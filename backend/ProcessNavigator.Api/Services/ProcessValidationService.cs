using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class ProcessValidationService(ProcessCatalogService catalog, OrganizationMapService organizations)
{
    public async Task<ProcessValidationReportModel> ValidateDraftAsync(string processId, CancellationToken cancellationToken = default)
    {
        var process = await catalog.LoadAsync(processId, draft: true, cancellationToken);
        var organization = await organizations.LoadAsync(cancellationToken);
        var catalogItems = await catalog.ListAsync(cancellationToken);
        return await ValidateModelAsync(process, organization, catalogItems, cancellationToken);
    }

    public async Task<ProcessValidationReportModel> ValidateModelAsync(ProcessModel process, OrganizationMapModel organization,
        IReadOnlyList<ProcessSummaryModel> catalogItems, CancellationToken cancellationToken = default)
    {
        var processId = process.Id;
        var processIds = catalogItems.Select(item => item.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var issues = new List<ProcessValidationIssueModel>();

        void Error(string code, string message, string? id = null, string? name = null) =>
            issues.Add(new(code, "Error", message, id, name, Category(code)));
        void Warning(string code, string message, string? id = null, string? name = null) =>
            issues.Add(new(code, "Warning", message, id, name, Category(code)));

        var sourceNodeIds = process.Nodes.Select(node => node.Id).ToHashSet(StringComparer.Ordinal);
        var sourceRoutes = process.Edges.Where(edge => sourceNodeIds.Contains(edge.SourceId) && sourceNodeIds.Contains(edge.TargetId))
            .GroupBy(edge => edge.SourceId).ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.Ordinal);
        foreach (var requirement in process.Passport?.SourceRequirements ?? [])
        {
            var ids = requirement.ElementIds ?? [];
            if (ids.Count == 0) Warning("process-source-unmapped", $"Пункт исходного описания не сопоставлен со схемой: {requirement.Text}");
            foreach (var id in ids.Where(id => !process.Nodes.Any(node => node.Id == id)))
                Warning("process-source-stale", $"Пункт исходного описания «{requirement.Text}» ссылается на отсутствующий элемент {id}.");
            if (requirement.CheckSequence)
            {
                if (ids.Count < 2) Warning("process-source-route", $"Для пункта «{requirement.Text}» недостаточно элементов для проверки маршрута.");
                for (var index = 1; index < ids.Count; index++)
                    if (sourceNodeIds.Contains(ids[index - 1]) && sourceNodeIds.Contains(ids[index]) && !Traverse([ids[index - 1]], sourceRoutes, edge => edge.TargetId).Contains(ids[index]))
                        Warning("process-source-route", $"Пункт «{requirement.Text}»: нет направленного маршрута от {ids[index - 1]} к {ids[index]}. Проверка не оценивает условия переходов и фактический порядок исполнения.", ids[index - 1]);
            }
        }

        var starts = process.Nodes.Where(node => node.Type == "startEvent").ToArray();
        var ends = process.Nodes.Where(node => node.Type == "endEvent").ToArray();
        if (starts.Length == 0) Error("missing-start", "В процессе отсутствует начальное событие.");
        if (ends.Length == 0) Error("missing-end", "В процессе отсутствует завершающее событие.");

        var outgoing = process.Edges.GroupBy(edge => edge.SourceId).ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.Ordinal);
        var incoming = process.Edges.GroupBy(edge => edge.TargetId).ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.Ordinal);
        var reachableFromStart = Traverse(starts.Select(node => node.Id), outgoing, edge => edge.TargetId);
        var canReachEnd = Traverse(ends.Select(node => node.Id), incoming, edge => edge.SourceId);

        foreach (var cycle in FindCycles(process.Nodes.Select(node => node.Id), outgoing))
        {
            var cycleNames = cycle.Select(id => process.Nodes.FirstOrDefault(node => node.Id == id)?.Name ?? id).ToArray();
            var controlledExit = cycle.SelectMany(id => outgoing.GetValueOrDefault(id) ?? [])
                .Any(edge => !cycle.Contains(edge.TargetId) && !string.IsNullOrWhiteSpace(edge.Label) &&
                    process.Nodes.Any(node => node.Id == edge.SourceId && node.Type == "exclusiveGateway"));
            var elementId = cycle.OrderBy(id => id, StringComparer.Ordinal).First();
            var elementName = process.Nodes.FirstOrDefault(node => node.Id == elementId)?.Name;
            if (controlledExit)
                Warning("route-cycle-controlled", $"Маршрут содержит управляемый повтор: {string.Join(" → ", cycleNames)}. Проверьте условие выхода и допустимое число повторов.", elementId, elementName);
            else
                Error("route-cycle-without-exit", $"Обнаружен цикл без подписанного выхода через исключающую развилку: {string.Join(" → ", cycleNames)}.", elementId, elementName);
        }

        foreach (var node in process.Nodes)
        {
            foreach (var evidence in node.Evidence ?? [])
                if (evidence.Status is "assumption" or "question")
                    Warning("task-evidence-unresolved", $"{(evidence.Status == "question" ? "Открытый вопрос" : "Предположение")}: {evidence.Statement}", node.Id, node.Name);
            if (node.Type != "startEvent" && !incoming.ContainsKey(node.Id))
                Error("missing-incoming", $"Элемент «{node.Name}» не имеет входящей связи.", node.Id, node.Name);
            if (node.Type != "endEvent" && !outgoing.ContainsKey(node.Id))
                Error("missing-outgoing", $"Элемент «{node.Name}» не имеет исходящей связи.", node.Id, node.Name);
            if (starts.Length > 0 && !reachableFromStart.Contains(node.Id))
                Error("unreachable-from-start", $"Элемент «{node.Name}» недостижим от начала процесса.", node.Id, node.Name);
            if (ends.Length > 0 && !canReachEnd.Contains(node.Id))
                Error("cannot-reach-end", $"Из элемента «{node.Name}» нельзя дойти до завершения процесса.", node.Id, node.Name);

            if (node.Type == "exclusiveGateway")
            {
                var branches = outgoing.GetValueOrDefault(node.Id) ?? [];
                if (branches.Length < 2) Error("gateway-branches", $"Шлюз «{node.Name}» должен иметь не менее двух исходящих ветвей.", node.Id, node.Name);
                foreach (var edge in branches.Where(edge => string.IsNullOrWhiteSpace(edge.Label)))
                    Error("gateway-label", $"У шлюза «{node.Name}» есть неподписанная исходящая ветвь.", node.Id, node.Name);
            }

            if (node.Type == "parallelGateway")
            {
                var incomingBranches = incoming.GetValueOrDefault(node.Id) ?? [];
                var outgoingBranches = outgoing.GetValueOrDefault(node.Id) ?? [];
                if (incomingBranches.Length < 2 && outgoingBranches.Length < 2)
                    Error("parallel-gateway-branches", $"Параллельный шлюз «{node.Name}» должен разделять или объединять не менее двух ветвей.", node.Id, node.Name);
                if (outgoingBranches.Length > 1 && outgoingBranches.Any(edge => !string.IsNullOrWhiteSpace(edge.Label)))
                    Warning("parallel-gateway-label", $"Подписи исходов параллельного шлюза «{node.Name}» не выбирают альтернативу: запускаются все ветви.", node.Id, node.Name);
            }

            if (node.Type == "task")
            {
                if (node.ExecutorKind == "system" && string.IsNullOrWhiteSpace(node.SystemName))
                    Warning("executor-system-missing", "Действие выполняется системой, но её название не указано.", node.Id, node.Name);
                if ((node.BpmnType == "serviceTask" && node.ExecutorKind == "human") || (node.BpmnType is "userTask" or "manualTask" && node.ExecutorKind == "system"))
                    Warning("executor-type-conflict", "Исполнитель действия не соответствует типу BPMN. Проверьте тип блока или исполнителя.", node.Id, node.Name);
                if (string.IsNullOrWhiteSpace(node.Name) || node.Name.Equals(node.Id, StringComparison.Ordinal))
                    Error("task-name", "У задачи отсутствует понятное название.", node.Id, node.Name);
                if (string.IsNullOrWhiteSpace(node.Description))
                    Warning("task-description", $"Для задачи «{node.Name}» не заполнено описание.", node.Id, node.Name);
                if (string.IsNullOrWhiteSpace(node.Duration))
                    Warning("task-duration", $"Для задачи «{node.Name}» не указан норматив выполнения.", node.Id, node.Name);
                if ((node.Inputs?.Count ?? 0) == 0)
                    Warning("task-inputs", $"Для задачи «{node.Name}» не указаны входы.", node.Id, node.Name);
                if (string.IsNullOrWhiteSpace(node.ExpectedResult))
                    Warning("task-result", $"Для задачи «{node.Name}» не указан ожидаемый результат.", node.Id, node.Name);
                if (string.IsNullOrWhiteSpace(node.CompletionCriteria))
                    Warning("task-completion", $"Для задачи «{node.Name}» не задан критерий завершения.", node.Id, node.Name);
                if (string.IsNullOrWhiteSpace(node.ExecutionMode) && (node.Channels?.Count ?? 0) == 0)
                    Warning("task-execution-mode", $"Для задачи «{node.Name}» не указан способ выполнения.", node.Id, node.Name);
                if (node.ExecutionMode == "system" && string.IsNullOrWhiteSpace(node.SystemName))
                    Warning("task-system", $"Для системной задачи «{node.Name}» не указана информационная система.", node.Id, node.Name);
                foreach (var channel in node.Channels ?? [])
                {
                    if (channel.Kind == "system" && string.IsNullOrWhiteSpace(channel.SystemName))
                        Warning("task-channel-system", $"Для канала «{channel.Label}» задачи «{node.Name}» не указана информационная система.", node.Id, node.Name);
                    if (channel.Flow == "parallel" && string.IsNullOrWhiteSpace(channel.DocumentName))
                        Warning("task-parallel-channel-document", $"Для параллельного канала «{channel.Label}» желательно указать передаваемый документ или результат.", node.Id, node.Name);
                }
                foreach (var reference in node.ParticipantUnitRefs ?? [])
                {
                    var entity = organization.LegalEntities.FirstOrDefault(item => item.Id.Equals(reference.LegalEntityId, StringComparison.OrdinalIgnoreCase));
                    if (entity is null || !(entity.Units ?? []).Any(unit => unit.Id.Equals(reference.UnitId, StringComparison.OrdinalIgnoreCase)))
                        Warning("task-participant-unit-missing", $"У задачи «{node.Name}» есть участник, которого больше нет в оргструктуре: {reference.LegalEntityId} / {reference.UnitId}.", node.Id, node.Name);
                }
                if (!string.IsNullOrWhiteSpace(node.LinkedProcessId))
                {
                    if (node.LinkedProcessId.Equals(processId, StringComparison.OrdinalIgnoreCase))
                        Error("linked-process-self", $"Задача «{node.Name}» ссылается на собственный процесс.", node.Id, node.Name);
                    else if (!processIds.Contains(node.LinkedProcessId))
                        Error("linked-process-missing", $"Детальный процесс «{node.LinkedProcessId}» для задачи «{node.Name}» не найден.", node.Id, node.Name);
                    else if (await CanReachProcessAsync(node.LinkedProcessId, processId, catalogItems, cancellationToken))
                        Error("linked-process-cycle", $"Связь задачи «{node.Name}» создаёт циклическую вложенность процессов.", node.Id, node.Name);
                    else
                    {
                        var targetSummary = catalogItems.First(item => item.Id.Equals(node.LinkedProcessId, StringComparison.OrdinalIgnoreCase));
                        var target = await catalog.LoadAsync(targetSummary.Id, draft: targetSummary.HasDraft || targetSummary.Status == "Draft", cancellationToken);
                        if (process.Passport is not null && target.Passport is not null && target.Passport.Level != process.Passport.Level + 1)
                            Warning("linked-process-level", $"Детальный процесс «{target.Name}» рекомендуется разместить на уровне {process.Passport.Level + 1}.", node.Id, node.Name);
                        if (string.IsNullOrWhiteSpace(target.Passport?.Trigger))
                            Warning("linked-process-trigger", $"У детального процесса «{target.Name}» не заполнено инициирующее событие.", node.Id, node.Name);
                        if ((target.Passport?.Inputs?.Count ?? 0) == 0)
                            Warning("linked-process-inputs", $"У детального процесса «{target.Name}» не описаны входы границы.", node.Id, node.Name);
                        if (string.IsNullOrWhiteSpace(target.Passport?.Result))
                            Warning("linked-process-result", $"У детального процесса «{target.Name}» не заполнен результат.", node.Id, node.Name);
                        if ((target.Passport?.Outputs?.Count ?? 0) == 0)
                            Warning("linked-process-outputs", $"У детального процесса «{target.Name}» не описаны выходы границы.", node.Id, node.Name);
                    }
                }
            }
        }

        var mappings = organization.CrossCompanyProcesses
            .FirstOrDefault(item => item.ProcessId.Equals(processId, StringComparison.OrdinalIgnoreCase))?
            .LaneOrganizations.ToDictionary(item => item.LaneId, StringComparer.Ordinal) ?? [];
        foreach (var lane in process.Lanes)
        {
            if (string.IsNullOrWhiteSpace(lane.Name) || lane.Name.Equals(lane.Id, StringComparison.Ordinal) || lane.Name.Equals("Подразделение", StringComparison.OrdinalIgnoreCase))
                Error("lane-name", "У дорожки не задано подразделение.", lane.Id, lane.Name);
            if (!mappings.TryGetValue(lane.Id, out var mapping) || string.IsNullOrWhiteSpace(mapping.UnitId))
                Error("lane-organization", $"Дорожка «{lane.Name}» не привязана к подразделению оргструктуры.", lane.Id, lane.Name);
            else
            {
                var unit = organization.LegalEntities.FirstOrDefault(entity => entity.Id.Equals(mapping.LegalEntityId, StringComparison.OrdinalIgnoreCase))?
                    .Units?.FirstOrDefault(item => item.Id.Equals(mapping.UnitId, StringComparison.OrdinalIgnoreCase));
                if (unit is not null)
                {
                    var expected = mapping.DisplayNameMode == "short" && !string.IsNullOrWhiteSpace(unit.ShortName) ? unit.ShortName : unit.Name;
                    if (!lane.Name.Trim().Equals(expected.Trim(), StringComparison.OrdinalIgnoreCase))
                        Warning("lane-name-outdated", $"Название дорожки «{lane.Name}» отличается от выбранного подразделения «{expected}». Администратор может обновить названия дорожек черновиков в настройках.", lane.Id, lane.Name);
                }
            }
        }

        if (string.IsNullOrWhiteSpace(process.Owner) || process.Owner.Equals("Не назначен", StringComparison.OrdinalIgnoreCase))
            Error("process-owner", "Не назначено подразделение-владелец процесса.");
        if (process.Passport is null) Warning("process-passport", "Не заполнен паспорт процесса.");
        else
        {
            if (string.IsNullOrWhiteSpace(process.Passport.Purpose)) Warning("process-purpose", "В паспорте не указана цель процесса.");
            if (string.IsNullOrWhiteSpace(process.Passport.Scope)) Warning("process-scope", "В паспорте не определены границы процесса.");
            if (string.IsNullOrWhiteSpace(process.Passport.Trigger) || string.IsNullOrWhiteSpace(process.Passport.Result)) Warning("process-boundaries", "Заполните инициирующее событие и результат процесса.");
            if ((process.Passport.TriggerOptions?.Count ?? 0) > 1 && string.IsNullOrWhiteSpace(process.Passport.Trigger))
                Warning("process-trigger-summary", "Для нескольких вариантов запуска добавьте общее описание инициирующего события.");
            foreach (var relatedId in process.Passport.RelatedProcessIds ?? [])
            {
                if (relatedId.Equals(processId, StringComparison.OrdinalIgnoreCase)) Warning("process-self-relation", "Процесс не должен ссылаться на себя как на связанный.");
                else if (!processIds.Contains(relatedId)) Warning("related-process-missing", $"Связанный процесс «{relatedId}» не найден в каталоге.");
            }
        }

        var ordered = issues.OrderBy(issue => issue.Severity == "Error" ? 0 : 1).ThenBy(issue => issue.Message).ToArray();
        var errorCount = ordered.Count(issue => issue.Severity == "Error");
        return new(processId, errorCount == 0, errorCount, ordered.Length - errorCount, ordered);
    }

    private async Task<bool> CanReachProcessAsync(
        string sourceId,
        string targetId,
        IReadOnlyList<ProcessSummaryModel> items,
        CancellationToken cancellationToken)
    {
        var byId = items.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        var queue = new Queue<string>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        queue.Enqueue(sourceId);
        while (queue.TryDequeue(out var currentId))
        {
            if (currentId.Equals(targetId, StringComparison.OrdinalIgnoreCase)) return true;
            if (!visited.Add(currentId) || !byId.TryGetValue(currentId, out var summary)) continue;
            var current = await catalog.LoadAsync(currentId, draft: summary.HasDraft || summary.Status == "Draft", cancellationToken);
            foreach (var linkedId in current.Nodes.Select(node => node.LinkedProcessId).Where(id => !string.IsNullOrWhiteSpace(id)))
                queue.Enqueue(linkedId!);
        }
        return false;
    }

    private static HashSet<string> Traverse(
        IEnumerable<string> roots,
        IReadOnlyDictionary<string, EdgeModel[]> adjacency,
        Func<EdgeModel, string> next)
    {
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var queue = new Queue<string>(roots);
        while (queue.TryDequeue(out var id))
        {
            if (!visited.Add(id)) continue;
            foreach (var edge in adjacency.GetValueOrDefault(id) ?? []) queue.Enqueue(next(edge));
        }
        return visited;
    }

    private static IReadOnlyList<HashSet<string>> FindCycles(IEnumerable<string> nodeIds,
        IReadOnlyDictionary<string, EdgeModel[]> outgoing)
    {
        var index = 0;
        var indices = new Dictionary<string, int>(StringComparer.Ordinal);
        var lowLinks = new Dictionary<string, int>(StringComparer.Ordinal);
        var stack = new Stack<string>();
        var onStack = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<HashSet<string>>();

        void Visit(string id)
        {
            indices[id] = lowLinks[id] = index++;
            stack.Push(id);
            onStack.Add(id);
            foreach (var edge in outgoing.GetValueOrDefault(id) ?? [])
            {
                if (!indices.ContainsKey(edge.TargetId))
                {
                    Visit(edge.TargetId);
                    lowLinks[id] = Math.Min(lowLinks[id], lowLinks[edge.TargetId]);
                }
                else if (onStack.Contains(edge.TargetId)) lowLinks[id] = Math.Min(lowLinks[id], indices[edge.TargetId]);
            }
            if (lowLinks[id] != indices[id]) return;
            var component = new HashSet<string>(StringComparer.Ordinal);
            string current;
            do { current = stack.Pop(); onStack.Remove(current); component.Add(current); } while (current != id);
            var selfLoop = component.Count == 1 && (outgoing.GetValueOrDefault(id) ?? []).Any(edge => edge.TargetId == id);
            if (component.Count > 1 || selfLoop) result.Add(component);
        }

        foreach (var id in nodeIds) if (!indices.ContainsKey(id)) Visit(id);
        return result;
    }

    private static string Category(string code)
    {
        if (code.StartsWith("lane-") || code.Contains("participant-unit", StringComparison.Ordinal)) return "Organization";
        if (code.StartsWith("linked-process") || code.StartsWith("related-process") || code == "process-self-relation") return "Decomposition";
        if (code.StartsWith("task-") || code.StartsWith("process-") || code.StartsWith("executor-")) return "Description";
        if (code.StartsWith("missing-") || code.StartsWith("unreachable-") || code.StartsWith("cannot-reach-") || code.StartsWith("gateway-") || code.StartsWith("parallel-gateway-") || code.StartsWith("route-cycle-")) return "Route";
        return "Other";
    }
}
