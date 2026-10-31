import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const code=(await transformWithOxc(readFileSync(new URL('../src/RouteTopologySummary.tsx',import.meta.url),'utf8'),'RouteTopologySummary.tsx',{jsx:{runtime:'classic'}})).code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
const Panel=new Function('React',code+';return RouteTopologySummary;')({createElement});
const render=topology=>renderToStaticMarkup(createElement(Panel,{topology,onSelect(){}}));
test('legacy response and empty graph render safely',()=>{assert.equal(render(undefined),'');assert.match(render({pairs:[],cycles:[],limited:false}),/пар 0/);});
test('evidence is bounded, escaped, and explains structural limitations',()=>{
 const html=render({pairs:Array.from({length:101},(_,i)=>({forkId:i===0?'<script>':'f'+i,joinId:'j',branches:2})),cycles:[{nodeIds:['a'],totalNodes:100,exitEdgeIds:['exit'],totalExits:1,hasLabeledExclusiveExit:true}],limited:true});
 assert.match(html,/100 из 101/);assert.doesNotMatch(html,/>f100</);assert.match(html,/&lt;script&gt;/);assert.match(html,/не последовательности/);assert.match(html,/проверка ограничена/);assert.match(html,/число повторов требуют проверки/);
});
