using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed record DepartmentHeatmapRow(string EntityId, string UnitId, string Name, string ShortName,
    string LegalEntityName, int ProcessCount, int OwnedProcessCount, int TaskCount, int IncomingTransferCount,
    int OutgoingTransferCount, int? OverdueCount, int ObservedInstanceCount, IReadOnlyList<string> ProcessIds,
    IReadOnlyList<string> OwnedProcessIds);
public sealed record OrganizationHeatmapReport(DateTimeOffset GeneratedAt, int ProcessCount, int UnmappedTaskCount,
    int UnmappedOwnershipCount, int UnmappedTransferCount, int OrphanExecutionStepCount,
    IReadOnlyList<string> Warnings, IReadOnlyList<DepartmentHeatmapRow> Rows, IReadOnlyList<DepartmentHeatmapProcess> Processes);
public sealed record DepartmentHeatmapProcess(string Id,string Name);

public sealed class OrganizationHeatmapService(ProcessCatalogService catalog, OrganizationMapService organization,
    ProcessExecutionService executions)
{
    public async Task<OrganizationHeatmapReport> BuildAsync(CancellationToken cancellationToken)
    {
        var map = await organization.LoadAsync(cancellationToken);
        var models = new List<ProcessModel>();
        var facts = new Dictionary<string,ProcessAnalyticsModel>(StringComparer.OrdinalIgnoreCase);
        foreach (var summary in await catalog.ListAsync(cancellationToken))
        {
            var model = await catalog.LoadAsync(summary.Id, summary.Status.Equals("Draft",StringComparison.OrdinalIgnoreCase), cancellationToken);
            models.Add(model); facts.Add(model.Id, await executions.AnalyticsAsync(model,cancellationToken));
        }
        return Build(map,models,facts,cancellationToken);
    }

    private sealed class Counts
    {
        public HashSet<string> Processes { get; } = new(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> Owners { get; } = new(StringComparer.OrdinalIgnoreCase);
        public int Tasks, Incoming, Outgoing, Overdue, Instances;
    }
    public static OrganizationHeatmapReport Build(OrganizationMapModel map, IReadOnlyList<ProcessModel> models,
        IReadOnlyDictionary<string,ProcessAnalyticsModel> facts, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        static string Key(string entity,string unit) => entity + ":" + unit;
        var counts = new Dictionary<string,Counts>(StringComparer.OrdinalIgnoreCase);
        foreach(var entity in map.LegalEntities) foreach(var unit in entity.Units ?? []) counts.Add(Key(entity.Id,unit.Id),new());
        var unmappedTasks=0;var unmappedOwners=0;var unmappedTransfers=0;var orphanFacts=0;
        var warnings=new List<string>();
        var links=map.CrossCompanyProcesses.GroupBy(p=>p.ProcessId,StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g=>g.Key,g=>g.SelectMany(p=>p.LaneOrganizations).ToArray(),StringComparer.OrdinalIgnoreCase);
        foreach(var model in models)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var actualLanes=model.Lanes.Select(l=>l.Id).ToHashSet(StringComparer.Ordinal);
            var lanes=new Dictionary<string,string>(StringComparer.Ordinal);
            foreach(var group in links.GetValueOrDefault(model.Id,[]).Where(l=>actualLanes.Contains(l.LaneId)).GroupBy(l=>l.LaneId,StringComparer.Ordinal))
            {
                var keys=group.Select(l=>string.IsNullOrWhiteSpace(l.UnitId)?"":Key(l.LegalEntityId,l.UnitId)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                if(keys.Length==1 && counts.ContainsKey(keys[0])) lanes.Add(group.Key,keys[0]);
                else warnings.Add($"{model.Id}/{group.Key}: неоднозначная или отсутствующая привязка подразделения; показатели не распределены наугад.");
            }
            foreach(var key in lanes.Values.Distinct(StringComparer.OrdinalIgnoreCase)) counts[key].Processes.Add(model.Id);
            var ownerKey=Key(model.OwnerLegalEntityId??"",model.OwnerUnitId??"");
            if(counts.TryGetValue(ownerKey,out var owner)) owner.Owners.Add(model.Id);else unmappedOwners++;
            var nodes=model.Nodes.ToDictionary(n=>n.Id,StringComparer.Ordinal);
            var participatingTaskUnits=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach(var task in model.Nodes.Where(n=>n.Type=="task"))
            {
                if(lanes.TryGetValue(task.LaneId,out var key)) {counts[key].Tasks++;participatingTaskUnits.Add(key);}else unmappedTasks++;
            }
            if(facts.TryGetValue(model.Id,out var fact))
            {
                foreach(var key in participatingTaskUnits) counts[key].Instances+=fact.TotalInstances;
                foreach(var step in fact.Steps.Where(_=>fact.TotalInstances>0))
                {
                    if(!nodes.TryGetValue(step.ElementId,out var node)||node.Type!="task"||!lanes.TryGetValue(node.LaneId,out var key)) {orphanFacts++;continue;}
                    counts[key].Overdue+=step.OverdueCount;
                }
            }
            var routes=TransferRoutes.Find(model,cancellationToken);
            if(routes.Limited) warnings.Add($"{model.Id}: число передач неполное — достигнут предел обхода шлюзов.");
            foreach(var route in routes.Routes)
            {
                if(route.Source.LaneId==route.Target.LaneId)continue;
                if(!lanes.TryGetValue(route.Source.LaneId,out var source)||!lanes.TryGetValue(route.Target.LaneId,out var target)) {unmappedTransfers++;continue;}
                if(source.Equals(target,StringComparison.OrdinalIgnoreCase))continue;
                counts[source].Outgoing++;counts[target].Incoming++;
            }
        }
        var rows=map.LegalEntities.SelectMany(entity=>(entity.Units??[]).Select(unit=>
        {
            var c=counts[Key(entity.Id,unit.Id)];
            return new DepartmentHeatmapRow(entity.Id,unit.Id,unit.Name,unit.ShortName,entity.Name,c.Processes.Count,c.Owners.Count,c.Tasks,c.Incoming,c.Outgoing,
                c.Instances==0?null:c.Overdue,c.Instances,c.Processes.Order().ToArray(),c.Owners.Order().ToArray());
        })).OrderBy(r=>r.LegalEntityName).ThenBy(r=>r.Name).ToArray();
        return new(DateTimeOffset.UtcNow,models.Count,unmappedTasks,unmappedOwners,unmappedTransfers,orphanFacts,warnings,rows,models.Select(m=>new DepartmentHeatmapProcess(m.Id,m.Name)).ToArray());
    }
}
