import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Building2, MapPin, Network, UserRound, X } from 'lucide-react';
import { loadOrganization } from './api';
import type { OrganizationMap, ProcessAssignments, ProcessModel } from './types';

export function ResponsibilityMatrixDialog({ process, assignments, onClose, onSelectLane }: {
  process: ProcessModel;
  assignments: ProcessAssignments;
  onClose: () => void;
  onSelectLane: (laneId: string) => void;
}) {
  const [organization, setOrganization] = useState<OrganizationMap>();
  const [error, setError] = useState('');

  useEffect(() => {
    loadOrganization().then(setOrganization).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить организационную модель.'));
  }, []);

  const rows = useMemo(() => {
    const processOrganization = organization?.crossCompanyProcesses.find(item => item.processId === process.id);
    return process.lanes.map(lane => {
      const link = processOrganization?.laneOrganizations.find(item => item.laneId === lane.id);
      const entity = organization?.legalEntities.find(item => item.id === link?.legalEntityId);
      const unit = entity?.units?.find(item => item.id === link?.unitId);
      const laneAssignment = assignments.lanes.find(item => item.laneId === lane.id);
      const people = (laneAssignment?.userIds ?? []).map(id => assignments.users.find(user => user.id === id)).filter((user): user is NonNullable<typeof user> => !!user);
      const unitById = new Map(entity?.units?.map(item => [item.id, item]) ?? []);
      const path: string[] = [];
      let current = unit;
      while (current) { path.unshift(current.shortName || current.name); current = current.parentId ? unitById.get(current.parentId) : undefined; }
      return { lane, entity, unit, people, path };
    });
  }, [organization, process, assignments]);

  const assignedCount = rows.reduce((total, row) => total + row.people.length, 0);
  const problemCount = rows.filter(row => !row.unit || !row.people.length).length;

  return createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="import-dialog responsibility-dialog" role="dialog" aria-modal="true" aria-labelledby="responsibility-title">
      <button className="icon-button dialog-close" onClick={onClose} aria-label="Закрыть"><X size={18}/></button>
      <span className="eyebrow">Организационная модель процесса</span>
      <h2 id="responsibility-title">Матрица ответственности</h2>
      <p>Сводное представление дорожек, подразделений и реальных участников процесса «{process.name}».</p>
      <div className="responsibility-summary">
        <div><Network size={18}/><span><strong>{rows.length}</strong><small>дорожек</small></span></div>
        <div><UserRound size={18}/><span><strong>{assignedCount}</strong><small>назначений</small></span></div>
        <div className={problemCount ? 'has-warning' : ''}><AlertTriangle size={18}/><span><strong>{problemCount}</strong><small>требуют внимания</small></span></div>
      </div>
      {error && <div className="import-message is-error"><AlertTriangle size={17}/>{error}</div>}
      <div className="responsibility-table">
        <div className="responsibility-head"><span>Дорожка BPMN</span><span>Организация и подразделение</span><span>Назначенные сотрудники</span></div>
        {rows.map(row => <button key={row.lane.id} className="responsibility-row" onClick={() => onSelectLane(row.lane.id)}>
          <span className="responsibility-lane"><Network size={16}/><span><strong>{row.lane.name}</strong><small>{process.nodes.filter(node => node.laneId === row.lane.id).length} элементов</small></span></span>
          <span className="responsibility-organization">
            {row.entity ? <><span><Building2 size={14}/>{row.entity.name}</span>{row.unit ? <><strong>{row.unit.name}</strong><small><MapPin size={12}/>{row.path.join(' → ')}</small>{row.unit.managerPosition && <em>{row.unit.managerPosition}</em>}</> : <small className="responsibility-warning">Подразделение не выбрано</small>}</> : <small className="responsibility-warning">Организационная привязка не задана</small>}
          </span>
          <span className="responsibility-people">{row.people.length ? row.people.map(person => <span key={person.id}><UserRound size={14}/><span><strong>{person.displayName}</strong><small>{person.position || person.roleName}</small></span></span>) : <small className="responsibility-warning">Сотрудники не назначены</small>}</span>
        </button>)}
      </div>
      <footer className="responsibility-footer"><span>Нажмите строку, чтобы перейти к дорожке на схеме.</span><button onClick={onClose}>Закрыть</button></footer>
    </section>
  </div>, document.body);
}
