using System.Text.Json.Serialization;
namespace ProcessNavigator.Api.Models;
public sealed record TableReferenceChoice(string Kind,string Id,string Name,string Scope="");
public sealed record TableReferenceCell(string Sheet,int Row,string Column,string Cell,int Token,string ProcessId,string StepId,string? RelatedCell=null);
public sealed record TableReferenceGroup(string Id,string Kind,string Value,string Scope,bool CanKeep,IReadOnlyList<TableReferenceCell> Cells);
public sealed record TableReferenceReport(string Fingerprint,IReadOnlyList<TableReferenceChoice> Choices,IReadOnlyList<TableReferenceGroup> Groups);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TableReferenceRule(string GroupId,string? TargetId=null,bool KeepNew=false);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TableReferenceResolution(string Fingerprint,IReadOnlyList<TableReferenceRule> Rules);
