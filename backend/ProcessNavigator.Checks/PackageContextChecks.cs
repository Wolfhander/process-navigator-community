using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class PackageContextChecks
{
    public static async Task<int> RunAsync()
    {
        var count=0;
        void Check(bool value,string label){if(!value)throw new Exception("Package: "+label);count++;}
        var temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        var root=Path.Combine(temp,"pn-package-context-"+Guid.NewGuid().ToString("N"));
        var sourceRoot=Path.Combine(root,"source");
        var repository=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../../../../"));
        var shipped=Path.Combine(repository,"backend","ProcessNavigator.Api","Data");
        Directory.CreateDirectory(Path.Combine(sourceRoot,"Data"));
        try
        {
            foreach(var file in Directory.EnumerateFiles(shipped,"demo-showcase-*").Where(f=>f.EndsWith(".bpmn")||f.EndsWith(".context.json")))
                File.Copy(file,Path.Combine(sourceRoot,"Data",Path.GetFileName(file)));
            const string id="demo-showcase-l3-warehouse";
            var contextPath=Path.Combine(sourceRoot,"Data",id+".context.json");
            var context=JsonNode.Parse(await File.ReadAllTextAsync(contextPath))!;
            var fixture=JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(repository,"master-data","package-context-fixture.json")))!;
            context["elements"]!["Task_PhysicalReceipt"]!["evidence"]=fixture["evidence"]!.DeepClone();
            context["passport"]!["sourceRequirements"]=fixture["sourceRequirements"]!.DeepClone();
            context["workflow"]=JsonNode.Parse("""{"state":"Approved","approvals":[{"userId":"must-not-transfer"}]}""");
            await File.WriteAllTextAsync(contextPath,context.ToJsonString());
            ProcessCatalogService Catalog(string name){var path=Path.Combine(root,name);Directory.CreateDirectory(Path.Combine(path,"Data"));return new(new BpmnProcessLoader(new Environment(path)));}
            var source=new ProcessCatalogService(new BpmnProcessLoader(new Environment(sourceRoot)));
            var target=Catalog("target");
            var packages=new Dictionary<string,byte[]>();
            foreach(var name in Directory.EnumerateFiles(Path.Combine(sourceRoot,"Data"),"*.bpmn").Select(Path.GetFileNameWithoutExtension))
            {
                var original=await source.LoadAsync(name!,false);
                var bytes=await source.ExportPackageAsync(name!,false);packages[name!]=bytes;
                var entries=Unpack(bytes);
                Check(entries.Count==3&&entries.ContainsKey(name+".pn-context.json"),"Only BPMN, portable context and readme exported");
                Check(!Encoding.UTF8.GetString(entries[name+".pn-context.json"]).Contains("must-not-transfer"),"Approvals excluded");
                var result=await Import(target,bytes);
                Check(result.Imported==1&&result.Failed==0,"Shipped model imported");
                var imported=await target.LoadAsync(name!,true);
                Check(Canonical(imported)==Canonical(original with{Version="0.1",Status="Draft"}),"Editable context, geometry, executor and types survive");
                Check((await File.ReadAllBytesAsync(Path.Combine(root,"target","Data","Drafts",name+".bpmn"))).SequenceEqual(entries[name+".bpmn"]),"BPMN bytes unchanged");
                Check((await Import(target,bytes)).Skipped==1,"Existing ID not overwritten");
            }
            var warehouse=await target.LoadAsync(id,true);
            Check(warehouse.Nodes.Single(n=>n.Id=="Task_PhysicalReceipt").Evidence!.Count==3,"Fact assumption and question retained");
            Check(warehouse.Passport!.SourceRequirements!.Single().CheckSequence,"Requirement sequence retained");
            Check(warehouse.Nodes.Single(n=>n.Id=="Task_SystemNotice").ExecutorKind=="system","System executor remains separate");
            Check(warehouse.Nodes.Single(n=>n.Id=="Task_ReceiptOrder").ExecutorKind=="human","ERP user task remains human");
            foreach(var kind in new[]{"manualTask","userTask","serviceTask","sendTask","receiveTask","businessRuleTask"})
            {
                var name="package-"+kind;
                var bpmn=XDocument.Load(Path.Combine(sourceRoot,"Data","demo-showcase-l4-drawing.bpmn"));
                XNamespace ns="http://www.omg.org/spec/BPMN/20100524/MODEL";
                var process=bpmn.Descendants(ns+"process").Single();var oldId=(string)process.Attribute("id")!;
                process.SetAttributeValue("id",name);
                foreach(var attribute in bpmn.Descendants().Attributes("bpmnElement").Where(a=>a.Value==oldId))attribute.Value=name;
                var taskIds=process.Elements().Where(e=>e.Name.LocalName is "task" or "manualTask" or "userTask" or "serviceTask" or "sendTask" or "receiveTask" or "businessRuleTask").Select(e=>{e.Name=ns+kind;return(string)e.Attribute("id")!;}).ToArray();
                bpmn.Save(Path.Combine(sourceRoot,"Data",name+".bpmn"));
                var typedContext=JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(sourceRoot,"Data","demo-showcase-l4-drawing.context.json")))!;
                foreach(var task in taskIds)typedContext["elements"]![task]!["executorKind"]=kind=="serviceTask"?"system":"human";
                await File.WriteAllTextAsync(Path.Combine(sourceRoot,"Data",name+".context.json"),typedContext.ToJsonString());
                var typedBytes=await source.ExportPackageAsync(name,false);
                Check((await Import(target,typedBytes)).Imported==1,"Task subtype package imported");
                var typed=await target.LoadAsync(name,true);
                Check(typed.Nodes.Where(n=>taskIds.Contains(n.Id)).All(n=>n.BpmnType==kind),"BPMN subtype preserved");
                Check(typed.Nodes.Where(n=>taskIds.Contains(n.Id)).All(n=>n.ExecutorKind==(kind=="serviceTask"?"system":"human")),"Explicit executor preserved");
            }
            var originalEntries=Unpack(packages[id]);
            var sidecar=id+".pn-context.json";
            var invalid=new List<Action<JsonObject>>
            {
                p=>p["schemaVersion"]=2,
                p=>p["schemaVersion"]="one",
                p=>p["processId"]="wrong",
                p=>p["sourceVersion"]="wrong",
                p=>p["unknown"]=true,
                p=>p["context"]!["workflow"]=new JsonObject(),
                p=>p["context"]!["elements"]!["lost"]=new JsonObject(),
                p=>p["context"]!["elements"]!["Task_PhysicalReceipt"]!["executorKind"]="robot",
                p=>p["context"]!["elements"]!["Task_PhysicalReceipt"]!["evidence"]=JsonNode.Parse("""[{"status":"fact","statement":"Нет источника"}]"""),
                p=>p["context"]!["elements"]!["Task_PhysicalReceipt"]!["actions"]=JsonNode.Parse("""[{"id":"bad","label":"Bad","kind":"url","target":"javascript:bad"}]"""),
                p=>p["context"]!["elements"]!["Task_PhysicalReceipt"]!["actions"]=JsonNode.Parse("[null]"),
                p=>p["context"]!["elements"]!["Task_PhysicalReceipt"]!["typo"]="lost"
            };
            var index=0;
            foreach(var mutate in invalid)
            {
                var payload=JsonNode.Parse(originalEntries[sidecar])!.AsObject();mutate(payload);
                var entries=new Dictionary<string,byte[]>(originalEntries){[sidecar]=Encoding.UTF8.GetBytes(payload.ToJsonString())};
                var result=await Import(Catalog("bad"+index++),Pack(entries));
                Check(result.Failed==1&&result.Imported==0,"Invalid portable context rejected before writing");
            }
            var duplicate=Encoding.UTF8.GetString(originalEntries[sidecar]).Replace("\"schemaVersion\": 1","\"schemaVersion\": 1, \"schemaVersion\": 1");
            Check((await Import(Catalog("duplicate-json"),Pack(new Dictionary<string,byte[]>(originalEntries){[sidecar]=Encoding.UTF8.GetBytes(duplicate)}))).Failed==1,"Duplicate JSON keys rejected");
            Check((await Import(Catalog("duplicate-sidecar"),Pack(originalEntries.Concat([new KeyValuePair<string,byte[]>(sidecar,originalEntries[sidecar])])))).Failed==1,"Ambiguous sidecar rejected");
            var oversized=new Dictionary<string,byte[]>(originalEntries){[sidecar]=new byte[2*1024*1024+1]};
            Check((await Import(Catalog("oversized"),Pack(oversized))).Failed==1,"Oversized context rejected");
            var ambiguousPassports=originalEntries.Concat(new Dictionary<string,byte[]>{{"a/"+id+".md",Encoding.UTF8.GetBytes("One")},{"b/"+id+".md",Encoding.UTF8.GetBytes("Two")}});
            Check((await Import(Catalog("ambiguous-passports"),Pack(ambiguousPassports))).Failed==1,"Ambiguous passports reported per item");
            var old=originalEntries.Where(e=>!e.Key.EndsWith(".pn-context.json")).ToArray();
            Check((await Import(Catalog("legacy"),Pack(old))).Imported==1,"Legacy package remains supported");
            var mixed=new Dictionary<string,byte[]>(originalEntries){[sidecar]=Encoding.UTF8.GetBytes("{}")};
            foreach(var pair in Unpack(packages["demo-showcase-l4-drawing"]).Where(e=>e.Key!="README.txt"))mixed.Add(pair.Key,pair.Value);
            var mixedResult=await Import(Catalog("mixed"),Pack(mixed));
            Check(mixedResult.Imported==1&&mixedResult.Failed==1,"One invalid process does not hide a valid sibling");
            var draftExport=await target.ExportPackageAsync(id,true);
            Check(Unpack(draftExport).ContainsKey(sidecar),"Explicit draft export supported");
            return count;
        }
        finally
        {
            if(Path.GetDirectoryName(root)!=temp||!Path.GetFileName(root).StartsWith("pn-package-context-"))throw new Exception("Unsafe fixture cleanup");
            Directory.Delete(root,true);
        }
    }
    private static async Task<ProcessPackageImportResultModel> Import(ProcessCatalogService catalog,byte[] bytes)
    {
        using var stream=new MemoryStream(bytes);
        return await catalog.ImportPackageAsync(new FormFile(stream,0,stream.Length,"packageFile","models.zip"));
    }
    private static Dictionary<string,byte[]> Unpack(byte[] bytes)
    {
        using var stream=new MemoryStream(bytes);using var archive=new ZipArchive(stream);
        return archive.Entries.ToDictionary(e=>e.FullName,e=>{using var input=e.Open();using var output=new MemoryStream();input.CopyTo(output);return output.ToArray();});
    }
    private static byte[] Pack(IEnumerable<KeyValuePair<string,byte[]>> entries)
    {
        using var stream=new MemoryStream();
        using(var archive=new ZipArchive(stream,ZipArchiveMode.Create,true))
            foreach(var pair in entries){using var entry=archive.CreateEntry(pair.Key).Open();entry.Write(pair.Value);}
        return stream.ToArray();
    }
    private static string Canonical(ProcessModel model)
    {
        var root=JsonSerializer.SerializeToNode(model,new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        static void Clean(JsonNode node)
        {
            if(node is JsonObject obj)foreach(var property in obj.ToArray())
            {
                if(property.Value is null||property.Value is JsonArray{Count:0})obj.Remove(property.Key);
                else Clean(property.Value);
            }
            else if(node is JsonArray array)foreach(var child in array)if(child is not null)Clean(child);
        }
        Clean(root);return root.ToJsonString();
    }
    private sealed class Environment(string root):IWebHostEnvironment
    {
        public string ApplicationName{get;set;}="PackageContextChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
        public string WebRootPath{get;set;}=root;public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
