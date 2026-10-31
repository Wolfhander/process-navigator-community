using System.Text.Json;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;
public sealed partial class ImportRecipeService
{
    private async Task<(ImportRecipeFilePreview Preview,byte[] Bytes)> Prepare(ImportRecipe recipe,ImportRecipeBatch batch,ImportRecipeFile file,bool drafts,CancellationToken ct)
    {
        var original=await OriginalAsync(recipe.OwnerId,recipe.Id,batch.Id,file.Id,ct);var bytes=original.Bytes;
        IFormFile Form(byte[] input)=>new FormFile(new MemoryStream(input),0,input.Length,"tableFile",file.FileName);
        var initial=await tables.ReferencesAsync(Form(bytes),registry,drafts,ct);
        var proof=Hash(JsonSerializer.SerializeToUtf8Bytes(new{initial.Fingerprint,recipe.Revision,file.Id,recipe.Rules}));
        var applied=new HashSet<string>(StringComparer.Ordinal);var report=initial;
        for(var pass=0;pass<3;pass++)
        {
            var selected=new List<TableReferenceRule>();
            foreach(var group in report.Groups)
            {
                var rule=recipe.Rules.FirstOrDefault(r=>r.Kind==group.Kind&&r.Value==group.Value&&r.Scope==group.Scope);
                if(rule is null||applied.Contains(RuleKey(rule)))continue;
                // Organization changes enable scoped unit rules only after a new reference scan.
                if(rule.Kind=="unit"&&!rule.KeepNew&&!report.Choices.Any(c=>c.Kind=="unit"&&c.Id==rule.TargetId&&c.Scope.Equals(group.Scope,StringComparison.OrdinalIgnoreCase)))continue;
                selected.Add(new(group.Id,rule.TargetId,rule.KeepNew));applied.Add(RuleKey(rule));
            }
            if(selected.Count==0)break;
            bytes=await tables.ResolveReferencesAsync(Form(bytes),new(report.Fingerprint,selected),registry,drafts,ct);
            report=await tables.ReferencesAsync(Form(bytes),registry,drafts,ct);
        }
        var remaining=report.Groups.Where(g=>!recipe.Rules.Any(r=>r.KeepNew&&r.Kind==g.Kind&&r.Value==g.Value&&r.Scope==g.Scope)).ToArray();
        var preview=await tables.PreviewAsync(Form(bytes),ct);
        if((await tables.ReferencesAsync(Form(original.Bytes),registry,drafts,ct)).Fingerprint!=initial.Fingerprint)
            throw new InvalidDataException("Справочники изменились во время проверки. Повторите её.");
        var messages=new List<string>();
        if(remaining.Length>0)messages.Add("Нужны решения по значениям: "+string.Join("; ",remaining.Take(10).Select(g=>g.Kind+": "+g.Value+" ["+g.Scope+"]")));
        if(recipe.Rules.Count>applied.Count)messages.Add("Правил без применения к этому файлу: "+(recipe.Rules.Count-applied.Count)+". Это может быть ожидаемо для другого состава данных.");
        messages.AddRange(preview.Issues.Where(i=>i.Severity=="Error").Take(20).Select(i=>i.Sheet+"!"+i.Row+": "+i.Message));
        return(new(file.Id,file.FileName,remaining.Length==0&&preview.ErrorCount==0?"ready":"needsMapping",applied.Count,recipe.Rules.Count-applied.Count,
            remaining.Length,preview.ErrorCount,preview.WarningCount,proof,messages),bytes);
    }
    public async Task<ImportRecipePreview> PreviewAsync(string owner,string id,string? batchId,int revision,bool drafts,CancellationToken ct=default)
    {
        var recipe=await Read(owner,id,ct);if(recipe.Revision!=revision)throw new InvalidDataException("Регламент изменился. Обновите список.");
        var batch=batchId is null?recipe.Batches.Last():recipe.Batches.SingleOrDefault(b=>b.Id==batchId)??throw new FileNotFoundException();
        var items=new List<ImportRecipeFilePreview>();
        foreach(var file in batch.Files)
        {
            try{items.Add((await Prepare(recipe,batch,file,drafts,ct)).Preview);}
            catch(Exception e)when(e is InvalidDataException or System.Xml.XmlException or JsonException)
            {items.Add(new(file.Id,file.FileName,"blocked",0,recipe.Rules.Count,0,1,0,null,[e.Message]));}
        }
        if((await Read(owner,id,ct)).Revision!=revision)throw new InvalidDataException("Пакет изменился. Обновите проверку.");
        return new(id,revision,batch.Id,items);
    }
    public async Task<(string Name,byte[] Bytes)> PreparedAsync(string owner,string id,string batchId,string fileId,int revision,string? fingerprint,bool drafts,CancellationToken ct=default)
    {
        var recipe=await Read(owner,id,ct);if(recipe.Revision!=revision)throw new InvalidDataException("Регламент изменился. Повторите проверку.");
        var batch=recipe.Batches.SingleOrDefault(b=>b.Id==batchId)??throw new FileNotFoundException();
        var file=batch.Files.SingleOrDefault(f=>f.Id==fileId)??throw new FileNotFoundException();
        var prepared=await Prepare(recipe,batch,file,drafts,ct);
        if(prepared.Preview.State!="ready"||prepared.Preview.Fingerprint!=fingerprint||(await Read(owner,id,ct)).Revision!=revision)
            throw new InvalidDataException("Проверка устарела или остались нерешённые значения/ошибки. Подготовленная копия не выдана.");
        return(file.FileName,prepared.Bytes);
    }
}
