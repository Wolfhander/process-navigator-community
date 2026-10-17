import test from 'node:test';
import assert from 'node:assert/strict';
import { processLocationHash, readProcessLocation } from '../src/process-location.ts';

test('plain startup stays at home, malformed locations are ignored', () => {
  for (const hash of ['', '#', '#step=Task_A', '#process=', '#process=%00bad', '#process=' + 'a'.repeat(301)]) {
    assert.equal(readProcessLocation(hash), undefined);
  }
  assert.equal(processLocationHash(), '');
});

test('process and selected step survive an encoded address round trip', () => {
  const location = { processId: 'Процесс & А', elementId: 'Task_1/#', draft: false, version: undefined };
  assert.deepEqual(readProcessLocation(processLocationHash(location)), location);
});

test('draft and archived editions are explicit and archive wins over draft', () => {
  const draft = { processId: 'demo', draft: true, elementId: undefined, version: undefined };
  assert.deepEqual(readProcessLocation(processLocationHash(draft)), draft);
  const archive = readProcessLocation('#process=demo&edition=draft&version=1.2&step=A');
  assert.equal(archive.version, '1.2');
  assert.equal(archive.draft, false);
  assert.equal(archive.elementId, 'A');
});

test('invalid optional fields do not prevent opening the model', () => {
  const location = readProcessLocation('#process=demo&step=%00&version=' + 'v'.repeat(301));
  assert.equal(location.processId, 'demo');
  assert.equal(location.elementId, undefined);
  assert.equal(location.version, undefined);
});
