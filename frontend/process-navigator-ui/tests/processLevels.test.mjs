import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PROCESS_LEVEL, processLevelOptions } from '../src/process-levels.ts';

test('level selector offers level four before any deeper processes exist', () => {
  assert.deepEqual(processLevelOptions(2), [0, 1, 2, 3, 4]);
});

test('level selector grows with hierarchy but stays inside supported limit', () => {
  assert.equal(processLevelOptions(4).at(-1), 5);
  assert.equal(processLevelOptions(18).at(-1), 19);
  assert.equal(processLevelOptions(20).at(-1), MAX_PROCESS_LEVEL);
});
