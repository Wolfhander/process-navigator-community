namespace ProcessNavigator.Api.Models;
public sealed record ParallelRoutePair(string ForkId,string JoinId,int Branches);
public sealed record RouteCycleComponent(IReadOnlyList<string> NodeIds,int TotalNodes,IReadOnlyList<string> ExitEdgeIds,int TotalExits,bool HasLabeledExclusiveExit);
public sealed record RouteTopologyReport(IReadOnlyList<ParallelRoutePair> Pairs,IReadOnlyList<RouteCycleComponent> Cycles,bool Limited,IReadOnlyList<ProcessValidationIssueModel> Issues);
