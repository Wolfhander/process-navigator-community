import { ArrowLeft, ArrowRight, Clock3, GitBranch, List, ListChecks, Search, Star, Trash2, Workflow, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { deleteProcess, loadProcessHierarchy, saveProcessHierarchy, saveProcessHierarchyBulk } from './api';
import type { ProcessHierarchyNode, ProcessPassport, ProcessSummary } from './types';
import { processLevelOptions } from './process-levels';
import { mergeHierarchyUpdate } from './process-hierarchy-update';
import './process-catalog.css';
import './process-hierarchy.css';

type SortMode = 'name' | 'updated' | 'created-new' | 'created-old';
type ViewMode = 'list' | 'hierarchy';
type Props = {
  catalog: ProcessSummary[];
  favorites: string[];
  onFavorite: (id: string) => void;
  canDelete: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onDeleted: (id: string) => Promise<void>;
  onAudit?: () => void;
  page?: boolean;
};

const classifications: ProcessPassport['classification'][] = ['Основной', 'Управляющий', 'Обеспечивающий', 'Обслуживающий'];
const dateText = (value?: string) => value
  ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'дата не зафиксирована';

export function ProcessCatalogDialog({ catalog, favorites, onFavorite, canDelete, onClose, onOpen, onDeleted, onAudit, page = false }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('updated');
  const [view, setView] = useState<ViewMode>('list');
  const [hierarchy, setHierarchy] = useState<ProcessHierarchyNode[]>([]);
  const [hierarchyBusy, setHierarchyBusy] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkLevel, setBulkLevel] = useState('');
  const [bulkClassification, setBulkClassification] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProcessSummary>();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadProcessHierarchy(controller.signal).then(setHierarchy).catch(reason => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить иерархию процессов.');
    });
    return () => controller.abort();
  }, [catalog]);

  const processes = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('ru-RU');
    const items = catalog.filter(item => !term || `${item.name} ${item.id} ${item.owner}`.toLocaleLowerCase('ru-RU').includes(term));
    return [...items].sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name, 'ru');
      const leftDate = Date.parse(sort.startsWith('created') ? left.createdAt ?? '' : left.updatedAt ?? '');
      const rightDate = Date.parse(sort.startsWith('created') ? right.createdAt ?? '' : right.updatedAt ?? '');
      return sort === 'created-old' ? leftDate - rightDate : rightDate - leftDate;
    });
  }, [catalog, query, sort]);

  const hierarchyRows = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('ru-RU');
    const byParent = new Map<string, ProcessHierarchyNode[]>();
    hierarchy.forEach(item => {
      const key = item.parentProcessId && hierarchy.some(candidate => candidate.id === item.parentProcessId) ? item.parentProcessId : '';
      byParent.set(key, [...(byParent.get(key) ?? []), item]);
    });
    byParent.forEach(items => items.sort((a, b) => a.name.localeCompare(b.name, 'ru')));
    const rows: Array<{ item: ProcessHierarchyNode; depth: number }> = [];
    const visited = new Set<string>();
    const append = (parentId: string, depth: number) => (byParent.get(parentId) ?? []).forEach(item => {
      if (visited.has(item.id)) return;
      visited.add(item.id); rows.push({ item, depth }); append(item.id, depth + 1);
    });
    append('', 0);
    hierarchy.forEach(item => { if (!visited.has(item.id)) rows.push({ item, depth: 0 }); });
    if (!term) return rows;
    return rows.filter(({ item }) => `${item.name} ${item.id} ${item.classification}`.toLocaleLowerCase('ru-RU').includes(term));
  }, [hierarchy, query]);
  const levelOptions = processLevelOptions(Math.max(0, ...hierarchy.map(item => item.level)));

  const updateHierarchy = async (item: ProcessHierarchyNode, update: Partial<ProcessHierarchyNode>) => {
    const next = mergeHierarchyUpdate(item, update);
    setHierarchyBusy(item.id); setError('');
    try {
      await saveProcessHierarchy(item.id, next);
      setHierarchy(await loadProcessHierarchy());
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить иерархию.'); }
    finally { setHierarchyBusy(''); }
  };

  const applyBulk = async () => {
    if (!selected.length || (!bulkLevel && !bulkClassification)) return;
    setHierarchyBusy('bulk'); setError('');
    try {
      await saveProcessHierarchyBulk({ processIds: selected, level: bulkLevel ? Number(bulkLevel) : undefined, classification: bulkClassification ? bulkClassification as ProcessPassport['classification'] : undefined });
      setHierarchy(await loadProcessHierarchy());
      setSelected([]); setBulkLevel(''); setBulkClassification('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось массово изменить процессы.'); }
    finally { setHierarchyBusy(''); }
  };

  const remove = async () => {
    if (!deleteTarget || confirmation !== deleteTarget.name) return;
    setBusy(true); setError('');
    try {
      await deleteProcess(deleteTarget.id);
      await onDeleted(deleteTarget.id);
      setHierarchy(current => current.filter(item => item.id !== deleteTarget.id));
      setDeleteTarget(undefined); setConfirmation('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить процесс.'); }
    finally { setBusy(false); }
  };

  const content = <section className={`process-catalog-dialog${page ? ' process-catalog-page-content' : ''}`} role={page ? 'region' : 'dialog'} aria-modal={page ? undefined : true} aria-label="Каталог процессов">
      <header><div><span className="eyebrow">Репозиторий процессов</span><h1>Каталог процессов</h1><p>Все опубликованные модели и черновики, включая ещё не распределённые по направлениям.</p></div>{!page && <button className="catalog-close" onClick={onClose} aria-label="Закрыть"><X size={18}/></button>}</header>
      <div className="catalog-toolbar">
        <label><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти процесс…" autoFocus/></label>
        <div className="catalog-view-switch"><button className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')}><List size={15}/> Список</button><button className={view === 'hierarchy' ? 'is-active' : ''} onClick={() => setView('hierarchy')}><GitBranch size={15}/> Иерархия</button></div>
        {view === 'list' && <select value={sort} onChange={event => setSort(event.target.value as SortMode)} aria-label="Сортировка"><option value="updated">Сначала недавно изменённые</option><option value="created-new">Сначала новые</option><option value="created-old">По очередности создания</option><option value="name">По названию</option></select>}
      </div>
      {error && <div className="catalog-error hierarchy-global-error">{error}</div>}
      {view === 'hierarchy' && canDelete && <div className="hierarchy-bulk"><label><input type="checkbox" checked={!!hierarchyRows.length && hierarchyRows.every(row => selected.includes(row.item.id))} onChange={event => setSelected(event.target.checked ? hierarchyRows.map(row => row.item.id) : [])}/> Выбрать показанные</label><strong>Выбрано: {selected.length}</strong><select value={bulkLevel} onChange={event => setBulkLevel(event.target.value)}><option value="">Уровень — без изменения</option>{levelOptions.map(level => <option key={level} value={level}>Уровень {level}</option>)}</select><select value={bulkClassification} onChange={event => setBulkClassification(event.target.value)}><option value="">Тип — без изменения</option>{classifications.map(value => <option key={value}>{value}</option>)}</select><button disabled={!selected.length || (!bulkLevel && !bulkClassification) || hierarchyBusy === 'bulk'} onClick={applyBulk}>{hierarchyBusy === 'bulk' ? 'Сохраняем…' : 'Применить'}</button></div>}
      {view === 'list' ? <div className="catalog-list">{processes.map(item => <article key={item.id} className="catalog-process-card">
        <button className="catalog-process-open" onClick={() => onOpen(item.id)}><span className="catalog-process-icon"><Workflow size={19}/></span><span><strong>{item.name}</strong><small>{item.id} · версия {item.hasDraft ? item.draftVersion : item.version} · {item.hasDraft ? 'есть черновик' : item.status}</small><em><Clock3 size={12}/> Изменён: {dateText(item.updatedAt)} · {item.nodeCount} элементов · {item.laneCount} дорожек</em></span><ArrowRight size={19}/></button>
        <div className="catalog-card-actions"><button className="personal-star" aria-pressed={favorites.includes(item.id)} aria-label={`${favorites.includes(item.id) ? 'Убрать из избранного' : 'В избранное'}: ${item.name}`} onClick={() => onFavorite(item.id)}><Star size={16} fill={favorites.includes(item.id) ? 'currentColor' : 'none'}/></button>{canDelete && <button className="catalog-delete" onClick={() => { setDeleteTarget(item); setConfirmation(''); setError(''); }} title="Полностью удалить процесс" aria-label={`Удалить ${item.name}`}><Trash2 size={16}/></button>}</div>
      </article>)}{!processes.length && <div className="catalog-empty"><Workflow size={28}/><strong>Процессы не найдены</strong><span>Измените строку поиска.</span></div>}</div>
      : <div className="hierarchy-list">{hierarchyRows.map(({ item, depth }) => <article className={`hierarchy-row${canDelete ? ' has-selection' : ''}`} key={item.id} style={{ '--hierarchy-depth': Math.min(depth, 6) } as CSSProperties}>
        {canDelete && <input className="hierarchy-select" type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} aria-label={`Выбрать ${item.name}`}/>}
        <button className="hierarchy-main" onClick={() => onOpen(item.id)}><GitBranch size={16}/><span><strong>{item.name}</strong><small>{item.id} · {item.status}</small></span></button>
        <div className="hierarchy-controls">
          <label>Уровень<select disabled={!canDelete || hierarchyBusy === item.id} value={item.level} onChange={event => updateHierarchy(item, { level: Number(event.target.value) })}>{levelOptions.map(level => <option key={level} value={level}>{level}</option>)}</select></label>
          <label>Тип<select disabled={!canDelete || hierarchyBusy === item.id} value={item.classification} onChange={event => updateHierarchy(item, { classification: event.target.value as ProcessPassport['classification'] })}>{classifications.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Родитель<select disabled={!canDelete || hierarchyBusy === item.id} value={item.parentProcessId ?? ''} onChange={event => updateHierarchy(item, { parentProcessId: event.target.value || undefined })}><option value="">Не выбран</option>{hierarchy.filter(candidate => candidate.id !== item.id).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
        </div>
        {!!item.issues.length && <div className="hierarchy-issues">{item.issues.map(issue => <span key={issue}>{issue}</span>)}</div>}
      </article>)}{!hierarchyRows.length && <div className="catalog-empty"><GitBranch size={28}/><strong>Процессы не найдены</strong><span>Измените строку поиска.</span></div>}</div>}
      <footer><span>{view === 'list' ? processes.length : hierarchyRows.length} из {catalog.length}</span>{onAudit && <button onClick={onAudit}><ListChecks size={15}/> Проверить каталог</button>}{!page && <button onClick={onClose}>Закрыть</button>}</footer>
    </section>;
  const deletePanel = deleteTarget && <section className="delete-process-confirm" role="alertdialog" aria-modal="true"><span className="eyebrow">Необратимое действие</span><h2>Полностью удалить процесс?</h2><p>Будут удалены BPMN, черновик, все версии, назначения, выполнения, комментарии и привязки процесса <strong>«{deleteTarget.name}»</strong>.</p><label>Для подтверждения введите название процесса<input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={deleteTarget.name} autoFocus/></label>{error && <div className="catalog-error">{error}</div>}<div><button onClick={() => setDeleteTarget(undefined)} disabled={busy}>Отмена</button><button className="is-danger" onClick={remove} disabled={busy || confirmation !== deleteTarget.name}><Trash2 size={15}/>{busy ? 'Удаляем…' : 'Удалить безвозвратно'}</button></div></section>;
  const deleteConfirmation = page && deletePanel
    ? <div className="delete-confirm-backdrop" onMouseDown={event => event.target === event.currentTarget && setDeleteTarget(undefined)}>{deletePanel}</div>
    : deletePanel;
  if (!page) return <div className="catalog-dialog-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>{content}{deleteConfirmation}</div>;
  return <><main className="feature-page catalog-page"><div className="feature-page-shell"><nav className="feature-breadcrumb" aria-label="Путь раздела"><button onClick={onClose}><ArrowLeft size={16}/>Рабочее пространство</button><span>›</span><strong>Каталог процессов</strong></nav>{content}</div></main>{deleteConfirmation}</>;
}
