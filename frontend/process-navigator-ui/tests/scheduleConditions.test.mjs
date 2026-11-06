import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';import {createElement,Fragment} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {parseScheduleSnapshots,serializeScheduleSnapshots,compareScheduleSnapshots} from '../src/schedule-snapshots.ts';
import {scheduleCsv} from '../src/schedule-export.ts';
const request={rootProcessId:'p',direction:'Forward',anchorDate:'2026-11-09T09:00:00Z',includeWaitTime:true,workdayStart:'09:00',workdayEnd:'17:00',workingDays:[1,2,3,4,5],nonWorkingDates:[],durationScalePercent:100,transferDelayHours:0,processDurationScalePercent:{},checkpoints:{},utcOffsetMinutes:0,processCalendars:{},facts:{needed:true},objectRules:[{processId:'p',elementId:'fast',objectId:'drawing',role:'Output',factName:'needed',expectedValue:true}],branchProbabilities:[{processId:'p',gatewayId:'g',weights:[{edgeId:'a',probability:.25},{edgeId:'b',probability:.75}]}]};
const leaf={number:1,probability:.25,choices:{p:{g:'a'}},startAt:request.anchorDate,endAt:'2026-11-09T11:00:00Z',nominalHours:2,complete:true,processIds:['p']};
const envelope={cases:[leaf,{...leaf,number:2,probability:.75,choices:{p:{g:'b'}},endAt:'2026-11-09T15:00:00Z',nominalHours:6}],earliestStart:leaf.startAt,latestStart:leaf.startAt,earliestEnd:leaf.endAt,latestEnd:'2026-11-09T15:00:00Z',expectedNominalHours:5,probabilityMass:1,complete:true};
const item={processId:'p',processName:'Учебный',startAt:leaf.startAt,endAt:envelope.latestEnd,durationHours:6,baseDurationHours:6,appliedDurationScalePercent:100,slackHours:0,uncertaintyReasons:[],missingDurationCount:0,hasInternalCycle:false,isDateReliable:false,isCritical:true,isCheckpointMissed:false};
const result={rootProcessId:'p',direction:'Forward',anchorDate:request.anchorDate,startAt:leaf.startAt,endAt:envelope.latestEnd,assumptions:request,processes:[item],dependencies:[],issues:[],durationHours:6,criticalDurationHours:6,complete:false,alternativeEnvelope:envelope};
const snapshot={id:'scenario',name:'Учебный диапазон',savedAt:request.anchorDate,request,result};
async function component(name,dependencies={}){
 const raw=readFileSync(new URL('../src/'+name+'.tsx',import.meta.url),'utf8');
 const code=(await transformWithOxc(raw,name+'.tsx',{jsx:{runtime:'classic'}})).code.replace(/^import [^\n]+;?$/gm,'').replace('export function ','function ');
 return new Function('React',...Object.keys(dependencies),code+';return '+name)({createElement,Fragment},...Object.values(dependencies));
}
function all(el,predicate,out=[]){if(Array.isArray(el)){el.forEach(x=>all(x,predicate,out));return out;}if(!el||typeof el!=='object')return out;if(predicate(el))out.push(el);all(el.props?.children,predicate,out);return out;}
test('conditions and complete envelope round-trip without erasing assumptions',()=>{
 assert.deepEqual(parseScheduleSnapshots(serializeScheduleSnapshots([snapshot])),[snapshot]);
 assert.equal(compareScheduleSnapshots(result,{...result,assumptions:{...request,facts:{needed:false}}})[0].routeChanged,true);
 assert.equal(compareScheduleSnapshots(result,result)[0].routeChanged,false);
 for(const patch of [{facts:{needed:'yes'}},{objectRules:[{...request.objectRules[0],expectedValue:null}]},{branchProbabilities:[{...request.branchProbabilities[0],weights:[{edgeId:'a',probability:2}]}]}])
  assert.throws(()=>serializeScheduleSnapshots([{...snapshot,request:{...request,...patch}}]));
});
test('damaged envelopes and missing case choices are rejected, not silently rendered',()=>{
 for(const patch of [{probabilityMass:.5},{cases:[{...leaf,choices:undefined}]},{cases:[{...leaf,probability:0}]},{earliestEnd:'broken'},{cases:[{...leaf,nominalHours:null}]}])
  assert.throws(()=>serializeScheduleSnapshots([{...snapshot,result:{...result,alternativeEnvelope:{...envelope,...patch}}}]));
});
test('CSV exports all facts, rules, leaf choices and explicit non-guarantee',()=>{
 const text=scheduleCsv(result);
 for(const value of ['needed','drawing','0.25','0.75','Номинальные часы','a','b'])assert.ok(text.includes(value),value);
 assert.ok(text.includes('Нет'));
});
test('range is read-only until an explicit leaf button, without hidden calculation',async()=>{
 const View=await component('ScheduleScenarioResult');const choices=[];
 const tree=View({result,disabled:false,onChoose:v=>choices.push(v)});
 const html=renderToStaticMarkup(tree);assert.match(html,/не гарантированный срок/);assert.match(html,/5.00/);
 assert.equal(choices.length,0);const buttons=all(tree,e=>e.type==='button');assert.equal(buttons.length,2);
 buttons[0].props.onClick();assert.deepEqual(choices,[leaf]);
 assert.equal(View({result:{...result,alternativeEnvelope:undefined,assumptions:{}},disabled:false,onChoose(){}}),null);
});
test('editor changes exact binding and percentage without mutating caller objects',async()=>{
 const Editor=await component('ScheduleConditionEditor',{useState:v=>[v,()=>{}]});const changes=[];
 const model={id:'p',name:'Учебный',nodes:[{id:'fast',name:'Разработать',type:'task',informationObjects:[{objectId:'drawing',name:'Чертёж',role:'Output',condition:'Если нужен'}]},{id:'g',name:'Выбрать',type:'exclusiveGateway'}],edges:[{id:'a',sourceId:'g',targetId:'fast'},{id:'b',sourceId:'g',targetId:'slow'}]};
 const tree=Editor({models:[model],facts:request.facts,rules:request.objectRules,probabilities:request.branchProbabilities,branches:{},disabled:false,onChange:(...args)=>changes.push(args)});
 const percent=all(tree,e=>e.type==='input'&&e.props.className==='scenario-probability')[0];percent.props.onChange({target:{value:'40'}});
 assert.equal(changes[0][2][0].weights[0].probability,.4);assert.equal(request.branchProbabilities[0].weights[0].probability,.25);
 const binding=all(tree,e=>e.type==='input'&&e.props.type==='checkbox')[0];binding.props.onChange({target:{checked:false}});
 assert.equal(changes[1][1].length,0);assert.equal(request.objectRules.length,1);
 assert.match(renderToStaticMarkup(tree),/Текст исходного условия не исполняется/);
});
