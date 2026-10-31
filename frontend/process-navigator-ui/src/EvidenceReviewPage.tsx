import {useEffect,useState} from 'react';
import {evidenceReviewCall,type EvidenceReviewReport} from './api';
import type {EvidenceEntry} from './evidence-register';

export function EvidenceReviewPage({entry,canReview,onBack}:{entry:EvidenceEntry;canReview:boolean;onBack:()=>void}){
  const [report,setReport]=useState<EvidenceReviewReport>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [reason,setReason]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [page,setPage]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setError('');setReport(undefined);
    evidenceReviewCall(entry.processId,entry.elementId,entry.edition==='Draft',undefined,controller.signal).then(value=>{if(!controller.signal.aborted){setReport(value);setPage(0);}}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Сведения недоступны.');}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[entry,refresh]);
  const current=report?.entries.find(e=>e.index===entry.index);
  const matches=!!report&&report.version===entry.version&&!!current&&(['status','statement','source','locator','author'] as const).every(key=>(current.evidence[key]??'').trim()===(entry[key]??'').trim());
  const writable=canReview&&matches&&current?.evidence.status==='fact'&&!!current.evidence.source?.trim()&&!busy;
  const stateNames={unreviewed:'Проверка не записана',reviewed:'Есть проверка данного снимка',stale:'Модель изменилась: прежняя проверка устарела',withdrawn:'Проверка отозвана'};
  const history=report?.history??[],lastPage=Math.max(0,Math.ceil(history.length/50)-1),currentPage=Math.min(page,lastPage);
  async function record(action:'review'|'withdraw'){
    if(!current||!writable||!reason.trim())return;
    setBusy(true);setError('');
    try{setReport(await evidenceReviewCall(entry.processId,entry.elementId,entry.edition==='Draft',{index:current.index,expectedVersion:report!.version,expectedFingerprint:current.fingerprint,action,reason}));setReason('');setPage(0);}
    catch(e){setReport(undefined);setError(e instanceof Error?e.message:'Запись не выполнена. Обновите сведения перед повтором.');}
    finally{setBusy(false);}
  }
  return <main className="evidence-register">
    <header><button onClick={onBack}>← Источники и вопросы</button><button disabled={busy} onClick={()=>setRefresh(x=>x+1)}>Обновить проверку</button></header>
    <h1>История проверки основания</h1><h2>{entry.processName} · {entry.elementName}</h2>
    <p>{entry.edition==='Draft'?'Черновик':'Действующая модель'} · {entry.version}. Проверка относится к точному снимку модели и основания. Любое изменение модели делает запись неактуальной для нового снимка; это не электронная подпись и не доказательство физического факта.</p>
    <p>Автор сведений в тексте и профиль, записавший проверку, — разные поля. Учитывается профиль текущего сеанса, а не произвольное имя из формы.</p>
    {busy&&<p role="status">Загружаем или сохраняем проверку…</p>}{error&&<p role="alert">{error}</p>}
    {report&&<><section className="evidence-review-current"><h3>Выбранное основание</h3><p className="evidence-statement">{entry.statement}</p><p>Источник: {entry.source||'не указан'} · {entry.locator||'место не указано'}</p>
      {!matches?<p role="alert">Основание или версия изменились либо запись удалена. Вернитесь в реестр и обновите его; история ниже сохранена.</p>:<p role="status">{stateNames[current!.state]}</p>}
      {!canReview&&<p>Текущий профиль может читать историю, но не записывать проверки.</p>}
      <label>По какому источнику проверено / причина отзыва<textarea value={reason} maxLength={2000} disabled={!writable} onChange={e=>setReason(e.target.value)}/></label>
      <div><button disabled={!writable||!reason.trim()} onClick={()=>record('review')}>Записать проверку факта</button> <button disabled={!writable||!reason.trim()||current?.state!=='reviewed'} onClick={()=>record('withdraw')}>Отозвать проверку с причиной</button></div>
    </section>
    <h2>Журнал шага · {history.length}</h2><p>Показаны записи доступных редакций этого шага, включая прежние версии и основания. Черновые записи не выдаются при просмотре действующей модели. Хранится до 1000 записей / 8 МБ на модель, без автоматического удаления. Рабочие записи не переносятся в ZIP/XLSX.</p>
    <nav aria-label="Страницы истории"><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>Назад по истории</button> Страница {currentPage+1} из {lastPage+1} <button disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>Далее по истории</button></nav>
    {!history.length&&<p>Записей проверки пока нет.</p>}
    <div className="evidence-entries">{history.slice(currentPage*50,(currentPage+1)*50).map(event=><article key={event.id}><h3>{event.action==='review'?'Проверка записана':'Проверка отозвана'}</h3><p>{event.actorName} · {event.actorId} · {new Date(event.recordedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</p><p>{event.draft?'Черновик':'Действующая'} · {event.version} · основание {event.index+1}</p><p className="evidence-statement">{event.evidence.statement}</p><p>Источник: {event.evidence.source} · {event.evidence.locator}</p><p>Автор сведений: {event.evidence.author||'не указан'}</p><p className="evidence-statement">Основание проверки: {event.reason}</p><small>Снимок: {event.fingerprint}</small></article>)}</div></>}
  </main>;
}
