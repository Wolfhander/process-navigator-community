import {useState} from 'react';
import {scheduleScenarioOptions} from './schedule-scenario-options';
import type {ProcessModel,InformationObject,ScheduleIterationPlan} from './types';
import './schedule-iterations.css';

export function ScheduleIterationEditor({models,objects,value,transfers,blocked,disabled,onChange}:{
 models:ProcessModel[];objects:InformationObject[];value:Record<string,ScheduleIterationPlan[]>;transfers:Record<string,'Batch'|'PerPass'>;
 blocked:boolean;disabled:boolean;onChange:(plans:Record<string,ScheduleIterationPlan[]>,transfers:Record<string,'Batch'|'PerPass'>)=>void;
}){
 const [modelId,setModelId]=useState(''),[query,setQuery]=useState('');
 const model=models.find(m=>m.id===modelId)??models[0],plans=model?value[model.id]??[]:[];
 const options=model?scheduleScenarioOptions(model):{returns:[],limited:false};
 const update=(next:ScheduleIterationPlan[])=>{
  if(!model)return;const copy={...value};if(next.length)copy[model.id]=next;else delete copy[model.id];
  onChange(copy,Object.keys(copy).length?transfers:{});
 };
 const patch=(index:number,change:Partial<ScheduleIterationPlan>)=>update(plans.map((p,i)=>i===index?{...p,...change}:p));
 const relevant=objects.filter(o=>o.producers.some(p=>o.consumers.some(c=>c.processId!==p.processId))&&
   (!query||[o.id,o.name].join(' ').toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))));
 return <details className="schedule-scenario schedule-iteration-editor"><summary>Несколько и вложенные повторные участки</summary>
 <p>Новый режим разворачивает отдельные проходы. Первый проход уже учтён; числа ниже — дополнительные. Вложенный участок повторяется заново при каждом входе во внешний. Норматив связанного подпроцесса остаётся нормативом родительского шага; схема детализации открывается отдельно.</p>
 <p>До 8 участков на процесс, 16 в цепочке, глубина 6 и суммарно 10 000 узлов. Допускаются отдельные или строго вложенные участки с одним входом/выходом; пересекающиеся циклы и внутренние AND отклоняются.</p>
 {blocked&&<p role="alert">Сначала уберите прежние простые повторы и вероятностные исходы XOR. Новые распределения повторов рассчитываются отдельно.</p>}
 <fieldset disabled={disabled||blocked}><legend>Участки и числа проходов</legend>
 <label>Процесс<select className="iteration-process" value={model?.id??''} onChange={e=>setModelId(e.target.value)}>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
 {model&&<label>Добавить возврат<select className="iteration-add" value="" disabled={plans.length>=8||Object.values(value).flat().length>=16} onChange={e=>{if(e.target.value)update([...plans,{returnEdgeId:e.target.value,plannedRepeats:1,maximumRepeats:1}]);}}>
 <option value="">Выберите возвратную стрелку</option>{options.returns.filter(e=>!plans.some(p=>p.returnEdgeId===e.id)).map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select></label>}
 {!model&&<p>Схемы появятся после первого расчёта.</p>}{options.limited&&<p role="alert">Список кандидатов ограничен; сервер проверяет структуру выбранных участков полностью.</p>}
 {plans.map((plan,index)=><article className="iteration-plan" data-return={plan.returnEdgeId} key={plan.returnEdgeId}><header><strong>{options.returns.find(e=>e.id===plan.returnEdgeId)?.label??plan.returnEdgeId}</strong><button onClick={()=>update(plans.filter((_,i)=>i!==index))}>Удалить участок</button></header>
 <div className="iteration-fields"><label>План дополнительных проходов<input className="iteration-planned" data-return={plan.returnEdgeId} type="number" min={0} max={50} step={1} value={plan.plannedRepeats} onChange={e=>patch(index,{plannedRepeats:Number(e.target.value)})}/></label>
 <label>Предел дополнительных проходов<input className="iteration-maximum" data-return={plan.returnEdgeId} type="number" min={0} max={50} step={1} value={plan.maximumRepeats} onChange={e=>patch(index,{maximumRepeats:Number(e.target.value)})}/></label></div>
 <label><input className="iteration-distribution-toggle" type="checkbox" checked={!!plan.distribution?.length} onChange={e=>patch(index,{distribution:e.target.checked?[{repeats:plan.plannedRepeats,probability:1}]:undefined})}/>Распределение числа дополнительных проходов</label>
 {!!plan.distribution?.length&&<><p>Сумма {(plan.distribution.reduce((s,w)=>s+w.probability,0)*100).toFixed(6)}%. План выше не является средним. Одна выбранная величина применяется одинаково при каждом входе во вложенный участок, не выбирается независимо заново.</p>
 {plan.distribution.map((weight,wi)=><div className="iteration-weight" key={wi}><label>Дополнительные проходы<input className="iteration-weight-count" type="number" min={0} max={plan.maximumRepeats} step={1} value={weight.repeats} onChange={e=>patch(index,{distribution:plan.distribution!.map((w,i)=>i===wi?{...w,repeats:Number(e.target.value)}:w)})}/></label><label>Вероятность, %<input className="iteration-weight-probability" type="number" min={0} max={100} step="any" value={Number((weight.probability*100).toPrecision(12))} onChange={e=>patch(index,{distribution:plan.distribution!.map((w,i)=>i===wi?{...w,probability:Number(e.target.value)/100}:w)})}/></label><button disabled={plan.distribution!.length===1} onClick={()=>patch(index,{distribution:plan.distribution!.filter((_,i)=>i!==wi)})}>Убрать исход</button></div>)}
 <button disabled={plan.distribution.length>=51} onClick={()=>patch(index,{distribution:[...plan.distribution!,{repeats:0,probability:0}]})}>Добавить исход</button></>}
 </article>)}
 </fieldset>
 {!!Object.keys(value).length&&<fieldset disabled={disabled}><legend>Межпроцессные передачи</legend><p>При затронутых повторением передачах режим обязателен. «Полный комплект» передаёт все проходы пакетом; «По номеру прохода» требует одинакового числа проходов источника и получателя во всех рассчитываемых сценариях. Процессы планируются с барьером полного завершения производителя, не в потоковом режиме. Это не факт приёмки и не автоматический запуск.</p>
 <label>Найти документ<input value={query} onChange={e=>setQuery(e.target.value)}/></label>
 {relevant.slice(0,200).map(o=><label key={o.id}>{o.name} · {o.id}<select className="iteration-transfer" data-object={o.id} value={transfers[o.id]??''} onChange={e=>{const next={...transfers};if(e.target.value)next[o.id]=e.target.value as 'Batch'|'PerPass';else delete next[o.id];onChange(value,next);}}>
 <option value="">Не задан</option><option value="Batch">Полный комплект после всех проходов</option><option value="PerPass">По порядковому номеру прохода</option></select></label>)}
 {relevant.length>200&&<p>Первые 200 из {relevant.length}; уточните поиск.</p>}</fieldset>}
 </details>;
}
