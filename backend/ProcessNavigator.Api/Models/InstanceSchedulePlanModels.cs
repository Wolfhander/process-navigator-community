namespace ProcessNavigator.Api.Models;

public sealed record InstanceSchedulePlanModel(string Id, string ProcessId, string InstanceId,
    string ProcessVersion, DateTimeOffset AssignedAt, string AssignedBy, string Reason,
    ProcessScheduleRequestModel Request, ProcessScheduleItemModel Item, ScheduleSourceSnapshotModel Sources);

public sealed record InstanceSchedulePlanUpdateModel(ProcessScheduleRequestModel Request,
    DateTimeOffset ExpectedStartAt, DateTimeOffset ExpectedEndAt, string ExpectedVersion,
    string? PreviousPlanId, string Reason, ScheduleSourceSnapshotModel? ExpectedSources = null);
