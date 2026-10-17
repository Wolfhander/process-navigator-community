import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const dataDirectory = resolve(import.meta.dirname, '../../../backend/ProcessNavigator.Api/Data');
const processIds = [
  'demo-showcase-l0',
  'demo-showcase-l1',
  'demo-showcase-l2-engineering',
  'demo-showcase-l3-documentation',
  'demo-showcase-l4-drawing',
  'demo-showcase-l2-procurement',
  'demo-showcase-l2-production',
  'demo-showcase-l3-quality'
];

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

test('showcase contains published models from level zero through level four', () => {
  const contexts = processIds.map(id => {
    assert.ok(existsSync(resolve(dataDirectory, `${id}.bpmn`)), `${id}.bpmn is missing`);
    return readJson(resolve(dataDirectory, `${id}.context.json`));
  });

  assert.deepEqual([...new Set(contexts.map(context => context.passport.level))].sort(), [0, 1, 2, 3, 4]);
  assert.ok(contexts.every(context => context.status === 'Published'));
  assert.ok(contexts.every(context => context.passport.scope.includes('Демонстрационный контур')));
});

test('showcase demonstrates nested models, organizations, systems and transfer channels', () => {
  const contexts = processIds.map(id => readJson(resolve(dataDirectory, `${id}.context.json`)));
  const organization = readJson(resolve(dataDirectory, 'organization.json'));
  const elements = contexts.flatMap(context => Object.values(context.elements));
  const channels = elements.flatMap(element => element.channels ?? []);
  const showcaseMappings = (organization.crossCompanyProcesses ?? [])
    .filter(process => processIds.includes(process.processId));

  assert.ok(elements.filter(element => element.linkedProcessId).length >= 7);
  assert.ok(new Set(showcaseMappings.flatMap(process => process.legalEntityIds)).size >= 3);
  assert.ok(new Set(contexts.map(context => context.ownerUnitId)).size >= 6);
  assert.ok(['1С:ERP', '1С:PLM', 'КОМПАС-3D'].every(system => channels.some(channel => channel.systemName === system)));
  assert.ok(['email', 'phone', 'paper', 'memo', 'meeting'].every(kind => channels.some(channel => channel.kind === kind)));
  assert.ok(['primary', 'alternative', 'parallel'].every(flow => channels.some(channel => channel.flow === flow)));
});

test('showcase includes a manual work action that can record an offline result', () => {
  const production = readJson(resolve(dataDirectory, 'demo-showcase-l2-production.context.json'));
  const actions = Object.values(production.elements).flatMap(element => element.actions ?? []);
  assert.ok(actions.some(action => action.kind === 'manual' && action.id === 'record-shift-result'));
});

test('receipt distinguishes an ERP user from an automatic system while both keep department ownership', () => {
  const context = readJson(resolve(dataDirectory, 'demo-showcase-l3-warehouse.context.json'));
  const organization = readJson(resolve(dataDirectory, 'organization.json'));
  const mapping = organization.crossCompanyProcesses.find(item => item.processId === 'demo-showcase-l3-warehouse');
  assert.equal(context.elements.Task_ReceiptOrder.executorKind, 'human');
  assert.equal(context.elements.Task_ReceiptOrder.executionMode, 'system');
  assert.equal(context.elements.Task_SystemNotice.executorKind, 'system');
  assert.equal(context.elements.Task_ReceiptOrder.systemName, context.elements.Task_SystemNotice.systemName);
  assert.match(context.elements.Task_SystemNotice.description, /подтверждается вручную/);
  for (const binding of mapping.laneOrganizations) {
    const entity = organization.legalEntities.find(item => item.id === binding.legalEntityId);
    assert.ok(entity.units.some(unit => unit.id === binding.unitId));
  }
});

test('organization maps every showcase model into its own direction', () => {
  const organization = readJson(resolve(dataDirectory, 'organization.json'));
  const mappedIds = new Set((organization.crossCompanyProcesses ?? [])
    .filter(process => processIds.includes(process.processId))
    .map(process => process.processId));

  assert.deepEqual([...mappedIds].sort(), [...processIds].sort());
  assert.ok(organization.legalEntities.every(entity =>
    entity.directions.some(direction => direction.id === 'demo-showcase' && direction.processIds.length > 0)));
});

test('showcase contains a schedulable interprocess document chain', () => {
  const engineering = readJson(resolve(dataDirectory, 'demo-showcase-l2-engineering.context.json'));
  const procurement = readJson(resolve(dataDirectory, 'demo-showcase-l2-procurement.context.json'));
  const production = readJson(resolve(dataDirectory, 'demo-showcase-l2-production.context.json'));
  const bindings = context => Object.values(context.elements).flatMap(element => element.informationObjects ?? []);
  const engineeringOutputs = bindings(engineering).filter(item => item.role === 'Output').map(item => item.objectId);
  const procurementOutputs = bindings(procurement).filter(item => item.role === 'Output').map(item => item.objectId);
  const productionInputs = bindings(production).filter(item => item.role === 'Input').map(item => item.objectId);

  assert.ok(engineeringOutputs.includes('demo-approved-documentation'));
  assert.ok(procurementOutputs.includes('demo-materials-available'));
  assert.ok(productionInputs.includes('demo-approved-documentation'));
  assert.ok(productionInputs.includes('demo-materials-available'));
});
