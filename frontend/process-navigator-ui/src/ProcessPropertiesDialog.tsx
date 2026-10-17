import { useMemo, useState } from 'react';
import { BookOpen, Building2, FileInput, FileOutput, Network, Save, X } from 'lucide-react';
import { saveProcessProperties } from './api';
import type { OrganizationMap, ProcessModel, ProcessPassport, ProcessSummary } from './types';
import { processLevelOptions } from './process-levels';
import './process-passport.css';
import { SourceRequirementsEditor } from './SourceRequirementsEditor';

type Props = { process: ProcessModel; organization: OrganizationMap; catalog: ProcessSummary[]; onClose: () => void; onSaved: (process: ProcessModel) => void };
const lines = (value?: string[]) => value?.join('\n') ?? '';
const list = (value: string) => value.split(/\r?\n|;/).map(item => item.trim()).filter(Boolean);

export function ProcessPropertiesDialog({ process, organization, catalog, onClose, onSaved }: Props) {
  const initial = useMemo(() => { for (const entity of organization.legalEntities) { const unit = entity.units?.find(item => item.name === process.owner || item.shortName === process.owner); if (unit) return { entityId: entity.id, unitId: unit.id }; } return { entityId: organization.legalEntities[0]?.id ?? '', unitId: '' }; }, [organization, process.owner]);
  const current = process.passport ?? { level: 2, classification: 'Основной' };
  const [entityId, setEntityId] = useState(initial.entityId); const [unitId, setUnitId] = useState(initial.unitId); const [passport, setPassport] = useState<ProcessPassport>(current); const [triggerOptions, setTriggerOptions] = useState(lines(current.triggerOptions)); const [inputs, setInputs] = useState(lines(current.inputs)); const [outputs, setOutputs] = useState(lines(current.outputs)); const [systems, setSystems] = useState(lines(current.systems)); const [documents, setDocuments] = useState(lines(current.documents)); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const entity = organization.legalEntities.find(item => item.id === entityId); const unit = entity?.units?.find(item => item.id === unitId);
  const structuredObjects = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; roles: Set<string>; versions: Set<string>; required: boolean; steps: string[] }>();
    for (const node of process.nodes) for (const binding of node.informationObjects ?? []) {
      const item = grouped.get(binding.objectId) ?? { id: binding.objectId, name: binding.name, roles: new Set<string>(), versions: new Set<string>(), required: false, steps: [] };
      item.roles.add(binding.role); if (binding.version) item.versions.add(binding.version); item.required ||= binding.required;
      if (!item.steps.includes(node.name)) item.steps.push(node.name); grouped.set(binding.objectId, item);
    }
    return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  }, [process.nodes]);
  const change = (field: keyof ProcessPassport, value: ProcessPassport[keyof ProcessPassport]) => setPassport(valueNow => ({ ...valueNow, [field]: value }));
  const save = async () => { if (!entity || !unit) return; setBusy(true); setError(''); try { onSaved(await saveProcessProperties(process.id, { owner: unit.shortName || unit.name, ownerLegalEntityId: entity.id, ownerUnitId: unit.id, passport: { ...passport, parentProcessId: passport.parentProcessId || undefined, relatedProcessIds: passport.relatedProcessIds?.filter(id => id !== process.id), triggerOptions: list(triggerOptions), inputs: list(inputs), outputs: list(outputs), systems: list(systems), documents: list(documents) } })); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить паспорт процесса.'); } finally { setBusy(false); } };

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="process-properties-dialog process-passport-dialog" role="dialog" aria-modal="true" aria-label="Паспорт процесса">
    <header><div><span className="eyebrow">Паспорт процесса</span><h2>{process.name}</h2><p>Классификация, место в иерархии, границы и основные сведения процесса.</p></div><button className="dialog-close" onClick={onClose}><X size={17}/></button></header>
    <div className="passport-scroll"><div className="process-properties-fields passport-grid">
      <label><span>Уровень процесса</span><select value={passport.level} onChange={event => change('level', Number(event.target.value))}>{processLevelOptions(passport.level).map(level => <option key={level} value={level}>Уровень {level}</option>)}</select></label>
      <label><span>Классификация</span><select value={passport.classification} onChange={event => change('classification', event.target.value)}>{['Основной','Управляющий','Обеспечивающий','Обслуживающий'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="passport-wide"><span>Родительский процесс</span><select value={passport.parentProcessId ?? ''} onChange={event => change('parentProcessId', event.target.value)}><option value="">Нет — верхний уровень</option>{catalog.filter(item => item.id !== process.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="passport-wide"><span>Связанные процессы</span><select className="passport-multiple" multiple value={passport.relatedProcessIds ?? []} onChange={event => change('relatedProcessIds', Array.from(event.target.selectedOptions, option => option.value))}>{catalog.filter(item => item.id !== process.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Можно выбрать несколько процессов с Ctrl или Shift. Связи не меняют иерархию.</small></label>
      <label><span><Building2 size={14}/>Юридическое лицо владельца</span><select value={entityId} onChange={event => { setEntityId(event.target.value); setUnitId(''); }}>{organization.legalEntities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span><Network size={14}/>Подразделение-владелец</span><select value={unitId} onChange={event => setUnitId(event.target.value)}><option value="">Выберите подразделение</option>{(entity?.units ?? []).map(item => <option key={item.id} value={item.id}>{item.shortName ? `${item.shortName} — ` : ''}{item.name}</option>)}</select></label>
      <label className="passport-wide"><span>Цель процесса</span><textarea value={passport.purpose ?? ''} onChange={event => change('purpose', event.target.value)} placeholder="Для чего существует процесс?"/></label>
      <label className="passport-wide"><span>Границы процесса</span><textarea value={passport.scope ?? ''} onChange={event => change('scope', event.target.value)} placeholder="Что входит и не входит в процесс?"/></label>
      <label><span>Общее инициирующее событие</span><textarea value={passport.trigger ?? ''} onChange={event => change('trigger', event.target.value)} placeholder="Например: получена потребность в закупке"/></label><label><span>Результат процесса</span><textarea value={passport.result ?? ''} onChange={event => change('result', event.target.value)}/></label>
      <label className="passport-wide"><span>Варианты запуска — один вариант в строке</span><textarea value={triggerOptions} onChange={event => setTriggerOptions(event.target.value)} placeholder={'Письмо на общую почту\nСлужебная записка\nТелефонный звонок'}/><small>Варианты считаются альтернативными: для запуска достаточно одного из них.</small></label>
      <label><span>Входы — по одному в строке</span><textarea value={inputs} onChange={event => setInputs(event.target.value)}/></label><label><span>Выходы — по одному в строке</span><textarea value={outputs} onChange={event => setOutputs(event.target.value)}/></label>
      <label><span>Информационные системы</span><textarea value={systems} onChange={event => setSystems(event.target.value)} placeholder="1С:ERP&#10;1С:PLM"/></label><label><span>Нормативные и рабочие документы</span><textarea value={documents} onChange={event => setDocuments(event.target.value)}/></label>
      <section className="passport-wide passport-information-objects"><div><span className="eyebrow">Структурированные входы и выходы</span><h3>Объекты, привязанные к шагам схемы</h3><p>Этот раздел рассчитывается автоматически. Изменять роль, версию и обязательность объекта нужно в карточке соответствующего шага.</p></div>
        {structuredObjects.length ? <div className="passport-object-list">{structuredObjects.map(item => <article key={item.id}><span className="passport-object-icon">{item.roles.has('Output') ? <FileOutput size={17}/> : item.roles.has('Input') ? <FileInput size={17}/> : <BookOpen size={17}/>}</span><div><strong>{item.name}</strong><small>{item.id} · {[...item.roles].map(role => role === 'Input' ? 'вход' : role === 'Output' ? 'выход' : 'справочный').join(', ')}{item.required ? ' · обязательный' : ''}{item.versions.size ? ` · версии ${[...item.versions].join(', ')}` : ''}</small><p>{item.steps.join(' · ')}</p></div></article>)}</div> : <div className="passport-object-empty">На шагах процесса ещё нет структурированных документов или результатов.</div>}
      </section>
      <SourceRequirementsEditor entries={passport.sourceRequirements ?? []} nodes={process.nodes} onChange={entries => change('sourceRequirements', entries)}/>
    </div></div>
    {error && <div className="organization-error">{error}</div>}<footer><button onClick={onClose}>Отмена</button><button className="primary" disabled={!unit || busy} onClick={save}><Save size={15}/>{busy ? 'Сохраняем…' : 'Сохранить паспорт'}</button></footer>
  </section></div>;
}
