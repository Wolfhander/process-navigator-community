import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Save, UserRound, Users, X } from 'lucide-react';
import { loadOrganization, saveAssignments } from './api';
import type { OrganizationMap, ProcessAssignments } from './types';

export function AssignmentDialog({ assignments, onClose, onSaved }: { assignments: ProcessAssignments; onClose: () => void; onSaved: (value: ProcessAssignments) => void }) {
  const [draft, setDraft] = useState(assignments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [organization, setOrganization] = useState<OrganizationMap>();
  useEffect(() => { loadOrganization().then(setOrganization).catch(() => undefined); }, []);
  const toggle = (laneId: string, userId: string) => setDraft(current => ({ ...current, lanes: current.lanes.map(lane => lane.laneId !== laneId ? lane : { ...lane, userIds: lane.userIds.includes(userId) ? lane.userIds.filter(id => id !== userId) : [...lane.userIds, userId] }) }));
  const save = async () => { setBusy(true); setError(''); try { onSaved(await saveAssignments(draft.processId, draft)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить ответственных.'); } finally { setBusy(false); } };
  return createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="import-dialog assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="assignments-title">
    <button className="icon-button dialog-close" onClick={onClose} aria-label="Закрыть"><X size={18}/></button><span className="eyebrow">Участники процесса</span><h2 id="assignments-title">Возможные исполнители действий</h2><p>Подразделение определяется дорожкой BPMN. Здесь можно необязательно указать одного или нескольких сотрудников, каждый из которых вправе выполнить действия этой дорожки.</p>
    <div className="assignment-lanes">{draft.lanes.map(lane => {
      const link = organization?.crossCompanyProcesses.find(item => item.processId === draft.processId)?.laneOrganizations.find(item => item.laneId === lane.laneId);
      const orderedUsers = [...draft.users].sort((left, right) => Number(right.unitId === link?.unitId) - Number(left.unitId === link?.unitId) || Number(right.legalEntityId === link?.legalEntityId) - Number(left.legalEntityId === link?.legalEntityId) || left.displayName.localeCompare(right.displayName, 'ru'));
      return <section key={lane.laneId}><header><Users size={17}/><div><strong>{lane.laneName}</strong><small>{lane.userIds.length ? `Назначено: ${lane.userIds.length}` : 'Исполнители не назначены'}</small></div></header><div className="assignment-users">{orderedUsers.map(user => {
        const recommended = !!link?.unitId && user.unitId === link.unitId;
        return <label key={user.id} className={recommended ? 'is-recommended' : ''}><input type="checkbox" checked={lane.userIds.includes(user.id)} onChange={() => toggle(lane.laneId, user.id)}/><UserRound size={15}/><span><strong>{user.displayName}{recommended && <em>Подходит</em>}</strong><small>{user.position || user.roleName}</small></span></label>;
      })}</div></section>;
    })}</div>
    {error && <div className="import-message is-error"><AlertTriangle size={17}/>{error}</div>}<button className="import-submit" disabled={busy} onClick={save}><Save size={17}/>{busy ? 'Сохраняем…' : 'Сохранить назначения'}</button>
  </section></div>, document.body);
}
