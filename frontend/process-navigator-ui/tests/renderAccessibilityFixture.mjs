import {readFileSync,writeFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const runtime=(await transformWithOxc(read('accessibility.ts'),'accessibility.ts')).code.replaceAll('export function ','function ');
const raw=read('ProcessCanvas.tsx'),shape=raw.slice(raw.indexOf('function NodeShape('),raw.indexOf('function InlineProcessLevel('));
const code=(await transformWithOxc(shape,'shape.tsx',{jsx:{runtime:'classic'}})).code;
const NodeShape=new Function('React','resolveCapabilities','diagramTaskTypography','activateByKeyboard','shortSystemName',code+';return NodeShape;')(
  {createElement,Fragment},()=>[],()=>({density:''}),()=>{},value=>value);
const nodes=renderToStaticMarkup(createElement('svg',{width:450,height:150,viewBox:'0 0 450 150','aria-label':'Учебная схема'},[
  createElement(NodeShape,{key:1,node:{id:'t',name:'Разработать модель и чертёж',type:'task',x:10,y:30,width:220,height:90,linkedProcessId:'child'},onSelect(){},onToggleDetails(){}}),
  createElement(NodeShape,{key:2,node:{id:'g',name:'Чертёж проверен?',type:'exclusiveGateway',x:290,y:50,width:60,height:60},onSelect(){},onToggleDetails(){}})
]));
const css=read('styles.css')+read('workspace-tool-page.css')+read('accessibility.css');
const html=`<!doctype html><meta charset="utf-8"><title>Проверка клавиатуры</title><style>${css}
body{height:auto;background:#fbfcf8;padding:20px}main{max-width:800px}header{flex-wrap:wrap}svg{max-width:100%;height:auto}main>label{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.fixture-dialog{position:fixed;inset:20% 10%;background:white;border:2px solid #164b8a;padding:20px;z-index:30}.fixture-dialog button,.fixture-dialog input{margin:8px;max-width:100%}
</style><button class="skip-content" id="skip">Перейти к содержимому</button><header><button id="open">Открыть поиск</button><button id="outside">Настройки</button></header><main><h1>Разработка и согласование чертежа</h1><p>Tab — следующий элемент; Enter / пробел — выбрать шаг.</p>${nodes}<label>Название документа<input value="Чертёж"/></label><button id="save">Сохранить</button></main><div id="portals"></div><output id="report"></output>
<script>${runtime}
installModalKeyboard();
skip.onclick=()=>focusMainContent();
let activations=0;
document.querySelectorAll('.node').forEach(node=>node.onkeydown=event=>activateByKeyboard(event,()=>{activations++;report.textContent='Выбран шаг '+activations;}));
document.getElementById('open').onclick=()=>{
 const section=document.createElement('section');section.className='fixture-dialog';section.setAttribute('role','dialog');section.setAttribute('aria-modal','true');section.setAttribute('aria-label','Поиск');
 section.innerHTML='<label>Поиск процессов<input id="query"/></label><button id="nested">Подтверждение</button><button id="close">Закрыть</button>';
 portals.append(section);section.querySelector('#close').onclick=()=>section.remove();
 section.querySelector('#nested').onclick=()=>{
  const inner=document.createElement('section');inner.className='fixture-dialog';inner.setAttribute('role','alertdialog');inner.setAttribute('aria-modal','true');inner.setAttribute('aria-label','Подтверждение');
  inner.innerHTML='<button id="innerClose">Отмена</button>';portals.append(inner);inner.firstChild.onclick=()=>inner.remove();
 };
};
</script>`;
writeFileSync(process.argv[2],html,{flag:'wx'});
