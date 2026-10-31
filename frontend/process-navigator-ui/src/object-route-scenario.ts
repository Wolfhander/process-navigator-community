import type {InformationObjectOccurrence,ProcessModel} from './types';
export type RouteChoices=Record<string,string>;
export type ObjectScheduleSeed={processId:string;choices:RouteChoices;version:string;status:string};
export type RouteCondition={gatewayId:string;gateway:string;edgeId:string;label:string};
export type ObjectRouteResult={status:'Reachable'|'Unreachable'|'Unknown'|'Unavailable'|'Invalid'|'Passport';limited:boolean;cycle:boolean;messages:string[];alternatives:{conditions:RouteCondition[];conditionCount:number;nodeIds:string[];nodeCount:number}[]};
/** Directed structural paths, NOT token execution, document availability, or evaluation of free text. */
export function objectRouteScenario(value:InformationObjectOccurrence,model?:ProcessModel,choices:RouteChoices={},budget=20000):ObjectRouteResult{
  const result:ObjectRouteResult={status:'Unknown',limited:false,cycle:false,messages:[],alternatives:[]};
  const finish=()=>{if(result.cycle)result.messages.push('В обходе есть повтор. Показаны только простые направленные пути; число итераций и условия возврата не вычисляются.');return result;};
  if(!model||model.id!==value.processId){result.status='Unavailable';result.messages.push('Модель недоступна или не соответствует участнику.');return result;}
  if(value.scope!=='Step'){result.status='Passport';result.messages.push('Граница паспорта не привязана к этапу; маршрутная достижимость не устанавливается.');return result;}
  if(model.nodes.length>2000||model.edges.length>5000){result.limited=true;result.messages.push('Предел анализа: 2000 элементов / 5000 стрелок.');return result;}
  const nodes=new Map(model.nodes.map(n=>[n.id,n])),outgoing=new Map<string,typeof model.edges>();
  if(nodes.size!==model.nodes.length||model.nodes.some(n=>!n.id)||new Set(model.edges.map(e=>e.id)).size!==model.edges.length||model.edges.some(e=>!e.id||!nodes.has(e.sourceId)||!nodes.has(e.targetId))){
    result.status='Invalid';result.messages.push('Повторные ID, пустые ID или обрывы стрелок: анализ не выполнен.');return result;
  }
  if(!value.elementId||!nodes.has(value.elementId)){result.status='Invalid';result.messages.push('Этап участника отсутствует в модели.');return result;}
  for(const edge of model.edges){const list=outgoing.get(edge.sourceId)??[];list.push(edge);outgoing.set(edge.sourceId,list);}
  if(Object.keys(choices).length>100){result.status='Invalid';result.messages.push('Предел сценария: 100 выбранных развилок.');return result;}
  for(const [id,edge]of Object.entries(choices)){
    if(nodes.get(id)?.type!=='exclusiveGateway'||(outgoing.get(id)?.length??0)<2||!outgoing.get(id)?.some(e=>e.id===edge)){
      result.status='Invalid';result.messages.push('Выбранный исход больше не принадлежит альтернативной развилке ['+id+']. Сбросьте сценарий.');return result;
    }
  }
  const starts=model.nodes.filter(n=>n.type==='startEvent').map(n=>n.id);
  if(!starts.length){result.messages.push('Начальное событие не найдено; достижимость не подтверждена.');return result;}
  const selectedEdges=new Map([...outgoing].map(([id,es])=>[id,es.filter(e=>!Object.hasOwn(choices,id)||choices[id]===e.id)]));
  const edges=(id:string)=>selectedEdges.get(id)??[];
  let work=0;const spend=()=>{if(++work>budget){result.limited=true;return false;}return true;};
  const reached=new Set<string>(),queue=[...starts];
  for(let head=0;head<queue.length;head++){
    if(!spend()){result.status=reached.has(value.elementId)?'Reachable':'Unknown';result.messages.push('Достигнут бюджет анализа; отсутствие найденного пути не доказывает недостижимость.');return result;}
    const id=queue[head];if(reached.has(id))continue;reached.add(id);for(const e of edges(id))queue.push(e.targetId);
  }
  result.status=reached.has(value.elementId)?'Reachable':'Unreachable';
  if(result.status==='Unreachable'){result.messages.push('Направленный путь от исходных стартов не найден при выбранных исходах. Это не удаляет объект из реестра.');return result;}
  const signatures=new Set<string>(),active=new Set<string>(),path:string[]=[],conditions:RouteCondition[]=[];
  type Frame={id:string;next:number;entered:boolean;condition?:RouteCondition};
  for(const start of starts){
    const stack:Frame[]=[{id:start,next:0,entered:false}];
    const leave=()=>{const f=stack.pop()!;active.delete(f.id);path.pop();if(f.condition)conditions.pop();};
    while(stack.length){
      if(!spend()){result.messages.push('Подробности путей ограничены бюджетом анализа.');return finish();}
      const f=stack[stack.length-1];
      if(!f.entered){
        f.entered=true;active.add(f.id);path.push(f.id);if(f.condition)conditions.push(f.condition);
        if(f.id===value.elementId){
          const signature=JSON.stringify(conditions.map(c=>[c.gatewayId,c.edgeId]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0));
          if(!signatures.has(signature)){signatures.add(signature);result.alternatives.push({conditions:conditions.slice(0,50),conditionCount:conditions.length,nodeIds:path.slice(0,20),nodeCount:path.length});}
          leave();
          if(result.alternatives.length>=25){result.limited=true;result.messages.push('Показано до 25 различных сочетаний исходов; список может быть неполным.');return finish();}
          continue;
        }
      }
      const exits=edges(f.id);
      if(f.next>=exits.length){leave();continue;}
      const edge=exits[f.next++];
      if(active.has(edge.targetId)){result.cycle=true;continue;}
      const split=nodes.get(f.id)!.type==='exclusiveGateway'&&(outgoing.get(f.id)?.length??0)>1;
      stack.push({id:edge.targetId,next:0,entered:false,condition:split?{gatewayId:f.id,gateway:nodes.get(f.id)!.name||f.id,edgeId:edge.id,label:edge.label?.trim()||'Условие ветви не указано'}:undefined});
    }
  }
  return finish();
}
