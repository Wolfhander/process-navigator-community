import assert from 'node:assert/strict';
import test from 'node:test';
import { auditWorkItemsCsv, buildCatalogAuditWorkItems, matchesAuditIssue } from '../src/catalog-audit-worklist.ts';

const issue = (severity, category, message) => ({ code: message, severity, category, message });
const process = (name, issues) => ({ processId: name, processName: name, edition: 'Draft', fileName: `${name}.bpmn`, openable: true, hasDraft: true, qualityStatus: 'Incomplete', errorCount: 0, warningCount: issues.length, issues });

test('filtered CSV preserves Unicode and quotes and neutralizes spreadsheet formulas', () => {
  const item = process('=unsafe', [issue('Error', 'Information', 'Нет "источника";\nуточнить')]);
  const csv = auditWorkItemsCsv(buildCatalogAuditWorkItems([item]));
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"'=unsafe"/);
  assert.match(csv, /Нет ""источника"";\nуточнить/);
  assert.equal(auditWorkItemsCsv([]).split('\r\n').length, 1);
});

test('catalog work list puts blocking errors before recommendations', () => {
  const result = buildCatalogAuditWorkItems([
    process('Бета', [issue('Warning', 'Description', 'описание')]),
    process('Альфа', [issue('Error', 'Information', 'нет источника')]),
  ]);
  assert.deepEqual(result.map(item => item.issue.severity), ['Error', 'Warning']);
  assert.equal(result[0].item.processName, 'Альфа');
});

test('errors-only view excludes recommendations in the same process', () => {
  const item = process('Процесс', [issue('Error', 'Information', 'источник'), issue('Warning', 'Description', 'норматив')]);
  assert.equal(buildCatalogAuditWorkItems([item], '', true).length, 1);
  assert.equal(matchesAuditIssue(item, item.issues[1], '', true), false);
  assert.equal(buildCatalogAuditWorkItems([item], 'Description', true).length, 0);
});

test('issue search does not leak unrelated issues from matching processes', () => {
  const item = process('Закупка', [issue('Error', 'Information', 'источник'), issue('Warning', 'Description', 'норматив')]);
  assert.equal(buildCatalogAuditWorkItems([item], '', false, ' НОРМАТИВ ').length, 1);
  assert.equal(buildCatalogAuditWorkItems([item], '', true, 'норматив').length, 0);
  assert.equal(buildCatalogAuditWorkItems([item], '', false, 'закупка').length, 2);
});

test('catalog work list filters by quality category', () => {
  const result = buildCatalogAuditWorkItems([
    process('Процесс', [issue('Error', 'Information', 'нет источника'), issue('Warning', 'Description', 'нет норматива')]),
  ], 'Information');
  assert.equal(result.length, 1);
  assert.equal(result[0].issue.message, 'нет источника');
});
