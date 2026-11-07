import type { ProcessSchedule, ProcessScheduleRequest } from './types';

export type ScheduleSnapshot = { id: string; name: string; savedAt: string; request: ProcessScheduleRequest; result: ProcessSchedule };
export const scheduleStorageKey = (userId: string) => `pn.schedule.v1:${encodeURIComponent(userId)}`;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const calendar = (value: unknown) => isRecord(value) && typeof value.workdayStart === 'string' && typeof value.workdayEnd === 'string'
  && Array.isArray(value.workingDays) && value.workingDays.every(day => Number.isInteger(day) && day >= 0 && day <= 6) && strings(value.nonWorkingDates) && finite(value.utcOffsetMinutes) && (value.timeZoneId==null||typeof value.timeZoneId==='string');
const routes = (value: unknown) => value === undefined || (isRecord(value) && Object.values(value).every(choices => isRecord(choices) && Object.values(choices).every(choice => typeof choice === 'string')));
const repetitions = (value: unknown) => value === undefined || (isRecord(value) && Object.values(value).every(repeat => isRecord(repeat) && typeof repeat.returnEdgeId === 'string' && Number.isInteger(repeat.plannedRepeats) && Number.isInteger(repeat.maximumRepeats) && Number(repeat.plannedRepeats) >= 0 && Number(repeat.plannedRepeats) <= Number(repeat.maximumRepeats) && Number(repeat.maximumRepeats) <= 50));
const optionalDate = (value: unknown) => value == null || date(value);
const iterationOptions=(value:Record<string,unknown>)=>
 (value.iterationPlans==null||(isRecord(value.iterationPlans)&&Object.keys(value.iterationPlans).length<=200&&
  Object.values(value.iterationPlans).every(plans=>Array.isArray(plans)&&plans.length<=8&&plans.every(p=>isRecord(p)&&typeof p.returnEdgeId==='string'&&
    Number.isInteger(p.plannedRepeats)&&Number(p.plannedRepeats)>=0&&Number.isInteger(p.maximumRepeats)&&Number(p.maximumRepeats)>=Number(p.plannedRepeats)&&Number(p.maximumRepeats)<=50&&
    (p.distribution==null||(Array.isArray(p.distribution)&&p.distribution.length<=51&&p.distribution.every(w=>isRecord(w)&&Number.isInteger(w.repeats)&&Number(w.repeats)>=0&&Number(w.repeats)<=Number(p.maximumRepeats)&&finite(w.probability)&&Number(w.probability)>=0&&Number(w.probability)<=1)))))))&&
 (value.iterationTransfers==null||(isRecord(value.iterationTransfers)&&Object.values(value.iterationTransfers).every(mode=>mode==='Batch'||mode==='PerPass')));
const iterationCounts=(value:unknown)=>value==null||(isRecord(value)&&Object.values(value).every(p=>isRecord(p)&&Object.values(p).every(n=>Number.isInteger(n)&&Number(n)>=0&&Number(n)<=50)));
const waitEvent=(value:unknown)=>value==null||(isRecord(value)&&['message','timer','unsupported'].includes(String(value.kind))&&
 ['durationMinutes','timeoutMinutes','expectedMinutes'].every(k=>value[k]==null||(finite(value[k])&&Number(value[k])>0&&Number(value[k])<=525600))&&
 ['source','channel','messageName','correlationKey','unsupportedDefinition','bpmnMessageRef'].every(k=>value[k]==null||typeof value[k]==='string'));
const scenarioOptions=(value:Record<string,unknown>)=>
 (value.facts==null||(isRecord(value.facts)&&Object.keys(value.facts).length<=100&&Object.values(value.facts).every(v=>typeof v==='boolean'))) &&
 (value.objectRules==null||(Array.isArray(value.objectRules)&&value.objectRules.length<=500&&value.objectRules.every(r=>isRecord(r)&&['processId','elementId','objectId','factName'].every(k=>typeof r[k]==='string')&&['Input','Output'].includes(String(r.role))&&typeof r.expectedValue==='boolean'))) &&
 (value.branchProbabilities==null||(Array.isArray(value.branchProbabilities)&&value.branchProbabilities.length<=8&&value.branchProbabilities.every(p=>isRecord(p)&&typeof p.processId==='string'&&typeof p.gatewayId==='string'&&Array.isArray(p.weights)&&p.weights.every(w=>isRecord(w)&&typeof w.edgeId==='string'&&finite(w.probability)&&Number(w.probability)>=0&&Number(w.probability)<=1))));
export function parseScheduleSnapshots(raw: string | null): ScheduleSnapshot[] {
  if (raw === null) return [];
  if (raw.length > 2_000_000) throw new Error('Хранилище расчётов превышает 2 млн символов. Оно не перезаписано.');
  const list: unknown = JSON.parse(raw);
  if (!Array.isArray(list) || list.length > 10) throw new Error('Неверный формат хранилища расчётов.');
  for (const saved of list) {
    if (!isRecord(saved) || typeof saved.id !== 'string' || typeof saved.name !== 'string' || !date(saved.savedAt) || !isRecord(saved.request) || !isRecord(saved.result)) throw new Error('Повреждён снимок расчёта.');
    const result = saved.result;
    const request = saved.request;
    if(!iterationOptions(request)||!isRecord(result.assumptions)||!iterationOptions(result.assumptions))throw Error('Повреждены параметры развёрнутых повторов.');
    if(result.iterationDetail!=null){
      const detail=result.iterationDetail;
      const pass=(s:unknown)=>isRecord(s)&&['processId','elementId','elementName','calendarSource'].every(k=>typeof s[k]==='string')&&Number.isInteger(s.occurrence)&&Number(s.occurrence)>0&&
        date(s.startAt)&&date(s.endAt)&&Array.isArray(s.path)&&s.path.length<=6&&s.path.every(c=>isRecord(c)&&typeof c.returnEdgeId==='string'&&Number.isInteger(c.pass)&&Number(c.pass)>0);
      const transfer=(t:unknown)=>isRecord(t)&&['objectId','objectName','sourceProcessId','sourceElementId','targetProcessId','targetElementId'].every(k=>typeof t[k]==='string')&&
        ['Batch','PerPass'].includes(String(t.mode))&&Number.isInteger(t.sourceOccurrence)&&Number(t.sourceOccurrence)>0&&Number.isInteger(t.targetOccurrence)&&Number(t.targetOccurrence)>0&&date(t.sourceReadyAt)&&date(t.requiredAt);
      if(!isRecord(detail)||![detail.plannedSteps,detail.maximumSteps].every(a=>Array.isArray(a)&&a.length<=10000&&a.every(pass))||
        ![detail.transfers,detail.maximumTransfers].every(a=>Array.isArray(a)&&a.length<=10000&&a.every(transfer)))throw Error('Повреждены даты проходов или передач.');
    }
    if(!scenarioOptions(request)||!isRecord(result.assumptions)||!scenarioOptions(result.assumptions))throw Error('Повреждены условия или вероятности сценария.');
    if(result.alternativeEnvelope!=null){
      const e=result.alternativeEnvelope;
      if(!isRecord(e)||!Array.isArray(e.cases)||e.cases.length<1||e.cases.length>64||typeof e.complete!=='boolean'||!finite(e.probabilityMass)||!finite(e.expectedNominalHours)||
        ![e.earliestStart,e.latestStart,e.earliestEnd,e.latestEnd].every(date)||
        !e.cases.every(c=>isRecord(c)&&Number.isInteger(c.number)&&finite(c.probability)&&Number(c.probability)>0&&Number(c.probability)<=1&&isRecord(c.choices)&&routes(c.choices)&&iterationCounts(c.iterationCounts)&&date(c.startAt)&&date(c.endAt)&&finite(c.nominalHours)&&typeof c.complete==='boolean'&&strings(c.processIds))||
        Math.abs(Number(e.probabilityMass)-1)>1e-7||
        Math.abs(e.cases.reduce((sum,c)=>sum+Number((c as Record<string,unknown>).probability),0)-1)>1e-7)throw Error('Повреждён диапазон альтернатив.');
    }
    for(const options of [request,result.assumptions]){
      if(!isRecord(options)||(options.useOrganizationCalendars!==undefined&&typeof options.useOrganizationCalendars!=='boolean')||
        (options.timeZoneId!=null&&typeof options.timeZoneId!=='string')||
        (options.stepCalendars!=null&&(!isRecord(options.stepCalendars)||!Object.values(options.stepCalendars).every(steps=>isRecord(steps)&&Object.values(steps).every(calendar)))))throw Error('Повреждены календари шагов.');
    }
    if (!routes(request.processBranches) || !repetitions(request.processRepetitions) || !optionalDate(result.maximumStartAt) || !optionalDate(result.maximumEndAt)) throw new Error('Повреждены решения, повторения или предельные даты.');
    if (typeof request.rootProcessId !== 'string' || !['Forward', 'Backward'].includes(String(request.direction)) || !date(request.anchorDate) ||
      !calendar({ ...request, utcOffsetMinutes: request.utcOffsetMinutes ?? 0 }) || typeof request.includeWaitTime !== 'boolean' ||
      !finite(request.durationScalePercent) || !finite(request.transferDelayHours) || !isRecord(request.processDurationScalePercent) ||
      !Object.values(request.processDurationScalePercent).every(finite) || !isRecord(request.checkpoints) || !Object.values(request.checkpoints).every(date) ||
      (request.processCalendars !== undefined && (!isRecord(request.processCalendars) || !Object.values(request.processCalendars).every(calendar)))) throw new Error('Повреждены параметры сценария.');
    if (!['Forward', 'Backward'].includes(String(result.direction)) || !date(result.startAt) || !date(result.endAt) || !date(result.anchorDate) ||
      !Array.isArray(result.processes) || !Array.isArray(result.dependencies) || !Array.isArray(result.issues) || !isRecord(result.assumptions) ||
      !finite(result.durationHours) || !finite(result.criticalDurationHours) || typeof result.complete !== 'boolean') throw new Error('Повреждены результаты расчёта.');
    for (const item of result.processes) {
      if(isRecord(item)&&item.steps!=null&&(!Array.isArray(item.steps)||item.steps.length>10000||!item.steps.every(step=>isRecord(step)&&typeof step.elementId==='string'&&typeof step.calendarSource==='string'&&date(step.startAt)&&date(step.endAt))))throw Error('Повреждены даты календарных шагов.');
      if (!isRecord(item) || typeof item.processId !== 'string' || typeof item.processName !== 'string' || !date(item.startAt) || !date(item.endAt) || !strings(item.uncertaintyReasons) ||
        !['durationHours', 'baseDurationHours', 'appliedDurationScalePercent', 'slackHours', 'missingDurationCount'].every(key => finite(item[key])) ||
        !['isDateReliable', 'hasInternalCycle', 'isCritical', 'isCheckpointMissed'].every(key => typeof item[key] === 'boolean') ||
        (item.checkpointAt != null && !date(item.checkpointAt)) || (item.checkpointDeltaHours != null && !finite(item.checkpointDeltaHours)) ||
        !optionalDate(item.maximumStartAt) || !optionalDate(item.maximumEndAt) || (item.maximumDurationHours != null && !finite(item.maximumDurationHours))) throw new Error('Повреждены даты или нормы процесса.');
    }
    if (!calendar({ ...result.assumptions, utcOffsetMinutes: result.assumptions.utcOffsetMinutes ?? 0 }) ||
      !finite(result.assumptions.durationScalePercent) || !finite(result.assumptions.transferDelayHours) || typeof result.assumptions.includeWaitTime !== 'boolean' ||
      (result.assumptions.processCalendars !== undefined && (!isRecord(result.assumptions.processCalendars) || !Object.values(result.assumptions.processCalendars).every(calendar))) ||
      !result.issues.every(item => isRecord(item) && typeof item.message === 'string') ||
      !result.dependencies.every(item => isRecord(item) && typeof item.sourceProcessId === 'string' && typeof item.targetProcessId === 'string' && typeof item.objectName === 'string')) throw new Error('Повреждены допущения или зависимости.');
    if (result.sources !== undefined && (!isRecord(result.sources) || typeof result.sources.algorithm !== 'string' || !date(result.sources.capturedAt) ||
      !Array.isArray(result.sources.processes) || !result.sources.processes.every(item => isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.version === 'string' && typeof item.status === 'string') ||
      !Array.isArray(result.sources.objects))) throw new Error('Повреждён снимок исходных данных.');
    if (!routes(result.assumptions.processBranches) || !repetitions(result.assumptions.processRepetitions)) throw new Error('Повреждены сценарные допущения.');
    if(isRecord(result.sources)&&Array.isArray(result.sources.processes)&&result.sources.processes.some(p=>isRecord(p)&&Array.isArray(p.nodes)&&p.nodes.some(n=>isRecord(n)&&!waitEvent(n.waitEvent))))throw Error('Повреждена спецификация ожидания в исходниках.');
  }
  return list as ScheduleSnapshot[];
}
export function serializeScheduleSnapshots(list: ScheduleSnapshot[]) {
  if (list.length > 10) throw new Error('Можно хранить до 10 расчётов. Удалите ненужный снимок или скачайте его.');
  const raw = JSON.stringify(list);
  parseScheduleSnapshots(raw);
  return raw;
}
export function compareScheduleSnapshots(baseline: ProcessSchedule, current: ProcessSchedule) {
  const scenario=(value:ProcessSchedule,id:string)=>JSON.stringify([value.assumptions.processBranches?.[id]??{},
    value.assumptions.processRepetitions?.[id]??null,value.assumptions.facts??{},
    (value.assumptions.objectRules??[]).filter(r=>r.processId===id),(value.assumptions.branchProbabilities??[]).filter(p=>p.processId===id),
    value.assumptions.iterationPlans?.[id]??[],value.assumptions.iterationTransfers??{}]);
  const previous = new Map(baseline.processes.map(item => [item.processId, item]));
  const rows = current.processes.map(item => {
    const old = previous.get(item.processId); previous.delete(item.processId);
    const before = baseline.sources?.processes.find(model => model.id === item.processId);
    const after = current.sources?.processes.find(model => model.id === item.processId);
    const routeChanged = old ? scenario(baseline,item.processId)!==scenario(current,item.processId) : undefined;
    return { id: item.processId, name: item.processName, state: old ? 'changed' : 'added', routeChanged, sourceChanged: before && after ? JSON.stringify(before) !== JSON.stringify(after) : undefined, finishDeltaHours: old ? (Date.parse(item.endAt) - Date.parse(old.endAt)) / 3600000 : undefined,
      durationDeltaHours: old ? item.durationHours - old.durationHours : undefined };
  });
  return [...rows, ...[...previous.values()].map(item => ({ id: item.processId, name: item.processName, state: 'removed', routeChanged: undefined, sourceChanged: undefined, finishDeltaHours: undefined, durationDeltaHours: undefined }))];
}
