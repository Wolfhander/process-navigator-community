using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class NotificationService(IWebHostEnvironment environment)
{
    private readonly string storagePath = Path.Combine(environment.ContentRootPath, "Data", "Notifications", "notifications.json");
    private readonly SemaphoreSlim writeLock = new(1, 1);

    public async Task<IReadOnlyList<UserNotificationModel>> ListAsync(string userId, CancellationToken cancellationToken) =>
        (await ReadAsync(cancellationToken)).Where(item => item.UserId == userId)
            .OrderByDescending(item => item.CreatedAt).Take(100).ToArray();

    public async Task CreateMentionsAsync(ProcessModel process, NodeModel element, UserProfileModel author,
        string text, IReadOnlyList<UserProfileModel> users, CancellationToken cancellationToken)
    {
        var mentioned = users.Where(user => user.IsActive && user.Id != author.Id &&
            text.Contains("@" + user.DisplayName, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (mentioned.Length == 0) return;
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var items = (await ReadAsync(cancellationToken)).ToList();
            items.AddRange(mentioned.Select(user => new UserNotificationModel(Guid.NewGuid().ToString("N"), user.Id,
                "Mention", $"{author.DisplayName} упомянул вас", text.Length > 240 ? text[..240] + "…" : text,
                process.Id, process.Name, element.Id, element.Name, author.Id, DateTimeOffset.UtcNow, null)));
            await WriteAsync(items, cancellationToken);
        }
        finally { writeLock.Release(); }
    }

    public async Task<UserNotificationModel> MarkReadAsync(string id, string userId, CancellationToken cancellationToken)
    {
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var items = (await ReadAsync(cancellationToken)).ToList();
            var index = items.FindIndex(item => item.Id == id && item.UserId == userId);
            if (index < 0) throw new KeyNotFoundException();
            items[index] = items[index] with { ReadAt = items[index].ReadAt ?? DateTimeOffset.UtcNow };
            await WriteAsync(items, cancellationToken); return items[index];
        }
        finally { writeLock.Release(); }
    }

    public async Task MarkAllReadAsync(string userId, CancellationToken cancellationToken)
    {
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            var now = DateTimeOffset.UtcNow;
            var items = (await ReadAsync(cancellationToken)).Select(item => item.UserId == userId && item.ReadAt is null ? item with { ReadAt = now } : item).ToList();
            await WriteAsync(items, cancellationToken);
        }
        finally { writeLock.Release(); }
    }

    private async Task<List<UserNotificationModel>> ReadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(storagePath)) return [];
        return JsonSerializer.Deserialize<List<UserNotificationModel>>(await File.ReadAllTextAsync(storagePath, cancellationToken),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
    }

    private async Task WriteAsync(IReadOnlyList<UserNotificationModel> items, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(storagePath)!); var temporary = storagePath + ".tmp";
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(items, new JsonSerializerOptions { WriteIndented = true }), cancellationToken);
        File.Move(temporary, storagePath, true);
    }
}
