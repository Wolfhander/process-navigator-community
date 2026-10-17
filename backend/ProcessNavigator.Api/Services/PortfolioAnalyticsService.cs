using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class PortfolioAnalyticsService(
    ProcessCatalogService catalog,
    OrganizationMapService organization,
    ProcessExecutionService executions,
    InformationObjectRegistryService informationObjects)
{
    public async Task<PortfolioAnalyticsModel> BuildAsync(CancellationToken cancellationToken = default)
    {
        var summaries = await catalog.ListAsync(cancellationToken);
        var map = await organization.LoadAsync(cancellationToken);
        var registry = await informationObjects.BuildAsync(true, cancellationToken);
        var informationObjectsByProcess = registry.Objects
            .SelectMany(item => item.Producers.Concat(item.Consumers).Concat(item.References)
                .Select(occurrence => new { occurrence.ProcessId, Object = item }))
            .GroupBy(item => item.ProcessId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Select(item => item.Object.Id).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(), StringComparer.OrdinalIgnoreCase);
        var registryIssuesByObject = registry.Issues.GroupBy(item => item.ObjectId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);
        var entityById = map.LegalEntities.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        var organizationByProcess = map.CrossCompanyProcesses.ToDictionary(item => item.ProcessId, StringComparer.OrdinalIgnoreCase);
        var directionsByProcess = map.LegalEntities
            .SelectMany(entity => entity.Directions.SelectMany(direction => direction.ProcessIds.Select(processId =>
                new { ProcessId = processId, Direction = direction.Name, DirectionId = $"{entity.Id}:{direction.Id}", Entity = entity.Name })))
            .GroupBy(item => item.ProcessId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.OrdinalIgnoreCase);

        var snapshots = await Task.WhenAll(summaries.Select(async summary =>
        {
            var process = await catalog.LoadAsync(summary.Id, summary.Status.Equals("Draft", StringComparison.OrdinalIgnoreCase), cancellationToken);
            var execution = await executions.AnalyticsAsync(process, cancellationToken);
            organizationByProcess.TryGetValue(summary.Id, out var processOrganization);
            directionsByProcess.TryGetValue(summary.Id, out var processDirections);
            processDirections ??= [];

            var mappedLaneIds = processOrganization?.LaneOrganizations.Select(item => item.LaneId)
                .ToHashSet(StringComparer.Ordinal) ?? [];
            var mappedLaneCount = process.Lanes.Count(lane => mappedLaneIds.Contains(lane.Id));
            var tasks = process.Nodes.Where(node => node.Type == "task").ToArray();
            var describedTasks = tasks.Count(node => !string.IsNullOrWhiteSpace(node.Description)
                && (node.Inputs?.Count ?? 0) > 0
                && !string.IsNullOrWhiteSpace(node.ExpectedResult)
                && !string.IsNullOrWhiteSpace(node.CompletionCriteria)
                && !string.IsNullOrWhiteSpace(node.ExecutionMode)
                && (node.ExecutionMode != "system" || !string.IsNullOrWhiteSpace(node.SystemName)));
            var timedTasks = tasks.Count(node => !string.IsNullOrWhiteSpace(node.Duration));
            var systemTasks = tasks.Where(node => node.ExecutionMode == "system" || !string.IsNullOrWhiteSpace(node.SystemName)).ToArray();
            var systems = (process.Passport?.Systems ?? []).Concat(systemTasks.Select(node => node.SystemName ?? string.Empty))
                .Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.CurrentCultureIgnoreCase).OrderBy(value => value).ToArray();
            var systemTaskCounts = systemTasks.Where(node => !string.IsNullOrWhiteSpace(node.SystemName))
                .GroupBy(node => node.SystemName!, StringComparer.CurrentCultureIgnoreCase)
                .ToDictionary(group => group.Key, group => group.Count(), StringComparer.CurrentCultureIgnoreCase);
            var manualTasks = tasks.Count(node => node.ExecutionMode == "manual" || string.IsNullOrWhiteSpace(node.ExecutionMode));
            var externalTasks = tasks.Count(node => node.ExecutionMode == "external");
            var nodesById = process.Nodes.ToDictionary(node => node.Id, StringComparer.Ordinal);
            var crossLaneTransferCount = process.Edges.Count(edge => nodesById.TryGetValue(edge.SourceId, out var source)
                && nodesById.TryGetValue(edge.TargetId, out var target)
                && !string.Equals(source.LaneId, target.LaneId, StringComparison.Ordinal));
            informationObjectsByProcess.TryGetValue(summary.Id, out var processObjectIds);
            processObjectIds ??= [];
            var informationIssueCount = processObjectIds.Sum(id => registryIssuesByObject.GetValueOrDefault(id));
            var ownerAssigned = !string.IsNullOrWhiteSpace(process.Owner)
                && !process.Owner.Equals("Не назначен", StringComparison.OrdinalIgnoreCase);
            var legalEntityNames = processOrganization?.LegalEntityIds
                .Select(id => entityById.GetValueOrDefault(id)?.Name ?? id).Distinct().ToArray() ?? [];

            var readiness = 0d;
            if (ownerAssigned) readiness += 20;
            readiness += process.Lanes.Count == 0 ? 0 : 35d * mappedLaneCount / process.Lanes.Count;
            readiness += tasks.Length == 0 ? 0 : 25d * describedTasks / tasks.Length;
            readiness += tasks.Length == 0 ? 0 : 10d * timedTasks / tasks.Length;
            if (processDirections.Length > 0) readiness += 10;

            var issues = new List<string>();
            if (!ownerAssigned) issues.Add("Не назначено подразделение-владелец");
            if (mappedLaneCount < process.Lanes.Count) issues.Add($"Не привязано дорожек: {process.Lanes.Count - mappedLaneCount}");
            if (describedTasks < tasks.Length) issues.Add($"Неполностью описано задач: {tasks.Length - describedTasks}");
            if (processDirections.Length == 0) issues.Add("Не назначено направление");
            if (timedTasks < tasks.Length) issues.Add($"Не задан норматив задач: {tasks.Length - timedTasks}");
            if (systems.Length == 0) issues.Add("Не указаны системы и каналы выполнения");
            if (informationIssueCount > 0) issues.Add($"Разрывов информационных объектов: {informationIssueCount}");
            if (execution.Steps.Sum(step => step.OverdueCount) > 0) issues.Add("Есть просроченные шаги");

            var model = new PortfolioProcessModel(summary.Id, summary.Name, summary.Status, process.Owner,
                legalEntityNames, processDirections.Select(item => item.Direction).Distinct().ToArray(),
                process.Lanes.Count, mappedLaneCount, tasks.Length, describedTasks, timedTasks,
                systemTasks.Length, manualTasks, externalTasks, processObjectIds.Length, informationIssueCount,
                crossLaneTransferCount,
                process.Passport?.Level ?? 2, 0, systems,
                execution.TotalInstances, execution.ActiveInstances, execution.AverageCycleMinutes,
                execution.Steps.Sum(step => step.OverdueCount), Math.Round(readiness, 1), issues);
            return (Model: model, ParentProcessId: process.Passport?.ParentProcessId, SystemTaskCounts: systemTaskCounts);
        }));

        var childCounts = snapshots.Where(item => !string.IsNullOrWhiteSpace(item.ParentProcessId))
            .GroupBy(item => item.ParentProcessId!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);
        var processResults = snapshots.Select(item => item.Model with { ChildProcessCount = childCounts.GetValueOrDefault(item.Model.Id) }).ToArray();
        var systemStats = snapshots.SelectMany(item => item.Model.Systems.Select(system => new
            {
                Name = system,
                ProcessId = item.Model.Id,
                TaskCount = item.SystemTaskCounts.GetValueOrDefault(system)
            }))
            .GroupBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(group => new PortfolioSystemModel(group.Key, group.Select(item => item.ProcessId).Distinct(StringComparer.OrdinalIgnoreCase).Count(), group.Sum(item => item.TaskCount)))
            .OrderByDescending(item => item.ProcessCount).ThenByDescending(item => item.TaskCount).ThenBy(item => item.Name).ToArray();
        var levelStats = processResults.GroupBy(item => item.Level).OrderBy(group => group.Key)
            .Select(group => new PortfolioLevelModel(group.Key, group.Count())).ToArray();

        var processIds = summaries.Select(item => item.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var directionStats = map.LegalEntities.SelectMany(entity => entity.Directions.Select(direction =>
            new PortfolioDirectionModel($"{entity.Id}:{direction.Id}", direction.Name, entity.Name,
                direction.ProcessIds.Count(processIds.Contains))))
            .Where(item => item.ProcessCount > 0)
            .OrderByDescending(item => item.ProcessCount).ThenBy(item => item.Name).ToArray();

        var departmentCounts = map.CrossCompanyProcesses
            .Where(item => processIds.Contains(item.ProcessId))
            .SelectMany(item => item.LaneOrganizations.Where(lane => !string.IsNullOrWhiteSpace(lane.UnitId))
                .Select(lane => new { item.ProcessId, lane.LegalEntityId, UnitId = lane.UnitId! }))
            .GroupBy(item => $"{item.LegalEntityId}:{item.UnitId}", StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Select(item => item.ProcessId).Distinct(StringComparer.OrdinalIgnoreCase).Count(), StringComparer.OrdinalIgnoreCase);
        var departments = map.LegalEntities.SelectMany(entity => (entity.Units ?? []).Select(unit =>
            new PortfolioDepartmentModel(unit.Id, unit.Name, unit.ShortName, entity.Name,
                departmentCounts.GetValueOrDefault($"{entity.Id}:{unit.Id}"))))
            .Where(item => item.ProcessCount > 0)
            .OrderByDescending(item => item.ProcessCount).ThenBy(item => item.Name).ToArray();

        return new PortfolioAnalyticsModel(
            processResults.Length,
            processResults.Count(item => !item.Status.Equals("Draft", StringComparison.OrdinalIgnoreCase)),
            processResults.Count(item => item.Status.Equals("Draft", StringComparison.OrdinalIgnoreCase)),
            processResults.Count(item => !item.Issues.Contains("Не назначено подразделение-владелец")),
            processResults.Count(item => item.MappedLaneCount > 0),
            map.LegalEntities.Sum(entity => entity.Units?.Count ?? 0),
            departments.Length,
            processResults.Sum(item => item.TotalInstances),
            processResults.Sum(item => item.ActiveInstances),
            processResults.Sum(item => item.TotalInstances - item.ActiveInstances),
            processResults.Sum(item => item.OverdueSteps),
            processResults.Length == 0 ? 0 : Math.Round(processResults.Average(item => item.ReadinessPercent), 1),
            processResults.Count(item => item.TaskCount > 0 && item.TimedTaskCount == item.TaskCount),
            processResults.Count(item => item.Systems.Count > 0),
            processResults.Count(item => item.ChildProcessCount > 0),
            registry.ObjectCount,
            registry.Issues.Count,
            processResults.Sum(item => item.CrossLaneTransferCount),
            directionStats, departments, systemStats, levelStats,
            processResults.OrderBy(item => item.ReadinessPercent).ThenBy(item => item.Name).ToArray());
    }
}
