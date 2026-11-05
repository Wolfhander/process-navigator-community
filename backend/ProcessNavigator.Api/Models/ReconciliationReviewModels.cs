using System.Text.Json.Serialization;
namespace ProcessNavigator.Api.Models;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReconciliationReviewRequest(string ExpectedVersion,string ExpectedFingerprint,string Action,string Reason,string? MaterialId=null,string? PreviousEventId=null);
public sealed record ReconciliationReviewEvent(string Id,string RequirementId,string Version,bool Draft,string Fingerprint,string Action,string Reason,
    string ActorId,string ActorName,DateTimeOffset RecordedAt,SourceRequirementModel Requirement,SourceMaterialRecord? Material);
public sealed record ReconciliationReviewReport(string ProcessId,string ProcessName,string RequirementId,string Version,bool Draft,string Fingerprint,
    SourceRequirementModel? Requirement,string State,IReadOnlyList<string> Gaps,IReadOnlyList<ReconciliationReviewEvent> History);
