import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {parseDevelopmentRoadmap} from '../src/development-roadmap.ts';
import {isSectionAvailable} from '../src/section-location.ts';
import {readDemonstrationScenarios,demonstrationCoverage,selectDemonstrations} from '../src/demonstrations.ts';
import {createDemoContour} from '../../../tools/reset-demo-contour.mjs';
const source=readFileSync(new URL('../../../docs/development-decomposition.md',import.meta.url),'utf8');
const scenarios=JSON.parse(readFileSync(new URL('../src/demonstration-scenarios.json',import.meta.url),'utf8'));
const cases=readDemonstrationScenarios(scenarios);
const steps=parseDevelopmentRoadmap(source).flatMap(s=>s.steps);
test('every completed roadmap function has exactly one reproducible demonstration and an existing evidence file',()=>{
  const coverage=demonstrationCoverage(steps,cases);
  assert.deepEqual(coverage.missing,[]);assert.deepEqual(coverage.duplicates,[]);assert.deepEqual(coverage.stale,[]);
  const models=new Set(createDemoContour().models.map(m=>m.id));
  for(const s of cases){for(const id of s.models)assert.ok(models.has(id),id);for(const file of s.evidence)assert.ok(existsSync(new URL('../../../'+file,import.meta.url)),file);}
});
test('a new completed function cannot silently lack a scenario; duplicates and stale mappings are explicit',()=>{
  const removed=structuredClone(cases);delete removed.find(item=>item.expected['1']).expected['1'];
  assert.deepEqual(demonstrationCoverage(steps,removed).missing.map(s=>s.id),[1]);
  const duplicate=demonstrationCoverage(steps,[...cases,cases.find(item=>item.expected['1'])]);assert.ok(duplicate.duplicates.includes(1));
  assert.ok(demonstrationCoverage(steps.filter(s=>s.id!==1),cases).stale.includes(1));
});
test('search narrows by function number, expected result, scenario or model without losing per-function wording',()=>{
  assert.deepEqual(selectDemonstrations(steps,cases,'103').flatMap(s=>s.steps.map(x=>x.id)),[103]);
  assert.ok(selectDemonstrations(steps,cases,'demo-showcase-l3-warehouse').length>0);
  assert.ok(selectDemonstrations(steps,cases,'геометрию').some(s=>s.steps.some(t=>t.id===5)));
  assert.deepEqual(selectDemonstrations(steps,cases,'нет такой функции'),[]);
});
test('invalid manifests reject missing results, duplicate scenario IDs and unsafe routes/evidence',()=>{
  for(const patch of [{title:' '},{role:' '},{page:'https://example.com'},{evidence:['../secret']},{expected:{}},{expected:{'01':'bad'}},{actions:[]}]){
    const data=structuredClone(scenarios);Object.assign(data[0],patch);assert.throws(()=>readDemonstrationScenarios(data));
  }
  assert.throws(()=>readDemonstrationScenarios([...scenarios,scenarios[0]]));
});
const compiled=await transformWithOxc(readFileSync(new URL('../src/DemonstrationsPage.tsx',import.meta.url),'utf8'),'DemonstrationsPage.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
function render(query,catalog=[],permissions=['process.view']){
  const state=[query,''];
  const Page=new Function('React','useState','source','scenarios','parseDevelopmentRoadmap','demonstrationCoverage','selectDemonstrations','readDemonstrationScenarios','isSectionAvailable',code+';return DemonstrationsPage;')({createElement},()=>[state.shift(),()=>{}],source,scenarios,parseDevelopmentRoadmap,demonstrationCoverage,selectDemonstrations,readDemonstrationScenarios,isSectionAvailable);
  return renderToStaticMarkup(createElement(Page,{catalog,permissions,onBack(){},onProcess(){throw Error('No mutation during render');},onSection(){throw Error('No navigation during render');}}));
}
test('page states coverage, lack of a demo model and the difference between plan and executed acceptance',()=>{
  const html=render('103');
  assert.match(html,/Покрыто 98 из 98/);assert.match(html,/Модель отсутствует в текущем контуре/);
  assert.match(html,/не отметка о том, что вы выполнили сценарий/);assert.match(html,/отдельный учебный контур/);
  assert.doesNotMatch(html,/Матрица требует актуализации/);
});
test('page cannot open unavailable sections or draft-only models for an employee',()=>{
  const html=render('65',[{id:'demo-showcase-l0',name:'Закрытый черновик',status:'Draft'}]);
  assert.match(html,/<button disabled="">Открыть раздел для показа/);assert.match(html,/Модель недоступна текущему профилю/);
  assert.doesNotMatch(html,/>Закрытый черновик<\/button>/);
});
