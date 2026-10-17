import test from 'node:test';
import assert from 'node:assert/strict';
import { decompositionTree, visibleDecompositionRows } from '../src/decomposition-tree.ts';
const process = id => ({ id, name: id });
const link = (from, to) => ({ sourceProcessId: from, targetProcessId: to, elementId: `${from}-${to}`, elementName: `${from}-${to}`, missingBoundaries: [] });

test('tree retains shared models under each source and collapses each occurrence independently', () => {
  const data = { processes: ['a', 'b', 'c', 'd'].map(process), links: [link('a', 'b'), link('a', 'c'), link('b', 'd'), link('c', 'd')] };
  const { rows } = decompositionTree(data);
  assert.equal(rows.filter(row => row.processId === 'd').length, 2);
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length);
  const collapsed = new Set([rows.find(row => row.processId === 'b').key]);
  assert.equal(visibleDecompositionRows(rows, collapsed, '').length, 4);
  assert.equal(visibleDecompositionRows(rows, collapsed, 'd').length, 5);
});

test('rootless cycles, missing targets, and output limits remain inspectable', () => {
  const data = { processes: ['a', 'b'].map(process), links: [link('a', 'b'), link('b', 'a'), link('b', 'missing')] };
  const tree = decompositionTree(data);
  assert.ok(tree.rows.some(row => row.cycle));
  assert.ok(tree.rows.some(row => !row.process));
  assert.equal(decompositionTree(data, 2).rows.length, 2);
  assert.equal(decompositionTree(data, 2).truncated, true);
});
