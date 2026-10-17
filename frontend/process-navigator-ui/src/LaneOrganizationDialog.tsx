import { useMemo, useState } from 'react';
import { Building2, Network, Save, X } from 'lucide-react';
import { loadDraftBpmn, saveDraftBpmn, saveProcessLaneOrganizations } from './api';
import type { LaneOrganization, OrganizationMap, ProcessModel } from './types';
import './lane-organization-dialog.css';

type Props = { organization: OrganizationMap; process: ProcessModel; updateDraftLaneNames: boolean; onClose: () => void; onSaved: (organization: OrganizationMap) => void };

const findUnitByLaneName = (organization: OrganizationMap, laneName: string) => {
  const normalized = laneName.trim().toLocaleLowerCase('ru');
  for (const entity of organization.legalEntities) {
    const unit = entity.units?.find(item => item.name.trim().toLocaleLowerCase('ru') === normalized || item.shortName.trim().toLocaleLowerCase('ru') === normalized);
    if (unit) return { entity, unit };
  }
  return undefined;
};

const renameDraftLanes = async (processId: string, mappings: LaneOrganization[], organization: OrganizationMap) => {
  const xml = await loadDraftBpmn(processId);
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('Не удалось прочитать BPMN-черновик для переименования дорожек.');
  const lanes = Array.from(document.getElementsByTagNameNS('*', 'lane'));
  for (const mapping of mappings) {
    const entity = organization.legalEntities.find(item => item.id === mapping.legalEntityId);
    const unit = entity?.units?.find(item => item.id === mapping.unitId);
    const lane = lanes.find(item => item.getAttribute('id') === mapping.laneId);
    if (unit && lane) lane.setAttribute('name', mapping.displayNameMode === 'short' && unit.shortName ? unit.shortName : unit.name);
  }
  await saveDraftBpmn(processId, new XMLSerializer().serializeToString(document));
};

export function LaneOrganizationDialog({ organization, process, updateDraftLaneNames, onClose, onSaved }: Props) {
  const existing = organization.crossCompanyProcesses.find(item => item.processId === process.id);
  const [mappings, setMappings] = useState<LaneOrganization[]>(() => process.lanes.map(lane => {
    const saved = existing?.laneOrganizations.find(item => item.laneId === lane.id);
    if (saved) return saved;
    const match = findUnitByLaneName(organization, lane.name);
    return { laneId: lane.id, legalEntityId: match?.entity.id ?? organization.legalEntities[0]?.id ?? '', unitId: match?.unit.id, department: match?.unit.name ?? '', displayNameMode: match?.unit.shortName ? 'short' : 'full' };
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const entityById = useMemo(() => new Map(organization.legalEntities.map(entity => [entity.id, entity])), [organization]);

  const update = (laneId: string, change: Partial<LaneOrganization>) => setMappings(items => items.map(item => item.laneId === laneId ? { ...item, ...change } : item));
  const save = async () => {
    if (mappings.some(item => !item.legalEntityId || !item.unitId)) { setError('Для каждой дорожки выберите подразделение. Назначать конкретных сотрудников на этом этапе не требуется.'); return; }
    setBusy(true); setError('');
    try {
      const saved = await saveProcessLaneOrganizations(process.id, mappings);
      if (updateDraftLaneNames) {
        const latestMappings = saved.crossCompanyProcesses.find(item => item.processId === process.id)?.laneOrganizations ?? mappings;
        try { await renameDraftLanes(process.id, latestMappings, saved); }
        catch (reason) { setError(`Привязки сохранены, но переименовать дорожки в BPMN не удалось: ${reason instanceof Error ? reason.message : 'повторите попытку позже'}`); return; }
      }
      onSaved(saved);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить привязки.'); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="lane-organization-dialog" role="dialog" aria-modal="true" aria-label="Подразделения дорожек">
    <header><div><span className="eyebrow">Организационная модель процесса</span><h2>Дорожки и подразделения</h2><p>Дорожка BPMN — это подразделение. После сохранения система сама определит юридические лица и тип процесса.</p></div><button className="dialog-close" onClick={onClose}><X size={17}/></button></header>
    <div className="lane-mapping-list">{process.lanes.map(lane => {
      const mapping = mappings.find(item => item.laneId === lane.id)!;
      const entity = entityById.get(mapping.legalEntityId);
      const unit = entity?.units?.find(item => item.id === mapping.unitId);
      const effectiveLaneName = unit
        ? mapping.displayNameMode === 'short' && unit.shortName ? unit.shortName : unit.name
        : lane.name;
      return <article key={lane.id}>
        <div className="lane-mapping-role"><Network size={17}/><span><small>Дорожка BPMN</small><strong>{effectiveLaneName}</strong>{effectiveLaneName !== lane.name && <em>В BPMN сейчас: {lane.name}</em>}</span></div>
        <label><span><Building2 size={13}/>Юридическое лицо</span><select value={mapping.legalEntityId} onChange={event => update(lane.id, { legalEntityId: event.target.value, unitId: undefined, department: '' })}>{organization.legalEntities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span><Network size={13}/>Подразделение</span><select value={mapping.unitId ?? ''} onChange={event => { const selected = entity?.units?.find(item => item.id === event.target.value); update(lane.id, { unitId: selected?.id, department: selected?.name ?? '', displayNameMode: selected?.shortName ? 'short' : 'full' }); }}><option value="">Выберите подразделение</option>{(entity?.units ?? []).map(item => <option key={item.id} value={item.id}>{item.id.split('.').slice(1).map(() => '—').join('')} {item.shortName ? `${item.shortName} — ` : ''}{item.name}</option>)}</select></label>
        <label><span>Название дорожки</span><select disabled={!unit} value={mapping.displayNameMode ?? (unit?.shortName ? 'short' : 'full')} onChange={event => update(lane.id, { displayNameMode: event.target.value as 'full' | 'short' })}><option value="short" disabled={!unit?.shortName}>Сокращённое{unit?.shortName ? ` — ${unit.shortName}` : ''}</option><option value="full">Полное{unit?.name ? ` — ${unit.name}` : ''}</option></select><small>Выбор действует только для этой дорожки.</small></label>
      </article>;
    })}</div>
    {error && <div className="lane-mapping-error">{error}</div>}
    <footer><button onClick={onClose}>Отмена</button><button className="primary" disabled={busy || mappings.some(item => !item.unitId)} onClick={save}><Save size={15}/>{busy ? 'Сохраняем…' : 'Сохранить привязки'}</button></footer>
  </section></div>;
}
