namespace ProcessNavigator.Api.Models;

public sealed record ProcessTableIssueModel(
    string Severity,
    string Sheet,
    int Row,
    string? Column,
    string Message,
    string? ProcessId = null,
    string? StepId = null);

public sealed record ProcessTableFieldChangeModel(
    string Scope,
    string Kind,
    string? ElementId,
    string? ElementName,
    string Field,
    string? OldValue,
    string? NewValue);

public sealed record ProcessTableRenameSuggestionModel(
    string ExistingStepId,
    string ExistingStepName,
    string IncomingStepId,
    string IncomingStepName);

public sealed record ProcessTableStepIdMappingModel(
    string ProcessId,
    string IncomingStepId,
    string ExistingStepId);

public sealed record ProcessTablePreviewItemModel(
    string Id,
    string Name,
    string Status,
    int? Level,
    int StepCount,
    int ChannelCount,
    int ErrorCount,
    int WarningCount,
    bool ProcessChanged = false,
    int AddedStepCount = 0,
    int ModifiedStepCount = 0,
    int RemovedStepCount = 0,
    int UnchangedStepCount = 0,
    IReadOnlyList<string>? Changes = null,
    IReadOnlyList<ProcessTableFieldChangeModel>? FieldChanges = null,
    IReadOnlyList<ProcessTableRenameSuggestionModel>? RenameSuggestions = null);

public sealed record ProcessTablePreviewModel(
    string FileName,
    int ProcessCount,
    int NewProcessCount,
    int ExistingProcessCount,
    int StepCount,
    int ChannelCount,
    int ErrorCount,
    int WarningCount,
    bool CanImport,
    IReadOnlyList<ProcessTablePreviewItemModel> Processes,
    IReadOnlyList<ProcessTableIssueModel> Issues);

public sealed record ProcessTableImportItemModel(
    string Id,
    string Name,
    string Status,
    int NodeCount,
    int LaneCount);

public sealed record ProcessTableImportResultModel(
    string BackupFileName,
    int Created,
    int Updated,
    IReadOnlyList<ProcessTableImportItemModel> Processes,
    int AppliedStepIdMappings = 0,
    string? ReportFileName = null);

public sealed record ProcessTableImportHistoryItemModel(
    string Id,
    DateTimeOffset OccurredAt,
    string AppliedBy,
    string SourceFileName,
    string BackupFileName,
    int WorkbookProcessCount,
    int ImportedProcessCount,
    int Created,
    int Updated,
    int Skipped,
    int AppliedStepIdMappings,
    string ReportFileName,
    bool HasReport,
    IReadOnlyList<ProcessTableImportItemModel> Processes);

public sealed record ProcessTableImportReportRowModel(
    string ProcessId,
    string ProcessName,
    string Outcome,
    string Kind,
    string ElementId,
    string ElementName,
    string Field,
    string OldValue,
    string NewValue,
    string Comment);

public sealed record ProcessTableImportReportModel(
    string HistoryId,
    string ReportFileName,
    int ProcessCount,
    int RowCount,
    int Added,
    int Modified,
    int Removed,
    int Mapped,
    IReadOnlyList<ProcessTableImportReportRowModel> Rows);

public sealed record ProcessTableImportRetentionPolicyModel(int RetentionDays, int MaximumEntries);

public sealed record ProcessTableImportCleanupResultModel(int RemovedEntries, long ReclaimedBytes, int RemainingEntries);

public sealed record ProcessTableSelectionSetModel(
    string Id,
    string Name,
    IReadOnlyList<string> ProcessIds,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record ProcessTableSelectionSetUpdateModel(
    string Name,
    IReadOnlyList<string> ProcessIds);

public sealed record ProcessTableExportModel(
    byte[] Content,
    string FileName,
    int ProcessCount);
