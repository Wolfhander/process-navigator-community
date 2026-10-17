import { useEffect, useState } from 'react';
import { assignInstanceSchedulePlan, loadInstanceSchedulePlans, loadInstances } from './api';
import type { InstanceSchedulePlan } from './instance-schedule-plan';
import { compareScheduleFact } from './schedule-fact';
import type { ProcessInstance, ProcessSchedule, ProcessScheduleRequest } from './types';

export function ScheduleFactPanel({ result, request, canAssign, dirty }: { result: ProcessSchedule; request?: ProcessScheduleRequest; canAssign: boolean; dirty: boolean }) {
  const [processId, setProcessId] = useState('');
  const [instances, setInstances] = useState<ProcessInstance[]>([]);
  const [instanceId, setInstanceId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(new Date().toISOString());
  const [plans, setPlans] = useState<InstanceSchedulePlan[]>([]);
  const [plansKey, setPlansKey] = useState('');
  const [planError, setPlanError] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [useBaseline, setUseBaseline] = useState(true);
  useEffect(() => {
    let current = true;
    setInstances([]); setError(''); setLoading(!!processId);
    if (processId) loadInstances(processId).then(items => { if (current) { setInstances(items); setNow(new Date().toISOString()); } })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить выполнения.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [processId, refresh, result]);
  const key = `${processId}:${instanceId}`;
  useEffect(() => {
    let current = true;
    setPlansKey(''); setPlanError(''); setReason('');
    if (processId && instanceId) loadInstanceSchedulePlans(processId, instanceId)
      .then(items => { if (current) { setPlans(items); setPlansKey(`${processId}:${instanceId}`); } })
      .catch(cause => { if (current) setPlanError(cause instanceof Error ? cause.message : 'Не удалось прочитать планы.'); });
    return () => { current = false; };
  }, [processId, instanceId, refresh]);
  const history = plansKey === key ? plans : [];
  const baseline = history.at(-1);
  const calculatedPlan = result.processes.find(item => item.processId === processId);
  const plan = useBaseline && baseline ? baseline.item : calculatedPlan;
  const instance = instances.find(item => item.id === instanceId);
  const assign = async () => {
    if (!request || !calculatedPlan || !instance || dirty || plansKey !== key) return;
    const version = result.sources?.processes.find(item => item.id === processId)?.version;
    if (!version) return;
    setSaving(true); setPlanError('');
    try {
      const assigned = await assignInstanceSchedulePlan(processId, instanceId, request, calculatedPlan.startAt,
        calculatedPlan.endAt, version, baseline?.id ?? null, reason, result.sources);
      setPlans([...history, assigned]); setReason(''); setUseBaseline(true);
    } catch (cause) { setPlanError(cause instanceof Error ? cause.message : 'Не удалось назначить план.'); }
    finally { setSaving(false); }
  };
  let comparison: ReturnType<typeof compareScheduleFact> | undefined;
  let comparisonError = '';
  try { if (plan && instance) comparison = compareScheduleFact(plan, instance, now); }
  catch (cause) { comparisonError = cause instanceof Error ? cause.message : 'Ошибка сравнения.'; }
  const hours = (value: number) => `${value > 0 ? '+' : ''}${Number(value.toFixed(2))} ч`;
  const date = (value: string) => new Date(value).toLocaleString('ru-RU');
  const source = (useBaseline && baseline ? baseline.sources : result.sources)?.processes.find(item => item.id === processId);
  return <details className="schedule-scenario"><summary>Сравнить расчёт с выполнением процесса</summary>
    <p>Выберите выполнение для сравнения. Базовый план хранится на сервере отдельно от норм шагов и факта. Назначение повторно рассчитывает опубликованные модели; при изменении дат запись отклоняется.</p>
    {dirty && <p role="status">Параметры изменены. Ниже сравнивается последний показанный результат, а не несохранённые изменения формы.</p>}
    <label>Процесс из расчёта<select value={processId} disabled={saving} onChange={event => { setProcessId(event.target.value); setInstanceId(''); }}><option value="">Выберите процесс</option>{result.processes.map(item => <option key={item.processId} value={item.processId}>{item.processName}</option>)}</select></label>
    {processId && <><button disabled={loading || saving} onClick={() => setRefresh(value => value + 1)}>Обновить факт и планы</button><label>Экземпляр<select value={instanceId} disabled={loading || saving} onChange={event => setInstanceId(event.target.value)}><option value="">{loading ? 'Загрузка…' : 'Выберите выполнение'}</option>{instances.map(item => <option key={item.id} value={item.id}>{item.name} · {date(item.startedAt)} · {item.id.slice(0, 8)}</option>)}</select></label>{!loading && !error && !instances.length && <p>У процесса пока нет выполнений.</p>}</>}
    {(error || comparisonError || planError) && <p role="alert">{error || comparisonError || planError}</p>}
    {baseline && <label><input type="checkbox" checked={useBaseline} onChange={event => setUseBaseline(event.target.checked)}/>Сравнивать с назначенным базовым планом, а не показанным расчётом</label>}
    {instance && canAssign && (instance.status === 'Active' || instance.status === 'Paused') && <div><label>Причина назначения / перепланирования<textarea maxLength={500} value={reason} disabled={saving} onChange={event => setReason(event.target.value)}/></label><button disabled={saving || dirty || plansKey !== key || !request || reason.trim().length < 3 || !result.complete || !calculatedPlan?.isDateReliable} onClick={assign}>{saving ? 'Сохраняем…' : baseline ? 'Заменить базовый план показанным расчётом' : 'Назначить показанный расчёт базовым планом'}</button><p>Только полный расчёт с достоверными датами и совпадающей версией. Пауза не переносит срок; для переноса нужен новый расчёт и причина.</p></div>}
    {!!history.length && <details><summary>История базового плана ({history.length})</summary>{history.slice().reverse().map(item => <article key={item.id}><strong>{date(item.assignedAt)} · {item.assignedBy}</strong><p>{date(item.item.startAt)} → {date(item.item.endAt)} · версия {item.processVersion}</p><p>{item.reason}</p></article>)}</details>}
    {comparison && plan && instance && <section aria-label="План и факт"><p>План: {date(plan.startAt)} → {date(plan.endAt)}. Факт запуска: {date(instance.startedAt)}. Отклонение запуска: {hours(comparison.startDeltaHours)}.</p>
      {source?.version !== instance.processVersion && <p role="status">Версии отличаются или версия снимка неизвестна. План: {source?.version ?? 'неизвестна'}; выполнение: {instance.processVersion}. Сопоставление ориентировочное.</p>}
      {!plan.isDateReliable && <p>Расчёт предварительный: {plan.uncertaintyReasons.join('; ')}</p>}
      <p>{comparison.state === 'completed' ? `Завершён: ${date(instance.completedAt!)}. Отклонение окончания: ${hours(comparison.finishDeltaHours!)}.` : comparison.state === 'cancelled' ? 'Отменён: отклонение завершения не вычисляется.' : comparison.state === 'missing-fact' ? 'Статус «Завершён», но дата окончания отсутствует.' : `${comparison.state === 'paused' ? 'Приостановлен' : 'В работе'}. Текущая просрочка: ${hours(comparison.finishDeltaHours!)}. Это не прогноз завершения.`}</p>
      <p>Состояние на {date(now)}. Положительное отклонение — позже плана; отрицательное — раньше. Часы календарные, включая выходные и паузы. Пауза не переносит контрольную дату.</p>
    </section>}
  </details>;
}
