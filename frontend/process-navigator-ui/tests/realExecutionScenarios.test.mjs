import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildExecutionGuidance, buildReturnStepOptions } from '../src/process-execution-flow.ts';

const dataDirectory = resolve(import.meta.dirname, '../../../backend/ProcessNavigator.Api/Data');
const decode = value => value?.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const attributes = value => Object.fromEntries([...value.matchAll(/([\w:]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]));

function readProcess(fileName) {
  const xml = readFileSync(resolve(dataDirectory, fileName), 'utf8');
  const nodes = [...xml.matchAll(/<bpmn:(startEvent|endEvent|task|exclusiveGateway|parallelGateway)\s+([^>]+)>/g)].map(match => {
    const value = attributes(match[2]);
    return { id: value.id, type: match[1], name: value.name ?? value.id, laneId: '', x: 0, y: 0, width: 0, height: 0 };
  });
  const edges = [...xml.matchAll(/<bpmn:sequenceFlow\s+([^>]+?)(?:\/>|>)/g)].map(match => {
    const value = attributes(match[1]);
    return { id: value.id, sourceId: value.sourceRef, targetId: value.targetRef, label: value.name, points: [] };
  });
  const process = attributes(xml.match(/<bpmn:process\s+([^>]+)>/)?.[1] ?? '');
  return { id: process.id, name: process.name, version: 'test', owner: '', status: 'Published', lanes: [], nodes, edges };
}

const instance = (model, states) => ({
  id: 'scenario', processId: model.id, processVersion: 'test', name: 'Предметная проверка', status: 'Active',
  startedAt: '2026-10-08T00:00:00Z', startedBy: 'test',
  steps: model.nodes.filter(node => node.type === 'task').map(node => ({ elementId: node.id, status: states[node.id] ?? 'NotStarted' }))
});

test('published production model opens both real parallel branches and waits for both', () => {
  const model = readProcess('demo-showcase-l2-production.bpmn');
  assert.equal(model.nodes.filter(node => node.type === 'parallelGateway').length, 2);
  const opened = buildExecutionGuidance(model, instance(model, { Task_ProductionOrder: 'Completed' }));
  assert.deepEqual(opened.availableStepIds.sort(), ['Task_Manufacture', 'Task_PrepareWarehouse']);

  const waiting = buildExecutionGuidance(model, instance(model, { Task_ProductionOrder: 'Completed', Task_Manufacture: 'Completed' }));
  assert.equal(waiting.steps.Task_Quality.available, false);
  assert.deepEqual(waiting.steps.Task_Quality.blockerNames, ['Подготовить склад к приёмке']);

  const joined = buildExecutionGuidance(model, instance(model, {
    Task_ProductionOrder: 'Completed', Task_Manufacture: 'Completed', Task_PrepareWarehouse: 'Completed'
  }));
  assert.deepEqual(joined.availableStepIds, ['Task_Quality']);
});

test('published purchase model preserves alternative labels and sequential blocking', () => {
  const model = readProcess('demo-showcase-l3-request.bpmn');
  const gateway = model.nodes.find(node => node.id === 'Gateway_RequestValid');
  const alternatives = model.edges.filter(edge => edge.sourceId === gateway?.id);
  assert.deepEqual(alternatives.map(edge => edge.label).sort(), ['Да', 'Нет — уточнить']);

  const initial = buildExecutionGuidance(model, instance(model, {}));
  assert.deepEqual(initial.availableStepIds, ['Task_CreateRequest']);
  const afterRequest = buildExecutionGuidance(model, instance(model, { Task_CreateRequest: 'Completed' }));
  assert.deepEqual(afterRequest.availableStepIds, ['Task_ReviewRequest']);
});

test('published purchase cycle exposes managed return targets for a real rework pass', () => {
  const model = readProcess('demo-showcase-l3-request.bpmn');
  assert.ok(model.edges.some(edge => edge.sourceId === 'Gateway_RequestValid' && edge.targetId === 'Task_CreateRequest'));
  const run = instance(model, {
    Task_CreateRequest: 'Completed', Task_ReviewRequest: 'Completed', Task_ApproveBudget: 'InProgress'
  });
  assert.deepEqual(buildReturnStepOptions(model, run, 'Task_ApproveBudget').map(item => item.elementId),
    ['Task_ReviewRequest', 'Task_CreateRequest']);
});
