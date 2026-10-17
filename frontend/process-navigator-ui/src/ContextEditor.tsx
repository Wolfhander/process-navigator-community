import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Plus, Save, Trash2, X } from 'lucide-react';
import { loadInformationObjects, loadOrganization, loadProcessCatalog, saveElementContext } from './api';
import { ArtifactUploadDialog } from './ArtifactUploadDialog';
import type { Artifact, ExecutionMode, InformationObject, InformationObjectBinding, OrganizationMap, ParticipantUnitRef, ProcessAction, ProcessChannel, ProcessChannelKind, ProcessNode, ProcessSummary } from './types';
import { actionTargetHint } from './process-actions';
import { bpmnTypeLabels } from './types';
import { StepEvidenceEditor } from './StepEvidence';
import type { StepEvidence, ExecutorKind } from './types';

const toLines = (values?: string[]) => values?.join('\n') ?? '';
const fromLines = (value: string) => [...new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))];

export function ContextEditor({ processId, node, onCancel, onSaved }: {
  processId: string;
  node: ProcessNode;
  onCancel: () => void;
  onSaved: (node: ProcessNode) => void;
}) {
  const [evidence, setEvidence] = useState<StepEvidence[]>(node.evidence ?? []);
  const [description, setDescription] = useState(node.description ?? '');
  const [responsible, setResponsible] = useState(node.responsible ?? '');
  const [duration, setDuration] = useState(node.duration ?? '');
  const [inputs, setInputs] = useState(toLines(node.inputs));
  const [expectedResult, setExpectedResult] = useState(node.expectedResult ?? '');
  const [completionCriteria, setCompletionCriteria] = useState(node.completionCriteria ?? '');
  const [instruction, setInstruction] = useState(node.instruction ?? '');
  const [executionMode, setExecutionMode] = useState<ExecutionMode | ''>(node.executionMode ?? '');
  const [executorKind, setExecutorKind] = useState<ExecutorKind | ''>(node.executorKind ?? '');
  const [systemName, setSystemName] = useState(node.systemName ?? '');
  const [workDuration, setWorkDuration] = useState(node.workDuration ?? '');
  const [waitDuration, setWaitDuration] = useState(node.waitDuration ?? '');
  const [participantUnits, setParticipantUnits] = useState(toLines(node.participantUnits));
  const [participantUnitRefs, setParticipantUnitRefs] = useState<ParticipantUnitRef[]>(node.participantUnitRefs ?? []);
  const [organization, setOrganization] = useState<OrganizationMap>();
  const [organizationError, setOrganizationError] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [linkedProcessId, setLinkedProcessId] = useState(node.linkedProcessId ?? '');
  const [catalog, setCatalog] = useState<ProcessSummary[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>(node.artifacts ?? []);
  const [actions, setActions] = useState<ProcessAction[]>(node.actions ?? []);
  const [channels, setChannels] = useState<ProcessChannel[]>(node.channels ?? []);
  const [informationObjects, setInformationObjects] = useState<InformationObjectBinding[]>(node.informationObjects ?? []);
  const [registryObjects, setRegistryObjects] = useState<InformationObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [selectedObjectRole, setSelectedObjectRole] = useState<InformationObjectBinding['role']>('Input');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [artifactNotice, setArtifactNotice] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => { loadProcessCatalog().then(setCatalog).catch(() => setCatalog([])); }, []);
  useEffect(() => { loadOrganization().then(setOrganization).catch(() => setOrganizationError(true)); }, []);
  useEffect(() => { loadInformationObjects().then(result => setRegistryObjects(result.objects)).catch(() => setRegistryObjects([])); }, []);
  const selectedEntity = organization?.legalEntities.find(item => item.id === selectedEntityId);
  const participantLabel = (reference: ParticipantUnitRef) => {
    const entity = organization?.legalEntities.find(item => item.id === reference.legalEntityId);
    const unit = entity?.units?.find(item => item.id === reference.unitId);
    return unit ? `${unit.shortName || unit.name} — ${entity?.name}` : `Не найдено: ${reference.legalEntityId} / ${reference.unitId}`;
  };

  const patchArtifact = (index: number, patch: Partial<Artifact>) =>
    setArtifacts(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const patchAction = (index: number, patch: Partial<ProcessAction>) =>
    setActions(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const patchChannel = (index: number, patch: Partial<ProcessChannel>) =>
    setChannels(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const patchInformationObject = (index: number, patch: Partial<InformationObjectBinding>) =>
    setInformationObjects(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const addInformationObject = () => {
    const item = registryObjects.find(value => value.id === selectedObjectId);
    if (!item || informationObjects.some(value => value.objectId === item.id && value.role === selectedObjectRole)) return;
    setInformationObjects(values => [...values, { objectId: item.id, name: item.name, role: selectedObjectRole, required: true, version: item.version }]);
    setSelectedObjectId('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (event.target !== event.currentTarget) return;
    setBusy(true); setError(''); setArtifactNotice('');
    try {
      onSaved(await saveElementContext(processId, node.id, { evidence, executorKind: executorKind || undefined, description, responsible, duration, artifacts, actions, channels, informationObjects, inputs: fromLines(inputs), expectedResult, completionCriteria, instruction, executionMode: executionMode || undefined, systemName, workDuration, waitDuration, participantUnits: fromLines(participantUnits), participantUnitRefs, linkedProcessId: linkedProcessId || undefined }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить контекст элемента.');
    } finally { setBusy(false); }
  };

  return <form className="context-editor" onSubmit={submit}>
    <div className="context-editor__heading"><div><span className="eyebrow">Контекст черновика</span><h2>{node.name}</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Отменить редактирование"><X size={18}/></button></div>
    <label>Описание<textarea value={description} maxLength={4000} rows={4} onChange={event => setDescription(event.target.value)} placeholder="Что должен сделать сотрудник и какой результат ожидается"/></label>
    <div className="context-form-grid"><label>Ответственная роль или должность<input value={responsible} maxLength={200} onChange={event => setResponsible(event.target.value)} placeholder="Не дублирует подразделение дорожки"/></label><label>Общий норматив<input value={duration} maxLength={100} onChange={event => setDuration(event.target.value)} placeholder="Например, 2 рабочих дня"/></label></div>

    <StepEvidenceEditor entries={evidence} onChange={setEvidence}/>
    {node.type === 'task' && <>
      <section className="context-collection context-business-description"><div className="collection-heading"><div><h3>Границы действия</h3><small>Что поступает на вход и когда действие действительно закончено</small></div></div>
        <label>Входы<textarea value={inputs} maxLength={6000} rows={3} onChange={event => setInputs(event.target.value)} placeholder={'Один вход в строке\nНапример: согласованная заявка'}/><small>Не более 20 значений. Повторы при сохранении будут удалены.</small></label>
        <label>Ожидаемый результат<textarea value={expectedResult} maxLength={2000} rows={3} onChange={event => setExpectedResult(event.target.value)} placeholder="Что создаётся или изменяется после выполнения"/></label>
        <div className="collection-heading"><div><h3>Объекты реестра</h3><small>Структурированные входы и выходы сохраняют связь даже после переименования документа.</small></div></div>
        <div className="context-form-grid"><label>Документ или результат<select value={selectedObjectId} onChange={event => setSelectedObjectId(event.target.value)}><option value="">Выберите объект реестра</option>{registryObjects.map(item => <option key={item.id} value={item.id}>{item.name} · {item.kind === 'Document' ? 'документ' : 'результат'}</option>)}</select></label><label>Роль<select value={selectedObjectRole} onChange={event => setSelectedObjectRole(event.target.value as InformationObjectBinding['role'])}><option value="Input">Вход</option><option value="Output">Выход</option><option value="Reference">Справочный объект</option></select></label></div>
        <button type="button" disabled={!selectedObjectId || informationObjects.length >= 40 || informationObjects.some(item => item.objectId === selectedObjectId && item.role === selectedObjectRole)} onClick={addInformationObject}><Plus size={15}/>Привязать объект</button>
        {informationObjects.map((binding, index) => <div className="collection-card information-binding-card" key={`${binding.objectId}:${binding.role}`}><button type="button" className="remove-row" onClick={() => setInformationObjects(items => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Удалить ${binding.name}`}><Trash2 size={15}/></button><strong>{binding.name}</strong><small>{binding.role === 'Input' ? 'Вход' : binding.role === 'Output' ? 'Выход' : 'Справочный объект'} · ID {binding.objectId}</small><div className="context-form-grid"><label>Версия<input value={binding.version ?? ''} maxLength={50} onChange={event => patchInformationObject(index, { version: event.target.value })} placeholder="Например, 2.1"/></label><label className="context-checkbox"><input type="checkbox" checked={binding.required} onChange={event => patchInformationObject(index, { required: event.target.checked })}/><span>Обязателен</span></label></div><label>Условие применения<input value={binding.condition ?? ''} maxLength={500} onChange={event => patchInformationObject(index, { condition: event.target.value })} placeholder="Например, только для закупки импортных комплектующих"/></label></div>)}
        {!informationObjects.length && <p className="empty-collection">Структурированные объекты ещё не привязаны. Текстовые входы и результат выше продолжают учитываться.</p>}
        <label>Критерий завершения<textarea value={completionCriteria} maxLength={2000} rows={3} onChange={event => setCompletionCriteria(event.target.value)} placeholder="Проверяемое условие, после которого можно перейти дальше"/></label>
      </section>
      <section className="context-collection context-business-description"><div className="collection-heading"><div><h3>Выполнение</h3><small>Как, где и за какое время выполняется действие</small></div></div>
        <p>Тип действия: {bpmnTypeLabels[node.bpmnType ?? 'task'] ?? node.bpmnType}. Изменяется в редакторе схемы через выбор типа блока.</p>
        <label>Кто выполняет действие<select value={executorKind} onChange={event => setExecutorKind(event.target.value as ExecutorKind | '')}><option value="">По типу BPMN, если определён</option><option value="human">Сотрудник</option><option value="system">Информационная система</option></select></label>
        <p>Подразделение дорожки отвечает за действие. Название системы задаётся ниже; участие ERP в передаче документа само по себе не делает действие автоматическим.</p>
        <label>Инструкция исполнителю<textarea value={instruction} maxLength={6000} rows={5} onChange={event => setInstruction(event.target.value)} placeholder="Последовательность работы, правила и важные исключения"/></label>
        <div className="context-form-grid"><label>Способ выполнения<select value={executionMode} onChange={event => setExecutionMode(event.target.value as ExecutionMode | '')}><option value="">Не указан</option><option value="manual">Вручную</option><option value="external">Вне информационной системы</option><option value="system">В информационной системе</option></select></label><label>Информационная система<input value={systemName} maxLength={200} onChange={event => setSystemName(event.target.value)} placeholder="При наличии, например 1С:ERP"/></label></div>
        <div className="context-form-grid"><label>Время работы<input value={workDuration} maxLength={100} onChange={event => setWorkDuration(event.target.value)} placeholder="Например, 30 минут"/></label><label>Время ожидания<input value={waitDuration} maxLength={100} onChange={event => setWaitDuration(event.target.value)} placeholder="Например, до 1 дня"/></label></div>
        <div className="collection-heading"><div><h3>Участвующие подразделения</h3><small>Ответственное подразделение задаётся дорожкой; здесь указываются дополнительные участники.</small></div></div>
        <div className="context-form-grid"><label>Юридическое лицо<select value={selectedEntityId} onChange={event => { setSelectedEntityId(event.target.value); setSelectedUnitId(''); }}><option value="">Выберите юридическое лицо</option>{organization?.legalEntities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label><label>Подразделение<select value={selectedUnitId} onChange={event => setSelectedUnitId(event.target.value)} disabled={!selectedEntity}><option value="">Выберите подразделение</option>{selectedEntity?.units?.map(unit => <option key={unit.id} value={unit.id}>{unit.shortName ? `${unit.shortName} — ` : ''}{unit.name}</option>)}</select></label></div>
        <button type="button" disabled={!selectedEntityId || !selectedUnitId || participantUnitRefs.length >= 20 || participantUnitRefs.some(item => item.legalEntityId === selectedEntityId && item.unitId === selectedUnitId)} onClick={() => { setParticipantUnitRefs(items => [...items, { legalEntityId: selectedEntityId, unitId: selectedUnitId }]); setSelectedUnitId(''); }}><Plus size={15}/>Добавить подразделение</button>
        {organizationError && <p className="context-save-error">Не удалось загрузить оргструктуру. Существующие привязки сохранены.</p>}
        {participantUnitRefs.map(reference => <div className="collection-card" key={`${reference.legalEntityId}:${reference.unitId}`}><span>{participantLabel(reference)}</span><button type="button" className="remove-row" onClick={() => setParticipantUnitRefs(items => items.filter(item => item !== reference))} aria-label={`Удалить ${participantLabel(reference)}`}><Trash2 size={15}/></button></div>)}
        {!!node.participantUnits?.length && <label>Прежние текстовые записи<textarea value={participantUnits} maxLength={6000} rows={3} onChange={event => setParticipantUnits(event.target.value)}/><small>Эти записи не привязаны к оргструктуре. После выбора подразделений выше их можно удалить.</small></label>}
      </section>
      <section className="context-collection context-business-description"><div className="collection-heading"><div><h3>Системы и каналы передачи</h3><small>У одного этапа может быть несколько альтернативных или параллельных способов выполнения и передачи результата.</small></div><button type="button" onClick={() => setChannels(items => [...items, { id: `channel-${crypto.randomUUID().slice(0, 8)}`, kind: 'system', label: '', flow: items.length ? 'parallel' : 'primary', direction: 'work' }])}><Plus size={15}/>Добавить</button></div>
        {channels.map((channel, index) => <div className="collection-card channel-card" key={channel.id}><button type="button" className="remove-row" onClick={() => setChannels(items => items.filter((_, itemIndex) => itemIndex !== index))} aria-label="Удалить канал"><Trash2 size={15}/></button>
          <label>Название<input required value={channel.label} maxLength={200} onChange={event => patchChannel(index, { label: event.target.value })} placeholder="Например, регистрация заявки в PLM"/></label>
          <div className="context-form-grid"><label>Среда<select value={channel.kind} onChange={event => patchChannel(index, { kind: event.target.value as ProcessChannelKind })}><option value="system">Информационная система</option><option value="email">Электронная почта</option><option value="paper">Бумажный документ</option><option value="phone">Телефонный звонок</option><option value="memo">Служебная записка</option><option value="meeting">Личное обращение / совещание</option><option value="other">Другое</option></select></label><label>Роль канала<select value={channel.flow} onChange={event => patchChannel(index, { flow: event.target.value as ProcessChannel['flow'] })}><option value="primary">Основной</option><option value="alternative">Альтернативный</option><option value="parallel">Параллельный</option></select></label></div>
          <div className="context-form-grid"><label>Место в этапе<select value={channel.direction} onChange={event => patchChannel(index, { direction: event.target.value as ProcessChannel['direction'] })}><option value="input">Поступление / вход</option><option value="work">Выполнение</option><option value="output">Передача / выход</option></select></label>{channel.kind === 'system' && <label>Информационная система<input required value={channel.systemName ?? ''} maxLength={200} onChange={event => patchChannel(index, { systemName: event.target.value })} placeholder="1С:ERP, 1С:PLM…"/></label>}</div>
          <label>Документ или результат<input value={channel.documentName ?? ''} maxLength={300} onChange={event => patchChannel(index, { documentName: event.target.value })} placeholder="Например, заявка на закупку / бумажная копия"/></label>
        </div>)}
        {!channels.length && <p className="empty-collection">Каналы пока не указаны. Старое поле «Способ выполнения» остаётся совместимым с ранее внесёнными данными.</p>}
      </section>
      <section className="context-collection context-business-description"><div className="collection-heading"><div><h3>Детализация процесса</h3><small>Откройте из этой задачи отдельную схему нижнего уровня</small></div></div>
        <label>Связанный процесс<select value={linkedProcessId} onChange={event => setLinkedProcessId(event.target.value)}><option value="">Не связан</option>{catalog.filter(item => item.id !== processId).sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(item => <option key={item.id} value={item.id}>{item.name} · {item.status === 'Draft' ? 'черновик' : `версия ${item.version}`}</option>)}</select><small>Самоссылки и циклическая вложенность блокируются при сохранении.</small></label>
      </section>
    </>}

    <section className="context-collection"><div className="collection-heading"><h3>Материалы и шаблоны</h3><div><button type="button" onClick={() => setArtifacts(items => [...items, { name: '', kind: 'Инструкция', version: '1.0', reference: '' }])}><Plus size={15}/>Ссылка</button><button type="button" onClick={() => setUploadOpen(true)}><FileUp size={15}/>Файл</button></div></div>
      {artifacts.map((artifact, index) => <div className="collection-card" key={`artifact-${index}`}><button type="button" className="remove-row" onClick={() => setArtifacts(items => items.filter((_, itemIndex) => itemIndex !== index))} aria-label="Удалить материал"><Trash2 size={15}/></button><label>Название<input required value={artifact.name} maxLength={200} onChange={event => patchArtifact(index, { name: event.target.value })}/></label><div className="context-form-grid"><label>Тип<input required value={artifact.kind} maxLength={80} onChange={event => patchArtifact(index, { kind: event.target.value })}/></label><label>Версия<input required value={artifact.version} maxLength={40} onChange={event => patchArtifact(index, { version: event.target.value })}/></label></div><label>Файл, ссылка или идентификатор<input value={artifact.reference ?? ''} maxLength={500} onChange={event => patchArtifact(index, { reference: event.target.value })} placeholder="Например, ХранилищеЗначения:..."/></label></div>)}
      {!artifacts.length && <p className="empty-collection">К элементу пока не прикреплены материалы.</p>}
      {artifactNotice && <div className="context-save-notice"><CheckCircle2 size={17}/><span>{artifactNotice}</span></div>}
    </section>

    <section className="context-collection"><div className="collection-heading"><div><h3>Рабочие действия</h3><small>Ручные операции, ссылки, файлы, отчёты и команды систем</small></div><button type="button" onClick={() => setActions(items => [...items, { id: `action-${crypto.randomUUID().slice(0, 8)}`, label: '', kind: 'manual', target: '' }])}><Plus size={15}/>Добавить</button></div>
      {actions.map((action, index) => <div className="collection-card" key={action.id}><button type="button" className="remove-row" onClick={() => setActions(items => items.filter((_, itemIndex) => itemIndex !== index))} aria-label="Удалить действие"><Trash2 size={15}/></button><label>Название действия<input required value={action.label} maxLength={200} onChange={event => patchAction(index, { label: event.target.value })}/></label><div className="context-form-grid"><label>Тип<select value={action.kind} onChange={event => patchAction(index, { kind: event.target.value, ...(event.target.value === 'manual' ? { target: '' } : {}) })}><option value="manual">Ручное действие</option><option value="url">Ссылка или внутренняя форма</option><option value="file">Файл репозитория</option><option value="report">Отчёт</option><option value="erp">Команда ERP</option></select></label><label>Идентификатор<input required value={action.id} maxLength={100} onChange={event => patchAction(index, { id: event.target.value })}/></label></div><label>Цель действия<input value={action.target ?? ''} maxLength={500} disabled={action.kind === 'manual'} onChange={event => patchAction(index, { target: event.target.value })} placeholder={actionTargetHint(action.kind)}/><small>{actionTargetHint(action.kind)}</small></label></div>)}
      {!actions.length && <p className="empty-collection">Для элемента пока не настроены действия.</p>}
    </section>

    {error && <div className="context-save-error"><AlertTriangle size={17}/>{error}</div>}
    <div className="context-editor__actions"><button type="button" onClick={onCancel}>Отмена</button><button className="is-primary" disabled={busy}><Save size={16}/>{busy ? 'Сохраняем…' : 'Сохранить контекст'}</button></div>
    {uploadOpen && (
      <ArtifactUploadDialog
      onClose={() => setUploadOpen(false)}
      onUploaded={artifact => {
        setArtifacts(items => [...items, artifact]);
        setArtifactNotice('Файл загружен в репозиторий и добавлен в список. Нажмите «Сохранить контекст».');
        setUploadOpen(false);
      }}/>
    )}
  </form>;
}
