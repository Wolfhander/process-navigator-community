import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),folder=path.join(root,'artifacts/import-recipes-http-20261031'),server=path.join(folder,'server'),data=path.join(server,'Data');
const processId='demo-showcase-l3-warehouse',contextPath=path.join(data,processId+'.context.json');
if(process.argv[2]==='prepare'){
  assert.ok(!fs.existsSync(folder),'Never overwrite acceptance data.');
  for(const [name,text]of createDemoContour().files){const target=path.join(data,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);}
  const context=JSON.parse(fs.readFileSync(contextPath));context.passport.scope='Isolated import recipes '+randomUUID();fs.writeFileSync(contextPath,JSON.stringify(context,null,2));
  console.log('Prepared: '+server);process.exit(0);
}
const origin=process.argv[2];assert.equal(origin,'http://127.0.0.1:5087');
const actor='demo-superadministrator',headers={'X-Process-Navigator-User':actor};let checks=0;
const context=JSON.parse(fs.readFileSync(contextPath));assert.ok(context.passport.scope.startsWith('Isolated import recipes '));
assert.equal((await(await fetch(origin+'/api/processes/'+processId,{headers})).json()).passport.scope,context.passport.scope);
await fetch(origin+'/api/session',{headers});
function domain(){const records=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(!['ImportRecipes','Keys','Audit'].includes(e.name))walk(p);}else records.push([path.relative(data,p),createHash('sha256').update(fs.readFileSync(p)).digest('hex')]);}}walk(data);return JSON.stringify(records.sort());}
const before=domain(),bytes=fs.readFileSync(path.join(root,'artifacts/reference-queue/references-input.xlsx'));
const rules=[{kind:'entity',value:'ghost-org',scope:'',targetId:'plant'},{kind:'unit',value:'ghost-unit',scope:'plant',targetId:'1.2.5'},{kind:'user',value:'ghost-user',scope:'',targetId:'demo-employee'},{kind:'system',value:'ghost-system',scope:'',targetId:'1С:ERP'},{kind:'object',value:'ghost-object',scope:'',targetId:'demo-receipt-inspection'},{kind:'document',value:'ghost-document',scope:'',targetId:'demo-receipt-inspection'}];
async function call(suffix='',body,user=actor,status=200){
  const response=await fetch(origin+'/api/import-recipes'+suffix,{method:body===undefined?'GET':'POST',headers:{'X-Process-Navigator-User':user,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
  assert.equal(response.status,status,suffix);checks++;if(status!==200)return;
  assert.equal(response.headers.get('cache-control'),'no-store');
  return response.headers.get('content-type')?.includes('application/json')?response.json():Buffer.from(await response.arrayBuffer());
}
function form(config,revision){const form=new FormData();if(config)form.set('config',JSON.stringify(config));if(revision)form.set('expectedRevision',String(revision));form.append('files',new Blob([bytes]),'source.xlsx');form.append('files',new Blob([bytes]),'source.xlsx');return form;}
await call('',undefined,'demo-employee',403);
await call('',form({name:'Denied',rules}),'demo-employee',403);
await call('',form({name:'Injected',rules,ownerId:'forged'}),actor,422);
const recipe=await call('',form({name:'Weekly source set',rules}));
await call('',form({name:recipe.name,rules}),actor,422);
assert.equal(recipe.ownerId,actor);assert.equal(recipe.batches[0].files.length,2);
assert.equal((await call('',undefined,'demo-administrator')).recipes.length,0);
const batch=recipe.batches[0],file=batch.files[0],filePath='/'+recipe.id+'/batches/'+batch.id+'/files/'+file.id;
assert.deepEqual(await call(filePath),bytes);
await call(filePath,undefined,'demo-administrator',404);
await call('/'+recipe.id+'/batches/'+batch.id+'/preview',{expectedRevision:1},'demo-administrator',404);
const report=await call('/'+recipe.id+'/batches/'+batch.id+'/preview',{expectedRevision:1});
assert.ok(report.files.every(f=>f.state==='ready'&&f.appliedRules===6&&f.errorCount===0));
const result=await call(filePath+'/prepared',{expectedRevision:1,fingerprint:report.files[0].fingerprint});
await call(filePath+'/prepared',{expectedRevision:1,fingerprint:'stale'},actor,422);
fs.writeFileSync(path.join(folder,'prepared.xlsx'),result);
const next=await call('/'+recipe.id+'/batches',form(undefined,1));assert.equal(next.revision,2);
await call('/'+recipe.id+'/batches',form(undefined,1),actor,422);
await call(filePath+'/prepared',{expectedRevision:1,fingerprint:report.files[0].fingerprint},actor,422);
const second=await call('/'+recipe.id+'/batches/'+next.batches.at(-1).id+'/preview',{expectedRevision:2});assert.ok(second.files.every(f=>f.state==='ready'));
const incomplete=await call('',form({name:'Incomplete mapping',rules:rules.filter(r=>r.kind!=='unit')}));
const pending=await call('/'+incomplete.id+'/batches/'+incomplete.batches[0].id+'/preview',{expectedRevision:1});assert.equal(pending.files[0].state,'needsMapping');
await call('/'+incomplete.id+'/batches/'+incomplete.batches[0].id+'/files/'+incomplete.batches[0].files[0].id+'/prepared',{expectedRevision:1,fingerprint:pending.files[0].fingerprint},actor,422);
assert.equal(domain(),before,'Source sets and previews do not mutate models or dictionaries');
fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({status:'passed',checks,recipeId:recipe.id,batches:next.batches.length,filesPerBatch:2,sourceSha256:createHash('sha256').update(bytes).digest('hex')},null,2));
console.log('Import recipe HTTP checks passed: '+checks);
