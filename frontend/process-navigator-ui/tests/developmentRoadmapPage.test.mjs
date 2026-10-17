import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseDevelopmentRoadmap,roadmapProgress,roadmapSubtaskProgress,roadmapStatusLabels} from '../src/development-roadmap.ts';
const source=readFileSync(new URL('../../../docs/development-decomposition.md',import.meta.url),'utf8');
const evidence=JSON.parse(readFileSync(new URL('../../../master-data/verification.json',import.meta.url),'utf8'));
const compiled=await transformWithOxc(readFileSync(new URL('../src/DevelopmentRoadmapPage.tsx',import.meta.url),'utf8'),'DevelopmentRoadmapPage.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/import[^;]+;/g,'').replace('export function ','function ');
function render(query='') {
  const state=[query,''];
  const icons=['ArrowLeft','CheckCircle2','Circle','Clock3','FlaskConical','GitBranch','PauseCircle'];
  const Page=new Function('React','useState','source','parseDevelopmentRoadmap','roadmapProgress','roadmapSubtaskProgress','roadmapStatusLabels',...icons,'evidence',code+';return DevelopmentRoadmapPage;')(
    {createElement},()=>[state.shift(),()=>{}],source,parseDevelopmentRoadmap,roadmapProgress,roadmapSubtaskProgress,roadmapStatusLabels,...icons.map(()=>'span'),evidence);
  return renderToStaticMarkup(Page({onBack:()=>{throw Error('No navigation during render');}}));
}
test('page shows child status and its limited coverage separately from parent totals',()=>{
  const html=render();
  assert.match(html,/49 из 103/);
  assert.match(html,/21 из 21 проверок пройдено/);
  assert.match(html,/не проверка вашего компьютера/);
  assert.match(html,/Детализировано пунктов: 5 из 103/);
  assert.match(html,/Подзадачи пункта 100/);
  assert.match(html,/100.8/);
  assert.match(html,/Визуальная приёмка согласованного контура/);
  assert.match(html,/не дополнительный процент готовности/);
});
test('search finds a parent through its child wording',()=>{
  const html=render('Структурированные требуемые статусы');
  assert.match(html,/Подзадачи пункта 100/);
  assert.doesNotMatch(html,/Подзадачи пункта 99/);
});
