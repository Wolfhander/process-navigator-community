import type { CatalogAuditReport, CommandExecution, DeploymentProfile, DraftLaneSyncReport, ElementComment, ElementContextUpdate, ExecutionTimeline, InformationObjectRegistry, InformationObjectUpdate, LaneOrganization, OneCConnectionStatus, OneCIntegrationSettings, OneCIntegrationUpdate, OrganizationMap, PortfolioAnalytics, ProcessAnalytics, ProcessAssignments, ProcessImportResult, ProcessPackageImportResult, ProcessSchedule, ProcessScheduleRequest, ProcessTableImportCleanupResult, ProcessTableImportHistoryItem, ProcessTableImportReport, ProcessTableImportResult, ProcessTableImportRetentionPolicy, ProcessTablePreview, ProcessTableSelectionSet, ProcessInstance, ProcessModel, ProcessNode, ProcessPropertiesUpdate, ProcessSummary, ProcessValidationReport, ProcessVersion, RepositoryArtifact, RepositoryArtifactUpload, SearchResult, Session, UserDirectory, UserNotification, UserProfile, UserUpdate } from './types';
import { readHostContext } from './host';

const hostContext = readHostContext();
let activeUser = hostContext.userId ?? localStorage.getItem('pn.demoUser') ?? 'demo-employee';
export function setActiveUser(userId: string) { activeUser = userId; localStorage.setItem('pn.demoUser', userId); }
const roleHeaders = () => ({ 'X-Process-Navigator-User': activeUser });

export async function loadSession(signal?: AbortSignal): Promise<Session> {
  const response = await fetch('/api/session', { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить профиль пользователя.'));
  return response.json() as Promise<Session>;
}

export async function loadOrganization(signal?: AbortSignal): Promise<OrganizationMap> {
  const response = await fetch('/api/organization', { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить карту группы компаний.'));
  return response.json() as Promise<OrganizationMap>;
}

export async function loadInformationObjects(signal?: AbortSignal): Promise<InformationObjectRegistry> {
  const response = await fetch('/api/information-objects', { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось построить реестр документов и результатов.'));
  return response.json() as Promise<InformationObjectRegistry>;
}

export async function saveInformationObject(objectId: string, update: InformationObjectUpdate): Promise<InformationObjectRegistry> {
  const response = await fetch(`/api/information-objects/${encodeURIComponent(objectId)}`, { method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(update) });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить объект реестра.'));
  return response.json() as Promise<InformationObjectRegistry>;
}

export async function calculateProcessSchedule(request: ProcessScheduleRequest): Promise<ProcessSchedule> {
  const query = new URLSearchParams({ rootProcessId: request.rootProcessId, direction: request.direction, anchorDate: request.anchorDate,
    includeWaitTime: String(request.includeWaitTime), workdayStart: request.workdayStart, workdayEnd: request.workdayEnd,
    workingDays: request.workingDays.join(','), durationScalePercent: String(request.durationScalePercent), transferDelayHours: String(request.transferDelayHours),
    nonWorkingDates: request.nonWorkingDates.join(','),
    processDurationScalePercent: Object.entries(request.processDurationScalePercent).map(([id, value]) => `${id}=${value}`).join(';'),
    checkpoints: Object.entries(request.checkpoints).map(([id, value]) => `${id}=${value}`).join(';') });
  const response = await fetch(`/api/processes/schedule?${query}`, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось рассчитать сроки цепочки процессов.'));
  return response.json() as Promise<ProcessSchedule>;
}

export async function saveOrganization(update: OrganizationMap): Promise<OrganizationMap> {
  const response = await fetch('/api/admin/organization', { method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(update) });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить организационную структуру.'));
  return response.json() as Promise<OrganizationMap>;
}

export type ProcessDirectionSelection = { processId: string; directions: { legalEntityId: string; directionId: string }[] };
export async function saveProcessDirections(processes: ProcessDirectionSelection[]): Promise<OrganizationMap> {
  const response = await fetch('/api/admin/organization/process-directions', {
    method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ processes })
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить направления процессов.'));
  return response.json() as Promise<OrganizationMap>;
}

export async function saveProcessLaneOrganizations(processId: string, lanes: LaneOrganization[]): Promise<OrganizationMap> {
  const response = await fetch(`/api/admin/processes/${encodeURIComponent(processId)}/lane-organizations`, {
    method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ lanes })
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить подразделения дорожек.'));
  return response.json() as Promise<OrganizationMap>;
}

export async function syncDraftLaneNames(): Promise<DraftLaneSyncReport> {
  const response = await fetch('/api/admin/organization/sync-draft-lanes', { method: 'POST', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось обновить названия дорожек.'));
  return response.json() as Promise<DraftLaneSyncReport>;
}

export async function saveProcessProperties(processId: string, update: ProcessPropertiesUpdate): Promise<ProcessModel> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/draft/properties`, { method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(update) });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить свойства процесса.'));
  return response.json() as Promise<ProcessModel>;
}

export async function loadProcessAnalytics(processId: string): Promise<ProcessAnalytics> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/analytics`, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить аналитику процесса.'));
  return response.json() as Promise<ProcessAnalytics>;
}

export async function loadPortfolioAnalytics(): Promise<PortfolioAnalytics> {
  const response = await fetch('/api/analytics/portfolio', { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить аналитику портфеля процессов.'));
  return response.json() as Promise<PortfolioAnalytics>;
}

export async function executeProcessAction(processId: string, elementId: string, actionId: string, instanceId?: string, result?: string): Promise<CommandExecution> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/elements/${encodeURIComponent(elementId)}/actions/${encodeURIComponent(actionId)}/execute`, {
    method: 'POST', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId, result })
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось выполнить команду процесса.'));
  return response.json() as Promise<CommandExecution>;
}

export async function loadCommandHistory(processId: string, elementId: string): Promise<CommandExecution[]> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/elements/${encodeURIComponent(elementId)}/commands`, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить журнал команд.'));
  return response.json() as Promise<CommandExecution[]>;
}

export async function searchProcesses(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось выполнить поиск.'));
  return response.json() as Promise<SearchResult[]>;
}

export async function loadElementComments(processId: string, elementId: string, signal?: AbortSignal): Promise<ElementComment[]> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/elements/${encodeURIComponent(elementId)}/comments`, { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить комментарии.'));
  return response.json() as Promise<ElementComment[]>;
}

export async function addElementComment(processId: string, elementId: string, text: string): Promise<ElementComment> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/elements/${encodeURIComponent(elementId)}/comments`, {
    method: 'POST', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить комментарий.'));
  return response.json() as Promise<ElementComment>;
}

export async function loadNotifications(signal?: AbortSignal): Promise<UserNotification[]> {
  const response = await fetch('/api/notifications', { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить уведомления.'));
  return response.json() as Promise<UserNotification[]>;
}

export async function markNotificationRead(notificationId: string): Promise<UserNotification> {
  const response = await fetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PUT', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось отметить уведомление прочитанным.'));
  return response.json() as Promise<UserNotification>;
}

export async function markAllNotificationsRead(): Promise<void> {
  const response = await fetch('/api/notifications/read-all', { method: 'PUT', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось отметить уведомления прочитанными.'));
}

export async function loadOneCSettings(): Promise<OneCIntegrationSettings> {
  const response = await fetch('/api/admin/integrations/one-c', { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить настройки 1С.'));
  return response.json() as Promise<OneCIntegrationSettings>;
}

export async function loadDeploymentProfile(): Promise<DeploymentProfile> {
  const response = await fetch('/api/deployment-profile', { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить схему размещения системы.'));
  return response.json() as Promise<DeploymentProfile>;
}

export async function saveOneCSettings(update: OneCIntegrationUpdate): Promise<OneCIntegrationSettings> {
  const response = await fetch('/api/admin/integrations/one-c', { method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(update) });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить настройки 1С.'));
  return response.json() as Promise<OneCIntegrationSettings>;
}

export async function testOneCConnection(): Promise<OneCConnectionStatus> {
  const response = await fetch('/api/admin/integrations/one-c/test', { method: 'POST', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось проверить соединение с 1С.'));
  return response.json() as Promise<OneCConnectionStatus>;
}

export async function loadUserDirectory(): Promise<UserDirectory> {
  const response = await fetch('/api/admin/users', { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить список пользователей.'));
  return response.json() as Promise<UserDirectory>;
}

export async function updateUser(userId: string, update: UserUpdate): Promise<UserProfile> {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(update)
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить пользователя.'));
  return response.json() as Promise<UserProfile>;
}

export async function loadAssignments(processId: string): Promise<ProcessAssignments> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/assignments`, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить ответственных по дорожкам.'));
  return response.json() as Promise<ProcessAssignments>;
}

export async function saveAssignments(processId: string, assignments: ProcessAssignments): Promise<ProcessAssignments> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/assignments`, {
    method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ lanes: assignments.lanes.map(lane => ({ laneId: lane.laneId, userIds: lane.userIds })) })
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить ответственных.'));
  return response.json() as Promise<ProcessAssignments>;
}

export async function loadInstances(processId: string): Promise<ProcessInstance[]> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/instances`, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить выполнения процесса.'));
  return response.json() as Promise<ProcessInstance[]>;
}

export async function loadInstanceTimeline(processId: string, instanceId: string): Promise<ExecutionTimeline> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/instances/${encodeURIComponent(instanceId)}/timeline`, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить историю выполнения.'));
  return response.json() as Promise<ExecutionTimeline>;
}

export async function startInstance(processId: string, name?: string): Promise<ProcessInstance> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/instances`, { method: 'POST', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось запустить процесс.'));
  return response.json() as Promise<ProcessInstance>;
}

export async function updateStep(processId: string, instanceId: string, elementId: string, status: 'InProgress' | 'Completed'): Promise<ProcessInstance> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/instances/${encodeURIComponent(instanceId)}/steps/${encodeURIComponent(elementId)}`, { method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось изменить состояние шага.'));
  return response.json() as Promise<ProcessInstance>;
}

export async function assignInstanceStep(processId: string, instanceId: string, elementId: string, userId: string, reason: string): Promise<ProcessInstance> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/instances/${encodeURIComponent(instanceId)}/steps/${encodeURIComponent(elementId)}/assignment`, {
    method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, reason })
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось передать шаг другому исполнителю.'));
  return response.json() as Promise<ProcessInstance>;
}

export async function returnStep(processId: string, instanceId: string, fromElementId: string, targetElementId: string, reason: string): Promise<ProcessInstance> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/instances/${encodeURIComponent(instanceId)}/steps/${encodeURIComponent(fromElementId)}/return`, {
    method: 'POST', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ targetElementId, reason })
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось вернуть процесс на доработку.'));
  return response.json() as Promise<ProcessInstance>;
}

export async function changeInstanceLifecycle(processId: string, instanceId: string, action: 'pause' | 'resume' | 'cancel', reason?: string): Promise<ProcessInstance> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/instances/${encodeURIComponent(instanceId)}/lifecycle`, {
    method: 'POST', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason })
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось изменить состояние экземпляра.'));
  return response.json() as Promise<ProcessInstance>;
}

export async function saveStepResult(processId: string, instanceId: string, elementId: string, resultText: string, objectIds: string[]): Promise<ProcessInstance> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/instances/${encodeURIComponent(instanceId)}/steps/${encodeURIComponent(elementId)}/result`, {
    method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ resultText, objectIds })
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить фактический результат.'));
  return response.json() as Promise<ProcessInstance>;
}

export async function uploadStepAttachment(processId: string, instanceId: string, elementId: string, file: File, name?: string): Promise<ProcessInstance> {
  const body = new FormData(); body.append('file', file); if (name) body.append('name', name);
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/instances/${encodeURIComponent(instanceId)}/steps/${encodeURIComponent(elementId)}/attachments`, {
    method: 'POST', headers: roleHeaders(), body
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось прикрепить файл результата.'));
  return response.json() as Promise<ProcessInstance>;
}

async function errorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { message?: string; detail?: string; title?: string };
    return payload.message ?? payload.detail ?? payload.title ?? fallback;
  } catch {
    return fallback;
  }
}

export async function loadProcess(id: string, signal?: AbortSignal, draft = false): Promise<ProcessModel> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}${draft ? '?draft=true' : ''}`, { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить процесс.'));
  return response.json() as Promise<ProcessModel>;
}

export async function createDraft(id: string): Promise<ProcessSummary> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/draft`, { method: 'POST', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось создать новую редакцию.'));
  return response.json() as Promise<ProcessSummary>;
}

export async function replaceDraft(id: string, bpmnFile: File, contextFile?: File): Promise<ProcessImportResult> {
  const body = new FormData(); body.append('bpmnFile', bpmnFile); if (contextFile) body.append('contextFile', contextFile);
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/draft`, { method: 'PUT', body, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось заменить BPMN черновика.'));
  return response.json() as Promise<ProcessImportResult>;
}

export async function loadDraftBpmn(id: string): Promise<string> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/draft/bpmn`, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить BPMN черновика.'));
  return response.text();
}

export async function saveDraftBpmn(id: string, xml: string, editToken?: string): Promise<ProcessImportResult> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/draft/bpmn`, {
    method: 'PUT', headers: { ...roleHeaders(), ...(editToken ? { 'X-Process-Navigator-Edit-Lock': editToken } : {}), 'Content-Type': 'application/xml; charset=utf-8' }, body: xml
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить BPMN черновика.'));
  return response.json() as Promise<ProcessImportResult>;
}

export async function acquireEditLock(id: string): Promise<import('./types').ProcessEditLock> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/draft/lock`, { method: 'POST', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось открыть редактор.'));
  return response.json();
}
export async function renewEditLock(id: string, token: string): Promise<import('./types').ProcessEditLock> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/draft/lock`, { method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  if (!response.ok) throw new Error(await errorMessage(response, 'Блокировка редактирования потеряна.'));
  return response.json();
}
export async function releaseEditLock(id: string, token: string): Promise<void> {
  await fetch(`/api/processes/${encodeURIComponent(id)}/draft/lock?token=${encodeURIComponent(token)}`, { method: 'DELETE', headers: roleHeaders(), keepalive: true });
}

export async function saveElementContext(processId: string, elementId: string, update: ElementContextUpdate): Promise<ProcessNode> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/draft/elements/${encodeURIComponent(elementId)}/context`, {
    method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(update)
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить контекст элемента.'));
  return response.json() as Promise<ProcessNode>;
}

export async function loadArtifacts(): Promise<RepositoryArtifact[]> {
  const response = await fetch('/api/artifacts', { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить репозиторий документов.'));
  return response.json() as Promise<RepositoryArtifact[]>;
}

export async function uploadArtifact(file: File, name: string, kind: string, version: string, artifactId?: string): Promise<RepositoryArtifactUpload> {
  const body = new FormData(); body.append('file', file); body.append('name', name); body.append('kind', kind); body.append('version', version); if (artifactId) body.append('artifactId', artifactId);
  const response = await fetch('/api/artifacts', { method: 'POST', headers: roleHeaders(), body });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить документ.'));
  return response.json() as Promise<RepositoryArtifactUpload>;
}

export function artifactDownloadUrl(reference: string, version?: string) {
  const id = reference.startsWith('artifact:') ? reference.slice('artifact:'.length) : '';
  return id ? `/api/artifacts/${encodeURIComponent(id)}/content${version ? `?version=${encodeURIComponent(version)}` : ''}` : undefined;
}

export async function publishDraft(id: string): Promise<ProcessSummary> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/publish`, { method: 'POST', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось опубликовать редакцию.'));
  return response.json() as Promise<ProcessSummary>;
}

export async function validateDraft(id: string): Promise<ProcessValidationReport> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/draft/validation`, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось проверить редакцию.'));
  return response.json() as Promise<ProcessValidationReport>;
}

export async function auditProcessCatalog(signal?: AbortSignal): Promise<CatalogAuditReport> {
  const response = await fetch('/api/processes/audit', { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось проверить каталог процессов.'));
  return response.json() as Promise<CatalogAuditReport>;
}

export function exportProcessCatalogAudit() {
  return downloadAdminFile('/api/processes/audit/export', `process-catalog-check-${new Date().toISOString().slice(0, 10)}.csv`);
}

export async function loadProcessWorkflow(id: string): Promise<import('./types').ProcessWorkflow> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/draft/workflow`, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить согласование.'));
  return response.json() as Promise<import('./types').ProcessWorkflow>;
}

export async function transitionProcessWorkflow(id: string, action: string, comment?: string): Promise<import('./types').ProcessWorkflow> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/draft/workflow/${encodeURIComponent(action)}`, { method: 'POST', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }) });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось изменить статус согласования.'));
  return response.json() as Promise<import('./types').ProcessWorkflow>;
}

export async function configureProcessWorkflow(id: string, stages: import('./types').ProcessWorkflowStage[], reviewDueAt?: string): Promise<import('./types').ProcessWorkflow> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/draft/workflow/route`, { method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ stages, reviewDueAt: reviewDueAt || null }) });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить маршрут согласования.'));
  return response.json() as Promise<import('./types').ProcessWorkflow>;
}

export async function loadVersions(id: string): Promise<ProcessVersion[]> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/versions`, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить историю версий.'));
  return response.json() as Promise<ProcessVersion[]>;
}

export async function loadArchivedProcess(id: string, version: string, signal?: AbortSignal): Promise<ProcessModel> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`, { signal });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить архивную версию.'));
  return response.json() as Promise<ProcessModel>;
}

export async function loadProcessCatalog(signal?: AbortSignal): Promise<ProcessSummary[]> {
  const response = await fetch('/api/processes', { signal });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить каталог процессов.'));
  return response.json() as Promise<ProcessSummary[]>;
}

export async function loadProcessHierarchy(signal?: AbortSignal): Promise<import('./types').ProcessHierarchyNode[]> {
  const response = await fetch('/api/processes/hierarchy', { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить иерархию процессов.'));
  return response.json() as Promise<import('./types').ProcessHierarchyNode[]>;
}

export async function loadProcessDecomposition(signal?: AbortSignal): Promise<import('./types').ProcessDecompositionMap> {
  const response = await fetch('/api/processes/decomposition', { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить карту детализации.'));
  return response.json() as Promise<import('./types').ProcessDecompositionMap>;
}

export async function saveProcessHierarchy(id: string, update: import('./types').ProcessHierarchyUpdate): Promise<import('./types').ProcessHierarchyNode> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}/draft/hierarchy`, {
    method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(update)
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить положение процесса в иерархии.'));
  return response.json() as Promise<import('./types').ProcessHierarchyNode>;
}

export async function saveProcessHierarchyBulk(update: import('./types').ProcessHierarchyBulkUpdate): Promise<import('./types').ProcessHierarchyNode[]> {
  const response = await fetch('/api/processes/hierarchy/bulk', {
    method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(update)
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось массово изменить процессы.'));
  return response.json() as Promise<import('./types').ProcessHierarchyNode[]>;
}

export async function importProcess(bpmnFile: File, contextFile?: File): Promise<ProcessImportResult> {
  const body = new FormData();
  body.append('bpmnFile', bpmnFile);
  if (contextFile) body.append('contextFile', contextFile);
  const response = await fetch('/api/processes/import', { method: 'POST', body, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось импортировать процесс.'));
  return response.json() as Promise<ProcessImportResult>;
}

export async function downloadProcessTableTemplate(): Promise<void> {
  const response = await fetch('/api/processes/table-template', { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось скачать табличный шаблон.'));
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'Process-Navigator-process-table.xlsx'; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadProcessTableExport(processId: string, includeDescendants: boolean): Promise<void> {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/table-export?includeDescendants=${includeDescendants}`, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось выгрузить процесс в таблицу.'));
  const disposition = response.headers.get('content-disposition') ?? '';
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const fallbackName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const fileName = encodedName ? decodeURIComponent(encodedName) : fallbackName ?? `Process-Navigator-${processId}.xlsx`;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = fileName; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function previewProcessTable(tableFile: File): Promise<ProcessTablePreview> {
  const body = new FormData(); body.append('tableFile', tableFile);
  const response = await fetch('/api/processes/table-preview', { method: 'POST', headers: roleHeaders(), body });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось проверить табличное описание процессов.'));
  return response.json() as Promise<ProcessTablePreview>;
}

export async function importProcessTable(tableFile: File, selectedProcessIds: string[], confirmedRemovalProcessIds: string[] = [], stepIdMappings: import('./types').ProcessTableStepIdMapping[] = []): Promise<ProcessTableImportResult> {
  const body = new FormData(); body.append('tableFile', tableFile); body.append('selectedProcessIds', selectedProcessIds.join('|')); body.append('confirmedRemovalProcessIds', confirmedRemovalProcessIds.join('|')); body.append('stepIdMappings', JSON.stringify(stepIdMappings));
  const response = await fetch('/api/processes/table-import', { method: 'POST', headers: roleHeaders(), body });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось создать черновики из таблицы.'));
  return response.json() as Promise<ProcessTableImportResult>;
}

export function downloadProcessTableImportReport(fileName: string) {
  return downloadAdminFile(`/api/processes/table-import-reports/${encodeURIComponent(fileName)}`, fileName);
}

export async function loadProcessTableImportHistory(signal?: AbortSignal): Promise<ProcessTableImportHistoryItem[]> {
  const response = await fetch('/api/processes/table-import-history?limit=500', { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить историю табличных импортов.'));
  return response.json() as Promise<ProcessTableImportHistoryItem[]>;
}

export async function loadProcessTableImportReport(historyId: string, signal?: AbortSignal): Promise<ProcessTableImportReport> {
  const response = await fetch(`/api/processes/table-import-history/${encodeURIComponent(historyId)}/report`, { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось открыть протокол импорта.'));
  return response.json() as Promise<ProcessTableImportReport>;
}

export async function deleteProcessTableImportHistory(historyId: string): Promise<void> {
  const response = await fetch(`/api/processes/table-import-history/${encodeURIComponent(historyId)}`, { method: 'DELETE', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось удалить запись импорта.'));
}

export async function loadProcessTableImportRetentionPolicy(signal?: AbortSignal): Promise<ProcessTableImportRetentionPolicy> {
  const response = await fetch('/api/admin/table-import-retention', { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить правила хранения.'));
  return response.json() as Promise<ProcessTableImportRetentionPolicy>;
}

export async function saveProcessTableImportRetentionPolicy(policy: ProcessTableImportRetentionPolicy): Promise<ProcessTableImportRetentionPolicy> {
  const response = await fetch('/api/admin/table-import-retention', { method: 'PUT', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(policy) });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить правила хранения.'));
  return response.json() as Promise<ProcessTableImportRetentionPolicy>;
}

export async function cleanupProcessTableImportHistory(): Promise<ProcessTableImportCleanupResult> {
  const response = await fetch('/api/admin/table-import-retention/cleanup', { method: 'POST', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось очистить историю импорта.'));
  return response.json() as Promise<ProcessTableImportCleanupResult>;
}

export async function loadProcessTableSelectionSets(signal?: AbortSignal): Promise<ProcessTableSelectionSet[]> {
  const response = await fetch('/api/processes/table-selection-sets', { signal, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить сохранённые наборы.'));
  return response.json() as Promise<ProcessTableSelectionSet[]>;
}

export async function saveProcessTableSelectionSet(name: string, processIds: string[]): Promise<ProcessTableSelectionSet> {
  const response = await fetch('/api/processes/table-selection-sets', {
    method: 'POST', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name, processIds })
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось сохранить набор выбора.'));
  return response.json() as Promise<ProcessTableSelectionSet>;
}

export async function deleteProcessTableSelectionSet(id: string): Promise<void> {
  const response = await fetch(`/api/processes/table-selection-sets/${encodeURIComponent(id)}`, { method: 'DELETE', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось удалить набор выбора.'));
}

export async function importProcessPackage(packageFile: File): Promise<ProcessPackageImportResult> {
  const body = new FormData();
  body.append('packageFile', packageFile);
  const response = await fetch('/api/processes/import-package', { method: 'POST', body, headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось импортировать пакет процессов.'));
  return response.json() as Promise<ProcessPackageImportResult>;
}

export async function createProcess(model: import('./types').CreateProcess): Promise<ProcessImportResult> {
  const response = await fetch('/api/processes', { method: 'POST', headers: { ...roleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(model) });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось создать процесс.'));
  return response.json() as Promise<ProcessImportResult>;
}

export async function deleteProcess(id: string): Promise<void> {
  const response = await fetch(`/api/processes/${encodeURIComponent(id)}`, { method: 'DELETE', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось удалить процесс.'));
}

export async function loadAuditLog(): Promise<import('./types').AuditEntry[]> {
  const response = await fetch('/api/admin/audit?limit=500', { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить журнал аудита.'));
  return response.json() as Promise<import('./types').AuditEntry[]>;
}

async function downloadAdminFile(url: string, fallbackName: string) {
  const response = await fetch(url, { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось скачать файл.'));
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : fallbackName;
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = objectUrl; link.download = name; link.click(); URL.revokeObjectURL(objectUrl);
}

export function exportAuditLog() { return downloadAdminFile('/api/admin/audit/export', 'process-navigator-audit.csv'); }
export async function loadBackups(): Promise<import('./types').BackupInfo[]> {
  const response = await fetch('/api/admin/backups', { headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось загрузить список резервных копий.'));
  return response.json() as Promise<import('./types').BackupInfo[]>;
}
export async function createBackup(): Promise<import('./types').BackupInfo> {
  const response = await fetch('/api/admin/backups', { method: 'POST', headers: roleHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response, 'Не удалось создать резервную копию.'));
  return response.json() as Promise<import('./types').BackupInfo>;
}
export function downloadBackup(fileName: string) { return downloadAdminFile(`/api/admin/backups/${encodeURIComponent(fileName)}/content`, fileName); }
async function sendBackupPackage(url: string, file: File) {
  const body = new FormData(); body.append('package', file);
  const response = await fetch(url, { method: 'POST', headers: roleHeaders(), body });
  if (!response.ok) throw new Error(await errorMessage(response, 'Резервная копия не прошла проверку.'));
  return response;
}
export async function previewBackupRestore(file: File): Promise<import('./types').BackupRestorePreview> { return (await sendBackupPackage('/api/admin/backups/restore/preview', file)).json(); }
export async function restoreBackup(file: File): Promise<import('./types').BackupRestoreResult> { return (await sendBackupPackage('/api/admin/backups/restore', file)).json(); }
