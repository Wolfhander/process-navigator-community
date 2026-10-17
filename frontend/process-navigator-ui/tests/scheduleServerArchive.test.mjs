import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const compiled = await transformWithOxc(readFileSync(new URL('../src/ScheduleServerArchive.tsx', import.meta.url), 'utf8'), 'ScheduleServerArchive.tsx', { jsx: { runtime: 'classic' } });
const code = compiled.code.replace(/import[^;]+;/g, '').replace('export function ', 'function ');
const item = { id: 'a', name: '<script>plan</script>', savedAt: '2026-10-17T09:00Z', processCount: 2, startAt: '2026-10-17T09:00Z', endAt: '2026-10-17T17:00Z', complete: false };
function setup(items, load = async () => ({}), restore = () => {}) {
  const state = [items, '', false, '', ''];
  let cleanup;
  const Component = new Function('React', 'useState', 'useEffect', 'useRef', 'listServerSchedules', 'loadServerSchedule', code + '\nreturn ScheduleServerArchive;')(
    { createElement }, () => [state.shift(), () => {}], effect => { cleanup = effect(); }, value => ({ current: value }),
    () => { throw Error('No background list request during render'); }, load);
  return { tree: Component({ dirty: false, busy: false, onRestore: restore }), cleanup: () => cleanup?.() };
}
function find(element, predicate) {
  if (Array.isArray(element)) return element.map(child => find(child, predicate)).find(Boolean);
  if (!element || typeof element !== 'object') return undefined;
  return predicate(element) ? element : find(element.props?.children, predicate);
}
test('server archive is explicit about scope and does not fetch every render', () => {
  const html = renderToStaticMarkup(setup([]).tree);
  assert.match(html, /тому же серверу с тем же профилем/);
  assert.match(html, /не облачная синхронизация/);
  assert.match(html, /Доступных архивных расчётов нет/);
});
test('archived names are escaped, preliminary results remain labelled', () => {
  const html = renderToStaticMarkup(setup([item]).tree);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /предварительный расчёт/);
  assert.match(html, /Открыть без пересчёта/);
});
test('loading snapshot after profile unmount cannot restore it into another profile', async () => {
  let resolve, restored = 0;
  const pending = new Promise(done => { resolve = done; });
  const app = setup([item], () => pending, () => { restored++; });
  find(app.tree, node => node.type === 'button' && node.props.children === 'Открыть без пересчёта').props.onClick();
  app.cleanup(); resolve({ id: 'a' });
  await new Promise(done => setImmediate(done));
  assert.equal(restored, 0);
});
