import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {processes} from '../../../tools/generate-demo-showcase.mjs';

const compiled=await transformWithOxc(readFileSync(new URL('../src/OverviewLinkedBranch.tsx',import.meta.url),'utf8'),'OverviewLinkedBranch.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
const model=processes.find(p=>p.id==='demo-showcase-l4-drawing');
const setup=(loader,stored={},requested='',archived=loader)=>{
  let effect,updates=[],index=0;
  const Page=new Function('React','useEffect','useState','loadProcess','loadArchivedProcess','ProcessRouteOverview',code+';return OverviewLinkedBranch;')(
    {createElement,Fragment},fn=>effect=fn,value=>{const i=index++;return [i===0?stored:i===3?requested:value,v=>updates.push(v)];},loader,archived,()=>null);
  return {Page,start:()=>effect(),updates};
};
test('overview loads only an exact published child and shows the edition',async()=>{
  for(const value of [{...model,status:'Draft'},{...model,id:'other',status:'Published'},{...model,version:'1.0',status:'Published'}]){
    const s=setup(async()=>value);
    s.Page({id:model.id,ancestors:['root'],onOpen(){}});
    assert.equal(s.updates.length,0);
    const stop=s.start();await new Promise(resolve=>setImmediate(resolve));stop();
    const result=s.updates.at(-1);
    if(value.id!==model.id||value.status!=='Published')assert.match(result.error,/недоступна/);
    else {
      const html=renderToStaticMarkup(setup(async()=>value,result).Page({id:model.id,ancestors:['root'],onOpen(){}}));
      assert.match(html,/действующая 1.0/);
    }
  }
});
test('an exact archived revision is loaded separately and cannot be replaced with the current edition',async()=>{
  const calls=[];
  for(const version of ['0.7','1.0']){
    const value={...model,status:'Archived',version};
    const s=setup(()=>assert.fail('current endpoint'),{},'0.7',async(id,revision)=>{calls.push([id,revision]);return value;});
    s.Page({id:model.id,ancestors:['root'],onOpen(){}});
    const stop=s.start();await new Promise(resolve=>setImmediate(resolve));stop();
    if(version==='0.7')assert.equal(s.updates.at(-1).model.version,'0.7');
    else assert.match(s.updates.at(-1).error,/недоступна/);
  }
  assert.deepEqual(calls,[[model.id,'0.7'],[model.id,'0.7']]);
});
test('cycles and depth guard do not request models; collapse cancels an outstanding load',async()=>{
  for(const ancestors of [[model.id],Array(21).fill('parent')]){
    const s=setup(()=>{assert.fail('blocked request');});
    assert.match(renderToStaticMarkup(s.Page({id:model.id,ancestors,onOpen(){}})),/цикл или предел/);
    s.start();
  }
  let resolve,signal;
  const s=setup((id,request)=>{signal=request;return new Promise(done=>resolve=done);});
  s.Page({id:model.id,ancestors:['root'],onOpen(){}});
  const stop=s.start();stop();resolve({...model,status:'Published'});
  await new Promise(done=>setImmediate(done));
  assert.equal(signal.aborted,true);assert.deepEqual(s.updates,[{}]);
});
