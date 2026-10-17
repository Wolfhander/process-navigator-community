import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, Eye, FileClock, FileSpreadsheet, Filter, Save, Search, Settings2, Trash2 } from 'lucide-react';
import {
  cleanupProcessTableImportHistory,
  deleteProcessTableImportHistory,
  downloadProcessTableImportReport,
  loadProcessTableImportHistory,
  loadProcessTableImportReport,
  loadProcessTableImportRetentionPolicy,
  saveProcessTableImportRetentionPolicy,
} from './api';
import type { ProcessTableImportHistoryItem, ProcessTableImportReport, ProcessTableImportRetentionPolicy } from './types';
import './process-table-import-history.css';

type Props = { onBack: () => void; canManage: boolean };

const defaultPolicy: ProcessTableImportRetentionPolicy = { retentionDays: 0, maximumEntries: 0 };

function formatBytes(value: number) {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

export function ProcessTableImportHistoryPage({ onBack, canManage }: Props) {
  const [items, setItems] = useState<ProcessTableImportHistoryItem[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string>();
  const [report, setReport] = useState<ProcessTableImportReport>();
  const [reportLoading, setReportLoading] = useState(false);
  const [reportQuery, setReportQuery] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [policy, setPolicy] = useState(defaultPolicy);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminNotice, setAdminNotice] = useState('');

  const refresh = async (signal?: AbortSignal) => setItems(await loadProcessTableImportHistory(signal));

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      refresh(controller.signal),
      canManage ? loadProcessTableImportRetentionPolicy(controller.signal).then(setPolicy) : Promise.resolve(),
    ])
      .catch(reason => { if (reason.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Не удалось загрузить журнал.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [canManage]);

  const visible = useMemo(() => {
    const value = query.trim().toLocaleLowerCase('ru');
    if (!value) return items;
    return items.filter(item => `${item.sourceFileName} ${item.appliedBy} ${item.processes.map(process => `${process.id} ${process.name}`).join(' ')}`
      .toLocaleLowerCase('ru').includes(value));
  }, [items, query]);
  const totals = useMemo(() => items.reduce((result, item) => ({
    imported: result.imported + item.importedProcessCount,
    created: result.created + item.created,
    updated: result.updated + item.updated,
  }), { imported: 0, created: 0, updated: 0 }), [items]);

  const outcomes = useMemo(() => report ? [...new Set(report.rows.map(row => row.outcome).filter(Boolean))].sort() : [], [report]);
  const kinds = useMemo(() => report ? [...new Set(report.rows.map(row => row.kind).filter(Boolean))].sort() : [], [report]);
  const filteredRows = useMemo(() => {
    if (!report) return [];
    const value = reportQuery.trim().toLocaleLowerCase('ru');
    return report.rows.filter(row => (!outcomeFilter || row.outcome === outcomeFilter)
      && (!kindFilter || row.kind === kindFilter)
      && (!value || `${row.processId} ${row.processName} ${row.elementId} ${row.elementName} ${row.field} ${row.oldValue} ${row.newValue} ${row.comment}`
        .toLocaleLowerCase('ru').includes(value)));
  }, [report, reportQuery, outcomeFilter, kindFilter]);

  const openReport = async (item: ProcessTableImportHistoryItem) => {
    setReportLoading(true); setError('');
    try {
      setReport(await loadProcessTableImportReport(item.id));
      setReportQuery(''); setOutcomeFilter(''); setKindFilter('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось открыть протокол.'); }
    finally { setReportLoading(false); }
  };

  const removeHistoryItem = async (item: ProcessTableImportHistoryItem) => {
    if (!window.confirm(`Удалить запись импорта «${item.sourceFileName}» и её CSV-протокол?`)) return;
    setAdminBusy(true); setError(''); setAdminNotice('');
    try {
      await deleteProcessTableImportHistory(item.id);
      setItems(current => current.filter(entry => entry.id !== item.id));
      setAdminNotice('Запись истории и связанный протокол удалены.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить запись.'); }
    finally { setAdminBusy(false); }
  };

  const savePolicy = async () => {
    setAdminBusy(true); setError(''); setAdminNotice('');
    try {
      setPolicy(await saveProcessTableImportRetentionPolicy(policy));
      setAdminNotice('Политика хранения сохранена. Она будет применяться после каждого нового импорта.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить политику.'); }
    finally { setAdminBusy(false); }
  };

  const cleanup = async () => {
    if (!window.confirm('Применить текущую политику хранения и удалить устаревшие записи с CSV-протоколами?')) return;
    setAdminBusy(true); setError(''); setAdminNotice('');
    try {
      const result = await cleanupProcessTableImportHistory();
      await refresh();
      setAdminNotice(`Удалено записей: ${result.removedEntries}. Освобождено: ${formatBytes(result.reclaimedBytes)}. Осталось: ${result.remainingEntries}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось выполнить очистку.'); }
    finally { setAdminBusy(false); }
  };

  if (report) {
    const source = items.find(item => item.id === report.historyId);
    const shownRows = filteredRows.slice(0, 1000);
    return <main className="feature-page table-import-history-page"><div className="feature-page-shell">
      <nav className="feature-breadcrumb" aria-label="Путь раздела"><button onClick={() => setReport(undefined)}><ArrowLeft size={16}/>История импортов</button><span>›</span><strong>Протокол проверки</strong></nav>
      <section className="table-import-history-surface table-import-report-page">
        <span className="eyebrow">Протокол табличного импорта</span><h1>{source?.sourceFileName ?? report.reportFileName}</h1>
        <p className="table-import-history-lead">Изменения показаны построчно. Используйте фильтры, чтобы найти процесс, элемент или незаполненное поле.</p>
        <div className="table-import-report-stats">
          <span><strong>{report.processCount}</strong><small>процессов</small></span><span><strong>{report.rowCount}</strong><small>строк протокола</small></span>
          <span className="is-created"><strong>+{report.added}</strong><small>добавлено</small></span><span className="is-updated"><strong>{report.modified}</strong><small>изменено</small></span>
          <span className="is-removed"><strong>{report.removed}</strong><small>удалено</small></span><span><strong>{report.mapped}</strong><small>сопоставлено ID</small></span>
        </div>
        <div className="table-import-report-toolbar">
          <label><Search size={17}/><input value={reportQuery} onChange={event => setReportQuery(event.target.value)} placeholder="Процесс, шаг, поле или значение…"/></label>
          <label><Filter size={16}/><select value={outcomeFilter} onChange={event => setOutcomeFilter(event.target.value)}><option value="">Все результаты</option>{outcomes.map(value => <option key={value}>{value}</option>)}</select></label>
          <label><Filter size={16}/><select value={kindFilter} onChange={event => setKindFilter(event.target.value)}><option value="">Все типы строк</option>{kinds.map(value => <option key={value}>{value}</option>)}</select></label>
          <button onClick={() => downloadProcessTableImportReport(report.reportFileName).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось скачать протокол.'))}><Download size={16}/>Скачать CSV</button>
        </div>
        <div className="table-import-report-count">Найдено: <strong>{filteredRows.length}</strong>{filteredRows.length > shownRows.length && <> · показаны первые <strong>{shownRows.length}</strong></>}</div>
        {error && <div className="import-message is-error">{error}</div>}
        {!filteredRows.length ? <div className="empty-collection">По заданным фильтрам строк нет.</div> : <div className="table-import-report-list">{shownRows.map((row, index) => <article key={`${row.processId}-${row.elementId}-${row.field}-${index}`}>
          <header><span><strong>{row.processName || row.processId || 'Общая запись'}</strong>{row.processId && <code>{row.processId}</code>}</span><span className={`report-outcome outcome-${row.outcome.toLocaleLowerCase('ru')}`}>{row.outcome || 'Информация'}</span><small>{row.kind}</small></header>
          <div className="table-import-report-body">
            {(row.elementName || row.elementId) && <span><small>Элемент</small><strong>{row.elementName || row.elementId}</strong>{row.elementName && row.elementId && <code>{row.elementId}</code>}</span>}
            {row.field && <span><small>Поле</small><strong>{row.field}</strong></span>}
            {row.oldValue && <span className="is-old"><small>Было</small><strong>{row.oldValue}</strong></span>}
            {row.newValue && <span className="is-new"><small>Стало</small><strong>{row.newValue}</strong></span>}
            {row.comment && <span className="is-comment"><small>Комментарий</small><strong>{row.comment}</strong></span>}
          </div>
        </article>)}</div>}
      </section>
    </div></main>;
  }

  return <main className="feature-page table-import-history-page"><div className="feature-page-shell">
    <nav className="feature-breadcrumb" aria-label="Путь раздела"><button onClick={onBack}><ArrowLeft size={16}/>Настройки</button><span>›</span><strong>История табличных импортов</strong></nav>
    <section className="table-import-history-surface">
      <span className="eyebrow">Репозиторий процессов</span><h1>История табличных импортов</h1>
      <p className="table-import-history-lead">Все завершённые загрузки из Excel: кто и когда изменил процессы, какая резервная копия создана и где открыть подробный протокол.</p>
      <div className="table-import-history-stats"><span><FileClock size={19}/><strong>{items.length}</strong><small>операций</small></span><span><FileSpreadsheet size={19}/><strong>{totals.imported}</strong><small>загружено процессов</small></span><span><CheckCircle2 size={19}/><strong>{totals.created}</strong><small>создано</small></span><span><CheckCircle2 size={19}/><strong>{totals.updated}</strong><small>обновлено</small></span></div>
      {canManage && <section className="table-import-retention">
        <div><Settings2 size={20}/><span><strong>Хранение протоколов</strong><small>Ноль означает хранить без ограничения.</small></span></div>
        <label>Срок, дней<input type="number" min="0" max="3650" value={policy.retentionDays} onChange={event => setPolicy(current => ({ ...current, retentionDays: Number(event.target.value) }))}/></label>
        <label>Максимум записей<input type="number" min="0" max="10000" value={policy.maximumEntries} onChange={event => setPolicy(current => ({ ...current, maximumEntries: Number(event.target.value) }))}/></label>
        <button disabled={adminBusy} onClick={savePolicy}><Save size={16}/>Сохранить</button><button className="secondary" disabled={adminBusy} onClick={cleanup}><Trash2 size={16}/>Очистить сейчас</button>
      </section>}
      {adminNotice && <div className="import-message is-success">{adminNotice}</div>}
      <label className="table-import-history-search"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти файл, пользователя или процесс…"/></label>
      {error && <div className="import-message is-error">{error}</div>}
      {loading && <div className="version-loading"><div className="loader"/>Загружаем историю…</div>}
      {reportLoading && <div className="version-loading"><div className="loader"/>Открываем протокол…</div>}
      {!loading && !error && !items.length && <div className="table-import-history-empty"><FileClock size={30}/><strong>Импортов пока не было</strong><span>После первой загрузки таблицы здесь появится запись и ссылка на протокол.</span></div>}
      {!!visible.length && <div className="table-import-history-list">{visible.map(item => {
        const isExpanded = expanded === item.id;
        return <article key={item.id}>
          <button className="table-import-history-summary" onClick={() => setExpanded(isExpanded ? undefined : item.id)} aria-expanded={isExpanded}>
            <span className="table-import-history-file"><FileSpreadsheet size={20}/><span><strong>{item.sourceFileName}</strong><small>{item.appliedBy} · {new Date(item.occurredAt).toLocaleString('ru-RU')}</small></span></span>
            <span className="table-import-history-result"><strong>{item.importedProcessCount}</strong><small>процессов</small></span>
            <span className="table-import-history-result is-created"><strong>+{item.created}</strong><small>создано</small></span>
            <span className="table-import-history-result is-updated"><strong>{item.updated}</strong><small>обновлено</small></span>
            <span className="table-import-history-toggle">{isExpanded ? 'Скрыть' : 'Подробнее'}</span>
          </button>
          {isExpanded && <div className="table-import-history-details">
            <div className="table-import-history-meta"><span>В книге: <strong>{item.workbookProcessCount}</strong></span><span>Пропущено: <strong>{item.skipped}</strong></span><span>Сопоставлено ID: <strong>{item.appliedStepIdMappings}</strong></span><span>Резервная копия: <code>{item.backupFileName}</code></span></div>
            <div className="table-import-history-processes">{item.processes.map(process => <span key={process.id}><strong>{process.name}</strong><code>{process.id}</code><small>{process.status === 'Created' ? 'Создан' : 'Обновлён'} · {process.nodeCount} шагов · {process.laneCount} дорожек</small></span>)}</div>
            <div className="table-import-history-actions">{item.hasReport ? <><button disabled={reportLoading} onClick={() => openReport(item)}><Eye size={16}/>Открыть протокол</button><button className="secondary" onClick={() => downloadProcessTableImportReport(item.reportFileName).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось скачать протокол.'))}><Download size={16}/>Скачать CSV</button></> : <span>Протокол недоступен: файл был удалён или каталог восстановлен из более ранней копии.</span>}{canManage && <button className="danger" disabled={adminBusy} onClick={() => removeHistoryItem(item)}><Trash2 size={16}/>Удалить</button>}</div>
          </div>}
        </article>;
      })}</div>}
      {!loading && !!items.length && !visible.length && <div className="empty-collection">По заданному фильтру импортов нет.</div>}
    </section>
  </div></main>;
}
