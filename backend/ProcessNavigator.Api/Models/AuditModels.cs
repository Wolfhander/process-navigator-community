namespace ProcessNavigator.Api.Models;

public sealed record AuditEntryModel(
    string Id,
    DateTimeOffset OccurredAt,
    string UserId,
    string UserName,
    string Action,
    string ObjectType,
    string ObjectId,
    string Description,
    string Method,
    string Path);
