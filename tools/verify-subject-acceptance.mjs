import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, {recursive:true});
const folder = fs.mkdtempSync(path.join(artifacts, 'subject-acceptance-'));
const temp = path.join(folder, 'temp');
fs.mkdirSync(temp);
const frontend = 'frontend/process-navigator-ui';
const version = JSON.parse(fs.readFileSync(path.join(root, frontend, 'package.json'), 'utf8')).version;
function git(...args) {
  const result = spawnSync('git', args, {cwd:root, encoding:'utf8', windowsHide:true});
  if (result.status !== 0) throw new Error('Cannot identify source tree: git ' + args.join(' '));
  return result.stdout.trim();
}
const report = {version, commit:git('rev-parse','HEAD'), dirty:Boolean(git('status','--porcelain')),
  startedAt:new Date().toISOString(), synthetic:true, status:'running', stages:[]};
const save = () => fs.writeFileSync(path.join(folder,'report.json'), JSON.stringify(report,null,2)+'\n');
const stages = [
  ['api-build','dotnet',['build','backend/ProcessNavigator.Api','-c','Release']],
  ['ui-build','pnpm',['--dir',frontend,'build']],
  ['client',process.execPath,['--test',...fs.readdirSync(path.join(root,frontend,'tests'))
    .filter(name=>name.endsWith('.test.mjs')).sort().map(name=>path.join(frontend,'tests',name))]],
  // The master-data suite already runs all server checks and captures their log.
  ['master-data',process.execPath,['tools/verify-master-data.mjs']],
  ...(process.platform==='win32'?[['offline-package','powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','tools/verify-offline-package.ps1']]]:[]),
  ['browser',process.execPath,['tools/verify-core-flow-browser.mjs']],
];
save();
for (const [id, command, args] of stages) {
  const log = path.join(folder,id+'.log');
  const fd = fs.openSync(log,'wx');
  const started = Date.now();
  console.log('Running '+id+'…');
  let result;
  try {
    const pnpmShim = process.platform==='win32' && command==='pnpm';
    // Windows pnpm is a command shim. No user paths or arguments enter this command.
    result = spawnSync(pnpmShim ? 'pnpm --dir frontend/process-navigator-ui build' : command,
      pnpmShim ? [] : args,{cwd:root,windowsHide:true,stdio:['ignore',fd,fd],shell:pnpmShim,
      env:{...process.env,TEMP:temp,TMP:temp,TMPDIR:temp}});
  } finally {
    fs.closeSync(fd);
  }
  const passed = result.status===0 && !result.error;
  report.stages.push({id,status:passed?'passed':'failed',exitCode:result.status,signal:result.signal,
    error:result.error?.message,durationMs:Date.now()-started,log:id+'.log'});
  if (!passed) {
    report.status='failed';
    process.exitCode=1;
    console.error('Failed: '+id+'; see '+log);
    break;
  }
  save();
}
if (report.status==='running') report.status='passed';
report.finishedAt=new Date().toISOString();
save();
console.log(report.status+': '+path.join(folder,'report.json'));
