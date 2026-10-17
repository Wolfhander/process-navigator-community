import test from 'node:test';
import assert from 'node:assert/strict';
import { informationObjectRoute } from '../src/information-object-route.ts';
const occurrence = { scope: 'Step', elementId: 'task', required: true, condition: 'При браке' };
const model = { nodes: [{ id: 'g', type: 'exclusiveGateway', name: 'Есть брак?' }, { id: 'task', type: 'task' }, { id: 'other', type: 'task' }], edges: [{ id: 'yes', sourceId: 'g', targetId: 'task', label: 'Да' }, { id: 'no', sourceId: 'g', targetId: 'other', label: 'Нет' }] };
test('conditional obligation and XOR branch are distinct facts', () => {
  const result = informationObjectRoute(occurrence, model);
  assert.equal(result.obligation, 'Обязателен при указанном условии');
  assert.deepEqual(result.branches, [{ id: 'yes', gateway: 'Есть брак?', label: 'Да' }]);
});
test('missing branch label stays explicit', () => {
  assert.equal(informationObjectRoute(occurrence, { ...model, edges: model.edges.map(e => ({ ...e, label: '' })) }).branches[0].label, 'Условие ветви не указано');
});
test('merged paths do not impose an earlier alternative on shared result', () => {
  assert.equal(informationObjectRoute(occurrence, { ...model, edges: [...model.edges, { id: 'merge', sourceId: 'other', targetId: 'task' }] }).branches.length, 0);
});
test('optional and unavailable process do not become mandatory', () => {
  assert.equal(informationObjectRoute({ ...occurrence, required: false }).obligation, 'Необязательный');
  assert.equal(informationObjectRoute(occurrence).branches.length, 0);
});
test('cycles terminate without invented branch', () => {
  assert.equal(informationObjectRoute(occurrence, { nodes: [{ id: 'task', type: 'task' }], edges: [{ id: 'loop', sourceId: 'task', targetId: 'task' }] }).branches.length, 0);
});
