import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { documentAnalytics, documentAnalyticsCsv, filterDocumentAnalytics } from '../src/document-analytics.ts';
const occurrence = (processId, version) => ({ processId, processName: processId, scope: 'Step', direction: 'Producer', required: true, version });
const object = (id, name, aliases = []) => ({ id, name, aliases, state: 'Связан', producers: [], consumers: [], references: [] });
const registry = objects => ({ generatedAt: '2026-10-18T00:00:00Z', objects, issues: [] });
test('same names and aliases identify candidates without merging distinct IDs or counting self aliases', () => {
  const result = documentAnalytics(registry([object('a', 'Документ', [' ДОКУМЕНТ ']), object('b', 'Другое', ['Документ'])]));
  assert.equal(result.length, 2); assert.deepEqual(result[0].duplicateIds, ['b']); assert.deepEqual(result[1].duplicateIds, ['a']);
});
test('rank uses occurrences not fabricated Cartesian transfers; process count is unique', () => {
  const a = object('a', 'А'); a.producers = [occurrence('p', '1'), occurrence('p', '1')]; a.consumers = [occurrence('q', '2'), occurrence('r')];
  const [row] = documentAnalytics(registry([a])); assert.equal(row.usageCount, 4); assert.equal(row.processCount, 3); assert.deepEqual(row.versions, ['1', '2']);
});
test('registry issues preserved; filters match source process and distinguish no results', () => {
  const a = object('a', 'А'); a.producers = [occurrence('PLM')]; const data = registry([a]);
  data.issues = [{ objectId: 'a', code: 'version-unverified', message: 'Уточнить версию' }];
  assert.equal(filterDocumentAnalytics(data, 'plm', true).length, 1); assert.equal(filterDocumentAnalytics(data, 'нет', false).length, 0);
  assert.equal(documentAnalytics(data)[0].issues[0].message, 'Уточнить версию');
});
test('CSV is formula safe, multiline quoted, has timestamp and structured endpoints', () => {
  const a = object('a', '=cmd\n"test"'); a.producers = [occurrence('p', '1')];
  const csv = documentAnalyticsCsv(registry([a])); assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("'=cmd")); assert.ok(csv.includes('""test""')); assert.ok(csv.includes('2026-10-18T00:00:00Z')); assert.ok(csv.includes('processId')); assert.equal(documentAnalyticsCsv(registry([a]), 'missing').split('\r\n').length, 1);
});
test('frozen master registry retains every object and exact structural usage totals', () => {
  const control = JSON.parse(readFileSync(new URL('../../../master-data/v1/registry-control.json', import.meta.url), 'utf8'));
  // Control contains expected counts, not a captured API response. Build only declared occurrences.
  const data = registry(control.map(c => ({ ...object(c.id, c.name), state: c.expectedState, producers: Array.from({length: c.producers ?? 0}, () => occurrence('master-source')), consumers: Array.from({length: c.consumers ?? 0}, () => occurrence('master-consumer')) })));
  const rows = documentAnalytics(data); assert.equal(rows.length, data.objects.length);
  assert.equal(rows.reduce((sum, row) => sum + row.usageCount, 0), data.objects.reduce((sum, row) => sum + row.producers.length + row.consumers.length, 0));
  assert.deepEqual(rows.find(row => row.object.id === 'md-source-package').duplicateIds, ['io-7938ce46ba0658d8']);
});
