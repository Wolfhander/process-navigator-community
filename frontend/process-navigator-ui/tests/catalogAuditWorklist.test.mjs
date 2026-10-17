import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalogAuditWorkItems } from '../src/catalog-audit-worklist.ts';

const issue = (severity, category, message) => ({ code: message, severity, category, message });
const process = (name, issues) => ({ processId: name, processName: name, edition: 'Draft', fileName: `${name}.bpmn`, openable: true, hasDraft: true, qualityStatus: 'Incomplete', errorCount: 0, warningCount: issues.length, issues });

test('catalog work list puts blocking errors before recommendations', () => {
  const result = buildCatalogAuditWorkItems([
    process('Бета', [issue('Warning', 'Description', 'описание')]),
    process('Альфа', [issue('Error', 'Information', 'нет источника')]),
  ]);
  assert.deepEqual(result.map(item => item.issue.severity), ['Error', 'Warning']);
  assert.equal(result[0].item.processName, 'Альфа');
});

test('catalog work list filters by quality category', () => {
  const result = buildCatalogAuditWorkItems([
    process('Процесс', [issue('Error', 'Information', 'нет источника'), issue('Warning', 'Description', 'нет норматива')]),
  ], 'Information');
  assert.equal(result.length, 1);
  assert.equal(result[0].issue.message, 'нет источника');
});
