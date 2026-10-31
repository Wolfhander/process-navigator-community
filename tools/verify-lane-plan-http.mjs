import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createDemoContour} from './reset-demo-contour.mjs';
const root=process.cwd(),folder=path.join(root,'artifacts/lane-plan-http-20261031'),server=path.join(folder,'server'),data=path.join(server,'Data');
const id='demo-showcase-l3-warehouse';
if(process.argv[2]==='prepare'){
  assert.ok(!fs.existsSync(folder),'Do not overwrite fixtures.');
  for(const [name,text]of createDemoContour().files){const p=path.join(data,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
  fs.mkdirSync(path.join(data,'Drafts'));
  const context=JSON.parse(fs.readFileSync(path.join(data,id+'.context.json')));context.status='Draft';context.version='1.1';
  fs.writeFileSync(path.join(data,'Drafts',id+'.context.json'),JSON.stringify(context));
  const xml=fs.readFileSync(path.join(data,id+'.bpmn'),'utf8').replace(/(<bpmn:lane\b[^>]*\bname=")[^"]*"/g,'$1Старое имя"');
  fs.writeFileSync(path.join(data,'Drafts',id+'.bpmn'),xml);
  console.log(server);process.exit(0);
}
assert.equal(process.argv[2],'http://127.0.0.1:5088');
const origin=process.argv[2],endpoint=origin+'/api/admin/organization/sync-draft-lanes';let count=0;
async function call(body,user='demo-superadministrator',status=200){
  const response=await fetch(endpoint,{method:body===undefined?'GET':'POST',headers:{'X-Process-Navigator-User':user,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(response.status,status);count++;return status===200?response.json():undefined;
}
await call(undefined,'demo-employee',403);
await call({organizationRevision:'bad',selected:[]},'demo-employee',403);
const published=fs.readFileSync(path.join(data,id+'.bpmn'));
const before=fs.readFileSync(path.join(data,'Drafts',id+'.bpmn'));
const plan=await call();assert.equal(plan.items.length,1);assert.ok(plan.items[0].changes.length>0);
assert.deepEqual(fs.readFileSync(path.join(data,'Drafts',id+'.bpmn')),before);
await call({organizationRevision:plan.organizationRevision,selected:[]},undefined,422);
const selected=plan.items.map(i=>({processId:i.processId,fingerprint:i.fingerprint}));
await call({organizationRevision:'bad',selected},undefined,422);
await call({organizationRevision:plan.organizationRevision,selected:[{...selected[0],fingerprint:'forged'}]},undefined,422);
const result=await call({organizationRevision:plan.organizationRevision,selected});
assert.equal(result.report.updatedProcesses,1);assert.ok(fs.existsSync(path.join(data,'Backups',result.backupFileName)));
assert.deepEqual(fs.readFileSync(path.join(data,id+'.bpmn')),published);
assert.equal((await call()).items[0].changes.length,0);
await call({organizationRevision:plan.organizationRevision,selected},undefined,422);
fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({checks:count,backup:result.backupFileName,updated:result.report.updatedProcesses},null,2));
console.log('Lane plan HTTP checks passed: '+count);
