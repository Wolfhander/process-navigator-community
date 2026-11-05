using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;

// Manual interpretation of a precise snapshot. A directed path is not a proof of meaning.
public sealed class ReconciliationReviewService(IWebHostEnvironment environment,ProcessCatalogService catalog,SourceMaterialService materials)
{
    private readonly string root=Path.Combine(environment.ContentRootPath,"Data","ReconciliationReviews");
    private readonly SemaphoreSlim gate=new(1,1);
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private sealed record Journal(int SchemaVersion,string ProcessId,IReadOnlyList<ReconciliationReviewEvent> Events);
    private static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private string PathFor(string processId)=>Path.Combine(root,Hash(Encoding.UTF8.GetBytes(processId))+".json");
    private static string Fingerprint(ProcessModel model,string id)=>Hash(JsonSerializer.SerializeToUtf8Bytes(new{model,requirementId=id},Json));
    private async Task<ProcessModel> Model(string processId,bool draft,CancellationToken ct){
        var model=await catalog.LoadAsync(processId,draft,ct);
        if(model.Id!=processId||!draft&&model.Status!="Published")throw new FileNotFoundException("Доступная редакция не найдена.");
        ProcessCatalogService.NormalizeSourceRequirements(model.Passport?.SourceRequirements);
        return model;
    }
    private async Task<Journal> Read(string id,CancellationToken ct)
    {
        var path=PathFor(id);if(!File.Exists(path))return new(1,id,[]);
        if(new FileInfo(path).Length>8*1024*1024)throw new InvalidDataException("Журнал сверки превышает 8 МБ.");
        try{
            var value=JsonSerializer.Deserialize<Journal>(await File.ReadAllTextAsync(path,ct),Json);
            if(value is null||value.SchemaVersion!=1||value.ProcessId!=id||value.Events is null||value.Events.Count>1000)
                throw new InvalidDataException("Повреждён журнал сверки.");
            var ids=new HashSet<string>();
            foreach(var e in value.Events){
                if(e is null||!Guid.TryParseExact(e.Id,"N",out _)||!ids.Add(e.Id)||string.IsNullOrWhiteSpace(e.RequirementId)||
                    string.IsNullOrWhiteSpace(e.Version)||e.Fingerprint?.Length!=64||e.Fingerprint.Any(c=>!char.IsAsciiHexDigit(c))||
                    e.Action is not ("review" or "reject" or "withdraw")||string.IsNullOrWhiteSpace(e.Reason)||e.Reason.Length>2000||
                    string.IsNullOrWhiteSpace(e.ActorId)||string.IsNullOrWhiteSpace(e.ActorName)||e.RecordedAt==default||e.Requirement is null||
                    e.Requirement.Id!=e.RequirementId||e.Action=="review"&&e.Material is null)
                    throw new InvalidDataException("Повреждена запись сверки.");
                ProcessCatalogService.NormalizeSourceRequirements([e.Requirement]);
                if(e.Material is not null&&(e.Material.SchemaVersion!=1||e.Material.Target is null||e.Material.Target.ProcessId!=id||
                    e.Material.Target.Draft!=e.Draft||e.Material.Target.ProcessVersion!=e.Version||e.Material.Sha256?.Length!=64||
                    e.Material.Sha256.Any(c=>!char.IsAsciiHexDigit(c))||e.Material.Size<=0||string.IsNullOrWhiteSpace(e.Material.Id)))
                    throw new InvalidDataException("Повреждён снимок оригинала в журнале.");
            }
            return value;
        }catch(JsonException e){throw new InvalidDataException("Журнал сверки повреждён; файл не изменён.",e);}
    }
    private static IReadOnlyList<string> Gaps(ProcessModel model,SourceRequirementModel? requirement)
    {
        if(requirement is null)return ["Пункт удалён или отсутствует."];
        var ids=requirement.ElementIds??[];var known=model.Nodes.Select(n=>n.Id).ToHashSet();
        if(model.Nodes.Count>10000||model.Edges.Count>20000)return ["Превышен предел структурной сверки: 10000 элементов / 20000 стрелок."];
        var outgoing=model.Edges.Where(e=>known.Contains(e.SourceId)&&known.Contains(e.TargetId)).GroupBy(e=>e.SourceId).ToDictionary(g=>g.Key,g=>g.Select(e=>e.TargetId).ToArray());
        var issues=new List<string>();if(ids.Count==0)issues.Add("Не выбраны элементы схемы.");
        foreach(var id in ids.Where(id=>!known.Contains(id)))issues.Add("Отсутствует элемент "+id);
        if(requirement.CheckSequence){
            if(ids.Count<2)issues.Add("Для последовательности нужны два элемента.");
            for(var i=1;i<ids.Count;i++){
                var seen=new HashSet<string>{ids[i-1]};var queue=new Queue<string>();queue.Enqueue(ids[i-1]);
                while(queue.TryDequeue(out var current)){
                    foreach(var target in outgoing.GetValueOrDefault(current)??[])if(seen.Add(target))queue.Enqueue(target);
                }
                if(seen.Count>10000)issues.Add("Предел обхода маршрута превышен.");
                else if(!seen.Contains(ids[i]))issues.Add($"Нет маршрута {ids[i-1]} → {ids[i]}");
            }
        }
        return issues;
    }
    private static ReconciliationReviewReport Report(ProcessModel model,string id,bool draft,Journal journal)
    {
        var requirement=(model.Passport?.SourceRequirements??[]).SingleOrDefault(r=>r.Id==id);
        var fingerprint=Fingerprint(model,id);
        var last=journal.Events.LastOrDefault(e=>e.RequirementId==id&&e.Version==model.Version&&e.Draft==draft);
        var state=last is null?"unreviewed":last.Fingerprint!=fingerprint?"stale":last.Action=="review"?"reviewed":last.Action=="reject"?"rejected":"withdrawn";
        return new(model.Id,model.Name,id,model.Version,draft,fingerprint,requirement,state,Gaps(model,requirement),
            journal.Events.Where(e=>e.RequirementId==id&&(draft||!e.Draft)).Reverse().ToArray());
    }
    public async Task<ReconciliationReviewReport> LoadAsync(string processId,string id,bool draft,CancellationToken ct)
    {
        if(string.IsNullOrWhiteSpace(id)||id.Length>100)throw new InvalidDataException("Неверный ID пункта.");
        await gate.WaitAsync(ct);
        try{return Report(await Model(processId,draft,ct),id,draft,await Read(processId,ct));}
        finally{gate.Release();}
    }
    public async Task<ReconciliationReviewReport> RecordAsync(string processId,string id,bool draft,ReconciliationReviewRequest request,string actorId,string actorName,CancellationToken ct)
    {
        var reason=request.Reason?.Trim();
        if(string.IsNullOrWhiteSpace(reason)||reason.Length>2000||request.Action is not ("review" or "reject" or "withdraw")||
            string.IsNullOrWhiteSpace(actorId)||string.IsNullOrWhiteSpace(actorName)||string.IsNullOrWhiteSpace(id)||id.Length>100)
            throw new InvalidDataException("Укажите действие, пункт и причину сверки до 2000 символов.");
        await gate.WaitAsync(ct);
        try{
            var model=await Model(processId,draft,ct);var journal=await Read(processId,ct);
            var report=Report(model,id,draft,journal);
            if(report.Requirement is null||request.ExpectedVersion!=report.Version||request.ExpectedFingerprint!=report.Fingerprint)
                throw new InvalidDataException("Модель или пункт изменились. Обновите сверку.");
            ProcessCatalogService.NormalizeSourceRequirements([report.Requirement]);
            var last=journal.Events.LastOrDefault(e=>e.RequirementId==id&&e.Version==model.Version&&e.Draft==draft);
            if(last is not null&&last.Fingerprint==report.Fingerprint&&last.Action==request.Action&&last.Reason==reason&&
                last.ActorId==actorId&&last.Material?.Id==request.MaterialId)return report;
            var latestVisible=journal.Events.LastOrDefault(e=>e.RequirementId==id&&(draft||!e.Draft));
            if(latestVisible?.Id!=request.PreviousEventId)throw new InvalidDataException("Журнал уже изменён. Обновите сведения перед решением.");
            if(request.Action=="withdraw"&&report.State!="reviewed")throw new InvalidDataException("Отозвать можно только актуальное подтверждение.");
            SourceMaterialRecord? material=null;
            if(request.Action=="review"){
                if(report.Gaps.Count>0)throw new InvalidDataException("Устраните структурные разрывы перед подтверждением.");
                if(string.IsNullOrWhiteSpace(request.MaterialId))throw new InvalidDataException("Выберите сохранённый оригинал.");
                material=await materials.GetAsync(request.MaterialId,ct);
                if(material.Target.ProcessId!=processId||material.Target.Draft!=draft||(await materials.CheckAsync(material,ct)).State!="matches")
                    throw new InvalidDataException("Оригинал недоступен или относится к другому/изменённому снимку.");
            }else if(request.MaterialId is not null)throw new InvalidDataException("Оригинал указывается только для подтверждения.");
            if(journal.Events.Count>=1000)throw new InvalidDataException("Предел 1000 событий; автоматического удаления нет.");
            if(Fingerprint(await Model(processId,draft,ct),id)!=report.Fingerprint)throw new InvalidDataException("Модель изменилась во время сверки.");
            var entry=new ReconciliationReviewEvent(Guid.NewGuid().ToString("N"),id,report.Version,draft,report.Fingerprint,
                request.Action,reason,actorId,actorName,DateTimeOffset.UtcNow,report.Requirement,material);
            var updated=journal with{Events=journal.Events.Append(entry).ToArray()};
            var content=JsonSerializer.Serialize(updated,Json);if(Encoding.UTF8.GetByteCount(content)>8*1024*1024)throw new InvalidDataException("Предел журнала 8 МБ; запись отменена.");
            Directory.CreateDirectory(root);await AtomicTextFile.WriteAsync(PathFor(processId),content,ct);
            return Report(model,id,draft,updated);
        }finally{gate.Release();}
    }
}
