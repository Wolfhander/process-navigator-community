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
Console.WriteLine($"Boundary checks passed: {count} scenarios.");
