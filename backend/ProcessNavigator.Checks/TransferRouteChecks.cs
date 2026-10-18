using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;
using System.Text.Json;

internal static class TransferRouteChecks
{
    public static int Run()
    {
        NodeModel Node(string id, string type = "task", string system = "ERP") => new(id, type == "gateway" ? "exclusiveGateway" : type, id, "lane", 0, 0, 180, 80, null, null, null, [], [], Channels: [new("s", "system", "Работа", system)]);
        EdgeModel Edge(string a, string b) => new(a + "-" + b, a, b, null, []);
        var a = Node("a", system: "PLM"); var b = Node("b"); var gate = Node("g", "gateway");
        ProcessModel Model(NodeModel[] nodes, EdgeModel[] edges) => new("test", "Синтетический маршрут", "1", "Учебный отдел", "Published", [], nodes, edges);
        var count = 0;
        void Check(bool value, string text) { if (!value) throw new Exception(text); count++; }
        var simple = Model([a, gate, b], [Edge("a", "g"), Edge("g", "b")]);
        var found = TransferRoutes.Find(simple);
        Check(found.Routes.Single().ElementIds.SequenceEqual(["a", "g", "b"]) && !found.Limited, "Gateway witness includes exact ordered source/gateway/target IDs");
        Check(TransferRoutes.Find(simple with { Nodes = [a, gate with { Type = "parallelGateway" }, b] }).Routes.Count == 1, "Actual parallel gateway loader type is supported");
        Check(TransferAnalyticsService.Analyze(simple).Single(f => f.Code == "system-transition").RouteElementIds!.SequenceEqual(["a", "g", "b"]), "Actual service retains gateway evidence");
        var c = Node("c", system: "MES");
        Check(TransferRoutes.Find(Model([a, gate, b, c], [Edge("a", "g"), Edge("g", "b"), Edge("g", "c")])).Routes.Count == 2, "Split creates candidate per nearest target, not an executable parallel schedule");
        var h = Node("h", "gateway");
        var diamond = Model([a, gate, h, b], [Edge("a", "g"), Edge("g", "h"), Edge("g", "b"), Edge("h", "b"), Edge("h", "g")]);
        Check(TransferRoutes.Find(diamond).Routes.Single().ElementIds.SequenceEqual(["a", "g", "b"]), "Cycle terminates and reconvergence keeps shortest witness once");
        Check(TransferRoutes.Find(diamond with { Edges = diamond.Edges.Reverse().ToArray() }).Routes.Single().ElementIds.SequenceEqual(["a", "g", "b"]), "Witness independent of edge storage order");
        var intermediate = Model([a, gate, b, c], [Edge("a", "g"), Edge("g", "b"), Edge("b", "c")]);
        Check(!TransferRoutes.Find(intermediate).Routes.Any(r => r.Source.Id == "a" && r.Target.Id == "c"), "Do not jump over intermediate work");
        Check(!TransferRoutes.Find(simple with { Nodes = [a, gate with { Type = "event" }, b] }).Routes.Any(), "Event is not a transparent gateway");
        Check(!TransferRoutes.Find(simple with { Edges = [Edge("a", "missing")] }).Routes.Any(), "Broken path remains safe");
        Check(!TransferRoutes.Find(Model([a, gate], [Edge("a", "g"), Edge("g", "a")])).Routes.Any(), "Loop back to same task is not a self transfer");
        Check(TransferRoutes.Find(simple, maximumEdgeVisits: 0).Limited, "Resource cap is explicit, never a silent complete report");
        Check(TransferRoutes.Find(simple, maximumGatewayDepth: 0).Limited, "Depth cap is explicit");
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        var interrupted = false; try { TransferRoutes.Find(simple, cancelled.Token); } catch (OperationCanceledException) { interrupted = true; }
        Check(interrupted, "Cancellation stops traversal");
        var chain = Enumerable.Range(0, 129).Select(i => Node("g" + i, "gateway")).ToArray();
        var longChain = Model([a, ..chain, b], [Edge("a", "g0"), ..Enumerable.Range(0,128).Select(i=>Edge("g"+i,"g"+(i+1))), Edge("g128", "b")]);
        Check(TransferAnalyticsService.Analyze(longChain).Any(f => f.Code == "traversal-limit"), "Production cap is visible in actual findings");
        using var fixtures = JsonDocument.Parse(File.ReadAllText("master-data/transfers/gateway-cases.json"));
        foreach (var fixture in fixtures.RootElement.EnumerateArray())
        {
            var gates = fixture.GetProperty("gateways").EnumerateArray().Select(v => Node(v.GetString()!, "gateway")).ToArray();
            var edges = fixture.GetProperty("edges").EnumerateArray().Select(v => Edge(v[0].GetString()!, v[1].GetString()!)).ToArray();
            var expected = fixture.GetProperty("expectedWitness").EnumerateArray().Select(v => v.GetString()).ToArray();
            Check(TransferRoutes.Find(Model([a, ..gates, b], edges)).Routes.Single().ElementIds.SequenceEqual(expected), "Persistent gateway master: " + fixture.GetProperty("name").GetString());
        }
        Console.WriteLine($"Gateway transfer checks passed: {count}."); return count;
    }
}
