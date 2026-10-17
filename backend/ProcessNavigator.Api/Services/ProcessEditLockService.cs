using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed class ProcessEditLockService
{
    private readonly object sync = new();
    private readonly Dictionary<string, EditLockModel> locks = new(StringComparer.OrdinalIgnoreCase);
    private static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(90);

    public EditLockModel Acquire(string processId, UserProfileModel user)
    {
        lock (sync)
        {
            RemoveExpired();
            if (locks.TryGetValue(processId, out var current) && !current.UserId.Equals(user.Id, StringComparison.OrdinalIgnoreCase))
                throw new ProcessEditLockedException(current);
            var renewed = current is not null
                ? current with { ExpiresAt = DateTimeOffset.UtcNow.Add(Lifetime) }
                : new(processId, Guid.NewGuid().ToString("N"), user.Id, user.DisplayName, DateTimeOffset.UtcNow.Add(Lifetime));
            locks[processId] = renewed;
            return renewed;
        }
    }

    public EditLockModel Renew(string processId, string token, UserProfileModel user)
    {
        lock (sync)
        {
            RemoveExpired();
            if (!locks.TryGetValue(processId, out var current) || current.Token != token || current.UserId != user.Id)
                throw new ProcessEditLockLostException();
            current = current with { ExpiresAt = DateTimeOffset.UtcNow.Add(Lifetime) }; locks[processId] = current; return current;
        }
    }

    public void Release(string processId, string? token, UserProfileModel user)
    {
        lock (sync) if (locks.TryGetValue(processId, out var current) && current.UserId == user.Id && (token is null || current.Token == token)) locks.Remove(processId);
    }

    public bool IsValid(string processId, string? token, UserProfileModel user)
    {
        lock (sync) { RemoveExpired(); return token is not null && locks.TryGetValue(processId, out var current) && current.Token == token && current.UserId == user.Id; }
    }

    public bool HasActiveLock(string processId)
    {
        lock (sync) { RemoveExpired(); return locks.ContainsKey(processId); }
    }

    private void RemoveExpired() { foreach (var key in locks.Where(item => item.Value.ExpiresAt <= DateTimeOffset.UtcNow).Select(item => item.Key).ToArray()) locks.Remove(key); }
}

public sealed class ProcessEditLockedException : Exception
{
    public ProcessEditLockedException(EditLockModel current) : base($"Черновик уже редактирует {current.UserName}.") => Current = current;
    public EditLockModel Current { get; }
}
public sealed class ProcessEditLockLostException : Exception
{
    public ProcessEditLockLostException() : base("Блокировка редактирования истекла. Откройте редактор повторно.") { }
}
