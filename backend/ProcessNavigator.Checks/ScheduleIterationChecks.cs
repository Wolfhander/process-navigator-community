using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class ScheduleIterationChecks
{
    static NodeModel N(string id,string type="task",string duration="1 час")=>new(id,type,id,"lane",100,40,100,80,null,null,duration,[],[],InformationObjects:[]);
    static EdgeModel E(string id,string from,string to)=>new(id,from,to,id,[new(100,40),new(200,40)]);
    static ProcessModel P(NodeModel[] nodes,EdgeModel[] edges)=>new("loops","Учебные повторы","1","Отдел","Published",[new("lane","Отдел",0,200)],nodes,edges);
    internal static ProcessModel Nested()=>P([N("s","startEvent"),N("pre"),N("a",duration:"2 часа"),N("b"),N("ig","exclusiveGateway"),
        N("c",duration:"3 часа"),N("g","exclusiveGateway"),N("post"),N("end","endEvent")],
        [E("sp","s","pre"),E("pa","pre","a"),E("ab","a","b"),E("bi","b","ig"),E("inner","ig","b"),E("ic","ig","c"),
         E("cg","c","g"),E("outer","g","a"),E("gp","g","post"),E("pe","post","end")]);
    public static Task<int> RunAsync()
    {
        var count=0;
        void Check(bool value,string text){if(!value)throw new Exception(text);count++;}
        void Reject(Action work){var bad=false;try{work();}catch(InvalidDataException){bad=true;}Check(bad,"Unsupported iteration structure must reject");}
        var model=Nested();ScheduleIterationPlanModel[] plans=[new("outer",1,2),new("inner",2,3)];
        var expanded=ScheduleIterationExpansion.Build(model,plans,null);
        Check(expanded.Nodes.Values.Count(n=>n.OriginalId=="a")==2&&expanded.Nodes.Values.Count(n=>n.OriginalId=="b")==6,"Nested pass multiplication, not whole-process multiplication");
        Check(expanded.Nodes.Values.Single(n=>n.OriginalId=="pre").Path.Count==0,"Prelude outside all loops remains once");
        Check(expanded.Nodes.Values.Where(n=>n.OriginalId=="b").All(n=>n.Path.Count==2),"Nested coordinates retain both return regions");
        var separate=P([N("s","startEvent"),N("a"),N("g","exclusiveGateway"),N("b"),N("h","exclusiveGateway"),N("end","endEvent")],
            [E("sa","s","a"),E("ag","a","g"),E("ga","g","a"),E("gb","g","b"),E("bh","b","h"),E("hb","h","b"),E("he","h","end")]);
        var disjoint=ScheduleIterationExpansion.Build(separate,[new("ga",1,1),new("hb",2,2)],null);
        Check(disjoint.Nodes.Values.Count(n=>n.OriginalId=="a")==2&&disjoint.Nodes.Values.Count(n=>n.OriginalId=="b")==3,"Disjoint regions do not multiply each other");
        Reject(()=>ScheduleIterationExpansion.Build(model,[plans[0]],null));
        Reject(()=>ScheduleIterationExpansion.Build(model,[plans[0],plans[0]],null));
        Reject(()=>ScheduleIterationExpansion.Build(model,[plans[0] with{PlannedRepeats=51},plans[1]],null));
        Reject(()=>ScheduleIterationExpansion.Build(model,plans,new Dictionary<string,string>{{"g","gp"}}));
        Reject(()=>ScheduleIterationExpansion.Build(model with{Edges=[..model.Edges,E("escape","b","post")]},plans,null));
        Reject(()=>ScheduleIterationExpansion.Build(model with{Nodes=model.Nodes.Select(n=>n.Id=="b"?n with{Type="parallelGateway"}:n).ToArray()},plans,null));
        Reject(()=>ScheduleIterationExpansion.Build(model with{Nodes=[..model.Nodes,N("extra")],
            Edges=[..model.Edges,E("implicit-fork","b","extra"),E("extra-join","extra","ig")]},plans,null));
        // Large nested product is rejected before publishing an oversized result.
        var triple=model with{Nodes=[..model.Nodes,N("x"),N("h","exclusiveGateway")],
            Edges=[..model.Edges.Where(e=>e.Id!="bi"),E("bx","b","x"),E("xh","x","h"),E("third","h","x"),E("hi","h","ig")]};
        Reject(()=>ScheduleIterationExpansion.Build(triple,[new("outer",50,50),new("inner",50,50),new("third",50,50)],null));
        return Task.FromResult(count);
    }
    public static async Task<int> IntegrationAsync()
    {
        var count=0;
        void Check(bool value,string text){if(!value)throw new Exception(text);count++;}
        var root=Path.Combine(Path.GetTempPath(),"pn-iteration-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"Data"));
        try{
            var host=new Host(root);var catalog=new ProcessCatalogService(new BpmnProcessLoader(host));
            var service=new ProcessScheduleService(catalog,new InformationObjectRegistryService(catalog,host));
            await ScheduleScenarioChecks.Write(root,Nested());
            var request=new ProcessScheduleRequestModel("loops","Forward",DateTimeOffset.Parse("2026-11-09T09:00Z"),UtcOffsetMinutes:0,
                IterationPlans:new Dictionary<string,IReadOnlyList<ScheduleIterationPlanModel>>{{"loops",[new("outer",1,2),new("inner",2,3)]}});
            var result=await service.CalculateAsync(request,false);
            Check(result.DurationHours==18&&result.Processes.Single().MaximumDurationHours==29,"Plan and maximum include only actual nested bodies");
            Check(result.Processes.Single().BaseDurationHours==8,"Base is initial traversal, not repeated plan");
            Check(result.EndAt==DateTimeOffset.Parse("2026-11-11T11:00Z"),"Calendar dates follow expanded task sequence");
            Check(result.IterationDetail!.PlannedSteps.Count(p=>p.ElementId=="b")==6&&result.IterationDetail.MaximumSteps.Count(p=>p.ElementId=="b")==12,"Plan and upper pass dates retained separately");
            Check(result.Complete&&result.Sources!.Algorithm==ProcessScheduleService.IterationAlgorithm,"Supported nested plan is complete and versioned");
            var preview=await service.LoadScenarioSourcesAsync("loops","Forward",false);
            Check(preview.Processes.Single().Nodes.Count==Nested().Nodes.Count,"Source preview reads original cycles without calculating dates");
            var custom=await service.CalculateAsync(request with{StepCalendars=new Dictionary<string,IReadOnlyDictionary<string,ScheduleCalendarModel>>{
                {"loops",new Dictionary<string,ScheduleCalendarModel>{{"b",new("17:00","18:00",[1,2,3,4,5],[],0)}}}}},false);
            Check(custom.IterationDetail!.PlannedSteps.Where(p=>p.ElementId=="b").All(p=>p.StartAt.Hour==17&&p.EndAt.Hour==18&&p.CalendarSource.StartsWith("Шаг: b")),"Original task calendar applies independently to every cloned pass");
            var reverse=await service.CalculateAsync(request with{Direction="Backward",AnchorDate=result.EndAt},false);
            Check(reverse.StartAt==request.AnchorDate,"Backward reverses the same finite task graph");
            Check(reverse.MaximumStartAt<reverse.StartAt,"Upper repeat bound starts earlier in reverse calculation");
            Check(JsonSerializer.Serialize(result)==JsonSerializer.Serialize(await service.ReplayAsync(request,result.Sources!)),"Replay uses frozen original models, not generated IDs");
            var archives=new ScheduleArchiveService(host,service);
            var archived=await archives.SaveAsync("demo",new("Вложенные проходы",request,result),false);
            Check((await archives.ReplayAsync("demo",archived.Id,false)).Status=="Reproduced","Server archive keeps all iteration options");
            var dead=Nested() with{Nodes=[..Nested().Nodes,N("decision","exclusiveGateway"),N("dead")],
                Edges=[..Nested().Edges.Where(e=>e.Id!="gp"),E("gd","g","decision"),E("ok","decision","post"),E("no-end","decision","dead")]};
            await ScheduleScenarioChecks.Write(root,dead);
            var noEnd=await service.CalculateAsync(request with{ProcessBranches=new Dictionary<string,IReadOnlyDictionary<string,string>>{{"loops",new Dictionary<string,string>{{"decision","no-end"}}}}},false);
            Check(!noEnd.Complete&&noEnd.Issues.Any(i=>i.Code=="scenario-no-end"),"Excluded original end remains uncertain after unfolding");
            await ScheduleScenarioChecks.Write(root,Nested());
            var distributed=request with{IterationPlans=new Dictionary<string,IReadOnlyList<ScheduleIterationPlanModel>>{{"loops",
                [new("outer",1,2,[new(0,.25),new(1,.75)]),new("inner",2,3)]}}};
            var range=await service.CalculateAsync(distributed,false);
            Check(range.AlternativeEnvelope!.Cases.Count==2&&range.AlternativeEnvelope.ExpectedNominalHours==16,"Finite repeat distribution gives weighted nominal duration separately from planned count");
            Check(range.AlternativeEnvelope.Cases.All(c=>c.IterationCounts is not null),"Each leaf records exact repetition choices");
            foreach(var weights in new ScheduleRepeatWeightModel[][]{[new(0,.2),new(1,.2)],[new(0,.5),new(0,.5)],[new(3,1)],[new(0,double.NaN)]}){
                var invalid=distributed with{IterationPlans=new Dictionary<string,IReadOnlyList<ScheduleIterationPlanModel>>{{"loops",[new("outer",1,2,weights),new("inner",2,3)]}}};
                var rejected=false;try{await service.CalculateAsync(invalid,false);}catch(InvalidDataException){rejected=true;}Check(rejected,"Invalid repeat distribution rejects");
            }
            // Cross-process documentary pass matching uses a whole-producer completion barrier.
            var producer=Nested() with{Nodes=Nested().Nodes.Select(n=>n.Id=="b"?n with{InformationObjects=[new("shared","Учебный комплект","Output")]}:n).ToArray()};
            var receiver=P([N("s","startEvent"),N("use") with{InformationObjects=[new("shared","Учебный комплект","Input")]},N("gate","exclusiveGateway"),N("end","endEvent")],
                [E("su","s","use"),E("ug","use","gate"),E("back","gate","use"),E("out","gate","end")]) with{Id="receiver"};
            await ScheduleScenarioChecks.Write(root,producer);await ScheduleScenarioChecks.Write(root,receiver with{Nodes=[N("use") with{InformationObjects=[new("shared","Учебный комплект","Input")]}],Edges=[]});
            var batch=await service.CalculateAsync(request with{IterationTransfers=new Dictionary<string,string>{{"shared","Batch"}}},false);
            Check(batch.Processes.Count==2&&batch.Complete&&batch.IterationDetail!.Transfers.Count==1,"Batch consumes the full repeated output without false multiple-producer warning");
            Check(batch.IterationDetail.Transfers.Single().SourceReadyAt<=batch.IterationDetail.Transfers.Single().RequiredAt,"Batch source ready no later than consumer need");
            var prunedRequest=request with{Facts=new Dictionary<string,bool>{{"need",false}},
                ObjectRules=[new("receiver","use","shared","Input","need",true)],
                ProcessCalendars=new Dictionary<string,ScheduleCalendarModel>{{"receiver",new("12:00","16:00",[1,2,3,4,5],[],0)}},
                IterationTransfers=new Dictionary<string,string>{{"shared","Batch"}}};
            var pruned=await service.CalculateAsync(prunedRequest,false);
            Check(pruned.Processes.Count==1&&pruned.Processes[0].ProcessId=="loops","Excluded consumer calendars do not break pruned scenario");
            Check(pruned.Assumptions.ProcessCalendars!.ContainsKey("receiver"),"Inactive configured calendars remain in original scenario assumptions");
            var prunedArchive=await archives.SaveAsync("demo",new("Исключённый получатель",prunedRequest,pruned),false);
            Check((await archives.ReplayAsync("demo",prunedArchive.Id,false)).Status=="Reproduced","Archive replay preserves inactive original options");
            await ScheduleScenarioChecks.Write(root,receiver);
            var perPass=request with{IterationPlans=new Dictionary<string,IReadOnlyList<ScheduleIterationPlanModel>>{
                {"loops",[new("outer",1,1),new("inner",2,2)]},{"receiver",[new("back",5,5)]}},
                IterationTransfers=new Dictionary<string,string>{{"shared","PerPass"}}};
            var matched=await service.CalculateAsync(perPass,false);
            Check(matched.Complete&&matched.IterationDetail!.Transfers.Count==6,"PerPass pairs six producer and consumer occurrences");
            Check(matched.IterationDetail.Transfers.All(t=>t.SourceOccurrence==t.TargetOccurrence),"Explicit ordinal pass pairing");
            Check(matched.Dependencies.Single().ObjectId=="shared"&&matched.Sources!.Processes.All(p=>p.Nodes.All(n=>!n.Id.StartsWith("_iteration_"))),"Generated identities never replace original snapshot or navigation");
            var failed=false;try{await service.CalculateAsync(perPass with{IterationTransfers=null},false);}catch(InvalidDataException){failed=true;}Check(failed,"Repeated cross-process transfer requires explicit mode");
            failed=false;try{await service.CalculateAsync(request with{IterationTransfers=new Dictionary<string,string>{{"shared","PerPass"}}},false);}catch(InvalidDataException){failed=true;}Check(failed,"PerPass mismatched counts reject");
        }finally{
            var temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            if(!Path.GetFullPath(root).StartsWith(temp,StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(root).StartsWith("pn-iteration-"))throw new Exception("Unsafe cleanup");
            Directory.Delete(root,true);
        }
        return count;
    }
    sealed class Host(string root):IWebHostEnvironment{
        public string ApplicationName{get;set;}="IterationChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public string WebRootPath{get;set;}=root;
        public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
    }
}
