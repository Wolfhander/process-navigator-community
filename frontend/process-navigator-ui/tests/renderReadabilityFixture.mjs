// Creates an isolated static browser acceptance page from the actual overview component and CSS.
import {readFileSync,writeFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {overviewLaneMap,overviewReadability} from '../src/overview-lane-map.ts';
import {diagramTaskTypography} from '../src/diagram-labels.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const compiled=await transformWithOxc(read('../src/ProcessRouteOverview.tsx'),'ProcessRouteOverview.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
const Overview=new Function('React','useState','overviewLaneMap','overviewReadability','OverviewLinkedBranch',code+';return ProcessRouteOverview;')(
  {createElement},()=>[undefined,()=>{}],overviewLaneMap,overviewReadability,()=>null);
const long='ОтделКонтрольныхИспытанийИПодготовкиДокументации'.repeat(2);
const model={id:'readability-fixture',lanes:[{id:'a',name:long},{id:'b',name:'Отдел выпуска'}],
  nodes:[{id:'a1',laneId:'a',type:'task',name:'Проверить документы'},{id:'b1',laneId:'b',type:'task',name:'Выпустить результат'}],
  edges:[{id:'forward',sourceId:'a1',targetId:'b1',label:'Принято'},{id:'return',sourceId:'b1',targetId:'a1',label:'Вернуть'},{id:'broken',sourceId:'a1',targetId:'missing'}]};
const overview=renderToStaticMarkup(createElement(Overview,{process:model}));
const styles=read('../src/process-instruction.css');
const viewer=read('../src/styles.css').split(/\r?\n/).filter(line=>line.startsWith('.node-label')).join('\n');
const name='Очень длинная подпись задачи '.repeat(12),density=diagramTaskTypography(name).density;
const inner=`<!doctype html><html lang="ru"><meta charset="utf-8"><style>
  :root{--line:#cdd9cc;--ink:#22342b;--muted:#45564c}body{font:14px Arial,sans-serif;margin:12px;color:var(--ink)}
  ${styles}\n${viewer}
  </style><body><p id="result">Проверка…</p><svg width="200" height="65"><rect x="1" y="1" width="198" height="63" rx="10" fill="#eef4ee" stroke="#355645"/><foreignObject x="10" y="8" width="180" height="49"><div xmlns="http://www.w3.org/1999/xhtml" class="node-label${density}" title="${name}"><span>${name}</span></div></foreignObject></svg>
  ${overview}
  <script>document.querySelector('.route-map-readability').open=true;
  const label=document.querySelector('.node-label span'),frame=document.querySelector('.node-label');
  const fits=[...document.querySelectorAll('.route-map-lanes li,.route-map-pairs li')].every(e=>e.scrollWidth<=e.clientWidth+1);
  const noOverflow=document.documentElement.scrollWidth<=innerWidth+1;
  const clipped=label.scrollHeight>label.clientHeight&&label.getBoundingClientRect().bottom<=frame.getBoundingClientRect().bottom+1&&frame.title.length>100;
  const ctx=document.createElement('canvas').getContext('2d');ctx.font='600 13px Manrope, sans-serif';
  const font=ctx.measureText('ШШШ').width>ctx.measureText('iii').width;
  document.getElementById('result').textContent=(fits&&noOverflow&&clipped&&font?'PASS':'FAIL')+' · '+innerWidth+' px · карта '+fits+' · ширина страницы '+noOverflow+' · подпись '+clipped+' · шрифт '+font;
  </script></body></html>`;
const escape=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const width=Number(process.argv[3]);
if(![360,1100].includes(width))throw Error('Choose 360 or 1100 CSS pixels.');
writeFileSync(process.argv[2],`<!doctype html><meta charset="utf-8"><title>Читаемость — контроль</title><body style="margin:0"><iframe title="Контроль читаемости" style="border:0;width:${width}px;height:100vh" srcdoc="${escape(inner)}"></iframe></body>`,{flag:'wx'});
