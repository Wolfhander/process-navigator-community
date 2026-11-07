namespace ProcessNavigator.Api.Models;

public sealed record ScheduleRepeatWeightModel(int Repeats,double Probability);
public sealed record ScheduleIterationPlanModel(string ReturnEdgeId,int PlannedRepeats,int MaximumRepeats,
    IReadOnlyList<ScheduleRepeatWeightModel>? Distribution=null);
public sealed record SchedulePassCoordinateModel(string ReturnEdgeId,int Pass);
public sealed record SchedulePassDateModel(string ProcessId,string ElementId,string ElementName,int Occurrence,
    IReadOnlyList<SchedulePassCoordinateModel> Path,DateTimeOffset StartAt,DateTimeOffset EndAt,string CalendarSource);
public sealed record SchedulePassTransferModel(string ObjectId,string ObjectName,string Mode,
    string SourceProcessId,string SourceElementId,int SourceOccurrence,string TargetProcessId,string TargetElementId,
    int TargetOccurrence,DateTimeOffset SourceReadyAt,DateTimeOffset RequiredAt);
public sealed record ScheduleIterationDetailModel(IReadOnlyList<SchedulePassDateModel> PlannedSteps,
    IReadOnlyList<SchedulePassDateModel> MaximumSteps,IReadOnlyList<SchedulePassTransferModel> Transfers,
    IReadOnlyList<SchedulePassTransferModel> MaximumTransfers);
