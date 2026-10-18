using System.Text.Json;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class TransferAnalyticsChecks
{
    public static int Run()
    {
        var process = JsonSerializer.Deserialize<ProcessModel>(File.ReadAllText("master-data/transfers/process.json"), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var count = 0;
        void Check(bool condition, string message) { if (!condition) throw new Exception(message); count++; }
        var findings = TransferAnalyticsService.Analyze(process);
        Check(findings.Count == 6, "Transfer master has exactly six explainable findings");
        Check(findings.Single(f => f.Code == "system-transition").ObjectIds.SequenceEqual(["drawing"]), "Stable document ID matches across systems despite different declared versions; no factual version confirmation");
        Check(findings.Single(f => f.Code == "paper-parallel").ObjectIds.SequenceEqual(["drawing"]), "Output paper maps to unique output document");
        Check(findings.Single(f => f.Code == "paper-primary").ObjectIds.SequenceEqual(["drawing"]), "Input paper maps to input document");
        Check(findings.Single(f => f.Code == "paper-alternative").ObjectIds.Count == 0, "Unnamed alternative paper is not mapped by guess");
        Check(findings.Single(f => f.Code == "outside-system").ElementId == "call", "Phone work is outside-system");
        Check(findings.Single(f => f.Code == "system-unspecified").ElementId == "unknown", "Unknown system is not proven manual");
        var sourceNode = process.Nodes[0]; var to = process.Nodes[1];
        IReadOnlyList<TransferFinding> Pair(NodeModel a, NodeModel b) => TransferAnalyticsService.Analyze(process with { Nodes = [a, b], Edges = [process.Edges[0]] });
        Check(!Pair(sourceNode, to with { Channels = [new("s", "system", "PLM", " учебная plm ")] }).Any(f => f.Code == "system-transition"), "Case and spaces do not create false system transition");
        Check(!Pair(sourceNode, to with { Channels = [new("s", "system", "ERP", "ERP", Direction: "input")] }).Any(f => f.Code == "system-transition"), "Input system does not imply execution system");
        Check(Pair(sourceNode, to with { Channels = [], ExecutionMode = "system", SystemName = "ERP" }).Any(f => f.Code == "system-transition"), "Legacy execution system supported");
        Check(!Pair(sourceNode, to with { Type = "gateway" }).Any(f => f.Code == "system-transition"), "Gateway does not become a guessed task handoff");
        var ambiguous = sourceNode with { InformationObjects = [new("drawing", "Чертёж", "Output"), new("other", "Чертёж", "Output")] };
        Check(Pair(ambiguous, to).Single(f => f.Code == "paper-parallel").ObjectIds.Count == 0, "Ambiguous equal names must not map to arbitrary ID");
        Check(!Pair(sourceNode, to with { Channels = [new("a", "system", "PLM", "Учебная PLM"), new("b", "system", "ERP", "ERP")] }).Any(f => f.Code == "system-transition"), "Overlapping system sets cannot prove a change of system");
        Check(TransferAnalyticsService.Analyze(process with { Edges = [new("broken", "missing", "register", null, [])] }).All(f => f.Code != "system-transition"), "Broken edge does not crash analysis");
        Console.WriteLine($"Transfer analytics master checks passed: {count}.");
        return count;
    }
}
