using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

static NodeModel Node(params InformationObjectBindingModel[] bindings) =>
    new("step", "task", "Этап", "lane", 0, 0, 100, 80, null, null, null, [], [], InformationObjects: bindings);
static ProcessModel Child(params InformationObjectBindingModel[] bindings) =>
    new("child", "Детальный процесс", "1", "Демо", "Published", [], [Node(bindings)], []);
var count = 0;
void Check(bool condition, string label) { if (!condition) throw new Exception(label); count++; }
var input = new InformationObjectBindingModel("request", "Заявка", "Input", Version: "1");
var output = new InformationObjectBindingModel("result", "Результат", "Output");

Check(ProcessBoundaryCheck.Compare(Node(input, output), Child(input, output)).Count == 0, "Matched boundaries should pass");
var missing = ProcessBoundaryCheck.Compare(Node(input, output), Child());
Check(missing.Count == 2 && missing.All(issue => issue.Severity == "Warning" && issue.Category == "Decomposition" && issue.ElementId == "step"), "Missing IDs must be non-blocking, actionable issues");
Check(ProcessBoundaryCheck.Compare(Node(input), Child(input with { Role = "Output" })).Single().Code.EndsWith("input-missing"), "Matching name/ID in opposite direction must not pass");
Check(ProcessBoundaryCheck.Compare(Node(input), Child(input with { Version = "2" })).Single().Code.EndsWith("version"), "Different explicit versions must be reported");
Check(ProcessBoundaryCheck.Compare(Node(input), Child(input with { Version = null })).Single().Code.EndsWith("version"), "Unspecified child version must not confirm a required version");
Check(ProcessBoundaryCheck.Compare(Node(input with { Required = false }), Child()).Count == 0, "Optional boundaries are not required");
Check(ProcessBoundaryCheck.Compare(Node(), Child()).Single().Code.EndsWith("unmapped"), "Text-only boundaries must not appear automatically verified");
Check(ProcessBoundaryCheck.Compare(Node(input), Child(input with { Name = "Другое имя", ObjectId = "REQUEST" })).Count == 0, "Stable ID, not name, determines the match");
var extra = input with { ObjectId = "external", Name = "Внешнее задание", Version = null };
Check(ProcessBoundaryCheck.Compare(Node(output), Child(extra)).Any(issue => issue.Code.EndsWith("external-input")), "Required child input without a producer must be visible at parent boundary");
Check(ProcessBoundaryCheck.Compare(Node(output), Child(extra with { Condition = "По запросу клиента" })).Any(issue => issue.Code.EndsWith("conditional-external-input") && issue.Message.Contains("По запросу клиента")), "Conditional input is reported explicitly with its condition");
Check(!ProcessBoundaryCheck.Compare(Node(output), Child(extra with { Required = false })).Any(issue => issue.Code.EndsWith("external-input")), "Optional child input does not impose a mandatory parent input");
Check(ProcessBoundaryCheck.Compare(Node(input with { Required = false }), Child(input)).Any(issue => issue.Code.EndsWith("input-obligation")), "Mandatory child input must not be confirmed by optional parent input");
Check(ProcessBoundaryCheck.Compare(Node(input with { Version = null }), Child(input)).Any(issue => issue.Code.EndsWith("version")), "Child's explicit version is checked in reverse");
Check(!ProcessBoundaryCheck.Compare(Node(output), Child(extra, extra with { Role = "Output" })).Any(issue => issue.Code.EndsWith("external-input")), "Produced intermediate objects do not impose an external source by this structural check");
Check(ProcessBoundaryCheck.Compare(Node(output), Child(extra, extra)).Count(issue => issue.Code.EndsWith("external-input")) == 1, "Repeated use of the same boundary object does not duplicate missing-source warnings");
Check(ProcessBoundaryCheck.Compare(Node(), Child(extra)).Any(issue => issue.Code.EndsWith("unmapped")) && ProcessBoundaryCheck.Compare(Node(), Child(extra)).Any(issue => issue.Code.EndsWith("external-input")), "Unmapped parent must not stop reverse diagnostics");
static InformationObjectOccurrenceModel Occurrence(string direction, string? version, bool required = true) =>
    new("process", "Процесс", "step", "Этап", "Step", direction, required, Version: version);
static InformationObjectModel RegistryObject(InformationObjectOccurrenceModel[] producers, InformationObjectOccurrenceModel[] consumers, string state = "Active") =>
    new("document", "Документ", "Document", [], "1", state, true, "Связан", producers, consumers, []);
var producer = Occurrence("Producer", "1");
var consumer = Occurrence("Consumer", "1");
Check(InformationObjectPolicy.Check(RegistryObject([producer], [consumer])).Count == 0, "Matching producer/consumer versions pass");
Check(InformationObjectPolicy.Check(RegistryObject([producer], [consumer with { Version = "2" }])).Any(issue => issue.Code == "version-source-missing"), "Required version absent from known producers is identified");
var unknownVersion = InformationObjectPolicy.Check(RegistryObject([producer with { Version = null }], [consumer]));
Check(unknownVersion.Any(issue => issue.Code == "version-unverified") && !unknownVersion.Any(issue => issue.Code == "version-source-missing"), "Unknown version is uncertainty, not proof of absence");
Check(!InformationObjectPolicy.Check(RegistryObject([producer, producer with { Version = "2" }], [consumer])).Any(issue => issue.Code is "version-source-missing" or "version-unverified"), "One matching producer is sufficient for structural version availability, not proof of routing");
Check(InformationObjectPolicy.Check(RegistryObject([producer], [consumer], "Archived")).Any(issue => issue.Code == "archived-in-use"), "Archived mandatory input requires review");
Check(InformationObjectPolicy.Check(RegistryObject([producer], [consumer], "Draft")).Any(issue => issue.Code == "draft-in-use"), "Draft mandatory input requires review");
Check(!InformationObjectPolicy.Check(RegistryObject([producer], [consumer with { Required = false, Version = "2" }], "Archived")).Any(issue => issue.Code is "archived-in-use" or "version-source-missing"), "Optional use is not treated as a mandatory demand");
var referenced = RegistryObject([producer], [consumer]) with { References = [Occurrence("Reference", "old")] };
Check(InformationObjectPolicy.Check(referenced).Count == 0, "Reference-only versions do not imply a transfer conflict");
var grouped = InformationObjectPolicy.Check(RegistryObject([producer], [consumer with { Version = "2" }, consumer with { Version = "3" }]));
Check(grouped.Count(issue => issue.Code == "version-source-missing") == 1 && grouped.Single(issue => issue.Code == "version-source-missing").Message.Contains("3"), "Distinct missing versions aggregate without duplicate issue keys");
Check(!InformationObjectPolicy.Check(RegistryObject([], [consumer])).Any(issue => issue.Code == "version-source-missing"), "Missing producer is diagnosed by the existing registry rule, not duplicated as a version issue");
var versionRecipients = RegistryObject([producer], [consumer, consumer with { ProcessId = "needs-v2", Version = "2" }]);
Check(InformationObjectPolicy.AffectedConsumers(versionRecipients, "version-source-missing").Single().ProcessId == "needs-v2", "Version-specific uncertainty targets only consumers needing the unavailable version");
count += await RegistryLifecycleChecks.RunAsync();
count += await ScheduleChecks.RunAsync();
static bool RejectedTransition(string? previous, string? previousVersion, string state, string version)
{
    try { InformationObjectLifecycle.Validate(previous, previousVersion, state, version); return false; }
    catch (InvalidDataException) { return true; }
}
Check(RejectedTransition("Active", "1", "Draft", "1"), "Active version cannot become the same draft");
Check(RejectedTransition("Archived", "1", "Active", "1"), "Archived version cannot be reactivated in place");
Check(!RejectedTransition("Draft", "1", "Archived", "1"), "Unused draft may be archived");
Check(!RejectedTransition(null, null, "Active", "1"), "Initial registration can describe an already active document");
Check(RejectedTransition(null, null, "Unknown", "1"), "Unknown lifecycle state is rejected");
bool CompositionRejected(InformationObjectComponentModel[] parts, Dictionary<string, IReadOnlyList<InformationObjectComponentModel>>? graph = null)
{
    try { InformationObjectComposition.Validate("kit", parts, graph ?? [], new HashSet<string>(["kit", "part", "other"], StringComparer.OrdinalIgnoreCase)); return false; }
    catch (InvalidDataException) { return true; }
}
Check(CompositionRejected([new("kit")]), "Self reference rejected");
Check(CompositionRejected([new("part")], new() { ["part"] = [new("kit")] }), "Indirect cycle rejected");
Check(CompositionRejected([new("part"), new("PART")]), "Case insensitive duplicate rejected");
Check(CompositionRejected([new("missing")]), "Unknown member rejected");
Check(CompositionRejected([null!]), "Null member rejected");
Check(CompositionRejected([new("part", Version: new string('v', 51))]), "Oversize version rejected");
Check(CompositionRejected(Enumerable.Repeat(new InformationObjectComponentModel("part"), 101).ToArray()), "Direct member limit enforced");
Check(!CompositionRejected([new("part", false, "1", "По запросу"), new("other")], new() { ["other"] = [new("part")] }), "Shared DAG and conditional optional member allowed");
Console.WriteLine($"Server checks passed: {count} scenarios.");
