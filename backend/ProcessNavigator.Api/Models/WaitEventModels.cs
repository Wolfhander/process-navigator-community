using System.Text.Json.Serialization;
namespace ProcessNavigator.Api.Models;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WaitEventModel(string Kind,string? Source=null,string? Channel=null,string? MessageName=null,
    double? DurationMinutes=null,double? TimeoutMinutes=null,double? ExpectedMinutes=null,string? CorrelationKey=null,
    string? UnsupportedDefinition=null,string? BpmnMessageRef=null);
public sealed record WaitExecutionModel(WaitEventModel Specification,string Status="Pending",DateTimeOffset? StartedAt=null,
    DateTimeOffset? DueAt=null,DateTimeOffset? ResolvedAt=null,string? ResolvedBy=null,string? Evidence=null,string? CorrelationKey=null);
public sealed record WaitActionModel(string Action,int ExpectedIteration,string? Evidence=null,string? CorrelationKey=null);
