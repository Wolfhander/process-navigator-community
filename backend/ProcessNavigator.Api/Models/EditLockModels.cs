namespace ProcessNavigator.Api.Models;

public sealed record EditLockModel(string ProcessId, string Token, string UserId, string UserName, DateTimeOffset ExpiresAt);
public sealed record EditLockRequestModel(string? Token);
