// Isolated Edge instance, local static fixture only. No application/API data.
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const artifacts=resolve('artifacts'),profile=resolve(artifacts,'edge-keyboard-'+Date.now());
await mkdir(profile,{recursive:true});
const child=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=0',
  '--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws,call,run;
try {
  let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await new Promise(r=>setTimeout(r,100));}}
  if(!port)throw Error('Isolated Edge did not start.');
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let serial=0;const pending=new Map();
  ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')console.error(JSON.stringify(message.params));if(message.id){const item=pending.get(message.id);if(item){clearTimeout(item.timer);pending.delete(message.id);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result);}}};
  call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  run=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  await call('Page.enable');await call('Runtime.enable');await call('Page.navigate',{url:pathToFileURL(resolve(process.argv[2]??resolve(artifacts,'keyboard-accessibility.html'))).href});
  for(let i=0;i<100;i++){if(await run("document.readyState==='complete'&&!!document.getElementById('skip')"))break;await new Promise(r=>setTimeout(r,50));}
  const key=async(key,code,modifiers=0)=>{
    const windowsVirtualKeyCode={Tab:9,Enter:13,' ':32}[key];
    await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:key===' '?{text:' ',unmodifiedText:' '}:{})});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,windowsVirtualKeyCode});
  };
  const active=()=>run("document.activeElement.id");
  const tick=()=>run('new Promise(resolve=>setTimeout(resolve,20))');
  assert.equal(await run("typeof document.getElementById('skip').onclick"),'function','Fixture handler not installed');
  await call('Emulation.setFocusEmulationEnabled',{enabled:true});await call('Page.bringToFront');
  // Genuine browser key events, not direct calls to keyboard handlers.
  await run("document.getElementById('skip').focus()");await key('Enter','Enter');
  assert.equal(await run("document.activeElement.tagName"),'MAIN');
  await key('Tab','Tab');assert.equal(await run("document.activeElement.getAttribute('aria-label')"),'Разработать модель и чертёж');
  const scroll=await run('scrollY');await key(' ','Space');assert.equal(await run('scrollY'),scroll);
  assert.equal(await run('activations'),1);
  await key('Tab','Tab');assert.match(await run("document.activeElement.getAttribute('aria-label')"),/Развернуть/);
  // Modal opens from a real keyboard-triggered button.
  await run("document.getElementById('open').focus()");await key('Enter','Enter');await tick();
  assert.equal(await active(),'query');assert.equal(await run("document.querySelector('main').inert"),true);
  await key('Tab','Tab',8);assert.equal(await active(),'close');
  await key('Tab','Tab');assert.equal(await active(),'query');
  await key('Tab','Tab');assert.equal(await active(),'nested');
  await key('Enter','Enter');await tick();assert.equal(await active(),'innerClose');
  await key('Tab','Tab');assert.equal(await active(),'innerClose');
  await key('Enter','Enter');await tick();assert.equal(await active(),'nested');
  await run("document.getElementById('close').focus()");await key('Enter','Enter');await tick();
  assert.equal(await active(),'open');assert.equal(await run("document.querySelector('main').inert"),false);
  // Empty modal and pre-existing inert state are preserved.
  await run("document.getElementById('outside').inert=true;const empty=document.createElement('section');empty.id='empty';empty.setAttribute('role','dialog');empty.setAttribute('aria-modal','true');empty.setAttribute('aria-label','Пустой диалог');document.getElementById('portals').append(empty)");
  await tick();assert.equal(await active(),'empty');await key('Tab','Tab');assert.equal(await active(),'empty');
  await run("document.getElementById('empty').remove()");await tick();assert.equal(await run("document.getElementById('outside').inert"),true);
  // 200% CSS zoom exercises reflow of reference content (not a claim about every screen).
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await run("document.documentElement.style.zoom='2'");assert.equal(await run("document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"),true);
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await run("getComputedStyle(document.querySelector('button')).transitionDuration"),'1e-05s');
  const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(artifacts,'keyboard-accessibility-200.png'),Buffer.from(shot.data,'base64'));
  console.log('PASS: native Tab/Shift+Tab/Enter/Space; skip; SVG name; nested/empty dialog; inert restoration; reference reflow at 200%; reduced motion.');
} finally {
  if(call&&ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
  if(child.exitCode===null)child.kill();
}
