import {useState} from 'react';
import type {InformationObject,InformationObjectOccurrence,ProcessModel} from './types';
import {objectRouteScenario,type RouteChoices,type ObjectScheduleSeed} from './object-route-scenario';
const labels={Reachable:'Есть направленный путь',Unreachable:'Путь исключён сценарием',Unknown:'Достижимость не установлена',Unavailable:'Модель недоступна',Invalid:'Некорректный контекст',Passport:'Граница паспорта'};
export function ObjectRouteScenarioPanel({item,models,loading,onOpen,onSchedule}:{item:InformationObject;models:Record<string,ProcessModel>;loading:boolean;onOpen:(value:InformationObjectOccurrence)=>void;onSchedule?:(seed:ObjectScheduleSeed)=>void}){
  const values=[...item.producers,...item.consumers],ids=[...new Set(values.map(v=>v.processId))];
  const [selected,setSelected]=useState(ids[0]??''),[choices,setChoices]=useState<Record<string,RouteChoices>>({}),[page,setPage]=useState(0);
  const processId=ids.includes(selected)?selected:ids[0]??'',model=models[processId],current=choices[processId]??{};
  const rows=values.filter(v=>v.processId===processId),pages=Math.max(1,Math.ceil(rows.length/50)),safePage=Math.min(page,pages-1);
  const gateways=model&&model.nodes.length<=2000&&model.edges.length<=5000?model.nodes.filter(n=>n.type==='exclusiveGateway'&&model.edges.filter(e=>e.sourceId===n.id).length>1):[];
  return <section className="object-route-scenario"><h2>Условия и сценарий маршрута</h2>
    <p>Проверяются направленные пути к местам создания и получения. Внутри варианта исходы соединены «И», между вариантами — «ИЛИ». Это не исполнение процесса, не доказательство обязательности шага или наличия документа: синхронизация параллельных ветвей, свободный текст условий и повторы требуют отдельной сверки.</p>
    <label>Процесс <select value={processId} onChange={e=>{setSelected(e.target.value);setPage(0);}}>{ids.map(id=><option key={id} value={id}>{values.find(v=>v.processId===id)?.processName||id}</option>)}</select></label>
    {loading&&<p role="status">Контекст загружается…</p>}
    <details><summary>Выбрать исходы альтернативных развилок</summary><p>Без выбора остаются все исходящие ветви. Выбор не меняет модель или выполнение. Для расчёта дат явно передайте выбранные исходы в калькулятор; остальные процессы цепочки там настраиваются отдельно.</p>
      <button onClick={()=>setChoices(prev=>({...prev,[processId]:{}}))}>Сбросить исходы этого процесса</button>
      <p>Показано развилок {Math.min(gateways.length,100)} из {gateways.length}. Выбирается до 100 исходов; невыбранные развилки не отсекаются.</p>
      {gateways.slice(0,100).map(g=><label key={g.id}>{g.name||g.id} [{g.id}] <select value={current[g.id]??''} onChange={e=>{const next={...current};if(e.target.value)next[g.id]=e.target.value;else delete next[g.id];setChoices(prev=>({...prev,[processId]:next}));}}><option value="">Все исходы — сценарий не уточнён</option>{model!.edges.filter(e=>e.sourceId===g.id).map(e=><option key={e.id} value={e.id}>{e.label||'Условие ветви не указано'} [{e.id}]</option>)}</select></label>)}
    </details>
    {onSchedule&&<button disabled={!model||loading||objectRouteScenario({...rows[0],processId,scope:'Step',elementId:model?.nodes.find(n=>n.type==='startEvent')?.id},model,current).status!=='Reachable'} onClick={()=>model&&onSchedule({processId,choices:{...current},version:model.version,status:model.status})}>Открыть сценарий в калькуляторе сроков</button>}
    <p>Редакция {model?model.status+' '+model.version:'недоступна'} · строк {rows.length} · страница {safePage+1} из {pages}. Сравнение документов разных процессов выполняется раздельно, не как сквозной выбор исполнения.</p>
    {rows.slice(safePage*50,safePage*50+50).map((v,i)=>{
      const result=objectRouteScenario(v,model,current);
      return <article key={safePage*50+i}><button disabled={!model||(v.scope==='Step'&&!model.nodes.some(n=>n.id===v.elementId))} onClick={()=>onOpen(v)}>{v.direction==='Producer'?'Создание':'Получение'} · {v.elementName||'Паспорт'} [{v.elementId||processId}]</button>
        <p>{labels[result.status]}{result.limited?' · анализ неполный':''}</p><p>{v.required?(v.condition?'Обязателен при указанном условии':'Обязателен по описанию'):'Необязательный'} · версия {v.version||'не указана'}</p><p>Условие объекта: {v.condition||'не указано'}. Текст не вычисляется.</p>
        {result.messages.map((m,j)=><p key={j}>{m}</p>)}
        {result.alternatives.map((a,j)=><details key={j}><summary>Вариант {j+1} · исходов {a.conditionCount}</summary>{a.conditions.map((c,k)=><p key={k}>{c.gateway} [{c.gatewayId}] → {c.label} [{c.edgeId}]</p>)}{!a.conditionCount&&<p>На этом пути нет альтернативной развилки; это не означает обязательное исполнение.</p>}{a.conditionCount>a.conditions.length&&<p>Показаны первые 50 исходов из {a.conditionCount}.</p>}<p>Пример пути: {a.nodeIds.join(' → ')}{a.nodeCount>a.nodeIds.length?' → …':''} · всего элементов {a.nodeCount}. Одинаковые сочетания исходов объединены, показан один пример.</p></details>)}
      </article>;
    })}
    {!rows.length&&<p>Места создания и получения пока не описаны.</p>}
    <button disabled={safePage===0} onClick={()=>setPage(safePage-1)}>Предыдущие места</button><button disabled={safePage+1>=pages} onClick={()=>setPage(safePage+1)}>Следующие места</button>
  </section>;
}
