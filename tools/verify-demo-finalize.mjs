import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDemoContour,resetDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=path.join(root,'artifacts/demo-rebuild-20261031');
assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'roundtrip-report.json'),'utf8')).status,'passed','First complete the HTTP roundtrip and stop its server.');
const repo=path.join(folder,'repository'),data=path.join(repo,'backend/ProcessNavigator.Api/Data');
function preserved(){
  const files=[];
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else files.push([path.relative(data,file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);}}
  for(const dir of ['Users','Keys','Integrations','Templates','Backups'])if(fs.existsSync(path.join(data,dir)))walk(path.join(data,dir));
  return files.sort((a,b)=>a[0].localeCompare(b[0]));
}
assert.equal(fs.readdirSync(path.join(data,'Drafts')).filter(n=>n.endsWith('.bpmn')).length,10);
const before=preserved(),result=resetDemoContour(repo,true);
assert.deepEqual(preserved(),before);
for(const dir of ['Drafts','ImportReports','Executions','ScheduleArchive','PortfolioHistory'])assert.equal(fs.existsSync(path.join(data,dir)),false,dir);
for(const [file,content]of createDemoContour().files)assert.equal(fs.readFileSync(path.join(data,file),'utf8'),content,file);
assert.ok(fs.existsSync(path.join(result.backup,'Drafts')));
assert.ok(fs.existsSync(path.join(result.backup,'ImportReports')));
fs.writeFileSync(path.join(folder,'finalize-report.json'),JSON.stringify({status:'passed',preservedFileCount:before.length,backup:path.relative(folder,result.backup)},null,2));
console.log('Post-import reset passed: drafts/history removed, exact demo restored, preserved settings byte-identical, backup retained.');
