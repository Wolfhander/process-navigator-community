import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsCsv,analyticsPresetKey,defaultAnalyticsSelection,readAnalyticsPresets,writeAnalyticsPresets,selectAnalyticsProcesses} from '../src/analytics-workspace.ts';
const chosen={...defaultAnalyticsSelection,metrics:['readiness'],query:'md-order',view:'processes'};
const preset={id:'view-1',name:'Мой срез',selection:chosen};
const process=(id)=>({id,name:'Название '+id,status:'Published',owner:'Владелец',legalEntities:['Компания'],directions:['Основные'],level:0,laneCount:1,mappedLaneCount:1,taskCount:2,describedTaskCount:2,timedTaskCount:2,systemTaskCount:2,manualTaskCount:0,externalTaskCount:0,systems:['PLM'],informationObjectCount:1,informationIssueCount:0,crossLaneTransferCount:0,totalInstances:0,activeInstances:0,averageCycleMinutes:null,overdueSteps:0,readinessPercent:100,issues:[]});
const data={totalProcesses:2,averageReadinessPercent:100,totalDepartments:0,participatingDepartments:0,totalInstances:0,overdueSteps:0,informationIssueCount:0,crossLaneTransferCount:0,processes:[process('md-order'),process('md-other')]};
function parseCsv(value){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=1;i<value.length;i++){
    const c=value[i];
    if(c==='"'){if(quoted&&value[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===';'&&!quoted){row.push(cell);cell='';}
    else if(c==='\r'&&value[i+1]==='\n'&&!quoted){row.push(cell);rows.push(row);row=[];cell='';i++;}
    else cell+=c;
  }
  assert.equal(quoted,false);return rows;
}
test('named views roundtrip independently by profile and never mutate the input',()=>{
  const values=new Map();const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  assert.notEqual(analyticsPresetKey('a'),analyticsPresetKey('b'));
  assert.equal(writeAnalyticsPresets(storage,analyticsPresetKey('a'),[preset]),'');
  const loaded=readAnalyticsPresets(storage,analyticsPresetKey('a'));
  assert.deepEqual(loaded.presets,[preset]);assert.equal(loaded.error,'');
  loaded.presets[0].selection.metrics.push('coverage');
  assert.deepEqual(preset.selection.metrics,['readiness']);
  assert.deepEqual(readAnalyticsPresets(storage,analyticsPresetKey('b')).presets,[]);
});
test('corruption, unknown values, duplicates, limits and denied storage are explicit',()=>{
  for(const value of ['bad',JSON.stringify({schemaVersion:2,presets:[]}),JSON.stringify({schemaVersion:1,presets:[preset,preset]}),
    JSON.stringify({schemaVersion:1,presets:[{...preset,selection:{...chosen,metrics:['__proto__']}}]}),
    JSON.stringify({schemaVersion:1,presets:[{...preset,selection:{...chosen,query:'x'.repeat(301)}}]})]){
    let writes=0;const result=readAnalyticsPresets({getItem:()=>value,setItem:()=>writes++},'key');
    assert.ok(result.error);assert.equal(writes,0);
  }
  assert.ok(readAnalyticsPresets({getItem:()=>{throw Error('denied');}},'key').error);
  assert.ok(writeAnalyticsPresets({setItem:()=>{throw Error('quota');}},'key',[preset]));
  assert.ok(writeAnalyticsPresets({setItem:()=>assert.fail('no write')},'key',Array.from({length:21},(_,i)=>({...preset,id:'p-'+i,name:'P'+i}))));
});
test('selection uses ID and all filters without rewriting model data',()=>{
  assert.deepEqual(selectAnalyticsProcesses(data,'md-order','all').map(p=>p.id),['md-order']);
  for(const filter of ['attention','documents','timing','draft','execution'])assert.equal(selectAnalyticsProcesses(data,'',filter).length,0);
  assert.equal(data.processes.length,2);
});
test('selected CSV and portfolio totals have explicit separate scope and all source rows',()=>{
  const selected=parseCsv(analyticsCsv(data,chosen,'processes','2026-10-18T09:00:00Z'));
  assert.ok(selected.every(row=>row.length===11));
  assert.equal(selected[1][8],'1');
  assert.ok(selected.slice(2).every(row=>row[4]==='md-order'));
  assert.ok(selected.some(row=>row[6]==='averageCycleMinutes'&&row[8]==='нет данных'));
  assert.ok(selected.some(row=>row[6]==='totalInstances'&&row[8]==='0'));
  const global=parseCsv(analyticsCsv(data,chosen,'portfolio','2026-10-18T09:00:00Z'));
  assert.equal(global[1][8],'2');
  assert.ok(global.some(row=>row[6]==='readiness'&&row[8]==='100'));
  assert.ok(!global.some(row=>row[6]==='coverage'));
  assert.ok(global.some(row=>row[4]==='md-other'));
  assert.ok(global.slice(1).every(row=>row[3]==='не применяется'));
});
test('CSV protects formulas, quotes, separators and newlines; empty list remains explicit',()=>{
  const copy=structuredClone(data);copy.processes[0].name=' =1+1;"текст"\nстрока';
  const rows=parseCsv(analyticsCsv(copy,{...chosen,query:''},'processes','2026-10-18T09:00:00Z'));
  assert.equal(rows[2][5],"' =1+1;\"текст\"\nстрока");
  const empty=parseCsv(analyticsCsv(copy,{...chosen,query:'missing'},'processes','2026-10-18T09:00:00Z'));
  assert.equal(empty.length,2);assert.equal(empty[1][8],'0');
  assert.throws(()=>analyticsCsv(data,chosen,'bad','now'));
});
test('large export does not truncate source rows or process count',()=>{
  const large={...data,processes:Array.from({length:600},(_,i)=>process('p-'+i))};
  const rows=parseCsv(analyticsCsv(large,{...chosen,query:''},'processes','2026-10-18T09:00:00Z'));
  assert.equal(rows[1][8],'600');assert.ok(rows.some(row=>row[4]==='p-599'));
  assert.equal(new Set(rows.slice(2).map(row=>row[4])).size,600);
});
