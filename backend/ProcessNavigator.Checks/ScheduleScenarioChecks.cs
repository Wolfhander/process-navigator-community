using System.Text.Json;
using System.Xml.Linq;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class ScheduleScenarioChecks
{
    static NodeModel Node(string id, string type = "task", string? duration = "2 часа", bool output = false) =>
        new(id, type, id, "lane", 100, 40, 100, 80, null, null, duration, [], [],
            InformationObjects: output ? [new("shared", "Учебный результат", "Output")] : []);
    static EdgeModel Edge(string id, string source, string target) => new(id, source, target, id, [new(100, 40), new(200, 40)]);
    static ProcessModel Process(NodeModel[] nodes, EdgeModel[] edges) => new("route", "Учебный маршрут", "1", "Учебный отдел", "Published", [new("lane", "Отдел", 0, 200)], nodes, edges);
    public static async Task<int> RunAsync()
    {
        var count = 0;
        void Check(bool value, string label) { if (!value) throw new Exception(label); count++; }
        void Reject(Action action) { var rejected = false; try { action(); } catch (InvalidDataException) { rejected = true; } Check(rejected, "Unsupported route must be rejected"); }
        var branch = Process([Node("s", "startEvent"), Node("g", "exclusiveGateway"), Node("fast"), Node("slow", duration: "8 часов", output: true), Node("join", "exclusiveGateway"), Node("end", "endEvent")],
            [Edge("sg", "s", "g"), Edge("fast-choice", "g", "fast"), Edge("slow-choice", "g", "slow"), Edge("fj", "fast", "join"), Edge("bj", "slow", "join"), Edge("je", "join", "end")]);
        var chosen = new Dictionary<string, string> { ["g"] = "fast-choice" };
        var route = ScheduleRouteScenario.Build(branch, chosen, null);
        Check(route.ActiveIds.Contains("fast") && !route.ActiveIds.Contains("slow") && route.ActiveIds.Contains("join"), "Selected alternative removes only unreachable branch");
        Check(!route.UnresolvedBranches && ScheduleRouteScenario.Build(branch, null, null).UnresolvedBranches, "Unselected alternative remains explicit");
        Reject(() => ScheduleRouteScenario.Build(branch, new Dictionary<string, string> { ["fast"] = "fj" }, null));
        Reject(() => ScheduleRouteScenario.Build(branch, new Dictionary<string, string> { ["g"] = "je" }, null));
        var loop = Process([Node("s", "startEvent"), Node("pre", duration: "1 час"), Node("body"), Node("check", "exclusiveGateway"), Node("post", duration: "1 час", output: true), Node("end", "endEvent")],
            [Edge("sp", "s", "pre"), Edge("pb", "pre", "body"), Edge("bc", "body", "check"), Edge("back", "check", "body"), Edge("exit", "check", "post"), Edge("pe", "post", "end")]);
        var repeat = new ScheduleRepetitionModel("back", 2, 4);
        var repeated = ScheduleRouteScenario.Build(loop, null, repeat);
        Check(repeated.RepeatedIds.SetEquals(["body", "check"]) && repeated.Model.Edges.All(edge => edge.Id != "back"), "Repeated region excludes prelude and completion");
        Reject(() => ScheduleRouteScenario.Build(loop, null, repeat with { MaximumRepeats = 51 }));
        Reject(() => ScheduleRouteScenario.Build(loop, null, repeat with { PlannedRepeats = 5 }));
        Reject(() => ScheduleRouteScenario.Build(loop, null, repeat with { ReturnEdgeId = "exit" }));
        Reject(() => ScheduleRouteScenario.Build(loop, new Dictionary<string, string> { ["check"] = "exit" }, repeat));
        var parallel = branch with { Nodes = branch.Nodes.Select(node => node.Id is "g" or "join" ? node with { Type = "parallelGateway" } : node).ToArray() };
        Check(ScheduleRouteScenario.Build(parallel, null, null).ActiveIds.Contains("slow"), "Parallel branches stay active");
        Reject(() => ScheduleRouteScenario.Build(parallel, chosen, null));
        var temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        var root = Path.Combine(temp, "pn-scenario-check-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "Data"));
        try
        {
            var env = new Environment(root);
            var catalog = new ProcessCatalogService(new BpmnProcessLoader(env));
            var service = new ProcessScheduleService(catalog, new InformationObjectRegistryService(catalog, env));
            var target = Process([Node("task", duration: "4 часа") with { InformationObjects = [new("shared", "Учебный результат", "Input")] }], []) with { Id = "target", Name = "Получатель" };
            await Write(root, branch); await Write(root, target);
            var request = new ProcessScheduleRequestModel("route", "Forward", DateTimeOffset.Parse("2026-10-19T06:00Z"), UtcOffsetMinutes: 180,
                ProcessBranches: new Dictionary<string, IReadOnlyDictionary<string, string>> { ["route"] = chosen });
            var fast = await service.CalculateAsync(request, false);
            Check(fast.Processes.Count == 1 && fast.DurationHours == 2 && fast.Dependencies.Count == 0, "Excluded output branch removes downstream transfer and process");
            Check(fast.Sources!.Processes.Count == 2 && fast.Sources.Objects.Single().Producers.Count == 1, "Original candidate models and object graph remain in snapshot");
            var defaults = await service.CalculateAsync(request with { ProcessBranches = null }, false);
            Check(!defaults.Complete && defaults.Issues.Any(issue => issue.Code == "branch-unresolved"), "Unselected XOR must not report reliable dates");
            var backwardMissing = await service.CalculateAsync(request with { RootProcessId = "target", Direction = "Backward" }, false);
            Check(backwardMissing.Processes.Count == 1 && backwardMissing.Issues.Any(issue => issue.Code == "missing-producer"), "Selected-away producer creates a visible missing input in reverse calculation");
            await Write(root, branch with { Nodes = branch.Nodes.Select(node => node.Id == "slow" ? node with { Duration = null } : node).ToArray() });
            var missingOnUnused = await service.CalculateAsync(request, false);
            Check(missingOnUnused.Processes.Single().MissingDurationCount == 0, "Unselected step without a duration does not invalidate the selected route");
            await Write(root, branch with { Passport = new ProcessPassportModel(Outputs: ["Паспортный результат"]) });
            var passport = await service.CalculateAsync(request, false);
            Check(!passport.Complete && passport.Processes.Single().UncertaintyReasons.Any(reason => reason.Contains("паспорта")), "Unbound passport boundary remains uncertain after choosing a route");
            await Write(root, branch);
            await Write(root, target with { Nodes = target.Nodes.Select(node => node with { InformationObjects = [new("shared", "Учебный результат", "Input", Condition: "По запросу")] }).ToArray() });
            var textCondition = await service.CalculateAsync(request with { ProcessBranches = null }, false);
            Check(textCondition.Issues.Any(issue => issue.Code == "object-condition-unresolved"), "Text condition is not silently evaluated as true or false");
            await Write(root, target);
            await Write(root, loop);
            var repeatRequest = request with { ProcessBranches = null, ProcessRepetitions = new Dictionary<string, ScheduleRepetitionModel> { ["route"] = repeat } };
            var plan = await service.CalculateAsync(repeatRequest, false);
            var step = plan.Processes.Single(item => item.ProcessId == "route");
            Check(step.BaseDurationHours == 4 && step.DurationHours == 8 && step.MaximumDurationHours == 12, "Repeats add section work, not the whole process");
            Check(!step.HasInternalCycle && plan.Issues.Any(issue => issue.Code == "repeat-assumption"), "Supported bounded repeat is explicit, not an unresolved cycle");
            Check(plan.EndAt == DateTimeOffset.Parse("2026-10-20T10:00Z") && plan.MaximumEndAt == DateTimeOffset.Parse("2026-10-20T14:00Z"), "Forward upper date propagates through recipient");
            var back = await service.CalculateAsync(repeatRequest with { RootProcessId = "target", Direction = "Backward", AnchorDate = plan.MaximumEndAt!.Value }, false);
            Check(back.MaximumStartAt < back.StartAt && back.MaximumEndAt == back.EndAt, "Backward maximum repeats require earlier start, same deadline");
            var noPlanRepeats = await service.CalculateAsync(repeatRequest with { ProcessRepetitions = new Dictionary<string, ScheduleRepetitionModel> { ["route"] = repeat with { PlannedRepeats = 0 } } }, false);
            Check(noPlanRepeats.Processes.Single(item => item.ProcessId == "route").DurationHours == 4, "Zero extra passes still includes the initial pass");
            var snapshot = JsonSerializer.Deserialize<ProcessScheduleModel>(JsonSerializer.Serialize(plan))!;
            Check(snapshot.Assumptions.ProcessRepetitions!["route"].MaximumRepeats == 4 && snapshot.MaximumEndAt == plan.MaximumEndAt, "Iteration assumptions and upper dates survive snapshot");
            var delayed = await service.CalculateAsync(repeatRequest with { TransferDelayHours = 2 }, false);
            Check(delayed.MaximumEndAt > plan.MaximumEndAt, "Transfer delay applies to upper scenario too");
            var scaled = await service.CalculateAsync(repeatRequest with { DurationScalePercent = 50 }, false);
            Check(scaled.Processes.Single(item => item.ProcessId == "route").MaximumDurationHours == 6, "Duration coefficient applies to both estimates");
            Reject(() => ScheduleRouteScenario.Build(loop, null, repeat with { PlannedRepeats = -1 }));
            var rejected = false;
            try { await service.CalculateAsync(repeatRequest with { ProcessRepetitions = new Dictionary<string, ScheduleRepetitionModel> { ["missing"] = repeat } }, false); }
            catch (InvalidDataException) { rejected = true; }
            Check(rejected, "Unknown process scenario rejected");
            var overlap = loop with {
                Nodes = loop.Nodes.Concat([Node("split", "parallelGateway"), Node("parallel-work", duration: "10 часов"), Node("parallel-join", "parallelGateway")]).ToArray(),
                Edges = loop.Edges.Where(edge => edge.Id is not "sp" and not "pe").Concat([
                    Edge("start-split", "s", "split"), Edge("split-main", "split", "pre"), Edge("split-side", "split", "parallel-work"),
                    Edge("main-join", "post", "parallel-join"), Edge("side-join", "parallel-work", "parallel-join"), Edge("join-end", "parallel-join", "end")]).ToArray()
            };
            await Write(root, overlap);
            var parallelRepeat = await service.CalculateAsync(repeatRequest, false);
            Check(parallelRepeat.Processes.Single(item => item.ProcessId == "route").DurationHours == 10 &&
                parallelRepeat.Processes.Single(item => item.ProcessId == "route").MaximumDurationHours == 12,
                "Repeats participate in longest-path comparison instead of inflating the entire parallel process");
            var nested = loop with { Edges = loop.Edges.Concat([Edge("other-loop", "post", "pre")]).ToArray() };
            Reject(() => ScheduleRouteScenario.Build(nested, null, repeat));
            var inactiveModel = loop with {
                Nodes = loop.Nodes.Concat([Node("before", "exclusiveGateway")]).ToArray(),
                Edges = loop.Edges.Where(edge => edge.Id != "sp").Concat([Edge("sb", "s", "before"), Edge("into-loop", "before", "pre"), Edge("bypass", "before", "post")]).ToArray()
            };
            Check(ScheduleRouteScenario.Build(inactiveModel, new Dictionary<string, string> { ["before"] = "bypass" }, repeat).RepetitionInactive, "Repeat excluded by upstream alternative is explicit");
            var duplicateTarget = branch with { Edges = branch.Edges.Where(edge => edge.Id != "slow-choice").Concat([Edge("other-fast", "g", "fast")]).ToArray() };
            await Write(root, duplicateTarget);
            var duplicateResult = await service.CalculateAsync(request with { ProcessBranches = null }, false);
            Check(!duplicateResult.Processes.Single(item => item.ProcessId == "route").HasInternalCycle, "Distinct sequence flows to one target do not create a false cycle");
            var escaping = loop with { Nodes = loop.Nodes.Concat([Node("side")]).ToArray(), Edges = loop.Edges.Concat([Edge("escape", "body", "side"), Edge("side-end", "side", "end")]).ToArray() };
            Reject(() => ScheduleRouteScenario.Build(escaping, null, repeat));
            var parallelInside = loop with { Nodes = loop.Nodes.Select(node => node.Id == "body" ? node with { Type = "parallelGateway" } : node).ToArray() };
            Reject(() => ScheduleRouteScenario.Build(parallelInside, null, repeat));
            var transferInside = loop with { Nodes = loop.Nodes.Select(node => node with { InformationObjects = node.Id == "body" ? [new("shared", "Учебный результат", "Output")] : [] }).ToArray() };
            await Write(root, transferInside);
            var externalRepeat = await service.CalculateAsync(repeatRequest, false);
            Check(externalRepeat.Issues.Any(issue => issue.Code == "repeat-transfer-unexpanded") && !externalRepeat.Complete, "Unexpanded per-pass transfers cannot produce a reliable date");
            foreach (var bad in new[] {
                repeatRequest with { ProcessRepetitions = new Dictionary<string, ScheduleRepetitionModel> { ["route"] = null! } },
                repeatRequest with { ProcessBranches = new Dictionary<string, IReadOnlyDictionary<string, string>> { ["route"] = null! } },
                repeatRequest with { ProcessBranches = new Dictionary<string, IReadOnlyDictionary<string, string>> { ["route"] = new Dictionary<string, string>(), ["ROUTE"] = new Dictionary<string, string>() } }
            })
            {
                var invalid = false;
                try { await service.CalculateAsync(bad, false); } catch (InvalidDataException) { invalid = true; }
                Check(invalid, "Malformed scenario maps reject cleanly");
            }
        }
        finally
        {
            if (Path.GetDirectoryName(root) != temp || !Path.GetFileName(root).StartsWith("pn-scenario-check-")) throw new Exception("Unsafe scenario fixture cleanup");
            Directory.Delete(root, true);
        }
        return count;
    }
    static async Task Write(string root, ProcessModel model)
    {
        XNamespace bpmn = "http://www.omg.org/spec/BPMN/20100524/MODEL", di = "http://www.omg.org/spec/BPMN/20100524/DI", dc = "http://www.omg.org/spec/DD/20100524/DC", point = "http://www.omg.org/spec/DD/20100524/DI";
        var process = new XElement(bpmn + "process", new XAttribute("id", model.Id), new XAttribute("name", model.Name),
            new XElement(bpmn + "laneSet", new XAttribute("id", "lanes"), new XElement(bpmn + "lane", new XAttribute("id", "lane"), model.Nodes.Select(node => new XElement(bpmn + "flowNodeRef", node.Id)))),
            model.Nodes.Select(node => new XElement(bpmn + node.Type, new XAttribute("id", node.Id), new XAttribute("name", node.Name))),
            model.Edges.Select(edge => new XElement(bpmn + "sequenceFlow", new XAttribute("id", edge.Id), new XAttribute("sourceRef", edge.SourceId), new XAttribute("targetRef", edge.TargetId))));
        XElement Shape(string id) => new(di + "BPMNShape", new XAttribute("id", id + "-di"), new XAttribute("bpmnElement", id), new XElement(dc + "Bounds", new XAttribute("x", 0), new XAttribute("y", 0), new XAttribute("width", 100), new XAttribute("height", 80)));
        var diagram = new XElement(di + "BPMNDiagram", new XAttribute("id", "diagram"), new XElement(di + "BPMNPlane", new XAttribute("id", "plane"), new XAttribute("bpmnElement", model.Id),
            Shape("lane"), model.Nodes.Select(node => Shape(node.Id)), model.Edges.Select(edge => new XElement(di + "BPMNEdge", new XAttribute("id", edge.Id + "-di"), new XAttribute("bpmnElement", edge.Id),
                new XElement(point + "waypoint", new XAttribute("x", 0), new XAttribute("y", 0)), new XElement(point + "waypoint", new XAttribute("x", 100), new XAttribute("y", 100))))));
        await File.WriteAllTextAsync(Path.Combine(root, "Data", model.Id + ".bpmn"), new XDocument(new XElement(bpmn + "definitions", process, diagram)).ToString());
        await File.WriteAllTextAsync(Path.Combine(root, "Data", model.Id + ".context.json"), JsonSerializer.Serialize(new {
            version = model.Version, owner = model.Owner, status = model.Status,
            passport = model.Passport,
            elements = model.Nodes.ToDictionary(node => node.Id, node => new { workDuration = node.Type == "task" ? node.Duration : null, informationObjects = node.InformationObjects })
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
    private sealed class Environment(string root) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "ScenarioChecks";
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = root;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = root;
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }
}
