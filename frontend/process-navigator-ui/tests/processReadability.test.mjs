import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectReadability } from '../src/process-readability.ts';
const node = (id, x = 0, y = 0) => ({ id, type: 'task', name: 'Шаг', laneId: 'a', x, y, width: 150, height: 80 });
const model = nodes => ({ nodes, edges: [], lanes: [{id:'a'}] });
const withEdge = points => ({...model([node('a',-200),node('middle'),node('b',300)]),edges:[{id:'flow',sourceId:'a',targetId:'b',points}]});
test('readability: crossing uses the complete polyline and excludes endpoints', () => {
  const source = withEdge([{x:-50,y:40},{x:300,y:40}]);
  const before = JSON.stringify(source);
  const advice = inspectReadability(source).advice.find(item=>item.code==='edge-crossing');
  assert.deepEqual(advice.nodeIds,['middle']);
  assert.deepEqual(advice.edgeIds,['flow']);
  assert.equal(JSON.stringify(source),before);
  assert.ok(!inspectReadability(withEdge([{x:-50,y:40},{x:-50,y:100},{x:300,y:100},{x:300,y:40}])).advice.some(item=>item.code==='edge-crossing'));
});
test('readability: border contact and zero-length segments are not crossings; diagonal is', () => {
  for (const points of [[{x:-50,y:0},{x:300,y:0}],[{x:20,y:20},{x:20,y:20}],[{x:-10,y:10},{x:10,y:-10}]]) {
    assert.ok(!inspectReadability(withEdge(points)).advice.some(item=>item.code==='edge-crossing'));
  }
  assert.ok(inspectReadability(withEdge([{x:-50,y:-50},{x:200,y:120}])).advice.some(item=>item.code==='edge-crossing'));
});
test('readability: missing or invalid points and segment limits are explicit', () => {
  assert.ok(inspectReadability(withEdge([])).advice.some(item=>item.code==='edge-geometry'));
  assert.ok(inspectReadability(withEdge([{x:NaN,y:0},{x:5,y:0}])).advice.some(item=>item.code==='edge-geometry'));
  const result = inspectReadability(withEdge(Array.from({length:20002},(_,i)=>({x:i,y:100}))));
  assert.equal(result.limited,true);
  assert.ok(result.advice.some(item=>item.code==='edge-limit'));
});
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
