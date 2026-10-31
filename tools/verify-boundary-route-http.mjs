import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {createDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=fs.mkdtempSync(path.join(root,'artifacts','boundary-route-http-')),data=path.join(folder,'Data');
for(const [name,text]of createDemoContour().files){const p=path.join(data,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
const spec=JSON.parse(fs.readFileSync(path.join(root,'master-data','boundary-route-fixture.json'),'utf8'));
const base=JSON.parse(fs.readFileSync(path.join(data,'demo-showcase-l0.context.json'),'utf8'));
const binding=role=>({objectId:'doc',name:'Учебный документ',role,required:true});
function write(id,nodes,edges,level,elements){
  assert.match(id,/^[a-z-]+$/);
  const shapes=['lane',...nodes.map(n=>n[0])].map((n,i)=>'<bpmndi:BPMNShape id="shape-'+n+'" bpmnElement="'+n+'"><dc:Bounds x="'+(i*180)+'" y="0" width="160" height="100"/></bpmndi:BPMNShape>').join('');
  const xml='<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" targetNamespace="urn:synthetic:boundary"><bpmn:process id="'+id+'" name="Учебная граница '+id+'"><bpmn:laneSet id="lanes"><bpmn:lane id="lane" name="Учебное подразделение">'+nodes.map(n=>'<bpmn:flowNodeRef>'+n[0]+'</bpmn:flowNodeRef>').join('')+'</bpmn:lane></bpmn:laneSet>'+nodes.map(([n,t])=>'<bpmn:'+t+' id="'+n+'" name="'+n+'"/>').join('')+edges.map(([a,b],i)=>'<bpmn:sequenceFlow id="flow'+i+'" sourceRef="'+a+'" targetRef="'+b+'"/>').join('')+'</bpmn:process><bpmndi:BPMNDiagram id="diagram"><bpmndi:BPMNPlane id="plane" bpmnElement="'+id+'">'+shapes+edges.map((_,i)=>'<bpmndi:BPMNEdge id="edge'+i+'" bpmnElement="flow'+i+'"><di:waypoint x="0" y="0"/><di:waypoint x="180" y="0"/></bpmndi:BPMNEdge>').join('')+'</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>';
  const context={...base,version:'1.0',status:'Published',passport:{level,trigger:'Учебное начало',result:'Учебный документ',inputs:['Задание'],outputs:['Учебный документ']},elements};
  fs.writeFileSync(path.join(data,id+'.bpmn'),xml);fs.writeFileSync(path.join(data,id+'.context.json'),JSON.stringify(context,null,2));
}
for(const c of spec.cases){
  const id='boundary-'+c.id;const ns=c.nodes.map(n=>n.split('|'));
  write(id,ns,c.edges,1,{make:{informationObjects:[binding('Output')]},use:{informationObjects:[binding('Input')]}});
  write('parent-'+c.id,[['s','startEvent'],['call','task'],['z','endEvent']],[['s','call'],['call','z']],0,{call:{linkedProcessId:id,inputs:['Задание'],expectedResult:'Учебный документ',informationObjects:[binding('Output')]}});
}
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const origin='http://127.0.0.1:'+port,dll=path.join(root,'backend','ProcessNavigator.Api','bin','Release','net9.0','ProcessNavigator.Api.dll');
assert.ok(fs.existsSync(dll),'Build Release backend first.');
const log=fs.openSync(path.join(folder,'server.log'),'wx');
const server=spawn('dotnet',[dll,'--contentRoot',folder,'--urls',origin],{cwd:folder,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,ASPNETCORE_ENVIRONMENT:'Development'}});fs.closeSync(log);
let checks=0;
try{
  const headers={'X-Process-Navigator-User':'demo-superadministrator'};let ready=false;
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Acceptance server exited');try{const res=await fetch(origin+'/api/session',{headers});if(res.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
  assert.ok(ready,'Own acceptance server did not start');
  async function call(url,method='GET',user='demo-superadministrator',status=200){const res=await fetch(origin+url,{method,headers:{'X-Process-Navigator-User':user}});assert.equal(res.status,status,url);checks++;return status===200?res.json():null;}
  const map=await call('/api/processes/decomposition');
  for(const c of spec.cases){
    const link=map.links.find(l=>l.sourceProcessId==='parent-'+c.id);assert.ok(link,c.id);
    assert.equal(link.missingBoundaries.some(m=>m.includes('не подтверждён до этапа [use]')),c.unavailable);checks++;
    await call('/api/processes/parent-'+c.id+'/draft','POST');
    const report=await call('/api/processes/parent-'+c.id+'/draft/validation');
    assert.equal(report.issues.some(i=>i.code.endsWith('route-input-unavailable')),c.unavailable);
    assert.ok(report.issues.filter(i=>i.code.includes('boundary-route')).every(i=>i.severity==='Warning'&&i.elementId==='call'));checks++;
  }
  await call('/api/processes/parent-late-producer/draft/validation','GET','demo-employee',403);
  fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({checks,cases:spec.cases.map(c=>c.id),draftAccessDenied:true},null,2));
  console.log('Boundary route HTTP checks passed: '+checks+'; '+folder);
}finally{server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
