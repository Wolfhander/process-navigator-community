import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Download, FilePenLine, Layers3, ListTodo, RefreshCw, X } from 'lucide-react';
import { auditProcessCatalog, exportProcessCatalogAudit } from './api';
import type { CatalogAuditItem, CatalogAuditReport, ProcessValidationIssue } from './types';
import { auditWorkItemsCsv, buildCatalogAuditWorkItems, matchesAuditIssue } from './catalog-audit-worklist';
import './catalog-audit.css';

type StatusFilter = 'problems' | 'errors' | 'ready' | 'all';
type EditionFilter = '' | 'Published' | 'Draft';
type CategoryFilter = '' | ProcessValidationIssue['category'];
type ViewMode = 'processes' | 'issues';
type Props = {
  onClose: () => void;
  onOpen: (item: CatalogAuditItem, issue?: ProcessValidationIssue) => void;
  onFix: (item: CatalogAuditItem, issue?: ProcessValidationIssue) => Promise<void> | void;
  canCreateDraft: boolean;
  page?: boolean;
  backLabel?: string;
};

const itemKey = (item: CatalogAuditItem) => `${item.edition}:${item.fileName}`;
const qualityLabel = (item: CatalogAuditItem) => item.qualityStatus === 'Blocked'
  ? `${item.errorCount} ошибок`
  : item.qualityStatus === 'Incomplete' ? `${item.warningCount} рекомендаций` : 'Готово к работе';

export function CatalogAuditDialog({ onClose, onOpen, onFix, canCreateDraft, page = false, backLabel = 'Рабочее пространство' }: Props) {
  const [report, setReport] = useState<CatalogAuditReport>();
  const [selectedKey, setSelectedKey] = useState('');
  const [status, setStatus] = useState<StatusFilter>('errors');
  const [edition, setEdition] = useState<EditionFilter>('');
  const [category, setCategory] = useState<CategoryFilter>('');
  const [viewMode, setViewMode] = useState<ViewMode>('issues');
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [fixing, setFixing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError(''); setReport(undefined);
    auditProcessCatalog(controller.signal).then(result => {
      setReport(result);
      const first = result.items.find(item => item.errorCount > 0) ?? result.items[0];
      setSelectedKey(current => result.items.some(item => itemKey(item) === current) ? current : first ? itemKey(first) : '');
    }).catch(reason => { if (reason.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Не удалось проверить каталог.'); });
    return () => controller.abort();
  }, [reload]);

  const visible = useMemo(() => (report?.items ?? []).filter(item => {
    const matchesStatus = status === 'all' || (status === 'errors' ? item.errorCount > 0 : status === 'ready' ? item.qualityStatus === 'Ready' : item.qualityStatus !== 'Ready');
    const matchesEdition = !edition || item.edition === edition;
    const matchesCategory = (!category && status !== 'errors') || item.issues.some(issue => matchesAuditIssue(item, issue, category, status === 'errors', query));
    const haystack = [item.processName, item.processId, item.fileName, ...item.issues.flatMap(issue => [issue.code, issue.message, issue.elementName ?? ''])].join(' ').toLocaleLowerCase();
    return matchesStatus && matchesEdition && matchesCategory && haystack.includes(query.trim().toLocaleLowerCase());
  }), [report, status, edition, category, query]);
  const selected = visible.find(item => itemKey(item) === selectedKey) ?? visible[0];
  const selectedIssues = selected?.issues.filter(issue => matchesAuditIssue(selected, issue, category, status === 'errors', query)) ?? [];
  const workItems = useMemo(() => buildCatalogAuditWorkItems(visible, category, status === 'errors', query), [visible, category, status, query]);
  const mayFix = selected?.openable && (selected.edition === 'Draft' || selected.hasDraft || canCreateDraft);
  const exportVisibleIssues = () => {
    const url = URL.createObjectURL(new Blob([auditWorkItemsCsv(workItems)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'process-correction-worklist.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const fix = async (item: CatalogAuditItem, issue?: ProcessValidationIssue) => {
    setFixing(true); setError('');
    try { await onFix(item, issue); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось открыть черновик для исправления.'); }
    finally { setFixing(false); }
  };
  const exportReport = async () => {
    setExporting(true); setError('');
    try { await exportProcessCatalogAudit(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось выгрузить отчёт.'); }
    finally { setExporting(false); }
  };

  const content = <section className={`catalog-audit${page ? ' catalog-audit-page-content' : ''}`} role={page ? 'region' : 'dialog'} aria-modal={page ? undefined : true} aria-label="Проверка каталога процессов">
    <header><div><span className="eyebrow">Качество действующих процессов</span><h2>Проверка каталога</h2><p>Единая очередь ошибок маршрута, оргпривязок, описания, декомпозиции, входов и результатов. Сначала показаны блокирующие ошибки; рекомендации можно включить фильтром.</p></div>{!page && <button className="dialog-close" onClick={onClose} aria-label="Закрыть"><X size={18}/></button>}</header>
    {error && <div className="catalog-audit-error" role="alert"><AlertTriangle size={17}/>{error}<button onClick={() => setReload(value => value + 1)}>Повторить проверку</button></div>}
    {!report && !error && <div className="catalog-audit-loading"><div className="loader"/>Проверяем схемы и оргпривязки…</div>}
    {report && <>
      <div className="catalog-audit-summary"><span><strong>{report.processCount}</strong> процессов</span><span><strong>{report.editionCount}</strong> редакций</span><span className="is-ready"><strong>{report.readyEditionCount}</strong> готовы</span><span className="is-warning"><strong>{report.incompleteEditionCount}</strong> требуют уточнений</span><span className="is-error"><strong>{report.blockedEditionCount}</strong> заблокированы</span></div>
      {report.categories.length > 0 && <div className="catalog-audit-categories" aria-label="Категории замечаний"><button className={!category ? 'active' : ''} onClick={() => setCategory('')}>Все категории <b>{report.errorCount + report.warningCount}</b></button>{report.categories.map(item => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(current => current === item.id ? '' : item.id)}>{item.name} <b>{item.errorCount + item.warningCount}</b></button>)}</div>}
      <div className="catalog-audit-view-tabs"><button className={viewMode === 'issues' ? 'active' : ''} onClick={() => setViewMode('issues')}><ListTodo size={15}/>Рабочий список <b>{workItems.length}</b></button><button className={viewMode === 'processes' ? 'active' : ''} onClick={() => setViewMode('processes')}><Layers3 size={15}/>По процессам <b>{visible.length}</b></button></div>
      <div className="catalog-audit-filters">
        <button onClick={exportVisibleIssues} disabled={!workItems.length}><Download size={15}/>Выгрузить выбранные замечания ({workItems.length})</button>
        <input aria-label="Поиск в проверке" placeholder="Процесс, файл, элемент или текст замечания" value={query} onChange={event => setQuery(event.target.value)}/>
        <select aria-label="Статус качества" value={status} onChange={event => setStatus(event.target.value as StatusFilter)}><option value="problems">Требуют внимания</option><option value="errors">Только ошибки</option><option value="ready">Готовы к работе</option><option value="all">Все редакции</option></select>
        <select aria-label="Тип редакции" value={edition} onChange={event => setEdition(event.target.value as EditionFilter)}><option value="">Все редакции</option><option value="Published">Действующие</option><option value="Draft">Черновики</option></select>
        <button onClick={() => setReload(value => value + 1)}><RefreshCw size={15}/>Обновить</button><button onClick={exportReport} disabled={exporting}><Download size={15}/>{exporting ? 'Выгружаем…' : 'Отчёт CSV'}</button>
      </div>
      {viewMode === 'issues' ? <div className="catalog-audit-work-list">{workItems.map(({ item, issue }, index) => { const fixable = item.openable && (item.edition === 'Draft' || item.hasDraft || canCreateDraft); return <article key={`${itemKey(item)}:${issue.code}:${issue.elementId ?? index}`} className={issue.severity === 'Error' ? 'is-error' : 'is-warning'}><AlertTriangle size={17}/><div><header><span className="catalog-audit-category">{report.categories.find(categoryItem => categoryItem.id === issue.category)?.name ?? 'Прочее'}</span><em>{issue.severity === 'Error' ? 'Ошибка' : 'Нужно дополнить'}</em></header><strong>{item.processName}</strong><p>{issue.message}</p>{issue.elementName && <small>{issue.elementName}</small>}<footer><span>{item.edition === 'Draft' ? 'Черновик' : 'Действующая редакция'} · {item.version ?? item.fileName}</span>{item.openable && issue.elementId && <button onClick={() => onOpen(item, issue)}>Показать на схеме</button>}{fixable && <button disabled={fixing} onClick={() => fix(item, issue)}><FilePenLine size={12}/>Исправить</button>}</footer></div></article>; })}{!workItems.length && <div className="empty-collection">По заданным условиям замечаний нет.</div>}</div> :
      <div className="catalog-audit-main"><div className="catalog-audit-list">{visible.map(item => <button key={itemKey(item)} className={selected && itemKey(selected) === itemKey(item) ? 'active' : ''} onClick={() => setSelectedKey(itemKey(item))}><span><strong>{item.processName}</strong><small>{item.edition === 'Draft' ? 'Черновик' : 'Действующая редакция'} · {item.version ?? item.fileName}</small></span><em className={item.qualityStatus === 'Blocked' ? 'is-error' : item.qualityStatus === 'Incomplete' ? 'is-warning' : 'is-ready'}>{qualityLabel(item)}</em></button>)}{visible.length === 0 && <p>По заданным условиям редакций нет.</p>}</div>
        <aside>{selected ? <><div className={`catalog-audit-quality is-${selected.qualityStatus.toLowerCase()}`}><strong>{selected.qualityStatus === 'Blocked' ? 'Использование заблокировано' : selected.qualityStatus === 'Incomplete' ? 'Требует уточнений' : 'Редакция готова к работе'}</strong><span>{selected.qualityStatus === 'Blocked' ? 'Исправьте ошибки в черновике и запустите проверку повторно.' : selected.qualityStatus === 'Incomplete' ? 'Схема связна, но некоторые данные рекомендуется дополнить.' : 'Обязательные проверки пройдены.'}</span></div><h3>{selected.processName}</h3><p>{selected.fileName} · {selected.edition === 'Draft' ? 'Черновик' : 'Действующая редакция'}</p><div className="catalog-audit-issues">{selectedIssues.map((issue, index) => <article key={`${issue.code}:${issue.elementId ?? index}`} className={issue.severity === 'Error' ? 'is-error' : 'is-warning'}><AlertTriangle size={16}/><span><small className="catalog-audit-category">{report.categories.find(item => item.id === issue.category)?.name ?? 'Прочее'}</small>{issue.message}{issue.elementName && <small>{issue.elementName}</small>}<span className="catalog-audit-issue-actions">{selected.openable && issue.elementId && <button className="catalog-audit-jump" onClick={() => onOpen(selected, issue)}>Показать</button>}{mayFix && <button className="catalog-audit-jump" disabled={fixing} onClick={() => fix(selected, issue)}><FilePenLine size={12}/>Исправить в черновике</button>}</span></span></article>)}{selectedIssues.length === 0 && <p>Замечаний в выбранной категории нет.</p>}</div><div className="catalog-audit-actions">{selected.openable && <button className="catalog-audit-secondary" onClick={() => onOpen(selected)}>Открыть редакцию</button>}{mayFix && selected.qualityStatus !== 'Ready' && <button className="catalog-audit-open" disabled={fixing} onClick={() => fix(selected)}><FilePenLine size={15}/>{fixing ? 'Открываем…' : selected.edition === 'Draft' || selected.hasDraft ? 'Открыть черновик' : 'Создать черновик и исправить'}</button>}</div></> : <p>Выберите редакцию слева, чтобы увидеть замечания.</p>}</aside></div>
      }
    </>}
    <footer><span>Проверка не изменяет процессы. Исправления выполняются только в черновиках.</span>{!page && <button onClick={onClose}>Закрыть</button>}</footer>
  </section>;
  if (!page) return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>{content}</div>;
  return <main className="feature-page catalog-audit-page"><div className="feature-page-shell"><nav className="feature-breadcrumb" aria-label="Путь раздела"><button onClick={onClose}><ArrowLeft size={16}/>{backLabel}</button><span>›</span><strong>Проверка каталога</strong></nav>{content}</div></main>;
}
