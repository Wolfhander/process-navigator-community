import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, CloudCog, Maximize2, Redo2, Save, ScanSearch, Shapes, Sparkles, Undo2, X, XCircle } from 'lucide-react';
import Modeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import { acquireEditLock, loadDraftBpmn, releaseEditLock, renewEditLock, saveDraftBpmn, validateDraft } from './api';
import type { ProcessValidationReport } from './types';
import { planHorizontalColumns } from './bpmnLayout';
import './bpmn-layout-options.css';

type EditorService = { zoom?: (value: string) => void; undo?: () => void; redo?: () => void };
type DiagramElement = { id: string; type?: string; x?: number; y?: number; width?: number; height?: number; parent?: DiagramElement; source?: DiagramElement; target?: DiagramElement; businessObject?: { name?: string }; waypoints?: unknown[] };
type Recovery = { savedAt: string; xml: string };

export function BpmnEditor({ processId, processName, onClose, onSaved }: { processId: string; processName: string; onClose: () => void; onSaved: (closeEditor?: boolean) => void }) {
  const container = useRef<HTMLDivElement>(null); const modeler = useRef<Modeler | null>(null); const lockToken = useRef(''); const ready = useRef(false); const recoveryTimer = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [dirty, setDirty] = useState(false); const [recovered, setRecovered] = useState(false); const [error, setError] = useState(''); const [report, setReport] = useState<ProcessValidationReport>(); const [templatesOpen, setTemplatesOpen] = useState(false); const [layoutOpen, setLayoutOpen] = useState(false);
  const recoveryKey = `pn.bpmn-recovery.${processId}`;

  const refreshEditLock = async () => {
    try {
      const editLock = lockToken.current ? await renewEditLock(processId, lockToken.current) : await acquireEditLock(processId);
      lockToken.current = editLock.token; ready.current = true; setError(''); return editLock.token;
    } catch {
      const editLock = await acquireEditLock(processId);
      lockToken.current = editLock.token; ready.current = true; setError(''); return editLock.token;
    }
  };

  useEffect(() => {
    if (!container.current) return;
    const instance = new Modeler({ container: container.current }); let active = true; let heartbeat: number | undefined; modeler.current = instance;
    const maintainLock = () => refreshEditLock().catch(reason => { if (!active) return; setError(reason instanceof Error ? reason.message : 'Не удалось восстановить блокировку редактирования.'); ready.current = false; });
    const persistRecovery = () => {
      if (!ready.current) return; setDirty(true); window.clearTimeout(recoveryTimer.current);
      recoveryTimer.current = window.setTimeout(async () => { try { const { xml } = await instance.saveXML({ format: true }); if (xml) localStorage.setItem(recoveryKey, JSON.stringify({ savedAt: new Date().toISOString(), xml } satisfies Recovery)); } catch { /* the editor remains usable */ } }, 1200);
    };
    (instance as unknown as { on: (event: string, handler: () => void) => void }).on('commandStack.changed', persistRecovery);
    Promise.all([acquireEditLock(processId), loadDraftBpmn(processId)]).then(async ([editLock, serverXml]) => {
      if (!active) { await releaseEditLock(processId, editLock.token); return; }
      lockToken.current = editLock.token; let xml = serverXml;
      const stored = localStorage.getItem(recoveryKey);
      if (stored) try { const recovery = JSON.parse(stored) as Recovery; if (recovery.xml && window.confirm(`Найдены несохранённые изменения от ${new Date(recovery.savedAt).toLocaleString('ru-RU')}. Восстановить их?`)) { xml = recovery.xml; setRecovered(true); } else localStorage.removeItem(recoveryKey); } catch { localStorage.removeItem(recoveryKey); }
      await instance.importXML(xml); if (!active) return; (instance.get('canvas') as EditorService).zoom?.('fit-viewport'); ready.current = true; setDirty(xml !== serverXml);
      heartbeat = window.setInterval(maintainLock, 20000);
      window.addEventListener('focus', maintainLock); document.addEventListener('visibilitychange', maintainLock);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось открыть редактор.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; ready.current = false; window.clearTimeout(recoveryTimer.current); if (heartbeat) window.clearInterval(heartbeat); window.removeEventListener('focus', maintainLock); document.removeEventListener('visibilitychange', maintainLock); if (lockToken.current) void releaseEditLock(processId, lockToken.current); instance.destroy(); if (modeler.current === instance) modeler.current = null; };
  }, [processId]);

  const close = () => { if (!dirty || window.confirm('Закрыть редактор без сохранения? Несохранённая схема останется доступна для восстановления.')) onClose(); };
  const command = (name: 'undo' | 'redo') => (modeler.current?.get('commandStack') as EditorService | undefined)?.[name]?.();
  const fit = () => (modeler.current?.get('canvas') as EditorService | undefined)?.zoom?.('fit-viewport');
  const format = (scope: 'all' | 'selection') => {
    if (!modeler.current || !ready.current) return;
    const registry = modeler.current.get('elementRegistry') as { filter: (predicate: (element: DiagramElement) => boolean) => DiagramElement[] };
    const selection = modeler.current.get('selection') as { get: () => DiagramElement[] };
    const modeling = modeler.current.get('modeling') as { resizeShape: (element: DiagramElement, bounds: { x: number; y: number; width: number; height: number }) => void; moveShape: (element: DiagramElement, delta: { x: number; y: number }) => void; layoutConnection: (element: DiagramElement, hints?: object) => void };
    const selectedIds = new Set(selection.get().map(element => element.id));
    if (scope === 'selection' && selectedIds.size === 0) { setError('Выберите элементы процесса для выборочного упорядочивания.'); setLayoutOpen(false); return; }
    const flowNodes = registry.filter(element => !!element.type && (element.type.endsWith('Task') || element.type.endsWith('Event') || element.type.endsWith('Gateway') || element.type === 'bpmn:SubProcess' || element.type === 'bpmn:CallActivity') && (scope === 'all' || selectedIds.has(element.id)));
    if (flowNodes.length === 0) { setError('В выделении нет задач, событий или шлюзов для упорядочивания.'); setLayoutOpen(false); return; }
    flowNodes.filter(element => element.type?.endsWith('Task') || element.type === 'bpmn:SubProcess' || element.type === 'bpmn:CallActivity').forEach(element => {
      const length = element.businessObject?.name?.trim().length ?? 0;
      const width = Math.max(120, Math.min(280, 110 + Math.ceil(length / 18) * 22));
      const height = Math.max(80, Math.min(150, 70 + Math.ceil(length / 34) * 18));
      modeling.resizeShape(element, { x: (element.x ?? 0) - (width - (element.width ?? width)) / 2, y: (element.y ?? 0) - (height - (element.height ?? height)) / 2, width, height });
    });
    const targets = planHorizontalColumns(flowNodes.map(element => ({ id: element.id, x: element.x ?? 0, width: element.width ?? 100 })));
    flowNodes.forEach(element => { const targetX = targets.get(element.id); if (targetX !== undefined && targetX !== element.x) modeling.moveShape(element, { x: targetX - (element.x ?? 0), y: 0 }); });
    registry.filter(element => element.type === 'bpmn:SequenceFlow' && (scope === 'all' || selectedIds.has(element.source?.id ?? '') || selectedIds.has(element.target?.id ?? ''))).forEach(element => modeling.layoutConnection(element, {}));
    setLayoutOpen(false); setError('');
    if (scope === 'all') window.setTimeout(fit, 50);
  };
  const insertTemplate = (kind: 'linear' | 'approval') => {
    if (!modeler.current) return;
    const registry = modeler.current.get('elementRegistry') as { filter: (predicate: (element: DiagramElement) => boolean) => DiagramElement[] };
    const selection = modeler.current.get('selection') as { get: () => DiagramElement[]; select: (element: DiagramElement) => void };
    const elementFactory = modeler.current.get('elementFactory') as { createShape: (attributes: { type: string }) => DiagramElement };
    const modeling = modeler.current.get('modeling') as { createShape: (shape: DiagramElement, position: { x: number; y: number }, parent: DiagramElement) => DiagramElement; connect: (source: DiagramElement, target: DiagramElement, attributes: { type: string }) => DiagramElement; updateProperties: (element: DiagramElement, properties: { name: string }) => void };
    const selected = selection.get()[0]; const lanes = registry.filter(element => element.type === 'bpmn:Lane'); const lane = selected?.type === 'bpmn:Lane' ? selected : selected?.parent?.type === 'bpmn:Lane' ? selected.parent : lanes[0];
    if (!lane) { setError('Сначала добавьте дорожку BPMN или выберите существующую дорожку.'); return; }
    const create = (type: string, name: string, x: number, y: number) => { const shape = elementFactory.createShape({ type }); const created = modeling.createShape(shape, { x, y }, lane); modeling.updateProperties(created, { name }); return created; };
    const connect = (source: DiagramElement, target: DiagramElement, name?: string) => { const edge = modeling.connect(source, target, { type: 'bpmn:SequenceFlow' }); if (name) modeling.updateProperties(edge, { name }); return edge; };
    const startX = Math.max((lane.x ?? 0) + 190, (selected?.x ?? 0) + (selected?.width ?? 0) + 150); const centerY = (lane.y ?? 0) + Math.max(75, (lane.height ?? 150) / 2);
    if (kind === 'linear') {
      const first = create('bpmn:Task', 'Первое действие', startX, centerY); const second = create('bpmn:Task', 'Следующее действие', startX + 190, centerY); const third = create('bpmn:Task', 'Зафиксировать результат', startX + 380, centerY); connect(first, second); connect(second, third); selection.select(first);
    } else {
      const prepare = create('bpmn:Task', 'Подготовить решение', startX, centerY); const gateway = create('bpmn:ExclusiveGateway', 'Решение согласовано?', startX + 180, centerY); const approved = create('bpmn:Task', 'Передать дальше', startX + 360, centerY - 45); const rework = create('bpmn:Task', 'Доработать', startX + 360, centerY + 65); connect(prepare, gateway); connect(gateway, approved, 'Да'); connect(gateway, rework, 'Нет'); connect(rework, prepare, 'После доработки'); selection.select(prepare);
    }
    setTemplatesOpen(false); setError(''); window.setTimeout(fit, 50);
  };
  const save = async (checkAfter = false, closeAfter = true) => {
    if (!modeler.current) return; setSaving(true); setError('');
    try { const token = await refreshEditLock(); const { xml } = await modeler.current.saveXML({ format: true }); if (!xml) throw new Error('Редактор не сформировал BPMN XML.'); await saveDraftBpmn(processId, xml, token); localStorage.removeItem(recoveryKey); setDirty(false); if (checkAfter) setReport(await validateDraft(processId)); onSaved(closeAfter); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить BPMN.'); } finally { setSaving(false); }
  };
  const focusIssue = (elementId?: string) => {
    if (!elementId || !modeler.current) return;
    const registry = modeler.current.get('elementRegistry') as { get: (id: string) => DiagramElement | undefined }; const element = registry.get(elementId); if (!element) return;
    (modeler.current.get('selection') as { select: (element: DiagramElement) => void }).select(element);
    (modeler.current.get('canvas') as { scrollToElement: (element: DiagramElement) => void }).scrollToElement(element);
  };

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 's') return;
      event.preventDefault(); if (!saving && !loading) void save(event.shiftKey, false);
    };
    window.addEventListener('keydown', shortcuts); return () => window.removeEventListener('keydown', shortcuts);
  }, [saving, loading, processId]);

  return <section className="bpmn-editor" aria-label={`Редактор BPMN: ${processName}`}>
    <div className="editor-toolbar"><div><span className="eyebrow">Редактор BPMN 2.0</span><strong>{processName}</strong>{dirty && <small>Есть несохранённые изменения</small>}</div><div className="editor-commands"><button onClick={() => command('undo')} title="Отменить"><Undo2 size={17}/></button><button onClick={() => command('redo')} title="Повторить"><Redo2 size={17}/></button><button onClick={fit} title="Показать всю схему"><Maximize2 size={17}/></button><button onClick={() => { setTemplatesOpen(value => !value); setLayoutOpen(false); }} title="Вставить типовой участок процесса"><Shapes size={17}/>Шаблоны</button><button onClick={() => { setLayoutOpen(value => !value); setTemplatesOpen(false); }} title="Выбрать область упорядочивания"><Sparkles size={17}/>Упорядочить</button><button onClick={() => save(true, false)} disabled={saving || loading} title="Сохранить и проверить полноту модели"><ScanSearch size={17}/>Проверить</button><button className="editor-cancel" onClick={close}><X size={17}/>Закрыть</button><button className="editor-save" onClick={() => save()} disabled={saving || loading} title="Сохранить и закрыть (Ctrl+S сохраняет без закрытия)"><Save size={17}/>{saving ? 'Сохраняем…' : 'Сохранить'}</button></div></div>
    {error && <div className="editor-error"><X size={17}/>{error}<button onClick={() => refreshEditLock().catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось восстановить блокировку.'))}>Подключиться снова</button></div>}{loading && <div className="editor-loading"><div className="loader"/>Получаем блокировку и загружаем модель…</div>}{!loading && !error && <div className="editor-ready">{recovered ? <CloudCog size={14}/> : <Check size={14}/>} {recovered ? 'Несохранённая схема восстановлена. Проверьте её и нажмите «Сохранить».' : 'Черновик заблокирован для других редакторов; локальное восстановление включено.'}</div>}
    <div className="bpmn-modeler" ref={container}/>
    {layoutOpen && <aside className="editor-layout-options"><header><strong>Упорядочить схему</strong><button onClick={() => setLayoutOpen(false)} aria-label="Закрыть варианты"><X size={16}/></button></header><button onClick={() => format('selection')}><strong>Только выделенные элементы</strong><small>Остальные блоки останутся на месте.</small></button><button onClick={() => format('all')}><strong>Вся схема</strong><small>Шаг колонок учитывает ширину блоков; дорожки остаются на своих местах.</small></button><p>Перед изменением можно сохранить черновик. При необходимости отменяйте изменения кнопкой «Отменить».</p></aside>}
    {templatesOpen && <aside className="editor-templates"><header><div><Shapes size={18}/><span><strong>Типовые фрагменты</strong><small>Выберите дорожку и вставьте готовый участок.</small></span></div><button onClick={() => setTemplatesOpen(false)} aria-label="Закрыть шаблоны"><X size={16}/></button></header><button onClick={() => insertTemplate('linear')}><strong>Последовательность из трёх действий</strong><small>Три задачи и две последовательные связи.</small></button><button onClick={() => insertTemplate('approval')}><strong>Согласование с возвратом</strong><small>Подготовка, шлюз «Да/Нет», передача дальше или доработка.</small></button><p>Названия, связи и расположение после вставки можно изменять обычными средствами редактора.</p></aside>}
    {report && <aside className="editor-validation"><header><div>{report.canPublish ? <CheckCircle2 size={20}/> : <AlertTriangle size={20}/>}<span><strong>{report.canPublish ? 'Схема готова к публикации' : 'Найдены замечания'}</strong><small>{report.errorCount} ошибок · {report.warningCount} рекомендаций</small></span></div><button onClick={() => setReport(undefined)} aria-label="Закрыть проверку"><X size={16}/></button></header><div>{report.issues.map((issue, index) => <button key={`${issue.code}:${issue.elementId ?? index}`} className={issue.severity === 'Error' ? 'is-error' : 'is-warning'} onClick={() => focusIssue(issue.elementId)} disabled={!issue.elementId}>{issue.severity === 'Error' ? <XCircle size={15}/> : <AlertTriangle size={15}/>}<span>{issue.message}{issue.elementName && <small>{issue.elementName}</small>}</span></button>)}{!report.issues.length && <p><Check size={16}/> Замечаний нет.</p>}</div></aside>}
  </section>;
}
