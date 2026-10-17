import test from 'node:test';
import assert from 'node:assert/strict';
import { informationTransfers } from '../src/information-transfers.ts';
const object = { id: 'doc', producers: [{ processId: 'a' }, { processId: 'b' }], consumers: [{ processId: 'c' }, { processId: 'd' }] };
test('multiple sources retain all possible pairs without selecting a producer', () => {
  assert.equal(informationTransfers([object]).rows.length, 4);
});
test('missing endpoints remain visible, reference-only objects excluded', () => {
  const result = informationTransfers([{ ...object, producers: [] }, { ...object, producers: [], consumers: [] }]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].source, undefined);
});
test('limit is explicit and does not silently truncate', () => {
  assert.equal(informationTransfers([object], 3).limited, true);
  assert.equal(informationTransfers([object], 4).limited, false);
  assert.equal(informationTransfers([object], 3).rows.length, 3);
});
