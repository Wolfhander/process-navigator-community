import assert from 'node:assert/strict';
import test from 'node:test';
import { activeMinutes, stepTiming } from '../src/execution-timing.ts';

const instance = {
  id: 'i', processId: 'p', processVersion: '1', name: 'Run', status: 'Active',
  startedAt: '2026-10-08T08:00:00Z', startedBy: 'u', steps: [],
  lifecycleEvents: [
    { action: 'pause', fromStatus: 'Active', toStatus: 'Paused', occurredAt: '2026-10-08T09:00:00Z', userId: 'u' },
    { action: 'resume', fromStatus: 'Paused', toStatus: 'Active', occurredAt: '2026-10-08T10:00:00Z', userId: 'u' }
  ]
};

test('active time excludes completed pauses from queue and work', () => {
  assert.equal(activeMinutes(instance, '2026-10-08T08:00:00Z', '2026-10-08T11:00:00Z'), 120);
});

test('step plan fact separates queue and work and reports overdue', () => {
  const result = stepTiming(instance, {
    elementId: 'task', status: 'Completed', iteration: 1,
    availableAt: '2026-10-08T08:00:00Z', startedAt: '2026-10-08T08:30:00Z', completedAt: '2026-10-08T11:00:00Z',
    plannedDurationMinutes: 90
  });
  assert.equal(result.queue, 30);
  assert.equal(result.work, 90);
  assert.equal(result.total, 120);
  assert.equal(result.overdue, 30);
});

test('stored completion facts stay stable when current time changes', () => {
  const result = stepTiming(instance, {
    elementId: 'task', status: 'Completed', iteration: 1,
    actualQueueMinutes: 12, actualWorkMinutes: 48, actualDurationMinutes: 60, overdueMinutes: 5
  }, Date.UTC(2030, 0, 1));
  assert.deepEqual(result, { queue: 12, work: 48, total: 60, overdue: 5 });
});
