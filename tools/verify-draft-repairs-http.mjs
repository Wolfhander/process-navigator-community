import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDemoContour} from './reset-demo-contour.mjs';
const fixtureName=process.argv[3]??'draft-repairs-http-20261031';
assert.match(fixtureName,/^draft-repairs-http-[0-9]{8}(-[a-z0-9-]+)?$/);
const root=process.cwd(),folder=path.join(root,'artifacts',fixtureName),server=path.join(folder,'server'),data=path.join(server,'Data');
if(process.argv[2]==='prepare'){
  assert.ok(!fs.existsSync(folder),'Do not overwrite fixtures.');
  for(const [name,text]of createDemoContour().files){const p=path.join(data,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
  const org=JSON.parse(fs.readFileSync(path.join(data,'organization.json')));const ids=org.crossCompanyProcesses.slice(0,2).map(i=>i.processId);const nodes=[];
  fs.mkdirSync(path.join(data,'Drafts'));const marker='Isolated draft repairs '+randomUUID();
  for(const id of ids){
    const c=JSON.parse(fs.readFileSync(path.join(data,id+'.context.json')));c.status='Draft';c.version='1.1';c.owner='Не назначен';c.ownerUnitId=null;c.ownerLegalEntityId=null;c.passport.scope=marker;
    const node=Object.keys(c.elements).find(k=>k.startsWith('Task_'));assert.ok(node);nodes.push(node);c.elements[node].linkedProcessId='lost-'+id;
    fs.writeFileSync(path.join(data,'Drafts',id+'.context.json'),JSON.stringify(c));
    fs.copyFileSync(path.join(data,id+'.bpmn'),path.join(data,'Drafts',id+'.bpmn'));
  }
  const leaf=fs.readdirSync(data).filter(n=>n.endsWith('.context.json')).map(n=>[n,JSON.parse(fs.readFileSync(path.join(data,n)))]).find(([n,c])=>!ids.includes(n.replace('.context.json',''))&&Object.values(c.elements).every(e=>!e.linkedProcessId))[0].replace('.context.json','');
  fs.writeFileSync(path.join(folder,'fixture.json'),JSON.stringify({ids,nodes,leaf,marker}));console.log(server);process.exit(0);
}
assert.equal(process.argv[2],'http://127.0.0.1:5089');const origin=process.argv[2],endpoint=origin+'/api/admin/draft-repairs';let checks=0;
const fixture=JSON.parse(fs.readFileSync(path.join(folder,'fixture.json'))),{ids,nodes,leaf,marker}=fixture;
const headers={'X-Process-Navigator-User':'demo-superadministrator','Content-Type':'application/json'};
assert.equal((await(await fetch(origin+'/api/processes/'+ids[0]+'?draft=true',{headers})).json()).passport.scope,marker);
async function call(suffix='',body,user='demo-superadministrator',status=200){
  const res=await fetch(endpoint+suffix,{method:body===undefined?'GET':'POST',headers:{...headers,'X-Process-Navigator-User':user},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(res.status,status,suffix);checks++;if(status===200){assert.equal(res.headers.get('cache-control'),'no-store');return res.json();}
}
await call('',undefined,'demo-employee',403);
await call('/preview',{baseFingerprint:'bad',choices:[]},'demo-employee',403);
await call('/apply',{request:{baseFingerprint:'bad',choices:[]},proof:'bad'},'demo-employee',403);
const scan=await call();assert.equal(scan.items.length,2);const unit=scan.units[0];
const owner=id=>({processId:id,kind:'owner',legalEntityId:unit.entityId,unitId:unit.unitId});
const request={baseFingerprint:scan.fingerprint,choices:[owner(ids[0]),{processId:ids[0],kind:'link',elementId:nodes[0],targetId:leaf},owner(ids[1]),{processId:ids[1],kind:'link',elementId:nodes[1],clear:true}]};
await call('/preview',{...request,choices:[]},undefined,422);
await call('/preview',{...request,choices:[{...owner(ids[0]),unitId:'unknown'}]},undefined,422);
await call('/preview',{...request,choices:ids.map((id,i)=>({processId:id,kind:'link',elementId:nodes[i],targetId:ids[1-i]}))},undefined,422);
await call('/preview',{...request,ownerId:'injected'},undefined,400);
const original=ids.map(id=>fs.readFileSync(path.join(data,id+'.bpmn'))),contexts=ids.map(id=>fs.readFileSync(path.join(data,'Drafts',id+'.context.json')));
const plan=await call('/preview',request);assert.equal(plan.changes.length,4);
contexts.forEach((bytes,i)=>assert.deepEqual(fs.readFileSync(path.join(data,'Drafts',ids[i]+'.context.json')),bytes));
await call('/apply',{request,proof:'bad'},undefined,422);
const result=await call('/apply',{request,proof:plan.proof});assert.ok(result.items.every(i=>i.status==='Updated'));assert.ok(fs.existsSync(path.join(data,'Backups',result.backupFileName)));
for(let i=0;i<ids.length;i++){
  assert.deepEqual(fs.readFileSync(path.join(data,ids[i]+'.bpmn')),original[i]);assert.deepEqual(fs.readFileSync(path.join(data,'Drafts',ids[i]+'.bpmn')),original[i]);
  const c=JSON.parse(fs.readFileSync(path.join(data,'Drafts',ids[i]+'.context.json')));assert.equal(c.ownerUnitId,unit.unitId);assert.equal(c.elements[nodes[i]].linkedProcessId,i===0?leaf:null);
}
assert.equal((await call()).items.length,0);
await call('/apply',{request,proof:plan.proof},undefined,422);
fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({checks,updated:result.items.length,backup:result.backupFileName},null,2));console.log('Draft repairs HTTP checks passed: '+checks);
