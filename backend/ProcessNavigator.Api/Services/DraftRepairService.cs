using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DraftRepairChoice(string ProcessId,string Kind,string? ElementId=null,string? LegalEntityId=null,string? UnitId=null,string? TargetId=null,bool Clear=false);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DraftRepairRequest(string BaseFingerprint,IReadOnlyList<DraftRepairChoice> Choices);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DraftRepairApply(DraftRepairRequest Request,string Proof);
public sealed record DraftRepairCandidate(string ProcessId,string ProcessName,bool MissingOwner,IReadOnlyList<DraftBrokenLink> Links,string? Reason);
public sealed record DraftBrokenLink(string ElementId,string ElementName,string TargetId);
public sealed record DraftRepairTarget(string Id,string Name);
public sealed record DraftRepairUnit(string EntityId,string EntityName,string UnitId,string UnitName);
public sealed record DraftRepairScan(string Fingerprint,IReadOnlyList<DraftRepairCandidate> Items,IReadOnlyList<DraftRepairTarget> Targets,IReadOnlyList<DraftRepairUnit> Units);
public sealed record DraftRepairChange(string ProcessId,string ProcessName,string Kind,string? ElementId,string Before,string After);
public sealed record DraftRepairPreview(string Proof,IReadOnlyList<DraftRepairChange> Changes);
public sealed record DraftRepairResult(string BackupFileName,IReadOnlyList<DraftRepairOutcome> Items);
public sealed record DraftRepairOutcome(string ProcessId,string Status,string? Reason);

public sealed class DraftRepairService(ProcessCatalogService catalog,OrganizationMapService organizations,ProcessEditLockService locks,RepositoryBackupService backups,BpmnProcessLoader loader)
{
    private readonly SemaphoreSlim gate=new(1,1);
    private static string Hash(byte[] b)=>Convert.ToHexString(SHA256.HashData(b));
    private static string HashState(SortedDictionary<string,string> files)=>Hash(JsonSerializer.SerializeToUtf8Bytes(files));
    private sealed record State(OrganizationMapModel Org,Dictionary<string,ProcessModel> Models,HashSet<string> Drafts,SortedDictionary<string,string> Files);
    private async Task<State> Read(CancellationToken ct)
    {
        var org=await organizations.LoadAsync(ct);
        var files=new SortedDictionary<string,string>(StringComparer.Ordinal){{"organization",org.Revision!}};
        // A corrupt source omitted by ListAsync is not proof that a linked model was deleted.
        var sources=new[]{loader.DataRoot,Path.Combine(loader.DataRoot,"Drafts")}.Where(Directory.Exists)
            .SelectMany(dir=>Directory.EnumerateFiles(dir,"*.bpmn",SearchOption.TopDirectoryOnly)).Take(201).ToArray();
        if(sources.Length>200)throw new InvalidDataException("Более 200 файлов редакций. Массовая правка метаданных поддерживает до 100 моделей.");
        foreach(var path in sources)
        {
            var context=Path.ChangeExtension(path,".context.json");
            try
            {
                var xml=Hash(await File.ReadAllBytesAsync(path,ct));var json=Hash(await File.ReadAllBytesAsync(context,ct));
                await loader.LoadFilesAsync(path,context,cancellationToken:ct);
                if(xml!=Hash(await File.ReadAllBytesAsync(path,ct))||json!=Hash(await File.ReadAllBytesAsync(context,ct)))throw new InvalidDataException("Исходник изменился при чтении.");
                files.Add("raw:"+Path.GetRelativePath(loader.DataRoot,path),xml);
                files.Add("raw:"+Path.GetRelativePath(loader.DataRoot,context),json);
            }
            catch(Exception e)when(e is IOException or InvalidDataException or JsonException or System.Xml.XmlException)
            {throw new InvalidDataException("Недоступный или повреждённый исходник "+Path.GetFileName(path)+". Сначала выполните проверку каталога.",e);}
        }
        var list=await catalog.ListAsync(ct);
        if(list.Count>100)throw new InvalidDataException("Массовая правка метаданных поддерживает фонд до 100 моделей. Обработайте более крупный фонд отдельно.");
        var models=new Dictionary<string,ProcessModel>(StringComparer.OrdinalIgnoreCase);var drafts=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(var item in list.OrderBy(i=>i.Id,StringComparer.Ordinal))
        {
            var draft=item.HasDraft||item.Status=="Draft";if(draft)drafts.Add(item.Id);
            var path=catalog.GetBpmnSourcePath(item.Id,draft);var context=Path.ChangeExtension(path,".context.json");
            var bpmn=Hash(await File.ReadAllBytesAsync(path,ct));var json=Hash(await File.ReadAllBytesAsync(context,ct));
            models.Add(item.Id,await catalog.LoadAsync(item.Id,draft,ct));
            if(bpmn!=Hash(await File.ReadAllBytesAsync(path,ct))||json!=Hash(await File.ReadAllBytesAsync(context,ct)))
                throw new InvalidDataException("Модель изменилась при чтении. Повторите просмотр.");
            files.Add(item.Id+":bpmn",bpmn);files.Add(item.Id+":context",json);files.Add(item.Id+":edition",draft?"draft":"published");
        }
        if((await organizations.LoadAsync(ct)).Revision!=org.Revision)throw new InvalidDataException("Оргструктура изменилась.");
        return new(org,models,drafts,files);
    }
    private static bool MissingOwner(ProcessModel m)=>(string.IsNullOrWhiteSpace(m.Owner)||m.Owner.Equals("Не назначен",StringComparison.OrdinalIgnoreCase))
        &&string.IsNullOrWhiteSpace(m.OwnerLegalEntityId)&&string.IsNullOrWhiteSpace(m.OwnerUnitId);
    private static DraftBrokenLink[] Broken(ProcessModel m,State s)=>m.Nodes.Where(n=>!string.IsNullOrWhiteSpace(n.LinkedProcessId)&&!s.Models.ContainsKey(n.LinkedProcessId))
        .Select(n=>new DraftBrokenLink(n.Id,n.Name,n.LinkedProcessId!)).ToArray();
    private static bool Editable(ProcessModel m)=>m.Status is "Draft" or "ChangesRequested";
    public async Task<DraftRepairScan> ScanAsync(CancellationToken ct=default)
    {
        var s=await Read(ct);var items=s.Drafts.Select(id=>s.Models[id]).OrderBy(m=>m.Name,StringComparer.Ordinal).Select(m=>
            new DraftRepairCandidate(m.Id,m.Name,MissingOwner(m),Broken(m,s),!Editable(m)?"Редакция недоступна для правки.":locks.HasActiveLock(m.Id)?"Открыт BPMN-редактор.":null))
            .Where(i=>i.MissingOwner||i.Links.Count>0).ToArray();
        return new(HashState(s.Files),items,s.Models.Values.Select(m=>new DraftRepairTarget(m.Id,m.Name)).ToArray(),
            s.Org.LegalEntities.SelectMany(e=>(e.Units??[]).Select(u=>new DraftRepairUnit(e.Id,e.Name,u.Id,u.Name))).ToArray());
    }
    private List<DraftRepairChange> Validate(State s,DraftRepairRequest r)
    {
        if(r.Choices is null||r.Choices.Count is <1 or >500||r.Choices.Any(c=>c is null)||r.Choices.Select(c=>(c.ProcessId,c.Kind,c.ElementId)).Distinct().Count()!=r.Choices.Count)
            throw new InvalidDataException("Нужно от 1 до 500 разных явных решений.");
        if(r.BaseFingerprint!=HashState(s.Files))throw new InvalidDataException("Фонд изменился. Загрузите список и подготовьте новый план.");
        var changes=new List<DraftRepairChange>();
        var routes=s.Models.ToDictionary(p=>p.Key,p=>p.Value.Nodes.Where(n=>!string.IsNullOrWhiteSpace(n.LinkedProcessId)).ToDictionary(n=>n.Id,n=>n.LinkedProcessId!),StringComparer.OrdinalIgnoreCase);
        foreach(var c in r.Choices)
        {
            if(string.IsNullOrWhiteSpace(c.ProcessId)||!s.Drafts.Contains(c.ProcessId)||!s.Models.TryGetValue(c.ProcessId,out var m)||!Editable(m)||locks.HasActiveLock(c.ProcessId))
                throw new InvalidDataException("Черновик недоступен или открыт в редакторе: "+c.ProcessId);
            if(c.ProcessId!=m.Id)throw new InvalidDataException("Используйте точный ID процесса из списка.");
            if(c.Kind=="owner")
            {
                if(!MissingOwner(m)||c.ElementId is not null||c.TargetId is not null||c.Clear)throw new InvalidDataException("Можно заполнить только отсутствующего владельца.");
                var e=s.Org.LegalEntities.SingleOrDefault(e=>e.Id==c.LegalEntityId);
                var unit=e?.Units?.SingleOrDefault(u=>u.Id==c.UnitId)??throw new InvalidDataException("Выберите существующее подразделение в его организации.");
                changes.Add(new(m.Id,m.Name,"owner",null,m.Owner,e!.Name+" / "+unit.Name));
            }
            else if(c.Kind=="link")
            {
                if(c.LegalEntityId is not null||c.UnitId is not null||c.ElementId is null)throw new InvalidDataException("Некорректные поля связи.");
                var broken=Broken(m,s).SingleOrDefault(n=>n.ElementId==c.ElementId)??throw new InvalidDataException("Править можно только ссылку на отсутствующую модель.");
                if(c.Clear)
                {
                    if(c.TargetId is not null)throw new InvalidDataException("Очистка и замена несовместимы.");
                    routes[m.Id].Remove(c.ElementId);
                }
                else
                {
                    if(string.IsNullOrWhiteSpace(c.TargetId)||!s.Models.ContainsKey(c.TargetId)||c.TargetId.Equals(m.Id,StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("Выберите другую существующую модель или явную очистку.");
                    routes[m.Id][c.ElementId]=c.TargetId;
                }
                changes.Add(new(m.Id,m.Name,"link",c.ElementId,broken.TargetId,c.Clear?"Удалить связь (сам этап сохраняется)":s.Models[c.TargetId!].Name+" ["+c.TargetId+"]"));
            }
            else throw new InvalidDataException("Неизвестный тип правки.");
        }
        foreach(var c in r.Choices.Where(c=>c.Kind=="link"&&!c.Clear))
        {
            var visited=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var queue=new Queue<string>();queue.Enqueue(c.TargetId!);
            while(queue.TryDequeue(out var id))
            {
                if(id.Equals(c.ProcessId,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Выбранный пакет создаёт циклическую вложенность.");
                if(visited.Add(id)&&routes.TryGetValue(id,out var next))foreach(var target in next.Values)queue.Enqueue(target);
            }
        }
        return changes;
    }
    private static string Proof(DraftRepairRequest request)=>Hash(JsonSerializer.SerializeToUtf8Bytes(request));
    public async Task<DraftRepairPreview> PreviewAsync(DraftRepairRequest r,CancellationToken ct=default)
    {var s=await Read(ct);return new(Proof(r),Validate(s,r));}
    public async Task<DraftRepairResult> ApplyAsync(DraftRepairApply a,string actor,CancellationToken ct=default)
    {
        if(a.Request is null||a.Proof!=Proof(a.Request))throw new InvalidDataException("Нет подтверждённого плана.");
        await gate.WaitAsync(ct);
        try
        {
            var state=await Read(ct);Validate(state,a.Request);
            var backup=await backups.CreateAsync(actor,ct);var results=new List<DraftRepairOutcome>();
            foreach(var group in a.Request.Choices.GroupBy(c=>c.ProcessId,StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    if(HashState((await Read(ct)).Files)!=HashState(state.Files))throw new InvalidDataException("Фонд изменился после просмотра.");
                    var hash=await catalog.ApplyDraftRepairsAsync(group.Key,group.ToArray(),state.Org,ct,async()=>
                        !locks.HasActiveLock(group.Key)&&HashState((await Read(ct)).Files)==HashState(state.Files));
                    state.Files[group.Key+":context"]=hash;
                    state.Files["raw:"+Path.GetRelativePath(loader.DataRoot,Path.ChangeExtension(catalog.GetBpmnSourcePath(group.Key,true),".context.json"))]=hash;
                    results.Add(new(group.Key,"Updated",null));
                }
                catch(Exception e)when(e is IOException or InvalidDataException or System.Xml.XmlException or JsonException)
                {results.Add(new(group.Key,"Skipped",e.Message));}
            }
            return new(backup.FileName,results);
        }
        finally{gate.Release();}
    }
}
