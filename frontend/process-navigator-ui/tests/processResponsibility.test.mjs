import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResponsibilityView } from '../src/process-responsibility.ts';
const task = (id, laneId, type = 'task') => ({ id, laneId, type, name: id });
const edge = (sourceId, targetId, label = '') => ({ id: sourceId + ':' + targetId, sourceId, targetId, label });
const process = { id: 'p', lanes: [{ id:'a', name:'Первый' },{ id:'b', name:'Второй' }],
  nodes: [task('one','a'),task('g','a','exclusiveGateway'),task('two','b'),task('three','b')],
  edges: [edge('one','g'),edge('g','two','Да'),edge('g','three','Нет')] };
test('potential transfers traverse gateways without selecting a branch or skipping actions', () => {
  const before = JSON.stringify(process);
  const result = buildResponsibilityView(process);
  assert.deepEqual(result.transfers.map(item => item.toId), ['two','three']);
  assert.deepEqual(result.transfers[0].labels, ['Да']);
  assert.equal(JSON.stringify(process), before);
  const consecutive = buildResponsibilityView({ ...process, nodes: [task('one','a'),task('two','a'),task('three','b')], edges: [edge('one','two'),edge('two','three')] });
  assert.deepEqual(consecutive.transfers.map(item => [item.fromId,item.toId]), [['two','three']]);
});
test('parallel transfer is marked, loops do not run forever and missing links stay diagnosed', () => {
  const result = buildResponsibilityView({ ...process, nodes: process.nodes.map(node => node.id === 'g' ? { ...node, type:'parallelGateway' } : node), edges: [...process.edges,edge('g','one'),edge('two','missing')] });
  assert.equal(result.transfers.length, 2); assert.equal(result.transfers[0].throughParallel, true); assert.equal(result.broken, 1);
});
const organization = { legalEntities: [{ id:'e', name:'Организация', units:[{ id:'u', parentId:'v', name:'Отдел', shortName:'О' },{ id:'v', parentId:'u', name:'Управление', shortName:'У' }] }],
  crossCompanyProcesses:[{ processId:'p', laneOrganizations:[{ laneId:'a', legalEntityId:'e', unitId:'u' }] }] };
const assignments = { processId:'p', lanes:[{ laneId:'a', userIds:['person','missing'] }], users:[{ id:'person', displayName:'Участник', isActive:false }] };
test('cyclic unit hierarchy, inactive and missing users are explained without fabricating assignments', () => {
  const row = buildResponsibilityView(process, organization, assignments).rows[0];
  assert.equal(row.people.length, 1);
  assert.ok(row.warnings.some(value => value.includes('Цикл')));
  assert.ok(row.warnings.some(value => value.includes('отсутствует')));
  assert.ok(row.warnings.some(value => value.includes('неактивным')));
  const unresolved = buildResponsibilityView(process, organization, { ...assignments, users:[] }).rows[0];
  assert.equal(unresolved.assignedCount, 2); assert.equal(unresolved.people.length, 0);
  assert.ok(!unresolved.warnings.some(value => value.includes('никто не назначен')));
});
test('unloaded or wrong-process assignments are not reported as absent assignments', () => {
  const result = buildResponsibilityView(process, undefined, { ...assignments, processId:'other' });
  assert.equal(result.rows[0].people.length, 0); assert.deepEqual(result.rows[0].warnings, []);
});
test('deep paths are bounded with explicit incompleteness rather than invented handovers', () => {
  const gateways = Array.from({ length:205 }, (_,index) => task('g'+index,'a','exclusiveGateway'));
  const ids = ['one',...gateways.map(node=>node.id),'two'];
  const result = buildResponsibilityView({ ...process, nodes:[task('one','a'),...gateways,task('two','b')], edges:ids.slice(1).map((id,index)=>edge(ids[index],id)) });
  assert.equal(result.limited, true); assert.equal(result.transfers.length, 0);
});
test('duplicate node IDs reject construction', () => {
  assert.throws(() => buildResponsibilityView({ ...process, nodes:[task('one','a'),task('one','b')] }));
});
