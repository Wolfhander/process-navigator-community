using System.Text.Json;
using System.Text.RegularExpressions;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class ProcessTableSelectionSetService(IWebHostEnvironment environment)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly JsonSerializerOptions jsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private string DirectoryPath => Path.Combine(environment.ContentRootPath, "Data", "ImportSelectionSets");
    private string StoragePath => Path.Combine(DirectoryPath, "selection-sets.json");

    public async Task<IReadOnlyList<ProcessTableSelectionSetModel>> ListAsync(string userId, CancellationToken cancellationToken = default)
    {
        var safeUserId = Required(userId, "Не определён текущий пользователь.", 100);
        await gate.WaitAsync(cancellationToken);
        try
        {
            return (await ReadUnsafeAsync(cancellationToken))
                .Where(item => item.UserId.Equals(safeUserId, StringComparison.OrdinalIgnoreCase))
                .OrderBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
                .Select(ToModel).ToArray();
        }
        finally { gate.Release(); }
    }

    public async Task<ProcessTableSelectionSetModel> SaveAsync(string userId, ProcessTableSelectionSetUpdateModel update,
        CancellationToken cancellationToken = default)
    {
        var safeUserId = Required(userId, "Не определён текущий пользователь.", 100);
        var name = Required(update.Name, "Укажите название набора.", 120);
        var processIds = (update.ProcessIds ?? []).Select(id => Required(id, "ID процесса не может быть пустым.", 160))
            .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(id => id, StringComparer.OrdinalIgnoreCase).ToArray();
        if (processIds.Length == 0) throw new InvalidDataException("Выберите хотя бы один процесс.");
        if (processIds.Length > 2000) throw new InvalidDataException("В одном наборе может быть не более 2000 процессов.");
        if (processIds.Any(id => !TechnicalId().IsMatch(id))) throw new InvalidDataException("Набор содержит некорректный ID процесса.");

        await gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(DirectoryPath);
            var items = (await ReadUnsafeAsync(cancellationToken)).ToList();
            var existingIndex = items.FindIndex(item => item.UserId.Equals(safeUserId, StringComparison.OrdinalIgnoreCase) &&
                item.Name.Equals(name, StringComparison.CurrentCultureIgnoreCase));
            var now = DateTimeOffset.UtcNow;
            StoredSelectionSet stored;
            if (existingIndex >= 0)
            {
                var existing = items[existingIndex];
                stored = existing with { Name = name, ProcessIds = processIds, UpdatedAt = now };
                items[existingIndex] = stored;
            }
            else
            {
                var userCount = items.Count(item => item.UserId.Equals(safeUserId, StringComparison.OrdinalIgnoreCase));
                if (userCount >= 100) throw new InvalidDataException("Для одного пользователя можно сохранить не более 100 наборов.");
                stored = new(Guid.NewGuid().ToString("N"), safeUserId, name, processIds, now, now);
                items.Add(stored);
            }
            await WriteUnsafeAsync(items, cancellationToken);
            return ToModel(stored);
        }
        finally { gate.Release(); }
    }

    public async Task<bool> DeleteAsync(string userId, string id, CancellationToken cancellationToken = default)
    {
        var safeUserId = Required(userId, "Не определён текущий пользователь.", 100);
        var safeId = Required(id, "Не указан набор.", 100);
        await gate.WaitAsync(cancellationToken);
        try
        {
            var items = (await ReadUnsafeAsync(cancellationToken)).ToList();
            var removed = items.RemoveAll(item => item.Id.Equals(safeId, StringComparison.OrdinalIgnoreCase) &&
                item.UserId.Equals(safeUserId, StringComparison.OrdinalIgnoreCase)) > 0;
            if (removed) await WriteUnsafeAsync(items, cancellationToken);
            return removed;
        }
        finally { gate.Release(); }
    }

    private async Task<IReadOnlyList<StoredSelectionSet>> ReadUnsafeAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(StoragePath)) return [];
        try
        {
            await using var stream = File.OpenRead(StoragePath);
            return await JsonSerializer.DeserializeAsync<List<StoredSelectionSet>>(stream, jsonOptions, cancellationToken) ?? [];
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("Сохранённые наборы выбора повреждены. Восстановите каталог данных из резервной копии.", exception);
        }
    }

    private async Task WriteUnsafeAsync(IReadOnlyList<StoredSelectionSet> items, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(DirectoryPath);
        var temporaryPath = StoragePath + ".tmp";
        await File.WriteAllTextAsync(temporaryPath, JsonSerializer.Serialize(items, jsonOptions), cancellationToken);
        File.Move(temporaryPath, StoragePath, true);
    }

    private static ProcessTableSelectionSetModel ToModel(StoredSelectionSet item) =>
        new(item.Id, item.Name, item.ProcessIds, item.CreatedAt, item.UpdatedAt);

    private static string Required(string? value, string message, int maximumLength)
    {
        var normalized = value?.Trim() ?? string.Empty;
        if (normalized.Length == 0) throw new InvalidDataException(message);
        if (normalized.Length > maximumLength) throw new InvalidDataException($"Значение не должно быть длиннее {maximumLength} символов.");
        return normalized;
    }

    private sealed record StoredSelectionSet(string Id, string UserId, string Name, IReadOnlyList<string> ProcessIds,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

    [GeneratedRegex("^[A-Za-z0-9._-]+$")]
    private static partial Regex TechnicalId();
}
