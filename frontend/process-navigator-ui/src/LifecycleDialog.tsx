import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Plus, RotateCcw, Save, Send, Trash2, Undo2, UsersRound, X } from 'lucide-react';
import { configureProcessWorkflow, loadProcessWorkflow, transitionProcessWorkflow } from './api';
import type { ProcessWorkflow, ProcessWorkflowStage, UserProfile } from './types';
import './lifecycle.css';
import './lifecycle-route.css';

const statusName: Record<string, string> = { Draft: 'Черновик', InReview: 'На согласовании', Approved: 'Одобрено', ChangesRequested: 'На доработке' };
const actionName: Record<string, string> = { submit: 'Отправлено на согласование', approve: 'Этап согласован', reject: 'Возвращено на доработку', reopen: 'Согласование отменено' };
const dateInput = (value?: string) => value ? new Date(value).toISOString().slice(0, 10) : '';

type Props = { processId: string; currentUserId: string; users: UserProfile[]; canEdit: boolean; canApprove: boolean; onClose: () => void; onChanged: () => Promise<void> };

export function LifecycleDialog({ processId, currentUserId, users, canEdit, canApprove, onClose, onChanged }: Props) {
  const [workflow, setWorkflow] = useState<ProcessWorkflow>();
  const [stages, setStages] = useState<ProcessWorkflowStage[]>([]);
  const [reviewDueAt, setReviewDueAt] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadProcessWorkflow(processId).then(data => { setWorkflow(data); setStages(data.stages); setReviewDueAt(dateInput(data.reviewDueAt)); }).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить согласование.')); }, [processId]);
  const apply = (next: ProcessWorkflow) => { setWorkflow(next); setStages(next.stages); setReviewDueAt(dateInput(next.reviewDueAt)); };
  const act = async (action: string) => { setBusy(true); setError(''); try { apply(await transitionProcessWorkflow(processId, action, comment)); setComment(''); await onChanged(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить статус.'); } finally { setBusy(false); } };
  const saveRoute = async () => { setBusy(true); setError(''); try { apply(await configureProcessWorkflow(processId, stages, reviewDueAt ? new Date(`${reviewDueAt}T12:00:00`).toISOString() : undefined)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить маршрут.'); } finally { setBusy(false); } };
  const changeStage = (index: number, patch: Partial<ProcessWorkflowStage>) => setStages(value => value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const stage = workflow?.stages[workflow.currentStageIndex];
  const assigned = !stage?.approverUserIds.length || stage.approverUserIds.includes(currentUserId);
  const editableRoute = canEdit && !!workflow && ['Draft', 'ChangesRequested'].includes(workflow.status);

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="lifecycle-dialog" role="dialog" aria-modal="true" aria-label="Согласование редакции">
    <header><div><span className="eyebrow">Жизненный цикл</span><h2>Согласование редакции</h2><p>Настройте последовательность этапов, ответственных и срок следующего пересмотра.</p></div><button onClick={onClose}><X size={17}/></button></header>
    {!workflow ? <div className="editor-loading"><div className="loader"/>{error || 'Загружаем историю…'}</div> : <div className="lifecycle-body">
      <div className="lifecycle-status"><Clock3 size={20}/><span><small>Текущий статус</small><strong>{statusName[workflow.status] ?? workflow.status}{workflow.status === 'InReview' ? ` · ${stage?.name}` : ''}</strong></span>{workflow.status === 'InReview' && stage && <em>{workflow.currentStageApproverIds.length} из {stage.requiredApprovals}</em>}</div>
      <section className="lifecycle-route"><div className="lifecycle-section-title"><span><UsersRound size={16}/><strong>Маршрут согласования</strong></span>{editableRoute && <button onClick={() => setStages(value => [...value, { name: `Этап ${value.length + 1}`, requiredApprovals: 1, approverUserIds: [] }])}><Plus size={14}/>Этап</button>}</div>
        {stages.map((item, index) => <article className={workflow.status === 'InReview' && index === workflow.currentStageIndex ? 'is-current' : ''} key={index}><b>{index + 1}</b><div><input value={item.name} disabled={!editableRoute} onChange={event => changeStage(index, { name: event.target.value })}/><label>Нужно решений <input type="number" min="1" max="20" value={item.requiredApprovals} disabled={!editableRoute} onChange={event => changeStage(index, { requiredApprovals: Number(event.target.value) })}/></label><div className="lifecycle-approvers">{users.filter(user => user.isActive && user.permissions.includes('process.publish')).map(user => <label key={user.id}><input type="checkbox" disabled={!editableRoute} checked={item.approverUserIds.includes(user.id)} onChange={event => changeStage(index, { approverUserIds: event.target.checked ? [...item.approverUserIds, user.id] : item.approverUserIds.filter(id => id !== user.id) })}/>{user.displayName}</label>)}<small>Если никого не выбрать, этап доступен любому пользователю с правом публикации.</small></div></div>{editableRoute && stages.length > 1 && <button className="icon-danger" onClick={() => setStages(value => value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14}/></button>}</article>)}
        <label className="lifecycle-review-date"><span>Следующий плановый пересмотр</span><input type="date" value={reviewDueAt} disabled={!editableRoute} onChange={event => setReviewDueAt(event.target.value)}/></label>
        {editableRoute && <button className="route-save" disabled={busy || !stages.length || stages.some(item => !item.name.trim())} onClick={saveRoute}><Save size={14}/>Сохранить маршрут</button>}
      </section>
      <label className="lifecycle-comment"><span>Комментарий к решению</span><textarea value={comment} onChange={event => setComment(event.target.value)} placeholder={workflow.status === 'InReview' ? 'Замечание или пояснение к решению' : 'Что изменено и на что обратить внимание'}/></label>{error && <div className="organization-error">{error}</div>}
      <div className="lifecycle-actions">{canEdit && ['Draft','ChangesRequested'].includes(workflow.status) && <button className="primary" onClick={() => act('submit')} disabled={busy}><Send size={15}/>Отправить на согласование</button>}{canApprove && workflow.status === 'InReview' && <><button className="is-danger" onClick={() => act('reject')} disabled={busy || !comment.trim()}><Undo2 size={15}/>Вернуть на доработку</button><button className="primary" title={!assigned ? 'Вы не назначены согласующим текущего этапа' : undefined} onClick={() => act('approve')} disabled={busy || !assigned || workflow.currentStageApproverIds.includes(currentUserId)}><CheckCircle2 size={15}/>Согласовать этап</button></>}{canEdit && workflow.status === 'Approved' && <button onClick={() => act('reopen')} disabled={busy}><RotateCcw size={15}/>Вернуть в черновик</button>}</div>
      <div className="lifecycle-history"><h3>История решений</h3>{workflow.events.map((event, index) => <article key={`${event.occurredAt}:${index}`}><span/><div><strong>{actionName[event.action] ?? event.action}{event.stageName ? ` · ${event.stageName}` : ''}</strong><small>{event.userName} · {new Date(event.occurredAt).toLocaleString('ru-RU')}</small>{event.comment && <p>{event.comment}</p>}</div></article>)}{!workflow.events.length && <p className="lifecycle-empty">Редакция ещё не отправлялась на согласование.</p>}</div>
    </div>}
  </section></div>;
}
