import test from 'node:test';
import assert from 'node:assert/strict';
import { compareScheduleSnapshots, parseScheduleSnapshots, scheduleStorageKey, serializeScheduleSnapshots } from '../src/schedule-snapshots.ts';
const request = { rootProcessId: 'p', direction: 'Forward', anchorDate: '2026-10-19T06:00:00Z', includeWaitTime: true, workdayStart: '09:00', workdayEnd: '17:00', workingDays: [1,2,3,4,5], nonWorkingDates: [], durationScalePercent: 100, transferDelayHours: 0, processDurationScalePercent: {}, checkpoints: {}, utcOffsetMinutes: 180, processCalendars: {} };
const process = { processId: 'p', processName: 'Демо', startAt: '2026-10-19T06:00:00Z', endAt: '2026-10-19T14:00:00Z', durationHours: 8, baseDurationHours: 8, appliedDurationScalePercent: 100, slackHours: 0, uncertaintyReasons: [], missingDurationCount: 0, hasInternalCycle: false, isDateReliable: true, isCritical: true, isCheckpointMissed: false };
const result = { rootProcessId: 'p', direction: 'Forward', anchorDate: request.anchorDate, startAt: process.startAt, endAt: process.endAt, assumptions: request, processes: [process], dependencies: [], issues: [], durationHours: 8, criticalDurationHours: 8, complete: true, sources: { algorithm: 'test', capturedAt: request.anchorDate, processes: [{ id: 'p', name: 'Демо', version: '1', status: 'Published' }], objects: [] } };
const saved = { id: 'snapshot', name: 'План', savedAt: request.anchorDate, request, result };
test('snapshot retains full parameters, offset and source versions', () => {
  assert.deepEqual(parseScheduleSnapshots(serializeScheduleSnapshots([saved])), [saved]);
  assert.deepEqual(parseScheduleSnapshots(null), []);
});
test('corrupted state is rejected rather than overwritten silently', () => {
  for (const value of ['{', '{}', '[null]', JSON.stringify([{ ...saved, result: { ...result, processes: [{ ...process, uncertaintyReasons: null }] } }]), JSON.stringify([{ ...saved, request: { ...request, checkpoints: { p: 'bad' } } }])]) assert.throws(() => parseScheduleSnapshots(value));
});
test('storage limits enforce ten snapshots and bounded payload', () => {
  assert.throws(() => serializeScheduleSnapshots(Array(11).fill(saved)));
  assert.throws(() => serializeScheduleSnapshots([{ ...saved, name: 'x'.repeat(2_000_000) }]));
});
test('profile keys are separate and safe for unusual identifiers', () => {
  assert.notEqual(scheduleStorageKey('a'), scheduleStorageKey('b'));
  assert.equal(scheduleStorageKey('a/b'), 'pn.schedule.v1:a%2Fb');
});
test('comparison distinguishes added and removed processes and calendar hour delta', () => {
  const current = { ...result, processes: [{ ...process, endAt: '2026-10-20T14:00:00Z', durationHours: 10 }, { ...process, processId: 'new' }] };
  const diff = compareScheduleSnapshots({ ...result, processes: [process, { ...process, processId: 'removed' }] }, current);
  assert.equal(diff[0].finishDeltaHours, 24);
  assert.equal(diff[0].durationDeltaHours, 2);
  assert.equal(diff[1].state, 'added');
  assert.equal(diff[2].state, 'removed');
});
test('changed source model is detected even if version label was not changed', () => {
  const different = { ...result, sources: { ...result.sources, processes: [{ ...result.sources.processes[0], name: 'Другое имя' }] } };
  assert.equal(compareScheduleSnapshots(result, different)[0].sourceChanged, true);
  assert.equal(compareScheduleSnapshots(result, result)[0].sourceChanged, false);
  assert.equal(compareScheduleSnapshots({ ...result, sources: undefined }, result)[0].sourceChanged, undefined);
});
