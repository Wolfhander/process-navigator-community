import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, ChevronRight, Search, UserRound } from 'lucide-react';
import type { OrganizationUnit } from './types';
import './organization-tree.css';

type Props = { units: OrganizationUnit[] };

export function OrganizationTree({ units }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const children = useMemo(() => {
    const map = new Map<string | undefined, OrganizationUnit[]>();
    const ids = new Set(units.map(unit => unit.id));
    for (const unit of units) {
      const parent = unit.parentId && ids.has(unit.parentId) ? unit.parentId : undefined;
      map.set(parent, [...(map.get(parent) ?? []), unit]);
    }
    return map;
  }, [units]);
  const visible = useMemo(() => {
    if (!query.trim()) return undefined;
    const result = new Set<string>();
    const byId = new Map(units.map(unit => [unit.id, unit]));
    for (const unit of units) if (`${unit.name} ${unit.shortName} ${unit.managerPosition}`.toLowerCase().includes(query.trim().toLowerCase())) {
      result.add(unit.id);
      let parentId = unit.parentId;
      while (parentId && byId.has(parentId)) { result.add(parentId); parentId = byId.get(parentId)?.parentId; }
    }
    return result;
  }, [query, units]);
  const toggle = (id: string) => setCollapsed(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const render = (unit: OrganizationUnit, depth: number): ReactNode => {
    if (visible && !visible.has(unit.id)) return null;
    const nested = children.get(unit.id) ?? [];
    const isCollapsed = collapsed.has(unit.id) && !visible;
    return <div className="organization-tree-branch" key={unit.id}>
      <article className="organization-tree-unit" style={{ '--tree-depth': depth } as CSSProperties}>
        <button className="tree-toggle" disabled={!nested.length} onClick={() => toggle(unit.id)} aria-label={isCollapsed ? 'Развернуть' : 'Свернуть'}>{nested.length ? (isCollapsed ? <ChevronRight size={15}/> : <ChevronDown size={15}/>) : <span/>}</button>
        <span className="tree-unit-copy"><strong>{unit.name}</strong><small>{unit.shortName || 'Без сокращения'}</small></span>
        <span className="tree-manager"><UserRound size={14}/><span><small>Руководитель</small><strong>{unit.managerPosition || 'Не указан'}</strong></span></span>
      </article>
      {!isCollapsed && nested.map(child => render(child, depth + 1))}
    </div>;
  };

  if (!units.length) return <div className="organization-tree-empty">Организационные подразделения пока не настроены.</div>;
  return <section className="organization-tree">
    <label><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти подразделение или руководителя…"/></label>
    <div>{(children.get(undefined) ?? []).map(unit => render(unit, 0))}</div>
    {visible?.size === 0 && <div className="organization-tree-empty">Совпадений не найдено.</div>}
  </section>;
}
