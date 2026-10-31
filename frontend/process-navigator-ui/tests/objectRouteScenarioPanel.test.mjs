import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {transformWithOxc} from 'vite';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import * as route from '../src/object-route-scenario.ts';
const model=JSON.parse(readFileSync(new URL('../../../master-data/object-route-scenario-fixture.json',import.meta.url),'utf8'));
const occurrence={processId:model.id,processName:'Учебный маршрут',scope:'Step',elementId:'make',elementName:'Создать чертёж',direction:'Producer',required:true,condition:'<script>bad</script>'};
const compiled=await transformWithOxc(readFileSync(new URL('../src/ObjectRouteScenarioPanel.tsx',import.meta.url),'utf8'),'ObjectRouteScenarioPanel.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
function setup({choices={},values=[occurrence],loaded=true,onSchedule=()=>{},loading=false}={}){
 const states=[model.id,{[model.id]:choices},0],updates=[];
 const Panel=new Function('React','useState','objectRouteScenario',code+';return ObjectRouteScenarioPanel;')({createElement},()=>{const i=updates.length;updates.push(undefined);return[states[i],v=>updates[i]=v];},route.objectRouteScenario);
 return{tree:Panel({item:{producers:values,consumers:[]},models:loaded?{[model.id]:model}:{},loading,onOpen(){},onSchedule}),updates};
}
function find(el,fn){if(Array.isArray(el))return el.map(v=>find(v,fn)).find(Boolean);if(!el||typeof el!=='object')return;return fn(el)?el:find(el.props?.children,fn);}
test('nested conditions, free text, bounds, and structural limitations are visible and escaped',()=>{
 const html=renderToStaticMarkup(setup().tree);assert.match(html,/Есть направленный путь/);assert.match(html,/исходов 2/);assert.match(html,/не доказательство обязательности/);assert.match(html,/Текст не вычисляется/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
test('excluded alternatives remain in registry, unavailable models are not silently treated as absent documents',()=>{
 assert.match(renderToStaticMarkup(setup({choices:{g1:'no'}}).tree),/Путь исключён сценарием/);
 const tree=setup({loaded:false}).tree;assert.match(renderToStaticMarkup(tree),/Модель недоступна/);
 assert.equal(find(tree,e=>e.type==='button'&&e.props.children==='Открыть сценарий в калькуляторе сроков').props.disabled,true);
});
test('occurrences are paginated at fifty with explicit total, scenario handoff is explicit and cloned',()=>{
 let seed;const choices={g1:'yes',g2:'check'},app=setup({choices,values:Array.from({length:51},()=>occurrence),onSchedule:v=>{seed=v;}});
 const html=renderToStaticMarkup(app.tree);assert.equal((html.match(/<article>/g)||[]).length,50);assert.match(html,/строк 51/);assert.match(html,/страница 1 из 2/);assert.equal(seed,undefined);
 find(app.tree,e=>e.type==='button'&&e.props.children==='Открыть сценарий в калькуляторе сроков').props.onClick();assert.deepEqual(seed.choices,choices);assert.notEqual(seed.choices,choices);assert.equal(seed.processId,model.id);
});
test('loading or invalid choices cannot be handed off as a validated scenario',()=>{
 for(const opts of [{loading:true},{choices:{g1:'invalid'}}])assert.equal(find(setup(opts).tree,e=>e.type==='button'&&e.props.children==='Открыть сценарий в калькуляторе сроков').props.disabled,true);
});
test('optional object and text condition stay separate from route outcomes',()=>{
 const html=renderToStaticMarkup(setup({values:[{...occurrence,required:false}]}).tree);
 assert.match(html,/Необязательный/);assert.match(html,/Текст не вычисляется/);assert.match(html,/условие/iu);
});
