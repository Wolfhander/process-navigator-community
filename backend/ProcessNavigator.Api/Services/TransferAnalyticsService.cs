using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed record TransferFinding(string ProcessId, string ProcessName, string Code, string ElementId,
    string ElementName, string? TargetId, string? TargetName, IReadOnlyList<string> SourceSystems,
    IReadOnlyList<string> TargetSystems, IReadOnlyList<string> ObjectIds, string Explanation,
    IReadOnlyList<string>? RouteElementIds = null, string? SourceProcessId = null, string? TargetProcessId = null);
public sealed record TransferAnalyticsReport(DateTimeOffset GeneratedAt, int ProcessCount, IReadOnlyList<TransferFinding> Findings);

public sealed class TransferAnalyticsService(ProcessCatalogService catalog)
{
    public async Task<TransferAnalyticsReport> BuildAsync(CancellationToken cancellationToken)
    {
        var summaries = await catalog.ListAsync(cancellationToken);
        var findings = new List<TransferFinding>();
        var models = new List<ProcessModel>();
        foreach (var summary in summaries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var process = await catalog.LoadAsync(summary.Id, summary.Status.Equals("Draft", StringComparison.OrdinalIgnoreCase), cancellationToken);
            models.Add(process);
            findings.AddRange(Analyze(process, cancellationToken));
        }
        findings.AddRange(NestedTransferAnalysis.Analyze(models, cancellationToken));
        return new(DateTimeOffset.UtcNow, summaries.Count, findings);
    }

    internal static string[] WorkSystems(NodeModel node) => (node.Channels ?? [])
        .Where(c => c.Kind == "system" && c.Direction == "work").Select(c => c.SystemName ?? "")
        .Concat(node.ExecutionMode == "system" ? [node.SystemName ?? ""] : Array.Empty<string>())
        .Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(s => s, StringComparer.OrdinalIgnoreCase).ToArray();

    // An explicit primary medium on both sides is required. A matching documented
    // parallel or alternative channel prevents a discrepancy claim.
    private static bool PaperMediumMismatch(NodeModel source, NodeModel target, string objectId)
    {
        var output = (source.InformationObjects ?? []).FirstOrDefault(b => b.Role == "Output" && string.Equals(b.ObjectId, objectId, StringComparison.OrdinalIgnoreCase));
        var input = (target.InformationObjects ?? []).FirstOrDefault(b => b.Role == "Input" && string.Equals(b.ObjectId, objectId, StringComparison.OrdinalIgnoreCase));
        if (output is null || input is null) return false;
        static string Medium(ProcessChannelModel c) => c.Kind.ToLowerInvariant() switch { "paper" => "paper", "email" or "system" => "digital", _ => "" };
        var from = (source.Channels ?? []).Where(c => c.Matches(output)).ToArray();
        var to = (target.Channels ?? []).Where(c => c.Matches(input)).ToArray();
        if (from.Concat(to).Any(c => Medium(c) == "")) return false;
        var sourcePrimary = from.Where(c => c.Flow.Equals("primary", StringComparison.OrdinalIgnoreCase)).Select(Medium).Distinct().ToArray();
        var targetPrimary = to.Where(c => c.Flow.Equals("primary", StringComparison.OrdinalIgnoreCase)).Select(Medium).Distinct().ToArray();
        return sourcePrimary.Length == 1 && targetPrimary.Length == 1 &&
            !from.Select(Medium).Intersect(to.Select(Medium)).Any();
    }

    public static IReadOnlyList<TransferFinding> Analyze(ProcessModel process, CancellationToken cancellationToken = default)
    {
        var result = new List<TransferFinding>();
        void Add(string code, NodeModel node, string explanation, NodeModel? target = null, string[]? objects = null, IReadOnlyList<string>? route = null) =>
            result.Add(new(process.Id, process.Name, code, node.Id, node.Name, target?.Id, target?.Name,
                WorkSystems(node), target is null ? [] : WorkSystems(target), objects ?? [], explanation, route));
        foreach (var node in process.Nodes.Where(n => n.Type == "task"))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var work = (node.Channels ?? []).Where(c => c.Direction == "work").ToArray();
            if (node.ExecutionMode == "manual" || (work.Length > 0 && work.All(c => c.Kind != "system")))
                Add("outside-system", node, "Указана ручная работа или только внесистемные рабочие каналы. Это описание модели, не журнал выполнения.");
            else if (WorkSystems(node).Length == 0 && string.IsNullOrWhiteSpace(node.LinkedProcessId))
                Add("system-unspecified", node, "Система выполнения не указана. Отсутствие сведений не доказывает ручную работу.");

            foreach (var group in (node.Channels ?? []).Where(c => c.Kind == "paper").GroupBy(c => (c.Direction, c.Flow)))
            {
                var objectIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var ambiguous = false;
                var explicitMatch = false;
                foreach (var channel in group)
                {
                    if (channel.ObjectId is not null)
                    {
                        var binding = (node.InformationObjects ?? []).FirstOrDefault(channel.Matches);
                        if (binding is null) ambiguous = true;
                        else { objectIds.Add(binding.ObjectId); explicitMatch = true; }
                        continue;
                    }
                    var matches = (node.InformationObjects ?? []).Where(binding =>
                        ((channel.Direction == "input" && binding.Role == "Input") || (channel.Direction == "output" && binding.Role == "Output"))
                        && !string.IsNullOrWhiteSpace(channel.DocumentName)
                        && string.Equals(binding.Name.Trim(), channel.DocumentName.Trim(), StringComparison.OrdinalIgnoreCase)).Select(b => b.ObjectId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                    if (matches.Length == 1) objectIds.Add(matches[0]); else ambiguous = true;
                }
                var code = group.Key.Flow == "parallel" ? "paper-parallel" : group.Key.Flow == "alternative" ? "paper-alternative" : "paper-primary";
                Add(code, node, $"Бумажный канал: {group.Key.Direction}; режим {group.Key.Flow}. " +
                    (explicitMatch ? "Есть явные привязки по ID. " : "") +
                    (ambiguous ? "Не все документы однозначно сопоставлены; уточните привязки. " : !explicitMatch ? "Документы сопоставлены по названию и направлению. " : "") +
                    "Это признак бумажной передачи, не доказательство потери документа или обязательности бумаги во всех случаях.", objects: objectIds.Order().ToArray());
            }
        }
        var routes = TransferRoutes.Find(process, cancellationToken);
        foreach (var route in routes.Routes)
        {
            var source = route.Source; var target = route.Target;
            var outputs = (source.InformationObjects ?? []).Where(b => b.Role == "Output").Select(b => b.ObjectId).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var shared = (target.InformationObjects ?? []).Where(b => b.Role == "Input" && outputs.Contains(b.ObjectId)).Select(b => b.ObjectId).Distinct(StringComparer.OrdinalIgnoreCase).Order().ToArray();
            var paperGaps = shared.Where(id => PaperMediumMismatch(source,target,id)).ToArray();
            if (paperGaps.Length > 0)
                Add("paper-medium-gap", source, "Для общего ID документа указаны разные среды: бумага на одной стороне и электронный канал на другой. Проверены явные выход и вход на структурном пути до ближайшей задачи. Общей среды среди привязанных каналов нет. Уточните оцифровку или печать; это несогласованность описания, не факт потери или доказательство исполнения ветви.", target, paperGaps, route.ElementIds);
            var from = WorkSystems(source); var to = WorkSystems(target);
            if (from.Length == 0 || to.Length == 0 || from.Intersect(to, StringComparer.OrdinalIgnoreCase).Any()) continue;
            Add("system-transition", source, (route.ElementIds.Count > 2 ? "Структурный путь BPMN через шлюзы между разными системами выполнения. Показан один кратчайший путь для пары задач; условия и совместимость ветвей не подтверждены. " : "Прямая связь BPMN между разными системами выполнения. ") +
                (shared.Length > 0 ? "Есть общие ID выходов и входов. " : "Общий документ по ID не установлен. ") +
                "Способ переноса не подтверждён: проверьте автоматический обмен или ручной ввод. Повторный ввод не считается доказанным.", target, shared, route.ElementIds);
        }
        if (routes.Limited && process.Nodes.FirstOrDefault(n => n.Type == "task") is { } firstTask)
            Add("traversal-limit", firstTask, "Проверка путей неполна: достигнут предел 50 000 просмотренных связей на модель или 128 шлюзов в пути. Не найденный переход нельзя считать отсутствующим. Разделите модель или проверьте её отдельно.");
        return result;
    }
}
