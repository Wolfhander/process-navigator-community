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
    IReadOnlyList<InformationObjectOccurrenceModel> References,
    IReadOnlyList<InformationObjectRevisionModel>? History = null,
    IReadOnlyList<InformationObjectComponentModel>? Components = null, string? ExternalSource = null, string? ExternalRecipient = null);

public sealed record InformationObjectComponentModel(string ObjectId, bool Required = true, string? Version = null, string? Condition = null);

public sealed record InformationObjectRevisionModel(string Name, string Kind, string Version, string LifecycleState,
    IReadOnlyList<string> Aliases, DateTimeOffset ArchivedAt, IReadOnlyList<InformationObjectComponentModel>? Components = null, string? ExternalSource = null, string? ExternalRecipient = null);

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
    IReadOnlyList<string> Aliases,
    string? ExpectedVersion = null,
    string? ExpectedLifecycleState = null,
    IReadOnlyList<InformationObjectComponentModel>? Components = null, string? ExternalSource = null, string? ExternalRecipient = null);
