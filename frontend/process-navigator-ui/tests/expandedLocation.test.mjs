import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreExpandedProcesses } from '../src/expanded-location.ts';
import {readProcessLocation,processLocationHash} from '../src/process-location.ts';
import {processes} from '../../../tools/generate-demo-showcase.mjs';
const model = (id, child) => ({ id, name: id, nodes: child ? [{ id: 'step', name: 'Step', linkedProcessId: child }] : [] });

test('a copied link restores four demo levels and never follows a reassigned third link',async()=>{
  const models=Object.fromEntries(processes.map(p=>[p.id,{...p,nodes:p.steps}]));
  const targets=['demo-showcase-l1','demo-showcase-l2-engineering','demo-showcase-l3-documentation','demo-showcase-l4-drawing'];
  const root=models['demo-showcase-l0'];
  const parents=[root,...targets.slice(0,-1).map(id=>models[id])];
  const steps=parents.map((parent,i)=>parent.nodes.find(n=>n.linkedProcessId===targets[i]).id);
  const location=readProcessLocation(processLocationHash({processId:root.id,elementId:steps[0],draft:false,version:'1.0',expandedSteps:steps,expandedTargets:targets}));
  assert.equal(location.version,'1.0');assert.deepEqual(location.expandedTargets,targets);
  const load=async id=>models[id];
  const full=await restoreExpandedProcesses(root,location.expandedSteps,load,new AbortController().signal,location.expandedTargets);
  assert.deepEqual(full.entries.map(entry=>entry.process.id),targets);
  const changed=structuredClone(models);
  changed[targets[1]].nodes.find(n=>n.id===steps[2]).linkedProcessId='demo-showcase-l3-warehouse';
  const requests=[];
  const partial=await restoreExpandedProcesses(root,steps,async id=>{requests.push(id);return changed[id];},new AbortController().signal,targets);
  assert.deepEqual(requests,targets.slice(0,2));
  assert.deepEqual(partial.entries.map(entry=>entry.process.id),requests);
  assert.match(partial.error,/ветвь изменилась/);
});

test('inconsistent addresses and an incorrect model response cannot silently reopen another branch',async()=>{
  assert.equal(readProcessLocation('#process=a&expand=one&expand=two&expandTarget=b').expandedSteps,undefined);
  assert.equal(readProcessLocation('#process=a&expand=one&expandTarget=%00').expandedSteps,undefined);
  const result=await restoreExpandedProcesses(model('a','b'),['step'],async()=>model('c'),new AbortController().signal,['b']);
  assert.equal(result.entries.length,0);assert.match(result.error,/другая модель/);
});

test('restores a linked chain in order, keeping source steps', async () => {
  const models = { b: model('b', 'c'), c: model('c') };
  const result = await restoreExpandedProcesses(model('a', 'b'), ['step', 'step'], async id => models[id], new AbortController().signal);
  assert.deepEqual(result.entries.map(item => item.process.id), ['b', 'c']);
  assert.equal(result.entries[1].sourceProcessId, 'b');
  assert.equal(result.error, '');
});

test('missing links and cycles stop without discarding already restored levels', async () => {
  for (const child of [model('b'), model('b', 'a')]) {
    const result = await restoreExpandedProcesses(model('a', 'b'), ['step', 'step'], async () => child, new AbortController().signal);
    assert.equal(result.entries.length, 1);
    assert.ok(result.error);
  }
});

test('unavailable child and cancellation never invent missing levels', async () => {
  const failed = await restoreExpandedProcesses(model('a', 'b'), ['step'], async () => { throw new Error('403'); }, new AbortController().signal);
  assert.equal(failed.entries.length, 0); assert.ok(failed.error);
  const controller = new AbortController();
  const cancelled = await restoreExpandedProcesses(model('a', 'b'), ['step'], async () => { controller.abort(); return model('b'); }, controller.signal);
  assert.equal(cancelled.entries.length, 0);
});
