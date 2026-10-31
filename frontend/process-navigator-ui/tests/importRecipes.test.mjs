import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {mergeRecipeRules} from '../src/import-recipes.ts';
import {referenceLabels} from '../src/table-references.ts';
const source=readFileSync(new URL('../src/ImportRecipesPage.tsx',import.meta.url),'utf8');
const compiled=await transformWithOxc(source,'ImportRecipesPage.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
const recipe={id:'recipe-a',name:'Недельный набор',revision:2,rules:[{kind:'unit',value:'старый',scope:'plant',targetId:'1',keepNew:false}],batches:[{id:'batch-a',createdAt:'2026-10-31T09:00:00Z',files:[{id:'file-a',fileName:'source.xlsx',size:100,sha256:'a'.repeat(64)}]}]};
function render({items=[recipe],unreadable=0,selected='recipe-a',batch='batch-a',busy=false,error='',report}={}) {
  const states=[items,unreadable,selected,batch,[],busy,error,report,0,0];
  const Page=new Function('React','useState','useEffect','referenceLabels','ArrowLeft','Download','RefreshCw',code+';return ImportRecipesPage;')({createElement,Fragment},()=>[states.shift(),()=>{}],()=>{},referenceLabels,...Array(3).fill('span'));
  return renderToStaticMarkup(createElement(Page,{onBack(){},onPrepared(){}}));
}
test('semantic history overwrites exact source scope only, preserving separate organizations',()=>{
  const a={kind:'unit',value:'old',scope:'plant',targetId:'1',keepNew:false};
  assert.deepEqual(mergeRecipeRules([a,{...a,scope:'other'}],[{...a,targetId:'2'}]).map(r=>[r.scope,r.targetId]),[['plant','2'],['other','1']]);
});
test('saved source sets show ownership scope, immutable rules, hashes and no automatic import',()=>{
  const html=render();for(const phrase of ['текущего профиля','Автоматического импорта процессов нет','не перезаписываются','SHA-256','source.xlsx','Проверить пакет по регламенту'])assert.ok(html.includes(phrase),phrase);
  assert.doesNotMatch(html,/Передать копию в импорт/);
});
test('prepared transfer requires a matching recipe revision and a ready proof',()=>{
  const file={fileId:'file-a',state:'ready',appliedRules:1,unusedRules:0,remainingGroups:0,errorCount:0,warningCount:0,fingerprint:'proof',messages:[]};
  const report={recipeId:recipe.id,revision:2,batchId:'batch-a',files:[file]};
  assert.doesNotMatch(render({report}),/<button disabled="">Передать копию в импорт/);
  assert.match(render({report:{...report,files:[{...file,state:'needsMapping'}]}}),/<button disabled="">Передать копию в импорт/);
  assert.doesNotMatch(render({report:{...report,revision:1}}),/Передать копию в импорт/);
});
test('empty, corrupted and failed storage states are not hidden or declared healthy',()=>{
  assert.match(render({items:[],selected:''}),/Регламентов пока нет/);
  assert.match(render({unreadable:1,error:'Недоступно'}),/Недоступных регламентов/);
  assert.match(render({busy:true}),/Выполняется операция/);
});
test('names are escaped, and saved-rule provenance includes exact source and scope',()=>{
  const malicious={...recipe,name:'<script>bad</script>',rules:[{...recipe.rules[0],value:'<img src=x>'}]};
  const html=render({items:[malicious]});assert.doesNotMatch(html,/<script>|<img src=x>/);assert.match(html,/&lt;img/);assert.match(html,/plant/);
});
test('reference page stores original input plus accumulated applied rules, not only final-pass choices',()=>{
  const page=readFileSync(new URL('../src/TableReferencesPage.tsx',import.meta.url),'utf8');
  assert.match(page,/mergeRecipeRules\(previous,selected.map/);assert.match(page,/saveImportRecipe\(recipeName,recipeRules,\[file\]\)/);
  assert.match(page,/selected.length>0\|\|!recipeName.trim/);
});
