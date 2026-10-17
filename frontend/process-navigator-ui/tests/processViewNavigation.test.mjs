import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement } from 'react';
const source=readFileSync(new URL('../src/ProcessViewNavigation.tsx',import.meta.url),'utf8');
const compiled=await transformWithOxc(source,'ProcessViewNavigation.tsx',{jsx:{runtime:'classic'}});
function setup(view='instruction') {
  let cleanup,changed,prints=0;
  const listeners=new Map();
  const window={addEventListener:(name,cb)=>listeners.set(name,cb),removeEventListener:(name,cb)=>{if(listeners.get(name)===cb)listeners.delete(name);},print:()=>prints++};
  let expanded=0,restored=0;
  const Page=new Function('React','useEffect','prepareProcessViewPrint','window','document',compiled.code.replace(/import[^;]+;/g,'').replace('export function ','function ')+';return ProcessViewNavigation;')(
    {createElement},cb=>cleanup=cb(),()=>{expanded++;return()=>restored++;},window,{querySelector:()=>({})});
  const tree=Page({view,onChange:value=>changed=value});
  return {tree,listeners,cleanup,changed:()=>changed,prints:()=>prints,expanded:()=>expanded,restored:()=>restored};
}
test('navigation exposes four exclusive views and does not execute actions during render',()=>{
  const s=setup();
  const buttons=s.tree.props.children[0];
  assert.equal(buttons.length,4);
  assert.equal(buttons.filter(b=>b.props['aria-current']==='page').length,1);
  assert.equal(s.changed(),undefined);
  buttons[1].props.onClick();
  assert.equal(s.changed(),'overview');
  s.tree.props.children[1].props.onClick();assert.equal(s.prints(),1);
  s.cleanup();
});
test('print lifecycle restores sections after cancellation and unmount removes handlers',()=>{
  const s=setup();
  s.listeners.get('beforeprint')();assert.equal(s.expanded(),1);
  s.listeners.get('afterprint')();assert.equal(s.restored(),1);
  s.listeners.get('beforeprint')();
  s.cleanup();
  assert.equal(s.restored(),2);
  assert.equal(s.listeners.size,0);
});
test('diagram has no misleading document-print command',()=>{
  const s=setup('diagram');
  assert.equal(s.tree.props.children[1],false);
  s.cleanup();
});
