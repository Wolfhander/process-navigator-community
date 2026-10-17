using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

// Personal immutable results. Never shares user-provided snapshots or changes execution baselines.
public sealed class ScheduleArchiveService(IWebHostEnvironment environment, ProcessScheduleService schedule)
{
    private readonly string root = Path.Combine(environment.ContentRootPath, "Data", "ScheduleArchive");
    private readonly SemaphoreSlim gate = new(1, 1);
    private static readonly JsonSerializerOptions json = new(JsonSerializerDefaults.Web);
    private const int MaxBytes = 20 * 1024 * 1024;
    private sealed record Archive(string OwnerId, IReadOnlyList<ScheduleArchiveSnapshotModel> Snapshots);
    private static bool Visible(ScheduleArchiveSnapshotModel item, bool includeDrafts) => includeDrafts ||
        item.Result.Sources!.Processes.All(model => model.Status.Equals("Published", StringComparison.OrdinalIgnoreCase));

    public async Task<IReadOnlyList<ScheduleArchiveSummaryModel>> ListAsync(string userId, bool includeDrafts, CancellationToken ct = default)
    {
        var archive = await ReadForViewAsync(userId, ct);
        return archive.Snapshots.Where(item => Visible(item, includeDrafts)).OrderByDescending(item => item.SavedAt)
            .Select(item => new ScheduleArchiveSummaryModel(item.Id, item.Name, item.SavedAt, item.Result.RootProcessId,
                item.Result.Processes.Count, item.Result.StartAt, item.Result.EndAt, item.Result.Complete)).ToArray();
    }

    public async Task<ScheduleArchiveSnapshotModel> LoadAsync(string userId, string id, bool includeDrafts, CancellationToken ct = default)
    {
        ValidateId(id);
        return (await ReadForViewAsync(userId, ct)).Snapshots.SingleOrDefault(item => item.Id == id && Visible(item, includeDrafts))
            ?? throw new KeyNotFoundException();
    }

    public async Task<ScheduleArchiveCheckModel> CheckAsync(string userId, string id, bool includeDrafts, CancellationToken ct = default)
    {
        var baseline = await LoadAsync(userId, id, includeDrafts, ct);
        ProcessScheduleModel current;
        try
        {
            // Preserve published-vs-draft source selection, not the current form or today's start date.
            var usedDrafts = !Visible(baseline, false);
            current = await schedule.CalculateAsync(baseline.Request, usedDrafts, ct);
        }
        catch (FileNotFoundException) { return new(baseline, DateTimeOffset.UtcNow, "Unavailable", ["Исходный процесс отсутствует. Пересчёт не выполнен."]); }
        catch (InvalidDataException exception) { return new(baseline, DateTimeOffset.UtcNow, "Unavailable", [exception.Message]); }
        try { await LoadAsync(userId, id, includeDrafts, ct); }
        catch (KeyNotFoundException) { return new(baseline, DateTimeOffset.UtcNow, "Unavailable", ["Архивная запись удалена во время проверки. Обновите список."]); }
        var changes = new List<string>();
        var previous = baseline.Result;
        if (previous.Sources!.Algorithm != current.Sources!.Algorithm) changes.Add("Изменился алгоритм расчёта.");
        if (JsonSerializer.Serialize(previous.Sources.Processes, json) != JsonSerializer.Serialize(current.Sources.Processes, json))
            changes.Add("Изменились исходные модели, их версии или состав. Изменения содержимого обнаруживаются и без смены версии.");
        if (JsonSerializer.Serialize(previous.Sources.Objects, json) != JsonSerializer.Serialize(current.Sources.Objects, json))
            changes.Add("Изменились документы, результаты, источники или получатели.");
        var same = SameResult(previous, current);
        if (!same) changes.Add("Сопоставьте даты, нормы, состав цепочки и достоверность в таблице ниже.");
        if (!current.Complete) changes.Add("Новый расчёт предварительный; изучите замечания перед применением.");
        return new(baseline, DateTimeOffset.UtcNow, same ? "Current" : "Changed", changes, current);
    }

    public async Task<ScheduleArchiveSnapshotModel> SaveAsync(string userId, ScheduleArchiveSaveModel update,
        bool includeDrafts, CancellationToken ct = default)
    {
        var path = PathFor(userId);
        var name = update.Name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 100 || update.Request is null || update.ExpectedResult?.Sources is null)
            throw new InvalidDataException("Укажите название до 100 символов и выполните расчёт с исходными данными.");
        var current = await schedule.CalculateAsync(update.Request, includeDrafts, ct);
        if (!SameResult(current, update.ExpectedResult))
            throw new InvalidDataException("Исходники или результат изменились. Пересчитайте сроки перед сохранением на сервере.");
        var a = current.Assumptions;
        var normalized = new ProcessScheduleRequestModel(current.RootProcessId, current.Direction, current.AnchorDate,
            a.IncludeWaitTime, a.WorkdayStart, a.WorkdayEnd, a.WorkingDays, a.DurationScalePercent, a.TransferDelayHours,
            a.NonWorkingDates, a.ProcessDurationScalePercent, a.Checkpoints, a.UtcOffsetMinutes, a.ProcessCalendars,
            a.ProcessBranches, a.ProcessRepetitions);
        await gate.WaitAsync(ct);
        try
        {
            var archive = await ReadAsync(userId, ct);
            var duplicate = archive.Snapshots.FirstOrDefault(item => item.Name == name && SameResult(item.Result, current) &&
                JsonSerializer.Serialize(item.Request, json) == JsonSerializer.Serialize(normalized, json));
            if (duplicate is not null) return duplicate;
            if (archive.Snapshots.Count >= 20) throw new InvalidDataException("В серверном архиве профиля уже 20 расчётов. Удалите ненужный явно; автоматического удаления нет.");
            var snapshot = new ScheduleArchiveSnapshotModel(Guid.NewGuid().ToString("N"), name, DateTimeOffset.UtcNow, normalized, current);
            await WriteAsync(path, archive with { Snapshots = archive.Snapshots.Append(snapshot).ToArray() }, ct);
            return snapshot;
        }
        finally { gate.Release(); }
    }

    public async Task<bool> DeleteAsync(string userId, string id, bool includeDrafts, CancellationToken ct = default)
    {
        ValidateId(id);
        var path = PathFor(userId);
        await gate.WaitAsync(ct);
        try
        {
            var archive = await ReadAsync(userId, ct);
            var item = archive.Snapshots.SingleOrDefault(item => item.Id == id && Visible(item, includeDrafts));
            if (item is null) return false;
            await WriteAsync(path, archive with { Snapshots = archive.Snapshots.Where(item => item.Id != id).ToArray() }, ct);
            return true;
        }
        finally { gate.Release(); }
    }

    private static bool SameResult(ProcessScheduleModel first, ProcessScheduleModel second)
    {
        if (first.Sources is null || second.Sources is null) return false;
        return JsonSerializer.Serialize(first with { Sources = first.Sources with { CapturedAt = DateTimeOffset.UnixEpoch } }, json)
            == JsonSerializer.Serialize(second with { Sources = second.Sources with { CapturedAt = DateTimeOffset.UnixEpoch } }, json);
    }

    private async Task<Archive> ReadAsync(string userId, CancellationToken ct)
    {
        var path = PathFor(userId);
        if (!File.Exists(path)) return new(userId, []);
        if (new FileInfo(path).Length > MaxBytes) throw new InvalidDataException("Архив профиля превышает 20 МБ.");
        try
        {
            var archive = JsonSerializer.Deserialize<Archive>(await File.ReadAllTextAsync(path, ct), json);
            if (archive?.OwnerId != userId || archive.Snapshots is null || archive.Snapshots.Count > 20 ||
                archive.Snapshots.Any(item => item is null || !Guid.TryParseExact(item.Id, "N", out _) ||
                    string.IsNullOrWhiteSpace(item.Name) || item.Request?.WorkingDays is null || item.Result?.Sources?.Processes is null ||
                    item.Result.Sources.Objects is null || item.Result.Assumptions is null || item.Result.Dependencies is null || item.Result.Issues is null ||
                    item.Result.Processes is null || item.Result.Processes.Any(process => process is null || process.ProcessName is null) ||
                    item.Result.Sources.Processes.Any(model => model is null || model.Status is null)) ||
                archive.Snapshots.Select(item => item.Id).Distinct().Count() != archive.Snapshots.Count)
                throw new InvalidDataException("Архив расчётов повреждён. Автоматическая перезапись запрещена.");
            return archive;
        }
        catch (JsonException) { throw new InvalidDataException("Архив расчётов повреждён. Автоматическая перезапись запрещена."); }
    }

    private async Task<Archive> ReadForViewAsync(string userId, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try { return await ReadAsync(userId, ct); }
        finally { gate.Release(); }
    }

    private async Task WriteAsync(string path, Archive archive, CancellationToken ct)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(archive, json);
        if (bytes.Length > MaxBytes) throw new InvalidDataException("Архив профиля превысит 20 МБ. Запись отменена без удаления снимков.");
        Directory.CreateDirectory(root);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { await File.WriteAllBytesAsync(temporary, bytes, ct); File.Move(temporary, path, true); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private string PathFor(string userId)
    {
        if (string.IsNullOrWhiteSpace(userId) || userId.Length > 100) throw new InvalidDataException("Не определён профиль пользователя.");
        return Path.Combine(root, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(userId))) + ".json");
    }
    private static void ValidateId(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new InvalidDataException("Неверный ID архивного расчёта.");
    }
}
