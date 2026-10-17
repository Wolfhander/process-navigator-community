import { useState } from 'react';
import { loadInstanceSchedulePlans } from './api';
import type { InstanceSchedulePlan } from './instance-schedule-plan';
import type { ProcessInstance } from './types';
import { compareScheduleFact } from './schedule-fact';
import { SchedulePlanFreshnessPanel } from './SchedulePlanFreshnessPanel';

export function InstanceScheduleSummary({ instance }: { instance: ProcessInstance }) {
  const [plans, setPlans] = useState<InstanceSchedulePlan[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date().toISOString());
  const load = async () => {
    setBusy(true); setError('');
    try { setPlans(await loadInstanceSchedulePlans(instance.processId, instance.id)); setNow(new Date().toISOString()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось прочитать план.'); }
    finally { setBusy(false); }
  };
  const baseline = plans?.at(-1);
  let fact = '';
  try {
    if (baseline) {
      const compared = compareScheduleFact(baseline.item, instance, now);
      fact = compared.state === 'cancelled' ? 'Выполнение отменено; завершение не оценивается.'
        : compared.state === 'missing-fact' ? 'Дата фактического завершения отсутствует.'
        : `${compared.state === 'completed' ? 'Отклонение окончания' : 'Текущая просрочка'}: ${Number(compared.finishDeltaHours!.toFixed(2))} календарных ч.`;
    }
  } catch { fact = 'Не удалось сопоставить даты плана и выполнения.'; }
  const date = (value: string) => new Date(value).toLocaleString('ru-RU');
  return <details className="execution-history" onToggle={event => { if (event.currentTarget.open && plans === undefined && !busy && !error) void load(); }}>
    <summary>Календарный план и факт</summary>
    {busy && <p>Загружаем план…</p>}{error && <p role="alert">{error}</p>}
    {!busy && <button onClick={load}>Обновить план</button>}
    {plans && !plans.length && <p>Базовый план не назначен. Назначить его можно на странице «Расчёт сроков».</p>}
    {baseline && <><p>Базовое окончание: {date(baseline.item.endAt)}. {fact}</p><p>По состоянию на {date(now)}. Пауза не переносит календарный срок. Отрицательное отклонение — раньше плана.</p>
      <SchedulePlanFreshnessPanel key={baseline.id} plan={baseline}/>
      {plans!.slice().reverse().map(plan => <div key={plan.id}><strong>{date(plan.assignedAt)} · {plan.assignedBy}</strong><span>{date(plan.item.startAt)} → {date(plan.item.endAt)} · {plan.reason}</span></div>)}
    </>}
  </details>;
}
