import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDemoContour} from '../../../tools/reset-demo-contour.mjs';
test('synthetic work rules survive demo regeneration without dangling object references',()=>{
  const contour=createDemoContour();
  const filename='demo-showcase-l2-production.context.json';
  const generated=JSON.parse(contour.files.get(filename));
  const saved=JSON.parse(readFileSync(new URL('../../../backend/ProcessNavigator.Api/Data/'+filename,import.meta.url),'utf8'));
  const step=generated.elements.Task_ProductionOrder;
  assert.deepEqual(step.workRules,saved.elements.Task_ProductionOrder.workRules);
  assert.equal(step.workRules.length,2);
  assert.ok(step.informationObjects.some(object=>object.objectId===step.workRules[0].objectId));
});
