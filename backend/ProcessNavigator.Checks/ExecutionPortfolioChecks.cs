using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using System.Text.Json;
using System.Text.Json.Nodes;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;
public static class ExecutionPortfolioChecks
{
    public static async Task<int> RunAsync()
    {
        var temp=Path.TrimEndingDirectorySeparator(Path.GetTempPath());var root=Path.Combine(temp,"pn-execution-observation-"+Guid.NewGuid().ToString("N"));var data=Path.Combine(root,"Data");Directory.CreateDirectory(data);int count=0;
        void Check(bool condition,string name){if(!condition)throw new Exception(name);count++;}
        try
        {
            const string id="execution-fixture";var env=new Env(root);var loader=new BpmnProcessLoader(env);var catalog=new ProcessCatalogService(loader);var locks=new ProcessEditLockService();var orgs=new OrganizationMapService(env,catalog,locks);
            File.Copy(Path.Combine(Directory.GetCurrentDirectory(),"backend/ProcessNavigator.Api/Data/organization.json"),Path.Combine(data,"organization.json"));
            await catalog.CreateAsync(new(id,"Учебное исполнение"));var draft=catalog.GetBpmnSourcePath(id,true);File.Copy(draft,Path.Combine(data,id+".bpmn"));
            var ctx=JsonNode.Parse(await File.ReadAllTextAsync(Path.ChangeExtension(draft,".context.json")))!;ctx["status"]="Published";ctx["version"]="1.0";await File.WriteAllTextAsync(Path.Combine(data,id+".context.json"),ctx.ToJsonString());
            var model=await catalog.LoadAsync(id,false);var node=model.Nodes.Single(n=>n.Type=="task");var org=await orgs.LoadAsync();var entity=org.LegalEntities.First();var unit=entity.Units!.First();
            var updated=org with{CrossCompanyProcesses=org.CrossCompanyProcesses.Append(new(id,[entity.Id],[new(node.LaneId,entity.Id,unit.Name,unit.Id)],"fixture")).ToArray()};
            await File.WriteAllTextAsync(Path.Combine(data,"organization.json"),JsonSerializer.Serialize(updated,new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            var start=DateTimeOffset.UtcNow.Date.AddDays(-5);var time=new DateTimeOffset(start,TimeSpan.Zero);
            var old=new StepExecutionIterationModel(1,"Completed",time.AddMinutes(20),time.AddMinutes(60),"fixture",null,null,time.AddMinutes(65),"fixture","Повтор",AvailableAt:time,ActualQueueMinutes:20,ActualWorkMinutes:40,ActualDurationMinutes:60,OverdueMinutes:0);
            var step=new StepExecutionModel(node.Id,"Completed",time.AddMinutes(75),time.AddMinutes(105),"fixture",Iteration:2,History:[old],AvailableAt:time.AddMinutes(65),ActualQueueMinutes:10,ActualWorkMinutes:30,ActualDurationMinutes:40,OverdueMinutes:5);
            var completed=new ProcessInstanceModel("complete",id,"1.0","Завершён","Completed",time,time.AddMinutes(120),"fixture",[step],ReturnEvents:[new(node.Id,node.Name,node.Id,node.Name,"Повтор",2,time.AddMinutes(65),"fixture",[node.Id])]);
            var paused=completed with{Id="paused",Status="Paused",CompletedAt=null,Steps=[step with{Status="InProgress",History=null,Iteration=1,CompletedAt=null}],ReturnEvents=[]};
            var cancelled=completed with{Id="cancelled",Status="Cancelled",CompletedAt=time.AddMinutes(80),Steps=[],ReturnEvents=[]};
            var legacy=completed with{Id="legacy",ProcessVersion="0.9",Steps=[step with{History=null,Iteration=1,ActualQueueMinutes=null,ActualWorkMinutes=null,ActualDurationMinutes=null,OverdueMinutes=null}],ReturnEvents=[]};
            var dir=Path.Combine(data,"Executions");Directory.CreateDirectory(dir);var path=Path.Combine(dir,id+".json");
            async Task Save(params ProcessInstanceModel[] records)=>await File.WriteAllTextAsync(path,JsonSerializer.Serialize(records,new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            var service=new ExecutionPortfolioService(env,catalog,orgs);
            Check((await service.BuildAsync()).Instances.Count==0,"Empty facts are an explicit empty report");
            await Save(completed,paused,cancelled,legacy);var bytes=await File.ReadAllBytesAsync(path);var report=await service.BuildAsync();
            Check(report.Complete&&report.Instances.Count==4,"All valid instances retained");
            Check(report.Instances.Single(i=>i.InstanceId=="complete").CycleMinutes==120,"Cycle includes whole calendar interval");
            Check(report.Instances.Single(i=>i.InstanceId=="cancelled").CycleMinutes is null&&report.Instances.Single(i=>i.InstanceId=="paused").CycleMinutes is null,"Cancelled/paused are not completed cycles");
            Check(report.Instances.Single(i=>i.InstanceId=="complete").ReturnEvents==1,"Returns counted as events, not archived steps");
            var facts=report.Attempts.Where(a=>a.InstanceId=="complete").ToArray();
            Check(facts.Length==2&&facts.Sum(a=>a.WorkMinutes)==70&&facts.Sum(a=>a.QueueMinutes)==30,"Every completed iteration contributes once");
            Check(facts.Single(a=>a.Current).OverdueMinutes==5&&facts.Single(a=>!a.Current).OverdueMinutes==0,"Known zero is not missing");
            Check(facts.All(a=>a.EntityId==entity.Id&&a.UnitId==unit.Id&&a.OrganizationBasis.Contains("не историческая")),"Current org projection explicitly labelled");
            Check(report.Attempts.Single(a=>a.InstanceId=="legacy").UnitId is null&&report.Attempts.Single(a=>a.InstanceId=="legacy").WorkMinutes is null,"Other version not attributed or filled with zero");
            Check(report.Attempts.Single(a=>a.InstanceId=="paused").WorkMinutes is null,"Unfinished stored values not presented as completed work");
            Check((await File.ReadAllBytesAsync(path)).SequenceEqual(bytes),"Read-only report");
            Check((await service.BuildAsync()).Fingerprint==report.Fingerprint,"Stable fingerprint with unchanged sources");
            await Save(completed with{StartedAt=completed.StartedAt.ToOffset(TimeSpan.FromHours(3)),CompletedAt=completed.CompletedAt?.ToOffset(TimeSpan.FromHours(3))});
            var utc=(await service.BuildAsync()).Instances.Single();Check(utc.StartedAt.Offset==TimeSpan.Zero&&utc.CompletedAt?.Offset==TimeSpan.Zero&&utc.CycleMinutes==120,"Output uses UTC dates even for sources with offsets");
            await Save(completed,completed);Check(!(await service.BuildAsync()).Complete&&(await service.BuildAsync()).Instances.Count==0,"Duplicate IDs exclude ambiguous file");
            await Save(completed with{StartedAt=DateTimeOffset.UtcNow.AddDays(1)});Check((await service.BuildAsync()).Instances.Count==0,"Future/invalid start excluded");
            await Save(completed with{CompletedAt=time.AddMinutes(-1)});Check((await service.BuildAsync()).Instances.Single().CycleMinutes is null,"Invalid completion stays unknown");
            await Save(completed with{Steps=[step with{ActualWorkMinutes=-1}]});Check((await service.BuildAsync()).Attempts.Single(a=>a.Current).WorkMinutes is null,"Negative facts excluded");
            await Save(completed with{Steps=[step with{History=[old with{Iteration=2}]}]});Check((await service.BuildAsync()).Attempts.Count==0,"Duplicate iterations not counted twice");
            await Save(completed);await File.WriteAllTextAsync(Path.Combine(dir,"orphan.json"),"broken");
            var partial=await service.BuildAsync();Check(!partial.Complete&&partial.IssueCount>0&&partial.Instances.Count==1,"Corrupt source cannot hide healthy facts or masquerade as full report");
            return count;
        }
        finally{if(Path.GetDirectoryName(root)!=temp||!Path.GetFileName(root).StartsWith("pn-execution-observation-"))throw new Exception("Unsafe fixture cleanup");Directory.Delete(root,true);}
    }
    private sealed class Env(string root):IWebHostEnvironment{
        public string ApplicationName{get;set;}="ExecutionPortfolioChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
        public string WebRootPath{get;set;}=root;public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
