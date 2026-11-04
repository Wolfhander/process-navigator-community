import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement,Fragment,useState as realUseState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {informationObjectVersions,occurrenceDetails} from '../src/information-object-detail.ts';
import {objectRouteScenario} from '../src/object-route-scenario.ts';
import {informationTransfers} from '../src/information-transfers.ts';
import * as report from '../src/information-transfer-report.ts';
import * as evidence from '../src/transfer-route-evidence.ts';
const code=async name=>(await transformWithOxc(readFileSync(new URL('../src/'+name+'.tsx',import.meta.url),'utf8'),name+'.tsx',{jsx:{runtime:'classic'}})).code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
const detailCode=await code('InformationObjectDetailPage'),transferCode=await code('InformationTransferPage');
const producer={scope:'Step',direction:'Producer',processId:'p',processName:'Разработка',elementId:'a',elementName:'Создать чертёж',required:true,version:'1'};
const item={id:'drawing',name:'Чертёж',kind:'Document',version:'2',lifecycleState:'Active',state:'Нет получателя',managed:true,aliases:['Модель'],producers:[producer],consumers:[],references:[],history:[],components:[]};
function makePage(body,name,params){
  return new Function(...Object.keys(params),body+';return '+name+';')(...Object.values(params));
}
const noop=()=>{};
const ObjectRouteScenarioPanel=makePage(await code('ObjectRouteScenarioPanel'),'ObjectRouteScenarioPanel',{React:{createElement,Fragment},useState:realUseState,objectRouteScenario});
test('object card displays version, state, aliases, missing parties and unavailable model without inventing transfer facts',()=>{
  const states=[{},undefined,false,[]];
  const Page=makePage(detailCode,'InformationObjectDetailPage',{React:{createElement,Fragment},useState:()=>[states.shift(),noop],useEffect:noop,ArrowLeft:()=>null,ArrowRight:()=>null,informationObjectVersions,occurrenceDetails,ObjectRouteScenarioPanel,InformationObjectCompositionView:()=>null});
  const html=renderToStaticMarkup(createElement(Page,{item,objects:[item],issues:[{code:'missing-consumer',message:'Нет получателя'}],onBack:noop,onOpen:noop,onOpenObject:noop}));
  for(const text of ['Карточка объекта','Действующий','Модель','Версия реестра: 2','Создают','Получают','Не найдены в доступных моделях','Сведения этапа недоступны','не хранилище файлов'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/undefined|NaN/);
});
test('transfer table renders at most 100 rows with explicit partial scope; summaries do not claim actual shipments',()=>{
  const objects=Array.from({length:1001},(_,i)=>({...item,id:'doc-'+i,consumers:[{...producer,processId:'q'}]}));
  const states=['',{},undefined,false,[],0,'pairs','','all'];
  const Page=makePage(transferCode,'InformationTransferPage',{React:{createElement,Fragment},useState:()=>[states.shift(),noop],useEffect:noop,useMemo:fn=>fn(),informationTransfers,...report,...evidence});
  const html=renderToStaticMarkup(createElement(Page,{objects,onBack:noop,onOpen:noop}));
  assert.equal((html.match(/<tr>/g)||[]).length,101);assert.match(html,/Страница 1 из 10/);
  assert.match(html,/только построенную выборку/);assert.match(html,/не является количеством фактических отправок/);
  assert.doesNotMatch(html,/doc-1000/);
});
test('loading prevents exporting a misleading incomplete enrichment',()=>{
  const states=['',{},undefined,true,[],0,'objects','','all'];
  const Page=makePage(transferCode,'InformationTransferPage',{React:{createElement,Fragment},useState:()=>[states.shift(),noop],useEffect:noop,useMemo:fn=>fn(),informationTransfers,...report,...evidence});
  const html=renderToStaticMarkup(createElement(Page,{objects:[],onBack:noop,onOpen:noop}));
  assert.match(html,/<button disabled="">Скачать найденные пары CSV/);
  assert.match(html,/Передачи по выбранным условиям не найдены/);
});
test('enrichment loads at most 200 models with three concurrent requests',async()=>{
  const objects=Array.from({length:233},(_,i)=>({...item,id:'doc-'+i,producers:[{...producer,processId:'p'+i}],consumers:[]}));
  let hook=0,effect,active=0,peak=0;const requested=[],updates=[];
  let done;const completed=new Promise(resolve=>done=resolve);
  const initial=['',{},undefined,true,[],0,'pairs','','all'];
  const Page=makePage(transferCode,'InformationTransferPage',{React:{createElement,Fragment},useState:()=>{const index=hook++;return[initial[index],value=>{updates.push([index,value]);if(index===3&&value===false)done();}];},useEffect:fn=>{effect=fn;},useMemo:fn=>fn(),informationTransfers,...report,...evidence,
    loadOrganization:async()=>({legalEntities:[],crossCompanyProcesses:[]}),
    loadProcess:async id=>{requested.push(id);peak=Math.max(peak,++active);await Promise.resolve();active--;return{nodes:[]};}});
  Page({objects,onBack:noop,onOpen:noop});const cleanup=effect();await completed;cleanup();
  assert.equal(requested.length,200);assert.equal(new Set(requested).size,200);assert.equal(peak,3);
  assert.equal(Object.keys(updates.filter(([index])=>index===1).at(-1)[1]).length,200);
});
test('leaving during enrichment aborts requests without committing late models or errors',async()=>{
  let hook=0,effect;const updates=[],signals=[];
  const pending=signal=>new Promise((_,reject)=>{signals.push(signal);signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});
  const initial=['',{},undefined,true,[],0,'pairs','','all'];
  const Page=makePage(transferCode,'InformationTransferPage',{React:{createElement,Fragment},useState:()=>{const index=hook++;return[initial[index],value=>updates.push([index,value])];},useEffect:fn=>{effect=fn;},useMemo:fn=>fn(),informationTransfers,...report,...evidence,loadOrganization:pending,loadProcess:(_,signal)=>pending(signal)});
  Page({objects:[item],onBack:noop,onOpen:noop});const cleanup=effect(),count=updates.length;cleanup();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(signals.length>0&&signals.every(s=>s.aborted));assert.equal(updates.length,count);
});
