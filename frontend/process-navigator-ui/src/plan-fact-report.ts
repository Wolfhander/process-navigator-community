import type {ProcessInstance,ProcessScheduleItem} from './types';
import type {InstanceSchedulePlan} from './instance-schedule-plan';
import {compareScheduleFact} from './schedule-fact.ts';
import {scheduleCsvCell} from './schedule-export.ts';
import {outcomeLabel} from './execution-outcome.ts';

export function planFactReport(plan:ProcessScheduleItem,instance:ProcessInstance,now:string,
  baseline?:InstanceSchedulePlan,sourceVersion?:string) {
  if(!Number.isFinite(Date.parse(now)))throw Error('Дата фиксации сравнения некорректна.');
  if(baseline&&(baseline.instanceId!==instance.id||baseline.processId!==instance.processId||
    baseline.item.processId!==instance.processId||baseline.processVersion!==instance.processVersion))
    throw Error('Назначенный план относится к другому выполнению, процессу или версии.');
  if(baseline&&(baseline.item.startAt!==plan.startAt||baseline.item.endAt!==plan.endAt))
    throw Error('Даты сравнения отличаются от выбранного базового плана.');
  const comparison=compareScheduleFact(plan,instance,now);
  const version=baseline?.processVersion??sourceVersion;
  const preliminary=!plan.isDateReliable||!version||version!==instance.processVersion;
  const state=({active:'В работе',paused:'Приостановлено',completed:'Завершено',cancelled:'Отменено','missing-fact':'Нет даты завершения'})[comparison.state];
  return {processId:instance.processId,instanceId:instance.id,instanceName:instance.name,
    instanceVersion:instance.processVersion,planVersion:version??'',planId:baseline?.id??'',
    basis:baseline?'Назначенный базовый план':'Показанный расчёт — не назначен',
    assignedBy:baseline?.assignedBy??'',assignedAt:baseline?.assignedAt??'',reason:baseline?.reason??'',
    capturedAt:now,preliminary,stateLabel:instance.outcome&&instance.outcome.kind!=='Success'?outcomeLabel(instance):state,
    outcome:instance.outcome,plannedStart:plan.startAt,plannedEnd:plan.endAt,actualStart:instance.startedAt,
    actualEnd:comparison.state==='completed'?instance.completedAt!:'',...comparison};
}
export type PlanFactReport=ReturnType<typeof planFactReport>;
export function planFactCsv(report:PlanFactReport) {
  const rows:(string|number|boolean)[][]=[
    ['Поле','Значение'],['Процесс ID',report.processId],['Выполнение ID',report.instanceId],['Выполнение',report.instanceName],
    ['Основание',report.basis],['План ID',report.planId],['Версия плана',report.planVersion],['Версия выполнения',report.instanceVersion],
    ['Назначил',report.assignedBy],['Назначено ISO',report.assignedAt],['Причина',report.reason],
    ['Состояние на ISO',report.capturedAt],['Предварительное сравнение',report.preliminary],['Статус',report.stateLabel],
    ['План начала ISO',report.plannedStart],['Факт начала ISO',report.actualStart],['Отклонение начала, календарные часы',report.startDeltaHours],
    ['План окончания ISO',report.plannedEnd],['Факт завершения ISO',report.actualEnd],
    ['Исход',report.outcome?.kind??'Не зафиксирован'],['Причина исхода',report.outcome?.reason??''],['Закрыто ISO',report.outcome?.recordedAt??''],
    [report.state==='completed'?'Отклонение окончания, календарные часы':'Текущая просрочка, календарные часы',report.finishDeltaHours??''],
    ['Методика','Календарные часы, не рабочие нормы. Пауза не переносит срок; отмена не является завершением.']
  ];
  return '\ufeff'+rows.map(row=>row.map(scheduleCsvCell).join(';')).join('\r\n');
}
