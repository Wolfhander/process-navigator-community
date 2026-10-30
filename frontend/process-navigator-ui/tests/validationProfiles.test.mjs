import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as profiles from '../src/validation-profiles.ts';
import {auditWorkItemsCsv} from '../src/catalog-audit-worklist.ts';
const warning={code:'task-instruction',severity:'Warning',category:'Description',message:'Заполнить инструкцию'};
const error={code:'missing-end',severity:'Error',category:'Route',message:'Нет окончания'};
const input=(issues=[],extra={})=>({errorCount:issues.filter(i=>i.severity==='Error').length,warningCount:issues.filter(i=>i.severity==='Warning').length,issues,canPublish:!issues.some(i=>i.severity==='Error'),...extra});
test('profiles distinguish structural minimum, recommended completeness and publication gate',()=>{
  assert.deepEqual(Object.keys(profiles.validationProfiles).map(p=>profiles.profileQuality(input([warning]),p)),['Ready','Incomplete','Ready']);
  assert.ok(Object.keys(profiles.validationProfiles).every(p=>profiles.profileQuality(input(),p)==='Ready'));
});
test('critical errors and unreadable models cannot be downgraded by any profile or inconsistent summary',()=>{
  for(const profile of Object.keys(profiles.validationProfiles)){
    assert.equal(profiles.profileQuality(input([error,warning],{errorCount:0,canPublish:true}),profile),'Blocked');
    assert.equal(profiles.profileQuality(input([],{openable:false}),profile),'Blocked');
    for(const count of [-1,NaN,Infinity,0.5])assert.equal(profiles.profileQuality(input([],{errorCount:count}),profile),'Blocked');
  }
});
test('publication profile respects explicit server refusal and never promotes recommendations to server prohibitions',()=>{
  const report=input([],{canPublish:false});
  assert.equal(profiles.profileQuality(report,'publication'),'Blocked');
  assert.equal(profiles.profileQuality(report,'minimum'),'Ready');
  assert.equal(profiles.profileQuality(input([warning]),'publication'),'Ready');
});
test('profile lists hide only recommendations at minimum; input counts, issues and severities stay immutable',()=>{
  const original=input([error,warning]);const copy=structuredClone(original);
  for(const profile of Object.keys(profiles.validationProfiles)){
    profiles.profileQuality(original,profile);profiles.profileResult(original,profile);profiles.profileIssues(original.issues,profile);
  }
  assert.deepEqual(original,copy);assert.deepEqual(profiles.profileIssues(original.issues,'minimum'),[error]);
  assert.equal(profiles.profileIssues(original.issues,'recommended').length,2);
});
test('selected CSV records the assessment profile without changing legacy full-export format',()=>{
  const row={item:{processId:'demo',processName:'Демо',edition:'Draft',fileName:'demo.bpmn'},issue:warning};
  const legacy=auditWorkItemsCsv([row]),selected=auditWorkItemsCsv([row],'=профиль "A"');
  assert.ok(!legacy.includes('Профиль проверки'));assert.ok(selected.includes('Профиль проверки'));assert.ok(selected.includes('"\'=профиль ""A"""'));
});
async function compile(name,deps){
  const transformed=await transformWithOxc(readFileSync(new URL('../src/'+name+'.tsx',import.meta.url),'utf8'),name+'.tsx',{jsx:{runtime:'classic'}});
  const code=transformed.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
  return new Function('React',...Object.keys(deps),code+';return '+name+';')({createElement,Fragment},...Object.values(deps));
}
test('profile panel presents scope, full counts and escaped diagnostics',async()=>{
  const Panel=await compile('ValidationProfilePanel',profiles);
  const html=renderToStaticMarkup(createElement(Panel,{profile:'minimum',input:input([warning]),onChange(){}}));
  assert.match(html,/Рекомендации скрыты только/);assert.match(html,/ошибок 0, рекомендаций 1/);assert.match(html,/не подтверждение готовности/);
});
test('publication button remains governed by server, even if recommended profile is incomplete',async()=>{
  const Panel=await compile('ValidationProfilePanel',profiles);
  async function render(report,profile){
    const state=[report,'',0,profile];
    const icons=Object.fromEntries(['AlertTriangle','CheckCircle2','RefreshCw','Rocket','X','XCircle'].map(k=>[k,'span']));
    const Dialog=await compile('PublicationValidationDialog',{...profiles,...icons,ValidationProfilePanel:Panel,useState:()=>[state.shift(),()=>{}],useEffect(){}});
    return renderToStaticMarkup(createElement(Dialog,{processId:'demo',version:'1.1',busy:false,onClose(){},onPublish(){},onSelectElement(){}}));
  }
  const recommended=await render(input([warning]),'recommended');
  assert.match(recommended,/Описание требует дополнений/);assert.match(recommended,/<button class="primary">/);
  const blocked=await render(input([error]),'minimum');
  assert.match(blocked,/<button class="primary" disabled=""/);assert.match(blocked,/Нет окончания/);
  const minimal=await render(input([warning]),'minimum');
  assert.doesNotMatch(minimal,/Заполнить инструкцию/);assert.match(minimal,/рекомендаций 1/);
});
