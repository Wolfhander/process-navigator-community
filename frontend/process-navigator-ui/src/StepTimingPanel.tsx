import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Hourglass } from 'lucide-react';
import { formatMinutes, stepTiming } from './execution-timing';
import type { ProcessInstance, StepExecution } from './types';

const dateTime = (value?: string) => value ? new Date(value).toLocaleString('ru-RU') : 'не рассчитан';

export function StepTimingPanel({ instance, step }: { instance: ProcessInstance; step: StepExecution }) {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (step.status !== 'InProgress' || instance.status !== 'Active') return;
    const timer = window.setInterval(() => refresh(value => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, [instance.status, step.status]);
  if (!step.availableAt && !step.startedAt) return null;
  const timing = stepTiming(instance, step);
  const overdue = (timing.overdue ?? 0) > 0;
  return <section className={`step-timing${overdue ? ' is-overdue' : ''}`}><h3>План и факт</h3>
    <div className="step-timing-grid">
      <article><CalendarClock size={16}/><span>Доступен с<strong>{dateTime(step.availableAt)}</strong></span></article>
      <article><Clock3 size={16}/><span>План завершения<strong>{dateTime(step.plannedCompletedAt)}</strong></span></article>
      <article><Hourglass size={16}/><span>До начала / передача<strong>{formatMinutes(timing.queue)}</strong></span></article>
      <article><CheckCircle2 size={16}/><span>Фактическая работа<strong>{formatMinutes(timing.work)}</strong></span></article>
    </div>
    {step.normText ? <p className="step-timing-norm">Снимок норматива: {step.normText}{step.plannedDurationMinutes !== undefined ? ` · всего ${formatMinutes(step.plannedDurationMinutes)}` : ''}</p> : <p className="step-timing-norm is-missing">Норматив шага не задан — просрочка не рассчитывается.</p>}
    {overdue && <div className="step-timing-alert"><AlertTriangle size={15}/>Отклонение от норматива: {formatMinutes(timing.overdue)}</div>}
  </section>;
}
