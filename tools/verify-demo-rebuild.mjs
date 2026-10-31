import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createDemoContour,resetDemoContour} from './reset-demo-contour.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtureName=process.argv[2]??'demo-rebuild-20261031';
assert.match(fixtureName,/^[a-z0-9-]+$/,'Use a simple fixture name under artifacts.');
const folder=path.join(root,'artifacts',fixtureName);
if(fs.existsSync(folder))throw Error('Use a fresh disposable directory; existing acceptance data is not overwritten.');
const repo=path.join(folder,'repository'),data=path.join(repo,'backend/ProcessNavigator.Api/Data');
fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,'../ProcessNavigator.Api.csproj'),'<Project/>');
const expected=createDemoContour();
const first=resetDemoContour(repo,true);
const histories=['Drafts','Versions','Passports','Assignments','Executions','SchedulePlans','ScheduleArchive','PortfolioHistory','EvidenceReviews','SourceMaterials','ImportRecipes','Commands','Comments','Notifications','ImportReports','ImportSelectionSets','Artifacts','Audit'];
for(const name of histories){fs.mkdirSync(path.join(data,name),{recursive:true});fs.writeFileSync(path.join(data,name,'old-marker.json'),'{"synthetic":true}');}
fs.writeFileSync(path.join(data,'old-process.bpmn'),'<old/>');
const second=resetDemoContour(repo,true);
for(const name of histories){
  assert.equal(fs.existsSync(path.join(data,name,'old-marker.json')),false,name);
  assert.equal(fs.readFileSync(path.join(second.backup,name,'old-marker.json'),'utf8'),'{"synthetic":true}');
}
assert.equal(fs.existsSync(path.join(data,'old-process.bpmn')),false);
for(const [relative,content]of expected.files)assert.equal(fs.readFileSync(path.join(data,relative),'utf8'),content,relative);
const third=resetDemoContour(repo,true);
for(const [relative,content]of expected.files)assert.equal(fs.readFileSync(path.join(data,relative),'utf8'),content,relative);
assert.equal(fs.readdirSync(data).filter(f=>f.endsWith('.bpmn')).length,10);
fs.cpSync(path.join(root,'backend/ProcessNavigator.Api/Data/Templates'),path.join(data,'Templates'),{recursive:true});
fs.writeFileSync(path.join(folder,'rebuild-report.json'),JSON.stringify({status:'passed',models:expected.models.length,organizations:expected.organization.legalEntities.length,historyDirectories:histories,backups:[first.backup,second.backup,third.backup].map(p=>path.relative(folder,p))},null,2));
console.log('Demo rebuild passed: 10 models, exact regeneration, '+histories.length+' history directories cleaned with verified recoverable backups.');
