import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectEvidence, evidenceReportCsv, filterEvidence, sourceRouteGaps } from '../src/evidence-register.ts';

const model = { id: 'p', name: 'Приёмка', version: '1.2', nodes: [
  { id: 'a', name: 'Проверить документы', evidence: [
    { status: 'question', statement: 'Кто принимает оригинал?', source: 'Интервью', locator: 'строка 3', author: 'Анна' },
    { status: 'fact', statement: 'Создать документ', source: 'Регламент' },
  ] }, { id: 'b', name: 'Оформить', evidence: [{ status: 'assumption', statement: 'В ERP' }] },
  { id: 'c', name: 'Без оснований' },
] };
test('register retains step, process, version and edition for every record without mutating source', () => {
  const before = JSON.stringify(model);
  const entries = collectEvidence(model, 'Draft');
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(row => [row.elementId, row.index]), [['a', 0], ['a', 1], ['b', 0]]);
  assert.ok(entries.every(row => row.processId === 'p' && row.version === '1.2' && row.edition === 'Draft'));
  assert.equal(entries[0].locator, 'строка 3');
  assert.equal(JSON.stringify(model), before);
});
test('unresolved status does not count confirmed facts; editions stay separate', () => {
  const entries = [...collectEvidence(model, 'Draft'), ...collectEvidence(model, 'Published')];
  assert.equal(filterEvidence(entries, 'unresolved', 'all', '', '').length, 4);
  assert.equal(filterEvidence(entries, 'fact', 'Published', 'p', '').length, 1);
  assert.equal(filterEvidence(entries, 'all', 'Draft', 'missing', '').length, 0);
});
test('search includes source locator author and step name and handles empty optional fields', () => {
  const entries = collectEvidence(model, 'Draft');
  for (const query of [' АННА ', 'ИНТЕРВЬЮ', 'строка 3', 'оригинал']) assert.equal(filterEvidence(entries, 'all', 'all', '', query).length, 1);
  assert.equal(filterEvidence(entries, 'all', 'all', '', 'ПРОВЕРИТЬ').length, 2);
  assert.equal(filterEvidence(entries, 'question', 'all', '', 'ERP').length, 0);
  assert.deepEqual(collectEvidence({ ...model, nodes: [] }, 'Published'), []);
});
test('demo offers a synthetic fact, assumption and question without presenting them as company facts', () => {
  const context = JSON.parse(readFileSync(new URL('../../../backend/ProcessNavigator.Api/Data/demo-showcase-l3-warehouse.context.json', import.meta.url), 'utf8'));
  const evidence = context.elements.Task_SystemNotice.evidence;
  assert.deepEqual(evidence.map(item => item.status), ['fact', 'assumption', 'question']);
  assert.ok(evidence.every(item => item.author === 'Демонстрационный сценарий' && item.source));
  const generator = readFileSync(new URL('../../../tools/reset-demo-contour.mjs', import.meta.url), 'utf8');
  for (const item of evidence) assert.ok(generator.includes(item.statement));
});
test('missing sources are computed once per task, do not alter stored records or count as questions', () => {
  const process = { ...model, nodes: model.nodes.map(node => ({ ...node, type: 'task' })).concat([
    { id: 's', name: 'Начало', type: 'startEvent' },
    { id: 'd', name: 'Развилка', type: 'exclusiveGateway' },
    { id: 'x', name: 'Пробельный источник', type: 'task', evidence: [{ status: 'question', statement: 'Проверить', source: '   ' }] },
  ]) };
  const before = JSON.stringify(process);
  const entries = collectEvidence(process, 'Draft', true);
  assert.deepEqual(filterEvidence(entries, 'missing', 'all', '', '').map(item => item.elementId), ['b', 'c', 'x']);
  assert.equal(filterEvidence(entries, 'unresolved', 'all', '', '').length, 3);
  assert.ok(entries.filter(entry => entry.status === 'missing').every(entry => entry.index === -1));
  assert.equal(JSON.stringify(process), before);
});
test('report includes incomplete-state metadata even without rows and neutralizes spreadsheet formulas', () => {
  const entries = collectEvidence(model, 'Draft');
  entries[0].statement = ' =HYPERLINK("bad")';
  entries[0].source = 'строка 1\nстрока 2; примечание';
  const csv = evidenceReportCsv(entries.slice(0, 1), ['Ошибка модели'], '2026-10-16');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('Неполный:'));
  assert.ok(csv.includes('"\' =HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"строка 1\nстрока 2; примечание"'));
  assert.ok(!csv.includes('Создать документ'));
  assert.ok(evidenceReportCsv([], ['Нет доступа'], 'test').includes('Нет доступа'));
});
test('source reconciliation distinguishes unmatched, broken and mapped requirements without semantic approval', () => {
  const process = { ...model, passport: { sourceRequirements: [
    { id: 'r1', text: 'Не отражено', source: 'Описание', elementIds: [] },
    { id: 'r2', text: 'Удалённая связь', source: 'Описание', elementIds: ['deleted', 'a'] },
    { id: 'r3', text: 'Привязано', source: 'Описание', elementIds: ['b', 'b'] },
  ] } };
  const entries = collectEvidence(process, 'Draft');
  const requirements = filterEvidence(entries, 'requirements', 'all', '', '');
  assert.deepEqual(requirements.map(entry => entry.status), ['unmapped', 'stale', 'mapped']);
  assert.equal(requirements[0].elementId, '');
  assert.equal(requirements[1].elementId, 'a');
  assert.ok(requirements[1].elementName.includes('deleted'));
  assert.equal(requirements[2].elementName, 'Оформить');
  assert.equal(filterEvidence(entries, 'gaps', 'Draft', 'p', '').length, 2);
  assert.equal(filterEvidence(entries, 'fact', 'all', '', '').length, 1);
  assert.equal(filterEvidence(entries, 'requirements', 'all', '', 'Удалённая').length, 1);
});
test('route checks accept intermediate blocks, reject reverse direction and terminate on cycles', () => {
  const process = { ...model, edges: [{ sourceId: 'a', targetId: 'c' }, { sourceId: 'c', targetId: 'b' }, { sourceId: 'c', targetId: 'a' }] };
  assert.deepEqual(sourceRouteGaps(process, ['a', 'b']), []);
  assert.deepEqual(sourceRouteGaps(process, ['b', 'a']), ['b → a']);
  const entries = collectEvidence({ ...process, passport: { sourceRequirements: [{ id: 'r', text: 'Сначала Б, потом А', source: 'Описание', elementIds: ['b', 'a'], checkSequence: true }] } }, 'Draft');
  assert.equal(filterEvidence(entries, 'gaps', 'all', '', '')[0].status, 'routeMismatch');
  assert.ok(filterEvidence(entries, 'requirements', 'all', '', '')[0].statement.includes('Условия переходов'));
  assert.deepEqual(sourceRouteGaps({ ...process, edges: [{ sourceId: 'a', targetId: 'unknown' }, { sourceId: 'unknown', targetId: 'b' }] }, ['a', 'b']), ['a → b']);
});
