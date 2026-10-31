using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;
internal static class ExecutionTimingChecks
{
    public static async Task<int> RunAsync(){
        int count=0;void Check(bool ok,string label){if(!ok)throw new Exception("Timing: "+label);count++;}
        var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var repo=new DirectoryInfo(AppContext.BaseDirectory);
        while(repo!=null&&!File.Exists(Path.Combine(repo.FullName,"master-data","execution-timing-fixture.json")))repo=repo.Parent;
        using var fixture=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(repo?.FullName??throw new Exception("Fixture missing"),"master-data","execution-timing-fixture.json")));
        foreach(var c in fixture.RootElement.GetProperty("cases").EnumerateArray()){
            var step=c.GetProperty("step").Deserialize<StepExecutionModel>(json)!;
            var events=c.GetProperty("events").Deserialize<ProcessLifecycleEventModel[]>(json)!;
            var instance=new ProcessInstanceModel("instance","timing","1","Учебный",c.GetProperty("status").GetString()!,DateTimeOffset.Parse("2026-10-19T08:00:00Z"),null,"fixture",[step],LifecycleEvents:events);
            var result=ExecutionTiming.Measure(instance,step,c.GetProperty("now").GetDateTimeOffset());
            Check(JsonSerializer.Serialize(result,json)==c.GetProperty("expected").GetRawText().Replace(" ",""),"Shared fixture "+c.GetProperty("id").GetString());
        }
        var root=Path.Combine(Path.GetTempPath(),"pn-timing-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        try{
            var clock=new Clock(DateTimeOffset.Parse("2026-10-19T08:00:00Z"));var service=new ProcessExecutionService(new Env(root),clock);
            NodeModel N(string id,string type="task")=>new(id,type,id,"lane",0,0,100,80,null,null,null,[],[],WorkDuration:"1 час",WaitDuration:"30 минут");
            var model=new ProcessModel("timing","Учебный маршрут","1","Отдел","Published",[],[N("s","startEvent"),N("a"),N("b"),N("z","endEvent")],[new("sa","s","a",null,[]),new("ab","a","b",null,[]),new("bz","b","z",null,[])]);
            var i=await service.StartAsync(model,"fixture","Проверка времени",default);
            Check(i.StartedAt==clock.Now&&i.Steps.Single(s=>s.ElementId=="a").PlannedDurationMinutes==90,"Server clock and norm snapshot captured");
            var originalDue=i.Steps.Single(s=>s.ElementId=="a").PlannedCompletedAt;
            clock.Advance(100);
            Check((await service.AnalyticsAsync(model,default)).Steps.Single(s=>s.ElementId=="a").OverdueCount==1,"Queue can exceed norm before start");
            i=await service.UpdateStepAsync(model,i.Id,"a","InProgress","fixture",default);
            clock.Advance(20);i=await service.ChangeLifecycleAsync(model.Id,i.Id,"pause","Учебная пауза","fixture",default);
            clock.Advance(120);
            var during=ExecutionTiming.Measure(i,i.Steps.Single(s=>s.ElementId=="a"),clock.Now);
            Check(during.Queue==100&&during.Work==20&&during.Overdue==30,"Pause does not accumulate new active minutes");
            i=await service.ChangeLifecycleAsync(model.Id,i.Id,"resume",null,"fixture",default);
            Check(i.Steps.Single(s=>s.ElementId=="a").PlannedCompletedAt==originalDue!.Value.AddMinutes(120),"Resume moves normative deadline by pause only");
            clock.Advance(10);i=await service.UpdateStepAsync(model,i.Id,"a","Completed","fixture",default);
            var done=i.Steps.Single(s=>s.ElementId=="a");
            Check(done.ActualQueueMinutes==100&&done.ActualWorkMinutes==30&&done.ActualDurationMinutes==130&&done.OverdueMinutes==40,"Completed facts exclude pause and include queue");
            Check(i.Steps.Single(s=>s.ElementId=="b").AvailableAt==clock.Now,"Next step norm begins when actually available");
            var changed=model with{Nodes=model.Nodes.Select(n=>n.Id=="a"?n with{WorkDuration="10 часов"}:n).ToArray()};
            clock.Advance(300);
            var loaded=(await service.ListAsync(model.Id,default)).Single();
            Check(loaded.Steps.Single(s=>s.ElementId=="a").PlannedDurationMinutes==90,"Current model does not rewrite saved norm");
            i=await service.ChangeLifecycleAsync(model.Id,i.Id,"cancel","Учебная отмена","fixture",default);
            var stopped=ExecutionTiming.Measure(i,i.Steps.Single(s=>s.ElementId=="b"),clock.Now);
            clock.Advance(10000);
            Check(ExecutionTiming.Measure(i,i.Steps.Single(s=>s.ElementId=="b"),clock.Now)==stopped,"Cancellation freezes unfinished queue");
            Check((await service.AnalyticsAsync(changed,default)).Steps.Single(s=>s.ElementId=="a").AverageMinutes==130,"Analytics uses preserved completion facts");
        }finally{
            var full=Path.GetFullPath(root);if(!full.StartsWith(Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("Unsafe temporary cleanup");
            Directory.Delete(full,true);
        }
        return count;
    }
    private sealed class Clock(DateTimeOffset start):TimeProvider{public DateTimeOffset Now=start;public override DateTimeOffset GetUtcNow()=>Now;public void Advance(int minutes)=>Now=Now.AddMinutes(minutes);}
    private sealed class Env(string root):IWebHostEnvironment{
        public string ApplicationName{get;set;}="Timing";public string EnvironmentName{get;set;}="Development";public string ContentRootPath{get;set;}=root;public string WebRootPath{get;set;}=root;
        public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
