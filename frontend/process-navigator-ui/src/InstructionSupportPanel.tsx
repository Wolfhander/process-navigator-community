import { useEffect, useRef, useState } from 'react';
import { loadAssignments, probeInstructionArtifact } from './api';
import type { ProcessAssignments, ProcessInstance, ProcessModel, ProcessNode } from './types';
import { checkInstructionMaterials, instructionAssignment, materialKey, type MaterialCheck } from './instruction-support';

export function InstructionSupportPanel({process,instance,onSelect}:{process:ProcessModel;instance?:ProcessInstance;onSelect:(node:ProcessNode)=>void}) {
  const [assignments,setAssignments]=useState<ProcessAssignments>();
  const [materials,setMaterials]=useState<Record<string,MaterialCheck>>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [checkedAt,setCheckedAt]=useState('');
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(0);
  const controller=useRef<AbortController|undefined>(undefined);
  useEffect(()=>{
    controller.current?.abort();setAssignments(undefined);setMaterials(undefined);setBusy(false);setError('');setCheckedAt('');setPage(0);
    return()=>controller.current?.abort();
  },[process]);
  const check=async()=>{
    controller.current?.abort();const request=new AbortController();controller.current=request;
    setBusy(true);setError('');setAssignments(undefined);setMaterials(undefined);setCheckedAt('');
    const outcomes=await Promise.allSettled([
      loadAssignments(process.id,request.signal),
      checkInstructionMaterials(process,probeInstructionArtifact,request.signal)
    ]);
    if(request.signal.aborted)return;
    const errors:string[]=[];
    if(outcomes[0].status==='fulfilled')setAssignments(outcomes[0].value);
    else errors.push('Назначения не загружены: '+String(outcomes[0].reason?.message ?? outcomes[0].reason));
    if(outcomes[1].status==='fulfilled')setMaterials(outcomes[1].value);
    else errors.push('Материалы не проверены: '+String(outcomes[1].reason?.message ?? outcomes[1].reason));
    setError(errors.join(' '));setCheckedAt(new Date().toISOString());setBusy(false);
  };
  const needle=query.trim().toLocaleLowerCase('ru-RU');
  const nodes=process.nodes.filter(node=>node.type==='task'&&(!needle||[node.name,node.id,...(node.artifacts??[]).map(a=>a.name)].join(' ').toLocaleLowerCase('ru-RU').includes(needle)));
  const pages=Math.max(1,Math.ceil(nodes.length/100));
  const activePage=Math.min(page,pages-1);
  const statuses=materials?Object.values(materials):[];
  return <section className="instruction-card"><h2>Подготовка к работе: сотрудники и материалы</h2>
    <p>Схема — открытой редакции. Назначения сотрудников и доступность материалов — текущие сведения на момент проверки, не исторический снимок и не подтверждение исполнения. Назначение на дорожку не равно персональному назначению шага.</p>
    <p>Проверяются только точные версии ссылок artifact: в локальном репозитории, без скачивания содержимого (HEAD). Внешние адреса и файлы не открываются. Доступность не подтверждает содержание, актуальность или право редактирования.</p>
    <div className="instruction-support-controls"><button disabled={busy} onClick={()=>void check()}>{busy?'Проверяем…':'Обновить назначения и проверить материалы'}</button>{busy&&<button onClick={()=>{controller.current?.abort();setBusy(false);}}>Отменить</button>}</div>
    {checkedAt?<p>Проверка завершена: {checkedAt}. Доступных точных версий: {statuses.filter(s=>s.status==='available').length} из {statuses.length} уникальных ссылок. Остальные статусы раскрыты ниже.</p>:<p>Проверка ещё не завершена. Незагруженные сведения не означают отсутствие сотрудников или материалов.</p>}
    {error&&<p role="alert">{error}</p>}
    <div className="instruction-support-controls"><label>Поиск по шагам и материалам<input value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/></label><span>В документе страница {activePage+1} из {pages}; показано до 100 из {nodes.length} найденных действий. Поиск: {query||'не задан'}.</span></div>
    {nodes.length>100&&<p className="instruction-warning">НЕПОЛНАЯ ВЫБОРКА ПОДГОТОВКИ: напечатана только текущая страница действий.</p>}
    {nodes.length>100&&<nav className="instruction-pagination" aria-label="Страницы подготовки"><button disabled={!activePage} onClick={()=>setPage(activePage-1)}>Назад</button><button disabled={activePage+1===pages} onClick={()=>setPage(activePage+1)}>Далее</button></nav>}
    {nodes.slice(activePage*100,(activePage+1)*100).map(node=>{
      const assignment=instructionAssignment(process,node,assignments,instance);
      return <article key={node.id}><h3><button onClick={()=>onSelect(node)}>{node.name||node.id}</button></h3>
        <p>Текущие назначения дорожки: {assignment.lane}</p><p>Персональное назначение {assignment.instanceName?'экземпляра «'+assignment.instanceName+'»':''}: {assignment.personal}</p>
        {node.executorKind==='system'&&<p>Исполнитель — система. Назначенный сотрудник не объявляется исполнителем автоматического действия.</p>}
        {(node.artifacts??[]).slice(0,50).map((artifact,index)=><p key={index}><strong>{artifact.name}</strong> · версия {artifact.version||'не задана'} · {materials?.[materialKey(artifact)]?.message??'Не проверено.'}</p>)}
        {(node.artifacts?.length??0)>50&&<p className="instruction-warning">Показаны первые 50 материалов шага; сведения на странице неполные.</p>}
        {!node.artifacts?.length&&<p>Материалы в модели не перечислены. Это не подтверждение, что они не требуются.</p>}
      </article>;
    })}
    {!nodes.length&&<p>Действия по фильтру не найдены.</p>}
    <p>Не более трёх одновременных проверок, до 200 уникальных запросов. Условия выполнения и обязательные статусы документов этим разделом не проверяются. Сквозной HTML сохраняет данные моделей, а не текущие результаты этой проверки.</p>
  </section>;
}
