using System.Security.Cryptography;
using System.Text.Json;
using System.Text;
using System.Text.RegularExpressions;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;

public sealed partial class SourceMaterialService(IWebHostEnvironment environment,ProcessCatalogService catalog)
{
    private readonly string root=Path.Combine(environment.ContentRootPath,"Data","SourceMaterials");
    private readonly SemaphoreSlim gate=new(1,1);
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){PropertyNameCaseInsensitive=false};
    private const int MaxItems=200;private const long MaxFile=20*1024*1024,MaxTotal=512*1024*1024;
    public static void ValidateStorageCapacity(int count,long total,long next)
    {
        if(count<0||total<0||next<=0||next>MaxFile)throw new InvalidDataException("Выберите файл до 20 МБ.");
        if(count>=MaxItems||total>MaxTotal-next)throw new InvalidDataException("Предел хранилища: 200 материалов / 512 МБ. Файлы не удаляются автоматически.");
    }
    [GeneratedRegex("^material-[a-f0-9]{32}$")]private static partial Regex IdPattern();
    private static string Hash(byte[] value)=>Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
    private string DirectoryFor(string id){if(!IdPattern().IsMatch(id??""))throw new FileNotFoundException();return Path.Combine(root,id!);}
    private static string Text(string? value,int max,string label)=>!string.IsNullOrWhiteSpace(value)&&value.Trim().Length<=max
        ?value.Trim():throw new InvalidDataException(label+" — обязательное поле до "+max+" символов.");
    public async Task<SourceMaterialSnapshot> PreviewAsync(SourceMaterialTarget request,CancellationToken ct=default)
    {
        var processId=Text(request.ProcessId,150,"Процесс");
        if(processId=="__missing__"||!Regex.IsMatch(processId,@"^[\p{L}\p{N}_-][\p{L}\p{N}_.-]{0,149}$"))
            throw new InvalidDataException("Неверный идентификатор процесса.");
        var name=Text(request.Name,200,"Название");var version=Text(request.DocumentVersion,40,"Версия документа");
        if(request.Kind is not ("passport" or "attachment"))throw new InvalidDataException("Выберите паспорт или приложение.");
        var model=await catalog.LoadAsync(processId,request.Draft,ct);
        if(model.Id!=processId)throw new FileNotFoundException();
        if(!request.Draft&&model.Status!="Published")throw new InvalidDataException("Редакция не опубликована. Выберите черновик.");
        var elementId=string.IsNullOrWhiteSpace(request.ElementId)?null:request.ElementId;
        var node=elementId is null?null:model.Nodes.SingleOrDefault(n=>n.Id==elementId)??throw new InvalidDataException("Этап не найден в выбранной редакции.");
        var objectId=string.IsNullOrWhiteSpace(request.ObjectId)?null:request.ObjectId;
        var binding=objectId is null?null:(node is null?model.Nodes.SelectMany(n=>n.InformationObjects??[]):node.InformationObjects??[])
            .FirstOrDefault(b=>b.ObjectId==objectId)??throw new InvalidDataException("Объект не привязан к выбранному этапу или модели.");
        var fingerprint=Hash(JsonSerializer.SerializeToUtf8Bytes(new{model,request.Draft,elementId,objectId,name,request.Kind,version},Json));
        return new(model.Id,model.Name,model.Version,request.Draft,name,request.Kind,version,elementId,node?.Name,objectId,binding?.Name,fingerprint);
    }
    private async Task<SourceMaterialRecord> Read(string id,CancellationToken ct)
    {
        var directory=DirectoryFor(id);var path=Path.Combine(directory,"metadata.json");
        if(!File.Exists(path))throw new FileNotFoundException();
        if(new FileInfo(path).Length>64*1024)throw new InvalidDataException("Повреждены метаданные материала.");
        try
        {
            var record=JsonSerializer.Deserialize<SourceMaterialRecord>(await File.ReadAllTextAsync(path,ct),Json);
            if(record is null||record.SchemaVersion!=1||record.Id!=id||record.Target is null||record.Size<=0||record.Size>MaxFile||
                string.IsNullOrWhiteSpace(record.FileName)||record.FileName.Any(char.IsControl)||record.Sha256 is null||record.Sha256.Length!=64||
                record.Sha256.Any(c=>!char.IsAsciiHexDigit(c))||record.Target.Fingerprint is null||record.Target.Fingerprint.Length!=64||
                record.Target.Fingerprint.Any(c=>!char.IsAsciiHexDigit(c))||string.IsNullOrWhiteSpace(record.Target.ProcessId)||
                string.IsNullOrWhiteSpace(record.Target.ProcessVersion)||string.IsNullOrWhiteSpace(record.Target.Name)||
                record.Target.Kind is not ("passport" or "attachment")||string.IsNullOrWhiteSpace(record.Target.DocumentVersion)||
                string.IsNullOrWhiteSpace(record.UploadedBy)||string.IsNullOrWhiteSpace(record.UploadedByName)||record.UploadedAt==default)
                throw new InvalidDataException("Неверные метаданные материала.");
            var content=Path.Combine(directory,"content.bin");
            if(!File.Exists(content)||new FileInfo(content).Length!=record.Size)throw new InvalidDataException("Файл материала отсутствует или имеет другой размер.");
            return record;
        }
        catch(JsonException e){throw new InvalidDataException("Метаданные материала повреждены.",e);}
    }
    private async Task<SourceMaterialList> ReadList(bool includeDraft,CancellationToken ct)
    {
        if(!Directory.Exists(root))return new([],0,false);
        var directories=Directory.EnumerateDirectories(root).Take(MaxItems+1).ToArray();var records=new List<SourceMaterialRecord>();var errors=0;
        foreach(var directory in directories.Take(MaxItems))
        {
            try{var record=await Read(Path.GetFileName(directory),ct);if(includeDraft||!record.Target.Draft)records.Add(record);}
            catch(Exception e)when(e is IOException or InvalidDataException or UnauthorizedAccessException){errors++;}
        }
        return new(records.OrderByDescending(r=>r.UploadedAt).ToArray(),errors,directories.Length>MaxItems);
    }
    public async Task<SourceMaterialList> ListAsync(bool includeDraft,CancellationToken ct=default)
    {await gate.WaitAsync(ct);try{return await ReadList(includeDraft,ct);}finally{gate.Release();}}
    public Task<SourceMaterialRecord> GetAsync(string id,CancellationToken ct=default)=>Read(id,ct);
    public async Task<byte[]> ContentAsync(string id,CancellationToken ct=default)
    {
        var record=await Read(id,ct);var path=Path.Combine(DirectoryFor(id),"content.bin");
        var bytes=await File.ReadAllBytesAsync(path,ct);
        if(bytes.LongLength!=record.Size||Hash(bytes)!=record.Sha256)throw new InvalidDataException("Контрольная сумма файла не совпадает. Скачивание отменено.");
        return bytes;
    }
    public async Task<SourceMaterialUploadResult> UploadAsync(IFormFile file,SourceMaterialTarget request,string actorId,string actorName,CancellationToken ct=default)
    {
        if(file.Length<=0||file.Length>MaxFile)throw new InvalidDataException("Выберите файл до 20 МБ.");
        var fileName=Path.GetFileName(file.FileName);
        if(string.IsNullOrWhiteSpace(fileName)||fileName.Length>200||fileName.Any(char.IsControl))throw new InvalidDataException("Неверное имя файла.");
        var extensions=new[]{".md",".txt",".pdf",".docx",".doc",".xlsx",".xls",".csv",".png",".jpg",".jpeg",".bpmn",".json",".zip"};
        if(!extensions.Contains(Path.GetExtension(fileName).ToLowerInvariant()))throw new InvalidDataException("Тип исходного файла не поддерживается.");
        Text(actorId,100,"Профиль");Text(actorName,200,"Имя профиля");
        await gate.WaitAsync(ct);string? temporary=null;
        try
        {
            var snapshot=await PreviewAsync(request,ct);
            if(request.ExpectedFingerprint!=snapshot.Fingerprint)throw new InvalidDataException("Привязка или модель изменились. Повторите предварительную проверку.");
            var existing=await ReadList(true,ct);
            if(existing.Unreadable>0||existing.Limited)throw new InvalidDataException("Хранилище неполно или повреждено. Загрузка не выполнена; существующие файлы сохранены.");
            Directory.CreateDirectory(root);temporary=Path.Combine(root,".pending-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temporary);
            var content=Path.Combine(temporary,"content.bin");
            await using(var output=File.Create(content))await file.CopyToAsync(output,ct);
            if(new FileInfo(content).Length!=file.Length)throw new InvalidDataException("Размер переданного файла не совпадает.");
            string hash;await using(var input=File.OpenRead(content))hash=Convert.ToHexString(await SHA256.HashDataAsync(input,ct)).ToLowerInvariant();
            var duplicate=existing.Materials.FirstOrDefault(r=>r.Target.Fingerprint==snapshot.Fingerprint&&r.Sha256==hash&&r.FileName==fileName);
            if(duplicate is not null){await ContentAsync(duplicate.Id,ct);return new(duplicate,false);}
            ValidateStorageCapacity(existing.Materials.Count,existing.Materials.Sum(r=>r.Size),file.Length);
            if((await PreviewAsync(request,ct)).Fingerprint!=snapshot.Fingerprint)throw new InvalidDataException("Модель изменилась во время передачи. Повторите проверку.");
            var id="material-"+Guid.NewGuid().ToString("N");
            var record=new SourceMaterialRecord(1,id,fileName,file.Length,hash,DateTimeOffset.UtcNow,actorId,actorName,snapshot);
            var metadata=JsonSerializer.Serialize(record,Json);
            if(Encoding.UTF8.GetByteCount(metadata)>64*1024)throw new InvalidDataException("Слишком длинные метки цели. Материал не сохранён.");
            await File.WriteAllTextAsync(Path.Combine(temporary,"metadata.json"),metadata,ct);
            ct.ThrowIfCancellationRequested();Directory.Move(temporary,DirectoryFor(id));temporary=null;
            return new(record,true);
        }
        finally
        {
            try{if(temporary is not null&&Directory.Exists(temporary)&&Path.GetFullPath(Path.GetDirectoryName(temporary)!)==Path.GetFullPath(root))Directory.Delete(temporary,true);}
            finally{gate.Release();}
        }
    }
    public async Task<SourceMaterialCheck> CheckAsync(SourceMaterialRecord record,CancellationToken ct=default)
    {
        var s=record.Target;
        try
        {
            var current=await PreviewAsync(new(s.ProcessId,s.Draft,s.Name,s.Kind,s.DocumentVersion,s.ElementId,s.ObjectId),ct);
            return current.Fingerprint==s.Fingerprint?new("matches","Содержимое модели совпадает с зафиксированной привязкой."):new("historical","Модель или её версия изменились. Сохранена историческая привязка.");
        }
        catch(Exception e)when(e is FileNotFoundException or InvalidDataException){return new("unavailable","Цель недоступна или привязка больше не разрешается. Исходник сохранён.");}
    }
}
