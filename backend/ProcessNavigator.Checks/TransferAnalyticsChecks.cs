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
        var exact = ambiguous with { Channels = sourceNode.Channels!.Select(c => c.Kind == "paper" ? c with { ObjectId = "other" } : c).ToArray() };
        Check(Pair(exact, to).Single(f => f.Code == "paper-parallel").ObjectIds.SequenceEqual(["other"]), "Explicit ID wins over ambiguous name");
        var bad = exact with { Channels = exact.Channels!.Select(c => c.Kind == "paper" ? c with { ObjectId = "absent" } : c).ToArray() };
        Check(Pair(bad, to).Single(f => f.Code == "paper-parallel").ObjectIds.Count == 0, "Invalid explicit ID cannot fall back to a name");
        Check(!new ProcessChannelModel("c","paper","Вход", Direction:"input", ObjectId:"drawing").Matches(new("drawing","Чертёж","Output")), "Input channel cannot point at an output binding");
        var json = JsonSerializer.Serialize(exact, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Check(JsonSerializer.Deserialize<NodeModel>(json,new JsonSerializerOptions(JsonSerializerDefaults.Web))!.Channels!.Any(c => c.ObjectId == "other"), "Explicit ID survives context JSON serialization");
        var paperSource=sourceNode with {Channels=[new("paper","paper","Подлинник",Direction:"output",ObjectId:"drawing")]};
        var digitalTarget=to with {Channels=[new("erp","system","Электронный вход","ERP",Direction:"input",ObjectId:"drawing")]};
        var gap=Pair(paperSource,digitalTarget).Single(f=>f.Code=="paper-medium-gap");
        Check(gap.ObjectIds.SequenceEqual(["drawing"]) && gap.TargetId==digitalTarget.Id && gap.RouteElementIds?.Count==2,"Explicit paper to digital discrepancy identifies document, endpoints and route");
        Check(!Pair(paperSource,digitalTarget with {Channels=[..digitalTarget.Channels!,new("backup","paper","Приём бумаги",Flow:"alternative",Direction:"input",ObjectId:"drawing")]}).Any(f=>f.Code=="paper-medium-gap"),"Matching alternative paper channel prevents discrepancy");
        Check(!Pair(paperSource,digitalTarget with {Channels=[new("mail","email","Только параллельная почта",Flow:"parallel",Direction:"input",ObjectId:"drawing")]}).Any(f=>f.Code=="paper-medium-gap"),"No primary channel is unknown, not a paper break");
        Check(!Pair(paperSource,digitalTarget with {Channels=[new("name","system","Совпадающее название","ERP","Чертёж",Direction:"input")]}).Any(f=>f.Code=="paper-medium-gap"),"Legacy name-only input cannot establish a channel discrepancy");
        Check(!TransferAnalyticsService.Analyze(process with {Nodes=[paperSource,digitalTarget],Edges=[]}).Any(f=>f.Code=="paper-medium-gap"),"Unconnected candidates do not become a paper break");
        var intermediate=sourceNode with {Id="intermediate",Type="task",Channels=[],InformationObjects=[]};
        Check(!TransferAnalyticsService.Analyze(process with {Nodes=[paperSource,intermediate,digitalTarget],Edges=[new("a",paperSource.Id,intermediate.Id,null,[]),new("b",intermediate.Id,digitalTarget.Id,null,[])]}).Any(f=>f.Code=="paper-medium-gap"),"No assumption across an intervening task that could digitize the document");
        foreach (var (method,code) in new[] {("manual-copy","declared-manual-transfer"),("reentry","declared-reentry"),("automatic","declared-automatic-transfer")})
        {
            var channel = new ProcessChannelModel("erp", "system", "ERP", "ERP", Direction:"input",ObjectId:"drawing",TransferMethod:method);
            var declared = Pair(sourceNode, to with { Channels=[channel] }).Single(f=>f.Code==code);
            Check(declared.ObjectIds.SequenceEqual(["drawing"]) && declared.TargetSystems.SequenceEqual(["ERP"]) && declared.RouteElementIds?.Count==2,"Declared method retains exact document, receiving system and route");
            Check(!Pair(sourceNode, to with { Channels=[channel with { ObjectId="other" }] }).Any(f=>f.Code==code),"Wrong document cannot produce declared transfer finding");
            Check(!Pair(sourceNode, to with { Channels=[channel with { SystemName="Учебная PLM" }] }).Any(f=>f.Code==code),"Same system is not an intersystem transfer");
        }
        Check(!new ProcessChannelModel("work","system","Работа","ERP",TransferMethod:"reentry").HasValidTransferMethod,"Transfer method requires an exact system input");
        Check(!Pair(sourceNode, to with { Channels = [new("a", "system", "PLM", "Учебная PLM"), new("b", "system", "ERP", "ERP")] }).Any(f => f.Code == "system-transition"), "Overlapping system sets cannot prove a change of system");
        Check(TransferAnalyticsService.Analyze(process with { Edges = [new("broken", "missing", "register", null, [])] }).All(f => f.Code != "system-transition"), "Broken edge does not crash analysis");
        Console.WriteLine($"Transfer analytics master checks passed: {count}.");
        return count;
    }
}
