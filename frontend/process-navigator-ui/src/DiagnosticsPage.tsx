import {useEffect,useState} from 'react';
import {loadDiagnostics} from './api';
import {diagnosticEvents,diagnosticPackageJson,diagnosticFailureLabels,type DiagnosticPackage} from './request-diagnostics';
import './diagnostics.css';
export function DiagnosticsPage({onBack}:{onBack:()=>void}){
  const [data,setData]=useState<DiagnosticPackage>(),[error,setError]=useState(''),[reload,setReload]=useState(0),[query,setQuery]=useState(''),[failures,setFailures]=useState(true),[page,setPage]=useState(0);
  useEffect(()=>{const c=new AbortController();setData(undefined);setError('');setPage(0);loadDiagnostics(c.signal).then(setData).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[reload]);
  let rows=data?.events??[],filterError='';try{if(data)rows=diagnosticEvents(data,query,failures);}catch(e){filterError=e instanceof Error?e.message:'Некорректный код';rows=[];}
  const pages=Math.max(1,Math.ceil(rows.length/50)),currentPage=Math.min(page,pages-1);
  function download(){if(!data)return;try{const json=diagnosticPackageJson(data);const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='process-navigator-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e instanceof Error?e.message:'Выгрузка остановлена.');}}
  return <main className="diagnostics-page"><div className="diagnostics-content"><nav><button onClick={onBack}>Назад к настройкам</button></nav><h1>Диагностика и коды операций</h1>
    <p>При ошибке сохраните её код операции и найдите его здесь. Журнал содержит только время UTC, сгенерированный сервером код, метод, общую категорию API, статус и длительность. Запросы и ответы, имена пользователей, заголовки, адреса, параметры, пути и тексты исключений не записываются.</p>
    <p>Это не аудит бизнес-действий. Хранятся последние 1000 завершённых API-запросов только в памяти текущего сервера. После перезапуска журнал пуст; старые события вытесняются с явным счётчиком. Нет автоматической отправки кому-либо. Ошибка сети до ответа сервера может не иметь кода.</p>
    <button onClick={()=>setReload(v=>v+1)}>Обновить срез</button>{!data&&!error&&<p role="status">Читаем технический журнал…</p>}{error&&<p role="alert">{error}</p>}
    {data&&<><p>Программа {data.applicationVersion} · .NET {data.runtimeVersion} · {data.architecture}. Запуск сервера UTC: {data.serverStartedAt}. Срез UTC: {data.generatedAt}.</p>
      <p>Всего завершённых запросов с запуска: {data.totalRequests}; с отказами/сбоями: {data.totalFailures}; вытеснено: {data.discardedEvents}; в срезе: {data.events.length}. Текущий запрос получения пакета завершается после формирования среза и появится в следующем.</p>
      <p>Код получения этого среза: <code>{data.requestOperationId}</code></p><button onClick={download}>Выгрузить весь безопасный пакет JSON</button>
      <p>Выгрузка включает весь показанный сервером срез, независимо от фильтров и страницы. Не добавляйте к нему полные консольные журналы или собственные документы без отдельной проверки конфиденциальности.</p>
      <div className="diagnostics-filters"><label>Код операции или начало кода<input value={query} maxLength={32} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label><label><input type="checkbox" checked={failures} onChange={e=>{setFailures(e.target.checked);setPage(0);}}/>Только отказы и сбои</label></div>
      {filterError&&<p role="alert">{filterError}</p>}<p>Найдено: {rows.length}. Страница {currentPage+1} из {pages}; по 50 событий.</p>
      {!rows.length&&<p>В этом срезе подходящих событий нет. Событие могло быть вытеснено, относиться к другому серверу или предшествовать перезапуску.</p>}
      {rows.slice(currentPage*50,(currentPage+1)*50).map(e=><article key={e.operationId}><code>{e.operationId}</code><p>UTC {e.at} · {e.method} · {e.category} · HTTP {e.status} · {e.elapsedMilliseconds} мс</p><p>Категория результата: {diagnosticFailureLabels[e.failure]??'Неизвестный результат'}</p></article>)}
      <button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>Предыдущие</button><button disabled={currentPage+1>=pages} onClick={()=>setPage(currentPage+1)}>Следующие</button>
    </>}
  </div></main>;
}
