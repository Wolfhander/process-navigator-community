import test from 'node:test';
import assert from 'node:assert/strict';
import {transferRouteEvidence} from '../src/transfer-route-evidence.ts';
import {transferCsv} from '../src/information-transfer-report.ts';

const object={id:'drawing',name:'Чертёж',producers:[],consumers:[]};
const side=(elementId,processId='plant')=>({scope:'Step',processId,elementId});
const pair=(a,b)=>({object,source:side(a),target:side(b)});
const graph=(ids,edges)=>({id:'plant',nodes:ids.map(id=>({id})),edges:edges.map(([sourceId,targetId])=>({sourceId,targetId}))});
test('directed routes through a gateway, alternative arms and a separate cycle stay distinct',()=>{
  const model=graph(['source','gate','left','right','end','x','y'],[['source','gate'],['gate','left'],['gate','right'],['left','end'],['right','end'],['x','y'],['y','x']]);
  const rows=[pair('source','end'),pair('left','right'),pair('end','source'),pair('x','y'),pair('x','x'),pair('missing','end'),{...pair('source','end'),target:side('end','supplier')}, {object}];
  assert.deepEqual([...transferRouteEvidence(rows,{plant:model}).values()],['reachable','unreachable','unreachable','reachable','same','unknown','external','unknown']);
});
test('damaged graph cannot establish absence and global work budget fails to unknown',()=>{
  const rows=[pair('a','b'),pair('b','a')];
  assert.deepEqual([...transferRouteEvidence(rows,{plant:graph(['a','b'],[['a','b'],['missing','a']])}).values()],['reachable','unknown']);
  const ids=Array.from({length:5000},(_,i)=>String(i));
  const chain=graph(ids,ids.slice(1).map((id,i)=>[String(i),id]));
  const many=Array.from({length:30},(_,i)=>pair(String(i),'4999'));
  const states=[...transferRouteEvidence(many,{plant:chain}).values()];
  assert.equal(states[0],'reachable');assert.equal(states.at(-1),'unknown');
});
test('CSV retains structural status, filter, and non-factual scope',()=>{
  const row=pair('a','b'),routes=transferRouteEvidence([row],{plant:graph(['a','b'],[['a','b']])});
  const meta={generatedAt:'now',query:'',built:1,limited:false,modelLimit:false,failures:[],routes,routeFilter:'reachable'};
  assert.match(transferCsv([row],new Map(),meta),/не факт передачи[\s\S]*"Путь в BPMN найден";"Путь в BPMN найден"/);
  assert.match(transferCsv([],new Map(),meta),/;"Путь в BPMN найден"\r\n$/);
});
