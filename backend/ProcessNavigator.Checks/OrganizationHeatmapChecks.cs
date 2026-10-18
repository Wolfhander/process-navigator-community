using System.Text.Json;
using ProcessNavigator.Api.Models;
using ProcessNavigator.Api.Services;

internal static class OrganizationHeatmapChecks
{
    public static int Run()
    {
        using var control=JsonDocument.Parse(File.ReadAllText("master-data/heatmap/control.json"));
        NodeModel Node(string id,string lane,string type="task")=>new(id,type,id,lane,0,0,180,80,null,null,null,[],[]);
        EdgeModel Edge(string a,string b)=>new(a+b,a,b,null,[]);
        var model=new ProcessModel("p","Учебная схема","1","Отдел","Published",[new("l1","Отдел",0,200),new("l2","Отдел",200,200),new("l3","Отдел",400,200)],
            [Node("a","l1"),Node("g","l1","exclusiveGateway"),Node("b","l2"),Node("c","l3")],[Edge("a","g"),Edge("g","b"),Edge("b","c")],OwnerLegalEntityId:"a",OwnerUnitId:"idle");
        var links=new LaneOrganizationModel[]{new("l1","a","Отдел","unit"),new("l2","b","Отдел","unit"),new("l3","b","Отдел","unit")};
        var map=new OrganizationMapModel("test","Учебная группа","Синтетические данные",
            [new("a","Организация А","",[],[new("unit",null,"Отдел","Отдел",""),new("idle",null,"Владелец без дорожки","Владелец","")]),new("b","Организация Б","",[],[new("unit",null,"Отдел","Отдел","")])],
            [new("p",["a","b"],links,"")]);
        var facts=new Dictionary<string,ProcessAnalyticsModel>{{"p",new("p",2,1,1,null,[new("a","a","Отдел",null,1,0,10,10,1),new("b","b","Отдел",null,1,0,5,5,0),new("c","c","Отдел",null,1,1,20,30,2)])}};
        var count=0;void Check(bool ok,string text){if(!ok)throw new Exception(text);count++;}
        var report=OrganizationHeatmapService.Build(map,[model],facts);
        var first=report.Rows.Single(r=>r.EntityId=="a"&&r.UnitId=="unit");var second=report.Rows.Single(r=>r.EntityId=="b");var owner=report.Rows.Single(r=>r.UnitId=="idle");
        Check(report.Rows.Count==control.RootElement.GetProperty("expected").GetProperty("rows").GetInt32(),"All units included, including no participation");
        Check(first.TaskCount==1&&second.TaskCount==2,"Same names and unit IDs in different entities never merge");
        Check(first.ProcessCount==1&&second.ProcessCount==1,"Multiple lanes do not duplicate process participation");
        Check(first.OutgoingTransferCount==1&&second.IncomingTransferCount==1&&second.OutgoingTransferCount==0,"Gateway counted once, same-unit cross-lane transfer excluded");
        Check(first.OverdueCount==1&&second.OverdueCount==2,"Actual step IDs, not lane names, allocate overdue facts");
        Check(owner.OwnedProcessCount==1&&owner.ProcessCount==0&&owner.OverdueCount==null,"Ownership distinct from participation and no observed task means no factual zero");
        Check(first.ObservedInstanceCount==2&&second.ObservedInstanceCount==2,"Observed model instances counted once per participating unit");
        var empty=OrganizationHeatmapService.Build(map,[model],new Dictionary<string,ProcessAnalyticsModel>());
        Check(empty.Rows.All(r=>r.OverdueCount==null),"Missing execution facts do not become zeros");
        var zeroFacts=new Dictionary<string,ProcessAnalyticsModel>{{"p",facts["p"] with {Steps=facts["p"].Steps.Select(s=>s with {OverdueCount=0}).ToArray()}}};
        Check(OrganizationHeatmapService.Build(map,[model],zeroFacts).Rows.Single(r=>r.EntityId=="a"&&r.UnitId=="unit").OverdueCount==0,"Observed zero distinct from absent observations");
        var duplicate=map with {CrossCompanyProcesses=[new("p",["a","b"],[..links,links[0]],"")]};
        Check(OrganizationHeatmapService.Build(duplicate,[model],facts).Rows.Single(r=>r.EntityId=="a"&&r.UnitId=="unit").TaskCount==1,"Duplicate identical lane mapping does not double-count");
        var ambiguous=map with {CrossCompanyProcesses=[new("p",["a","b"],[..links,new("l1","b","Отдел","unit")],"")]};
        var bad=OrganizationHeatmapService.Build(ambiguous,[model],facts);
        Check(bad.UnmappedTaskCount==1&&bad.UnmappedTransferCount==1&&bad.Warnings.Count>0,"Ambiguous mappings remain unresolved, not guessed");
        Check(OrganizationHeatmapService.Build(map,[model with {OwnerUnitId=null}],facts).UnmappedOwnershipCount==1,"Owner label cannot replace stable owner IDs");
        var orphanFacts=new Dictionary<string,ProcessAnalyticsModel>{{"p",facts["p"] with {Steps=[..facts["p"].Steps,new("missing","missing","",null,1,0,null,null,3)]}}};
        Check(OrganizationHeatmapService.Build(map,[model],orphanFacts).OrphanExecutionStepCount==1,"Unknown execution step explicitly unallocated");
        Check(OrganizationHeatmapService.Build(map,[],new Dictionary<string,ProcessAnalyticsModel>()).Rows.All(r=>r.ProcessCount==0&&r.OverdueCount==null),"Empty catalog retains the full organization map");
        using var cancelled=new CancellationTokenSource();cancelled.Cancel();var stopped=false;
        try{OrganizationHeatmapService.Build(map,[],facts,cancelled.Token);}catch(OperationCanceledException){stopped=true;}
        Check(stopped,"Heatmap cancellation applies even to empty catalogs");
        Console.WriteLine($"Organization heatmap checks passed: {count}.");return count;
    }
}
