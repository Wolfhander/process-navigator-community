import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
const text=readFileSync(new URL('../src/ImportDialog.tsx',import.meta.url),'utf8');
const output=await transformWithOxc(text,'ImportDialog.tsx',{jsx:{runtime:'classic'}});
const code=output.code.replace(/^import [^\n]+;$/gm,'').replace('export function ','function ');
test('ZIP page explicitly chooses a revision and discloses missing files, history and organizations',()=>{
  const noop=()=>{};
  const icons=['AlertTriangle','ArrowLeft','BookmarkPlus','CheckCircle2','Download','FileArchive','FileJson2','FileSpreadsheet','FileUp','Trash2','Upload','X'];
  const params={React:{createElement,Fragment},useState:initial=>[typeof initial==='function'?initial():initial==='single'?'package':initial,noop],useEffect:noop,...Object.fromEntries(icons.map(name=>[name,()=>null]))};
  const Page=new Function(...Object.keys(params),code+';return ImportDialog;')(...Object.values(params));
  const html=renderToStaticMarkup(createElement(Page,{catalog:[{id:'demo',name:'Демо'}],onClose:noop,page:true}));
  for(const phrase of ['Модель для ZIP','Выгрузить модель ZIP','черновик вместо действующей','черновик 0.1','история и согласования не включены','.pn-context.json','существующий ID не заменяется'])assert.ok(html.includes(phrase),phrase);
});
test('package export retains server-side draft protection and uses role-aware download',()=>{
  const api=readFileSync(new URL('../src/api.ts',import.meta.url),'utf8');
  assert.match(api,/downloadProcessPackage[\s\S]*?downloadAdminFile\([\s\S]*?package-export\?draft=/);
  const server=readFileSync(new URL('../../../backend/ProcessNavigator.Api/Program.cs',import.meta.url),'utf8');
  const route=server.slice(server.indexOf('app.MapGet("/api/processes/{processId}/package-export"'),server.indexOf('app.MapPost("/api/processes/import-package"'));
  assert.match(route,/ProcessPermissions.Import/);assert.match(route,/draft == true && !CanOpenDraft/);
});
