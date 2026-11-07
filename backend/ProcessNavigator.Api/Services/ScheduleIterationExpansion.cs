using System.Text.Json;
using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed record ScheduleExpandedNode(string OriginalId,int Occurrence,IReadOnlyList<SchedulePassCoordinateModel> Path);
public sealed record ScheduleExpandedRoute(ProcessModel Model,IReadOnlyDictionary<string,ScheduleExpandedNode> Nodes,
    IReadOnlySet<string> ActiveReturns);

// Finite unfolding of explicitly bounded, single-entry/single-exit return regions.
// No arbitrary cycle inference, BPMN token execution or edits to the stored model.
public static class ScheduleIterationExpansion
{
    public static ScheduleExpandedRoute Build(ProcessModel process,IReadOnlyList<ScheduleIterationPlanModel> plans,
        IReadOnlyDictionary<string,string>? choices,IReadOnlyDictionary<string,int>? counts=null)
    {
        if(plans.Count>8||plans.Any(p=>p is null)||plans.Select(p=>p.ReturnEdgeId).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=plans.Count)
            throw new InvalidDataException("До 8 неповторяющихся возвратных участков на процесс.");
        foreach(var p in plans)if(p.PlannedRepeats<0||p.MaximumRepeats<p.PlannedRepeats||p.MaximumRepeats>50)
            throw new InvalidDataException("Дополнительные проходы: 0 ≤ план ≤ предел ≤ 50.");
        var nodes=process.Nodes.ToDictionary(n=>n.Id,StringComparer.Ordinal);
        var outgoing=process.Edges.ToLookup(e=>e.SourceId,StringComparer.Ordinal);
        var backs=plans.ToDictionary(p=>p.ReturnEdgeId,p=>{
            var edge=process.Edges.SingleOrDefault(e=>e.Id==p.ReturnEdgeId);
            if(edge is null||!nodes.TryGetValue(edge.SourceId,out var gate)||gate.Type!="exclusiveGateway"||
                outgoing[edge.SourceId].Count()!=2||choices?.ContainsKey(edge.SourceId)==true)
                throw new InvalidDataException("Возврат требует точную стрелку XOR с двумя выходами без ручного исхода этого шлюза.");
            return edge;
        },StringComparer.Ordinal);
        if(backs.Values.Select(e=>e.SourceId).Distinct().Count()!=backs.Count)
            throw new InvalidDataException("Один шлюз не может управлять несколькими участками.");
        var stripped=process with{Edges=process.Edges.Where(e=>!backs.ContainsKey(e.Id)).ToArray()};
        // Use the established route validator for all non-return XOR choices.
        var route=ScheduleRouteScenario.Build(stripped,choices,null);
        var edges=route.Model.Edges;
        var active=route.ActiveIds;
        var regions=new Dictionary<string,HashSet<string>>(StringComparer.Ordinal);
        foreach(var (id,back) in backs){
            if(!active.Contains(back.SourceId))continue;
            var region=Walk(back.TargetId,edges,false);
            region.IntersectWith(Walk(back.SourceId,edges,true));
            if(!region.Contains(back.TargetId)||!region.Contains(back.SourceId)||
                region.Any(n=>nodes[n].Type is "parallelGateway" or "startEvent" or "endEvent")||
                edges.Any(e=>region.Contains(e.SourceId)&&!region.Contains(e.TargetId)&&e.SourceId!=back.SourceId)||
                edges.Any(e=>!region.Contains(e.SourceId)&&region.Contains(e.TargetId)&&e.TargetId!=back.TargetId)||
                edges.GroupBy(e=>e.SourceId).Any(g=>region.Contains(g.Key)&&nodes[g.Key].Type!="exclusiveGateway"&&g.Count()>1)||
                edges.Any(e=>e.SourceId==back.SourceId&&region.Contains(e.TargetId)))
                throw new InvalidDataException("Повторяемый участок требует один вход/выход без внутренних AND, событий границ и пересекающих связей.");
            regions[id]=region;
        }
        var all=regions.ToArray();
        for(var i=0;i<all.Length;i++)for(var j=i+1;j<all.Length;j++){
            var a=all[i];var b=all[j];
            if(!a.Value.Overlaps(b.Value))continue;
            if(a.Value.SetEquals(b.Value)||(!a.Value.IsProperSubsetOf(b.Value)&&!b.Value.IsProperSubsetOf(a.Value))||
                backs[a.Key].TargetId==backs[b.Key].TargetId||backs[a.Key].SourceId==backs[b.Key].SourceId)
                throw new InvalidDataException("Участки должны быть раздельными или строго вложенными, без общих границ.");
        }
        var indegree=active.ToDictionary(n=>n,_=>0);
        foreach(var e in edges)indegree[e.TargetId]++;
        var ready=new Queue<string>(indegree.Where(p=>p.Value==0).Select(p=>p.Key));
        var adjacency=edges.ToLookup(e=>e.SourceId);var visited=0;
        while(ready.TryDequeue(out var n)){visited++;foreach(var e in adjacency[n])if(--indegree[e.TargetId]==0)ready.Enqueue(e.TargetId);}
        if(visited!=active.Count)throw new InvalidDataException("Не для всех циклов задано поддержанное правило возврата.");
        var scopes=route.Model.Nodes.ToDictionary(n=>n.Id,n=>all.Where(p=>p.Value.Contains(n.Id))
            .OrderByDescending(p=>p.Value.Count).ThenBy(p=>p.Key,StringComparer.Ordinal).Select(p=>p.Key).ToArray());
        if(scopes.Values.Any(s=>s.Length>6))throw new InvalidDataException("Глубина повторных участков превышает 6.");
        var starts=route.Model.Nodes.Where(n=>n.Type=="startEvent").Select(n=>n.Id).ToArray();
        if(starts.Length==0)starts=route.Model.Nodes.Where(n=>!process.Edges.Any(e=>e.TargetId==n.Id)).Select(n=>n.Id).ToArray();
        if(starts.Length==0)throw new InvalidDataException("Нет исходной точки маршрута повторений.");
        var prefix="_iteration_";
        while(process.Nodes.Select(n=>n.Id).Concat(process.Lanes.Select(l=>l.Id)).Concat(process.Edges.Select(e=>e.Id)).Any(id=>id.StartsWith(prefix,StringComparison.Ordinal)))prefix="_"+prefix;
        var map=new Dictionary<string,ScheduleExpandedNode>();var clones=new List<NodeModel>();var links=new List<EdgeModel>();
        var states=new Dictionary<string,string>(StringComparer.Ordinal);
        var pending=new Queue<(string Original,Dictionary<string,int> Counters,string Clone)>();
        var occurrence=new Dictionary<string,int>(StringComparer.Ordinal);
        string Add(string original,Dictionary<string,int> previous,string? increment=null){
            var current=scopes[original].ToDictionary(key=>key,key=>previous.GetValueOrDefault(key));
            if(increment is not null){
                var index=Array.IndexOf(scopes[original],increment);
                if(index<0)throw new InvalidDataException("Возврат не принадлежит целевому участку.");
                current[increment]=previous.GetValueOrDefault(increment)+1;
                foreach(var inner in scopes[original].Skip(index+1))current[inner]=0;
            }
            var key=JsonSerializer.Serialize(new{original,counts=current});
            if(states.TryGetValue(key,out var known))return known;
            if(clones.Count>=10000)throw new InvalidDataException("Развёртка превышает 10 000 узлов; уменьшите число проходов.");
            var clone=prefix+"node"+clones.Count;
            occurrence[original]=occurrence.GetValueOrDefault(original)+1;
            map[clone]=new(original,occurrence[original],current.Select(p=>new SchedulePassCoordinateModel(p.Key,p.Value+1)).ToArray());
            states[key]=clone;clones.Add(nodes[original] with{Id=clone});pending.Enqueue((original,current,clone));
            return clone;
        }
        foreach(var start in starts)Add(start,[]);
        var gateReturns=backs.Values.ToDictionary(e=>e.SourceId,e=>e.Id);
        while(pending.TryDequeue(out var state)){
            IEnumerable<EdgeModel> next=adjacency[state.Original];string? increment=null;
            if(gateReturns.TryGetValue(state.Original,out var loop)&&regions.ContainsKey(loop)){
                var plan=plans.Single(p=>p.ReturnEdgeId==loop);var amount=counts?.GetValueOrDefault(loop)??plan.PlannedRepeats;
                if(amount<0||amount>plan.MaximumRepeats)throw new InvalidDataException("Число проходов вне заданного предела.");
                if(state.Counters[loop]<amount){next=[backs[loop]];increment=loop;}
            }
            foreach(var edge in next){
                if(links.Count>=20000)throw new InvalidDataException("Развёртка превышает 20 000 переходов.");
                var target=Add(edge.TargetId,state.Counters,increment);
                links.Add(edge with{Id=prefix+"edge"+links.Count,SourceId=state.Clone,TargetId=target});
            }
        }
        // Number occurrences by hierarchical coordinates, not queue discovery order:
        // a short alternative must not give a later pass an earlier ordinal.
        foreach(var group in map.GroupBy(p=>p.Value.OriginalId).ToArray()){
            var ordered=group.OrderBy(p=>string.Join("/",p.Value.Path.Select(c=>c.Pass.ToString("D2"))),StringComparer.Ordinal).ToArray();
            for(var i=0;i<ordered.Length;i++)map[ordered[i].Key]=ordered[i].Value with{Occurrence=i+1};
        }
        return new(process with{Nodes=clones,Edges=links},map,regions.Keys.ToHashSet(StringComparer.Ordinal));
    }
    static HashSet<string> Walk(string start,IReadOnlyList<EdgeModel> edges,bool reverse){
        var adjacency=edges.ToLookup(e=>reverse?e.TargetId:e.SourceId);
        var result=new HashSet<string>(StringComparer.Ordinal);var pending=new Queue<string>();pending.Enqueue(start);
        while(pending.TryDequeue(out var id))if(result.Add(id))foreach(var e in adjacency[id])pending.Enqueue(reverse?e.SourceId:e.TargetId);
        return result;
    }
}
