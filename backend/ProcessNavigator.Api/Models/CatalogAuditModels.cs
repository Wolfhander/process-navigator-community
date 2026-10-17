namespace ProcessNavigator.Api.Models;

public sealed record CatalogAuditItemModel(
    string ProcessId,
    string ProcessName,
    string Edition,
    string FileName,
    string? Version,
    bool Openable,
    bool HasDraft,
    string QualityStatus,
    int ErrorCount,
    int WarningCount,
    IReadOnlyList<ProcessValidationIssueModel> Issues);

public sealed record CatalogAuditReportModel(
    int ProcessCount,
    int EditionCount,
    int UnreadableCount,
    int ErrorCount,
    int WarningCount,
    int ReadyEditionCount,
    int BlockedEditionCount,
    int IncompleteEditionCount,
    IReadOnlyList<CatalogAuditCategoryModel> Categories,
    IReadOnlyList<CatalogAuditItemModel> Items);

public sealed record CatalogAuditCategoryModel(string Id, string Name, int ErrorCount, int WarningCount, int EditionCount);
