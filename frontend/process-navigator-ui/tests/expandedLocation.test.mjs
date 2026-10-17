import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreExpandedProcesses } from '../src/expanded-location.ts';
const model = (id, child) => ({ id, name: id, nodes: child ? [{ id: 'step', name: 'Step', linkedProcessId: child }] : [] });

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
