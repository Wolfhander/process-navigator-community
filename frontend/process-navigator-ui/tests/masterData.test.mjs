import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {masterModels,masterOrganization,masterSpec,masterFiles} from '../../../tools/master-data.mjs';
import {buildProcessInstruction} from '../src/process-instruction.ts';
import {buildResponsibilityView} from '../src/process-responsibility.ts';
import {collectInstructionPackage,instructionPackageHtml} from '../src/instruction-package.ts';
import {inspectReadability} from '../src/process-readability.ts';
import {readProcessLocation,processLocationHash} from '../src/process-location.ts';
import {parseDevelopmentRoadmap} from '../src/development-roadmap.ts';
const models=masterModels(),root=models[0];
const passed=id=>console.log('[master-data:'+id+'] PASS');
test('master reference files reproduce exactly from versioned input definitions',()=>{
  for(const [name,value]of masterFiles())assert.equal(readFileSync(new URL('../../../master-data/v1/reference/'+name,import.meta.url),'utf8').trimEnd(),value.trimEnd(),name);
  assert.equal(models.length,masterSpec.expected.processes);
  assert.equal(masterOrganization().legalEntities.length,masterSpec.expected.organizations);
  const coverage=JSON.parse(readFileSync(new URL('../../../master-data/v1/coverage.json',import.meta.url),'utf8'));
  const steps=parseDevelopmentRoadmap(readFileSync(new URL('../../../docs/development-decomposition.md',import.meta.url),'utf8')).flatMap(stage=>stage.steps);
  for(const item of steps.flatMap(step=>[step,...step.subtasks]).filter(item=>item.status==='verify'))
    assert.ok(coverage.cases.some(entry=>entry.roadmap===String(item.id)), 'Missing reference coverage: '+item.id);
});
test('master instruction retains all root tasks and diagnoses a deliberate broken copy',()=>{
  const instruction=buildProcessInstruction(root);
  assert.equal(instruction.tasks.length,2);assert.equal(instruction.broken.length,0);assert.equal(instruction.unreachable.length,0);
  passed('instruction');
  const broken={...root,nodes:root.nodes.filter(node=>node.id!=='task-1')};
  assert.equal(buildProcessInstruction(broken).broken.length,2);
  assert.equal(root.nodes.length,4);
  passed('broken-reference');
});
test('master composition checks depth, reuse and cycle without altering baseline',async()=>{
  let reads=0;
  const bundle=await collectInstructionPackage(root,'Эталон',{},async id=>{reads++;return models.find(model=>model.id===id);},new AbortController().signal);
  assert.equal(bundle.entries.length,masterSpec.expected.compositionOccurrences);assert.equal(reads,4);assert.equal(bundle.issues.length,0);
  assert.equal(Math.max(...bundle.entries.map(entry=>entry.model.passport.level)),masterSpec.expected.maximumLevel);
  passed('composition');
  const cyclic=structuredClone(root);cyclic.nodes[1].linkedProcessId=root.id;
  const result=await collectInstructionPackage(cyclic,'Негативная копия',{},async id=>models.find(model=>model.id===id),new AbortController().signal);
  assert.ok(result.issues.some(issue=>issue.includes('цикл')));
  assert.notEqual(root.nodes[1].linkedProcessId,root.id);
  passed('composition-cycle');
});
test('master responsibility identifies cross-organization handover and unknown assignment',()=>{
  const assignments={processId:root.id,users:[],lanes:[{laneId:'lane-0',userIds:['unknown-operator']}]};
  const view=buildResponsibilityView(root,masterOrganization(),assignments);
  assert.equal(view.transfers.length,masterSpec.expected.rootTransfers);
  assert.notEqual(view.rows[0].entity.id,view.rows[1].entity.id);
  assert.ok(view.rows[0].warnings.some(message=>message.includes('отсутствует в справочнике')));
  assert.equal(view.rows[0].assignedCount,1);
  assert.equal(view.rows[0].people.length,0);
  passed('responsibility');
});
test('master full HTML contains every included node, state requirement and exception',async()=>{
  const bundle=await collectInstructionPackage(root,'Эталон',{},async id=>models.find(model=>model.id===id),new AbortController().signal);
  const html=instructionPackageHtml(bundle);
  assert.equal((html.match(/<article>/g)||[]).length,bundle.entries.reduce((sum,entry)=>sum+entry.model.nodes.length,0));
  for(const id of masterSpec.processIds)assert.ok(html.includes(id));
  assert.ok(html.includes('Подписан'));assert.ok(html.includes('Вернуть автору'));
  assert.doesNotMatch(html,/<script|href=/);
  const reference=readFileSync(new URL('../../../master-data/v1/reference/instruction.html',import.meta.url),'utf8');
  for(const id of masterSpec.processIds)assert.ok(reference.includes(id));
  assert.equal((reference.match(/<article>/g)||[]).length,(html.match(/<article>/g)||[]).length);
  assert.doesNotMatch(reference,/<script|href=/);
  passed('work-rules');passed('full-html');
});
test('master readability finds deliberately overloaded text and overlap',()=>{
  const copy=structuredClone(root);copy.nodes[1].name='Длинная подпись '.repeat(100);
  copy.nodes[2].x=copy.nodes[1].x;copy.nodes[2].y=copy.nodes[1].y;
  const result=inspectReadability(copy);
  assert.ok(result.advice.some(advice=>advice.code==='text'));assert.ok(result.advice.some(advice=>advice.code==='overlap'));
  assert.equal(inspectReadability(root).advice.length,0);
  passed('readability');
});
test('master process address preserves edition, path and selected representation',()=>{
  const location={processId:root.id,draft:false,version:'1.0',elementId:'task-2',view:'instruction',expandedSteps:['task-1'],trail:['parent-test']};
  assert.deepEqual(readProcessLocation(processLocationHash(location)),location);
  passed('location');
});
