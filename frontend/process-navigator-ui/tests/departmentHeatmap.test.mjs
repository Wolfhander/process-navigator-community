import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDepartments,departmentCsv,departmentIntensity} from '../src/department-heatmap.ts';
const row=(entityId,overdueCount)=>({entityId,unitId:'same',name:'Отдел',shortName:'О',legalEntityName:entityId,processCount:1,ownedProcessCount:0,taskCount:1,incomingTransferCount:2,outgoingTransferCount:1,overdueCount,observedInstanceCount:overdueCount==null?0:2,processIds:['p'],ownedProcessIds:[]});
const report={generatedAt:'2026-10-18T12:00:00Z',processCount:1,rows:[row('a',null),row('b',0)],processes:[{id:'p',name:'Учебный чертёж'}],warnings:[],unmappedTaskCount:0,unmappedOwnershipCount:0,unmappedTransferCount:0,orphanExecutionStepCount:0};
test('filters preserve distinct entity/unit pairs, process search and original source order',()=>{
  assert.equal(selectDepartments(report,'чертёж','','name').length,2);assert.equal(selectDepartments(report,'','a','overdue').length,1);assert.equal(selectDepartments(report,'','','overdue')[0].entityId,'b');assert.equal(report.rows[0].entityId,'a');
});
test('intensity has bounded scale and does not pretend no data is a measured value',()=>{
  assert.equal(departmentIntensity(null,10),0);assert.equal(departmentIntensity(0,10),0);assert.equal(departmentIntensity(1,0),0);assert.equal(departmentIntensity(100,10),0.5);assert.ok(departmentIntensity(5,10)>departmentIntensity(1,10));
});
test('CSV distinguishes no data and actual zero and exports all filtered rows with stable IDs',()=>{
  const csv=departmentCsv(report,'','','name');assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('Нет данных'));assert.ok(csv.includes('"b";"same"'));assert.equal(csv.split('\r\n').length,3);assert.equal(departmentCsv(report,'missing','','name').split('\r\n').length,1);
});
test('CSV protects formula strings, quotes and multiline names and does not truncate screen pages',()=>{
  const data={...report,rows:Array.from({length:301},(_,i)=>({...row('a',0),unitId:'u'+i,name:'=cmd\n"test"'}))};const csv=departmentCsv(data,'','','name');assert.ok(csv.includes("'=cmd"));assert.ok(csv.includes('""test""'));assert.ok(csv.includes('u300'));assert.equal(selectDepartments(data,'','','name').length,301);
});
