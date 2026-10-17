import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {collectInstructionPackage,instructionPackageHtml} from '../src/instruction-package.ts';
const compiled=await transformWithOxc(readFileSync(new URL('../src/InstructionPackagePanel.tsx',import.meta.url),'utf8'),'InstructionPackagePanel.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
const root={id:'root',name:'Корень',version:'1',status:'Draft',nodes:[{id:'s',name:'Шаг',type:'task',linkedProcessId:'child'}],edges:[],lanes:[]};
function setup({bundle,versions={},built='',partial=false,loader=async()=>{throw Error('No automatic request');}}={}) {
  const states=[bundle,versions,built,false,'',partial];
  let calls=0,index=0;const ref={current:undefined};
  const Page=new Function('React','useState','useEffect','useRef','loadProcess','loadArchivedProcess','collectInstructionPackage','instructionPackageHtml',code+';return InstructionPackagePanel;')(
    {createElement,Fragment},()=>{const i=index++;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},()=>{},()=>ref,
    async(...args)=>{calls++;return loader(...args);},async(id,version,signal)=>{calls++;return loader(id,signal,version);},collectInstructionPackage,instructionPackageHtml);
  return {render:()=>{index=0;return Page({process:root,edition:'Черновик'});},states,calls:()=>calls};
}
function button(tree,text) {
  if(Array.isArray(tree))return tree.map(t=>button(t,text)).find(Boolean);
  if(!tree || typeof tree!=='object')return;
  return tree.type==='button' && tree.props.children===text ? tree : button(tree.props?.children,text);
}
test('partial document requires explicit acknowledgement and stale choices disable download',()=>{
  const bundle={entries:[{model:root,path:['root'],edition:'Черновик'}],issues:['Недоступный уровень'],capturedAt:'now'};
  const s=setup({bundle,built:'[]'});const tree=s.render();
  assert.equal(s.calls(),0);
  assert.equal(button(tree,'Скачать инструкцию HTML').props.disabled,true);
  assert.match(renderToStaticMarkup(tree),/НЕПОЛНЫЙ ДОКУМЕНТ/);
  const acknowledged=setup({bundle,built:'[]',partial:true});
  assert.equal(button(acknowledged.render(),'Скачать инструкцию HTML').props.disabled,false);
  const stale=setup({bundle,built:'[]',partial:true,versions:{child:'2'}});
  assert.equal(button(stale.render(),'Скачать инструкцию HTML').props.disabled,true);
  assert.match(renderToStaticMarkup(stale.render()),/Соберите документ заново/);
});
test('explicit build uses chosen child version and records exact root edition',async()=>{
  let selectedVersion;
  const s=setup({versions:{child:'2'},loader:async(id,_signal,version)=>{selectedVersion=version;return {id,version:'2',status:'Published',name:id,nodes:[],edges:[],lanes:[]};}});
  button(s.render(),'Собрать сквозную инструкцию').props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.calls(),1);assert.equal(selectedVersion,'2');
  assert.equal(s.states[0].entries[0].model,root);
  assert.equal(s.states[0].entries[0].edition,'Черновик');
  assert.equal(s.states[0].entries[1].model.version,'2');
});
test('cancelling in-flight collection prevents a late result from becoming the report',async()=>{
  let resolve;
  const s=setup({loader:()=>new Promise(r=>resolve=r)});
  button(s.render(),'Собрать сквозную инструкцию').props.onClick();
  button(s.render(),'Отменить сбор').props.onClick();
  resolve({id:'child',version:'1',status:'Published',nodes:[],edges:[],lanes:[]});
  await new Promise(r=>setImmediate(r));
  assert.equal(s.states[0],undefined);assert.equal(s.states[3],false);
});
