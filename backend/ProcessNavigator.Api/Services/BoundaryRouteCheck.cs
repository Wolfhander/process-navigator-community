using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;

// Conservative must-availability over an acyclic graph. Conditions are never executed.
public static class BoundaryRouteCheck
{
    private sealed class Limit:Exception;
    public static IReadOnlyList<ProcessValidationIssueModel> Compare(NodeModel parent,ProcessModel child,int budget=200000)
    {
        var issues=new List<ProcessValidationIssueModel>();var reported=new HashSet<string>(StringComparer.Ordinal);
        void Warn(string code,string text,string key=""){if(reported.Add(code+":"+key))issues.Add(new("linked-process-boundary-route-"+code,"Warning",text,parent.Id,parent.Name,"Decomposition"));}
        if(child.Nodes.Count>5000||child.Edges.Count>10000||(parent.InformationObjects?.Count??0)>2000||child.Nodes.Sum(n=>(long)(n.InformationObjects?.Count??0))>20000){Warn("limit","Проверка доступности границ не выполнена: превышены пределы модели или структурированных привязок.");return issues;}
        var bindings=parent.InformationObjects??[];
        var nested=child.Nodes.SelectMany(n=>n.InformationObjects??[]).ToArray();
        var producedIds=nested.Where(b=>b.Role=="Output").Select(b=>b.ObjectId).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var requirements=nested.Where(b=>b.Role=="Input"&&b.Required)
            .Concat(bindings.Where(b=>b.Role=="Output"&&b.Required&&producedIds.Contains(b.ObjectId))).ToArray();
        if(requirements.Length==0)return issues; // Missing contract members are diagnosed by ProcessBoundaryCheck.
        if(child.Nodes.Count>5000||child.Edges.Count>10000||requirements.Length>2000){Warn("limit","Проверка доступности границ не выполнена: предел 5000 элементов / 10000 стрелок / 2000 требований.");return issues;}
        if(child.Nodes.Select(n=>n.Id).Distinct(StringComparer.Ordinal).Count()!=child.Nodes.Count||child.Nodes.Any(n=>string.IsNullOrWhiteSpace(n.Id))){Warn("invalid","Неоднозначные ID: доступность объектов на маршруте не подтверждена.");return issues;}
        var nodes=child.Nodes.ToDictionary(n=>n.Id,StringComparer.Ordinal);
        if(child.Edges.Any(e=>!nodes.ContainsKey(e.SourceId)||!nodes.ContainsKey(e.TargetId))){Warn("invalid","Обрыв стрелки: доступность объектов на маршруте не подтверждена.");return issues;}
        var outgoing=child.Edges.GroupBy(e=>e.SourceId).ToDictionary(g=>g.Key,g=>g.ToArray());
        var incoming=child.Edges.GroupBy(e=>e.TargetId).ToDictionary(g=>g.Key,g=>g.ToArray());
        EdgeModel[] Out(string id)=>outgoing.GetValueOrDefault(id)??[];
        EdgeModel[] In(string id)=>incoming.GetValueOrDefault(id)??[];
        var starts=child.Nodes.Where(n=>n.Type=="startEvent").Select(n=>n.Id).ToArray();
        if(starts.Length==0||starts.Any(s=>In(s).Length>0)||child.Nodes.Any(n=>n.Type=="endEvent"&&Out(n.Id).Length>0)){Warn("invalid","Начало/завершение маршрута не определено однозначно; доступность границ не подтверждена.");return issues;}
        int work=0;void Spend(int amount=1){work+=amount;if(work>budget)throw new Limit();}
        try{
            var reachable=new HashSet<string>(StringComparer.Ordinal);var queue=new Queue<string>(starts);
            while(queue.TryDequeue(out var id)){Spend();if(!reachable.Add(id))continue;foreach(var e in Out(id)){Spend();queue.Enqueue(e.TargetId);}}
            var degrees=reachable.ToDictionary(id=>id,id=>In(id).Count(e=>reachable.Contains(e.SourceId)));
            var ready=new Queue<string>(degrees.Where(p=>p.Value==0).Select(p=>p.Key));var order=new List<string>();
            while(ready.TryDequeue(out var id)){Spend();order.Add(id);foreach(var e in Out(id)){Spend();if(--degrees[e.TargetId]==0)ready.Enqueue(e.TargetId);}}
            if(order.Count!=reachable.Count){Warn("repeat","На маршруте есть повтор: наличие производителя не подтверждает доступность до первого использования. Уточните начальное обеспечение и условие повторов; автоматическое подтверждение не выполняется.");return issues;}
            if(reachable.Any(id=>nodes[id].Type is not ("task" or "userTask" or "serviceTask" or "manualTask" or "scriptTask" or "businessRuleTask" or "sendTask" or "receiveTask" or "startEvent" or "endEvent" or "exclusiveGateway" or "parallelGateway"))){
                Warn("unsupported","Маршрут содержит неподдержанный тип события/шлюза. Доступность границ требует ручной проверки.");return issues;
            }
            var topology=RouteTopologyCheck.Analyze(child);
            var confirmedJoins=topology.Pairs.Select(p=>p.JoinId).ToHashSet(StringComparer.Ordinal);
            bool Matches(InformationObjectBindingModel producer,InformationObjectBindingModel needed)=>producer.ObjectId.Equals(needed.ObjectId,StringComparison.OrdinalIgnoreCase)&&(string.IsNullOrWhiteSpace(needed.Version)||producer.Version==needed.Version);
            bool Certain(InformationObjectBindingModel b)=>b.Required&&string.IsNullOrWhiteSpace(b.Condition);
            var req=requirements.DistinctBy(b=>(b.ObjectId.ToUpperInvariant(),b.Version??"")).ToArray();
            HashSet<int> Produced(IEnumerable<InformationObjectBindingModel> sources){
                var result=new HashSet<int>();foreach(var source in sources.Where(Certain))for(var i=0;i<req.Length;i++){Spend();if(Matches(source,req[i]))result.Add(i);}return result;
            }
            var initial=Produced(bindings.Where(b=>b.Role=="Input"));
            var after=new Dictionary<string,HashSet<int>>(StringComparer.Ordinal);
            foreach(var id in order){
                var ins=In(id).Where(e=>reachable.Contains(e.SourceId)).ToArray();
                var before=ins.Length==0?new HashSet<int>(initial):new HashSet<int>(after[ins[0].SourceId]);
                if(ins.Length>1){
                    bool all=nodes[id].Type=="parallelGateway"&&confirmedJoins.Contains(id);
                    if(nodes[id].Type=="parallelGateway"&&!all)Warn("synchronization","Не подтверждена структурная синхронизация ["+id+"]; для доступности принят только общий набор входных ветвей.",id);
                    foreach(var e in ins.Skip(1)){Spend(before.Count+after[e.SourceId].Count);if(all)before.UnionWith(after[e.SourceId]);else before.IntersectWith(after[e.SourceId]);}
                }
                bool canProduce=true;
                foreach(var input in (nodes[id].InformationObjects??[]).Where(b=>b.Role=="Input"&&b.Required)){
                    var index=Array.FindIndex(req,b=>b.ObjectId.Equals(input.ObjectId,StringComparison.OrdinalIgnoreCase)&&(b.Version??"")== (input.Version??""));if(index<0)continue;
                    if(!string.IsNullOrWhiteSpace(input.Condition))Warn("conditional-input","Вход ["+input.ObjectId+"] этапа ["+id+"] условный: «"+input.Condition+"». Условие не вычисляется; обеспеченность требует сверки.",id+":"+index);
                    if(!before.Contains(index)){canProduce=false;if(string.IsNullOrWhiteSpace(input.Condition))Warn("input-unavailable","Обязательный вход ["+input.ObjectId+"]"+(string.IsNullOrWhiteSpace(input.Version)?"":" версии "+input.Version)+" не подтверждён до этапа ["+id+"] на всех ведущих к нему ветвях. Совпадение ID с поздним, условным или альтернативным производителем недостаточно.",id+":"+index);}
                }
                Spend(before.Count);if(canProduce)before.UnionWith(Produced((nodes[id].InformationObjects??[]).Where(b=>b.Role=="Output")));after[id]=before;
            }
            var ends=reachable.Where(id=>nodes[id].Type=="endEvent").ToArray();
            if(ends.Length==0||reachable.Any(id=>Out(id).Length==0&&nodes[id].Type!="endEvent"))Warn("termination","Есть незавершённый маршрут: обязательные результаты не подтверждены для всех завершений.");
            foreach(var output in bindings.Where(b=>b.Role=="Output"&&b.Required)){
                var index=Array.FindIndex(req,b=>b.ObjectId.Equals(output.ObjectId,StringComparison.OrdinalIgnoreCase)&&(b.Version??"")==(output.Version??""));if(index<0)continue;
                if(!string.IsNullOrWhiteSpace(output.Condition))Warn("conditional-output","Выход ["+output.ObjectId+"] условный: «"+output.Condition+"». Связь условия с завершениями требует ручной проверки.",output.ObjectId);
                else if(ends.Length==0||ends.Any(id=>!after[id].Contains(index)))Warn("output-unavailable","Обязательный выход ["+output.ObjectId+"] не подтверждён к каждому достижимому завершению детального процесса. Проверьте альтернативы, версии и обязательность результата.",output.ObjectId);
            }
            if(reachable.Count!=nodes.Count)Warn("unreachable","В детальном процессе есть недостижимые элементы; их документы не подтверждают обеспечение или результат границы.");
        }catch(Limit){Warn("limit","Достигнут бюджет "+budget+" операций. Анализ доступности границ неполный; отсутствие других замечаний не подтверждает результат.");}
        return issues;
    }
}
