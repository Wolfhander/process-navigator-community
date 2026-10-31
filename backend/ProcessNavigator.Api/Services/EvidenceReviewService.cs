using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

// A selected-profile review of a precise model snapshot; not a signature or a statement of physical truth.
public sealed class EvidenceReviewService(IWebHostEnvironment environment,ProcessCatalogService catalog,TimeProvider? clock=null)
{
    private readonly string root=Path.Combine(environment.ContentRootPath,"Data","EvidenceReviews");
    private readonly SemaphoreSlim gate=new(1,1);
    private const int MaxEvents=1000,MaxBytes=8*1024*1024;
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private sealed record Journal(int SchemaVersion,string ProcessId,IReadOnlyList<EvidenceReviewEvent> Events);
    private static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    internal static string FileNameFor(string processId)=>Hash(Encoding.UTF8.GetBytes(processId))+".json";
    private string PathFor(string processId)=>Path.Combine(root,FileNameFor(processId));
    private static string ModelFingerprint(ProcessModel model)=>Hash(JsonSerializer.SerializeToUtf8Bytes(model,Json));
    private static string Fingerprint(string snapshot,string elementId,int index)=>
        Hash(JsonSerializer.SerializeToUtf8Bytes(new{snapshot,elementId,index},Json));
    private async Task<ProcessModel> Model(string id,bool draft,CancellationToken ct)
    {
        var model=await catalog.LoadAsync(id,draft,ct);
        if(model.Id!=id)throw new FileNotFoundException("Модель не найдена.");
        return model;
    }
    private async Task<Journal> Read(string processId,CancellationToken ct)
    {
        var path=PathFor(processId);
        if(!File.Exists(path))return new(1,processId,[]);
        if(new FileInfo(path).Length>MaxBytes)throw new InvalidDataException("Журнал проверок превышает 8 МБ. Данные не изменены.");
        try
        {
            var journal=JsonSerializer.Deserialize<Journal>(await File.ReadAllTextAsync(path,ct),Json);
            if(journal is null||journal.SchemaVersion!=1||journal.ProcessId!=processId||journal.Events is null||journal.Events.Count>MaxEvents)
                throw new InvalidDataException("Неверный формат журнала проверок.");
            var ids=new HashSet<string>();
            foreach(var e in journal.Events)
            {
                if(e is null||!Guid.TryParseExact(e.Id,"N",out _)||!ids.Add(e.Id)||string.IsNullOrWhiteSpace(e.ElementId)||e.Index<0||
                    string.IsNullOrWhiteSpace(e.Version)||e.Fingerprint is null||e.Fingerprint.Length!=64||e.Fingerprint.Any(c=>!char.IsAsciiHexDigit(c))||
                    e.Action is not ("review" or "withdraw")||string.IsNullOrWhiteSpace(e.Reason)||e.Reason.Length>2000||
                    string.IsNullOrWhiteSpace(e.ActorId)||string.IsNullOrWhiteSpace(e.ActorName)||e.RecordedAt==default||e.Evidence is null)
                    throw new InvalidDataException("Повреждена запись журнала проверок.");
                ProcessCatalogService.NormalizeEvidence([e.Evidence]);
                if(e.Evidence.Status!="fact")throw new InvalidDataException("В журнале проверки не-факт.");
            }
            return journal;
        }
        catch(JsonException exception){throw new InvalidDataException("Журнал проверок повреждён. Исходный файл не изменён.",exception);}
    }
    private static EvidenceReviewReport Report(ProcessModel model,string elementId,bool draft,Journal journal)
    {
        var node=model.Nodes.SingleOrDefault(n=>n.Id==elementId)??throw new KeyNotFoundException("Элемент не найден.");
        var snapshot=ModelFingerprint(model);
        var entries=(node.Evidence??[]).Select((e,i)=>{
            var fingerprint=Fingerprint(snapshot,elementId,i);
            var latest=journal.Events.LastOrDefault(x=>x.ElementId==elementId&&x.Index==i&&x.Version==model.Version&&x.Draft==draft);
            var state=latest is null?"unreviewed":latest.Fingerprint!=fingerprint?"stale":latest.Action=="review"?"reviewed":"withdrawn";
            return new EvidenceReviewEntry(i,fingerprint,e,state);
        }).ToArray();
        return new(model.Id,elementId,model.Version,draft,entries,journal.Events.Where(e=>e.ElementId==elementId&&(draft||!e.Draft)).Reverse().ToArray());
    }
    public async Task<EvidenceReviewReport> LoadAsync(string processId,string elementId,bool draft,CancellationToken ct=default)
    {
        await gate.WaitAsync(ct);
        try{return Report(await Model(processId,draft,ct),elementId,draft,await Read(processId,ct));}
        finally{gate.Release();}
    }
    public async Task<EvidenceReviewReport> RecordAsync(string processId,string elementId,bool draft,EvidenceReviewRequest request,
        string actorId,string actorName,CancellationToken ct=default)
    {
        var reason=request.Reason?.Trim();
        if(string.IsNullOrWhiteSpace(reason)||reason.Length>2000||request.Action is not ("review" or "withdraw")||
            string.IsNullOrWhiteSpace(actorId)||string.IsNullOrWhiteSpace(actorName))
            throw new InvalidDataException("Укажите действие проверки и основание до 2000 символов.");
        await gate.WaitAsync(ct);
        try
        {
            var journal=await Read(processId,ct);
            var model=await Model(processId,draft,ct);
            var report=Report(model,elementId,draft,journal);
            var entry=report.Entries.SingleOrDefault(e=>e.Index==request.Index);
            if(entry is null||request.ExpectedVersion!=model.Version||request.ExpectedFingerprint!=entry.Fingerprint)
                throw new InvalidDataException("Модель или основание изменились. Обновите сведения перед проверкой.");
            if(entry.Evidence.Status!="fact"||string.IsNullOrWhiteSpace(entry.Evidence.Source))
                throw new InvalidDataException("Запись проверки допускается только для факта с указанным источником.");
            ProcessCatalogService.NormalizeEvidence([entry.Evidence]);
            var last=journal.Events.LastOrDefault(e=>e.ElementId==elementId&&e.Index==request.Index&&e.Version==model.Version&&e.Draft==draft);
            if(last is not null&&last.Fingerprint==entry.Fingerprint&&last.Action==request.Action&&last.ActorId==actorId&&last.Reason==reason)return report;
            if(request.Action=="withdraw"&&entry.State!="reviewed")throw new InvalidDataException("Нет актуальной проверки для отзыва.");
            if(journal.Events.Count>=MaxEvents)throw new InvalidDataException("В журнале уже 1000 записей. Автоматического удаления нет.");
            // Re-read before committing. A subsequent edit is still detected by the snapshot fingerprint on the next read.
            if(Fingerprint(ModelFingerprint(await Model(processId,draft,ct)),elementId,request.Index)!=entry.Fingerprint)
                throw new InvalidDataException("Модель изменилась во время проверки. Повторите загрузку.");
            var record=new EvidenceReviewEvent(Guid.NewGuid().ToString("N"),elementId,entry.Index,model.Version,draft,entry.Fingerprint,
                request.Action,reason,actorId,actorName,(clock??TimeProvider.System).GetUtcNow(),entry.Evidence);
            var updated=journal with{Events=journal.Events.Append(record).ToArray()};
            var bytes=JsonSerializer.SerializeToUtf8Bytes(updated,Json);
            if(bytes.Length>MaxBytes)throw new InvalidDataException("Журнал превысит 8 МБ. Запись не выполнена.");
            Directory.CreateDirectory(root);var path=PathFor(processId);var temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
            try{await File.WriteAllBytesAsync(temporary,bytes,ct);ct.ThrowIfCancellationRequested();File.Move(temporary,path,true);}
            finally{if(File.Exists(temporary))File.Delete(temporary);}
            return Report(await Model(processId,draft,ct),elementId,draft,updated);
        }
        finally{gate.Release();}
    }
}
