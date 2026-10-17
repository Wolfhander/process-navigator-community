using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed record ScheduleRouteResult(ProcessModel Model, IReadOnlySet<string> ActiveIds,
    IReadOnlySet<string> RepeatedIds, bool UnresolvedBranches, bool RepetitionInactive);

/// <summary>Explicit structural scenario, not BPMN token execution or condition evaluation.</summary>
public static class ScheduleRouteScenario
{
    public static ScheduleRouteResult Build(ProcessModel process, IReadOnlyDictionary<string, string>? choices,
        ScheduleRepetitionModel? repetition)
    {
        if (process.Nodes.Count > 10000 || process.Edges.Count > 20000) throw new InvalidDataException("Схема превышает предел сценария: 10 000 элементов или 20 000 стрелок.");
        var nodes = process.Nodes.ToDictionary(node => node.Id, StringComparer.OrdinalIgnoreCase);
        var outgoing = process.Edges.GroupBy(edge => edge.SourceId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.OrdinalIgnoreCase);
        if (choices?.Count > 200 || choices?.Keys.Distinct(StringComparer.OrdinalIgnoreCase).Count() != choices?.Count)
            throw new InvalidDataException("Не более 200 неповторяющихся решений развилок на процесс.");
        var selected = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (gateway, edgeId) in choices ?? new Dictionary<string, string>())
        {
            if (!nodes.TryGetValue(gateway, out var node) || node.Type != "exclusiveGateway" ||
                !outgoing.TryGetValue(gateway, out var edges) || edges.Length < 2 || !edges.Any(edge => edge.Id.Equals(edgeId, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException($"Решение развилки «{gateway}» не соответствует исходящей стрелке исключающего шлюза.");
            selected.Add(gateway, edgeId);
        }
        EdgeModel? back = null;
        if (repetition is not null)
        {
            if (repetition.PlannedRepeats < 0 || repetition.MaximumRepeats < repetition.PlannedRepeats || repetition.MaximumRepeats > 50)
                throw new InvalidDataException("Дополнительные проходы: 0 ≤ плановое число ≤ предельное число ≤ 50.");
            back = process.Edges.FirstOrDefault(edge => edge.Id.Equals(repetition.ReturnEdgeId, StringComparison.OrdinalIgnoreCase));
            if (back is null || !nodes.TryGetValue(back.SourceId, out var gate) || gate.Type != "exclusiveGateway" ||
                !outgoing.TryGetValue(back.SourceId, out var exits) || exits.Length != 2 || selected.ContainsKey(back.SourceId))
                throw new InvalidDataException("Повтор задаётся одной возвратной стрелкой исключающего шлюза с двумя выходами, без одновременного выбора исхода этого шлюза.");
        }
        var filtered = process.Edges.Where(edge => (back is null || edge.Id != back.Id) &&
            (!selected.TryGetValue(edge.SourceId, out var selectedId) || edge.Id.Equals(selectedId, StringComparison.OrdinalIgnoreCase))).ToArray();
        var starts = process.Nodes.Where(node => node.Type == "startEvent").Select(node => node.Id).ToArray();
        if (starts.Length == 0) starts = process.Nodes.Where(node => !process.Edges.Any(edge => edge.TargetId.Equals(node.Id, StringComparison.OrdinalIgnoreCase))).Select(node => node.Id).ToArray();
        // Rootless cyclic models stay visible for conservative cycle diagnostics.
        var active = starts.Length == 0 ? nodes.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase) : Walk(starts, filtered, false);
        var edgesActive = filtered.Where(edge => active.Contains(edge.SourceId) && active.Contains(edge.TargetId)).ToArray();
        var repeated = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var inactive = back is not null && !active.Contains(back.SourceId);
        if (back is not null && !inactive)
        {
            var fromTarget = Walk([back.TargetId], edgesActive, false);
            var toSource = Walk([back.SourceId], edgesActive, true);
            repeated.UnionWith(fromTarget.Intersect(toSource, StringComparer.OrdinalIgnoreCase));
            if (!repeated.Contains(back.TargetId) || !repeated.Contains(back.SourceId))
                throw new InvalidDataException("Возвратная стрелка не замыкает достижимый участок выбранного маршрута.");
            if (process.Nodes.Any(node => repeated.Contains(node.Id) && node.Type == "parallelGateway") ||
                edgesActive.Any(edge => repeated.Contains(edge.SourceId) && !repeated.Contains(edge.TargetId) && edge.SourceId != back.SourceId) ||
                edgesActive.Any(edge => !repeated.Contains(edge.SourceId) && repeated.Contains(edge.TargetId) && edge.TargetId != back.TargetId) ||
                edgesActive.GroupBy(edge => edge.SourceId).Any(group => repeated.Contains(group.Key) && nodes[group.Key].Type != "exclusiveGateway" && group.Count() > 1))
                throw new InvalidDataException("Повторяемый участок должен иметь один вход и выход, без параллельных шлюзов и пересекающих связей внутри. Параллельная работа вне участка допускается.");
            var exit = outgoing[back.SourceId].Single(edge => edge.Id != back.Id);
            if (repeated.Contains(exit.TargetId)) throw new InvalidDataException("Оба выхода шлюза остаются внутри повторяемого участка.");
            if (HasCycle(active, edgesActive)) throw new InvalidDataException("После удаления возврата остались циклы. Вложенные и пересекающиеся повторения пока не поддерживаются.");
        }
        var unresolved = process.Nodes.Any(node => active.Contains(node.Id) && node.Type == "exclusiveGateway" &&
            outgoing.GetValueOrDefault(node.Id)?.Length > 1 && !selected.ContainsKey(node.Id) && node.Id != back?.SourceId);
        return new(process with { Nodes = process.Nodes.Where(node => active.Contains(node.Id)).ToArray(), Edges = edgesActive }, active, repeated, unresolved, inactive);
    }

    private static HashSet<string> Walk(IEnumerable<string> roots, IReadOnlyList<EdgeModel> edges, bool reverse)
    {
        var adjacency = edges.GroupBy(edge => reverse ? edge.TargetId : edge.SourceId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Select(edge => reverse ? edge.SourceId : edge.TargetId).ToArray(), StringComparer.OrdinalIgnoreCase);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var queue = new Queue<string>(roots);
        while (queue.TryDequeue(out var id)) if (seen.Add(id))
            foreach (var next in adjacency.GetValueOrDefault(id) ?? []) queue.Enqueue(next);
        return seen;
    }
    private static bool HasCycle(IReadOnlySet<string> nodes, IReadOnlyList<EdgeModel> edges)
    {
        var counts = nodes.ToDictionary(id => id, _ => 0, StringComparer.OrdinalIgnoreCase);
        foreach (var edge in edges) counts[edge.TargetId]++;
        var queue = new Queue<string>(counts.Where(pair => pair.Value == 0).Select(pair => pair.Key));
        var outgoing = edges.GroupBy(edge => edge.SourceId, StringComparer.OrdinalIgnoreCase).ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.OrdinalIgnoreCase);
        var visited = 0;
        while (queue.TryDequeue(out var id)) { visited++; foreach (var edge in outgoing.GetValueOrDefault(id) ?? []) if (--counts[edge.TargetId] == 0) queue.Enqueue(edge.TargetId); }
        return visited != nodes.Count;
    }
}
