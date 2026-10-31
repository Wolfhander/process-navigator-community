import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import {createDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),folder=fs.mkdtempSync(path.join(root,'artifacts','schedule-replay-http-')),data=path.join(folder,'Data');
for(const [name,text]of createDemoContour().files){const p=path.join(data,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
const requests=JSON.parse(fs.readFileSync(path.join(root,'master-data','schedule-replay-fixture.json'),'utf8')).requests;
const probe=net.createServer();await new Promise((r,j)=>{probe.once('error',j);probe.listen(0,'127.0.0.1',r);});const port=probe.address().port;await new Promise(r=>probe.close(r));
const dll=path.join(root,'backend','ProcessNavigator.Api','bin','Release','net9.0','ProcessNavigator.Api.dll');assert.ok(fs.existsSync(dll));
const fd=fs.openSync(path.join(folder,'server.log'),'wx'),origin='http://127.0.0.1:'+port;
const server=spawn('dotnet',[dll,'--contentRoot',folder,'--urls',origin],{cwd:folder,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,ASPNETCORE_ENVIRONMENT:'Development'}});fs.closeSync(fd);
let checks=0;
try{
 let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Own server exited');try{if((await fetch(origin+'/api/session')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready);
 async function call(url,method='GET',body,user='demo-superadministrator',status=200){
   const res=await fetch(origin+url,{method,headers:{'Content-Type':'application/json','X-Process-Navigator-User':user},body:body===undefined?undefined:JSON.stringify(body)});
   assert.equal(res.status,status,url);checks++;return status===200?res.json():null;
 }
 for(const request of requests){
   const result=await call('/api/processes/schedule','POST',request);
   const snapshot=await call('/api/processes/schedule/archive','POST',{name:'Frozen '+request.direction,request,expectedResult:result});
   const url='/api/processes/schedule/archive/'+snapshot.id;
   const owner='demo-superadministrator',archivePath=path.join(data,'ScheduleArchive',createHash('sha256').update(owner).digest('hex').toUpperCase()+'.json');
   const archiveBytes=fs.readFileSync(archivePath);
   const replay=await call(url+'/replay');assert.equal(replay.status,'Reproduced');assert.deepEqual(replay.replayedResult,snapshot.result);checks++;
   await call(url+'/replay','GET',undefined,'demo-employee',404);
   const sourcePath=path.join(data,request.rootProcessId+'.context.json'),original=fs.readFileSync(sourcePath);
   try{
     fs.writeFileSync(sourcePath,'{broken live context');
     assert.equal((await call(url+'/replay')).status,'Reproduced');assert.equal((await call(url+'/check')).status,'Unavailable');checks++;
   }finally{fs.writeFileSync(sourcePath,original);}
   assert.deepEqual(fs.readFileSync(archivePath),archiveBytes);checks++;
   try{
     const edited=JSON.parse(archiveBytes);edited.snapshots.find(s=>s.id===snapshot.id).result.durationHours+=999;
     fs.writeFileSync(archivePath,JSON.stringify(edited));
     assert.equal((await call(url+'/replay')).status,'Different');checks++;
     edited.snapshots.find(s=>s.id===snapshot.id).result.sources.algorithm='unavailable-engine';
     fs.writeFileSync(archivePath,JSON.stringify(edited));
     assert.equal((await call(url+'/replay')).status,'Unavailable');checks++;
   }finally{fs.writeFileSync(archivePath,archiveBytes);}
 }
 fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({checks,directions:requests.map(r=>r.direction),archiveUnchanged:true,ownerIsolation:true,liveSourcesNotUsed:true},null,2));
 console.log('Schedule frozen replay HTTP checks passed: '+checks+'; '+folder);
}finally{server.kill();await Promise.race([new Promise(r=>server.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);}
