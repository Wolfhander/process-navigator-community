using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
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
            using var control=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(source,"registry-control.json")));
            Check(objects.Objects.Count==control.RootElement.GetArrayLength(),"Registry control covers the entire catalog");
            foreach(var row in control.RootElement.EnumerateArray())
            {
                var actual=objects.Objects.Single(item=>item.Id==row.GetProperty("id").GetString());
                Check(actual.Name==row.GetProperty("name").GetString()&&actual.Kind==row.GetProperty("kind").GetString()&&actual.State==row.GetProperty("expectedState").GetString(),"Registry control: "+actual.Id+" / "+actual.Name+" / "+actual.Kind+" / "+actual.State);
            }
            var document=objects.Objects.Single(item=>item.Id==spec.RootElement.GetProperty("document").GetProperty("id").GetString());
            Check(document.Id==spec.RootElement.GetProperty("document").GetProperty("id").GetString()&&document.Producers.Count==1&&document.Consumers.Count==1,"Master registry has exact source and recipient");Passed("registry");
            var locks=new ProcessEditLockService();var organization=new OrganizationMapService(environment,catalog,locks);
            var analytics=await new PortfolioAnalyticsService(catalog,organization,new ProcessExecutionService(environment),registry).BuildAsync();
            Check(analytics.TotalProcesses==5&&analytics.PublishedProcesses==5&&analytics.DraftProcesses==0,"Master analytics populations");
            Check(analytics.TotalDepartments==expected.GetProperty("units").GetInt32()&&analytics.TotalInstances==0,"Master analytics units and execution baseline");Passed("analytics");
            Check(analytics.ProcessesWithOwner==5&&analytics.ProcessesWithOrganization==5&&analytics.ParticipatingDepartments==3,"Analytics owner/organization/participation coverage");
            Check(analytics.ProcessesWithAllDurations==5&&analytics.ProcessesWithSystems==5&&analytics.ProcessesWithDecomposition==4,$"Analytics durations, systems and parents: {analytics.ProcessesWithAllDurations}/{analytics.ProcessesWithSystems}/{analytics.ProcessesWithDecomposition}");
            Check(analytics.InformationObjectCount==5&&analytics.CrossLaneTransferCount==1&&analytics.AverageReadinessPercent==100,"Analytics object/transfer/readiness formulas");
            Check(analytics.Levels.Count==5&&analytics.Levels.All(item=>item.ProcessCount==1)&&analytics.Systems.Single().TaskCount==7,"Analytics level and task distributions");
            var contextPath=Path.Combine(root,"Data","md-order.context.json");
            var heatmap=await new OrganizationHeatmapService(catalog,organization,new ProcessExecutionService(environment)).BuildAsync(default);
            Check(heatmap.Rows.Count==6&&heatmap.Rows.Count(r=>r.ProcessCount>0)==3,"Heatmap real loader includes participating and unused master units");
            Check(heatmap.Rows.Sum(r=>r.TaskCount)==7&&heatmap.Rows.Sum(r=>r.OwnedProcessCount)==5,"Heatmap real loader reconciles tasks and stable owners");
            Check(heatmap.Rows.All(r=>r.OverdueCount==null),"Master has no instances, not a zero-delay enterprise");
            var transferService=new TransferAnalyticsService(catalog);
            var baselineTransfers=await transferService.BuildAsync(default);
            Check(baselineTransfers.ProcessCount==5&&!baselineTransfers.Findings.Any(f=>f.Code=="nested-transition"),"Same-system master does not invent nested system transfers");
            var leafContextPath=Path.Combine(root,"Data","md-drawing.context.json");
            var leafOriginal=await File.ReadAllTextAsync(leafContextPath);
            try
            {
                var leafContext=JsonNode.Parse(leafOriginal)!;
                leafContext["elements"]!["task-1"]!["channels"]![0]!["systemName"]="Учебная ERP";
                await File.WriteAllTextAsync(leafContextPath,leafContext.ToJsonString());
                var nestedReport=await transferService.BuildAsync(default);
                var reused=nestedReport.Findings.Single(f=>f.Code=="nested-transition"&&f.ProcessId=="md-order");
                Check(reused.SourceProcessId=="md-drawing"&&reused.TargetProcessId=="md-drawing","Real loader resolves both calls to fourth-level endpoints");
                Check(reused.RouteElementIds!.Contains("md-order/task-1")&&reused.RouteElementIds!.Contains("md-order/task-2"),"Real catalog preserves both occurrences of shared detailed process");
            }
            finally {await File.WriteAllTextAsync(leafContextPath,leafOriginal);}
            var originalContext=await File.ReadAllTextAsync(contextPath);
            try
            {
                var context=JsonNode.Parse(originalContext)!;var task=context["elements"]!["task-1"]!;
                task["systemName"]="Учебная PLM";
                var duplicate=task["channels"]![0]!.DeepClone();duplicate["id"]="duplicate-channel";duplicate["systemName"]="учебная plm";
                task["channels"]!.AsArray().Add(duplicate);
                await File.WriteAllTextAsync(contextPath,context.ToJsonString());
                var duplicateAnalytics=await new PortfolioAnalyticsService(catalog,organization,new ProcessExecutionService(environment),registry).BuildAsync();
                Check(duplicateAnalytics.Systems.Single().TaskCount==7,"Legacy and repeated channels count a system once per task");
            }
            finally { await File.WriteAllTextAsync(contextPath,originalContext); }
            var history=new PortfolioHistoryService(environment,new PortfolioAnalyticsService(catalog,organization,new ProcessExecutionService(environment),registry));
            var baseline=await history.SaveAsync("history-a",new("Исходный мастер-контур",analytics));
            Check(baseline.Data.AverageReadinessPercent==100&&baseline.Algorithm==PortfolioHistoryService.Algorithm,"History captures server values and methodology");
            Check((await history.SaveAsync("history-a",new("Исходный мастер-контур",analytics))).Id==baseline.Id,"History retry is idempotent");
            var reopenedHistory=new PortfolioHistoryService(environment,new PortfolioAnalyticsService(catalog,organization,new ProcessExecutionService(environment),registry));
            Check((await reopenedHistory.LoadAsync("history-a",baseline.Id)).Fingerprint==baseline.Fingerprint,"History survives service restart");
            Check((await history.ListAsync("history-b")).Count==0,"History lists are profile-isolated");
            try { await history.LoadAsync("history-b",baseline.Id);Check(false,"History owner isolation"); } catch(KeyNotFoundException){Check(true,"History owner isolation");}
            try { await history.LoadAsync("history-a","../bad");Check(false,"History ID validation"); } catch(InvalidDataException){Check(true,"History ID validation");}
            PortfolioHistorySnapshotModel changedSnapshot;
            try
            {
                var context=JsonNode.Parse(originalContext)!;context["elements"]!["task-1"]!["description"]="";
                await File.WriteAllTextAsync(contextPath,context.ToJsonString());
                try { await history.SaveAsync("history-a",new("Устаревший экран",analytics));Check(false,"Stale history rejected"); } catch(InvalidDataException){Check(true,"Stale history rejected");}
                var changedAnalytics=await new PortfolioAnalyticsService(catalog,organization,new ProcessExecutionService(environment),registry).BuildAsync();
                Check(changedAnalytics.AverageReadinessPercent==97.5,"Independent expected change: one of two root descriptions missing");
                changedSnapshot=await history.SaveAsync("history-a",new("Описание требует уточнения",changedAnalytics));
                Check((await history.LoadAsync("history-a",baseline.Id)).Data.AverageReadinessPercent==100,"Frozen baseline does not change with live model");
                Check(changedSnapshot.Data.Processes.Single(p=>p.Id=="md-order").ReadinessPercent==87.5,"History preserves per-model source");
            }
            finally { await File.WriteAllTextAsync(contextPath,originalContext); }
            var repeated=await Task.WhenAll(Enumerable.Range(0,4).Select(_=>history.SaveAsync("history-a",new("Параллельный повтор",analytics))));
            Check(repeated.Select(item=>item.Id).Distinct().Count()==1&&(await history.ListAsync("history-a")).Count==3,"Concurrent retries do not lose or duplicate records");
            using(var cancelled=new CancellationTokenSource())
            {
                cancelled.Cancel();
                try { await history.SaveAsync("history-a",new("Отменённый",analytics),cancelled.Token);Check(false,"History cancellation"); } catch(OperationCanceledException){Check(true,"History cancellation");}
                Check((await history.ListAsync("history-a")).Count==3,"Cancellation leaves existing history intact");
            }
            await history.SaveAsync("history-corrupt",new("До повреждения",analytics));
            var corruptPath=Path.Combine(root,"Data","PortfolioHistory",Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("history-corrupt")))+".json");
            await File.WriteAllTextAsync(corruptPath,"{broken");
            try { await history.SaveAsync("history-corrupt",new("Не перезаписывать",analytics));Check(false,"Corrupt history protected"); } catch(InvalidDataException){Check(true,"Corrupt history protected");}
            Check(await File.ReadAllTextAsync(corruptPath)=="{broken","Corruption is not replaced with an empty history");
            await history.SaveAsync("history-integrity",new("Контроль целостности",analytics));
            var integrityPath=Path.Combine(root,"Data","PortfolioHistory",Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("history-integrity")))+".json");
            var tampered=JsonNode.Parse(await File.ReadAllTextAsync(integrityPath))!;tampered["snapshots"]![0]!["data"]!["averageReadinessPercent"]=99;
            await File.WriteAllTextAsync(integrityPath,tampered.ToJsonString());
            try { await history.ListAsync("history-integrity");Check(false,"History fingerprint detects modification"); } catch(InvalidDataException){Check(true,"History fingerprint detects modification");}
            for(var i=0;i<30;i++)await history.SaveAsync("history-limit",new("Срез "+i,analytics));
            try { await history.SaveAsync("history-limit",new("Лишний срез",analytics));Check(false,"History count limit"); } catch(InvalidDataException){Check(true,"History count limit");}
            Check((await history.ListAsync("history-limit")).Count==30&&!Directory.EnumerateFiles(Path.Combine(root,"Data","PortfolioHistory"),"*.tmp").Any(),"Limit keeps all records; atomic write leaves no temporary files");
            var clock=new HistoryClock(DateTimeOffset.UtcNow);
            var timedHistory=new PortfolioHistoryService(environment,new PortfolioAnalyticsService(catalog,organization,new ProcessExecutionService(environment),registry),clock);
            var firstObservation=await timedHistory.SaveAsync("history-clock",new("Ежедневное наблюдение",analytics));
            clock.Advance(TimeSpan.FromMinutes(2));
            var secondObservation=await timedHistory.SaveAsync("history-clock",new("Ежедневное наблюдение",analytics));
            Check(firstObservation.Id!=secondObservation.Id&&secondObservation.CapturedAt>firstObservation.CapturedAt,"Unchanged values can be observed again later; retry deduplication is not permanent");
            Passed("analytics-history");
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
                await File.WriteAllTextAsync(Path.Combine(reportDirectory,"registry-actual.json"),JsonSerializer.Serialize(objects,new JsonSerializerOptions(JsonSerializerDefaults.Web){WriteIndented=true}));
                await File.WriteAllTextAsync(Path.Combine(reportDirectory,"analytics-actual.json"),JsonSerializer.Serialize(analytics,new JsonSerializerOptions(JsonSerializerDefaults.Web){WriteIndented=true}));
                await File.WriteAllTextAsync(Path.Combine(reportDirectory,"portfolio-history-before.json"),JsonSerializer.Serialize(baseline,new JsonSerializerOptions(JsonSerializerDefaults.Web){WriteIndented=true}));
                await File.WriteAllTextAsync(Path.Combine(reportDirectory,"portfolio-history-after.json"),JsonSerializer.Serialize(changedSnapshot,new JsonSerializerOptions(JsonSerializerDefaults.Web){WriteIndented=true}));
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
    private sealed class HistoryClock(DateTimeOffset now):TimeProvider
    {
        public override DateTimeOffset GetUtcNow()=>now;
        public void Advance(TimeSpan duration)=>now+=duration;
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
