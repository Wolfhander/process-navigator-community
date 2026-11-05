using System.IO.Compression;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Services;

internal static class BackupIntegrityChecks
{
    public static async Task<int> RunAsync()
    {
        var root=Path.Combine(Path.GetTempPath(),"pn-backup-check-"+Guid.NewGuid().ToString("N"));
        var data=Path.Combine(root,"Data");Directory.CreateDirectory(data);
        var source=Path.Combine(data,"document.json");
        await File.WriteAllTextAsync(source,"{\"value\":1}");
        await File.WriteAllTextAsync(Path.Combine(data,"unfinished.tmp"),"not committed");
        var service=new RepositoryBackupService(new Host(root));var count=0;
        void Check(bool ok,string label){if(!ok)throw new Exception(label);count++;}
        var first=await service.CreateAsync("Учебная копия");
        var second=await service.CreateAsync("Учебная копия");
        Check(first.FileName!=second.FileName && first.FileCount==1,"Backups are unique and do not capture staged files");
        var bytes=await File.ReadAllBytesAsync(service.GetPath(first.FileName));
        Check((await service.PreviewRestoreAsync(new MemoryStream(bytes))).FileCount==1,"Verified backup can be previewed");
        await File.WriteAllTextAsync(source,"{\"value\":2}");
        var restored=await service.RestoreAsync(new MemoryStream(bytes),"Учебное восстановление");
        Check(await File.ReadAllTextAsync(source)=="{\"value\":1}","Restore returns exact original content");
        Check(File.Exists(service.GetPath(restored.SafetyBackupFileName)),"Restore retains a safety backup");
        using(var archive=ZipFile.OpenRead(service.GetPath(restored.SafetyBackupFileName)))
        using(var reader=new StreamReader(archive.GetEntry("Data/document.json")!.Open()))
            Check(await reader.ReadToEndAsync()=="{\"value\":2}","Safety copy contains pre-restore bytes");
        byte[] Alter(Action<ZipArchive> change)
        {
            using var stream=new MemoryStream();stream.Write(bytes);
            using(var archive=new ZipArchive(stream,ZipArchiveMode.Update,true))change(archive);
            return stream.ToArray();
        }
        async Task Reject(byte[] package)
        {
            var before=await File.ReadAllTextAsync(source);
            try {await service.RestoreAsync(new MemoryStream(package),"invalid");throw new Exception("Invalid package accepted");}
            catch(InvalidDataException){Check(before==await File.ReadAllTextAsync(source),"Rejected restore does not alter data");}
        }
        await Reject(Alter(zip=>{zip.GetEntry("Data/document.json")!.Delete();using var writer=new StreamWriter(zip.CreateEntry("Data/document.json").Open());writer.Write("corrupted");}));
        await Reject(Alter(zip=>{using var writer=new StreamWriter(zip.CreateEntry("Data/document.json").Open());writer.Write("duplicate");}));
        await Reject(Alter(zip=>{
            var entry=zip.GetEntry("manifest.json")!;
            JsonNode json;using(var reader=new StreamReader(entry.Open()))json=JsonNode.Parse(reader.ReadToEnd())!;
            entry.Delete();json["Files"]![0]!["Size"]=999;
            using var writer=new StreamWriter(zip.CreateEntry("manifest.json").Open());writer.Write(json.ToJsonString());
        }));
        await Reject(Alter(zip=>{
            var entry=zip.GetEntry("manifest.json")!;
            JsonNode json;using(var reader=new StreamReader(entry.Open()))json=JsonNode.Parse(reader.ReadToEnd())!;
            entry.Delete();json["Files"]![0]!["Path"]="../escape.json";
            using var writer=new StreamWriter(zip.CreateEntry("manifest.json").Open());writer.Write(json.ToJsonString());
        }));
        var cancelled=new CancellationToken(true);
        try {await AtomicTextFile.WriteAsync(source,"wrong",cancelled);throw new Exception("Cancelled write succeeded");}
        catch(OperationCanceledException){Check(await File.ReadAllTextAsync(source)=="{\"value\":1}","Cancelled atomic write keeps original");}
        await AtomicTextFile.WriteAsync(source,"replacement");
        Check(await File.ReadAllTextAsync(source)=="replacement","Atomic replacement succeeds");
        Check(!Directory.EnumerateFiles(data,"*.tmp",SearchOption.AllDirectories).Any(path=>!path.EndsWith("unfinished.tmp")),"No staged files remain after checks");
        Console.WriteLine($"Backup integrity checks passed: {count}.");
        return count;
    }
    private sealed class Host(string root):IWebHostEnvironment
    {
        public string ApplicationName {get;set;}="BackupChecks";
        public string EnvironmentName {get;set;}="Development";
        public string ContentRootPath {get;set;}=root;
        public IFileProvider ContentRootFileProvider {get;set;}=new NullFileProvider();
        public string WebRootPath {get;set;}=root;
        public IFileProvider WebRootFileProvider {get;set;}=new NullFileProvider();
    }
}
