import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReferenceObjects, reconcileInformationObjects } from '../src/information-reconciliation.ts';
const item = { id: 'doc', name: 'Чертёж', kind: 'Document', aliases: ['Модель'], producers: [{ processId: 'demo' }], consumers: [], references: [] };
test('reference format accepts BOM and trims fields', () => {
  assert.deepEqual(parseReferenceObjects('\uFEFF[{"name":" Чертёж ","id":" doc ","kind":"Document"}]'), [{ id: 'doc', name: 'Чертёж', kind: 'Document' }]);
});
test('invalid or repeated references reject the entire input', () => {
  for (const value of ['{}', '[]', '[null]', '[{"name":""}]', '[{"name":"x","kind":"file"}]', '[{"name":"a","id":"X"},{"name":"b","id":"x"}]', '[{"name":" Чертёж "},{"name":"чертеж"}]']) assert.throws(() => parseReferenceObjects(value));
  assert.throws(() => parseReferenceObjects(' '.repeat(1_000_001)));
});
test('explicit unknown ID never falls back to name', () => {
  const result = reconcileInformationObjects([{ id: 'missing', name: 'Чертёж' }], [item]);
  assert.equal(result.rows[0].status, 'missing');
  assert.equal(result.unlisted.length, 1);
});
test('name aliases match exactly with normalization, never fuzzy', () => {
  assert.equal(reconcileInformationObjects([{ name: ' модель ' }], [item]).rows[0].status, 'matched');
  assert.equal(reconcileInformationObjects([{ name: 'Чертеж' }], [item]).rows[0].status, 'matched');
  assert.equal(reconcileInformationObjects([{ name: 'Черт' }], [item]).rows[0].status, 'missing');
});
test('ambiguous aliases remain unconfirmed and uncovered', () => {
  const result = reconcileInformationObjects([{ name: 'Модель' }], [item, { ...item, id: 'other' }]);
  assert.equal(result.rows[0].status, 'ambiguous');
  assert.equal(result.unlisted.length, 2);
});
test('ID match exposes name/type mismatches and absent process usage', () => {
  const result = reconcileInformationObjects([{ id: 'doc', name: 'Другое', kind: 'Result' }], [{ ...item, producers: [] }]);
  assert.equal(result.rows[0].status, 'matched');
  assert.equal(result.rows[0].issues.length, 3);
});
test('demo list covers object but leaves unlisted objects intact', () => {
  const original = JSON.stringify(item);
  const result = reconcileInformationObjects([{ id: 'doc', name: 'Чертёж', kind: 'Document' }], [item, { ...item, id: 'extra' }]);
  assert.equal(result.rows[0].issues.length, 0);
  assert.deepEqual(result.unlisted.map(value => value.id), ['extra']);
  assert.equal(JSON.stringify(item), original);
});
