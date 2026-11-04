import {occurrenceDetails} from './information-object-detail.ts';
import type {InformationTransfer} from './information-transfers.ts';
import type {InformationObjectOccurrence,OrganizationMap,ProcessModel} from './types';

export function transferFacts(rows:InformationTransfer[],models:Record<string,ProcessModel>,organization?:OrganizationMap){
  const facts=new Map<InformationObjectOccurrence,ReturnType<typeof occurrenceDetails>>();
  for(const row of rows)for(const value of [row.source,row.target])if(value&&!facts.has(value))facts.set(value,occurrenceDetails(value,models[value.processId],organization));
  return facts;
}
export type TransferFacts=ReturnType<typeof transferFacts>;
export function explicitTransferChannels(objectId:string,value:InformationObjectOccurrence,facts:TransferFacts){
  const direction=value.direction==='Producer'?'output':value.direction==='Consumer'?'input':undefined;
  return direction ? (facts.get(value)?.channels??[]).filter(channel=>channel.directionCode===direction&&channel.objectId?.toLowerCase()===objectId.toLowerCase()) : [];
}
export function filterTransfers(rows:InformationTransfer[],query:string,facts:TransferFacts){
  const needle=query.trim().toLocaleLowerCase('ru');
  return rows.filter(row=>[row.object.id,row.object.name,row.object.version,row.object.externalSource,row.object.externalRecipient,
    ...[row.source,row.target].flatMap(value=>value?[value.processId,value.processName,value.elementId,value.elementName,value.version,value.condition,facts.get(value)?.responsibility,...(facts.get(value)?.systems??[]),...(facts.get(value)?.channels??[]).flatMap(c=>[c.label,c.kind,c.direction,c.documentName])]:[])
  ].some(value=>value?.toLocaleLowerCase('ru').includes(needle)));
}
export function summarizeTransfers(rows:InformationTransfer[]){
  const groups=new Map<string,{id:string;name:string;pairs:number;sources:Set<string>;targets:Set<string>;missingSource:boolean;missingTarget:boolean}>();
  const key=(v:InformationObjectOccurrence)=>JSON.stringify([v.processId,v.scope,v.elementId??null]);
  for(const row of rows){
    let group=groups.get(row.object.id);
    if(!group){group={id:row.object.id,name:row.object.name,pairs:0,sources:new Set(),targets:new Set(),missingSource:false,missingTarget:false};groups.set(group.id,group);}
    group.pairs++;
    if(row.source)group.sources.add(key(row.source));else group.missingSource=true;
    if(row.target)group.targets.add(key(row.target));else group.missingTarget=true;
  }
  return [...groups.values()].map(g=>({...g,sources:g.sources.size,targets:g.targets.size}));
}
export function transferPage<T>(rows:T[],page:number,size=100){
  const pages=Math.max(1,Math.ceil(rows.length/size)),index=Math.max(0,Math.min(page,pages-1));
  return {index,pages,rows:rows.slice(index*size,(index+1)*size)};
}
function csvCell(value:unknown){
  let text=String(value??'');
  if(/^[\s\u0000-\u001f]*[=+\-@]/u.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function transferCsv(rows:InformationTransfer[],facts:TransferFacts,meta:{generatedAt:string;registryGeneratedAt?:string;query:string;built:number;limited:boolean;modelLimit:boolean;failures:string[]}){
  const header=['Сформировано','Реестр сформирован','Область','Поиск','Найдено пар','Построено пар','Предел пар','Предел моделей','Недоступные сведения','ID объекта','Объект','Версия объекта','Состояние реестра','Внешний источник','Внешний получатель','Число источников в реестре',
    ...['Источник','Получатель'].flatMap(side=>['ID процесса','Процесс','Область привязки','ID этапа','Этап','Подразделение','Системы этапа','Каналы этапа','Обязательный','Условие','Версия привязки','Сведения модели','Каналы объекта по ID'].map(name=>side+': '+name))];
  const endpoint=(objectId:string,value?:InformationObjectOccurrence)=>{
    const f=value?facts.get(value):undefined;
    return value?[value.processId,value.processName,value.scope,value.elementId,value.elementName,f?.responsibility,f?.systems.join(' · '),f?.channels.map(c=>[c.kind,c.direction,c.label,c.documentName].filter(Boolean).join(': ')).join(' · '),value.required?'Да':'Нет',value.condition,value.version,f?.available?'Доступны':'Недоступны',explicitTransferChannels(objectId,value,facts).map(c=>[c.id,c.kind,c.flow,c.label].join(': ')).join(' · ')]:
      ['','','','','','','','','','','','Не указан в реестре',''];
  };
  const prefix=[meta.generatedAt,meta.registryGeneratedAt,'Возможные пары по ID, не факт передачи; вся найденная построенная выборка',meta.query,rows.length,meta.built,meta.limited?'Достигнут':'Нет',meta.modelLimit?'Достигнут':'Нет',meta.failures.join(' · ')];
  // An empty selection still exports scope, limits and errors instead of a misleading blank file.
  const records=rows.length?rows.map(row=>[...prefix,row.object.id,row.object.name,row.object.version,row.object.lifecycleState,row.object.externalSource,row.object.externalRecipient,row.object.producers.length,...endpoint(row.object.id,row.source),...endpoint(row.object.id,row.target)]):[[...prefix,...Array(header.length-prefix.length).fill('')]];
  return '\uFEFF'+[header,...records].map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';
}
