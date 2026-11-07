using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class ProcessScheduleService
{
    private static IReadOnlyList<Scheduled> ScheduleWithStepCalendars(IReadOnlyList<string> processOrder,
        IReadOnlyList<ProcessScheduleDependencyModel> dependencies, IReadOnlyDictionary<string, Estimate> estimates,
        ProcessScheduleRequestModel request, IReadOnlyDictionary<string, ScheduleRouteResult> routes,
        IReadOnlyDictionary<string, ScheduleCalendarModel> profiles, OrganizationMapModel? organization,
        Dictionary<string, IReadOnlyList<ScheduleStepDateModel>> stepDates)
    {
        var common = new ScheduleCalendarModel(request.WorkdayStart, request.WorkdayEnd, request.WorkingDays ?? [1,2,3,4,5],
            request.NonWorkingDates ?? [], request.UtcOffsetMinutes ?? (int)request.AnchorDate.Offset.TotalMinutes, request.TimeZoneId);
        var result = new Dictionary<string, Scheduled>(StringComparer.OrdinalIgnoreCase);
        var forward = request.Direction.Equals("Forward", StringComparison.OrdinalIgnoreCase);
        foreach (var id in forward ? processOrder : processOrder.Reverse())
        {
            if (!routes.TryGetValue(id, out var route)) throw new InvalidDataException("Для календарного расчёта нужны все модели цепочки.");
            if (estimates[id].HasCycle || request.ProcessRepetitions?.GetValueOrDefault(id)?.MaximumRepeats > 0)
                throw new InvalidDataException("Календари шагов пока требуют ациклический маршрут без дополнительных проходов. Повторы остаются отдельным сценарием пункта 61.");
            var process = route.Model;
            if(process.Nodes.Count==0)throw new InvalidDataException("Нет элементов для календарного расчёта.");
            var nodes=process.Nodes.ToDictionary(n=>n.Id,StringComparer.OrdinalIgnoreCase);
            var incoming=process.Edges.ToLookup(e=>e.TargetId,StringComparer.OrdinalIgnoreCase);
            var outgoing=process.Edges.ToLookup(e=>e.SourceId,StringComparer.OrdinalIgnoreCase);
            var maps = organization?.CrossCompanyProcesses.FirstOrDefault(p=>p.ProcessId.Equals(id,StringComparison.OrdinalIgnoreCase))?.LaneOrganizations ?? [];
            (ScheduleCalendarModel Calendar, string Source) Resolve(string? lane, string? element = null)
            {
                if (element is not null && request.StepCalendars?.GetValueOrDefault(id)?.TryGetValue(element, out var manual) == true)
                    return (manual, "Шаг: " + element);
                if (profiles.TryGetValue(id, out var custom)) return (custom, "Процесс: " + id);
                var matches = maps.Where(m=>m.LaneId==lane).ToArray();
                if (matches.Length > 1) throw new InvalidDataException("Неоднозначная оргпривязка календаря дорожки.");
                var mapping = matches.SingleOrDefault();
                var entityId = mapping?.LegalEntityId ?? (lane is null ? process.OwnerLegalEntityId : null);
                var unitId = mapping?.UnitId ?? (lane is null ? process.OwnerUnitId : null);
                var entity = organization?.LegalEntities.SingleOrDefault(e=>e.Id.Equals(entityId,StringComparison.OrdinalIgnoreCase));
                if (mapping is not null && entity is null) throw new InvalidDataException("Неизвестная организация календаря дорожки.");
                if (entity is not null)
                {
                    var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    while (unitId is not null)
                    {
                        if (!visited.Add(unitId)) throw new InvalidDataException("Цикл наследования календаря подразделения.");
                        var unit = entity.Units?.SingleOrDefault(u=>u.Id.Equals(unitId,StringComparison.OrdinalIgnoreCase));
                        if (unit is null) throw new InvalidDataException("Неизвестное подразделение календаря: " + unitId);
                        if (unit.Calendar is not null) return (unit.Calendar, entity.Name + " / " + unit.Name);
                        unitId = unit.ParentId;
                    }
                    if (entity.Calendar is not null) return (entity.Calendar, entity.Name);
                }
                return (common, "Общий календарь");
            }
            var receivingCalendar = new ScheduleWorkCalendar(Resolve(null).Calendar);
            var anchors = forward
                ? dependencies.Where(d=>d.TargetProcessId.Equals(id,StringComparison.OrdinalIgnoreCase)).Select(d=>
                    receivingCalendar.Add(result[d.SourceProcessId].EndAt,request.TransferDelayHours))
                : dependencies.Where(d=>d.SourceProcessId.Equals(id,StringComparison.OrdinalIgnoreCase)).Select(d=>
                {
                    var targetModel = routes[d.TargetProcessId].Model;
                    // Transfer delay is in the receiving process owner's calendar,
                    // not in the sender's step calendar.
                    var targetProfile = profiles.GetValueOrDefault(d.TargetProcessId) ?? common;
                    var targetEntity = organization?.LegalEntities.FirstOrDefault(e=>e.Id.Equals(targetModel.OwnerLegalEntityId,StringComparison.OrdinalIgnoreCase));
                    var targetUnitId = targetModel.OwnerUnitId;
                    var visited = new HashSet<string>();
                    while (!profiles.ContainsKey(d.TargetProcessId) && targetEntity is not null && targetUnitId is not null)
                    {
                        if (!visited.Add(targetUnitId)) throw new InvalidDataException("Цикл календаря получателя.");
                        var unit = targetEntity.Units?.FirstOrDefault(u=>u.Id.Equals(targetUnitId,StringComparison.OrdinalIgnoreCase));
                        if (unit is null) throw new InvalidDataException("Неизвестное подразделение получателя.");
                        if (unit.Calendar is not null) {targetProfile=unit.Calendar;break;}
                        targetUnitId=unit.ParentId;
                    }
                    if (!profiles.ContainsKey(d.TargetProcessId) && targetUnitId is null && targetEntity?.Calendar is not null) targetProfile=targetEntity.Calendar;
                    return new ScheduleWorkCalendar(targetProfile).Add(result[d.TargetProcessId].StartAt,request.TransferDelayHours,false);
                });
            var values = anchors.ToArray();
            var anchor = values.Length==0 ? request.AnchorDate : forward ? values.Max() : values.Min();
            var ids = process.Nodes.Select(n=>n.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var order = TopologicalNodeOrder(ids, process.Edges, out var cycle);
            if (cycle) throw new InvalidDataException("Маршрут календарного расчёта содержит цикл.");
            var dates = new Dictionary<string, ScheduleStepDateModel>(StringComparer.OrdinalIgnoreCase);
            foreach (var nodeId in forward ? order : order.Reverse())
            {
                var node = nodes[nodeId];
                var peers = (forward ? incoming[nodeId] : outgoing[nodeId])
                    .Select(e=>dates[forward ? e.SourceId : e.TargetId]).ToArray();
                var at = peers.Length==0 ? anchor : forward ? peers.Max(p=>p.EndAt) : peers.Min(p=>p.StartAt);
                var resolved = Resolve(node.LaneId,nodeId);
                var engine = new ScheduleWorkCalendar(resolved.Calendar);
                var work = ParseHours(node.WorkDuration).GetValueOrDefault();
                var wait = request.IncludeWaitTime ? ParseHours(node.WaitDuration).GetValueOrDefault() : 0;
                var hours = node.Type=="task" ? ((work+wait)>0 ? work+wait : ParseHours(node.Duration).GetValueOrDefault()) * estimates[id].AppliedScalePercent/100 : 0;
                if(node.WaitEvent is not null){
                    var minutes=WaitEvents.Minutes(node)??0;
                    dates[nodeId]=new(nodeId,"Календарное ожидание · "+node.WaitEvent.Kind,forward?at:at.AddMinutes(-minutes),forward?at.AddMinutes(minutes):at);
                    continue;
                }
                var boundary = hours>0 ? engine.Normalize(at,forward) : at;
                var other = hours>0 ? engine.Add(boundary,hours,forward) : boundary;
                dates[nodeId] = new(nodeId,resolved.Source+" · "+resolved.Calendar.WorkdayStart+"–"+resolved.Calendar.WorkdayEnd+" · "+(resolved.Calendar.TimeZoneId??"UTC "+resolved.Calendar.UtcOffsetMinutes+" мин"),forward ? boundary : other,forward ? other : boundary);
            }
            var tasks = dates.Values.Where(d=>nodes[d.ElementId].Type=="task").ToArray();
            stepDates[id] = tasks.OrderBy(d=>d.StartAt).ToArray();
            var bounds = tasks.Length>0 ? tasks : dates.Values.ToArray();
            result[id] = new(id,bounds.Min(d=>d.StartAt),bounds.Max(d=>d.EndAt));
        }
        return processOrder.Select(id=>result[id]).ToArray();
    }
}
