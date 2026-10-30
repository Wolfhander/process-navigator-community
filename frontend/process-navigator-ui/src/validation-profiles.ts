import type {ProcessValidationIssue} from './types';
export const validationProfiles={
  minimum:{label:'Минимальная структурная пригодность',description:'Все критические ошибки должны быть исправлены. Рекомендации не входят в этот просмотр, но остаются в полном отчёте. Это не подтверждение готовности сотрудников, документов или выполнения.'},
  recommended:{label:'Рекомендуемая полнота',description:'Нет критических ошибок и рекомендаций. Требует полноты описания сверх минимального контроля; незаполненные рекомендации не превращаются в серверные запреты.'},
  publication:{label:'Перед публикацией',description:'Критические ошибки блокируют структурный допуск, рекомендации допускаются. Окончательное решение принимает сервер с учётом текущей редакции, прав и согласования; профиль не меняет эти правила.'}
} as const;
export type ValidationProfile=keyof typeof validationProfiles;
export type QualityInput={errorCount:number;warningCount:number;issues:ProcessValidationIssue[];openable?:boolean;canPublish?:boolean};
export type ProfileState='Ready'|'Incomplete'|'Blocked';
export function profileQuality(input:QualityInput,profile:ValidationProfile):ProfileState {
  if(!Number.isInteger(input.errorCount)||input.errorCount<0||!Number.isInteger(input.warningCount)||input.warningCount<0)return 'Blocked';
  // A stale or inconsistent summary cannot suppress an actual critical issue.
  const errors=Math.max(input.errorCount,input.issues.filter(issue=>issue.severity==='Error').length);
  const warnings=Math.max(input.warningCount,input.issues.filter(issue=>issue.severity==='Warning').length);
  if(input.openable===false||errors>0||(profile==='publication'&&input.canPublish===false))return 'Blocked';
  return profile==='recommended'&&warnings>0?'Incomplete':'Ready';
}
export function profileIssues(issues:ProcessValidationIssue[],profile:ValidationProfile) {
  return profile==='minimum'?issues.filter(issue=>issue.severity==='Error'):issues;
}
export function profileResult(input:QualityInput,profile:ValidationProfile) {
  const state=profileQuality(input,profile);
  if(state==='Blocked')return 'Критерий не пройден';
  if(state==='Incomplete')return 'Описание требует дополнений';
  return profile==='publication'?'Критерий подготовки к публикации пройден':'Критерий профиля пройден';
}
