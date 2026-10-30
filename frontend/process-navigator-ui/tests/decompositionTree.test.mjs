import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import { decompositionTree, visibleDecompositionRows,decompositionPage } from '../src/decomposition-tree.ts';
const process = id => ({ id, name: id });
const link = (from, to) => ({ sourceProcessId: from, targetProcessId: to, elementId: `${from}-${to}`, elementName: `${from}-${to}`, missingBoundaries: [] });

test('tree retains shared models under each source and collapses each occurrence independently', () => {
  const data = { processes: ['a', 'b', 'c', 'd'].map(process), links: [link('a', 'b'), link('a', 'c'), link('b', 'd'), link('c', 'd')] };
  const { rows } = decompositionTree(data);
  assert.equal(rows.filter(row => row.processId === 'd').length, 2);
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length);
  const collapsed = new Set([rows.find(row => row.processId === 'b').key]);
  assert.equal(visibleDecompositionRows(rows, collapsed, '').length, 4);
  assert.equal(visibleDecompositionRows(rows, collapsed, 'd').length, 5);
});

test('rootless cycles, missing targets, and output limits remain inspectable', () => {
  const data = { processes: ['a', 'b'].map(process), links: [link('a', 'b'), link('b', 'a'), link('b', 'missing')] };
  const tree = decompositionTree(data);
  assert.ok(tree.rows.some(row => row.cycle));
  assert.ok(tree.rows.some(row => !row.process));
  assert.equal(decompositionTree(data, 2).rows.length, 2);
  assert.equal(decompositionTree(data, 2).truncated, true);
});

test('deep descendants are not incorrectly reintroduced as new roots after the depth limit',()=>{
  const data={processes:Array.from({length:30},(_,i)=>process('p'+i)),links:Array.from({length:29},(_,i)=>link('p'+i,'p'+(i+1)))};
  const tree=decompositionTree(data);
  assert.equal(tree.rows.length,21);assert.equal(tree.depthLimitReached,true);assert.equal(tree.rowLimitReached,false);
  assert.equal(tree.rows.filter(row=>row.depth===0).length,1);
  assert.equal(tree.rows.at(-1).depthLimited,true);assert.equal(tree.truncated,true);
});

test('3000 repeated calls stay independent and report a bounded, explicitly incomplete overview',()=>{
  const links=Array.from({length:3000},(_,i)=>({...link('root','shared'),elementId:'step-'+i}));
  const data={processes:[process('root'),process('shared')],links};
  const tree=decompositionTree(data);
  assert.equal(tree.rows.length,2000);assert.equal(new Set(tree.rows.map(r=>r.key)).size,2000);
  assert.equal(tree.rowLimitReached,true);assert.equal(tree.depthLimitReached,false);
  assert.equal(tree.rows.filter(r=>r.processId==='shared').length,1999);
  const collapse=new Set([tree.rows[0].key]);
  assert.equal(visibleDecompositionRows(tree.rows,collapse,'').length,1);
  assert.equal(visibleDecompositionRows(tree.rows,collapse,'step-1500').length,2);
  assert.equal(visibleDecompositionRows(tree.rows,collapse,'step-2500').length,0);
});

test('paging neither duplicates nor loses 2000 built occurrences and clamps stale positions',()=>{
  const rows=Array.from({length:2000},(_,i)=>({id:i}));
  const all=Array.from({length:20},(_,i)=>decompositionPage(rows,i)).flatMap(p=>p.rows);
  assert.deepEqual(all,rows);assert.equal(decompositionPage(rows,999).page,19);
  assert.equal(decompositionPage(rows,-5).page,0);assert.equal(decompositionPage(rows,NaN).page,0);
  assert.equal(decompositionPage(rows,0,100000).rows.length,100);
  assert.deepEqual(decompositionPage([],9),{rows:[],page:0,pages:1,total:0,from:0,to:0});
});

test('multiple independent cyclic components retain one inspectable seed each',()=>{
  const tree=decompositionTree({processes:['a','b','c','d'].map(process),links:[link('a','b'),link('b','a'),link('c','d'),link('d','c')]});
  assert.equal(tree.rows.filter(r=>r.cycle).length,2);assert.equal(tree.rows.filter(r=>r.depth===0).length,2);
  assert.equal(tree.truncated,false);
});

test('large-tree view renders only the requested hundred rows with parent context and a truthful warning',async()=>{
  const data={processes:[process('root'),process('shared')],links:Array.from({length:3000},(_,i)=>({...link('root','shared'),elementId:'step-'+i}))};
  const compiled=await transformWithOxc(readFileSync(new URL('../src/DecompositionTreeView.tsx',import.meta.url),'utf8'),'DecompositionTreeView.tsx',{jsx:{runtime:'classic'}});
  const code=compiled.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
  const states=[new Set(),{query:'',page:19}];
  const View=new Function('React','useState','useMemo','useEffect','decompositionTree','visibleDecompositionRows','decompositionPage',code+';return DecompositionTreeView;')({createElement},()=>[states.shift(),()=>{}],fn=>fn(),()=>{},decompositionTree,visibleDecompositionRows,decompositionPage);
  const html=renderToStaticMarkup(createElement(View,{data,query:'',onOpen(){}}));
  assert.equal((html.match(/<li /g)??[]).length,100);
  assert.match(html,/1901–2000/);assert.match(html,/Страница 20 из 20/);assert.match(html,/Дерево неполное/);assert.match(html,/Поиск работает только внутри построенной части/);assert.match(html,/Путь: root → shared/);
});
