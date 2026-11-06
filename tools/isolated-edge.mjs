import {spawn} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

/** Own headless instance only. Does not attach to any existing browser session. */
export async function isolatedEdge(folder) {
  const profile=path.join(folder,'edge-profile');await mkdir(profile,{recursive:true});
  const child=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
    '--headless=new','--disable-gpu','--no-first-run','--disable-background-networking',
    '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let diagnostics='';child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-4000);});
  let startupError,ws;child.on('error',error=>{startupError=error;});
  try {
    let port;
    for(let n=0;n<100;n++){
      if(startupError)throw startupError;
      try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{}
      // Edge's launcher may hand off to its browser child and exit with 0.
      // Only connect to this freshly created profile's advertised port.
      if(child.exitCode!==null&&child.exitCode!==0)throw Error('Own Edge exited ('+child.exitCode+'): '+diagnostics);
      await new Promise(r=>setTimeout(r,100));
    }
    if(!port)throw Error('Own Edge did not expose its local debugging port.');
    const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let serial=0;const pending=new Map(),events=new Set(),errors=[];
    ws.onmessage=event=>{
      const message=JSON.parse(event.data);
      if(message.id){
        const item=pending.get(message.id);if(!item)return;clearTimeout(item.timer);pending.delete(message.id);
        message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result);
      }else{
        if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
        for(const listener of events)listener(message);
      }
    };
    const call=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},10000);
      pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
    });
    const run=async expression=>{
      const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);
      return response.result.value;
    };
    const wait=async(expression,label)=>{
      for(let n=0;n<100;n++){if(errors.length)throw Error(errors.join('\n'));if(await run(expression))return;await new Promise(r=>setTimeout(r,100));}
      throw Error('Timeout: '+label+'; '+await run("document.body.innerText.slice(0,700)"));
    };
    await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
    await call('Emulation.setFocusEmulationEnabled',{enabled:true});
    return {call,run,wait,errors,events,async close(){
      try{await call('Browser.close');}catch{}
      ws.close();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Browser closed'));}pending.clear();
      if(child.exitCode===null)child.kill();
    }};
  } catch(error){ws?.close();if(child.exitCode===null)child.kill();throw error;}
}
