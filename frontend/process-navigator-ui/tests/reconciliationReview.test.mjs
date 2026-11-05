import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';import {createElement,Fragment} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {collectEvidence} from '../src/evidence-register.ts';
const source=readFileSync(new URL('../src/ReconciliationReviewPage.tsx',import.meta.url),'utf8');
const code=(await transformWithOxc(source,'ReconciliationReviewPage.tsx',{jsx:{runtime:'classic'}})).code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
const requirement={id:'r',text:'Проверить условие перед передачей',source:'TRACE-001',locator:'раздел 2',elementIds:['a','b'],checkSequence:true};
const entry={processId:'p',processName:'Учебный процесс',version:'1',edition:'Published',requirementId:'r',requirementSnapshot:requirement};
const report={processId:'p',processName:'Учебный процесс',version:'1',draft:false,requirementId:'r',fingerprint:'f',requirement,state:'reviewed',gaps:[],history:[]};
function render({value=report,selected=entry,canReview=true,error='',sources=[],materialId='',busy=false}={}){
  const values=[value,sources,error,'',busy,'Проверено по разделу 2',materialId,0,0];
  const Page=new Function('React','useState','useEffect',code+';return ReconciliationReviewPage;')({createElement,Fragment},()=>[values.shift(),()=>{}],()=>{});
  return renderToStaticMarkup(createElement(Page,{entry:selected,canReview,onBack(){}}));
}
test('requirements retain stable ID and a separate immutable source snapshot in the register',()=>{
  const model={id:'p',name:'P',version:'1',nodes:[{id:'a',name:'A'},{id:'b',name:'B'}],edges:[{sourceId:'a',targetId:'b'}],passport:{sourceRequirements:[requirement]}};
  const row=collectEvidence(model,'Published').find(e=>e.requirementId==='r');assert.deepEqual(row.requirementSnapshot,requirement);
  row.requirementSnapshot.elementIds.push('c');assert.deepEqual(requirement.elementIds,['a','b']);
});
test('review page is a full page, distinguishes route check from meaning and exposes source-based actions',()=>{
  const html=render({materialId:'original'});assert.match(html,/<main/);assert.doesNotMatch(html,/role="dialog"/);
  assert.match(html,/Подтвердить сверку по оригиналу/);assert.match(html,/не доказывает смысл/);
  assert.match(html,/профиль сеанса/);assert.match(html,/Отозвать подтверждение/);
});
test('reader, mismatched statement, gaps and missing originals cannot confirm',()=>{
  for(const props of [{canReview:false},{selected:{...entry,requirementSnapshot:{...requirement,text:'Старый текст'}}},{value:{...report,gaps:['Нет маршрута']}},{}]){
    const html=render(props);assert.match(html,/<button disabled="">Подтвердить сверку по оригиналу<\/button>/);
  }
  const failed=render({value:null,error:'Ошибка журнала'});assert.match(failed,/role="alert"/);assert.doesNotMatch(failed,/Текущий пункт источника/);
});
test('history carries exact source, profile and immutable original reference without executing text',()=>{
  const event={id:'one',action:'review',actorId:'profile',actorName:'<script>x</script>',recordedAt:'2026-11-05T09:00Z',version:'1',draft:false,
    fingerprint:'f',requirement,reason:'По разделу 2',material:{id:'material-x',fileName:'TRACE-001.md',sha256:'a'.repeat(64)}};
  const html=render({value:{...report,history:[event]}});
  assert.match(html,/TRACE-001.md/);assert.match(html,/material-x/);assert.match(html,/profile/);assert.doesNotMatch(html,/<script>/);
});
