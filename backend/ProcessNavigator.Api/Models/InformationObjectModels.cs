namespace ProcessNavigator.Api.Models;

public sealed record InformationObjectOccurrenceModel(
    string ProcessId,
    string ProcessName,
    string? ElementId,
    string? ElementName,
    string Scope,
    string Direction,
    bool Required = true,
    string? Condition = null,
    string? Version = null);

public sealed record InformationObjectModel(
    string Id,
    string Name,
    string Kind,
    IReadOnlyList<string> Aliases,
    string Version,
    string LifecycleState,
    bool Managed,
    string State,
    IReadOnlyList<InformationObjectOccurrenceModel> Producers,
    IReadOnlyList<InformationObjectOccurrenceModel> Consumers,
    IReadOnlyList<InformationObjectOccurrenceModel> References);

public sealed record InformationObjectIssueModel(
    string ObjectId,
    string Code,
    string Severity,
    string Message);

public sealed record InformationObjectRegistryModel(
    DateTimeOffset GeneratedAt,
    int ProcessCount,
    int ObjectCount,
    int DocumentCount,
    int ResultCount,
    int MissingProducerCount,
    int MissingConsumerCount,
    int MultipleProducerCount,
    int VersionConflictCount,
    IReadOnlyList<InformationObjectModel> Objects,
    IReadOnlyList<InformationObjectIssueModel> Issues);

public sealed record InformationObjectUpdateModel(
    string Name,
    string Kind,
    string Version,
    string LifecycleState,
    IReadOnlyList<string> Aliases);
