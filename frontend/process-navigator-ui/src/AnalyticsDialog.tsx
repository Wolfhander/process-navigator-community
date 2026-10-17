import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, ArrowLeft } from 'lucide-react';
import { loadProcessAnalytics } from './api';
import type { ProcessAnalytics } from './types';

type Props = { processId: string; processName: string; onClose: () => void; onSelectStep: (elementId: string) => void };

function duration(value?: number) {
  if (value == null) return '—';
  if (value < 60) return `${Math.round(value)} мин`;
  if (value < 480) return `${(value / 60).toFixed(1)} ч`;
  return `${(value / 480).toFixed(1)} раб. дн.`;
}

export function AnalyticsDialog({ processId, processName, onClose, onSelectStep }: Props) {
  const [data, setData] = useState<ProcessAnalytics>();
  const [error, setError] = useState('');
  useEffect(() => { loadProcessAnalytics(processId).then(setData).catch(reason => setError(reason.message)); }, [processId]);
  const steps = useMemo(() => data?.steps.slice().sort((a, b) => (b.overdueCount - a.overdueCount) || ((b.averageMinutes ?? -1) - (a.averageMinutes ?? -1))) ?? [], [data]);
  const maximum = Math.max(1, ...steps.map(step => step.averageMinutes ?? 0));

  return <main className="process-analytics-page">
    <section className="analytics-dialog" aria-label="Аналитика процесса">
      <button className="portfolio-refresh" onClick={onClose}><ArrowLeft size={17}/>К процессу</button>
      <span className="eyebrow">Аналитика выполнения · {processName}</span><h2>Время и узкие места</h2>
      <p>Фактические показатели рассчитываются по сохранённым экземплярам процесса. Выберите шаг, чтобы перейти к нему на схеме.</p>
      {error && <div className="import-message is-error"><AlertTriangle size={17}/><span>{error}</span></div>}
      {!data && !error && <div className="version-loading"><div className="loader"/>Собираем показатели…</div>}
      {data && <>
        <div className="analytics-summary">
          <article><Activity size={17}/><span>Всего прохождений<strong>{data.totalInstances}</strong></span></article>
          <article><Clock3 size={17}/><span>Активных<strong>{data.activeInstances}</strong></span></article>
          <article><CheckCircle2 size={17}/><span>Завершено<strong>{data.completedInstances}</strong></span></article>
          <article><BarChart3 size={17}/><span>Средний цикл<strong>{duration(data.averageCycleMinutes)}</strong></span></article>
        </div>
        <div className="analytics-heading"><strong>Шаги процесса</strong><span>среднее / максимум</span></div>
        <div className="analytics-steps">
          {steps.map(step => <button key={step.elementId} className={step.overdueCount ? 'is-overdue' : ''} onClick={() => onSelectStep(step.elementId)}>
            <div className="analytics-step-title"><span><strong>{step.name}</strong><small>{step.laneName}{step.norm ? ` · норматив ${step.norm}` : ''}</small></span>{step.overdueCount > 0 && <em><AlertTriangle size={12}/>{step.overdueCount} превыш.</em>}</div>
            <div className="analytics-bar"><i style={{ width: `${((step.averageMinutes ?? 0) / maximum) * 100}%` }}/></div>
            <div className="analytics-step-facts"><span>Среднее <strong>{duration(step.averageMinutes)}</strong></span><span>Максимум <strong>{duration(step.maximumMinutes)}</strong></span><span>Завершено <strong>{step.completedCount}</strong></span><span>В работе <strong>{step.inProgressCount}</strong></span></div>
          </button>)}
          {!steps.length && <div className="empty-collection">В процессе пока нет задач для анализа.</div>}
        </div>
      </>}
    </section>
  </main>;
}
