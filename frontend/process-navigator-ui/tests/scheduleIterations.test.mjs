import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';import {createElement,Fragment} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {parseScheduleSnapshots,serializeScheduleSnapshots,compareScheduleSnapshots} from '../src/schedule-snapshots.ts';
import {scheduleCsv} from '../src/schedule-export.ts';import {scheduleIterationFiles} from '../../../tools/schedule-iterations-fixture.mjs';
const at='2026-11-09T09:00:00Z',end='2026-11-09T10:00:00Z';
const request={rootProcessId:'p',direction:'Forward',anchorDate:at,includeWaitTime:true,workdayStart:'09:00',workdayEnd:'17:00',workingDays:[1,2,3,4,5],nonWorkingDates:[],durationScalePercent:100,transferDelayHours:0,processDurationScalePercent:{},checkpoints:{},utcOffsetMinutes:0,processCalendars:{},iterationPlans:{p:[{returnEdgeId:'back',plannedRepeats:1,maximumRepeats:2,distribution:[{repeats:0,probability:.25},{repeats:1,probability:.75}]}]},iterationTransfers:{drawing:'Batch'}};
const pass={processId:'p',elementId:'task',elementName:'Учебная правка',occurrence:1,path:[{returnEdgeId:'back',pass:1}],startAt:at,endAt:end,calendarSource:'Общий календарь'};
const transfer={objectId:'drawing',objectName:'Чертёж',mode:'Batch',sourceProcessId:'p',sourceElementId:'task',sourceOccurrence:1,targetProcessId:'q',targetElementId:'use',targetOccurrence:1,sourceReadyAt:end,requiredAt:end};
const item={processId:'p',processName:'Учебный',startAt:at,endAt:end,durationHours:1,baseDurationHours:1,appliedDurationScalePercent:100,slackHours:0,uncertaintyReasons:[],missingDurationCount:0,hasInternalCycle:false,isDateReliable:true,isCritical:true,isCheckpointMissed:false};
const result={rootProcessId:'p',direction:'Forward',anchorDate:at,startAt:at,endAt:end,assumptions:request,processes:[item],dependencies:[],issues:[],durationHours:1,criticalDurationHours:1,complete:true,iterationDetail:{plannedSteps:[pass],maximumSteps:[pass],transfers:[transfer],maximumTransfers:[transfer]}};
const snapshot={id:'iterations',name:'Учебный',savedAt:at,request,result};
function all(el,predicate,out=[]){if(Array.isArray(el)){el.forEach(x=>all(x,predicate,out));return out;}if(!el||typeof el!=='object')return out;if(predicate(el))out.push(el);all(el.props?.children,predicate,out);return out;}
async function component(name,initial=[]){
 const raw=readFileSync(new URL('../src/'+name+'.tsx',import.meta.url),'utf8');
 const code=(await transformWithOxc(raw,name+'.tsx',{jsx:{runtime:'classic'}})).code.replace(/^import [^\n]+;?$/gm,'').replace('export function ','function ');
 const deps={useEffect:()=>{},useState:v=>[initial.length?initial.shift():v,()=>{}],scheduleScenarioOptions:()=>({returns:[{id:'back',label:'Учебный возврат'}],limited:false})};
 return new Function('React',...Object.keys(deps),code+';return '+name)({createElement,Fragment},...Object.values(deps));
}
test('repeat parameters and all pass coordinates survive snapshot and scenario comparison',()=>{
 assert.deepEqual(parseScheduleSnapshots(serializeScheduleSnapshots([snapshot])),[snapshot]);
 const changed={...result,assumptions:{...request,iterationTransfers:{drawing:'PerPass'}}};
 assert.equal(compareScheduleSnapshots(result,changed)[0].routeChanged,true);
 for(const patch of [{iterationPlans:{p:[{returnEdgeId:'back',plannedRepeats:3,maximumRepeats:2}]}},{iterationTransfers:{drawing:'Guess'}}])
  assert.throws(()=>serializeScheduleSnapshots([{...snapshot,request:{...request,...patch}}]));
});
test('broken pass dates and nested coordinates cannot be imported as a writable snapshot',()=>{
 for(const patch of [{occurrence:0},{startAt:'bad'},{path:[{returnEdgeId:'back',pass:-1}]}])
  assert.throws(()=>serializeScheduleSnapshots([{...snapshot,result:{...result,iterationDetail:{...result.iterationDetail,plannedSteps:[{...pass,...patch}]}}}]));
 assert.throws(()=>serializeScheduleSnapshots([{...snapshot,result:{...result,iterationDetail:{...result.iterationDetail,transfers:[{...transfer,mode:'Unknown'}]}}}]));
});
test('CSV includes every pass and transfer, original IDs and explicit whole-producer barrier',()=>{
 const many={...result,iterationDetail:{...result.iterationDetail,plannedSteps:Array.from({length:120},(_,i)=>({...pass,occurrence:i+1})),transfers:Array.from({length:120},(_,i)=>({...transfer,targetOccurrence:i+1}))}};
 const csv=scheduleCsv(many);assert.match(csv,/Барьер завершения всего производителя/);assert.match(csv,/"120"/);assert.match(csv,/Вложенные координаты JSON/);assert.match(csv,/Планы развёрнутых повторов/);
});
test('editor adds an explicit plan without mutating existing dictionaries or running calculation',async()=>{
 const Editor=await component('ScheduleIterationEditor');const changes=[];
 const tree=Editor({models:[{id:'p',name:'Учебный'}],objects:[],value:{},transfers:{},blocked:false,disabled:false,onChange:(...v)=>changes.push(v)});
 assert.equal(changes.length,0);const add=all(tree,e=>e.props?.className==='iteration-add')[0];add.props.onChange({target:{value:'back'}});
 assert.deepEqual(changes[0][0],{p:[{returnEdgeId:'back',plannedRepeats:1,maximumRepeats:1}]});
 assert.match(renderToStaticMarkup(tree),/Первый проход уже учтён/);
});
test('pass and transfer tables paginate independently rather than silently dropping later rows',async()=>{
 const View=await component('ScheduleIterationResult',[false,'',0,1]);
 const value={...result,iterationDetail:{...result.iterationDetail,transfers:Array.from({length:120},(_,i)=>({...transfer,targetOccurrence:i+1}))}};
 const tree=View({result:value,onOpen(){}}),html=renderToStaticMarkup(tree);
 assert.match(html,/Передачи 51–100 из 120/);assert.match(html,/Строки 1–1/);assert.match(html,/не события исполнения/);
 assert.equal(all(tree,e=>e.type==='tr').length,53); // 1 pass + 50 transfers + two headers
});
test('fixture generator is deterministic and retains both nested return edges and synthetic document bindings',()=>{
 const spec=JSON.parse(readFileSync(new URL('../../../master-data/schedule-iterations-fixture.json',import.meta.url),'utf8'));
 assert.deepEqual(scheduleIterationFiles(spec),scheduleIterationFiles(spec));const files=scheduleIterationFiles(spec);
 assert.match(files.get(spec.id+'.bpmn'),/id="inner"/);assert.match(files.get(spec.id+'.bpmn'),/id="outer"/);
 assert.equal(JSON.parse(files.get(spec.id+'.context.json')).elements.b.informationObjects[0].objectId,spec.objectId);
 assert.equal(JSON.parse(files.get(spec.receiverId+'.context.json')).elements.use.informationObjects[0].role,'Input');
});
