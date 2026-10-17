import test from 'node:test';
import assert from 'node:assert/strict';
import { compareScheduleFact } from '../src/schedule-fact.ts';
const plan = { processId: 'p', startAt: '2026-10-17T09:00Z', endAt: '2026-10-17T17:00Z' };
const instance = { processId: 'p', startedAt: '2026-10-17T10:00Z', status: 'Active' };
test('completed comparison uses final timestamp, not current time', () => {
  assert.deepEqual(compareScheduleFact(plan, { ...instance, status: 'Completed', completedAt: '2026-10-17T16:00Z' }, '2026-10-20T17:00Z'), { state: 'completed', startDeltaHours: 1, finishDeltaHours: -1 });
});
test('active and paused compare calendar deadline including nonworking days', () => {
  for (const status of ['Active', 'Paused']) assert.equal(compareScheduleFact(plan, { ...instance, status }, '2026-10-19T17:00Z').finishDeltaHours, 48);
  assert.equal(compareScheduleFact(plan, instance, '2026-10-17T12:00Z').finishDeltaHours, 0);
});
test('cancelled and missing completion date are not completion facts', () => {
  assert.equal(compareScheduleFact(plan, { ...instance, status: 'Cancelled', completedAt: '2026-10-19T17:00Z' }, '').finishDeltaHours, null);
  assert.equal(compareScheduleFact(plan, { ...instance, status: 'Completed' }, '').state, 'missing-fact');
});
test('rejects wrong process and invalid chronology', () => {
  assert.throws(() => compareScheduleFact(plan, { ...instance, processId: 'other' }, ''));
  assert.throws(() => compareScheduleFact({ ...plan, endAt: 'bad' }, instance, ''));
  assert.throws(() => compareScheduleFact({ ...plan, endAt: '2026-10-16T17:00Z' }, instance, ''));
  assert.throws(() => compareScheduleFact(plan, { ...instance, status: 'Completed', completedAt: '2026-10-16T17:00Z' }, ''));
});
test('does not modify instance or normative step plan', () => {
  const value = { ...instance, steps: [{ plannedCompletedAt: '2026-10-18T00:00Z' }] };
  const before = JSON.stringify(value);
  compareScheduleFact(plan, value, '2026-10-18T17:00Z');
  assert.equal(JSON.stringify(value), before);
});
