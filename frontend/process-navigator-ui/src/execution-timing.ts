import type { ProcessInstance, StepExecution } from './types';

const overlapMinutes = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / 60000;

export function activeMinutes(instance: ProcessInstance, from: string | undefined, to: string | number | undefined): number {
  if (!from || to === undefined) return 0;
  const start = new Date(from).getTime();
  const end = typeof to === 'number' ? to : new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  let pausedAt: number | undefined;
  let paused = 0;
  for (const event of [...(instance.lifecycleEvents ?? [])].sort((a, b) => Date.parse(a.occurredAt)-Date.parse(b.occurredAt))) {
    const at = new Date(event.occurredAt).getTime();
    if (event.toStatus === 'Paused' && pausedAt===undefined) pausedAt = at;
    if (event.fromStatus === 'Paused' && pausedAt !== undefined) {
      paused += overlapMinutes(pausedAt, at, start, end);
      pausedAt = undefined;
    }
  }
  if (pausedAt !== undefined) paused += overlapMinutes(pausedAt, end, start, end);
  return Math.max(0, (end - start) / 60000 - paused);
}

export function stepTiming(instance: ProcessInstance, step: StepExecution, now = Date.now()) {
  if(step.status==='Skipped')return{queue:undefined,work:undefined,total:undefined,overdue:undefined};
  const fact=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:undefined;
  const date=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s))?Date.parse(s):undefined;
  const eventAt=(status:string)=>(instance.lifecycleEvents??[]).filter(e=>e.toStatus===status).map(e=>date(e.occurredAt)).filter((v):v is number=>v!==undefined).sort((a,b)=>a-b).at(-1);
  let cutoff:number|undefined=now;
  if(instance.status==='Paused')cutoff=eventAt('Paused');
  if(instance.status==='Cancelled')cutoff=eventAt('Cancelled')??date(instance.completedAt);
  if(instance.status==='Completed')cutoff=date(instance.completedAt);
  const completed=step.status==='Completed',end=date(step.completedAt)??cutoff,available=step.availableAt??step.startedAt;
  let queue=available&&end!==undefined?activeMinutes(instance,available,step.startedAt??end):undefined;
  let work=end!==undefined?(step.startedAt?activeMinutes(instance,step.startedAt,end):0):undefined;
  if(completed){queue=fact(step.actualQueueMinutes)??queue;work=fact(step.actualWorkMinutes)??work;}
  let total=(completed?fact(step.actualDurationMinutes):undefined)??(queue!==undefined&&work!==undefined?queue+work:undefined);
  let eventWait:number|undefined;
  if(step.waiting){
    const waitEnd=date(step.waiting.resolvedAt)??date(step.completedAt)??(instance.status==='Paused'?now:end);
    eventWait=step.startedAt&&waitEnd!==undefined?Math.max(0,(waitEnd-Date.parse(step.startedAt))/60000):0;
    if(completed)eventWait=fact(step.actualEventWaitMinutes)??eventWait;
    work=0;total=queue!==undefined?queue+eventWait:undefined;
  }
  const norm=fact(step.plannedDurationMinutes);
  const overdue=(completed?fact(step.overdueMinutes):undefined)??(total!==undefined&&norm!==undefined&&norm>0?Math.max(0,total-norm):undefined);
  const round=(v:number|undefined)=>v===undefined?undefined:Math.round(v*100)/100;
  return {queue:round(queue),work:round(work),total:round(total),overdue:round(overdue),...(step.waiting?{eventWait:round(eventWait)}:{})};
}

export const formatMinutes = (value: number | undefined) => typeof value!=='number'||!Number.isFinite(value)
  ? 'не рассчитано'
  : value >= 60 ? `${(value / 60).toFixed(value % 60 === 0 ? 0 : 1)} ч` : `${Math.max(0, Math.round(value))} мин`;
