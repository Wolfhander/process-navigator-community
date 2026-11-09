import test from 'node:test';
import assert from 'node:assert/strict';
import {compareRoutes} from '../src/route-comparison.ts';

const original={id:'p',lanes:[{id:'l',name:'Отдел'}],
  nodes:[{id:'a',name:'Собрать',type:'task',laneId:'l',x:1},{id:'b',name:'Проверить',type:'task',laneId:'l'}],
  edges:[{id:'e',sourceId:'a',targetId:'b',label:'Да'}]};

test('route comparison ignores geometry, metadata and order',()=>{
  assert.deepEqual(compareRoutes(original,{...original,nodes:[...original.nodes].reverse().map(n=>({...n,x:100,instruction:'новая'}))}),[]);
});

test('route comparison distinguishes rename, removal, addition and direction',()=>{
  const after={...original,lanes:[{id:'l',name:'Другой отдел'}],
    nodes:[original.nodes[0],{...original.nodes[1],id:'c'}],
    edges:[{...original.edges[0],sourceId:'c',targetId:'a'}]};
  assert.deepEqual(compareRoutes(original,after).map(x=>[x.id,x.kind]),
    [['l','changed'],['b','removed'],['c','added'],['e','changed']]);
  assert.equal(compareRoutes(after,original).find(x=>x.id==='b').kind,'added');
});

test('different processes cannot be compared',()=>{
  assert.throws(()=>compareRoutes(original,{...original,id:'other'}),/одного процесса/);
});
