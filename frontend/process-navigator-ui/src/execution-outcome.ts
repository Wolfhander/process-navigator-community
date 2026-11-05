import type {ProcessInstance} from './types';
export const outcomeNames={Success:'Успешное завершение',Refusal:'Отказ',Error:'Ошибка',Cancellation:'Отмена'};
export function outcomeLabel(instance:ProcessInstance){
  if(instance.outcome)return outcomeNames[instance.outcome.kind]??'Неизвестный исход';
  return instance.status==='Completed'?'Завершён — без явной классификации':instance.status==='Cancelled'?'Закрыт — без явной классификации':
    instance.status==='Paused'?'Приостановлен':'В работе';
}
