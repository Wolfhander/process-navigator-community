import type {ScheduleCalendar} from './types';
import './calendar-profile.css';
export const defaultCalendar:ScheduleCalendar={workdayStart:'09:00',workdayEnd:'17:00',workingDays:[1,2,3,4,5],nonWorkingDates:[],utcOffsetMinutes:180};
export function CalendarProfileEditor({value,onChange,label='Собственный календарь',disabled=false,defaults=defaultCalendar}:{value?:ScheduleCalendar;onChange:(value:ScheduleCalendar|undefined)=>void;label?:string;disabled?:boolean;defaults?:ScheduleCalendar}){
  const patch=(update:Partial<ScheduleCalendar>)=>onChange({...value!,...update});
  return <fieldset disabled={disabled} className="schedule-calendar-fields"><label><input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked?structuredClone(defaults):undefined)}/>{label}</label>{value&&<>
    <label>Начало смены<input type="time" value={value.workdayStart} onChange={e=>patch({workdayStart:e.target.value})}/></label>
    <label>Конец смены<input type="time" value={value.workdayEnd} onChange={e=>patch({workdayEnd:e.target.value})}/></label>
    <label>Часовой пояс (IANA или Windows)<input placeholder="Например, Europe/Berlin" value={value.timeZoneId??''} onChange={e=>patch({timeZoneId:e.target.value||undefined})}/></label>
    <label>Фиксированный UTC, минуты (без часового пояса)<input disabled={!!value.timeZoneId} type="number" min={-720} max={840} value={value.utcOffsetMinutes} onChange={e=>patch({utcOffsetMinutes:Number(e.target.value)})}/></label>
    <div>{['Вс','Пн','Вт','Ср','Чт','Пт','Сб'].map((name,day)=><label key={day}><input type="checkbox" checked={value.workingDays.includes(day)} onChange={e=>patch({workingDays:e.target.checked?[...value.workingDays,day]:value.workingDays.filter(d=>d!==day)})}/>{name}</label>)}</div>
    <label>Нерабочие даты начала смены (ГГГГ-ММ-ДД, через запятую)<input value={value.nonWorkingDates.join(',')} onChange={e=>patch({nonWorkingDates:e.target.value.split(',')})}/></label>
    <p>Конец раньше начала — ночная смена следующего дня. Равные часы недопустимы. Исключение относится к дате начала смены. При сезонном переводе считаются реальные часы: весенний пропуск сдвигается к первой допустимой минуте, осенний повтор включается целиком.</p>
  </>}</fieldset>;
}
