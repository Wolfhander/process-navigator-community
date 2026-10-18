import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Activity, AlertTriangle, BarChart3, Building2, CheckCircle2, Clock3, FileWarning, GitBranch, Layers3, MonitorCog, Search, ShieldCheck, RefreshCw } from 'lucide-react';
import { loadPortfolioAnalytics } from './api';
import type { PortfolioAnalytics } from './types';
import './portfolio-analytics.css';
import { PortfolioCharts } from './PortfolioCharts';
import { AnalyticsWorkspaceControls } from './AnalyticsWorkspaceControls';
import { PortfolioHistoryPanel } from './PortfolioHistoryPanel';
import { DocumentAnalyticsPanel } from './DocumentAnalyticsPanel';
import { TransferAnalyticsPanel } from './TransferAnalyticsPanel';
import { analyticsCsv, defaultAnalyticsSelection, selectAnalyticsProcesses, type AnalyticsView, type AnalyticsFilter, type AnalyticsMetric } from './analytics-workspace';

type Props = { profileId: string; onClose: () => void; onOpenProcess: (id: string) => void };
type View = AnalyticsView;

function percent(value: number, total: number) { return total ? Math.round(value / total * 100) : 0; }
function duration(value?: number) {
  if (value == null) return '—';
  if (value < 60) return `${Math.round(value)} мин`;
  if (value < 480) return `${(value / 60).toFixed(1)} ч`;
  return `${(value / 480).toFixed(1)} раб. дн.`;
}

export function PortfolioAnalyticsDialog({ profileId, onClose, onOpenProcess }: Props) {
  const [data, setData] = useState<PortfolioAnalytics>();
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AnalyticsFilter>('all');
  const [metrics, setMetrics] = useState<AnalyticsMetric[]>([...defaultAnalyticsSelection.metrics]);
  const [loadedAt, setLoadedAt] = useState('');
  const [exportError, setExportError] = useState('');

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); setError(''); try { setData(await loadPortfolioAnalytics()); setLoadedAt(new Date().toISOString()); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить аналитику.'); } finally { setRefreshing(false); } };
  useEffect(() => { void refresh(); }, []);
  const processes = useMemo(() => data ? selectAnalyticsProcesses(data, query, filter) : [], [data, query, filter]);
  function exportCsv(scope: 'portfolio' | 'processes') {
    if (!data) return;
    try {
      const csv = analyticsCsv(data, { view, query, filter, metrics }, scope, loadedAt);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'process-analytics-' + scope + '.csv'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setExportError('');
    } catch { setExportError('Не удалось подготовить выгрузку. Обновите данные и повторите.'); }
  }

  return <main className="portfolio-page">
    <section className="portfolio-dialog" aria-label="Аналитика портфеля процессов">
      <header className="portfolio-header">
        <div><span className="eyebrow">Корпоративная аналитика</span><h2>Портфель бизнес-процессов</h2><p>Охват, качество моделей, участие подразделений и фактическое выполнение.</p></div>
        <button className="portfolio-refresh" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16}/>{refreshing ? 'Обновление…' : 'Обновить данные'}</button>
      </header>
      <nav className="portfolio-tabs" aria-label="Разделы аналитики">
        <button className={view === 'documents' ? 'is-active' : ''} onClick={() => setView('documents')}><FileWarning size={15}/>Документы и передачи</button>
        <button className={view === 'overview' ? 'is-active' : ''} onClick={() => setView('overview')}><BarChart3 size={15}/>Обзор</button>
        <button className={view === 'processes' ? 'is-active' : ''} onClick={() => setView('processes')}><Layers3 size={15}/>Процессы</button>
        <button className={view === 'departments' ? 'is-active' : ''} onClick={() => setView('departments')}><Building2 size={15}/>Подразделения</button>
        <button className={view === 'systems' ? 'is-active' : ''} onClick={() => setView('systems')}><MonitorCog size={15}/>Системы и уровни</button>
        <button className={view === 'history' ? 'is-active' : ''} onClick={() => setView('history')}><Clock3 size={15}/>История и сравнение</button>
      </nav>
      {error && <div className="portfolio-error"><AlertTriangle size={17}/>{error}</div>}
      {!data && !error && <div className="portfolio-loading"><div className="loader"/>Собираем показатели по всему репозиторию…</div>}
      {data && <div className="portfolio-content">
        {error && <p role="status">Показаны ранее загруженные данные от {loadedAt}; обновление не удалось.</p>}
        <AnalyticsWorkspaceControls profileId={profileId} current={{ view, query, filter, metrics }} loadedAt={loadedAt} count={processes.length} total={data.processes.length} onChange={next => { setView(next.view); setQuery(next.query); setFilter(next.filter); setMetrics(next.metrics); }} onExport={exportCsv}/>
        {exportError && <p role="alert">{exportError}</p>}
        {view === 'history' && <PortfolioHistoryPanel data={data} onOpenProcess={onOpenProcess}/>}
        {view === 'documents' && <><DocumentAnalyticsPanel onOpenProcess={onOpenProcess}/><TransferAnalyticsPanel onOpenProcess={onOpenProcess}/></>}
        {view === 'overview' && <>
          <div className="portfolio-kpis">
            {metrics.includes('processes') && <article><Layers3/><span>Процессов<strong>{data.totalProcesses}</strong><small>{data.publishedProcesses} действующих · {data.draftProcesses} черновиков</small></span></article>}
            {metrics.includes('readiness') && <article><ShieldCheck/><span>Готовность<strong>{data.averageReadinessPercent}%</strong><small>владелец, дорожки, описания, нормативы</small></span></article>}
            {metrics.includes('coverage') && <article><Building2/><span>Охват структуры<strong>{percent(data.participatingDepartments, data.totalDepartments)}%</strong><small>{data.participatingDepartments} из {data.totalDepartments} подразделений</small></span></article>}
            {metrics.includes('instances') && <article><Activity/><span>Выполнений<strong>{data.totalInstances}</strong><small>{data.activeInstances} активных · {data.completedInstances} завершено</small></span></article>}
            {metrics.includes('overdue') && <article className={data.overdueSteps ? 'is-warning' : ''}><Clock3/><span>Просроченных шагов<strong>{data.overdueSteps}</strong><small>по заданным нормативам времени</small></span></article>}
            {metrics.includes('documents') && <article className={data.informationIssueCount ? 'is-warning' : ''}><FileWarning/><span>Разрывов данных<strong>{data.informationIssueCount}</strong><small>{data.informationObjectCount} документов и результатов в реестре</small></span></article>}
            {metrics.includes('transfers') && <article><GitBranch/><span>Передач между дорожками<strong>{data.crossLaneTransferCount}</strong><small>переходы между подразделениями и участниками</small></span></article>}
          </div>
          <PortfolioCharts data={data}/>
          <details className="portfolio-methodology"><summary>Как рассчитаны показатели</summary><div><p><strong>Готовность</strong> — владелец 20%, оргпривязки дорожек 35%, полное описание задач 25%, нормативы 10%, направление 10%.</p><p><strong>Разрыв данных</strong> — у документа или результата нет источника/получателя, найдено несколько источников либо конфликтуют версии.</p><p><strong>Передача</strong> — переход BPMN между шагами разных дорожек. Ручные и внешние шаги определяются по способу выполнения в карточке этапа.</p></div></details>
          <div className="portfolio-grid">
            <section className="portfolio-panel"><div className="portfolio-panel-title"><div><strong>Процессы по направлениям</strong><span>распределение текущего каталога</span></div></div>
              <div className="portfolio-bars">{data.directions.slice(0, 10).map(item => <div key={item.id}><span title={`${item.legalEntityName}: ${item.name}`}>{item.name}<small>{item.legalEntityName}</small></span><i><b style={{ width: `${percent(item.processCount, Math.max(...data.directions.map(value => value.processCount), 1))}%` }}/></i><strong>{item.processCount}</strong></div>)}</div>
            </section>
            <section className="portfolio-panel"><div className="portfolio-panel-title"><div><strong>Требуют внимания</strong><span>сначала наименее подготовленные</span></div><button onClick={() => { setFilter('attention'); setView('processes'); }}>Все</button></div>
              <div className="portfolio-attention">{data.processes.filter(item => item.issues.length).slice(0, 6).map(item => <button key={item.id} onClick={() => onOpenProcess(item.id)}><span><strong>{item.name}</strong><small>{item.issues[0]}</small></span><em>{item.readinessPercent}%</em></button>)}</div>
            </section>
          </div>
        </>}
        {view === 'processes' && <>
          <div className="portfolio-toolbar"><label><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} aria-label="Поиск процессов аналитики" maxLength={300} placeholder="ID, название, владелец, направление…"/></label><select aria-label="Фильтр процессов аналитики" value={filter} onChange={event => setFilter(event.target.value as AnalyticsFilter)}><option value="all">Все процессы</option><option value="attention">Требуют внимания</option><option value="documents">С разрывами документов</option><option value="timing">Без полных нормативов</option><option value="draft">Черновики</option><option value="execution">С данными выполнения</option></select></div>
          <div className="portfolio-process-list">{processes.map(process => <button key={process.id} onClick={() => onOpenProcess(process.id)}>
            <span className="portfolio-score" style={{ '--score': `${process.readinessPercent}%` } as CSSProperties}><strong>{process.readinessPercent}%</strong><small>готовность</small></span>
            <span className="portfolio-process-main"><strong>{process.name}</strong><small>Уровень {process.level} · {process.owner} · {process.directions.join(', ') || 'направление не назначено'}</small><span>{process.issues.slice(0, 3).map(issue => <em key={issue}><AlertTriangle size={11}/>{issue}</em>)}</span></span>
            <span className="portfolio-process-facts"><small>Дорожки<strong>{process.mappedLaneCount}/{process.laneCount}</strong></small><small>Нормативы<strong>{process.timedTaskCount}/{process.taskCount}</strong></small><small>Передачи<strong>{process.crossLaneTransferCount}</strong></small><small>Разрывы данных<strong>{process.informationIssueCount}</strong></small></span>
          </button>)}{!processes.length && <div className="empty-collection">По заданным условиям процессы не найдены.</div>}</div>
        </>}
        {view === 'departments' && <div className="portfolio-department-grid">
          <section className="portfolio-panel"><div className="portfolio-panel-title"><div><strong>Участие подразделений</strong><span>число процессов с дорожками подразделения</span></div></div><div className="portfolio-ranking">{data.departments.map((item, index) => <div key={`${item.legalEntityName}:${item.id}`}><b>{index + 1}</b><span><strong>{item.shortName || item.name}</strong><small>{item.name} · {item.legalEntityName}</small></span><em>{item.processCount}</em></div>)}</div></section>
          <section className="portfolio-panel portfolio-coverage"><ShieldCheck/><strong>{data.participatingDepartments} подразделений участвуют в процессах</strong><p>{data.totalDepartments - data.participatingDepartments} подразделений пока не представлены ни в одной организационно привязанной дорожке.</p><div><i style={{ width: `${percent(data.participatingDepartments, data.totalDepartments)}%` }}/></div><span>{percent(data.participatingDepartments, data.totalDepartments)}% охвата</span></section>
        </div>}
        {view === 'systems' && <div className="portfolio-systems-layout">
          <section className="portfolio-panel"><div className="portfolio-panel-title"><div><strong>Информационные системы</strong><span>по паспортам и шагам процессов</span></div></div>
            <div className="portfolio-system-list">{data.systems.map(item => <div key={item.name}><MonitorCog size={17}/><span><strong>{item.name}</strong><small>{item.processCount} процессов</small></span><em>{item.taskCount} шагов</em></div>)}{!data.systems.length && <p>Системы выполнения пока не указаны.</p>}</div>
          </section>
          <section className="portfolio-panel"><div className="portfolio-panel-title"><div><strong>Глубина декомпозиции</strong><span>число моделей на каждом уровне</span></div></div>
            <div className="portfolio-levels">{data.levels.map(item => <div key={item.level}><b>Уровень {item.level}</b><i><span style={{ width: `${percent(item.processCount, Math.max(...data.levels.map(value => value.processCount), 1))}%` }}/></i><strong>{item.processCount}</strong></div>)}</div>
            <div className="portfolio-decomposition-summary"><GitBranch/><span><strong>{data.processesWithDecomposition} процессов</strong><small>имеют дочерние модели следующего уровня</small></span></div>
          </section>
          <section className="portfolio-panel portfolio-mode-summary"><div className="portfolio-panel-title"><div><strong>Способы выполнения шагов</strong><span>по всему каталогу</span></div></div>{[
            ['В информационных системах', data.processes.reduce((sum, item) => sum + item.systemTaskCount, 0)],
            ['Вручную / не уточнено', data.processes.reduce((sum, item) => sum + item.manualTaskCount, 0)],
            ['Во внешнем канале', data.processes.reduce((sum, item) => sum + item.externalTaskCount, 0)],
          ].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}</section>
        </div>}
      </div>}
      <footer className="portfolio-footer"><span><CheckCircle2 size={14}/>{view === 'history' ? 'Сохранённые наблюдения текущего профиля. Исторические схемы этим разделом не восстанавливаются.' : 'Текущий срез репозитория. Сохранить наблюдение можно в разделе «История и сравнение».'}</span><button onClick={onClose}>На главную</button></footer>
    </section>
  </main>;
}
