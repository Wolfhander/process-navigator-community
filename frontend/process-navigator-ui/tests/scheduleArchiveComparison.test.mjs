import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compareScheduleSnapshots } from '../src/schedule-snapshots.ts';
const compiled = await transformWithOxc(readFileSync(new URL('../src/ScheduleArchiveComparison.tsx', import.meta.url), 'utf8'), 'ScheduleArchiveComparison.tsx', { jsx: { runtime: 'classic' } });
const code = compiled.code.replace(/import[^;]+;/g, '').replace('export function ', 'function ');
const Component = new Function('React', 'compareScheduleSnapshots', code + '\nreturn ScheduleArchiveComparison;')({ createElement, Fragment }, compareScheduleSnapshots);
const item = { processId: 'p', processName: '<script>name</script>', startAt: '2026-10-19T06:00Z', endAt: '2026-10-19T14:00Z', durationHours: 8 };
const result = { processes: [item], assumptions: {}, issues: [], complete: true, endAt: item.endAt };
const report = { baseline: { name: 'Архив', result }, checkedAt: '2026-10-19T15:00Z', status: 'Current', changes: [], currentResult: result };
const render = value => renderToStaticMarkup(Component({ report: value, disabled: false, onApply: () => {} }));
test('matching archive result remains an equality check, not a business guarantee', () => {
  const html = render(report);
  assert.match(html, /Исходники и результат совпадают/);
  assert.match(html, /Совпадение не гарантирует бизнес-корректность/);
  assert.doesNotMatch(html, /<script>/);
});
test('changed archive comparison shows signed shifts, preliminary status and bounded issues', () => {
  const currentResult = { ...result, complete: false, endAt: '2026-10-19T18:00Z', processes: [{ ...item, endAt: '2026-10-19T18:00Z', durationHours: 12 }], issues: Array.from({ length: 22 }, (_, index) => ({ message: 'Вопрос ' + index })) };
  const html = render({ ...report, status: 'Changed', changes: ['Изменены нормативы'], currentResult });
  assert.match(html, /Обнаружены изменения/);
  assert.match(html, /\+4.00/);
  assert.match(html, /предварительный/);
  assert.match(html, /Показаны первые 20/);
  assert.doesNotMatch(html, /Вопрос 21/);
});
test('failed recalculation never offers to apply nonexistent result', () => {
  const html = render({ ...report, status: 'Unavailable', currentResult: null, changes: ['Процесс отсутствует'] });
  assert.match(html, /Актуальность не установлена/);
  assert.doesNotMatch(html, /Показать новый пересчёт/);
});
test('applying recalculation is explicit and never invoked by rendering', () => {
  let called = 0;
  const tree = Component({ report, disabled: false, onApply: () => { called++; } });
  assert.equal(called, 0);
  function find(element) {
    if (Array.isArray(element)) return element.map(find).find(Boolean);
    if (!element || typeof element !== 'object') return undefined;
    return element.type === 'button' ? element : find(element.props?.children);
  }
  find(tree).props.onClick();
  assert.equal(called, 1);
});
