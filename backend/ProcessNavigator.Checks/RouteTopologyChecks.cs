using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;
public static class RouteTopologyChecks
{
    static NodeModel N(string id,string type="task")=>new(id,type,id,"lane",0,0,100,80,null,null,null,[],[]);
    static EdgeModel E(string a,string b,string? label=null,string? id=null)=>new(id??a+"_"+b,a,b,label,[]);
    static ProcessModel M(NodeModel[] nodes,EdgeModel[] edges)=>new("topology","Учебный маршрут","1","Учебный отдел","Published",[],nodes,edges);
    public static async Task<int> RunAsync()
    {
        var count=0;void Check(bool ok,string name){if(!ok)throw new Exception(name);count++;}
        NodeModel s=N("s","startEvent"),f=N("f","parallelGateway"),a=N("a"),b=N("b"),j=N("j","parallelGateway"),z=N("z","endEvent");
        var simple=M([s,f,a,b,j,z],[E("s","f"),E("f","a"),E("f","b"),E("a","j"),E("b","j"),E("j","z")]);
        var report=RouteTopologyCheck.Analyze(simple);
        Check(report.Pairs.Single()==new ParallelRoutePair("f","j",2)&&report.Issues.Count==0,"Structured fork/join confirmed");
        Check(RouteTopologyCheck.Analyze(simple with{Edges=simple.Edges.Reverse().ToArray()}).Pairs.SequenceEqual(report.Pairs),"Storage order does not choose pairing");
        var nested=M([s,f,a,b,j,z,N("nf","parallelGateway"),N("nj","parallelGateway"),N("c"),N("d")],
            [E("s","f"),E("f","nf"),E("f","b"),E("nf","c"),E("nf","d"),E("c","nj"),E("d","nj"),E("nj","a"),E("a","j"),E("b","j"),E("j","z")]);
        Check(RouteTopologyCheck.Analyze(nested).Pairs.Count==2&&RouteTopologyCheck.Analyze(nested).Issues.Count==0,"Nested pairs are independent");
        var mixed=M([s,f,a,b,j,z,N("c"),N("d"),N("k","parallelGateway")],
            [E("s","f"),E("f","a"),E("f","b"),E("a","j"),E("b","j"),E("j","c"),E("j","d"),E("c","k"),E("d","k"),E("k","z")]);
        Check(RouteTopologyCheck.Analyze(mixed).Pairs.Count==2&&RouteTopologyCheck.Analyze(mixed).Issues.Count==0,"Combined join/fork retains both roles");
        var direct=M([s,f,j,z],[E("s","f"),E("f","j",id:"one"),E("f","j",id:"two"),E("j","z")]);
        Check(RouteTopologyCheck.Analyze(direct).Pairs.Count==1,"Distinct direct sequence flows not collapsed by target ID");
        var separate=M([s,f,a,b,z,N("end2","endEvent")],[E("s","f"),E("f","a"),E("f","b"),E("a","z"),E("b","end2")]);
        var independent=RouteTopologyCheck.Analyze(separate);Check(independent.Pairs.Count==0&&independent.Issues.All(i=>i.Severity=="Warning"),"Separate endings are unconfirmed, not declared illegal");
        var xor=N("x","exclusiveGateway");
        var bypass=M([s,f,a,b,j,z,xor],[E("s","f"),E("f","a"),E("f","b"),E("a","j"),E("b","x"),E("x","j","ждать"),E("x","z","обойти"),E("j","z")]);
        Check(RouteTopologyCheck.Analyze(bypass).Pairs.Count==0,"Path bypassing join cannot confirm synchronization");
        var alternatives=M([s,f,a,b,j,z,xor,N("c")],[E("s","f"),E("f","x"),E("f","b"),E("x","a","А"),E("x","c","Б"),E("a","j"),E("c","j"),E("b","j"),E("j","z")]);
        Check(RouteTopologyCheck.Analyze(alternatives).Pairs.Count==0&&RouteTopologyCheck.Analyze(alternatives).Issues.Any(i=>i.Code=="parallel-gateway-pair-unconfirmed"),"Alternative inputs are not mistaken for concurrent mandatory inputs");
        var extra=simple with{Nodes=simple.Nodes.Append(N("external")).ToArray(),Edges=simple.Edges.Append(E("external","j")).ToArray()};
        Check(RouteTopologyCheck.Analyze(extra).Pairs.Count==0,"External join input not silently ignored");
        var reconverge=M([s,f,a,b,j,z,xor],[E("s","f"),E("f","a"),E("f","b"),E("a","x"),E("b","x"),E("x","j"),E("s","j"),E("j","z")]);
        Check(RouteTopologyCheck.Analyze(reconverge).Pairs.Count==0,"Merged lineage is not a confirmed pair");
        var loop=M([s,a,xor,z],[E("s","a"),E("a","x"),E("x","a","доработать"),E("x","z","готово")]);
        var controlled=RouteTopologyCheck.Analyze(loop);
        Check(controlled.Cycles.Single().HasLabeledExclusiveExit&&controlled.Issues.Single().Code=="route-cycle-controlled","Labeled exclusive exit is structural evidence, not evaluated condition");
        var noLabel=RouteTopologyCheck.Analyze(loop with{Edges=loop.Edges.Select(e=>e.TargetId=="z"?e with{Label=null}:e).ToArray()});
        Check(noLabel.Issues.Any(i=>i.Code=="route-cycle-without-exit"&&i.Severity=="Error"),"Unlabelled loop exit blocks under application policy");
        var self=RouteTopologyCheck.Analyze(M([a],[E("a","a")]));
        Check(self.Cycles.Single().TotalNodes==1&&self.Issues.Any(i=>i.Severity=="Error"),"Self-loop found");
        var disconnected=RouteTopologyCheck.Analyze(M([s,z,a,b],[E("s","z"),E("a","b"),E("b","a")]));
        Check(disconnected.Cycles.Count==1,"Disconnected cycle still diagnosed");
        var ghosts=RouteTopologyCheck.Analyze(simple with{Edges=simple.Edges.Append(E("a","ghost")).ToArray()});
        Check(ghosts.Limited&&ghosts.Pairs.Count==0&&ghosts.Issues.Any(i=>i.Code=="route-topology-broken-edge"),"Broken references block positive confirmation");
        Check(RouteTopologyCheck.Analyze(simple with{Nodes=simple.Nodes.Append(a).ToArray()}).Limited,"Duplicate IDs do not throw or get guessed");
        Check(RouteTopologyCheck.Analyze(simple,workLimit:0).Limited&&RouteTopologyCheck.Analyze(simple,workLimit:0).Issues.Count(i=>i.Code=="parallel-gateway-analysis-limit")==1,"Work cap explicit without spurious unmatched joins");
        var deep=Enumerable.Range(0,10000).Select(i=>N("n"+i)).ToArray();var edges=Enumerable.Range(0,9999).Select(i=>E("n"+i,"n"+(i+1))).Append(E("n9999","n0")).ToArray();
        var big=RouteTopologyCheck.Analyze(M(deep,edges));
        Check(big.Cycles.Single().TotalNodes==10000&&big.Cycles.Single().NodeIds.Count==50,"Deep SCC is iterative and preview truncation explicit");
        Check(RouteTopologyCheck.Analyze(M(deep.Append(N("too-many")).ToArray(),[])).Limited,"Node cap explicit");
        Check(!controlled.Issues.Single().Message.Contains(" → "),"SCC members are not falsely presented as ordered path");
        using var cancel=new CancellationTokenSource();cancel.Cancel();try{RouteTopologyCheck.Analyze(simple,cancel.Token);throw new Exception("Cancellation ignored");}catch(OperationCanceledException){count++;}
        var env=new Env(Directory.GetCurrentDirectory());var loader=new BpmnProcessLoader(env);var catalog=new ProcessCatalogService(loader);
        var validator=new ProcessValidationService(catalog,new OrganizationMapService(env,catalog,new ProcessEditLockService()));
        var organization=new OrganizationMapModel("org","Учебная группа","",[],[]);
        var merged=M([s,xor,a,b,N("merge","exclusiveGateway"),z],[E("s","x"),E("x","a","А"),E("x","b","Б"),E("a","merge"),E("b","merge"),E("merge","z")]);
        var validated=await validator.ValidateModelAsync(merged,organization,[]);
        Check(!validated.Issues.Any(i=>i.ElementId=="merge"&&(i.Code=="gateway-branches"||i.Code=="gateway-label")),"Converging XOR does not require two exits or an alternative label");
        var split=await validator.ValidateModelAsync(merged with{Edges=merged.Edges.Select(e=>e.SourceId=="x"?e with{Label=null}:e).ToArray()},organization,[]);
        Check(split.Issues.Count(i=>i.Code=="gateway-label"&&i.ElementId=="x")==2,"Actual XOR split still requires labels");
        Check((await validator.ValidateModelAsync(simple,organization,[])).Topology?.Pairs.Count==1,"Real validation response carries structural evidence");
        var directory=new DirectoryInfo(AppContext.BaseDirectory);
        while(directory!=null&&!File.Exists(Path.Combine(directory.FullName,"master-data","route-topology-fixture.json")))directory=directory.Parent;
        if(directory==null)throw new Exception("Master route fixture not found");
        using var fixture=System.Text.Json.JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory.FullName,"master-data","route-topology-fixture.json")));
        foreach(var item in fixture.RootElement.GetProperty("cases").EnumerateArray()){
            var ns=item.GetProperty("nodes").EnumerateArray().Select(n=>n.GetString()!.Split('|')).Select(p=>N(p[0],p[1])).ToArray();
            var es=item.GetProperty("edges").EnumerateArray().Select((e,i)=>E(e[0].GetString()!,e[1].GetString()!,e[2].GetString(),item.GetProperty("id").GetString()+i)).ToArray();
            var result=RouteTopologyCheck.Analyze(M(ns,es));
            Check(result.Pairs.Count==item.GetProperty("pairs").GetInt32()&&result.Cycles.Count==item.GetProperty("cycles").GetInt32()&&result.Issues.Count(i=>i.Severity=="Error")==item.GetProperty("errors").GetInt32(),"Stored master fixture: "+item.GetProperty("id").GetString());
        }
        return count;
    }
    private sealed class Env(string root):Microsoft.AspNetCore.Hosting.IWebHostEnvironment{
        public string ApplicationName{get;set;}="TopologyChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}=root;public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider{get;set;}=new Microsoft.Extensions.FileProviders.NullFileProvider();
        public string WebRootPath{get;set;}=root;public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider{get;set;}=new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
