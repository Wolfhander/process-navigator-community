import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=path.join(root,'artifacts/evidence-reviews-http-20261031'),contentRoot=path.join(folder,'server'),data=path.join(contentRoot,'Data');
const id='demo-showcase-l3-warehouse',step='Task_PhysicalReceipt';
if(process.argv[2]==='prepare'){
  assert.ok(!fs.existsSync(folder),'Use a fresh fixture; never overwrite acceptance data.');
  for(const [name,text]of createDemoContour().files){const target=path.join(data,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);}
  const contextPath=path.join(data,id+'.context.json'),context=JSON.parse(fs.readFileSync(contextPath,'utf8'));
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'master-data/package-context-fixture.json'),'utf8'));
  context.elements[step].evidence=fixture.evidence;
  context.passport.scope='Isolated evidence review fixture '+randomUUID();
  fs.writeFileSync(contextPath,JSON.stringify(context,null,2));
  console.log('Prepared isolated review fixture: '+contentRoot);
  process.exit(0);
}
const origin=process.argv[2];assert.equal(origin,'http://127.0.0.1:5087','Use the isolated server.');
const contextPath=path.join(data,id+'.context.json'),source=fs.readFileSync(contextPath),context=JSON.parse(source);
const base='/api/processes/'+id+'/elements/'+step+'/evidence-reviews';
async function call(route,body,user='demo-superadministrator',expected=200){
  const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Process-Navigator-User':user},body:body?JSON.stringify(body):undefined});
  assert.equal(response.status,expected,route);return expected===200?response.json():undefined;
}
// A random fixture marker is checked before the first mutation, not merely a port number.
assert.equal((await call('/api/processes/'+id)).passport.scope,context.passport.scope);
assert.ok(context.passport.scope.startsWith('Isolated evidence review fixture '));
let report=await call(base);
assert.equal(report.history.length,0,'Use a fresh fixture journal.');
const request=(action='review',reason='Проверено по пункту 1 PKG-001')=>({index:0,expectedVersion:report.version,expectedFingerprint:report.entries[0].fingerprint,action,reason});
const document=fs.readFileSync(path.join(root,'master-data/v1/documents/PKG-001.md'),'utf8');
assert.ok(document.toLowerCase().includes(report.entries[0].evidence.statement.toLowerCase()));
await call(base,request(),'demo-employee',403);
await call(base+'?draft=true',undefined,'demo-employee',403);
await call(base,{...request(),actorId:'forged'},'demo-superadministrator',400);
report=await call(base,request());
assert.equal(report.entries[0].state,'reviewed');assert.equal(report.history[0].actorId,'demo-superadministrator');
assert.notEqual(report.history[0].actorName,report.history[0].evidence.author);
assert.equal((await call(base,request())).history.length,1);
report=await call(base,request('withdraw','Источник нуждается в уточнении'));assert.equal(report.entries[0].state,'withdrawn');
report=await call(base,request('review','Сверено повторно с PKG-001'));
const staleRequest=request();
try{
  context.elements.Task_ReceiptOrder.description+=' (контрольное изменение)';
  fs.writeFileSync(contextPath,JSON.stringify(context));
  assert.equal((await call(base)).entries[0].state,'stale');
  await call(base,staleRequest,'demo-superadministrator',422);
}finally{fs.writeFileSync(contextPath,source);}
report=await call(base);assert.equal(report.history.length,3);
await call('/api/processes/'+id+'/draft',{});
const draft=await call(base+'?draft=true');
await call(base+'?draft=true',{index:0,expectedVersion:draft.version,expectedFingerprint:draft.entries[0].fingerprint,action:'review',reason:'PRIVATE-DRAFT-REVIEW'});
const publicReport=await call(base,undefined,'demo-employee');
assert.ok(!JSON.stringify(publicReport).includes('PRIVATE-DRAFT-REVIEW'));
assert.deepEqual(fs.readFileSync(contextPath),source);
fs.writeFileSync(path.join(folder,'http-result.json'),JSON.stringify({passed:true,publishedEvents:3,privateDraftEvents:1,actorFromSession:true,staleRejected:true,permissions:[403,400]},null,2));
console.log('[evidence-reviews:http] PASS: review/withdraw/retry, server actor, stale rejection, draft isolation and unchanged source.');
