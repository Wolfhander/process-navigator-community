using ProcessNavigator.Api.Models;

namespace ProcessNavigator.Api.Services;

public sealed partial class ProcessExecutionService
{
    public async Task<ProcessInstanceModel> AcceptReceiptAsync(string processId,string instanceId,ProcessReceiptUpdateModel request,
        string actorId,string actorName,CancellationToken ct=default)
    {
        await mutationLock.WaitAsync(ct);
        try
        {
            if(string.IsNullOrWhiteSpace(request.SourceProcessId)||request.SourceProcessId.Length>100 ||
                string.IsNullOrWhiteSpace(request.SourceInstanceId)||request.SourceInstanceId.Length>100 ||
                string.IsNullOrWhiteSpace(request.SourceElementId)||request.SourceElementId.Length>300 ||
                string.IsNullOrWhiteSpace(request.TargetElementId)||request.TargetElementId.Length>300 ||
                string.IsNullOrWhiteSpace(request.ObjectId)||request.ObjectId.Length>100 || request.SourceIteration<1 || request.TargetIteration<1)
                throw new InvalidDataException("Укажите процессы, выполнения, шаги, документ и положительные номера итераций.");
            if(string.IsNullOrWhiteSpace(request.Reason)||request.Reason.Trim().Length is <3 or >500 ||
                string.IsNullOrWhiteSpace(request.Version)||request.Version.Trim().Length>100)
                throw new InvalidDataException("Укажите версию результата (до 100 символов) и основание приёмки (3–500).");
            var targets=(await ReadAsync(processId,ct)).ToArray();
            var index=Array.FindIndex(targets,p=>p.Id==instanceId);
            if(index<0)throw new KeyNotFoundException("Выполнение-получатель не найдено.");
            var target=targets[index];
            if(target.Responsibility is null)throw new InvalidDataException("У старого выполнения нет исторического снимка ответственности.");
            var targetStep=target.Steps.SingleOrDefault(s=>s.ElementId==request.TargetElementId)??throw new InvalidDataException("Шаг-получатель не найден.");
            if(targetStep.Iteration!=request.TargetIteration)throw new InvalidDataException("Итерация получателя изменилась. Обновите данные.");
            var source=(await ReadAsync(request.SourceProcessId,ct)).SingleOrDefault(p=>p.Id==request.SourceInstanceId)??throw new KeyNotFoundException("Выполнение-источник не найдено.");
            if(source.Responsibility is null)throw new InvalidDataException("У источника нет исторического снимка.");
            var sourceStep=source.Steps.SingleOrDefault(s=>s.ElementId==request.SourceElementId)??throw new InvalidDataException("Шаг-источник не найден.");
            if(source.Status=="Cancelled")throw new InvalidDataException("Источник закрыт без успеха. Действительность его результата не подтверждена.");
            if(sourceStep.Iteration!=request.SourceIteration || sourceStep.Status!="Completed" ||
                sourceStep.ResultObjects?.Any(o=>o.ObjectId==request.ObjectId)!=true)
                throw new InvalidDataException("Нет завершённого шага с записанным результатом указанной итерации.");
            if(source.ProcessId==target.ProcessId&&source.Id==target.Id&&sourceStep.ElementId==targetStep.ElementId)
                throw new InvalidDataException("Шаг не может принять результат сам у себя.");
            var sourceNode=source.Responsibility.Process.Nodes.Single(n=>n.Id==sourceStep.ElementId);
            var targetNode=target.Responsibility.Process.Nodes.Single(n=>n.Id==targetStep.ElementId);
            var outputs=(sourceNode.InformationObjects??[]).Where(b=>b.ObjectId==request.ObjectId&&b.Role=="Output").ToArray();
            var inputs=(targetNode.InformationObjects??[]).Where(b=>b.ObjectId==request.ObjectId&&b.Role=="Input").ToArray();
            var version=request.Version.Trim();
            if(outputs.Length!=1||inputs.Length!=1||outputs.Concat(inputs).Any(b=>b.Version is not null && b.Version!=version))
                throw new InvalidDataException("Исторические вход/выход неоднозначны, не совпадают по ID или версии.");
            if(source.ProcessId==target.ProcessId&&source.Id==target.Id)
            {
                // A result may cross gateways/events, but never skip another
                // task or flow backwards into its producer.
                var reached=new HashSet<string>{sourceNode.Id};var queue=new Queue<string>();queue.Enqueue(sourceNode.Id);var found=false;var visits=0;
                while(queue.TryDequeue(out var id)){
                    foreach(var edge in source.Responsibility.Process.Edges.Where(e=>e.SourceId==id)){
                        if(++visits>10000)throw new InvalidDataException("Передача превышает предел обхода.");
                        if(edge.TargetId==targetNode.Id){found=true;continue;}
                        var node=source.Responsibility.Process.Nodes.SingleOrDefault(n=>n.Id==edge.TargetId);
                        if(node is not null&&node.Type!="task"&&reached.Add(node.Id))queue.Enqueue(node.Id);
                    }
                }
                if(!found)throw new InvalidDataException("Между шагами нет непосредственного пути передачи через события/шлюзы.");
            }
            var receipts=target.Receipts??[];
            var same=receipts.SingleOrDefault(r=>r.SourceProcessId==source.ProcessId&&r.SourceInstanceId==source.Id&&
                r.SourceElementId==sourceNode.Id&&r.SourceIteration==request.SourceIteration&&r.TargetElementId==targetNode.Id&&
                r.TargetIteration==request.TargetIteration&&r.ObjectId==request.ObjectId);
            if(same is not null){
                if(same.Version==version&&same.Reason==request.Reason.Trim()&&same.AcceptedBy==actorId)return target;
                throw new InvalidDataException("Такая передача уже принята. Историю нельзя заменить новым текстом.");
            }
            if(target.Status!="Active"||targetStep.Status is "Completed" or "Skipped")
                throw new InvalidDataException("Принять результат можно только в активное выполнение до завершения шага.");
            if(receipts.Count>=1000)throw new InvalidDataException("Предел журнала приёмки: 1000 записей на выполнение.");
            var receipt=new ProcessReceiptModel(Guid.NewGuid().ToString("N"),source.ProcessId,source.Responsibility.Process.Name,source.ProcessVersion,
                source.Id,sourceNode.Id,sourceNode.Name,sourceStep.Iteration,ResponsibilitySnapshot.DescribeExecution(source,sourceStep),
                targetNode.Id,targetNode.Name,targetStep.Iteration,ResponsibilitySnapshot.DescribeExecution(target,targetStep),
                request.ObjectId,version,request.Reason.Trim(),Now,actorId,actorName);
            targets[index]=target with{Receipts=receipts.Append(receipt).ToArray()};
            await WriteAsync(processId,targets,ct);return targets[index];
        }
        finally{mutationLock.Release();}
    }
}
