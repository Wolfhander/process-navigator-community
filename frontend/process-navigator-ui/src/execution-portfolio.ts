export type InstanceFact={processId:string;processName:string;modelAvailable:boolean;instanceId:string;name:string;version:string;status:string;startedAt:string;completedAt?:string;cycleMinutes?:number|null;returnEvents:number};
export type AttemptFact={processId:string;instanceId:string;elementId:string;name:string;iteration:number;current:boolean;status:string;department:string;entityId?:string;unitId?:string;organizationBasis:string;queueMinutes?:number|null;workMinutes?:number|null;durationMinutes?:number|null;overdueMinutes?:number|null;notes:string[]};
export type ExecutionReport={capturedAt:string;algorithm:string;complete:boolean;fingerprint:string;issueCount:number;issues:{source:string;message:string}[];instances:InstanceFact[];attempts:AttemptFact[]};
export type ExecutionFilters={query:string;status:string;from:string;to:string};
const key=(i:{processId:string;instanceId:string})=>JSON.stringify([i.processId,i.instanceId]);
export function executionSelection(data:ExecutionReport,filters:ExecutionFilters){
  if(filters.from&&filters.to&&filters.from>filters.to)throw Error('Начальная дата позже конечной.');
  const query=filters.query.trim().toLocaleLowerCase();
  const instances=data.instances.filter(i=>(!filters.status||i.status===filters.status)&&(!filters.from||i.startedAt.slice(0,10)>=filters.from)&&(!filters.to||i.startedAt.slice(0,10)<=filters.to)
    &&[i.processId,i.processName,i.instanceId,i.name,i.version].join(' ').toLocaleLowerCase().includes(query));
  const ids=new Set(instances.map(key));return {instances,attempts:data.attempts.filter(a=>ids.has(key(a)))};
}
const numbers=(rows:AttemptFact[],field:'queueMinutes'|'workMinutes'|'durationMinutes'|'overdueMinutes')=>rows.flatMap(r=>typeof r[field]==='number'&&Number.isFinite(r[field])&&r[field]!>=0?[r[field]!]:[]);
export function executionStats(instances:InstanceFact[],attempts:AttemptFact[]){
  const openIds=new Set(instances.filter(i=>i.status==='Active'||i.status==='Paused').map(key));
  const cycles=instances.flatMap(i=>typeof i.cycleMinutes==='number'&&Number.isFinite(i.cycleMinutes)&&i.cycleMinutes>=0?[i.cycleMinutes]:[]);
  const queue=numbers(attempts,'queueMinutes'),work=numbers(attempts,'workMinutes'),overdue=numbers(attempts,'overdueMinutes');
  return {instances:instances.length,completed:instances.filter(i=>i.status==='Completed').length,cycleCount:cycles.length,averageCycle:cycles.length?cycles.reduce((a,b)=>a+b,0)/cycles.length:null,
    returns:instances.reduce((n,i)=>n+i.returnEvents,0),queueCount:queue.length,averageQueue:queue.length?queue.reduce((a,b)=>a+b,0)/queue.length:null,
    workCount:work.length,workMinutes:work.length?work.reduce((a,b)=>a+b,0):null,overdueKnown:overdue.length,overdue:overdue.filter(n=>n>0).length,
    open:attempts.filter(a=>openIds.has(key(a))&&a.current&&(a.status==='NotStarted'||a.status==='InProgress')).length};
}
export function executionDepartments(attempts:AttemptFact[],instances:InstanceFact[]=[]){
  const openIds=new Set(instances.filter(i=>i.status==='Active'||i.status==='Paused').map(key));
  const rows=new Map<string,{name:string;known:number;minutes:number;open:number;attempts:number}>();
  for(const a of attempts){const k=JSON.stringify([a.entityId??'',a.unitId??'']);const row=rows.get(k)??{name:a.department,known:0,minutes:0,open:0,attempts:0};
    row.attempts++;if(typeof a.workMinutes==='number'&&Number.isFinite(a.workMinutes)&&a.workMinutes>=0){row.known++;row.minutes+=a.workMinutes;}
    if(openIds.has(key(a))&&a.current&&(a.status==='NotStarted'||a.status==='InProgress'))row.open++;rows.set(k,row);
  }return [...rows.entries()].map(([key,r])=>({key,...r})).sort((a,b)=>b.minutes-a.minutes||a.name.localeCompare(b.name));
}
function cell(value:unknown){let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
export function executionCsv(data:ExecutionReport,filters:ExecutionFilters){
  const selection=executionSelection(data,filters);
  const rows:unknown[][]=[['Алгоритм',data.algorithm,'Срез UTC',data.capturedAt,'Отпечаток',data.fingerprint],['Период запуска UTC',filters.from,filters.to,'Статус',filters.status,'Поиск',filters.query],
    ['Ошибок чтения/валидации',data.issueCount,'Показано замечаний',data.issues.length],['Методика','Минуты из сохранённых завершённых проходов, включая историю. Цикл календарный, с паузами. Оргпривязки текущие, не исторические. Не процент загрузки мощности.'],
    ['Вид','Процесс','ID экземпляра','Версия','Статус','Начало UTC','Конец UTC','Цикл минут','Событий возврата','Этап','Итерация','Текущий проход','Подразделение','Основание организации','Очередь минут','Работа минут','Общий факт минут','Превышение нормы минут','Замечания']];
  for(const i of selection.instances)rows.push(['Экземпляр',i.processId,i.instanceId,i.version,i.status,i.startedAt,i.completedAt,i.cycleMinutes,i.returnEvents]);
  for(const a of selection.attempts)rows.push(['Проход',a.processId,a.instanceId,'',a.status,'','','','',a.elementId,a.iteration,a.current,a.department,a.organizationBasis,a.queueMinutes,a.workMinutes,a.durationMinutes,a.overdueMinutes,a.notes.join('; ')]);
  for(const i of data.issues)rows.push(['Замечание',i.source,i.message]);
  return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
}
