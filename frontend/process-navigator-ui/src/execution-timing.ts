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
  for (const event of [...(instance.lifecycleEvents ?? [])].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const at = new Date(event.occurredAt).getTime();
    if (event.toStatus === 'Paused') pausedAt = at;
    if (event.fromStatus === 'Paused' && pausedAt !== undefined) {
      paused += overlapMinutes(pausedAt, at, start, end);
      pausedAt = undefined;
    }
  }
  if (pausedAt !== undefined) paused += overlapMinutes(pausedAt, end, start, end);
  return Math.max(0, (end - start) / 60000 - paused);
}

export function stepTiming(instance: ProcessInstance, step: StepExecution, now = Date.now()) {
  const effectiveNow = instance.status === 'Paused'
    ? new Date([...(instance.lifecycleEvents ?? [])].reverse().find(item => item.toStatus === 'Paused')?.occurredAt ?? now).getTime()
    : now;
  const end = step.completedAt ? new Date(step.completedAt).getTime() : effectiveNow;
  const queue = step.actualQueueMinutes ?? activeMinutes(instance, step.availableAt, step.startedAt ?? end);
  const work = step.actualWorkMinutes ?? (step.startedAt ? activeMinutes(instance, step.startedAt, end) : 0);
  const total = step.actualDurationMinutes ?? queue + work;
  const overdue = step.overdueMinutes ?? (step.plannedDurationMinutes !== undefined ? Math.max(0, total - step.plannedDurationMinutes) : undefined);
  return { queue, work, total, overdue };
}

export const formatMinutes = (value: number | undefined) => value === undefined
  ? 'не рассчитано'
  : value >= 60 ? `${(value / 60).toFixed(value % 60 === 0 ? 0 : 1)} ч` : `${Math.max(0, Math.round(value))} мин`;
