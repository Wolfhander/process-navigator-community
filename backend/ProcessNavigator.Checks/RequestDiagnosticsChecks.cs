using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;
using System.Text.Json;
using ProcessNavigator.Api.Services;
public static class RequestDiagnosticsChecks
{
    private sealed class CaptureLogger:ILogger<RequestDiagnosticsMiddleware>{
        public List<string> Lines{get;}=[];
        public IDisposable? BeginScope<TState>(TState state)where TState:notnull=>null;
        public bool IsEnabled(LogLevel level)=>true;
        public void Log<TState>(LogLevel level,EventId id,TState state,Exception? e,Func<TState,Exception?,string> formatter)=>Lines.Add(formatter(state,e));
    }
    public static async Task<int> RunAsync()
    {
        var count=0;void Check(bool ok,string name){if(!ok)throw new Exception(name);count++;}
        const string canary="CANARY_PRIVATE_TOKEN_name@example.invalid_C:/Private/SECRET";
        DefaultHttpContext Context(string path="/api/processes/private-item"){
            var c=new DefaultHttpContext();c.RequestServices=new ServiceCollection().AddLogging().BuildServiceProvider();
            c.Request.Path=path;c.Request.QueryString=new("?token="+Uri.EscapeDataString(canary));c.Request.Headers["Authorization"]=canary;c.Request.Headers["Cookie"]=canary;
            c.Request.Headers[RequestDiagnostics.Header]=new string('a',32);c.Request.Method="POST";c.Request.Body=new MemoryStream(System.Text.Encoding.UTF8.GetBytes(canary));c.Response.Body=new MemoryStream();return c;
        }
        async Task<(DefaultHttpContext Context,RequestDiagnostics Journal,CaptureLogger Logger)> Run(RequestDelegate next){
            var c=Context();var journal=new RequestDiagnostics();var log=new CaptureLogger();await new RequestDiagnosticsMiddleware(next,journal,log).InvokeAsync(c);return(c,journal,log);
        }
        var failed=await Run(_=>throw new InvalidOperationException(canary));
        var id=failed.Context.TraceIdentifier;Check(RequestDiagnostics.ValidId(id)&&id!=new string('a',32),"Server generates its own ID");
        Check(failed.Context.Response.Headers[RequestDiagnostics.Header]==id,"Response exposes matching ID");
        failed.Context.Response.Body.Position=0;var body=await new StreamReader(failed.Context.Response.Body).ReadToEndAsync();
        Check(failed.Context.Response.StatusCode==500&&body.Contains(id)&&!body.Contains(canary),"Safe unhandled response");
        var package=failed.Journal.Snapshot(RequestDiagnostics.NewOperationId());
        var json=JsonSerializer.Serialize(package,new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Check(!json.Contains(canary)&&!json.Contains("private-item")&&!json.Contains("Authorization")&&!json.Contains("Cookie"),"Packet never receives payload, path, identities or headers");
        Check(package.Events.Single().Failure==DiagnosticFailure.ServerError&&package.Events.Single().Category=="processes","Structured classification");
        Check(failed.Logger.Lines.Count==1&&failed.Logger.Lines.All(l=>!l.Contains(canary))&&failed.Logger.Lines.Single().Contains(id),"Structured log safe and correlated");
        var storage=await Run(_=>throw new IOException(canary));Check(storage.Context.Response.StatusCode==503&&storage.Journal.Snapshot(id).Events.Single().Failure==DiagnosticFailure.StorageUnavailable,"IO failure classified without details");
        var bad=await Run(_=>throw new BadHttpRequestException(canary,413));Check(bad.Context.Response.StatusCode==413&&bad.Journal.Snapshot(id).Events.Single().Failure==DiagnosticFailure.Rejected,"Bad request status retained without message");
        var rejected=await Run(c=>{c.Response.StatusCode=422;return Task.CompletedTask;});Check(rejected.Journal.Snapshot(id).Events.Single().Failure==DiagnosticFailure.Rejected,"Handled nonexception error retained");
        var missing=await Run(c=>{c.Response.StatusCode=404;return Task.CompletedTask;});Check(missing.Journal.Snapshot(id).Events.Single().Failure==DiagnosticFailure.Missing,"Not found retained");
        var conflict=await Run(c=>{c.Response.StatusCode=409;return Task.CompletedTask;});Check(conflict.Journal.Snapshot(id).Events.Single().Failure==DiagnosticFailure.Conflict,"Conflict retained");
        var auxiliary=await Run(c=>{RequestDiagnostics.AuditFailure(c);return Task.CompletedTask;});
        Check(auxiliary.Journal.Snapshot(id).Events.Single().Status==200&&auxiliary.Journal.Snapshot(id).Events.Single().Failure==DiagnosticFailure.AuditWriteFailed,"Audit failure does not pretend business operation failed");
        var cancelled=Context();cancelled.RequestAborted=new CancellationToken(true);var cancelledJournal=new RequestDiagnostics();
        await new RequestDiagnosticsMiddleware(_=>throw new OperationCanceledException(),cancelledJournal,new CaptureLogger()).InvokeAsync(cancelled);
        Check(cancelledJournal.Snapshot(id).Events.Single().Failure==DiagnosticFailure.Cancelled&&cancelled.Response.StatusCode==499,"Aborted request diagnosed separately");
        var ordinary=Context("/static/private");var ordinaryJournal=new RequestDiagnostics();
        await new RequestDiagnosticsMiddleware(_=>Task.CompletedTask,ordinaryJournal,new CaptureLogger()).InvokeAsync(ordinary);
        Check(ordinaryJournal.Snapshot(id).TotalRequests==0&&!ordinary.Response.Headers.ContainsKey(RequestDiagnostics.Header),"Static/nonAPI outside journal scope");
        var ring=new RequestDiagnostics();for(var i=0;i<1005;i++)ring.Record(Context(),RequestDiagnostics.NewOperationId(),-1,DiagnosticFailure.None);
        var window=ring.Snapshot(id);Check(window.Events.Count==1000&&window.TotalRequests==1005&&window.DiscardedEvents==5,"Bounded window and honest counters");
        Check(window.Events.All(e=>e.ElapsedMilliseconds==0),"Negative elapsed is normalized");
        var concurrent=new RequestDiagnostics();Parallel.For(0,200,i=>concurrent.Record(Context(),RequestDiagnostics.NewOperationId(),i,DiagnosticFailure.None));
        Check(concurrent.Snapshot(id).Events.Count==200&&concurrent.Snapshot(id).Events.Select(e=>e.OperationId).Distinct().Count()==200,"Concurrent requests retained exactly once");
        var other=Context();other.Request.Method=canary;other.Request.Path="/api/unknown/private-name";
        Check(ring.Record(other,RequestDiagnostics.NewOperationId(),1,DiagnosticFailure.None).Method=="OTHER"&&ring.Snapshot(id).Events.Last().Category=="other-api","Arbitrary method/path cannot become exported strings");
        try{ring.Record(other,canary,1,DiagnosticFailure.None);throw new Exception("Unsafe ID accepted");}catch(ArgumentException){count++;}
        var restarted=new RequestDiagnostics();Check(restarted.Snapshot(id).TotalRequests==0,"New process journal does not invent prior history");
        return count;
    }
}
