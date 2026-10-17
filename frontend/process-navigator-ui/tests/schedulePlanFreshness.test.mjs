import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const source = readFileSync(new URL('../src/SchedulePlanFreshnessPanel.tsx', import.meta.url), 'utf8');
const compiled = await transformWithOxc(source, 'SchedulePlanFreshnessPanel.tsx', { jsx: { runtime: 'classic' } });
const code = compiled.code.replace(/import[^;]+;/g, '').replace('export function ', 'function ');
function render(report, error = '') {
  const values = [report, error, false];
  const Component = new Function('React', 'useState', 'checkInstanceSchedulePlan', code + '\nreturn SchedulePlanFreshnessPanel;')(
    { createElement, Fragment }, () => [values.shift(), () => {}], () => { throw new Error('No automatic recalculation during render'); });
  return renderToStaticMarkup(Component({ plan: { id: 'baseline', processId: 'p', instanceId: 'i' } }));
}
const report = { planId: 'baseline', checkedAt: '2026-10-17T09:00Z', status: 'Current', changes: [], totalChanges: 0 };
test('freshness is unknown until checked and errors never become confirmation', () => {
  assert.match(render(undefined), /Проверка ещё не выполнялась/);
  assert.match(render(undefined, 'Сервер недоступен'), /role="alert"/);
  assert.doesNotMatch(render(undefined, 'Сервер недоступен'), /Исходники и даты совпадают/);
});
test('current status is scoped to input equality rather than business correctness', () => {
  assert.match(render(report), /Исходники и даты совпадают/);
  assert.match(render(report), /не гарантия полноты/);
});
test('changed results explain differences, signed dates and explicit truncation', () => {
  const html = render({ ...report, status: 'Changed', changes: [{ kind: 'ProcessChanged', id: 'p', name: 'Процесс', message: 'Изменён норматив' }],
    totalChanges: 72, finishShiftHours: 4, currentItem: { startAt: '2026-10-17T09:00Z', endAt: '2026-10-17T17:00Z', isDateReliable: false } });
  assert.match(html, /Изменён норматив/);
  assert.match(html, /из 72 различий/);
  assert.match(html, /\+4 календарных ч/);
  assert.match(html, /Даты предварительные/);
});
test('unavailable and replaced plans never display a confirmation for the shown baseline', () => {
  assert.match(render({ ...report, status: 'Unavailable' }), /Актуальность не установлена/);
  assert.match(render({ ...report, planId: 'new-plan' }), /не подтверждает показанный план/);
  assert.doesNotMatch(render({ ...report, planId: 'new-plan' }), /Исходники и даты совпадают/);
  assert.match(render({ ...report, status: 'Superseded' }), /Обновите историю/);
});
