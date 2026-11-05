import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {initialSourceTarget,sourceObjects,sourceTimestamp} from '../src/source-materials.ts';
const source=readFileSync(new URL('../src/SourceMaterialsPage.tsx',import.meta.url),'utf8');
const compiled=await transformWithOxc(source,'SourceMaterialsPage.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
const material={id:'material-1',fileName:'PKG-001.md',size:128,sha256:'a'.repeat(64),uploadedByName:'Учебный профиль',uploadedAt:'2026-10-31T09:00:00Z',target:{name:'Исходный паспорт',kind:'passport',documentVersion:'1',processId:'demo',processName:'Приёмка',processVersion:'1.4',draft:false,elementId:'step',elementName:'Физическая приёмка',objectId:'receipt',objectName:'Результат приёмки'}};
function render({list={materials:[material],unreadable:0,limited:false},canUpload=true,loading=false,error='',filter='',preview,target={processId:'demo',draft:false,name:'',kind:'passport',documentVersion:'1'}}={}) {
  const values=[list,error,'',false,loading,target,undefined,undefined,preview,{},filter,0,0];
  const icons=['ArrowLeft','Download','FileText','RefreshCw','Upload'];
  const Page=new Function('React','useState','useEffect','sourceObjects','sourceTimestamp',...icons,code+';return SourceMaterialsPage;')({createElement,Fragment},()=>[values.shift(),()=>{}],()=>{},sourceObjects,sourceTimestamp,...icons.map(()=>'span'));
  return renderToStaticMarkup(createElement(Page,{catalog:[{id:'demo',name:'Приёмка',status:'Published',version:'1.4'}],canUpload,onBack(){},onOpen(){}}));
}
test('object choices are restricted to selected model and stage, deduplicated by stable ID',()=>{
  const model={nodes:[{id:'a',informationObjects:[{objectId:'x',name:'X'}]},{id:'b',informationObjects:[{objectId:'x',name:'X'},{objectId:'y',name:'Y'}]}]};
  assert.equal(sourceObjects(model,'').length,2);assert.deepEqual(sourceObjects(model,'a').map(o=>o.objectId),['x']);
  assert.deepEqual(sourceObjects(model,'missing'),[]);assert.deepEqual(sourceObjects(undefined,''),[]);
  model.nodes[1].informationObjects[0].name='Другой псевдоним';
  assert.equal(sourceObjects(model,'')[0].name,'X','Model-wide label agrees with server first occurrence');
});
test('late catalogue initialization and draft-only first model have explicit target defaults',()=>{
  assert.equal(initialSourceTarget([]).processId,'');
  assert.equal(initialSourceTarget([{id:'published',status:'Published'}]).draft,false);
  assert.deepEqual(initialSourceTarget([{id:'new',status:'Draft'}]),{processId:'new',draft:true,name:'',kind:'passport',documentVersion:'1'});
  assert.match(source,/if\(!target.processId&&catalog.length\)setTarget\(initialSourceTarget\(catalog\)\)/);
});
test('source page explains scope and needs a checked target before saving',()=>{
  const html=render();for(const text of ['не подтверждает факты','не полную копию схемы','Антивирусная проверка не выполняется','Проверить привязку','PKG-001','SHA-256','1.4'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/Сохранить оригинал/);
  assert.match(render({preview:{processName:'Приёмка',draft:false,processVersion:'1.4'}}),/Сохранить оригинал/);
});
test('reader has no upload form but can obtain and recheck accessible originals',()=>{
  const html=render({canUpload:false});assert.doesNotMatch(html,/Добавить исходник|type="file"|Сохранить оригинал/);
  assert.match(html,/Скачать оригинал/);assert.match(html,/Сверить с моделью/);
});

test('provenance has separate status, statement, locator and informational author; old files need no assertion',()=>{
  const html=render();assert.match(html,/Переход схемы/);assert.match(html,/Только файл, без утверждения/);
  assert.doesNotMatch(html,/aria-label="Содержание основания"/);
  const citation={status:'fact',statement:'Утверждение из исходника',locator:'Лист 1, строка 7',author:'Справочный автор'};
  const editable=render({target:{processId:'demo',draft:false,name:'',kind:'passport',documentVersion:'1',citation}});
  assert.match(editable,/Содержание основания/);assert.match(editable,/не профиль загрузившего/);
  const cited={...material,target:{...material.target,elementId:undefined,objectId:undefined,edgeId:'flow',edgeName:'Передать результат',citation}};
  const listed=render({list:{materials:[cited],unreadable:0,limited:false},filter:'строка 7'});
  assert.match(listed,/Показано 1/);for(const text of ['Передать результат','Справочный автор','Утверждение из исходника','Переход ID: flow'])assert.ok(listed.includes(text),text);
  const unsafe={...cited,target:{...cited.target,citation:{...citation,statement:'<script>bad</script>'}}};
  assert.doesNotMatch(render({list:{materials:[unsafe],unreadable:0,limited:false}}),/<script>/);
});
test('empty, loading, damaged and failed states are explicit',()=>{
  assert.match(render({loading:true}),/Загрузка…/);
  assert.match(render({list:{materials:[],unreadable:0,limited:false}}),/Материалы не найдены/);
  assert.match(render({list:{materials:[],unreadable:1,limited:true}}),/Новые загрузки заблокированы/);
  assert.match(render({error:'Недоступно'}),/role="alert"/);
});
test('names and filename text are escaped; search covers objects and timestamps have Moscow zone',()=>{
  const poisoned={...material,fileName:'<script>alert(1)</script>',target:{...material.target,name:'<img src=x>'}};
  const html=render({list:{materials:[poisoned],unreadable:0,limited:false}});
  assert.doesNotMatch(html,/<script>|<img src=x>/);assert.match(html,/&lt;script&gt;/);
  assert.match(render({filter:'результат'}),/Показано 1/);assert.match(render({filter:'ничего'}),/Показано 0/);
  assert.match(sourceTimestamp('2026-10-31T09:00:00Z'),/12:00:00 МСК/);
});
test('page uses remaining shell rows with bounded responsive fields and remounts on profile change',()=>{
  const css=readFileSync(new URL('../src/source-materials.css',import.meta.url),'utf8');
  assert.match(css,/grid-row:2\/-1/);assert.match(css,/overflow-wrap:anywhere/);assert.match(css,/@media\(max-width:900px\)/);
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.ok(app.includes("<SourceMaterialsPage key={session.currentUser.id+':'+session.currentUser.permissions.join(',')}"));
});
