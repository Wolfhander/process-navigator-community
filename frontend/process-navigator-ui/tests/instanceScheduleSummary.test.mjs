import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compareScheduleFact } from '../src/schedule-fact.ts';
const source = readFileSync(new URL('../src/InstanceScheduleSummary.tsx', import.meta.url), 'utf8');
const compiled = await transformWithOxc(source, 'InstanceScheduleSummary.tsx', { jsx: { runtime: 'classic' } });
const code = compiled.code.replace(/import[^;]+from "[^"]+";/g, '').replace('export function ', 'function ');
function render(instance, plans, error = '') {
  const values = [plans, error, false, '2026-10-19T17:00Z'];
  const Component = new Function('React', 'useState', 'loadInstanceSchedulePlans', 'compareScheduleFact', 'SchedulePlanFreshnessPanel', code + '\nreturn InstanceScheduleSummary;')(
    { createElement, Fragment }, () => [values.shift(), () => {}], () => { throw new Error('Unexpected request during render'); }, compareScheduleFact, () => null);
  return renderToStaticMarkup(Component({ instance }));
}
const instance = { processId: 'p', id: 'i', status: 'Active', startedAt: '2026-10-17T09:00Z' };
const plan = { id: 'baseline', assignedAt: '2026-10-17T08:00Z', assignedBy: 'demo', reason: 'Первоначальный план',
  item: { processId: 'p', startAt: '2026-10-17T09:00Z', endAt: '2026-10-17T17:00Z' } };
test('execution plan section handles legacy instances and read errors without crashing', () => {
  assert.match(render(instance, []), /Базовый план не назначен/);
  assert.match(render(instance, undefined, 'Ошибка чтения'), /role="alert"/);
});
test('stored baseline shows current overdue and complete history, cancellation is not completion', () => {
  const html = render(instance, [plan]);
  assert.match(html, /48 календарных ч/);
  assert.match(html, /Первоначальный план/);
  assert.match(render({ ...instance, status: 'Cancelled' }, [plan]), /отменено; завершение не оценивается/);
});
