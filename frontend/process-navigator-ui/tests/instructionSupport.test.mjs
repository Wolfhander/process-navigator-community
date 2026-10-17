import test from 'node:test';
import assert from 'node:assert/strict';
import {checkInstructionMaterials,instructionAssignment,materialKey} from '../src/instruction-support.ts';
const artifact=(id,version='1')=>({name:id,reference:'artifact:'+id,version});
const process={id:'p',version:'1',nodes:[],edges:[],lanes:[]};
const model=artifacts=>({...process,nodes:[{id:'a',artifacts}]});
test('material checks deduplicate exact versions and never probe external paths or implicit versions',async()=>{
  const a=artifact('one'),missingVersion=artifact('unpinned',''),external={name:'external',reference:'https://example.test',version:'1'};
  const calls=[];
  const result=await checkInstructionMaterials(model([a,a,missingVersion,external]),async(...args)=>{calls.push(args);return 200;},new AbortController().signal);
  assert.equal(calls.length,1);assert.equal(result[materialKey(a)].status,'available');
  assert.equal(result[materialKey(missingVersion)].status,'unpinned');assert.equal(result[materialKey(external)].status,'external');
  assert.equal(Object.keys(result).length,3);
});
test('HTTP failure categories and network errors cannot become available',async()=>{
  const artifacts=[200,404,403,401,500,405,0].map(code=>artifact(String(code)));
  const result=await checkInstructionMaterials(model(artifacts),async reference=>{const code=Number(reference.slice(9));if(!code)throw Error('network');return code;},new AbortController().signal);
  assert.deepEqual(artifacts.map(a=>result[materialKey(a)].status),['available','missing','forbidden','forbidden','unknown','unknown','unknown']);
});
test('at most three probes overlap and total requests are capped',async()=>{
  let active=0,max=0,calls=0;
  const result=await checkInstructionMaterials(model(Array.from({length:205},(_,i)=>artifact(String(i)))),async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>setImmediate(r));active--;return 200;},new AbortController().signal);
  assert.equal(calls,200);assert.ok(max<=3);assert.equal(Object.values(result).filter(r=>r.status==='limit').length,5);
});
test('cancelled probes do not return stale confirmation',async()=>{
  const controller=new AbortController();
  await assert.rejects(()=>checkInstructionMaterials(model([artifact('a')]),async()=>{controller.abort();return 200;},controller.signal),/отменена/);
});
test('oversized reference sets are rejected before requesting files',async()=>{
  const probe=async()=>{throw Error('No requests expected');};
  await assert.rejects(()=>checkInstructionMaterials({...process,nodes:Array(5001).fill({id:'a'})},probe,new AbortController().signal),/5000/);
  await assert.rejects(()=>checkInstructionMaterials(model(Array(20001).fill(artifact('x'))),probe,new AbortController().signal),/20000/);
});
test('lane assignment and exact-instance personal assignment remain separate, with unknown/inactive users explicit',()=>{
  const node={id:'a',laneId:'lane'};
  const assignments={processId:'p',lanes:[{laneId:'lane',userIds:['u','missing']}],users:[{id:'u',displayName:'Имя',isActive:false}]};
  const instance={processId:'p',processVersion:'1',name:'Экземпляр',steps:[{elementId:'a',assignedUserId:'u'}]};
  const result=instructionAssignment(process,node,assignments,instance);
  assert.match(result.lane,/неактивен/);assert.match(result.lane,/missing/);assert.match(result.personal,/Имя/);
  assert.match(instructionAssignment(process,node,assignments,{...instance,processVersion:'2'}).personal,/не выбран/);
  assert.match(instructionAssignment(process,node,{...assignments,processId:'other'},instance).lane,/не загружены/);
  assert.match(instructionAssignment(process,node,undefined,instance).personal,/ID u/);
  assert.match(instructionAssignment(process,node,assignments,{...instance,steps:[]}).personal,/отсутствует/);
});
