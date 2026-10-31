using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.IO.Compression;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class SourceMaterialChecks
{
    public static async Task<int> RunAsync()
    {
        var count=0;void Check(bool value,string label){if(!value)throw new Exception("Source material: "+label);count++;}
        async Task Reject(Func<Task> action){var rejected=false;try{await action();}catch(InvalidDataException){rejected=true;}Check(rejected,"Invalid operation rejected");}
        var temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        var root=Path.Combine(temp,"pn-source-materials-"+Guid.NewGuid().ToString("N"));
        var repo=Directory.GetCurrentDirectory();const string processId="demo-showcase-l3-warehouse";
        var data=Path.Combine(root,"Data");Directory.CreateDirectory(data);
        try
        {
            foreach(var suffix in new[]{".bpmn",".context.json"})File.Copy(Path.Combine(repo,"backend","ProcessNavigator.Api","Data",processId+suffix),Path.Combine(data,processId+suffix));
            var contextPath=Path.Combine(data,processId+".context.json");var original=await File.ReadAllBytesAsync(contextPath);
            var env=new Environment(root);var catalog=new ProcessCatalogService(new BpmnProcessLoader(env));var service=new SourceMaterialService(env,catalog);
            var model=await catalog.LoadAsync(processId,false);var node=model.Nodes.First(n=>n.InformationObjects?.Any()==true);
            var target=new SourceMaterialTarget(processId,false,"Исходный паспорт","passport","PKG-001",node.Id,node.InformationObjects![0].ObjectId);
            var snapshot=await service.PreviewAsync(target);target=target with{ExpectedFingerprint=snapshot.Fingerprint};
            var bytes=await File.ReadAllBytesAsync(Path.Combine(repo,"master-data","v1","documents","PKG-001.md"));
            FormFile FileFor(byte[]? content=null,string name="PKG-001.md")=>new(new MemoryStream(content??bytes),0,(content??bytes).Length,"file",name);
            Check(snapshot.ProcessVersion==model.Version&&snapshot.ElementId==node.Id&&snapshot.ObjectId==target.ObjectId,"Exact edition, stage and registry target");
            await Reject(()=>service.UploadAsync(FileFor(),target with{ExpectedFingerprint="stale"},"actor","Профиль"));
            Check(!(await service.ListAsync(true)).Materials.Any(),"Stale preview creates no material");
            var uploaded=await service.UploadAsync(FileFor(),target,"actor","Профиль");
            Check(uploaded.Created&&uploaded.Material.UploadedBy=="actor","Server supplied actor recorded");
            Check((await service.ContentAsync(uploaded.Material.Id)).SequenceEqual(bytes),"Original bytes round trip");
            var backup=await new RepositoryBackupService(env).CreateAsync("fixture");
            using(var zip=ZipFile.OpenRead(Path.Combine(data,"Backups",backup.FileName)))Check(zip.Entries.Any(e=>e.FullName.EndsWith(uploaded.Material.Id+"/content.bin"))&&zip.Entries.Any(e=>e.FullName.EndsWith(uploaded.Material.Id+"/metadata.json")),"Backup includes original and binding");
            Check((await File.ReadAllBytesAsync(contextPath)).SequenceEqual(original),"Upload does not change process context");
            Check(!(await service.UploadAsync(FileFor(),target,"actor2","Другой")).Created,"Retry does not replace or duplicate source");
            Check((await service.GetAsync(uploaded.Material.Id)).UploadedBy=="actor","Retry preserves original uploader");
            Check((await service.CheckAsync(uploaded.Material)).State=="matches","Unchanged target matches");
            await Reject(()=>service.PreviewAsync(target with{ElementId="absent"}));
            await Reject(()=>service.PreviewAsync(target with{ObjectId="absent"}));
            await Reject(()=>service.PreviewAsync(target with{ProcessId="../escape"}));
            await Reject(()=>service.PreviewAsync(target with{Kind="execute"}));
            await Reject(()=>service.PreviewAsync(target with{DocumentVersion=""}));
            await Reject(()=>service.UploadAsync(FileFor(name:"run.exe"),target,"actor","Профиль"));
            await Reject(()=>service.UploadAsync(FileFor([]),target,"actor","Профиль"));
            await Reject(()=>service.UploadAsync(new FormFile(new MemoryStream(bytes),0,20L*1024*1024+1,"file","large.md"),target,"actor","Профиль"));
            var drafts=Path.Combine(data,"Drafts");Directory.CreateDirectory(drafts);
            foreach(var suffix in new[]{".bpmn",".context.json"})File.Copy(Path.Combine(data,processId+suffix),Path.Combine(drafts,processId+suffix));
            var privateTarget=target with{Draft=true};var privatePreview=await service.PreviewAsync(privateTarget);
            Check(privatePreview.Fingerprint!=snapshot.Fingerprint,"Draft is part of fingerprint even for identical model bytes");
            var privateUpload=await service.UploadAsync(FileFor(),privateTarget with{ExpectedFingerprint=privatePreview.Fingerprint},"editor","Редактор");
            Check(privateUpload.Created&&privateUpload.Material.Id!=uploaded.Material.Id,"Same bytes in draft cannot alias public source");
            Check((await service.ListAsync(false)).Materials.Count==1&&(await service.ListAsync(true)).Materials.Count==2,"Draft metadata never included in public list");
            var changed=JsonNode.Parse(original)!;changed["passport"]!["scope"]="Changed scope";await File.WriteAllTextAsync(contextPath,changed.ToJsonString());
            Check((await service.CheckAsync(uploaded.Material)).State=="historical","Changed model reported as historical");
            await Reject(()=>service.UploadAsync(FileFor(),target,"actor","Профиль"));
            await File.WriteAllBytesAsync(contextPath,original);
            var directory=Path.Combine(data,"SourceMaterials",uploaded.Material.Id);var contentPath=Path.Combine(directory,"content.bin");
            var bad=(byte[])bytes.Clone();bad[0]^=1;await File.WriteAllBytesAsync(contentPath,bad);
            await Reject(()=>service.ContentAsync(uploaded.Material.Id));
            await Reject(()=>service.UploadAsync(FileFor(),target,"actor","Профиль"));
            await File.WriteAllBytesAsync(contentPath,bytes);
            var metadataPath=Path.Combine(directory,"metadata.json");var metadata=await File.ReadAllTextAsync(metadataPath);
            var missingDraft=JsonNode.Parse(metadata)!;missingDraft["target"]!.AsObject().Remove("draft");
            await File.WriteAllTextAsync(metadataPath,missingDraft.ToJsonString());
            Check((await service.ListAsync(false)).Unreadable==1,"Missing draft classification is corrupt, never defaults public");
            await Reject(()=>service.UploadAsync(FileFor(),target,"actor","Профиль"));
            await File.WriteAllTextAsync(metadataPath,metadata);
            var pending=Path.Combine(data,"SourceMaterials",".pending-old");Directory.CreateDirectory(pending);
            Check((await service.ListAsync(true)).Unreadable==1,"Unfinished directory surfaced without deleting it");
            await Reject(()=>service.UploadAsync(FileFor(),target,"actor","Профиль"));
            Directory.Delete(pending);
            // Bounded small fixtures, not hundreds of megabytes: every record has real content and valid size.
            var seed=uploaded.Material;
            for(var i=2;i<200;i++){var id="material-"+Guid.NewGuid().ToString("N");var dir=Path.Combine(data,"SourceMaterials",id);Directory.CreateDirectory(dir);await File.WriteAllBytesAsync(Path.Combine(dir,"content.bin"),bytes);await File.WriteAllTextAsync(Path.Combine(dir,"metadata.json"),JsonSerializer.Serialize(seed with{Id=id},new JsonSerializerOptions(JsonSerializerDefaults.Web)));}
            await Reject(()=>service.UploadAsync(FileFor(Encoding.UTF8.GetBytes("new source")),target,"actor","Профиль"));
            Check((await service.ListAsync(true)).Materials.Count==200,"Record limit preserves all existing entries");
            Check(!Directory.EnumerateDirectories(Path.Combine(data,"SourceMaterials"),".pending-*").Any(),"Failed uploads clean their own staging only");
            File.Delete(Path.Combine(data,processId+".bpmn"));File.Delete(contextPath);
            Check((await service.CheckAsync(seed)).State=="unavailable","Deleted target does not silently rebind");
            Check((await service.ContentAsync(seed.Id)).SequenceEqual(bytes),"Historical original retained when target is gone");
            SourceMaterialService.ValidateStorageCapacity(199,512L*1024*1024-1,1);Check(true,"Exact byte limit accepted without allocating huge fixture");
            await Reject(()=>{SourceMaterialService.ValidateStorageCapacity(199,512L*1024*1024,1);return Task.CompletedTask;});
            await Reject(()=>{SourceMaterialService.ValidateStorageCapacity(1,long.MaxValue,1);return Task.CompletedTask;});
            return count;
        }
        finally{if(Path.GetDirectoryName(root)!=temp||!Path.GetFileName(root).StartsWith("pn-source-materials-"))throw new Exception("Unsafe fixture cleanup");Directory.Delete(root,true);}
    }
    private sealed class Environment(string root):IWebHostEnvironment
    {
        public string ApplicationName{get;set;}="SourceMaterialChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
        public string WebRootPath{get;set;}=root;public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
