import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {transformWithOxc} from 'vite';import {createElement} from 'react';
const source=readFileSync(new URL('../src/ProcessSchedulePage.tsx',import.meta.url),'utf8');
const code=(await transformWithOxc(source,'ProcessSchedulePage.tsx',{jsx:{runtime:'classic'}})).code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
const icons=source.match(/import \{ ([^}]+) \} from 'lucide-react'/)[1].split(',').map(s=>s.trim());
function find(el,fn){if(Array.isArray(el))return el.map(v=>find(v,fn)).find(Boolean);if(!el||typeof el!=='object')return;return fn(el)?el:find(el.props?.children,fn);}
function setup(catalog,seed){
 let consumed=0;const calls=[],state=[],deps={...Object.fromEntries(icons.map(n=>[n,'span'])),...Object.fromEntries(['ScheduleCalendarEditor','ScheduleRouteEditor','ScheduleArchive','ScheduleServerArchive','ScheduleFactPanel'].map(n=>[n,'section'])),calculateProcessSchedule:async r=>{calls.push(r);return{};},useMemo:fn=>fn(),useEffect:fn=>fn(),useState:v=>{const value=typeof v==='function'?v():v;state.push(value);return[value,()=>{}];}};
 const Page=new Function('React',...Object.keys(deps),code+';return ProcessSchedulePage;')({createElement},...Object.values(deps));
 return{tree:Page({userId:'demo',catalog,initialScenario:seed,onSeedConsumed:()=>consumed++,onBack(){},onOpen(){}}),calls,state,get consumed(){return consumed;}};
}
test('calculator receives exact choices once without an automatic API request',async()=>{
 const seed={processId:'p',version:'1',status:'Published',choices:{g1:'yes',g2:'check'}},app=setup([{id:'p',name:'Учебный'}],seed);
 assert.equal(app.calls.length,0);assert.equal(app.consumed,1);
 const button=find(app.tree,e=>e.type==='button'&&e.props.onClick?.name==='calculate');assert.ok(button);await button.props.onClick();
 assert.equal(app.calls[0].rootProcessId,'p');assert.deepEqual(app.calls[0].processBranches,{p:seed.choices});assert.notEqual(app.calls[0].processBranches.p,seed.choices);
});
test('missing source never silently applies choices to the first catalog process',()=>{
 const app=setup([{id:'other',name:'Другой'}],{processId:'gone',version:'1',status:'Published',choices:{g:'edge'}});
 assert.equal(app.state[1],'');assert.ok(find(app.tree,e=>e.props?.role==='alert'));assert.equal(app.calls.length,0);
});
