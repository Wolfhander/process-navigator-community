import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
const compiled = await transformWithOxc(readFileSync(new URL('../src/schedule-transfer.ts', import.meta.url), 'utf8'), 'schedule-transfer.ts');
const code = compiled.code.replace(/from (["'])\.\/schedule-snapshots\1/, 'from ' + JSON.stringify(new URL('../src/schedule-snapshots.ts', import.meta.url).href));
const { exportScheduleTransfer, readScheduleTransfer, mergeScheduleTransfer } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const request = { rootProcessId: 'p', direction: 'Forward', anchorDate: '2026-10-19T06:00Z', includeWaitTime: true,
  workdayStart: '09:00', workdayEnd: '17:00', workingDays: [1,2,3,4,5], nonWorkingDates: [], utcOffsetMinutes: 180,
  durationScalePercent: 100, transferDelayHours: 0, processDurationScalePercent: {}, checkpoints: {} };
const item = { processId: 'p', processName: 'Расчёт', startAt: request.anchorDate, endAt: '2026-10-19T14:00Z',
  durationHours: 8, baseDurationHours: 8, appliedDurationScalePercent: 100, slackHours: 0, uncertaintyReasons: [], missingDurationCount: 0,
  hasInternalCycle: false, isDateReliable: true, isCritical: true, isCheckpointMissed: false };
const snapshot = { id: 'original', name: 'Сценарий', savedAt: request.anchorDate, request, result: {
  rootProcessId: 'p', direction: 'Forward', anchorDate: request.anchorDate, startAt: item.startAt, endAt: item.endAt,
  assumptions: request, processes: [item], dependencies: [], issues: [], durationHours: 8, criticalDurationHours: 8, complete: true } };
const envelope = snapshots => JSON.stringify({ format: 'process-navigator.schedule', formatVersion: 1, snapshots });
test('new package and legacy single export round-trip without losing snapshot data', () => {
  assert.deepEqual(readScheduleTransfer(exportScheduleTransfer([snapshot])), [snapshot]);
  assert.deepEqual(readScheduleTransfer('\uFEFF' + JSON.stringify(snapshot)), [snapshot]);
});
test('rejects unsupported formats, duplicate IDs, bad JSON and empty packages', () => {
  for (const raw of ['{', '[]', '{}', 'null', envelope([]), envelope([snapshot, snapshot]),
    JSON.stringify({ format: 'process-navigator.schedule', formatVersion: 99, snapshots: [snapshot] })]) assert.throws(() => readScheduleTransfer(raw));
});
test('external structure is bounded and prototype-related keys are never accepted', () => {
  assert.throws(() => readScheduleTransfer(' '.repeat(2_000_001)));
  assert.throws(() => readScheduleTransfer('{"__proto__":{"polluted":true}}'));
  let nested = {};
  for (let index = 0; index < 70; index++) nested = { next: nested };
  assert.throws(() => readScheduleTransfer(JSON.stringify({ ...snapshot, nested })));
  assert.equal({}.polluted, undefined);
});
test('inconsistent request, chronology, missing roots and dangling dependencies rejected before preview', () => {
  const variants = [
    { ...snapshot, result: { ...snapshot.result, direction: 'Backward' } },
    { ...snapshot, result: { ...snapshot.result, rootProcessId: 'other' } },
    { ...snapshot, result: { ...snapshot.result, endAt: '2026-10-18T06:00Z' } },
    { ...snapshot, result: { ...snapshot.result, processes: [item, item] } },
    { ...snapshot, result: { ...snapshot.result, dependencies: [{ sourceProcessId: 'p', targetProcessId: 'missing', objectName: 'Документ' }] } },
    { ...snapshot, name: '' },
    { ...snapshot, result: { ...snapshot.result, processes: [{ ...item, durationHours: -1 }] } }
  ];
  for (const value of variants) assert.throws(() => readScheduleTransfer(JSON.stringify(value)));
});
test('invalid calendars and non-existent dates rejected', () => {
  for (const patch of [{ workingDays: [] }, { workingDays: [1,1] }, { workdayEnd: '08:00' }, { workdayStart: '25:00' },
    { utcOffsetMinutes: 841 }, { nonWorkingDates: ['2026-02-31'] }, { durationScalePercent: 0 }])
    assert.throws(() => readScheduleTransfer(JSON.stringify({ ...snapshot, request: { ...request, ...patch } })));
});
test('merge regenerates imported IDs, leaves inputs untouched and never overwrites a matching ID', () => {
  const different = { ...snapshot, name: 'Другой сценарий' };
  const before = JSON.stringify([snapshot, different]);
  const merged = mergeScheduleTransfer([snapshot], [different], () => 'new-id');
  assert.equal(merged.next.length, 2);
  assert.equal(merged.next[1].id, 'new-id');
  assert.equal(merged.next[0], snapshot);
  assert.equal(JSON.stringify([snapshot, different]), before);
  assert.throws(() => mergeScheduleTransfer([snapshot], [different], () => snapshot.id));
});
test('exact repeated content is skipped even with another ID or reordered JSON keys', () => {
  const reordered = { ...snapshot, id: 'different', request: Object.fromEntries(Object.entries(request).reverse()) };
  const merged = mergeScheduleTransfer([snapshot], [reordered], () => { throw new Error('Duplicate needs no new ID'); });
  assert.equal(merged.added, 0); assert.equal(merged.skipped, 1);
});
test('capacity errors do not evict existing scenarios or partially import', () => {
  const existing = Array.from({ length: 10 }, (_, index) => ({ ...snapshot, id: 's' + index, name: 'Сценарий ' + index }));
  const before = JSON.stringify(existing);
  assert.throws(() => mergeScheduleTransfer(existing, [snapshot], () => 'added'));
  assert.equal(JSON.stringify(existing), before);
});
