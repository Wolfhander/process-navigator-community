using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class AuditLogService(IWebHostEnvironment environment)
{
    private readonly string path = Path.Combine(environment.ContentRootPath, "Data", "Audit", "audit-log.jsonl");
    private readonly SemaphoreSlim writeLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task RecordAsync(UserProfileModel user, string method, string requestPath, CancellationToken cancellationToken = default)
    {
        var details = Describe(method, requestPath);
        if (details is null) return;
        var entry = new AuditEntryModel(Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow, user.Id, user.DisplayName,
            details.Value.Action, details.Value.ObjectType, details.Value.ObjectId, details.Value.Description, method, requestPath);
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await File.AppendAllTextAsync(path, JsonSerializer.Serialize(entry, JsonOptions) + Environment.NewLine, cancellationToken);
        }
        finally { writeLock.Release(); }
    }

    public async Task<IReadOnlyList<AuditEntryModel>> ListAsync(int limit = 300, CancellationToken cancellationToken = default)
    {
        if (!File.Exists(path)) return [];
        var lines = await File.ReadAllLinesAsync(path, cancellationToken);
        return lines.Reverse().Where(line => !string.IsNullOrWhiteSpace(line)).Take(Math.Clamp(limit, 1, 1000))
            .Select(line => JsonSerializer.Deserialize<AuditEntryModel>(line, JsonOptions))
            .Where(entry => entry is not null).Cast<AuditEntryModel>().ToArray();
    }

    private static (string Action, string ObjectType, string ObjectId, string Description)? Describe(string method, string path)
    {
        if (method is not ("POST" or "PUT" or "DELETE")) return null;
        if (path.Contains("/notifications", StringComparison.OrdinalIgnoreCase)
            || path.Contains("/test", StringComparison.OrdinalIgnoreCase)
            || path.Contains("/draft/lock", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/table-preview", StringComparison.OrdinalIgnoreCase)) return null;
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        string processId = parts.Length > 2 && parts[1].Equals("processes", StringComparison.OrdinalIgnoreCase) ? Uri.UnescapeDataString(parts[2]) : string.Empty;
        if (path.Contains("/admin/organization")) return ("organization.updated", "organization", "root", "Изменена организационная структура");
        if (path.Contains("/admin/users/")) return ("user.updated", "user", parts.Last(), "Изменён профиль пользователя");
        if (path.Contains("/admin/integrations/")) return ("integration.updated", "integration", parts.Last(), "Изменены настройки интеграции");
        if (path.EndsWith("/publish")) return ("process.published", "process", processId, "Опубликована новая версия процесса");
        if (path.EndsWith("/draft") && method == "POST") return ("draft.created", "process", processId, "Создана новая редакция процесса");
        if (path.Contains("/draft/elements/")) return ("context.updated", "process-element", parts[^2], $"Изменён контекст элемента процесса {processId}");
        if (path.Contains("/draft/properties")) return ("process.owner.updated", "process", processId, "Изменён владелец процесса");
        if (path.Contains("/draft")) return ("diagram.updated", "process", processId, "Изменена BPMN-схема черновика");
        if (path.Contains("/assignments")) return ("assignments.updated", "process", processId, "Изменены ответственные по дорожкам");
        if (method == "DELETE" && processId.Length > 0) return ("process.deleted", "process", processId, "Процесс полностью удалён");
        if (path.EndsWith("/api/processes")) return (method == "POST" ? "process.created" : "process.updated", "process", processId, "Создан или импортирован процесс");
        if (path.Contains("/import")) return ("process.imported", "process", "package", "Импортирован процесс или пакет процессов");
        if (path.Contains("/artifacts")) return ("artifact.uploaded", "artifact", "repository", "Загружен документ в репозиторий");
        return ("data.changed", "system", path, "Изменены данные системы");
    }
}
