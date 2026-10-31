import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {isSectionAvailable,readSectionLocation,sectionLocationHash} from '../src/section-location.ts';
const source=readFileSync(new URL('../src/DraftRepairPage.tsx',import.meta.url),'utf8');
const compiled=await transformWithOxc(source,'DraftRepairPage.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
const item={processId:'p',processName:'Модель',missingOwner:true,links:[{elementId:'owner',elementName:'Этап',targetId:'lost'}]};
const scan={fingerprint:'source',items:[item],targets:[{id:'p',name:'Модель'},{id:'leaf',name:'Детали'}],units:[{entityId:'entity',entityName:'Организация',unitId:'unit',unitName:'Отдел'}]};
function render({data=scan,choices={},plan,busy=false,error='',result}={}){
  const states=[data,choices,plan,busy,error,0,result];
  const Page=new Function('React','useState','useEffect',code+';return DraftRepairPage;')({createElement,Fragment},()=>[states.shift(),()=>{}],()=>{});
  return renderToStaticMarkup(createElement(Page,{onBack(){},onSaved(){}}));
}
test('metadata repairs have their own guarded page and no default changes',()=>{
  assert.equal(readSectionLocation(sectionLocationHash('draftRepairs')),'draftRepairs');assert.equal(isSectionAvailable('draftRepairs',['process.view']),false);
  const html=render();assert.match(html,/Выбрано решений: 0/);assert.doesNotMatch(html,/role="dialog"|Создать резервную копию и применить план/);assert.match(html,/<button disabled="">Подготовить план/);
  assert.match(html,/Удалить только связь детализации/);assert.match(html,/lost/);assert.match(html,/Организация \/ Отдел/);
  assert.doesNotMatch(html,/value="target:p"/);
});
test('owner and step named owner use separate selection keys, plan invalidates on edits',()=>{
  assert.match(code,/JSON\.stringify\(\[id, "owner"\]\)/);assert.match(code,/JSON\.stringify\(\[\s*id,\s*"link",\s*element\s*\]\)/);assert.match(source,/function choose[^]*?setPlan\(undefined\)/);
  const plan={request:{},preview:{proof:'proof',changes:[{processName:'Модель',kind:'link',elementId:'owner',before:'lost',after:'Детали'}]}};
  assert.match(render({plan}),/Создать резервную копию и применить план/);
});
test('blocked, loading, errors, results and escaped labels remain explicit',()=>{
  assert.match(render({busy:true}),/role="status"/);assert.match(render({error:'Ошибка'}),/role="alert"/);
  assert.match(render({data:{...scan,items:[{...item,reason:'Заблокирован'}]}}),/disabled=""[^]*Заблокирован|Заблокирован[^]*disabled=""/);
  assert.match(render({data:{...scan,items:[]}}),/нет подходящих/);
  assert.match(render({data:{...scan,items:[{...item,processName:'<script>bad</script>'}]}}),/&lt;script&gt;/);
  assert.match(render({result:{backupFileName:'safe.zip',items:[{processId:'p',status:'Skipped',reason:'Изменился'}]}}),/Пропущен/);
});
