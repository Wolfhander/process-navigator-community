namespace ProcessNavigator.Api.Models;

public sealed record ProcessValidationIssueModel(
    string Code,
    string Severity,
    string Message,
    string? ElementId = null,
    string? ElementName = null,
    string Category = "Other");

public sealed record ProcessValidationReportModel(
    string ProcessId,
    bool CanPublish,
    int ErrorCount,
    int WarningCount,
    IReadOnlyList<ProcessValidationIssueModel> Issues);
