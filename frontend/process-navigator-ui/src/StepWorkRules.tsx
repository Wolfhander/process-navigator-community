import type { InformationObjectBinding, StepWorkRule } from './types';

export function StepWorkRulesView({rules}:{rules?:StepWorkRule[]}) {
  if(!rules?.length)return <p>Требования к состояниям документов и правила исключений не заполнены.</p>;
  return <section><h3>Требования и исключения</h3><p>Это правила инструкции, не автоматическая проверка фактического состояния документа и не команда перехода по BPMN.</p>
    {rules.map((rule,index)=><article className="collection-card" key={index}>
      {rule.kind==='document'?<><strong>Требование к документу · {rule.objectId}</strong><p>Требуемое состояние: {rule.requiredState}</p></>:<><strong>Если возникло отклонение</strong><p>Условие: {rule.condition}</p><p>Что сделать: {rule.response}</p></>}
      {rule.kind==='document'&&rule.condition&&<p>Применяется при условии: {rule.condition}</p>}
      {rule.responsible&&<p>К кому обратиться / ответственный: {rule.responsible}</p>}
    </article>)}
  </section>;
}

export function StepWorkRulesEditor({rules,objects,onChange}:{rules:StepWorkRule[];objects:InformationObjectBinding[];onChange:(rules:StepWorkRule[])=>void}) {
  const patch=(index:number,change:Partial<StepWorkRule>)=>onChange(rules.map((rule,i)=>i===index?{...rule,...change}:rule));
  const unique=[...new Map(objects.map(object=>[object.objectId,object])).values()];
  return <section className="context-section"><h3>Требования к документам и исключения</h3>
    <p>Состояние задаётся словами вашего регламента (например, «Подписан»). Это не статус карточки реестра и не автоматическое разрешение завершить шаг. Исключение описывает действие человеку, не меняя стрелки схемы.</p>
    <button type="button" disabled={rules.length>=40||!unique.length} onClick={()=>onChange([...rules,{kind:'document',objectId:unique[0].objectId,requiredState:''}])}>Добавить требование документа</button>
    <button type="button" disabled={rules.length>=40} onClick={()=>onChange([...rules,{kind:'exception',condition:'',response:''}])}>Добавить правило исключения</button>
    {!unique.length&&<p>Сначала привяжите объект реестра к этому шагу, чтобы задать требование его состояния.</p>}
    {rules.map((rule,index)=><div className="collection-card" key={index}><strong>{rule.kind==='document'?'Требование документа':'Исключение'}</strong>
      <button type="button" onClick={()=>onChange(rules.filter((_,i)=>i!==index))}>Удалить правило {index+1}</button>
      {rule.kind==='document'?<>
        <label>Объект<select value={rule.objectId??''} onChange={event=>patch(index,{objectId:event.target.value})}>{!unique.some(object=>object.objectId===rule.objectId)&&<option value={rule.objectId??''}>Объект не привязан: {rule.objectId}</option>}{unique.map(object=><option value={object.objectId} key={object.objectId}>{object.name} · {object.objectId}</option>)}</select></label>
        <label>Требуемое состояние<input maxLength={200} required value={rule.requiredState??''} onChange={event=>patch(index,{requiredState:event.target.value})}/></label>
      </>:null}
      <label>{rule.kind==='document'?'Условие применения (необязательно)':'Если / условие отклонения'}<textarea maxLength={1000} required={rule.kind==='exception'} value={rule.condition??''} onChange={event=>patch(index,{condition:event.target.value})}/></label>
      {rule.kind==='exception'&&<label>Что сделать<textarea maxLength={2000} required value={rule.response??''} onChange={event=>patch(index,{response:event.target.value})}/></label>}
      <label>К кому обратиться / ответственный<input maxLength={200} value={rule.responsible??''} onChange={event=>patch(index,{responsible:event.target.value})}/></label>
    </div>)}
    <p>До 40 правил. Пустой список явно удаляет правила; существующие свободные инструкции сохраняются отдельно.</p>
  </section>;
}
