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

test('expanded chain and return trail round trip with depth limits', () => {
  const location = { processId: 'leaf', draft: false, expandedSteps: ['Шаг 1', 'Шаг&2'], trail: ['root', 'middle'] };
  const restored = readProcessLocation(processLocationHash(location));
  assert.deepEqual(restored.expandedSteps, location.expandedSteps);
  assert.deepEqual(restored.trail, location.trail);
  assert.equal(readProcessLocation('#process=leaf&parent=root&parent=root&parent=leaf').trail.length, 1);
  assert.equal(readProcessLocation(processLocationHash({ ...location, expandedSteps: Array(30).fill('step') })).expandedSteps.length, 20);
});

test('all process representations preserve edition, selected step and composition on refresh', () => {
  for (const view of ['overview','instruction','responsibility']) {
    for (const edition of [{draft:true},{draft:false,version:'2.4'}]) {
      const location = {processId:'p',elementId:'task',expandedSteps:['child'],trail:['parent'],view,...edition};
      const result = readProcessLocation(processLocationHash(location));
      assert.equal(result.view,view);
      assert.equal(result.elementId,'task');
      assert.equal(result.version,edition.version);
      assert.equal(result.draft,edition.draft);
      assert.deepEqual(result.expandedSteps,['child']);
      assert.deepEqual(result.trail,['parent']);
    }
  }
});

test('unknown view falls back to the diagram and diagram keeps legacy addresses', () => {
  assert.equal(readProcessLocation('#process=p&view=execute').view,undefined);
  assert.equal(readProcessLocation('#process=p&view=%00instruction').view,undefined);
  assert.equal(processLocationHash({processId:'p',draft:false,view:'diagram'}),'#process=p');
});
