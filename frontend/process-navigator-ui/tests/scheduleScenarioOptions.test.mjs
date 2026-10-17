import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleScenarioOptions } from '../src/schedule-scenario-options.ts';
const model = { nodes: [{ id: 'body', type: 'task', name: 'Работа' }, { id: 'gate', type: 'exclusiveGateway', name: 'Проверка' }, { id: 'end', type: 'endEvent', name: 'Готово' }], edges: [{ id: 'work', sourceId: 'body', targetId: 'gate' }, { id: 'return', sourceId: 'gate', targetId: 'body', label: 'На доработку' }, { id: 'exit', sourceId: 'gate', targetId: 'end', label: 'Готово' }] };
test('only edges leading back to their source are repeat candidates', () => {
  const options = scheduleScenarioOptions(model);
  assert.equal(options.gateways.length, 1);
  assert.deepEqual(options.returns.map(edge => edge.id), ['return']);
});
test('parallel gateways are not presented as alternatives', () => {
  assert.equal(scheduleScenarioOptions({ ...model, nodes: model.nodes.map(node => ({ ...node, type: 'parallelGateway' })) }).gateways.length, 0);
});
test('large or old incomplete source snapshots do not trigger unbounded traversal', () => {
  assert.equal(scheduleScenarioOptions({ nodes: [] }).limited, true);
  assert.equal(scheduleScenarioOptions({ nodes: Array(10001).fill({}), edges: [] }).limited, true);
});
