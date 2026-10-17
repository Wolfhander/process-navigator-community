import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePortfolioSnapshots,portfolioTrend,snapshotCsv} from '../src/portfolio-history.ts';
const p=(id)=>({id,name:id,owner:'Владелец',status:'Published',readinessPercent:100,informationIssueCount:0,timedTaskCount:2,taskCount:2,totalInstances:0,overdueSteps:0,systems:['PLM'],legalEntities:[],directions:[],issues:[]});
const snapshot=(id,processes,time)=>({id,name:'Срез',capturedAt:time,algorithm:'v1',fingerprint:'fingerprint',data:{totalProcesses:processes.length,averageReadinessPercent:100,informationIssueCount:0,crossLaneTransferCount:0,totalInstances:0,overdueSteps:0,totalDepartments:1,participatingDepartments:1,processes}});
const a=snapshot('a',[p('same'),p('removed')],'2026-10-18T09:00:00Z');
test('history compares fixed observations, not the current catalog; absence is not zero',()=>{
  const b=snapshot('b',[{...p('same'),readinessPercent:75,name:'Новое имя',systems:['ERP']},p('added')],'2026-10-18T10:00:00Z');
  b.data.averageReadinessPercent=87.5;
  const original=JSON.stringify([a,b]);const result=comparePortfolioSnapshots(a,b);
  assert.equal(result.comparable,true);
  assert.equal(result.metrics.find(m=>m.key==='averageReadinessPercent').delta,-12.5);
  const changed=result.processes.find(p=>p.id==='same');assert.equal(changed.status,'changed');assert.equal(changed.delta,-25);
  assert.ok(changed.changes.some(text=>text.includes('Название')));
  for(const id of ['added','removed'])assert.equal(result.processes.find(p=>p.id===id).delta,null);
  assert.equal(result.processes.find(p=>p.id==='removed').after,undefined);
  assert.equal(JSON.stringify([a,b]),original);
});
test('method changes and reversed dates never produce a misleading numeric trend',()=>{
  assert.equal(comparePortfolioSnapshots(a,{...a,algorithm:'v2'}).comparable,false);
  assert.equal(comparePortfolioSnapshots(a,{...a,capturedAt:'invalid'}).comparable,false);
  const later={...a,capturedAt:'2026-10-18T11:00:00Z'};
  assert.equal(comparePortfolioSnapshots(later,a).comparable,false);
  const same=comparePortfolioSnapshots(a,a);assert.ok(same.metrics.every(m=>m.delta===0));assert.ok(same.processes.every(p=>p.status==='same'));
});
test('source CSV uses captured time and embeds snapshot identity and algorithm, not now',()=>{
  const csv=snapshotCsv(a);
  for(const text of ['2026-10-18T09:00:00Z','source_snapshotId','source_snapshotAlgorithm','fingerprint'])assert.ok(csv.includes(text));
  const hostile={...a,name:'=1+1'};assert.ok(snapshotCsv(hostile).includes('"\'=1+1"'));
});
test('comparison retains hundreds of sources for UI pagination and export',()=>{
  const many=snapshot('m',Array.from({length:600},(_,i)=>p('p-'+i)),'2026-10-18T10:00:00Z');
  assert.equal(comparePortfolioSnapshots(a,many).processes.length,602);
  assert.ok(snapshotCsv(many).includes('"p-599"'));
});
test('trend uses elapsed time, never mixes methodologies and handles coincident observations',()=>{
  const points=[{id:'a',capturedAt:'2026-10-18T09:00:00Z',algorithm:'v1',readinessPercent:100},{id:'b',capturedAt:'2026-10-18T10:00:00Z',algorithm:'v1',readinessPercent:75},{id:'c',capturedAt:'2026-10-18T13:00:00Z',algorithm:'v1',readinessPercent:80}];
  assert.deepEqual(portfolioTrend(points).map(p=>p.x),[30,155,530]);
  assert.equal(portfolioTrend([points[0],{...points[1],algorithm:'v2'}]).length,0);
  assert.equal(portfolioTrend([points[0],{...points[1],capturedAt:points[0].capturedAt}])[1].x,280);
});
test('stable IDs follow catalog case-insensitive semantics; empty portfolios remain valid',()=>{
  const upper={...a,data:{...a.data,processes:a.data.processes.map(p=>({...p,id:p.id.toUpperCase()}))}};
  assert.ok(comparePortfolioSnapshots(a,upper).processes.every(p=>p.status==='same'));
  const empty=snapshot('empty',[],'2026-10-18T08:00:00Z');
  assert.equal(comparePortfolioSnapshots(empty,a).processes.length,2);
  assert.ok(comparePortfolioSnapshots(empty,a).processes.every(p=>p.status==='added'&&p.delta===null));
});
