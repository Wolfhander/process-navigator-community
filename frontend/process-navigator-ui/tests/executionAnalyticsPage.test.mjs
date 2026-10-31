import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createElement,Fragment} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {transformWithOxc} from 'vite';
import {executionSelection,executionStats,executionDepartments} from '../src/execution-portfolio.ts';
const source=readFileSync(new URL('../src/ExecutionAnalyticsPanel.tsx',import.meta.url),'utf8');const compiled=await transformWithOxc(source,'ExecutionAnalyticsPanel.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
const i={processId:'p',processName:'Процесс',modelAvailable:true,instanceId:'i',name:'Заказ',version:'1',status:'Completed',startedAt:'2026-10-01T00:00:00Z',cycleMinutes:120,returnEvents:1};
const a={processId:'p',instanceId:'i',elementId:'step',name:'Шаг',iteration:2,current:true,status:'Completed',department:'Отдел',organizationBasis:'Текущая, не историческая',workMinutes:30,queueMinutes:10,durationMinutes:40,overdueMinutes:5,notes:[]};
const data={capturedAt:'2026-10-31T00:00:00Z',algorithm:'test',fingerprint:'hash',complete:false,issueCount:2,issues:[{source:'broken',message:'Неполнота'}],instances:[i],attempts:[a]};
function render({report=data,error='',opened='',from='',to=''}={}){
  const states=[report,error,0,'','',from,to,0,opened];
  const Page=new Function('React','useState','useEffect','executionSelection','executionStats','executionDepartments',code+';return ExecutionAnalyticsPanel;')({createElement,Fragment},()=>[states.shift(),()=>{}],()=>{},executionSelection,executionStats,executionDepartments);
  return renderToStaticMarkup(createElement(Page,{onOpenProcess(){}}));
}
test('execution dashboard explains sample denominators, time basis, unknowns and partial diagnostics',()=>{const html=render();for(const phrase of ['календарное','не историческая','не занятость','измерений 1','Превышений нормы','Неполнота','CSV всей выбранной выборки'])assert.ok(html.includes(phrase),phrase);assert.doesNotMatch(html,/раб. дн./);});
test('instance details are lazy, explicit about current model and safely escape source strings',()=>{assert.doesNotMatch(render(),/Открыть текущую модель/);const html=render({opened:JSON.stringify(['p','i'])});assert.match(html,/Открыть текущую модель \(не историческую\)/);assert.match(html,/step/);assert.match(render({report:{...data,instances:[{...i,name:'<script>bad</script>'}]}}),/&lt;script&gt;/);});
test('date errors, read failures and empty snapshots do not produce stale writable data',()=>{assert.match(render({from:'2026-10-03',to:'2026-10-01'}),/Начальная дата позже/);assert.match(render({report:undefined,error:'Недоступно'}),/role="alert"/);assert.match(render({report:{...data,instances:[],attempts:[]}}),/экземпляров нет/);});
