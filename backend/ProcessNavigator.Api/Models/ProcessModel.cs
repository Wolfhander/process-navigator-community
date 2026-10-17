using System.Text.Json.Serialization;
namespace ProcessNavigator.Api.Models;

public sealed record ProcessModel(
    string Id,
    string Name,
    string Version,
    string Owner,
    string Status,
    IReadOnlyList<LaneModel> Lanes,
    IReadOnlyList<NodeModel> Nodes,
    IReadOnlyList<EdgeModel> Edges,
    ProcessPassportModel? Passport = null,
    string? OwnerLegalEntityId = null,
    string? OwnerUnitId = null);

public sealed record SourceRequirementModel(string Id, string Text, string Source, string? Locator = null, IReadOnlyList<string>? ElementIds = null, bool CheckSequence = false);

public sealed record ProcessPassportModel(
    int Level = 2,
    string Classification = "Основной",
    string? ParentProcessId = null,
    string? Purpose = null,
    string? Scope = null,
    string? Trigger = null,
    string? Result = null,
    IReadOnlyList<string>? Inputs = null,
    IReadOnlyList<string>? Outputs = null,
    IReadOnlyList<string>? Systems = null,
    IReadOnlyList<string>? Documents = null,
    IReadOnlyList<string>? RelatedProcessIds = null,
    IReadOnlyList<string>? TriggerOptions = null,
    IReadOnlyList<SourceRequirementModel>? SourceRequirements = null);

public sealed record LaneModel(string Id, string Name, double Y, double Height);
public sealed record ParticipantUnitRefModel(string LegalEntityId, string UnitId);
public sealed record ProcessChannelModel(
    string Id,
    string Kind,
    string Label,
    string? SystemName = null,
    string? DocumentName = null,
    string Flow = "primary",
    string Direction = "work");

public sealed record InformationObjectBindingModel(
    string ObjectId,
    string Name,
    string Role,
    bool Required = true,
    string? Condition = null,
    string? Version = null);

public sealed record StepEvidenceModel(string Status, string Statement, string? Source = null, string? Locator = null, string? Author = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record StepWorkRuleModel(string Kind, string? ObjectId = null, string? RequiredState = null, string? Condition = null, string? Response = null, string? Responsible = null);

public sealed record NodeModel(
    string Id,
    string Type,
    string Name,
    string LaneId,
    double X,
    double Y,
    double Width,
    double Height,
    string? Description,
    string? Responsible,
    string? Duration,
    IReadOnlyList<ArtifactModel>? Artifacts,
    IReadOnlyList<ActionModel>? Actions,
    IReadOnlyList<string>? Inputs = null,
    string? ExpectedResult = null,
    string? CompletionCriteria = null,
    string? Instruction = null,
    string? ExecutionMode = null,
    string? SystemName = null,
    string? WorkDuration = null,
    string? WaitDuration = null,
    IReadOnlyList<string>? ParticipantUnits = null,
    string? LinkedProcessId = null,
    IReadOnlyList<ParticipantUnitRefModel>? ParticipantUnitRefs = null,
    IReadOnlyList<ProcessChannelModel>? Channels = null,
    IReadOnlyList<InformationObjectBindingModel>? InformationObjects = null,
    string? BpmnType = null,
    string? ExecutorKind = null,
    IReadOnlyList<StepEvidenceModel>? Evidence = null,
    IReadOnlyList<StepWorkRuleModel>? WorkRules = null);

public sealed record EdgeModel(
    string Id,
    string SourceId,
    string TargetId,
    string? Label,
    IReadOnlyList<PointModel> Points);

public sealed record PointModel(double X, double Y);
public sealed record ArtifactModel(string Name, string Kind, string Version, string? Reference = null);
public sealed record ActionModel(string Id, string Label, string Kind, string? Target = null);

public sealed record ElementContextUpdateModel(
    string? Description,
    string? Responsible,
    string? Duration,
    IReadOnlyList<ArtifactModel>? Artifacts,
    IReadOnlyList<ActionModel>? Actions,
    IReadOnlyList<string>? Inputs = null,
    string? ExpectedResult = null,
    string? CompletionCriteria = null,
    string? Instruction = null,
    string? ExecutionMode = null,
    string? SystemName = null,
    string? WorkDuration = null,
    string? WaitDuration = null,
    IReadOnlyList<string>? ParticipantUnits = null,
    string? LinkedProcessId = null,
    IReadOnlyList<ParticipantUnitRefModel>? ParticipantUnitRefs = null,
    IReadOnlyList<ProcessChannelModel>? Channels = null,
    IReadOnlyList<InformationObjectBindingModel>? InformationObjects = null,
    string? ExecutorKind = null,
    IReadOnlyList<StepEvidenceModel>? Evidence = null,
    IReadOnlyList<StepWorkRuleModel>? WorkRules = null);

public sealed record ProcessSummaryModel(
    string Id,
    string Name,
    string Version,
    string Owner,
    string Status,
    int NodeCount,
    int LaneCount,
    bool HasDraft = false,
    string? DraftVersion = null,
    DateTimeOffset? CreatedAt = null,
    DateTimeOffset? UpdatedAt = null);

public sealed record ProcessImportResultModel(
    ProcessSummaryModel Process,
    IReadOnlyList<string> Warnings);

public sealed record ProcessPackageImportItemModel(
    string FileName,
    string Status,
    ProcessSummaryModel? Process,
    IReadOnlyList<string> Warnings,
    string? Error = null);

public sealed record ProcessPackageImportResultModel(
    int Total,
    int Imported,
    int Skipped,
    int Failed,
    IReadOnlyList<ProcessPackageImportItemModel> Items);

public sealed record CreateProcessModel(
    string? Id,
    string Name);

public sealed record ProcessPropertiesUpdateModel(
    string Owner,
    string OwnerLegalEntityId,
    string OwnerUnitId,
    ProcessPassportModel? Passport = null);

public sealed record ProcessVersionModel(
    string Version,
    string Status,
    DateTimeOffset CreatedAt);

public sealed record ProcessHierarchyUpdateModel(int Level, string Classification, string? ParentProcessId);
public sealed record ProcessHierarchyNodeModel(string Id, string Name, string Status, int Level, string Classification, string? ParentProcessId, IReadOnlyList<string> Issues);
public sealed record ProcessHierarchyBulkUpdateModel(IReadOnlyList<string> ProcessIds, int? Level, string? Classification);
public sealed record ProcessDecompositionLinkModel(
    string SourceProcessId,
    string SourceProcessName,
    int SourceLevel,
    string ElementId,
    string ElementName,
    string TargetProcessId,
    string? TargetProcessName,
    int? TargetLevel,
    bool BoundaryReady,
    IReadOnlyList<string> MissingBoundaries);
public sealed record ProcessDecompositionMapModel(
    IReadOnlyList<ProcessHierarchyNodeModel> Processes,
    IReadOnlyList<ProcessDecompositionLinkModel> Links);
public sealed record ProcessWorkflowActionModel(string? Comment);
public sealed record ProcessWorkflowStageModel(string Name, int RequiredApprovals = 1, IReadOnlyList<string>? ApproverUserIds = null);
public sealed record ProcessWorkflowRouteUpdateModel(IReadOnlyList<ProcessWorkflowStageModel> Stages, DateTimeOffset? ReviewDueAt = null);
public sealed record ProcessWorkflowEventModel(string Action, string FromStatus, string ToStatus, string UserId, string UserName, string? Comment, DateTimeOffset OccurredAt, int StageIndex = 0, string? StageName = null);
public sealed record ProcessWorkflowModel(
    string ProcessId,
    string Status,
    IReadOnlyList<ProcessWorkflowEventModel> Events,
    IReadOnlyList<ProcessWorkflowStageModel> Stages,
    int CurrentStageIndex,
    IReadOnlyList<string> CurrentStageApproverIds,
    DateTimeOffset? ReviewDueAt);
