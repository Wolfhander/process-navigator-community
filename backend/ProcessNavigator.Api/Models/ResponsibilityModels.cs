namespace ProcessNavigator.Api.Models;

public sealed record ResponsibilityPersonModel(string Id, string Name, bool ActiveAtCapture = true);
public sealed record ProcessResponsibilitySnapshotModel(ProcessModel Process, OrganizationMapModel Organization,
    IReadOnlyList<LaneAssignmentModel> Lanes, IReadOnlyList<ResponsibilityPersonModel> People, DateTimeOffset CapturedAt);
public sealed record ProcessReceiptUpdateModel(string SourceProcessId, string SourceInstanceId, string SourceElementId,
    int SourceIteration, string TargetElementId, int TargetIteration, string ObjectId, string Version, string Reason);
public sealed record ProcessReceiptModel(string Id, string SourceProcessId, string SourceProcessName, string SourceVersion,
    string SourceInstanceId, string SourceElementId, string SourceElementName, int SourceIteration, string SourceResponsible,
    string TargetElementId, string TargetElementName, int TargetIteration, string TargetResponsible,
    string ObjectId, string Version, string Reason, DateTimeOffset AcceptedAt, string AcceptedBy, string AcceptedByName);
