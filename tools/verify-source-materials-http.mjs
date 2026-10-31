import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const name=process.argv[3]??'source-materials-http-20261031';assert.match(name,/^source-materials-http-[a-z0-9-]+$/);
const folder=path.join(root,'artifacts',name),contentRoot=path.join(folder,'server'),data=path.join(contentRoot,'Data');
const processId='demo-showcase-l3-warehouse',elementId='Task_PhysicalReceipt',objectId='demo-receipt-inspection';
const contextPath=path.join(data,processId+'.context.json');
if(process.argv[2]==='prepare'){
  assert.ok(!fs.existsSync(folder),'Never overwrite an existing acceptance fixture.');
  for(const [name,text]of createDemoContour().files){const target=path.join(data,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);}
  const context=JSON.parse(fs.readFileSync(contextPath,'utf8'));context.passport.scope='Isolated source material fixture '+randomUUID();
  fs.writeFileSync(contextPath,JSON.stringify(context,null,2));
  console.log('Prepared: '+contentRoot);process.exit(0);
}
const origin=process.argv[2];assert.equal(origin,'http://127.0.0.1:5087');
let checks=0;
async function call(route,body,user='demo-superadministrator',expected=200){
  const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Process-Navigator-User':user},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(response.status,expected,route);checks++;return expected===200?response.json():undefined;
}
const original=fs.readFileSync(contextPath),context=JSON.parse(original);
assert.ok(context.passport.scope.startsWith('Isolated source material fixture '));
assert.equal((await call('/api/processes/'+processId)).passport.scope,context.passport.scope,'Verify random owned fixture marker before mutations');
const bytes=fs.readFileSync(path.join(root,'master-data/v1/documents/PKG-001.md'));
let target={processId,elementId,objectId,draft:false,name:'Паспорт приёмки PKG-001 — проверка оригинала и точной привязки к физической приёмке материалов',kind:'passport',documentVersion:'PKG-001'};
async function upload(mapping=target,user='demo-superadministrator',expected=200,filename='PKG-001.md'){
  const form=new FormData();form.set('file',new Blob([bytes]),filename);form.set('target',JSON.stringify(mapping));
  const response=await fetch(origin+'/api/source-materials',{method:'POST',headers:{'X-Process-Navigator-User':user},body:form});
  assert.equal(response.status,expected,'Source upload');checks++;return expected===200?response.json():undefined;
}
assert.deepEqual((await call('/api/source-materials')).materials,[]);
await call('/api/source-materials/preview',target,'demo-employee',403);
await upload(target,'demo-employee',403);
await call('/api/source-materials/preview',{...target,uploadedBy:'forged'},'demo-superadministrator',400);
const preview=await call('/api/source-materials/preview',target);assert.equal(preview.objectId,objectId);
target={...target,expectedFingerprint:preview.fingerprint};
await upload({...target,expectedFingerprint:'stale'},'demo-superadministrator',422);
await upload({...target,uploadedBy:'forged'},'demo-superadministrator',422);
await upload(target,'demo-superadministrator',422,'run.exe');
const saved=await upload();assert.equal(saved.created,true);assert.equal(saved.material.uploadedBy,'demo-superadministrator');
assert.equal(saved.material.sha256,createHash('sha256').update(bytes).digest('hex'));
assert.equal((await upload()).created,false);
const route='/api/source-materials/'+saved.material.id;
const download=await fetch(origin+route+'/content',{headers:{'X-Process-Navigator-User':'demo-employee'}});
assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment;/);assert.equal(download.headers.get('x-content-type-options'),'nosniff');
assert.equal(download.headers.get('cache-control'),'no-store');
assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);checks++;
assert.equal((await call(route+'/check',undefined,'demo-employee')).state,'matches');
await call('/api/processes/'+processId+'/draft',{});
let draft={...target,draft:true};draft.expectedFingerprint=(await call('/api/source-materials/preview',draft)).fingerprint;
const privateFile=(await upload(draft)).material;assert.notEqual(privateFile.id,saved.material.id);
assert.equal((await call('/api/source-materials',undefined,'demo-employee')).materials.length,1);
assert.equal((await call('/api/source-materials')).materials.length,2);
await call('/api/source-materials/'+privateFile.id+'/check',undefined,'demo-employee',403);
const hiddenDownload=await fetch(origin+'/api/source-materials/'+privateFile.id+'/content',{headers:{'X-Process-Navigator-User':'demo-employee'}});assert.equal(hiddenDownload.status,403);checks++;
assert.match(privateFile.id,/^material-[a-f0-9]{32}$/);
const metadataPath=path.join(data,'SourceMaterials',privateFile.id,'metadata.json'),metadata=fs.readFileSync(metadataPath);
try{
  const damaged=JSON.parse(metadata);delete damaged.target.draft;fs.writeFileSync(metadataPath,JSON.stringify(damaged));
  const reader=await call('/api/source-materials',undefined,'demo-employee');assert.equal(reader.unreadable,1);assert.equal(reader.materials.length,1);
  await upload(target,'demo-superadministrator',422);
}finally{fs.writeFileSync(metadataPath,metadata);}
try{
  const changed=structuredClone(context);changed.passport.scope+=' changed';fs.writeFileSync(contextPath,JSON.stringify(changed));
  assert.equal((await call(route+'/check')).state,'historical');await upload(target,'demo-superadministrator',422);
}finally{fs.writeFileSync(contextPath,original);}
const contentPath=path.join(data,'SourceMaterials',saved.material.id,'content.bin');
try{
  const damaged=Buffer.from(bytes);damaged[0]^=1;fs.writeFileSync(contentPath,damaged);
  const response=await fetch(origin+route+'/content',{headers:{'X-Process-Navigator-User':'demo-employee'}});assert.equal(response.status,422);checks++;
  await upload(target,'demo-superadministrator',422);
}finally{fs.writeFileSync(contentPath,bytes);}
assert.deepEqual(fs.readFileSync(contextPath),original,'Material operations do not edit model context');
const report={status:'passed',checks,publicMaterial:saved.material.id,privateMaterial:privateFile.id,processId,elementId,objectId,sha256:saved.material.sha256};
fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log('Source material HTTP checks passed: '+checks);
