import type {ProcessInstance,ProcessScheduleItem} from './types';
import type {InstanceSchedulePlan} from './instance-schedule-plan';
import {planFactReport,planFactCsv} from './plan-fact-report';
import './plan-fact.css';

export function PlanFactComparison({plan,instance,now,baseline,sourceVersion}:{
  plan:ProcessScheduleItem;instance:ProcessInstance;now:string;baseline?:InstanceSchedulePlan;sourceVersion?:string
}) {
  let report;
  try{report=planFactReport(plan,instance,now,baseline,sourceVersion);}
  catch(reason){return <p role="alert">{reason instanceof Error?reason.message:'Не удалось сравнить план и факт.'}</p>;}
  const date=(value:string)=>value?new Date(value).toLocaleString('ru-RU'):'—';
  const hours=(value:number|null)=>value===null?'Не оценивается':(value>0?'+':'')+Number(value.toFixed(2))+' календарных ч';
  const download=()=>{
    const url=URL.createObjectURL(new Blob([planFactCsv(report)],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='plan-fact-'+instance.id+'.csv';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="plan-fact-report" aria-label="План и факт выполнения">
    <header><div><strong>{report.basis}</strong><p>{instance.name} · {report.stateLabel}</p></div><button onClick={download}>Выгрузить план / факт CSV</button></header>
    {report.preliminary&&<p role="status">Сопоставление предварительное: даты расчёта ненадёжны, версия неизвестна или отличается от выполнения. Это не назначенный подтверждённый срок.</p>}
    <div className="plan-fact-table"><table><caption>Календарные даты конкретного выполнения</caption><thead><tr><th scope="col">Показатель</th><th scope="col">План</th><th scope="col">Факт</th><th scope="col">Отклонение</th></tr></thead><tbody>
      <tr><th scope="row">Начало</th><td>{date(report.plannedStart)}</td><td>{date(report.actualStart)}</td><td>{hours(report.startDeltaHours)}</td></tr>
      <tr><th scope="row">{report.state==='completed'?'Завершение':'Окончание / текущая просрочка'}</th><td>{date(report.plannedEnd)}</td><td>{date(report.actualEnd)}</td><td>{hours(report.finishDeltaHours)}</td></tr>
    </tbody></table></div>
    <p>План: версия {report.planVersion||'неизвестна'}; выполнение: {report.instanceVersion}. Состояние на {date(now)}.</p>
    {report.planId&&<p>Редакция плана: {report.planId} · {report.assignedBy} · {date(report.assignedAt)}. Основание: {report.reason}</p>}
    <p>Положительное отклонение — позже плана, отрицательное — раньше. Текущая просрочка — не прогноз завершения. Пауза не переносит срок; отмена не считается завершением. Отдельная сверка проверяет актуальность исходников, не изменяя назначенный план.</p>
  </section>;
}
