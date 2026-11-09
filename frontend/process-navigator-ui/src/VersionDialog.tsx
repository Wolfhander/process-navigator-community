import {WorkspaceToolPage} from './WorkspaceToolPage';
import {pageReadRequest} from './page-read-request';
import {PageReadState} from './PageReadState';
import { useEffect, useState } from 'react';
import { Clock3, X } from 'lucide-react';
import { loadArchivedProcess, loadProcess, loadVersions } from './api';
import {compareRoutes, type RouteChange} from './route-comparison';
import type { ProcessVersion } from './types';

const statusName: Record<ProcessVersion['status'], string> = {
  Published: 'Действует', Draft: 'Черновик', Archived: 'Архив'
};

function RouteComparison({processId,versions}:{processId:string;versions:ProcessVersion[]}) {
  const [from,setFrom]=useState(1);
  const [to,setTo]=useState(0);
  const [request,setRequest]=useState<{from:number;to:number}>();
  const [result,setResult]=useState<RouteChange[]>();
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!request) return;
    const load=(index:number,signal:AbortSignal)=>{
      const edition=versions[index];
      return edition.status==='Archived'?loadArchivedProcess(processId,edition.version,signal)
        :loadProcess(processId,signal,edition.status==='Draft');
    };
    return pageReadRequest(async signal=>{
      const [a,b]=await Promise.all([load(request.from,signal),load(request.to,signal)]);
      if(a.version!==versions[request.from].version || b.version!==versions[request.to].version)
        throw new Error('Список редакций устарел. Откройте историю заново.');
      return compareRoutes(a,b);
    },setResult,setError);
  },[request,processId,versions]);
  function reset(){setRequest(undefined);setResult(undefined);setError('');}
  function compare(){setResult(undefined);setError('');setRequest({from,to});}
  return <section aria-label="Сравнение маршрутов">
    <h3>Сравнение маршрутов</h3>
    <p>Сравниваются дорожки, элементы и переходы по BPMN ID. Геометрия и инструкции не сравниваются. Данные не изменяются.</p>
    <div className="route-comparison-controls">
      {([['Исходная редакция',from,setFrom],['Сравниваемая редакция',to,setTo]] as const).map(([label,value,change])=>
        <label key={label}>{label}<select value={value} onChange={event=>{reset();change(Number(event.target.value));}}>
          {versions.map((v,i)=><option key={i} value={i}>{v.version} — {statusName[v.status]}</option>)}
        </select></label>)}
      <button type="button" onClick={compare} disabled={from===to}>Сравнить</button>
    </div>
    {request&&!result&&<PageReadState error={error} loading="Сравниваем редакции…" onRetry={compare}/>}
    {result&&<div aria-live="polite">
      <p>{result.length?'Отличий: '+result.length:'Отличий маршрута не найдено.'}</p>
      {result.length>200&&<p>Показано первых 200 отличий.</p>}
      {result.length>0&&<ul>{result.slice(0,200).map(item=><li key={item.group+':'+item.id}>
        <strong>{item.group} · {item.id} · {{added:'Добавлено',removed:'Удалено',changed:'Изменено'}[item.kind]}</strong>
        {item.before!==undefined&&<div>Было: {item.before}</div>}
        {item.after!==undefined&&<div>Стало: {item.after}</div>}
      </li>)}</ul>}
    </div>}
  </section>;
}

export function VersionDialog({ processId, processName, onClose, onOpen }: { processId: string; processName: string; onClose: () => void; onOpen: (version: ProcessVersion) => void }) {
  const [versions, setVersions] = useState<ProcessVersion[]>();
  const [error, setError] = useState('');
  const [revision,setRevision]=useState(0);
  useEffect(() => {setVersions(undefined);setError('');return pageReadRequest(signal=>loadVersions(processId,signal),setVersions,setError);}, [processId,revision]);
  return <WorkspaceToolPage title="История версий процесса" onBack={onClose}>
    <section className="import-dialog version-dialog" role="region" aria-labelledby="version-title">
      <button className="icon-button dialog-close" onClick={onClose} aria-label="Закрыть"><X size={18}/></button>
      <span className="eyebrow">История процесса</span><h2 id="version-title">{processName}</h2>
      {!versions&&<PageReadState error={error} loading="Загружаем редакции…" onRetry={()=>setRevision(n=>n+1)}/>}
      {versions&&!versions.length&&<p role="status">Доступных редакций нет. Вернитесь к каталогу и проверьте выбранный процесс.</p>}
      {versions&&versions.length>1&&<RouteComparison key={processId} processId={processId} versions={versions}/>}
      {versions && <div className="version-list">{versions.map(version => <button type="button" className={`version-row is-${version.status.toLowerCase()}`} key={`${version.status}-${version.version}`} onClick={() => onOpen(version)}><Clock3 size={18}/><div><strong>Версия {version.version}</strong><small>{new Date(version.createdAt).toLocaleString('ru-RU')}</small></div><span>{statusName[version.status]}</span></button>)}</div>}
    </section>
  </WorkspaceToolPage>;
}
