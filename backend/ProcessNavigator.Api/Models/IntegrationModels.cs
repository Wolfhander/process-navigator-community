namespace ProcessNavigator.Api.Models;

public sealed record OneCIntegrationSettingsModel(
    bool Enabled,
    string BaseUrl,
    string HealthPath,
    string CommandPath,
    string Username,
    bool PasswordConfigured,
    int TimeoutSeconds);

public sealed record OneCIntegrationUpdateModel(
    bool Enabled,
    string BaseUrl,
    string HealthPath,
    string CommandPath,
    string Username,
    string? Password,
    int TimeoutSeconds);

public sealed record OneCConnectionStatusModel(
    bool Connected,
    string Mode,
    string Message,
    DateTimeOffset CheckedAt);

public sealed record OneCCommandRequestModel(
    string ProcessId,
    string ProcessVersion,
    string ElementId,
    string ElementName,
    string ActionId,
    string ActionName,
    string? Target,
    string? InstanceId,
    string UserId);

public sealed record OneCCommandResponseModel(
    bool Succeeded,
    string Message,
    string? ExternalReference);

