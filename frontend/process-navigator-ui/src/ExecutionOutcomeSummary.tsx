import type {ProcessInstance} from './types';
import {outcomeLabel} from './execution-outcome';
import './execution-outcome.css';
export function ExecutionOutcomeSummary({instance}:{instance:ProcessInstance}){
  if(instance.status!=='Completed'&&instance.status!=='Cancelled')return null;
  const value=instance.outcome,unfinished=instance.steps.filter(s=>s.status!=='Completed'&&s.status!=='Skipped');
  return <section className="execution-outcome" aria-label="Исход выполнения"><h3>{outcomeLabel(instance)}</h3>
    {value?<><p>{value.reason}</p><p>{new Date(value.recordedAt).toLocaleString('ru-RU')} · {value.recordedBy}</p></>:
      <p>Старая запись: отдельный исход и причина не фиксировались. По одному статусу нельзя восстановить точную причину.</p>}
    <p>Завершено действий: {instance.steps.filter(s=>s.status==='Completed').length}. Сохранено результатов: {instance.steps.reduce((n,s)=>n+(s.resultObjects?.length??0),0)}; вложений: {instance.steps.reduce((n,s)=>n+(s.attachments?.length??0),0)}.</p>
    {instance.steps.some(s=>s.resultText)&&<details><summary>Сохранённые текстовые результаты</summary><ul>{instance.steps.filter(s=>s.resultText).slice(0,100).map(s=><li key={s.elementId}>{s.elementId}: {s.resultText}</li>)}</ul>{instance.steps.filter(s=>s.resultText).length>100&&<p>Показаны первые 100; полный текст доступен в карточках действий.</p>}</details>}
    {!!unfinished.length&&<><p>Незавершённые ветви остановлены; дальнейшие действия запрещены. Они не объявлены выполненными или неприменимыми. Ранее сохранённые результаты, вложения и история не удалены.</p><details><summary>Незавершённые действия: {unfinished.length}</summary><ul>{unfinished.slice(0,100).map(s=><li key={s.elementId}>{s.elementId} · {s.status==='InProgress'?'Был в работе':'Не был начат'}</li>)}</ul>{unfinished.length>100&&<p>Показаны первые 100; полный состав сохранён в исходе.</p>}</details></>}
  </section>;
}
