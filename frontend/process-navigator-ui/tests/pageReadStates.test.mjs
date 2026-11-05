import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement,Component} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {pageReadRequest} from '../src/page-read-request.ts';
const tick=()=>new Promise(done=>setImmediate(done));
test('page read distinguishes empty success, thrown errors, and late success or failure after leaving',async()=>{
  const values=[],errors=[];
  pageReadRequest(async()=>[],v=>values.push(v),m=>errors.push(m));await tick();
  assert.deepEqual(values,[[]]);assert.deepEqual(errors,[]);
  pageReadRequest(()=>{throw Error('Недоступно');},v=>values.push(v),m=>errors.push(m));await tick();
  assert.deepEqual(errors,['Недоступно']);
  for(const reject of [false,true]){
    let finish,signal;
    const stop=pageReadRequest(s=>{signal=s;return new Promise((resolve,fail)=>finish=reject?fail:resolve);},v=>values.push(v),m=>errors.push(m));
    await tick();stop();finish(reject?Error('Late'):['old']);await tick();assert.equal(signal.aborted,true);
  }
  assert.deepEqual(values,[[]]);assert.deepEqual(errors,['Недоступно']);
});
test('shared read UI never renders a spinner with an error and offers explicit retry',async()=>{
  const compiled=await transformWithOxc(readFileSync(new URL('../src/PageReadState.tsx',import.meta.url),'utf8'),'PageReadState.tsx',{jsx:{runtime:'classic'}});
  const Page=new Function('React',compiled.code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ')+';return PageReadState;')({createElement});
  const html=renderToStaticMarkup(Page({error:'Доступ запрещён',loading:'Ждём',onRetry(){}}));
  assert.match(html,/role="alert"/);assert.match(html,/Повторить загрузку/);assert.doesNotMatch(html,/loader|Ждём/);
  assert.match(renderToStaticMarkup(Page({loading:'Ждём',onRetry(){}})),/role="status"/);
});
test('section failure can return home without permanently trapping the interface in its fallback',async()=>{
  const compiled=await transformWithOxc(readFileSync(new URL('../src/SectionLoadBoundary.tsx',import.meta.url),'utf8'),'SectionLoadBoundary.tsx',{jsx:{runtime:'classic'}});
  const Boundary=new Function('React','Component',compiled.code.replace(/^import[^\n]*\n/gm,'').replace('export class ','class ')+';return SectionLoadBoundary;')({createElement},Component);
  let returned=false;
  const instance=new Boundary({children:'content',onHome(){returned=true;}});
  instance.state={failed:true};instance.setState=patch=>instance.state={...instance.state,...patch};
  const tree=instance.render();tree.props.children.find(child=>child?.type==='button').props.onClick();
  assert.equal(returned,true);assert.equal(instance.render(),'content');
});
