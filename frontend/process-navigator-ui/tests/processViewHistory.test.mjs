import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canRestoreProcessView, processViewLocation } from '../src/process-view-history.ts';
import { readProcessLocation, processLocationHash } from '../src/process-location.ts';
test('history never applies a representation to another process or source edition',()=>{
  const current={processId:'p',draft:false};
  assert.equal(canRestoreProcessView(current,{...current,view:'instruction'}),true);
  for(const target of [undefined,{...current,processId:'other'},{...current,draft:true},{...current,version:'1'}]) assert.equal(canRestoreProcessView(current,target),false);
  assert.equal(canRestoreProcessView(undefined,current),false);
});
test('view transition preserves context and does not mutate source',()=>{
  const source={processId:'p',draft:true,elementId:'a',expandedSteps:['x'],trail:['root']};
  const copy=JSON.stringify(source);
  assert.deepEqual(processViewLocation(source,'overview'),{...source,view:'overview'});
  assert.equal(JSON.stringify(source),copy);
});
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const body=app.slice(app.indexOf('    const restoreView = () => {'),app.indexOf("    window.addEventListener('popstate', restoreView);"));
function handler({editorOpen=false,hash='#process=p&view=responsibility&step=a'}={}) {
  const state={view:undefined,node:undefined,reloads:0,replaced:undefined,message:undefined,focus:undefined};
  const node={id:'a'};
  const values={
    window:{location:{hash,pathname:'/',search:'',reload:()=>state.reloads++},history:{replaceState:(_s,_t,url)=>state.replaced=url}},
    readProcessLocation,processLocationHash,canRestoreProcessView,
    processId:'p',selected:undefined,draftView:false,archivedVersion:undefined,processView:'instruction',editorOpen,enterpriseOpen:false,
    process:{nodes:[node]},setProcessView:value=>state.view=value,setSelected:value=>state.node=value,
    setFocusCommand:cb=>state.focus=cb(),setMessage:value=>state.message=value
  };
  return {run:new Function(...Object.keys(values),body+';return restoreView;')(...Object.values(values)),state,node};
}
test('browser back restores local view and original selected node without reloading',()=>{
  const h=handler();h.run();
  assert.equal(h.state.view,'responsibility');assert.equal(h.state.node,h.node);
  assert.equal(h.state.focus.elementId,'a');assert.equal(h.state.reloads,0);
});
test('browser history requests reload for a different edition rather than showing stale model',()=>{
  const h=handler({hash:'#process=p&version=old&view=overview'});h.run();
  assert.equal(h.state.reloads,1);assert.equal(h.state.view,undefined);
});
test('browser history cannot silently abandon an editor',()=>{
  const h=handler({editorOpen:true});h.run();
  assert.equal(h.state.reloads,0);assert.equal(h.state.view,undefined);
  assert.ok(h.state.message);assert.match(h.state.replaced,/view=instruction/);
});
