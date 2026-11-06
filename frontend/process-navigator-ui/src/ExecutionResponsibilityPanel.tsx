import {useEffect,useState} from 'react';
import {acceptReceipt,loadInstances,loadProcessCatalog} from './api';
import type {ProcessInstance,ProcessSummary} from './types';
import {buildResponsibilityView} from './process-responsibility';
import './execution-responsibility.css';
const statusNames:Record<string,string>={Active:'Активно',Paused:'Приостановлено',Completed:'Завершено',Cancelled:'Закрыто без успеха',NotStarted:'Не начат',InProgress:'В работе',Skipped:'Неприменим'};

export function ExecutionResponsibilityPanel({processId,canExecute=false}:{processId:string;canExecute?:boolean}){
 const [instances,setInstances]=useState<ProcessInstance[]>([]),[catalog,setCatalog]=useState<ProcessSummary[]>([]);
 const [selected,setSelected]=useState(''),[reload,setReload]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [sourceProcess,setSourceProcess]=useState(processId),[sources,setSources]=useState<ProcessInstance[]>([]),[sourceId,setSourceId]=useState(''),[sourceStepId,setSourceStepId]=useState(''),[targetStepId,setTargetStepId]=useState(''),[objectId,setObjectId]=useState(''),[version,setVersion]=useState(''),[reason,setReason]=useState('');
 const [sourceError,setSourceError]=useState(''),[sourceLoading,setSourceLoading]=useState(false);
 useEffect(()=>{setSourceProcess(processId);setSourceId('');setTargetStepId('');setReason('');},[processId]);
 useEffect(()=>{
   const controller=new AbortController();setInstances([]);setError('');setLoading(true);setSelected('');
   Promise.all([loadInstances(processId,controller.signal),loadProcessCatalog(controller.signal)]).then(([items,models])=>{
     if(controller.signal.aborted)return;setInstances(items);setCatalog(models);
   }).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
   return()=>controller.abort();
 },[processId,reload]);
 useEffect(()=>{
   const controller=new AbortController();setSources([]);setSourceId('');setSourceStepId('');setObjectId('');setSourceError('');setSourceLoading(true);
   loadInstances(sourceProcess,controller.signal).then(items=>{if(!controller.signal.aborted)setSources(items);})
     .catch(e=>{if(!controller.signal.aborted)setSourceError(e.message);}).finally(()=>{if(!controller.signal.aborted)setSourceLoading(false);});
   return()=>controller.abort();
 },[sourceProcess,reload]);
 const target=instances.find(i=>i.id===selected),snapshot=target?.responsibility,source=sources.find(i=>i.id===sourceId);
 const sourceStep=source?.steps.find(s=>s.elementId===sourceStepId),targetStep=target?.steps.find(s=>s.elementId===targetStepId);
 const sourceNode=source?.responsibility?.process.nodes.find(n=>n.id===sourceStepId);
 const outputs=(sourceNode?.informationObjects??[]).filter(b=>b.role==='Output'&&sourceStep?.resultObjects?.some(o=>o.objectId===b.objectId));
 const history=snapshot?(()=>{try{return{data:buildResponsibilityView(snapshot.process,snapshot.organization,{processId,lanes:snapshot.lanes,users:snapshot.people.map(p=>({id:p.id,displayName:p.name,isActive:p.activeAtCapture??true,role:'',roleName:'',permissions:[]}))}),error:''};}catch(e){return{data:undefined,error:e instanceof Error?e.message:'Снимок не прочитан'};}})():undefined;
 const save=async()=>{
   if(!target||!source||!sourceStep||!targetStep)return;
   setBusy(true);setError('');
   try{
     const updated=await acceptReceipt(processId,target.id,{sourceProcessId:source.processId,sourceInstanceId:source.id,sourceElementId:sourceStep.elementId,
       sourceIteration:sourceStep.iteration??1,targetElementId:targetStep.elementId,targetIteration:targetStep.iteration??1,objectId,version,reason});
     setInstances(items=>items.map(i=>i.id===updated.id?updated:i));setReason('');
   }catch(e){setError(e instanceof Error?e.message:'Не удалось записать приёмку.');}
   finally{setBusy(false);}
 };
 return <section className="instruction-card execution-responsibility"><h2>Историческая ответственность и приёмка</h2>
   <p>Выберите конкретное выполнение. Снимок фиксирует схему, оргпривязки, названия и назначения дорожек при запуске; персональные изменения показаны отдельным журналом. Он не выдаёт полномочий. Факт приёмки — ручное подтверждение профиля, не доказательство физической доставки или подпись документа. Изменение источника после приёмки не отзывает запись автоматически.</p>
   <button disabled={busy||loading} onClick={()=>setReload(v=>v+1)}>Обновить выполнения</button>
   {loading&&<p role="status">Читаем выполнения…</p>}{error&&<p role="alert">{error}</p>}
   {!loading&&!error&&instances.length===0&&<p>Выполнений пока нет.</p>}
   <label>Выполнение-получатель<select className="receipt-target-instance" disabled={busy||loading} value={selected} onChange={e=>{setSelected(e.target.value);setTargetStepId('');setError('');}}>
     <option value="">Выберите выполнение</option>{instances.map(i=><option key={i.id} value={i.id}>{i.name} · {i.processVersion} · {i.id.slice(0,8)} · {statusNames[i.status]??i.status}</option>)}
   </select></label>
   {target&&!snapshot&&<p>Старая запись без исторического снимка. Текущие справочники не подставляются; приёмка для неё недоступна.</p>}
   {snapshot&&<><h3>Снимок запуска · {new Date(snapshot.capturedAt).toLocaleString('ru-RU')} · версия {snapshot.process.version}</h3><p>Выполнение: {target?.name} · {target?.id} · процесс {processId}. Это компактный снимок структуры ответственности, не полный исходный BPMN с приложениями.</p>
     {history?.error&&<p role="alert">{history.error}</p>}
     {history?.data?.rows.slice(0,200).map(row=><article key={row.lane.id}><h4>{row.lane.name}</h4><p>{row.entity?.name??'Организация не уточнена'} / {row.unit?.name??'Подразделение не уточнено'} · {row.path.join(' → ')}</p><p>Назначения на запуске: {row.people.map(p=>p.displayName+(p.isActive?'':' (неактивен на запуске)')).join('; ')||'Не назначены'}.</p>{row.warnings.map((warning,index)=><p className="instruction-warning" key={index}>{warning}</p>)}</article>)}
     {!!history?.data&&history.data.rows.length>200&&<p>Показаны первые 200 дорожек; полный снимок сохранён в записи.</p>}
     <h3>Варианты передачи в сохранённой схеме</h3><p>Простые пути до следующего действия, не фактическое исполнение всех вариантов. Подписи не исполняются.</p>
     {history?.data?.limited&&<p className="instruction-warning">Есть цикл или достигнут предел. Перечень путей неполный.</p>}
     {history?.data?.transfers.slice(0,200).map(path=><p key={path.edgeIds.join('|')}>{snapshot.process.nodes.find(n=>n.id===path.fromId)?.name??path.fromId} → {snapshot.process.nodes.find(n=>n.id===path.toId)?.name??path.toId}: {path.labels.join(' → ')||'без подписей'} · {path.edgeIds.join(' → ')}{path.throughParallel?' · Параллельный шлюз: не выбор альтернативы':''}</p>)}
     {(history?.data?.transfers.length??0)>200&&<p>Показаны первые 200 из {history?.data?.transfers.length}; полный обход ограничен 2000 передачами.</p>}
     <h3>Индивидуальные назначения</h3>{(target?.assignmentEvents??[]).slice(0,200).map((event,i)=><p key={i}>{event.elementName}: {event.fromUserName??event.fromUserId??'не назначен'} → {event.toUserName??event.toUserId} · {event.reason} · {new Date(event.assignedAt).toLocaleString('ru-RU')}</p>)}
     {!target?.assignmentEvents?.length&&<p>Отдельных назначений не фиксировалось.</p>}
     {(target?.assignmentEvents?.length??0)>200&&<p>Показаны первые 200 событий назначений.</p>}
     <h3>Состояние и исполнитель прохода</h3><ul>{target?.steps.slice(0,200).map(step=><li key={step.elementId}>{snapshot.process.nodes.find(n=>n.id===step.elementId)?.name??step.elementId} · проход {step.iteration} · {statusNames[step.status]??step.status} · персональное назначение: {(target.assignmentEvents??[]).filter(e=>e.elementId===step.elementId&&e.toUserId===step.assignedUserId).at(-1)?.toUserName??step.assignedUserId??'не задано'} · фактически выполнил (ID профиля): {step.userId??'не зафиксирован'}</li>)}</ul>{(target?.steps.length??0)>200&&<p>Показаны первые 200 действий; остальные сохранены в выполнении.</p>}
     <h3>Подтверждённые передачи</h3>{(target?.receipts??[]).slice(0,200).map(receipt=><article className="receipt-entry" key={receipt.id}><strong>{receipt.objectId} · версия {receipt.version}</strong><p>{receipt.sourceProcessName} / {receipt.sourceInstanceId} / {receipt.sourceElementName} · проход {receipt.sourceIteration} → {receipt.targetElementName} · проход {receipt.targetIteration}</p><p>{receipt.sourceResponsible} → {receipt.targetResponsible}</p><p>{receipt.acceptedByName} · {new Date(receipt.acceptedAt).toLocaleString('ru-RU')} · {receipt.reason}</p>{target?.steps.find(s=>s.elementId===receipt.targetElementId)?.iteration!==receipt.targetIteration&&<p>Факт относится к прошлой итерации, не к текущему проходу.</p>}</article>)}
     {!target?.receipts?.length&&<p>Приёмка не подтверждалась.</p>}{(target?.receipts?.length??0)>200&&<p>Показаны первые 200 записей.</p>}
     {canExecute&&target?.status==='Active'&&<details><summary>Зафиксировать приёмку результата</summary><p>Источник — завершённый шаг с записанным выходом. Вход получателя и версия должны совпасть со снимками. Статусы шагов не изменяются; запись не является автоматической передачей в 1С.</p>
       <fieldset disabled={busy} className="receipt-form">
       <label>Процесс-источник<select className="receipt-source-process" value={sourceProcess} onChange={e=>setSourceProcess(e.target.value)}>{catalog.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
       {sourceLoading&&<p role="status">Читаем источники…</p>}{sourceError&&<p role="alert">{sourceError}</p>}
       <label>Выполнение-источник<select className="receipt-source-instance" disabled={sourceLoading||!!sourceError} value={sourceId} onChange={e=>{setSourceId(e.target.value);setSourceStepId('');setObjectId('');}}><option value="">Выберите</option>{sources.filter(i=>i.responsibility).map(i=><option key={i.id} value={i.id}>{i.name} · {i.processVersion} · {i.id.slice(0,8)}</option>)}</select></label>
       <label>Завершённый шаг-источник<select className="receipt-source-step" value={sourceStepId} onChange={e=>{setSourceStepId(e.target.value);setObjectId('');}}><option value="">Выберите</option>{source?.steps.filter(s=>s.status==='Completed'&&s.resultObjects?.length).map(s=><option key={s.elementId} value={s.elementId}>{source.responsibility?.process.nodes.find(n=>n.id===s.elementId)?.name??s.elementId} · проход {s.iteration}</option>)}</select></label>
       <label>Записанный выход<select className="receipt-object" value={objectId} onChange={e=>{setObjectId(e.target.value);setVersion(outputs.find(o=>o.objectId===e.target.value)?.version??'');}}><option value="">Выберите</option>{outputs.map(o=><option key={o.objectId} value={o.objectId}>{o.name} · {o.objectId}</option>)}</select></label>
       <label>Шаг-получатель<select className="receipt-target-step" value={targetStepId} onChange={e=>setTargetStepId(e.target.value)}><option value="">Выберите</option>{target?.steps.filter(s=>s.status==='NotStarted'||s.status==='InProgress').map(s=><option key={s.elementId} value={s.elementId}>{snapshot.process.nodes.find(n=>n.id===s.elementId)?.name??s.elementId} · проход {s.iteration}</option>)}</select></label>
       <label>Фактическая версия результата<input className="receipt-version" maxLength={100} value={version} onChange={e=>setVersion(e.target.value)}/></label>
       <label>Основание приёмки<textarea className="receipt-reason" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
       <button className="receipt-save" disabled={!sourceStep||!targetStep||!objectId||!version.trim()||reason.trim().length<3||sourceLoading||!!sourceError} onClick={save}>Подтвердить приёмку</button>
       </fieldset></details>}
   </>}
 </section>;
}
