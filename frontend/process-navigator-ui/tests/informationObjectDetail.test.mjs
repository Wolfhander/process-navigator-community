import test from 'node:test';
import assert from 'node:assert/strict';
import { informationObjectVersions, occurrenceDetails } from '../src/information-object-detail.ts';

test('observed versions are distinct, numerically sorted, and omit absent values', () => {
  assert.deepEqual(informationObjectVersions({ version: '2', producers: [{ version: '10' }, { version: '2' }], consumers: [{ version: '1' }, {}], references: [{ version: '' }] }), ['1', '2', '10']);
});

test('step details use its lane binding and do not confuse process systems with step systems', () => {
  const occurrence = { processId: 'p', scope: 'Step', elementId: 's' };
  const model = { nodes: [{ id: 's', laneId: 'l', systemName: 'CAD', channels: [{ kind: 'system', systemName: 'PLM' }] }], passport: { systems: ['ERP'] } };
  const org = { crossCompanyProcesses: [{ processId: 'p', laneOrganizations: [{ laneId: 'l', legalEntityId: 'org', unitId: 'unit' }] }], legalEntities: [{ id: 'org', name: 'Компания', units: [{ id: 'unit', name: 'Конструкторский отдел' }] }] };
  const result = occurrenceDetails(occurrence, model, org);
  assert.equal(result.available, true);
  assert.deepEqual(result.systems, ['CAD', 'PLM']);
  assert.equal(result.responsibility, 'Конструкторский отдел · Компания');
});

test('missing models or steps remain explicitly unavailable', () => {
  assert.equal(occurrenceDetails({ scope: 'Step', elementId: 'missing' }, { nodes: [], passport: { systems: ['ERP'] } }).available, false);
  assert.deepEqual(occurrenceDetails({ scope: 'Step', elementId: 'missing' }, { nodes: [], passport: { systems: ['ERP'] } }).systems, []);
  assert.equal(occurrenceDetails({ scope: 'Process' }).available, false);
});
