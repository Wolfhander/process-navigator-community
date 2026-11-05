import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const spec=JSON.parse(fs.readFileSync(path.join(root,'master-data/provenance-fixture.json'),'utf8'));
const folder=fs.mkdtempSync(path.join(root,'artifacts/provenance-http-')),data=path.join(folder,'Data');
for(const [name,text]of createDemoContour().files){const p=path.join(data,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
const probe=net.createServer();await new Promise((r,j)=>{probe.once('error',j);probe.listen(0,'127.0.0.1',r);});
const port=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+port;
const fd=fs.openSync(path.join(folder,'server.log'),'wx');
const server=spawn('dotnet',[path.join(root,'backend/ProcessNavigator.Api/bin/Release/net9.0/ProcessNavigator.Api.dll'),'--contentRoot',folder,'--urls',origin],
  {cwd:folder,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,ASPNETCORE_ENVIRONMENT:'Development'}});
fs.closeSync(fd);let startupError;server.on('error',e=>{startupError=e;});let checks=0;
const report={result:'FAIL'};
try{
  let ready=false;for(let n=0;n<100;n++){if(startupError)throw startupError;try{if((await fetch(origin+'/api/session')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready);
  const bytes=fs.readFileSync(path.join(root,spec.source));
  const headers={'X-Process-Navigator-User':'demo-superadministrator'};
  async function call(url,body,status=200,user=headers['X-Process-Navigator-User']){
    const res=await fetch(origin+url,{method:body?'POST':'GET',headers:{...headers,'X-Process-Navigator-User':user,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
    assert.equal(res.status,status,url);checks++;return status===200?res.json():null;
  }
  const model=await call('/api/processes/'+spec.processId);
  const edgeId=model.edges.find(e=>e.sourceId===spec.elementId).id;
  const citation={status:spec.status,statement:spec.statement,locator:spec.locator,author:spec.author};
  const base={processId:spec.processId,draft:false,name:'Учебное основание',kind:'passport',documentVersion:'1',citation};
  const targets=[base,{...base,elementId:spec.elementId},{...base,edgeId},{...base,elementId:spec.elementId,objectId:spec.objectId}];
  const original=fs.readFileSync(path.join(data,spec.processId+'.context.json')),saved=[];
  for(const target of targets){
    const preview=await call('/api/source-materials/preview',target);
    const body=new FormData();body.set('file',new Blob([bytes]),path.basename(spec.source));body.set('target',JSON.stringify({...target,expectedFingerprint:preview.fingerprint}));
    const result=await call('/api/source-materials',body);saved.push(result.material);
    assert.equal(result.material.target.citation.author,spec.author);assert.equal(result.material.uploadedBy,'demo-superadministrator');
    assert.equal(result.material.target.citation.statement,spec.statement);
    assert.equal((await call('/api/source-materials/'+result.material.id+'/check')).state,'matches');
    assert.equal((await call('/api/source-materials',body)).created,false);
  }
  assert.equal(new Set(saved.map(x=>x.id)).size,4);
  await call('/api/source-materials/preview',{...base,edgeId:'missing'},422);
  await call('/api/source-materials/preview',{...base,edgeId,elementId:spec.elementId},422);
  await call('/api/source-materials/preview',{...base,citation:{...citation,status:'verified-by-system'}},422);
  await call('/api/source-materials/preview',{...base,citation:{...citation,statement:' '}},422);
  await call('/api/source-materials/preview',{...base,citation:{...citation,locator:'x'.repeat(301)}},422);
  await call('/api/source-materials/preview',{...base,citation:{...citation,execute:'shell'}},400);
  await call('/api/source-materials/preview',base,403,'demo-employee');
  const old={...base,citation:undefined,name:'Старый формат'};
  const oldPreview=await call('/api/source-materials/preview',old),form=new FormData();
  form.set('file',new Blob([bytes]),'legacy.md');form.set('target',JSON.stringify({...old,expectedFingerprint:oldPreview.fingerprint}));
  const legacy=(await call('/api/source-materials',form)).material,metadata=path.join(data,'SourceMaterials',legacy.id,'metadata.json');
  const record=JSON.parse(fs.readFileSync(metadata,'utf8'));delete record.target.edgeId;delete record.target.edgeName;delete record.target.citation;
  fs.writeFileSync(metadata,JSON.stringify(record));assert.equal((await call('/api/source-materials/'+legacy.id+'/check')).state,'matches');
  const file=path.join(data,'SourceMaterials',saved[2].id,'content.bin'),damaged=Buffer.from(bytes);damaged[0]^=1;
  fs.writeFileSync(file,damaged);
  assert.equal((await call('/api/source-materials/'+saved[2].id+'/check')).state,'unavailable');
  const blocked=await fetch(origin+'/api/source-materials/'+saved[2].id+'/content',{headers});assert.equal(blocked.status,422);checks++;
  fs.writeFileSync(file,bytes);
  fs.renameSync(file,file+'.missing');
  try{await call('/api/source-materials/'+saved[2].id+'/check',undefined,422);assert.equal((await call('/api/source-materials')).unreadable,1);}
  finally{fs.renameSync(file+'.missing',file);}
  const changed=JSON.parse(original);changed.passport.scope+=' Учебное изменение.';
  fs.writeFileSync(path.join(data,spec.processId+'.context.json'),JSON.stringify(changed));
  assert.equal((await call('/api/source-materials/'+saved[2].id+'/check')).state,'historical');
  fs.writeFileSync(path.join(data,spec.processId+'.context.json'),original);
  const privateTarget={...base,draft:true};await call('/api/processes/'+spec.processId+'/draft',{});
  const privatePreview=await call('/api/source-materials/preview',privateTarget),privateForm=new FormData();
  privateForm.set('file',new Blob([bytes]),'private.md');privateForm.set('target',JSON.stringify({...privateTarget,expectedFingerprint:privatePreview.fingerprint}));
  const privateId=(await call('/api/source-materials',privateForm)).material.id;
  await call('/api/source-materials/'+privateId+'/check',undefined,403,'demo-employee');
  assert.equal((await call('/api/source-materials',undefined,200,'demo-employee')).materials.some(m=>m.id===privateId),false);
  assert.deepEqual(fs.readFileSync(path.join(data,spec.processId+'.context.json')),original);
  report.result='PASS';report.scopes=['process','step','edge','document'];report.legacy=true;report.integrity=true;report.checks=checks;
  console.log('Provenance HTTP PASS: '+checks+' calls; '+folder);
}catch(error){report.error=error.message;throw error;}
finally{fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));if(server.exitCode===null)server.kill();}
