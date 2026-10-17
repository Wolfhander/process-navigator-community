using System.Globalization;
using System.Text.RegularExpressions;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class ProcessScheduleService(ProcessCatalogService catalog, InformationObjectRegistryService registry)
{
    public async Task<ProcessScheduleModel> CalculateAsync(ProcessScheduleRequestModel request, bool includeDrafts,
        CancellationToken cancellationToken = default)
    {
        var direction = request.Direction?.Equals("Backward", StringComparison.OrdinalIgnoreCase) == true ? "Backward"
            : request.Direction?.Equals("Forward", StringComparison.OrdinalIgnoreCase) == true ? "Forward"
            : throw new InvalidDataException("Направление расчёта должно быть Forward или Backward.");
        if (string.IsNullOrWhiteSpace(request.RootProcessId)) throw new InvalidDataException("Выберите исходный процесс.");
        if (request.AnchorDate.Year is < 1000 or > 9000) throw new InvalidDataException("Дата расчёта должна находиться в диапазоне 1000–9000 годов.");
        var calendar = BuildCalendar(request);
        if (!double.IsFinite(request.DurationScalePercent) || !double.IsFinite(request.TransferDelayHours)) throw new InvalidDataException("Числовые параметры должны быть конечными.");
        if (request.DurationScalePercent is < 1 or > 1000) throw new InvalidDataException("Коэффициент длительности должен быть от 1 до 1000 процентов.");
        if (request.TransferDelayHours is < 0 or > 10000) throw new InvalidDataException("Задержка передачи должна быть от 0 до 10 000 часов.");
        var durationFactor = request.DurationScalePercent / 100d;

        var summaries = await catalog.ListAsync(cancellationToken);
        var summaryById = summaries.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        if (!summaryById.ContainsKey(request.RootProcessId)) throw new FileNotFoundException("Процесс не найден.");
        request = request with { RootProcessId = summaryById[request.RootProcessId].Id };

        var originalRegistry = await registry.BuildAsync(includeDrafts, cancellationToken);
        var allDependencies = BuildDependencies(originalRegistry);
        var candidateIds = Traverse(request.RootProcessId, allDependencies, direction);
        if (candidateIds.Count > 200 || allDependencies.Count(item => candidateIds.Contains(item.SourceProcessId) && candidateIds.Contains(item.TargetProcessId)) > 5000)
            throw new InvalidDataException("Цепочка превышает предел: 200 процессов или 5000 зависимостей.");
        ValidateScenarioParameters(request, candidateIds);
        var branches = (request.ProcessBranches ?? new Dictionary<string, IReadOnlyDictionary<string, string>>()).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
        var repetitions = (request.ProcessRepetitions ?? new Dictionary<string, ScheduleRepetitionModel>()).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
        var sourceModels = new List<ProcessModel>();
        var routes = new Dictionary<string, ScheduleRouteResult>(StringComparer.OrdinalIgnoreCase);
        var failures = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in candidateIds)
        {
            ProcessModel process;
            try
            {
                var summary = summaryById.TryGetValue(id, out var known) ? known : throw new InvalidDataException("Каталог изменён во время расчёта. Повторите запрос.");
                process = await catalog.LoadAsync(id, summary.Status == "Draft" || (includeDrafts && summary.HasDraft), cancellationToken);
            }
            catch (Exception exception) when (exception is IOException or InvalidDataException or System.Xml.XmlException or System.Text.Json.JsonException)
            {
                if (branches.ContainsKey(id) || repetitions.ContainsKey(id)) throw new InvalidDataException($"Невозможно проверить сценарий непрочитанного процесса «{id}».");
                failures[id] = exception.Message;
                continue;
            }
            sourceModels.Add(process);
            routes[id] = ScheduleRouteScenario.Build(process, branches.GetValueOrDefault(id), repetitions.GetValueOrDefault(id));
        }
        bool InRoute(InformationObjectOccurrenceModel occurrence) => occurrence.Scope != "Step" ||
            !routes.TryGetValue(occurrence.ProcessId, out var route) || route.ActiveIds.Contains(occurrence.ElementId ?? "");
        var scenarioObjects = originalRegistry.Objects.Select(item => item with {
            Producers = item.Producers.Where(InRoute).ToArray(), Consumers = item.Consumers.Where(InRoute).ToArray(),
            References = item.References.Where(InRoute).ToArray()
        }).ToArray();
        var objectRegistry = originalRegistry with { Objects = scenarioObjects, Issues = InformationObjectRegistryService.Diagnose(scenarioObjects) };
        var effectiveDependencies = BuildDependencies(objectRegistry);
        var relevantIds = Traverse(request.RootProcessId, effectiveDependencies, direction);
        var dependencies = effectiveDependencies.Where(item => relevantIds.Contains(item.SourceProcessId) && relevantIds.Contains(item.TargetProcessId)).ToArray();
        var profiles = (request.ProcessCalendars ?? new Dictionary<string, ScheduleCalendarModel>()).ToDictionary(entry => entry.Key, entry => entry.Value, StringComparer.OrdinalIgnoreCase);
        // Validate even a calendar of a process removed by the selected scenario.
        var allCalendars = candidateIds.ToDictionary(id => id, id => profiles.TryGetValue(id, out var custom)
            ? BuildCalendar(request with { WorkdayStart = custom.WorkdayStart, WorkdayEnd = custom.WorkdayEnd, WorkingDays = custom.WorkingDays, NonWorkingDates = custom.NonWorkingDates, UtcOffsetMinutes = custom.UtcOffsetMinutes }) : calendar, StringComparer.OrdinalIgnoreCase);
        var calendars = relevantIds.ToDictionary(id => id, id => allCalendars[id], StringComparer.OrdinalIgnoreCase);
        var issues = new List<ProcessScheduleIssueModel>();
        var estimates = new Dictionary<string, Estimate>(StringComparer.OrdinalIgnoreCase);
        var uncertaintyReasons = relevantIds.ToDictionary(id => id, _ => new HashSet<string>(StringComparer.CurrentCultureIgnoreCase), StringComparer.OrdinalIgnoreCase);
        foreach (var id in relevantIds)
        {
            if (!routes.TryGetValue(id, out var route))
            {
                issues.Add(new("process-unreadable", "Error", $"Не удалось прочитать процесс: {failures.GetValueOrDefault(id)}", id));
                estimates[id] = new(0, 0, 100, 0, false, []);
                uncertaintyReasons[id].Add("Процесс не удалось прочитать.");
                continue;
            }
            var raw = EstimateProcess(route.Model, request.IncludeWaitTime, route.RepeatedIds, repetitions.GetValueOrDefault(id));
            var scale = request.ProcessDurationScalePercent?.GetValueOrDefault(id, 100) ?? 100;
            var factor = durationFactor * scale / 100d;
            estimates[id] = raw with { Hours = raw.Hours * factor, MaximumHours = raw.MaximumHours * factor, AppliedScalePercent = request.DurationScalePercent * scale / 100d };
            issues.AddRange(raw.Issues);
            if (raw.MissingDurationCount > 0) uncertaintyReasons[id].Add($"Не задан норматив для {raw.MissingDurationCount} шагов.");
            if (raw.HasCycle) uncertaintyReasons[id].Add("Внутри процесса остался цикл без поддержанного правила повторения.");
            if (route.UnresolvedBranches)
            {
                uncertaintyReasons[id].Add("Не выбраны все доступные альтернативы; использована предварительная оценка по длинному пути.");
                issues.Add(new("branch-unresolved", "Warning", "Остались исключающие развилки без выбора исхода. Даты предварительные.", id));
            }
            if (sourceModels.First(model => model.Id.Equals(id, StringComparison.OrdinalIgnoreCase)).Nodes.Any(node => node.Type == "endEvent") && !route.Model.Nodes.Any(node => node.Type == "endEvent"))
            {
                uncertaintyReasons[id].Add("Выбранный маршрут не достигает ни одного завершающего события.");
                issues.Add(new("scenario-no-end", "Warning", "Выбранный маршрут не достигает завершающего события.", id));
            }
            if (route.RepetitionInactive) issues.Add(new("repeat-inactive", "Warning", "Повторяемый участок исключён выбранной ветвью и не добавляет время.", id));
            if (repetitions.GetValueOrDefault(id)?.MaximumRepeats > 0 && scenarioObjects.Any(item =>
                (item.Producers.Any(value => value.ProcessId.Equals(id, StringComparison.OrdinalIgnoreCase) && route.RepeatedIds.Contains(value.ElementId ?? "")) && item.Consumers.Any(value => !value.ProcessId.Equals(id, StringComparison.OrdinalIgnoreCase))) ||
                (item.Consumers.Any(value => value.ProcessId.Equals(id, StringComparison.OrdinalIgnoreCase) && route.RepeatedIds.Contains(value.ElementId ?? "")) && item.Producers.Any(value => !value.ProcessId.Equals(id, StringComparison.OrdinalIgnoreCase)))))
            {
                uncertaintyReasons[id].Add("Межпроцессные передачи внутри повторяемого участка не развёрнуты по отдельным проходам.");
                issues.Add(new("repeat-transfer-unexpanded", "Warning", "Повторяются нормы участка, но межпроцессные передачи по каждому проходу пока не моделируются.", id));
            }
            if (branches.GetValueOrDefault(id)?.Count > 0 || repetitions.ContainsKey(id))
            {
                var unbound = scenarioObjects.Any(item => item.Producers.Concat(item.Consumers).Any(value => value.ProcessId.Equals(id, StringComparison.OrdinalIgnoreCase) && value.Scope != "Step"));
                if (unbound)
                {
                    uncertaintyReasons[id].Add("Границы из паспорта не привязаны к шагам и не могут быть исключены решением развилки.");
                    issues.Add(new("scenario-passport-boundary", "Warning", "Границы паспорта без привязки к шагам оставлены в сценарии и требуют проверки.", id));
                }
            }
        }
        if (candidateIds.Count != relevantIds.Count) issues.Add(new("scenario-chain-pruned", "Warning", $"По выбранным ветвям из цепочки исключено процессов: {candidateIds.Count - relevantIds.Count}. Исходные модели сохранены в снимке."));
        if (estimates.Values.Any(item => !double.IsFinite(item.Hours) || !double.IsFinite(item.MaximumHours) || item.MaximumHours > 200000))
            throw new InvalidDataException("Длительность процесса превышает предел 200 000 часов или не является конечной.");
        foreach (var issue in objectRegistry.Issues)
        {
            var item = objectRegistry.Objects.FirstOrDefault(value => value.Id.Equals(issue.ObjectId, StringComparison.OrdinalIgnoreCase));
            if (item is null) continue;
            var affected = (issue.Code switch
            {
                "missing-producer" => item.Consumers.Where(value => value.Required),
                "missing-consumer" => item.Producers,
                "multiple-producers" or "version-conflict" => item.Consumers,
                "version-source-missing" or "version-unverified" or "archived-in-use" or "draft-in-use" => InformationObjectPolicy.AffectedConsumers(item, issue.Code),
                _ => item.Producers.Concat(item.Consumers)
            }).Where(value => relevantIds.Contains(value.ProcessId)).DistinctBy(value => value.ProcessId, StringComparer.OrdinalIgnoreCase).ToArray();
            foreach (var occurrence in affected)
            {
                issues.Add(new(issue.Code, issue.Severity, $"{item.Name}: {issue.Message}", occurrence.ProcessId, occurrence.ElementId, item.Id));
                if (issue.Code is "missing-producer" or "multiple-producers" or "version-conflict" or "version-source-missing" or "version-unverified")
                    uncertaintyReasons[occurrence.ProcessId].Add($"Ненадёжный вход «{item.Name}»: {issue.Message}");
            }
        }

        foreach (var item in scenarioObjects)
        foreach (var consumer in item.Consumers.Where(value => relevantIds.Contains(value.ProcessId) && (!value.Required || !string.IsNullOrWhiteSpace(value.Condition))))
        {
            uncertaintyReasons[consumer.ProcessId].Add($"Условие или необязательность входа «{item.Name}» не вычисляются автоматически.");
            issues.Add(new("object-condition-unresolved", "Warning", $"«{item.Name}»: текстовые условия и необязательность не исключают передачу автоматически.", consumer.ProcessId, consumer.ElementId, item.Id));
        }

        var order = TopologicalOrder(relevantIds, dependencies, out var hasCycle);
        if (hasCycle)
        {
            issues.Add(new("process-cycle", "Error", "Цепочка процессов содержит цикл. Даты рассчитаны в устойчивом порядке, но требуют ручной проверки."));
            foreach (var processId in relevantIds) uncertaintyReasons[processId].Add("Межпроцессная цепочка содержит цикл.");
        }
        PropagateUncertainty(order, dependencies, direction, uncertaintyReasons, summaryById);

        if (request.ProcessCalendars?.Count > 0) issues.Add(new("calendar-reserve", "Warning", "Критическая цепочка и резерв рассчитаны в номинальных рабочих часах. При разных календарях календарные ожидания могут изменить фактическую критичность."));
        var critical = CalculateCriticalPath(order, dependencies, estimates, request.TransferDelayHours, hasCycle);
        var scheduled = direction == "Forward"
            ? ScheduleForward(order, dependencies, estimates, request.AnchorDate, request.TransferDelayHours, calendars)
            : ScheduleBackward(order, dependencies, estimates, request.AnchorDate, request.TransferDelayHours, calendars);

        var maximumEstimates = estimates.ToDictionary(pair => pair.Key, pair => pair.Value with { Hours = pair.Value.MaximumHours }, StringComparer.OrdinalIgnoreCase);
        var maximumSchedule = direction == "Forward"
            ? ScheduleForward(order, dependencies, maximumEstimates, request.AnchorDate, request.TransferDelayHours, calendars)
            : ScheduleBackward(order, dependencies, maximumEstimates, request.AnchorDate, request.TransferDelayHours, calendars);
        var maximumById = maximumSchedule.ToDictionary(item => item.ProcessId, StringComparer.OrdinalIgnoreCase);
        var items = scheduled.Select(item =>
            {
                DateTimeOffset? checkpoint = null;
                if (request.Checkpoints?.TryGetValue(item.ProcessId, out var checkpointValue) == true) checkpoint = checkpointValue;
                var checkpointDelta = checkpoint is not null ? SignedBusinessHours(checkpoint.Value, item.EndAt, calendars[item.ProcessId]) : (double?)null;
                if (checkpointDelta > .001)
                    issues.Add(new("checkpoint-missed", "Warning",
                        $"Контрольная дата нарушена на {Math.Round(checkpointDelta.Value, 2)} ч.", item.ProcessId));
                return new ProcessScheduleItemModel(item.ProcessId,
                    summaryById.TryGetValue(item.ProcessId, out var summary) ? summary.Name : item.ProcessId,
                    Math.Round(estimates[item.ProcessId].BaseHours, 2), Math.Round(estimates[item.ProcessId].Hours, 2), item.StartAt, item.EndAt,
                    Math.Round(critical.Slack.GetValueOrDefault(item.ProcessId), 2), critical.CriticalIds.Contains(item.ProcessId),
                    Math.Round(estimates[item.ProcessId].AppliedScalePercent, 2), checkpoint,
                    checkpointDelta is null ? null : Math.Round(checkpointDelta.Value, 2), checkpointDelta > .001,
                    uncertaintyReasons[item.ProcessId].Count == 0, uncertaintyReasons[item.ProcessId].OrderBy(value => value).ToArray(),
                    estimates[item.ProcessId].MissingDurationCount, estimates[item.ProcessId].HasCycle,
                    Math.Round(estimates[item.ProcessId].MaximumHours, 2), maximumById[item.ProcessId].StartAt, maximumById[item.ProcessId].EndAt);
            })
            .OrderBy(item => item.StartAt).ThenBy(item => item.ProcessName, StringComparer.CurrentCultureIgnoreCase).ToArray();
        var startAt = items.Min(item => item.StartAt);
        var endAt = items.Max(item => item.EndAt);
        var assumptions = new ProcessScheduleAssumptionsModel(request.IncludeWaitTime, calendar.Start.ToString("hh\\:mm"), calendar.End.ToString("hh\\:mm"),
            calendar.WorkingDays.Select(value => (int)value).OrderBy(value => value).ToArray(), request.DurationScalePercent, request.TransferDelayHours,
            calendar.NonWorkingDates.OrderBy(value => value).Select(value => value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).ToArray(),
            request.ProcessDurationScalePercent ?? new Dictionary<string, double>(), request.Checkpoints ?? new Dictionary<string, DateTimeOffset>(), (int)calendar.Offset.TotalMinutes,
            candidateIds.Where(profiles.ContainsKey).ToDictionary(id => id, id => profiles[id]), branches, repetitions);
        return new(direction, request.RootProcessId, request.AnchorDate, startAt, endAt,
            Math.Round(items.Sum(item => item.DurationHours), 2), Math.Round(critical.DurationHours, 2),
            uncertaintyReasons.Values.All(value => value.Count == 0) && !issues.Any(item => item.Severity == "Error" || item.Code == "internal-cycle"), assumptions,
            items, dependencies, issues.DistinctBy(item => $"{item.Code}:{item.ProcessId}:{item.ElementId}:{item.ObjectId}").ToArray(),
            new("schedule-v3-route-scenario", DateTimeOffset.UtcNow, sourceModels.OrderBy(item => item.Id).ToArray(),
                originalRegistry.Objects.Where(item => item.Producers.Concat(item.Consumers).Any(value => candidateIds.Contains(value.ProcessId))).ToArray()),
            maximumSchedule.Min(item => item.StartAt), maximumSchedule.Max(item => item.EndAt));
    }

    private static WorkCalendar BuildCalendar(ProcessScheduleRequestModel request)
    {
        if (!TimeSpan.TryParseExact(request.WorkdayStart, ["h\\:mm", "hh\\:mm"], CultureInfo.InvariantCulture, out var start)
            || !TimeSpan.TryParseExact(request.WorkdayEnd, ["h\\:mm", "hh\\:mm"], CultureInfo.InvariantCulture, out var end)
            || start < TimeSpan.Zero || end > TimeSpan.FromDays(1) || end <= start)
            throw new InvalidDataException("Проверьте начало и окончание рабочего дня.");
        if (request.WorkingDays?.Count > 7 || request.NonWorkingDates?.Count > 366) throw new InvalidDataException("Допускается до 7 дней недели и 366 исключений календаря.");
        if (request.WorkingDays is { Count: 0 }) throw new InvalidDataException("Выберите хотя бы один рабочий день.");
        var offset = request.UtcOffsetMinutes ?? (int)request.AnchorDate.Offset.TotalMinutes;
        if (offset is < -720 or > 840) throw new InvalidDataException("Сдвиг UTC должен быть от −720 до 840 минут.");
        var days = (request.WorkingDays ?? [1, 2, 3, 4, 5]).Distinct().ToHashSet();
        if (days.Any(day => day is < 0 or > 6)) throw new InvalidDataException("Рабочие дни должны быть заданы числами от 0 (воскресенье) до 6 (суббота).");
        var nonWorkingDates = new HashSet<DateOnly>();
        foreach (var value in request.NonWorkingDates ?? [])
        {
            if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
                throw new InvalidDataException($"Проверьте нерабочую дату «{value}».");
            nonWorkingDates.Add(date);
        }
        if (nonWorkingDates.Count > 366) throw new InvalidDataException("В одном сценарии допускается не более 366 нерабочих дат.");
        return new(start, end, days.Select(day => (DayOfWeek)day).ToHashSet(), nonWorkingDates, TimeSpan.FromMinutes(offset));
    }

    private static void ValidateScenarioParameters(ProcessScheduleRequestModel request, HashSet<string> relevantIds)
    {
        ValidateMap(request.ProcessBranches, relevantIds);
        ValidateMap(request.ProcessRepetitions, relevantIds);
        if (request.ProcessCalendars?.Count > 200) throw new InvalidDataException("Не более 200 календарей в сценарии.");
        if (request.ProcessCalendars?.Keys.Distinct(StringComparer.OrdinalIgnoreCase).Count() != request.ProcessCalendars?.Count) throw new InvalidDataException("ID календарей повторяются с разным регистром.");
        foreach (var entry in request.ProcessCalendars ?? new Dictionary<string, ScheduleCalendarModel>())
            if (!relevantIds.Contains(entry.Key) || entry.Value is null || entry.Value.WorkingDays is null || entry.Value.NonWorkingDates is null) throw new InvalidDataException("Календарь относится к неизвестному процессу или заполнен не полностью.");
        foreach (var (processId, scale) in request.ProcessDurationScalePercent ?? new Dictionary<string, double>())
        {
            if (!relevantIds.Contains(processId)) throw new InvalidDataException($"Процесс «{processId}» не входит в рассчитанную цепочку.");
            if (!double.IsFinite(scale) || scale is < 1 or > 1000) throw new InvalidDataException($"Коэффициент процесса «{processId}» должен быть от 1 до 1000 процентов.");
        }
        if (request.ProcessDurationScalePercent?.Count > 200 || request.Checkpoints?.Count > 200) throw new InvalidDataException("Слишком много параметров сценария.");
        if (request.Checkpoints?.Values.Any(value => value.Year is < 1000 or > 9000) == true) throw new InvalidDataException("Контрольная дата вне допустимого диапазона.");
        foreach (var processId in request.Checkpoints?.Keys ?? [])
            if (!relevantIds.Contains(processId)) throw new InvalidDataException($"Контрольная точка относится к процессу «{processId}», которого нет в рассчитанной цепочке.");
    }

    private static void ValidateMap<T>(IReadOnlyDictionary<string, T>? map, HashSet<string> ids) where T : class
    {
        if (map is null) return;
        if (map.Count > 200 || map.Keys.Distinct(StringComparer.OrdinalIgnoreCase).Count() != map.Count ||
            map.Any(pair => !ids.Contains(pair.Key) || pair.Value is null)) throw new InvalidDataException("Решения и повторы должны относиться к процессам исходной цепочки, без повторных ID и пустых значений (до 200 процессов).");
    }

    private static void PropagateUncertainty(IReadOnlyList<string> order, IReadOnlyList<ProcessScheduleDependencyModel> dependencies,
        string direction, Dictionary<string, HashSet<string>> reasons, IReadOnlyDictionary<string, ProcessSummaryModel> summaries)
    {
        var traversal = direction == "Forward" ? order : order.Reverse();
        foreach (var processId in traversal)
        {
            var influencers = direction == "Forward"
                ? dependencies.Where(item => item.TargetProcessId.Equals(processId, StringComparison.OrdinalIgnoreCase)).Select(item => item.SourceProcessId)
                : dependencies.Where(item => item.SourceProcessId.Equals(processId, StringComparison.OrdinalIgnoreCase)).Select(item => item.TargetProcessId);
            foreach (var influencerId in influencers.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                if (!reasons.TryGetValue(influencerId, out var influencerReasons) || influencerReasons.Count == 0) continue;
                var name = summaries.TryGetValue(influencerId, out var summary) ? summary.Name : influencerId;
                reasons[processId].Add($"Дата зависит от процесса «{name}» с неполными исходными данными.");
            }
        }
    }

    private static ProcessScheduleDependencyModel[] BuildDependencies(InformationObjectRegistryModel registry) =>
        registry.Objects.SelectMany(item =>
            item.Producers.SelectMany(producer => item.Consumers
                .Where(consumer => !consumer.ProcessId.Equals(producer.ProcessId, StringComparison.OrdinalIgnoreCase))
                .Select(consumer => new ProcessScheduleDependencyModel(producer.ProcessId, producer.ProcessName,
                    consumer.ProcessId, consumer.ProcessName, item.Id, item.Name, consumer.Required))))
            .DistinctBy(item => $"{item.SourceProcessId}:{item.TargetProcessId}:{item.ObjectId}", StringComparer.OrdinalIgnoreCase).ToArray();

    private static HashSet<string> Traverse(string rootId, IReadOnlyList<ProcessScheduleDependencyModel> dependencies, string direction)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { rootId };
        var queue = new Queue<string>(); queue.Enqueue(rootId);
        while (queue.TryDequeue(out var current))
        {
            var next = direction == "Forward"
                ? dependencies.Where(item => item.SourceProcessId.Equals(current, StringComparison.OrdinalIgnoreCase)).Select(item => item.TargetProcessId)
                : dependencies.Where(item => item.TargetProcessId.Equals(current, StringComparison.OrdinalIgnoreCase)).Select(item => item.SourceProcessId);
            foreach (var id in next) if (result.Add(id)) queue.Enqueue(id);
        }
        return result;
    }

    private static Estimate EstimateProcess(ProcessModel process, bool includeWait, IReadOnlySet<string> repeatedIds, ScheduleRepetitionModel? repetition)
    {
        var issues = new List<ProcessScheduleIssueModel>();
        var weights = process.Nodes.ToDictionary(node => node.Id, node =>
        {
            if (!node.Type.Equals("task", StringComparison.OrdinalIgnoreCase)) return 0d;
            var work = ParseHours(node.WorkDuration);
            var wait = includeWait ? ParseHours(node.WaitDuration) : 0;
            var fallback = ParseHours(node.Duration);
            if (work is null && wait is null && fallback is null)
            {
                issues.Add(new("missing-duration", "Error", $"Не задана норма времени шага «{node.Name}».", process.Id, node.Id));
                return 0;
            }
            return work.GetValueOrDefault() + wait.GetValueOrDefault() > 0
                ? work.GetValueOrDefault() + wait.GetValueOrDefault()
                : fallback.GetValueOrDefault();
        }, StringComparer.OrdinalIgnoreCase);

        var nodeIds = process.Nodes.Select(node => node.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var edges = process.Edges.Where(edge => nodeIds.Contains(edge.SourceId) && nodeIds.Contains(edge.TargetId)).ToArray();
        var order = TopologicalNodeOrder(nodeIds, edges, out var hasCycle);
        double hours;
        if (hasCycle)
        {
            hours = weights.Values.Sum();
            issues.Add(new("internal-cycle", "Warning", "Внутри процесса есть возвратный цикл. Для предварительного расчёта каждый шаг учтён один раз.", process.Id));
        }
        else
        {
            var longest = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
            foreach (var id in order)
            {
                var incoming = edges.Where(edge => edge.TargetId.Equals(id, StringComparison.OrdinalIgnoreCase))
                    .Select(edge => longest.GetValueOrDefault(edge.SourceId)).DefaultIfEmpty(0).Max();
                longest[id] = incoming + weights.GetValueOrDefault(id);
            }
            hours = longest.Values.DefaultIfEmpty(0).Max();
        }
        var baseHours = hours;
        var maximum = hours;
        if (repetition is not null && repeatedIds.Count > 0)
        {
            var section = process.Edges.Where(edge => repeatedIds.Contains(edge.SourceId) && repeatedIds.Contains(edge.TargetId)).ToArray();
            var sectionOrder = TopologicalNodeOrder(repeatedIds.ToHashSet(StringComparer.OrdinalIgnoreCase), section, out var sectionCycle);
            if (hasCycle || sectionCycle) throw new InvalidDataException("Невозможно оценить повторение участка с дополнительными циклами.");
            var sectionHours = Longest(sectionOrder, section, weights);
            var gate = sectionOrder[^1]; // Every region node reaches the unique terminal return gateway.
            var plannedWeights = new Dictionary<string, double>(weights, StringComparer.OrdinalIgnoreCase);
            plannedWeights[gate] += sectionHours * repetition.PlannedRepeats;
            var maximumWeights = new Dictionary<string, double>(weights, StringComparer.OrdinalIgnoreCase);
            maximumWeights[gate] += sectionHours * repetition.MaximumRepeats;
            hours = Longest(order, edges, plannedWeights);
            maximum = Longest(order, edges, maximumWeights);
            issues.Add(new("repeat-assumption", "Warning", $"Дополнительных проходов участка: план {repetition.PlannedRepeats}, предел {repetition.MaximumRepeats}. Это допущение сценария, не факт выполнения.", process.Id));
        }
        return new(baseHours, hours, 100, issues.Count(item => item.Code == "missing-duration"), hasCycle, issues, maximum);
    }

    private static double Longest(IReadOnlyList<string> order, IReadOnlyList<EdgeModel> edges, IReadOnlyDictionary<string, double> weights)
    {
        var lengths = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in order) lengths[id] = edges.Where(edge => edge.TargetId.Equals(id, StringComparison.OrdinalIgnoreCase))
            .Select(edge => lengths.GetValueOrDefault(edge.SourceId)).DefaultIfEmpty(0).Max() + weights.GetValueOrDefault(id);
        return lengths.Values.DefaultIfEmpty(0).Max();
    }

    private static double? ParseHours(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var matches = DurationPart().Matches(value.ToLowerInvariant().Replace(',', '.'));
        if (matches.Count == 0) return null;
        double total = 0;
        foreach (Match match in matches)
        {
            if (!double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var amount)) continue;
            var unit = match.Groups[2].Value;
            total += unit.StartsWith("мин") ? amount / 60d
                : unit.StartsWith("час") ? amount
                : unit.StartsWith("дн") || unit.StartsWith("день") || unit.StartsWith("дня") ? amount * 8d
                : unit.StartsWith("нед") ? amount * 40d : 0;
        }
        return total > 0 ? total : null;
    }

    private static string[] TopologicalOrder(HashSet<string> ids, IReadOnlyList<ProcessScheduleDependencyModel> dependencies, out bool hasCycle)
    {
        var indegree = ids.ToDictionary(id => id, _ => 0, StringComparer.OrdinalIgnoreCase);
        foreach (var edge in dependencies.Select(item => (item.SourceProcessId, item.TargetProcessId)).Distinct()) indegree[edge.TargetProcessId]++;
        var queue = new Queue<string>(indegree.Where(item => item.Value == 0).Select(item => item.Key).OrderBy(value => value));
        var result = new List<string>();
        while (queue.TryDequeue(out var id))
        {
            result.Add(id);
            foreach (var target in dependencies.Where(item => item.SourceProcessId.Equals(id, StringComparison.OrdinalIgnoreCase)).Select(item => item.TargetProcessId).Distinct(StringComparer.OrdinalIgnoreCase))
                if (--indegree[target] == 0) queue.Enqueue(target);
        }
        hasCycle = result.Count != ids.Count;
        result.AddRange(ids.Except(result, StringComparer.OrdinalIgnoreCase).OrderBy(value => value));
        return result.ToArray();
    }

    private static string[] TopologicalNodeOrder(HashSet<string> ids, IReadOnlyList<EdgeModel> edges, out bool hasCycle)
    {
        var indegree = ids.ToDictionary(id => id, _ => 0, StringComparer.OrdinalIgnoreCase);
        foreach (var edge in edges) indegree[edge.TargetId]++;
        var queue = new Queue<string>(indegree.Where(item => item.Value == 0).Select(item => item.Key));
        var result = new List<string>();
        while (queue.TryDequeue(out var id))
        {
            result.Add(id);
            foreach (var target in edges.Where(edge => edge.SourceId.Equals(id, StringComparison.OrdinalIgnoreCase)).Select(edge => edge.TargetId))
                if (--indegree[target] == 0) queue.Enqueue(target);
        }
        hasCycle = result.Count != ids.Count;
        result.AddRange(ids.Except(result, StringComparer.OrdinalIgnoreCase));
        return result.ToArray();
    }

    private static CriticalPath CalculateCriticalPath(IReadOnlyList<string> order, IReadOnlyList<ProcessScheduleDependencyModel> dependencies,
        IReadOnlyDictionary<string, Estimate> estimates, double transferDelayHours, bool hasCycle)
    {
        if (hasCycle)
            return new(estimates.Values.Sum(value => value.Hours), order.ToHashSet(StringComparer.OrdinalIgnoreCase),
                order.ToDictionary(id => id, _ => 0d, StringComparer.OrdinalIgnoreCase));
        var earliestStart = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        var earliestFinish = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in order)
        {
            earliestStart[id] = dependencies.Where(item => item.TargetProcessId.Equals(id, StringComparison.OrdinalIgnoreCase))
                .Select(item => earliestFinish.GetValueOrDefault(item.SourceProcessId) + transferDelayHours).DefaultIfEmpty(0).Max();
            earliestFinish[id] = earliestStart[id] + estimates[id].Hours;
        }
        var duration = earliestFinish.Values.DefaultIfEmpty(0).Max();
        var latestStart = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        var latestFinish = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in order.Reverse())
        {
            latestFinish[id] = dependencies.Where(item => item.SourceProcessId.Equals(id, StringComparison.OrdinalIgnoreCase))
                .Select(item => latestStart.GetValueOrDefault(item.TargetProcessId) - transferDelayHours).DefaultIfEmpty(duration).Min();
            latestStart[id] = latestFinish[id] - estimates[id].Hours;
        }
        var slack = order.ToDictionary(id => id, id => Math.Max(0, latestStart[id] - earliestStart[id]), StringComparer.OrdinalIgnoreCase);
        return new(duration, slack.Where(item => item.Value < .01).Select(item => item.Key).ToHashSet(StringComparer.OrdinalIgnoreCase), slack);
    }

    private static Scheduled[] ScheduleForward(IReadOnlyList<string> order, IReadOnlyList<ProcessScheduleDependencyModel> dependencies,
        IReadOnlyDictionary<string, Estimate> estimates, DateTimeOffset anchor, double transferDelayHours, IReadOnlyDictionary<string, WorkCalendar> calendars)
    {
        var result = new Dictionary<string, Scheduled>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in order)
        {
            var calendar = calendars[id];
            var predecessorEnds = dependencies.Where(item => item.TargetProcessId.Equals(id, StringComparison.OrdinalIgnoreCase))
                .Select(item => result.TryGetValue(item.SourceProcessId, out var value) ? AddBusinessHours(value.EndAt, transferDelayHours, calendar) : (DateTimeOffset?)null).OfType<DateTimeOffset>().ToArray();
            var start = predecessorEnds.Length == 0 ? NormalizeForward(anchor, calendar) : NormalizeForward(predecessorEnds.Max(), calendar);
            result[id] = new(id, start, AddBusinessHours(start, estimates[id].Hours, calendar));
        }
        return result.Values.ToArray();
    }

    private static Scheduled[] ScheduleBackward(IReadOnlyList<string> order, IReadOnlyList<ProcessScheduleDependencyModel> dependencies,
        IReadOnlyDictionary<string, Estimate> estimates, DateTimeOffset anchor, double transferDelayHours, IReadOnlyDictionary<string, WorkCalendar> calendars)
    {
        var result = new Dictionary<string, Scheduled>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in order.Reverse())
        {
            var calendar = calendars[id];
            var successorStarts = dependencies.Where(item => item.SourceProcessId.Equals(id, StringComparison.OrdinalIgnoreCase))
                .Select(item => result.TryGetValue(item.TargetProcessId, out var value) ? SubtractBusinessHours(value.StartAt, transferDelayHours, calendars[item.TargetProcessId]) : (DateTimeOffset?)null).OfType<DateTimeOffset>().ToArray();
            var end = successorStarts.Length == 0 ? NormalizeBackward(anchor, calendar) : NormalizeBackward(successorStarts.Min(), calendar);
            result[id] = new(id, SubtractBusinessHours(end, estimates[id].Hours, calendar), end);
        }
        return result.Values.ToArray();
    }

    private static DateTimeOffset AddBusinessHours(DateTimeOffset value, double hours, WorkCalendar calendar)
    {
        var current = NormalizeForward(value, calendar); var minutes = Math.Max(0, hours * 60); var days = 0;
        while (minutes > .001)
        {
            if (++days > 100000) throw new InvalidDataException("Расчёт превысил предел 100 000 рабочих дней. Уточните нормы и календарь.");
            var available = (current.Date + calendar.End - current.DateTime).TotalMinutes;
            if (minutes <= available) return current.AddMinutes(minutes);
            minutes -= available; current = NormalizeForward(current.Date.AddDays(1).Add(calendar.Start).WithOffset(current.Offset), calendar);
        }
        return current;
    }

    private static DateTimeOffset SubtractBusinessHours(DateTimeOffset value, double hours, WorkCalendar calendar)
    {
        var current = NormalizeBackward(value, calendar); var minutes = Math.Max(0, hours * 60); var days = 0;
        while (minutes > .001)
        {
            if (++days > 100000) throw new InvalidDataException("Расчёт превысил предел 100 000 рабочих дней. Уточните нормы и календарь.");
            var available = (current.DateTime - (current.Date + calendar.Start)).TotalMinutes;
            if (minutes <= available) return current.AddMinutes(-minutes);
            minutes -= available; current = NormalizeBackward(current.Date.AddDays(-1).Add(calendar.End).WithOffset(current.Offset), calendar);
        }
        return current;
    }

    private static double SignedBusinessHours(DateTimeOffset from, DateTimeOffset to, WorkCalendar calendar)
    {
        if (from == to) return 0;
        if (to < from) return -SignedBusinessHours(to, from, calendar);
        var current = from.ToOffset(calendar.Offset);
        to = to.ToOffset(calendar.Offset);
        double minutes = 0; var days = 0;
        while (current < to)
        {
            if (++days > 100000) throw new InvalidDataException("Слишком далёкая контрольная дата для сравнения.");
            current = NormalizeForward(current, calendar);
            if (current >= to) break;
            var endOfDay = current.Date.Add(calendar.End).WithOffset(current.Offset);
            var segmentEnd = endOfDay < to ? endOfDay : to;
            minutes += Math.Max(0, (segmentEnd - current).TotalMinutes);
            current = segmentEnd >= endOfDay ? current.Date.AddDays(1).Add(calendar.Start).WithOffset(current.Offset) : segmentEnd;
        }
        return minutes / 60d;
    }

    private static DateTimeOffset NormalizeForward(DateTimeOffset value, WorkCalendar calendar)
    {
        var current = value.ToOffset(calendar.Offset);
        while (!IsWorkingDay(current, calendar)) current = current.Date.AddDays(1).Add(calendar.Start).WithOffset(current.Offset);
        if (current.TimeOfDay < calendar.Start) return current.Date.Add(calendar.Start).WithOffset(current.Offset);
        if (current.TimeOfDay >= calendar.End) return NormalizeForward(current.Date.AddDays(1).Add(calendar.Start).WithOffset(current.Offset), calendar);
        return current;
    }

    private static DateTimeOffset NormalizeBackward(DateTimeOffset value, WorkCalendar calendar)
    {
        var current = value.ToOffset(calendar.Offset);
        while (!IsWorkingDay(current, calendar)) current = current.Date.AddDays(-1).Add(calendar.End).WithOffset(current.Offset);
        if (current.TimeOfDay > calendar.End) return current.Date.Add(calendar.End).WithOffset(current.Offset);
        if (current.TimeOfDay < calendar.Start) return NormalizeBackward(current.Date.AddDays(-1).Add(calendar.End).WithOffset(current.Offset), calendar);
        return current;
    }

    private static bool IsWorkingDay(DateTimeOffset value, WorkCalendar calendar) =>
        calendar.WorkingDays.Contains(value.DayOfWeek) && !calendar.NonWorkingDates.Contains(DateOnly.FromDateTime(value.Date));

    private sealed record Estimate(double BaseHours, double Hours, double AppliedScalePercent, int MissingDurationCount, bool HasCycle, IReadOnlyList<ProcessScheduleIssueModel> Issues, double MaximumHours = 0);
    private sealed record Scheduled(string ProcessId, DateTimeOffset StartAt, DateTimeOffset EndAt);
    private sealed record CriticalPath(double DurationHours, HashSet<string> CriticalIds, IReadOnlyDictionary<string, double> Slack);
    private sealed record WorkCalendar(TimeSpan Start, TimeSpan End, HashSet<DayOfWeek> WorkingDays, HashSet<DateOnly> NonWorkingDates, TimeSpan Offset);

    [GeneratedRegex("(\\d+(?:\\.\\d+)?)\\s*(?:рабоч(?:ий|ая|ее|его|ей|их)\\s+)?(минут(?:а|ы)?|мин|час(?:а|ов)?|день|дня|дней|дн(?:я|ей)?|недел(?:я|и|ь))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DurationPart();
}

internal static class DateTimeOffsetExtensions
{
    public static DateTimeOffset WithOffset(this DateTime value, TimeSpan offset) => new(value, offset);
}
