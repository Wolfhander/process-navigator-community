import {readFileSync,writeFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
async function compile(name,params){
  const transformed=await transformWithOxc(read('../src/'+name+'.tsx'),name+'.tsx',{jsx:{runtime:'classic'}});
  const code=transformed.code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
  return new Function(...Object.keys(params),code+';return '+name+';')(...Object.values(params));
}
const Page=await compile('WorkspaceToolPage',{React:{createElement},useRef:()=>({current:null}),useEffect(){}});
const assignments={processId:'test',lanes:[{laneId:'one',laneName:'УправлениеСопровожденияКонтрольныхИспытаний'.repeat(2),userIds:[]}],
  users:Array.from({length:4},(_,i)=>({id:'u'+i,displayName:'СотрудникСОченьДлиннымИменемБезПробелов'.repeat(2),position:'Специалист по проверке технической документации '+i}))};
const params={React:{createElement},WorkspaceToolPage:Page,useState:v=>[v,()=>{}],useEffect(){},createPortal:v=>v,document:{body:{}},
  ...Object.fromEntries(['AlertTriangle','Save','UserRound','Users','X'].map(name=>[name,()=>null]))};
const Assignment=await compile('AssignmentDialog',params);
const html=renderToStaticMarkup(createElement(Assignment,{assignments,onClose(){},onSaved(){}}));
const css=read('../src/styles.css')+'\n'+read('../src/workspace-tool-page.css');
const width=Number(process.argv[3]);
if(![360,1440].includes(width))throw Error('Choose 360 or 1440.');
const inner=`<!doctype html><meta charset="utf-8"><style>${css}</style>${html}<script>
const main=document.querySelector('.workspace-tool-page'),shell=document.querySelector('.workspace-tool-shell'),lanes=document.querySelector('.assignment-lanes');
const width=main.scrollWidth<=main.clientWidth+1;
const names=[...document.querySelectorAll('.assignment-users strong')].every(e=>e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1);
const height=lanes.scrollHeight<=lanes.clientHeight+1;
const report=document.createElement('p');report.textContent=(width&&names&&height?'PASS':'FAIL')+' · '+innerWidth+' px · страница '+width+' · имена '+names+' · высота '+height;
shell.prepend(report);
</script>`;
const escape=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
writeFileSync(process.argv[2],`<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe style="border:0;width:${width}px;height:100vh" srcdoc="${escape(inner)}"></iframe>`,{flag:'wx'});
