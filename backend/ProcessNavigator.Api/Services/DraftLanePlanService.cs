using System.Security.Cryptography;
using System.Text.Json;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;

public sealed record LaneRename(string LaneId,string Before,string After);
public sealed record LanePlanItem(string ProcessId,string ProcessName,string? Fingerprint,IReadOnlyList<LaneRename> Changes,string? Reason);
public sealed record LanePlan(string OrganizationRevision,IReadOnlyList<LanePlanItem> Items);
public sealed record LanePlanSelection(string ProcessId,string Fingerprint);
public sealed record LanePlanApply(string OrganizationRevision,IReadOnlyList<LanePlanSelection> Selected);
public sealed record LanePlanResult(string BackupFileName,DraftLaneSyncReportModel Report);

// No guessing: only exact, existing lane-to-unit bindings are eligible.
public sealed class DraftLanePlanService(ProcessCatalogService catalog,OrganizationMapService organizations,
    ProcessEditLockService locks,RepositoryBackupService backups)
{
    private readonly SemaphoreSlim gate=new(1,1);
    private static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes));
    private async Task<string> Fingerprint(string id,string revision,CancellationToken ct)
    {
        var path=catalog.GetBpmnSourcePath(id,true);
        var xml=Hash(await File.ReadAllBytesAsync(path,ct));
        var context=Hash(await File.ReadAllBytesAsync(Path.ChangeExtension(path,".context.json"),ct));
        return Hash(JsonSerializer.SerializeToUtf8Bytes(new{revision,xml,context}));
    }
    private async Task<LanePlanItem> Item(CrossCompanyProcessModel binding,OrganizationMapModel org,CancellationToken ct)
    {
        try
        {
            if(locks.HasActiveLock(binding.ProcessId))throw new InvalidDataException("Черновик открыт в редакторе.");
            await catalog.EnsureDraftEditableAsync(binding.ProcessId,ct);
            var fingerprint=await Fingerprint(binding.ProcessId,org.Revision!,ct);
            var model=await catalog.LoadAsync(binding.ProcessId,true,ct);
            var mapped=binding.LaneOrganizations.ToDictionary(m=>m.LaneId,StringComparer.Ordinal);
            if(mapped.Count!=model.Lanes.Count||model.Lanes.Any(l=>!mapped.ContainsKey(l.Id)))
                throw new InvalidDataException("Состав дорожек не совпадает с оргпривязками.");
            var changes=new List<LaneRename>();
            foreach(var lane in model.Lanes)
            {
                var m=mapped[lane.Id];
                var unit=org.LegalEntities.FirstOrDefault(e=>e.Id.Equals(m.LegalEntityId,StringComparison.OrdinalIgnoreCase))?.Units?
                    .FirstOrDefault(u=>u.Id.Equals(m.UnitId,StringComparison.OrdinalIgnoreCase))
                    ??throw new InvalidDataException("Подразделение дорожки отсутствует.");
                var name=m.DisplayNameMode=="short"&&!string.IsNullOrWhiteSpace(unit.ShortName)?unit.ShortName:unit.Name;
                if(lane.Name!=name)changes.Add(new(lane.Id,lane.Name,name));
            }
            if(fingerprint!=await Fingerprint(binding.ProcessId,org.Revision!,ct))
                throw new InvalidDataException("Черновик изменился во время проверки.");
            return new(model.Id,model.Name,fingerprint,changes,null);
        }
        catch(Exception e)when(e is IOException or InvalidDataException or System.Xml.XmlException or JsonException or ArgumentException)
        {return new(binding.ProcessId,binding.ProcessId,null,[],e is FileNotFoundException?"Нет доступного черновика.":e.Message);}
    }
    public async Task<LanePlan> PreviewAsync(CancellationToken ct=default)
    {
        var org=await organizations.LoadAsync(ct);var catalogItems=await catalog.ListAsync(ct);
        var drafts=catalogItems.Where(i=>i.HasDraft||i.Status=="Draft").Select(i=>i.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var bindings=org.CrossCompanyProcesses.Where(b=>drafts.Contains(b.ProcessId)).ToArray();
        if(bindings.Length>500)throw new InvalidDataException("Более 500 черновиков: разделите фонд перед массовой обработкой.");
        var items=new List<LanePlanItem>();foreach(var b in bindings)items.Add(await Item(b,org,ct));
        if((await organizations.LoadAsync(ct)).Revision!=org.Revision)throw new InvalidDataException("Оргструктура изменилась. Повторите просмотр.");
        return new(org.Revision!,items);
    }
    public async Task<LanePlanResult> ApplyAsync(LanePlanApply request,string actor,CancellationToken ct=default)
    {
        if(request.Selected is null||request.Selected.Count is <1 or >500||request.Selected.Any(s=>s is null||string.IsNullOrWhiteSpace(s.ProcessId)||string.IsNullOrWhiteSpace(s.Fingerprint))||request.Selected.Select(s=>s.ProcessId).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=request.Selected.Count)
            throw new InvalidDataException("Выберите от 1 до 500 разных черновиков.");
        await gate.WaitAsync(ct);
        try
        {
            var org=await organizations.LoadAsync(ct);
            if(org.Revision!=request.OrganizationRevision)throw new InvalidDataException("Оргструктура изменилась. Повторите просмотр.");
            // Validate the whole requested selection before creating a backup or changing any draft.
            foreach(var selected in request.Selected)
            {
                var b=org.CrossCompanyProcesses.SingleOrDefault(b=>b.ProcessId==selected.ProcessId)??throw new InvalidDataException("Нет оргпривязки процесса.");
                var item=await Item(b,org,ct);
                if(item.Fingerprint!=selected.Fingerprint||item.Reason is not null||item.Changes.Count==0)
                    throw new InvalidDataException("План устарел или процесс недоступен: "+selected.ProcessId+". Повторите просмотр.");
            }
            var backup=await backups.CreateAsync(actor,ct);var results=new List<DraftLaneSyncItemModel>();
            foreach(var selected in request.Selected)
            {
                var current=await organizations.LoadAsync(ct);
                var b=current.CrossCompanyProcesses.SingleOrDefault(b=>b.ProcessId==selected.ProcessId);
                var item=b is null?null:await Item(b,current,ct);
                if(current.Revision!=request.OrganizationRevision||item?.Fingerprint!=selected.Fingerprint||item.Reason is not null)
                {results.Add(new(selected.ProcessId,selected.ProcessId,"Skipped",Reason:"Данные или блокировка изменились. Повторите просмотр."));continue;}
                try
                {
                    var count=await catalog.SyncDraftLaneNamesAsync(selected.ProcessId,b!.LaneOrganizations,current,ct,async()=>
                        !locks.HasActiveLock(selected.ProcessId)&&(await organizations.LoadAsync(ct)).Revision==request.OrganizationRevision
                        &&await Fingerprint(selected.ProcessId,request.OrganizationRevision,ct)==selected.Fingerprint);
                    results.Add(new(selected.ProcessId,item.ProcessName,"Updated",count));
                }
                catch(Exception e)when(e is IOException or InvalidDataException or System.Xml.XmlException)
                {results.Add(new(selected.ProcessId,item.ProcessName,"Skipped",Reason:e.Message));}
            }
            return new(backup.FileName,new(results.Count(i=>i.Status=="Updated"),results.Sum(i=>i.RenamedLanes),results));
        }
        finally{gate.Release();}
    }
}
