export type DiagnosticEvent={at:string;operationId:string;method:string;category:string;status:number;elapsedMilliseconds:number;failure:string};
export const diagnosticFailureLabels:Record<string,string>={None:'Без ошибки',Rejected:'Запрос отклонён',Missing:'Не найдено',Conflict:'Конфликт изменений',Cancelled:'Запрос прерван',ServerError:'Сбой сервера',StorageUnavailable:'Хранилище недоступно',AuditWriteFailed:'Не записан аудит; основное действие могло выполниться'};
export type DiagnosticPackage={schemaVersion:number;generatedAt:string;serverStartedAt:string;applicationVersion:string;runtimeVersion:string;architecture:string;requestOperationId:string;totalRequests:number;totalFailures:number;discardedEvents:number;events:DiagnosticEvent[]};
export function withOperationId(message:string,id:string|null){
  return id&&/^[a-f0-9]{32}$/.test(id)&&!message.includes(id)?message+' Код операции: '+id+'.':message;
}
export function diagnosticEvents(data:DiagnosticPackage,query:string,failuresOnly:boolean){
  const normalized=query.trim().toLowerCase();
  if(normalized&&!/^[a-f0-9]{1,32}$/.test(normalized))throw Error('Код операции содержит только 32 шестнадцатеричных символа; можно искать по его началу.');
  return data.events.filter(e=>(!normalized||e.operationId.startsWith(normalized))&&(!failuresOnly||e.status>=400||e.failure!=='None')).slice().reverse();
}
export function diagnosticPackageJson(data:DiagnosticPackage){
  const safeInt=(n:number)=>Number.isSafeInteger(n)&&n>=0;
  const id=(s:string)=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
  const date=(s:string)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s));
  if(data.schemaVersion!==1||!date(data.generatedAt)||!date(data.serverStartedAt)||!id(data.requestOperationId)
    ||!/^([0-9]+\.[0-9]+\.[0-9]+[-A-Za-z0-9.]*|unknown)$/.test(data.applicationVersion)||!/^\d+(\.\d+){1,3}$/.test(data.runtimeVersion)
    ||!['X86','X64','Arm','Arm64','Wasm','S390x','LoongArch64','Armv6','Ppc64le','RiscV64'].includes(data.architecture)
    ||![data.totalRequests,data.totalFailures,data.discardedEvents].every(safeInt)||!Array.isArray(data.events)||data.events.length>1000
    ||data.totalRequests!==data.discardedEvents+data.events.length||data.totalFailures>data.totalRequests)throw Error('Пакет не соответствует безопасному формату; выгрузка остановлена.');
  const methods=['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS','OTHER'],categories=['processes','analytics','admin','organization','session','health','notifications','users','import-recipes','other-api'];
  const kinds=['None','Rejected','Missing','Conflict','Cancelled','ServerError','StorageUnavailable','AuditWriteFailed'];
  const events=data.events.map(e=>{
    if(!date(e.at)||!id(e.operationId)||!methods.includes(e.method)||!categories.includes(e.category)||!safeInt(e.status)||e.status<100||e.status>599||!safeInt(e.elapsedMilliseconds)||!kinds.includes(e.failure))
      throw Error('Событие не соответствует безопасному формату; выгрузка остановлена.');
    return {at:e.at,operationId:e.operationId,method:e.method,category:e.category,status:e.status,elapsedMilliseconds:e.elapsedMilliseconds,failure:e.failure};
  });
  return JSON.stringify({schemaVersion:1,generatedAt:data.generatedAt,serverStartedAt:data.serverStartedAt,applicationVersion:data.applicationVersion,runtimeVersion:data.runtimeVersion,architecture:data.architecture,
    requestOperationId:data.requestOperationId,totalRequests:data.totalRequests,totalFailures:data.totalFailures,discardedEvents:data.discardedEvents,events},null,2);
}
