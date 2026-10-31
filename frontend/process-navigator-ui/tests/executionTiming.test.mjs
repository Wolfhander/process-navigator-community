import assert from 'node:assert/strict';
import test from 'node:test';
import { activeMinutes, stepTiming } from '../src/execution-timing.ts';
import {readFileSync} from 'node:fs';

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
test('same persisted master cases match the server for pauses, cancellation, null norms and unknown stop time',()=>{
 const spec=JSON.parse(readFileSync(new URL('../../../master-data/execution-timing-fixture.json',import.meta.url),'utf8'));
 for(const c of spec.cases){
   const value=stepTiming({...instance,status:c.status,lifecycleEvents:c.events},c.step,Date.parse(c.now));
   assert.deepEqual(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,v??null])),c.expected,c.id);
 }
});
test('zero or absent norm is unknown, not a zero-minute SLA, and cancelled facts never keep growing',()=>{
 const step={elementId:'task',status:'InProgress',availableAt:'2026-10-08T08:00Z',startedAt:'2026-10-08T08:30Z'};
 for(const plannedDurationMinutes of [null,undefined,0,NaN,Infinity,-1])assert.equal(stepTiming(instance,{...step,plannedDurationMinutes},Date.parse('2026-10-08T11:00Z')).overdue,undefined);
 const stopped={...instance,status:'Cancelled',lifecycleEvents:[{toStatus:'Cancelled',occurredAt:'2026-10-08T09:00Z'}]};
 assert.deepEqual(stepTiming(stopped,step,Date.parse('2030-01-01')),stepTiming(stopped,step,Date.parse('2040-01-01')));
});
