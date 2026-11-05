import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';import {createElement,Fragment} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {outcomeLabel} from '../src/execution-outcome.ts';import {planFactReport,planFactCsv} from '../src/plan-fact-report.ts';
const code=(await transformWithOxc(readFileSync(new URL('../src/ExecutionOutcomeSummary.tsx',import.meta.url),'utf8'),'ExecutionOutcomeSummary.tsx',{jsx:{runtime:'classic'}})).code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
const Component=new Function('React','outcomeLabel',code+';return ExecutionOutcomeSummary;')({createElement,Fragment},outcomeLabel);
const base={id:'i',processId:'p',processVersion:'1',name:'Учебный',status:'Cancelled',startedAt:'2026-11-05T06:00Z',
  steps:[{elementId:'done',status:'Completed',resultObjects:[{objectId:'proof'}],attachments:[{artifactId:'file'}]},{elementId:'b',status:'InProgress'},{elementId:'c',status:'NotStarted'}]};
const outcome=kind=>({kind,reason:'Основание завершения',recordedAt:'2026-11-05T07:00Z',recordedBy:'profile',unfinishedElementIds:['b','c']});
test('explicit failure, refusal and cancellation have different labels despite compatible raw status',()=>{
  assert.equal(new Set(['Error','Refusal','Cancellation'].map(kind=>outcomeLabel({...base,outcome:outcome(kind)}))).size,3);
  assert.equal(outcomeLabel({...base,status:'Completed',outcome:outcome('Success')}),'Успешное завершение');
});
test('legacy closed status does not fabricate an explicit reason or outcome',()=>{
  assert.match(outcomeLabel(base),/без явной классификации/);
  assert.match(renderToStaticMarkup(createElement(Component,{instance:base})),/Старая запись/);
});
test('closure summary keeps results and explains unfinished parallel branches without marking them skipped',()=>{
  const value={...base,outcome:outcome('Error')},before=JSON.stringify(value);
  const html=renderToStaticMarkup(createElement(Component,{instance:value}));
  for(const text of ['Ошибка','Основание завершения','Незавершённые ветви остановлены','Не был начат','Сохранено результатов: 1','вложений: 1'])assert.ok(html.includes(text),text);
  assert.equal(JSON.stringify(value),before);assert.doesNotMatch(html,/пропущено/);
  assert.equal(renderToStaticMarkup(createElement(Component,{instance:{...base,status:'Active'}})),'');
});
test('plan/fact CSV records failure kind, reason and closure date but never successful completion',()=>{
  const value={...base,outcome:outcome('Refusal')};
  const report=planFactReport({processId:'p',startAt:'2026-11-05T06:00Z',endAt:'2026-11-05T10:00Z',isDateReliable:true},value,'2026-11-05T12:00Z',undefined,'1');
  assert.equal(report.stateLabel,'Отказ');assert.equal(report.actualEnd,'');assert.equal(report.finishDeltaHours,null);
  const csv=planFactCsv(report);assert.match(csv,/"Исход";"Refusal"/);assert.match(csv,/"Причина исхода";"Основание завершения"/);
});
test('untrusted reason text is escaped, never executed',()=>{
  const html=renderToStaticMarkup(createElement(Component,{instance:{...base,outcome:{...outcome('Error'),reason:'<script>bad</script>'}}}));
  assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});
