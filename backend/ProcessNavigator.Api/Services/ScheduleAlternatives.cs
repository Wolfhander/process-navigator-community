using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class ProcessScheduleService
{
    public const string ScenarioAlgorithm="schedule-v5-object-conditions";
    private static bool HasScenario(ProcessScheduleRequestModel request)=>
        request.Facts?.Count>0||request.ObjectRules?.Count>0||request.BranchProbabilities?.Count>0;
    private static void ValidateObjectRules(ProcessScheduleRequestModel request,IReadOnlyList<ProcessModel> models)
    {
        if(request.Facts?.Count>100||request.ObjectRules?.Count>500)
            throw new InvalidDataException("Предел сценария: 100 булевых фактов и 500 условий объектов.");
        foreach(var key in request.Facts?.Keys??[]){
            if(string.IsNullOrWhiteSpace(key)||key.Length>80||key.Any(char.IsControl))
                throw new InvalidDataException("Имя факта: 1–80 символов без управляющих знаков.");
        }
        var rules=request.ObjectRules??[];
        if(rules.Any(r=>r is null)||rules.Select(r=>RuleKey(r.ProcessId,r.ElementId,r.ObjectId,r.Role)).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=rules.Count)
            throw new InvalidDataException("Условия объектов повторяются или не заполнены.");
        foreach(var rule in rules){
            if(rule.ExpectedValue is null||rule.Role is not ("Input" or "Output")||
                string.IsNullOrWhiteSpace(rule.FactName)||request.Facts?.ContainsKey(rule.FactName)!=true)
                throw new InvalidDataException("Условие требует существующий булев факт, ожидаемое значение и роль Input/Output.");
            var node=models.SingleOrDefault(p=>p.Id==rule.ProcessId)?.Nodes.SingleOrDefault(n=>n.Id==rule.ElementId&&n.Type=="task");
            if((node?.InformationObjects??[]).Count(b=>b.ObjectId==rule.ObjectId&&b.Role==rule.Role)!=1)
                throw new InvalidDataException("Условие относится к отсутствующей или неоднозначной привязке документа к шагу.");
        }
    }
    private static IReadOnlyList<InformationObjectModel> ApplyObjectRules(ProcessScheduleRequestModel request,IReadOnlyList<InformationObjectModel> objects)
    {
        var rules=(request.ObjectRules??[]).ToDictionary(r=>RuleKey(r.ProcessId,r.ElementId,r.ObjectId,r.Role),StringComparer.OrdinalIgnoreCase);
        InformationObjectOccurrenceModel[] Filter(IReadOnlyList<InformationObjectOccurrenceModel> occurrences,string objectId,string role)=>occurrences
            .Where(o=>o.Scope!="Step"||!rules.TryGetValue(RuleKey(o.ProcessId,o.ElementId??"",objectId,role),out var rule)||request.Facts![rule.FactName]==rule.ExpectedValue)
            .Select(o=>o.Scope=="Step"&&rules.ContainsKey(RuleKey(o.ProcessId,o.ElementId??"",objectId,role))?o with{Required=true,Condition=null}:o).ToArray();
        return objects.Select(o=>o with{Producers=Filter(o.Producers,o.Id,"Output"),Consumers=Filter(o.Consumers,o.Id,"Input")}).ToArray();
    }
    private static string RuleKey(string process,string element,string document,string role)=>string.Join("\0",process,element,document,role);
    private async Task<ProcessScheduleModel> CalculateScenarioAsync(ProcessScheduleRequestModel request,bool includeDrafts,
        ScheduleSourceSnapshotModel? frozen,CancellationToken ct)
    {
        var enabled=HasScenario(request);
        if(frozen is not null && (frozen.Algorithm==ScenarioAlgorithm)!=enabled)
            throw new InvalidDataException("Алгоритм снимка не соответствует условиям сценария.");
        var baseSource=frozen;
        if(frozen?.Algorithm==ScenarioAlgorithm){
            if(frozen.BaseAlgorithm is not (Algorithm or CalendarAlgorithm or EventAlgorithm))throw new InvalidDataException("В снимке не указан поддержанный базовый календарный алгоритм.");
            baseSource=frozen with{Algorithm=frozen.BaseAlgorithm,BaseAlgorithm=null};
        }
        var basis=await CalculateCoreAsync(request,includeDrafts,baseSource,ct);
        if(!enabled)return basis;
        var source=basis.Sources!;
        var probabilities=request.BranchProbabilities??[];
        if(probabilities.Count>8||probabilities.Any(p=>p is null)||probabilities.Select(p=>(p.ProcessId,p.GatewayId)).Distinct().Count()!=probabilities.Count)
            throw new InvalidDataException("Не более 8 неповторяющихся вероятностных XOR-шлюзов в сценарии.");
        foreach(var profile in probabilities){
            var model=source.Processes.SingleOrDefault(p=>p.Id==profile.ProcessId)??throw new InvalidDataException("Неизвестный процесс вероятностного шлюза.");
            var gate=model.Nodes.SingleOrDefault(n=>n.Id==profile.GatewayId&&n.Type=="exclusiveGateway")??throw new InvalidDataException("Вероятности задаются только исходам XOR.");
            var edges=model.Edges.Where(e=>e.SourceId==gate.Id).ToArray();
            if(edges.Length<2||profile.Weights is null||profile.Weights.Count!=edges.Length||
                profile.Weights.Any(w=>w is null||w.Probability is null||!double.IsFinite(w.Probability.Value)||w.Probability<0||w.Probability>1||(w.Probability>0&&w.Probability<0.000001))||
                profile.Weights.Select(w=>w.EdgeId).Distinct().Count()!=edges.Length||profile.Weights.Any(w=>!edges.Any(e=>e.Id==w.EdgeId))||
                Math.Abs(profile.Weights.Sum(w=>w.Probability!.Value)-1)>1e-9||
                request.ProcessBranches?.GetValueOrDefault(model.Id)?.ContainsKey(gate.Id)==true)
                throw new InvalidDataException("Вероятности должны покрывать все исходы ровно один раз, иметь сумму 1 и значения 0 либо от 0.000001 до 1; ручной исход того же шлюза запрещён.");
        }
        if(probabilities.Count>0&&(request.ProcessRepetitions?.Values.Any(r=>r.MaximumRepeats>0)==true||basis.Processes.Any(p=>p.HasInternalCycle)))
            throw new InvalidDataException("Вероятностный диапазон требует маршрут без повторов и циклов. Итерации — отдельный сценарий.");
        var topologies=probabilities.Select(p=>p.ProcessId).Distinct().ToDictionary(id=>id,id=>{
            var model=source.Processes.Single(p=>p.Id==id);
            var incoming=model.Edges.Select(e=>e.TargetId).ToHashSet(StringComparer.Ordinal);
            return (Model:model,Starts:model.Nodes.Where(n=>n.Type=="startEvent"||!incoming.Contains(n.Id)).Select(n=>n.Id).ToArray());
        });
        var cases=new List<ScheduleAlternativeCaseModel>();var used=new HashSet<(string,string)>();
        if(probabilities.Count>0){
            var initial=(request.ProcessBranches??new Dictionary<string,IReadOnlyDictionary<string,string>>())
                .ToDictionary(p=>p.Key,p=>(IReadOnlyDictionary<string,string>)new Dictionary<string,string>(p.Value),StringComparer.Ordinal);
            var pending=new Stack<(Dictionary<string,IReadOnlyDictionary<string,string>> Choices,double Weight)>();
            pending.Push((initial,1));var calls=0;
            while(pending.TryPop(out var entry)){
                ct.ThrowIfCancellationRequested();
                if(++calls>512)throw new InvalidDataException("Перебор превысил 512 расчётов.");
                var calculation=await CalculateCoreAsync(request with{ProcessBranches=entry.Choices},false,source,ct);
                var routeCache=new Dictionary<string,ScheduleRouteResult>();
                ScheduleRouteResult Route(string id){
                    if(!routeCache.TryGetValue(id,out var value)){
                        value=ScheduleRouteScenario.Build(topologies[id].Model,entry.Choices.GetValueOrDefault(id),null);routeCache[id]=value;
                    }
                    return value;
                }
                ScheduleBranchProbabilityModel? next=null;
                foreach(var candidate in probabilities.OrderBy(p=>p.ProcessId,StringComparer.Ordinal).ThenBy(p=>p.GatewayId,StringComparer.Ordinal)){
                    if(entry.Choices.GetValueOrDefault(candidate.ProcessId)?.ContainsKey(candidate.GatewayId)==true||
                        !calculation.Processes.Any(p=>p.ProcessId==candidate.ProcessId))continue;
                    var model=topologies[candidate.ProcessId].Model;
                    var route=Route(model.Id);
                    // An unresolved upstream probabilistic gate blocks traversal to its
                    // descendants. Identifier sorting must not sample a latent nested XOR.
                    var blocked=probabilities.Where(p=>p.ProcessId==model.Id&&entry.Choices.GetValueOrDefault(model.Id)?.ContainsKey(p.GatewayId)!=true)
                        .Select(p=>p.GatewayId).ToHashSet(StringComparer.Ordinal);
                    var outgoing=route.Model.Edges.GroupBy(e=>e.SourceId).ToDictionary(g=>g.Key,g=>g.Select(e=>e.TargetId).ToArray());
                    var queue=new Queue<string>(topologies[model.Id].Starts);var visited=new HashSet<string>(StringComparer.Ordinal);
                    while(queue.TryDequeue(out var id)){
                        if(!visited.Add(id)||!route.ActiveIds.Contains(id))continue;
                        if(blocked.Contains(id)){if(id==candidate.GatewayId)next=candidate;continue;}
                        foreach(var target in outgoing.GetValueOrDefault(id)??[])queue.Enqueue(target);
                    }
                    if(next is not null)break;
                }
                if(next is null){
                    var effective=entry.Choices.ToDictionary(p=>p.Key,p=>p.Value,StringComparer.Ordinal);
                    // A downstream decision can remove an entire producer process in a
                    // reverse chain. Its latent probability choices must not duplicate leaves.
                    foreach(var profile in probabilities){
                        var active=calculation.Processes.Any(p=>p.ProcessId==profile.ProcessId)&&
                            Route(profile.ProcessId).ActiveIds.Contains(profile.GatewayId);
                        if(!active&&effective.TryGetValue(profile.ProcessId,out var previous)){
                            var reduced=new Dictionary<string,string>(previous);reduced.Remove(profile.GatewayId);
                            if(reduced.Count==0)effective.Remove(profile.ProcessId);else effective[profile.ProcessId]=reduced;
                        }
                    }
                    string Key(IReadOnlyDictionary<string,IReadOnlyDictionary<string,string>> choices)=>System.Text.Json.JsonSerializer.Serialize(
                        choices.OrderBy(p=>p.Key,StringComparer.Ordinal).Select(p=>new{p.Key,Values=p.Value.OrderBy(v=>v.Key,StringComparer.Ordinal).ToArray()}));
                    var match=cases.FindIndex(c=>Key(c.Choices)==Key(effective));
                    if(match>=0)cases[match]=cases[match] with{Probability=cases[match].Probability+entry.Weight};
                    else cases.Add(new(cases.Count+1,entry.Weight,effective,calculation.StartAt,calculation.EndAt,calculation.CriticalDurationHours,
                        calculation.Complete,calculation.Processes.Select(p=>p.ProcessId).ToArray()));
                    if(cases.Count>64)throw new InvalidDataException("Диапазон содержит более 64 сценариев. Уточните ручные исходы.");
                }else{
                    used.Add((next.ProcessId,next.GatewayId));
                    foreach(var weight in next.Weights.Where(w=>w.Probability>0).OrderByDescending(w=>w.EdgeId,StringComparer.Ordinal)){
                        var choices=new Dictionary<string,IReadOnlyDictionary<string,string>>(entry.Choices,StringComparer.Ordinal);
                        var selected=new Dictionary<string,string>(choices.GetValueOrDefault(next.ProcessId)??new Dictionary<string,string>());
                        selected[next.GatewayId]=weight.EdgeId;choices[next.ProcessId]=selected;
                        pending.Push((choices,entry.Weight*weight.Probability!.Value));
                    }
                    if(pending.Count+cases.Count>64)throw new InvalidDataException("Диапазон требует более 64 сценариев; усечение и перенормировка запрещены.");
                }
            }
        }
        var issues=basis.Issues.ToList();
        if(request.ObjectRules?.Count>0)issues.Add(new("object-rule-assumption","Warning","Булевы факты и условия — явные допущения сценария, не проверенные данные внешней системы."));
        if(request.Facts?.Count>0&&request.ObjectRules?.Count is not >0)issues.Add(new("unused-facts","Warning","Факты заданы, но не связаны с условиями объектов."));
        ScheduleAlternativeEnvelopeModel? envelope=null;
        if(cases.Count>0){
            var mass=cases.Sum(c=>c.Probability);
            if(Math.Abs(mass-1)>1e-7)throw new InvalidDataException("Вероятностная масса диапазона не равна 1.");
            envelope=new(cases,cases.Min(c=>c.StartAt),cases.Max(c=>c.StartAt),cases.Min(c=>c.EndAt),cases.Max(c=>c.EndAt),
                cases.Sum(c=>c.Probability*c.NominalHours),mass,cases.All(c=>c.Complete));
            issues.Add(new("alternative-envelope","Warning","Диапазон перечисляет положительные исходы; вероятности условны на достигаемом XOR. Средняя номинальная длительность — не гарантированный срок. Основная таблица без выбора исходов остаётся предварительной."));
            if(probabilities.Any(p=>!used.Contains((p.ProcessId,p.GatewayId))))issues.Add(new("inactive-distribution","Warning","Часть вероятностных шлюзов недостижима в выбранной цепочке и не участвует в вероятностной массе."));
        }
        return basis with{Sources=source with{Algorithm=ScenarioAlgorithm,BaseAlgorithm=source.Algorithm},
            Issues=issues,AlternativeEnvelope=envelope};
    }
}
