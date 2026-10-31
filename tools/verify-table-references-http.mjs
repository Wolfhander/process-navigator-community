import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),folder=path.join(root,'artifacts/reference-queue-http-20261031'),contentRoot=path.join(folder,'server'),data=path.join(contentRoot,'Data');
const id='demo-showcase-l3-warehouse',contextPath=path.join(data,id+'.context.json');
if(process.argv[2]==='prepare'){
  assert.ok(!fs.existsSync(folder),'Do not overwrite an acceptance fixture.');
  for(const [name,text]of createDemoContour().files){const target=path.join(data,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);}
  const context=JSON.parse(fs.readFileSync(contextPath));context.passport.scope='Isolated reference queue '+randomUUID();fs.writeFileSync(contextPath,JSON.stringify(context,null,2));
  console.log('Prepared: '+contentRoot);process.exit(0);
}
const origin=process.argv[2];assert.equal(origin,'http://127.0.0.1:5087');
const context=JSON.parse(fs.readFileSync(contextPath));assert.ok(context.passport.scope.startsWith('Isolated reference queue '));
const headers={'X-Process-Navigator-User':'demo-superadministrator'};
assert.equal((await(await fetch(origin+'/api/processes/'+id,{headers})).json()).passport.scope,context.passport.scope);
await fetch(origin+'/api/session',{headers});
function digest(){
  const records=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(!['Keys','Audit'].includes(e.name))walk(p);}else records.push([path.relative(data,p),createHash('sha256').update(fs.readFileSync(p)).digest('hex')]);}}walk(data);return JSON.stringify(records.sort());
}
const before=digest();let checks=0;
async function call(bytes,resolution,user='demo-superadministrator',expected=200){
  const form=new FormData();form.set('tableFile',new Blob([bytes]),'references.xlsx');if(resolution!==undefined)form.set('resolution',JSON.stringify(resolution));
  const response=await fetch(origin+'/api/processes/table-references'+(resolution!==undefined?'/resolve':''),{method:'POST',headers:{'X-Process-Navigator-User':user},body:form});
  assert.equal(response.status,expected);checks++;if(expected!==200)return;
  assert.equal(response.headers.get('cache-control'),'no-store');
  return resolution!==undefined?Buffer.from(await response.arrayBuffer()):response.json();
}
const original=fs.readFileSync(path.join(root,'artifacts/reference-queue/references-input.xlsx'));
await call(original,undefined,'demo-employee',403);
let report=await call(original);
assert.deepEqual(new Set(report.groups.map(g=>g.kind)),new Set(['entity','unit','user','system','object','document']));
const entity=report.groups.find(g=>g.value==='ghost-org'),unit=report.groups.find(g=>g.value==='ghost-unit');
await call(original,{fingerprint:report.fingerprint,rules:[{groupId:entity.id,targetId:'plant'}]},'demo-employee',403);
await call(original,{fingerprint:'stale',rules:[{groupId:entity.id,targetId:'plant'}]},'demo-superadministrator',422);
await call(original,{fingerprint:report.fingerprint,rules:[{groupId:unit.id,targetId:'1.2.5'}]},'demo-superadministrator',422);
await call(original,{fingerprint:report.fingerprint,rules:[null]},'demo-superadministrator',422);
await call(original,{fingerprint:report.fingerprint,rules:[{groupId:entity.id,keepNew:true}]},'demo-superadministrator',422);
const rules=report.groups.filter(g=>g.value.startsWith('ghost-')&&g.kind!=='unit').map(g=>({groupId:g.id,targetId:({entity:'plant',user:'demo-employee',system:'1С:ERP',object:'demo-receipt-inspection',document:'demo-receipt-inspection'})[g.kind]}));
const first=await call(original,{fingerprint:report.fingerprint,rules});
await call(first,{fingerprint:report.fingerprint,rules},'demo-superadministrator',422);
report=await call(first);const nextUnit=report.groups.find(g=>g.value==='ghost-unit');assert.equal(nextUnit.scope,'plant');
const result=await call(first,{fingerprint:report.fingerprint,rules:[{groupId:nextUnit.id,targetId:'1.2.5'}]});
const final=await call(result);assert.ok(!final.groups.some(g=>g.value.startsWith('ghost-')));
const form=new FormData();form.set('tableFile',new Blob([result]),'resolved.xlsx');
const response=await fetch(origin+'/api/processes/table-preview',{method:'POST',headers,body:form});
assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.errorCount,0);checks++;
assert.equal(digest(),before,'Queue and ordinary preview never mutate application data');
assert.deepEqual(fs.readFileSync(path.join(root,'artifacts/reference-queue/references-input.xlsx')),original);
fs.writeFileSync(path.join(folder,'resolved.xlsx'),result);fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({status:'passed',checks,originalSha256:createHash('sha256').update(original).digest('hex'),resolvedSha256:createHash('sha256').update(result).digest('hex'),previewErrors:preview.errorCount},null,2));
console.log('Reference queue HTTP checks passed: '+checks);
