export type DepartmentRow = {entityId:string;unitId:string;name:string;shortName:string;legalEntityName:string;processCount:number;ownedProcessCount:number;taskCount:number;incomingTransferCount:number;outgoingTransferCount:number;overdueCount:number|null;observedInstanceCount:number;processIds:string[];ownedProcessIds:string[]};
export type DepartmentReport = {generatedAt:string;processCount:number;unmappedTaskCount:number;unmappedOwnershipCount:number;unmappedTransferCount:number;orphanExecutionStepCount:number;warnings:string[];rows:DepartmentRow[];processes:{id:string;name:string}[]};
export const departmentMetrics = {processCount:'Участие',ownedProcessCount:'Владение',taskCount:'Задачи',incomingTransferCount:'Входящие',outgoingTransferCount:'Исходящие',overdueCount:'С просрочкой'} as const;
export function selectDepartments(report:DepartmentReport,query:string,entityId:string,sort:string) {
  const names=new Map(report.processes.map(p=>[p.id,p.name]));const needle=query.trim().toLocaleLowerCase('ru');
  return report.rows.filter(r=>(!entityId||r.entityId===entityId)&&(!needle||[r.name,r.shortName,r.unitId,r.legalEntityName,...r.processIds.map(id=>names.get(id)??id),...r.ownedProcessIds.map(id=>names.get(id)??id)].some(v=>v.toLocaleLowerCase('ru').includes(needle))))
    .sort((a,b)=>(sort==='overdue'?(b.overdueCount??-1)-(a.overdueCount??-1):sort==='ownership'?b.ownedProcessCount-a.ownedProcessCount:sort==='activity'?(b.incomingTransferCount+b.outgoingTransferCount)-(a.incomingTransferCount+a.outgoingTransferCount):0)||a.legalEntityName.localeCompare(b.legalEntityName,'ru')||a.name.localeCompare(b.name,'ru')||a.unitId.localeCompare(b.unitId));
}
export function departmentIntensity(value:number|null,maximum:number) {return value==null||value<=0||maximum<=0?0:0.08+Math.min(1,value/maximum)*0.42;}
export function departmentCsv(report:DepartmentReport,query:string,entityId:string,sort:string) {
  const cell=(v:unknown)=>'"'+String(v??'').replace(/^(\s*[=+@-])/,"'$1").replaceAll('"','""')+'"';
  const rows:unknown[][]=[['Срез','Организация ID','Подразделение ID','Организация','Подразделение',...Object.values(departmentMetrics),'Экземпляров участвующих моделей','Участие ID JSON','Владение ID JSON']];
  for(const r of selectDepartments(report,query,entityId,sort))rows.push([report.generatedAt,r.entityId,r.unitId,r.legalEntityName,r.name,...Object.keys(departmentMetrics).map(k=>r[k as keyof typeof departmentMetrics]??'Нет данных'),r.observedInstanceCount,JSON.stringify(r.processIds),JSON.stringify(r.ownedProcessIds)]);
  return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
}
