import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, BookOpen, Box, CheckCircle2, ClipboardCheck, Clock3, ExternalLink, FileText, GitBranch, Link2, MonitorCog, PanelRight, Pencil, Play, RotateCcw, UserRound, X } from 'lucide-react';
import { resolveCapabilities } from './capabilities';
import { artifactDownloadUrl, assignInstanceStep, executeProcessAction, loadCommandHistory, loadInformationObjects, loadOrganization, loadProcessCatalog } from './api';
import { StepEvidenceList } from './StepEvidence';
import { ContextEditor } from './ContextEditor';
import { ElementComments } from './ElementComments';
import { informationOccurrenceKey, informationRelationLabel, missingInformationRelationLabel, relatedInformationOccurrences } from './information-object-workflow';
import { actionLaunchTarget, normalizedActionKind } from './process-actions';
import { StepResultPanel } from './StepResultPanel';
import { StepTimingPanel } from './StepTimingPanel';
import { ExecutionTimelinePanel } from './ExecutionTimelinePanel';
import { bpmnTypeLabels } from './types';
import type { ReturnStepOption, StepReadiness } from './process-execution-flow';
import type { CommandExecution, InformationObjectOccurrence, InformationObjectRegistry, OrganizationMap, ParticipantUnitRef, ProcessAction, ProcessInstance, ProcessNode, UserProfile } from './types';

type ContextPanelProps = {
  processId: string;
  node?: ProcessNode;
  onClose: () => void;
  onAction: (label: string) => void;
  onUpdated: (node: ProcessNode) => void;
  canExecute: boolean;
  canEdit: boolean;
  assignableUsers?: UserProfile[];
  activeInstance?: ProcessInstance;
  onStepStatus?: (status: 'InProgress' | 'Completed') => void;
  stepReadiness?: StepReadiness;
  nextSteps?: ProcessNode[];
  onOpenStep?: (node: ProcessNode) => void;
  returnOptions?: ReturnStepOption[];
  onReturnStep?: (targetElementId: string, reason: string) => Promise<void>;
  onInstanceUpdated?: (instance: ProcessInstance) => void;
  onOpenOccurrence: (occurrence: InformationObjectOccurrence) => void;
};

export function ContextPanel({ processId, node, onClose, onAction, onUpdated, canExecute: permittedToExecute, canEdit, assignableUsers = [], activeInstance, onStepStatus, stepReadiness, nextSteps = [], onOpenStep, returnOptions = [], onReturnStep, onInstanceUpdated, onOpenOccurrence }: ContextPanelProps) {
  const canExecute = permittedToExecute && (!activeInstance || activeInstance.status === 'Active');
  const [editingId, setEditingId] = useState<string>();
  const [busyAction, setBusyAction] = useState<string>();
  const [lastCommand, setLastCommand] = useState<CommandExecution>();
  const [commandHistory, setCommandHistory] = useState<CommandExecution[]>([]);
  const [linkedProcessName, setLinkedProcessName] = useState<string>();
  const [organization, setOrganization] = useState<OrganizationMap>();
  const [informationRegistry, setInformationRegistry] = useState<InformationObjectRegistry | null>();
  const [manualActionId, setManualActionId] = useState<string>();
  const [manualResult, setManualResult] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnTargetId, setReturnTargetId] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnBusy, setReturnBusy] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentUserId, setAssignmentUserId] = useState('');
  const [assignmentReason, setAssignmentReason] = useState('');
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  useEffect(() => { loadOrganization().then(setOrganization).catch(() => undefined); }, []);
  useEffect(() => {
    setLastCommand(undefined); setCommandHistory([]); setLinkedProcessName(undefined); setManualActionId(undefined); setManualResult(''); setReturnOpen(false); setReturnTargetId(''); setReturnReason(''); setAssignmentOpen(false); setAssignmentUserId(''); setAssignmentReason('');
    if (node) loadCommandHistory(processId, node.id).then(setCommandHistory).catch(() => undefined);
    if (node?.linkedProcessId) loadProcessCatalog().then(items => setLinkedProcessName(items.find(item => item.id === node.linkedProcessId)?.name)).catch(() => undefined);
  }, [processId, node?.id, node?.linkedProcessId]);
  useEffect(() => {
    if (!node?.informationObjects?.length) { setInformationRegistry(undefined); return; }
    setInformationRegistry(undefined);
    loadInformationObjects().then(setInformationRegistry).catch(() => setInformationRegistry(null));
  }, [processId, node?.id]);
  if (!node) return <aside className="context context--empty" title="Выберите элемент BPMN, чтобы открыть его контекст"><PanelRight size={18}/><span>Контекст</span></aside>;
  if (editingId === node.id) return <aside className="context context--editing"><ContextEditor processId={processId} node={node} onCancel={() => setEditingId(undefined)} onSaved={updated => { setEditingId(undefined); onUpdated(updated); }}/></aside>;
  const laneBinding = organization?.crossCompanyProcesses.find(item => item.processId === processId)?.laneOrganizations.find(item => item.laneId === node.laneId);
  const responsibleEntity = organization?.legalEntities.find(item => item.id === laneBinding?.legalEntityId);
  const responsibleUnit = responsibleEntity?.units?.find(item => item.id === laneBinding?.unitId);
  const responsibleDepartment = responsibleUnit ? `${responsibleUnit.name} · ${responsibleEntity?.name}` : laneBinding?.department;

  const capabilities = resolveCapabilities(node);
  const actions = capabilities.filter(capability => capability.kind === 'action');
  const artifacts = capabilities.filter(capability => capability.kind === 'artifact');
  const step = activeInstance?.steps.find(item => item.elementId === node.id);
  const assignedUser = assignableUsers.find(user => user.id === step?.assignedUserId);
  const assignmentCandidates = assignableUsers.filter(user => user.id !== step?.assignedUserId);
  const assignStep = async () => {
    if (!activeInstance || !assignmentUserId) return;
    setAssignmentBusy(true);
    try {
      const updated = await assignInstanceStep(processId, activeInstance.id, node.id, assignmentUserId, assignmentReason);
      onInstanceUpdated?.(updated); setAssignmentOpen(false); setAssignmentReason(''); onAction('Исполнитель шага изменён');
    } catch (reason) { onAction(reason instanceof Error ? reason.message : 'Не удалось передать шаг'); }
    finally { setAssignmentBusy(false); }
  };
  const executionLabels = { manual: 'Вручную', external: 'Вне информационной системы', system: 'В информационной системе' } as const;
  const channelKinds = { system: 'Информационная система', email: 'Электронная почта', paper: 'Бумажный документ', phone: 'Телефонный звонок', memo: 'Служебная записка', meeting: 'Личное обращение / совещание', other: 'Другой канал' } as const;
  const channelFlows = { primary: 'основной', alternative: 'альтернативный', parallel: 'параллельный' } as const;
  const channelDirections = { input: 'вход', work: 'выполнение', output: 'выход' } as const;
  const participantLabel = (reference: ParticipantUnitRef) => {
    const entity = organization?.legalEntities.find(item => item.id === reference.legalEntityId);
    const unit = entity?.units?.find(item => item.id === reference.unitId);
    return unit ? `${unit.name} · ${entity?.name}` : `${reference.legalEntityId} / ${reference.unitId} (нет в оргструктуре)`;
  };
  const registryObject = (objectId: string) => informationRegistry?.objects.find(item => item.id === objectId);
  const objectIssues = (objectId: string) => informationRegistry?.issues.filter(item => item.objectId === objectId) ?? [];
  const occurrenceButton = (occurrence: InformationObjectOccurrence) => <button key={informationOccurrenceKey(occurrence)} onClick={() => onOpenOccurrence(occurrence)}><span><strong>{occurrence.elementName ?? occurrence.processName}</strong>{occurrence.elementName && <small>{occurrence.processName}</small>}</span><ArrowRight size={13}/></button>;
  const openArtifact = (reference: string | undefined, version: string | undefined, label: string) => {
    const url = reference ? artifactDownloadUrl(reference, version) : undefined;
    if (url) window.open(url, '_blank', 'noopener'); else onAction(`Открыть материал: ${label}`);
  };
  const runAction = async (action: ProcessAction, resultText?: string) => {
    const launchTarget = actionLaunchTarget(action, reference => artifactDownloadUrl(reference));
    const pendingWindow = launchTarget ? window.open('', '_blank') : null;
    if (pendingWindow) pendingWindow.opener = null;
    setBusyAction(action.id);
    try {
      const result = await executeProcessAction(processId, node.id, action.id, activeInstance?.id, resultText);
      if (launchTarget) {
        if (pendingWindow) pendingWindow.location.href = launchTarget;
        else window.open(launchTarget, '_blank', 'noopener');
      }
      setManualActionId(undefined); setManualResult('');
      setLastCommand(result); setCommandHistory(await loadCommandHistory(processId, node.id)); onAction(result.message);
    } catch (reason) { pendingWindow?.close(); onAction(reason instanceof Error ? reason.message : 'Не удалось выполнить действие'); }
    finally { setBusyAction(undefined); }
  };
  const actionIcon = (action: ProcessAction) => {
    const kind = normalizedActionKind(action.kind);
    return kind === 'manual' ? <ClipboardCheck size={18}/> : kind === 'url' ? <Link2 size={18}/> : kind === 'file' ? <FileText size={18}/> : <Box size={18}/>;
  };

  return <aside className="context">
    <div className="context-title-actions">{canEdit && <button className="icon-button" onClick={() => setEditingId(node.id)} aria-label="Редактировать контекст"><Pencil size={17}/></button>}<button className="icon-button" onClick={onClose} aria-label="Закрыть контекст"><X size={18}/></button></div>
    <span className="eyebrow">{node.type === 'task' ? 'Задача процесса' : 'Элемент BPMN'}</span><h2>{node.name}</h2><p className="description">{node.description || 'Описание пока не заполнено.'}</p>
    <div className="facts"><div><UserRound size={17}/><span>Ответственное подразделение</span><strong>{responsibleDepartment ?? 'Не привязано'}</strong></div>{node.type === 'task' && <div><MonitorCog size={17}/><span>Тип действия</span><strong>{bpmnTypeLabels[node.bpmnType ?? 'task'] ?? node.bpmnType}</strong></div>}{node.duration && <div><Clock3 size={17}/><span>Общий норматив</span><strong>{node.duration}</strong></div>}{node.executionMode && <div><MonitorCog size={17}/><span>Способ выполнения</span><strong>{executionLabels[node.executionMode]}{node.systemName ? ` · ${node.systemName}` : ''}</strong></div>}</div>
    {node.type === 'task' && <section className="business-context"><h3>Границы действия</h3><div><span>Входы</span>{node.inputs?.length ? <ul>{node.inputs.map(input => <li key={input}>{input}</li>)}</ul> : <p>Не указаны</p>}</div><div><span>Ожидаемый результат</span><p>{node.expectedResult || 'Не указан'}</p></div>{!!node.informationObjects?.length && <div><span>Рабочая цепочка документов и результатов</span><ul className="bound-object-list">{node.informationObjects.map(binding => { const item = registryObject(binding.objectId); const issues = objectIssues(binding.objectId); const occurrences = item ? relatedInformationOccurrences(item, binding.role, processId, node.id) : []; return <li key={`${binding.objectId}:${binding.role}`} className={issues.some(issue => issue.severity === 'Error') ? 'has-error' : issues.length ? 'has-warning' : ''}><strong>{item?.name ?? binding.name}</strong><small>{binding.role === 'Input' ? 'вход' : binding.role === 'Output' ? 'выход' : 'справочный'} · {binding.required ? 'обязательный' : 'необязательный'}{binding.version ? ` · версия ${binding.version}` : ''}{binding.condition ? ` · ${binding.condition}` : ''}</small>{issues.map(issue => <em key={issue.code}><AlertTriangle size={11}/>{issue.message}</em>)}{item ? <div className="bound-object-relations"><b>{informationRelationLabel(binding.role)}</b>{occurrences.length ? occurrences.map(occurrenceButton) : <p>{missingInformationRelationLabel(binding.role)}</p>}</div> : <div className="bound-object-relations is-loading"><p>{informationRegistry === null ? 'Не удалось загрузить связи реестра' : 'Проверяем связь с другими шагами…'}</p></div>}</li>; })}</ul></div>}<div><span>Критерий завершения</span><p>{node.completionCriteria || 'Не указан'}</p></div>{node.instruction && <details><summary>Инструкция исполнителю</summary><p>{node.instruction}</p></details>}{(node.workDuration || node.waitDuration) && <div className="business-time"><span>Состав времени</span><p>{node.workDuration ? `Работа: ${node.workDuration}` : 'Время работы не указано'} · {node.waitDuration ? `ожидание: ${node.waitDuration}` : 'время ожидания не указано'}</p></div>}{(!!node.participantUnitRefs?.length || !!node.participantUnits?.length) && <div><span>Участвующие подразделения</span><ul>{node.participantUnitRefs?.map(reference => <li key={`${reference.legalEntityId}:${reference.unitId}`}>{participantLabel(reference)}</li>)}{node.participantUnits?.map(unit => <li key={`legacy:${unit}`}>{unit} · текстовая запись</li>)}</ul></div>}</section>}
    {node.type === 'task' && <section className="process-channels"><h3>Кто выполняет действие</h3><p>{node.executorKind === 'system' ? `Информационная система${node.systemName ? ` · ${node.systemName}` : ' · название не указано'}` : node.executorKind === 'human' ? `Сотрудник${node.systemName ? ` · работает с ${node.systemName}` : ''}` : 'Исполнитель не уточнён'}</p>{node.executorKind === 'system' && <p className="permission-note">Факт работы внешней системы подтверждает сотрудник. Отметка в Process Navigator не запускает обработку в ERP и не означает, что система автоматически подтвердила результат.</p>}</section>}
    {!!node.channels?.length && <section className="process-channels"><h3>Системы и каналы</h3>{node.channels.map(channel => <article key={channel.id} className={`channel-item is-${channel.kind}`}><MonitorCog size={17}/><span><strong>{channel.label}</strong><small>{channelKinds[channel.kind]}{channel.systemName ? ` · ${channel.systemName}` : ''}</small>{channel.documentName && <em>{channel.documentName}</em>}</span><b>{channelDirections[channel.direction]} · {channelFlows[channel.flow]}</b></article>)}</section>}
    {node.linkedProcessId && <section className="linked-process"><h3>Детализация</h3><button onClick={() => window.dispatchEvent(new CustomEvent('pn:open-linked-process', { detail: node.linkedProcessId }))}><GitBranch size={18}/><span><strong>{linkedProcessName ?? 'Открыть связанный процесс'}</strong><small>{linkedProcessName ? 'Перейти к схеме нижнего уровня' : node.linkedProcessId}</small></span><ExternalLink size={15}/></button></section>}
    <StepEvidenceList entries={node.evidence}/>
    <section className="assigned-people"><h3>{node.executorKind === 'system' ? 'Сотрудник, подтверждающий результат' : 'Исполнитель шага'}</h3>{assignedUser ? <div><span className="assigned-avatar"><UserRound size={14}/></span><span><strong>{assignedUser.displayName}</strong><small>{assignedUser.position || 'Допущен к дорожке'}</small></span></div> : <p className="permission-note">Конкретный сотрудник пока не выбран.</p>}{assignableUsers.length > 0 ? <><small className="assignment-candidates">Допустимые сотрудники дорожки: {assignableUsers.map(user => user.displayName).join(', ')}</small>{canExecute && step && step.status !== 'Completed' && step.status !== 'Skipped' && assignmentCandidates.length > 0 && <button className="step-assignment-toggle" onClick={() => { setAssignmentOpen(value => !value); if (!assignmentUserId || assignmentUserId === step.assignedUserId) setAssignmentUserId(assignmentCandidates[0]?.id ?? ''); }}><UserRound size={15}/>{assignedUser ? 'Передать другому' : 'Назначить сотрудника'}</button>}{assignmentOpen && <div className="step-assignment-form"><label>Новый исполнитель<select value={assignmentUserId} onChange={event => setAssignmentUserId(event.target.value)}>{assignmentCandidates.map(user => <option key={user.id} value={user.id}>{user.displayName}{user.position ? ` · ${user.position}` : ''}</option>)}</select></label><label>Основание передачи<textarea value={assignmentReason} maxLength={500} onChange={event => setAssignmentReason(event.target.value)} placeholder="Например: замещение на период отсутствия"/></label><div><button onClick={() => { setAssignmentOpen(false); setAssignmentReason(''); }}>Отмена</button><button className="is-primary" disabled={assignmentBusy || assignmentReason.trim().length < 3 || !assignmentUserId} onClick={assignStep}>{assignmentBusy ? 'Передаём…' : 'Подтвердить'}</button></div></div>}</> : <p className="permission-note">На ответственную дорожку пока никто не назначен.</p>}</section>
    {activeInstance && activeInstance.status !== 'Active' && <section className={`instance-state-note is-${activeInstance.status.toLowerCase()}`}><AlertTriangle size={16}/><span><strong>{activeInstance.status === 'Paused' ? 'Выполнение приостановлено' : activeInstance.status === 'Cancelled' ? 'Выполнение отменено' : 'Выполнение завершено'}</strong><small>{activeInstance.status === 'Paused' ? 'Возобновите экземпляр в списке выполнений, чтобы продолжить.' : 'Новые действия недоступны; ранее сохранённая история остаётся доступной.'}</small></span></section>}
    {activeInstance && step && <StepTimingPanel instance={activeInstance} step={step}/>}
    {activeInstance && <StepResultPanel processId={processId} instance={activeInstance} node={node} canExecute={canExecute} onUpdated={updated => onInstanceUpdated?.(updated)} onMessage={onAction}/>}
    {step && <section className="step-execution"><h3>Текущее выполнение</h3><div className={`step-status is-${step.status.toLowerCase()}`}><Clock3 size={16}/><span><strong>{step.status === 'NotStarted' ? (stepReadiness?.available ? 'Можно начинать' : 'Ожидает предыдущий этап') : step.status === 'InProgress' ? 'В работе' : step.status === 'Skipped' ? 'Не входит в выбранную ветвь' : 'Завершено'}</strong><small>{step.status === 'Skipped' ? (step.skipReason ?? 'Выбрана другая ветвь маршрута') : step.startedAt ? `Начато ${new Date(step.startedAt).toLocaleString('ru-RU')}` : activeInstance?.name}</small></span></div>{step.status === 'NotStarted' && stepReadiness && !stepReadiness.available && <div className="step-blockers"><AlertTriangle size={15}/><span>Сначала завершите:{stepReadiness.blockerNames.length ? <strong>{stepReadiness.blockerNames.join(' · ')}</strong> : <strong>предыдущую часть маршрута</strong>}</span></div>}{canExecute && step.status === 'NotStarted' && <button disabled={stepReadiness ? !stepReadiness.available : false} title={stepReadiness && !stepReadiness.available ? 'Шаг станет доступен после завершения предыдущего этапа' : undefined} onClick={() => onStepStatus?.('InProgress')}><Play size={16}/>Начать шаг</button>}{canExecute && step.status === 'InProgress' && <button onClick={() => onStepStatus?.('Completed')}><CheckCircle2 size={16}/>Завершить шаг</button>}{step.status === 'Completed' && nextSteps.length > 0 && <div className="next-step-list"><span>Доступно дальше</span>{nextSteps.slice(0, 4).map(item => <button key={item.id} onClick={() => onOpenStep?.(item)}><ArrowRight size={14}/>{item.name}</button>)}</div>}{!!activeInstance?.branchDecisions?.length && <details className="branch-decision-log"><summary><GitBranch size={14}/>Выбранные ветви ({activeInstance.branchDecisions.length})</summary>{activeInstance.branchDecisions.map(decision => <div key={decision.gatewayId}><strong>{decision.gatewayName}</strong><span>{decision.selectedLabel ?? decision.selectedTargetName}</span><small>{new Date(decision.selectedAt).toLocaleString('ru-RU')}</small></div>)}</details>}</section>}
    {step && canExecute && returnOptions.length > 0 && (step.status === 'InProgress' || step.status === 'Completed') && <section className="step-return"><button className="step-return-toggle" onClick={() => { setReturnOpen(value => !value); if (!returnTargetId) setReturnTargetId(returnOptions[0]?.elementId ?? ''); }}><RotateCcw size={15}/>Вернуть на доработку</button>{returnOpen && <div className="step-return-form"><label>Повторить с этапа<select value={returnTargetId} onChange={event => setReturnTargetId(event.target.value)}>{returnOptions.map(option => <option key={option.elementId} value={option.elementId}>{option.name}</option>)}</select></label><label>Причина возврата<textarea value={returnReason} maxLength={500} onChange={event => setReturnReason(event.target.value)} placeholder="Что требуется уточнить или исправить"/></label><div><button onClick={() => { setReturnOpen(false); setReturnReason(''); }}>Отмена</button><button className="is-primary" disabled={returnBusy || returnReason.trim().length < 3} onClick={async () => { if (!onReturnStep || !returnTargetId) return; setReturnBusy(true); try { await onReturnStep(returnTargetId, returnReason); setReturnOpen(false); setReturnReason(''); } finally { setReturnBusy(false); } }}><RotateCcw size={14}/>{returnBusy ? 'Возвращаем…' : 'Подтвердить возврат'}</button></div></div>}{step.iteration > 1 && <small className="step-iteration">Текущий проход: {step.iteration}</small>}{!!step.history?.length && <details className="step-iteration-history"><summary>Предыдущие проходы ({step.history.length})</summary>{step.history.map(item => <div key={`${item.iteration}:${item.archivedAt}`}><strong>Проход {item.iteration} · {item.status === 'Completed' ? 'завершён' : item.status === 'InProgress' ? 'прерван возвратом' : item.status === 'Skipped' ? 'не применялся' : 'не начат'}</strong><span>{item.returnReason}</span><small>{new Date(item.archivedAt).toLocaleString('ru-RU')}</small></div>)}</details>}</section>}
    {!!activeInstance?.returnEvents?.length && <section className="return-event-log"><h3>Возвраты экземпляра</h3>{activeInstance.returnEvents.slice().reverse().map((event, index) => <article key={`${event.returnedAt}:${index}`}><RotateCcw size={14}/><span><strong>{event.fromElementName} → {event.targetElementName}</strong><em>{event.reason}</em><small>Проход {event.iteration} · {new Date(event.returnedAt).toLocaleString('ru-RU')}</small></span></article>)}</section>}
    {activeInstance && (
      <ExecutionTimelinePanel
        processId={processId}
        instance={activeInstance}
        refreshKey={commandHistory.length}
        onOpenStep={elementId => {
          const target = elementId === node.id ? node : undefined;
          if (target) onOpenStep?.(target);
          else window.dispatchEvent(new CustomEvent('pn:focus-element', { detail: elementId }));
        }}
      />
    )}
    {!!actions.length && <section className="work-actions"><h3>Рабочие действия</h3>{!canExecute && <p className="permission-note">Действия доступны исполнителю или администратору.</p>}{actions.map(capability => { const action = capability.action!; const kind = normalizedActionKind(action.kind); const manualOpen = manualActionId === action.id; return <div className={`work-action is-${kind ?? 'unknown'}`} key={capability.id}><button className="primary-action" disabled={!canExecute || !!busyAction} onClick={() => kind === 'manual' ? setManualActionId(value => value === action.id ? undefined : action.id) : runAction(action)}>{actionIcon(action)}<span><strong>{capability.label}</strong><small>{capability.badge}{action.target ? ` · ${action.target}` : ''}</small></span>{kind === 'manual' ? <ClipboardCheck size={15}/> : <ExternalLink size={15}/>}</button>{manualOpen && <div className="manual-action-result"><label>Результат выполнения<textarea value={manualResult} maxLength={1000} onChange={event => setManualResult(event.target.value)} placeholder="Кратко укажите, что выполнено или какой результат получен (необязательно)"/></label><div><button onClick={() => { setManualActionId(undefined); setManualResult(''); }}>Отмена</button><button className="is-primary" disabled={!!busyAction} onClick={() => runAction(action, manualResult)}><CheckCircle2 size={14}/>Зафиксировать</button></div></div>}</div>; })}{lastCommand && <div className={`command-result${lastCommand.status === 'Failed' ? ' is-failed' : ''}`}><CheckCircle2 size={16}/><span><strong>{lastCommand.message}</strong>{lastCommand.result && <em>{lastCommand.result}</em>}<small>{lastCommand.externalReference ?? new Date(lastCommand.executedAt).toLocaleString('ru-RU')}</small></span></div>}{commandHistory.length > 0 && <details className="command-history"><summary>Журнал действий ({commandHistory.length})</summary>{commandHistory.map(item => <div key={item.id}><span>{item.actionLabel}</span>{item.result && <em>{item.result}</em>}<small>{new Date(item.executedAt).toLocaleString('ru-RU')} · {item.status === 'Succeeded' ? 'выполнено' : 'ошибка'}{item.externalReference ? ` · ${item.externalReference}` : ''}</small></div>)}</details>}</section>}
    {!!artifacts.length && <section><h3>Материалы</h3>{artifacts.map(capability => <button className="artifact" key={capability.id} onClick={() => openArtifact(capability.artifact?.reference, capability.artifact?.version, capability.label)}><BookOpen size={18}/><span><strong>{capability.label}</strong><small>{capability.artifact?.kind} · версия {capability.artifact?.version}{capability.artifact?.reference?.startsWith('artifact:') ? ' · репозиторий' : capability.artifact?.reference ? ` · ${capability.artifact.reference}` : ''}</small></span></button>)}</section>}
    <ElementComments key={node.id} processId={processId} elementId={node.id} onMessage={onAction}/>
  </aside>;
}
