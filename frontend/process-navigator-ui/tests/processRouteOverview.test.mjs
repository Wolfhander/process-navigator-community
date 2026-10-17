import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const compiled = await transformWithOxc(readFileSync(new URL('../src/ProcessRouteOverview.tsx',import.meta.url),'utf8'),'ProcessRouteOverview.tsx',{jsx:{runtime:'classic'}});
const Page = new Function('React',compiled.code.replace(/import[^;]+;/g,'').replace('export function ','function ')+';return ProcessRouteOverview;')({createElement});
const model = {nodes:[{id:'a',name:'Действие',type:'task',laneId:'l',linkedProcessId:'child'},{id:'g',name:'Разделение',type:'parallelGateway',laneId:'unknown'}],lanes:[{id:'l',name:'Отдел'}],edges:[{id:'e1',sourceId:'a',targetId:'g',label:'Да'},{id:'e2',sourceId:'g',targetId:'a',label:'Повтор'},{id:'e3',sourceId:'g',targetId:'missing'},{id:'e4',sourceId:'gone',targetId:'a'}]};
test('overview preserves loops, parallel meaning, missing references and linked detail without mutation',()=>{
  const before=JSON.stringify(model);
  const html=renderToStaticMarkup(Page({process:model,onSelect:()=>{throw Error('Not during rendering');}}));
  for(const text of ['Да','Повтор','Параллельный шлюз не означает','Без известной дорожки','missing','child','без исходного элемента']) assert.ok(html.includes(text));
  assert.equal(JSON.stringify(model),before);
});
test('overview empty and bounded states are explicit',()=>{
  assert.match(renderToStaticMarkup(Page({process:{nodes:[],edges:[],lanes:[]},onSelect:()=>{}})),/нет элементов/);
  assert.match(renderToStaticMarkup(Page({process:{...model,nodes:Array(5001).fill(model.nodes[0])},onSelect:()=>{}})),/Обзор не построен/);
});
test('overview only selects original node after explicit click',()=>{
  let selected;
  const tree=Page({process:model,onSelect:node=>selected=node});
  function find(value) {
    if(Array.isArray(value)) return value.map(find).find(Boolean);
    if(!value || typeof value!=='object') return;
    return value.type==='button' ? value : find(value.props?.children);
  }
  assert.equal(selected,undefined);
  find(tree).props.onClick();
  assert.equal(selected,model.nodes[0]);
});
