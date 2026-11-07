import {useState} from 'react';
import {updateWaitEvent} from './api';
import type {ProcessNode,ProcessInstance,StepExecution,WaitEventSpec} from './types';
import './wait-events.css';
const time=(s?:string)=>s?new Date(s).toLocaleString('ru-RU'):'не задан';
export function WaitEventEditor({node,value,onChange}:{node:ProcessNode;value?:WaitEventSpec;onChange:(v?:WaitEventSpec)=>void}){
 const native=node.bpmnType==='intermediateCatchEvent'||node.bpmnType==='receiveTask';
 if(value?.kind==='unsupported')return <section className="wait-definition"><h3>Неподдержанное событие</h3><p>{value.unsupportedDefinition}. Исправьте определение в BPMN; его нельзя выдать за обычное действие.</p></section>;
 const patch=(change:Partial<WaitEventSpec>)=>onChange({...value!,...change});
 return <section className="wait-definition"><h3>Ожидание сообщения или таймера</h3>
 <label><input className="wait-enabled" type="checkbox" checked={!!value} disabled={native} onChange={e=>onChange(e.target.checked?{kind:'message'}:undefined)}/>Явное ожидание (расширение контекста Process Navigator)</label>
 {value&&<><label>Тип<select className="wait-kind" value={value.kind} disabled={native} onChange={e=>onChange({kind:e.target.value as 'message'|'timer'})}><option value="message">Получение сообщения</option><option value="timer">Истечение таймера</option></select></label>
 {value.kind==='timer'?<label>Календарные минуты таймера<input className="wait-duration" type="number" min={.001} max={525600} step="any" value={value.durationMinutes??''} disabled={node.bpmnType==='intermediateCatchEvent'} onChange={e=>patch({durationMinutes:e.target.value?Number(e.target.value):undefined})}/><small>Для native BPMN-таймера длительность берётся из timeDuration; меняйте её в BPMN или таблице.</small></label>:<>
 <label>Ожидаемое сообщение<input className="wait-message" maxLength={300} value={value.messageName??''} onChange={e=>patch({messageName:e.target.value})}/></label>
 <label>Источник<input className="wait-source" maxLength={200} value={value.source??''} onChange={e=>patch({source:e.target.value})}/></label>
 <label>Канал<input className="wait-channel" maxLength={200} value={value.channel??''} onChange={e=>patch({channel:e.target.value})}/></label>
 <label>Ожидаемое время для расчёта, календарные минуты<input className="wait-expected" type="number" min={.001} max={525600} step="any" value={value.expectedMinutes??''} onChange={e=>patch({expectedMinutes:e.target.value?Number(e.target.value):undefined})}/></label>
 <label>Тайм-аут с момента начала, календарные минуты (необязательно)<input className="wait-timeout" type="number" min={.001} max={525600} step="any" value={value.timeoutMinutes??''} onChange={e=>patch({timeoutMinutes:e.target.value?Number(e.target.value):undefined})}/></label>
 <label>Ожидаемый ключ сопоставления (необязательно)<input maxLength={200} value={value.correlationKey??''} onChange={e=>patch({correlationKey:e.target.value||undefined})}/></label></>}
 {value.bpmnMessageRef&&<p>messageRef BPMN: {value.bpmnMessageRef}. Определение сохраняйте через BPMN/ZIP.</p>}
 <p>Часы календарные, включая выходные и паузы. Прогноз сообщения не является фактом получения, тайм-аут не является успехом. Внешних подписок и фонового запуска здесь нет.</p></>}
 </section>;
}
export function WaitEventPanel({processId,node,instance,step,canExecute,available,onUpdated}:{processId:string;node:ProcessNode;instance?:ProcessInstance;step?:StepExecution;canExecute:boolean;available:boolean;onUpdated?:(v:ProcessInstance)=>void}){
 const [evidence,setEvidence]=useState(''),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const saved=step?.waiting,spec=saved?.specification??node.waitEvent;if(!spec)return null;
 async function action(value:string){if(!instance||!step)return;setBusy(true);setError('');try{onUpdated?.(await updateWaitEvent(processId,instance.id,node.id,value,step.iteration,evidence||undefined,key||undefined));}catch(e){setError(e instanceof Error?e.message:'Не удалось изменить ожидание.');}finally{setBusy(false);}}
 const enabled=canExecute&&instance?.status==='Active'&&!!saved;
 return <section className="wait-panel"><h3>{spec.kind==='timer'?'Таймер':spec.kind==='message'?'Ожидание сообщения':'Неподдержанное событие'}</h3>
 {spec.kind==='unsupported'?<p role="alert">{spec.unsupportedDefinition}. Исполнение заблокировано.</p>:<>
 {spec.kind==='message'&&<p><strong>{spec.messageName??'Сообщение не указано'}</strong><br/>Источник: {spec.source??'не указан'}<br/>Канал: {spec.channel??'не указан'}<br/>Прогноз: {spec.expectedMinutes??'не задан'} мин · тайм-аут: {spec.timeoutMinutes??'нет'} мин</p>}
 {spec.kind==='timer'&&<p>Календарная длительность: {spec.durationMinutes??'не задана'} мин.</p>}
 <p>Состояние: <strong>{saved?({Pending:'Ожидание ещё не начато',Open:'Ожидаем событие',Received:'Сообщение подтверждено',Elapsed:'Таймер подтверждён',TimedOut:'Сообщение не получено в срок'})[saved.status]:'Определение модели, не факт исполнения'}</strong></p>
 {saved?.startedAt&&<p>Начало: {time(saved.startedAt)}<br/>Срок: {time(saved.dueAt)}</p>}
 {saved?.resolvedAt&&<p>Подтверждено: {time(saved.resolvedAt)} · {saved.resolvedBy}{saved.evidence&&<><br/>{saved.evidence}</>}</p>}
 {saved?.status==='TimedOut'&&<p role="alert">Следующий этап не открыт. Явно закройте выполнение с отказом/ошибкой либо верните маршрут на доработку. Это не успешное получение сообщения.</p>}
 {enabled&&saved?.status==='Pending'&&<button className="wait-begin" disabled={busy||!available} onClick={()=>action('Begin')}>Начать ожидание</button>}
 {enabled&&saved?.status==='Open'&&<fieldset disabled={busy}>
 {spec.kind==='message'?<><label>Основание фактического получения<textarea className="wait-evidence" maxLength={2000} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label><label>Ключ сообщения<input className="wait-correlation" maxLength={200} value={key} onChange={e=>setKey(e.target.value)}/></label><button className="wait-receive" disabled={evidence.trim().length<3} onClick={()=>action('Receive')}>Подтвердить получение</button>{spec.timeoutMinutes!=null&&<button className="wait-check" onClick={()=>action('CheckTimeout')}>Проверить тайм-аут</button>}</>:<button className="wait-check" onClick={()=>action('CheckTimer')}>Проверить истечение таймера</button>}
 </fieldset>}
 {instance&&!saved&&<p>В старом выполнении нет снимка ожидания; для новых правил нужно новое выполнение.</p>}
 <p>Срок начинается только после «Начать ожидание». Пауза экземпляра его не переносит. Проверка выполняется на сервере по кнопке; это не фоновая доставка или подключение к почте.</p>
 </>}{error&&<p className="wait-error" role="alert">{error}</p>}</section>;
}
