import assert from 'node:assert/strict';
import test from 'node:test';
import { informationRelationLabel, missingInformationRelationLabel, relatedInformationOccurrences } from '../src/information-object-workflow.ts';

const occurrence = (processId, elementId, direction) => ({ processId, processName: processId, elementId, elementName: elementId, scope: 'Step', direction, required: true });
const object = {
  id: 'request', name: 'Заявка', kind: 'Document', aliases: [], version: '', lifecycleState: 'Observed', managed: false, state: 'Связан',
  producers: [occurrence('source', 'create', 'Producer'), occurrence('current', 'step', 'Producer')],
  consumers: [occurrence('target', 'approve', 'Consumer'), occurrence('current', 'step', 'Consumer'), occurrence('target', 'approve', 'Consumer')],
  references: [occurrence('archive', 'store', 'Reference')],
};

test('input shows producers and excludes the current step', () => {
  const result = relatedInformationOccurrences(object, 'Input', 'current', 'step');
  assert.deepEqual(result.map(item => item.elementId), ['create']);
});

test('output shows unique downstream consumers', () => {
  const result = relatedInformationOccurrences(object, 'Output', 'current', 'step');
  assert.deepEqual(result.map(item => item.elementId), ['approve']);
});

test('reference shows the whole related chain without duplicates', () => {
  const result = relatedInformationOccurrences(object, 'Reference', 'current', 'step');
  assert.deepEqual(result.map(item => item.elementId), ['create', 'approve', 'store']);
});

test('relation labels explain missing source and recipient', () => {
  assert.equal(informationRelationLabel('Input'), 'Создают до этого шага');
  assert.equal(missingInformationRelationLabel('Output'), 'Следующий получатель не найден');
});
