import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createDemoContour} from './reset-demo-contour.mjs';
const root=process.cwd(),name=process.argv[3]??'execution-portfolio-http-20261031';assert.match(name,/^execution-portfolio-http-[0-9]{8}(-[a-z0-9-]+)?$/);
const folder=path.join(root,'artifacts',name),server=path.join(folder,'server'),data=path.join(server,'Data'),id='demo-showcase-l3-warehouse';
if(process.argv[2]==='prepare'){
  assert.ok(!fs.existsSync(folder),'Do not overwrite acceptance files.');
  for(const [name,text]of createDemoContour().files){const p=path.join(data,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
  const c=JSON.parse(fs.readFileSync(path.join(data,id+'.context.json'))),stepId=Object.keys(c.elements).find(k=>k.startsWith('Task_'));assert.ok(stepId);
  const base=Date.now()-5*86400000,t=n=>new Date(base+n*60000).toISOString();
  const step={elementId:stepId,status:'Completed',iteration:2,startedAt:t(75),completedAt:t(105),actualQueueMinutes:10,actualWorkMinutes:30,actualDurationMinutes:40,overdueMinutes:5,
    history:[{iteration:1,status:'Completed',startedAt:t(20),completedAt:t(60),archivedAt:t(65),archivedBy:'fixture',returnReason:'Повтор',actualQueueMinutes:20,actualWorkMinutes:40,actualDurationMinutes:60,overdueMinutes:0}]};
  const instance={id:'observed',processId:id,processVersion:c.version,name:'Учебное наблюдение',status:'Completed',startedAt:t(0),completedAt:t(120),startedBy:'fixture',steps:[step],
    returnEvents:[{fromElementId:stepId,targetElementId:stepId,returnedAt:t(65),iteration:2,reason:'Повтор',userId:'fixture',resetElementIds:[stepId]}]};
  fs.mkdirSync(path.join(data,'Executions'));fs.writeFileSync(path.join(data,'Executions',id+'.json'),JSON.stringify([instance]));
  console.log(server);process.exit(0);
}
assert.equal(process.argv[2],'http://127.0.0.1:5090');const origin=process.argv[2],endpoint=origin+'/api/analytics/execution';let checks=0;
const source=path.join(data,'Executions',id+'.json'),hash=()=>createHash('sha256').update(fs.readFileSync(source)).digest('hex');const before=hash();
async function get(user='demo-superadministrator',status=200){const r=await fetch(endpoint,{headers:{'X-Process-Navigator-User':user}});assert.equal(r.status,status);checks++;if(status===200){assert.equal(r.headers.get('cache-control'),'no-store');return r.json();}}
await get('demo-employee',403);
const report=await get();assert.equal(report.instances.length,1);assert.equal(report.instances[0].cycleMinutes,120);assert.equal(report.instances[0].returnEvents,1);assert.equal(report.attempts.reduce((s,a)=>s+a.workMinutes,0),70);assert.equal(report.attempts.reduce((s,a)=>s+a.queueMinutes,0),30);
assert.equal(report.attempts.filter(a=>a.overdueMinutes>0).length,1);assert.ok(report.attempts.every(a=>a.organizationBasis.includes('не историческая')));assert.equal(hash(),before);
assert.equal((await get()).fingerprint,report.fingerprint);
fs.writeFileSync(path.join(data,'Executions','broken.json'),'{broken');
const partial=await get();assert.equal(partial.complete,false);assert.ok(partial.issueCount>0);assert.equal(partial.instances.length,1);assert.equal(hash(),before);
fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({checks,instances:report.instances.length,workMinutes:70,queueMinutes:30,cycleMinutes:120,partialIssues:partial.issueCount},null,2));console.log('Execution portfolio HTTP checks passed: '+checks);
