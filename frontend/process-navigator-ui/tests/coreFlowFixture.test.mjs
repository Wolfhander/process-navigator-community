import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDemoContour} from '../../../tools/reset-demo-contour.mjs';
test('browser/API master scenario refers to actual synthetic tasks and exact declared hours',()=>{
  const spec=JSON.parse(readFileSync(new URL('../../../master-data/core-flow-fixture.json',import.meta.url),'utf8'));
  const files=createDemoContour().files,context=JSON.parse(files.get(spec.sourceModel+'.context.json'));
  assert.equal(new Set(spec.steps).size,spec.steps.length);
  for(const id of spec.steps){assert.ok(context.elements[id]);assert.ok(files.get(spec.sourceModel+'.bpmn').includes('id="'+id+'"'));}
  assert.equal(spec.expectedHours,spec.hoursPerStep*spec.steps.length);
  assert.equal((Date.parse(spec.expectedEnd)-Date.parse(spec.anchorDate))/3600000,spec.expectedHours);
  assert.match(spec.id,/^acceptance-/);
});
