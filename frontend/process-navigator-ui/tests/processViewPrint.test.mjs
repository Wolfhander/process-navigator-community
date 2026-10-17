import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareProcessViewPrint } from '../src/process-view-print.ts';
test('print opens all scoped sections and restores exact states on completion or cancellation',()=>{
  const sections=[{open:false},{open:true},{open:false}];
  const restore=prepareProcessViewPrint({querySelectorAll:selector=>{assert.equal(selector,'details');return sections;}});
  assert.deepEqual(sections.map(s=>s.open),[true,true,true]);
  restore();
  assert.deepEqual(sections.map(s=>s.open),[false,true,false]);
  restore();
  assert.deepEqual(sections.map(s=>s.open),[false,true,false]);
});
test('empty view prints without state changes',()=>{
  assert.doesNotThrow(()=>prepareProcessViewPrint({querySelectorAll:()=>[]})());
});
