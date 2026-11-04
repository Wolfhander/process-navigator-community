import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {processes} from '../../../tools/generate-demo-showcase.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const path=JSON.parse(read('../src/manual-learning-path.json'));
const manual=read('../../../docs/user-manual.md');
const scenarios=JSON.parse(read('../src/demonstration-scenarios.json'));
test('five safe exercises in the manual reference existing demonstrations and the drawing example',()=>{
  assert.equal(path.length,5);
  assert.equal(new Set(path.map(item=>item.scenario)).size,5);
  for(const [index,item] of path.entries()){
    assert.ok(scenarios.some(s=>s.id===item.scenario&&s.models.length&&s.evidence.length));
    assert.ok(manual.includes((index+1)+'. '+item.step));
  }
  assert.ok(path[0].step.includes(processes.find(model=>model.id==='demo-showcase-l4-drawing').name));
  assert.match(path[4].step,/не применяйте импорт/);
  assert.match(manual,/рабочий фонд сбрасывать не нужно/);
});
test('the in-app guide opens on the exercises and offers an explicit transition to demonstrations',async()=>{
  const compiled=await transformWithOxc(read('../src/HelpDialog.tsx'),'HelpDialog.tsx',{jsx:{runtime:'classic'}});
  const code=compiled.code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
  const icons=['ArrowLeft','BookOpen','Check','Search','ShieldCheck','X'];
  const Page=new Function('React','useMemo','useState','learningPath',...icons,code+';return HelpDialog;')({createElement},fn=>fn(),value=>[value,()=>{}],path,...icons.map(()=>()=>null));
  let opened=0;
  const tree=Page({page:true,user:{role:'employee',permissions:[]},onClose(){},onDemonstrations(){opened++;}});
  const html=renderToStaticMarkup(tree);
  for(const item of path)assert.ok(html.includes(item.step));
  assert.match(html,/не сбрасывайте рабочие данные/);
  const find=node=>Array.isArray(node)?node.map(find).find(Boolean):node?.type==='button'&&node.props.children==='Открыть матрицу демонстраций'?node:node?.props?find(node.props.children):undefined;
  assert.equal(opened,0);
  find(tree).props.onClick();
  assert.equal(opened,1);
});
