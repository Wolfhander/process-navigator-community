import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const directory=path.join(root,'artifacts','master-data',stamp+'-'+process.pid);
fs.mkdirSync(directory,{recursive:true});
const coverage=JSON.parse(fs.readFileSync(path.join(root,'master-data','v1','coverage.json'),'utf8'));
const phases=[
  ['frontend',process.execPath,['--test','--test-reporter=spec','tests/masterData.test.mjs'],path.join(root,'frontend','process-navigator-ui')],
  ['server','dotnet',['run','--no-restore','--project','backend/ProcessNavigator.Checks','--configuration','Release'],root],
  ['registry',process.execPath,['tools/verify-registry-control.mjs',path.join(directory,'registry-actual.json')],root],
  ['analytics',process.execPath,['tools/verify-analytics-workspace.mjs',directory],root]
];
const outcomes=[];
const passed=new Set();
for(const [name,command,args,cwd]of phases){
  const result=spawnSync(command,args,{cwd,encoding:'utf8',env:{...process.env,PN_MASTER_REPORT_DIR:directory},maxBuffer:8*1024*1024,timeout:180000});
  const output=(result.stdout??'')+'\n'+(result.stderr??'');
  fs.writeFileSync(path.join(directory,name+'.log'),output);
  if(result.status===0)for(const match of output.matchAll(/\[master-data:([a-z-]+)\] PASS/g))passed.add(match[1]);
  outcomes.push({phase:name,status:result.status===0?'passed':'failed',exitCode:result.status,error:result.error?.message});
  console.log(name+': '+outcomes.at(-1).status);
}
const checks=[...new Set(coverage.cases.flatMap(item=>item.checks))].map(id=>({id,status:passed.has(id)?'passed':'not-passed'}));
const inputFiles=[];
function visit(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const full=path.join(directory,entry.name);
    if(entry.isDirectory())visit(full);
    else if(entry.isFile())inputFiles.push({path:path.relative(root,full).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')});
  }
}
visit(path.join(root,'master-data','v1'));
const inputsFingerprint=crypto.createHash('sha256').update(JSON.stringify(inputFiles.sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex');
const report={schemaVersion:1,synthetic:true,checkedAt:new Date().toISOString(),status:checks.every(check=>check.status==='passed')&&outcomes.every(item=>item.status==='passed')?'passed':'failed',inputsFingerprint,inputFiles,outcomes,checks,
  manualAcceptance:{basis:coverage.acceptanceBasis,evidence:coverage.manualEvidence,repeatedByThisRun:false},
  coverage:coverage.cases.map(item=>({roadmap:item.roadmap,automated:item.checks.every(id=>passed.has(id))?'passed':'not-passed',remaining:item.remaining})),
  limitations:['Синтетические данные не заменяют предметную приёмку предприятия.','Браузерная визуальная проверка и проверка страниц печати этим запуском не выполнялись.','Сформированные XLSX проверены импортом программы; отображение и пересчёт в Microsoft Excel не проверялись.']};
fs.writeFileSync(path.join(directory,'verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:checks.length,report:path.join(directory,'verification.json')}));
if(report.status!=='passed')process.exitCode=1;
