using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Text.Json.Serialization;
using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;

[JsonConverter(typeof(JsonStringEnumConverter<DiagnosticFailure>))]
public enum DiagnosticFailure { None, Rejected, Missing, Conflict, Cancelled, ServerError, StorageUnavailable, AuditWriteFailed }
public sealed record DiagnosticEvent(DateTimeOffset At,string OperationId,string Method,string Category,int Status,long ElapsedMilliseconds,DiagnosticFailure Failure);
public sealed record DiagnosticPackage(int SchemaVersion,DateTimeOffset GeneratedAt,DateTimeOffset ServerStartedAt,string ApplicationVersion,
    string RuntimeVersion,string Architecture,string RequestOperationId,long TotalRequests,long TotalFailures,long DiscardedEvents,IReadOnlyList<DiagnosticEvent> Events);

// Whitelist, not redaction: no request/response payloads, identities, headers, URLs or exception strings enter this journal.
public sealed class RequestDiagnostics
{
    public const string Header="X-Process-Navigator-Operation-Id";
    private static readonly object FailureKey=new();
    private readonly object gate=new();private readonly Queue<DiagnosticEvent> events=new();
    private readonly DateTimeOffset started=DateTimeOffset.UtcNow;private long total,failures,discarded;
    public static string NewOperationId()=>Guid.NewGuid().ToString("N");
    public static bool ValidId(string? id)=>id is not null&&Regex.IsMatch(id,"^[a-f0-9]{32}$");
    public static void AuditFailure(HttpContext c)=>c.Items[FailureKey]=DiagnosticFailure.AuditWriteFailed;
    public DiagnosticEvent Record(HttpContext c,string id,long elapsed,DiagnosticFailure failure)
    {
        if(!ValidId(id))throw new ArgumentException("Invalid server operation identifier.");
        var method=c.Request.Method is "GET" or "POST" or "PUT" or "DELETE" or "PATCH" or "HEAD" or "OPTIONS"?c.Request.Method:"OTHER";
        var category=new[]{"processes","analytics","admin","organization","session","health","notifications","users","import-recipes"}
            .FirstOrDefault(name=>c.Request.Path.StartsWithSegments("/api/"+name))??"other-api";
        var status=c.Response.StatusCode;
        if(c.Items.TryGetValue(FailureKey,out var auxiliary)&&auxiliary is DiagnosticFailure value)failure=value;
        if(failure==DiagnosticFailure.None)failure=status switch{404=>DiagnosticFailure.Missing,409=>DiagnosticFailure.Conflict,>=500=>DiagnosticFailure.ServerError,>=400=>DiagnosticFailure.Rejected,_=>DiagnosticFailure.None};
        var item=new DiagnosticEvent(DateTimeOffset.UtcNow,id,method,category,status,Math.Max(0,elapsed),failure);
        lock(gate){total++;if(failure!=DiagnosticFailure.None)failures++;if(events.Count==1000){events.Dequeue();discarded++;}events.Enqueue(item);}
        return item;
    }
    public DiagnosticPackage Snapshot(string requestId)
    {
        if(!ValidId(requestId))throw new ArgumentException("Invalid server operation identifier.");
        var version=typeof(RequestDiagnostics).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0]??"unknown";
        if(!Regex.IsMatch(version,"^[A-Za-z0-9.-]{1,80}$"))version="unknown";
        lock(gate)return new(1,DateTimeOffset.UtcNow,started,version,Environment.Version.ToString(),RuntimeInformation.ProcessArchitecture.ToString(),
            requestId,total,failures,discarded,events.ToArray());
    }
}

public sealed class RequestDiagnosticsMiddleware(RequestDelegate next,RequestDiagnostics diagnostics,ILogger<RequestDiagnosticsMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext c)
    {
        if(!c.Request.Path.StartsWithSegments("/api")){await next(c);return;}
        var id=RequestDiagnostics.NewOperationId();c.TraceIdentifier=id;c.Response.Headers[RequestDiagnostics.Header]=id;
        c.Response.OnStarting(()=>{c.Response.Headers[RequestDiagnostics.Header]=id;return Task.CompletedTask;});
        var watch=Stopwatch.StartNew();var failure=DiagnosticFailure.None;
        try{await next(c);}
        catch(OperationCanceledException)when(c.RequestAborted.IsCancellationRequested){failure=DiagnosticFailure.Cancelled;if(!c.Response.HasStarted)c.Response.StatusCode=499;}
        catch(Exception e)
        {
            var status=e is BadHttpRequestException request&&request.StatusCode is >=400 and <500?request.StatusCode:e is IOException or UnauthorizedAccessException?503:500;
            failure=status==503?DiagnosticFailure.StorageUnavailable:status>=500?DiagnosticFailure.ServerError:DiagnosticFailure.Rejected;
            if(c.Response.HasStarted)throw;
            c.Response.Clear();c.Response.StatusCode=status;c.Response.Headers[RequestDiagnostics.Header]=id;c.Response.Headers["Cache-Control"]="no-store";
            await c.Response.WriteAsJsonAsync(new{type="about:blank",title=status>=500?"Не удалось выполнить операцию":"Запрос отклонён",status,
                detail="Обновите данные и повторите. При обращении за помощью сообщите код операции.",operationId=id});
        }
        finally
        {
            var item=diagnostics.Record(c,id,watch.ElapsedMilliseconds,failure);
            if(item.Failure!=DiagnosticFailure.None)
                logger.Log(item.Status>=500?LogLevel.Error:LogLevel.Warning,
                    "API operation {OperationId}: {Method} {Category}; status {StatusCode}, elapsed {ElapsedMilliseconds} ms, failure {FailureKind}",
                    item.OperationId,item.Method,item.Category,item.Status,item.ElapsedMilliseconds,item.Failure);
        }
    }
}

public static class RequestDiagnosticsEndpoints
{
    public static void MapRequestDiagnostics(this WebApplication app)
    {
        app.MapGet("/api/admin/diagnostics",(HttpContext c,RequestDiagnostics d,AccessControlService access)=>{
            c.Response.Headers["Cache-Control"]="no-store";c.Response.Headers["X-Content-Type-Options"]="nosniff";
            return access.Has(c,ProcessPermissions.ManageSystem)?Results.Ok(d.Snapshot(c.TraceIdentifier)):Results.Problem("Нужно управление системой.",statusCode:403);
        });
    }
}
