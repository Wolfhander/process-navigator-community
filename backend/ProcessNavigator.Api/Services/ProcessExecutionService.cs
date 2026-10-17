using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class ProcessExecutionService(IWebHostEnvironment environment)
{
    private readonly string root = Path.Combine(environment.ContentRootPath, "Data", "Executions");
    private readonly SemaphoreSlim writeLock = new(1, 1);

    public async Task<IReadOnlyList<ProcessInstanceModel>> ListAsync(string processId, CancellationToken cancellationToken) =>
        (await ReadAsync(processId, cancellationToken)).OrderByDescending(instance => instance.StartedAt).ToArray();

    public async Task<ProcessAnalyticsModel> AnalyticsAsync(ProcessModel process, CancellationToken cancellationToken)
    {
        var instances = await ReadAsync(process.Id, cancellationToken); var now = DateTimeOffset.UtcNow;
        var completedCycles = instances.Where(item => item.CompletedAt.HasValue).Select(item => (item.CompletedAt!.Value - item.StartedAt).TotalMinutes).ToArray();
        var lanes = process.Lanes.ToDictionary(lane => lane.Id, lane => lane.Name);
        var steps = process.Nodes.Where(node => node.Type == "task").Select(node =>
        {
            var facts = instances.SelectMany(instance => instance.Steps).Where(step => step.ElementId == node.Id).ToArray();
            var durations = facts.Where(step => step.StartedAt.HasValue && step.CompletedAt.HasValue)
                .Select(step => step.ActualDurationMinutes ?? (step.CompletedAt!.Value - step.StartedAt!.Value).TotalMinutes).ToArray();
            var norm = ParseNormMinutes(node.Duration);
            var overdue = facts.Count(step => (step.OverdueMinutes ?? 0) > 0 ||
                (step.Status == "InProgress" && step.PlannedCompletedAt.HasValue && step.PlannedCompletedAt.Value < now));
            return new StepAnalyticsModel(node.Id, node.Name, lanes.GetValueOrDefault(node.LaneId, node.Responsible ?? "Без дорожки"), node.Duration,
                facts.Count(step => step.Status == "Completed"), facts.Count(step => step.Status == "InProgress"),
                durations.Length > 0 ? Math.Round(durations.Average(), 1) : null, durations.Length > 0 ? Math.Round(durations.Max(), 1) : null, overdue);
        }).ToArray();
        return new(process.Id, instances.Count, instances.Count(item => item.Status == "Active"), instances.Count(item => item.Status == "Completed"),
            completedCycles.Length > 0 ? Math.Round(completedCycles.Average(), 1) : null, steps);
    }

    public async Task<ProcessInstanceModel> StartAsync(ProcessModel process, string userId, string? name, CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.UtcNow;
        var instance = new ProcessInstanceModel(Guid.NewGuid().ToString("N"), process.Id, process.Version,
            string.IsNullOrWhiteSpace(name) ? $"Выполнение от {DateTimeOffset.Now:dd.MM.yyyy HH:mm}" : name.Trim(), "Active",
            startedAt, null, userId, process.Nodes.Where(node => node.Type == "task")
                .Select(node => new StepExecutionModel(node.Id, "NotStarted", null, null, null)).ToArray());
        instance = RefreshAvailablePlans(process, instance, startedAt);
        var instances = (await ReadAsync(process.Id, cancellationToken)).Append(instance).ToArray();
        await WriteAsync(process.Id, instances, cancellationToken); return instance;
    }

    public async Task<ProcessInstanceModel> UpdateStepAsync(ProcessModel process, string instanceId, string elementId, string status,
        string userId, CancellationToken cancellationToken)
    {
        if (status is not ("InProgress" or "Completed")) throw new InvalidDataException("Допустимы состояния InProgress и Completed.");
        if (!process.Nodes.Any(node => node.Id == elementId && node.Type == "task")) throw new KeyNotFoundException("BPMN element");
        var instances = (await ReadAsync(process.Id, cancellationToken)).ToArray();
        var index = Array.FindIndex(instances, item => item.Id == instanceId);
        if (index < 0) throw new KeyNotFoundException("Instance");
        var current = instances[index];
        if (current.Status != "Active") throw new InvalidDataException(current.Status switch
        {
            "Paused" => "Приостановленный экземпляр сначала нужно возобновить.",
            "Cancelled" => "Отменённый экземпляр нельзя изменять.",
            _ => "Завершённый экземпляр нельзя изменять."
        });
        var currentStep = current.Steps.First(step => step.ElementId == elementId);
        if (currentStep.Status == "Completed")
        {
            if (status == "Completed") return current;
            throw new InvalidDataException("Завершённый шаг нельзя вернуть в работу.");
        }
        if (currentStep.Status == "Skipped") throw new InvalidDataException("Шаг относится к неприменимой ветви и был пропущен.");
        if (currentStep.Status == "NotStarted" && !IsStepAvailable(process, current, elementId))
        {
            var blockers = BlockingStepNames(process, current, elementId);
            var details = blockers.Count > 0 ? $" Сначала завершите: {string.Join(", ", blockers)}." : string.Empty;
            throw new InvalidDataException($"Шаг пока недоступен по маршруту процесса.{details}");
        }
        if (status == "Completed")
        {
            var node = process.Nodes.First(item => item.Id == elementId);
            var requiredOutputs = (node.InformationObjects ?? []).Where(item => item.Role == "Output" && item.Required).ToArray();
            var recorded = (currentStep.ResultObjects ?? []).Select(item => item.ObjectId).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var missing = requiredOutputs.Where(item => !recorded.Contains(item.ObjectId)).Select(item => item.Name).ToArray();
            if (missing.Length > 0)
                throw new InvalidDataException($"Перед завершением зафиксируйте обязательные результаты: {string.Join(", ", missing)}.");
        }
        var now = DateTimeOffset.UtcNow;
        var branchChoice = currentStep.Status == "NotStarted"
            ? ResolveBranchChoices(process, current, elementId, userId, now)
            : new BranchChoiceResult([], []);
        var skipped = branchChoice.SkippedSteps.ToDictionary(item => item.ElementId, StringComparer.Ordinal);
        var currentNode = process.Nodes.First(item => item.Id == elementId);
        var plannedStep = currentStep.AvailableAt.HasValue ? currentStep : ApplyPlan(currentNode, currentStep, now);
        var startedAt = plannedStep.StartedAt ?? now;
        var completedStep = status == "Completed" ? CompleteTiming(current, plannedStep, startedAt, now) : plannedStep;
        var steps = current.Steps.Select(step => skipped.TryGetValue(step.ElementId, out var skip)
            ? step with { Status = "Skipped", SkippedAt = now, SkipReason = skip.Reason, UserId = userId }
            : step.ElementId != elementId ? step : status == "InProgress"
            ? plannedStep with { Status = status, StartedAt = startedAt, UserId = userId }
            : completedStep with { Status = status, StartedAt = startedAt, CompletedAt = now, UserId = userId }).ToArray();
        var completed = steps.All(step => step.Status is "Completed" or "Skipped");
        var decisions = (current.BranchDecisions ?? []).Concat(branchChoice.Decisions)
            .GroupBy(item => item.GatewayId, StringComparer.Ordinal).Select(group => group.First()).ToArray();
        var updated = current with { Steps = steps, BranchDecisions = decisions, Status = completed ? "Completed" : "Active", CompletedAt = completed ? now : null };
        if (!completed) updated = RefreshAvailablePlans(process, updated, now);
        instances[index] = updated; await WriteAsync(process.Id, instances, cancellationToken); return updated;
    }

    public async Task<ProcessInstanceModel> ReturnStepAsync(ProcessModel process, string instanceId, string fromElementId,
        string targetElementId, string reason, string userId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length is < 3 or > 500)
            throw new InvalidDataException("Укажите причину возврата длиной от 3 до 500 символов.");
        var nodes = process.Nodes.ToDictionary(node => node.Id, StringComparer.Ordinal);
        if (!nodes.TryGetValue(fromElementId, out var sourceNode) || sourceNode.Type != "task" ||
            !nodes.TryGetValue(targetElementId, out var targetNode) || targetNode.Type != "task")
            throw new KeyNotFoundException("BPMN element");
        if (fromElementId == targetElementId) throw new InvalidDataException("Выберите предыдущий этап для возврата.");

        var instances = (await ReadAsync(process.Id, cancellationToken)).ToArray();
        var index = Array.FindIndex(instances, item => item.Id == instanceId);
        if (index < 0) throw new KeyNotFoundException("Instance");
        var current = instances[index];
        if (current.Status != "Active") throw new InvalidDataException(current.Status switch
        {
            "Paused" => "Приостановленный экземпляр сначала нужно возобновить.",
            "Cancelled" => "Отменённый экземпляр нельзя вернуть на доработку.",
            _ => "Завершённый экземпляр нельзя вернуть на доработку."
        });
        var sourceStep = current.Steps.FirstOrDefault(step => step.ElementId == fromElementId);
        var targetStep = current.Steps.FirstOrDefault(step => step.ElementId == targetElementId);
        if (sourceStep is null || targetStep is null) throw new KeyNotFoundException("Instance step");
        if (sourceStep.Status != "InProgress")
            throw new InvalidDataException("Вернуть маршрут можно только из этапа, который сейчас находится в работе.");
        if (targetStep.Status != "Completed") throw new InvalidDataException("Этап возврата должен быть завершён в текущем проходе.");

        var outgoing = process.Edges.GroupBy(edge => edge.SourceId).ToDictionary(group => group.Key,
            group => group.Select(edge => edge.TargetId).ToArray(), StringComparer.Ordinal);
        var incoming = process.Edges.GroupBy(edge => edge.TargetId).ToDictionary(group => group.Key,
            group => group.Select(edge => edge.SourceId).ToArray(), StringComparer.Ordinal);
        var forward = TraverseNodeIds(targetElementId, outgoing);
        if (!forward.Contains(fromElementId)) throw new InvalidDataException("Возврат разрешён только к предыдущему этапу текущего маршрута.");
        var backward = TraverseNodeIds(fromElementId, incoming);
        var segment = forward.Intersect(backward, StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal);
        var affected = current.Steps.Where(step => segment.Contains(step.ElementId) && step.Status != "NotStarted").ToArray();
        if (!affected.Any(step => step.ElementId == targetElementId) || !affected.Any(step => step.ElementId == fromElementId))
            throw new InvalidDataException("Не удалось определить участок маршрута для повторного прохода.");

        var now = DateTimeOffset.UtcNow;
        var cleanReason = reason.Trim();
        var resetIds = affected.Select(step => step.ElementId).ToHashSet(StringComparer.Ordinal);
        var steps = current.Steps.Select(step => !resetIds.Contains(step.ElementId) ? step : step with
        {
            Status = "NotStarted",
            StartedAt = null,
            CompletedAt = null,
            UserId = null,
            SkippedAt = null,
            SkipReason = null,
            ResultText = null,
            ResultRecordedAt = null,
            ResultRecordedBy = null,
            ResultObjects = null,
            Attachments = null,
            AvailableAt = null,
            NormText = null,
            PlannedWorkMinutes = null,
            PlannedWaitMinutes = null,
            PlannedDurationMinutes = null,
            PlannedCompletedAt = null,
            ActualQueueMinutes = null,
            ActualWorkMinutes = null,
            ActualDurationMinutes = null,
            OverdueMinutes = null,
            Iteration = Math.Max(1, step.Iteration) + 1,
            History = (step.History ?? []).Append(new StepExecutionIterationModel(Math.Max(1, step.Iteration), step.Status,
                step.StartedAt, step.CompletedAt, step.UserId, step.SkippedAt, step.SkipReason, now, userId, cleanReason,
                step.ResultText, step.ResultObjects, step.Attachments, step.ResultRecordedAt, step.ResultRecordedBy,
                step.AvailableAt, step.NormText, step.PlannedWorkMinutes,
                step.PlannedWaitMinutes, step.PlannedDurationMinutes, step.PlannedCompletedAt, step.ActualQueueMinutes,
                step.ActualWorkMinutes, step.ActualDurationMinutes, step.OverdueMinutes, step.AssignedUserId)).ToArray()
        }).ToArray();
        var clearedGateways = process.Nodes.Where(node => segment.Contains(node.Id) && node.Type == "exclusiveGateway")
            .Select(node => node.Id).ToHashSet(StringComparer.Ordinal);
        var decisions = (current.BranchDecisions ?? []).Where(item => !clearedGateways.Contains(item.GatewayId)).ToArray();
        var targetIteration = steps.First(step => step.ElementId == targetElementId).Iteration;
        var returnEvent = new ProcessReturnEventModel(fromElementId, sourceNode.Name, targetElementId, targetNode.Name, cleanReason,
            targetIteration, now, userId, resetIds.OrderBy(id => id, StringComparer.Ordinal).ToArray());
        var updated = current with
        {
            Steps = steps,
            BranchDecisions = decisions,
            ReturnEvents = (current.ReturnEvents ?? []).Append(returnEvent).ToArray(),
            Status = "Active",
            CompletedAt = null
        };
        updated = RefreshAvailablePlans(process, updated, now);
        instances[index] = updated;
        await WriteAsync(process.Id, instances, cancellationToken);
        return updated;
    }

    public async Task<ProcessInstanceModel> SaveStepResultAsync(ProcessModel process, string instanceId, string elementId,
        string? resultText, IReadOnlyList<string>? objectIds, string userId, CancellationToken cancellationToken)
    {
        var node = process.Nodes.FirstOrDefault(item => item.Id == elementId && item.Type == "task")
            ?? throw new KeyNotFoundException("BPMN element");
        var cleanText = string.IsNullOrWhiteSpace(resultText) ? null : resultText.Trim();
        if ((cleanText?.Length ?? 0) > 4000) throw new InvalidDataException("Фактический результат не должен превышать 4000 символов.");
        var selectedIds = (objectIds ?? []).Where(id => !string.IsNullOrWhiteSpace(id)).Select(id => id.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (selectedIds.Length > 40) throw new InvalidDataException("Нельзя зафиксировать более 40 результатов одного шага.");
        var available = (node.InformationObjects ?? []).Where(item => item.Role == "Output")
            .ToDictionary(item => item.ObjectId, StringComparer.OrdinalIgnoreCase);
        if (selectedIds.Any(id => !available.ContainsKey(id)))
            throw new InvalidDataException("Выбран результат, который не указан как выход этого шага.");

        var instances = (await ReadAsync(process.Id, cancellationToken)).ToArray();
        var index = Array.FindIndex(instances, item => item.Id == instanceId);
        if (index < 0) throw new KeyNotFoundException("Instance");
        var current = instances[index];
        EnsureEditable(current);
        var step = current.Steps.FirstOrDefault(item => item.ElementId == elementId) ?? throw new KeyNotFoundException("Instance step");
        if (step.Status != "InProgress") throw new InvalidDataException("Фактический результат можно записать только для шага в работе.");
        var now = DateTimeOffset.UtcNow;
        var resultObjects = selectedIds.Select(id => new StepExecutionResultObjectModel(id, available[id].Name, now, userId)).ToArray();
        var updatedStep = step with { ResultText = cleanText, ResultRecordedAt = now, ResultRecordedBy = userId, ResultObjects = resultObjects };
        var updated = current with { Steps = current.Steps.Select(item => item.ElementId == elementId ? updatedStep : item).ToArray() };
        instances[index] = updated;
        await WriteAsync(process.Id, instances, cancellationToken);
        return updated;
    }

    public async Task<ProcessInstanceModel> AddStepAttachmentAsync(ProcessModel process, string instanceId, string elementId,
        RepositoryArtifactUploadModel artifact, string fileName, long size, string userId, CancellationToken cancellationToken)
    {
        if (!process.Nodes.Any(item => item.Id == elementId && item.Type == "task")) throw new KeyNotFoundException("BPMN element");
        var instances = (await ReadAsync(process.Id, cancellationToken)).ToArray();
        var index = Array.FindIndex(instances, item => item.Id == instanceId);
        if (index < 0) throw new KeyNotFoundException("Instance");
        var current = instances[index];
        EnsureEditable(current);
        var step = current.Steps.FirstOrDefault(item => item.ElementId == elementId) ?? throw new KeyNotFoundException("Instance step");
        if (step.Status != "InProgress") throw new InvalidDataException("Вложение можно добавить только к шагу в работе.");
        if ((step.Attachments?.Count ?? 0) >= 20) throw new InvalidDataException("К одному проходу шага можно прикрепить не более 20 файлов.");
        var attachment = new StepExecutionAttachmentModel(artifact.Id, artifact.Name, artifact.Kind, artifact.Version,
            artifact.Reference, Path.GetFileName(fileName), size, DateTimeOffset.UtcNow, userId);
        var updatedStep = step with { Attachments = (step.Attachments ?? []).Append(attachment).ToArray() };
        var updated = current with { Steps = current.Steps.Select(item => item.ElementId == elementId ? updatedStep : item).ToArray() };
        instances[index] = updated;
        await WriteAsync(process.Id, instances, cancellationToken);
        return updated;
    }

    public async Task<ProcessInstanceModel> AssignStepAsync(ProcessModel process, string instanceId, string elementId,
        string targetUserId, string reason, string assignedBy, ProcessAssignmentsModel assignments,
        CancellationToken cancellationToken)
    {
        var node = process.Nodes.FirstOrDefault(item => item.Id == elementId && item.Type == "task")
            ?? throw new KeyNotFoundException("BPMN element");
        var cleanReason = string.IsNullOrWhiteSpace(reason) ? string.Empty : reason.Trim();
        if (cleanReason.Length is < 3 or > 500) throw new InvalidDataException("Укажите основание передачи длиной от 3 до 500 символов.");
        var lane = assignments.Lanes.FirstOrDefault(item => item.LaneId == node.LaneId)
            ?? throw new InvalidDataException("Для дорожки шага не настроены допустимые исполнители.");
        var target = assignments.Users.FirstOrDefault(item => item.Id.Equals(targetUserId?.Trim(), StringComparison.OrdinalIgnoreCase) && item.IsActive)
            ?? throw new InvalidDataException("Выбранный сотрудник не найден или отключён.");
        if (!lane.UserIds.Contains(target.Id, StringComparer.OrdinalIgnoreCase))
            throw new InvalidDataException("Сотрудник не назначен допустимым исполнителем дорожки этого шага.");

        var instances = (await ReadAsync(process.Id, cancellationToken)).ToArray();
        var index = Array.FindIndex(instances, item => item.Id == instanceId);
        if (index < 0) throw new KeyNotFoundException("Instance");
        var current = instances[index];
        EnsureEditable(current);
        var step = current.Steps.FirstOrDefault(item => item.ElementId == elementId) ?? throw new KeyNotFoundException("Instance step");
        if (step.Status is "Completed" or "Skipped") throw new InvalidDataException("Завершённый или пропущенный шаг нельзя передать другому исполнителю.");
        if (string.Equals(step.AssignedUserId, target.Id, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Этот сотрудник уже назначен исполнителем шага.");

        var users = assignments.Users.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        var now = DateTimeOffset.UtcNow;
        var assignmentEvent = new StepAssignmentEventModel(node.Id, node.Name, step.AssignedUserId,
            step.AssignedUserId is not null && users.TryGetValue(step.AssignedUserId, out var previous) ? previous.DisplayName : null,
            target.Id, target.DisplayName, cleanReason, now, assignedBy);
        var updated = current with
        {
            Steps = current.Steps.Select(item => item.ElementId == elementId ? item with { AssignedUserId = target.Id } : item).ToArray(),
            AssignmentEvents = (current.AssignmentEvents ?? []).Append(assignmentEvent).ToArray()
        };
        instances[index] = updated;
        await WriteAsync(process.Id, instances, cancellationToken);
        return updated;
    }

    public async Task ValidateStepAttachmentAsync(ProcessModel process, string instanceId, string elementId,
        CancellationToken cancellationToken)
    {
        if (!process.Nodes.Any(item => item.Id == elementId && item.Type == "task")) throw new KeyNotFoundException("BPMN element");
        var current = (await ReadAsync(process.Id, cancellationToken)).FirstOrDefault(item => item.Id == instanceId)
            ?? throw new KeyNotFoundException("Instance");
        EnsureEditable(current);
        var step = current.Steps.FirstOrDefault(item => item.ElementId == elementId) ?? throw new KeyNotFoundException("Instance step");
        if (step.Status != "InProgress") throw new InvalidDataException("Вложение можно добавить только к шагу в работе.");
        if ((step.Attachments?.Count ?? 0) >= 20) throw new InvalidDataException("К одному проходу шага можно прикрепить не более 20 файлов.");
    }

    public async Task<ExecutionTimelineModel> TimelineAsync(ProcessModel process, string instanceId,
        IReadOnlyList<CommandExecutionModel> commands, CancellationToken cancellationToken)
    {
        var instance = (await ReadAsync(process.Id, cancellationToken)).FirstOrDefault(item => item.Id == instanceId)
            ?? throw new KeyNotFoundException("Instance");
        var nodes = process.Nodes.ToDictionary(item => item.Id, StringComparer.Ordinal);
        var events = new List<ExecutionTimelineEventModel>
        {
            new($"instance:start:{instance.Id}", "InstanceStarted", "Экземпляр запущен", instance.Name,
                instance.StartedAt, UserId: instance.StartedBy)
        };

        void AddStepEvents(string elementId, int iteration, string status, DateTimeOffset? availableAt, DateTimeOffset? startedAt,
            DateTimeOffset? completedAt, DateTimeOffset? skippedAt, string? skipReason, string? userId, string? resultText,
            DateTimeOffset? resultAt, IReadOnlyList<StepExecutionAttachmentModel>? attachments, double? overdueMinutes)
        {
            var name = nodes.GetValueOrDefault(elementId)?.Name ?? elementId;
            if (availableAt.HasValue) events.Add(new($"step:available:{elementId}:{iteration}:{availableAt.Value.UtcTicks}",
                "StepAvailable", $"Доступен этап «{name}»", null, availableAt.Value, elementId, name, iteration));
            if (startedAt.HasValue) events.Add(new($"step:start:{elementId}:{iteration}:{startedAt.Value.UtcTicks}",
                "StepStarted", $"Начат этап «{name}»", $"Проход {iteration}", startedAt.Value, elementId, name, iteration, userId));
            if (resultAt.HasValue) events.Add(new($"step:result:{elementId}:{iteration}:{resultAt.Value.UtcTicks}",
                "ResultRecorded", $"Зафиксирован результат «{name}»", resultText, resultAt.Value, elementId, name, iteration, userId));
            foreach (var attachment in attachments ?? []) events.Add(new($"step:file:{elementId}:{iteration}:{attachment.ArtifactId}:{attachment.Version}",
                "AttachmentAdded", $"Прикреплён файл «{attachment.FileName}»", name, attachment.AttachedAt,
                elementId, name, iteration, attachment.UserId));
            if (completedAt.HasValue) events.Add(new($"step:complete:{elementId}:{iteration}:{completedAt.Value.UtcTicks}",
                "StepCompleted", $"Завершён этап «{name}»", overdueMinutes > 0 ? $"Просрочка {FormatMinutes(overdueMinutes.Value)}" : $"Проход {iteration}",
                completedAt.Value, elementId, name, iteration, userId, overdueMinutes > 0 ? "Warning" : "Success"));
            if (status == "Skipped" && skippedAt.HasValue) events.Add(new($"step:skip:{elementId}:{iteration}:{skippedAt.Value.UtcTicks}",
                "StepSkipped", $"Пропущен этап «{name}»", skipReason, skippedAt.Value, elementId, name, iteration, userId));
        }

        foreach (var step in instance.Steps)
        {
            foreach (var old in step.History ?? []) AddStepEvents(step.ElementId, old.Iteration, old.Status, old.AvailableAt,
                old.StartedAt, old.CompletedAt, old.SkippedAt, old.SkipReason, old.UserId, old.ResultText,
                old.ResultRecordedAt,
                old.Attachments, old.OverdueMinutes);
            AddStepEvents(step.ElementId, Math.Max(1, step.Iteration), step.Status, step.AvailableAt, step.StartedAt,
                step.CompletedAt, step.SkippedAt, step.SkipReason, step.UserId, step.ResultText, step.ResultRecordedAt,
                step.Attachments, step.OverdueMinutes);
        }
        events.AddRange((instance.BranchDecisions ?? []).Select(item => new ExecutionTimelineEventModel(
            $"branch:{item.GatewayId}:{item.SelectedAt.UtcTicks}", "BranchSelected", $"Выбрана ветвь «{item.SelectedLabel ?? item.SelectedTargetName}»",
            item.GatewayName, item.SelectedAt, item.GatewayId, item.GatewayName, UserId: item.UserId)));
        events.AddRange((instance.ReturnEvents ?? []).Select(item => new ExecutionTimelineEventModel(
            $"return:{item.ReturnedAt.UtcTicks}:{item.TargetElementId}", "StepReturned", $"Возврат к этапу «{item.TargetElementName}»",
            item.Reason, item.ReturnedAt, item.TargetElementId, item.TargetElementName, item.Iteration, item.UserId, "Warning")));
        events.AddRange((instance.LifecycleEvents ?? []).Select(item => new ExecutionTimelineEventModel(
            $"lifecycle:{item.Action}:{item.OccurredAt.UtcTicks}", "LifecycleChanged", LifecycleTitle(item.Action), item.Reason,
            item.OccurredAt, UserId: item.UserId, Severity: item.Action == "cancel" ? "Warning" : "Info")));
        events.AddRange((instance.AssignmentEvents ?? []).Select(item => new ExecutionTimelineEventModel(
            $"assignment:{item.ElementId}:{item.AssignedAt.UtcTicks}", "StepAssigned", $"Этап «{item.ElementName}» передан сотруднику {item.ToUserName}",
            string.IsNullOrWhiteSpace(item.FromUserName) ? item.Reason : $"От: {item.FromUserName}. {item.Reason}",
            item.AssignedAt, item.ElementId, item.ElementName, UserId: item.AssignedBy, Severity: "Info")));
        events.AddRange(commands.Select(item => new ExecutionTimelineEventModel($"command:{item.Id}", "ActionExecuted",
            $"Выполнено действие «{item.ActionLabel}»", item.Result ?? item.Message, item.ExecutedAt, item.ElementId,
            nodes.GetValueOrDefault(item.ElementId)?.Name, UserId: item.UserId, Severity: item.Status == "Failed" ? "Warning" : "Success")));
        if (instance.CompletedAt.HasValue) events.Add(new($"instance:complete:{instance.Id}", "InstanceCompleted", "Экземпляр завершён",
            instance.Name, instance.CompletedAt.Value, Severity: "Success"));
        return new(process.Id, instance.Id, events.OrderByDescending(item => item.OccurredAt).ThenBy(item => item.Id).ToArray());
    }

    private static void EnsureEditable(ProcessInstanceModel instance)
    {
        if (instance.Status != "Active") throw new InvalidDataException(instance.Status switch
        {
            "Paused" => "Приостановленный экземпляр сначала нужно возобновить.",
            "Cancelled" => "Отменённый экземпляр нельзя изменять.",
            _ => "Завершённый экземпляр нельзя изменять."
        });
    }

    public async Task<ProcessInstanceModel> ChangeLifecycleAsync(string processId, string instanceId, string action,
        string? reason, string userId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(action)) throw new InvalidDataException("Укажите действие с экземпляром.");
        var normalized = action.Trim().ToLowerInvariant();
        if (normalized is not ("pause" or "resume" or "cancel"))
            throw new InvalidDataException("Допустимы действия Pause, Resume и Cancel.");
        var cleanReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (normalized is "pause" or "cancel" && (cleanReason?.Length ?? 0) is < 3 or > 500)
            throw new InvalidDataException("Укажите причину длиной от 3 до 500 символов.");

        var instances = (await ReadAsync(processId, cancellationToken)).ToArray();
        var index = Array.FindIndex(instances, item => item.Id == instanceId);
        if (index < 0) throw new KeyNotFoundException("Instance");
        var current = instances[index];
        var nextStatus = normalized switch
        {
            "pause" when current.Status == "Active" => "Paused",
            "resume" when current.Status == "Paused" => "Active",
            "cancel" when current.Status is "Active" or "Paused" => "Cancelled",
            "pause" => throw new InvalidDataException("Приостановить можно только активный экземпляр."),
            "resume" => throw new InvalidDataException("Возобновить можно только приостановленный экземпляр."),
            _ => throw new InvalidDataException("Отменить можно только активный или приостановленный экземпляр.")
        };
        var now = DateTimeOffset.UtcNow;
        var lifecycleEvent = new ProcessLifecycleEventModel(normalized, current.Status, nextStatus, cleanReason, now, userId);
        var steps = current.Steps;
        if (normalized == "resume")
        {
            var pausedAt = (current.LifecycleEvents ?? []).LastOrDefault(item => item.ToStatus == "Paused")?.OccurredAt;
            if (pausedAt.HasValue)
            {
                var pauseDuration = now - pausedAt.Value;
                steps = current.Steps.Select(step => step.Status is "Completed" or "Skipped" || !step.PlannedCompletedAt.HasValue
                    ? step
                    : step with { PlannedCompletedAt = step.PlannedCompletedAt.Value.Add(pauseDuration) }).ToArray();
            }
        }
        var updated = current with
        {
            Status = nextStatus,
            Steps = steps,
            LifecycleEvents = (current.LifecycleEvents ?? []).Append(lifecycleEvent).ToArray()
        };
        instances[index] = updated;
        await WriteAsync(processId, instances, cancellationToken);
        return updated;
    }

    private sealed record SkippedBranchStep(string ElementId, string Reason);
    private sealed record BranchChoiceResult(IReadOnlyList<SkippedBranchStep> SkippedSteps, IReadOnlyList<BranchDecisionModel> Decisions);

    private static BranchChoiceResult ResolveBranchChoices(ProcessModel process, ProcessInstanceModel instance, string selectedElementId,
        string userId, DateTimeOffset selectedAt)
    {
        var nodes = process.Nodes.ToDictionary(node => node.Id);
        var outgoingEdges = process.Edges.GroupBy(edge => edge.SourceId).ToDictionary(group => group.Key, group => group.ToArray());
        var existing = (instance.BranchDecisions ?? []).Select(item => item.GatewayId).ToHashSet(StringComparer.Ordinal);
        var notStarted = instance.Steps.Where(step => step.Status == "NotStarted").Select(step => step.ElementId).ToHashSet(StringComparer.Ordinal);
        var skipped = new Dictionary<string, SkippedBranchStep>(StringComparer.Ordinal);
        var decisions = new List<BranchDecisionModel>();

        foreach (var gateway in process.Nodes.Where(node => node.Type == "exclusiveGateway" && !existing.Contains(node.Id)))
        {
            var branches = outgoingEdges.GetValueOrDefault(gateway.Id, []);
            if (branches.Length < 2) continue;
            var reachable = branches.Select(branch => ReachableNodes(branch.TargetId, outgoingEdges)).ToArray();
            var selectedBranchIndexes = reachable.Select((set, index) => (set, index)).Where(item => item.set.Contains(selectedElementId)).Select(item => item.index).ToArray();
            if (selectedBranchIndexes.Length != 1) continue;

            var selectedIndex = selectedBranchIndexes[0];
            var chosenNodes = reachable[selectedIndex];
            var uniqueAlternatives = reachable.Where((_, index) => index != selectedIndex).SelectMany(set => set)
                .Where(id => !chosenNodes.Contains(id) && notStarted.Contains(id) && nodes.GetValueOrDefault(id)?.Type == "task")
                .Distinct(StringComparer.Ordinal).ToArray();
            if (uniqueAlternatives.Length == 0) continue;

            var selectedBranch = branches[selectedIndex];
            var selectedName = nodes.GetValueOrDefault(selectedBranch.TargetId)?.Name ?? selectedBranch.TargetId;
            var reason = $"Пропущено: после «{gateway.Name}» выбрана ветвь «{selectedBranch.Label ?? selectedName}».";
            foreach (var id in uniqueAlternatives) skipped[id] = new(id, reason);
            decisions.Add(new(gateway.Id, gateway.Name, selectedBranch.TargetId, selectedName, selectedBranch.Label, selectedAt, userId));
        }
        return new(skipped.Values.ToArray(), decisions);
    }

    private static HashSet<string> ReachableNodes(string startId, IReadOnlyDictionary<string, EdgeModel[]> outgoing)
    {
        var reachable = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Stack<string>();
        pending.Push(startId);
        while (pending.TryPop(out var current))
        {
            if (!reachable.Add(current)) continue;
            foreach (var edge in outgoing.GetValueOrDefault(current, [])) pending.Push(edge.TargetId);
        }
        return reachable;
    }

    private static HashSet<string> TraverseNodeIds(string startId, IReadOnlyDictionary<string, string[]> adjacency)
    {
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Stack<string>();
        pending.Push(startId);
        while (pending.TryPop(out var current))
        {
            if (!visited.Add(current)) continue;
            foreach (var next in adjacency.GetValueOrDefault(current, [])) pending.Push(next);
        }
        return visited;
    }

    private static bool IsStepAvailable(ProcessModel process, ProcessInstanceModel instance, string elementId)
    {
        var incoming = process.Edges.GroupBy(edge => edge.TargetId).ToDictionary(group => group.Key, group => group.Select(edge => edge.SourceId).ToArray());
        var nodes = process.Nodes.ToDictionary(node => node.Id);
        var statuses = instance.Steps.ToDictionary(step => step.ElementId, step => step.Status);
        var sources = incoming.GetValueOrDefault(elementId, []);
        return sources.Length == 0 || sources.Any(sourceId => PathSatisfied(sourceId, nodes, incoming, statuses, []));
    }

    private static bool PathSatisfied(string nodeId, IReadOnlyDictionary<string, NodeModel> nodes,
        IReadOnlyDictionary<string, string[]> incoming, IReadOnlyDictionary<string, string> statuses, HashSet<string> visited)
    {
        if (!visited.Add(nodeId) || !nodes.TryGetValue(nodeId, out var node)) return false;
        if (node.Type == "task") return statuses.GetValueOrDefault(nodeId) == "Completed";
        if (node.Type == "startEvent") return true;
        var sources = incoming.GetValueOrDefault(nodeId, []);
        if (sources.Length == 0) return true;
        return node.Type == "parallelGateway" && sources.Length > 1
            ? sources.All(sourceId => PathSatisfied(sourceId, nodes, incoming, statuses, new HashSet<string>(visited)))
            : sources.Any(sourceId => PathSatisfied(sourceId, nodes, incoming, statuses, new HashSet<string>(visited)));
    }

    private static IReadOnlyList<string> BlockingStepNames(ProcessModel process, ProcessInstanceModel instance, string elementId)
    {
        var incoming = process.Edges.GroupBy(edge => edge.TargetId).ToDictionary(group => group.Key, group => group.Select(edge => edge.SourceId).ToArray());
        var nodes = process.Nodes.ToDictionary(node => node.Id);
        var statuses = instance.Steps.ToDictionary(step => step.ElementId, step => step.Status);
        var result = incoming.GetValueOrDefault(elementId, [])
            .SelectMany(sourceId => FindBlockingSteps(sourceId, nodes, incoming, statuses, []))
            .Distinct(StringComparer.Ordinal)
            .Select(id => nodes.GetValueOrDefault(id)?.Name ?? id)
            .ToArray();
        return result;
    }

    private static IEnumerable<string> FindBlockingSteps(string nodeId, IReadOnlyDictionary<string, NodeModel> nodes,
        IReadOnlyDictionary<string, string[]> incoming, IReadOnlyDictionary<string, string> statuses, HashSet<string> visited)
    {
        if (!visited.Add(nodeId) || !nodes.TryGetValue(nodeId, out var node) || node.Type == "startEvent") return [];
        if (node.Type == "task") return statuses.GetValueOrDefault(nodeId) == "Completed" ? [] : [nodeId];
        var sources = incoming.GetValueOrDefault(nodeId, []);
        if (node.Type == "parallelGateway" && sources.Length > 1)
            return sources.SelectMany(sourceId => FindBlockingSteps(sourceId, nodes, incoming, statuses, new HashSet<string>(visited)));
        var alternatives = sources.Select(sourceId => FindBlockingSteps(sourceId, nodes, incoming, statuses, new HashSet<string>(visited)).ToArray()).ToArray();
        return alternatives.FirstOrDefault(items => items.Length == 0) ?? alternatives.SelectMany(items => items);
    }

    private async Task<IReadOnlyList<ProcessInstanceModel>> ReadAsync(string processId, CancellationToken cancellationToken)
    {
        var path = PathFor(processId); if (!File.Exists(path)) return [];
        return JsonSerializer.Deserialize<List<ProcessInstanceModel>>(await File.ReadAllTextAsync(path, cancellationToken),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
    }

    private async Task WriteAsync(string processId, IReadOnlyList<ProcessInstanceModel> instances, CancellationToken cancellationToken)
    {
        await writeLock.WaitAsync(cancellationToken);
        try { Directory.CreateDirectory(root); var path = PathFor(processId); var temporary = path + ".tmp"; await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(instances, new JsonSerializerOptions { WriteIndented = true }), cancellationToken); File.Move(temporary, path, true); }
        finally { writeLock.Release(); }
    }

    private string PathFor(string processId)
    {
        if (processId.Length is < 1 or > 100 || processId.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.'))) throw new InvalidDataException("Недопустимый идентификатор процесса.");
        return Path.Combine(root, processId + ".json");
    }

    private static ProcessInstanceModel RefreshAvailablePlans(ProcessModel process, ProcessInstanceModel instance, DateTimeOffset availableAt)
    {
        var nodes = process.Nodes.ToDictionary(item => item.Id, StringComparer.Ordinal);
        var steps = instance.Steps.Select(step => step.Status == "NotStarted" && !step.AvailableAt.HasValue &&
            IsStepAvailable(process, instance, step.ElementId) && nodes.TryGetValue(step.ElementId, out var node)
                ? ApplyPlan(node, step, availableAt)
                : step).ToArray();
        return instance with { Steps = steps };
    }

    private static StepExecutionModel ApplyPlan(NodeModel node, StepExecutionModel step, DateTimeOffset availableAt)
    {
        var work = ParseNormMinutes(node.WorkDuration);
        var wait = ParseNormMinutes(node.WaitDuration);
        if (!work.HasValue && !wait.HasValue) work = ParseNormMinutes(node.Duration);
        var total = (work ?? 0) + (wait ?? 0);
        var normParts = new[]
        {
            !string.IsNullOrWhiteSpace(node.WorkDuration) ? $"работа: {node.WorkDuration}" : null,
            !string.IsNullOrWhiteSpace(node.WaitDuration) ? $"ожидание: {node.WaitDuration}" : null
        }.Where(item => item is not null).ToArray();
        var normText = normParts.Length > 0 ? string.Join(" · ", normParts!) : node.Duration;
        return step with
        {
            AvailableAt = availableAt,
            NormText = normText,
            PlannedWorkMinutes = work,
            PlannedWaitMinutes = wait,
            PlannedDurationMinutes = total > 0 ? total : null,
            PlannedCompletedAt = total > 0 ? availableAt.AddMinutes(total) : null
        };
    }

    private static StepExecutionModel CompleteTiming(ProcessInstanceModel instance, StepExecutionModel step,
        DateTimeOffset startedAt, DateTimeOffset completedAt)
    {
        var availableAt = step.AvailableAt ?? startedAt;
        var queue = ActiveMinutes(instance, availableAt, startedAt);
        var work = ActiveMinutes(instance, startedAt, completedAt);
        var actual = queue + work;
        double? overdue = step.PlannedDurationMinutes.HasValue ? Math.Max(0, actual - step.PlannedDurationMinutes.Value) : null;
        return step with
        {
            ActualQueueMinutes = Math.Round(queue, 2),
            ActualWorkMinutes = Math.Round(work, 2),
            ActualDurationMinutes = Math.Round(actual, 2),
            OverdueMinutes = overdue.HasValue ? Math.Round(overdue.Value, 2) : null
        };
    }

    private static double ActiveMinutes(ProcessInstanceModel instance, DateTimeOffset from, DateTimeOffset to)
    {
        if (to <= from) return 0;
        var paused = TimeSpan.Zero;
        DateTimeOffset? pausedAt = null;
        foreach (var item in (instance.LifecycleEvents ?? []).OrderBy(item => item.OccurredAt))
        {
            if (item.ToStatus == "Paused") pausedAt = item.OccurredAt;
            if (item.FromStatus != "Paused" || !pausedAt.HasValue) continue;
            paused += Overlap(pausedAt.Value, item.OccurredAt, from, to);
            pausedAt = null;
        }
        if (pausedAt.HasValue) paused += Overlap(pausedAt.Value, to, from, to);
        return Math.Max(0, (to - from - paused).TotalMinutes);
    }

    private static TimeSpan Overlap(DateTimeOffset firstStart, DateTimeOffset firstEnd, DateTimeOffset secondStart, DateTimeOffset secondEnd)
    {
        var start = firstStart > secondStart ? firstStart : secondStart;
        var end = firstEnd < secondEnd ? firstEnd : secondEnd;
        return end > start ? end - start : TimeSpan.Zero;
    }

    private static string LifecycleTitle(string action) => action switch
    {
        "pause" => "Экземпляр приостановлен",
        "resume" => "Экземпляр возобновлён",
        "cancel" => "Экземпляр отменён",
        _ => "Состояние экземпляра изменено"
    };

    private static string FormatMinutes(double value) => value >= 60
        ? $"{Math.Round(value / 60, 1)} ч"
        : $"{Math.Max(1, Math.Round(value))} мин";

    private static double? ParseNormMinutes(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var match = System.Text.RegularExpressions.Regex.Match(value, @"\d+(?:[\.,]\d+)?");
        if (!match.Success) return null;
        var numberText = match.Value.Replace(',', '.');
        if (!double.TryParse(numberText, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var number)) return null;
        var text = value.ToLowerInvariant();
        if (text.Contains("мин")) return number;
        if (text.Contains("час")) return number * 60;
        if (text.Contains("недел")) return number * 5 * 8 * 60;
        if (text.Contains("дн") || text.Contains("день")) return number * 8 * 60;
        return null;
    }
}
