import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const origin=process.argv[2];
assert.equal(origin,'http://127.0.0.1:5087','Use the isolated acceptance server.');
const directory=new URL('../artifacts/package-context/',import.meta.url);
const data=new URL('repository/backend/ProcessNavigator.Api/Data/',directory);
const id='demo-showcase-l3-warehouse';
const bpmn=new URL(id+'.bpmn',data),held=new URL(id+'.bpmn.held',data);
assert.ok(fileURLToPath(data).includes('artifacts'));
const headers={'X-Process-Navigator-User':'demo-superadministrator'};
async function json(route){const r=await fetch(origin+route,{headers});assert.equal(r.status,200,route);return r.json();}
function clean(value){
  if(Array.isArray(value))return value.map(clean);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null&&!(Array.isArray(v)&&!v.length)).map(([k,v])=>[k,clean(v)]));
  return value;
}
const original=await json('/api/processes/'+id);
assert.equal(original.status,'Published');
assert.ok(original.nodes.some(n=>n.executorKind==='system')&&original.nodes.some(n=>n.executorKind==='human'));
const denied=await fetch(origin+'/api/processes/'+id+'/package-export?draft=true',{headers:{'X-Process-Navigator-User':'demo-employee'}});
assert.equal(denied.status,403);
for(const process of await json('/api/processes')){
  const r=await fetch(origin+'/api/processes/'+process.id+'/package-export',{headers});
  assert.equal(r.status,200,process.id);assert.match(r.headers.get('content-type'),/application\/zip/);
}
const response=await fetch(origin+'/api/processes/'+id+'/package-export',{headers});
const bytes=new Uint8Array(await response.arrayBuffer());
fs.writeFileSync(new URL('model.zip',directory),bytes);
const before=fs.readFileSync(bpmn);
assert.ok(!fs.existsSync(new URL('Drafts/'+id+'.bpmn',data)),'Use a fresh isolated copy without the test draft.');
let moved=false;
try{
  assert.ok(!fs.existsSync(held));fs.renameSync(bpmn,held);moved=true;
  async function upload(content,user='demo-superadministrator'){
    const form=new FormData();form.set('packageFile',new Blob([content]),'model.zip');
    return fetch(origin+'/api/processes/import-package',{method:'POST',headers:{'X-Process-Navigator-User':user},body:form});
  }
  assert.equal((await upload(bytes,'demo-employee')).status,403);
  const result=await upload(bytes);assert.equal(result.status,200);
  const report=await result.json();assert.equal(report.imported,1);assert.equal(report.failed,0);
  const draft=await json('/api/processes/'+id+'?draft=true');
  assert.deepEqual(clean(draft),clean({...original,version:'0.1',status:'Draft'}));
  const context=new URL('Drafts/'+id+'.context.json',data),saved=fs.readFileSync(context);
  const repeated=await(await upload(bytes)).json();assert.equal(repeated.skipped,1);
  assert.deepEqual(fs.readFileSync(context),saved);
  assert.equal((await upload(new TextEncoder().encode('not zip'))).status,422);
  assert.deepEqual(fs.readFileSync(held),before);
  fs.writeFileSync(new URL('http-result.json',directory),JSON.stringify({passed:true,models:10,imported:1,skipped:1,denied:403,invalid:422},null,2));
  console.log('[package-context:http] PASS: 10 exports; exact editable model roundtrip, new draft, repeat skip, permissions and malformed ZIP.');
}finally{if(moved)fs.renameSync(held,bpmn);}
