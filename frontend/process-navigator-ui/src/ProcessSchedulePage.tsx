import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, CalendarX2, CheckCircle2, Clock3, Download, Gauge, Milestone, Network, Play, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import { calculateProcessSchedule } from './api';
import { ScheduleCalendarEditor } from './ScheduleCalendarEditor';
import { scheduleCsv } from './schedule-export';
import { ScheduleRouteEditor } from './ScheduleRouteEditor';
import { ScheduleArchive } from './ScheduleArchive';
import type { ScheduleSnapshot } from './schedule-snapshots';
import type { ProcessSchedule, ProcessScheduleRequest, ProcessSummary, ScheduleCalendar, ScheduleRepetition } from './types';
import './process-schedule.css';

type Props = { userId: string; catalog: ProcessSummary[]; onBack: () => void; onOpen: (processId: string) => void };
const week = [{ id: 1, short: 'Пн' }, { id: 2, short: 'Вт' }, { id: 3, short: 'Ср' }, { id: 4, short: 'Чт' }, { id: 5, short: 'Пт' }, { id: 6, short: 'Сб' }, { id: 0, short: 'Вс' }];

function localInputValue(value: Date | string) { const date = value instanceof Date ? value : new Date(value); const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function displayDate(value: string) { return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function displayHours(value: number) { return `${Math.round(value * 10) / 10} ч`; }

export function ProcessSchedulePage({ userId, catalog, onBack, onOpen }: Props) {
  const [rootProcessId, setRootProcessId] = useState(catalog[0]?.id ?? '');
  const [direction, setDirection] = useState<'Forward' | 'Backward'>('Forward');
  const [anchorDate, setAnchorDate] = useState(localInputValue(new Date()));
  const [includeWaitTime, setIncludeWaitTime] = useState(true);
  const [workdayStart, setWorkdayStart] = useState('09:00');
  const [workdayEnd, setWorkdayEnd] = useState('17:00');
  const [workingDays, setWorkingDays] = useState([1, 2, 3, 4, 5]);
  const [durationScalePercent, setDurationScalePercent] = useState(100);
  const [transferDelayHours, setTransferDelayHours] = useState(0);
  const [nonWorkingDates, setNonWorkingDates] = useState<string[]>([]);
  const [newNonWorkingDate, setNewNonWorkingDate] = useState('');
  const [processScales, setProcessScales] = useState<Record<string, number>>({});
  const [checkpoints, setCheckpoints] = useState<Record<string, string>>({});
  const [utcOffsetMinutes, setUtcOffsetMinutes] = useState(-new Date().getTimezoneOffset());
  const [processCalendars, setProcessCalendars] = useState<Record<string, ScheduleCalendar>>({});
  const [processBranches, setProcessBranches] = useState<Record<string, Record<string, string>>>({});
  const [processRepetitions, setProcessRepetitions] = useState<Record<string, ScheduleRepetition>>({});
  const [lastRequest, setLastRequest] = useState<ProcessScheduleRequest>();
  const [scenarioDirty, setScenarioDirty] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [result, setResult] = useState<ProcessSchedule>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dependencies = useMemo(() => new Map(result?.processes.map(item => [item.processId,
    result.dependencies.filter(dependency => direction === 'Forward' ? dependency.targetProcessId === item.processId : dependency.sourceProcessId === item.processId)]) ?? []), [result, direction]);
  const timeRange = result ? Math.max(1, new Date(result.endAt).getTime() - new Date(result.startAt).getTime()) : 1;

  const resetChain = () => { setResult(undefined); setProcessScales({}); setCheckpoints({}); setProcessCalendars({}); setProcessBranches({}); setProcessRepetitions({}); setLastRequest(undefined); setScenarioDirty(false); };
  const addNonWorkingDate = () => {
    if (!newNonWorkingDate || nonWorkingDates.includes(newNonWorkingDate)) return;
    setNonWorkingDates(value => [...value, newNonWorkingDate].sort()); setNewNonWorkingDate(''); setScenarioDirty(true);
  };
  const calculate = async () => {
    if (!rootProcessId || !anchorDate || !workingDays.length) return;
    setBusy(true); setError('');
    try {
      const request: ProcessScheduleRequest = {
        rootProcessId, direction, anchorDate: new Date(anchorDate).toISOString(), includeWaitTime, workdayStart, workdayEnd,
        workingDays, durationScalePercent, transferDelayHours, nonWorkingDates, utcOffsetMinutes, processBranches, processRepetitions,
        processCalendars: Object.fromEntries(Object.entries(processCalendars).map(([id, calendar]) => [id, { ...calendar, nonWorkingDates: calendar.nonWorkingDates.map(value => value.trim()).filter(Boolean) }])),
        processDurationScalePercent: Object.fromEntries(Object.entries(processScales).filter(([, value]) => value !== 100)),
        checkpoints: Object.fromEntries(Object.entries(checkpoints).filter(([, value]) => value).map(([id, value]) => [id, new Date(value).toISOString()]))
      };
      const schedule = await calculateProcessSchedule(request);
      setLastRequest(structuredClone(request));
      setResult(schedule); setScenarioDirty(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось выполнить расчёт.'); }
    finally { setBusy(false); }
  };
  const restore = (snapshot: ScheduleSnapshot) => {
    const value = snapshot.request;
    setRootProcessId(value.rootProcessId); setDirection(value.direction); setAnchorDate(localInputValue(value.anchorDate));
    setIncludeWaitTime(value.includeWaitTime); setWorkdayStart(value.workdayStart); setWorkdayEnd(value.workdayEnd);
    setWorkingDays(value.workingDays); setDurationScalePercent(value.durationScalePercent); setTransferDelayHours(value.transferDelayHours);
    setNonWorkingDates(value.nonWorkingDates); setProcessScales(value.processDurationScalePercent); setUtcOffsetMinutes(value.utcOffsetMinutes ?? 0);
    setProcessCalendars(value.processCalendars ?? {}); setCheckpoints(Object.fromEntries(Object.entries(value.checkpoints).map(([id, date]) => [id, localInputValue(date)])));
    setProcessBranches(value.processBranches ?? {}); setProcessRepetitions(value.processRepetitions ?? {});
    setLastRequest(value); setResult(snapshot.result); setScenarioDirty(false); setError('');
  };
  const exportCsv = () => {
    if (!result) return;
    const csv = scheduleCsv(result);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `process-schedule-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return <main className="feature-page schedule-page"><div className="feature-page-shell">
    <nav className="feature-breadcrumb"><button onClick={onBack}><ArrowLeft size={16}/>Рабочее пространство</button><span>›</span><strong>Расчёт сроков</strong></nav>
    <header className="schedule-heading"><div><span className="eyebrow">Цепочка процессов и документов</span><h1>Калькулятор сроков</h1><p>Прямой и обратный расчёт по нормам шагов, передачам документов и рабочему календарю. Сценарий позволяет менять отдельные ветви и контролировать обязательные даты.</p></div><div className="schedule-heading-actions">{result && <button onClick={exportCsv}><Download size={16}/>Выгрузить CSV</button>}<CalendarClock size={42}/></div></header>
    <fieldset disabled={busy} className="schedule-controls"><section className="schedule-form">
      <label><span>{direction === 'Forward' ? 'Начальный процесс' : 'Конечный процесс'}</span><select value={rootProcessId} onChange={event => { setRootProcessId(event.target.value); resetChain(); }}>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>Направление</span><select value={direction} onChange={event => { setDirection(event.target.value as 'Forward' | 'Backward'); resetChain(); }}><option value="Forward">Прямой расчёт от старта</option><option value="Backward">Обратный расчёт от результата</option></select></label>
      <label><span>{direction === 'Forward' ? 'Дата начала' : 'Требуемая дата результата'}</span><input disabled={busy} type="datetime-local" value={anchorDate} onChange={event => { setAnchorDate(event.target.value); setScenarioDirty(true); }}/></label>
      <p className="schedule-zone-note">Дата ввода и отображаемые даты — в часовом поясе браузера. Рабочие часы применяются в явно заданном UTC-сдвиге календаря.</p><button className="schedule-settings" aria-expanded={assumptionsOpen} onClick={() => setAssumptionsOpen(value => !value)}><Settings2 size={17}/>Календарь</button>
      <button className="schedule-run" disabled={busy || !rootProcessId || !workingDays.length} onClick={calculate}>{busy ? <RotateCcw className="is-spinning" size={17}/> : <Play size={17}/>}Рассчитать</button>
      {assumptionsOpen && <div className="schedule-assumptions">
        <label><span>Сдвиг общего календаря UTC, минуты</span><input disabled={busy} type="number" min="-720" max="840" value={utcOffsetMinutes} onChange={event => { setUtcOffsetMinutes(Number(event.target.value)); setScenarioDirty(true); }}/></label><label><span>Начало рабочего дня</span><input disabled={busy} type="time" value={workdayStart} onChange={event => { setWorkdayStart(event.target.value); setScenarioDirty(true); }}/></label>
        <label><span>Окончание рабочего дня</span><input disabled={busy} type="time" value={workdayEnd} onChange={event => { setWorkdayEnd(event.target.value); setScenarioDirty(true); }}/></label>
        <label><span>Общий коэффициент, %</span><input disabled={busy} type="number" min="1" max="1000" value={durationScalePercent} onChange={event => { setDurationScalePercent(Number(event.target.value)); setScenarioDirty(true); }}/></label>
        <label><span>Задержка каждой передачи, ч</span><input disabled={busy} type="number" min="0" step="0.5" value={transferDelayHours} onChange={event => { setTransferDelayHours(Number(event.target.value)); setScenarioDirty(true); }}/></label>
        <label className="schedule-check"><input disabled={busy} type="checkbox" checked={includeWaitTime} onChange={event => { setIncludeWaitTime(event.target.checked); setScenarioDirty(true); }}/><span>Учитывать ожидание</span></label>
        <fieldset><legend>Рабочие дни</legend>{week.map(day => <label key={day.id} className={workingDays.includes(day.id) ? 'is-active' : ''}><input disabled={busy} type="checkbox" checked={workingDays.includes(day.id)} onChange={() => { setWorkingDays(days => days.includes(day.id) ? days.filter(value => value !== day.id) : [...days, day.id]); setScenarioDirty(true); }}/>{day.short}</label>)}</fieldset>
        <div className="schedule-holidays"><div><CalendarX2 size={17}/><span><strong>Исключения календаря</strong><small>Праздники, переносы и другие нерабочие даты</small></span></div><label><input disabled={busy} type="date" value={newNonWorkingDate} onChange={event => setNewNonWorkingDate(event.target.value)}/><button type="button" onClick={addNonWorkingDate} disabled={!newNonWorkingDate}><Plus size={15}/>Добавить</button></label>{nonWorkingDates.length > 0 && <div className="schedule-holiday-list">{nonWorkingDates.map(date => <span key={date}>{new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU')}<button title="Удалить дату" onClick={() => { setNonWorkingDates(value => value.filter(item => item !== date)); setScenarioDirty(true); }}><Trash2 size={12}/></button></span>)}</div>}</div>
      </div>}
    </section>
    </fieldset>
    <ScheduleCalendarEditor processes={result?.processes ?? []} defaults={{ workdayStart, workdayEnd, workingDays, nonWorkingDates, utcOffsetMinutes }} value={processCalendars} disabled={busy} onChange={value => { setProcessCalendars(value); setScenarioDirty(true); }}/>
    <ScheduleRouteEditor models={result?.sources?.processes ?? []} branches={processBranches} repetitions={processRepetitions} disabled={busy} onChange={(branches, repetitions) => { setProcessBranches(branches); setProcessRepetitions(repetitions); setScenarioDirty(true); }}/>
    <ScheduleArchive userId={userId} result={result} request={lastRequest} dirty={scenarioDirty || busy} busy={busy} onRestore={restore}/>
    {error && <div className="schedule-error"><AlertTriangle size={18}/>{error}</div>}
    {!result && !busy && !error && <section className="schedule-intro"><Network size={32}/><h2>Как строится цепочка</h2><p>Программа находит документы и результаты, которые выходят из одного процесса и являются входами другого. Затем применяет нормы работы, ожидания, календарь и параметры сценария.</p></section>}
    {result && <>
      {scenarioDirty && <div className="schedule-dirty"><AlertTriangle size={16}/>Параметры изменены. Нажмите «Рассчитать», чтобы обновить даты.</div>}
      {result.maximumStartAt && result.maximumEndAt && (result.maximumStartAt !== result.startAt || result.maximumEndAt !== result.endAt) && <section className="schedule-scenario"><h2>Предельный вариант по числу повторов</h2><p>{result.direction === "Forward" ? "Расчётная дата результата при предельном числе дополнительных проходов:" : "Расчётный предельный старт для заданного числа дополнительных проходов:"} <strong>{displayDate(result.direction === "Forward" ? result.maximumEndAt : result.maximumStartAt)}</strong>.</p><p>Это сценарный предел заданных повторов, а не вероятностный прогноз и не гарантия фактического срока. Остальные допущения и неопределённости сохраняются.</p></section>}
      <section className="schedule-kpis"><article><strong>{result.processes.length}</strong><span>процессов в цепочке</span></article><article><strong>{displayHours(result.durationHours)}</strong><span>сумма расчётных длительностей</span></article><article><strong>{displayHours(result.criticalDurationHours)}</strong><span>критическая цепочка</span></article><article><strong>{displayDate(result.startAt)}</strong><span>начало цепочки</span></article><article><strong>{displayDate(result.endAt)}</strong><span>завершение цепочки</span></article><article className={result.complete ? 'is-ready' : 'is-alert'}>{result.complete ? <CheckCircle2 size={20}/> : <AlertTriangle size={20}/>}<strong>{result.complete ? 'Расчёт полный' : 'Есть пробелы'}</strong><span>{result.issues.length} замечаний</span></article></section>
      {result.sources && <details className="schedule-scenario"><summary>Исходные версии и календари снимка</summary><p>{result.sources.algorithm} · {displayDate(result.sources.capturedAt)} · общий сдвиг UTC {result.assumptions.utcOffsetMinutes ?? 0} минут</p>{result.sources.processes.map(model => <p key={model.id}>{model.name} · {model.version} · {model.status}{result.assumptions.processCalendars?.[model.id] ? ` · отдельный график ${result.assumptions.processCalendars[model.id].workdayStart}–${result.assumptions.processCalendars[model.id].workdayEnd}, UTC ${result.assumptions.processCalendars[model.id].utcOffsetMinutes} мин` : " · общий график"}</p>)}</details>}
      <section className="schedule-summary"><span><strong>Календарь:</strong> {result.assumptions.workdayStart}–{result.assumptions.workdayEnd}</span><span><strong>Исключения:</strong> {result.assumptions.nonWorkingDates.length}</span><span><strong>Длительность:</strong> {result.assumptions.durationScalePercent}%</span><span><strong>Передача:</strong> {displayHours(result.assumptions.transferDelayHours)}</span><span><strong>Ожидание:</strong> {result.assumptions.includeWaitTime ? 'учтено' : 'не учтено'}</span></section>
      <section className="schedule-scenario"><header><div><span className="eyebrow">Сценарий «что если»</span><h2>Длительности и контрольные даты</h2><p>Измените длительность конкретного процесса или задайте дату, к которой он должен завершиться, затем пересчитайте цепочку.</p></div><button disabled={busy} onClick={() => { setProcessScales({}); setCheckpoints({}); setScenarioDirty(true); }}><RotateCcw size={15}/>Сбросить сценарий</button></header><div className="schedule-scenario-grid">
        {result.processes.map(item => <div key={item.processId}><span><strong>{item.processName}</strong><small>{item.processId}</small></span><label><Gauge size={15}/><span>Длительность, %</span><input disabled={busy} type="number" min="1" max="1000" value={processScales[item.processId] ?? 100} onChange={event => { setProcessScales(value => ({ ...value, [item.processId]: Number(event.target.value) })); setScenarioDirty(true); }}/></label><label><Milestone size={15}/><span>Контрольная дата</span><input disabled={busy} type="datetime-local" value={checkpoints[item.processId] ?? ''} onChange={event => { setCheckpoints(value => ({ ...value, [item.processId]: event.target.value })); setScenarioDirty(true); }}/></label></div>)}
      </div></section>
      {result.issues.length > 0 && <section className="schedule-issues"><h2>Что требует уточнения</h2>{result.issues.map((issue, index) => <button key={`${issue.code}:${issue.processId}:${issue.elementId}:${index}`} disabled={!issue.processId} onClick={() => issue.processId && onOpen(issue.processId)} className={issue.severity === 'Error' ? 'is-error' : ''}><AlertTriangle size={16}/><span><strong>{issue.code === 'checkpoint-missed' ? 'Нарушена контрольная дата' : issue.severity === 'Error' ? 'Не хватает данных' : 'Проверьте'}</strong>{issue.message}</span>{issue.processId && <ArrowRight size={15}/>}</button>)}</section>}
      <section className="schedule-results"><header><div><span className="eyebrow">Расчётная последовательность</span><h2>{direction === 'Forward' ? 'От запуска к результату' : 'От результата к необходимым входам'}</h2></div><span>Оранжевым отмечена критическая цепочка, пунктиром — предварительные даты, ромбом — контрольная дата</span></header>
        <div className="schedule-timeline" aria-label="Шкала сроков">{result.processes.map(item => { const left = ((new Date(item.startAt).getTime() - new Date(result.startAt).getTime()) / timeRange) * 100; const width = Math.max(1.5, ((new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) / timeRange) * 100); const checkpointLeft = item.checkpointAt ? Math.max(0, Math.min(100, ((new Date(item.checkpointAt).getTime() - new Date(result.startAt).getTime()) / timeRange) * 100)) : undefined; return <div key={item.processId}><button onClick={() => onOpen(item.processId)} title={`${item.processName}: ${displayDate(item.startAt)} — ${displayDate(item.endAt)}`}>{item.processName}</button><i><span className={`${item.isCritical ? 'is-critical ' : ''}${item.isDateReliable ? '' : 'is-uncertain'}`} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}/>{checkpointLeft !== undefined && <b className={item.isCheckpointMissed ? 'is-missed' : ''} style={{ left: `${checkpointLeft}%` }} title={`Контрольная дата: ${displayDate(item.checkpointAt!)}`}/>}</i></div>; })}</div>
        <div className="schedule-list">{result.processes.map((item, index) => <article key={item.processId} className={`${item.missingDurationCount ? 'has-gap ' : ''}${item.isCritical ? 'is-critical ' : ''}${item.isCheckpointMissed ? 'is-late ' : ''}${item.isDateReliable ? '' : 'is-uncertain'}`}>
          <div className="schedule-index">{index + 1}</div><button className="schedule-process" onClick={() => onOpen(item.processId)}><strong>{item.processName}</strong><span>{item.processId}</span></button>
          <div className="schedule-dates"><span><Clock3 size={14}/>{item.isDateReliable ? 'с' : 'ориентировочно с'} {displayDate(item.startAt)}</span><span>{item.isDateReliable ? 'до' : 'ориентировочно до'} {displayDate(item.endAt)}</span>{item.checkpointAt && <span className={item.isCheckpointMissed ? 'is-missed' : 'is-on-time'}><Milestone size={14}/>контроль: {displayDate(item.checkpointAt)}</span>}</div><div className="schedule-duration"><strong>{displayHours(item.durationHours)}</strong>{item.baseDurationHours !== item.durationHours && <small>база {displayHours(item.baseDurationHours)} · {item.appliedDurationScalePercent}%</small>}<small>{item.maximumDurationHours != null && item.maximumDurationHours !== item.durationHours ? `предел ${displayHours(item.maximumDurationHours)} · ` : ''}{item.isCritical ? 'критический' : `резерв ${displayHours(item.slackHours)}`}</small>{item.checkpointDeltaHours != null && <small>{item.isCheckpointMissed ? `опоздание ${displayHours(item.checkpointDeltaHours)}` : `до контроля ${displayHours(Math.abs(item.checkpointDeltaHours))}`}</small>}</div>
          {(dependencies.get(item.processId)?.length ?? 0) > 0 && <div className="schedule-objects">{dependencies.get(item.processId)!.map(dependency => <span key={`${dependency.objectId}:${dependency.sourceProcessId}:${dependency.targetProcessId}`}>{dependency.objectName}{!dependency.required && <small>необязательный</small>}</span>)}</div>}
          {(item.missingDurationCount > 0 || item.hasInternalCycle) && <div className="schedule-flags">{item.missingDurationCount > 0 && <span>{item.missingDurationCount} шагов без нормы</span>}{item.hasInternalCycle && <span>возвратный цикл</span>}</div>}
          {!item.isDateReliable && <div className="schedule-uncertainty"><strong>Почему даты предварительные</strong>{item.uncertaintyReasons.map(reason => <span key={reason}>{reason}</span>)}</div>}
        </article>)}</div>
      </section>
    </>}
  </div></main>;
}
