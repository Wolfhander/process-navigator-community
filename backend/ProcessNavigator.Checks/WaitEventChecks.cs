using System.Text.Json;
using System.Xml.Linq;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class WaitEventChecks
{
    static NodeModel N(string id,string type="task")=>new(id,type,id,"lane",100,40,100,80,null,null,"1 час",[],[],InformationObjects:[]);
    static EdgeModel E(string id,string a,string b)=>new(id,a,b,id,[new(100,40),new(200,40)]);
    static ProcessModel P(WaitEventModel wait,bool after=true)=>new("waits","Учебное ожидание","1","Отдел","Published",[new("lane","Отдел",0,200)],
        after?[N("s","startEvent"),N("wait") with{WaitEvent=wait},N("after"),N("end","endEvent")]:[N("s","startEvent"),N("wait") with{WaitEvent=wait},N("end","endEvent")],
        after?[E("sw","s","wait"),E("wa","wait","after"),E("ae","after","end")]:[E("sw","s","wait"),E("we","wait","end")]);
    public static async Task<int> RunAsync()
    {
        var count=0;void Check(bool b,string message){if(!b)throw new Exception(message);count++;}
        async Task Reject(Func<Task> action){var rejected=false;try{await action();}catch(InvalidDataException){rejected=true;}Check(rejected,"Unsupported wait transition must reject");}
        XNamespace b="http://www.omg.org/spec/BPMN/20100524/MODEL";
        var native=new XElement(b+"intermediateCatchEvent",new XAttribute("id","native"),
            new XElement(b+"timerEventDefinition",new XElement(b+"timeDuration","PT1H")));
        Check(WaitEvents.Read(native,null)?.DurationMinutes==60,"Native duration read as elapsed calendar minutes");
        Check(WaitEvents.Read(new XElement(b+"receiveTask",new XAttribute("messageRef","ref1")),null)?.BpmnMessageRef=="ref1","Native message reference survives model reading");
        Check(WaitEvents.Read(new XElement(b+"intermediateCatchEvent",new XElement(b+"timerEventDefinition",new XElement(b+"timeCycle","R3/PT1H"))),null)?.Kind=="unsupported","Timer cycles never become zero-duration tasks");
        Check(WaitEvents.Read(new XElement(b+"intermediateCatchEvent",new XElement(b+"signalEventDefinition")),null)?.Kind=="unsupported","Other catch semantics explicit unsupported");
        Check(WaitEvents.Read(new XElement(b+"startEvent",new XElement(b+"timerEventDefinition",new XElement(b+"timeDuration","PT1H"))),null)?.Kind=="unsupported","Scheduled start cannot be silently executed as ordinary manual start");
        Check(WaitEvents.Normalize(JsonSerializer.Deserialize<WaitEventModel>("""{"kind":"message","source":"Отдел","channel":"Почта","messageName":"Ответ"}""",new JsonSerializerOptions(JsonSerializerDefaults.Web)))?.Source=="Отдел","Structured wait JSON parsing");
        await Reject(()=>{WaitEvents.Normalize(new("timer",DurationMinutes:double.PositiveInfinity));return Task.CompletedTask;});
        await Reject(()=>{WaitEvents.Normalize(new("message",DurationMinutes:1));return Task.CompletedTask;});
        await Reject(()=>{WaitEvents.Normalize(new("message",ExpectedMinutes:60,TimeoutMinutes:60));return Task.CompletedTask;});
        var root=Path.Combine(Path.GetTempPath(),"pn-waits-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"Data"));
        try{
            var host=new Host(root);var clock=new Clock{At=DateTimeOffset.Parse("2026-11-13T16:30Z")};
            var execution=new ProcessExecutionService(host,clock);
            var timer=P(new("timer",DurationMinutes:60),false);
            var instance=await execution.StartAsync(timer,"demo","Таймер",default);
            Check(instance.Steps.Single().Waiting?.Status=="Pending","Spec snapshotted at execution launch, before activation");
            await Reject(()=>execution.UpdateStepAsync(timer,instance.Id,"wait","Completed","demo",default));
            instance=await execution.UpdateStepAsync(timer,instance.Id,"wait","InProgress","demo",default,new("Begin",1));
            var due=instance.Steps.Single().Waiting!.DueAt;
            Check(due==clock.At.AddHours(1),"Deadline starts at explicit activation");
            await Reject(()=>execution.UpdateStepAsync(timer,instance.Id,"wait","InProgress","demo",default,new("CheckTimer",1)));
            await execution.ChangeLifecycleAsync(timer.Id,instance.Id,"pause","Учебная пауза","demo",default);
            clock.At=clock.At.AddMinutes(65);
            await Reject(()=>execution.UpdateStepAsync(timer,instance.Id,"wait","InProgress","demo",default,new("CheckTimer",1)));
            instance=await execution.ChangeLifecycleAsync(timer.Id,instance.Id,"resume",null,"demo",default);
            Check(instance.Steps.Single().Waiting!.DueAt==due,"Pause never moves calendar timer deadline");
            instance=await execution.UpdateStepAsync(timer,instance.Id,"wait","InProgress","demo",default,new("CheckTimer",1));
            Check(instance.Status=="Completed"&&instance.Steps.Single().Waiting?.Status=="Elapsed","Confirmed timer completes its own step and process");
            Check(instance.Steps.Single().ActualWorkMinutes==0&&instance.Steps.Single().ActualEventWaitMinutes==65,"Timer elapsed includes pause, not employee work");
            Check((await execution.UpdateStepAsync(timer,instance.Id,"wait","InProgress","demo",default,new("CheckTimer",1))).Id==instance.Id,"Terminal timer retry is idempotent");
            await Reject(()=>{WaitEvents.Validate(instance.Steps.Single().Waiting! with{DueAt=due!.Value.AddMinutes(-1)});return Task.CompletedTask;});
            var message=P(new("message","Учебный отдел","Почта","Подтверждение",TimeoutMinutes:30,ExpectedMinutes:10,CorrelationKey:"ORDER-1"));
            instance=await execution.StartAsync(message,"demo","Сообщение",default);
            await Reject(()=>execution.UpdateStepAsync(message,instance.Id,"after","InProgress","demo",default));
            instance=await execution.UpdateStepAsync(message,instance.Id,"wait","InProgress","demo",default,new("Begin",1));
            await Reject(()=>execution.UpdateStepAsync(message,instance.Id,"wait","InProgress","demo",default,new("Receive",1,"Письмо получено","OTHER")));
            await Reject(()=>execution.UpdateStepAsync(message,instance.Id,"wait","InProgress","demo",default,new("Receive",2,"Письмо получено","ORDER-1")));
            clock.At=clock.At.AddMinutes(5);
            instance=await execution.UpdateStepAsync(message,instance.Id,"wait","InProgress","demo",default,new("Receive",1,"Письмо получено","ORDER-1"));
            Check(instance.Steps.Single(s=>s.ElementId=="wait").Waiting?.Evidence=="Письмо получено","Receipt reason and correlation recorded");
            instance=await execution.UpdateStepAsync(message,instance.Id,"after","InProgress","demo",default);
            instance=await execution.ReturnStepAsync(message,instance.Id,"after","wait","Повторить запрос","demo",default);
            var step=instance.Steps.Single(s=>s.ElementId=="wait");
            Check(step.Iteration==2&&step.Waiting?.Status=="Pending"&&step.History!.Single().Waiting?.Status=="Received","Return archives prior receipt and resets new wait activation");
            await Reject(()=>execution.UpdateStepAsync(message,instance.Id,"wait","InProgress","demo",default,new("Receive",1,"Письмо получено","ORDER-1")));
            instance=await execution.UpdateStepAsync(message,instance.Id,"wait","InProgress","demo",default,new("Begin",2));
            clock.At=clock.At.AddMinutes(31);
            await Reject(()=>execution.UpdateStepAsync(message,instance.Id,"wait","InProgress","demo",default,new("Receive",2,"Позднее письмо","ORDER-1")));
            instance=await execution.UpdateStepAsync(message,instance.Id,"wait","InProgress","demo",default,new("CheckTimeout",2));
            Check(instance.Status=="Active"&&instance.Steps.Single(s=>s.ElementId=="wait").Status=="InProgress"&&instance.Steps.Single(s=>s.ElementId=="wait").Waiting?.Status=="TimedOut","Message timeout is not success and cannot unlock downstream");
            await Reject(()=>execution.UpdateStepAsync(message,instance.Id,"after","InProgress","demo",default));
            var timeline=await execution.TimelineAsync(message,instance.Id,[],default);
            Check(timeline.Events.Count(e=>e.Type=="WaitResolved")==2,"Current timeout and prior receipt visible in timeline");
            var closed=await execution.ChangeLifecycleAsync(message.Id,instance.Id,"refuse","Не поступило подтверждение","demo",default);
            Check(closed.Outcome?.Kind=="Refusal"&&closed.Steps.Single(s=>s.ElementId=="wait").Waiting?.Status=="TimedOut","Explicit refusal preserves timeout, never invents successful receipt");
            var lastMessage=P(message.Nodes.Single(n=>n.Id=="wait").WaitEvent!,false);
            var last=await execution.StartAsync(lastMessage,"demo","Последнее сообщение",default);
            await execution.UpdateStepAsync(lastMessage,last.Id,"wait","InProgress","demo",default,new("Begin",1));
            last=await execution.UpdateStepAsync(lastMessage,last.Id,"wait","InProgress","demo",default,new("Receive",1,"Получено подтверждение","ORDER-1"));
            Check((await execution.UpdateStepAsync(lastMessage,last.Id,"wait","InProgress","demo",default,new("Receive",1,"Получено подтверждение","ORDER-1"))).CompletedAt==last.CompletedAt,"Terminal message retry preserves original fact and timestamp");
            await Reject(()=>execution.StartAsync(P(new("message")), "demo",null,default));
            await ScheduleScenarioChecks.Write(root,P(new("timer",DurationMinutes:60)));
            var catalog=new ProcessCatalogService(new BpmnProcessLoader(host));
            var schedule=new ProcessScheduleService(catalog,new InformationObjectRegistryService(catalog,host));
            var request=new ProcessScheduleRequestModel("waits","Forward",DateTimeOffset.Parse("2026-11-13T16:30Z"),UtcOffsetMinutes:0);
            var plan=await schedule.CalculateAsync(request,false);
            Check(plan.EndAt==DateTimeOffset.Parse("2026-11-16T10:00Z")&&plan.CriticalDurationHours==2,"Calendar timer crosses end of shift before next working action");
            Check(plan.Sources!.Algorithm==ProcessScheduleService.EventAlgorithm&&plan.Complete,"New event algorithm is versioned and complete with explicit timer");
            var scaled=await schedule.CalculateAsync(request with{DurationScalePercent=50,IncludeWaitTime=false},false);
            Check(scaled.DurationHours==1.5&&scaled.EndAt==DateTimeOffset.Parse("2026-11-16T09:30Z"),"Work scaling and optional wait toggle do not shorten explicit timer");
            Check(JsonSerializer.Serialize(await schedule.ReplayAsync(request,plan.Sources))==JsonSerializer.Serialize(plan),"Frozen event source replay exact");
            var archives=new ScheduleArchiveService(host,schedule);var archived=await archives.SaveAsync("demo",new("Таймер",request,plan),false);
            Check((await archives.ReplayAsync("demo",archived.Id,false)).Status=="Reproduced","Server archive supports wait event algorithm");
            await ScheduleScenarioChecks.Write(root,P(new("message","Отдел","Почта","Ответ")));
            Check(!(await schedule.CalculateAsync(request,false)).Complete,"Message without arrival estimate remains preliminary, never silently zero-complete");
            // Real loader reads native double-ring events while preserving messageRef.
            await ScheduleScenarioChecks.Write(root,P(new("timer",DurationMinutes:60)));
            var path=Path.Combine(root,"Data","waits.bpmn");var doc=XDocument.Load(path);
            var element=doc.Descendants().Single(e=>(string?)e.Attribute("id")=="wait");element.Name=b+"intermediateCatchEvent";element.Add(native.Elements());
            await File.WriteAllTextAsync(path,doc.ToString());
            var loaded=await new BpmnProcessLoader(host).LoadAsync("waits");
            Check(loaded.Nodes.Single(n=>n.Id=="wait") is {Type:"task",BpmnType:"intermediateCatchEvent",WaitEvent.DurationMinutes:60},"Native catch event is loadable and remains an execution barrier");
        }finally{
            var temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            if(!Path.GetFullPath(root).StartsWith(temp,StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(root).StartsWith("pn-waits-"))throw new Exception("Unsafe cleanup");
            Directory.Delete(root,true);
        }
        return count;
    }
    sealed class Clock:TimeProvider{public DateTimeOffset At;public override DateTimeOffset GetUtcNow()=>At;}
    sealed class Host(string root):IWebHostEnvironment{
        public string ApplicationName{get;set;}="WaitChecks";public string EnvironmentName{get;set;}="Development";public string ContentRootPath{get;set;}=root;
        public string WebRootPath{get;set;}=root;public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
