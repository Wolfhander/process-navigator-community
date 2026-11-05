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
const reconciliationSpec=JSON.parse(fs.readFileSync(path.join(root,'master-data/reconciliation-fixture.json'),'utf8'));
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
organization.crossCompanyProcesses.push({...affiliation,processId:spec.id+'-error-end'});
fs.writeFileSync(path.join(data,'organization.json'),JSON.stringify(organization));
const bpmn=source.replaceAll(spec.sourceModel,spec.id);
// Untrusted imported metadata must never bypass the normal publication workflow.
const context={version:'9.9',status:'Published',owner:sourceContext.owner,ownerLegalEntityId:sourceContext.ownerLegalEntityId,
  ownerUnitId:sourceContext.ownerUnitId,laneOrganizations:sourceContext.laneOrganizations,
  passport:{level:4,purpose:spec.name,trigger:'Получено учебное задание',result:'Учебный чертёж выпущен',
    sourceRequirements:[{id:reconciliationSpec.browserRequirementId,text:reconciliationSpec.browserText,source:'TRACE-001',locator:'раздел 2',elementIds:spec.steps.slice(0,2),checkSequence:true}]},
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
  const request=()=>fetch(origin+url,{method,headers:{'X-Process-Navigator-User':user,...(body instanceof FormData?{}:body?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  let response=await request();
  // Only observational polling can retry a transient read during a file swap.
  // Keep every occurrence in the report; never retry business writes.
  for(let attempt=0;method==='GET'&&status===200&&response.status===503&&attempt<3;attempt++){
    (report.transientReads??=[]).push({url,status:503,attempt:attempt+1,detail:await response.text()});
    await new Promise(resolve=>setTimeout(resolve,50));response=await request();
  }
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
    let point;
    // Wait for reload/async layout, but never retry the business click itself.
    for(let n=0;n<100;n++){
      point=await run("(async()=>{const e=("+expression+");if(!e||e.disabled||e.closest('[inert]'))return null;e.scrollIntoView({behavior:'instant',block:'center',inline:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(!e.isConnected)return null;const r=e.getBoundingClientRect();const p={x:r.x+r.width/2,y:r.y+r.height/2};const hit=document.elementFromPoint(p.x,p.y);return hit===e||e.contains(hit)?p:null;})()");
      if(point)break;await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(point,'Click target remained absent or obstructed');
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
    await run("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");const setter=Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");};
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
  stage='baseline';
  const planRequest={rootProcessId:spec.id,direction:'Forward',anchorDate:spec.anchorDate,utcOffsetMinutes:spec.utcOffsetMinutes};
  const calculation=await api('/api/processes/schedule',planRequest);
  assert.equal(calculation.complete,true);
  const calculated=calculation.processes.find(p=>p.processId===spec.id);
  const update={request:planRequest,expectedStartAt:calculated.startAt,expectedEndAt:calculated.endAt,
    expectedVersion:instances[0].processVersion,previousPlanId:null,reason:'Первоначальный учебный план',expectedSources:calculation.sources};
  const planUrl='/api/processes/'+spec.id+'/instances/'+instanceId+'/schedule-plans';
  const executionBefore=JSON.stringify(instances[0]);
  const initialPlan=await api(planUrl,update);
  await api(planUrl,update,422); // stale PreviousPlanId
  await api(planUrl,{...update,previousPlanId:initialPlan.id,expectedVersion:'other'},422);
  const replacement=await api(planUrl,{...update,previousPlanId:initialPlan.id,reason:'Уточнение учебного плана'});
  const history=await api(planUrl);assert.equal(history.length,2);assert.equal(history[0].id,initialPlan.id);
  assert.equal(history[1].id,replacement.id);
  assert.equal(JSON.stringify((await api('/api/processes/'+spec.id+'/instances'))[0]),executionBefore);
  assert.equal((await api(planUrl+'/check')).status,'Current');
  check('Baseline assigned/replaced; stale and wrong version rejected; history and execution unchanged');
  stage='execution';
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
  stage='plan-fact';
  await api(planUrl,{...update,previousPlanId:replacement.id},422);
  await clickText(instances[0].name);
  await click('.execution-item .execution-history summary','load baseline in execution list');
  await wait("!!document.querySelector('.plan-fact-report table')",'baseline fact comparison');
  const comparisonText=await run("document.querySelector('.plan-fact-report').textContent");
  assert.ok(comparisonText.includes('Назначенный базовый план'));assert.ok(comparisonText.includes('Завершено'));
  assert.ok(comparisonText.includes(replacement.id));
  const downloads=path.join(folder,'downloads');fs.mkdirSync(downloads);
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await clickText('Выгрузить план / факт CSV');
  const csvFile=path.join(downloads,'plan-fact-'+instanceId+'.csv');
  for(let n=0;n<100&&!fs.existsSync(csvFile);n++)await new Promise(r=>setTimeout(r,50));
  assert.ok(fs.existsSync(csvFile),'Browser comparison CSV was not downloaded');
  const csv=fs.readFileSync(csvFile,'utf8');assert.ok(csv.includes(instanceId)&&csv.includes(replacement.id)&&csv.includes('Уточнение учебного плана'));
  assert.equal((await api(planUrl)).length,2);
  await call('Emulation.setDeviceMetricsOverride',{width:360,height:1000,deviceScaleFactor:1,mobile:false});
  await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  assert.equal(await run("(()=>{const e=document.querySelector('.plan-fact-report');return e.scrollWidth<=e.clientWidth+1})()"),true);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  const factShot=await call('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(folder,'plan-fact.png'),Buffer.from(factShot.data,'base64'));
  check('Completed baseline comparison and actual CSV download; finished instance cannot be replanned');
  await clickText('← Вернуться');
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
  stage='provenance';
  const provenance=JSON.parse(fs.readFileSync(path.join(root,'master-data/provenance-fixture.json'),'utf8'));
  const sourceFile=path.join(upload,'provenance.md');fs.copyFileSync(path.join(root,provenance.source),sourceFile);
  const linkedEdge=(await api('/api/processes/'+spec.id)).edges.find(e=>e.sourceId===spec.steps[0]).id;
  await navigate('page=sourceMaterials');await wait("!!document.querySelector('.source-fields')",'source materials page');
  await set('select[aria-label="Процесс"]',spec.id);
  await wait("!!document.querySelector('select[aria-label=\"Переход схемы\"] option[value=\""+linkedEdge+"\"]')",'edge source target');
  await set('select[aria-label="Переход схемы"]',linkedEdge);
  const sourceDoc=await call('DOM.getDocument'),sourceInput=await call('DOM.querySelector',{nodeId:sourceDoc.root.nodeId,selector:'.source-fields input[type=file]'});
  await call('DOM.setFileInputFiles',{nodeId:sourceInput.nodeId,files:[sourceFile]});
  await set('input[aria-label="Название"]','Основание перехода — учебный прогон');
  await set('select[aria-label="Статус основания"]','fact');
  await set('textarea[aria-label="Содержание основания"]',provenance.browserStatement);
  await set('input[aria-label="Место в источнике"]',provenance.browserLocator);
  await set('input[aria-label="Автор сведений"]',provenance.author);
  await clickText('Проверить привязку');await clickText('Сохранить оригинал');
  await wait("!!document.querySelector('.source-citation')",'saved source citation');
  assert.ok((await run("document.querySelector('.source-citation').textContent")).includes(provenance.browserLocator));
  const materials=(await api('/api/source-materials')).materials;assert.equal(materials.length,1);
  assert.equal(materials[0].target.edgeId,linkedEdge);assert.equal(materials[0].target.citation.statement,provenance.browserStatement);
  await clickText('Сверить с моделью');await wait("document.querySelector('.source-list').textContent.includes('SHA-256 совпадает')",'original integrity check');
  const sourceShot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(folder,'provenance.png'),Buffer.from(sourceShot.data,'base64'));
  await clickText('Открыть модель');await wait("!!document.querySelector('.edges .is-focused')",'source transition navigation');
  check('Browser creates cited transition source, verifies original SHA-256 and opens focused edge');
  stage='reconciliation';
  await navigate('page=evidenceRegister');await wait("!!document.querySelector('.evidence-filters')",'evidence register');
  await set('.evidence-filters label:nth-child(2) select','requirements');
  await set('.evidence-filters label:nth-child(4) select',spec.id);
  await clickText('Предметная сверка пункта');
  await wait("!!document.querySelector('.reconciliation-review select')",'manual reconciliation page');
  await set('select[aria-label="Оригинал для подтверждения"]',materials[0].id);
  await set('textarea[aria-label="Причина сверки"]','Проверен раздел 2 TRACE-001: смысл передачи оценён вручную.');
  await clickText('Подтвердить сверку по оригиналу');
  await wait("document.querySelector('.reconciliation-review').textContent.includes('Есть ручное подтверждение снимка')",'confirmed source reconciliation');
  const reviewUrl='/api/processes/'+spec.id+'/requirements/'+reconciliationSpec.browserRequirementId+'/reviews';
  let reviewed=await api(reviewUrl);assert.equal(reviewed.state,'reviewed');assert.equal(reviewed.history[0].material.id,materials[0].id);
  const reviewShot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(folder,'reconciliation.png'),Buffer.from(reviewShot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:360,height:1000,deviceScaleFactor:1,mobile:false});
  await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  assert.equal(await run("(()=>{const e=document.querySelector('.reconciliation-review');return e.scrollWidth<=e.clientWidth+1})()"),true);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await set('textarea[aria-label="Причина сверки"]','Учебный отзыв: требуется повторная оценка условия.');
  await clickText('Отозвать подтверждение');
  await wait("document.querySelector('.reconciliation-review').textContent.includes('Подтверждение отозвано')",'withdrawn reconciliation');
  reviewed=await api(reviewUrl);assert.equal(reviewed.state,'withdrawn');assert.equal(reviewed.history.length,2);
  await clickText('← Источники и вопросы');await clickText('Предметная сверка пункта');
  await wait("document.querySelector('.reconciliation-review').textContent.includes('Подтверждение отозвано')",'reopened reconciliation journal');
  check('Browser records/withdraws/reopens exact source requirement review with server-persisted history');
  stage='outcomes';
  await navigate('process='+spec.id);await wait("!!document.querySelector('.canvas')",'execution outcome source diagram');
  await clickText('Выполнения');await set('.execution-start input','Учебное закрытие по ошибке');await clickText('Запустить');
  await wait("!document.querySelector('.execution-start')",'new failure example');
  const failure=(await api('/api/processes/'+spec.id+'/instances')).find(i=>i.name==='Учебное закрытие по ошибке');
  const firstName=(await api('/api/processes/'+spec.id)).nodes.find(n=>n.id===spec.steps[0]).name;
  await click('.node[aria-label='+JSON.stringify(firstName)+']','failure step');
  await clickText('Начать шаг');
  await api('/api/processes/'+spec.id+'/instances/'+failure.id+'/steps/'+spec.steps[0]+'/result',{resultText:'Промежуточный результат сохранён',objectIds:[]},200,spec.user,'PUT');
  await clickText(failure.name);await clickText('Закрыть с ошибкой');
  await set('.execution-lifecycle-form textarea','Учебная ошибка: прекращаем выполнение с сохранением результатов.');
  await clickText('Подтвердить');
  await wait("document.querySelector('.execution-list').textContent.includes('Незавершённые ветви остановлены')",'failure closure summary');
  const closed=(await api('/api/processes/'+spec.id+'/instances')).find(i=>i.id===failure.id);
  assert.equal(closed.status,'Cancelled');assert.equal(closed.outcome.kind,'Error');
  assert.equal(closed.steps[0].resultText,'Промежуточный результат сохранён');assert.equal(closed.outcome.unfinishedElementIds.length,4);
  await api('/api/processes/'+spec.id+'/instances/'+failure.id+'/steps/'+spec.steps[0],{status:'Completed'},422,spec.user,'PUT');
  const closureShot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(folder,'outcomes.png'),Buffer.from(closureShot.data,'base64'));
  await call('Page.reload');await wait("!!document.querySelector('.canvas')",'outcome model reload');await clickText('Выполнения');
  await wait("document.querySelector('.execution-list').textContent.includes('Учебная ошибка:')",'persisted error outcome');
  const specialId=spec.id+'-error-end';
  const specialForm=new FormData();
  specialForm.set('bpmnFile',new Blob([bpmn.replaceAll(spec.id,specialId).replace('</bpmn:endEvent>','<bpmn:errorEventDefinition id="error_end"/></bpmn:endEvent>')]),'special.bpmn');
  specialForm.set('contextFile',new Blob([JSON.stringify(context)]),'special.context.json');
  await api('/api/processes/import',specialForm,201);
  await api('/api/processes/'+specialId+'/draft/workflow/submit',{comment:'Учебная проверка специального события'});
  for(let n=0;n<10;n++){if((await api('/api/processes/'+specialId+'/draft/workflow')).status==='Approved')break;await api('/api/processes/'+specialId+'/draft/workflow/approve',{comment:'Учебное согласование'});}
  await api('/api/processes/'+specialId+'/publish',{});
  assert.equal((await api('/api/processes/'+specialId)).nodes.find(n=>n.type==='endEvent').endEventDefinitions,'errorEventDefinition');
  await api('/api/processes/'+specialId+'/instances',{name:'Не должен запуститься'},422);
  check('Browser error closure preserves facts; reopen persists outcome; special BPMN end rejects execution');
  assert.ok(fs.existsSync(path.join(data,spec.id+'.bpmn')),'First publication has its own file');
  assert.ok(fs.existsSync(path.join(data,specialId+'.bpmn')),'Second publication has its own file');
  await api('/api/processes/not-present/bpmn',undefined,404);
  await api('/api/processes/not-present',undefined,404,spec.user,'DELETE');
  assert.equal((await api('/api/processes/'+spec.id)).id,spec.id);
  assert.equal((await api('/api/processes/'+specialId)).id,specialId);
  check('Sequential import/publication preserves both identities; absent read/delete cannot address another model');
  assert.deepEqual(browser.errors,[],'Browser runtime errors after source workflow');
  report.result='PASS';console.log('Core flow browser/API PASS: '+report.checks.length+' groups; '+folder);
} catch(error){
  report.result='FAIL';report.stage=stage;report.error=error.message;
  if(browser){try{report.page=await browser.run('document.body.innerText.slice(0,1200)');}catch{}}
  throw error;
} finally {
  fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));
  await browser?.close();if(server.exitCode===null)server.kill();
}
