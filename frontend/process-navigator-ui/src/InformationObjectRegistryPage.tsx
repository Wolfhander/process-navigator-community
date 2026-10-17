import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Download, FileText, Pencil, RefreshCw, Save, Search, Waypoints, X } from 'lucide-react';
import { loadInformationObjects, saveInformationObject } from './api';
import type { InformationObject, InformationObjectOccurrence, InformationObjectRegistry, InformationObjectUpdate } from './types';
import { buildProcessDependencies } from './information-object-dependencies';
import { InformationObjectDetailPage } from './InformationObjectDetailPage';
import './information-object-registry.css';

type Props = { canManage: boolean; onBack: () => void; onOpen: (occurrence: InformationObjectOccurrence) => void };
type Filter = 'all' | 'broken' | 'missing-producer' | 'missing-consumer' | 'multiple-producers' | 'version-conflict';
type UpstreamItem = { object: InformationObject; depth: number; viaProcesses: string[] };

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function upstreamFor(root: InformationObject, objects: InformationObject[]) {
  const result: UpstreamItem[] = [];
  const visited = new Set([root.id]);
  let frontier: InformationObject[] = [root];
  for (let depth = 1; depth <= 8 && frontier.length; depth++) {
    const next: InformationObject[] = [];
    for (const target of frontier) {
      const producingProcesses = new Map(target.producers.map(item => [item.processId, item.processName]));
      for (const candidate of objects) {
        if (visited.has(candidate.id)) continue;
        const viaProcesses = [...new Set(candidate.consumers.filter(item => producingProcesses.has(item.processId)).map(item => producingProcesses.get(item.processId)!))];
        if (!viaProcesses.length) continue;
        visited.add(candidate.id); next.push(candidate); result.push({ object: candidate, depth, viaProcesses });
      }
    }
    frontier = next;
  }
  return result;
}

export function InformationObjectRegistryPage({ canManage, onBack, onOpen }: Props) {
  const [registry, setRegistry] = useState<InformationObjectRegistry>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'Document' | 'Result'>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'objects' | 'dependencies'>('objects');
  const [expanded, setExpanded] = useState<string>();
  const [detailId, setDetailId] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [form, setForm] = useState<InformationObjectUpdate>();
  const [saving, setSaving] = useState(false);
  const refresh = () => { setError(''); setRegistry(undefined); loadInformationObjects().then(setRegistry).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось построить реестр.')); };
  useEffect(refresh, []);
  const issuesByObject = useMemo(() => new Map(registry?.objects.map(item => [item.id, registry.issues.filter(issue => issue.objectId === item.id)]) ?? []), [registry]);
  const objects = useMemo(() => (registry?.objects ?? []).filter(item => {
    if (kind !== 'all' && item.kind !== kind) return false;
    const issues = issuesByObject.get(item.id) ?? [];
    if (filter === 'broken' && issues.length === 0) return false;
    if (!['all', 'broken'].includes(filter) && !issues.some(issue => issue.code === filter)) return false;
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    return !needle || [item.name, item.id, ...item.aliases, ...item.producers.map(value => value.processName), ...item.consumers.map(value => value.processName)].some(value => value.toLocaleLowerCase('ru-RU').includes(needle));
  }), [registry, issuesByObject, kind, filter, query]);
  const dependencies = useMemo(() => buildProcessDependencies(registry?.objects ?? [], new Set(registry?.issues.map(issue => issue.objectId) ?? [])), [registry]);
  const visibleDependencies = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    return dependencies.map(item => ({ ...item, objects: item.objects.filter(object => {
      if (kind !== 'all' && object.kind !== kind) return false;
      if (filter !== 'all' && filter !== 'broken' && !(issuesByObject.get(object.id) ?? []).some(issue => issue.code === filter)) return false;
      if (filter === 'broken' && !object.hasIssue) return false;
      return !needle || [item.sourceName, item.targetName, object.name, object.id].some(value => value.toLocaleLowerCase('ru-RU').includes(needle));
    }) })).filter(item => item.objects.length > 0);
  }, [dependencies, issuesByObject, kind, filter, query]);
  const occurrence = (item: InformationObjectOccurrence) => <button key={`${item.processId}:${item.elementId}:${item.direction}`} onClick={() => onOpen(item)}><strong>{item.elementName ?? item.processName}</strong>{item.elementName && <small>{item.processName}</small>}{(item.version || item.condition || !item.required) && <small>{item.required ? 'обязательный' : 'необязательный'}{item.version ? ` · версия ${item.version}` : ''}{item.condition ? ` · ${item.condition}` : ''}</small>}<ArrowRight size={14}/></button>;
  const beginEdit = (item: InformationObject) => { setEditing(item.id); setForm({ name: item.name, kind: item.kind, version: item.version, lifecycleState: item.lifecycleState === 'Observed' ? 'Draft' : item.lifecycleState, aliases: item.aliases }); setError(''); };
  const save = async () => { if (!editing || !form) return; setSaving(true); setError(''); try { setRegistry(await saveInformationObject(editing, form)); setEditing(undefined); setForm(undefined); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить объект.'); } finally { setSaving(false); } };
  const exportCsv = () => {
    if (!registry) return;
    if (view === 'dependencies') {
      const header = ['Процесс-источник', 'ID источника', 'Процесс-получатель', 'ID получателя', 'Объекты', 'Обязательные объекты', 'Объекты с замечаниями'];
      const rows = visibleDependencies.map(item => [item.sourceName, item.sourceId, item.targetName, item.targetId, item.objects.map(object => `${object.name} [${object.id}]`).join(' | '), item.objects.filter(object => object.required).map(object => object.name).join(' | '), item.objects.filter(object => object.hasIssue).map(object => object.name).join(' | ')]);
      const csv = `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n')}`;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `process-navigator-process-dependencies-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); return;
    }
    const header = ['ID', 'Наименование', 'Тип', 'Версия', 'Состояние жизненного цикла', 'Диагностика', 'Источники', 'Получатели', 'Упоминания', 'Синонимы'];
    const rows = objects.map(item => {
      const issues = issuesByObject.get(item.id) ?? [];
      const occurrences = (values: InformationObjectOccurrence[]) => values.map(value => `${value.processName}${value.elementName ? ` / ${value.elementName}` : ''}`).join(' | ');
      return [item.id, item.name, item.kind === 'Document' ? 'Документ' : 'Результат', item.version, item.lifecycleState, issues.map(issue => issue.message).join(' | '), occurrences(item.producers), occurrences(item.consumers), occurrences(item.references), item.aliases.join(' | ')];
    });
    const csv = `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `process-navigator-information-objects-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const detail = registry?.objects.find(item => item.id === detailId);
  if (detail) return <InformationObjectDetailPage key={detail.id} item={detail} issues={issuesByObject.get(detail.id) ?? []} onBack={() => setDetailId(undefined)} onOpen={onOpen}/>;
  return <main className="feature-page information-registry"><div className="feature-page-shell">
    <nav className="feature-breadcrumb"><button onClick={onBack}><ArrowLeft size={16}/>Рабочее пространство</button><span>›</span><strong>Документы и результаты</strong></nav>
    <header className="registry-heading"><div><span className="eyebrow">Сквозные зависимости</span><h1>Документы и результаты</h1><p>Автоматический реестр входов и выходов всех доступных процессов. Он показывает, где объект создаётся, кто его получает и где цепочка обрывается.</p></div><div className="registry-heading-actions"><button disabled={!registry} onClick={exportCsv}><Download size={16}/>Выгрузить CSV</button><button onClick={refresh}><RefreshCw size={16}/>Пересчитать</button></div></header>
    {error && <div className="registry-error">{error}</div>}
    {!registry && !error && <div className="editor-loading"><div className="loader"/>Сопоставляем входы, выходы и документы…</div>}
    {registry && <>
      <section className="registry-kpis"><article><strong>{registry.objectCount}</strong><span>объектов</span></article><article><strong>{registry.documentCount}</strong><span>документов</span></article><article><strong>{registry.resultCount}</strong><span>прочих результатов</span></article><article className={registry.missingProducerCount ? 'is-alert' : ''}><strong>{registry.missingProducerCount}</strong><span>без источника</span></article><article className={registry.missingConsumerCount ? 'is-warning' : ''}><strong>{registry.missingConsumerCount}</strong><span>без получателя</span></article><article className={registry.multipleProducerCount ? 'is-warning' : ''}><strong>{registry.multipleProducerCount}</strong><span>с несколькими источниками</span></article><article className={registry.versionConflictCount ? 'is-warning' : ''}><strong>{registry.versionConflictCount}</strong><span>конфликтов версий</span></article></section>
      <div className="registry-view-tabs"><button className={view === 'objects' ? 'is-active' : ''} onClick={() => setView('objects')}><FileText size={15}/>Объекты</button><button className={view === 'dependencies' ? 'is-active' : ''} onClick={() => setView('dependencies')}><Waypoints size={15}/>Связи процессов <span>{dependencies.length}</span></button></div>
      <section className="registry-tools"><label><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Название, ID или процесс…"/></label><select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="all">Все типы</option><option value="Document">Документы</option><option value="Result">Результаты</option></select><select value={filter} onChange={event => setFilter(event.target.value as Filter)}><option value="all">Все состояния</option><option value="broken">Только замечания</option><option value="missing-producer">Нет источника</option><option value="missing-consumer">Нет получателя</option><option value="multiple-producers">Несколько источников</option><option value="version-conflict">Конфликт версий</option></select></section>
      {view === 'objects' ? <><div className="registry-count">Показано {objects.length} из {registry.objectCount} · проанализировано процессов: {registry.processCount}</div>
      <section className="registry-list">{objects.map(item => { const issues = issuesByObject.get(item.id) ?? []; const open = expanded === item.id; const upstream = open ? upstreamFor(item, registry.objects) : []; return <article key={item.id} className={issues.some(issue => issue.severity === 'Error') ? 'has-error' : issues.length ? 'has-warning' : ''}>
        <button className="registry-row" onClick={() => setExpanded(open ? undefined : item.id)} aria-expanded={open}><span className="registry-kind">{item.kind === 'Document' ? <FileText size={18}/> : <Waypoints size={18}/>}<small>{item.kind === 'Document' ? 'Документ' : 'Результат'}</small></span><span className="registry-name"><strong>{item.name}</strong><small>{item.id}{item.aliases.length > 1 ? ` · вариантов названия: ${item.aliases.length}` : ''}</small></span><span><strong>{item.producers.length}</strong><small>источников</small></span><span><strong>{item.consumers.length}</strong><small>получателей</small></span><span className="registry-state">{issues.length > 0 && <AlertTriangle size={15}/>} {item.state}</span></button>
        {open && <div className="registry-details">
          <div className="registry-manage"><button onClick={() => setDetailId(item.id)}>Открыть полную карточку <ArrowRight size={14}/></button></div>
          {issues.length > 0 && <div className="registry-issues">{issues.map(issue => <p key={issue.code} className={issue.severity === 'Error' ? 'is-error' : ''}><AlertTriangle size={14}/>{issue.message}</p>)}</div>}
          {editing === item.id && form ? <div className="registry-editor">
            <div><label>Каноническое наименование<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label><label>Тип<select value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value as InformationObjectUpdate['kind'] })}><option value="Document">Документ</option><option value="Result">Результат</option></select></label><label>Версия<input value={form.version} onChange={event => setForm({ ...form, version: event.target.value })}/></label><label>Состояние<select value={form.lifecycleState} onChange={event => setForm({ ...form, lifecycleState: event.target.value as InformationObjectUpdate['lifecycleState'] })}><option value="Draft">Черновик</option><option value="Active">Действующий</option><option value="Archived">Архивный</option></select></label></div>
            <label>Синонимы — по одному в строке<textarea rows={4} value={form.aliases.join('\n')} onChange={event => setForm({ ...form, aliases: event.target.value.split('\n') })}/></label>
            <footer><button onClick={() => { setEditing(undefined); setForm(undefined); }}><X size={14}/>Отмена</button><button className="is-primary" disabled={saving} onClick={save}><Save size={14}/>{saving ? 'Сохранение…' : 'Сохранить объект'}</button></footer>
          </div> : <>
            {canManage && <div className="registry-manage"><span>{item.managed ? `Версия ${item.version} · ${item.lifecycleState === 'Active' ? 'действующий' : item.lifecycleState === 'Archived' ? 'архивный' : 'черновик'}` : 'Автоматически обнаруженный объект'}</span><button onClick={() => beginEdit(item)}><Pencil size={14}/>{item.managed ? 'Изменить' : 'Принять в реестр'}</button></div>}
            <div className="registry-flow"><section><h3>Создают</h3>{item.producers.length ? item.producers.map(occurrence) : <p>Источник не найден</p>}</section><section><h3>Получают</h3>{item.consumers.length ? item.consumers.map(occurrence) : <p>Получатель не найден</p>}</section><section><h3>Упоминают</h3>{item.references.length ? item.references.map(occurrence) : <p>Дополнительных ссылок нет</p>}</section></div>
            {item.producers.length > 0 && <div className="registry-upstream"><h3>Цепочка предшествующих объектов</h3>{upstream.length ? <div>{upstream.map(entry => <button key={entry.object.id} style={{ '--dependency-depth': entry.depth } as CSSProperties} onClick={() => { setQuery(entry.object.name); setExpanded(entry.object.id); }}><span>Уровень −{entry.depth}</span><strong>{entry.object.name}</strong><small>через {entry.viaProcesses.join(', ')}</small>{entry.object.producers.length === 0 && <em>источник не найден</em>}</button>)}</div> : <p>Входящие объекты для процессов-источников пока не описаны.</p>}</div>}
            {item.aliases.length > 1 && <p className="registry-aliases"><strong>Варианты названия:</strong> {item.aliases.join(' · ')}</p>}
          </>}
        </div>}
      </article>; })}{objects.length === 0 && <div className="registry-empty">По выбранным условиям ничего не найдено.</div>}</section></> : <><div className="registry-count">Показано связей: {visibleDependencies.length} из {dependencies.length} · участвует процессов: {registry.processCount}</div><section className="process-dependency-list">{visibleDependencies.map(item => <article key={`${item.sourceId}:${item.targetId}`}><div className="process-dependency-route"><button onClick={() => onOpen({ processId: item.sourceId, processName: item.sourceName, scope: 'Process', direction: 'Producer', required: true })}><small>Источник</small><strong>{item.sourceName}</strong><span>{item.sourceId}</span></button><ArrowRight size={18}/><button onClick={() => onOpen({ processId: item.targetId, processName: item.targetName, scope: 'Process', direction: 'Consumer', required: true })}><small>Получатель</small><strong>{item.targetName}</strong><span>{item.targetId}</span></button></div><div className="process-dependency-objects">{item.objects.map(object => <button key={object.id} className={object.hasIssue ? 'has-issue' : ''} onClick={() => { setView('objects'); setQuery(object.name); setExpanded(object.id); }}><span>{object.kind === 'Document' ? <FileText size={13}/> : <Waypoints size={13}/>}</span><strong>{object.name}</strong><small>{object.required ? 'обязательный' : 'необязательный'} · {object.id}</small>{object.hasIssue && <AlertTriangle size={13}/>}</button>)}</div></article>)}{visibleDependencies.length === 0 && <div className="registry-empty">Межпроцессные передачи по выбранным условиям не найдены.</div>}</section></>}
    </>}
  </div></main>;
}
