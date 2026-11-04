import {useEffect,useState} from 'react';
import {loadArchivedProcess,loadProcess} from './api';
import {ProcessRouteOverview} from './ProcessRouteOverview';
import type {ProcessModel} from './types';

export function OverviewLinkedBranch({id,ancestors,onOpen}:{id:string;ancestors:string[];onOpen:(id:string)=>void}){
  const [state,setState]=useState<{model?:ProcessModel;error?:string}>({});
  const [retry,setRetry]=useState(0);
  const [version,setVersion]=useState('');
  const [requested,setRequested]=useState('');
  const blocked=ancestors.includes(id)||ancestors.length>20;
  useEffect(()=>{
    if(blocked)return;
    const request=new AbortController();
    setState({});
    (requested?loadArchivedProcess(id,requested,request.signal):loadProcess(id,request.signal)).then(model=>{
      if(request.signal.aborted)return;
      if(model.id!==id||(requested?model.version!==requested:model.status!=='Published')){setState({error:'Выбранная редакция этой модели недоступна.'});return;}
      setState({model});
    }).catch(()=>{if(!request.signal.aborted)setState({error:'Не удалось загрузить выбранную редакцию.'});});
    return ()=>request.abort();
  },[id,blocked,retry,requested]);
  if(blocked)return <p role="status">Ветвь не раскрыта: цикл или предел глубины 20.</p>;
  return <section className="route-linked-branch">
    <label>Номер архивной редакции <input value={version} maxLength={100} placeholder="Пусто — действующая" onChange={e=>setVersion(e.target.value)}/></label>
    <button onClick={()=>{setState({});setRequested(version.trim());setRetry(n=>n+1);}}>Загрузить редакцию</button>
    {state.error?<p role="status">{state.error}</p>:!state.model?<p role="status">Загружается связанная модель…</p>:<>
      <h3>{state.model.name} · {requested?'архивная':'действующая'} {state.model.version}</h3>
      {!requested&&<button onClick={()=>onOpen(id)}>Открыть связанную схему</button>}
      <ProcessRouteOverview key={state.model.id+':'+state.model.version} process={state.model} ancestors={[...ancestors,id]} onOpenLinked={onOpen}/>
    </>}
  </section>;
}
