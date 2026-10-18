using System.Text.Json;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class NestedTransferChecks
{
    public static int Run()
    {
        using var spec = JsonDocument.Parse(File.ReadAllText("master-data/transfers/nested-case.json"));
        string? Text(JsonElement e, string key) => e.TryGetProperty(key, out var v) ? v.GetString() : null;
        bool Has(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.GetBoolean();
        var models = spec.RootElement.GetProperty("models").EnumerateArray().Select(m => new ProcessModel(
            m.GetProperty("id").GetString()!, "Учебная вложенность", "1", "Учебный отдел", "Published", [],
            m.GetProperty("nodes").EnumerateArray().Select(n => new NodeModel(n.GetProperty("id").GetString()!, n.GetProperty("type").GetString()!, n.GetProperty("id").GetString()!, "lane", 0, 0, 180, 80, null, null, null, [], [],
                LinkedProcessId: Text(n,"child"), Channels: Text(n,"system") is { } system ? [new("system","system","Работа",system)] : [],
                InformationObjects: (Has(n,"input") ? new[] {new InformationObjectBindingModel("drawing","Чертёж","Input",Version:"1")} : []).Concat(Has(n,"output") ? [new InformationObjectBindingModel("drawing","Чертёж","Output",Version:"1")] : []).ToArray())).ToArray(),
            m.GetProperty("edges").EnumerateArray().Select((e,i) => new EdgeModel("flow"+i,e[0].GetString()!,e[1].GetString()!,null,[])).ToArray())).ToArray();
        var count = 0; void Check(bool ok,string message) {if(!ok)throw new Exception(message);count++;}
        var found = NestedTransferAnalysis.Analyze(models);
        Check(found.Count == spec.RootElement.GetProperty("expectedTransitions").GetInt32(), "Two cross-boundary transitions, no invented standalone call transitions");
        var input = found.Single(f => f.SourceSystems.Contains("PLM")); var output = found.Single(f => f.TargetSystems.Contains("MES"));
        Check(input.TargetProcessId == "nested-detail" && output.SourceProcessId == "nested-detail", "Endpoint process IDs survive two levels");
        Check(input.ObjectIds.SequenceEqual(["drawing"]) && output.ObjectIds.SequenceEqual(["drawing"]), "Boundary document keeps stable ID");
        Check(input.RouteElementIds!.Contains("nested-root/g") && input.RouteElementIds!.Contains("nested-child/call"), "Witness contains parent gateway and nested call occurrence");
        Check(found.All(f => f.Code != "nested-boundary"), "Compatible boundary contracts have no false warning");
        Check(input.RouteElementIds!.Zip(input.RouteElementIds!.Skip(1)).All(pair=>pair.First!=pair.Second), "Boundary joins do not duplicate adjacent witness IDs");
        var root = models[0]; var child = models[1]; var detail = models[2];
        Check(NestedTransferAnalysis.Analyze([root, child]).Any(f => f.Code == "nested-unresolved"), "Missing detail is explicit");
        var cycle = child with {Nodes=child.Nodes.Select(n=>n.Id=="call"?n with {LinkedProcessId=root.Id}:n).ToArray()};
        Check(NestedTransferAnalysis.Analyze([root,cycle,detail]).Any(f => f.Code == "nested-unresolved" && f.Explanation.Contains("цикл")), "Recursion cycle is explicit and terminates");
        Check(NestedTransferAnalysis.Analyze(models,maximumDepth:1).Any(f=>f.Code=="nested-unresolved"), "Depth budget reports uncertainty");
        Check(NestedTransferAnalysis.Analyze(models,maximumVisits:1).Any(f=>f.Code=="nested-limit"), "Global work budget reports incomplete analysis");
        var noStart=detail with {Nodes=detail.Nodes.Where(n=>n.Type!="startEvent").ToArray()};
        Check(NestedTransferAnalysis.Analyze([root,child,noStart]).Any(f=>f.Code=="nested-unresolved" && f.Explanation.Contains("начала")), "Missing start is never guessed from coordinates");
        var badVersion=child with {Nodes=child.Nodes.Select(n=>n.Id=="call"?n with {InformationObjects=[new("drawing","Чертёж","Input",Version:"2"),new("drawing","Чертёж","Output",Version:"2")]}:n).ToArray()};
        Check(NestedTransferAnalysis.Analyze([root,badVersion,detail]).Any(f=>f.Code=="nested-boundary" && f.Explanation.Contains("верси")), "Version disagreement crosses into analytics, not auto confirmed");
        var noEnd=detail with {Nodes=detail.Nodes.Where(n=>n.Type!="endEvent").ToArray()};
        Check(NestedTransferAnalysis.Analyze([root,child,noEnd]).Any(f=>f.Code=="nested-unresolved" && f.Explanation.Contains("завершения")), "Missing end is explicit");
        var sameSystem=detail with {Nodes=detail.Nodes.Select(n=>n.Id=="work"?n with {Channels=[new("s","system","PLM","PLM")]}:n).ToArray()};
        Check(!NestedTransferAnalysis.Analyze([root,child,sameSystem]).Any(f=>f.Code=="nested-transition" && f.SourceProcessId==root.Id && f.TargetProcessId==detail.Id), "Same systems do not create cross-system candidate on the incoming boundary; outgoing PLM to MES remains valid");
        using var cancelled=new CancellationTokenSource();cancelled.Cancel();var stopped=false;
        try{NestedTransferAnalysis.Analyze(models,cancelled.Token);}catch(OperationCanceledException){stopped=true;}
        Check(stopped,"Nested scan obeys cancellation");
        Check(NestedTransferAnalysis.Analyze([root with {Nodes=root.Nodes.Select(n=>n.Id=="call"?n with {InformationObjects=[]}:n).ToArray()},child,detail]).Any(f=>f.Code=="nested-boundary"),"Unmapped boundary remains visible");
        var repeated = root with {Nodes=[..root.Nodes, root.Nodes.Single(n=>n.Id=="call") with {Id="second-call"}], Edges=[..root.Edges, new("extra","before","second-call",null,[])]};
        var repeatedInputs=NestedTransferAnalysis.Analyze([repeated,child,detail]).Where(f=>f.Code=="nested-transition" && f.SourceProcessId==root.Id && f.TargetProcessId==detail.Id).ToArray();
        Check(repeatedInputs.Length==2 && repeatedInputs.Any(f=>f.RouteElementIds!.Contains("nested-root/second-call")),"Shared child keeps distinct call occurrences instead of merging by child ID");
        var branching = detail with {Nodes=[..detail.Nodes,new("branch","task","Второй вход","lane",0,0,180,80,null,null,null,[],[],Channels:[new("s","system","ERP","ERP")])],Edges=[..detail.Edges,new("branch-start","s","branch",null,[]),new("branch-end","branch","e",null,[])]};
        Check(NestedTransferAnalysis.Analyze([root,child,branching],maximumPairs:1).Any(f=>f.Code=="nested-limit"),"Too many port combinations are explicitly limited");
        var gate1=new NodeModel("g1","exclusiveGateway","Шлюз 1","lane",0,0,40,40,null,null,null,[],[]);
        var gate2=gate1 with {Id="g2",Name="Шлюз 2"};
        var reconverged=detail with {Nodes=[..detail.Nodes,gate1,gate2],Edges=[new("s-g1","s","g1",null,[]),new("s-g2","s","g2",null,[]),new("g1-work","g1","work",null,[]),new("g2-work","g2","work",null,[]),new("work-e","work","e",null,[])]};
        Check(NestedTransferAnalysis.Analyze([root,child,reconverged]).Count(f=>f.Code=="nested-transition")==2,"Reconverged ports retain one witness per call occurrence, not duplicate candidates");
        var recipientVersion=root with {Nodes=root.Nodes.Select(n=>n.Id=="after"?n with {InformationObjects=[new("drawing","Чертёж","Input",Version:"2")]}:n).ToArray()};
        Check(NestedTransferAnalysis.Analyze([recipientVersion,child,detail]).Any(f=>f.Code=="nested-document-version" && f.SourceProcessId==detail.Id && f.TargetProcessId==root.Id),"Endpoint version mismatch is checked beyond the call contract");
        var unknownVersion=detail with {Nodes=detail.Nodes.Select(n=>n.Id=="work"?n with {InformationObjects=[new("drawing","Чертёж","Input",Version:"1"),new("drawing","Чертёж","Output")]}:n).ToArray()};
        Check(NestedTransferAnalysis.Analyze([recipientVersion,child,unknownVersion]).Any(f=>f.Code=="nested-document-version" && f.Explanation.Contains("не указана")),"Unknown source version is uncertainty, not a proven incompatibility");
        Console.WriteLine($"Nested transfer checks passed: {count}.");return count;
    }
}
