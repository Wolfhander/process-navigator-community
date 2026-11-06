import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {transformWithOxc} from 'vite';
import {createElement,Fragment} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {buildResponsibilityView} from '../src/process-responsibility.ts';
const code=(await transformWithOxc(readFileSync(new URL('../src/ExecutionResponsibilityPanel.tsx',import.meta.url),'utf8'),'ExecutionResponsibilityPanel.tsx',{jsx:{runtime:'classic'}})).code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
const nodes=[{id:'a',type:'task',name:'Разработать',laneId:'l1',informationObjects:[{objectId:'doc',name:'Чертёж',role:'Output',version:'1'}]},{id:'b',type:'task',name:'Проверить',laneId:'l2',informationObjects:[{objectId:'doc',name:'Чертёж',role:'Input',version:'1'}]}];
const process={id:'p',name:'Учебный',version:'1',nodes,lanes:[{id:'l1',name:'Разработка'},{id:'l2',name:'Проверка'}],edges:[{id:'a-b',sourceId:'a',targetId:'b'}]};
const snapshot={process,organization:{legalEntities:[{id:'org',name:'Старая организация',units:[{id:'u',name:'Исторический отдел'}]}],crossCompanyProcesses:[{processId:'p',laneOrganizations:[{laneId:'l1',legalEntityId:'org',unitId:'u'},{laneId:'l2',legalEntityId:'org',unitId:'u'}]}]},lanes:[{laneId:'l1',userIds:['actor']}],people:[{id:'actor',name:'Историческое имя'}],capturedAt:'2026-11-06T06:00Z'};
const instance={id:'i',processId:'p',processVersion:'1',name:'Учебное выполнение',status:'Active',responsibility:snapshot,steps:[{elementId:'a',status:'Completed',iteration:1,resultObjects:[{objectId:'doc'}]},{elementId:'b',status:'NotStarted',iteration:1}]};
function setup(value=instance,canExecute=false){
 let reads=0;const writes=[],state=[[value],[{id:'p',name:'Учебный'}],'i',0,'',false,false,'p',[instance],'i','a','b','doc','1','Результат проверен','',false];
 const deps={useState:()=>[state.shift(),()=>{}],useEffect(){},loadInstances(){reads++;throw Error('No automatic reads during render');},loadProcessCatalog(){reads++;throw Error('No automatic reads');},acceptReceipt:async(...args)=>{writes.push(args);return value;},buildResponsibilityView};
 const Panel=new Function('React',...Object.keys(deps),code+';return ExecutionResponsibilityPanel;')({createElement,Fragment},...Object.values(deps));
 const tree=Panel({processId:'p',canExecute});return{tree,html:renderToStaticMarkup(tree),writes,get reads(){return reads;}};
}
function find(el,fn){if(Array.isArray(el))return el.map(v=>find(v,fn)).find(Boolean);if(!el||typeof el!=='object')return;return fn(el)?el:find(el.props?.children,fn);}
test('historical org and people are rendered without replacing them with current directories',()=>{
 const page=setup();for(const text of ['Старая организация','Исторический отдел','Историческое имя','Снимок запуска','Приёмка не подтверждалась'])assert.ok(page.html.includes(text),text);
 assert.equal(page.reads,0);assert.equal(page.writes.length,0);assert.doesNotMatch(page.html,/receipt-save/);
});
test('legacy record explicitly has no snapshot and cannot pretend a receipt was recorded',()=>{
 const page=setup({...instance,responsibility:undefined},true);assert.match(page.html,/Старая запись без исторического снимка/);assert.doesNotMatch(page.html,/receipt-save/);
});
test('explicit receipt action sends IDs and exact iterations, never a forged actor',async()=>{
 const page=setup(instance,true);const button=find(page.tree,e=>e.props?.className==='receipt-save');assert.equal(button.props.disabled,false);
 await button.props.onClick();assert.equal(page.writes.length,1);
 assert.deepEqual(page.writes[0],['p','i',{sourceProcessId:'p',sourceInstanceId:'i',sourceElementId:'a',sourceIteration:1,targetElementId:'b',targetIteration:1,objectId:'doc',version:'1',reason:'Результат проверен'}]);
});
test('closed instance has no receipt action even with execution permission',()=>{
 assert.doesNotMatch(setup({...instance,status:'Cancelled'},true).html,/receipt-save/);
});
test('untrusted historical names and reasons remain escaped',()=>{
 const page=setup({...instance,receipts:[{id:'r',objectId:'doc',version:'1',sourceProcessName:'<script>x</script>',sourceElementName:'A',sourceIteration:1,targetElementName:'B',targetElementId:'b',targetIteration:1,reason:'<img src=x>',acceptedAt:'2026-11-06T07:00Z',acceptedByName:'Actor'}]});
 assert.doesNotMatch(page.html,/<script>|<img/);assert.match(page.html,/&lt;script&gt;/);
});
