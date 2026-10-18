using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed record TransferFinding(string ProcessId, string ProcessName, string Code, string ElementId,
    string ElementName, string? TargetId, string? TargetName, IReadOnlyList<string> SourceSystems,
    IReadOnlyList<string> TargetSystems, IReadOnlyList<string> ObjectIds, string Explanation);
public sealed record TransferAnalyticsReport(DateTimeOffset GeneratedAt, int ProcessCount, IReadOnlyList<TransferFinding> Findings);

public sealed class TransferAnalyticsService(ProcessCatalogService catalog)
{
    public async Task<TransferAnalyticsReport> BuildAsync(CancellationToken cancellationToken)
    {
        var summaries = await catalog.ListAsync(cancellationToken);
        var findings = new List<TransferFinding>();
        foreach (var summary in summaries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var process = await catalog.LoadAsync(summary.Id, summary.Status.Equals("Draft", StringComparison.OrdinalIgnoreCase), cancellationToken);
            findings.AddRange(Analyze(process));
        }
        return new(DateTimeOffset.UtcNow, summaries.Count, findings);
    }

    private static string[] WorkSystems(NodeModel node) => (node.Channels ?? [])
        .Where(c => c.Kind == "system" && c.Direction == "work").Select(c => c.SystemName ?? "")
        .Concat(node.ExecutionMode == "system" ? [node.SystemName ?? ""] : Array.Empty<string>())
        .Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(s => s, StringComparer.OrdinalIgnoreCase).ToArray();

    public static IReadOnlyList<TransferFinding> Analyze(ProcessModel process)
    {
        var result = new List<TransferFinding>();
        void Add(string code, NodeModel node, string explanation, NodeModel? target = null, string[]? objects = null) =>
            result.Add(new(process.Id, process.Name, code, node.Id, node.Name, target?.Id, target?.Name,
                WorkSystems(node), target is null ? [] : WorkSystems(target), objects ?? [], explanation));
        var nodes = process.Nodes.ToDictionary(n => n.Id, StringComparer.Ordinal);
        foreach (var node in process.Nodes.Where(n => n.Type == "task"))
        {
            var work = (node.Channels ?? []).Where(c => c.Direction == "work").ToArray();
            if (node.ExecutionMode == "manual" || (work.Length > 0 && work.All(c => c.Kind != "system")))
                Add("outside-system", node, "Указана ручная работа или только внесистемные рабочие каналы. Это описание модели, не журнал выполнения.");
            else if (WorkSystems(node).Length == 0)
                Add("system-unspecified", node, "Система выполнения не указана. Отсутствие сведений не доказывает ручную работу.");

            foreach (var group in (node.Channels ?? []).Where(c => c.Kind == "paper").GroupBy(c => (c.Direction, c.Flow)))
            {
                var objectIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var ambiguous = false;
                foreach (var channel in group)
                {
                    var matches = (node.InformationObjects ?? []).Where(binding =>
                        ((channel.Direction == "input" && binding.Role == "Input") || (channel.Direction == "output" && binding.Role == "Output"))
                        && !string.IsNullOrWhiteSpace(channel.DocumentName)
                        && string.Equals(binding.Name.Trim(), channel.DocumentName.Trim(), StringComparison.OrdinalIgnoreCase)).Select(b => b.ObjectId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                    if (matches.Length == 1) objectIds.Add(matches[0]); else ambiguous = true;
                }
                var code = group.Key.Flow == "parallel" ? "paper-parallel" : group.Key.Flow == "alternative" ? "paper-alternative" : "paper-primary";
                Add(code, node, $"Бумажный канал: {group.Key.Direction}; режим {group.Key.Flow}. " +
                    (ambiguous ? "Не все документы однозначно сопоставлены по названию и направлению; уточните привязки. " : "Документы сопоставлены по названию и направлению. ") +
                    "Это признак бумажной передачи, не доказательство потери документа или обязательности бумаги во всех случаях.", objects: objectIds.Order().ToArray());
            }
        }
        foreach (var edge in process.Edges)
        {
            if (!nodes.TryGetValue(edge.SourceId, out var source) || !nodes.TryGetValue(edge.TargetId, out var target) || source.Type != "task" || target.Type != "task") continue;
            var from = WorkSystems(source); var to = WorkSystems(target);
            if (from.Length == 0 || to.Length == 0 || from.Intersect(to, StringComparer.OrdinalIgnoreCase).Any()) continue;
            var outputs = (source.InformationObjects ?? []).Where(b => b.Role == "Output").Select(b => b.ObjectId).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var shared = (target.InformationObjects ?? []).Where(b => b.Role == "Input" && outputs.Contains(b.ObjectId)).Select(b => b.ObjectId).Distinct(StringComparer.OrdinalIgnoreCase).Order().ToArray();
            Add("system-transition", source, "Прямая связь BPMN между разными системами выполнения. " +
                (shared.Length > 0 ? "Есть общие ID выходов и входов. " : "Общий документ по ID не установлен. ") +
                "Способ переноса не подтверждён: проверьте автоматический обмен или ручной ввод. Повторный ввод не считается доказанным.", target, shared);
        }
        return result;
    }
}
