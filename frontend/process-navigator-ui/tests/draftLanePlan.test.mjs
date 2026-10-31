import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {isSectionAvailable,readSectionLocation,sectionLocationHash} from '../src/section-location.ts';
const source=readFileSync(new URL('../src/DraftLaneSyncDialog.tsx',import.meta.url),'utf8');
const compiled=await transformWithOxc(source,'DraftLaneSyncDialog.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
function render({plan,selected=[],busy=false,error='',result}={}){
  const states=[plan,selected,busy,error,0,result];
  const Page=new Function('React','useState','useEffect','ArrowLeft','RefreshCw',code+';return DraftLaneSyncDialog;')({createElement,Fragment},()=>[states.shift(),()=>{}],()=>{},'span','span');
  return renderToStaticMarkup(createElement(Page,{onClose(){},onSynced(){}}));
}
const item={processId:'p',processName:'Процесс',fingerprint:'hash',changes:[{laneId:'l',before:'Старое',after:'Новое'}]};
test('lane plan is a permission-guarded address, not modal',()=>{
  assert.equal(readSectionLocation(sectionLocationHash('laneSync')),'laneSync');
  assert.equal(isSectionAvailable('laneSync',['process.view']),false);
  assert.equal(isSectionAvailable('laneSync',['system.manage']),true);
  assert.doesNotMatch(render(),/role="dialog"|aria-modal/);
});
test('explicit selection, exact old/new values, blocked and unchanged drafts',()=>{
  const html=render({plan:{organizationRevision:'rev',items:[item,{...item,processId:'bad',reason:'Заблокирован',changes:[]},{...item,processId:'same',changes:[]}]}});
  for(const s of ['Старое','Новое','Заблокирован','уже актуальны','Выбрано: 0','резервная копия'])assert.ok(html.includes(s),s);
  assert.match(html,/<button disabled="">Создать резервную копию/);
  assert.doesNotMatch(html,/checked=""/);
  assert.doesNotMatch(render({plan:{items:[item]},selected:['p']}),/<button disabled="">Создать резервную копию/);
});
test('loading, errors, results and malicious source labels stay explicit and escaped',()=>{
  assert.match(render({busy:true}),/role="status"/);
  assert.match(render({error:'Ошибка'}),/role="alert"/);
  const result={backupFileName:'safe.zip',report:{updatedProcesses:1,renamedLanes:2,items:[]}};
  assert.match(render({result}),/safe.zip/);
  assert.match(render({plan:{items:[{...item,processName:'<script>bad</script>'}]}}),/&lt;script&gt;/);
});
