import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Paperclip, Save, Upload } from 'lucide-react';
import { artifactDownloadUrl, saveStepResult, uploadStepAttachment } from './api';
import type { InformationObjectBinding, ProcessInstance, ProcessNode } from './types';

const bytes = (value: number) => value < 1024 ? `${value} Б` : value < 1024 * 1024 ? `${Math.round(value / 1024)} КБ` : `${(value / 1024 / 1024).toFixed(1)} МБ`;

export function StepResultPanel({ processId, instance, node, canExecute, onUpdated, onMessage }: {
  processId: string;
  instance: ProcessInstance;
  node: ProcessNode;
  canExecute: boolean;
  onUpdated: (instance: ProcessInstance) => void;
  onMessage: (message: string) => void;
}) {
  const step = instance.steps.find(item => item.elementId === node.id);
  const outputs = useMemo(() => (node.informationObjects ?? []).filter(item => item.role === 'Output'), [node.informationObjects]);
  const [text, setText] = useState(step?.resultText ?? '');
  const [selected, setSelected] = useState<string[]>(step?.resultObjects?.map(item => item.objectId) ?? []);
  const [attachments, setAttachments] = useState(step?.attachments ?? []);
  const [recordedAt, setRecordedAt] = useState(step?.resultRecordedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setText(step?.resultText ?? ''); setSelected(step?.resultObjects?.map(item => item.objectId) ?? []); setAttachments(step?.attachments ?? []); setRecordedAt(step?.resultRecordedAt); setError(''); }, [step?.iteration, step?.resultText, step?.resultRecordedAt]);
  if (!step) return null;
  const editable = canExecute && step.status === 'InProgress';
  const missing = outputs.filter(item => item.required && !selected.includes(item.objectId));
  const publish = (updated: ProcessInstance) => {
    onUpdated(updated);
    window.dispatchEvent(new CustomEvent<ProcessInstance>('pn:instance-updated', { detail: updated }));
  };
  const toggle = (item: InformationObjectBinding) => setSelected(items => items.includes(item.objectId) ? items.filter(id => id !== item.objectId) : [...items, item.objectId]);
  const save = async () => {
    setBusy(true); setError('');
    try { const updated = await saveStepResult(processId, instance.id, node.id, text, selected); const updatedStep = updated.steps.find(item => item.elementId === node.id); setRecordedAt(updatedStep?.resultRecordedAt); publish(updated); onMessage('Фактический результат сохранён'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить результат.'); }
    finally { setBusy(false); }
  };
  const upload = async (file?: File) => {
    if (!file) return; setBusy(true); setError('');
    try { const updated = await uploadStepAttachment(processId, instance.id, node.id, file); setAttachments(updated.steps.find(item => item.elementId === node.id)?.attachments ?? []); publish(updated); onMessage(`Файл «${file.name}» прикреплён`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось прикрепить файл.'); }
    finally { setBusy(false); }
  };
  return <section className="step-result-panel"><h3>Фактический результат</h3>
    {editable ? <label className="step-result-text">Комментарий или реквизиты результата<textarea value={text} maxLength={4000} onChange={event => setText(event.target.value)} placeholder="Что получено, номер документа, ссылка или краткое пояснение"/></label> : step.resultText ? <p className="step-result-readonly">{step.resultText}</p> : <p className="permission-note">Фактический комментарий не указан.</p>}
    {!!outputs.length && <div className="step-result-objects"><span>Выходы шага</span>{outputs.map(item => { const checked = selected.includes(item.objectId); return <label key={item.objectId} className={checked ? 'is-recorded' : item.required ? 'is-required' : ''}><input type="checkbox" checked={checked} disabled={!editable} onChange={() => toggle(item)}/><span>{checked ? <CheckCircle2 size={15}/> : <span className="result-checkbox"/>}<strong>{item.name}</strong><small>{item.required ? 'обязательный' : 'необязательный'} · {item.objectId}</small></span></label>; })}</div>}
    {editable && missing.length > 0 && <div className="step-result-warning"><AlertTriangle size={15}/><span>До завершения отметьте: {missing.map(item => item.name).join(', ')}</span></div>}
    {!!attachments.length && <div className="step-result-files"><span>Приложенные файлы</span>{attachments.map(item => <button key={`${item.artifactId}:${item.version}`} onClick={() => { const url = artifactDownloadUrl(item.reference, item.version); if (url) window.open(url, '_blank', 'noopener,noreferrer'); }}><FileText size={16}/><span><strong>{item.fileName}</strong><small>{bytes(item.size)} · {new Date(item.attachedAt).toLocaleString('ru-RU')}</small></span></button>)}</div>}
    {error && <div className="step-result-warning is-error"><AlertTriangle size={15}/><span>{error}</span></div>}
    {editable && <div className="step-result-actions"><label className={busy ? 'is-disabled' : ''}><Paperclip size={15}/>Прикрепить файл<input type="file" disabled={busy} onChange={event => { void upload(event.target.files?.[0]); event.currentTarget.value = ''; }}/></label><button disabled={busy} onClick={save}><Save size={15}/>{busy ? 'Сохраняем…' : 'Сохранить результат'}</button></div>}
    {recordedAt && <small className="step-result-meta"><Upload size={12}/>Обновлено {new Date(recordedAt).toLocaleString('ru-RU')}</small>}
  </section>;
}
