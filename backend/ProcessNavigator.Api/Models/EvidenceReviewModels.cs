using System.Text.Json.Serialization;
namespace ProcessNavigator.Api.Models;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record EvidenceReviewRequest(int Index,string ExpectedVersion,string ExpectedFingerprint,string Action,string Reason);
public sealed record EvidenceReviewEvent(string Id,string ElementId,int Index,string Version,bool Draft,string Fingerprint,
    string Action,string Reason,string ActorId,string ActorName,DateTimeOffset RecordedAt,StepEvidenceModel Evidence);
public sealed record EvidenceReviewEntry(int Index,string Fingerprint,StepEvidenceModel Evidence,string State);
public sealed record EvidenceReviewReport(string ProcessId,string ElementId,string Version,bool Draft,
    IReadOnlyList<EvidenceReviewEntry> Entries,IReadOnlyList<EvidenceReviewEvent> History);
