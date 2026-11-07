using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;

public sealed record ExecutionReportIssue(string Source,string Message);
public sealed record ExecutionInstanceFact(string ProcessId,string ProcessName,bool ModelAvailable,string InstanceId,string Name,string Version,string Status,
    DateTimeOffset StartedAt,DateTimeOffset? CompletedAt,double? CycleMinutes,int ReturnEvents);
public sealed record ExecutionAttemptFact(string ProcessId,string InstanceId,string ElementId,string Name,int Iteration,bool Current,string Status,
    string Department,string? EntityId,string? UnitId,string OrganizationBasis,
    double? QueueMinutes,double? WorkMinutes,double? DurationMinutes,double? OverdueMinutes,IReadOnlyList<string> Notes);
public sealed record ExecutionPortfolioReport(DateTimeOffset CapturedAt,string Algorithm,bool Complete,string Fingerprint,int IssueCount,
    IReadOnlyList<ExecutionReportIssue> Issues,IReadOnlyList<ExecutionInstanceFact> Instances,IReadOnlyList<ExecutionAttemptFact> Attempts);

public sealed class ExecutionPortfolioService(IWebHostEnvironment env,ProcessCatalogService catalog,OrganizationMapService organizations)
{
    public async Task<ExecutionPortfolioReport> BuildAsync(CancellationToken ct=default)
    {
        var now=DateTimeOffset.UtcNow;var issues=new List<ExecutionReportIssue>();var instances=new List<ExecutionInstanceFact>();var attempts=new List<ExecutionAttemptFact>();
        var digests=new List<string>();var directory=Path.Combine(env.ContentRootPath,"Data","Executions");long total=0;var issueCount=0;
        void Issue(string source,string message){issueCount++;if(issues.Count<1000)issues.Add(new(source,message));}
        var org=await organizations.LoadAsync(ct);var list=await catalog.ListAsync(ct);var models=new Dictionary<string,ProcessModel>(StringComparer.OrdinalIgnoreCase);
        if(list.Count>500)throw new InvalidDataException("Для аналитики исполнения поддерживается до 500 моделей.");
        var paths=Directory.Exists(directory)?Directory.EnumerateFiles(directory,"*.json",SearchOption.TopDirectoryOnly).Order(StringComparer.Ordinal).Take(501).ToArray():[];
        if(paths.Length>500)throw new InvalidDataException("Более 500 файлов выполнений. Разделите фонд перед построением отчёта.");
        foreach(var path in paths)
        {
            ct.ThrowIfCancellationRequested();var source=Path.GetFileName(path);var id=Path.GetFileNameWithoutExtension(path);
            if(!Regex.IsMatch(id,"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")){Issue(source,"Недопустимое имя файла; файл пропущен.");continue;}
            long size;try{size=new FileInfo(path).Length;}catch(Exception e)when(e is IOException or UnauthorizedAccessException){Issue(source,"Файл недоступен; пропущен.");continue;}
            if(size>20*1024*1024){Issue(source,"Файл больше 20 МБ; пропущен.");continue;}
            total+=size;if(total>100*1024*1024)throw new InvalidDataException("Совокупный объём выполнений превышает 100 МБ.");
            IReadOnlyList<ProcessInstanceModel> records;
            try
            {
                var bytes=await File.ReadAllBytesAsync(path,ct);
                if(bytes.Length>20*1024*1024)throw new InvalidDataException("Файл вырос за предел 20 МБ.");
                digests.Add(source+":"+Convert.ToHexString(SHA256.HashData(bytes)));
                records=JsonSerializer.Deserialize<List<ProcessInstanceModel>>(bytes,new JsonSerializerOptions(JsonSerializerDefaults.Web))??throw new InvalidDataException("Нет списка выполнений.");
                if(records.Any(i=>i is null||string.IsNullOrWhiteSpace(i.Id))||records.Select(i=>i.Id).Distinct(StringComparer.Ordinal).Count()!=records.Count)
                    throw new InvalidDataException("Пустые или повторяющиеся ID экземпляров.");
            }
            catch(Exception e)when(e is IOException or UnauthorizedAccessException or JsonException or InvalidDataException){Issue(source,"Файл не прочитан: "+e.Message);continue;}
            ProcessModel? model=null;
            if(records.Count>0)try{model=await catalog.LoadAsync(id,false,ct);models[id]=model;}
            catch(Exception e)when(e is IOException or UnauthorizedAccessException or InvalidDataException or System.Xml.XmlException or JsonException)
            {Issue(id,"Действующая модель недоступна; организация этапов не определена.");}
            foreach(var instance in records)
            {
                ct.ThrowIfCancellationRequested();
                if(instances.Count>=20000)throw new InvalidDataException("Более 20000 экземпляров; отчёт не выдаётся с усечёнными итогами.");
                if(instance.ProcessId!=id||instance.Id.Length>100||string.IsNullOrWhiteSpace(instance.ProcessVersion)||instance.ProcessVersion.Length>100||instance.StartedAt==default||instance.StartedAt>now
                    ||instance.Status is not ("Active" or "Paused" or "Cancelled" or "Completed")||instance.Steps is null
                    ||instance.Steps.Any(s=>s is null||string.IsNullOrWhiteSpace(s.ElementId)||s.ElementId.Length>200)||instance.Steps.Select(s=>s.ElementId).Distinct(StringComparer.Ordinal).Count()!=instance.Steps.Count)
                {Issue(source,"Некорректный экземпляр "+instance.Id+" исключён.");continue;}
                double? cycle=null;
                if(instance.Status=="Completed")
                {
                    if(instance.CompletedAt is null||instance.CompletedAt<instance.StartedAt||instance.CompletedAt>now)
                        Issue(source,"Некорректное завершение "+instance.Id+": время цикла неизвестно.");
                    else cycle=(instance.CompletedAt.Value-instance.StartedAt).TotalMinutes;
                }
                var returns=(instance.ReturnEvents??[]).Count(e=>e is not null&&e.ReturnedAt>=instance.StartedAt&&e.ReturnedAt<=now);
                if(returns!=(instance.ReturnEvents?.Count??0))Issue(source,"Некорректные события возврата исключены: "+instance.Id);
                instances.Add(new(id,model?.Name??id,model is not null,instance.Id,instance.Name??instance.Id,instance.ProcessVersion,instance.Status,instance.StartedAt.ToUniversalTime(),instance.CompletedAt?.ToUniversalTime(),cycle,returns));
                foreach(var step in instance.Steps)
                {
                    try{WaitEvents.ValidateStep(step.Waiting,step.Status,step.StartedAt,step.CompletedAt);foreach(var old in step.History??[])WaitEvents.ValidateStep(old.Waiting,old.Status,old.StartedAt,old.CompletedAt);}
                    catch(InvalidDataException e){Issue(source,"Повреждённое ожидание исключено из фактов: "+e.Message);continue;}
                    var history=step.History??[];
                    if(history.Any(h=>h is null)||step.Iteration<1||history.Any(h=>h.Iteration<1)||history.Select(h=>h.Iteration).Append(step.Iteration).Distinct().Count()!=history.Count+1)
                    {Issue(source,"Неоднозначные итерации этапа "+step.ElementId+" в "+instance.Id+" исключены.");continue;}
                    var node=model is not null&&model.Version==instance.ProcessVersion?model.Nodes.FirstOrDefault(n=>n.Id==step.ElementId):null;
                    var mapping=node is null?null:org.CrossCompanyProcesses.FirstOrDefault(b=>b.ProcessId.Equals(id,StringComparison.OrdinalIgnoreCase))?.LaneOrganizations.FirstOrDefault(l=>l.LaneId==node.LaneId);
                    var entity=org.LegalEntities.FirstOrDefault(e=>e.Id.Equals(mapping?.LegalEntityId,StringComparison.OrdinalIgnoreCase));
                    var unit=entity?.Units?.FirstOrDefault(u=>u.Id.Equals(mapping?.UnitId,StringComparison.OrdinalIgnoreCase));
                    void Add(int iteration,bool current,string status,DateTimeOffset? started,DateTimeOffset? completed,double? queue,double? work,double? duration,double? overdue,double? eventWait=null)
                    {
                        if(attempts.Count>=100000)throw new InvalidDataException("Более 100000 проходов этапов; отчёт не выдаётся с усечёнными итогами.");
                        var notes=new List<string>();
                        if(status is not ("Completed" or "InProgress" or "NotStarted" or "Skipped")){Issue(source,"Неизвестное состояние прохода "+step.ElementId);return;}
                        bool closed=status=="Completed"&&started.HasValue&&completed.HasValue&&started>=instance.StartedAt&&completed>=started&&completed<=now;
                        if(status=="Completed"&&!closed){notes.Add("Некорректные даты завершения; длительности исключены.");Issue(source,instance.Id+"/"+step.ElementId+": некорректные даты.");}
                        double? Number(double? value,string field){
                            if(value is null)return null;
                            if(!double.IsFinite(value.Value)||value<0||value>52_560_000){notes.Add("Некорректное "+field+" исключено.");Issue(source,instance.Id+"/"+step.ElementId+": "+field);return null;}
                            return closed?value:null;
                        }
                        if(Number(eventWait,"календарное ожидание события") is { } measured)notes.Add("Календарное ожидание события: "+measured.ToString(System.Globalization.CultureInfo.InvariantCulture)+" мин; входит в общий факт, не в работу сотрудника.");
                        attempts.Add(new(id,instance.Id,step.ElementId,node?.Name??step.ElementId,iteration,current,status,
                            unit is null?"Не определено":entity!.Name+" / "+unit.Name,unit is null?null:entity!.Id,unit?.Id,
                            unit is null?"Нет сопоставления той же версии":"Текущая оргпривязка; не историческая",
                            Number(queue,"ожидание"),Number(work,"работа"),Number(duration,"общий факт"),Number(overdue,"превышение нормы"),notes));
                    }
                    foreach(var h in history)Add(h.Iteration,false,h.Status,h.StartedAt,h.CompletedAt,h.ActualQueueMinutes,h.ActualWorkMinutes,h.ActualDurationMinutes,h.OverdueMinutes,h.ActualEventWaitMinutes);
                    Add(step.Iteration,true,step.Status,step.StartedAt,step.CompletedAt,step.ActualQueueMinutes,step.ActualWorkMinutes,step.ActualDurationMinutes,step.OverdueMinutes,step.ActualEventWaitMinutes);
                }
            }
        }
        var fingerprint=Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new{digests,org.Revision,instances,attempts,issues,issueCount})));
        return new(now,"execution-observation-v1",issueCount==0,fingerprint,issueCount,issues,instances,attempts);
    }
}
