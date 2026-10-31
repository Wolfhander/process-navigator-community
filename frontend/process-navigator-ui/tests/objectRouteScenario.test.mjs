import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {objectRouteScenario} from '../src/object-route-scenario.ts';
const fixture=JSON.parse(readFileSync(new URL('../../../master-data/object-route-scenario-fixture.json',import.meta.url),'utf8'));
const occurrence=target=>({processId:fixture.id,scope:'Step',elementId:target,required:true});
test('stored master graph covers nested XOR, shared merge, selection, and alternative combinations',()=>{
 for(const c of fixture.cases){const result=objectRouteScenario(occurrence(c.target),fixture,c.choices);assert.equal(result.status,c.status);assert.equal(result.alternatives.length,c.alternatives);if(c.conditions!==null)assert.equal(result.alternatives[0].conditionCount,c.conditions);}
});
test('conditions remain data, graph and choices are not mutated',()=>{
 const m=structuredClone(fixture),before=JSON.stringify(m),choices={g1:'yes'};
 objectRouteScenario({...occurrence('make'),condition:'eval("bad")'},m,choices);assert.equal(JSON.stringify(m),before);assert.deepEqual(choices,{g1:'yes'});
});
test('unavailable, passport, missing node, startless, duplicates, and broken edges stay explicit',()=>{
 assert.equal(objectRouteScenario(occurrence('make')).status,'Unavailable');
 assert.equal(objectRouteScenario({...occurrence('make'),processId:'other'},fixture).status,'Unavailable');
 assert.equal(objectRouteScenario({...occurrence('make'),scope:'Process'},fixture).status,'Passport');
 assert.equal(objectRouteScenario(occurrence('unknown'),fixture).status,'Invalid');
 assert.equal(objectRouteScenario(occurrence('make'),{...fixture,nodes:fixture.nodes.filter(n=>n.id!=='s'),edges:fixture.edges.filter(e=>e.sourceId!=='s')}).status,'Unknown');
 assert.equal(objectRouteScenario(occurrence('make'),{...fixture,nodes:[...fixture.nodes,fixture.nodes[0]]}).status,'Invalid');
 assert.equal(objectRouteScenario(occurrence('make'),{...fixture,edges:[...fixture.edges,{id:'broken',sourceId:'s',targetId:'lost'}]}).status,'Invalid');
});
test('invalid or stale scenario is not silently applied, and AND is never selectable as XOR',()=>{
 for(const choices of [{g1:'skip'},{unknown:'yes'},{g2:'__proto__'}])assert.equal(objectRouteScenario(occurrence('make'),fixture,choices).status,'Invalid');
 const parallel={...fixture,nodes:fixture.nodes.map(n=>n.id==='g1'?{...n,type:'parallelGateway'}:n)};
 assert.equal(objectRouteScenario(occurrence('make'),parallel,{g1:'yes'}).status,'Invalid');
 assert.equal(objectRouteScenario(occurrence('make'),parallel).alternatives[0].conditions.some(c=>c.gatewayId==='g1'),false);
});
test('cycle is finite and labelled, budget exhaustion never claims an unseen target unreachable',()=>{
 const loop={...fixture,edges:[{id:'loop',sourceId:'g2',targetId:'g1'},...fixture.edges]};
 const result=objectRouteScenario(occurrence('use'),loop);assert.equal(result.status,'Reachable');assert.equal(result.cycle,true);
 const limited=objectRouteScenario(occurrence('make'),fixture,{},0);assert.equal(limited.status,'Unknown');assert.equal(limited.limited,true);
});
test('missing labels are explicit, optional text is not replaced by branch meaning',()=>{
 const result=objectRouteScenario(occurrence('make'),{...fixture,edges:fixture.edges.map(e=>({...e,label:''}))});
 assert.ok(result.alternatives[0].conditions.every(c=>c.label==='Условие ветви не указано'));
});
test('large graphs, deep paths, and path combination explosion are bounded without recursion',()=>{
 const nodes=Array.from({length:2000},(_,i)=>({id:'n'+i,type:i===0?'startEvent':'task'})),edges=nodes.slice(1).map((_,i)=>({id:'e'+i,sourceId:'n'+i,targetId:'n'+(i+1)}));
 const result=objectRouteScenario({...occurrence('n1999')},{id:fixture.id,nodes,edges});assert.equal(result.status,'Reachable');assert.equal(result.alternatives[0].nodeCount,2000);assert.equal(result.alternatives[0].nodeIds.length,20);
 assert.equal(objectRouteScenario(occurrence('make'),{...fixture,nodes:[...nodes,{id:'extra',type:'task'}]}).limited,true);
 const ns=[{id:'s',type:'startEvent'},{id:'g',type:'exclusiveGateway'},{id:'t',type:'task'}],es=[{id:'a',sourceId:'s',targetId:'g'},...Array.from({length:30},(_,i)=>({id:'o'+i,sourceId:'g',targetId:'t'}))];
 const capped=objectRouteScenario(occurrence('t'),{id:fixture.id,nodes:ns,edges:es});assert.equal(capped.alternatives.length,25);assert.equal(capped.limited,true);
});
test('detected cycle is still disclosed when alternative enumeration is truncated',()=>{
 const model={...fixture,edges:[{id:'loop',sourceId:'g2',targetId:'g1'},...fixture.edges,...Array.from({length:30},(_,i)=>({id:'extra'+i,sourceId:'g1',targetId:'use'}))]};
 const result=objectRouteScenario(occurrence('use'),model);assert.equal(result.cycle,true);assert.equal(result.limited,true);assert.ok(result.messages.some(m=>m.includes('повтор')));
});
