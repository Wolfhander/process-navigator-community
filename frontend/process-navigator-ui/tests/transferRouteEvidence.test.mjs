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
  assert.deepEqual([...transferRouteEvidence(rows,{plant:model}).values()],['reachable','unreachable','unreachable','reachable','same','unknown','unknown','unknown']);
});
test('both directions of a direct call require a shared contract and real paths across its boundary',()=>{
  const binding=(role,version='2')=>({objectId:'drawing',role,version});
  const parent=graph(['prepare','call','accept'],[['prepare','call'],['call','accept']]);
  parent.nodes[0].informationObjects=[binding('Output')];
  parent.nodes[1].linkedProcessId='child';
  parent.nodes[1].informationObjects=[binding('Input'),binding('Output')];
  parent.nodes[2].informationObjects=[binding('Input')];
  const child={...graph(['start','work','end'],[['start','work'],['work','end']]),id:'child'};
  child.nodes[0].type='startEvent';child.nodes[2].type='endEvent';
  child.nodes[1].informationObjects=[binding('Input'),binding('Output')];
  const rows=[{object,source:side('prepare'),target:side('work','child')},{object,source:side('work','child'),target:side('accept')}];
  const get=(p,c)=>[...transferRouteEvidence(rows,{plant:p,child:c}).values()];
  assert.deepEqual(get(parent,child),['nested','nested']);
  assert.deepEqual(get({...parent,nodes:[...parent.nodes,{...parent.nodes[1],id:'otherCall'}]},child),['external','external']);
  assert.deepEqual(get(parent,{...child,edges:child.edges.slice(1)}),['external','nested']);
  const conflict=structuredClone(child);conflict.nodes[1].informationObjects[0].version='1';
  assert.deepEqual(get(parent,conflict),['external','nested']);
  const csv=transferCsv(rows,new Map(),{generatedAt:'now',query:'',built:2,limited:false,modelLimit:false,failures:[],routes:transferRouteEvidence(rows,{plant:parent,child}),routeFilter:'nested'});
  assert.match(csv,/Путь через границу подпроцесса найден/);
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
