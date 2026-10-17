using System.Text.Json;
using System.Text;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class ProcessTableImportHistoryService(IWebHostEnvironment environment)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly JsonSerializerOptions jsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private string DirectoryPath => Path.Combine(environment.ContentRootPath, "Data", "ImportReports");
    private string HistoryPath => Path.Combine(DirectoryPath, "history.json");
    private string PolicyPath => Path.Combine(DirectoryPath, "retention-policy.json");

    public async Task AppendAsync(ProcessTableImportHistoryItemModel item, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(DirectoryPath);
            var items = (await ReadUnsafeAsync(cancellationToken)).ToList();
            items.RemoveAll(existing => existing.Id.Equals(item.Id, StringComparison.OrdinalIgnoreCase));
            items.Add(item with { HasReport = File.Exists(SafeReportPath(item.ReportFileName)) });
            items = items.OrderByDescending(existing => existing.OccurredAt).ToList();
            ApplyRetentionUnsafe(items, await ReadPolicyUnsafeAsync(cancellationToken), cancellationToken);
            await WriteHistoryUnsafeAsync(items, cancellationToken);
        }
        finally { gate.Release(); }
    }

    public async Task<IReadOnlyList<ProcessTableImportHistoryItemModel>> ListAsync(int limit = 200, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var safeLimit = Math.Clamp(limit, 1, 1000);
            return (await ReadUnsafeAsync(cancellationToken))
                .OrderByDescending(item => item.OccurredAt)
                .Take(safeLimit)
                .Select(item => item with { HasReport = File.Exists(SafeReportPath(item.ReportFileName)) })
                .ToArray();
        }
        finally { gate.Release(); }
    }

    public string ResolveReportPath(string fileName)
    {
        var path = SafeReportPath(fileName);
        if (!File.Exists(path)) throw new FileNotFoundException("Протокол импорта не найден.", path);
        return path;
    }

    public async Task<ProcessTableImportReportModel> LoadReportAsync(string historyId, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var history = (await ReadUnsafeAsync(cancellationToken)).FirstOrDefault(item => item.Id.Equals(historyId, StringComparison.OrdinalIgnoreCase))
                ?? throw new FileNotFoundException("Запись импорта не найдена.");
            var path = ResolveReportPath(history.ReportFileName);
            if (new FileInfo(path).Length > 50L * 1024 * 1024) throw new InvalidDataException("Протокол слишком велик для просмотра в браузере.");
            var parsed = ParseCsv(await File.ReadAllTextAsync(path, cancellationToken));
            if (parsed.Count == 0 || parsed[0].Count < 10) throw new InvalidDataException("Протокол импорта имеет неизвестный формат.");
            var rows = parsed.Skip(1).Where(row => row.Any(value => value.Length > 0)).Select(row =>
            {
                while (row.Count < 10) row.Add(string.Empty);
                return new ProcessTableImportReportRowModel(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9]);
            }).Take(200_000).ToArray();
            return new(history.Id, history.ReportFileName,
                rows.Select(row => row.ProcessId).Where(id => id.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Count(), rows.Length,
                rows.Count(row => row.Kind.Equals("Added", StringComparison.OrdinalIgnoreCase)),
                rows.Count(row => row.Kind.Equals("Modified", StringComparison.OrdinalIgnoreCase)),
                rows.Count(row => row.Kind.Equals("Removed", StringComparison.OrdinalIgnoreCase)),
                rows.Count(row => row.Kind.Equals("Сопоставление ID", StringComparison.OrdinalIgnoreCase)), rows);
        }
        finally { gate.Release(); }
    }

    public async Task<bool> DeleteAsync(string historyId, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var items = (await ReadUnsafeAsync(cancellationToken)).ToList();
            var item = items.FirstOrDefault(existing => existing.Id.Equals(historyId, StringComparison.OrdinalIgnoreCase));
            if (item is null) return false;
            items.Remove(item);
            DeleteReportUnsafe(item.ReportFileName);
            await WriteHistoryUnsafeAsync(items, cancellationToken);
            return true;
        }
        finally { gate.Release(); }
    }

    public async Task<ProcessTableImportRetentionPolicyModel> GetRetentionPolicyAsync(CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try { return await ReadPolicyUnsafeAsync(cancellationToken); }
        finally { gate.Release(); }
    }

    public async Task<ProcessTableImportRetentionPolicyModel> SaveRetentionPolicyAsync(ProcessTableImportRetentionPolicyModel policy,
        CancellationToken cancellationToken = default)
    {
        ValidatePolicy(policy);
        await gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(DirectoryPath);
            await WriteAtomicAsync(PolicyPath, JsonSerializer.Serialize(policy, jsonOptions), cancellationToken);
            return policy;
        }
        finally { gate.Release(); }
    }

    public async Task<ProcessTableImportCleanupResultModel> CleanupAsync(CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var items = (await ReadUnsafeAsync(cancellationToken)).OrderByDescending(item => item.OccurredAt).ToList();
            var beforeIds = items.Select(item => item.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var bytes = ApplyRetentionUnsafe(items, await ReadPolicyUnsafeAsync(cancellationToken), cancellationToken);
            var removed = beforeIds.Count - items.Count;
            if (removed > 0) await WriteHistoryUnsafeAsync(items, cancellationToken);
            return new(removed, bytes, items.Count);
        }
        finally { gate.Release(); }
    }

    private async Task<IReadOnlyList<ProcessTableImportHistoryItemModel>> ReadUnsafeAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(HistoryPath)) return [];
        try
        {
            await using var stream = File.OpenRead(HistoryPath);
            return await JsonSerializer.DeserializeAsync<List<ProcessTableImportHistoryItemModel>>(stream, jsonOptions, cancellationToken) ?? [];
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("Журнал табличных импортов повреждён. Восстановите каталог данных из резервной копии.", exception);
        }
    }

    private async Task WriteHistoryUnsafeAsync(IReadOnlyList<ProcessTableImportHistoryItemModel> items, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(DirectoryPath);
        await WriteAtomicAsync(HistoryPath, JsonSerializer.Serialize(items.OrderByDescending(item => item.OccurredAt), jsonOptions), cancellationToken);
    }

    private async Task<ProcessTableImportRetentionPolicyModel> ReadPolicyUnsafeAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(PolicyPath)) return new(0, 0);
        try
        {
            await using var stream = File.OpenRead(PolicyPath);
            var policy = await JsonSerializer.DeserializeAsync<ProcessTableImportRetentionPolicyModel>(stream, jsonOptions, cancellationToken) ?? new(0, 0);
            ValidatePolicy(policy);
            return policy;
        }
        catch (JsonException exception) { throw new InvalidDataException("Политика хранения протоколов повреждена.", exception); }
    }

    private long ApplyRetentionUnsafe(List<ProcessTableImportHistoryItemModel> items,
        ProcessTableImportRetentionPolicyModel policy, CancellationToken cancellationToken)
    {
        ValidatePolicy(policy);
        if (policy.RetentionDays == 0 && policy.MaximumEntries == 0) return 0;
        var cutoff = policy.RetentionDays > 0 ? DateTimeOffset.UtcNow.AddDays(-policy.RetentionDays) : DateTimeOffset.MinValue;
        var ordered = items.OrderByDescending(item => item.OccurredAt).ToArray();
        var removeIds = ordered.Where((item, index) =>
                (policy.RetentionDays > 0 && item.OccurredAt < cutoff) || (policy.MaximumEntries > 0 && index >= policy.MaximumEntries))
            .Select(item => item.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        long bytes = 0;
        foreach (var item in items.Where(item => removeIds.Contains(item.Id)).ToArray())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var path = SafeReportPath(item.ReportFileName);
            if (File.Exists(path)) { bytes += new FileInfo(path).Length; File.Delete(path); }
        }
        items.RemoveAll(item => removeIds.Contains(item.Id));
        return bytes;
    }

    private void DeleteReportUnsafe(string fileName)
    {
        var path = SafeReportPath(fileName);
        if (File.Exists(path)) File.Delete(path);
    }

    private string SafeReportPath(string fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName) || Path.GetFileName(fileName) != fileName ||
            !fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Некорректное имя протокола импорта.");
        return Path.Combine(DirectoryPath, fileName);
    }

    private static void ValidatePolicy(ProcessTableImportRetentionPolicyModel policy)
    {
        if (policy.RetentionDays is < 0 or > 3650) throw new InvalidDataException("Срок хранения должен быть от 0 до 3650 дней.");
        if (policy.MaximumEntries is < 0 or > 10000) throw new InvalidDataException("Количество записей должно быть от 0 до 10000.");
    }

    private static async Task WriteAtomicAsync(string path, string content, CancellationToken cancellationToken)
    {
        var temporaryPath = path + ".tmp";
        await File.WriteAllTextAsync(temporaryPath, content, cancellationToken);
        File.Move(temporaryPath, path, true);
    }

    private static List<List<string>> ParseCsv(string content)
    {
        var rows = new List<List<string>>(); var row = new List<string>(); var cell = new StringBuilder(); var quoted = false;
        for (var index = 0; index < content.Length; index++)
        {
            var value = content[index];
            if (quoted)
            {
                if (value == '"' && index + 1 < content.Length && content[index + 1] == '"') { cell.Append('"'); index++; }
                else if (value == '"') quoted = false;
                else cell.Append(value);
                continue;
            }
            if (value == '"') { quoted = true; continue; }
            if (value == ';') { row.Add(cell.ToString()); cell.Clear(); continue; }
            if (value == '\r') continue;
            if (value == '\n') { row.Add(cell.ToString()); cell.Clear(); rows.Add(row); row = []; continue; }
            cell.Append(value);
        }
        if (cell.Length > 0 || row.Count > 0) { row.Add(cell.ToString()); rows.Add(row); }
        return rows;
    }
}
