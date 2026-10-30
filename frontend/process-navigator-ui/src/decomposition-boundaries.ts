import type {ProcessDecompositionLink as Link,ProcessDecompositionMap} from './types';
import {processLocationHash} from './process-location.ts';
export type BoundaryStatus='missing'|'review'|'described';
export const boundaryLabels:Record<BoundaryStatus,string>={missing:'Нет детальной модели',review:'Требует уточнения',described:'Замечаний не найдено'};
export function boundaryStatus(link:Link):BoundaryStatus {
  return !link.targetProcessName?'missing':!link.boundaryReady||link.missingBoundaries.length?'review':'described';
}
export function selectBoundaries(data:ProcessDecompositionMap,query:string,status:BoundaryStatus|'') {
  const needle=query.trim().toLocaleLowerCase('ru');
  return data.links.filter(link=>(!status||boundaryStatus(link)===status)&&[link.sourceProcessId,link.sourceProcessName,link.elementId,link.elementName,link.targetProcessId,link.targetProcessName??'',...link.missingBoundaries].join(' ').toLocaleLowerCase('ru').includes(needle));
}
export function boundaryLocation(link:Link,target=false) {
  return processLocationHash({processId:target?link.targetProcessId:link.sourceProcessId,draft:(target?link.targetDraft:link.sourceDraft)??false,...(!target?{elementId:link.elementId}:{})});
}
export function boundariesCsv(data:ProcessDecompositionMap,query:string,status:BoundaryStatus|'',loadedAt:string) {
  const cell=(v:unknown)=>'"'+String(v??'').replace(/^(\s*[=+@-])/,"'$1").replaceAll('"','""')+'"';
  const rows:unknown[][]=[['Загружено UTC','Поиск','Фильтр','Источник ID','Источник','Уровень источника','Версия источника','Черновик источника','Этап ID','Этап','Детальная модель ID','Детальная модель','Уровень детализации','Версия детализации','Черновик детализации','Состояние','Замечания JSON']];
  for(const link of selectBoundaries(data,query,status))rows.push([loadedAt,query,status?boundaryLabels[status]:'Все',link.sourceProcessId,link.sourceProcessName,link.sourceLevel,link.sourceVersion,link.sourceDraft?'Да':'Нет',link.elementId,link.elementName,link.targetProcessId,link.targetProcessName,link.targetLevel,link.targetVersion,link.targetDraft?'Да':'Нет',boundaryLabels[boundaryStatus(link)],JSON.stringify(link.missingBoundaries)]);
  return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
}
