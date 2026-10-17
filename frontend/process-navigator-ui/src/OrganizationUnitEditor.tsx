import type { CSSProperties } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { OrganizationUnit } from './types';
import './organization-unit-editor.css';

type Props = { units: OrganizationUnit[]; usedBy: Record<string, string[]>; onChange: (units: OrganizationUnit[]) => void };
const createId = () => `unit-${crypto.randomUUID().slice(0, 8)}`;

export function OrganizationUnitEditor({ units, usedBy, onChange }: Props) {
  const update = (id: string, change: Partial<OrganizationUnit>) => onChange(units.map(unit => unit.id === id ? { ...unit, ...change } : unit));
  const add = (parentId?: string) => onChange([...units, { id: createId(), parentId, name: 'Новое подразделение', shortName: '', managerPosition: '' }]);
  const remove = (id: string) => onChange(units.filter(unit => unit.id !== id));
  const hasChildren = (id: string) => units.some(unit => unit.parentId === id);
  const depth = (unit: OrganizationUnit) => { let value = 0; let parentId = unit.parentId; const visited = new Set<string>(); while (parentId && !visited.has(parentId)) { visited.add(parentId); const parent = units.find(item => item.id === parentId); if (!parent) break; value++; parentId = parent.parentId; } return value; };
  const ordered = [...units].sort((left, right) => left.id.localeCompare(right.id, 'ru', { numeric: true }));

  return <section className="unit-editor">
    <header><div><strong>Подразделения и подчинённость</strong><small>Руководитель хранится как должность, а не как конкретный сотрудник.</small></div><button onClick={() => add()}><Plus size={14}/>Корневое подразделение</button></header>
    {!units.length && <div className="unit-editor-empty">Добавьте первое подразделение юридического лица.</div>}
    <div className="unit-editor-list">{ordered.map(unit => <article key={unit.id} style={{ '--unit-depth': Math.min(depth(unit), 5) } as CSSProperties}>
      <div className="unit-editor-main"><label>Название<input value={unit.name} onChange={event => update(unit.id, { name: event.target.value })}/></label><label>Сокращение<input value={unit.shortName} onChange={event => update(unit.id, { shortName: event.target.value })}/></label><label>Руководящая должность<input value={unit.managerPosition} onChange={event => update(unit.id, { managerPosition: event.target.value })}/></label></div>
      <div className="unit-editor-relations"><label>Подчиняется<select value={unit.parentId ?? ''} onChange={event => update(unit.id, { parentId: event.target.value || undefined })}><option value="">Нет — корневой уровень</option>{units.filter(candidate => candidate.id !== unit.id).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><button onClick={() => add(unit.id)}><Plus size={14}/>Подразделение</button><button className="unit-remove" disabled={hasChildren(unit.id) || !!usedBy[unit.id]?.length} title={hasChildren(unit.id) ? 'Сначала удалите или перенесите подчинённые подразделения' : usedBy[unit.id]?.length ? 'Сначала переназначьте дорожки связанных процессов' : 'Удалить'} onClick={() => remove(unit.id)}><Trash2 size={14}/></button></div>
      {!!usedBy[unit.id]?.length && <p className="unit-editor-usage">Участвует в процессах: {usedBy[unit.id].join(', ')}. Перед удалением переназначьте их дорожки.</p>}
    </article>)}</div>
  </section>;
}
