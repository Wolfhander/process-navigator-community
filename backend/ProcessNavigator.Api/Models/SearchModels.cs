namespace ProcessNavigator.Api.Models;

public sealed record SearchResultModel(
    string Kind,
    string Label,
    string? Description,
    string ProcessId,
    string ProcessName,
    string? ElementId,
    string? ElementName,
    int Score);
