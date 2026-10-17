import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildProcessInstruction } from '../src/process-instruction.ts';
import { inspectReadability } from '../src/process-readability.ts';
const compiled = await transformWithOxc(readFileSync(new URL('../src/ProcessInstructionPage.tsx', import.meta.url), 'utf8'), 'ProcessInstructionPage.tsx', { jsx: { runtime: 'classic' } });
const code = compiled.code.replace(/import[^;]+;/g, '').replace('export function ', 'function ');
const Page = new Function('React','useState','useMemo','buildProcessInstruction','inspectReadability', code + '\nreturn ProcessInstructionPage;')({ createElement, Fragment }, () => ['', () => {}], callback => callback(), buildProcessInstruction, inspectReadability);
const process = { id: 'p', name: 'Процесс', version: '7', status: 'Draft', lanes: [{ id: 'lane', name: 'Отдел' }],
  nodes: [{ id: 's', type: 'startEvent', name: 'Начало' }, { id: 'a', type: 'task', name: '<script>действие</script>', laneId: 'lane', instruction: 'Сделать действие', channels: [{ id: 'mail', label: 'Заявка', kind: 'email', direction: 'input', flow: 'alternative' }], actions: [{ id: 'cmd', label: 'Зарегистрировать', kind: 'manual' }], informationObjects: [{ objectId: 'd', name: 'Чертёж', role: 'Output', required: true, version: '2' }] }], edges: [{ id: 'f', sourceId: 's', targetId: 'a' }] };
test('instruction renders exact opened revision, gaps, channels and documents without executing anything', () => {
  const html = renderToStaticMarkup(Page({ process, onBack: () => {}, onSelect: () => { throw Error('No execution during render'); } }));
  assert.match(html, /версия 7/); assert.match(html, /Черновик/);
  assert.doesNotMatch(html, /<script>/); assert.match(html, /Сделать действие/);
  assert.match(html, /электронная почта/); assert.match(html, /альтернативный/);
  assert.match(html, /Чертёж/); assert.match(html, /Критерий завершения/); assert.match(html, /не заполнен/);
  assert.match(html, /здесь команды не запускаются/);
});
test('source action selection requires explicit click and preserves the same node object', () => {
  let selected;
  const tree = Page({ process, onBack: () => {}, onSelect: node => { selected = node; } });
  function find(value) {
    if (Array.isArray(value)) return value.map(find).find(Boolean);
    if (!value || typeof value !== 'object') return undefined;
    return value.type === 'button' && value.props.children === 'Открыть действие на схеме' ? value : find(value.props?.children);
  }
  assert.equal(selected, undefined); find(tree).props.onClick(); assert.equal(selected, process.nodes[1]);
});
