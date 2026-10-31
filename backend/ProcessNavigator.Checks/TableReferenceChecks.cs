using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;
internal static class TableReferenceChecks
{
    private static readonly XNamespace Main="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    public static async Task<int> RunAsync()
    {
        var count=0;void Check(bool ok,string label){if(!ok)throw new Exception("Reference queue: "+label);count++;}
        async Task Reject(Func<Task> action){var rejected=false;try{await action();}catch(InvalidDataException){rejected=true;}Check(rejected,"Unsafe decision rejected");}
        var temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);var root=Path.Combine(temp,"pn-reference-queue-"+Guid.NewGuid().ToString("N"));
        var repo=Directory.GetCurrentDirectory();var data=Path.Combine(root,"Data");Directory.CreateDirectory(data);
        try
        {
            var source=Path.Combine(repo,"backend","ProcessNavigator.Api","Data");
            foreach(var path in Directory.EnumerateFiles(source,"demo-showcase*"))File.Copy(path,Path.Combine(data,Path.GetFileName(path)));
            File.Copy(Path.Combine(source,"organization.json"),Path.Combine(data,"organization.json"));
            foreach(var folder in new[]{"Templates","InformationObjects"})foreach(var path in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories))
            {var target=Path.Combine(data,folder,Path.GetRelativePath(Path.Combine(source,folder),path));Directory.CreateDirectory(Path.GetDirectoryName(target)!);File.Copy(path,target);}
            var env=new Environment(root);var loader=new BpmnProcessLoader(env);var catalog=new ProcessCatalogService(loader);var locks=new ProcessEditLockService();
            var org=new OrganizationMapService(env,catalog,locks);var users=new AccessControlService(env);var registry=new InformationObjectRegistryService(catalog,env);
            var service=new ProcessTableService(catalog,org,new RepositoryBackupService(env),new ProcessAssignmentService(env),users,locks,loader,new ProcessTableImportHistoryService(env));
            IFormFile Form(byte[] bytes)=>new FormFile(new MemoryStream(bytes),0,bytes.Length,"tableFile","references.xlsx");
            var fixture=JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(repo,"master-data","reference-queue-fixture.json")))!;
            var exported=(await service.ExportAsync(fixture["processId"]!.GetValue<string>(),false,false)).Content;
            var damaged=Edit(exported,(sheet,header,row,value)=>fixture["changes"]!.AsArray().FirstOrDefault(change=>
                change!["sheet"]!.GetValue<string>()==sheet&&change["column"]!.GetValue<string>()==header&&
                (change["row"] is null||change["row"]!.GetValue<int>()==row)&&
                (change["nonEmpty"]?.GetValue<bool>()!=true||value.Length>0))?["value"]?.GetValue<string>());
            string State()=>string.Join("|",Directory.EnumerateFiles(data,"*",SearchOption.AllDirectories).Order().Select(p=>Path.GetRelativePath(data,p)+":"+Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p)))));
            var before=State();
            var artifacts=Path.Combine(repo,"artifacts","reference-queue");Directory.CreateDirectory(artifacts);
            await File.WriteAllBytesAsync(Path.Combine(artifacts,"references-input.xlsx"),damaged);
            var report=await service.ReferencesAsync(Form(damaged),registry,true);
            Check(report.Groups.Select(g=>g.Kind).Distinct().Count()==6,"All five domains, document ID and channel name included");
            Check(report.Groups.Any(g=>g.Cells.Any(c=>c.Cell.EndsWith("5")&&c.ProcessId=="demo-showcase-l3-warehouse")),"Exact cells and process IDs");
            var organization=report.Groups.Single(g=>g.Kind=="entity"&&g.Value=="ghost-org");
            var unit=report.Groups.Single(g=>g.Kind=="unit"&&g.Value=="ghost-unit");
            Check(organization.Cells.Count>1&&unit.Scope=="ghost-org","Repeated values grouped; unit scoped by organization");
            TableReferenceResolution Plan(params TableReferenceRule[] rules)=>new(report.Fingerprint,rules);
            await Reject(()=>service.ResolveReferencesAsync(Form(damaged),new("stale",[new(organization.Id,"plant")]),registry,true));
            await Reject(()=>service.ResolveReferencesAsync(Form(damaged),Plan(new TableReferenceRule(unit.Id,"1.2.5")),registry,true));
            await Reject(()=>service.ResolveReferencesAsync(Form(damaged),Plan(new TableReferenceRule(organization.Id,KeepNew:true)),registry,true));
            await Reject(()=>service.ResolveReferencesAsync(Form(damaged),Plan(new TableReferenceRule(organization.Id,"plant"),new TableReferenceRule(organization.Id,"plant")),registry,true));
            await Reject(()=>service.ResolveReferencesAsync(Form(damaged),Plan(new TableReferenceRule("absent","plant")),registry,true));
            var rules=report.Groups.Where(g=>g.Value.StartsWith("ghost-")&&g.Kind!="unit").Select(g=>new TableReferenceRule(g.Id,g.Kind switch{
                "entity"=>"plant","user"=>"demo-employee","system"=>"1С:ERP","object" or "document"=>"demo-receipt-inspection",_=>throw new Exception()})).ToArray();
            var first=await service.ResolveReferencesAsync(Form(damaged),Plan(rules),registry,true);
            var secondReport=await service.ReferencesAsync(Form(first),registry,true);
            Check(!secondReport.Groups.Any(g=>g.Value.StartsWith("ghost-")&&g.Kind!="unit"),"Chosen references replaced in every occurrence");
            var nextUnit=secondReport.Groups.Single(g=>g.Value=="ghost-unit");
            Check(nextUnit.Scope=="plant","Organization decision enables its units on next pass");
            var corrected=await service.ResolveReferencesAsync(Form(first),new(secondReport.Fingerprint,[new(nextUnit.Id,"1.2.5")]),registry,true);
            var preview=await service.PreviewAsync(Form(corrected));
            await File.WriteAllBytesAsync(Path.Combine(artifacts,"references-resolved.xlsx"),corrected);
            Check(preview.ErrorCount==0,"Corrected copy passes ordinary import preview: "+string.Join("; ",preview.Issues.Where(i=>i.Severity=="Error").Select(i=>i.Message)));
            Check(Read(corrected,"Шаги","Сотрудники ID",5)=="demo-employee | demo-employee","Token replacement retains every other employee token, without silent deduplication");
            Check(Read(corrected,"Шаги","Объекты реестра — названия",5)=="Результат физической приёмки","Object name follows its chosen ID");
            Check(Read(corrected,"Шаги","Описание",5)==Read(damaged,"Шаги","Описание",5),"Unrelated text unchanged");
            using(var a=new ZipArchive(new MemoryStream(damaged)))
            using(var b=new ZipArchive(new MemoryStream(corrected)))
                Check(a.GetEntry("xl/styles.xml")!.Length==b.GetEntry("xl/styles.xml")!.Length&&Bytes(a,"xl/styles.xml").SequenceEqual(Bytes(b,"xl/styles.xml")),"Styles preserved byte-for-byte");
            Check(State()==before,"Reference analysis and correction do not write application data");
            await Reject(()=>service.ResolveReferencesAsync(Form(first),Plan(rules),registry,true));
            var system=report.Groups.Single(g=>g.Value=="ghost-system");
            var kept=await service.ResolveReferencesAsync(Form(damaged),Plan(new TableReferenceRule(system.Id,KeepNew:true)),registry,true);
            Check(Read(kept,"Шаги","Система выполнения",5)=="ghost-system","Keeping new text does not invent a catalogue entry");
            var orgPath=Path.Combine(data,"organization.json");var orgBytes=await File.ReadAllBytesAsync(orgPath);
            var changed=JsonNode.Parse(orgBytes)!;changed["name"]="Changed dictionary";changed["legalEntities"]![0]!["name"]="Renamed entity";await File.WriteAllTextAsync(orgPath,changed.ToJsonString());
            await Reject(()=>service.ResolveReferencesAsync(Form(damaged),Plan(rules),registry,true));await File.WriteAllBytesAsync(orgPath,orgBytes);
            var formula=Edit(damaged,(sheet,header,row,value)=>sheet=="Шаги"&&header=="Система выполнения"&&row==5?"=1":null,true);
            var formulaReport=await service.ReferencesAsync(Form(formula),registry,true);var formulaGroup=formulaReport.Groups.Single(g=>g.Kind=="system"&&g.Value=="ghost-system");
            await Reject(()=>service.ResolveReferencesAsync(Form(formula),new(formulaReport.Fingerprint,[new(formulaGroup.Id,"1С:ERP")]),registry,true));
            using var signedStream=new MemoryStream();signedStream.Write(damaged);signedStream.Position=0;
            using(var zip=new ZipArchive(signedStream,ZipArchiveMode.Update,true)){var entry=zip.CreateEntry("_xmlsignatures/sig1.xml");using var output=entry.Open();output.Write([1]);}
            var signed=signedStream.ToArray();var signedReport=await service.ReferencesAsync(Form(signed),registry,true);
            await Reject(()=>service.ResolveReferencesAsync(Form(signed),new(signedReport.Fingerprint,[new(organization.Id,"plant")]),registry,true));
            return count;
        }
        finally{if(Path.GetDirectoryName(root)!=temp||!Path.GetFileName(root).StartsWith("pn-reference-queue-"))throw new Exception("Unsafe fixture cleanup");Directory.Delete(root,true);}
    }
    private static byte[] Bytes(ZipArchive zip,string path){using var input=zip.GetEntry(path)!.Open();using var output=new MemoryStream();input.CopyTo(output);return output.ToArray();}
    private static string Text(XElement cell)=>cell.Attribute("t")?.Value=="inlineStr"?string.Concat(cell.Descendants(Main+"t").Select(t=>t.Value)):cell.Element(Main+"v")?.Value??"";
    private static byte[] Edit(byte[] bytes,Func<string,string,int,string,string?> change,bool formula=false)
    {
        using var stream=new MemoryStream();stream.Write(bytes);stream.Position=0;
        using(var zip=new ZipArchive(stream,ZipArchiveMode.Update,true))
        foreach(var name in new[]{"Процессы","Шаги","Каналы"})
        {
            var workbook=XDocument.Load(new MemoryStream(Bytes(zip,"xl/workbook.xml")));
            var links=XDocument.Load(new MemoryStream(Bytes(zip,"xl/_rels/workbook.xml.rels")));
            XNamespace rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
            var id=(string)workbook.Descendants(Main+"sheet").Single(s=>(string?)s.Attribute("name")==name).Attribute(rel+"id")!;
            var path=(string)links.Root!.Elements().Single(e=>(string?)e.Attribute("Id")==id).Attribute("Target")!;
            path=path.TrimStart('/');if(!path.StartsWith("xl/"))path="xl/"+path;
            var xml=XDocument.Load(new MemoryStream(Bytes(zip,path)));
            var headers=xml.Descendants(Main+"row").Single(r=>(string?)r.Attribute("r")=="3").Elements(Main+"c").ToDictionary(c=>new string(((string)c.Attribute("r")!).TakeWhile(char.IsLetter).ToArray()),Text);
            foreach(var row in xml.Descendants(Main+"row").Where(r=>(int)r.Attribute("r")!>3))
            foreach(var cell in row.Elements(Main+"c"))
            {
                var column=new string(((string)cell.Attribute("r")!).TakeWhile(char.IsLetter).ToArray());
                if(!headers.TryGetValue(column,out var header))continue;var value=change(name,header,(int)row.Attribute("r")!,Text(cell));if(value is null)continue;
                if(formula){cell.SetAttributeValue("t","str");cell.RemoveNodes();cell.Add(new XElement(Main+"f","1"),new XElement(Main+"v","ghost-system"));}
                else{cell.RemoveNodes();cell.SetAttributeValue("t","inlineStr");cell.Add(new XElement(Main+"is",new XElement(Main+"t",value)));}
            }
            zip.GetEntry(path)!.Delete();var entry=zip.CreateEntry(path);using var output=entry.Open();xml.Save(output);
        }
        return stream.ToArray();
    }
    private static string Read(byte[] bytes,string sheet,string column,int row)
    {
        string? result=null;Edit(bytes,(s,c,r,v)=>{if(s==sheet&&c==column&&r==row)result=v;return null;});return result??"";
    }
    private sealed class Environment(string root):IWebHostEnvironment
    {
        public string ApplicationName{get;set;}="TableReferenceChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
        public string WebRootPath{get;set;}=root;public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
