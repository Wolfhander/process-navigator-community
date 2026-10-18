import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const origin='http://127.0.0.1:5087';
const headers={'X-Process-Navigator-User':'demo-superadministrator'};
const response=await fetch(origin+'/api/analytics/organization',{headers});assert.equal(response.status,200);
const report=await response.json();assert.equal(report.processCount,5);assert.equal(report.rows.length,6);
assert.equal(report.rows.reduce((sum,r)=>sum+r.taskCount,0),7);assert.equal(report.rows.reduce((sum,r)=>sum+r.ownedProcessCount,0),5);
assert.ok(report.rows.every(r=>r.overdueCount===null));
assert.equal(report.unmappedTaskCount+report.unmappedOwnershipCount+report.unmappedTransferCount,0);
for(const user of ['demo-employee','no-such-user']){const denied=await fetch(origin+'/api/analytics/organization',{headers:{'X-Process-Navigator-User':user}});assert.equal(denied.status,403);}
if(process.argv[2]){const csv=await readFile(process.argv[2],'utf8');assert.equal(csv.trim().split('\r\n').length,3);assert.ok(csv.includes('md-a-plan'));assert.ok(csv.includes('md-a-control'));assert.ok(!csv.includes('md-b-design'));assert.ok(csv.includes('Нет данных'));}
await writeFile('artifacts/master-acceptance/department-heatmap-actual.json',JSON.stringify(report,null,2));
console.log('Heatmap HTTP: six units, exact source totals, no false zero, denied profiles and browser CSV PASS.');
