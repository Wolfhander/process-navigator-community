import test from 'node:test';
import assert from 'node:assert/strict';
import {objectCompositionTree,objectCompositionCsv} from '../src/object-composition-tree.ts';

const kit=(id,components=[],overrides={})=>({id,name:id,version:'2',lifecycleState:'Active',components,...overrides});
const part=(objectId,overrides={})=>({objectId,required:true,...overrides});

test('nested control kit preserves each occurrence, optional parents and inherited conditions',()=>{
  const root=kit('root',[part('A',{required:false,condition:'После испытаний'}),part('b')]);
  const a=kit('a',[part('drawing',{version:'1'}),part('missing')]);
  const b=kit('b',[part('drawing',{version:'2'})]);
  const drawing=kit('drawing',[],{name:'=Учебный чертёж'});
  const before=JSON.stringify([root,a,b,drawing]);
  const tree=objectCompositionTree(root,[a,b,drawing]);
  assert.equal(tree.limited,false);
  assert.deepEqual(tree.rows.map(r=>[r.path.at(-1),r.required,r.conditional,r.issue]),[
    ['a',false,true,undefined],['drawing',false,true,'version'],['missing',false,true,'missing'],['b',true,false,undefined],['drawing',true,false,undefined]]);
  const csv=objectCompositionCsv(root,tree);
  assert.equal(csv.split('\r\n').length,6);
  assert.match(csv,/""root"",""a"",""drawing""/);
  assert.match(csv,/'=Учебный чертёж/);
  assert.equal(JSON.stringify([root,a,b,drawing]),before);
});
test('legacy corruption and unknown versions do not produce complete-looking results',()=>{
  const root=kit('root',[part('loop'),part('archive'),part('unknown',{version:'1'})]);
  const tree=objectCompositionTree(root,[kit('loop',[part('ROOT')]),kit('archive',[],{lifecycleState:'Archived'}),kit('unknown',[],{version:''})]);
  assert.deepEqual(tree.rows.map(r=>r.issue),[undefined,'cycle','inactive','unknown-version']);
  const many=kit('large',Array.from({length:501},(_,i)=>part('p'+i)));
  const limited=objectCompositionTree(many,[]);
  assert.equal(limited.rows.length,500);
  assert.equal(limited.limited,true);
  assert.match(objectCompositionCsv(many,limited),/Неполный/);
  const depth=Array.from({length:25},(_,i)=>kit(String(i),i<24?[part(String(i+1))]:[]));
  assert.equal(objectCompositionTree(depth[0],depth).rows.length,20);
  assert.equal(objectCompositionTree(depth[0],depth).limited,true);
});
