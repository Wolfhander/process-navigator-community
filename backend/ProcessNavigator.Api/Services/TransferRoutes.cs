using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed record TransferRoute(NodeModel Source, NodeModel Target, IReadOnlyList<string> ElementIds);
public sealed record TransferRoutesResult(IReadOnlyList<TransferRoute> Routes, bool Limited);

public static class TransferRoutes
{
    // One shortest witness per pair, not all paths. Stop at the next task; do not jump across work.
    public static TransferRoutesResult Find(ProcessModel process, CancellationToken cancellationToken = default,
        int maximumEdgeVisits = 50_000, int maximumGatewayDepth = 128)
    {
        var nodes = process.Nodes.ToDictionary(n => n.Id, StringComparer.Ordinal);
        var outgoing = process.Edges.GroupBy(e => e.SourceId, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.OrderBy(e => e.TargetId, StringComparer.Ordinal).ThenBy(e => e.Id, StringComparer.Ordinal).ToArray(), StringComparer.Ordinal);
        var routes = new List<TransferRoute>();
        var visits = 0; var limited = false;
        foreach (var source in process.Nodes.Where(n => n.Type == "task").OrderBy(n => n.Id, StringComparer.Ordinal))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var queue = new Queue<(NodeModel Node, string[] Path)>();
            queue.Enqueue((source, [source.Id]));
            var seen = new HashSet<string>(StringComparer.Ordinal) { source.Id };
            while (queue.TryDequeue(out var item))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!outgoing.TryGetValue(item.Node.Id, out var edges)) continue;
                foreach (var edge in edges)
                {
                    if (++visits > maximumEdgeVisits) return new(routes, true);
                    if (!nodes.TryGetValue(edge.TargetId, out var target) || !seen.Add(target.Id)) continue;
                    var path = item.Path.Append(target.Id).ToArray();
                    if (target.Type == "task") routes.Add(new(source, target, path));
                    else if (target.Type is "exclusiveGateway" or "parallelGateway")
                    {
                        if (path.Length - 1 > maximumGatewayDepth) { limited = true; continue; }
                        queue.Enqueue((target, path));
                    }
                    // Events, unknown nodes and linked child models are not transparent gateways.
                }
            }
        }
        return new(routes, limited);
    }
}
