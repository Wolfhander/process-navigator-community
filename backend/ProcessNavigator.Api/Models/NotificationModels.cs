namespace ProcessNavigator.Api.Models;

public sealed record UserNotificationModel(
    string Id,
    string UserId,
    string Kind,
    string Title,
    string Message,
    string ProcessId,
    string ProcessName,
    string? ElementId,
    string? ElementName,
    string? SourceUserId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ReadAt);

