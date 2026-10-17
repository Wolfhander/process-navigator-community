namespace ProcessNavigator.Api.Models;

public sealed record ExecuteCommandRequestModel(string? InstanceId, string? Result = null);

public sealed record CommandExecutionModel(
    string Id,
    string ProcessId,
    string ElementId,
    string ActionId,
    string ActionLabel,
    string Kind,
    string? Target,
    string? InstanceId,
    string UserId,
    string Status,
    string Message,
    string? ExternalReference,
    string? Result,
    DateTimeOffset ExecutedAt);
