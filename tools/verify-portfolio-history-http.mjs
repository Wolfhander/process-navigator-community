import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=process.argv[2];
assert.equal(origin,'http://127.0.0.1:5087','Use the isolated master-data server only.');
async function call(path,user='demo-superadministrator',body){
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'X-Process-Navigator-User':user,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();return {status:response.status,data:text?JSON.parse(text):null};
}
const catalog=await call('/api/processes');
assert.deepEqual(catalog.data.map(p=>p.id).sort(),['md-design','md-documentation','md-drawing','md-engineering','md-order']);
const current=(await call('/api/analytics/portfolio')).data;
assert.equal(current.totalProcesses,5);
const saved=await call('/api/analytics/history','demo-superadministrator',{name:'HTTP-контроль истории',expectedData:current});
assert.equal(saved.status,200);assert.equal(saved.data.data.averageReadinessPercent,100);
assert.equal((await call('/api/analytics/history','demo-superadministrator',{name:'HTTP-контроль истории',expectedData:current})).data.id,saved.data.id);
assert.equal((await call('/api/analytics/history/'+saved.data.id,'demo-analyst')).status,404);
assert.deepEqual((await call('/api/analytics/history','demo-analyst')).data,[]);
assert.equal((await call('/api/analytics/history','demo-employee')).status,403);
assert.equal((await call('/api/analytics/history','demo-employee',{name:'Запрет',expectedData:current})).status,403);
assert.equal((await call('/api/analytics/history/not-a-guid')).status,400);
assert.equal((await call('/api/analytics/history','demo-superadministrator',{name:'',expectedData:current})).status,400);
assert.equal((await call('/api/analytics/history','demo-superadministrator',{name:'Устаревший',expectedData:{...current,totalProcesses:6}})).status,400);
assert.equal((await call('/api/analytics/history/'+saved.data.id)).data.fingerprint,saved.data.fingerprint);
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({status:'passed',scenarios:10,snapshotId:saved.data.id,checkedAt:new Date().toISOString()},null,2));
console.log('History HTTP checks passed: 10 scenarios (permissions, owner isolation, retry, stale screen, validation, readback).');
