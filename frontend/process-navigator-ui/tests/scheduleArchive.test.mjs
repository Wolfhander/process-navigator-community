import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const source = readFileSync(new URL('../src/ScheduleArchive.tsx', import.meta.url), 'utf8');
const compiled = await transformWithOxc(source, 'ScheduleArchive.tsx', { jsx: { runtime: 'classic' } });
const code = compiled.code.replace(/import[^;]+;/g, '').replace('export function ', 'function ');
function render(preview) {
  const state = [[], '', '', '', '', true, false, preview];
  const component = new Function('React', 'useState', 'useEffect', 'useRef', code + '\nreturn ScheduleArchive;')(
    { createElement, Fragment }, () => [state.shift(), () => {}], () => {}, value => ({ current: value }));
  return renderToStaticMarkup(component({ userId: 'demo', dirty: false, busy: false, onRestore: () => {} }));
}
test('archive offers package transfer without accessing storage or applying models during render', () => {
  const html = render(undefined);
  assert.match(html, /Скачать все снимки JSON/);
  assert.match(html, /Проверить файл снимков/);
  assert.match(html, /Файл не создаёт процессы/);
});
test('import preview is explicit, escaped and non-destructive', () => {
  const html = render({ file: '<unsafe>.json', snapshots: [{ id: 's', name: '<script>data</script>', savedAt: '2026-10-17T09:00Z', result: { processes: [] } }], added: 1, skipped: 0 });
  assert.match(html, /Подтвердить добавление снимков/);
  assert.match(html, /Отменить импорт/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /не подтверждённый сервером расчёт/);
});

function harness() {
  const states = [[], '', '', '', '', true, false, undefined];
  const refs = [{ current: null }, { current: 0 }];
  let stateIndex = 0, refIndex = 0, raw = null, writes = 0;
  const imported = { id: 'source', name: 'План', savedAt: '2026-10-17T09:00Z', result: { processes: [] } };
  const component = new Function('React', 'useState', 'useEffect', 'useRef', 'scheduleStorageKey', 'serializeScheduleSnapshots',
    'mergeScheduleTransfer', 'readScheduleTransfer', 'scheduleTransferMaxBytes', code + '\nreturn ScheduleArchive;')(
    { createElement, Fragment }, initial => { const index = stateIndex++; return [states[index] ?? initial, value => { states[index] = value; }]; },
    () => {}, () => refs[refIndex++], () => 'key', JSON.stringify,
    (existing, items) => ({ next: [...existing, ...items], added: items.length, skipped: 0 }), () => [imported], 8_000_000);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => raw, setItem: (_key, value) => { raw = value; writes++; } } });
  return {
    render() { stateIndex = 0; refIndex = 0; return component({ userId: 'demo', dirty: false, busy: false, onRestore: () => {} }); },
    writes: () => writes, changeStorage: () => { raw = 'changed elsewhere'; },
    close() { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
  };
}
function find(element, predicate) {
  if (Array.isArray(element)) return element.map(item => find(item, predicate)).find(Boolean);
  if (!element || typeof element !== 'object') return undefined;
  return predicate(element) ? element : find(element.props?.children, predicate);
}
test('file preview never writes storage; explicit confirmation commits once', async () => {
  const app = harness();
  try {
    find(app.render(), node => node.props?.type === 'file').props.onChange({ target: { files: [{ name: 'plan.json', size: 10, text: async () => '{}' }], value: '' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.writes(), 0);
    find(app.render(), node => node.type === 'button' && node.props.children === 'Подтвердить добавление снимков').props.onClick();
    assert.equal(app.writes(), 1);
  } finally { app.close(); }
});
test('another tab changing storage prevents confirmation from overwriting it', async () => {
  const app = harness();
  try {
    find(app.render(), node => node.props?.type === 'file').props.onChange({ target: { files: [{ name: 'plan.json', size: 10, text: async () => '{}' }], value: '' } });
    await new Promise(resolve => setImmediate(resolve));
    app.changeStorage();
    find(app.render(), node => node.type === 'button' && node.props.children === 'Подтвердить добавление снимков').props.onClick();
    assert.equal(app.writes(), 0);
    assert.match(renderToStaticMarkup(app.render()), /другой вкладке/);
  } finally { app.close(); }
});
