import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTransfers, transfersCsv } from '../src/transfer-analytics.ts';
const finding = { processId: 'p', processName: 'Чертёж', code: 'system-transition', elementId: 'a', elementName: 'Создать', targetId: 'b', targetName: 'Принять', sourceSystems: ['PLM'], targetSystems: ['ERP'], objectIds: ['drawing'], explanation: 'Проверить перенос, не доказан повторный ввод' };
const report = { generatedAt: '2026-10-18T00:00:00Z', processCount: 1, findings: [finding, {...finding, code: 'paper-alternative', objectIds: []}] };
test('filters preserve codes, source IDs and Unicode; never turn alternate paper into required', () => {
  assert.equal(selectTransfers(report, 'paper-alternative', 'чертёж').length, 1);
  assert.equal(selectTransfers(report, '', 'erp').length, 2);
  assert.equal(selectTransfers(report, '', 'drawing').length, 1);
  assert.equal(selectTransfers(report, 'paper-primary', '').length, 0);
});
test('CSV exports complete filtered set with UTC source timestamp and safe spreadsheet values', () => {
  const csv = transfersCsv({...report, findings: [{...finding, elementName: '=cmd\n"test"'}]}, '', '');
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("'=cmd")); assert.ok(csv.includes('""test""')); assert.ok(csv.includes(report.generatedAt)); assert.ok(csv.includes('drawing'));
  assert.equal(transfersCsv(report, 'paper-primary', '').split('\r\n').length, 1);
});
test('CSV includes every row beyond the 100-row screen page without fabricating cartesian pairs', () => {
  const large = {...report, findings: Array.from({length: 301}, (_, i) => ({...finding, elementId: 'a' + i}))};
  const csv = transfersCsv(large, '', ''); assert.equal(csv.split('\r\n').length, 302); assert.ok(csv.includes('a300'));
});
