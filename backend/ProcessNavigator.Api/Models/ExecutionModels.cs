namespace ProcessNavigator.Api.Models;

public sealed record StepExecutionIterationModel(int Iteration, string Status, DateTimeOffset? StartedAt, DateTimeOffset? CompletedAt,
    string? UserId, DateTimeOffset? SkippedAt, string? SkipReason, DateTimeOffset ArchivedAt, string ArchivedBy, string ReturnReason,
    string? ResultText = null, IReadOnlyList<StepExecutionResultObjectModel>? ResultObjects = null,
    IReadOnlyList<StepExecutionAttachmentModel>? Attachments = null, DateTimeOffset? ResultRecordedAt = null,
    string? ResultRecordedBy = null, DateTimeOffset? AvailableAt = null, string? NormText = null,
    double? PlannedWorkMinutes = null, double? PlannedWaitMinutes = null, double? PlannedDurationMinutes = null,
    DateTimeOffset? PlannedCompletedAt = null, double? ActualQueueMinutes = null, double? ActualWorkMinutes = null,
    double? ActualDurationMinutes = null, double? OverdueMinutes = null, string? AssignedUserId = null);
public sealed record StepExecutionResultObjectModel(string ObjectId, string Name, DateTimeOffset RecordedAt, string UserId);
public sealed record StepExecutionAttachmentModel(string ArtifactId, string Name, string Kind, string Version, string Reference,
    string FileName, long Size, DateTimeOffset AttachedAt, string UserId);
public sealed record StepExecutionModel(string ElementId, string Status, DateTimeOffset? StartedAt, DateTimeOffset? CompletedAt, string? UserId,
    DateTimeOffset? SkippedAt = null, string? SkipReason = null, int Iteration = 1,
    IReadOnlyList<StepExecutionIterationModel>? History = null, string? ResultText = null, DateTimeOffset? ResultRecordedAt = null,
    string? ResultRecordedBy = null, IReadOnlyList<StepExecutionResultObjectModel>? ResultObjects = null,
    IReadOnlyList<StepExecutionAttachmentModel>? Attachments = null, DateTimeOffset? AvailableAt = null, string? NormText = null,
    double? PlannedWorkMinutes = null, double? PlannedWaitMinutes = null, double? PlannedDurationMinutes = null,
    DateTimeOffset? PlannedCompletedAt = null, double? ActualQueueMinutes = null, double? ActualWorkMinutes = null,
    double? ActualDurationMinutes = null, double? OverdueMinutes = null, string? AssignedUserId = null);
public sealed record BranchDecisionModel(string GatewayId, string GatewayName, string SelectedTargetId, string SelectedTargetName,
    string? SelectedLabel, DateTimeOffset SelectedAt, string UserId);
public sealed record ProcessReturnEventModel(string FromElementId, string FromElementName, string TargetElementId, string TargetElementName,
    string Reason, int Iteration, DateTimeOffset ReturnedAt, string UserId, IReadOnlyList<string> ResetElementIds);
public sealed record ProcessLifecycleEventModel(string Action, string FromStatus, string ToStatus, string? Reason,
    DateTimeOffset OccurredAt, string UserId);
public sealed record StepAssignmentEventModel(string ElementId, string ElementName, string? FromUserId, string? FromUserName,
    string ToUserId, string ToUserName, string Reason, DateTimeOffset AssignedAt, string AssignedBy);
public sealed record ProcessInstanceModel(string Id, string ProcessId, string ProcessVersion, string Name, string Status,
    DateTimeOffset StartedAt, DateTimeOffset? CompletedAt, string StartedBy, IReadOnlyList<StepExecutionModel> Steps,
    IReadOnlyList<BranchDecisionModel>? BranchDecisions = null, IReadOnlyList<ProcessReturnEventModel>? ReturnEvents = null,
    IReadOnlyList<ProcessLifecycleEventModel>? LifecycleEvents = null, IReadOnlyList<StepAssignmentEventModel>? AssignmentEvents = null);
public sealed record StartProcessInstanceModel(string? Name);
public sealed record StepStatusUpdateModel(string Status);
public sealed record ReturnStepModel(string TargetElementId, string Reason);
public sealed record ProcessLifecycleUpdateModel(string Action, string? Reason);
public sealed record StepResultUpdateModel(string? ResultText, IReadOnlyList<string>? ObjectIds);
public sealed record StepAssignmentUpdateModel(string UserId, string Reason);
public sealed record ExecutionTimelineEventModel(string Id, string Type, string Title, string? Detail, DateTimeOffset OccurredAt,
    string? ElementId = null, string? ElementName = null, int? Iteration = null, string? UserId = null, string Severity = "Info");
public sealed record ExecutionTimelineModel(string ProcessId, string InstanceId, IReadOnlyList<ExecutionTimelineEventModel> Events);
public sealed record StepAnalyticsModel(string ElementId, string Name, string LaneName, string? Norm,
    int CompletedCount, int InProgressCount, double? AverageMinutes, double? MaximumMinutes, int OverdueCount);
public sealed record ProcessAnalyticsModel(string ProcessId, int TotalInstances, int ActiveInstances, int CompletedInstances,
    double? AverageCycleMinutes, IReadOnlyList<StepAnalyticsModel> Steps);
