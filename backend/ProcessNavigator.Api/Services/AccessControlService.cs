using ProcessNavigator.Api.Models;
using System.Text.Json;

namespace ProcessNavigator.Api.Services;

public sealed class AccessControlService
{
    public const string RoleHeader = "X-Process-Navigator-Role";
    public const string UserHeader = "X-Process-Navigator-User";
    private readonly object sync = new();
    private readonly SemaphoreSlim saveLock = new(1, 1);
    private readonly string storagePath;
    private Dictionary<string, UserProfileModel> users;
    private readonly IReadOnlyDictionary<string, RoleProfileModel> roles;

    public AccessControlService(IWebHostEnvironment environment)
    {
        roles = new[]
        {
            Role("employee", "Исполнитель", ProcessPermissions.View, ProcessPermissions.Execute),
            Role("manager", "Руководитель", ProcessPermissions.View, ProcessPermissions.Execute, ProcessPermissions.ViewAnalytics),
            Role("analyst", "Аналитик", ProcessPermissions.View, ProcessPermissions.Import, ProcessPermissions.CreateDraft, ProcessPermissions.EditDiagram, ProcessPermissions.EditContext, ProcessPermissions.ViewAnalytics),
            Role("owner", "Владелец процесса", ProcessPermissions.View, ProcessPermissions.CreateDraft, ProcessPermissions.EditContext, ProcessPermissions.ManageAssignments, ProcessPermissions.Publish, ProcessPermissions.ViewAnalytics),
            Role("administrator", "Администратор", ProcessPermissions.View, ProcessPermissions.Execute, ProcessPermissions.Import, ProcessPermissions.CreateDraft, ProcessPermissions.EditDiagram, ProcessPermissions.EditContext, ProcessPermissions.ManageAssignments, ProcessPermissions.Publish, ProcessPermissions.ViewAnalytics, ProcessPermissions.ManageUsers),
            Role("superadministrator", "СуперАдминистратор", ProcessPermissions.View, ProcessPermissions.Execute, ProcessPermissions.Import, ProcessPermissions.CreateDraft, ProcessPermissions.EditDiagram, ProcessPermissions.EditContext, ProcessPermissions.ManageAssignments, ProcessPermissions.Publish, ProcessPermissions.ViewAnalytics, ProcessPermissions.ManageUsers, ProcessPermissions.ManageSystem)
        }.ToDictionary(role => role.Id, StringComparer.OrdinalIgnoreCase);
        storagePath = Path.Combine(environment.ContentRootPath, "Data", "Users", "users.json");
        users = LoadUsers();
    }

    public SessionModel Session(HttpContext context)
    {
        var current = CurrentUser(context);
        lock (sync) return new SessionModel(current, users.Values.Where(user => user.IsActive).OrderBy(user => user.DisplayName).ToArray());
    }

    public UserProfileModel CurrentUser(HttpContext context)
    {
        lock (sync)
        {
            var userId = context.Request.Headers[UserHeader].FirstOrDefault();
            if (userId is not null && users.TryGetValue(userId, out var selected) && selected.IsActive) return selected;
            var role = context.Request.Headers[RoleHeader].FirstOrDefault();
            var legacy = role is null ? null : users.Values.FirstOrDefault(user => user.Role.Equals(role, StringComparison.OrdinalIgnoreCase) && user.IsActive);
            return legacy ?? users.Values.FirstOrDefault(user => user.Role == "employee" && user.IsActive)
                ?? users.Values.First(user => user.IsActive);
        }
    }

    public bool Has(HttpContext context, string permission) =>
        CurrentUser(context).Permissions.Contains(permission, StringComparer.Ordinal);

    public UserDirectoryModel Directory()
    {
        lock (sync) return new(users.Values.OrderBy(user => user.DisplayName).ToArray(), roles.Values.ToArray());
    }

    public IReadOnlyList<UserProfileModel> Users()
    {
        lock (sync) return users.Values.ToArray();
    }

    public async Task<UserProfileModel> UpdateAsync(string id, UserUpdateModel update, string currentUserId, CancellationToken cancellationToken)
    {
        UserProfileModel updated;
        lock (sync)
        {
            if (!users.TryGetValue(id, out var existing)) throw new KeyNotFoundException();
            if (!roles.TryGetValue(update.Role, out var role)) throw new InvalidDataException("Неизвестная роль пользователя.");
            if (string.IsNullOrWhiteSpace(update.DisplayName) || update.DisplayName.Trim().Length > 160) throw new InvalidDataException("Укажите имя пользователя длиной до 160 символов.");
            if (id == currentUserId && !update.IsActive) throw new InvalidDataException("Нельзя отключить текущего пользователя.");
            if (existing.Role == "superadministrator" && (update.Role != "superadministrator" || !update.IsActive) && users.Values.Count(user => user.Role == "superadministrator" && user.IsActive) == 1)
                throw new InvalidDataException("В системе должен остаться хотя бы один активный СуперАдминистратор.");
            updated = new UserProfileModel(id, update.DisplayName.Trim(), role.Id, role.Name, role.Permissions, update.IsActive,
                Clean(update.LegalEntityId), Clean(update.UnitId), Clean(update.Position));
            users[id] = updated;
        }
        await SaveAsync(cancellationToken);
        return updated;
    }

    private Dictionary<string, UserProfileModel> LoadUsers()
    {
        if (File.Exists(storagePath))
        {
            var stored = JsonSerializer.Deserialize<List<StoredUser>>(File.ReadAllText(storagePath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (stored is not null)
                return stored.Where(user => roles.ContainsKey(user.Role)).Select(user => User(user.Id, user.DisplayName, user.Role, user.IsActive, user.LegalEntityId, user.UnitId, user.Position)).ToDictionary(user => user.Id, StringComparer.OrdinalIgnoreCase);
        }
        return new[]
        {
            User("demo-employee", "Демо-исполнитель", "employee", true, "plant", "1.2", "Специалист по закупкам"),
            User("demo-manager", "Демо-руководитель", "manager", true, "plant", "1", "Руководитель комплекса"),
            User("demo-analyst", "Демо-аналитик", "analyst", true, "communications", "2.9.1", "Бизнес-аналитик"),
            User("demo-owner", "Демо-владелец", "owner", true, "plant", "1.6", "Владелец процесса"),
            User("demo-administrator", "Демо-администратор", "administrator", true, "plant", "1.5", "Администратор системы"),
            User("demo-superadministrator", "Демо-системный администратор", "superadministrator", true, "corporation", "0.1", "Системный архитектор")
        }.ToDictionary(user => user.Id, StringComparer.OrdinalIgnoreCase);
    }

    private UserProfileModel User(string id, string displayName, string roleId, bool active = true,
        string? legalEntityId = null, string? unitId = null, string? position = null)
    {
        var role = roles[roleId]; return new(id, displayName, role.Id, role.Name, role.Permissions, active, legalEntityId, unitId, position);
    }
    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static RoleProfileModel Role(string id, string name, params string[] permissions) => new(id, name, permissions);
    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        await saveLock.WaitAsync(cancellationToken);
        try
        {
            StoredUser[] snapshot;
            lock (sync) snapshot = users.Values.Select(user => new StoredUser(user.Id, user.DisplayName, user.Role, user.IsActive, user.LegalEntityId, user.UnitId, user.Position)).ToArray();
            System.IO.Directory.CreateDirectory(Path.GetDirectoryName(storagePath)!);
            var temporary = storagePath + ".tmp";
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(snapshot, new JsonSerializerOptions { WriteIndented = true }), cancellationToken);
            File.Move(temporary, storagePath, true);
        }
        finally { saveLock.Release(); }
    }
    private sealed record StoredUser(string Id, string DisplayName, string Role, bool IsActive,
        string? LegalEntityId = null, string? UnitId = null, string? Position = null);
}
