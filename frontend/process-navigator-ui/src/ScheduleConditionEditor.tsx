import {useState} from 'react';
import type {ProcessModel,ScheduleObjectRule,ScheduleBranchProbability} from './types';
import './schedule-conditions.css';

export function ScheduleConditionEditor({models,facts,rules,probabilities,branches,disabled,iterationMode=false,onChange}:{
 models:ProcessModel[];facts:Record<string,boolean>;rules:ScheduleObjectRule[];probabilities:ScheduleBranchProbability[];
 branches:Record<string,Record<string,string>>;disabled:boolean;iterationMode?:boolean;
 onChange:(facts:Record<string,boolean>,rules:ScheduleObjectRule[],probabilities:ScheduleBranchProbability[])=>void;
}){
 const [factName,setFactName]=useState(''),[modelId,setModelId]=useState(''),[query,setQuery]=useState('');
 const model=models.find(p=>p.id===modelId)??models[0],needle=query.trim().toLocaleLowerCase('ru');
 const bindings=(model?.nodes??[]).flatMap(node=>(node.informationObjects??[]).filter(b=>node.type==='task'&&(b.role==='Input'||b.role==='Output')).map(binding=>({node,binding})))
   .filter(({node,binding})=>!needle||[node.id,node.name,binding.objectId,binding.name].join(' ').toLocaleLowerCase('ru').includes(needle));
 const gateways=(model?.nodes??[]).filter(n=>n.type==='exclusiveGateway'&&(model?.edges.filter(e=>e.sourceId===n.id).length??0)>1);
 const names=Object.keys(facts);
 return <details className="schedule-scenario schedule-condition-editor"><summary>Условия объектов и вероятностные исходы</summary>
 <p>Это допущения расчёта, не факты из 1С и не изменение BPMN. Булево условие включает или исключает только выбранную передачу документа, а не действие. Текст исходного условия не исполняется. После изменения нужен пересчёт.</p>
 <fieldset disabled={disabled}><legend>Булевы факты сценария</legend><div className="condition-add"><label>Имя нового факта<input className="scenario-new-fact" maxLength={80} value={factName} onChange={e=>setFactName(e.target.value)}/></label><button className="scenario-add-fact" disabled={!factName.trim()||names.includes(factName.trim())||names.length>=100} onClick={()=>{onChange({...facts,[factName.trim()]:true},rules,probabilities);setFactName('');}}>Добавить факт</button></div>
 {names.map(name=><div className="condition-fact" key={name}><strong>{name}</strong><select aria-label={'Значение факта '+name} value={String(facts[name])} onChange={e=>onChange({...facts,[name]:e.target.value==='true'},rules,probabilities)}><option value="true">Да</option><option value="false">Нет</option></select><button disabled={rules.some(r=>r.factName===name)} title="Сначала уберите условия, использующие факт" onClick={()=>{const next={...facts};delete next[name];onChange(next,rules,probabilities);}}>Удалить</button></div>)}
 {!names.length&&<p>Факты ещё не заданы. Их имена чувствительны к регистру; выражения и скрипты не вычисляются.</p>}
 </fieldset>
 <label>Процесс для условий и вероятностей<select className="scenario-condition-process" value={model?.id??''} disabled={disabled} onChange={e=>setModelId(e.target.value)}>{models.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 {!model&&<p>Исходные схемы появятся после первого расчёта.</p>}
 {model&&<><fieldset disabled={disabled}><legend>Условия входов и выходов</legend><label>Найти шаг или документ<input value={query} onChange={e=>setQuery(e.target.value)}/></label>
 {bindings.slice(0,500).map(({node,binding})=>{
  const index=rules.findIndex(r=>r.processId===model.id&&r.elementId===node.id&&r.objectId===binding.objectId&&r.role===binding.role),rule=rules[index];
  const patch=(change:Partial<ScheduleObjectRule>)=>onChange(facts,rules.map((r,i)=>i===index?{...r,...change}:r),probabilities);
  return <article className="condition-binding" key={node.id+':'+binding.role+':'+binding.objectId}><label><input type="checkbox" disabled={!names.length} checked={!!rule} onChange={e=>onChange(facts,e.target.checked?[...rules,{processId:model.id,elementId:node.id,objectId:binding.objectId,role:binding.role as 'Input'|'Output',factName:names[0],expectedValue:true}]:rules.filter((_,i)=>i!==index),probabilities)}/>{node.name} · {binding.role==='Input'?'Вход':'Выход'}: {binding.name} · {binding.objectId}</label>
  {binding.condition&&<p>Исходный текст (не исполняется): {binding.condition}</p>}
  {rule&&<div className="condition-fields"><label>Факт<select value={rule.factName} onChange={e=>patch({factName:e.target.value})}>{names.map(name=><option key={name}>{name}</option>)}</select></label><label>Передача нужна, если<select value={String(rule.expectedValue)} onChange={e=>patch({expectedValue:e.target.value==='true'})}><option value="true">факт = Да</option><option value="false">факт = Нет</option></select></label></div>}</article>;
 })}
 {bindings.length>500&&<p>Показаны первые 500 из {bindings.length}; уточните поиск.</p>}{!bindings.length&&<p>Подходящих привязок документа к шагу нет. Границы паспорта без шага не формализуются здесь.</p>}
 </fieldset><fieldset disabled={disabled||iterationMode}><legend>Вероятностные исходы XOR</legend><p>До 8 шлюзов во всей цепочке и 64 конечных сценариев. Сумма исходов каждого шлюза — 100%. Нулевой исход исключён; минимальная положительная вероятность — 0,0001%. Вероятности условны на достигаемом шлюзе; корреляции и повторения не моделируются. Не все типы BPMN поддержаны.</p>
 {gateways.slice(0,200).map(gateway=>{
   const profile=probabilities.find(p=>p.processId===model.id&&p.gatewayId===gateway.id),edges=model.edges.filter(e=>e.sourceId===gateway.id),fixed=!!branches[model.id]?.[gateway.id];
   return <article className="condition-probability" key={gateway.id}><label><input type="checkbox" checked={!!profile} disabled={fixed||(!profile&&probabilities.length>=8)} onChange={e=>onChange(facts,rules,e.target.checked?[...probabilities,{processId:model.id,gatewayId:gateway.id,weights:edges.map(e=>({edgeId:e.id,probability:1/edges.length}))}]:probabilities.filter(p=>p!==profile))}/>{gateway.name} · {gateway.id}</label>
    {fixed&&<p>Сначала уберите ручной исход этого шлюза в «Альтернативы и повторные проходы».</p>}
    {profile&&<><p>Сумма: {(profile.weights.reduce((sum,w)=>sum+w.probability,0)*100).toFixed(6)}%</p>{profile.weights.map(weight=><label key={weight.edgeId}>{edges.find(e=>e.id===weight.edgeId)?.label||weight.edgeId} · вероятность, %<input className="scenario-probability" data-edge={weight.edgeId} type="number" min={0} max={100} step="any" value={Number((weight.probability*100).toPrecision(12))} onChange={e=>onChange(facts,rules,probabilities.map(p=>p===profile?{...p,weights:p.weights.map(w=>w.edgeId===weight.edgeId?{...w,probability:Number(e.target.value)/100}:w)}:p))}/></label>)}</>}
   </article>;
 })}{gateways.length>200&&<p>Первые 200 шлюзов; остальные задайте через исходный сценарий.</p>}{!gateways.length&&<p>В этом процессе нет разветвляющихся XOR.</p>}
 </fieldset></>}
 </details>;
}
