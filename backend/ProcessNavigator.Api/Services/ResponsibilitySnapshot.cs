using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public static class ResponsibilitySnapshot
{
    public static ProcessResponsibilitySnapshotModel Create(ProcessModel process, OrganizationMapModel organization, ProcessAssignmentsModel assignments)
    {
        if (process.Nodes.Count>5000 || process.Edges.Count>10000 || process.Lanes.Count>2000 || assignments.ProcessId!=process.Id)
            throw new InvalidDataException("Снимок ответственности ограничен 5000 элементами / 10000 стрелками / 2000 дорожками; назначения должны соответствовать процессу.");
        var links=organization.CrossCompanyProcesses.Where(p=>p.ProcessId==process.Id).ToArray();
        var ids=links.SelectMany(p=>p.LegalEntityIds).Append(process.OwnerLegalEntityId).ToHashSet();
        var subset=organization with {Description="",LegalEntities=organization.LegalEntities.Where(e=>ids.Contains(e.Id))
            .Select(e=>e with{Description="",Directions=[],Calendar=null,Units=e.Units?.Select(u=>u with{Calendar=null}).ToArray()}).ToArray(),CrossCompanyProcesses=links};
        var assigned=assignments.Lanes.SelectMany(l=>l.UserIds).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var people=assignments.Users.Where(p=>assigned.Contains(p.Id)).Select(p=>new ResponsibilityPersonModel(p.Id,p.DisplayName,p.IsActive)).ToArray();
        var lanes=assignments.Lanes.Select(l=>l with{UserIds=l.UserIds.Select(id=>people.FirstOrDefault(p=>p.Id.Equals(id,StringComparison.OrdinalIgnoreCase))?.Id??id).ToArray()}).ToArray();
        var compact=process with{Passport=null,Edges=process.Edges.Select(e=>e with{Points=[]}).ToArray(),
            Nodes=process.Nodes.Select(n=>new NodeModel(n.Id,n.Type,n.Name,n.LaneId,n.X,n.Y,n.Width,n.Height,null,n.Responsible,null,null,null,
                SystemName:n.SystemName,InformationObjects:n.InformationObjects,BpmnType:n.BpmnType,ExecutorKind:n.ExecutorKind,EndEventDefinitions:n.EndEventDefinitions)).ToArray()};
        var value=new ProcessResponsibilitySnapshotModel(compact,subset,lanes,people,DateTimeOffset.UtcNow);
        // No live references or historical permissions: names/IDs are evidence,
        // never an authorization source.
        return JsonSerializer.Deserialize<ProcessResponsibilitySnapshotModel>(JsonSerializer.Serialize(value))!;
    }
    public static string Describe(ProcessResponsibilitySnapshotModel value,string elementId)
    {
        var node=value.Process.Nodes.Single(n=>n.Id==elementId);
        var link=value.Organization.CrossCompanyProcesses.SingleOrDefault(p=>p.ProcessId==value.Process.Id)?.LaneOrganizations.SingleOrDefault(l=>l.LaneId==node.LaneId);
        var entity=value.Organization.LegalEntities.SingleOrDefault(e=>e.Id==link?.LegalEntityId);
        var unit=entity?.Units?.SingleOrDefault(u=>u.Id==link?.UnitId);
        var people=value.Lanes.SingleOrDefault(l=>l.LaneId==node.LaneId)?.UserIds.Select(id=>value.People.SingleOrDefault(p=>p.Id==id)?.Name??id)??[];
        return (entity?.Name??"Организация не уточнена")+" / "+(unit?.Name??node.LaneId)+" / "+string.Join("; ",people);
    }
    public static string DescribeExecution(ProcessInstanceModel instance,StepExecutionModel step)
    {
        var snapshot=instance.Responsibility!;
        var assignedName=(instance.AssignmentEvents??[]).LastOrDefault(e=>e.ElementId==step.ElementId&&e.ToUserId==step.AssignedUserId)?.ToUserName
            ?? snapshot.People.FirstOrDefault(p=>p.Id==step.AssignedUserId)?.Name ?? step.AssignedUserId ?? "не уточнён";
        return Describe(snapshot,step.ElementId)+" · персонально назначен: "+assignedName+" · завершил: "+(step.UserId??"ещё не завершено");
    }
    public static void Validate(ProcessInstanceModel instance)
    {
        var snapshot=instance.Responsibility;
        if(snapshot is not null && (snapshot.Process is null || snapshot.Organization is null || snapshot.Lanes is null || snapshot.People is null ||
            snapshot.Process.Id!=instance.ProcessId || snapshot.Process.Version!=instance.ProcessVersion || snapshot.CapturedAt!=instance.StartedAt ||
            snapshot.Process.Nodes is null || snapshot.Process.Edges is null || snapshot.Process.Lanes is null ||
            snapshot.Process.Nodes.Count>5000 || snapshot.Process.Edges.Count>10000 || snapshot.Process.Lanes.Count>2000 ||
            snapshot.Process.Nodes.Select(n=>n.Id).Distinct().Count()!=snapshot.Process.Nodes.Count ||
            !snapshot.Process.Nodes.Where(n=>n.Type=="task").Select(n=>n.Id).ToHashSet().SetEquals(instance.Steps.Select(s=>s.ElementId)) ||
            snapshot.Organization.LegalEntities is null || snapshot.Organization.CrossCompanyProcesses is null ||
            snapshot.Organization.LegalEntities.Count>50 || snapshot.People.Count>10000 ||
            snapshot.People.Select(p=>p.Id).Distinct().Count()!=snapshot.People.Count))
            throw new InvalidDataException("Повреждён снимок ответственности выполнения.");
        if(instance.Receipts is { } receipts && (snapshot is null || receipts.Count>1000 || receipts.Any(r=>r is null ||
            string.IsNullOrWhiteSpace(r.Id)||string.IsNullOrWhiteSpace(r.AcceptedBy)||string.IsNullOrWhiteSpace(r.Reason)||r.Reason.Length>500 ||
            string.IsNullOrWhiteSpace(r.Version)||r.Version.Length>100 || r.AcceptedAt<instance.StartedAt ||
            !instance.Steps.Any(s=>s.ElementId==r.TargetElementId) || r.SourceIteration<1||r.TargetIteration<1) ||
            receipts.Select(r=>r.Id).Distinct().Count()!=receipts.Count ||
            receipts.Select(r=>(r.SourceProcessId,r.SourceInstanceId,r.SourceElementId,r.SourceIteration,r.TargetElementId,r.TargetIteration,r.ObjectId)).Distinct().Count()!=receipts.Count))
            throw new InvalidDataException("Повреждён журнал приёмки.");
    }
}
