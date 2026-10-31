import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createDemoContour} from './reset-demo-contour.mjs';
const root=process.cwd(),name=process.argv[3]??'request-diagnostics-http-20261031';assert.match(name,/^request-diagnostics-http-[0-9]{8}(-[a-z0-9-]+)?$/);
const folder=path.join(root,'artifacts',name),server=path.join(folder,'server'),data=path.join(server,'Data');
if(process.argv[2]==='prepare'){assert.ok(!fs.existsSync(folder),'Never overwrite acceptance files.');for(const [name,text]of createDemoContour().files){const p=path.join(data,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}console.log(server);process.exit(0);}
assert.equal(process.argv[2],'http://127.0.0.1:5092');const origin=process.argv[2];let checks=0;
const canary='CANARY_PRIVATE_TOKEN',clientId='a'.repeat(32),headers={'X-Process-Navigator-User':'demo-superadministrator','X-Process-Navigator-Operation-Id':clientId,'Authorization':'Bearer '+canary};
async function call(url,user='demo-superadministrator',status=200){const res=await fetch(origin+url,{headers:{...headers,'X-Process-Navigator-User':user}});assert.equal(res.status,status,url);const id=res.headers.get('x-process-navigator-operation-id');assert.match(id,/^[a-f0-9]{32}$/);assert.notEqual(id,clientId);checks++;return {res,id,text:await res.text()};}
await call('/api/admin/diagnostics','demo-employee',403);
const missing=await call('/api/processes/'+canary+'?token='+canary,undefined,404);
const orgFile=path.join(data,'organization.json'),original=fs.readFileSync(orgFile);let broken;
try{fs.writeFileSync(orgFile,'{broken '+canary+' C:/PRIVATE/PATH/name@example.invalid');broken=await call('/api/organization?secret='+canary,undefined,500);assert.ok(!broken.text.includes(canary)&&!broken.text.includes('PRIVATE/PATH'));assert.equal(JSON.parse(broken.text).operationId,broken.id);}
finally{fs.writeFileSync(orgFile,original);}
const snapshot=await call('/api/admin/diagnostics');const packet=JSON.parse(snapshot.text);
assert.ok(packet.events.some(e=>e.operationId===missing.id&&e.status===404));
assert.ok(packet.events.some(e=>e.operationId===broken.id&&e.failure==='ServerError'));
assert.ok(!snapshot.text.includes(canary)&&!snapshot.text.includes('PRIVATE/PATH')&&!snapshot.text.includes('name@example.invalid')&&!snapshot.text.includes('Authorization'));
assert.equal(packet.totalRequests,packet.events.length+packet.discardedEvents);assert.equal(packet.requestOperationId,snapshot.id);assert.equal(snapshot.res.headers.get('cache-control'),'no-store');
assert.deepEqual(Object.keys(packet.events[0]).sort(),['at','operationId','method','category','status','elapsedMilliseconds','failure'].sort());
assert.deepEqual(fs.readFileSync(orgFile),original);
fs.writeFileSync(path.join(folder,'packet.json'),snapshot.text);
fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({checks,correlation:true,canariesAbsent:true,events:packet.events.length},null,2));console.log('Request diagnostics HTTP checks passed: '+checks);
