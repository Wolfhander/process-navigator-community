namespace ProcessNavigator.Api.Models;

public sealed record PortfolioAnalyticsModel(
    int TotalProcesses,
    int PublishedProcesses,
    int DraftProcesses,
    int ProcessesWithOwner,
    int ProcessesWithOrganization,
    int TotalDepartments,
    int ParticipatingDepartments,
    int TotalInstances,
    int ActiveInstances,
    int CompletedInstances,
    int OverdueSteps,
    double AverageReadinessPercent,
    int ProcessesWithAllDurations,
    int ProcessesWithSystems,
    int ProcessesWithDecomposition,
    int InformationObjectCount,
    int InformationIssueCount,
    int CrossLaneTransferCount,
    IReadOnlyList<PortfolioDirectionModel> Directions,
    IReadOnlyList<PortfolioDepartmentModel> Departments,
    IReadOnlyList<PortfolioSystemModel> Systems,
    IReadOnlyList<PortfolioLevelModel> Levels,
    IReadOnlyList<PortfolioProcessModel> Processes);

public sealed record PortfolioDirectionModel(string Id, string Name, string LegalEntityName, int ProcessCount);

public sealed record PortfolioDepartmentModel(string Id, string Name, string ShortName, string LegalEntityName, int ProcessCount);

public sealed record PortfolioSystemModel(string Name, int ProcessCount, int TaskCount);

public sealed record PortfolioLevelModel(int Level, int ProcessCount);

public sealed record PortfolioProcessModel(
    string Id,
    string Name,
    string Status,
    string Owner,
    IReadOnlyList<string> LegalEntities,
    IReadOnlyList<string> Directions,
    int LaneCount,
    int MappedLaneCount,
    int TaskCount,
    int DescribedTaskCount,
    int TimedTaskCount,
    int SystemTaskCount,
    int ManualTaskCount,
    int ExternalTaskCount,
    int InformationObjectCount,
    int InformationIssueCount,
    int CrossLaneTransferCount,
    int Level,
    int ChildProcessCount,
    IReadOnlyList<string> Systems,
    int TotalInstances,
    int ActiveInstances,
    double? AverageCycleMinutes,
    int OverdueSteps,
    double ReadinessPercent,
    IReadOnlyList<string> Issues);
