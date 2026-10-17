using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class ScheduleChecks
{
    public static async Task<int> RunAsync()
    {
        var temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        var root = Path.Combine(temp, "pn-schedule-check-" + Guid.NewGuid().ToString("N"));
        var data = Path.Combine(root, "Data");
        Directory.CreateDirectory(data);
        var count = 0;
        void Check(bool value, string label) { if (!value) throw new Exception(label); count++; }
        async Task Reject(ProcessScheduleService service, ProcessScheduleRequestModel request)
        {
            var rejected = false;
            try { await service.CalculateAsync(request, false); } catch (InvalidDataException) { rejected = true; }
            Check(rejected, "Invalid scenario must be rejected");
        }
        try
        {
            foreach (var id in new[] { "source", "target" })
            {
                await File.WriteAllTextAsync(Path.Combine(data, id + ".bpmn"), $$"""
                    <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                      xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">
                      <process id="{{id}}" name="{{id}}"><laneSet id="lanes"><lane id="lane"><flowNodeRef>task</flowNodeRef></lane></laneSet><task id="task" name="Работа"/></process>
                      <bpmndi:BPMNDiagram id="diagram"><bpmndi:BPMNPlane id="plane" bpmnElement="{{id}}">
                        <bpmndi:BPMNShape id="lane-di" bpmnElement="lane"><dc:Bounds x="0" y="0" width="400" height="180"/></bpmndi:BPMNShape>
                        <bpmndi:BPMNShape id="task-di" bpmnElement="task"><dc:Bounds x="100" y="40" width="120" height="80"/></bpmndi:BPMNShape>
                      </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
                    </definitions>
                    """);
                await File.WriteAllTextAsync(Path.Combine(data, id + ".context.json"), JsonSerializer.Serialize(new {
                    version = "test-1", owner = "Учебный отдел", status = "Published",
                    elements = new Dictionary<string, object> { ["task"] = new { workDuration = "8 часов", informationObjects = new[] {
                        new { objectId = "shared", name = "Учебный результат", role = id == "source" ? "Output" : "Input", required = true }
                    } } }
                }));
            }
            var env = new Environment(root);
            var catalog = new ProcessCatalogService(new BpmnProcessLoader(env));
            var service = new ProcessScheduleService(catalog, new InformationObjectRegistryService(catalog, env));
            var request = new ProcessScheduleRequestModel("source", "Forward", DateTimeOffset.Parse("2026-10-19T06:00:00Z"), UtcOffsetMinutes: 180);
            var result = await service.CalculateAsync(request, false);
            Check(result.Processes.Single(item => item.ProcessId == "source").EndAt == DateTimeOffset.Parse("2026-10-19T14:00:00Z"), "UTC input must use explicit local calendar hours");
            Check(result.EndAt == DateTimeOffset.Parse("2026-10-20T14:00:00Z"), "Sequential work rolls over to next workday");
            Check(result.Sources?.Processes.Count == 2 && result.Sources.Objects.Single().Id == "shared", "Snapshot captures actual models and dependency objects");
            Check(result.Sources?.Algorithm == "schedule-v2-fixed-offset" && result.Assumptions.UtcOffsetMinutes == 180, "Algorithm and calendar offset retained");
            var profile = new ScheduleCalendarModel("09:00", "17:00", [1, 2, 3, 4, 5], [], 300);
            var custom = request with { ProcessCalendars = new Dictionary<string, ScheduleCalendarModel> { ["target"] = profile } };
            var different = await service.CalculateAsync(custom, false);
            Check(different.EndAt == DateTimeOffset.Parse("2026-10-20T12:00:00Z"), "Recipient calendar applies its own UTC offset");
            Check(different.Issues.Any(item => item.Code == "calendar-reserve"), "Nominal reserve caveat is explicit with multiple calendars");
            var reverse = await service.CalculateAsync(custom with { RootProcessId = "target", Direction = "Backward", AnchorDate = different.EndAt }, false);
            Check(reverse.StartAt == result.StartAt, "Backward calculation respects both calendars");
            var withDelay = await service.CalculateAsync(custom with { TransferDelayHours = 2 }, false);
            Check(withDelay.EndAt == DateTimeOffset.Parse("2026-10-21T06:00:00Z"), "Transfer delay uses recipient working hours");
            var reverseDelay = await service.CalculateAsync(custom with { RootProcessId = "target", Direction = "Backward", TransferDelayHours = 2, AnchorDate = withDelay.EndAt }, false);
            Check(reverseDelay.StartAt == result.StartAt, "Backward transfer uses same recipient calendar as forward transfer");
            var holiday = await service.CalculateAsync(custom with { ProcessCalendars = new Dictionary<string, ScheduleCalendarModel> { ["target"] = profile with { NonWorkingDates = ["2026-10-20"] } } }, false);
            Check(holiday.EndAt == DateTimeOffset.Parse("2026-10-21T12:00:00Z"), "Process-local holiday moves only its work");
            var sunday = await service.CalculateAsync(custom with { ProcessCalendars = new Dictionary<string, ScheduleCalendarModel> { ["target"] = profile with { WorkingDays = [0] } } }, false);
            Check(sunday.EndAt == DateTimeOffset.Parse("2026-10-25T12:00:00Z"), "Separate work week can include Sunday only");
            var caseProfile = await service.CalculateAsync(custom with { ProcessCalendars = new Dictionary<string, ScheduleCalendarModel> { ["TARGET"] = profile } }, false);
            Check(caseProfile.EndAt == different.EndAt && caseProfile.Assumptions.ProcessCalendars!.ContainsKey("target"), "Calendar ID matching is case-insensitive and canonical in result");
            var shifted = await service.CalculateAsync(request with { AnchorDate = DateTimeOffset.Parse("2026-10-19T09:00:00+03:00"), UtcOffsetMinutes = null }, false);
            Check(shifted.StartAt == result.StartAt && shifted.EndAt == result.EndAt, "Legacy explicit anchor offset remains supported");
            await Reject(service, request with { WorkingDays = [] });
            await Reject(service, request with { UtcOffsetMinutes = 841 });
            await Reject(service, request with { DurationScalePercent = double.NaN });
            await Reject(service, request with { TransferDelayHours = double.PositiveInfinity });
            await Reject(service, request with { Direction = null! });
            await Reject(service, request with { AnchorDate = DateTimeOffset.MaxValue });
            await Reject(service, request with { Checkpoints = new Dictionary<string, DateTimeOffset> { ["source"] = DateTimeOffset.MaxValue } });
            await Reject(service, custom with { ProcessCalendars = new Dictionary<string, ScheduleCalendarModel> { ["unknown"] = profile } });
            await Reject(service, custom with { ProcessCalendars = new Dictionary<string, ScheduleCalendarModel> { ["target"] = profile with { NonWorkingDates = ["bad"] } } });
            await Reject(service, custom with { ProcessCalendars = new Dictionary<string, ScheduleCalendarModel> { ["target"] = profile with { WorkdayStart = "17:00", WorkdayEnd = "09:00" } } });
            await Reject(service, custom with { ProcessCalendars = new Dictionary<string, ScheduleCalendarModel> { ["target"] = null! } });
            var saved = JsonSerializer.Serialize(different);
            var reloaded = JsonSerializer.Deserialize<ProcessScheduleModel>(saved)!;
            Check(reloaded.Sources?.Processes.Single(item => item.Id == "source").Version == "test-1" && reloaded.Assumptions.ProcessCalendars!["target"].UtcOffsetMinutes == 300, "Source versions and calendars survive JSON snapshot round trip");
            var contextPath = Path.Combine(data, "source.context.json");
            var changedContext = System.Text.Json.Nodes.JsonNode.Parse(await File.ReadAllTextAsync(contextPath))!;
            changedContext["elements"]!["task"]!["workDuration"] = "4 часа";
            await File.WriteAllTextAsync(contextPath, changedContext.ToJsonString());
            var recalculated = await service.CalculateAsync(request, false);
            Check(recalculated.Sources!.Processes.Single(item => item.Id == "source").Nodes.Single().WorkDuration == "4 часа", "Recalculation uses current model even with unchanged version");
            Check(different.Sources!.Processes.Single(item => item.Id == "source").Nodes.Single().WorkDuration == "8 часов", "Previous source snapshot stays unchanged");
        }
        finally
        {
            if (Path.GetDirectoryName(root) != temp || !Path.GetFileName(root).StartsWith("pn-schedule-check-")) throw new Exception("Unsafe schedule fixture cleanup");
            Directory.Delete(root, true);
        }
        return count;
    }
    private sealed class Environment(string root) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "ScheduleChecks";
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = root;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = root;
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }
}
