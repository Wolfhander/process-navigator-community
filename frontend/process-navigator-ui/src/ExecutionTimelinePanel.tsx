import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, FileText, GitBranch, History, Play, RotateCcw, UserRound } from 'lucide-react';
import { loadInstanceTimeline } from './api';
import type { ExecutionTimeline, ProcessInstance } from './types';

const icon = (type: string) => type === 'StepCompleted' || type === 'InstanceCompleted' ? <CheckCircle2 size={14}/>
  : type === 'StepReturned' ? <RotateCcw size={14}/> : type === 'BranchSelected' ? <GitBranch size={14}/>
  : type === 'AttachmentAdded' || type === 'ResultRecorded' ? <FileText size={14}/>
  : type === 'StepAssigned' ? <UserRound size={14}/>
  : type === 'StepStarted' || type === 'InstanceStarted' ? <Play size={14}/> : <Clock3 size={14}/>;

export function ExecutionTimelinePanel({ processId, instance, refreshKey, onOpenStep }: {
  processId: string;
  instance: ProcessInstance;
  refreshKey?: number;
  onOpenStep?: (elementId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ExecutionTimeline>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    loadInstanceTimeline(processId, instance.id).then(value => { setData(value); setError(''); })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Не удалось загрузить хронологию.'));
  }, [open, processId, instance, refreshKey]);
  return <section className="execution-timeline"><details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><History size={15}/>Хронология экземпляра{data ? ` (${data.events.length})` : ''}</summary>
    {error && <div className="step-timing-alert"><AlertTriangle size={15}/>{error}</div>}
    {!data && !error && <p className="permission-note">Откройте раздел, чтобы загрузить события экземпляра.</p>}
    {data?.events.map(event => <button key={event.id} className={`timeline-event is-${event.severity.toLowerCase()}`} disabled={!event.elementId || !onOpenStep} onClick={() => event.elementId && onOpenStep?.(event.elementId)}>
      <span className="timeline-event-icon">{icon(event.type)}</span><span><strong>{event.title}</strong>{event.detail && <em>{event.detail}</em>}<small>{new Date(event.occurredAt).toLocaleString('ru-RU')}{event.iteration ? ` · проход ${event.iteration}` : ''}</small></span>
    </button>)}
  </details></section>;
}
