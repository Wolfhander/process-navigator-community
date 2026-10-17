import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectReadability } from '../src/process-readability.ts';
const node = (id, x = 0, y = 0) => ({ id, type: 'task', name: 'Шаг', laneId: 'a', x, y, width: 150, height: 80 });
const model = nodes => ({ nodes, edges: [], lanes: [{id:'a'}] });
test('readability: touching blocks are not overlapping and source is unchanged', () => {
  const source = model([node('a'), node('b',150)]);
  const before = JSON.stringify(source);
  assert.equal(inspectReadability(source).advice.length,0);
  assert.equal(JSON.stringify(source),before);
});
test('readability: long text, overlap and bad geometry are separate advisory groups', () => {
  const result = inspectReadability(model([{...node('a'),name:'Длинное название '.repeat(30)},node('b',10),{...node('c'),width:NaN}]));
  assert.deepEqual(result.advice.map(item=>item.code),['geometry','text','overlap']);
  assert.deepEqual(result.advice.find(item=>item.code==='overlap').nodeIds,['a','b']);
});
test('readability: density is local to a lane, not a universal model limit', () => {
  const nodes = Array.from({length:16},(_,i)=>({...node(String(i),i*200),laneId:String(i)}));
  assert.ok(!inspectReadability({...model(nodes),lanes:nodes.map(n=>({id:n.laneId}))}).advice.some(a=>a.code==='density'));
  assert.ok(inspectReadability(model(nodes.map(n=>({...n,laneId:'a'})))).advice.some(a=>a.code==='density'));
});
test('readability: bounds and expensive overlap checks report incomplete inspection', () => {
  assert.equal(inspectReadability(model(Array(5001).fill(node('x')))).limited,true);
  const result = inspectReadability(model(Array.from({length:500},(_,i)=>node(String(i)))));
  assert.equal(result.limited,true);
  assert.ok(result.advice.some(item=>item.code==='limit'));
});
test('readability: empty model is safe and stretched layout produces advice', () => {
  assert.deepEqual(inspectReadability(model([])),{advice:[],limited:false});
  assert.ok(inspectReadability(model([node('a'),node('b',3000)])).advice.some(item=>item.code==='aspect'));
});
