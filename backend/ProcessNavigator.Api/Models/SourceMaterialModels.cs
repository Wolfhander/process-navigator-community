using System.Text.Json.Serialization;
namespace ProcessNavigator.Api.Models;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourceMaterialTarget(string ProcessId,bool Draft,string Name,string Kind,string DocumentVersion,
    string? ElementId=null,string? ObjectId=null,string? ExpectedFingerprint=null,string? EdgeId=null,SourceMaterialCitation? Citation=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourceMaterialCitation(string Status,string Statement,string? Locator=null,string? Author=null);
public sealed record SourceMaterialSnapshot(string ProcessId,string ProcessName,string ProcessVersion,[property:JsonRequired] bool Draft,
    string Name,string Kind,string DocumentVersion,string? ElementId,string? ElementName,string? ObjectId,string? ObjectName,string Fingerprint,
    string? EdgeId=null,string? EdgeName=null,SourceMaterialCitation? Citation=null);
public sealed record SourceMaterialRecord(int SchemaVersion,string Id,string FileName,long Size,string Sha256,
    DateTimeOffset UploadedAt,string UploadedBy,string UploadedByName,SourceMaterialSnapshot Target);
public sealed record SourceMaterialList(IReadOnlyList<SourceMaterialRecord> Materials,int Unreadable,bool Limited);
public sealed record SourceMaterialUploadResult(SourceMaterialRecord Material,bool Created);
public sealed record SourceMaterialCheck(string State,string Message);
