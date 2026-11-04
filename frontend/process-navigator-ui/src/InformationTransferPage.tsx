import {useEffect,useMemo,useState} from 'react';
import {loadOrganization,loadProcess} from './api';
import {informationTransfers} from './information-transfers';
import {explicitTransferChannels,filterTransfers,summarizeTransfers,transferCsv,transferFacts,transferPage} from './information-transfer-report';
import type {InformationObject,InformationObjectOccurrence,OrganizationMap,ProcessModel} from './types';
import {transferRouteEvidence,transferRouteLabels,type TransferRoute} from './transfer-route-evidence';

export function InformationTransferPage({objects,registryGeneratedAt,onBack,onOpen}:{objects:InformationObject[];registryGeneratedAt?:string;onBack:()=>void;onOpen:(value:InformationObjectOccurrence)=>void}){
  const [query,setQuery]=useState('');
  const [models,setModels]=useState<Record<string,ProcessModel>>({});
  const [organization,setOrganization]=useState<OrganizationMap>();
  const [loading,setLoading]=useState(true);
  const [failures,setFailures]=useState<string[]>([]);
  const [page,setPage]=useState(0);
  const [view,setView]=useState<'pairs'|'objects'>('pairs');
  const [error,setError]=useState('');
  const [routeFilter,setRouteFilter]=useState<TransferRoute|'all'>('all');
  const result=useMemo(()=>informationTransfers(objects),[objects]);
  const ids=useMemo(()=>[...new Set(result.rows.flatMap(row=>[row.source?.processId,row.target?.processId]).filter((id):id is string=>!!id))],[result]);
  useEffect(()=>{
    const controller=new AbortController(),loaded:Record<string,ProcessModel>=Object.create(null),errors:string[]=[];let next=0;
    setLoading(true);setModels({});setOrganization(undefined);setFailures([]);setPage(0);
    const worker=async()=>{while(next<Math.min(ids.length,200)&&!controller.signal.aborted){const id=ids[next++];try{loaded[id]=await loadProcess(id,controller.signal);}catch{if(!controller.signal.aborted)errors.push(id);}}};
    const org=loadOrganization(controller.signal).then(value=>{if(!controller.signal.aborted)setOrganization(value);}).catch(()=>{if(!controller.signal.aborted)errors.push('Оргструктура');});
    Promise.all([org,...Array.from({length:Math.min(3,ids.length)},worker)]).then(()=>{if(!controller.signal.aborted){setModels(loaded);setFailures(errors);setLoading(false);}});
    return()=>controller.abort();
  },[ids]);
  const facts=useMemo(()=>transferFacts(result.rows,models,organization),[result,models,organization]);
  const routes=useMemo(()=>transferRouteEvidence(result.rows,models),[result,models]);
  const visible=useMemo(()=>filterTransfers(result.rows,query,facts).filter(row=>routeFilter==='all'||routes.get(row)===routeFilter),[result,query,facts,routes,routeFilter]);
  const summary=useMemo(()=>summarizeTransfers(visible),[visible]);
  const pairsPage=transferPage(visible,page),objectsPage=transferPage(summary,page);
  const current=view==='pairs'?pairsPage:objectsPage;
  function download(){
    setError('');
    try{
      const csv=transferCsv(visible,facts,{generatedAt:new Date().toISOString(),registryGeneratedAt,query,built:result.rows.length,limited:result.limited,modelLimit:ids.length>200,failures,routes,routeFilter});
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));setTimeout(()=>URL.revokeObjectURL(url),1000);
      const link=document.createElement('a');link.href=url;link.download='information-transfers.csv';link.click();
    }catch{setError('Не удалось выгрузить матрицу передач.');}
  }
  function endpoint(objectId:string,value?:InformationObjectOccurrence){
    if(!value)return <p>Не указан в реестре</p>;
    const f=facts.get(value);
    const exact=explicitTransferChannels(objectId,value,facts);
    return <div><button onClick={()=>onOpen(value)}>{value.processName} · {value.elementName||'Паспорт'}</button><p><code>{value.processId} / {value.elementId||'паспорт'}</code></p><p>{f?.responsibility||'Подразделение не установлено'}</p><p>Системы этапа: {f?.systems.join(' · ')||'не указаны'}</p><p>Каналы этапа: {f?.channels.map(c=>[c.kind,c.direction,c.label,c.documentName].filter(Boolean).join(': ')).join(' · ')||'не указаны'}</p><p>Каналы этого объекта по ID: {exact.map(c=>[c.label,c.kind,c.flow].join(' · ')).join('; ')||'не назначены'}</p><small>{value.required?'Обязательный':'Необязательный'} · {value.condition||'условие не указано'} · версия {value.version||'не указана'}</small>{!f?.available&&!loading&&<p>Сведения модели недоступны</p>}</div>;
  }
  return <main className="feature-page information-registry"><div className="feature-page-shell">
    <nav className="feature-breadcrumb" aria-label="Путь матрицы"><button onClick={onBack}>← Документы и результаты</button><span>› Матрица передач</span></nav>
    <h1>Матрица передач</h1>
    <p>Пары строятся по ID объекта. Для двух этапов одной модели проверяется направленный путь BPMN. Найденный путь не подтверждает выбор ветви, совместимость версий документа или фактическую передачу. Для разных моделей такая проверка не выполняется. Сводка не является количеством фактических отправок.</p>
    <div className="transfer-controls"><label>Поиск по ID, объекту, процессу, подразделению, системе или каналу<input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>
      <label>Представление<select value={view} onChange={e=>{setView(e.target.value as typeof view);setPage(0);}}><option value="pairs">Возможные пары</option><option value="objects">Сводка по объектам</option></select></label>
      <label>Путь BPMN<select value={routeFilter} disabled={loading} onChange={e=>{setRouteFilter(e.target.value as typeof routeFilter);setPage(0);}}><option value="all">Все результаты</option>{Object.entries(transferRouteLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <button disabled={loading} onClick={download}>Скачать найденные пары CSV</button>
    </div>
    {loading&&<p role="status">Загружаются сведения этапов… Выгрузка доступна после завершения загрузки.</p>}
    {failures.length>0&&<p role="alert">Часть сведений недоступна: {failures.join(', ')}. Они останутся явно недоступными и в CSV.</p>}
    {(result.limited||ids.length>200)&&<p role="alert">Достигнут предел: 1000 построенных пар или 200 загруженных моделей. Поиск, сводка и CSV охватывают только построенную выборку. Уточните фильтры в реестре.</p>}
    {error&&<p role="alert">{error}</p>}
    <p role="status">Найдено пар: {visible.length} из {result.rows.length} построенных · объектов: {summary.length} · без источника: {summary.filter(g=>g.missingSource).length} · без получателя: {summary.filter(g=>g.missingTarget).length}. CSV включает все найденные пары, не только текущую страницу.</p>
    <nav className="transfer-pagination" aria-label="Страницы матрицы">
      <button disabled={current.index===0} onClick={()=>setPage(current.index-1)}>Предыдущая страница</button>
      <span>Страница {current.index+1} из {current.pages} · до 100 строк</span>
      <button disabled={current.index+1>=current.pages} onClick={()=>setPage(current.index+1)}>Следующая страница</button>
    </nav>
    <div className="transfer-table"><table>
      {view==='pairs'?<><thead><tr><th scope="col">Документ / результат</th><th scope="col">Источник</th><th scope="col">Получатель</th></tr></thead><tbody>{pairsPage.rows.map((row,index)=><tr key={index}>
        <td>{row.object.name}<p><code>{row.object.id}</code></p><p>{loading?'Проверяем путь…':transferRouteLabels[routes.get(row)??'unknown']}</p><p>Внешний источник: {row.object.externalSource||'не указан'}</p><p>Внешний получатель: {row.object.externalRecipient||'не указан'}</p>{row.object.producers.length>1&&<strong>Несколько возможных источников</strong>}</td><td>{endpoint(row.object.id,row.source)}</td><td>{endpoint(row.object.id,row.target)}</td>
      </tr>)}</tbody></>:<><thead><tr><th scope="col">Объект</th><th scope="col">Пары в выборке</th><th scope="col">Источники / получатели в выборке</th></tr></thead><tbody>{objectsPage.rows.map(g=><tr key={g.id}><td>{g.name}<p><code>{g.id}</code></p></td><td>{g.pairs}</td><td>{g.sources} / {g.targets}{g.missingSource&&<p>Источник не указан</p>}{g.missingTarget&&<p>Получатель не указан</p>}</td></tr>)}</tbody></>}
    </table></div>
    {!visible.length&&<p>Передачи по выбранным условиям не найдены. Это не подтверждает отсутствие передач в непостроенной части фонда.</p>}
  </div></main>;
}
