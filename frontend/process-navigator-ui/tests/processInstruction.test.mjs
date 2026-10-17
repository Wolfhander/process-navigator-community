import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProcessInstruction } from '../src/process-instruction.ts';
const node = (id, type = 'task') => ({ id, type, name: id, laneId: 'lane' });
const edge = (sourceId, targetId, label) => ({ id: sourceId + '-' + targetId, sourceId, targetId, label });
const process = { id: 'p', name: 'Процесс', version: '1', status: 'Published', lanes: [{ id: 'lane', name: 'Отдел' }],
  nodes: [node('s', 'startEvent'), node('a'), node('g', 'exclusiveGateway'), node('b'), node('c'), node('e', 'endEvent')],
  edges: [edge('s','a'), edge('a','g'), edge('g','b','Да'), edge('g','c','Нет'), edge('b','e'), edge('c','e')] };
test('instruction retains both alternatives and original edge labels without choosing execution route', () => {
  const before = JSON.stringify(process);
  const result = buildProcessInstruction(process);
  assert.deepEqual(result.tasks.map(item => item.id), ['a','b','c']);
  assert.equal(result.outgoing.get('g').length, 2);
  assert.equal(result.outgoing.get('g')[1].label, 'Нет');
  assert.equal(result.hasCycle, false);
  assert.equal(JSON.stringify(process), before);
});
test('cycles, missing targets and disconnected actions remain visible', () => {
  const result = buildProcessInstruction({ ...process, nodes: [...process.nodes, node('lost')], edges: [...process.edges, edge('c','a'), edge('b','missing')] });
  assert.equal(result.hasCycle, true);
  assert.deepEqual(result.unreachable, ['lost']);
  assert.equal(result.broken.length, 1);
  assert.ok(result.tasks.some(item => item.id === 'lost'));
});
test('parallel gateways are not converted into alternatives and rootless cycles are bounded', () => {
  const parallel = buildProcessInstruction({ ...process, nodes: process.nodes.map(item => item.id === 'g' ? { ...item, type: 'parallelGateway' } : item) });
  assert.equal(parallel.outgoing.get('g').length, 2);
  const cycle = buildProcessInstruction({ nodes: [node('a'),node('b')], edges: [edge('a','b'),edge('b','a')] });
  assert.equal(cycle.hasStart, false); assert.equal(cycle.hasCycle, true); assert.equal(cycle.unreachable.length, 2);
});
test('duplicate elements and oversized structures are rejected without modifying process', () => {
  assert.throws(() => buildProcessInstruction({ ...process, nodes: [...process.nodes, node('a')] }));
  assert.throws(() => buildProcessInstruction({ nodes: Array(5001).fill(node('a')), edges: [] }));
});
