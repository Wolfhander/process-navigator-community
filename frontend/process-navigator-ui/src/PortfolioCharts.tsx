import type { PortfolioAnalytics } from './types';

export function PortfolioCharts({ data }: { data: PortfolioAnalytics }) {
  const total = data.totalInstances;
  const completed = total ? Math.min(100, data.completedInstances / total * 100) : 0;
  const buckets = [
    { label: '0–24%', count: data.processes.filter(p => p.readinessPercent < 25).length },
    { label: '25–49%', count: data.processes.filter(p => p.readinessPercent >= 25 && p.readinessPercent < 50).length },
    { label: '50–74%', count: data.processes.filter(p => p.readinessPercent >= 50 && p.readinessPercent < 75).length },
    { label: '75–100%', count: data.processes.filter(p => p.readinessPercent >= 75).length },
  ];
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const quality = [
    { label: 'Назначен владелец', value: data.processesWithOwner },
    { label: 'Все дорожки привязаны', value: data.processes.filter(p => p.laneCount > 0 && p.mappedLaneCount === p.laneCount).length },
    { label: 'Все задачи полностью описаны', value: data.processes.filter(p => p.taskCount > 0 && p.describedTaskCount === p.taskCount).length },
    { label: 'Заданы все нормативы', value: data.processesWithAllDurations },
    { label: 'Указаны системы выполнения', value: data.processesWithSystems },
  ];
  return <div className="analytics-charts">
    <section className="analytics-chart"><h3>Состояние выполнений</h3>{total ? <><svg viewBox="0 0 220 180" role="img" aria-label={`${data.completedInstances} завершено, ${data.activeInstances} активно`}><circle cx="110" cy="82" r="60" fill="none" stroke="#dae7de" strokeWidth="19"/><circle cx="110" cy="82" r="60" fill="none" stroke="#376f50" strokeWidth="19" pathLength="100" strokeDasharray={`${completed} ${100 - completed}`} transform="rotate(-90 110 82)"/><text x="110" y="80" textAnchor="middle" fontSize="28" fill="#274f3a">{total}</text><text x="110" y="101" textAnchor="middle" fontSize="11" fill="#68736c">выполнений</text></svg><div className="chart-legend"><span><i style={{ background: '#376f50' }}/>{data.completedInstances} завершено</span><span><i style={{ background: '#dae7de' }}/>{data.activeInstances} активно</span></div></> : <p>Выполнений пока нет. После запуска экземпляров здесь появится фактическая статистика, а не демонстрационные значения.</p>}</section>
    <section className="analytics-chart"><h3>Готовность моделей</h3><div className="histogram" role="img" aria-label={buckets.map(b => `${b.label}: ${b.count} процессов`).join('; ')}>{buckets.map(b => <div key={b.label}><strong>{b.count}</strong><i style={{ height: `${b.count / maxCount * 120}px` }}/><small>{b.label}</small></div>)}</div><p>Распределение процессов по полноте описания. Это не оценка эффективности выполнения.</p></section>
    <section className="analytics-chart"><h3>Качество описания</h3><div className="portfolio-bars">{quality.map(item => <div key={item.label}><span>{item.label}</span><i><b style={{ width: `${data.totalProcesses ? item.value / data.totalProcesses * 100 : 0}%` }}/></i><strong>{item.value}</strong></div>)}</div><p>Число процессов из {data.totalProcesses}, удовлетворяющих каждому критерию. Один процесс может входить сразу в несколько показателей.</p></section>
  </div>;
}
