using ProcessNavigator.Api.Models;
namespace ProcessNavigator.Api.Services;
public sealed record ExecutionTimingValue(double? Queue,double? Work,double? Total,double? Overdue,
    [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] double? EventWait=null);
// Active elapsed minutes, excluding instance pauses; not a business-calendar calculation.
public static class ExecutionTiming
{
    private static double? Fact(double? n)=>n.HasValue&&double.IsFinite(n.Value)&&n>=0?n:null;
    public static ExecutionTimingValue Measure(ProcessInstanceModel instance,StepExecutionModel step,DateTimeOffset now)
    {
        if(step.Status=="Skipped")return new(null,null,null,null);
        var completed=step.Status=="Completed";
        DateTimeOffset? cutoff=now;
        if(instance.Status=="Paused")cutoff=(instance.LifecycleEvents??[]).Where(e=>e.ToStatus=="Paused").OrderBy(e=>e.OccurredAt).LastOrDefault()?.OccurredAt;
        if(instance.Status=="Cancelled")cutoff=(instance.LifecycleEvents??[]).Where(e=>e.ToStatus=="Cancelled").OrderBy(e=>e.OccurredAt).LastOrDefault()?.OccurredAt??instance.CompletedAt;
        if(instance.Status=="Completed")cutoff=instance.CompletedAt;
        var end=step.CompletedAt??cutoff;
        var available=step.AvailableAt??step.StartedAt;
        double? queue=available.HasValue&&end.HasValue?ActiveMinutes(instance,available.Value,step.StartedAt??end.Value):null;
        double? work=end.HasValue?(step.StartedAt.HasValue?ActiveMinutes(instance,step.StartedAt.Value,end.Value):0):null;
        if(completed){queue=Fact(step.ActualQueueMinutes)??queue;work=Fact(step.ActualWorkMinutes)??work;}
        var total=(completed?Fact(step.ActualDurationMinutes):null)??(queue.HasValue&&work.HasValue?queue+work:null);
        double? eventWait=null;
        if(step.Waiting is not null){
            work=0;
            var waitEnd=step.Waiting.ResolvedAt??step.CompletedAt??(instance.Status=="Paused"?now:end);
            eventWait=step.StartedAt.HasValue&&waitEnd.HasValue?Math.Max(0,(waitEnd.Value-step.StartedAt.Value).TotalMinutes):0;
            if(completed)eventWait=Fact(step.ActualEventWaitMinutes)??eventWait;
            total=queue+eventWait;
        }
        var norm=Fact(step.PlannedDurationMinutes);
        var overdue=(completed?Fact(step.OverdueMinutes):null)??(total.HasValue&&norm>0?Math.Max(0,total.Value-norm.Value):null);
        static double? Round(double? v)=>v.HasValue?Math.Floor(v.Value*100+0.5)/100:null;
        return new(Round(queue),Round(work),Round(total),Round(overdue),Round(eventWait));
    }
    public static double ActiveMinutes(ProcessInstanceModel instance,DateTimeOffset from,DateTimeOffset to)
    {
        if(to<=from)return 0;
        DateTimeOffset? pausedAt=null;double paused=0;
        double Overlap(DateTimeOffset a,DateTimeOffset b)=>Math.Max(0,((b<to?b:to)-(a>from?a:from)).TotalMinutes);
        foreach(var e in (instance.LifecycleEvents??[]).OrderBy(e=>e.OccurredAt)){
            if(e.ToStatus=="Paused"&&!pausedAt.HasValue)pausedAt=e.OccurredAt;
            if(e.FromStatus=="Paused"&&pausedAt.HasValue){paused+=Overlap(pausedAt.Value,e.OccurredAt);pausedAt=null;}
        }
        if(pausedAt.HasValue)paused+=Overlap(pausedAt.Value,to);
        return Math.Max(0,(to-from).TotalMinutes-paused);
    }
}
