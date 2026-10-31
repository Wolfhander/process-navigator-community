import {useEffect,useState} from 'react';
import {ArrowLeft,RefreshCw} from 'lucide-react';
import {previewDraftLaneNames,syncDraftLaneNames,type LanePlan} from './api';
import type {DraftLaneSyncReport} from './types';
import './draft-lane-sync.css';
export function DraftLaneSyncDialog({onClose,onSynced,onMetadata}:{onClose:()=>void;onSynced:()=>void;onMetadata?:()=>void}){
  const [plan,setPlan]=useState<LanePlan>(),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const [result,setResult]=useState<{backupFileName:string;report:DraftLaneSyncReport}>();
  useEffect(()=>{const c=new AbortController();setBusy(true);setError('');setPlan(undefined);setSelected([]);
    previewDraftLaneNames(c.signal).then(setPlan).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});
    return()=>c.abort();
  },[reload]);
  async function apply(){if(!plan||!selected.length)return;setBusy(true);setError('');
    try{setResult(await syncDraftLaneNames(plan,selected));setPlan(undefined);setSelected([]);onSynced();}
    catch(e){setError(e instanceof Error?e.message:'Не удалось применить план.');setPlan(undefined);setSelected([]);}
    finally{setBusy(false);}
  }
  return <section className="draft-lane-plan" aria-label="Обновление дорожек черновиков"><div className="draft-lane-plan-content">
    <nav><button disabled={busy} onClick={onClose}><ArrowLeft size={16}/>Назад к настройкам</button></nav>
    <h1>План обновления дорожек</h1>
    {onMetadata&&<button disabled={busy} onClick={onMetadata}>Исправить владельцев и потерянные связи</button>}
    <p>Просмотрите точные изменения и выберите черновики. Владельцы, ссылки, опубликованные редакции, идентификаторы, переходы и координаты не изменяются.</p>
    <p>Перед применением создаётся резервная копия. Каждый черновик проверяется повторно; заблокированные и изменённые пропускаются. Пакет не является общей транзакцией: уже выполненные изменения сохраняются при последующей ошибке. Для восстановления используйте раздел резервных копий.</p>
    <button disabled={busy} onClick={()=>setReload(v=>v+1)}><RefreshCw size={15}/>Подготовить новый просмотр</button>
    {busy&&<p role="status">Выполняется операция…</p>}{error&&<p role="alert">{error} Для продолжения подготовьте новый просмотр.</p>}
    {result&&<section><h2>Последний результат</h2><p>Обновлено: {result.report.updatedProcesses}; дорожек: {result.report.renamedLanes}.</p><p>Резервная копия: <code>{result.backupFileName}</code></p>
      {result.report.items.map(i=><p key={i.processId}>{i.processName} · {i.status==='Updated'?'Обновлён':'Пропущен'} · {i.reason??i.renamedLanes}</p>)}</section>}
    {plan&&<><p>Черновиков с оргпривязками: {plan.items.length}. Выбрано: {selected.length}. Просмотр ничего не записывает.</p>
      {plan.items.map(i=><article key={i.processId}><label><input type="checkbox" disabled={busy||!!i.reason||!i.changes.length} checked={selected.includes(i.processId)} onChange={e=>setSelected(v=>e.target.checked?[...v,i.processId]:v.filter(id=>id!==i.processId))}/><strong>{i.processName}</strong> <code>{i.processId}</code></label>
        {i.reason?<p>Пропущен: {i.reason}</p>:!i.changes.length?<p>Названия уже актуальны.</p>:<ul>{i.changes.map(c=><li key={c.laneId}><code>{c.laneId}</code>: <span>{c.before||'(пусто)'}</span> → <strong>{c.after}</strong></li>)}</ul>}
      </article>)}
      <button disabled={busy||!selected.length} onClick={()=>void apply()}>Создать резервную копию и применить выбранное ({selected.length})</button>
    </>}
  </div></section>;
}
