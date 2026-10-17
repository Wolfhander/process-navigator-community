using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class MasterDataChecks
{
    public static async Task<int> RunAsync()
    {
        var source=Path.Combine(Directory.GetCurrentDirectory(),"master-data","v1");
        using var spec=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(source,"spec.json")));
        var expected=spec.RootElement.GetProperty("expected");
        var temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        var root=Path.Combine(temp,"pn-master-check-"+Guid.NewGuid().ToString("N"));
        var count=0;
        void Check(bool value,string message){if(!value)throw new Exception(message);count++;}
        void Passed(string id)=>Console.WriteLine("[master-data:"+id+"] PASS");
        try
        {
            var reference=Path.Combine(source,"reference");
            foreach(var file in Directory.EnumerateFiles(reference,"*",SearchOption.AllDirectories))
            {
                var destination=Path.Combine(root,Path.GetRelativePath(reference,file));
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);File.Copy(file,destination);
            }
            var template=Path.Combine(root,"Data","Templates","process-table-template.xlsx");Directory.CreateDirectory(Path.GetDirectoryName(template)!);
            File.Copy(Path.Combine(Directory.GetCurrentDirectory(),"backend","ProcessNavigator.Api","Data","Templates","process-table-template.xlsx"),template);
            var environment=new Host(root);var loader=new BpmnProcessLoader(environment);var catalog=new ProcessCatalogService(loader);
            var summaries=await catalog.ListAsync();Check(summaries.Count==expected.GetProperty("processes").GetInt32(),"Master catalog count");
            var models=await Task.WhenAll(summaries.Select(item=>catalog.LoadAsync(item.Id,false)));
            Check(models.Sum(model=>model.Nodes.Count)==expected.GetProperty("nodes").GetInt32(),"Master node count");
            Check(models.Sum(model=>model.Edges.Count)==expected.GetProperty("edges").GetInt32(),"Master edge count");
            Check(models.Sum(model=>model.Nodes.Count(node=>node.Type=="task"))==expected.GetProperty("tasks").GetInt32(),"Master task count");
            Check((await catalog.HierarchyAsync()).Max(item=>item.Level)==expected.GetProperty("maximumLevel").GetInt32(),"Master hierarchy depth");
            Passed("catalog");Passed("depth-and-reuse");
            var registry=new InformationObjectRegistryService(catalog,environment);
            var objects=await registry.BuildAsync(false);Check(objects.Objects.Count==expected.GetProperty("registryObjects").GetInt32(),"Master registry count: "+string.Join("; ",objects.Objects.Select(item=>item.Id+"="+item.Name+"("+item.State+")")));
            var document=objects.Objects.Single(item=>item.Id==spec.RootElement.GetProperty("document").GetProperty("id").GetString());
            Check(document.Id==spec.RootElement.GetProperty("document").GetProperty("id").GetString()&&document.Producers.Count==1&&document.Consumers.Count==1,"Master registry has exact source and recipient");Passed("registry");
            var locks=new ProcessEditLockService();var organization=new OrganizationMapService(environment,catalog,locks);
            var analytics=await new PortfolioAnalyticsService(catalog,organization,new ProcessExecutionService(environment),registry).BuildAsync();
            Check(analytics.TotalProcesses==5&&analytics.PublishedProcesses==5&&analytics.DraftProcesses==0,"Master analytics populations");
            Check(analytics.TotalDepartments==expected.GetProperty("units").GetInt32()&&analytics.TotalInstances==0,"Master analytics units and execution baseline");Passed("analytics");
            var schedule=new ProcessScheduleService(catalog,registry);
            foreach(var item in spec.RootElement.GetProperty("calendarCases").EnumerateArray())
            {
                var request=new ProcessScheduleRequestModel("md-order",item.GetProperty("direction").GetString()!,DateTimeOffset.Parse(item.GetProperty("anchor").GetString()!),NonWorkingDates:item.GetProperty("nonWorkingDates").EnumerateArray().Select(date=>date.GetString()!).ToArray(),UtcOffsetMinutes:180);
                var result=await schedule.CalculateAsync(request,false);
                Check(result.StartAt==DateTimeOffset.Parse(item.GetProperty("expectedStart").GetString()!)&&result.EndAt==DateTimeOffset.Parse(item.GetProperty("expectedEnd").GetString()!),"Master calendar case "+item.GetProperty("id").GetString());
            }
            Passed("calendar");
            var table=new ProcessTableService(catalog,organization,new RepositoryBackupService(environment),new ProcessAssignmentService(environment),new AccessControlService(environment),locks,loader,new ProcessTableImportHistoryService(environment));
            var exported=await table.ExportAsync("md-order",true,false);
            IFormFile Form(byte[] content)=>new FormFile(new MemoryStream(content),0,content.Length,"file","master.xlsx");
            var preview=await table.PreviewAsync(Form(exported.Content));
            Check(preview.ErrorCount==0,"Master XLSX roundtrip: "+string.Join("; ",preview.Issues.Where(issue=>issue.Severity=="Error").Take(3).Select(issue=>issue.Message)));
            Check(preview.ProcessCount==5&&preview.StepCount==17,"Master XLSX retains all processes and elements");Passed("xlsx-roundtrip");
            var single=await table.ExportAsync("md-order",false,false);
            var large=LargeBook(single.Content);
            var largePreview=await table.PreviewAsync(Form(large));
            Check(largePreview.ErrorCount==0,"Large workbook: "+string.Join("; ",largePreview.Issues.Where(issue=>issue.Severity=="Error").Take(3).Select(issue=>issue.Message)));
            Check(largePreview.StepCount==3002,"Large workbook parses all 3000 tasks plus two events");Passed("large-book");
            var reportDirectory=System.Environment.GetEnvironmentVariable("PN_MASTER_REPORT_DIR");
            if(!string.IsNullOrWhiteSpace(reportDirectory))
            {
                Directory.CreateDirectory(reportDirectory);
                await File.WriteAllBytesAsync(Path.Combine(reportDirectory,"master-processes.xlsx"),exported.Content);
                await File.WriteAllBytesAsync(Path.Combine(reportDirectory,"master-large-3000.xlsx"),large);
            }
        }
        finally
        {
            if(Path.GetDirectoryName(root)!=temp||!Path.GetFileName(root).StartsWith("pn-master-check-"))throw new Exception("Unsafe fixture cleanup");
            if(Directory.Exists(root))Directory.Delete(root,true);
        }
        return count;
    }
    private static byte[] LargeBook(byte[] original)
    {
        using var memory=new MemoryStream();memory.Write(original);memory.Position=0;
        using(var zip=new ZipArchive(memory,ZipArchiveMode.Update,true))
        {
            XNamespace ns="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
            XDocument Read(string name){using var stream=zip.GetEntry(name)!.Open();return XDocument.Load(stream);}
            void Write(string name,XDocument doc){zip.GetEntry(name)!.Delete();using var stream=zip.CreateEntry(name).Open();doc.Save(stream);}
            var sheet=Read("xl/worksheets/sheet3.xml");var data=sheet.Root!.Element(ns+"sheetData")!;
            var rows=data.Elements(ns+"row").Where(row=>(int?)row.Attribute("r")>3).ToArray();
            var start=rows[0];var task=rows[1];var end=rows[^1];
            foreach(var row in rows)row.Remove();
            XElement Copy(XElement input,int number,string id,string next)
            {
                var row=new XElement(input);row.SetAttributeValue("r",number);
                foreach(var cell in row.Elements(ns+"c"))
                {
                    var column=Regex.Match((string)cell.Attribute("r")!,"^[A-Z]+").Value;
                    cell.SetAttributeValue("r",column+number);
                    if(cell.Element(ns+"f") is {} formula)formula.Value=Regex.Replace(formula.Value,"([A-Z]+)[0-9]+","$1"+number);
                    if(column is "C" or "D" or "S" or "T"){cell.RemoveNodes();cell.SetAttributeValue("t","str");cell.Add(new XElement(ns+"v",column=="C"?(number-3).ToString():column=="D"?id:column=="S"?next:""));}
                }
                return row;
            }
            data.Add(Copy(start,4,"start","load-0"));
            for(var i=0;i<3000;i++)data.Add(Copy(task,i+5,"load-"+i,i==2999?"end":"load-"+(i+1)));
            data.Add(Copy(end,3005,"end",""));
            sheet.Root.Element(ns+"dimension")?.SetAttributeValue("ref","A1:AF3005");
            Write("xl/worksheets/sheet3.xml",sheet);
            var table=Read("xl/tables/table2.xml");table.Root!.SetAttributeValue("ref","A3:AF3005");table.Root.Element(ns+"autoFilter")?.SetAttributeValue("ref","A3:AF3005");Write("xl/tables/table2.xml",table);
            var channels=Read("xl/worksheets/sheet4.xml");channels.Descendants(ns+"row").Where(row=>(int?)row.Attribute("r")>3).Remove();Write("xl/worksheets/sheet4.xml",channels);
        }
        return memory.ToArray();
    }
    private sealed class Host(string root):IWebHostEnvironment
    {
        public string ApplicationName{get;set;}="MasterDataChecks";
        public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;
        public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
        public string WebRootPath{get;set;}=root;
        public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
