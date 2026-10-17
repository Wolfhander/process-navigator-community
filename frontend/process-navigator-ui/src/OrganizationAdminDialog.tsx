import { useState } from 'react';
import { ArrowLeft, Building2, Network, Plus, Save, Trash2, X } from 'lucide-react';
import { saveOrganization } from './api';
import { OrganizationUnitEditor } from './OrganizationUnitEditor';
import type { BusinessDirection, LegalEntity, OrganizationMap, ProcessSummary } from './types';
import './organization-admin.css';

type Props = {
  organization: OrganizationMap;
  catalog: ProcessSummary[];
  onClose: () => void;
  onSaved: (organization: OrganizationMap) => void;
  page?: boolean;
};

type EditorSection = 'directions' | 'units';

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const emptyDirection = (): BusinessDirection => ({
  id: newId('direction'),
  name: 'Новое направление',
  description: '',
  icon: 'planning',
  processIds: [],
});
const emptyEntity = (): LegalEntity => ({
  id: newId('entity'),
  name: 'Новое юридическое лицо',
  description: '',
  directions: [emptyDirection()],
  units: [],
});

export function OrganizationAdminDialog({ organization, catalog, onClose, onSaved, page = false }: Props) {
  const [draft, setDraft] = useState<OrganizationMap>(() => structuredClone(organization));
  const [selectedId, setSelectedId] = useState(draft.legalEntities[0]?.id);
  const [section, setSection] = useState<EditorSection>('directions');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = draft.legalEntities.find(item => item.id === selectedId);
  const usedBy: Record<string, string[]> = {};
  if (selected) for (const process of organization.crossCompanyProcesses) {
    const name = catalog.find(item => item.id === process.processId)?.name ?? process.processId;
    for (const lane of process.laneOrganizations.filter(item => item.legalEntityId === selected.id && item.unitId))
      if (!(usedBy[lane.unitId!] ??= []).includes(name)) usedBy[lane.unitId!].push(name);
  }
  const linkedEntityProcesses = selected
    ? organization.crossCompanyProcesses.filter(process => process.laneOrganizations.some(lane => lane.legalEntityId === selected.id))
    : [];
  const originalEntity = organization.legalEntities.find(item => item.id === selectedId);
  const renamedLinkedUnits = selected?.units?.filter(unit => {
    const original = originalEntity?.units?.find(item => item.id === unit.id);
    return usedBy[unit.id]?.length && original && (original.name !== unit.name || original.shortName !== unit.shortName);
  }) ?? [];

  const updateEntity = (change: Partial<LegalEntity>) => setDraft(current => ({
    ...current,
    legalEntities: current.legalEntities.map(item => item.id === selectedId ? { ...item, ...change } : item),
  }));
  const updateDirection = (id: string, change: Partial<BusinessDirection>) => selected && updateEntity({
    directions: selected.directions.map(item => item.id === id ? { ...item, ...change } : item),
  });
  const removeEntity = (id: string) => {
    const next = draft.legalEntities.filter(item => item.id !== id);
    setDraft(current => ({ ...current, legalEntities: next }));
    setSelectedId(next[0]?.id);
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      onSaved(await saveOrganization(draft));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить структуру.');
    } finally {
      setBusy(false);
    }
  };

  const content = <section className={`organization-dialog${page ? ' organization-page-content' : ''}`} role={page ? 'region' : 'dialog'} aria-modal={page ? undefined : true} aria-label="Настройки группы и организационная структура">
      <header>
        <div><span className="eyebrow">Системное администрирование</span><h2>Настройки группы и оргструктуры</h2><p>Название группы, юридические лица, направления и многоуровневое подчинение подразделений.</p></div>
        {!page && <button className="dialog-close" onClick={onClose}><X size={17}/></button>}
      </header>

      <div className="organization-group-fields">
        <label>Название группы<input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}/></label>
        <label>Описание<input value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}/></label>
      </div>

      <div className="organization-body">
        <aside>
          <div className="organization-list-title"><strong>Юридические лица</strong><button onClick={() => { const entity = emptyEntity(); setDraft(current => ({ ...current, legalEntities: [...current.legalEntities, entity] })); setSelectedId(entity.id); }}><Plus size={15}/></button></div>
          {draft.legalEntities.map(entity => <button key={entity.id} className={entity.id === selectedId ? 'is-active' : ''} onClick={() => setSelectedId(entity.id)}>
            <Building2 size={16}/><span><strong>{entity.name}</strong><small>{entity.directions.length} напр. · {entity.units?.length ?? 0} подразделений</small></span>
          </button>)}
        </aside>

        <div className="organization-editor">{selected ? <>
          <div className="entity-fields">
            <label>Наименование<input value={selected.name} onChange={event => updateEntity({ name: event.target.value })}/></label>
            <label>Описание<textarea value={selected.description} onChange={event => updateEntity({ description: event.target.value })}/></label>
          </div>
          <nav className="organization-section-tabs">
            <button className={section === 'directions' ? 'is-active' : ''} onClick={() => setSection('directions')}><Building2 size={14}/>Направления ({selected.directions.length})</button>
            <button className={section === 'units' ? 'is-active' : ''} onClick={() => setSection('units')}><Network size={14}/>Подразделения ({selected.units?.length ?? 0})</button>
          </nav>

          {section === 'directions' ? <>
            <div className="directions-title"><strong>Направления деятельности</strong><button onClick={() => updateEntity({ directions: [...selected.directions, emptyDirection()] })}><Plus size={14}/>Добавить</button></div>
            <div className="direction-editor-list">{selected.directions.map(direction => <article key={direction.id}>
              <label>Название<input value={direction.name} onChange={event => updateDirection(direction.id, { name: event.target.value })}/></label>
              <label>Описание<input value={direction.description} onChange={event => updateDirection(direction.id, { description: event.target.value })}/></label>
              <button className="remove-direction" onClick={() => updateEntity({ directions: selected.directions.filter(item => item.id !== direction.id) })}><Trash2 size={14}/></button>
              <fieldset className="direction-processes"><legend>Процессы направления</legend>{catalog.map(process => <label key={process.id}><input type="checkbox" checked={direction.processIds.includes(process.id)} onChange={event => updateDirection(direction.id, { processIds: event.target.checked ? [...direction.processIds, process.id] : direction.processIds.filter(id => id !== process.id) })}/>{process.name}</label>)}</fieldset>
            </article>)}</div>
          </> : <OrganizationUnitEditor
            units={selected.units ?? []}
            usedBy={usedBy}
            onChange={units => updateEntity({ units })}
          />}

          {!!renamedLinkedUnits.length && <p className="organization-impact">Изменены названия подразделений, участвующих в процессах ({renamedLinkedUnits.length}). Привязки по ID сохранятся; опубликованные BPMN не меняются. После сохранения откройте «Обновить дорожки черновиков» в настройках.</p>}
          {!!linkedEntityProcesses.length && <p className="organization-impact">Это юридическое лицо участвует в {linkedEntityProcesses.length} процессах. Перед удалением переназначьте их дорожки.</p>}
          <button className="remove-entity" disabled={draft.legalEntities.length === 1 || !!linkedEntityProcesses.length} onClick={() => removeEntity(selected.id)}><Trash2 size={14}/>Удалить юридическое лицо</button>
        </> : <p>Выберите юридическое лицо.</p>}</div>
      </div>

      {error && <div className="organization-error">{error}</div>}
      <footer>{!page && <button onClick={onClose}>Отмена</button>}<button className="primary" disabled={busy} onClick={submit}><Save size={15}/>{busy ? 'Сохраняем…' : 'Сохранить структуру'}</button></footer>
    </section>;
  if (!page) return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>{content}</div>;
  return <main className="feature-page organization-page"><div className="feature-page-shell"><nav className="feature-breadcrumb" aria-label="Путь раздела"><button onClick={onClose}><ArrowLeft size={16}/>Настройки</button><span>›</span><strong>Группа и оргструктура</strong></nav>{content}</div></main>;
}
