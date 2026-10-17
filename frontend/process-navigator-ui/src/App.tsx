import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { processLocationHash, readProcessLocation } from './process-location';
import { Activity, BarChart3, Bell, BriefcaseBusiness, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, FilePenLine, GitPullRequest, History, Home, Maximize2, Minus, Network, PanelTop, PencilRuler, PlugZap, Plus, Rocket, RotateCcw, Search, Upload, UserCog, Users } from 'lucide-react';
import { createDraft, loadArchivedProcess, loadAssignments, loadNotifications, loadOrganization, loadProcess, loadProcessCatalog, loadSession, markAllNotificationsRead, markNotificationRead, publishDraft, returnStep, setActiveUser, updateStep } from './api';
import { ContextPanel } from './ContextPanel';
import { SectionLoadBoundary } from './SectionLoadBoundary';
import { ProcessCanvas } from './ProcessCanvas';
import { VersionDialog } from './VersionDialog';
import { UserMenu } from './UserMenu';
import { AssignmentDialog } from './AssignmentDialog';
import { ExecutionDialog } from './ExecutionDialog';
import { AnalyticsDialog } from './AnalyticsDialog';
import { SearchDialog } from './SearchDialog';
import { NotificationDialog } from './NotificationDialog';
import { OneCIntegrationDialog } from './OneCIntegrationDialog';
import { EnterpriseMap } from './EnterpriseMap';
import { LaneOrganizationDialog } from './LaneOrganizationDialog';
import { DeploymentDialog } from './DeploymentDialog';
import { CreateProcessDialog } from './CreateProcessDialog';
import { EvidenceRegisterPage } from './EvidenceRegisterPage';
import { ProcessCatalogDialog } from './ProcessCatalogDialog';
import { ProcessPropertiesDialog } from './ProcessPropertiesDialog';
import { PublicationValidationDialog } from './PublicationValidationDialog';
import { AuditLogDialog } from './AuditLogDialog';
import { WorkspaceHome, type HomeAction } from './WorkspaceHome';
import { AppVersionPage } from './AppVersionPage';
import { DraftLaneSyncDialog } from './DraftLaneSyncDialog';
import { ProcessDirectionMatrixDialog } from './ProcessDirectionMatrixDialog';
import { CatalogAuditDialog } from './CatalogAuditDialog';
import { PersonalProcesses } from './PersonalProcesses';
import { usePersonalWorkspace } from './usePersonalWorkspace';
import { buildExecutionGuidance, buildReturnStepOptions } from './process-execution-flow';
import './workspace-navigation.css';
import { LifecycleDialog } from './LifecycleDialog';
import { announceReady, readHostContext } from './host';
import type { InformationObjectOccurrence, OrganizationMap, ProcessAssignments, ProcessImportResult, ProcessInstance, ProcessModel, ProcessNode, ProcessSummary, SearchResult, Session, UserNotification } from './types';
import './workflow-fixes.css';

const BpmnEditor = lazy(() => import('./BpmnEditor').then(module => ({ default: module.BpmnEditor })));
const HelpDialog = lazy(() => import('./HelpDialog').then(module => ({ default: module.HelpDialog })));
const ImportDialog = lazy(() => import('./ImportDialog').then(module => ({ default: module.ImportDialog })));
const UserAdminDialog = lazy(() => import('./UserAdminDialog').then(module => ({ default: module.UserAdminDialog })));
const OrganizationAdminDialog = lazy(() => import('./OrganizationAdminDialog').then(module => ({ default: module.OrganizationAdminDialog })));
const PortfolioAnalyticsDialog = lazy(() => import('./PortfolioAnalyticsDialog').then(module => ({ default: module.PortfolioAnalyticsDialog })));
const DevelopmentRoadmapPage = lazy(() => import('./DevelopmentRoadmapPage').then(module => ({ default: module.DevelopmentRoadmapPage })));
const ProcessTableImportHistoryPage = lazy(() => import('./ProcessTableImportHistoryPage').then(module => ({ default: module.ProcessTableImportHistoryPage })));
const ProcessSchedulePage = lazy(() => import('./ProcessSchedulePage').then(module => ({ default: module.ProcessSchedulePage })));
const ProcessInstructionPage = lazy(() => import('./ProcessInstructionPage').then(module => ({ default: module.ProcessInstructionPage })));
const ProcessResponsibilityPage = lazy(() => import('./ProcessResponsibilityPage').then(module => ({ default: module.ProcessResponsibilityPage })));
const InformationObjectRegistryPage = lazy(() => import('./InformationObjectRegistryPage').then(module => ({ default: module.InformationObjectRegistryPage })));

export default function App() {
  const [initialLocation] = useState(() => readProcessLocation(window.location.hash));
  const restoreLocation = useRef(initialLocation);
  const hostContext = readHostContext();
  const [catalog, setCatalog] = useState<ProcessSummary[]>([]);
  const [session, setSession] = useState<Session>();
  const personalWorkspace = usePersonalWorkspace(session?.currentUser.id ?? '');
  const [processId, setProcessId] = useState(initialLocation?.processId ?? '');
  const [process, setProcess] = useState<ProcessModel>();
  const [selected, setSelected] = useState<ProcessNode>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [createProcessOpen, setCreateProcessOpen] = useState(false);
  const [auditReturnSection, setAuditReturnSection] = useState<'home' | 'catalog'>('home');
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [draftLaneSyncOpen, setDraftLaneSyncOpen] = useState(false);
  const [assignmentsOpen, setAssignmentsOpen] = useState(false);
  const [responsibilityOpen, setResponsibilityOpen] = useState(false);
  const [instructionOpen, setInstructionOpen] = useState(false);
  const [assignments, setAssignments] = useState<ProcessAssignments>();
  const [personalMode, setPersonalMode] = useState(false);
  const [executionsOpen, setExecutionsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [portfolioAnalyticsOpen, setPortfolioAnalyticsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [oneCOpen, setOneCOpen] = useState(false);
  const [deploymentOpen, setDeploymentOpen] = useState(false);
  const [enterpriseOpen, setEnterpriseOpen] = useState(!initialLocation);
  useEffect(() => { setInstructionOpen(false); setResponsibilityOpen(false); }, [process?.id, process?.version, enterpriseOpen, session?.currentUser.id]);
  const [homeSection, setHomeSection] = useState<'home' | 'map' | 'settings' | 'version' | 'roadmap' | 'import' | 'importHistory' | 'help' | 'catalog' | 'catalogAudit' | 'evidenceRegister' | 'informationObjects' | 'schedule' | 'organization' | 'users' | 'directions' | 'auditLog'>('home');
  const [organizationIdentity, setOrganizationIdentity] = useState<OrganizationMap>();
  const [organizationEditor, setOrganizationEditor] = useState<OrganizationMap>();
  const [laneOrganizationEditor, setLaneOrganizationEditor] = useState<{ organization: OrganizationMap; process: ProcessModel }>();
  const [processPropertiesOrganization, setProcessPropertiesOrganization] = useState<OrganizationMap>();
  const [organizationReloadKey, setOrganizationReloadKey] = useState(0);
  const [pendingSearchResult, setPendingSearchResult] = useState<SearchResult>();
  const [pendingAuditTarget, setPendingAuditTarget] = useState<{ processId: string; elementId: string }>();
  const [activeInstance, setActiveInstance] = useState<ProcessInstance>();
  const [draftView, setDraftView] = useState(initialLocation?.draft ?? false);
  const [archivedVersion, setArchivedVersion] = useState<string | undefined>(initialLocation?.version);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [publicationValidationOpen, setPublicationValidationOpen] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [sectionVisit, setSectionVisit] = useState(0);
  const [zoomCommand, setZoomCommand] = useState({ id: 0, factor: 1 });
  const [fitCommand, setFitCommand] = useState(0);
  const [focusCommand, setFocusCommand] = useState<{ id: number; elementId: string }>();
  const [processTrail, setProcessTrail] = useState<{ id: string; name: string }[]>(() => initialLocation?.trail?.map(id => ({ id, name: id })) ?? []);

  const refreshCatalog = async (preferredId?: string) => {
    const items = await loadProcessCatalog();
    setCatalog(items);
    const nextId = preferredId && items.some(item => item.id === preferredId)
      ? preferredId
      : items.find(item => item.id === processId)?.id ?? items[0]?.id ?? '';
    setProcessId(nextId);
  };

  useEffect(() => {
    const controller = new AbortController();
    loadProcessCatalog(controller.signal).then(items => {
      setCatalog(items);
      setProcessTrail(current => current.filter(parent => items.some(item => item.id === parent.id)).map(parent => ({ id: parent.id, name: items.find(item => item.id === parent.id)!.name })));
      // The home page does not require access to any individual process.
    }).catch(reason => { if (reason.name !== 'AbortError') setError(reason.message); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadSession(controller.signal).then(setSession).catch(reason => { if (reason.name !== 'AbortError') setError(reason.message); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadOrganization(controller.signal)
      .then(setOrganizationIdentity)
      .catch(reason => { if (reason.name !== 'AbortError') setError(reason.message); });
    return () => controller.abort();
  }, [organizationReloadKey]);

  useEffect(() => {
    const groupButton = document.querySelectorAll<HTMLButtonElement>('.breadcrumb-button')[1];
    if (groupButton && organizationIdentity?.name) groupButton.textContent = organizationIdentity.name;
  });

  useEffect(() => {
    const openCreateProcess = () => setCreateProcessOpen(true);
    const openAuditLog = () => { setEnterpriseOpen(true); setPortfolioAnalyticsOpen(false); setHomeSection('auditLog'); };
    window.addEventListener('process-navigator:create-process', openCreateProcess);
    window.addEventListener('process-navigator:audit', openAuditLog);
    return () => { window.removeEventListener('process-navigator:create-process', openCreateProcess); window.removeEventListener('process-navigator:audit', openAuditLog); };
  }, []);

  useEffect(() => {
    if (session) announceReady(hostContext, session.currentUser.id);
  }, [session?.currentUser.id]);

  useEffect(() => {
    if (!processId || enterpriseOpen || !session) return;
    const controller = new AbortController();
    setSelected(undefined); setProcess(undefined); setError('');
    const request = archivedVersion
      ? loadArchivedProcess(processId, archivedVersion, controller.signal)
      : loadProcess(processId, controller.signal, draftView);
    request.then(result => { if (!controller.signal.aborted) {
      setProcess(result); personalWorkspace.visit(result.id);
      if (restoreLocation.current?.processId === result.id) {
        const elementId = restoreLocation.current.elementId;
        setSelected(result.nodes.find(node => node.id === elementId));
        if (elementId && result.nodes.some(node => node.id === elementId)) setFocusCommand({ id: Date.now(), elementId });
        restoreLocation.current = undefined;
      }
    } })
      .catch(reason => { if (reason.name !== 'AbortError') setError(reason.message); });
    return () => controller.abort();
  }, [processId, draftView, archivedVersion, reloadKey, enterpriseOpen, session?.currentUser.id]);

  useEffect(() => {
    if (!session || (!enterpriseOpen && process?.id !== processId)) return;
    const currentLocation = readProcessLocation(window.location.hash);
    const hash = processLocationHash(enterpriseOpen ? undefined : { processId, elementId: selected?.id, draft: draftView, version: archivedVersion,
      expandedSteps: currentLocation?.processId === processId ? currentLocation.expandedSteps : undefined,
      trail: processTrail.map(parent => parent.id) });
    if (window.location.hash !== hash) window.history.replaceState(null, '', window.location.pathname + window.location.search + hash);
  }, [session, enterpriseOpen, process, processId, selected?.id, draftView, archivedVersion, processTrail]);

  useEffect(() => {
    if (!processId || !session || enterpriseOpen) return;
    loadAssignments(processId).then(setAssignments).catch(() => setAssignments(undefined));
  }, [processId, session?.currentUser.id, enterpriseOpen]);

  useEffect(() => setPersonalMode(false), [processId, session?.currentUser.id]);
  useEffect(() => setActiveInstance(undefined), [processId]);

  useEffect(() => {
    const updateInstance = (event: Event) => setActiveInstance((event as CustomEvent<ProcessInstance>).detail);
    window.addEventListener('pn:instance-updated', updateInstance);
    return () => window.removeEventListener('pn:instance-updated', updateInstance);
  }, []);

  useEffect(() => {
    const focusElement = (event: Event) => {
      const elementId = (event as CustomEvent<string>).detail;
      const target = process?.nodes.find(node => node.id === elementId);
      if (!target) return;
      setSelected(target);
      setFocusCommand(current => ({ id: (current?.id ?? 0) + 1, elementId }));
    };
    window.addEventListener('pn:focus-element', focusElement);
    return () => window.removeEventListener('pn:focus-element', focusElement);
  }, [process]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const refresh = () => loadNotifications(controller.signal).then(setNotifications).catch(() => undefined);
    refresh(); const timer = window.setInterval(refresh, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [session?.currentUser.id]);

  useEffect(() => {
    if (!process || !pendingSearchResult || process.id !== pendingSearchResult.processId) return;
    setDraftView(false); setArchivedVersion(undefined); setPersonalMode(false);
    setSelected(pendingSearchResult.elementId ? process.nodes.find(node => node.id === pendingSearchResult.elementId) : undefined);
    setPendingSearchResult(undefined);
  }, [process, pendingSearchResult]);

  useEffect(() => {
    if (!process || !pendingAuditTarget || process.id !== pendingAuditTarget.processId) return;
    setPersonalMode(false);
    setSelected(process.nodes.find(node => node.id === pendingAuditTarget.elementId)
      ?? process.nodes.find(node => node.laneId === pendingAuditTarget.elementId));
    setFocusCommand(current => ({ id: (current?.id ?? 0) + 1, elementId: pendingAuditTarget.elementId }));
    setPendingAuditTarget(undefined);
  }, [process, pendingAuditTarget]);

  const notify = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 2800);
  };

  const can = (permission: string) => session?.currentUser.permissions.includes(permission) === true;
  const personalLaneIds = assignments?.lanes.filter(lane => lane.userIds.includes(session?.currentUser.id ?? '')).map(lane => lane.laneId) ?? [];
  const unreadNotifications = notifications.filter(item => !item.readAt).length;
  const changeUser = async (userId: string) => {
    setActiveUser(userId);
    const nextSession = await loadSession();
    setSession(nextSession);
    setPortfolioAnalyticsOpen(false); setAnalyticsOpen(false);
    setError('');
    const mayOpenDraft = nextSession.currentUser.permissions.some(permission => ['process.diagram.edit', 'process.context.edit', 'process.publish'].includes(permission));
    if (!mayOpenDraft) { setEnterpriseOpen(true); setDraftView(false); setArchivedVersion(undefined); setEditorOpen(false); }
    else if (!enterpriseOpen) { setDraftView(catalog.find(item => item.id === processId)?.status === 'Draft' || draftView); }
    notify(`Текущий пользователь: ${nextSession.currentUser.displayName}`);
  };

  const navigateSection = (section: 'home' | 'map' | 'settings' | 'version' | 'roadmap' | 'analytics' | 'import' | 'importHistory' | 'help' | 'catalog' | 'catalogAudit' | 'evidenceRegister' | 'informationObjects' | 'schedule' | 'organization' | 'users' | 'directions' | 'auditLog') => {
    if (editorOpen && !window.confirm('Переход закроет редактор. Сохраните изменения перед выходом. Продолжить?')) return;
    setSectionVisit(value => value + 1);
    setImportOpen(false);
    setEditorOpen(false); setError(''); setEnterpriseOpen(true);
    setAnalyticsOpen(false);
    setPortfolioAnalyticsOpen(section === 'analytics');
    setHomeSection(section === 'analytics' ? 'home' : section);
    setDraftView(false);
    setProcessTrail([]);
  };
  const homeAction = (action: HomeAction) => {
    if (action === 'map' || action === 'analytics' || action === 'settings' || action === 'version') { navigateSection(action); return; }
    if (action === 'catalog') { navigateSection('catalog'); return; }
    if (action === 'catalogAudit') { setAuditReturnSection('home'); navigateSection('catalogAudit'); return; }
    if (action === 'evidenceRegister') { navigateSection('evidenceRegister'); return; }
    if (action === 'informationObjects') { navigateSection('informationObjects'); return; }
    if (action === 'schedule') { navigateSection('schedule'); return; }
    if (action === 'create') setCreateProcessOpen(true);
    if (action === 'import') { setDraftView(false); navigateSection('import'); }
    if (action === 'importHistory') navigateSection('importHistory');
    if (action === 'organization') { setOrganizationEditor(undefined); navigateSection('organization'); loadOrganization().then(setOrganizationEditor).catch(reason => notify(reason.message)); }
    if (action === 'syncLanes') setDraftLaneSyncOpen(true);
    if (action === 'directionMatrix') navigateSection('directions');
    if (action === 'users') navigateSection('users');
    if (action === 'audit') navigateSection('auditLog');
    if (action === 'deployment') setDeploymentOpen(true);
    if (action === 'integration') setOneCOpen(true);
    if (action === 'help') navigateSection('help');
  };

  const openProcess = (id: string, keepTrail = false) => {
    setAnalyticsOpen(false);
    setPortfolioAnalyticsOpen(false);
    setError('');
    setProcessId(id);
    setDraftView(catalog.find(item => item.id === id)?.status === 'Draft');
    setArchivedVersion(undefined);
    setEditorOpen(false);
    setSelected(undefined);
    setFocusCommand(undefined);
    setEnterpriseOpen(false);
    if (!keepTrail) setProcessTrail([]);
  };

  const openInformationOccurrence = (occurrence: InformationObjectOccurrence) => {
    openProcess(occurrence.processId);
    if (occurrence.elementId) setPendingSearchResult({ kind: 'element', label: occurrence.elementName ?? occurrence.processName, processId: occurrence.processId, processName: occurrence.processName, elementId: occurrence.elementId, elementName: occurrence.elementName, score: 1 });
  };

  const openLinkedProcess = (id: string) => {
    if (!process || id === process.id) return;
    setProcessTrail(items => [...items, { id: process.id, name: process.name }]);
    openProcess(id, true);
  };

  const returnToParentProcess = () => {
    const previous = processTrail.at(-1);
    if (!previous) return;
    setProcessTrail(items => items.slice(0, -1));
    openProcess(previous.id, true);
  };

  const returnToTrailProcess = (index: number) => {
    const target = processTrail[index];
    if (!target) return;
    setProcessTrail(items => items.slice(0, index));
    openProcess(target.id, true);
  };

  const processDeleted = async (deletedId: string) => {
    const items = await loadProcessCatalog();
    setCatalog(items);
    setOrganizationReloadKey(value => value + 1);
    if (processId === deletedId) {
      const next = items[0];
      if (next) {
        setProcessId(next.id);
        setDraftView(next.status === 'Draft');
        setArchivedVersion(undefined);
        setEditorOpen(false);
        setSelected(undefined);
      }
    }
    notify('Процесс полностью удалён');
  };

  const imported = async (result: ProcessImportResult) => {
    setImportOpen(false);
    await refreshCatalog(result.process.id);
    if (draftView) setReloadKey(value => value + 1);
    notify(draftView ? 'BPMN черновика обновлена' : `Импортирован процесс «${result.process.name}»`);
  };

  const beginRevision = async () => {
    setRevisionBusy(true);
    try { await createDraft(processId); await refreshCatalog(processId); setArchivedVersion(undefined); setDraftView(true); notify('Создана новая редакция процесса'); }
    catch (reason) { notify(reason instanceof Error ? reason.message : 'Не удалось создать редакцию'); }
    finally { setRevisionBusy(false); }
  };

  const publishRevision = () => { if (process?.status !== 'Approved') { setLifecycleOpen(true); notify('Сначала отправьте редакцию на согласование и получите одобрение.'); return; } setPublicationValidationOpen(true); };

  const performPublication = async () => {
    if (!process) return;
    const version = process.version;
    setRevisionBusy(true);
    try { await publishDraft(processId); setPublicationValidationOpen(false); setDraftView(false); await refreshCatalog(processId); setReloadKey(value => value + 1); notify(`Версия ${version} опубликована`); }
    catch (reason) { notify(reason instanceof Error ? reason.message : 'Не удалось опубликовать редакцию'); }
    finally { setRevisionBusy(false); }
  };

  const changeStepStatus = async (status: 'InProgress' | 'Completed') => {
    if (!activeInstance || !selected) return;
    try { const updated = await updateStep(processId, activeInstance.id, selected.id, status); const skipped = updated.steps.filter(step => step.status === 'Skipped' && activeInstance.steps.find(previous => previous.elementId === step.elementId)?.status !== 'Skipped').length; setActiveInstance(updated); notify(status === 'InProgress' ? skipped ? `Шаг начат · альтернативных шагов пропущено: ${skipped}` : 'Шаг начат' : updated.status === 'Completed' ? 'Шаг завершён · процесс выполнен' : 'Шаг завершён'); }
    catch (reason) { notify(reason instanceof Error ? reason.message : 'Не удалось изменить состояние шага'); }
  };

  const returnExecutionStep = async (targetElementId: string, reason: string) => {
    if (!activeInstance || !selected) return;
    try {
      const updated = await returnStep(processId, activeInstance.id, selected.id, targetElementId, reason);
      const target = process?.nodes.find(node => node.id === targetElementId);
      setActiveInstance(updated);
      if (target) setSelected(target);
      notify(`Маршрут возвращён на этап «${target?.name ?? targetElementId}»`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Не удалось вернуть процесс на доработку';
      notify(message);
      throw cause;
    }
  };

  const openLaneOrganizationEditor = async () => {
    if (editorOpen) {
      notify('Сначала сохраните изменения BPMN. После сохранения новые дорожки появятся в оргпривязках.');
      return;
    }
    try {
      const [organization, latestProcess] = await Promise.all([loadOrganization(), loadProcess(processId, undefined, draftView)]);
      setProcess(latestProcess);
      setLaneOrganizationEditor({ organization, process: latestProcess });
    }
    catch (reason) { notify(reason instanceof Error ? reason.message : 'Не удалось загрузить организационную модель.'); }
  };

  const openProcessProperties = async () => {
    if (!draftView || archivedVersion || editorOpen || !can('process.context.edit')) return;
    try { setProcessPropertiesOrganization(await loadOrganization()); }
    catch (reason) { notify(reason instanceof Error ? reason.message : 'Не удалось загрузить организационную структуру.'); }
  };

  useEffect(() => {
    const owner = document.querySelector<HTMLElement>('.process-bar .owner');
    if (!owner || !draftView || archivedVersion || editorOpen || !can('process.context.edit')) return;
    owner.classList.add('owner--editable');
    owner.setAttribute('role', 'button');
    owner.setAttribute('tabindex', '0');
    owner.setAttribute('title', 'Назначить подразделение-владельца');
    const click = () => void openProcessProperties();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); click(); } };
    owner.addEventListener('click', click);
    owner.addEventListener('keydown', keydown);
    return () => { owner.removeEventListener('click', click); owner.removeEventListener('keydown', keydown); owner.classList.remove('owner--editable'); };
  }, [draftView, archivedVersion, editorOpen, process?.owner]);

  useEffect(() => {
    const openLinked = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!id || !catalog.some(item => item.id === id)) { notify('Связанный процесс больше не найден в каталоге'); return; }
      openLinkedProcess(id);
    };
    window.addEventListener('pn:open-linked-process', openLinked);
    return () => window.removeEventListener('pn:open-linked-process', openLinked);
  }, [process?.id, process?.name, catalog]);

  const executionGuidance = process ? buildExecutionGuidance(process, activeInstance) : { steps: {}, availableStepIds: [] };
  const nextExecutionSteps = process?.nodes.filter(node => executionGuidance.availableStepIds.includes(node.id)) ?? [];
  const returnStepOptions = process && selected ? buildReturnStepOptions(process, activeInstance, selected.id) : [];

  if (error) return <main className="state-page"><h1>Не удалось открыть Process Navigator</h1><p>{error}</p>{session && <label>Профиль пользователя <select value={session.currentUser.id} onChange={event => void changeUser(event.target.value)}>{session.availableUsers.map(user => <option key={user.id} value={user.id}>{user.roleName} — {user.displayName}</option>)}</select></label>}<button onClick={() => { setError(''); setEnterpriseOpen(true); setEditorOpen(false); setDraftView(false); setArchivedVersion(undefined); }}>На главную</button><button onClick={() => location.reload()}>Повторить</button></main>;
  if (!session || (!enterpriseOpen && !process)) return <main className="state-page"><div className="loader"/><p>{catalog.length ? 'Загружаем рабочее пространство…' : 'Загружаем каталог процессов…'}</p></main>;

  return <div className="app-shell">
    <header className="workspace-header"><button className="brand app-home-button" onClick={() => navigateSection('home')} aria-label="Главная"><span className="brand-mark">PN</span><span>Process Navigator</span></button>
      <nav aria-label="Основные разделы"><button className={enterpriseOpen && homeSection === 'home' && !portfolioAnalyticsOpen ? 'is-active' : ''} onClick={() => navigateSection('home')}>Главная</button><button className={(!enterpriseOpen || homeSection === 'map') && !portfolioAnalyticsOpen ? 'is-active' : ''} onClick={() => navigateSection('map')}>Бизнес-процессы</button>{can('analytics.view') && <button className={portfolioAnalyticsOpen ? 'is-active' : ''} onClick={() => navigateSection('analytics')}>Аналитика</button>}<button className={enterpriseOpen && ['settings', 'version', 'organization', 'users', 'directions', 'auditLog', 'importHistory'].includes(homeSection) && !portfolioAnalyticsOpen ? 'is-active' : ''} onClick={() => navigateSection('settings')}>Настройки</button></nav>
      <button className="header-action notification-button" onClick={() => setNotificationsOpen(true)} aria-label="Уведомления" title="Уведомления"><Bell size={17}/>{unreadNotifications > 0 && <span>{unreadNotifications}</span>}</button><UserMenu session={session} onChange={changeUser}/><button className="search" onClick={() => setSearchOpen(true)} aria-label="Поиск" title="Поиск"><Search size={17}/></button>
    </header>
    <SectionLoadBoundary key={`${sectionVisit}:${homeSection}:${enterpriseOpen}:${portfolioAnalyticsOpen}`} onHome={() => navigateSection('home')}>
    <Suspense fallback={<main className="state-page" role="status"><div className="loader"/><p>Загружаем раздел…</p></main>}>
    {!enterpriseOpen && !analyticsOpen && process && instructionOpen && <ProcessInstructionPage process={process} edition={archivedVersion ? 'Архивная версия' : draftView ? 'Черновик' : 'Действующая версия'} onBack={() => setInstructionOpen(false)} onSelect={node => {
      setInstructionOpen(false); setSelected(node); setFocusCommand(current => ({ id: (current?.id ?? 0) + 1, elementId: node.id }));
    }}/>}
    {!enterpriseOpen && !analyticsOpen && process && responsibilityOpen && <ProcessResponsibilityPage process={process} assignments={assignments} edition={archivedVersion ? 'Архивная версия' : draftView ? 'Черновик' : 'Действующая версия'} onBack={() => setResponsibilityOpen(false)} onSelect={node => {
      setResponsibilityOpen(false); setPersonalMode(false); setSelected(node); setFocusCommand(current => ({ id: (current?.id ?? 0) + 1, elementId: node.id }));
    }}/>}
    {!enterpriseOpen && !analyticsOpen && process && !instructionOpen && !responsibilityOpen && <>
    {processTrail.length > 0 && <nav className="process-trail" aria-label="Путь детализации"><button className="process-back" onClick={returnToParentProcess} title={`Вернуться: ${processTrail.at(-1)?.name}`}><ChevronLeft size={18}/><span>Назад</span></button><div>{processTrail.map((item, index) => <span key={`${item.id}:${index}`}><button onClick={() => returnToTrailProcess(index)}>{item.name}</button><i>›</i></span>)}<strong>{process.name}</strong></div></nav>}
    <div className="process-bar"><div><span className={`eyebrow ${draftView ? 'is-draft' : archivedVersion ? 'is-archive' : ''}`}>{archivedVersion ? 'Архивная версия' : draftView ? 'Черновик' : 'Действующая версия'} {process.version}</span><h1>{process.name}</h1></div><div className="revision-actions"><button className="revision-button" disabled={editorOpen} onClick={() => { setResponsibilityOpen(false); setInstructionOpen(true); }}><ClipboardList size={15}/>Инструкция</button><button className="revision-button" onClick={() => setVersionsOpen(true)}><History size={15}/>История</button>{!draftView && !archivedVersion && <button className={`revision-button${activeInstance ? ' is-primary' : ''}`} onClick={() => setExecutionsOpen(true)}><Activity size={15}/>{activeInstance ? activeInstance.name : 'Выполнения'}</button>}{can('analytics.view') && !draftView && !archivedVersion && <button className="revision-button" onClick={() => setAnalyticsOpen(true)}><BarChart3 size={15}/>Аналитика</button>}{assignments && <button className={`revision-button${personalMode ? ' is-primary' : ''}`} disabled={!personalLaneIds.length} title={personalLaneIds.length ? 'Подсветить мои дорожки и задачи' : 'Текущий пользователь не назначен на дорожки процесса'} onClick={() => { setPersonalMode(value => !value); setSelected(undefined); }}><BriefcaseBusiness size={15}/>Мои шаги ({personalLaneIds.length})</button>}<button className="revision-button" disabled={editorOpen} onClick={() => { setInstructionOpen(false); setResponsibilityOpen(true); }}><ClipboardList size={15}/>Ответственность</button>{can('process.assignments.manage') && !archivedVersion && <button className="revision-button" onClick={() => setAssignmentsOpen(true)}><UserCog size={15}/>Ответственные</button>}{can('system.manage') && !archivedVersion && <button className="revision-button" onClick={openLaneOrganizationEditor}><Network size={15}/>Оргпривязки</button>}{archivedVersion ? <button className="revision-button is-primary" onClick={() => setArchivedVersion(undefined)}><RotateCcw size={15}/>К действующей</button> : draftView ? <>{can('process.diagram.edit') && <><button className="revision-button" onClick={() => setEditorOpen(true)}><PencilRuler size={15}/>Редактировать</button><button className="revision-button" onClick={() => setImportOpen(true)} disabled={revisionBusy}><Upload size={15}/>Заменить BPMN</button></>}{can('process.publish') && <button className="revision-button is-primary" onClick={publishRevision} disabled={revisionBusy}><Rocket size={15}/>Опубликовать</button>}</> : catalog.find(item => item.id === processId)?.hasDraft ? (can('process.diagram.edit') || can('process.context.edit') || can('process.publish')) && <button className="revision-button" onClick={() => setDraftView(true)}><FilePenLine size={15}/>Открыть черновик</button> : can('process.draft.create') && <button className="revision-button" onClick={beginRevision} disabled={revisionBusy}><FilePenLine size={15}/>Новая редакция</button>}</div><div className="owner">Владелец процесса<strong>{process.owner}</strong></div><div className="view-controls"><button aria-label="Уменьшить" onClick={() => setZoomCommand(command => ({ id: command.id + 1, factor: 1 / 1.25 }))}><Minus size={18}/></button><button aria-label="Показать весь процесс" onClick={() => { setFitCommand(command => command + 1); setSelected(undefined); }}><Maximize2 size={18}/><span>Весь процесс</span></button><button aria-label="Увеличить" onClick={() => setZoomCommand(command => ({ id: command.id + 1, factor: 1.25 }))}><Plus size={18}/></button></div></div>
    {editorOpen ? <main className="workspace workspace--editor"><Suspense fallback={<div className="editor-loading"><div className="loader"/>Запускаем локальный BPMN-редактор…</div>}><BpmnEditor processId={processId} processName={process.name} onClose={() => setEditorOpen(false)} onSaved={(closeEditor = true) => { if (closeEditor) setEditorOpen(false); setReloadKey(value => value + 1); notify(closeEditor ? 'BPMN черновика сохранена' : 'BPMN сохранена и проверена'); }}/></Suspense></main> : <main className="workspace"><ProcessCanvas key={`${process.id}:${process.version}:${draftView ? 'draft' : archivedVersion ?? 'published'}`} process={process} selectedId={selected?.id} onSelect={setSelected} zoomCommand={zoomCommand} fitCommand={fitCommand} focusCommand={focusCommand} personalMode={personalMode} personalLaneIds={personalLaneIds} stepStatuses={Object.fromEntries(activeInstance?.steps.map(step => [step.elementId, step.status]) ?? [])} availableStepIds={executionGuidance.availableStepIds}/><ContextPanel processId={processId} node={selected} onClose={() => setSelected(undefined)} onAction={notify} onUpdated={updated => { setSelected(updated); setProcess(current => current ? { ...current, nodes: current.nodes.map(node => node.id === updated.id ? updated : node) } : current); notify('Контекст элемента сохранён'); }} canExecute={can('process.execute') && !archivedVersion} canEdit={draftView && can('process.context.edit')} assignableUsers={selected ? assignments?.lanes.find(lane => lane.laneId === selected.laneId)?.userIds.map(id => assignments.users.find(user => user.id === id)).filter((user): user is NonNullable<typeof user> => !!user) : []} activeInstance={activeInstance} onInstanceUpdated={setActiveInstance} onStepStatus={changeStepStatus} stepReadiness={selected ? executionGuidance.steps[selected.id] : undefined} nextSteps={nextExecutionSteps.filter(node => node.id !== selected?.id)} onOpenStep={setSelected} returnOptions={returnStepOptions} onReturnStep={returnExecutionStep} onOpenOccurrence={openInformationOccurrence}/></main>}
    {draftView && !editorOpen && <button className="lifecycle-fab" onClick={() => setLifecycleOpen(true)}><GitPullRequest size={15}/>Согласование · {process.status === 'InReview' ? 'на рассмотрении' : process.status === 'Approved' ? 'одобрено' : process.status === 'ChangesRequested' ? 'на доработке' : 'черновик'}</button>}
    <footer><span>{editorOpen ? 'BPMN 2.0 · редактирование черновика' : 'BPMN 2.0 · только просмотр'}</span><span>{process.nodes.length} элементов · {process.lanes.length} роли</span><span>Canvas занимает {selected ? '76%' : '100%'} рабочего пространства</span></footer>
    </>}
    {message && <div className="toast">{message}</div>}
    {createProcessOpen && <CreateProcessDialog
      onClose={() => setCreateProcessOpen(false)}
      onCreated={async result => { setCreateProcessOpen(false); setPortfolioAnalyticsOpen(false); await refreshCatalog(result.process.id); setProcessId(result.process.id); setEnterpriseOpen(false); setArchivedVersion(undefined); setDraftView(true); setSelected(undefined); setEditorOpen(true); notify(`Создан черновик «${result.process.name}»`); }}/>
    }
    {importOpen && (
      <ImportDialog onClose={() => setImportOpen(false)} onImported={imported} processId={draftView ? processId : undefined}
        initialExportProcessId={processId} catalog={catalog}
        onPackageImported={async result => { setImportOpen(false); setCatalog(await loadProcessCatalog()); navigateSection('catalog'); notify(`Импортировано процессов: ${result.imported}`); }}
        onTableImported={async result => { setImportOpen(false); setCatalog(await loadProcessCatalog()); navigateSection('catalog'); notify(`Черновики из таблицы: создано ${result.created}, обновлено ${result.updated}`); }}/>
    )}
    {versionsOpen && process && (
      <VersionDialog processId={processId} processName={process.name} onClose={() => setVersionsOpen(false)} onOpen={version => { setVersionsOpen(false); setSelected(undefined); if (version.status === 'Archived') { setDraftView(false); setArchivedVersion(version.version); } else { setArchivedVersion(undefined); setDraftView(version.status === 'Draft'); } }}/>
    )}
    {draftLaneSyncOpen && <DraftLaneSyncDialog onClose={() => setDraftLaneSyncOpen(false)} onSynced={() => { setReloadKey(value => value + 1); void refreshCatalog(); }}/>}
    {assignmentsOpen && assignments && <AssignmentDialog assignments={assignments}
      onClose={() => setAssignmentsOpen(false)}
      onSaved={updated => { setAssignments(updated); setAssignmentsOpen(false); notify('Ответственные по дорожкам сохранены'); }}
    />}
    {executionsOpen && <ExecutionDialog processId={processId} canStart={can('process.execute')}
      onClose={() => setExecutionsOpen(false)}
      onOpen={instance => { setActiveInstance(instance); setExecutionsOpen(false); setSelected(undefined); notify(`Открыто выполнение «${instance.name}»`); }}
      onChanged={instance => { if (activeInstance?.id === instance.id) setActiveInstance(instance); notify(instance.status === 'Paused' ? 'Выполнение приостановлено' : instance.status === 'Cancelled' ? 'Выполнение отменено, история сохранена' : 'Выполнение возобновлено'); }}
    />}
    {analyticsOpen && process && <AnalyticsDialog processId={processId} processName={process.name}
      onClose={() => setAnalyticsOpen(false)}
      onSelectStep={elementId => { setAnalyticsOpen(false); setPersonalMode(false); setSelected(process.nodes.find(node => node.id === elementId)); }}
    />}
    {portfolioAnalyticsOpen && <PortfolioAnalyticsDialog
      onClose={() => navigateSection('home')}
      onOpenProcess={id => { setPortfolioAnalyticsOpen(false); openProcess(id); }}/>
    }
    {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} onOpen={result => {
      setSearchOpen(false); setPortfolioAnalyticsOpen(false); setEnterpriseOpen(false); setDraftView(false); setArchivedVersion(undefined); setEditorOpen(false); setPendingSearchResult(result);
      if (result.processId !== processId) setProcessId(result.processId);
      else { setPersonalMode(false); setSelected(result.elementId ? process?.nodes.find(node => node.id === result.elementId) : undefined); setPendingSearchResult(undefined); }
    }}
    />}
    {notificationsOpen && <NotificationDialog notifications={notifications} onClose={() => setNotificationsOpen(false)} onReadAll={async () => { await markAllNotificationsRead(); setNotifications(items => items.map(item => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }))); }} onOpen={async notification => {
      if (!notification.readAt) { const updated = await markNotificationRead(notification.id); setNotifications(items => items.map(item => item.id === updated.id ? updated : item)); }
      setNotificationsOpen(false); setPortfolioAnalyticsOpen(false); setEnterpriseOpen(false); setDraftView(false); setArchivedVersion(undefined); setEditorOpen(false);
      setPendingSearchResult({ kind: 'element', label: notification.elementName ?? notification.processName, processId: notification.processId, processName: notification.processName, elementId: notification.elementId, elementName: notification.elementName, score: 1 });
      if (notification.processId !== processId) setProcessId(notification.processId);
      else { setPersonalMode(false); setSelected(notification.elementId ? process?.nodes.find(node => node.id === notification.elementId) : undefined); setPendingSearchResult(undefined); }
    }}
    />}
    {oneCOpen && <OneCIntegrationDialog onClose={() => setOneCOpen(false)}/>}
    {deploymentOpen && <DeploymentDialog onClose={() => setDeploymentOpen(false)}/>}
    {enterpriseOpen && !portfolioAnalyticsOpen && (homeSection === 'home' || homeSection === 'settings') && <WorkspaceHome settings={homeSection === 'settings'} groupName={organizationIdentity?.name ?? 'Группа компаний'} catalog={catalog} can={can} onAction={homeAction}><PersonalProcesses key={session.currentUser.id} catalog={catalog} preferences={personalWorkspace.data} storageFailed={personalWorkspace.storageFailed} canOpenDraft={can('process.diagram.edit') || can('process.context.edit') || can('process.publish')} onOpen={openProcess} onFavorite={personalWorkspace.favorite} onFilter={personalWorkspace.filter} onClearRecent={personalWorkspace.clearRecent}/></WorkspaceHome>}
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'version' && <AppVersionPage onBack={() => navigateSection('settings')} onRoadmap={() => navigateSection('roadmap')}/>}
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'roadmap' && <DevelopmentRoadmapPage onBack={() => navigateSection('version')}/>}
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'importHistory' && <ProcessTableImportHistoryPage canManage={can('system.manage')} onBack={() => navigateSection('settings')}/>}
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'import' && <ImportDialog page catalog={catalog} initialExportProcessId={processId} onClose={() => navigateSection('home')}
      onImported={async result => { await refreshCatalog(result.process.id); openProcess(result.process.id); setDraftView(true); notify(`Импортирован процесс «${result.process.name}»`); }}
      onPackageImported={async result => { setCatalog(await loadProcessCatalog()); navigateSection('home'); notify(`Импортировано процессов: ${result.imported}`); }}
      onTableImported={async result => { setCatalog(await loadProcessCatalog()); navigateSection('home'); notify(`Черновики из таблицы: создано ${result.created}, обновлено ${result.updated}`); }}/>
    }
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'help' && <Suspense fallback={<div className="page-loading"><div className="loader"/>Открываем руководство…</div>}><HelpDialog page user={session.currentUser} onClose={() => navigateSection('home')}/></Suspense>}
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'catalog' && <ProcessCatalogDialog page
      catalog={catalog}
      favorites={personalWorkspace.data.favorites}
      onFavorite={personalWorkspace.favorite}
      canDelete={can('system.manage')}
      onClose={() => navigateSection('home')}
      onOpen={openProcess}
      onAudit={can('process.diagram.edit') || can('process.context.edit') || can('process.publish') ? () => { setAuditReturnSection('catalog'); navigateSection('catalogAudit'); } : undefined}
      onDeleted={processDeleted}/>
    }
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'catalogAudit' && <CatalogAuditDialog page backLabel={auditReturnSection === 'catalog' ? 'Каталог процессов' : 'Рабочее пространство'}
      canCreateDraft={can('process.draft.create')}
      onClose={() => navigateSection(auditReturnSection)}
      onOpen={(item, issue) => {
        openProcess(item.processId);
        setProcess(undefined);
        setDraftView(item.edition === 'Draft');
        setReloadKey(value => value + 1);
        setPendingAuditTarget(issue?.elementId ? { processId: item.processId, elementId: issue.elementId } : undefined);
      }}
      onFix={async (item, issue) => {
        if (item.edition !== 'Draft' && !item.hasDraft) await createDraft(item.processId);
        await refreshCatalog(item.processId);
        openProcess(item.processId);
        setProcess(undefined);
        setArchivedVersion(undefined);
        setDraftView(true);
        setReloadKey(value => value + 1);
        setPendingAuditTarget(issue?.elementId ? { processId: item.processId, elementId: issue.elementId } : undefined);
        notify(item.edition !== 'Draft' && !item.hasDraft ? 'Создан черновик для исправления' : 'Открыт черновик для исправления');
      }}/>
    }
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'informationObjects' && <InformationObjectRegistryPage canManage={can('process.context.edit')} onBack={() => navigateSection('home')} onOpen={openInformationOccurrence}/>}
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'evidenceRegister' && <EvidenceRegisterPage catalog={catalog} onBack={() => navigateSection('home')} onOpen={entry => {
      openProcess(entry.processId);
      setProcess(undefined);
      setDraftView(entry.edition === 'Draft');
      setReloadKey(value => value + 1);
      setPendingAuditTarget(entry.elementId ? { processId: entry.processId, elementId: entry.elementId } : undefined);
    }}/>}
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'schedule' && <ProcessSchedulePage key={session.currentUser.id} userId={session.currentUser.id} canAssign={can('process.execute')} catalog={catalog} onBack={() => navigateSection('home')} onOpen={openProcess}/>}
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'organization' && (organizationEditor ? <OrganizationAdminDialog page
      organization={organizationEditor}
      catalog={catalog}
      onClose={() => navigateSection('settings')}
      onSaved={updated => { setOrganizationEditor(updated); setOrganizationIdentity(updated); setOrganizationReloadKey(value => value + 1); notify('Организационная структура сохранена'); }}/>
      : <main className="feature-page"><div className="feature-page-shell"><div className="editor-loading"><div className="loader"/>Загружаем организационную структуру…</div></div></main>)}
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'users' && <UserAdminDialog
      page currentUserId={session.currentUser.id}
      onClose={() => navigateSection('settings')}
      onChanged={async () => setSession(await loadSession())}/>
    }
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'directions' && <ProcessDirectionMatrixDialog
      page catalog={catalog}
      onClose={() => navigateSection('settings')}
      onSaved={updated => { setOrganizationIdentity(updated); setOrganizationReloadKey(value => value + 1); notify('Направления процессов сохранены'); }}/>
    }
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'auditLog' && <AuditLogDialog page onClose={() => navigateSection('settings')}/>}
    {enterpriseOpen && !portfolioAnalyticsOpen && homeSection === 'map' && (
      <EnterpriseMap
        key={organizationReloadKey}
        catalog={catalog}
        onOpenProcess={openProcess}
        onOpenCatalog={() => navigateSection('catalog')}
        onCreate={can('process.import') ? () => setCreateProcessOpen(true) : undefined}
        onImport={can('process.import') ? () => { setDraftView(false); navigateSection('import'); } : undefined}
        canManage={can('system.manage')}
        onManage={organization => { setOrganizationEditor(organization); navigateSection('organization'); }}
      />
    )}
    {laneOrganizationEditor && <LaneOrganizationDialog
      organization={laneOrganizationEditor.organization}
      process={laneOrganizationEditor.process}
      updateDraftLaneNames={draftView}
      onClose={() => setLaneOrganizationEditor(undefined)}
      onSaved={() => { setLaneOrganizationEditor(undefined); setReloadKey(value => value + 1); notify('Организационные привязки дорожек сохранены'); }}
    />}
    {processPropertiesOrganization && process && <ProcessPropertiesDialog
      process={process}
      organization={processPropertiesOrganization}
      catalog={catalog}
      onClose={() => setProcessPropertiesOrganization(undefined)}
      onSaved={updated => { setProcess(updated); setProcessPropertiesOrganization(undefined); setReloadKey(value => value + 1); notify('Подразделение-владелец процесса сохранено'); }}
    />}
    {publicationValidationOpen && process && <PublicationValidationDialog
      processId={processId}
      version={process.version}
      busy={revisionBusy}
      onClose={() => setPublicationValidationOpen(false)}
      onPublish={performPublication}
      onSelectElement={elementId => { setPublicationValidationOpen(false); setPersonalMode(false); setSelected(process.nodes.find(node => node.id === elementId) ?? process.nodes.find(node => node.laneId === elementId)); }}
    />}
    {lifecycleOpen && <LifecycleDialog
      processId={processId}
      currentUserId={session.currentUser.id}
      users={session.availableUsers}
      canEdit={can('process.diagram.edit') || can('process.context.edit')}
      canApprove={can('process.publish')}
      onClose={() => setLifecycleOpen(false)}
      onChanged={async () => { setProcess(await loadProcess(processId, undefined, true)); await refreshCatalog(processId); setReloadKey(value => value + 1); }}/>
    }
    </Suspense>
    </SectionLoadBoundary>
  </div>;
}
