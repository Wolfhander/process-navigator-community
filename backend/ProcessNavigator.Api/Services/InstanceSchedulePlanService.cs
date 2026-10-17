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
