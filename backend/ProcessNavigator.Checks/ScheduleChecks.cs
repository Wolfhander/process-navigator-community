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
            var archives = new ScheduleArchiveService(env, service);
            var archiveUpdate = new ScheduleArchiveSaveModel("Контрольный сценарий", request, result);
            var archived = await archives.SaveAsync("archive-owner", archiveUpdate, false);
            Check((await archives.ListAsync("archive-owner", false)).Count == 1 && (await archives.ListAsync("other-owner", false)).Count == 0,
                "Server archive is private to its owner");
            var readArchive = await new ScheduleArchiveService(env, service).LoadAsync("archive-owner", archived.Id, false);
            Check(readArchive.Result.EndAt == result.EndAt && readArchive.Request.WorkingDays!.Count == 5 && readArchive.Request.Checkpoints is not null,
                "Server archive survives reload and normalizes request defaults for UI restoration");
            var parallelArchive = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => archives.SaveAsync("archive-owner", archiveUpdate, false)));
            Check(parallelArchive.All(item => item.Id == archived.Id) && (await archives.ListAsync("archive-owner", false)).Count == 1,
                "Concurrent identical saves never multiply archive entries");
            async Task RejectArchive(ScheduleArchiveSaveModel value, string label, string owner = "archive-owner")
            {
                var rejected = false;
                try { await archives.SaveAsync(owner, value, false); } catch (InvalidDataException) { rejected = true; }
                Check(rejected, label);
            }
            await RejectArchive(archiveUpdate with { ExpectedResult = result with { EndAt = result.EndAt.AddHours(1) } }, "Client-supplied altered dates not archived");
            await RejectArchive(archiveUpdate with { Name = " " }, "Archive name required");
            var hidden = false;
            try { await archives.LoadAsync("other-owner", archived.Id, false); } catch (KeyNotFoundException) { hidden = true; }
            Check(hidden && !await archives.DeleteAsync("other-owner", archived.Id, false), "Other profile cannot read or delete archive entry by known ID");
            var secondArchive = await archives.SaveAsync("archive-owner", archiveUpdate with { Name = "Вторая запись" }, false);
            Check(secondArchive.Id != archived.Id && (await archives.ListAsync("archive-owner", false)).Count == 2, "New archive entry never overwrites an old snapshot");
            Check(await archives.DeleteAsync("archive-owner", secondArchive.Id, false) && (await archives.ListAsync("archive-owner", false)).Single().Id == archived.Id,
                "Explicit owner deletion removes only selected archive entry");
            var safeId = false;
            try { await archives.LoadAsync("archive-owner", "../../other", false); } catch (InvalidDataException) { safeId = true; }
            Check(safeId, "Archive IDs cannot escape storage directory");
            for (var index = 0; index < 20; index++) await archives.SaveAsync("quota-owner", archiveUpdate with { Name = "Сценарий " + index }, false);
            await RejectArchive(archiveUpdate, "Server archive quota never evicts existing entries", "quota-owner");
            Check((await archives.ListAsync("quota-owner", false)).Count == 20, "Archive count retained after quota rejection");
            await archives.SaveAsync("damaged-owner", archiveUpdate, false);
            var damagedArchivePath = Path.Combine(data, "ScheduleArchive", Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("damaged-owner")))) + ".json";
            await File.WriteAllTextAsync(damagedArchivePath, "null");
            await RejectArchive(archiveUpdate, "Corrupt server archive not overwritten", "damaged-owner");
            Check(await File.ReadAllTextAsync(damagedArchivePath) == "null", "Corrupt archive retained for recovery");
            var drafts = Path.Combine(data, "Drafts");
            Directory.CreateDirectory(drafts);
            File.Copy(Path.Combine(data, "source.bpmn"), Path.Combine(drafts, "source.bpmn"));
            var draftContext = System.Text.Json.Nodes.JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(data, "source.context.json")))!;
            draftContext["version"] = "draft-2"; draftContext["status"] = "Draft";
            await File.WriteAllTextAsync(Path.Combine(drafts, "source.context.json"), draftContext.ToJsonString());
            var draftResult = await service.CalculateAsync(request, true);
            var draftArchive = await archives.SaveAsync("draft-owner", archiveUpdate with { ExpectedResult = draftResult }, true);
            Check((await archives.ListAsync("draft-owner", false)).Count == 0 && (await archives.ListAsync("draft-owner", true)).Count == 1,
                "Draft archive hidden when edit permission is absent");
            var draftHidden = false;
            try { await archives.LoadAsync("draft-owner", draftArchive.Id, false); } catch (KeyNotFoundException) { draftHidden = true; }
            Check(draftHidden && !await archives.DeleteAsync("draft-owner", draftArchive.Id, false), "Draft permission enforced for direct load and deletion");
            File.Delete(Path.Combine(drafts, "source.bpmn")); File.Delete(Path.Combine(drafts, "source.context.json"));
            var executions = new ProcessExecutionService(env);
            var process = await catalog.LoadAsync("source", false, default);
            var instance = await executions.StartAsync(process, "tester", "Контрольный заказ", default);
            var plans = new InstanceSchedulePlanService(env, executions, service);
            var scheduledItem = result.Processes.Single(item => item.ProcessId == "source");
            var update = new InstanceSchedulePlanUpdateModel(request, scheduledItem.StartAt, scheduledItem.EndAt,
                process.Version, null, "Первоначальный план", result.Sources);
            var apiJson = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
            update = JsonSerializer.Deserialize<InstanceSchedulePlanUpdateModel>(JsonSerializer.Serialize(update, apiJson), apiJson)!;
            async Task RejectPlan(InstanceSchedulePlanUpdateModel value, string label, string? target = null)
            {
                var rejected = false;
                try { await plans.AssignAsync("source", target ?? instance.Id, value, "tester"); }
                catch (InvalidDataException) { rejected = true; }
                catch (KeyNotFoundException) { rejected = true; }
                Check(rejected, label);
            }
            Check((await plans.ListAsync("source", instance.Id)).Count == 0, "Legacy execution needs no plan migration");
            Check((await plans.CheckAsync("source", instance.Id)).Status == "NoPlan", "Freshness does not invent a missing baseline");
            var assigned = await plans.AssignAsync("source", instance.Id, update, "tester");
            var baselinePath = Path.Combine(data, "SchedulePlans", "source_" + instance.Id + ".json");
            var baselineBytes = await File.ReadAllBytesAsync(baselinePath);
            var freshness = await plans.CheckAsync("source", instance.Id);
            Check(freshness.Status == "Current" && freshness.TotalChanges == 0 && freshness.PlanId == assigned.Id && freshness.FinishShiftHours == 0,
                "Unchanged sources remain current despite a new capture timestamp");
            Check((await File.ReadAllBytesAsync(baselinePath)).SequenceEqual(baselineBytes), "Freshness check never modifies the saved baseline");
            var algorithmCheck = InstanceSchedulePlanService.Compare(assigned, result with { Sources = result.Sources! with { Algorithm = "different" } });
            Check(algorithmCheck.Status == "Changed" && algorithmCheck.Changes.Any(item => item.Kind == "Algorithm"), "Algorithm drift explained");
            Check(InstanceSchedulePlanService.Compare(assigned, result with { Sources = null }).Status == "Unavailable", "Missing source snapshot is not current");
            var objectCheck = InstanceSchedulePlanService.Compare(assigned, result with { Sources = result.Sources! with {
                Objects = result.Sources.Objects.Select(item => item with { Name = "Изменённый документ" }).ToArray() } });
            Check(objectCheck.Changes.Any(item => item.Kind == "ObjectChanged"), "Document property drift explained");
            Check(InstanceSchedulePlanService.Compare(assigned, result with { Sources = result.Sources! with { Objects = [] } }).Changes.Any(item => item.Kind == "ObjectRemoved"), "Removed source object explained");
            Check(InstanceSchedulePlanService.Compare(assigned, result with { Complete = false }).Changes.Any(item => item.Kind == "Reliability"), "Preliminary recalculation cannot confirm a baseline");
            var manyChanges = InstanceSchedulePlanService.Compare(assigned, result with { Sources = result.Sources! with {
                Processes = Enumerable.Range(0, 60).Select(index => process with { Id = "added-" + index }).ToArray() } });
            Check(manyChanges.Changes.Count == 50 && manyChanges.TotalChanges > 50 && manyChanges.Status == "Changed", "Large drift report has explicit bounded output");
            Check(assigned.Item.EndAt == scheduledItem.EndAt && assigned.AssignedBy == "tester", "Plan is calculated and attributed on server");
            Check(JsonSerializer.Serialize((await executions.ListAsync("source", default)).Single()) == JsonSerializer.Serialize(instance), "Baseline leaves all execution history and normative steps unchanged");
            await RejectPlan(update, "Stale baseline revision rejected");
            await RejectPlan(update with { PreviousPlanId = assigned.Id, Reason = " " }, "Empty reason rejected");
            await RejectPlan(update with { PreviousPlanId = assigned.Id, ExpectedEndAt = scheduledItem.EndAt.AddHours(1) }, "Changed dates rejected");
            await RejectPlan(update with { PreviousPlanId = assigned.Id, ExpectedSources = null }, "Missing source snapshot rejected");
            await RejectPlan(update with { PreviousPlanId = assigned.Id, ExpectedSources = result.Sources! with { Algorithm = "old" } }, "Changed algorithm rejected");
            await RejectPlan(update with { PreviousPlanId = assigned.Id, ExpectedSources = result.Sources! with {
                Processes = result.Sources.Processes.Select(item => item.Id == "source" ? item with { Name = "Изменено без новой версии" } : item).ToArray()
            } }, "Source content mismatch rejected even with same dates and version");
            await RejectPlan(update, "Unknown instance rejected", Guid.NewGuid().ToString("N"));
            await RejectPlan(update, "Unsafe identifier rejected", "../../other");
            var replacement = update with { PreviousPlanId = assigned.Id, Reason = "Уточнение календарного плана" };
            var results = await Task.WhenAll(Enumerable.Range(0, 2).Select(async _ => {
                try { await plans.AssignAsync("source", instance.Id, replacement, "tester"); return true; }
                catch (InvalidDataException) { return false; }
            }));
            Check(results.Count(item => item) == 1, "Only one concurrent replacement commits");
            var history = await new InstanceSchedulePlanService(env, executions, service).ListAsync("source", instance.Id);
            Check(history.Count == 2 && history[0].Id == assigned.Id && history[0].Reason == "Первоначальный план", "Baseline revisions survive service reload without overwriting first plan");
            await executions.ChangeLifecycleAsync("source", instance.Id, "pause", "Пауза заказа", "tester", default);
            var pausedPlan = await plans.AssignAsync("source", instance.Id, update with { PreviousPlanId = history[^1].Id, Reason = "План на период паузы" }, "tester");
            Check(pausedPlan.Item.EndAt == assigned.Item.EndAt, "Pause never silently moves baseline deadline");
            await executions.ChangeLifecycleAsync("source", instance.Id, "cancel", "Заказ отменён", "tester", default);
            await RejectPlan(update with { PreviousPlanId = pausedPlan.Id }, "Cancelled execution cannot be replanned");
            var completed = await executions.StartAsync(process, "tester", "Завершённый заказ", default);
            await executions.UpdateStepAsync(process, completed.Id, "task", "InProgress", "tester", default);
            await executions.SaveStepResultAsync(process, completed.Id, "task", "Результат готов", ["shared"], "tester", default);
            await executions.UpdateStepAsync(process, completed.Id, "task", "Completed", "tester", default);
            await RejectPlan(update, "Completed execution cannot be replanned", completed.Id);
            var otherVersion = await executions.StartAsync(process with { Version = "other-version" }, "tester", "Другая версия", default);
            await RejectPlan(update, "Mismatched execution version rejected", otherVersion.Id);
            var damaged = await executions.StartAsync(process, "tester", "Повреждённая история", default);
            var damagedPlan = await plans.AssignAsync("source", damaged.Id, update, "tester");
            var damagedPath = Path.Combine(data, "SchedulePlans", "source_" + damaged.Id + ".json");
            await File.WriteAllTextAsync(damagedPath, "broken-json");
            await RejectPlan(update with { PreviousPlanId = damagedPlan.Id }, "Corrupt history cannot be overwritten", damaged.Id);
            Check(await File.ReadAllTextAsync(damagedPath) == "broken-json", "Corrupt history retained for recovery");
            await File.WriteAllTextAsync(damagedPath, "[null]");
            await RejectPlan(update with { PreviousPlanId = damagedPlan.Id }, "Structurally corrupt JSON history rejected", damaged.Id);
            Check(result.Processes.Single(item => item.ProcessId == "source").EndAt == DateTimeOffset.Parse("2026-10-19T14:00:00Z"), "UTC input must use explicit local calendar hours");
            Check(result.EndAt == DateTimeOffset.Parse("2026-10-20T14:00:00Z"), "Sequential work rolls over to next workday");
            Check(result.Sources?.Processes.Count == 2 && result.Sources.Objects.Single().Id == "shared", "Snapshot captures actual models and dependency objects");
            Check(result.Sources?.Algorithm == "schedule-v3-route-scenario" && result.Assumptions.UtcOffsetMinutes == 180, "Algorithm and calendar offset retained");
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
            Check((await archives.LoadAsync("archive-owner", archived.Id, false)).Result.EndAt == result.EndAt, "Opening archive after source edits never recalculates past dates");
            await RejectArchive(archiveUpdate, "Stale source/result pair cannot be saved as verified server snapshot");
            Check(recalculated.Sources!.Processes.Single(item => item.Id == "source").Nodes.Single().WorkDuration == "4 часа", "Recalculation uses current model even with unchanged version");
            Check(different.Sources!.Processes.Single(item => item.Id == "source").Nodes.Single().WorkDuration == "8 часов", "Previous source snapshot stays unchanged");
            var latestBeforeCheck = await File.ReadAllBytesAsync(baselinePath);
            var drift = await plans.CheckAsync("source", instance.Id);
            Check(drift.Status == "Changed" && drift.Changes.Any(item => item.Kind == "ProcessChanged" && item.Message.Contains("прежней версии")), "Same-version normative edits mark baseline as changed");
            Check(drift.FinishShiftHours == -4 && drift.CurrentItem!.EndAt == assigned.Item.EndAt.AddHours(-4), "Calendar finish delta compares new calculation with original baseline");
            Check((await File.ReadAllBytesAsync(baselinePath)).SequenceEqual(latestBeforeCheck), "Drift check preserves all plan revisions and dates");
            File.Move(Path.Combine(data, "source.bpmn"), Path.Combine(data, "source.bpmn.hold"));
            Check((await archives.LoadAsync("archive-owner", archived.Id, false)).Result.RootProcessId == "source", "Past archive still opens after deleting its original process");
            Check((await plans.CheckAsync("source", instance.Id)).Status == "Unavailable", "Deleted published root gives unknown freshness, not current");
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
