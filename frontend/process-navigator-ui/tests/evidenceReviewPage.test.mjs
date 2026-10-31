import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
const source=readFileSync(new URL('../src/EvidenceReviewPage.tsx',import.meta.url),'utf8');
const output=await transformWithOxc(source,'EvidenceReviewPage.tsx',{jsx:{runtime:'classic'}});
const code=output.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
const entry={processId:'p',processName:'Модель',elementId:'s',elementName:'Приёмка',edition:'Published',version:'1',index:0,status:'fact',statement:'Проверить комплект',source:'PKG-001',author:'Автор источника'};
const report={processId:'p',elementId:'s',version:'1',draft:false,entries:[{index:0,fingerprint:'hash',evidence:entry,state:'reviewed'}],history:[]};
function render(data=report,{canReview=true,busy=false,error=''}={}){
  const states=[data,error,busy,'Причина',0,0];
  const Page=new Function('React','useState','useEffect','evidenceReviewCall',code+';return EvidenceReviewPage;')({createElement,Fragment},()=>[states.shift(),()=>{}],()=>{},()=>{throw Error('No writes during render');});
  return renderToStaticMarkup(createElement(Page,{entry,canReview,onBack(){}}));
}
test('review page states snapshot scope and differentiates profile from source author',()=>{
  const html=render();
  for(const phrase of ['точному снимку','не электронная подпись','профиль текущего сеанса','Есть проверка данного снимка','Записей проверки пока нет'])assert.ok(html.includes(phrase),phrase);
  assert.doesNotMatch(html,/<button disabled="">Записать проверку факта/);
});
test('reader cannot write and changed evidence cannot be reviewed silently',()=>{
  assert.match(render(report,{canReview:false}),/<button disabled="">Записать проверку факта/);
  const changed=structuredClone(report);changed.entries[0].evidence.statement='Другой факт';
  assert.match(render(changed),/Основание или версия изменились/);
  assert.match(render(changed),/<button disabled="">Отозвать проверку с причиной/);
});
test('history is paged, escaped and retained for stale snapshots',()=>{
  const data={...report,entries:[{...report.entries[0],state:'stale'}],history:Array.from({length:63},(_,i)=>({id:String(i),action:'review',index:0,version:'1',draft:false,actorName:'Проверяющий',actorId:'real-profile',recordedAt:'2026-10-31T09:00:00Z',reason:'<script>bad</script>',evidence:entry,fingerprint:'hash'}))};
  const html=render(data);assert.equal((html.match(/<article/g)||[]).length,50);
  assert.match(html,/Страница 1 из 2/);assert.match(html,/прежняя проверка устарела/);
  assert.doesNotMatch(html,/<script>/);assert.match(html,/real-profile/);
});
test('loading and failure are explicit, with no stale writable form',()=>{
  assert.match(render(null,{busy:true}),/Загружаем или сохраняем/);
  const html=render(null,{error:'Журнал повреждён'});
  assert.match(html,/Журнал повреждён/);assert.doesNotMatch(html,/Отозвать проверку с причиной/);
});
test('profile or permission changes remount the register and discard previously loaded private history',()=>{
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(app,/<EvidenceRegisterPage key=\{session\.currentUser\.id\+':'.*permissions\.join/);
});
test('register and review fill the remaining shell rows rather than the 84px process toolbar row',()=>{
  const css=readFileSync(new URL('../src/evidence-register.css',import.meta.url),'utf8');
  assert.match(css,/\.app-shell>\.evidence-register\{grid-row:2\/-1\}/);
});
