using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class EvidenceReviewChecks
{
    public static async Task<int> RunAsync()
    {
        var count=0;void Check(bool value,string label){if(!value)throw new Exception("Evidence review: "+label);count++;}
        async Task Reject(Func<Task> action){var rejected=false;try{await action();}catch(InvalidDataException){rejected=true;}Check(rejected,"Invalid operation rejected");}
        var temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        var root=Path.Combine(temp,"pn-evidence-reviews-"+Guid.NewGuid().ToString("N"));
        var repo=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../../../../"));
        const string id="demo-showcase-l3-warehouse",step="Task_PhysicalReceipt";
        var data=Path.Combine(root,"Data");Directory.CreateDirectory(data);
        try
        {
            foreach(var suffix in new[]{".bpmn",".context.json"})File.Copy(Path.Combine(repo,"backend","ProcessNavigator.Api","Data",id+suffix),Path.Combine(data,id+suffix));
            var contextPath=Path.Combine(data,id+".context.json");
            var context=JsonNode.Parse(await File.ReadAllTextAsync(contextPath))!;
            var fixture=JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(repo,"master-data","package-context-fixture.json")))!;
            context["elements"]![step]!["evidence"]=fixture["evidence"]!.DeepClone();
            await File.WriteAllTextAsync(contextPath,context.ToJsonString());
            var env=new Environment(root);var catalog=new ProcessCatalogService(new BpmnProcessLoader(env));
            var service=new EvidenceReviewService(env,catalog);
            EvidenceReviewRequest Request(EvidenceReviewReport report,string action="review",string reason="Проверено по PKG-001")=>new(0,report.Version,report.Entries[0].Fingerprint,action,reason);
            var initial=await service.LoadAsync(id,step,false);
            Check(initial.Entries.Count==3&&initial.Entries[0].State=="unreviewed"&&!initial.History.Any(),"Empty history is not a confirmation");
            var reviewed=await service.RecordAsync(id,step,false,Request(initial),"actual-profile","Текущий профиль");
            Check(reviewed.Entries[0].State=="reviewed"&&reviewed.History.Count==1,"Review records matching snapshot");
            Check(reviewed.History[0].ActorId=="actual-profile"&&reviewed.History[0].Evidence.Author=="Учебный автор","Actor and claimed author stay separate");
            var duplicate=await service.RecordAsync(id,step,false,Request(initial),"actual-profile","Текущий профиль");
            Check(duplicate.History.Count==1,"Retry is idempotent");
            await Reject(()=>service.RecordAsync(id,step,false,Request(initial) with{Index=1,ExpectedFingerprint=initial.Entries[1].Fingerprint},"p","П"));
            await Reject(()=>service.RecordAsync(id,step,false,Request(initial) with{Reason=" "},"p","П"));
            await Reject(()=>service.RecordAsync(id,step,false,Request(initial) with{ExpectedVersion="old"},"p","П"));
            await Reject(()=>service.RecordAsync(id,step,false,Request(initial) with{ExpectedFingerprint="bad"},"p","П"));
            var withdrawn=await service.RecordAsync(id,step,false,Request(reviewed,"withdraw","Источник требует уточнения"),"other-profile","Другой профиль");
            Check(withdrawn.Entries[0].State=="withdrawn"&&withdrawn.History.Count==2,"Withdrawal appends rather than deletes");
            var checkedAgain=await service.RecordAsync(id,step,false,Request(withdrawn,"review","Источник уточнён"),"actual-profile","Текущий профиль");
            Check(checkedAgain.History.Count==3,"Rechecking has its own record");
            context["elements"]!["Task_ReceiptOrder"]!["description"]="Изменение другого этапа";
            await File.WriteAllTextAsync(contextPath,context.ToJsonString());
            var stale=await service.LoadAsync(id,step,false);
            Check(stale.Entries[0].State=="stale"&&stale.History.Count==3,"Any model edit invalidates applicability, history stays");
            await Reject(()=>service.RecordAsync(id,step,false,Request(checkedAgain),"p","П"));
            var current=await service.RecordAsync(id,step,false,Request(stale),"actual-profile","Текущий профиль");
            Check(current.Entries[0].State=="reviewed"&&current.History.Count==4,"New snapshot can be reviewed explicitly");
            await catalog.CreateDraftAsync(id);
            var draft=await service.LoadAsync(id,step,true);
            Check(draft.Entries[0].State=="unreviewed","Review never carries to another edition");
            await service.RecordAsync(id,step,true,Request(draft,"review","PRIVATE-DRAFT-REASON"),"actual-profile","Текущий профиль");
            var publicReport=await service.LoadAsync(id,step,false);
            Check(publicReport.History.Count==4&&!JsonSerializer.Serialize(publicReport).Contains("PRIVATE-DRAFT-REASON"),"Published read never exposes draft history");
            using(var stream=new MemoryStream(await catalog.ExportPackageAsync(id,false)))
            using(var archive=new ZipArchive(stream))
            {
                Check(archive.Entries.Count==3,"Portable package excludes the review journal");
                using var reader=new StreamReader(archive.GetEntry(id+".pn-context.json")!.Open());
                Check(!(await reader.ReadToEndAsync()).Contains("actual-profile"),"Review actor never enters portable context");
            }
            var path=Directory.GetFiles(Path.Combine(data,"EvidenceReviews"),"*.json").Single();
            var valid=await File.ReadAllBytesAsync(path);
            await File.WriteAllTextAsync(path,"{\"schemaVersion\":99}");
            await Reject(()=>service.LoadAsync(id,step,false));
            await Reject(()=>service.RecordAsync(id,step,false,Request(current),"p","П"));
            Check(await File.ReadAllTextAsync(path)=="{\"schemaVersion\":99}","Corruption is not overwritten");
            await File.WriteAllBytesAsync(path,valid);
            var cancelled=new CancellationToken(true);var cancelledCorrectly=false;
            try{await service.RecordAsync(id,step,false,Request(current),"p","П",cancelled);}catch(OperationCanceledException){cancelledCorrectly=true;}
            Check(cancelledCorrectly&&(await File.ReadAllBytesAsync(path)).SequenceEqual(valid),"Cancellation leaves journal unchanged");
            var full=JsonNode.Parse(valid)!;
            var template=full["events"]![0]!.DeepClone();var events=new JsonArray();
            for(var i=0;i<1000;i++){var e=template.DeepClone();e["id"]=Guid.NewGuid().ToString("N");events.Add(e);}
            full["events"]=events;await File.WriteAllTextAsync(path,full.ToJsonString());
            await Reject(()=>service.RecordAsync(id,step,false,Request(current,"review","Другая причина"),"p","П"));
            Check(JsonNode.Parse(await File.ReadAllTextAsync(path))!["events"]!.AsArray().Count==1000,"Limit never removes history");
            await File.WriteAllBytesAsync(path,valid);
            var backup=await new RepositoryBackupService(env).CreateAsync("fixture");
            using(var zip=ZipFile.OpenRead(Path.Combine(data,"Backups",backup.FileName)))Check(zip.Entries.Any(e=>e.FullName.StartsWith("Data/EvidenceReviews/")),"History participates in normal backup");
            var parallelScope=await service.LoadAsync(id,step,true);
            await Task.WhenAll(service.RecordAsync(id,step,true,Request(parallelScope,"review","Проверка A"),"a","Профиль A"),
                service.RecordAsync(id,step,true,Request(parallelScope,"review","Проверка B"),"b","Профиль B"));
            Check((await service.LoadAsync(id,step,true)).History.Count==7,"Concurrent reviewers never lose an appended event");
            context["elements"]![step]!["evidence"]=new JsonArray();
            await File.WriteAllTextAsync(contextPath,context.ToJsonString());
            var removed=await service.LoadAsync(id,step,false);
            Check(!removed.Entries.Any()&&removed.History.Count==4,"Removing evidence does not remove its history");
            await catalog.DeleteAsync(id);
            Check(!File.Exists(path),"Explicit deletion of the entire process removes its journal, preventing ID reuse leakage");
            return count;
        }
        finally
        {
            if(Path.GetDirectoryName(root)!=temp||!Path.GetFileName(root).StartsWith("pn-evidence-reviews-"))throw new Exception("Unsafe fixture cleanup");
            Directory.Delete(root,true);
        }
    }
    private sealed class Environment(string root):IWebHostEnvironment
    {
        public string ApplicationName{get;set;}="EvidenceReviewChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
        public string WebRootPath{get;set;}=root;public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
