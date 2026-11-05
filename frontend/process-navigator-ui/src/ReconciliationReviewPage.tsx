import {useEffect,useState} from 'react';
import {loadSourceMaterials,reconciliationReviewCall} from './api';
import type {EvidenceEntry} from './evidence-register';
import type {ReconciliationReport} from './reconciliation-review';
import type {SourceMaterial} from './source-materials';

export function ReconciliationReviewPage({entry,canReview,onBack}:{entry:EvidenceEntry;canReview:boolean;onBack:()=>void}){
  const [report,setReport]=useState<ReconciliationReport>(),[sources,setSources]=useState<SourceMaterial[]>([]);
  const [error,setError]=useState(''),[sourceError,setSourceError]=useState(''),[busy,setBusy]=useState(true);
  const [reason,setReason]=useState(''),[materialId,setMaterialId]=useState(''),[revision,setRevision]=useState(0),[page,setPage]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setReport(undefined);setSources([]);setError('');setSourceError('');setReason('');setMaterialId('');setPage(0);
    const draft=entry.edition==='Draft';
    Promise.allSettled([reconciliationReviewCall(entry.processId,entry.requirementId!,draft,undefined,controller.signal),loadSourceMaterials(controller.signal)])
      .then(([review,materials])=>{if(controller.signal.aborted)return;
        if(review.status==='fulfilled')setReport(review.value);else setError(review.reason instanceof Error?review.reason.message:'Не удалось прочитать сверку.');
        if(materials.status==='fulfilled'){setSources(materials.value.materials.filter(m=>m.target.processId===entry.processId&&m.target.draft===draft));if(materials.value.unreadable||materials.value.limited)setSourceError('Список оригиналов неполный. Неразрешённые материалы не подтверждаются.');}
        else setSourceError('Оригиналы не загружены. Подтверждение недоступно.');
      }).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[entry,revision]);
  const labels={unreviewed:'Сверка не записана',reviewed:'Есть ручное подтверждение снимка',rejected:'Есть замечание по сверке',withdrawn:'Подтверждение отозвано',stale:'Модель изменилась: прежняя сверка устарела'};
  const current=report?.requirement;
  const expected=entry.requirementSnapshot;
  const matches=!!current&&!!expected&&report?.version===entry.version&&current.text===expected.text&&current.source===expected.source&&
    (current.locator??'')===(expected.locator??'')&&!!current.checkSequence===!!expected.checkSequence&&JSON.stringify(current.elementIds??[])===JSON.stringify(expected.elementIds??[]);
  const writable=canReview&&matches&&!busy;
  async function record(action:'review'|'reject'|'withdraw'){
    if(!writable||!report||!reason.trim())return;
    setBusy(true);setError('');
    try{setReport(await reconciliationReviewCall(entry.processId,entry.requirementId!,entry.edition==='Draft',
      {expectedVersion:report.version,expectedFingerprint:report.fingerprint,action,reason,previousEventId:report.history[0]?.id??null,...(action==='review'?{materialId}: {})}));setReason('');setPage(0);}
    catch(e){setReport(undefined);setError(e instanceof Error?e.message:'Сохранение не подтверждено. Обновите сведения перед повтором.');}
    finally{setBusy(false);}
  }
  const history=report?.history??[],lastPage=Math.max(0,Math.ceil(history.length/50)-1),visiblePage=Math.min(page,lastPage);
  return <main className="evidence-register reconciliation-review">
    <header><button onClick={onBack}>← Источники и вопросы</button><button disabled={busy} onClick={()=>setRevision(n=>n+1)}>Обновить сверку</button></header>
    <h1>Предметная сверка описания и маршрута</h1><h2>{entry.processName}</h2>
    <p>Пункт {entry.requirementId} · {entry.edition==='Draft'?'черновик':'действующая'} {entry.version}. Проверка пути не доказывает смысл, условия или обязательность порядка. Их вручную оценивает профиль, записывающий решение по оригиналу.</p>
    {busy&&<p role="status">Загружаем или сохраняем сверку…</p>}{error&&<p role="alert">{error}</p>}{sourceError&&<p role="alert">{sourceError}</p>}
    {report&&<><p role="status">{labels[report.state]}</p>
      {!matches&&<p role="alert">Пункт или редакция изменились/удалены. Вернитесь в реестр и обновите сведения; журнал ниже сохранён.</p>}
      {current&&<section><h3>Текущий пункт источника</h3><p className="evidence-statement">{current.text}</p><p>{current.source} · {current.locator||'Место не указано'}</p><p>Элементы: {current.elementIds?.join(' → ')||'Не сопоставлено'}; проверка пути: {current.checkSequence?'включена':'не задана'}.</p></section>}
      {!!report.gaps.length&&<section role="alert"><h3>Структурные замечания</h3><ul>{report.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul></section>}
      <label>Оригинал для подтверждения<select aria-label="Оригинал для подтверждения" value={materialId} disabled={!writable} onChange={e=>setMaterialId(e.target.value)}><option value="">Выберите сохранённый оригинал</option>{sources.map(s=><option key={s.id} value={s.id}>{s.target.name} · {s.fileName} · {s.id}</option>)}</select></label>
      <p>Сервер проверит SHA-256 и точную актуальную привязку оригинала. При изменении схемы загрузите оригинал с новой привязкой. Файл не анализируется автоматически.</p>
      <label>По какому месту и каким условиям выполнена сверка / причина замечания<textarea aria-label="Причина сверки" maxLength={2000} value={reason} disabled={!writable} onChange={e=>setReason(e.target.value)}/></label>
      <div><button disabled={!writable||!reason.trim()||!materialId||report.gaps.length>0} onClick={()=>record('review')}>Подтвердить сверку по оригиналу</button> <button disabled={!writable||!reason.trim()} onClick={()=>record('reject')}>Записать замечание</button> <button disabled={!writable||!reason.trim()||report.state!=='reviewed'} onClick={()=>record('withdraw')}>Отозвать подтверждение</button></div>
      {!canReview&&<p>Профиль может читать журнал, но не записывать решение.</p>}
      <h2>Журнал · {history.length}</h2><p>Решение привязано к снимку модели и пункту. Автор решения — профиль сеанса, не произвольное имя. Доступность оригинала проверена в момент подтверждения; для повторной проверки используйте страницу материалов. Это не подпись и не доказательство фактического исполнения.</p>
      <nav aria-label="Страницы журнала сверки"><button disabled={!visiblePage} onClick={()=>setPage(visiblePage-1)}>Назад по журналу</button> {visiblePage+1} / {lastPage+1} <button disabled={visiblePage===lastPage} onClick={()=>setPage(visiblePage+1)}>Далее по журналу</button></nav>
      {history.slice(visiblePage*50,(visiblePage+1)*50).map(event=><article key={event.id}><h3>{event.action==='review'?'Сверка подтверждена':event.action==='reject'?'Замечание':'Подтверждение отозвано'}</h3><p>{event.actorName} · {event.actorId} · {new Date(event.recordedAt).toLocaleString('ru-RU')} · {event.draft?'Черновик':'Действующая'} {event.version}</p><p className="evidence-statement">{event.requirement.text}</p><p>{event.requirement.source} · {event.requirement.locator}</p><p className="evidence-statement">{event.reason}</p>{event.material&&<p>Оригинал: {event.material.fileName} · {event.material.id} · SHA-256 {event.material.sha256}</p>}<small>Снимок: {event.fingerprint}</small></article>)}
      {!history.length&&<p>Решения ещё не записывались.</p>}
    </>}
  </main>;
}
