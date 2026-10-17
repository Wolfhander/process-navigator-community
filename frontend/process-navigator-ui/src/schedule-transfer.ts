import { parseScheduleSnapshots, serializeScheduleSnapshots, type ScheduleSnapshot } from './schedule-snapshots';

export const scheduleTransferMaxBytes = 8_000_000;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

// External JSON is data, never code. Bound structure before handing it to existing snapshot readers.
function inspect(value: unknown) {
  const pending = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (++visited > 100_000 || next.depth > 64) throw new Error('Слишком сложная структура JSON.');
    if (next.value && typeof next.value === 'object') {
      for (const [key, child] of Object.entries(next.value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Недопустимый служебный ключ в JSON.');
        pending.push({ value: child, depth: next.depth + 1 });
      }
    }
  }
}

function validateImported(snapshot: ScheduleSnapshot) {
  if (!snapshot.id.trim() || snapshot.id.length > 160 || !snapshot.name.trim() || snapshot.name.length > 100)
    throw new Error('У снимка отсутствует название/идентификатор или превышена их длина.');
  const { request, result } = snapshot;
  if (request.rootProcessId !== result.rootProcessId || request.direction !== result.direction ||
      Date.parse(request.anchorDate) !== Date.parse(result.anchorDate)) throw new Error('Параметры и результат снимка относятся к разным расчётам.');
  if (Date.parse(result.startAt) > Date.parse(result.endAt)) throw new Error('Окончание расчёта раньше начала.');
  if (!result.processes.length || result.processes.length > 200 || result.dependencies.length > 5000 || result.issues.length > 10000)
    throw new Error('Недопустимое количество процессов, связей или замечаний.');
  const ids = new Set(result.processes.map(item => item.processId));
  if (ids.size !== result.processes.length || !ids.has(request.rootProcessId)) throw new Error('Повторяющиеся процессы или отсутствующий корневой процесс.');
  if (result.processes.some(item => !item.processId || Date.parse(item.startAt) > Date.parse(item.endAt) || item.durationHours < 0 || item.baseDurationHours < 0))
    throw new Error('Некорректные даты, идентификатор или отрицательная длительность процесса.');
  if (result.dependencies.some(item => !ids.has(item.sourceProcessId) || !ids.has(item.targetProcessId)))
    throw new Error('Связь ссылается на процесс вне расчётной цепочки.');
  for (const options of [request, result.assumptions]) {
    if (options.durationScalePercent < 1 || options.durationScalePercent > 1000 || options.transferDelayHours < 0 || options.transferDelayHours > 10000)
      throw new Error('Коэффициент или задержка вне допустимых границ.');
    for (const calendar of [options, ...Object.values(options.processCalendars ?? {})]) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(calendar.workdayStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(calendar.workdayEnd) ||
        calendar.workdayStart >= calendar.workdayEnd || !calendar.workingDays.length || calendar.workingDays.length > 7 ||
        new Set(calendar.workingDays).size !== calendar.workingDays.length ||
        !Number.isInteger(calendar.utcOffsetMinutes ?? 0) || Math.abs(calendar.utcOffsetMinutes ?? 0) > 840 ||
        calendar.nonWorkingDates.some(value => !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))
        throw new Error('Некорректный рабочий календарь.');
    }
  }
}

export function readScheduleTransfer(raw: string): ScheduleSnapshot[] {
  if (raw.length > 2_000_000) throw new Error('Файл превышает 2 млн символов.');
  let value: unknown;
  try { value = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw new Error('Не удалось прочитать JSON.'); }
  inspect(value);
  let snapshots: unknown;
  if (record(value) && value.format === 'process-navigator.schedule') {
    if (value.formatVersion !== 1) throw new Error('Версия файла расчётов не поддерживается.');
    snapshots = value.snapshots;
  } else if (record(value) && 'request' in value && 'result' in value) snapshots = [value]; // legacy single export
  else throw new Error('Это не файл снимков расчёта Process Navigator.');
  const parsed = parseScheduleSnapshots(JSON.stringify(snapshots));
  if (!parsed.length) throw new Error('Файл не содержит снимков.');
  if (new Set(parsed.map(item => item.id)).size !== parsed.length) throw new Error('В файле повторяются идентификаторы снимков.');
  parsed.forEach(validateImported);
  return parsed;
}

export function exportScheduleTransfer(snapshots: ScheduleSnapshot[]) {
  serializeScheduleSnapshots(snapshots);
  const raw = JSON.stringify({ format: 'process-navigator.schedule', formatVersion: 1, snapshots });
  readScheduleTransfer(raw);
  return raw;
}

function content(snapshot: ScheduleSnapshot) {
  // Canonical object keys: a formatted/reordered export is still the same snapshot.
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical({ name: snapshot.name, savedAt: snapshot.savedAt, request: snapshot.request, result: snapshot.result }));
}

export function mergeScheduleTransfer(existing: ScheduleSnapshot[], imported: ScheduleSnapshot[], createId: () => string) {
  const seen = new Set(existing.map(content));
  const added: ScheduleSnapshot[] = [];
  let skipped = 0;
  for (const snapshot of imported) {
    const key = content(snapshot);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const id = createId();
    if ([...existing, ...added].some(item => item.id === id)) throw new Error('Не удалось создать уникальный идентификатор снимка.');
    added.push({ ...structuredClone(snapshot), id });
  }
  const next = [...existing, ...added];
  serializeScheduleSnapshots(next); // all-or-nothing capacity check; never evict existing snapshots
  return { next, added: added.length, skipped };
}
