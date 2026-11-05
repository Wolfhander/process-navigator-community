import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {planFactReport,planFactCsv} from '../src/plan-fact-report.ts';
import {PlanFactComparison} from './planFactComponent.mjs';
const plan={processId:'p',startAt:'2026-11-09T06:00Z',endAt:'2026-11-09T10:00Z',isDateReliable:true};
const instance={id:'i',processId:'p',processVersion:'1',name:'Учебное выполнение',startedAt:'2026-11-09T07:00Z',status:'Completed',completedAt:'2026-11-09T11:00Z'};
const baseline={id:'baseline',processId:'p',instanceId:'i',processVersion:'1',item:plan,assignedAt:'2026-11-05T06:00Z',assignedBy:'demo',reason:'Утверждённый учебный срок'};
const now='2026-11-10T10:00Z';
test('assigned baseline uses real completion, exact instance and version; report does not mutate inputs',()=>{
  const before=JSON.stringify({plan,instance,baseline});
  const report=planFactReport(plan,instance,now,baseline);
  assert.equal(report.preliminary,false);assert.equal(report.finishDeltaHours,1);assert.equal(report.startDeltaHours,1);
  assert.equal(report.planId,'baseline');assert.equal(report.actualEnd,instance.completedAt);
  assert.equal(JSON.stringify({plan,instance,baseline}),before);
});
test('foreign instance, process, version or substituted dates cannot masquerade as assigned plan',()=>{
  for(const altered of [{instanceId:'other'},{processId:'other'},{processVersion:'other'},{item:{...plan,processId:'other'}}])
    assert.throws(()=>planFactReport(plan,instance,now,{...baseline,...altered}));
  assert.throws(()=>planFactReport({...plan,endAt:'2026-11-09T12:00Z'},instance,now,baseline));
  assert.throws(()=>planFactReport(plan,instance,'invalid',baseline));
});
test('scenario is not a baseline; unknown versions and unreliable dates stay preliminary',()=>{
  assert.equal(planFactReport(plan,instance,now,undefined,'1').planId,'');
  for(const version of [undefined,'other'])assert.equal(planFactReport(plan,instance,now,undefined,version).preliminary,true);
  assert.equal(planFactReport({...plan,isDateReliable:false},instance,now,undefined,'1').preliminary,true);
});
test('paused/active use snapshot overdue; cancellation and missing date never invent completion',()=>{
  for(const status of ['Active','Paused']){
    const report=planFactReport(plan,{...instance,status,completedAt:null},now,baseline);
    assert.equal(report.finishDeltaHours,24);assert.equal(report.actualEnd,'');
  }
  for(const value of [{...instance,status:'Cancelled'},{...instance,completedAt:null}]){
    const report=planFactReport(plan,value,now,baseline);assert.equal(report.finishDeltaHours,null);assert.equal(report.actualEnd,'');
  }
});
test('CSV carries exact identity, basis, capture date and safe spreadsheet cells',()=>{
  const report=planFactReport(plan,{...instance,name:'=SUM(1;2)'},now,{...baseline,reason:'@command'});
  const csv=planFactCsv(report);assert.ok(csv.startsWith('\ufeff'));
  assert.match(csv,/"План ID";"baseline"/);assert.match(csv,/"Выполнение ID";"i"/);
  assert.match(csv,/"'@command"/);assert.match(csv,/"'=SUM\(1;2\)"/);
  assert.ok(csv.includes(now));assert.match(csv,/"Отклонение окончания, календарные часы";"1"/);
});
test('comparison table has explicit basis, dates, missing values, status and CSV action',()=>{
  const html=renderToStaticMarkup(createElement(PlanFactComparison,{plan,instance,now,baseline}));
  assert.match(html,/Назначенный базовый план/);assert.match(html,/scope="col"/);assert.match(html,/Выгрузить план \/ факт CSV/);
  assert.match(html,/Завершено/);assert.match(html,/Утверждённый учебный срок/);
  const blocked=renderToStaticMarkup(createElement(PlanFactComparison,{plan,instance,now,baseline:{...baseline,instanceId:'foreign'}}));
  assert.match(blocked,/role="alert"/);assert.doesNotMatch(blocked,/<table/);
});
