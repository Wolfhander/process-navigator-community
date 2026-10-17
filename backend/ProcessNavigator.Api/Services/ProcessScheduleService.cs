using System.Globalization;
using System.Text.RegularExpressions;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class ProcessScheduleService(ProcessCatalogService catalog, InformationObjectRegistryService registry)
{
    public async Task<ProcessScheduleModel> CalculateAsync(ProcessScheduleRequestModel request, bool includeDrafts,
        CancellationToken cancellationToken = default)
    {
        var direction = request.Direction.Equals("Backward", StringComparison.OrdinalIgnoreCase) ? "Backward"
            : request.Direction.Equals("Forward", StringComparison.OrdinalIgnoreCase) ? "Forward"
            : throw new InvalidDataException("Направление расчёта должно быть Forward или Backward.");
        if (string.IsNullOrWhiteSpace(request.RootProcessId)) throw new InvalidDataException("Выберите исходный процесс.");
        var calendar = BuildCalendar(request);
        if (request.DurationScalePercent is < 1 or > 1000) throw new InvalidDataException("Коэффициент длительности должен быть от 1 до 1000 процентов.");
        if (request.TransferDelayHours is < 0 or > 10000) throw new InvalidDataException("Задержка передачи должна быть от 0 до 10 000 часов.");
        var durationFactor = request.DurationScalePercent / 100d;

        var summaries = await catalog.ListAsync(cancellationToken);
        var summaryById = summaries.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
        if (!summaryById.ContainsKey(request.RootProcessId)) throw new FileNotFoundException("Процесс не найден.");

        var objectRegistry = await registry.BuildAsync(includeDrafts, cancellationToken);
        var allDependencies = BuildDependencies(objectRegistry);
        var relevantIds = Traverse(request.RootProcessId, allDependencies, direction);
        var dependencies = allDependencies.Where(item => relevantIds.Contains(item.SourceProcessId) && relevantIds.Contains(item.TargetProcessId)).ToArray();
        ValidateScenarioParameters(request, relevantIds);
        var issues = new List<ProcessScheduleIssueModel>();
        var estimates = new Dictionary<string, Estimate>(StringComparer.OrdinalIgnoreCase);
        var uncertaintyReasons = relevantIds.ToDictionary(id => id, _ => new HashSet<string>(StringComparer.CurrentCultureIgnoreCase), StringComparer.OrdinalIgnoreCase);

        foreach (var processId in relevantIds)
        {
            try
            {
                var summary = summaryById[processId];
                var useDraft = summary.Status == "Draft" || (includeDrafts && summary.HasDraft);
                var process = await catalog.LoadAsync(processId, useDraft, cancellationToken);
                var rawEstimate = EstimateProcess(process, request.IncludeWaitTime);
                var processScale = request.ProcessDurationScalePercent?.GetValueOrDefault(processId, 100) ?? 100;
                var appliedScale = request.DurationScalePercent * processScale / 100d;
                var estimate = rawEstimate with { Hours = rawEstimate.Hours * durationFactor * processScale / 100d, AppliedScalePercent = appliedScale };
                estimates[processId] = estimate;
                issues.AddRange(estimate.Issues);
                if (estimate.MissingDurationCount > 0)
                    uncertaintyReasons[processId].Add($"Не задан норматив для {estimate.MissingDurationCount} шагов.");
                if (estimate.HasCycle)
                    uncertaintyReasons[processId].Add("Внутри процесса есть возвратный цикл без правила повторения.");
            }
            catch (Exception exception) when (exception is IOException or InvalidDataException or System.Xml.XmlException or System.Text.Json.JsonException)
            {
                issues.Add(new("process-unreadable", "Error", $"Не удалось прочитать процесс: {exception.Message}", processId));
                estimates[processId] = new(0, 0, 100, 0, false, []);
                uncertaintyReasons[processId].Add("Процесс не удалось прочитать.");
            }
        }

        foreach (var issue in objectRegistry.Issues)
        {
            var item = objectRegistry.Objects.FirstOrDefault(value => value.Id.Equals(issue.ObjectId, StringComparison.OrdinalIgnoreCase));
            if (item is null) continue;
            var affected = (issue.Code switch
            {
                "missing-producer" => item.Consumers.Where(value => value.Required),
                "missing-consumer" => item.Producers,
                "multiple-producers" or "version-conflict" => item.Consumers,
                _ => item.Producers.Concat(item.Consumers)
            }).Where(value => relevantIds.Contains(value.ProcessId)).DistinctBy(value => value.ProcessId, StringComparer.OrdinalIgnoreCase).ToArray();
            foreach (var occurrence in affected)
            {
                issues.Add(new(issue.Code, issue.Severity, $"{item.Name}: {issue.Message}", occurrence.ProcessId, occurrence.ElementId, item.Id));
                if (issue.Code is "missing-producer" or "multiple-producers" or "version-conflict")
                    uncertaintyReasons[occurrence.ProcessId].Add($"Ненадёжный вход «{item.Name}»: {issue.Message}");
            }
        }

        var order = TopologicalOrder(relevantIds, dependencies, out var hasCycle);
        if (hasCycle)
        {
            issues.Add(new("process-cycle", "Error", "Цепочка процессов содержит цикл. Даты рассчитаны в устойчивом порядке, но требуют ручной проверки."));
            foreach (var processId in relevantIds) uncertaintyReasons[processId].Add("Межпроцессная цепочка содержит цикл.");
        }
        PropagateUncertainty(order, dependencies, direction, uncertaintyReasons, summaryById);

        var critical = CalculateCriticalPath(order, dependencies, estimates, request.TransferDelayHours, hasCycle);
        var scheduled = direction == "Forward"
            ? ScheduleForward(order, dependencies, estimates, request.AnchorDate, request.TransferDelayHours, calendar)
            : ScheduleBackward(order, dependencies, estimates, request.AnchorDate, request.TransferDelayHours, calendar);

        var items = scheduled.Select(item =>
            {
                DateTimeOffset? checkpoint = null;
                if (request.Checkpoints?.TryGetValue(item.ProcessId, out var checkpointValue) == true) checkpoint = checkpointValue;
                var checkpointDelta = checkpoint is not null ? SignedBusinessHours(checkpoint.Value, item.EndAt, calendar) : (double?)null;
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
                    estimates[item.ProcessId].MissingDurationCount, estimates[item.ProcessId].HasCycle);
            })
            .OrderBy(item => item.StartAt).ThenBy(item => item.ProcessName, StringComparer.CurrentCultureIgnoreCase).ToArray();
        var startAt = items.Min(item => item.StartAt);
        var endAt = items.Max(item => item.EndAt);
        var assumptions = new ProcessScheduleAssumptionsModel(request.IncludeWaitTime, calendar.Start.ToString("hh\\:mm"), calendar.End.ToString("hh\\:mm"),
            calendar.WorkingDays.Select(value => (int)value).OrderBy(value => value).ToArray(), request.DurationScalePercent, request.TransferDelayHours,
            calendar.NonWorkingDates.OrderBy(value => value).Select(value => value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).ToArray(),
            request.ProcessDurationScalePercent ?? new Dictionary<string, double>(), request.Checkpoints ?? new Dictionary<string, DateTimeOffset>());
        return new(direction, request.RootProcessId, request.AnchorDate, startAt, endAt,
            Math.Round(items.Sum(item => item.DurationHours), 2), Math.Round(critical.DurationHours, 2),
            uncertaintyReasons.Values.All(value => value.Count == 0) && !issues.Any(item => item.Severity == "Error" || item.Code == "internal-cycle"), assumptions,
            items, dependencies, issues.DistinctBy(item => $"{item.Code}:{item.ProcessId}:{item.ElementId}:{item.ObjectId}").ToArray());
    }

    private static WorkCalendar BuildCalendar(ProcessScheduleRequestModel request)
    {
        if (!TimeSpan.TryParseExact(request.WorkdayStart, ["h\\:mm", "hh\\:mm"], CultureInfo.InvariantCulture, out var start)
            || !TimeSpan.TryParseExact(request.WorkdayEnd, ["h\\:mm", "hh\\:mm"], CultureInfo.InvariantCulture, out var end)
            || start < TimeSpan.Zero || end > TimeSpan.FromDays(1) || end <= start)
            throw new InvalidDataException("Проверьте начало и окончание рабочего дня.");
        var days = (request.WorkingDays is { Count: > 0 } ? request.WorkingDays : [1, 2, 3, 4, 5]).Distinct().ToHashSet();
        if (days.Any(day => day is < 0 or > 6)) throw new InvalidDataException("Рабочие дни должны быть заданы числами от 0 (воскресенье) до 6 (суббота).");
        var nonWorkingDates = new HashSet<DateOnly>();
        foreach (var value in request.NonWorkingDates ?? [])
        {
            if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
                throw new InvalidDataException($"Проверьте нерабочую дату «{value}».");
            nonWorkingDates.Add(date);
        }
        if (nonWorkingDates.Count > 366) throw new InvalidDataException("В одном сценарии допускается не более 366 нерабочих дат.");
        return new(start, end, days.Select(day => (DayOfWeek)day).ToHashSet(), nonWorkingDates);
    }

    private static void ValidateScenarioParameters(ProcessScheduleRequestModel request, HashSet<string> relevantIds)
    {
        foreach (var (processId, scale) in request.ProcessDurationScalePercent ?? new Dictionary<string, double>())
        {
            if (!relevantIds.Contains(processId)) throw new InvalidDataException($"Процесс «{processId}» не входит в рассчитанную цепочку.");
            if (scale is < 1 or > 1000) throw new InvalidDataException($"Коэффициент процесса «{processId}» должен быть от 1 до 1000 процентов.");
        }
        foreach (var processId in request.Checkpoints?.Keys ?? [])
            if (!relevantIds.Contains(processId)) throw new InvalidDataException($"Контрольная точка относится к процессу «{processId}», которого нет в рассчитанной цепочке.");
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

    private static Estimate EstimateProcess(ProcessModel process, bool includeWait)
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
        return new(hours, hours, 100, issues.Count(item => item.Code == "missing-duration"), hasCycle, issues);
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
            foreach (var target in edges.Where(edge => edge.SourceId.Equals(id, StringComparison.OrdinalIgnoreCase)).Select(edge => edge.TargetId).Distinct(StringComparer.OrdinalIgnoreCase))
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
        IReadOnlyDictionary<string, Estimate> estimates, DateTimeOffset anchor, double transferDelayHours, WorkCalendar calendar)
    {
        var result = new Dictionary<string, Scheduled>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in order)
        {
            var predecessorEnds = dependencies.Where(item => item.TargetProcessId.Equals(id, StringComparison.OrdinalIgnoreCase))
                .Select(item => result.TryGetValue(item.SourceProcessId, out var value) ? AddBusinessHours(value.EndAt, transferDelayHours, calendar) : (DateTimeOffset?)null).OfType<DateTimeOffset>().ToArray();
            var start = predecessorEnds.Length == 0 ? NormalizeForward(anchor, calendar) : NormalizeForward(predecessorEnds.Max(), calendar);
            result[id] = new(id, start, AddBusinessHours(start, estimates[id].Hours, calendar));
        }
        return result.Values.ToArray();
    }

    private static Scheduled[] ScheduleBackward(IReadOnlyList<string> order, IReadOnlyList<ProcessScheduleDependencyModel> dependencies,
        IReadOnlyDictionary<string, Estimate> estimates, DateTimeOffset anchor, double transferDelayHours, WorkCalendar calendar)
    {
        var result = new Dictionary<string, Scheduled>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in order.Reverse())
        {
            var successorStarts = dependencies.Where(item => item.SourceProcessId.Equals(id, StringComparison.OrdinalIgnoreCase))
                .Select(item => result.TryGetValue(item.TargetProcessId, out var value) ? SubtractBusinessHours(value.StartAt, transferDelayHours, calendar) : (DateTimeOffset?)null).OfType<DateTimeOffset>().ToArray();
            var end = successorStarts.Length == 0 ? NormalizeBackward(anchor, calendar) : NormalizeBackward(successorStarts.Min(), calendar);
            result[id] = new(id, SubtractBusinessHours(end, estimates[id].Hours, calendar), end);
        }
        return result.Values.ToArray();
    }

    private static DateTimeOffset AddBusinessHours(DateTimeOffset value, double hours, WorkCalendar calendar)
    {
        var current = NormalizeForward(value, calendar); var minutes = Math.Max(0, hours * 60);
        while (minutes > .001)
        {
            var available = (current.Date + calendar.End - current.DateTime).TotalMinutes;
            if (minutes <= available) return current.AddMinutes(minutes);
            minutes -= available; current = NormalizeForward(current.Date.AddDays(1).Add(calendar.Start).WithOffset(current.Offset), calendar);
        }
        return current;
    }

    private static DateTimeOffset SubtractBusinessHours(DateTimeOffset value, double hours, WorkCalendar calendar)
    {
        var current = NormalizeBackward(value, calendar); var minutes = Math.Max(0, hours * 60);
        while (minutes > .001)
        {
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
        var current = from;
        double minutes = 0;
        while (current < to)
        {
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
        var current = value;
        while (!IsWorkingDay(current, calendar)) current = current.Date.AddDays(1).Add(calendar.Start).WithOffset(current.Offset);
        if (current.TimeOfDay < calendar.Start) return current.Date.Add(calendar.Start).WithOffset(current.Offset);
        if (current.TimeOfDay >= calendar.End) return NormalizeForward(current.Date.AddDays(1).Add(calendar.Start).WithOffset(current.Offset), calendar);
        return current;
    }

    private static DateTimeOffset NormalizeBackward(DateTimeOffset value, WorkCalendar calendar)
    {
        var current = value;
        while (!IsWorkingDay(current, calendar)) current = current.Date.AddDays(-1).Add(calendar.End).WithOffset(current.Offset);
        if (current.TimeOfDay > calendar.End) return current.Date.Add(calendar.End).WithOffset(current.Offset);
        if (current.TimeOfDay < calendar.Start) return NormalizeBackward(current.Date.AddDays(-1).Add(calendar.End).WithOffset(current.Offset), calendar);
        return current;
    }

    private static bool IsWorkingDay(DateTimeOffset value, WorkCalendar calendar) =>
        calendar.WorkingDays.Contains(value.DayOfWeek) && !calendar.NonWorkingDates.Contains(DateOnly.FromDateTime(value.Date));

    private sealed record Estimate(double BaseHours, double Hours, double AppliedScalePercent, int MissingDurationCount, bool HasCycle, IReadOnlyList<ProcessScheduleIssueModel> Issues);
    private sealed record Scheduled(string ProcessId, DateTimeOffset StartAt, DateTimeOffset EndAt);
    private sealed record CriticalPath(double DurationHours, HashSet<string> CriticalIds, IReadOnlyDictionary<string, double> Slack);
    private sealed record WorkCalendar(TimeSpan Start, TimeSpan End, HashSet<DayOfWeek> WorkingDays, HashSet<DateOnly> NonWorkingDates);

    [GeneratedRegex("(\\d+(?:\\.\\d+)?)\\s*(?:рабоч(?:ий|ая|ее|его|ей|их)\\s+)?(минут(?:а|ы)?|мин|час(?:а|ов)?|день|дня|дней|дн(?:я|ей)?|недел(?:я|и|ь))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DurationPart();
}

internal static class DateTimeOffsetExtensions
{
    public static DateTimeOffset WithOffset(this DateTime value, TimeSpan offset) => new(value, offset);
}
