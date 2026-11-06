namespace ProcessNavigator.Api.Models;

public sealed record ScheduleObjectRuleModel(string ProcessId,string ElementId,string ObjectId,string Role,string FactName,bool? ExpectedValue);
public sealed record ScheduleProbabilityWeightModel(string EdgeId,double? Probability);
public sealed record ScheduleBranchProbabilityModel(string ProcessId,string GatewayId,IReadOnlyList<ScheduleProbabilityWeightModel> Weights);
public sealed record ScheduleAlternativeCaseModel(int Number,double Probability,
    IReadOnlyDictionary<string,IReadOnlyDictionary<string,string>> Choices,DateTimeOffset StartAt,DateTimeOffset EndAt,
    double NominalHours,bool Complete,IReadOnlyList<string> ProcessIds);
public sealed record ScheduleAlternativeEnvelopeModel(IReadOnlyList<ScheduleAlternativeCaseModel> Cases,
    DateTimeOffset EarliestStart,DateTimeOffset LatestStart,DateTimeOffset EarliestEnd,DateTimeOffset LatestEnd,
    double ExpectedNominalHours,double ProbabilityMass,bool Complete);
