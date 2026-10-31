import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {referenceChoices,referenceGroups,referenceLabels,referenceOccurrencesCsv} from '../src/table-references.ts';
const source=readFileSync(new URL('../src/TableReferencesPage.tsx',import.meta.url),'utf8');
const out=await transformWithOxc(source,'TableReferencesPage.tsx',{jsx:{runtime:'classic'}});
const code=out.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
const group={id:'g',kind:'unit',value:'ghost',scope:'plant',canKeep:false,cells:[{sheet:'Шаги',cell:'I5',column:'Подразделение ID',row:5,token:0,processId:'process-a',stepId:'step-a',relatedCell:null}]};
const report={fingerprint:'hash',choices:[{kind:'unit',id:'1',name:'Склад',scope:'plant'},{kind:'unit',id:'1',name:'Другой склад',scope:'other'}],groups:[group]};
function render({data=report,rules={},busy=false,error='',search='',kind='',acknowledged=[],candidateSearch={}}={}) {
  const values=[{name:'references.xlsx',size:100},data,rules,acknowledged,busy,error,kind,search,0,0,candidateSearch];
  const icons=['ArrowLeft','Download','RefreshCw'];
  const Page=new Function('React','useState','useEffect','referenceChoices','referenceGroups','referenceLabels',...icons,code+';return TableReferencesPage;')({createElement,Fragment},()=>[values.shift(),()=>{}],()=>{},referenceChoices,referenceGroups,referenceLabels,...icons.map(()=>'span'));
  return renderToStaticMarkup(createElement(Page,{file:values[0],onBack(){},onResolved(){}}));
}
test('choices enforce organization scope even for same unit ID; search does not broaden scope',()=>{
  assert.deepEqual(referenceChoices(report,group).map(c=>c.name),['Склад']);
  assert.deepEqual(referenceChoices(report,group,'Другой'),[]);
  assert.equal(referenceChoices(report,{...group,scope:'PLANT'},'скл').length,1);
});
test('group filters cover coordinates and model IDs independently of pending decisions',()=>{
  assert.equal(referenceGroups(report,'unit','I5').length,1);
  assert.equal(referenceGroups(report,'user','process-a').length,0);
  assert.equal(referenceGroups(report,'','step-a').length,1);
});
test('page has explicit scope, no writes to models, and normal preview remains required',()=>{
  const html=render();
  for(const s of ['процессы и справочники не меняются','включая скрытые текущим фильтром','Проверить копию перед импортом','формулы не меняются','Формулы не пересчитываются','Вернуться без замены книги','Шаги','I5'])assert.ok(html.includes(s),s);
  assert.doesNotMatch(html,/<option value="@new"/);
});
test('known choice remains visible when candidate search excludes it or exceeds first 200',()=>{
  const data={...report,choices:Array.from({length:240},(_,i)=>({kind:'unit',id:String(i),scope:'plant',name:'Склад '+i}))};
  const html=render({data,rules:{g:{groupId:'g',targetId:'239'}},candidateSearch:{g:'не найдено'}});
  assert.match(html,/<option value="known:239" selected="">/);
});
test('new system decision cannot collide with a literal @new system name',()=>{
  const data={fingerprint:'h',choices:[{kind:'system',id:'@new',name:'@new',scope:''}],groups:[{...group,kind:'system',scope:'',canKeep:true}]};
  const html=render({data,rules:{g:{groupId:'g',targetId:'@new'}}});
  assert.match(html,/<option value="known:@new" selected="">/);assert.match(html,/<option value="@new">Оставить/);
});
test('queue pagination, truncation and escaped unknown values are explicit',()=>{
  const data={...report,groups:Array.from({length:25},(_,i)=>({...group,id:String(i),value:'<script>'+i}))};
  const html=render({data});assert.equal((html.match(/class="reference-group"/g)||[]).length,20);
  assert.match(html,/Страница 1 из 2/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});
test('errors and loading never imply resolved data; all five domain labels exist',()=>{
  assert.match(render({data:undefined,busy:true,error:'Недоступно'}),/role="alert"/);
  assert.match(render({data:{...report,groups:[]}}),/Это не заменяет общую проверку/);
  assert.deepEqual(Object.keys(referenceLabels),['entity','unit','user','system','object','document']);
});
test('CSV includes all occurrences beyond display limits, companion cells, and protects formulas',()=>{
  const data={...report,groups:[{...group,value:' =HYPERLINK("bad")',cells:Array.from({length:130},(_,i)=>({...group.cells[0],cell:'I'+(i+5),relatedCell:'V'+(i+5)}))}]};
  const csv=referenceOccurrencesCsv(data);
  assert.equal(csv.split('\r\n').length,131);assert.ok(csv.includes('I134'));assert.ok(csv.includes('V134'));
  assert.ok(csv.includes("' =HYPERLINK("));assert.ok(csv.includes('""bad""'));
});
