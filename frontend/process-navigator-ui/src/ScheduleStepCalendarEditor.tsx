import type {ProcessModel,ScheduleCalendar} from './types';
import {CalendarProfileEditor} from './CalendarProfileEditor';
export function ScheduleStepCalendarEditor({models,value,onChange,disabled}:{models:ProcessModel[];value:Record<string,Record<string,ScheduleCalendar>>;onChange:(value:Record<string,Record<string,ScheduleCalendar>>)=>void;disabled:boolean}){
 return <details className="schedule-scenario"><summary>Календари отдельных шагов</summary><p>Приоритет: шаг → ручной календарь процесса → подразделение/его предки → организация → общий. Без оргкалендарей остаются ручные и общий. Эти настройки относятся только к сценарию расчёта.</p>{models.map(model=><details key={model.id}><summary>{model.name}</summary>{(model.nodes??[]).filter(n=>n.type==='task').map(node=><details key={node.id}><summary>{node.name} · {node.id}</summary><CalendarProfileEditor disabled={disabled} value={value[model.id]?.[node.id]} onChange={calendar=>{
   const next={...value},steps={...next[model.id]};if(calendar)steps[node.id]=calendar;else delete steps[node.id];if(Object.keys(steps).length)next[model.id]=steps;else delete next[model.id];onChange(next);
 }}/></details>)}</details>)}</details>;
}
