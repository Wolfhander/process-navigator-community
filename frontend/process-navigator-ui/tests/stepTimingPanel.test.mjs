import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {transformWithOxc} from 'vite';import {createElement,Fragment} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import * as timing from '../src/execution-timing.ts';
async function compile(name,deps){const code=(await transformWithOxc(readFileSync(new URL('../src/'+name+'.tsx',import.meta.url),'utf8'),name+'.tsx',{jsx:{runtime:'classic'}})).code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');return new Function('React',...Object.keys(deps),code+';return '+name+';')({createElement,Fragment},...Object.values(deps));}
const icons=Object.fromEntries(['AlertTriangle','CalendarClock','CheckCircle2','Clock3','Hourglass','Activity','BarChart3','ArrowLeft'].map(n=>[n,'span']));
const instance={status:'Active',lifecycleEvents:[]},step={status:'NotStarted',availableAt:'2026-10-19T08:00Z',normText:'<script>text</script>',plannedDurationMinutes:null};
test('unknown norm is not a zero SLA, labels distinguish elapsed time and baseline, and norm text is escaped',async()=>{
 const Panel=await compile('StepTimingPanel',{...icons,...timing,useState:()=>[0,()=>{}],useEffect(){}});
 const html=renderToStaticMarkup(createElement(Panel,{instance,step}));assert.match(html,/не распознан/);assert.doesNotMatch(html,/Отклонение от норматива/);assert.match(html,/не рабочий календарь/);assert.match(html,/&lt;script&gt;text/);assert.doesNotMatch(html,/<script>/);
});
test('active waiting queue refreshes and paused instance does not poll',async()=>{
 let effect;const Panel=await compile('StepTimingPanel',{...icons,...timing,useState:()=>[0,()=>{}],useEffect:fn=>{effect=fn;}});
 const saved=globalThis.window;let timers=0,cleared=0;globalThis.window={setInterval(){timers++;return 7;},clearInterval(id){assert.equal(id,7);cleared++;}};
 try{Panel({instance,step});const cleanup=effect();assert.equal(timers,1);cleanup();assert.equal(cleared,1);Panel({instance:{...instance,status:'Paused'},step});assert.equal(effect(),undefined);assert.equal(timers,1);}finally{if(saved===undefined)delete globalThis.window;else globalThis.window=saved;}
});
test('analytics shows server capture, no fictional working days, and discards late response on exit',async()=>{
 let effect,resolve;const states=[{totalInstances:1,activeInstances:0,completedInstances:1,averageCycleMinutes:960,capturedAt:'2026-10-31T08:00:00Z',steps:[]},''],updates=[];
 const Panel=await compile('AnalyticsDialog',{...icons,useState:()=>{const i=updates.length;updates.push(undefined);return[states[i],v=>{updates[i]=v;}];},useMemo:fn=>fn(),useEffect:fn=>{effect=fn;},loadProcessAnalytics:()=>new Promise(r=>{resolve=r;})});
 const html=renderToStaticMarkup(createElement(Panel,{processId:'p',processName:'Учебный',onClose(){},onSelectStep(){}}));assert.match(html,/2026-10-31T08:00:00Z/);assert.doesNotMatch(html,/раб\. дн/);assert.match(html,/включая паузы/);
 const cleanup=effect();cleanup();resolve({processId:'wrong'});await new Promise(r=>setImmediate(r));assert.equal(updates[0],undefined);
});
