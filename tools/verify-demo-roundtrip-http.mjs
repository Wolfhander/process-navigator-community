import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=path.join(root,'artifacts/demo-rebuild-20261031');
const origin=process.argv[2];assert.equal(origin,'http://127.0.0.1:5087','Use the disposable demo-rebuild server only.');
const headers={'X-Process-Navigator-User':'demo-superadministrator'};
async function json(route,body){
  const response=await fetch(origin+route,{method:body?'POST':'GET',headers,body});
  const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
}
function compact(value){
  if(Array.isArray(value))return value.map(compact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null&&v!==undefined&&!(Array.isArray(v)&&v.length===0)).map(([k,v])=>[k,compact(v)]));
  return value;
}
function semantic(model){
  const laneRefs=organization.crossCompanyProcesses.find(p=>p.processId===model.id)?.laneOrganizations??[];
  const nodes=model.nodes.map(node=>{
    const lane=laneRefs.find(l=>l.laneId===node.laneId);
    const unit=organization.legalEntities.find(e=>e.id===lane?.legalEntityId)?.units.find(u=>u.id===lane?.unitId);
    // The existing exporter explicitly fills missing participant fields from the exact bound lane.
    return {...node,
      participantUnitRefs:node.participantUnitRefs?.length?node.participantUnitRefs:unit?[{legalEntityId:lane.legalEntityId,unitId:unit.id}]:undefined,
      participantUnits:node.participantUnits?.length?node.participantUnits:unit?[unit.name]:undefined};
  });
  return compact({id:model.id,name:model.name,owner:model.owner,passport:model.passport,lanes:model.lanes,nodes,edges:model.edges});
}
const expected=createDemoContour().models.map(m=>m.id).sort();
const catalog=await json('/api/processes');assert.deepEqual(catalog.map(m=>m.id).sort(),expected);
const organization=await json('/api/organization');
const signatures=[];
for(const id of expected){
  const publishedFiles=['.bpmn','.context.json'].map(ext=>path.join(folder,'repository/backend/ProcessNavigator.Api/Data',id+ext));
  const publishedBytes=publishedFiles.map(file=>fs.readFileSync(file));
  const before=await json('/api/processes/'+id);
  const exported=await fetch(origin+'/api/processes/'+id+'/table-export?includeDescendants=false',{headers});
  assert.equal(exported.status,200);const bytes=await exported.arrayBuffer();
  fs.writeFileSync(path.join(folder,id+'.xlsx'),Buffer.from(bytes));
  const form=()=>{const body=new FormData();body.append('tableFile',new Blob([bytes]),id+'.xlsx');return body;};
  const preview=await json('/api/processes/table-preview',form());assert.equal(preview.canImport,true,JSON.stringify(preview.issues));
  const body=form();body.append('selectedProcessIds',id);body.append('stepIdMappings','[]');
  await json('/api/processes/table-import',body);
  const after=await json('/api/processes/'+id+'?draft=true');
  assert.deepEqual(semantic(after),semantic(before),id);
  assert.deepEqual(semantic(await json('/api/processes/'+id)),semantic(before),'Published source must not change');
  publishedFiles.forEach((file,index)=>assert.ok(fs.readFileSync(file).equals(publishedBytes[index]),'Published bytes changed: '+id));
  signatures.push({id,nodes:after.nodes.length,links:after.nodes.filter(n=>n.linkedProcessId).length,level:after.passport?.level});
}
const afterOrg=await json('/api/organization');
const refs=org=>org.crossCompanyProcesses.map(p=>({processId:p.processId,lanes:p.laneOrganizations.map(l=>({laneId:l.laneId,unitId:l.unitId,legalEntityId:l.legalEntityId})).sort((a,b)=>a.laneId.localeCompare(b.laneId))})).sort((a,b)=>a.processId.localeCompare(b.processId));
assert.deepEqual(refs(afterOrg),refs(organization));
assert.deepEqual(afterOrg.legalEntities,organization.legalEntities);
assert.equal((await json('/api/processes')).length,10);
fs.writeFileSync(path.join(folder,'roundtrip-report.json'),JSON.stringify({status:'passed',models:signatures,checkedAt:new Date().toISOString()},null,2));
console.log('Demo table roundtrip passed: all 10 models, task types, geometry, levels, references, channels and documents; published sources unchanged.');
