import {useEffect,useState} from 'react';
import {executionCsv,executionDepartments,executionSelection,executionStats,type ExecutionReport} from './execution-portfolio';
import {loadExecutionPortfolio} from './api';
import './execution-analytics.css';
const minutes=(n:number|null|undefined)=>n==null?'Неизвестно':n.toLocaleString('ru-RU',{maximumFractionDigits:1})+' мин';
export function ExecutionAnalyticsPanel({onOpenProcess}:{onOpenProcess:(id:string)=>void}){
  const [data,setData]=useState<ExecutionReport>(),[error,setError]=useState(''),[reload,setReload]=useState(0),[query,setQuery]=useState(''),[status,setStatus]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(0),[opened,setOpened]=useState('');
  useEffect(()=>{const c=new AbortController();setData(undefined);setError('');loadExecutionPortfolio(c.signal).then(setData).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[reload]);
  const filters={query,status,from,to};let selection=data?executionSelection(data,{...filters,from:'',to:''}):{instances:[],attempts:[]};
  let filterError='';try{if(data)selection=executionSelection(data,filters);}catch(e){filterError=e instanceof Error?e.message:'Ошибка фильтров';selection={instances:[],attempts:[]};}
  const stats=executionStats(selection.instances,selection.attempts),departments=executionDepartments(selection.attempts,selection.instances);
  const instances=[...selection.instances].sort((a,b)=>b.startedAt.localeCompare(a.startedAt));const pages=Math.max(1,Math.ceil(instances.length/50)),currentPage=Math.min(page,pages-1);
  const visible=instances.slice(currentPage*50,(currentPage+1)*50),maximum=Math.max(1,...departments.map(d=>d.minutes));
  const byInstance=new Map<string,typeof selection.attempts>();for(const a of selection.attempts){const k=JSON.stringify([a.processId,a.instanceId]);const rows=byInstance.get(k)??[];rows.push(a);byInstance.set(k,rows);}
  function download(){if(!data||filterError)return;const url=URL.createObjectURL(new Blob([executionCsv(data,filters)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='execution-observation.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function resetPage(){setPage(0);}
  return <section className="execution-analytics" aria-label="Аналитика исполнения"><header><h2>Исполнение: факты и повторные проходы</h2><button onClick={()=>setReload(v=>v+1)}>Обновить срез исполнения</button></header>
    <p>Цикл — календарное время завершённого экземпляра, включая паузы и выходные. Очередь/работа/превышение нормы — только сохранённые факты завершённых проходов, включая историю возвратов; программа не восстанавливает отсутствующие минуты и не считает незавершённую работу завершённой.</p>
    <p>Подразделения — текущая проекция оргпривязок для совпадающей версии модели, не историческая ответственность. Для иных версий/потерянных моделей — «Не определено». Нагрузка показывает измеренные минуты работы, а не занятость персонала или процент мощности.</p>
    {error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">Читаем факты выполнения…</p>}
    {data&&<><p>Срез UTC: {data.capturedAt} · {data.algorithm} · {data.complete?'Чтение без ошибок':'Есть исключённые/непрочитанные данные'}. Отпечаток: <code>{data.fingerprint}</code></p>
      <details><summary>Диагностика: {data.issueCount} (показано {data.issues.length}, максимум 1000)</summary>{data.issues.map((i,n)=><p key={n}>{i.source}: {i.message}</p>)}</details>
      <div className="execution-filters"><label>Процесс или экземпляр<input value={query} maxLength={300} onChange={e=>{setQuery(e.target.value);resetPage();}}/></label>
        <label>Состояние экземпляра<select value={status} onChange={e=>{setStatus(e.target.value);resetPage();}}><option value="">Все</option><option value="Active">Активен</option><option value="Paused">Пауза</option><option value="Cancelled">Отменён</option><option value="Completed">Завершён</option></select></label>
        <label>Запуск с (UTC)<input type="date" value={from} onChange={e=>{setFrom(e.target.value);resetPage();}}/></label><label>Запуск по (UTC, включительно)<input type="date" value={to} onChange={e=>{setTo(e.target.value);resetPage();}}/></label>
        <button disabled={!!filterError} onClick={download}>CSV всей выбранной выборки</button></div>
      {filterError&&<p role="alert">{filterError}</p>}
      <div className="execution-kpis">{[
        ['Экземпляров',stats.instances],['Завершённых',stats.completed],['Средний календарный цикл',minutes(stats.averageCycle)+' · измерений '+stats.cycleCount],
        ['Средняя очередь прохода',minutes(stats.averageQueue)+' · измерений '+stats.queueCount],['Измеренная работа',minutes(stats.workMinutes)+' · измерений '+stats.workCount],
        ['Превышений нормы',stats.overdue+' из '+stats.overdueKnown+' известных'],['Записанных событий возврата',stats.returns],['Незавершённых проходов (активные/пауза)',stats.open],
      ].map(([name,value])=><article key={name}><span>{name}</span><strong>{value}</strong></article>)}</div>
      {!selection.instances.length&&<p>По выбранным условиям экземпляров нет. Это не означает отсутствия данных в исключённых файлах.</p>}
      <h3>Измеренная работа по текущим подразделениям</h3><p>Показаны первые {Math.min(20,departments.length)} из {departments.length} групп по сумме минут. Итоги и CSV включают всю выборку.</p>
      {departments.slice(0,20).map(d=><article className="execution-department" key={d.key}><strong>{d.name}</strong><progress aria-label={'Минуты работы '+d.name} value={d.minutes} max={maximum}/><span>{d.known?minutes(d.minutes):'Нет измерений работы'} · измерений {d.known} · текущих незавершённых {d.open}</span></article>)}
      <h3>Экземпляры и исходные проходы</h3><p>Страница {currentPage+1} из {pages}; по 50 экземпляров. Раскройте строку для этапов, итераций и оснований группировки. В каждом экземпляре показано до 200 проходов; все остальные сохранены в CSV.</p>
      <button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>Предыдущие</button><button disabled={currentPage+1>=pages} onClick={()=>setPage(currentPage+1)}>Следующие</button>
      {visible.map(i=>{const key=JSON.stringify([i.processId,i.instanceId]),facts=byInstance.get(key)??[];return <details key={key} open={opened===key} onToggle={e=>{if(e.currentTarget.open)setOpened(key);else setOpened(old=>old===key?'':old);}}><summary>{i.processName} · {i.name} · {i.status} · цикл {minutes(i.cycleMinutes)}</summary>
        {opened===key&&<>
        <p>{i.processId} / {i.instanceId} · версия {i.version} · запуск {i.startedAt} · завершение {i.completedAt??'не записано'} · событий возврата {i.returnEvents}</p>
        <button disabled={!i.modelAvailable} onClick={()=>onOpenProcess(i.processId)}>Открыть текущую модель (не историческую)</button>
        <p>Проходов: {facts.length}; показано {Math.min(200,facts.length)}.</p>
        {facts.slice(0,200).map(a=><article key={JSON.stringify([a.elementId,a.iteration])}><strong>{a.name} [{a.elementId}] · проход {a.iteration} · {a.current?'текущий':'архив прохода'} · {a.status}</strong><p>{a.department} · {a.organizationBasis}</p><p>Очередь {minutes(a.queueMinutes)} · работа {minutes(a.workMinutes)} · общий факт {minutes(a.durationMinutes)} · превышение {minutes(a.overdueMinutes)}</p>{a.notes.map((n,k)=><p key={k}>{n}</p>)}</article>)}
        </>}
      </details>;})}
      <p>Пределы отчёта: 500 моделей/файлов выполнения, 20000 экземпляров, 100000 проходов, 20 МБ на файл и 100 МБ суммарно. Большой общий объём отклоняется без усечённых итогов; отдельные недоступные файлы явно исключаются.</p>
    </>}
  </section>;
}
