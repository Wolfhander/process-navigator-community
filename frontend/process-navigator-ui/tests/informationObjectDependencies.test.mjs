import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProcessDependencies } from '../src/information-object-dependencies.ts';

const occurrence = (processId, processName, direction, required = true) => ({ processId, processName, scope: 'Process', direction, required });
const object = {
  id: 'document-order', name: 'Заказ', kind: 'Document', aliases: [], version: '1.0', lifecycleState: 'Active', managed: true, state: 'Связан',
  producers: [occurrence('source', 'Источник', 'Producer'), occurrence('source', 'Источник', 'Producer')],
  consumers: [occurrence('target', 'Получатель', 'Consumer'), occurrence('source', 'Источник', 'Consumer')], references: [],
};

test('process dependencies connect distinct processes and deduplicate occurrences', () => {
  const result = buildProcessDependencies([object], new Set(['document-order']));
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { sourceId: 'source', sourceName: 'Источник', targetId: 'target', targetName: 'Получатель', objects: [{ id: 'document-order', name: 'Заказ', kind: 'Document', required: true, hasIssue: true }] });
});

test('an object used only inside one process does not create an interprocess dependency', () => {
  assert.deepEqual(buildProcessDependencies([{ ...object, consumers: [occurrence('source', 'Источник', 'Consumer')] }]), []);
});
