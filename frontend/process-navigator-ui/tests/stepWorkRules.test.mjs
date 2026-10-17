import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=await transformWithOxc(readFileSync(new URL('../src/StepWorkRules.tsx',import.meta.url),'utf8'),'StepWorkRules.tsx',{jsx:{runtime:'classic'}});
const components=new Function('React',source.code.replace(/^import[^\n]*\n/gm,'').replace(/export function /g,'function ')+';return {StepWorkRulesView,StepWorkRulesEditor};')({createElement,Fragment});
test('structured states and exceptions render as escaped guidance, never execution',()=>{
  const html=renderToStaticMarkup(components.StepWorkRulesView({rules:[{kind:'document',objectId:'d',requiredState:'Подписан',condition:'При поставке'},{kind:'exception',condition:'Нет подписи',response:'<script>Вернуть</script>',responsible:'Владелец'}]}));
  assert.match(html,/Подписан/);assert.match(html,/При поставке/);assert.match(html,/Нет подписи/);assert.match(html,/Владелец/);
  assert.doesNotMatch(html,/<script>/);assert.match(html,/не автоматическая проверка/);
  assert.match(renderToStaticMarkup(components.StepWorkRulesView({})),/не заполнены/);
});
test('editor explicitly adds or clears rules without inferring document states',()=>{
  let changed;
  const tree=components.StepWorkRulesEditor({rules:[],objects:[{objectId:'d',name:'Документ'}],onChange:v=>changed=v});
  function find(value,text) {
    if(Array.isArray(value))return value.map(v=>find(v,text)).find(Boolean);
    if(!value||typeof value!=='object')return;
    return value.type==='button'&&value.props.children===text?value:find(value.props?.children,text);
  }
  assert.equal(changed,undefined);find(tree,'Добавить требование документа').props.onClick();
  assert.deepEqual(changed,[{kind:'document',objectId:'d',requiredState:''}]);
  const withoutObjects=components.StepWorkRulesEditor({rules:[],objects:[],onChange:()=>{}});
  assert.equal(find(withoutObjects,'Добавить требование документа').props.disabled,true);
  const limited=components.StepWorkRulesEditor({rules:Array(40).fill({kind:'exception'}),objects:[],onChange:()=>{}});
  assert.equal(find(limited,'Добавить правило исключения').props.disabled,true);
});
