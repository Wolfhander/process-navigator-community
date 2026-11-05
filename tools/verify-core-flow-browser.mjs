import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoContour} from './reset-demo-contour.mjs';
import {isolatedEdge} from './isolated-edge.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const spec=JSON.parse(fs.readFileSync(path.join(root,'master-data/core-flow-fixture.json'),'utf8'));
const artifacts=path.join(root,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
const folder=fs.mkdtempSync(path.join(artifacts,'core-flow-browser-')),data=path.join(folder,'Data');
const files=createDemoContour().files;
for(const [name,text]of files){const p=path.join(data,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
const source=files.get(spec.sourceModel+'.bpmn');assert.ok(source,'Source BPMN fixture missing');
const sourceContext=JSON.parse(files.get(spec.sourceModel+'.context.json'));
const organization=JSON.parse(files.get('organization.json'));
const affiliation=organization.crossCompanyProcesses.find(p=>p.processId===spec.sourceModel);
assert.ok(affiliation,'Synthetic lane affiliations are missing');
organization.crossCompanyProcesses.push({...affiliation,processId:spec.id});
fs.writeFileSync(path.join(data,'organization.json'),JSON.stringify(organization));
const bpmn=source.replaceAll(spec.sourceModel,spec.id);
// Untrusted imported metadata must never bypass the normal publication workflow.
const context={version:'9.9',status:'Published',owner:sourceContext.owner,ownerLegalEntityId:sourceContext.ownerLegalEntityId,
  ownerUnitId:sourceContext.ownerUnitId,laneOrganizations:sourceContext.laneOrganizations,
  passport:{level:4,purpose:spec.name,trigger:'Получено учебное задание',result:'Учебный чертёж выпущен'},
  elements:Object.fromEntries(spec.steps.map(id=>[id,{description:'Учебное действие для сквозной приёмки',duration:spec.hoursPerStep+' час',
    responsible:sourceContext.elements[id]?.responsible,expectedResult:'Учебный результат',completionCriteria:'Зафиксирован результат'}]))};
for(const step of spec.steps)assert.ok(sourceContext.elements[step],step+' is missing');
const upload=path.join(folder,'input');fs.mkdirSync(upload);
const bpmnFile=path.join(upload,'process.bpmn'),contextFile=path.join(upload,'context.json');
fs.writeFileSync(bpmnFile,bpmn);fs.writeFileSync(contextFile,JSON.stringify(context));
const dist=path.join(root,'frontend/process-navigator-ui/dist'),dll=path.join(root,'backend/ProcessNavigator.Api/bin/Release/net9.0/ProcessNavigator.Api.dll');
assert.ok(fs.existsSync(path.join(dist,'index.html'))&&fs.existsSync(dll),'Build frontend and Release API before running.');
fs.cpSync(dist,path.join(folder,'wwwroot'),{recursive:true});
const probe=net.createServer();await new Promise((r,j)=>{probe.once('error',j);probe.listen(0,'127.0.0.1',r);});
const port=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+port;
const fd=fs.openSync(path.join(folder,'server.log'),'wx');
const server=spawn('dotnet',[dll,'--contentRoot',folder,'--webroot',path.join(folder,'wwwroot'),'--urls',origin],
  {cwd:folder,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,ASPNETCORE_ENVIRONMENT:'Development'}});
fs.closeSync(fd);let browser,stage='startup';const report={version:JSON.parse(fs.readFileSync(path.join(root,'frontend/process-navigator-ui/package.json'))).version,checks:[],network:[]};
server.on('error',error=>{report.serverError=error.message;});
const check=(name)=>{report.checks.push(name);};
async function api(url,body,status=200,user=spec.user,method=body?'POST':'GET'){
  const response=await fetch(origin+url,{method,headers:{'X-Process-Navigator-User':user,...(body instanceof FormData?{}:body?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  assert.equal(response.status,status,url+' '+await(response.status!==status?response.text():''));
  return response.status===200||response.status===201?response.json():null;
}
const form=()=>{const value=new FormData();value.set('bpmnFile',new Blob([bpmn]),'process.bpmn');value.set('contextFile',new Blob([JSON.stringify(context)]),'context.json');return value;};
try {
  let ready=false;for(let n=0;n<100;n++){
    if(report.serverError||server.exitCode!==null)throw Error(report.serverError??'Own API exited');
    try{if((await fetch(origin+'/api/session')).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }assert.ok(ready,'Own API not ready');
  browser=await isolatedEdge(folder);const {call,run,wait}=browser;
  const schedules=new Set(),scheduleReads=[],browserSchedules=[];
  browser.events.add(message=>{
    if(message.method==='Network.responseReceived'){
      const {url,status}=message.params.response;if(url.startsWith(origin+'/api/'))report.network.push({path:new URL(url).pathname,status});
      if(new URL(url).pathname==='/api/processes/schedule'&&status===200)schedules.add(message.params.requestId);
    }
    if(message.method==='Network.loadingFinished'&&schedules.has(message.params.requestId)){
      schedules.delete(message.params.requestId);
      scheduleReads.push(call('Network.getResponseBody',{requestId:message.params.requestId}).then(body=>browserSchedules.push(JSON.parse(body.body))));
    }
  });
  await call('Emulation.setTimezoneOverride',{timezoneId:'Europe/Moscow'});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('pn.demoUser',"+JSON.stringify(spec.user)+")"});
  const press=async(expression)=>{
    const point=await run("(()=>{const e=("+expression+");e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  };
  const click=async(selector,label)=>{await wait("!!document.querySelector("+JSON.stringify(selector)+")&&!document.querySelector("+JSON.stringify(selector)+").disabled",label);
    await press("document.querySelector("+JSON.stringify(selector)+")");};
  const clickText=async(text,selector='button')=>{
    const expression="[...document.querySelectorAll("+JSON.stringify(selector)+")].find(e=>e.textContent.trim()==="+JSON.stringify(text)+"&&!e.disabled&&!e.closest('[inert]'))";
    await wait('!!('+expression+')','button '+text);await press(expression);
  };
  const set=async(selector,value)=>{await wait('!!document.querySelector('+JSON.stringify(selector)+')',selector);
    await run("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");const setter=Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");};
  const navigate=async(hash)=>{await run('location.hash='+JSON.stringify(hash));};
  stage='import';await call('Page.navigate',{url:origin+'/#page=import'});
  await wait("!!document.querySelector('.import-page input[type=file]')",'import form');
  const doc=await call('DOM.getDocument');
  const inputs=await call('DOM.querySelectorAll',{nodeId:doc.root.nodeId,selector:'.import-page input[type=file]'});
  assert.equal(inputs.nodeIds.length,2);
  await call('DOM.setFileInputFiles',{nodeId:inputs.nodeIds[0],files:[bpmnFile]});
  await call('DOM.setFileInputFiles',{nodeId:inputs.nodeIds[1],files:[contextFile]});
  await click('.import-submit','import submit');
  await clickText('Открыть процесс');
  await wait("location.hash.includes('process="+spec.id+"')&&!!document.querySelector('.canvas')",'imported diagram');
  const draft=await api('/api/processes/'+spec.id+'?draft=true');
  assert.equal(draft.nodes.filter(n=>n.type==='task').length,spec.steps.length);
  assert.equal(draft.status,'Draft');assert.equal(draft.version,'0.1');
  assert.equal(fs.existsSync(path.join(data,spec.id+'.bpmn')),false);
  check('Browser file upload -> draft -> rendered diagram');
  const draftBpmn=path.join(data,'Drafts',spec.id+'.bpmn'),draftContext=path.join(data,'Drafts',spec.id+'.context.json');
  const originalDraft=[fs.readFileSync(draftBpmn),fs.readFileSync(draftContext)];
  await api('/api/processes/import',form(),409);await api('/api/processes/import',form(),403,'demo-employee');
  assert.deepEqual([fs.readFileSync(draftBpmn),fs.readFileSync(draftContext)],originalDraft);
  check('Duplicate import rejected (409), employee import forbidden (403)');
  const withoutContext=new FormData(),bareId=spec.id+'-without-context';
  withoutContext.set('bpmnFile',new Blob([bpmn.replaceAll(spec.id,bareId)]),'without-context.bpmn');
  const bare=await api('/api/processes/import',withoutContext,201);
  assert.equal(bare.process.status,'Draft');assert.equal(bare.process.version,'0.1');assert.equal(bare.process.hasDraft,true);
  assert.equal((await api('/api/processes/'+bareId+'?draft=true')).id,bareId);
  await api('/api/processes/import',withoutContext,409);
  check('Import without JSON also creates a readable draft; existing draft cannot be overwritten');
  stage='validation';const validation=await api('/api/processes/'+spec.id+'/draft/validation');
  report.validation=validation;
  assert.equal(validation.errorCount,0);assert.equal(validation.canPublish,true);
  await clickText('Опубликовать');
  await clickText('Отправить на согласование');
  for(let n=0;n<10;n++){
    const before=await api('/api/processes/'+spec.id+'/draft/workflow');
    if(before.status==='Approved')break;
    await clickText('Согласовать этап');
    for(let attempt=0;attempt<100;attempt++){
      const next=await api('/api/processes/'+spec.id+'/draft/workflow');
      if(next.status==='Approved'||next.currentStageIndex!==before.currentStageIndex)break;
      await new Promise(r=>setTimeout(r,50));
    }
  }
  assert.equal((await api('/api/processes/'+spec.id+'/draft/workflow')).status,'Approved');
  await clickText('← Вернуться');await clickText('Опубликовать');
  await wait("!!document.querySelector('.validation-summary.is-ready')",'publication validation');
  await clickText('Опубликовать версию');
  await wait("!!document.querySelector('.process-bar .eyebrow')&&document.querySelector('.process-bar .eyebrow').textContent.includes('Действующая')",'published edition');
  check('API validation agrees with browser publication checks; publication visible');
  stage='execution';await clickText('Выполнения');await clickText('Запустить');
  await wait("!document.querySelector('.execution-start')",'execution opened');
  let instances=await api('/api/processes/'+spec.id+'/instances');assert.equal(instances.length,1);
  const instanceId=instances[0].id;
  for(const id of spec.steps){
    await click('.node[aria-label='+JSON.stringify((await api('/api/processes/'+spec.id)).nodes.find(n=>n.id===id).name)+']','step '+id);
    await clickText('Начать шаг');await clickText('Завершить шаг');
    await wait("!document.querySelector('.context-panel button')||!([...document.querySelectorAll('.step-execution button')].some(e=>e.textContent.trim()==='Завершить шаг'))",'saved step '+id);
    // Observe persisted server state, not just a local optimistic caption.
    for(let n=0;n<100;n++){instances=await api('/api/processes/'+spec.id+'/instances');if(instances[0].steps.find(s=>s.elementId===id).status==='Completed')break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(instances[0].steps.find(s=>s.elementId===id).status,'Completed');
  }
  assert.equal(instances[0].id,instanceId);assert.equal(instances[0].status,'Completed');
  check('Browser starts instance and completes every step; API confirms Completed');
  stage='navigation';await navigate('page=catalog');
  await wait("!!document.querySelector('.process-catalog-page-content')",'catalog navigation');
  await call('Page.reload');await wait("!!document.querySelector('.process-catalog-page-content')",'catalog after reload');
  check('Catalog hash navigation survives full reload');
  stage='schedule';await navigate('page=schedule');await wait("!!document.querySelector('.schedule-form')",'schedule form');
  await set('.schedule-form select',spec.id);await set('.schedule-form input[type=datetime-local]','2026-11-09T09:00');
  await click('.schedule-run','forward calculation');await wait("!!document.querySelector('.schedule-kpis')",'forward schedule');
  assert.ok((await run("document.querySelector('.schedule-kpis').textContent")).includes('4 ч'));
  const forward=await api('/api/processes/schedule',{rootProcessId:spec.id,direction:'Forward',anchorDate:spec.anchorDate,utcOffsetMinutes:spec.utcOffsetMinutes});
  assert.equal(forward.processes.find(p=>p.processId===spec.id).durationHours,spec.expectedHours);
  assert.equal(Date.parse(forward.endAt),Date.parse(spec.expectedEnd));
  await set('.schedule-form label:nth-child(2) select','Backward');await set('.schedule-form input[type=datetime-local]','2026-11-09T13:00');
  await click('.schedule-run','backward calculation');await wait("!!document.querySelector('.schedule-results')&&document.querySelector('.schedule-results h2').textContent.includes('От результата')",'backward schedule');
  const backward=await api('/api/processes/schedule',{rootProcessId:spec.id,direction:'Backward',anchorDate:spec.expectedEnd,utcOffsetMinutes:spec.utcOffsetMinutes});
  assert.equal(Date.parse(backward.startAt),Date.parse(spec.anchorDate));assert.equal(backward.durationHours,spec.expectedHours);
  check('Browser runs both directions; API verifies 4 hours and inverse dates');
  assert.deepEqual(browser.errors,[],'Browser runtime errors');
  assert.ok(report.network.some(n=>n.path.endsWith('/import')&&n.status===201));
  assert.ok(report.network.filter(n=>n.path==='/api/processes/schedule'&&n.status===200).length>=2);
  await Promise.all(scheduleReads);
  assert.equal(browserSchedules.length,2);
  for(const value of browserSchedules){
    assert.equal(value.processes.length,1);assert.equal(value.processes[0].processId,spec.id);
    assert.equal(value.durationHours,spec.expectedHours);
    assert.equal(Date.parse(value.startAt),Date.parse(spec.anchorDate));
    assert.equal(Date.parse(value.endAt),Date.parse(spec.expectedEnd));
  }
  report.browserSchedules=browserSchedules.map(value=>({direction:value.direction,startAt:value.startAt,endAt:value.endAt,durationHours:value.durationHours}));
  const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(folder,'schedule.png'),Buffer.from(shot.data,'base64'));
  report.result='PASS';console.log('Core flow browser/API PASS: '+report.checks.length+' groups; '+folder);
} catch(error){
  report.result='FAIL';report.stage=stage;report.error=error.message;
  if(browser){try{report.page=await browser.run('document.body.innerText.slice(0,1200)');}catch{}}
  throw error;
} finally {
  fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));
  await browser?.close();if(server.exitCode===null)server.kill();
}
