using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;
using System.Text.Json;
internal static class BoundaryRouteChecks
{
    static InformationObjectBindingModel B(string role,string id="doc",string? version=null)=>new(id,id,role,Version:version);
    static NodeModel N(string id,string type="task",params InformationObjectBindingModel[] bindings)=>new(id,type,id,"lane",0,0,100,80,null,null,null,[],[],InformationObjects:bindings);
    static EdgeModel E(string a,string b)=>new(a+"-"+b,a,b,null,[]);
    static ProcessModel M(NodeModel[] ns,EdgeModel[] es)=>new("nested","Детальный маршрут","1","Учебное подразделение","Published",[],ns,es);
    public static int Run(){
        int count=0;void Check(bool ok,string text){if(!ok)throw new Exception("Boundary route: "+text);count++;}
        var parent=N("parent","task",B("Output"));
        var s=N("s","startEvent");var z=N("z","endEvent");var make=N("make","task",B("Output"));var use=N("use","task",B("Input"));
        var linear=M([s,make,use,z],[E("s","make"),E("make","use"),E("use","z")]);
        var good=BoundaryRouteCheck.Compare(parent,linear);Check(good.Count==0,"Earlier required producer");
        var late=linear with{Edges=[E("s","use"),E("use","make"),E("make","z")]};
        Check(BoundaryRouteCheck.Compare(parent,late).Any(i=>i.Code.EndsWith("input-unavailable")),"Later producer cannot satisfy earlier consumer");
        Check(BoundaryRouteCheck.Compare(parent with{InformationObjects=[B("Input"),B("Output")]},late).Count==0,"Guaranteed initial supply");
        var self=M([s,N("self","task",B("Input"),B("Output")),z],[E("s","self"),E("self","z")]);
        Check(BoundaryRouteCheck.Compare(parent,self).Count(i=>i.Code.EndsWith("input-unavailable")||i.Code.EndsWith("output-unavailable"))==2,"A step cannot supply its own missing prerequisite");
        var fork=N("f","exclusiveGateway");var join=N("j","exclusiveGateway");var bypass=N("b");
        var split=M([s,fork,make,bypass,join,use,z],[E("s","f"),E("f","make"),E("f","b"),E("make","j"),E("b","j"),E("j","use"),E("use","z")]);
        Check(BoundaryRouteCheck.Compare(parent,split).Any(i=>i.Code.EndsWith("input-unavailable")),"XOR may bypass producer");
        var both=split with{Nodes=split.Nodes.Select(n=>n.Id=="b"?n with{InformationObjects=[B("Output")]}:n).ToArray()};
        Check(BoundaryRouteCheck.Compare(parent,both).Count==0,"Both XOR alternatives produce");
        var parallel=split with{Nodes=split.Nodes.Select(n=>n.Id is "f" or "j"?n with{Type="parallelGateway"}:n).ToArray()};
        Check(BoundaryRouteCheck.Compare(parent,parallel).Count==0,"Confirmed AND join unions guarantees");
        var mixed=parallel with{Nodes=parallel.Nodes.Select(n=>n.Id=="f"?n with{Type="exclusiveGateway"}:n).ToArray()};
        Check(BoundaryRouteCheck.Compare(parent,mixed).Any(i=>i.Code.EndsWith("synchronization")),"Unconfirmed AND cannot imply union");
        foreach(var binding in new[]{B("Output") with{Required=false},B("Output") with{Condition="Если одобрено"},B("Output",version:"1")}){
            var model=linear with{Nodes=[s,make with{InformationObjects=[binding]},use with{InformationObjects=[B("Input",version:binding.Version==null?null:"2")]},z]};
            Check(BoundaryRouteCheck.Compare(parent,model).Any(i=>i.Code.EndsWith("input-unavailable")),"Optional, conditional, or incompatible version does not guarantee supply");
        }
        var conditional=linear with{Nodes=[s,make,use with{InformationObjects=[B("Input") with{Condition="Если требуется"}]},z]};
        Check(BoundaryRouteCheck.Compare(parent,conditional).Any(i=>i.Code.EndsWith("conditional-input")),"Text condition remains manual");
        Check(BoundaryRouteCheck.Compare(parent with{InformationObjects=[B("Output") with{Condition="Успех"}]},linear).Any(i=>i.Code.EndsWith("conditional-output")),"Conditional contract not silently proven");
        var blocked=linear with{Nodes=[s,make with{InformationObjects=[B("Input","external"),B("Output")]},use,z]};
        Check(BoundaryRouteCheck.Compare(parent,blocked).Any(i=>i.Code.EndsWith("output-unavailable")),"Blocked producer cannot promise downstream results");
        var unreachable=linear with{Edges=[E("s","use"),E("use","z")]};
        Check(BoundaryRouteCheck.Compare(parent,unreachable).Any(i=>i.Code.EndsWith("unreachable")),"Unreachable producer excluded");
        var repeat=linear with{Edges=linear.Edges.Append(E("use","make")).ToArray()};
        Check(BoundaryRouteCheck.Compare(parent,repeat).Any(i=>i.Code.EndsWith("repeat")),"Repeat explicitly unconfirmed");
        var broken=linear with{Edges=linear.Edges.Append(E("make","missing")).ToArray()};
        Check(BoundaryRouteCheck.Compare(parent,broken).Any(i=>i.Code.EndsWith("invalid")),"Dangling flow");
        Check(BoundaryRouteCheck.Compare(parent,linear with{Nodes=linear.Nodes.Append(make).ToArray()}).Single().Code.EndsWith("invalid"),"Duplicate IDs");
        Check(BoundaryRouteCheck.Compare(parent,linear,budget:0).Single().Code.EndsWith("limit"),"Explicit operation limit");
        Check(BoundaryRouteCheck.Compare(parent,linear with{Nodes=Enumerable.Range(0,5001).Select(i=>N("n"+i)).ToArray()}).Single().Code.EndsWith("limit"),"Explicit model limit");
        var endings=split with{Nodes=[s,fork,make,bypass,z,N("z2","endEvent")],Edges=[E("s","f"),E("f","make"),E("f","b"),E("make","z"),E("b","z2")]};
        Check(BoundaryRouteCheck.Compare(parent,endings).Any(i=>i.Code.EndsWith("output-unavailable")),"All reachable endings considered");
        var integrated=ProcessBoundaryCheck.Compare(parent,late);
        Check(integrated.Any(i=>i.Code.EndsWith("route-input-unavailable"))&&integrated.All(i=>i.Severity=="Warning"&&i.ElementId=="parent"&&i.Category=="Decomposition"),"Integrated nonblocking parent anchor");
        var root=new DirectoryInfo(AppContext.BaseDirectory);
        while(root!=null&&!File.Exists(Path.Combine(root.FullName,"master-data","boundary-route-fixture.json")))root=root.Parent;
        using var doc=JsonDocument.Parse(File.ReadAllText(Path.Combine(root?.FullName??throw new Exception("Fixture missing"),"master-data","boundary-route-fixture.json")));
        foreach(var c in doc.RootElement.GetProperty("cases").EnumerateArray()){
            var ns=c.GetProperty("nodes").EnumerateArray().Select(v=>v.GetString()!.Split('|')).Select(p=>p[0]=="make"?make:p[0]=="use"?use:N(p[0],p[1])).ToArray();
            var es=c.GetProperty("edges").EnumerateArray().Select(e=>E(e[0].GetString()!,e[1].GetString()!)).ToArray();
            var result=ProcessBoundaryCheck.Compare(parent,M(ns,es));
            Check(result.Any(i=>i.Code.EndsWith("route-input-unavailable"))==c.GetProperty("unavailable").GetBoolean(),"Persisted master route "+c.GetProperty("id").GetString());
        }
        return count;
    }
}
