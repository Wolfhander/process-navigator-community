import test from 'node:test';
import assert from 'node:assert/strict';
import { planHorizontalColumns } from '../src/bpmnLayout.ts';

test('empty diagram has no layout targets', () => {
  assert.equal(planHorizontalColumns([]).size, 0);
});

test('nodes in the same column align and wide blocks leave enough room', () => {
  const targets = planHorizontalColumns([
    { id: 'later', x: 350, width: 120 },
    { id: 'first', x: 100, width: 280 },
    { id: 'parallel', x: 120, width: 140 },
    { id: 'last', x: 600, width: 100 }
  ]);
  assert.equal(targets.get('first'), 100);
  assert.equal(targets.get('parallel'), 100);
  assert.equal(targets.get('later'), 450);
  assert.equal(targets.get('last'), 640);
});

test('existing row order and custom gap are preserved', () => {
  const targets = planHorizontalColumns([
    { id: 'right', x: 500, width: 100 },
    { id: 'left', x: 50, width: 150 }
  ], 40);
  assert.equal(targets.get('left'), 50);
  assert.equal(targets.get('right'), 240);
});
