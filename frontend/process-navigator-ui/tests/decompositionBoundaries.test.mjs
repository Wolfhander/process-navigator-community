import test from 'node:test';
import assert from 'node:assert/strict';
import {boundariesCsv,boundaryStatus,boundaryLocation,selectBoundaries} from '../src/decomposition-boundaries.ts';
import {readProcessLocation} from '../src/process-location.ts';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as boundaries from '../src/decomposition-boundaries.ts';
const link=(id,overrides={})=>({sourceProcessId:'root',sourceProcessName:'Заказ',sourceLevel:0,elementId:id,elementName:id,targetProcessId:'detail',targetProcessName:'Разработка',targetLevel:1,boundaryReady:true,missingBoundaries:[],sourceVersion:'1.1',sourceDraft:true,targetVersion:'1.0',targetDraft:false,...overrides});
const data={processes:[],links:[link('one'),link('two',{boundaryReady:false,missingBoundaries:['Не совпала версия документа']}),link('three',{targetProcessName:undefined,boundaryReady:false,missingBoundaries:['доступная детальная схема']})]};
test('boundary status separates missing models, structural issues and described contracts',()=>{
  assert.deepEqual(data.links.map(boundaryStatus),['described','review','missing']);
  assert.equal(boundaryStatus(link('inconsistent',{missingBoundaries:['error']})),'review');
  assert.equal(selectBoundaries(data,'','').length,3);
});
test('boundary query searches IDs, model, task and detailed diagnostics with status intersection',()=>{
  assert.equal(selectBoundaries(data,'ВЕРСИЯ','review')[0].elementId,'two');
  assert.equal(selectBoundaries(data,'detail','missing').length,1);
  assert.equal(selectBoundaries(data,'заказ','described').length,1);
  assert.equal(selectBoundaries(data,'не найдено','').length,0);
});
test('each occurrence of a reused model remains separate, full CSV is not page-limited',()=>{
  const many={processes:[],links:Array.from({length:203},(_,i)=>link('step-'+i))};
  assert.equal(selectBoundaries(many,'','').length,203);
  assert.equal(boundariesCsv(many,'','','2026-10-30T09:00:00Z').split('\r\n').length,204);
  assert.equal(new Set(selectBoundaries(many,'','').map(x=>x.elementId)).size,203);
});
test('CSV retains edition, full diagnostics, filter and load time with formula and quote protection',()=>{
  const csv=boundariesCsv({processes:[],links:[link('x',{elementName:' =HYPERLINK("x")',missingBoundaries:['line1\nline2','Версия "A"'],boundaryReady:false})]},'','review','2026-10-30T09:00:00Z');
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\' =HYPERLINK(""x"")"'));
  assert.ok(csv.includes('2026-10-30T09:00:00Z'));assert.ok(csv.includes('Требует уточнения'));assert.ok(csv.includes('line1\\nline2'));
});
test('links preserve exact process/task IDs and draft choice, without treating current version as an archive',()=>{
  const x=link('этап & 1',{sourceProcessId:'источник & 1',targetDraft:true});
  assert.deepEqual(readProcessLocation(boundaryLocation(x)),{processId:'источник & 1',elementId:'этап & 1',draft:true,version:undefined});
  assert.equal(readProcessLocation(boundaryLocation(x,true)).draft,true);
  assert.equal(readProcessLocation(boundaryLocation(x,true)).version,undefined);
});
test('boundary cards page at fifty without hiding full diagnostics or allowing HTML injection',async()=>{
  const compiled=await transformWithOxc(readFileSync(new URL('../src/DecompositionBoundaryView.tsx',import.meta.url),'utf8'),'DecompositionBoundaryView.tsx',{jsx:{runtime:'classic'}});
  const code=compiled.code.replace(/import[^;]+;/g,'').replace('export function ','function ');
  const state=['',0,''];
  const Page=new Function('React','useState',...Object.keys(boundaries),code+';return DecompositionBoundaryView;')({createElement},()=>[state.shift(),()=>{}],...Object.values(boundaries));
  const html=renderToStaticMarkup(Page({data:{processes:[],links:Array.from({length:51},(_,i)=>link('task-'+i,{elementName:'<script>alert(1)</script>',missingBoundaries:['<b>Не совпали документы</b>'],boundaryReady:false}))},query:'',loadedAt:'2026-10-30'}));
  assert.equal((html.match(/<article>/g)??[]).length,50);assert.match(html,/Найдено 51 из 51/);assert.match(html,/Страница 1 из 2/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;b&gt;Не совпали документы/);assert.match(html,/edition=draft/);
  assert.match(html,/Поздний, необязательный или условный производитель не гарантирует вход/);assert.match(html,/не фактическое наличие файлов/);assert.match(html,/текстовых условий/);
});

test('route availability warnings remain searchable and exported with their child anchors',()=>{
  const message='Обязательный вход [doc] не подтверждён до этапа [use]';
  const model={processes:[],links:[link('call',{boundaryReady:false,missingBoundaries:[message]})]};
  assert.equal(selectBoundaries(model,'[use]','review').length,1);
  assert.ok(boundariesCsv(model,'[use]','review','2026-10-31').includes(message));
});
