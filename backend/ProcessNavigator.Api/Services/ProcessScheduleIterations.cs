using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class ProcessScheduleService
{
    public const string IterationAlgorithm="schedule-v6-bounded-iterations";
    public async Task<ScheduleSourceSnapshotModel> LoadScenarioSourcesAsync(string rootProcessId,string direction,bool includeDrafts,CancellationToken ct=default)
    {
        if(string.IsNullOrWhiteSpace(rootProcessId)||direction is not ("Forward" or "Backward"))throw new InvalidDataException("Выберите процесс и направление.");
        var summaries=await catalog.ListAsync(ct);var index=await registry.BuildAsync(includeDrafts,ct);
        var dependencies=BuildDependencies(index);var ids=Traverse(rootProcessId,dependencies,direction);
        if(ids.Count>200||dependencies.Count(d=>ids.Contains(d.SourceProcessId)&&ids.Contains(d.TargetProcessId))>5000)
            throw new InvalidDataException("Цепочка превышает 200 процессов или 5000 зависимостей.");
        var models=new List<ProcessModel>();
        foreach(var id in ids.Order(StringComparer.Ordinal)){
            var summary=summaries.SingleOrDefault(s=>s.Id==id)??throw new FileNotFoundException("Процесс не найден: "+id);
            models.Add(await catalog.LoadAsync(id,summary.Status=="Draft"||(includeDrafts&&summary.HasDraft),ct));
        }
        return new(IterationAlgorithm,DateTimeOffset.UtcNow,models,index.Objects.Where(o=>o.Producers.Concat(o.Consumers).Any(v=>ids.Contains(v.ProcessId))).ToArray());
    }
    private async Task<ProcessScheduleModel> CalculateIterationsAsync(ProcessScheduleRequestModel request,bool includeDrafts,
        ScheduleSourceSnapshotModel? frozen,CancellationToken ct)
    {
        var enabled=request.IterationPlans?.Count>0||request.IterationTransfers?.Count>0;
        if(frozen is not null&&(frozen.Algorithm==IterationAlgorithm)!=enabled)
            throw new InvalidDataException("Снимок не соответствует режиму развёрнутых итераций.");
        if(!enabled)return await CalculateScenarioAsync(request,includeDrafts,frozen,ct);
        if(request.IterationPlans?.Count is not >0||request.ProcessRepetitions?.Count>0||request.BranchProbabilities?.Count>0)
            throw new InvalidDataException("Задайте участки нового режима без прежних простых повторов и вероятностных XOR. Эти сценарии рассчитываются отдельно.");
        if(request.Direction is not ("Forward" or "Backward")||string.IsNullOrWhiteSpace(request.RootProcessId))
            throw new InvalidDataException("Выберите процесс и направление Forward/Backward.");
        ScheduleSourceSnapshotModel source;
        if(frozen is not null)source=frozen;
        else{
            var captured=await LoadScenarioSourcesAsync(request.RootProcessId,request.Direction,includeDrafts,ct);
            var org=request.UseOrganizationCalendars
                ? organization is null?throw new InvalidDataException("Оргструктура календарей недоступна."):await organization.LoadAsync(ct):null;
            source=captured with{Organization=org};
        }
        var idsSource=source.Processes.Select(p=>p.Id).ToHashSet(StringComparer.Ordinal);
        if(source.Objects.Count>10000||source.Objects.Sum(o=>(long)o.Producers.Count+o.Consumers.Count+o.References.Count)>100000||
            source.Objects.Sum(o=>(long)o.Producers.Count*o.Consumers.Count)>200000)
            throw new InvalidDataException("Исходный граф документов превышает предел развёртки.");
        ValidateScenarioParameters(request,idsSource);
        foreach(var calendar in request.ProcessCalendars?.Values??[])_ = new ScheduleWorkCalendar(calendar);
        ValidateObjectRules(request,source.Processes);
        if(request.IterationPlans.Count>200||request.IterationPlans.Any(p=>!idsSource.Contains(p.Key)||p.Value is null)||
            request.IterationPlans.Sum(p=>p.Value.Count)>16)
            throw new InvalidDataException("Планы итераций должны относиться к исходным процессам; до 16 участков в цепочке.");
        if(request.IterationTransfers?.Count>10000||request.IterationTransfers?.Any(p=>!source.Objects.Any(o=>o.Id==p.Key)||p.Value is not ("Batch" or "PerPass"))==true)
            throw new InvalidDataException("Режим передачи: Batch (полный комплект) либо PerPass (по номеру прохода) для известного объекта.");
        var distributions=new List<(string Process,ScheduleIterationPlanModel Plan)>();
        foreach(var (process,plans) in request.IterationPlans){
            // Validate null entries and all structural limits before inspecting distributions.
            _=ScheduleIterationExpansion.Build(source.Processes.Single(p=>p.Id==process),plans,request.ProcessBranches?.GetValueOrDefault(process));
            foreach(var plan in plans){
                if(plan.Distribution is not {Count:>0} weights)continue;
                if(weights.Count>51||weights.Any(w=>w is null||w.Repeats<0||w.Repeats>plan.MaximumRepeats||!double.IsFinite(w.Probability)||
                    w.Probability<0||w.Probability>1||(w.Probability>0&&w.Probability<.000001))||
                    weights.Select(w=>w.Repeats).Distinct().Count()!=weights.Count||Math.Abs(weights.Sum(w=>w.Probability)-1)>1e-9)
                    throw new InvalidDataException("Распределение повторов: разные числа 0..предел, сумма вероятностей 1; вероятность 0 либо не менее 0.000001.");
                distributions.Add((process,plan));
            }
        }
        if(distributions.Count>8)throw new InvalidDataException("Не более 8 распределений повторов.");
        var conditioned=ApplyObjectRules(request,source.Objects);
        var originalNodes=source.Processes.ToDictionary(p=>p.Id,p=>p.Nodes.ToDictionary(n=>n.Id));
        Dictionary<string,IReadOnlyDictionary<string,int>> Counts(Func<ScheduleIterationPlanModel,int> select)=>
            request.IterationPlans.ToDictionary(p=>p.Key,p=>(IReadOnlyDictionary<string,int>)p.Value.ToDictionary(v=>v.ReturnEdgeId,select));
        var planned=Counts(p=>p.PlannedRepeats);var maximum=Counts(p=>p.MaximumRepeats);
        async Task<(ProcessScheduleModel Result,ScheduleIterationDetailModel Detail,Dictionary<string,ScheduleExpandedRoute> Routes)> Calculate(
            IReadOnlyDictionary<string,IReadOnlyDictionary<string,int>> counts)
        {
            ct.ThrowIfCancellationRequested();
            var routes=source.Processes.ToDictionary(p=>p.Id,p=>ScheduleIterationExpansion.Build(p,request.IterationPlans.GetValueOrDefault(p.Id)??[],
                request.ProcessBranches?.GetValueOrDefault(p.Id),counts.GetValueOrDefault(p.Id)));
            if(routes.Values.Sum(p=>p.Model.Nodes.Count)>10000)throw new InvalidDataException("Общая развёртка превышает 10 000 узлов.");
            var mappedCalendars=new Dictionary<string,IReadOnlyDictionary<string,ScheduleCalendarModel>>();
            foreach(var (id,route) in routes){
                var profiles=new Dictionary<string,ScheduleCalendarModel>();
                var manual=request.StepCalendars?.GetValueOrDefault(id);
                if(manual?.Keys.Any(key=>!originalNodes[id].TryGetValue(key,out var n)||n.Type!="task")==true)
                    throw new InvalidDataException("Неизвестный исходный шаг календаря.");
                foreach(var (clone,node) in route.Nodes)
                    if(manual?.TryGetValue(node.OriginalId,out var cal)==true)profiles[clone]=cal;
                // Force task-level dates without overriding inherited organization calendars.
                if(!request.UseOrganizationCalendars)
                    foreach(var node in route.Model.Nodes.Where(n=>n.Type=="task"&&!profiles.ContainsKey(n.Id)))
                        profiles[node.Id]=request.ProcessCalendars?.GetValueOrDefault(id)??new(request.WorkdayStart,request.WorkdayEnd,
                            request.WorkingDays??[1,2,3,4,5],request.NonWorkingDates??[],request.UtcOffsetMinutes??(int)request.AnchorDate.Offset.TotalMinutes,request.TimeZoneId);
                if(profiles.Count>0)mappedCalendars[id]=profiles;
            }
            // A zero-task graph still needs a stable advanced-calendar algorithm.
            var internalRequest=request with{IterationPlans=null,IterationTransfers=null,ProcessRepetitions=null,ProcessBranches=null,
                Facts=null,ObjectRules=null,BranchProbabilities=null,StepCalendars=mappedCalendars};
            var objects=ExpandIterationObjects(conditioned,routes,request.IterationTransfers,out var objectOrigins);
            var dependencies=BuildDependencies(new InformationObjectRegistryModel(source.CapturedAt,routes.Count,objects.Count,0,0,0,0,0,0,objects,[]));
            var candidates=Traverse(request.RootProcessId,dependencies,request.Direction);
            internalRequest=internalRequest with{
                StepCalendars=mappedCalendars.Where(p=>candidates.Contains(p.Key)).ToDictionary(p=>p.Key,p=>p.Value),
                ProcessCalendars=request.ProcessCalendars?.Where(p=>candidates.Contains(p.Key)).ToDictionary(p=>p.Key,p=>p.Value),
                ProcessDurationScalePercent=request.ProcessDurationScalePercent?.Where(p=>candidates.Contains(p.Key)).ToDictionary(p=>p.Key,p=>p.Value),
                Checkpoints=request.Checkpoints?.Where(p=>candidates.Contains(p.Key)).ToDictionary(p=>p.Key,p=>p.Value)};
            var advanced=request.UseOrganizationCalendars||internalRequest.StepCalendars?.Count>0||!string.IsNullOrWhiteSpace(request.TimeZoneId)||
                ScheduleWorkCalendar.IsNight(request.WorkdayStart,request.WorkdayEnd)||
                internalRequest.ProcessCalendars?.Values.Any(c=>!string.IsNullOrWhiteSpace(c.TimeZoneId)||ScheduleWorkCalendar.IsNight(c.WorkdayStart,c.WorkdayEnd))==true;
            var transformed=source with{Algorithm=routes.Values.Any(r=>r.Model.Nodes.Any(n=>n.WaitEvent is not null))?EventAlgorithm:advanced?CalendarAlgorithm:Algorithm,BaseAlgorithm=null,
                Processes=routes.Values.Select(r=>r.Model).ToArray(),Objects=objects};
            var result=await CalculateCoreAsync(internalRequest,false,transformed,ct);
            var passes=new List<SchedulePassDateModel>();
            foreach(var item in result.Processes)
            foreach(var step in item.Steps??[]){
                var info=routes[item.ProcessId].Nodes[step.ElementId];
                var original=originalNodes[item.ProcessId][info.OriginalId];
                var calendarSource=step.CalendarSource;
                var marker="Шаг: "+step.ElementId;
                if(calendarSource.StartsWith(marker+" ·",StringComparison.Ordinal)){
                    var label=request.StepCalendars?.GetValueOrDefault(item.ProcessId)?.ContainsKey(info.OriginalId)==true?"Шаг: "+info.OriginalId:
                        request.ProcessCalendars?.ContainsKey(item.ProcessId)==true?"Процесс: "+item.ProcessId:"Общий календарь";
                    calendarSource=label+calendarSource[marker.Length..];
                }
                passes.Add(new(item.ProcessId,info.OriginalId,original.Name,info.Occurrence,info.Path,step.StartAt,step.EndAt,calendarSource));
            }
            var transfers=IterationTransfers(conditioned,routes,request.IterationTransfers,passes);
            var issues=result.Issues.Select(i=>{
                var node=i.ElementId is not null&&i.ProcessId is not null&&routes.TryGetValue(i.ProcessId,out var r)&&r.Nodes.TryGetValue(i.ElementId,out var n)?n.OriginalId:i.ElementId;
                return i with{ElementId=node,ObjectId=i.ObjectId is not null?objectOrigins.GetValueOrDefault(i.ObjectId,i.ObjectId):null};
            }).ToList();
            var reasons=result.Processes.ToDictionary(p=>p.ProcessId,p=>p.UncertaintyReasons.ToHashSet(StringComparer.CurrentCultureIgnoreCase));
            foreach(var original in source.Processes.Where(p=>reasons.ContainsKey(p.Id))){
                if(original.Nodes.Any(n=>n.Type=="endEvent")&&!routes[original.Id].Model.Nodes.Any(n=>n.Type=="endEvent")){
                    reasons[original.Id].Add("Выбранный маршрут не достигает завершающего события исходной схемы.");
                    issues.Add(new("scenario-no-end","Warning","Конечное событие исходной схемы исключено выбранной ветвью.",original.Id));
                }
                if((request.ProcessBranches?.GetValueOrDefault(original.Id)?.Count>0||request.IterationPlans.ContainsKey(original.Id))&&
                    conditioned.Any(o=>o.Producers.Concat(o.Consumers).Any(v=>v.ProcessId==original.Id&&v.Scope!="Step"))){
                    reasons[original.Id].Add("Границы паспорта не привязаны к отдельным проходам.");
                    issues.Add(new("scenario-passport-boundary","Warning","Границы паспорта оставлены в сценарии без распределения по проходам.",original.Id));
                }
            }
            var order=TopologicalOrder(reasons.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase),result.Dependencies,out _);
            var summaries=source.Processes.ToDictionary(p=>p.Id,p=>new ProcessSummaryModel(p.Id,p.Name,p.Version,p.Owner,p.Status,p.Nodes.Count,p.Lanes.Count));
            PropagateUncertainty(order,result.Dependencies,request.Direction,reasons,summaries);
            return (result with{Issues=issues,Complete=result.Complete&&reasons.Values.All(r=>r.Count==0),
                Dependencies=result.Dependencies.Select(d=>d with{ObjectId=objectOrigins.GetValueOrDefault(d.ObjectId,d.ObjectId)})
                    .DistinctBy(d=>(d.SourceProcessId,d.TargetProcessId,d.ObjectId,d.Required)).ToArray(),
                Processes=result.Processes.Select(p=>p with{IsDateReliable=reasons[p.ProcessId].Count==0,UncertaintyReasons=reasons[p.ProcessId].Order(StringComparer.Ordinal).ToArray()}).ToArray()},
                new(passes,[],transfers,[]),routes);
        }
        var planResult=await Calculate(planned);
        var maxResult=await Calculate(maximum);
        var zero=request.IterationPlans.ToDictionary(p=>p.Key,p=>(IReadOnlyDictionary<string,int>)p.Value.ToDictionary(v=>v.ReturnEdgeId,_=>0));
        var baseHours=source.Processes.ToDictionary(p=>p.Id,p=>EstimateProcess(ScheduleIterationExpansion.Build(p,request.IterationPlans.GetValueOrDefault(p.Id)??[],
            request.ProcessBranches?.GetValueOrDefault(p.Id),zero.GetValueOrDefault(p.Id)).Model,request.IncludeWaitTime,new HashSet<string>(),null).Hours);
        var cases=new List<ScheduleAlternativeCaseModel>();
        var pending=new List<(Dictionary<string,IReadOnlyDictionary<string,int>> Counts,double Weight)>{(planned,1)};
        foreach(var distribution in distributions){
            if(!planResult.Result.Processes.Any(p=>p.ProcessId==distribution.Process)||
                !planResult.Routes[distribution.Process].ActiveReturns.Contains(distribution.Plan.ReturnEdgeId))continue;
            if((long)pending.Count*distribution.Plan.Distribution!.Count(w=>w.Probability>0)>64)
                throw new InvalidDataException("Распределение требует более 64 полных сценариев; усечение запрещено.");
            pending=pending.SelectMany(entry=>distribution.Plan.Distribution!.Where(w=>w.Probability>0).OrderBy(w=>w.Repeats).Select(w=>{
                var next=new Dictionary<string,IReadOnlyDictionary<string,int>>(entry.Counts);
                var values=new Dictionary<string,int>(next[distribution.Process]);values[distribution.Plan.ReturnEdgeId]=w.Repeats;next[distribution.Process]=values;
                return(next,entry.Weight*w.Probability);
            })).ToList();
        }
        if(distributions.Count>0)foreach(var entry in pending){
            var calculated=await Calculate(entry.Counts);
            cases.Add(new(cases.Count+1,entry.Weight,request.ProcessBranches??new Dictionary<string,IReadOnlyDictionary<string,string>>(),
                calculated.Result.StartAt,calculated.Result.EndAt,calculated.Result.CriticalDurationHours,calculated.Result.Complete,
                calculated.Result.Processes.Select(p=>p.ProcessId).ToArray(),entry.Counts));
        }
        var result=planResult.Result;
        var assumption=result.Assumptions with{ProcessBranches=request.ProcessBranches,ProcessRepetitions=request.ProcessRepetitions,
            ProcessCalendars=request.ProcessCalendars??new Dictionary<string,ScheduleCalendarModel>(),
            ProcessDurationScalePercent=request.ProcessDurationScalePercent??new Dictionary<string,double>(),
            Checkpoints=request.Checkpoints??new Dictionary<string,DateTimeOffset>(),
            StepCalendars=request.StepCalendars,Facts=request.Facts,ObjectRules=request.ObjectRules,BranchProbabilities=request.BranchProbabilities,
            IterationPlans=request.IterationPlans,IterationTransfers=request.IterationTransfers};
        var items=result.Processes.Select(p=>{
            var high=maxResult.Result.Processes.SingleOrDefault(m=>m.ProcessId==p.ProcessId)
                ??throw new InvalidDataException("Состав максимальной цепочки отличается от плановой.");
            return p with{BaseDurationHours=Math.Round(baseHours[p.ProcessId],2),MaximumDurationHours=high.DurationHours,
                MaximumStartAt=high.StartAt,MaximumEndAt=high.EndAt,Steps=null};
        }).ToArray();
        var messages=result.Issues.Concat([new ProcessScheduleIssueModel("iteration-assumption","Warning",
            "Числа проходов и распределения — допущения. Один набор чисел применяется при каждом входе во вложенный участок. Межпроцессный расчёт использует барьер полного завершения производителя, не потоковую оптимизацию; передачи по проходам не запускают экземпляры автоматически.")]).ToList();
        if(request.ObjectRules?.Count>0)messages.Add(new("object-rule-assumption","Warning","Булевы факты — допущения пользователя, не подтверждённые внешней системой."));
        if(distributions.Any(d=>!planResult.Result.Processes.Any(p=>p.ProcessId==d.Process)||
            !planResult.Routes[d.Process].ActiveReturns.Contains(d.Plan.ReturnEdgeId)))
            messages.Add(new("iteration-distribution-inactive","Warning","Распределение исключённого процесса или участка не участвует в вероятностной массе."));
        ScheduleAlternativeEnvelopeModel? envelope=cases.Count==0?null:new(cases,cases.Min(c=>c.StartAt),cases.Max(c=>c.StartAt),
            cases.Min(c=>c.EndAt),cases.Max(c=>c.EndAt),cases.Sum(c=>c.Probability*c.NominalHours),cases.Sum(c=>c.Probability),cases.All(c=>c.Complete));
        return result with{Sources=source with{Algorithm=IterationAlgorithm},Assumptions=assumption,Processes=items,Issues=messages,
            MaximumStartAt=maxResult.Result.StartAt,MaximumEndAt=maxResult.Result.EndAt,AlternativeEnvelope=envelope,
            IterationDetail=new(planResult.Detail.PlannedSteps,maxResult.Detail.PlannedSteps,planResult.Detail.Transfers,maxResult.Detail.Transfers)};
    }

    private static List<(InformationObjectOccurrenceModel Value,int Occurrence)> ExpandedOccurrences(InformationObjectOccurrenceModel original,
        IReadOnlyDictionary<string,ScheduleExpandedRoute> routes,
        IReadOnlyDictionary<(string Process,string Element),(string Clone,int Occurrence)[]> mapping)
    {
        if(original.Scope!="Step"||!routes.TryGetValue(original.ProcessId,out var route))return[(original,1)];
        return (mapping.GetValueOrDefault((original.ProcessId,original.ElementId??""))??[])
            .Select(p=>(original with{ElementId=p.Clone},p.Occurrence)).ToList();
    }
    private static IReadOnlyList<InformationObjectModel> ExpandIterationObjects(IReadOnlyList<InformationObjectModel> objects,
        IReadOnlyDictionary<string,ScheduleExpandedRoute> routes,IReadOnlyDictionary<string,string>? modes,out Dictionary<string,string> provenance)
    {
        provenance=new(StringComparer.Ordinal);
        var mapping=routes.SelectMany(r=>r.Value.Nodes.Select(n=>(Key:(r.Key,n.Value.OriginalId),Clone:n.Key,n.Value.Occurrence)))
            .GroupBy(p=>p.Key).ToDictionary(g=>g.Key,g=>g.OrderBy(p=>p.Occurrence).Select(p=>(p.Clone,p.Occurrence)).ToArray());
        var referencedParts=objects.SelectMany(o=>o.Components??[]).Select(c=>c.ObjectId).ToHashSet(StringComparer.Ordinal);
        var result=new List<InformationObjectModel>();var objectNumber=0;
        var prefix="_iteration_object_";while(objects.Any(o=>o.Id.StartsWith(prefix,StringComparison.Ordinal)))prefix="_"+prefix;
        foreach(var obj in objects){
            objectNumber++;
            var producers=obj.Producers.Select(o=>ExpandedOccurrences(o,routes,mapping)).ToArray();
            var consumers=obj.Consumers.Select(o=>ExpandedOccurrences(o,routes,mapping)).ToArray();
            var repeated=producers.Concat(consumers).Any(p=>p.Count>1);
            var external=obj.Producers.Any(p=>obj.Consumers.Any(c=>p.ProcessId!=c.ProcessId));
            var mode=modes?.GetValueOrDefault(obj.Id);
            if(repeated&&external&&mode is null)throw new InvalidDataException("Для повторяющейся межпроцессной передачи выберите Batch/PerPass: "+obj.Id);
            if(repeated&&mode=="PerPass"){
                if(obj.Components?.Count>0||referencedParts.Contains(obj.Id))
                    throw new InvalidDataException("PerPass пока не сопоставляет составные комплекты и их части; выберите Batch: "+obj.Id);
                var groups=producers.Concat(consumers).Where(p=>p.Count>0).ToArray();
                var count=groups.Select(p=>p.Count).Distinct().ToArray();
                if(count.Length!=1||producers.Any(p=>p.Count==0)||consumers.Any(p=>p.Count==0))
                    throw new InvalidDataException("PerPass требует одинаковое число достигаемых проходов источника и получателя: "+obj.Id);
                for(var i=0;i<count[0];i++){
                    var id=prefix+objectNumber+"_"+(i+1);provenance[id]=obj.Id;
                    result.Add(obj with{Id=id,
                    Producers=producers.Select(p=>p[i].Value).ToArray(),Consumers=consumers.Select(p=>p[i].Value).ToArray(),
                    References=[]});
                }
            }else{
                provenance[obj.Id]=obj.Id;
                result.Add(obj with{Producers=producers.Where(p=>p.Count>0).Select(p=>p[^1].Value).ToArray(),
                    Consumers=consumers.Where(p=>p.Count>0).Select(p=>p[0].Value).ToArray(),
                    References=obj.References.SelectMany(o=>ExpandedOccurrences(o,routes,mapping).Select(p=>p.Value)).ToArray()});
            }
            if(result.Count>10000)throw new InvalidDataException("Развёртка документов превышает 10 000 объектов.");
        }
        return result;
    }
    private static IReadOnlyList<SchedulePassTransferModel> IterationTransfers(IReadOnlyList<InformationObjectModel> objects,
        IReadOnlyDictionary<string,ScheduleExpandedRoute> routes,IReadOnlyDictionary<string,string>? modes,IReadOnlyList<SchedulePassDateModel> passes)
    {
        var result=new List<SchedulePassTransferModel>();
        var byStep=passes.GroupBy(p=>(p.ProcessId,p.ElementId)).ToDictionary(g=>g.Key,g=>g.OrderBy(p=>p.Occurrence).ToArray());
        foreach(var obj in objects)
        foreach(var producer in obj.Producers.Where(p=>p.Scope=="Step"))
        foreach(var consumer in obj.Consumers.Where(c=>c.Scope=="Step"&&c.ProcessId!=producer.ProcessId)){
            var from=byStep.GetValueOrDefault((producer.ProcessId,producer.ElementId??""))??[];
            var to=byStep.GetValueOrDefault((consumer.ProcessId,consumer.ElementId??""))??[];
            var mode=modes?.GetValueOrDefault(obj.Id)??"Batch";
            if(from.Length==0||to.Length==0)continue;
            foreach(var target in to){
                var source=mode=="PerPass"?from.Single(p=>p.Occurrence==target.Occurrence):from.MaxBy(p=>p.EndAt)!;
                result.Add(new(obj.Id,obj.Name,mode,producer.ProcessId,producer.ElementId!,source.Occurrence,
                    consumer.ProcessId,consumer.ElementId!,target.Occurrence,source.EndAt,target.StartAt));
                if(result.Count>10000)throw new InvalidDataException("Более 10 000 передач по проходам.");
            }
        }
        return result;
    }
}
