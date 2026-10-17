import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeHierarchyUpdate } from '../src/process-hierarchy-update.ts';

const item = { id: 'child', name: 'Child', status: 'Draft', level: 3, classification: 'Основной', parentProcessId: 'parent', issues: [] };

test('clearing a parent is retained in the update sent to the server', () => {
  assert.equal(mergeHierarchyUpdate(item, { parentProcessId: undefined }).parentProcessId, undefined);
});

test('changing only the level preserves the existing parent', () => {
  assert.deepEqual(mergeHierarchyUpdate(item, { level: 4 }), { level: 4, classification: 'Основной', parentProcessId: 'parent' });
});
