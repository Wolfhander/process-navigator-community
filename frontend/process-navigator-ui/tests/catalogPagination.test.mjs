import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogHierarchy,catalogPage} from '../src/catalog-pagination.ts';

test('640 catalog entries preserve all items across bounded pages and clamp after filtering',()=>{
  const items=Array.from({length:640},(_,i)=>({id:'p'+i}));
  const slices=Array.from({length:13},(_,i)=>catalogPage(items,i));
  assert.deepEqual(slices.flatMap(page=>page.items),items);
  assert.equal(slices[0].items.length,50);
  assert.deepEqual([slices.at(-1).from,slices.at(-1).to],[601,640]);
  assert.equal(catalogPage(items.slice(0,3),12).index,0);
  assert.deepEqual(catalogPage([],Infinity),{index:0,pages:1,items:[],from:0,to:0});
});
test('iterative hierarchy handles deep trees, orphaned parents and cycles without dropping models',()=>{
  const chain=Array.from({length:12000},(_,i)=>({id:'p'+i,name:'Узел '+i,parentProcessId:i?'p'+(i-1):undefined}));
  const extras=[{id:'orphan',name:'Сирота',parentProcessId:'missing'},{id:'a',name:'A',parentProcessId:'b'},{id:'b',name:'B',parentProcessId:'a'}];
  const rows=catalogHierarchy([...chain,...extras]);
  assert.equal(rows.length,12003);
  assert.equal(rows.find(row=>row.item.id==='p11999').depth,11999);
  assert.equal(rows.find(row=>row.item.id==='orphan').depth,0);
  assert.equal(new Set(rows.map(row=>row.item.id)).size,rows.length);
});
