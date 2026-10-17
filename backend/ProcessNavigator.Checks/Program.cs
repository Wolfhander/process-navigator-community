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
Console.WriteLine($"Boundary checks passed: {count} scenarios.");
