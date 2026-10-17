import type { ProcessSchedule, ProcessScheduleRequest } from './types';

export type ScheduleSnapshot = { id: string; name: string; savedAt: string; request: ProcessScheduleRequest; result: ProcessSchedule };
export const scheduleStorageKey = (userId: string) => `pn.schedule.v1:${encodeURIComponent(userId)}`;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const calendar = (value: unknown) => isRecord(value) && typeof value.workdayStart === 'string' && typeof value.workdayEnd === 'string'
  && Array.isArray(value.workingDays) && value.workingDays.every(day => Number.isInteger(day) && day >= 0 && day <= 6) && strings(value.nonWorkingDates) && finite(value.utcOffsetMinutes);
export function parseScheduleSnapshots(raw: string | null): ScheduleSnapshot[] {
  if (raw === null) return [];
  if (raw.length > 2_000_000) throw new Error('Хранилище расчётов превышает 2 млн символов. Оно не перезаписано.');
  const list: unknown = JSON.parse(raw);
  if (!Array.isArray(list) || list.length > 10) throw new Error('Неверный формат хранилища расчётов.');
  for (const saved of list) {
    if (!isRecord(saved) || typeof saved.id !== 'string' || typeof saved.name !== 'string' || !date(saved.savedAt) || !isRecord(saved.request) || !isRecord(saved.result)) throw new Error('Повреждён снимок расчёта.');
    const result = saved.result;
    const request = saved.request;
    if (typeof request.rootProcessId !== 'string' || !['Forward', 'Backward'].includes(String(request.direction)) || !date(request.anchorDate) ||
      !calendar({ ...request, utcOffsetMinutes: request.utcOffsetMinutes ?? 0 }) || typeof request.includeWaitTime !== 'boolean' ||
      !finite(request.durationScalePercent) || !finite(request.transferDelayHours) || !isRecord(request.processDurationScalePercent) ||
      !Object.values(request.processDurationScalePercent).every(finite) || !isRecord(request.checkpoints) || !Object.values(request.checkpoints).every(date) ||
      (request.processCalendars !== undefined && (!isRecord(request.processCalendars) || !Object.values(request.processCalendars).every(calendar)))) throw new Error('Повреждены параметры сценария.');
    if (!['Forward', 'Backward'].includes(String(result.direction)) || !date(result.startAt) || !date(result.endAt) || !date(result.anchorDate) ||
      !Array.isArray(result.processes) || !Array.isArray(result.dependencies) || !Array.isArray(result.issues) || !isRecord(result.assumptions) ||
      !finite(result.durationHours) || !finite(result.criticalDurationHours) || typeof result.complete !== 'boolean') throw new Error('Повреждены результаты расчёта.');
    for (const item of result.processes) {
      if (!isRecord(item) || typeof item.processId !== 'string' || typeof item.processName !== 'string' || !date(item.startAt) || !date(item.endAt) || !strings(item.uncertaintyReasons) ||
        !['durationHours', 'baseDurationHours', 'appliedDurationScalePercent', 'slackHours', 'missingDurationCount'].every(key => finite(item[key])) ||
        !['isDateReliable', 'hasInternalCycle', 'isCritical', 'isCheckpointMissed'].every(key => typeof item[key] === 'boolean') ||
        (item.checkpointAt != null && !date(item.checkpointAt)) || (item.checkpointDeltaHours != null && !finite(item.checkpointDeltaHours))) throw new Error('Повреждены даты или нормы процесса.');
    }
    if (!calendar({ ...result.assumptions, utcOffsetMinutes: result.assumptions.utcOffsetMinutes ?? 0 }) ||
      !finite(result.assumptions.durationScalePercent) || !finite(result.assumptions.transferDelayHours) || typeof result.assumptions.includeWaitTime !== 'boolean' ||
      (result.assumptions.processCalendars !== undefined && (!isRecord(result.assumptions.processCalendars) || !Object.values(result.assumptions.processCalendars).every(calendar))) ||
      !result.issues.every(item => isRecord(item) && typeof item.message === 'string') ||
      !result.dependencies.every(item => isRecord(item) && typeof item.sourceProcessId === 'string' && typeof item.targetProcessId === 'string' && typeof item.objectName === 'string')) throw new Error('Повреждены допущения или зависимости.');
    if (result.sources !== undefined && (!isRecord(result.sources) || typeof result.sources.algorithm !== 'string' || !date(result.sources.capturedAt) ||
      !Array.isArray(result.sources.processes) || !result.sources.processes.every(item => isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.version === 'string' && typeof item.status === 'string') ||
      !Array.isArray(result.sources.objects))) throw new Error('Повреждён снимок исходных данных.');
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
  const previous = new Map(baseline.processes.map(item => [item.processId, item]));
  const rows = current.processes.map(item => {
    const old = previous.get(item.processId); previous.delete(item.processId);
    const before = baseline.sources?.processes.find(model => model.id === item.processId);
    const after = current.sources?.processes.find(model => model.id === item.processId);
    return { id: item.processId, name: item.processName, state: old ? 'changed' : 'added', sourceChanged: before && after ? JSON.stringify(before) !== JSON.stringify(after) : undefined, finishDeltaHours: old ? (Date.parse(item.endAt) - Date.parse(old.endAt)) / 3600000 : undefined,
      durationDeltaHours: old ? item.durationHours - old.durationHours : undefined };
  });
  return [...rows, ...[...previous.values()].map(item => ({ id: item.processId, name: item.processName, state: 'removed', sourceChanged: undefined, finishDeltaHours: undefined, durationDeltaHours: undefined }))];
}
