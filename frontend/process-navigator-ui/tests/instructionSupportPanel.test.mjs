import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {checkInstructionMaterials,instructionAssignment,materialKey} from '../src/instruction-support.ts';
const compiled=await transformWithOxc(readFileSync(new URL('../src/InstructionSupportPanel.tsx',import.meta.url),'utf8'),'InstructionSupportPanel.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
const process={id:'p',version:'1',nodes:[{id:'a',type:'task',name:'Действие',laneId:'l',artifacts:[{name:'Файл',reference:'artifact:a',version:'1'}]}]};
function setup(load=async()=>{throw Error('Недоступны назначения');},probe=async()=>200) {
  const state=[undefined,undefined,false,'','','',0];let index=0,calls=0;
  const ref={current:undefined};
  const Page=new Function('React','useState','useEffect','useRef','loadAssignments','probeInstructionArtifact','checkInstructionMaterials','instructionAssignment','materialKey',code+';return InstructionSupportPanel;')(
    {createElement},()=>{const i=index++;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},()=>{},()=>ref,
    async(...args)=>{calls++;return load(...args);},probe,checkInstructionMaterials,instructionAssignment,materialKey);
  return{state,calls:()=>calls,render:()=>{index=0;return Page({process,onSelect:()=>{}});}};
}
function find(tree,text) {
  if(Array.isArray(tree))return tree.map(t=>find(t,text)).find(Boolean);
  if(!tree||typeof tree!=='object')return;
  return tree.type==='button'&&tree.props.children===text?tree:find(tree.props?.children,text);
}
test('support panel never probes automatically and failed directory does not erase material result',async()=>{
  const s=setup();const tree=s.render();assert.equal(s.calls(),0);
  assert.match(renderToStaticMarkup(tree),/Проверка ещё не завершена/);
  find(tree,'Обновить назначения и проверить материалы').props.onClick();
  await new Promise(r=>setImmediate(r));
  assert.equal(s.calls(),1);assert.equal(s.state[1][materialKey(process.nodes[0].artifacts[0])].status,'available');
  assert.match(s.state[3],/Недоступны назначения/);
  assert.match(renderToStaticMarkup(s.render()),/Назначения не загружены/);
});
test('support cancellation prevents late data from attaching to another screen',async()=>{
  let resolve;const s=setup(()=>new Promise(r=>resolve=r));
  find(s.render(),'Обновить назначения и проверить материалы').props.onClick();
  find(s.render(),'Отменить').props.onClick();
  resolve({processId:'p',users:[],lanes:[]});
  await new Promise(r=>setImmediate(r));
  assert.equal(s.state[0],undefined);assert.equal(s.state[1],undefined);assert.equal(s.state[2],false);
});
