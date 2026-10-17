using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

// Separate storage: assigning a baseline never rewrites execution steps or their history.
public sealed class InstanceSchedulePlanService(IWebHostEnvironment environment,
    ProcessExecutionService executions, ProcessScheduleService schedule)
{
    private readonly string root = Path.Combine(environment.ContentRootPath, "Data", "SchedulePlans");
    private readonly SemaphoreSlim gate = new(1, 1);
    private static readonly JsonSerializerOptions json = new() { PropertyNameCaseInsensitive = true };

    public async Task<IReadOnlyList<InstanceSchedulePlanModel>> ListAsync(string processId, string instanceId, CancellationToken ct = default)
    {
        var path = PathFor(processId, instanceId);
        if (!(await executions.ListAsync(processId, ct)).Any(item => item.Id == instanceId)) throw new KeyNotFoundException();
        return await ReadAsync(path, ct);
    }

    public async Task<InstanceSchedulePlanModel> AssignAsync(string processId, string instanceId,
        InstanceSchedulePlanUpdateModel update, string userId, CancellationToken ct = default)
    {
        var path = PathFor(processId, instanceId);
        if (update.Request is null || string.IsNullOrWhiteSpace(update.Reason) || update.Reason.Trim().Length is < 3 or > 500)
            throw new InvalidDataException("Укажите причину назначения или замены плана (3–500 символов).");
        // Only published models may be baselined for published executions. Recalculate on the server,
        // never accept client-provided dates as the authoritative plan.
        var calculated = await schedule.CalculateAsync(update.Request, false, ct);
        var item = calculated.Processes.SingleOrDefault(item => item.ProcessId == processId)
            ?? throw new InvalidDataException("Выполнение не входит в рассчитанную цепочку.");
        var source = calculated.Sources?.Processes.SingleOrDefault(item => item.Id == processId)
            ?? throw new InvalidDataException("Не удалось зафиксировать исходную модель.");
        if (item.StartAt != update.ExpectedStartAt || item.EndAt != update.ExpectedEndAt || source.Version != update.ExpectedVersion)
            throw new InvalidDataException("Расчёт изменился. Пересчитайте сроки и проверьте новые даты перед назначением.");
        if (update.ExpectedSources is null || calculated.Sources!.Algorithm != update.ExpectedSources.Algorithm ||
            JsonSerializer.Serialize(calculated.Sources.Processes, json) != JsonSerializer.Serialize(update.ExpectedSources.Processes, json) ||
            JsonSerializer.Serialize(calculated.Sources.Objects, json) != JsonSerializer.Serialize(update.ExpectedSources.Objects, json))
            throw new InvalidDataException("Исходные данные расчёта изменились или отсутствуют. Пересчитайте сроки перед назначением.");
        if (!item.IsDateReliable || !calculated.Complete)
            throw new InvalidDataException("Предварительный расчёт с пробелами нельзя назначить базовым планом. Сначала устраните замечания.");
        await gate.WaitAsync(ct);
        try
        {
            var instance = (await executions.ListAsync(processId, ct)).SingleOrDefault(item => item.Id == instanceId)
                ?? throw new KeyNotFoundException();
            if (instance.Status is not ("Active" or "Paused")) throw new InvalidDataException("Завершённому или отменённому выполнению план не назначается.");
            if (instance.ProcessVersion != source.Version) throw new InvalidDataException("Версия выполнения отличается от рассчитанной модели.");
            var history = await ReadAsync(path, ct);
            if (history.LastOrDefault()?.Id != update.PreviousPlanId) throw new InvalidDataException("План уже изменён. Обновите историю перед повторной записью.");
            if (history.Count >= 20) throw new InvalidDataException("Достигнут предел 20 редакций плана; история не удаляется автоматически.");
            var plan = new InstanceSchedulePlanModel(Guid.NewGuid().ToString("N"), processId, instanceId,
                source.Version, DateTimeOffset.UtcNow, userId, update.Reason.Trim(), update.Request, item, calculated.Sources!);
            var content = JsonSerializer.SerializeToUtf8Bytes(history.Append(plan), json);
            if (content.Length > 20 * 1024 * 1024) throw new InvalidDataException("История планов превышает 20 МБ; запись отменена без удаления данных.");
            Directory.CreateDirectory(root);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try { await File.WriteAllBytesAsync(temporary, content, ct); File.Move(temporary, path, true); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
            return plan;
        }
        finally { gate.Release(); }
    }

    public async Task<SchedulePlanFreshnessModel> CheckAsync(string processId, string instanceId, CancellationToken ct = default)
    {
        var baseline = (await ListAsync(processId, instanceId, ct)).LastOrDefault();
        if (baseline is null) return new(null, DateTimeOffset.UtcNow, "NoPlan", [], 0);
        ProcessScheduleModel current;
        try { current = await schedule.CalculateAsync(baseline.Request, false, ct); }
        catch (FileNotFoundException) { return Unavailable("Опубликованный процесс расчёта отсутствует."); }
        catch (InvalidDataException exception) { return Unavailable(exception.Message); }
        // A concurrent replacement must never be reported as checked by this request.
        if ((await ListAsync(processId, instanceId, ct)).LastOrDefault()?.Id != baseline.Id)
            return new(baseline.Id, DateTimeOffset.UtcNow, "Superseded",
                [new("Plan", baseline.Id, "Базовый план", "План заменён во время проверки. Обновите историю.")], 1);
        return Compare(baseline, current);

        SchedulePlanFreshnessModel Unavailable(string message) => new(baseline.Id, DateTimeOffset.UtcNow, "Unavailable",
            [new("Calculation", processId, "Пересчёт", message)], 1);
    }

    public static SchedulePlanFreshnessModel Compare(InstanceSchedulePlanModel baseline, ProcessScheduleModel current)
    {
        var changes = new List<SchedulePlanChangeModel>();
        if (current.Sources is null)
            return new(baseline.Id, DateTimeOffset.UtcNow, "Unavailable",
                [new("Source", baseline.ProcessId, "Исходники", "Пересчёт не вернул снимок исходных данных.")], 1);
        if (baseline.Sources.Algorithm != current.Sources.Algorithm)
            changes.Add(new("Algorithm", "algorithm", "Алгоритм", $"{baseline.Sources.Algorithm} → {current.Sources.Algorithm}"));
        var oldModels = baseline.Sources.Processes.ToDictionary(item => item.Id, StringComparer.Ordinal);
        var newModels = current.Sources.Processes.ToDictionary(item => item.Id, StringComparer.Ordinal);
        foreach (var id in oldModels.Keys.Union(newModels.Keys).Order(StringComparer.Ordinal))
        {
            oldModels.TryGetValue(id, out var before); newModels.TryGetValue(id, out var after);
            if (before is null) changes.Add(new("ProcessAdded", id, after!.Name, "Процесс добавлен в исходную цепочку."));
            else if (after is null) changes.Add(new("ProcessRemoved", id, before.Name, "Процесс больше не входит в исходную цепочку."));
            else if (JsonSerializer.Serialize(before, json) != JsonSerializer.Serialize(after, json))
                changes.Add(new("ProcessChanged", id, after.Name, before.Version == after.Version
                    ? $"Изменилось содержимое модели при прежней версии {after.Version}: схема, описание, нормативы или привязки."
                    : $"Версия модели: {before.Version} → {after.Version}."));
        }
        var oldObjects = baseline.Sources.Objects.ToDictionary(item => item.Id, StringComparer.Ordinal);
        var newObjects = current.Sources.Objects.ToDictionary(item => item.Id, StringComparer.Ordinal);
        foreach (var id in oldObjects.Keys.Union(newObjects.Keys).Order(StringComparer.Ordinal))
        {
            oldObjects.TryGetValue(id, out var before); newObjects.TryGetValue(id, out var after);
            if (before is null) changes.Add(new("ObjectAdded", id, after!.Name, "Документ или результат добавлен в исходники."));
            else if (after is null) changes.Add(new("ObjectRemoved", id, before.Name, "Документ или результат отсутствует в новых исходниках."));
            else if (JsonSerializer.Serialize(before, json) != JsonSerializer.Serialize(after, json))
                changes.Add(new("ObjectChanged", id, after.Name, "Изменились свойства документа, источники или получатели."));
        }
        var item = current.Processes.SingleOrDefault(item => item.ProcessId == baseline.ProcessId);
        if (item is null) changes.Add(new("Schedule", baseline.ProcessId, baseline.Item.ProcessName, "Процесс отсутствует в новой расчётной последовательности."));
        else if (JsonSerializer.Serialize(baseline.Item, json) != JsonSerializer.Serialize(item, json))
            changes.Add(new("Schedule", item.ProcessId, item.ProcessName, "Изменились расчётные даты, длительность, резерв или достоверность."));
        if (!current.Complete || item?.IsDateReliable == false)
            changes.Add(new("Reliability", baseline.ProcessId, "Полнота расчёта", "Новый расчёт предварительный: проверьте замечания и недостающие данные."));
        return new(baseline.Id, DateTimeOffset.UtcNow, changes.Count == 0 ? "Current" : "Changed",
            changes.Take(50).ToArray(), changes.Count, item,
            item is null ? null : Math.Round((item.EndAt - baseline.Item.EndAt).TotalHours, 2));
    }

    private static async Task<IReadOnlyList<InstanceSchedulePlanModel>> ReadAsync(string path, CancellationToken ct)
    {
        if (!File.Exists(path)) return [];
        if (new FileInfo(path).Length > 20 * 1024 * 1024) throw new InvalidDataException("История планов превышает допустимый размер.");
        try
        {
            var items = JsonSerializer.Deserialize<InstanceSchedulePlanModel[]>(await File.ReadAllTextAsync(path, ct), json);
            if (items is null || items.Length > 20 || items.Any(item => item is null || item.Item is null || item.Sources is null ||
                item.Request is null || item.Sources.Processes is null || item.Sources.Objects is null ||
                item.Item.UncertaintyReasons is null || !Guid.TryParseExact(item.Id, "N", out _) || item.Item.ProcessId != item.ProcessId ||
                Path.GetFileNameWithoutExtension(path) != item.ProcessId + "_" + item.InstanceId ||
                item.Item.EndAt < item.Item.StartAt) || items.Select(item => item.Id).Distinct().Count() != items.Length)
                throw new InvalidDataException("История планов повреждена; автоматическая перезапись запрещена.");
            return items;
        }
        catch (JsonException) { throw new InvalidDataException("История планов повреждена; автоматическая перезапись запрещена."); }
    }

    private string PathFor(string processId, string instanceId)
    {
        if (processId.Length is < 1 or > 100 || processId.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.')) ||
            !Guid.TryParseExact(instanceId, "N", out _)) throw new InvalidDataException("Недопустимый идентификатор процесса или выполнения.");
        return Path.Combine(root, processId + "_" + instanceId + ".json");
    }
}
