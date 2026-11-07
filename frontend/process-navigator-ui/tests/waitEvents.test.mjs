import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';import {createElement,Fragment} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {stepTiming} from '../src/execution-timing.ts';import {waitEventFiles} from '../../../tools/wait-events-fixture.mjs';
import {serializeScheduleSnapshots} from '../src/schedule-snapshots.ts';
const at='2026-11-07T09:00:00Z',due='2026-11-07T10:00:00Z';
const timer={kind:'timer',durationMinutes:60};
const node={id:'wait',type:'task',bpmnType:'intermediateCatchEvent',name:'Учебный таймер',waitEvent:timer};
const step={elementId:'wait',status:'InProgress',iteration:2,availableAt:at,startedAt:at,plannedDurationMinutes:60,
 waiting:{specification:timer,status:'Open',startedAt:at,dueAt:due}};
const instance={id:'i',processId:'p',processVersion:'1',name:'Учебный',status:'Active',startedAt:at,startedBy:'demo',steps:[step]};
function all(el,predicate,out=[]){if(Array.isArray(el)){el.forEach(x=>all(x,predicate,out));return out;}if(!el||typeof el!=='object')return out;if(predicate(el))out.push(el);all(el.props?.children,predicate,out);return out;}
async function components(){
 const raw=readFileSync(new URL('../src/WaitEventPanel.tsx',import.meta.url),'utf8');
 const code=(await transformWithOxc(raw,'WaitEventPanel.tsx',{jsx:{runtime:'classic'}})).code.replace(/^import [^\n]+;?$/gm,'').replaceAll('export function ','function ');
 const calls=[],api=async(...args)=>{calls.push(args);return instance;};
 const result=new Function('React','useState','updateWaitEvent',code+';return {WaitEventEditor,WaitEventPanel};')({createElement,Fragment},v=>[v,()=>{}],api);
 return{...result,calls};
}
test('rendering an open timer never mutates execution; explicit check sends exact iteration',async()=>{
 const {WaitEventPanel:View,calls}=await components();const changed=[];
 const tree=View({processId:'p',node,instance,step,canExecute:true,available:true,onUpdated:i=>changed.push(i)});
 assert.equal(calls.length,0);const button=all(tree,e=>e.props?.className==='wait-check')[0];assert.ok(button);
 await button.props.onClick();assert.equal(calls[0][3],'CheckTimer');assert.equal(calls[0][4],2);assert.deepEqual(changed,[instance]);
 assert.match(renderToStaticMarkup(tree),/Пауза экземпляра его не переносит/);
});
test('read-only profile cannot activate or resolve an event',async()=>{
 const {WaitEventPanel:View}=await components();
 const html=renderToStaticMarkup(View({processId:'p',node,instance,step,canExecute:false,available:true}));
 assert.doesNotMatch(html,/<button/);assert.match(html,/Ожидаем событие/);
});
test('message timeout never renders receipt or normal completion controls',async()=>{
 const {WaitEventPanel:View}=await components();
 const waiting={specification:{kind:'message',source:'Отдел',channel:'Почта',messageName:'Ответ',timeoutMinutes:60},status:'TimedOut',startedAt:at,dueAt:due,resolvedAt:due,resolvedBy:'demo'};
 const html=renderToStaticMarkup(View({processId:'p',node,instance,step:{...step,waiting},canExecute:true,available:true}));
 assert.match(html,/Следующий этап не открыт/);assert.match(html,/не успешное получение/);assert.doesNotMatch(html,/class="wait-receive"/);
});
test('saved execution specification has priority over changed current metadata',async()=>{
 const {WaitEventPanel:View}=await components();
 const html=renderToStaticMarkup(View({processId:'p',node:{...node,waitEvent:{kind:'timer',durationMinutes:500}},instance,step,canExecute:false,available:true}));
 assert.match(html,/60 мин/);assert.doesNotMatch(html,/500 мин/);
});
test('calendar event elapsed includes pause and is never counted as employee work',()=>{
 const paused={...instance,status:'Paused',lifecycleEvents:[{toStatus:'Paused',occurredAt:'2026-11-07T09:15:00Z'}]};
 const timing=stepTiming(paused,step,Date.parse(due));
 assert.equal(timing.eventWait,60);assert.equal(timing.work,0);assert.equal(timing.total,60);
 const timedOut={...step,waiting:{...step.waiting,status:'TimedOut',resolvedAt:due}};
 assert.equal(stepTiming(instance,timedOut,Date.parse('2026-11-07T12:00Z')).eventWait,60);
});
test('native timer duration is visibly read-only, generic task wait is configurable',async()=>{
 const {WaitEventEditor:Editor}=await components(),changes=[];
 const tree=Editor({node,value:timer,onChange:v=>changes.push(v)});
 assert.equal(all(tree,e=>e.props?.className==='wait-duration')[0].props.disabled,true);
 const custom=Editor({node:{...node,bpmnType:'task'},value:undefined,onChange:v=>changes.push(v)});
 all(custom,e=>e.props?.className==='wait-enabled')[0].props.onChange({target:{checked:true}});
 assert.deepEqual(changes,[{kind:'message'}]);
});
test('synthetic fixture is deterministic, timer keeps its native definition and message source',()=>{
 const spec=JSON.parse(readFileSync(new URL('../../../master-data/wait-events-fixture.json',import.meta.url),'utf8'));
 const files=waitEventFiles(spec);assert.deepEqual(files,waitEventFiles(spec));
 assert.match(files.get(spec.id+'.bpmn'),/timerEventDefinition/);
 assert.equal(JSON.parse(files.get(spec.id+'.context.json')).elements.message.waitEvent.channel,spec.channel);
});
test('saved schedule rejects corrupted wait fields rather than passing them to the view',()=>{
 const request={rootProcessId:'p',direction:'Forward',anchorDate:at,includeWaitTime:true,workdayStart:'09:00',workdayEnd:'17:00',workingDays:[1],nonWorkingDates:[],durationScalePercent:100,transferDelayHours:0,processDurationScalePercent:{},checkpoints:{},utcOffsetMinutes:0,processCalendars:{}};
 const item={processId:'p',processName:'Учебный',startAt:at,endAt:due,durationHours:1,baseDurationHours:1,appliedDurationScalePercent:100,slackHours:0,uncertaintyReasons:[],missingDurationCount:0,hasInternalCycle:false,isDateReliable:true,isCritical:true,isCheckpointMissed:false};
 const result={rootProcessId:'p',direction:'Forward',anchorDate:at,startAt:at,endAt:due,assumptions:request,processes:[item],dependencies:[],issues:[],durationHours:1,criticalDurationHours:1,complete:true,
  sources:{algorithm:'schedule-v7-wait-events',capturedAt:at,processes:[{id:'p',name:'Учебный',version:'1',status:'Published',nodes:[node]}],objects:[]}};
 const saved={id:'s',name:'Таймер',savedAt:at,request,result};
 assert.doesNotThrow(()=>serializeScheduleSnapshots([saved]));
 for(const waitEvent of [{kind:'timer',durationMinutes:{}},{kind:'wrong'},{kind:'message',source:{}}])
  assert.throws(()=>serializeScheduleSnapshots([{...saved,result:{...result,sources:{...result.sources,processes:[{...result.sources.processes[0],nodes:[{...node,waitEvent}]}]}}}]));
});
