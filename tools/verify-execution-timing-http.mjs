import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {createDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),folder=fs.mkdtempSync(path.join(root,'artifacts','execution-timing-http-')),data=path.join(folder,'Data');
for(const [name,text]of createDemoContour().files){const p=path.join(data,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
const cases=JSON.parse(fs.readFileSync(path.join(root,'master-data','execution-timing-fixture.json'),'utf8')).cases;
const probe=net.createServer();await new Promise((r,j)=>{probe.once('error',j);probe.listen(0,'127.0.0.1',r);});const port=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+port;
const dll=path.join(root,'backend','ProcessNavigator.Api','bin','Release','net9.0','ProcessNavigator.Api.dll');assert.ok(fs.existsSync(dll));const fd=fs.openSync(path.join(folder,'server.log'),'wx');
const server=spawn('dotnet',[dll,'--contentRoot',folder,'--urls',origin],{cwd:folder,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,ASPNETCORE_ENVIRONMENT:'Development'}});fs.closeSync(fd);let checks=0;
try{
 let ready=false;for(let n=0;n<100;n++){if(server.exitCode!==null)throw Error('Own server exited');try{if((await fetch(origin+'/api/session')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready);
 async function call(url,user='demo-superadministrator',status=200){const res=await fetch(origin+url,{headers:{'X-Process-Navigator-User':user}});assert.equal(res.status,status,url);checks++;return status===200?res.json():null;}
 const id='demo-showcase-l4-drawing',model=await call('/api/processes/'+id),elementId=model.nodes.find(n=>n.type==='task').id;
 const records=cases.filter(c=>['queue-overdue','paused','cancelled','null-norm','stored-completion'].includes(c.id)).map(c=>{
   const delta=Date.now()-Date.parse(c.now),shift=s=>s?new Date(Date.parse(s)+delta).toISOString():null;
   const step={...c.step,elementId,availableAt:shift(c.step.availableAt),startedAt:shift(c.step.startedAt),completedAt:shift(c.step.completedAt)};
   return{id:c.id,processId:id,processVersion:model.version,name:'Учебное время '+c.id,status:c.status,startedAt:step.availableAt??new Date().toISOString(),completedAt:c.status==='Cancelled'?shift(c.events.at(-1).occurredAt):null,startedBy:'fixture',steps:[step],lifecycleEvents:c.events.map(e=>({...e,occurredAt:shift(e.occurredAt)}))};
 });
 const file=path.join(data,'Executions',id+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(records));const before=fs.readFileSync(file);
 const report=await call('/api/processes/'+id+'/analytics'),row=report.steps.find(s=>s.elementId===elementId);
 assert.equal(report.totalInstances,5);assert.equal(row.overdueCount,3);assert.equal(row.inProgressCount,1);assert.equal(row.completedCount,1);assert.equal(row.averageMinutes,60);assert.equal(report.averageCycleMinutes,null);assert.ok(Number.isFinite(Date.parse(report.capturedAt)));checks++;
 await call('/api/processes/'+id+'/analytics','demo-employee',403);
 assert.deepEqual(fs.readFileSync(file),before);checks++;
 fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({checks,overdue:row.overdueCount,inProgress:row.inProgressCount,averageMinutes:row.averageMinutes,filesUnchanged:true},null,2));console.log('Execution timing HTTP checks passed: '+checks+'; '+folder);
}finally{server.kill();await Promise.race([new Promise(r=>server.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);}
