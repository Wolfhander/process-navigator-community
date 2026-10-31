import {useState} from 'react';
import type {ProcessDecompositionMap} from './types';
import {boundariesCsv,boundaryLabels,boundaryLocation,boundaryStatus,selectBoundaries,type BoundaryStatus} from './decomposition-boundaries';

export function DecompositionBoundaryView({data,query,loadedAt}:{data:ProcessDecompositionMap;query:string;loadedAt:string}) {
  const [status,setStatus]=useState<BoundaryStatus|''>('');
  const [page,setPage]=useState(0);
  const [error,setError]=useState('');
  const rows=selectBoundaries(data,query,status),pages=Math.max(1,Math.ceil(rows.length/50)),current=Math.min(page,pages-1);
  function download(){try{const url=URL.createObjectURL(new Blob([boundariesCsv(data,query,status,loadedAt)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='decomposition-boundaries.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setError('');}catch{setError('Не удалось создать CSV границ.');}}
  return <section className="boundary-workspace" aria-label="Сводная карта границ">
    <h3>Границы между уровнями</h3>
    <p>Показаны связи из этапа верхнего уровня в детальную модель. Доступные черновики имеют приоритет над действующей версией; иначе используется действующая. Архивы не сравниваются. Срез загружен: {loadedAt}.</p>
    <p>Проверка обеспечения учитывает порядок действий, альтернативы и подтверждённые параллельные объединения. Поздний, необязательный или условный производитель не гарантирует вход. Для повторов, текстовых условий и неподдержанных участков подтверждение не выдаётся: причина указана в замечании.</p>
    <p>«Замечаний не найдено» означает только прохождение структурных проверок описания, не фактическое наличие файлов или правильность бизнес-процесса. При нескольких завершениях проверка консервативна: обещанный безусловный результат ищется к каждому из них. Переход открывает текущую редакцию выбранного типа, а не замороженный снимок.</p>
    <div className="boundary-controls"><label>Состояние границы <select value={status} onChange={event=>{setStatus(event.target.value as BoundaryStatus|'');setPage(0);}}><option value="">Все границы</option>{Object.entries(boundaryLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><button onClick={download}>CSV всех найденных границ</button><span role="status">Найдено {rows.length} из {data.links.length}</span></div>
    {error&&<p role="alert">{error}</p>}
    <div className="boundary-cards">{rows.slice(current*50,current*50+50).map((link,index)=><article key={current*50+index}>
      <header><strong>{link.elementName}</strong><span className={'boundary-status is-'+boundaryStatus(link)}>{boundaryLabels[boundaryStatus(link)]}</span></header>
      <div className="boundary-pair"><div><h4>Верхний уровень {link.sourceLevel}</h4><a href={boundaryLocation(link)}>{link.sourceProcessName} → {link.elementName}</a><small>{link.sourceProcessId} / {link.elementId} · {link.sourceDraft?'Черновик':'Действующая'} {link.sourceVersion??'версия не указана'}</small></div><div><h4>Детальный уровень {link.targetLevel??'неизвестен'}</h4>{link.targetProcessName?<a href={boundaryLocation(link,true)}>{link.targetProcessName}</a>:<strong>Модель недоступна или отсутствует</strong>}<small>{link.targetProcessId}{link.targetProcessName?' · '+(link.targetDraft?'Черновик':'Действующая')+' '+(link.targetVersion??'версия не указана'):''}</small></div></div>
      {link.missingBoundaries.length>0?<ul>{link.missingBoundaries.map((message,i)=><li key={i}>{message}</li>)}</ul>:<p>{link.boundaryReady?'Структурных замечаний в этой связи нет.':'Граница требует уточнения; подробности проверки не получены.'}</p>}
    </article>)}</div>
    {!rows.length&&<p>{data.links.length?'По заданным условиям границ нет. Измените поиск или фильтр.':'Связи детализации пока не назначены.'}</p>}
    <div className="boundary-controls"><button disabled={current===0} onClick={()=>setPage(current-1)}>Предыдущие границы</button><span>Страница {current+1} из {pages} · до 50 связей на странице; CSV содержит всю выборку</span><button disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Следующие границы</button></div>
  </section>;
}
