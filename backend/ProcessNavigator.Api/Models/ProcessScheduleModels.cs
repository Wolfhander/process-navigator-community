namespace ProcessNavigator.Api.Models;

public sealed record ProcessScheduleRequestModel(
    string RootProcessId,
    string Direction,
    DateTimeOffset AnchorDate,
    bool IncludeWaitTime = true,
    string WorkdayStart = "09:00",
    string WorkdayEnd = "17:00",
    IReadOnlyList<int>? WorkingDays = null,
    double DurationScalePercent = 100,
    double TransferDelayHours = 0,
    IReadOnlyList<string>? NonWorkingDates = null,
    IReadOnlyDictionary<string, double>? ProcessDurationScalePercent = null,
    IReadOnlyDictionary<string, DateTimeOffset>? Checkpoints = null,
    int? UtcOffsetMinutes = null,
    IReadOnlyDictionary<string, ScheduleCalendarModel>? ProcessCalendars = null,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>? ProcessBranches = null,
    IReadOnlyDictionary<string, ScheduleRepetitionModel>? ProcessRepetitions = null);

public sealed record ScheduleRepetitionModel(string ReturnEdgeId, int PlannedRepeats, int MaximumRepeats);

public sealed record ScheduleCalendarModel(string WorkdayStart, string WorkdayEnd,
    IReadOnlyList<int> WorkingDays, IReadOnlyList<string> NonWorkingDates, int UtcOffsetMinutes);

public sealed record ProcessScheduleItemModel(
    string ProcessId,
    string ProcessName,
    double BaseDurationHours,
    double DurationHours,
    DateTimeOffset StartAt,
    DateTimeOffset EndAt,
    double SlackHours,
    bool IsCritical,
    double AppliedDurationScalePercent,
    DateTimeOffset? CheckpointAt,
    double? CheckpointDeltaHours,
    bool IsCheckpointMissed,
    bool IsDateReliable,
    IReadOnlyList<string> UncertaintyReasons,
    int MissingDurationCount,
    bool HasInternalCycle,
    double? MaximumDurationHours = null,
    DateTimeOffset? MaximumStartAt = null,
    DateTimeOffset? MaximumEndAt = null);

public sealed record ProcessScheduleDependencyModel(
    string SourceProcessId,
    string SourceProcessName,
    string TargetProcessId,
    string TargetProcessName,
    string ObjectId,
    string ObjectName,
    bool Required);

public sealed record ProcessScheduleIssueModel(
    string Code,
    string Severity,
    string Message,
    string? ProcessId = null,
    string? ElementId = null,
    string? ObjectId = null);

public sealed record ProcessScheduleAssumptionsModel(
    bool IncludeWaitTime,
    string WorkdayStart,
    string WorkdayEnd,
    IReadOnlyList<int> WorkingDays,
    double DurationScalePercent,
    double TransferDelayHours,
    IReadOnlyList<string> NonWorkingDates,
    IReadOnlyDictionary<string, double> ProcessDurationScalePercent,
    IReadOnlyDictionary<string, DateTimeOffset> Checkpoints,
    int UtcOffsetMinutes = 0,
    IReadOnlyDictionary<string, ScheduleCalendarModel>? ProcessCalendars = null,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>? ProcessBranches = null,
    IReadOnlyDictionary<string, ScheduleRepetitionModel>? ProcessRepetitions = null);

public sealed record ProcessScheduleModel(
    string Direction,
    string RootProcessId,
    DateTimeOffset AnchorDate,
    DateTimeOffset StartAt,
    DateTimeOffset EndAt,
    double DurationHours,
    double CriticalDurationHours,
    bool Complete,
    ProcessScheduleAssumptionsModel Assumptions,
    IReadOnlyList<ProcessScheduleItemModel> Processes,
    IReadOnlyList<ProcessScheduleDependencyModel> Dependencies,
    IReadOnlyList<ProcessScheduleIssueModel> Issues,
    ScheduleSourceSnapshotModel? Sources = null,
    DateTimeOffset? MaximumStartAt = null,
    DateTimeOffset? MaximumEndAt = null);

public sealed record ScheduleSourceSnapshotModel(string Algorithm, DateTimeOffset CapturedAt,
    IReadOnlyList<ProcessModel> Processes, IReadOnlyList<InformationObjectModel> Objects);
