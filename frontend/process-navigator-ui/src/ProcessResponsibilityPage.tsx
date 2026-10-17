import { useEffect, useMemo, useState } from 'react';
import { loadOrganization } from './api';
import type { OrganizationMap, ProcessAssignments, ProcessModel, ProcessNode } from './types';
import { buildResponsibilityView } from './process-responsibility';
import './process-instruction.css';

export function ProcessResponsibilityPage({ process, assignments, edition, onBack, onSelect }: {
  process: ProcessModel; assignments?: ProcessAssignments; edition: string; onBack: () => void; onSelect: (node: ProcessNode) => void;
}) {
  assignments = assignments?.processId === process.id ? assignments : undefined;
  const [organization, setOrganization] = useState<OrganizationMap>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [entityId, setEntityId] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setOrganization(undefined); setError('');
    loadOrganization(controller.signal).then(value => { if (!controller.signal.aborted) setOrganization(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Оргструктура недоступна.'); });
    return () => controller.abort();
  }, [process.id, reload]);
  const built = useMemo(() => {
    try { return { data: buildResponsibilityView(process, organization, assignments), error: '' }; }
    catch (cause) { return { data: undefined, error: cause instanceof Error ? cause.message : 'Не удалось построить представление.' }; }
  }, [process, organization, assignments]);
  const data = built.data;
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const rows = data?.rows.filter(row => (!entityId || row.entity?.id === entityId) &&
    (!needle || [row.lane.name, row.entity?.name, row.unit?.name, ...row.people.map(user => user.displayName)].join(' ').toLocaleLowerCase('ru-RU').includes(needle))) ?? [];
  const visible = new Set(rows.map(row => row.lane.id));
  const transfers = data?.transfers.filter(item => (!needle && !entityId) || visible.has(data.nodes.get(item.fromId)!.laneId) || visible.has(data.nodes.get(item.toId)!.laneId)) ?? [];
  const laneLabel = (id: string) => data?.rows.find(row => row.lane.id === id)?.lane.name ?? 'Дорожка не найдена';
  const context = (id: string) => { const row = data?.rows.find(row => row.lane.id === id); return [row?.entity?.name ?? 'Организация не установлена', row?.unit?.name ?? laneLabel(id)].join(' / '); };
  const stepLink = (id: string) => { const node = data!.nodes.get(id)!; return <button onClick={() => onSelect(node)}>{node.name || id} · {laneLabel(node.laneId)}</button>; };
  return <main className="feature-page instruction-page"><div className="feature-page-shell"><nav className="feature-breadcrumb"><button onClick={onBack}>← К схеме процесса</button><span>›</span><strong>Ответственность и передачи</strong></nav>
    <header><span className="eyebrow">{edition} · версия {process.version}</span><h1>{process.name}</h1><p>Схема — открытой редакции; оргпривязки и назначения — текущие справочники, не исторический снимок. Назначение на дорожку не означает, что сотрудник фактически выполнил каждый её шаг.</p></header>
    <p>Страница только для чтения. Возможная передача по стрелкам — не факт исполнения или подтверждение приёмки; отдельная фиксация приёмки здесь не реализована.</p>
    {!organization && !error && <p role="status">Загружаем оргструктуру…</p>}{error && <p role="alert">{error} Оргпривязки пока не подтверждены.</p>}
    {!assignments && <p>Назначения сотрудников ещё не загружены. Это не означает их отсутствие.</p>}
    <button onClick={() => setReload(value => value + 1)}>Обновить оргструктуру</button>
    {built.error && <p role="alert">{built.error}</p>}
    {data && <><p>Дорожек: {data.rows.length}. Возможных междорожечных передач: {data.transfers.length}. Ошибок ссылок в стрелках: {data.broken}. Действий без дорожки: {data.tasksWithoutLane}.</p>
      <div className="instruction-filters"><label>Поиск<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Дорожка, подразделение, сотрудник…"/></label><label>Организация<select value={entityId} onChange={event => setEntityId(event.target.value)}><option value="">Все организации</option>{organization?.legalEntities.map(entity => <option value={entity.id} key={entity.id}>{entity.name}</option>)}</select></label></div>
      {rows.slice(0, 200).map(row => <article className="instruction-card" key={row.lane.id}><h2>{row.lane.name}</h2><p>{organization ? row.entity?.name ?? 'Организация не сопоставлена' : 'Оргструктура не загружена'} · {row.unit?.name ?? 'Подразделение не определено'}</p>
        <p>{row.path.join(' → ')}</p>{row.warnings.map((warning, index) => <p className="instruction-warning" key={index}>{warning}</p>)}
        <p>Назначенные сотрудники: {assignments ? row.people.slice(0, 50).map(person => person.displayName + (person.isActive ? '' : ' (неактивен)')).join('; ') || (row.assignedCount ? 'назначения есть, пользователи не найдены' : 'нет назначений') : 'не загружены'}.{row.people.length > 50 ? ' Показаны первые 50 из ' + row.people.length + ' назначений.' : ''}</p>
        <p>Действий на дорожке: {row.tasks.length}.</p>{row.tasks.slice(0, 50).map(node => <p key={node.id}><button onClick={() => onSelect(node)}>{node.name || node.id}</button> · исполнитель шага: {node.executorKind === 'system' ? 'система' : node.executorKind === 'human' ? 'сотрудник' : 'не уточнён'}{node.systemName ? ' · ' + node.systemName : ''}</p>)}
        {row.tasks.length > 50 && <p>Показаны первые 50 действий дорожки. Остальные — на схеме.</p>}
      </article>)}{rows.length > 200 && <p>Показаны первые 200 дорожек. Уточните фильтр.</p>}{!rows.length && <p>Дорожки по выбранному фильтру не найдены.</p>}
      <section className="instruction-card"><h2>Возможные передачи работы</h2><p>Для каждой пары соседних по маршруту действий показан один найденный путь через события/шлюзы, не все варианты условий. Промежуточные действия не пропускаются. Фильтр включает передачи, где видна хотя бы одна сторона.</p>
        {data.limited && <p className="instruction-warning">Достигнут предел обхода или 2000 передач. Список неполный; проверьте исходную схему.</p>}
        {transfers.slice(0, 200).map(item => <article key={item.fromId + ':' + item.toId}><p>{stepLink(item.fromId)} → {stepLink(item.toId)}</p><p>{context(data.nodes.get(item.fromId)!.laneId)} → {context(data.nodes.get(item.toId)!.laneId)}</p><p>Подписи стрелок на найденном пути: {item.labels.join(' → ') || 'не заданы'}.</p>{item.throughParallel && <p>Путь проходит через параллельный шлюз; это не выбор одной альтернативы.</p>}</article>)}
        {transfers.length > 200 && <p>Показаны первые 200 из {transfers.length} передач фильтра.</p>}{!transfers.length && <p>Для фильтра передачи не найдены. Это не подтверждение отсутствия межпроцессных передач документов.</p>}
      </section>
    </>}
  </div></main>;
}
