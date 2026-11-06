using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class ScheduleConditionChecks
{
    static NodeModel N(string id,string type="task",string duration="2 часа")=>new(id,type,id,"lane",100,40,100,80,null,null,duration,[],[],InformationObjects:[]);
    static EdgeModel E(string id,string from,string to)=>new(id,from,to,id,[new(100,40),new(200,40)]);
    static ProcessModel P(NodeModel[] nodes,EdgeModel[] edges)=>new("prob","Учебные альтернативы","1","Отдел","Published",[new("lane","Отдел",0,200)],nodes,edges);
    public static async Task<int> RunAsync()
    {
        var count=0;
        void Check(bool value,string message){if(!value)throw new Exception(message);count++;}
        async Task Reject(ProcessScheduleService service,ProcessScheduleRequestModel request){
            var bad=false;try{await service.CalculateAsync(request,false);}catch(InvalidDataException){bad=true;}
            Check(bad,"Invalid formal scenario must reject");
        }
        var root=Path.Combine(Path.GetTempPath(),"pn-condition-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root,"Data"));
        try{
            var host=new Host(root);
            var catalog=new ProcessCatalogService(new BpmnProcessLoader(host));
            var service=new ProcessScheduleService(catalog,new InformationObjectRegistryService(catalog,host));
            var model=P([N("s","startEvent"),N("g","exclusiveGateway"),N("fast"),N("slow",duration:"6 часов"),N("j","exclusiveGateway"),N("end","endEvent")],
                [E("sg","s","g"),E("a","g","fast"),E("b","g","slow"),E("fj","fast","j"),E("sj","slow","j"),E("je","j","end")]);
            await ScheduleScenarioChecks.Write(root,model);
            ScheduleBranchProbabilityModel profile=new("prob","g",[new("a",.25),new("b",.75)]);
            var request=new ProcessScheduleRequestModel("prob","Forward",DateTimeOffset.Parse("2026-11-09T09:00Z"),UtcOffsetMinutes:0,BranchProbabilities:[profile]);
            var result=await service.CalculateAsync(request,false);var range=result.AlternativeEnvelope!;
            Check(range.Cases.Count==2&&range.Complete&&Math.Abs(range.ProbabilityMass-1)<1e-12,"Exact complete probability mass");
            Check(range.ExpectedNominalHours==5&&range.EarliestEnd==request.AnchorDate.AddHours(2)&&range.LatestEnd==request.AnchorDate.AddHours(6),"Weighted nominal duration and exact forward dates");
            Check(!result.Complete&&result.Issues.Any(i=>i.Code=="branch-unresolved"),"Base unresolved plan stays preliminary");
            var backward=await service.CalculateAsync(request with{Direction="Backward",AnchorDate=request.AnchorDate.AddHours(6)},false);
            Check(backward.AlternativeEnvelope!.EarliestStart==request.AnchorDate&&backward.AlternativeEnvelope.LatestStart==request.AnchorDate.AddHours(4),"Backward alternative bounds");
            Check(JsonSerializer.Serialize(await service.ReplayAsync(request,result.Sources!))==JsonSerializer.Serialize(result),"Frozen scenario replay exact");
            var archive=new ScheduleArchiveService(host,service);
            var saved=await archive.SaveAsync("demo",new("Альтернативы",request,result),false);
            Check((await archive.ReplayAsync("demo",saved.Id,false)).Status=="Reproduced","Server archive preserves v5 request and envelope");
            var zero=await service.CalculateAsync(request with{BranchProbabilities=[profile with{Weights=[new("a",0),new("b",1)]}]},false);
            Check(zero.AlternativeEnvelope!.Cases.Count==1&&zero.AlternativeEnvelope.ExpectedNominalHours==6,"Zero probability excluded without renormalizing");
            foreach(var weights in new ScheduleProbabilityWeightModel[][]{
                [new("a",.2),new("b",.2)],[new("a",.5)],[new("a",.5),new("a",.5)],
                [new("a",double.NaN),new("b",1)],[new("a",.0000001),new("b",.9999999)],[new("a",-.5),new("b",1.5)]})
                await Reject(service,request with{BranchProbabilities=[profile with{Weights=weights}]});
            await Reject(service,request with{BranchProbabilities=[profile,profile]});
            await Reject(service,request with{BranchProbabilities=[profile with{GatewayId="fast"}]});
            await Reject(service,request with{BranchProbabilities=[profile with{ProcessId="unknown"}]});
            await Reject(service,request with{ProcessBranches=new Dictionary<string,IReadOnlyDictionary<string,string>>{{"prob",new Dictionary<string,string>{{"g","a"}}}}});
            var parallel=model with{Nodes=model.Nodes.Select(n=>n.Id is "g" or "j"?n with{Type="parallelGateway"}:n).ToArray()};
            await ScheduleScenarioChecks.Write(root,parallel);await Reject(service,request);
            var and=await service.CalculateAsync(request with{BranchProbabilities=null},false);
            Check(and.DurationHours==6&&and.Sources!.Algorithm==ProcessScheduleService.Algorithm,"AND kept and legacy algorithm unchanged");
            var nested=model with{Nodes=[..model.Nodes,N("h","exclusiveGateway"),N("x"),N("y",duration:"4 часа")],
                Edges=[..model.Edges.Where(e=>e.Id!="b"),E("b","g","h"),E("ha","h","x"),E("hb","h","y"),E("xj","x","j"),E("yj","y","j")]};
            // Remove the old unreachable task as a well-formed nested example.
            nested=nested with{Nodes=nested.Nodes.Where(n=>n.Id!="slow").ToArray(),Edges=nested.Edges.Where(e=>e.Id!="sj").ToArray()};
            await ScheduleScenarioChecks.Write(root,nested);
            var nestedResult=await service.CalculateAsync(request with{BranchProbabilities=[profile with{Weights=[new("a",.5),new("b",.5)]},new("prob","h",[new("ha",.25),new("hb",.75)])]},false);
            Check(nestedResult.AlternativeEnvelope!.Cases.Count==3&&nestedResult.AlternativeEnvelope.Cases.Select(c=>c.Probability).Order().SequenceEqual(new[]{.125,.375,.5}),"Unreachable nested XOR is not independently multiplied");
            var renamed=nested with{Nodes=nested.Nodes.Select(n=>n.Id=="h"?n with{Id="a-gate"}:n).ToArray(),Edges=nested.Edges.Select(e=>e with{SourceId=e.SourceId=="h"?"a-gate":e.SourceId,TargetId=e.TargetId=="h"?"a-gate":e.TargetId}).ToArray()};
            await ScheduleScenarioChecks.Write(root,renamed);
            var reordered=await service.CalculateAsync(request with{BranchProbabilities=[profile with{Weights=[new("a",.5),new("b",.5)]},new("prob","a-gate",[new("ha",.25),new("hb",.75)])]},false);
            Check(reordered.AlternativeEnvelope!.Cases.Count==3,"Gateway identifier order cannot sample unreachable nested branch");
            // Seven successive independent XOR gates exceed the exact 64-case budget.
            var nodes=new List<NodeModel>{N("s","startEvent"),N("end","endEvent")};var edges=new List<EdgeModel>();var profiles=new List<ScheduleBranchProbabilityModel>();
            for(var i=0;i<7;i++){
                var g="g"+i;nodes.AddRange([N(g,"exclusiveGateway"),N("a"+i),N("b"+i),N("j"+i,"exclusiveGateway")]);
                edges.AddRange([E("in"+i,i==0?"s":"j"+(i-1),g),E("ea"+i,g,"a"+i),E("eb"+i,g,"b"+i),E("aj"+i,"a"+i,"j"+i),E("bj"+i,"b"+i,"j"+i)]);
                profiles.Add(new("prob",g,[new("ea"+i,.5),new("eb"+i,.5)]));
            }
            edges.Add(E("last","j6","end"));await ScheduleScenarioChecks.Write(root,P(nodes.ToArray(),edges.ToArray()));
            await Reject(service,request with{BranchProbabilities=profiles});
            // Conditional producer/consumer occurrences, not task deletion.
            var producer=P([N("make") with{InformationObjects=[new("shared","Результат","Output")]}],[]) with{Id="producer"};
            var consumer=P([N("use") with{InformationObjects=[new("shared","Результат","Input",Condition:"Если требуется")]}],[]) with{Id="consumer"};
            File.Delete(Path.Combine(root,"Data","prob.bpmn"));File.Delete(Path.Combine(root,"Data","prob.context.json"));
            await ScheduleScenarioChecks.Write(root,producer);await ScheduleScenarioChecks.Write(root,consumer);
            var rule=new ScheduleObjectRuleModel("consumer","use","shared","Input","needs",true);
            var conditional=request with{RootProcessId="consumer",Direction="Backward",BranchProbabilities=null,Facts=new Dictionary<string,bool>{{"needs",true}},ObjectRules=[rule]};
            var yes=await service.CalculateAsync(conditional,false);
            Check(yes.Processes.Count==2&&yes.Dependencies.Count==1&&!yes.Issues.Any(i=>i.Code=="object-condition-unresolved"),"True formal rule activates exact required occurrence");
            var no=await service.CalculateAsync(conditional with{Facts=new Dictionary<string,bool>{{"needs",false}}},false);
            Check(no.Processes.Count==1&&no.Processes[0].DurationHours==2&&no.Dependencies.Count==0,"False rule excludes transfer, never task");
            Check(no.Sources!.Objects.Single().Consumers.Single().Condition=="Если требуется","Frozen source preserves original opaque text");
            var opaque=await service.CalculateAsync(conditional with{Facts=null,ObjectRules=null},false);
            Check(opaque.Issues.Any(i=>i.Code=="object-condition-unresolved"),"Unformalized text remains uncertainty");
            await Reject(service,conditional with{Facts=null});
            await Reject(service,conditional with{ObjectRules=[rule,rule]});
            await Reject(service,conditional with{ObjectRules=[rule with{ElementId="missing"}]});
            await Reject(service,conditional with{ObjectRules=[rule with{Role="Execution"}]});
            await Reject(service,conditional with{ObjectRules=[rule with{ExpectedValue=null}]});
            var factArchive=await archive.SaveAsync("demo",new("Условия",conditional,yes),false);
            Check((await archive.ReplayAsync("demo",factArchive.Id,false)).Status=="Reproduced","Boolean assumptions survive archive replay");
        }finally{
            var temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            if(!Path.GetFullPath(root).StartsWith(temp,StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(root).StartsWith("pn-condition-"))throw new Exception("Unsafe cleanup");
            Directory.Delete(root,true);
        }
        return count;
    }
    sealed class Host(string root):IWebHostEnvironment{
        public string ApplicationName{get;set;}="ConditionChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public string WebRootPath{get;set;}=root;
        public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
