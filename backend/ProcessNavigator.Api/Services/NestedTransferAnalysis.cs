using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

/// <summary>Structural call-boundary candidates, not executable branch/parallel semantics.</summary>
public static class NestedTransferAnalysis
{
    private sealed record Port(ProcessModel Process, NodeModel Node, string[] Path, string[] Calls);
    private sealed record ModelGraph(Dictionary<string,NodeModel> Nodes, Dictionary<string,EdgeModel[]> Forward,
        Dictionary<string,EdgeModel[]> Reverse, NodeModel[] Starts, NodeModel[] Ends);
    public static IReadOnlyList<TransferFinding> Analyze(IReadOnlyList<ProcessModel> models,
        CancellationToken cancellationToken = default, int maximumVisits = 50_000, int maximumDepth = 20, int maximumPairs = 200)
    {
        var byId = models.ToDictionary(m => m.Id, StringComparer.OrdinalIgnoreCase);
        var owners = new Dictionary<NodeModel, string>(ReferenceEqualityComparer.Instance);
        foreach (var model in models) foreach (var node in model.Nodes) owners.TryAdd(node, model.Id);
        var findings = new List<TransferFinding>();
        var graphs = new Dictionary<string,ModelGraph>(StringComparer.OrdinalIgnoreCase);
        ModelGraph GraphFor(ProcessModel model)
        {
            if (graphs.TryGetValue(model.Id,out var cached)) return cached;
            var graph = new ModelGraph(model.Nodes.ToDictionary(n=>n.Id,StringComparer.Ordinal),
                model.Edges.GroupBy(e=>e.SourceId,StringComparer.Ordinal).ToDictionary(g=>g.Key,g=>g.OrderBy(e=>e.Id,StringComparer.Ordinal).ToArray(),StringComparer.Ordinal),
                model.Edges.GroupBy(e=>e.TargetId,StringComparer.Ordinal).ToDictionary(g=>g.Key,g=>g.OrderBy(e=>e.Id,StringComparer.Ordinal).ToArray(),StringComparer.Ordinal),
                model.Nodes.Where(n=>n.Type=="startEvent").OrderBy(n=>n.Id,StringComparer.Ordinal).ToArray(),
                model.Nodes.Where(n=>n.Type=="endEvent").OrderBy(n=>n.Id,StringComparer.Ordinal).ToArray());
            graphs.Add(model.Id,graph);return graph;
        }
        var visits = 0; var budgetEnded = false;
        foreach (var parent in models.OrderBy(m => m.Id, StringComparer.Ordinal))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var reported = new HashSet<string>(StringComparer.Ordinal);
            void Note(NodeModel call, string code, string text)
            {
                if (reported.Add(call.Id + ":" + code + ":" + text))
                    findings.Add(new(parent.Id, parent.Name, code, call.Id, call.Name, null, null, [], [], [], text,
                        SourceProcessId: owners.GetValueOrDefault(call, parent.Id)));
            }
            bool Spend(NodeModel call)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (++visits <= maximumVisits) return true;
                if (!budgetEnded) Note(call, "nested-limit", "Сквозная проверка каталога неполна: достигнут предел обхода границ. Отсутствие записи не подтверждает отсутствие передачи.");
                budgetEnded = true; return false;
            }
            List<Port> Resolve(ProcessModel model, NodeModel task, bool input, string[] path, HashSet<string> ancestors, int depth, string[]? calls = null)
            {
                calls ??= [];
                if (!Spend(task)) return [];
                if (string.IsNullOrWhiteSpace(task.LinkedProcessId)) return [new(model, task, [..path, model.Id + "/" + task.Id], calls)];
                if (!byId.TryGetValue(task.LinkedProcessId, out var child))
                { Note(task, "nested-unresolved", $"Детальный процесс «{task.LinkedProcessId}» не найден. Передача через него не проверена."); return []; }
                if (depth >= maximumDepth || ancestors.Contains(child.Id))
                { Note(task, "nested-unresolved", $"Не раскрыта граница «{model.Id}/{task.Id} → {child.Id}»: цикл вложенности либо предел {maximumDepth} уровней."); return []; }
                var nextAncestors = new HashSet<string>(ancestors, StringComparer.OrdinalIgnoreCase) { child.Id };
                var graph = GraphFor(child);
                var children = graph.Nodes;
                var edges = input ? graph.Forward : graph.Reverse;
                var starts = input ? graph.Starts : graph.Ends;
                if (starts.Length == 0)
                { Note(task, "nested-unresolved", $"У «{child.Id}» нет явного {(input ? "начала" : "завершения")}; граничные задачи не угадываются по координатам или порядку."); return []; }
                var queue = new Queue<(NodeModel Node, string[] Path)>();
                foreach (var start in starts) queue.Enqueue((start, [..path, model.Id + "/" + task.Id, child.Id + "/" + start.Id]));
                var seen = new HashSet<string>(StringComparer.Ordinal);
                var ports = new List<Port>();
                while (queue.TryDequeue(out var item))
                {
                    if (!Spend(task)) return ports;
                    if (!seen.Add(item.Node.Id) || !edges.TryGetValue(item.Node.Id, out var outgoing)) continue;
                    foreach (var edge in outgoing)
                    {
                        if (!Spend(task)) return ports;
                        var targetId = input ? edge.TargetId : edge.SourceId;
                        if (!children.TryGetValue(targetId, out var target)) continue;
                        if (target.Type == "task") ports.AddRange(Resolve(child, target, input, item.Path, nextAncestors, depth + 1, [..calls, model.Id + "/" + task.Id]));
                        else if (target.Type is "exclusiveGateway" or "parallelGateway")
                            queue.Enqueue((target, [..item.Path, child.Id + "/" + target.Id]));
                        else Note(task, "nested-unresolved", $"На границе «{child.Id}» встретилось событие или неподдержанный узел «{target.Id}». Участок не считается прозрачным.");
                    }
                }
                if (ports.Count == 0 && !budgetEnded) Note(task, "nested-unresolved", $"Для «{child.Id}» не найдены доступные граничные задачи ({(input ? "вход" : "выход")}).");
                // Distinct endpoint within a call; retain one structural witness, not all branch combinations.
                return ports.DistinctBy(p => p.Process.Id + "/" + p.Node.Id + ":" + string.Join("/", p.Calls), StringComparer.Ordinal).ToList();
            }
            foreach (var call in parent.Nodes.Where(n => !string.IsNullOrWhiteSpace(n.LinkedProcessId)))
            {
                if (!Spend(call)) break;
                if (byId.TryGetValue(call.LinkedProcessId!, out var child))
                    foreach (var issue in ProcessBoundaryCheck.Compare(call, child)) Note(call, "nested-boundary", issue.Message);
                else Note(call, "nested-unresolved", $"Детальный процесс «{call.LinkedProcessId}» не найден.");
                // Check entry/exit even if the call has no neighbouring task in the parent.
                Resolve(parent, call, true, [], new([parent.Id], StringComparer.OrdinalIgnoreCase), 0);
                Resolve(parent, call, false, [], new([parent.Id], StringComparer.OrdinalIgnoreCase), 0);
            }
            if (budgetEnded) break;
            var routes = TransferRoutes.Find(parent, cancellationToken);
            foreach (var route in routes.Routes.Where(r => !string.IsNullOrWhiteSpace(r.Source.LinkedProcessId) || !string.IsNullOrWhiteSpace(r.Target.LinkedProcessId)))
            {
                var sources = Resolve(parent, route.Source, false, [], new([parent.Id], StringComparer.OrdinalIgnoreCase), 0);
                var targets = Resolve(parent, route.Target, true, [], new([parent.Id], StringComparer.OrdinalIgnoreCase), 0);
                var pairs = 0;
                foreach (var source in sources)
                {
                foreach (var target in targets)
                {
                    if (++pairs > maximumPairs)
                    { Note(route.Source, "nested-limit", $"На границе {route.Source.Id} → {route.Target.Id} более {maximumPairs} сочетаний. Проверка неполна; комбинации ветвей не считаются исполнимыми автоматически."); break; }
                    if (!Spend(route.Source)) break;
                    var from = TransferAnalyticsService.WorkSystems(source.Node); var to = TransferAnalyticsService.WorkSystems(target.Node);
                    if (from.Length == 0 || to.Length == 0 || from.Intersect(to, StringComparer.OrdinalIgnoreCase).Any()) continue;
                    var outputs = (source.Node.InformationObjects ?? []).Where(b => b.Role == "Output").Select(b => b.ObjectId).ToHashSet(StringComparer.OrdinalIgnoreCase);
                    var shared = (target.Node.InformationObjects ?? []).Where(b => b.Role == "Input" && outputs.Contains(b.ObjectId)).Select(b => b.ObjectId).Distinct(StringComparer.OrdinalIgnoreCase).Order().ToArray();
                    string[] witness = [..source.Path.Reverse(), ..route.ElementIds.Select(id => parent.Id + "/" + id), ..target.Path];
                    witness = witness.Where((id, index) => index == 0 || id != witness[index - 1]).ToArray();
                    findings.Add(new(parent.Id, parent.Name, "nested-transition", source.Node.Id, source.Node.Name, target.Node.Id, target.Node.Name, from, to, shared,
                        "Кандидат передачи через явные начало/завершение вложенной модели. Указаны квалифицированные ID и один структурный путь. Совместимость условий, фактическая версия и способ переноса не подтверждены.",
                        witness, source.Process.Id, target.Process.Id));
                    foreach (var required in (target.Node.InformationObjects ?? []).Where(b => b.Role == "Input" && b.Required && !string.IsNullOrWhiteSpace(b.Version) && outputs.Contains(b.ObjectId))
                        .DistinctBy(b => (b.ObjectId.ToUpperInvariant(), b.Version, b.Condition)))
                    {
                        var versions = (source.Node.InformationObjects ?? []).Where(b => b.Role == "Output" && b.ObjectId.Equals(required.ObjectId, StringComparison.OrdinalIgnoreCase)).Select(b => b.Version).ToArray();
                        if (versions.Contains(required.Version, StringComparer.Ordinal)) continue;
                        var unknown = versions.Any(string.IsNullOrWhiteSpace);
                        findings.Add(new(parent.Id, parent.Name, "nested-document-version", source.Node.Id, source.Node.Name, target.Node.Id, target.Node.Name, from, to, [required.ObjectId],
                            $"На кандидатной границе требуется «{required.Name}» [{required.ObjectId}] версии «{required.Version}». " +
                            (unknown ? "Версия хотя бы одного выхода источника не указана; совместимость не подтверждена. " : "Такая версия среди выходов этого источника не указана. ") +
                            (string.IsNullOrWhiteSpace(required.Condition) ? "" : $"Условие входа: {required.Condition}. ") +
                            "Проверьте маршрут, внешний источник и условия ветвей; это не доказательство фактической потери документа.", witness, source.Process.Id, target.Process.Id));
                    }
                }
                if (pairs > maximumPairs || budgetEnded) break;
                }
                if (budgetEnded) break;
            }
            if (budgetEnded) break;
        }
        return findings;
    }
}
