using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;
internal static class ExecutionOutcomeChecks
{
    public static async Task<int> RunAsync(){
        var count=0;void Check(bool value,string label){if(!value)throw new Exception("Outcome: "+label);count++;}
        var root=Path.Combine(Path.GetTempPath(),"pn-outcomes-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        try{
            var clock=new Clock();var service=new ProcessExecutionService(new Env(root),clock);
            NodeModel N(string id,string type="task")=>new(id,type,id,"lane",0,0,100,80,null,null,"1 час",[],[]);
            var model=new ProcessModel("outcomes","Учебное параллельное выполнение","1","Demo","Published",[],
                [N("start","startEvent"),N("a") with{InformationObjects=[new("proof","Результат","Output")]},N("split","parallelGateway"),N("b"),N("c"),N("join","parallelGateway"),N("d"),N("end","endEvent")],
                [new("s-a","start","a",null,[]),new("a-g","a","split",null,[]),new("g-b","split","b",null,[]),new("g-c","split","c",null,[]),new("b-j","b","join",null,[]),new("c-j","c","join",null,[]),new("j-d","join","d",null,[]),new("d-z","d","end",null,[])]);
            async Task Reject(Func<Task> action,string label){try{await action();throw new Exception("Accepted: "+label);}catch(InvalidDataException){Check(true,label);}}
            foreach(var (action,kind) in new[]{("refuse","Refusal"),("fail","Error"),("cancel","Cancellation")}){
                var item=await service.StartAsync(model,"actor",action,default);
                item=await service.UpdateStepAsync(model,item.Id,"a","InProgress","actor",default);
                item=await service.SaveStepResultAsync(model,item.Id,"a","Учебный результат",["proof"],"actor",default);
                item=await service.AddStepAttachmentAsync(model,item.Id,"a",new("artifact","Учебный файл","document","1","repository:artifact"),"result.txt",12,"actor",default);
                item=await service.UpdateStepAsync(model,item.Id,"a","Completed","actor",default);
                item=await service.UpdateStepAsync(model,item.Id,"b","InProgress","actor",default);
                item=await service.UpdateStepAsync(model,item.Id,"c","InProgress","actor",default);
                var before=JsonSerializer.Serialize(item.Steps);clock.Now=clock.Now.AddHours(2);
                if(action=="refuse")await service.ChangeLifecycleAsync(model.Id,item.Id,"pause","Учебная пауза","actor",default);
                await Reject(()=>service.ChangeLifecycleAsync(model.Id,item.Id,action," ","actor",default),"Reason is required");
                var ended=await service.ChangeLifecycleAsync(model.Id,item.Id,action,"Учебное основание закрытия","actor",default);
                Check(ended.Status=="Cancelled"&&ended.CompletedAt is null&&ended.Outcome?.Kind==kind,"Explicit non-success outcome");
                Check(ended.Outcome!.UnfinishedElementIds.ToHashSet().SetEquals(["b","c","d"]),"Both branches and future step are stopped");
                Check(JsonSerializer.Serialize(ended.Steps)==before,"All results, attachments and step histories retained");
                Check(ended.Outcome.RecordedBy=="actor"&&ended.Outcome.RecordedAt==clock.Now,"Actor and closure timestamp stored");
                await Reject(()=>service.UpdateStepAsync(model,ended.Id,"b","Completed","actor",default),"No completion after closure");
                await Reject(()=>service.ChangeLifecycleAsync(model.Id,ended.Id,"resume",null,"actor",default),"No reopening after closure");
                var reread=(await new ProcessExecutionService(new Env(root),clock).ListAsync(model.Id,default)).Single(i=>i.Id==ended.Id);
                Check(reread.Outcome==ended.Outcome||JsonSerializer.Serialize(reread.Outcome)==JsonSerializer.Serialize(ended.Outcome),"Outcome survives restart");
                var timeline=await service.TimelineAsync(model,ended.Id,[],default);
                Check(!timeline.Events.Any(e=>e.Type=="InstanceCompleted"),"Refusal/error/cancellation is not successful completion");
            }
            var success=await service.StartAsync(model,"actor","success",default);
            foreach(var id in new[]{"a","b","c","d"}){
                await service.UpdateStepAsync(model,success.Id,id,"InProgress","actor",default);
                if(id=="a")await service.SaveStepResultAsync(model,success.Id,id,"Готово",["proof"],"actor",default);
                success=await service.UpdateStepAsync(model,success.Id,id,"Completed","actor",default);
            }
            Check(success.Status=="Completed"&&success.Outcome?.Kind=="Success"&&success.Outcome.UnfinishedElementIds.Count==0,"Success requires completed applicable steps");
            var concurrent=await service.StartAsync(model,"actor","concurrent",default);
            var results=await Task.WhenAll(new[]{"fail","refuse"}.Select(async action=>{try{await service.ChangeLifecycleAsync(model.Id,concurrent.Id,action,"Параллельное закрытие","actor",default);return true;}catch(InvalidDataException){return false;}}));
            Check(results.Count(v=>v)==1,"Only one terminal mutation commits");
            Check((await service.ListAsync(model.Id,default)).Single(i=>i.Id==concurrent.Id).LifecycleEvents!.Count==1,"No lost/duplicated closure event");
            foreach(var definition in new[]{"errorEventDefinition","cancelEventDefinition","terminateEventDefinition","unknownEventDefinition"}){
                var special=model with{Nodes=model.Nodes.Select(n=>n.Id=="end"?n with{EndEventDefinitions=definition}:n).ToArray()};
                await Reject(()=>service.StartAsync(special,"actor","special",default),"Special BPMN ending does not become success");
            }
            ExecutionOutcome.Validate(success with{Outcome=null});Check(true,"Old instances remain readable without inventing an outcome");
            var repo=new DirectoryInfo(AppContext.BaseDirectory);
            while(repo is not null&&!File.Exists(Path.Combine(repo.FullName,"master-data","core-flow-fixture.json")))repo=repo.Parent;
            var xml=await File.ReadAllTextAsync(Path.Combine(repo?.FullName??throw new Exception("Repository missing"),"backend","ProcessNavigator.Api","Data","demo-showcase-l4-drawing.bpmn"));
            var source=Path.Combine(root,"special.bpmn");var context=Path.Combine(root,"special.context.json");
            await File.WriteAllTextAsync(source,xml.Replace("</bpmn:endEvent>","<bpmn:errorEventDefinition id=\"error_end\"/></bpmn:endEvent>"));
            await File.WriteAllTextAsync(context,"{\"version\":\"1\",\"owner\":\"Demo\",\"status\":\"Published\",\"elements\":{}}");
            var parsed=await new BpmnProcessLoader(new Env(root)).LoadFilesAsync(source,context);
            Check(parsed.Nodes.Single(n=>n.Type=="endEvent").EndEventDefinitions=="errorEventDefinition","XML event definition retained independently of name/icon");
            await Reject(()=>{ExecutionOutcome.Validate(success with{Outcome=success.Outcome! with{Kind="Error"}});return Task.CompletedTask;},"Contradictory stored outcome rejected");
        }finally{
            var full=Path.GetFullPath(root);var allowed=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            if(!full.StartsWith(allowed,StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(full).StartsWith("pn-outcomes-"))throw new Exception("Unsafe test cleanup");
            Directory.Delete(full,true);
        }
        return count;
    }
    private sealed class Clock:TimeProvider{public DateTimeOffset Now=DateTimeOffset.Parse("2026-11-05T06:00:00Z");public override DateTimeOffset GetUtcNow()=>Now;}
    private sealed class Env(string root):IWebHostEnvironment{
        public string ApplicationName{get;set;}="OutcomeChecks";public string EnvironmentName{get;set;}="Development";public string ContentRootPath{get;set;}=root;public string WebRootPath{get;set;}=root;
        public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
