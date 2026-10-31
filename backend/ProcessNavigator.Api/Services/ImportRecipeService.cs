using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;

public sealed partial class ImportRecipeService(IWebHostEnvironment environment,ProcessTableService tables,InformationObjectRegistryService registry)
{
    private readonly string root=Path.Combine(environment.ContentRootPath,"Data","ImportRecipes");
    private readonly SemaphoreSlim gate=new(1,1);
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){PropertyNameCaseInsensitive=false};
    [GeneratedRegex("^(recipe|batch|file)-[a-f0-9]{32}$")]private static partial Regex SafeId();
    private static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private string Owner(string owner){if(string.IsNullOrWhiteSpace(owner)||owner.Length>100)throw new InvalidDataException("Неверный профиль.");return Path.Combine(root,Hash(Encoding.UTF8.GetBytes(owner)));}
    private string RecipePath(string owner,string id){if(!SafeId().IsMatch(id??"")||!id!.StartsWith("recipe-"))throw new FileNotFoundException();return Path.Combine(Owner(owner),id);}
    private static string Id(string prefix)=>prefix+"-"+Guid.NewGuid().ToString("N");
    private static string RuleKey(ImportRecipeRule r)=>JsonSerializer.Serialize(new{r.Kind,r.Value,r.Scope});
    private static void ValidateRules(IReadOnlyList<ImportRecipeRule>? rules)
    {
        if(rules is null||rules.Count>2000||rules.Any(r=>r is null))throw new InvalidDataException("Не более 2000 правил.");
        foreach(var r in rules)
            if(r.Kind is not ("entity" or "unit" or "user" or "system" or "object" or "document")||string.IsNullOrWhiteSpace(r.Value)||r.Value.Length>2000||r.Scope is null||r.Scope.Length>160||
                (r.KeepNew?(r.Kind is not ("system" or "object" or "document")||!string.IsNullOrEmpty(r.TargetId)):string.IsNullOrWhiteSpace(r.TargetId)||r.TargetId.Length>2000))
                throw new InvalidDataException("Правило содержит недопустимую область, значение или цель.");
        if(rules.Select(RuleKey).Distinct().Count()!=rules.Count)throw new InvalidDataException("Правила одного значения в одной области повторяются.");
    }
    private async Task<ImportRecipe> Read(string owner,string id,CancellationToken ct)
    {
        var directory=RecipePath(owner,id);var path=Path.Combine(directory,"metadata.json");if(!File.Exists(path))throw new FileNotFoundException();
        if(new FileInfo(path).Length>2*1024*1024)throw new InvalidDataException("Метаданные регламента слишком велики.");
        ImportRecipe? recipe;
        try{recipe=JsonSerializer.Deserialize<ImportRecipe>(await File.ReadAllTextAsync(path,ct),Json);}catch(JsonException e){throw new InvalidDataException("Метаданные регламента повреждены.",e);}
        if(recipe is null||recipe.SchemaVersion!=1||recipe.Id!=id||recipe.OwnerId!=owner||recipe.Revision<1||string.IsNullOrWhiteSpace(recipe.Name)||recipe.Batches is null||recipe.Batches.Count is <1 or >10)
            throw new InvalidDataException("Неверные метаданные регламента.");
        ValidateRules(recipe.Rules);
        if(recipe.Batches.Select(b=>b?.Id).Distinct().Count()!=recipe.Batches.Count)throw new InvalidDataException("Пакеты регламента повторяются.");
        foreach(var batch in recipe.Batches)
        {
            if(batch is null||!SafeId().IsMatch(batch.Id??"")||!batch.Id!.StartsWith("batch-")||batch.Files is null||batch.Files.Count is <1 or >10||
                batch.Files.Select(f=>f?.Id).Distinct().Count()!=batch.Files.Count)throw new InvalidDataException("Неверный пакет регламента.");
            foreach(var file in batch.Files)
            {
                if(file is null||!SafeId().IsMatch(file.Id??"")||!file.Id!.StartsWith("file-")||file.Size is <=0 or >10*1024*1024||string.IsNullOrWhiteSpace(file.FileName)||file.FileName.Any(char.IsControl)||
                    file.Sha256 is null||file.Sha256.Length!=64||file.Sha256.Any(c=>!char.IsAsciiHexDigit(c)))throw new InvalidDataException("Неверная запись файла.");
                var content=Path.Combine(directory,batch.Id,file.Id+".bin");
                if(!File.Exists(content)||new FileInfo(content).Length!=file.Size)throw new InvalidDataException("Исходный файл отсутствует или изменил размер.");
            }
        }
        if(Directory.EnumerateDirectories(directory).Select(Path.GetFileName).Except(recipe.Batches.Select(b=>b.Id)).Any())
            throw new InvalidDataException("Есть незавершённый пакет. Существующие исходники сохранены.");
        return recipe;
    }
    public async Task<ImportRecipeList> ListAsync(string owner,CancellationToken ct=default)
    {
        await gate.WaitAsync(ct);try
        {
            var folder=Owner(owner);var list=new List<ImportRecipe>();var errors=0;
            if(Directory.Exists(folder))foreach(var path in Directory.EnumerateDirectories(folder).Take(101))
            {try{list.Add(await Read(owner,Path.GetFileName(path),ct));}catch(Exception e)when(e is IOException or InvalidDataException){errors++;}}
            return new(list.OrderByDescending(r=>r.Batches.Last().CreatedAt).ToArray(),errors);
        }finally{gate.Release();}
    }
    public Task<ImportRecipe> GetAsync(string owner,string id,CancellationToken ct=default)=>Read(owner,id,ct);
    private async Task<ImportRecipeBatch> Stage(string directory,IReadOnlyList<IFormFile> files,bool includeDrafts,CancellationToken ct)
    {
        if(files.Count is <1 or >10||files.Any(f=>f.Length<=0||f.Length>10*1024*1024)||files.Sum(f=>f.Length)>50L*1024*1024)throw new InvalidDataException("Пакет: 1–10 XLSX, до 10 МБ каждый и до 50 МБ суммарно.");
        var stored=new List<ImportRecipeFile>();
        foreach(var file in files)
        {
            var name=Path.GetFileName(file.FileName);
            if(string.IsNullOrWhiteSpace(name)||name.Length>200||name.Any(char.IsControl)||!name.EndsWith(".xlsx",StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Нужны файлы XLSX с корректными именами.");
            await tables.ReferencesAsync(file,registry,includeDrafts,ct);
            using var memory=new MemoryStream();await using(var input=file.OpenReadStream())await input.CopyToAsync(memory,ct);
            var bytes=memory.ToArray();if(bytes.LongLength!=file.Length)throw new InvalidDataException("Размер передачи не совпадает.");
            var id=Id("file");await File.WriteAllBytesAsync(Path.Combine(directory,id+".bin"),bytes,ct);stored.Add(new(id,name,bytes.LongLength,Hash(bytes)));
        }
        return new(Id("batch"),DateTimeOffset.UtcNow,stored);
    }
    private void Capacity(long next)
    {
        if(!Directory.Exists(root))return;
        var paths=Directory.EnumerateFiles(root,"*",SearchOption.AllDirectories).Take(12001).ToArray();
        if(paths.Length>12000||paths.Sum(p=>new FileInfo(p).Length)>1024L*1024*1024-next)throw new InvalidDataException("Предел хранилища регламентов: 1 ГБ. Автоудаления нет.");
    }
    private async Task Write(string directory,ImportRecipe recipe,CancellationToken ct)
    {
        var bytes=JsonSerializer.SerializeToUtf8Bytes(recipe,Json);if(bytes.Length>2*1024*1024)throw new InvalidDataException("Слишком большие метаданные регламента.");
        var temporary=Path.Combine(directory,"metadata-"+Guid.NewGuid().ToString("N")+".tmp");
        try{await File.WriteAllBytesAsync(temporary,bytes,ct);File.Move(temporary,Path.Combine(directory,"metadata.json"),true);}finally{if(File.Exists(temporary))File.Delete(temporary);}
    }
    public async Task<ImportRecipe> CreateAsync(string owner,ImportRecipeCreate request,IReadOnlyList<IFormFile> files,bool includeDrafts,CancellationToken ct=default)
    {
        ValidateRules(request.Rules);if(string.IsNullOrWhiteSpace(request.Name)||request.Name.Trim().Length>120)throw new InvalidDataException("Название: 1–120 символов.");
        await gate.WaitAsync(ct);string? temporary=null;
        try
        {
            var parent=Owner(owner);Directory.CreateDirectory(parent);
            foreach(var path in Directory.EnumerateDirectories(parent))
            {
                var existing=await Read(owner,Path.GetFileName(path),ct);
                if(existing.Name.Equals(request.Name.Trim(),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Регламент с таким названием уже есть. Для следующего набора откройте его; для другой настройки выберите новое название.");
            }
            if(Directory.EnumerateDirectories(parent).Count()>=20||Directory.EnumerateFiles(root,"metadata.json",SearchOption.AllDirectories).Count()>=100)throw new InvalidDataException("Предел: 20 регламентов на профиль, 100 в хранилище.");
            Capacity(files.Sum(f=>f.Length)+2*1024*1024);
            temporary=Path.Combine(parent,".pending-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temporary);
            var staging=Path.Combine(temporary,"staging");Directory.CreateDirectory(staging);var batch=await Stage(staging,files,includeDrafts,ct);
            Directory.Move(staging,Path.Combine(temporary,batch.Id));
            var recipe=new ImportRecipe(1,Id("recipe"),owner,request.Name.Trim(),1,DateTimeOffset.UtcNow,request.Rules.ToArray(),[batch]);
            await Write(temporary,recipe,ct);ct.ThrowIfCancellationRequested();Directory.Move(temporary,RecipePath(owner,recipe.Id));temporary=null;return recipe;
        }finally{try{if(temporary is not null&&Path.GetDirectoryName(temporary)==Owner(owner)&&Directory.Exists(temporary))Directory.Delete(temporary,true);}finally{gate.Release();}}
    }
    public async Task<ImportRecipe> AppendAsync(string owner,string id,int revision,IReadOnlyList<IFormFile> files,bool includeDrafts,CancellationToken ct=default)
    {
        await gate.WaitAsync(ct);string? staging=null;string? committed=null;
        try
        {
            var recipe=await Read(owner,id,ct);if(recipe.Revision!=revision)throw new InvalidDataException("Регламент изменился. Обновите список.");
            if(recipe.Batches.Count>=10)throw new InvalidDataException("Предел: 10 неизменяемых пакетов на регламент. Автоудаления нет.");
            Capacity(files.Sum(f=>f.Length)+64*1024);
            var directory=RecipePath(owner,id);staging=Path.Combine(directory,".pending-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(staging);
            var batch=await Stage(staging,files,includeDrafts,ct);committed=Path.Combine(directory,batch.Id);Directory.Move(staging,committed);staging=null;
            var next=recipe with{Revision=recipe.Revision+1,Batches=recipe.Batches.Append(batch).ToArray()};await Write(directory,next,ct);committed=null;return next;
        }finally{try{foreach(var path in new[]{staging,committed})if(path is not null&&Path.GetDirectoryName(path)==RecipePath(owner,id)&&Directory.Exists(path))Directory.Delete(path,true);}finally{gate.Release();}}
    }
    public async Task<(ImportRecipeFile File,byte[] Bytes)> OriginalAsync(string owner,string id,string batchId,string fileId,CancellationToken ct=default)
    {
        var recipe=await Read(owner,id,ct);
        var batch=recipe.Batches.SingleOrDefault(b=>b.Id==batchId)??throw new FileNotFoundException();
        var file=batch.Files.SingleOrDefault(f=>f.Id==fileId)??throw new FileNotFoundException();
        var bytes=await File.ReadAllBytesAsync(Path.Combine(RecipePath(owner,id),batch.Id,file.Id+".bin"),ct);
        if(bytes.LongLength!=file.Size||Hash(bytes)!=file.Sha256)throw new InvalidDataException("Контрольная сумма исходника не совпадает.");
        return(file,bytes);
    }
}
