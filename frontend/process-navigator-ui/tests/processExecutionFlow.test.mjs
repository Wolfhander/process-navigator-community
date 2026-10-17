import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExecutionGuidance, buildReturnStepOptions } from '../src/process-execution-flow.ts';

const node = (id, type = 'task', name = id) => ({ id, type, name, laneId: 'lane', x: 0, y: 0, width: 100, height: 60 });
const edge = (sourceId, targetId) => ({ id: `${sourceId}-${targetId}`, sourceId, targetId, points: [] });
const process = (nodes, edges) => ({ id: 'p', name: 'P', version: '1', owner: '', status: 'Published', lanes: [], nodes, edges });
const instance = (states) => ({ id: 'i', processId: 'p', processVersion: '1', name: 'Run', status: 'Active', startedAt: '', startedBy: 'u', steps: Object.entries(states).map(([elementId, status]) => ({ elementId, status })) });

test('only the first task is available before execution starts', () => {
  const model = process([node('start', 'startEvent'), node('a', 'task', 'Подготовить'), node('b', 'task', 'Проверить')], [edge('start', 'a'), edge('a', 'b')]);
  const result = buildExecutionGuidance(model, instance({ a: 'NotStarted', b: 'NotStarted' }));
  assert.deepEqual(result.availableStepIds, ['a']);
  assert.deepEqual(result.steps.b.blockerNames, ['Подготовить']);
});

test('completion unlocks the next task', () => {
  const model = process([node('start', 'startEvent'), node('a'), node('b')], [edge('start', 'a'), edge('a', 'b')]);
  const result = buildExecutionGuidance(model, instance({ a: 'Completed', b: 'NotStarted' }));
  assert.deepEqual(result.availableStepIds, ['b']);
});

test('exclusive split exposes its alternative branches after the preceding task', () => {
  const model = process([node('start', 'startEvent'), node('a'), node('gate', 'exclusiveGateway'), node('b'), node('c')], [edge('start', 'a'), edge('a', 'gate'), edge('gate', 'b'), edge('gate', 'c')]);
  const result = buildExecutionGuidance(model, instance({ a: 'Completed', b: 'NotStarted', c: 'NotStarted' }));
  assert.deepEqual(result.availableStepIds, ['b', 'c']);
});

test('a skipped alternative is not offered and a completed chosen branch unlocks the merge', () => {
  const model = process([node('start', 'startEvent'), node('a'), node('gate', 'exclusiveGateway'), node('b'), node('c'), node('merge', 'exclusiveGateway'), node('d')], [edge('start', 'a'), edge('a', 'gate'), edge('gate', 'b'), edge('gate', 'c'), edge('b', 'merge'), edge('c', 'merge'), edge('merge', 'd')]);
  const result = buildExecutionGuidance(model, instance({ a: 'Completed', b: 'Completed', c: 'Skipped', d: 'NotStarted' }));
  assert.deepEqual(result.availableStepIds, ['d']);
  assert.equal(result.steps.c.available, false);
});

test('parallel split exposes every branch but join waits for all branches', () => {
  const model = process([
    node('start', 'startEvent'), node('prepare'), node('split', 'parallelGateway'), node('legal'), node('finance'),
    node('join', 'parallelGateway'), node('release')
  ], [
    edge('start', 'prepare'), edge('prepare', 'split'), edge('split', 'legal'), edge('split', 'finance'),
    edge('legal', 'join'), edge('finance', 'join'), edge('join', 'release')
  ]);
  const opened = buildExecutionGuidance(model, instance({ prepare: 'Completed', legal: 'NotStarted', finance: 'NotStarted', release: 'NotStarted' }));
  assert.deepEqual(opened.availableStepIds, ['legal', 'finance']);

  const waiting = buildExecutionGuidance(model, instance({ prepare: 'Completed', legal: 'Completed', finance: 'NotStarted', release: 'NotStarted' }));
  assert.equal(waiting.steps.release.available, false);
  assert.deepEqual(waiting.steps.release.blockerNames, ['finance']);

  const joined = buildExecutionGuidance(model, instance({ prepare: 'Completed', legal: 'Completed', finance: 'Completed', release: 'NotStarted' }));
  assert.deepEqual(joined.availableStepIds, ['release']);
});

test('cycles do not cause recursion overflow and remain blocked without a completed predecessor', () => {
  const model = process([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);
  const result = buildExecutionGuidance(model, instance({ a: 'NotStarted', b: 'NotStarted' }));
  assert.deepEqual(result.availableStepIds, []);
});

test('return options contain only completed predecessor tasks ordered from nearest to farthest', () => {
  const model = process([node('start', 'startEvent'), node('prepare', 'task', 'Подготовить'), node('review', 'task', 'Проверить'), node('approve', 'task', 'Утвердить')], [edge('start', 'prepare'), edge('prepare', 'review'), edge('review', 'approve')]);
  const run = instance({ prepare: 'Completed', review: 'Completed', approve: 'InProgress' });
  assert.deepEqual(buildReturnStepOptions(model, run, 'approve').map(item => item.elementId), ['review', 'prepare']);
  assert.deepEqual(buildReturnStepOptions(model, run, 'prepare'), []);
});

test('paused and cancelled instances expose no executable or returnable steps', () => {
  const model = process([node('start', 'startEvent'), node('prepare'), node('review')], [edge('start', 'prepare'), edge('prepare', 'review')]);
  const paused = { ...instance({ prepare: 'Completed', review: 'NotStarted' }), status: 'Paused' };
  const cancelled = { ...paused, status: 'Cancelled' };
  assert.deepEqual(buildExecutionGuidance(model, paused).availableStepIds, []);
  assert.deepEqual(buildExecutionGuidance(model, cancelled).availableStepIds, []);
  assert.deepEqual(buildReturnStepOptions(model, { ...paused, steps: [{ elementId: 'prepare', status: 'Completed' }, { elementId: 'review', status: 'InProgress' }] }, 'review'), []);
});
