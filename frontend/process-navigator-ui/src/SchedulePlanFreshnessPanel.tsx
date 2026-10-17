import { useState } from 'react';
import { checkInstanceSchedulePlan } from './api';
import type { InstanceSchedulePlan, SchedulePlanFreshness } from './instance-schedule-plan';
import './schedule-freshness.css';

const labels: Record<SchedulePlanFreshness['status'], string> = {
  Current: 'Исходники и даты совпадают', Changed: 'План требует проверки: исходники или расчёт изменились',
  Unavailable: 'Актуальность не установлена: пересчёт не выполнен',
  NoPlan: 'Базовый план не назначен', Superseded: 'План заменён во время проверки'
};

// Parents key this component by baseline ID: a report never migrates to a replacement plan.
export function SchedulePlanFreshnessPanel({ plan }: { plan: InstanceSchedulePlan }) {
  const [report, setReport] = useState<SchedulePlanFreshness>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true); setError(''); setReport(undefined);
    try { setReport(await checkInstanceSchedulePlan(plan.processId, plan.instanceId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Актуальность плана не установлена.'); }
    finally { setBusy(false); }
  };
  const matches = report?.planId === plan.id && report.status !== 'Superseded';
  const label = report && !matches && report.status !== 'NoPlan' && report.status !== 'Superseded'
    ? 'Результат относится к другой редакции плана' : report ? labels[report.status] ?? 'Актуальность не установлена' : '';
  const date = (value: string) => new Date(value).toLocaleString('ru-RU');
  return <section className="schedule-freshness" aria-label="Актуальность базового плана">
    <h4>Актуальность базового плана</h4>
    <p>Проверка пересчитывает опубликованные модели с сохранёнными параметрами и календарями. Базовый срок и история не изменяются.</p>
    <button disabled={busy} onClick={check}>{busy ? 'Проверяем…' : 'Проверить актуальность плана'}</button>
    {error && <p role="alert">{error}</p>}
    {!report && !error && !busy && <p>Проверка ещё не выполнялась в этом окне. Изменения исходников автоматически не отслеживаются.</p>}
    {report && <><p role="status"><strong>{label}</strong> · {date(report.checkedAt)}</p>
      {!matches && <p>Этот результат не подтверждает показанный план. Обновите историю базового плана и повторите проверку.</p>}
      {matches && <>
        {report.status === 'Current' && <p>Совпадение с сохранёнными исходниками — не гарантия полноты описания или фактического срока.</p>}
        {!!report.changes.length && <ul>{report.changes.map((item, index) => <li key={`${item.kind}:${item.id}:${index}`}><strong>{item.name}</strong> ({item.id}): {item.message}</li>)}</ul>}
        {report.totalChanges > report.changes.length && <p>Показаны первые {report.changes.length} из {report.totalChanges} различий.</p>}
        {report.currentItem && <p>Результат нового пересчёта: {date(report.currentItem.startAt)} → {date(report.currentItem.endAt)}.
          {report.finishShiftHours != null && ` Сдвиг окончания: ${report.finishShiftHours > 0 ? '+' : ''}${report.finishShiftHours} календарных ч.`}
          {!report.currentItem.isDateReliable && ' Даты предварительные.'} Это не новый базовый план и не прогноз по текущему состоянию выполнения.</p>}
      </>}
    </>}
  </section>;
}
