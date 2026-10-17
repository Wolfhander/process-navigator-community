import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { loadOrganization, saveProcessDirections, type ProcessDirectionSelection } from './api';
import type { OrganizationMap, ProcessSummary } from './types';
import './process-direction-matrix.css';

type DirectionRef = ProcessDirectionSelection['directions'][number];
const key = (ref: DirectionRef) => `${ref.legalEntityId}\u001f${ref.directionId}`;
const initialSelections = (organization: OrganizationMap, catalog: ProcessSummary[]) => Object.fromEntries(catalog.map(process => [process.id,
  organization.legalEntities.flatMap(entity => entity.directions.filter(direction => direction.processIds.some(id => id.toLowerCase() === process.id.toLowerCase()))
    .map(direction => ({ legalEntityId: entity.id, directionId: direction.id })))])) as Record<string, DirectionRef[]>;
const same = (a: DirectionRef[] = [], b: DirectionRef[] = []) => a.length === b.length && a.every(ref => b.some(other => key(ref) === key(other)));

export function ProcessDirectionMatrixDialog({ catalog, onClose, onSaved, page = false }: { catalog: ProcessSummary[]; onClose: () => void; onSaved: (organization: OrganizationMap) => void; page?: boolean }) {
  const [organization, setOrganization] = useState<OrganizationMap>();
  const [baseline, setBaseline] = useState<Record<string, DirectionRef[]>>({});
  const [assignments, setAssignments] = useState<Record<string, DirectionRef[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState(catalog[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [bulkDirection, setBulkDirection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadOrganization().then(map => { const values = initialSelections(map, catalog); setOrganization(map); setBaseline(values); setAssignments(values); }).catch(reason => setError(reason.message)); }, [catalog]);
  const directions = useMemo(() => organization?.legalEntities.flatMap(entity => entity.directions.map(direction => ({
    ref: { legalEntityId: entity.id, directionId: direction.id }, label: `${entity.name} / ${direction.name}`
  }))) ?? [], [organization]);
  const visible = catalog.filter(process => (!unassignedOnly || !(assignments[process.id]?.length)) &&
    `${process.name} ${process.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const changed = catalog.filter(process => !same(assignments[process.id], baseline[process.id]));
  const update = (processIds: string[], ref: DirectionRef, add: boolean) => setAssignments(previous => {
    const next = { ...previous };
    for (const id of processIds) next[id] = add
      ? [...(previous[id] ?? []).filter(item => key(item) !== key(ref)), ref]
      : (previous[id] ?? []).filter(item => key(item) !== key(ref));
    return next;
  });
  const applyBulk = (add: boolean) => {
    const direction = directions.find(item => key(item.ref) === bulkDirection);
    if (direction) update(selected, direction.ref, add);
  };
  const save = async () => {
    setBusy(true); setError('');
    try {
      const updated = await saveProcessDirections(changed.map(process => ({ processId: process.id, directions: assignments[process.id] ?? [] })));
      setOrganization(updated);
      const next = initialSelections(updated, catalog); setBaseline(next); setAssignments(next);
      onSaved(updated);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить направления.'); }
    finally { setBusy(false); }
  };
  const content = <section className={`direction-matrix${page ? ' direction-matrix-page-content' : ''}`} role={page ? 'region' : 'dialog'} aria-modal={page ? undefined : true} aria-label="Распределение процессов по направлениям">
    <header><div><span className="eyebrow">Настройки · Каталог процессов</span><h2>Распределение по направлениям</h2><p>Выберите процесс и отметьте направления справа. Для массового назначения отметьте несколько строк.</p></div>{!page && <button className="dialog-close" onClick={onClose} aria-label="Закрыть">×</button>}</header>
    {error && <p className="direction-matrix-error" role="alert">{error}</p>}
    {!organization ? <p className="direction-matrix-loading">Загружаем организационную структуру…</p> : <>
      <div className="direction-matrix-toolbar"><input aria-label="Поиск процесса" placeholder="Найти процесс по названию или коду" value={query} onChange={event => setQuery(event.target.value)}/><label><input type="checkbox" checked={unassignedOnly} onChange={event => setUnassignedOnly(event.target.checked)}/> Без направления ({catalog.filter(process => !(assignments[process.id]?.length)).length})</label></div>
      <div className="direction-matrix-main"><div className="direction-matrix-list"><div className="direction-matrix-list-head"><label><input type="checkbox" checked={visible.length > 0 && visible.every(item => selected.includes(item.id))} onChange={event => setSelected(event.target.checked ? [...new Set([...selected, ...visible.map(item => item.id)])] : selected.filter(id => !visible.some(item => item.id === id)))}/> Выбрать видимые</label><span>{visible.length} из {catalog.length}</span></div>
        {visible.map(process => <div key={process.id} className={`direction-matrix-row ${active === process.id ? 'active' : ''}`}><input type="checkbox" aria-label={`Выбрать ${process.name}`} checked={selected.includes(process.id)} onChange={event => setSelected(event.target.checked ? [...selected, process.id] : selected.filter(id => id !== process.id))}/><button onClick={() => setActive(process.id)}><strong>{process.name}</strong><small>{process.id} · {(assignments[process.id] ?? []).map(ref => directions.find(item => key(item.ref) === key(ref))?.label ?? ref.directionId).join(', ') || 'Без направления'}</small></button>{!same(assignments[process.id], baseline[process.id]) && <span title="Не сохранено">●</span>}</div>)}
        {visible.length === 0 && <p className="direction-matrix-empty">Процессы не найдены.</p>}</div>
        <aside><h3>{catalog.find(process => process.id === active)?.name ?? 'Выберите процесс'}</h3><p>Один процесс может относиться к нескольким направлениям.</p>{organization.legalEntities.map(entity => <div key={entity.id} className="direction-matrix-group"><strong>{entity.name}</strong>{entity.directions.map(direction => { const ref = { legalEntityId: entity.id, directionId: direction.id }; return <label key={direction.id}><input type="checkbox" checked={(assignments[active] ?? []).some(item => key(item) === key(ref))} disabled={!active} onChange={event => update([active], ref, event.target.checked)}/>{direction.name}</label>; })}</div>)}</aside></div>
      <div className="direction-matrix-bulk"><strong>Выбрано: {selected.length}</strong><select aria-label="Направление для массовой операции" value={bulkDirection} onChange={event => setBulkDirection(event.target.value)}><option value="">Выберите направление</option>{directions.map(item => <option key={key(item.ref)} value={key(item.ref)}>{item.label}</option>)}</select><button disabled={!selected.length || !bulkDirection} onClick={() => applyBulk(true)}>Добавить выбранным</button><button disabled={!selected.length || !bulkDirection} onClick={() => applyBulk(false)}>Убрать у выбранных</button></div>
    </>}
    <footer><span>Несохранённых процессов: {changed.length}</span>{!page && <button onClick={onClose}>Закрыть</button>}<button className="primary" disabled={!changed.length || busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить изменения'}</button></footer>
  </section>;
  if (!page) return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>{content}</div>;
  return <main className="feature-page direction-matrix-page"><div className="feature-page-shell"><nav className="feature-breadcrumb" aria-label="Путь раздела"><button onClick={onClose}><ArrowLeft size={16}/>Настройки</button><span>›</span><strong>Распределение процессов</strong></nav>{content}</div></main>;
}
