namespace ProcessNavigator.Api.Models;

public sealed record ScheduleArchiveSaveModel(string Name, ProcessScheduleRequestModel Request, ProcessScheduleModel ExpectedResult);
public sealed record ScheduleArchiveSnapshotModel(string Id, string Name, DateTimeOffset SavedAt,
    ProcessScheduleRequestModel Request, ProcessScheduleModel Result);
public sealed record ScheduleArchiveSummaryModel(string Id, string Name, DateTimeOffset SavedAt,
    string RootProcessId, int ProcessCount, DateTimeOffset StartAt, DateTimeOffset EndAt, bool Complete);
