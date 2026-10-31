using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;


// Conservative structural analysis. No evaluation of business conditions or simulation of tokens.
public static class RouteTopologyCheck
{
    private sealed class BudgetExceeded:Exception;
    public static RouteTopologyReport Analyze(ProcessModel process,CancellationToken ct=default,int workLimit=200000)
    {
        var issues=new List<ProcessValidationIssueModel>();var pairs=new List<ParallelRoutePair>();var cycles=new List<RouteCycleComponent>();
        void Add(string code,string severity,string message,string? id=null)=>issues.Add(new(code,severity,message,id,process.Nodes.FirstOrDefault(n=>n.Id==id)?.Name,"Route"));
        if(process.Nodes.Count>10000||process.Edges.Count>20000){Add("route-topology-limit","Error","Маршрут превышает предел структурного анализа: 10000 элементов / 20000 стрелок. Проверка повторов и пар шлюзов не выполнена.");return new([],[],true,issues);}
        if(process.Nodes.Any(n=>string.IsNullOrWhiteSpace(n.Id))||process.Nodes.Select(n=>n.Id).Distinct(StringComparer.Ordinal).Count()!=process.Nodes.Count
            ||process.Edges.Any(e=>string.IsNullOrWhiteSpace(e.Id))||process.Edges.Select(e=>e.Id).Distinct(StringComparer.Ordinal).Count()!=process.Edges.Count)
        {Add("route-topology-identifiers","Error","Пустые или повторные ID мешают однозначной проверке маршрута.");return new([],[],true,issues);}
        var nodes=process.Nodes.ToDictionary(n=>n.Id,StringComparer.Ordinal);
        var valid=process.Edges.Where(e=>nodes.ContainsKey(e.SourceId)&&nodes.ContainsKey(e.TargetId)).ToArray();
        foreach(var edge in process.Edges.Except(valid))Add("route-topology-broken-edge","Error","У стрелки "+edge.Id+" отсутствует источник или получатель.",nodes.ContainsKey(edge.SourceId)?edge.SourceId:null);
        var outgoing=valid.GroupBy(e=>e.SourceId).ToDictionary(g=>g.Key,g=>g.OrderBy(e=>e.Id,StringComparer.Ordinal).ToArray(),StringComparer.Ordinal);
        var incoming=valid.GroupBy(e=>e.TargetId).ToDictionary(g=>g.Key,g=>g.ToArray(),StringComparer.Ordinal);
        EdgeModel[] Out(string id)=>outgoing.GetValueOrDefault(id)??[];
        EdgeModel[] In(string id)=>incoming.GetValueOrDefault(id)??[];
        // Iterative Kosaraju: deep routes cannot overflow the native call stack.
        var visited=new HashSet<string>(StringComparer.Ordinal);var finish=new List<string>();
        foreach(var root in nodes.Keys.Order(StringComparer.Ordinal))
        {
            var stack=new Stack<(string Id,bool Exit)>();stack.Push((root,false));
            while(stack.TryPop(out var frame))
            {
                ct.ThrowIfCancellationRequested();
                if(frame.Exit){finish.Add(frame.Id);continue;}
                if(!visited.Add(frame.Id))continue;
                stack.Push((frame.Id,true));foreach(var edge in Out(frame.Id).Reverse())if(!visited.Contains(edge.TargetId))stack.Push((edge.TargetId,false));
            }
        }
        visited.Clear();
        foreach(var root in finish.AsEnumerable().Reverse())
        {
            if(!visited.Add(root))continue;var component=new HashSet<string>(StringComparer.Ordinal){root};var stack=new Stack<string>();stack.Push(root);
            while(stack.TryPop(out var id)){ct.ThrowIfCancellationRequested();foreach(var e in In(id))if(visited.Add(e.SourceId)){component.Add(e.SourceId);stack.Push(e.SourceId);}}
            if(component.Count==1&&!Out(root).Any(e=>e.TargetId==root))continue;
            var ids=component.Order(StringComparer.Ordinal).ToArray();var exits=component.SelectMany(Out).Where(e=>!component.Contains(e.TargetId)).OrderBy(e=>e.Id,StringComparer.Ordinal).ToArray();
            var controlled=exits.Any(e=>nodes[e.SourceId].Type=="exclusiveGateway"&&Out(e.SourceId).Length>=2&&!string.IsNullOrWhiteSpace(e.Label));
            cycles.Add(new(ids.Take(50).ToArray(),ids.Length,exits.Select(e=>e.Id).Take(50).ToArray(),exits.Length,controlled));
            var names=string.Join("; ",ids.Take(10).Select(id=>nodes[id].Name))+(ids.Length>10?$"; ещё {ids.Length-10}":"");
            Add(controlled?"route-cycle-controlled":"route-cycle-without-exit",controlled?"Warning":"Error",
                controlled?"Компонента повтора имеет подписанный выход XOR: "+names+". Это не порядок обхода; подтвердите условие выхода и число итераций."
                    :"Компонента повтора без подписанного выхода XOR: "+names+". Это множество связанных элементов, не последовательность стрелок.",ids[0]);
        }
        if(valid.Length!=process.Edges.Count)return new(pairs,cycles,true,issues);
        int work=0;void Spend(){ct.ThrowIfCancellationRequested();if(++work>workLimit)throw new BudgetExceeded();}
        var joins=nodes.Values.Where(n=>n.Type=="parallelGateway"&&In(n.Id).Length>=2).Select(n=>n.Id).ToHashSet(StringComparer.Ordinal);
        bool limited=false;
        try
        {
            foreach(var fork in nodes.Values.Where(n=>n.Type=="parallelGateway"&&Out(n.Id).Length>=2).OrderBy(n=>n.Id,StringComparer.Ordinal))
            {
                Spend();var branches=Out(fork.Id);var maps=new List<Dictionary<string,int>>();
                foreach(var branch in branches)
                {
                    var distances=new Dictionary<string,int>(StringComparer.Ordinal);var queue=new Queue<(string Id,int Depth)>();queue.Enqueue((branch.TargetId,0));
                    while(queue.TryDequeue(out var next)){Spend();if(next.Id==fork.Id||!distances.TryAdd(next.Id,next.Depth))continue;foreach(var e in Out(next.Id)){Spend();queue.Enqueue((e.TargetId,next.Depth+1));}}
                    maps.Add(distances);
                }
                var candidates=joins.Where(j=>j!=fork.Id&&maps.All(m=>m.ContainsKey(j))).OrderBy(j=>maps.Max(m=>m[j])).ThenBy(j=>j,StringComparer.Ordinal).ToArray();
                bool matched=false;string? uncertainty=null;
                foreach(var join in candidates)
                {
                    var region=new HashSet<string>(StringComparer.Ordinal);var queue=new Queue<string>(branches.Select(b=>b.TargetId));bool bypass=false;
                    while(queue.TryDequeue(out var id))
                    {
                        Spend();if(id==join||!region.Add(id))continue;
                        if(!nodes.ContainsKey(id)||nodes[id].Type=="endEvent"||Out(id).Length==0){bypass=true;continue;}
                        foreach(var e in Out(id)){Spend();queue.Enqueue(e.TargetId);}
                    }
                    if(bypass)continue;
                    var degrees=region.ToDictionary(id=>id,id=>In(id).Count(e=>region.Contains(e.SourceId)),StringComparer.Ordinal);
                    var ready=new Queue<string>(degrees.Where(k=>k.Value==0).Select(k=>k.Key));var order=new List<string>();
                    while(ready.TryDequeue(out var id)){Spend();order.Add(id);foreach(var e in Out(id)){Spend();if(region.Contains(e.TargetId)&&--degrees[e.TargetId]==0)ready.Enqueue(e.TargetId);}}
                    if(order.Count!=region.Count){uncertainty="Участок содержит повтор; структурная синхронизация не подтверждена.";continue;}
                    if(region.Any(id=>In(id).Any(e=>!region.Contains(e.SourceId)&&e.SourceId!=fork.Id)))
                    {uncertainty="Внутрь участка входят внешние потоки.";continue;}
                    var lineage=region.ToDictionary(id=>id,_=>new HashSet<int>(),StringComparer.Ordinal);
                    for(var i=0;i<branches.Length;i++)if(lineage.TryGetValue(branches[i].TargetId,out var roots))roots.Add(i);
                    foreach(var id in order)foreach(var e in Out(id))if(lineage.TryGetValue(e.TargetId,out var target))
                        foreach(var branch in lineage[id]){Spend();target.Add(branch);}
                    var used=new HashSet<int>();bool exact=true;
                    foreach(var edge in In(join))
                    {
                        Spend();var direct=Array.FindIndex(branches,b=>b.Id==edge.Id);
                        var origins=direct>=0?new HashSet<int>{direct}:lineage.GetValueOrDefault(edge.SourceId)??[];
                        if(origins.Count!=1||!used.Add(origins.SingleOrDefault())){exact=false;break;}
                    }
                    if(!exact||used.Count!=branches.Length){uncertainty="Входы объединения не соответствуют по одному входу на исходную ветвь. Проверьте альтернативы, внешние потоки и вложенные разветвления.";continue;}
                    pairs.Add(new(fork.Id,join,branches.Length));matched=true;break;
                }
                if(!matched)Add("parallel-gateway-pair-unconfirmed","Warning",
                    "Для разветвления "+fork.Id+" не подтверждена структурная пара объединения. "+(uncertainty??"Возможны отдельные завершения, обход объединения или нестандартная синхронизация; это не доказательство ошибки BPMN."),fork.Id);
            }
        }
        catch(BudgetExceeded){limited=true;Add("parallel-gateway-analysis-limit","Warning","Проверка пар шлюзов ограничена бюджетом "+workLimit+" операций. Непроверенные объединения не объявляются ошибками.");}
        if(!limited)foreach(var join in joins.Order(StringComparer.Ordinal).Where(j=>pairs.All(p=>p.JoinId!=j)))
            Add("parallel-gateway-join-unconfirmed","Warning","Для объединения "+join+" не подтверждено соответствующее разветвление. Проверьте происхождение всех входных потоков; нестандартный маршрут не объявляется неверным автоматически.",join);
        return new(pairs,cycles,limited,issues);
    }
}
