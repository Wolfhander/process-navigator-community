import type { ProcessInstance, ProcessScheduleItem } from './types';

// Calendar elapsed hours, deliberately separate from working-time step norms.
export function compareScheduleFact(plan: ProcessScheduleItem, instance: ProcessInstance, now: string) {
  if (plan.processId !== instance.processId) throw new Error('Экземпляр относится к другому процессу.');
  const date = (value: string) => {
    const result = Date.parse(value);
    if (!Number.isFinite(result)) throw new Error('Не удалось прочитать дату плана или выполнения.');
    return result;
  };
  const startDeltaHours = (date(instance.startedAt) - date(plan.startAt)) / 3600000;
  const end = date(plan.endAt);
  if (end < date(plan.startAt)) throw new Error('Окончание плана раньше начала.');
  if (instance.status === 'Cancelled') return { startDeltaHours, finishDeltaHours: null, state: 'cancelled' as const };
  if (instance.status === 'Completed') {
    if (!instance.completedAt) return { startDeltaHours, finishDeltaHours: null, state: 'missing-fact' as const };
    const completed = date(instance.completedAt);
    if (completed < date(instance.startedAt)) throw new Error('Окончание выполнения раньше запуска.');
    return { startDeltaHours, finishDeltaHours: (completed - end) / 3600000, state: 'completed' as const };
  }
  return { startDeltaHours, finishDeltaHours: Math.max(0, (date(now) - end) / 3600000), state: instance.status === 'Paused' ? 'paused' as const : 'active' as const };
}
