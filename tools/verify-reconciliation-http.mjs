import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
import {createDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),folder=fs.mkdtempSync(path.join(root,'artifacts/reconciliation-http-')),data=path.join(folder,'Data');
const spec=JSON.parse(fs.readFileSync(path.join(root,'master-data/reconciliation-fixture.json'),'utf8'));
for(const [name,text]of createDemoContour().files){const p=path.join(data,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
const contextPath=path.join(data,spec.processId+'.context.json'),context=JSON.parse(fs.readFileSync(contextPath,'utf8'));
const requirement={id:spec.requirementId,text:spec.text,source:spec.source,locator:spec.locator,elementIds:spec.elementIds,checkSequence:true};
context.passport.sourceRequirements=[requirement,{...requirement,id:'bad-route',elementIds:[...spec.elementIds].reverse()},{...requirement,id:'unmapped',elementIds:[],checkSequence:false}];
fs.writeFileSync(contextPath,JSON.stringify(context));const original=fs.readFileSync(contextPath);
const probe=net.createServer();await new Promise((r,j)=>{probe.once('error',j);probe.listen(0,'127.0.0.1',r);});
const port=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+port;
const fd=fs.openSync(path.join(folder,'server.log'),'wx'),server=spawn('dotnet',[path.join(root,'backend/ProcessNavigator.Api/bin/Release/net9.0/ProcessNavigator.Api.dll'),'--contentRoot',folder,'--urls',origin],{cwd:folder,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,ASPNETCORE_ENVIRONMENT:'Development'}});
fs.closeSync(fd);let startupError;server.on('error',e=>startupError=e);let checks=0;const report={result:'FAIL'};
try{
  let ready=false;for(let n=0;n<100;n++){if(startupError)throw startupError;try{if((await fetch(origin+'/api/session')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  async function call(url,body,status=200,user='demo-superadministrator'){
    const res=await fetch(origin+url,{method:body?'POST':'GET',headers:{'X-Process-Navigator-User':user,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
    assert.equal(res.status,status,url);checks++;return status===200?res.json():null;
  }
  const url=(id=spec.requirementId,draft=false)=>'/api/processes/'+spec.processId+'/requirements/'+id+'/reviews?draft='+draft;
  const request=(value,action='review',materialId)=>({expectedVersion:value.version,expectedFingerprint:value.fingerprint,action,reason:spec.reason,previousEventId:value.history[0]?.id??null,...(materialId?{materialId}:{})});
  async function upload(draft=false){
    const target={processId:spec.processId,draft,name:'TRACE-001 — оригинал сверки',kind:'passport',documentVersion:'1'};
    const preview=await call('/api/source-materials/preview',target),form=new FormData();
    form.set('target',JSON.stringify({...target,expectedFingerprint:preview.fingerprint}));form.set('file',new Blob([fs.readFileSync(path.join(root,spec.original))]),'TRACE-001.md');
    return(await call('/api/source-materials',form)).material.id;
  }
  const materialId=await upload();let current=await call(url());assert.equal(current.state,'unreviewed');assert.deepEqual(current.gaps,[]);
  await call(url(),request(current),422);
  await call(url(),{...request(current,'review',materialId),actorId:'forged'},400);
  await call(url(),request(current,'review',materialId),403,'demo-employee');
  current=await call(url(),request(current,'review',materialId));assert.equal(current.state,'reviewed');assert.equal(current.history[0].actorId,'demo-superadministrator');
  assert.equal(current.history[0].material.id,materialId);assert.equal(current.history[0].requirement.id,spec.requirementId);
  const retry=request({...current,history:[]},'review',materialId);
  assert.equal((await call(url(),retry)).history.length,1);
  await call(url(),{...request(current,'reject'),previousEventId:null},422);
  const before=JSON.stringify(current.history);
  current=await call(url(),request(current,'withdraw'));assert.equal(current.state,'withdrawn');assert.equal(current.history.length,2);
  current=await call(url(),request(current,'reject'));assert.equal(current.state,'rejected');assert.equal(current.history.length,3);
  const concurrent=await Promise.all(['A','B'].map(reason=>fetch(origin+url(),{method:'POST',headers:{'Content-Type':'application/json','X-Process-Navigator-User':'demo-superadministrator'},
    body:JSON.stringify({...request(current,'review',materialId),reason:'Параллельное решение '+reason})})));
  checks+=2;assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,422]);current=await call(url());assert.equal(current.history.length,4);
  for(const id of ['bad-route','unmapped']){
    const value=await call(url(id));assert.ok(value.gaps.length);await call(url(id),request(value,'review',materialId),422);
  }
  const files=fs.readdirSync(path.join(data,'ReconciliationReviews'));assert.equal(files.length,1);
  const journalPath=path.join(data,'ReconciliationReviews',files[0]),journalBytes=fs.readFileSync(journalPath);
  const changed=JSON.parse(original);changed.passport.sourceRequirements[0].text+=' Уточнение условия.';
  fs.writeFileSync(contextPath,JSON.stringify(changed));
  assert.equal((await call(url())).state,'stale');await call(url(),request(current,'review',materialId),422);
  const changedReport=await call(url());await call(url(),request(changedReport,'review',materialId),422);
  assert.deepEqual(fs.readFileSync(journalPath),journalBytes);
  changed.passport.sourceRequirements=changed.passport.sourceRequirements.filter(r=>r.id!==spec.requirementId);
  fs.writeFileSync(contextPath,JSON.stringify(changed));const removed=await call(url());assert.equal(removed.requirement,null);assert.equal(removed.history.length,4);
  fs.writeFileSync(contextPath,original);
  await call('/api/processes/'+spec.processId+'/draft',{});
  const privateMaterial=await upload(true),draft=await call(url(spec.requirementId,true));
  const privateReport=await call(url(spec.requirementId,true),request(draft,'review',privateMaterial));assert.equal(privateReport.state,'reviewed');
  await call(url(spec.requirementId,true),undefined,403,'demo-employee');
  const publicHistory=(await call(url(),undefined,200,'demo-employee')).history;assert.ok(publicHistory.every(e=>!e.draft));
  assert.equal(publicHistory.length,4);assert.equal(JSON.stringify(publicHistory.slice().reverse()[0]),JSON.stringify(JSON.parse(before)[0]));
  const valid=fs.readFileSync(journalPath);
  fs.writeFileSync(journalPath,'{broken');
  await call(url(),undefined,422);await call(url(),request(current,'review',materialId),422);assert.equal(fs.readFileSync(journalPath,'utf8'),'{broken');
  fs.writeFileSync(journalPath,valid);
  const bounded=JSON.parse(valid),sample=bounded.events[0];bounded.events=Array.from({length:1000},()=>({...sample,id:randomUUID().replaceAll('-','')}));
  fs.writeFileSync(journalPath,JSON.stringify(bounded));const full=await call(url());
  await call(url(),{...request(full,'reject'),reason:'Проверка предела без удаления'},422);assert.equal(JSON.parse(fs.readFileSync(journalPath)).events.length,1000);
  fs.writeFileSync(journalPath,valid);
  const backup=await call('/api/admin/backups',{});
  const backupResponse=await fetch(origin+'/api/admin/backups/'+backup.fileName+'/content',{headers:{'X-Process-Navigator-User':'demo-superadministrator'}});
  assert.equal(backupResponse.status,200);checks++;
  assert.ok(Buffer.from(await backupResponse.arrayBuffer()).includes(Buffer.from('Data/ReconciliationReviews/'+files[0])),'Backup must contain journal entry');
  assert.deepEqual(fs.readFileSync(contextPath),original);
  report.result='PASS';report.checks=checks;report.history=true;report.sourceIntegrity=true;report.bounds=true;
  console.log('Reconciliation HTTP PASS: '+checks+' calls; '+folder);
}catch(error){report.error=error.message;throw error;}
finally{fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));if(server.exitCode===null)server.kill();}
