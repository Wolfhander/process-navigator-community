import {useEffect,useState} from 'react';
import {draftRepairCall} from './api';
import type {RepairChoice,RepairScan,RepairRequest,RepairPlan,RepairResult} from './draft-repairs';
import './draft-lane-sync.css';
const ownerKey=(id:string)=>JSON.stringify([id,'owner']);
const linkKey=(id:string,element:string)=>JSON.stringify([id,'link',element]);
export function DraftRepairPage({onBack,onSaved}:{onBack:()=>void;onSaved:()=>void}){
  const [scan,setScan]=useState<RepairScan>(),[choices,setChoices]=useState<Record<string,RepairChoice>>({}),[plan,setPlan]=useState<{request:RepairRequest;preview:RepairPlan}>();
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0),[result,setResult]=useState<RepairResult>();
  useEffect(()=>{const c=new AbortController();setBusy(true);setError('');setScan(undefined);setChoices({});setPlan(undefined);
    draftRepairCall<RepairScan>('',undefined,c.signal).then(setScan).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});return()=>c.abort();
  },[reload]);
  function choose(key:string,choice?:RepairChoice){setPlan(undefined);setChoices(old=>{const next={...old};if(choice)next[key]=choice;else delete next[key];return next;});}
  async function run(apply=false){if(!scan)return;setBusy(true);setError('');
    try{
      if(apply&&plan){setResult(await draftRepairCall<RepairResult>('/apply',{request:plan.request,proof:plan.preview.proof}));setScan(undefined);setChoices({});setPlan(undefined);onSaved();}
      else{const request={baseFingerprint:scan.fingerprint,choices:Object.values(choices)};const preview=await draftRepairCall<RepairPlan>('/preview',request);setPlan({request,preview});}
    }catch(e){setError(e instanceof Error?e.message:'Ошибка исправления.');setPlan(undefined);setScan(undefined);setChoices({});}
    finally{setBusy(false);}
  }
  return <main className="draft-lane-plan"><div className="draft-lane-plan-content">
    <nav><button disabled={busy} onClick={onBack}>Назад к исправлениям дорожек</button></nav><h1>Владельцы и потерянные связи</h1>
    <p>Только неназначенные владельцы и ссылки этапов на отсутствующие модели. Выберите подразделение или явную замену/очистку. По умолчанию изменений нет. Удаление связи сохраняет этап и обе модели.</p>
    <p>До 100 моделей в фонде и 500 решений. Проверяется весь выбранный граф, затем создаётся резервная копия. Изменения применяются по процессам, не общей транзакцией; после сбоя проверьте результат и резервные копии. Архивные и действующие файлы не меняются.</p>
    <button disabled={busy} onClick={()=>setReload(v=>v+1)}>Загрузить актуальный список</button>
    {busy&&<p role="status">Выполняется операция…</p>}{error&&<p role="alert">{error} Загрузите список заново.</p>}
    {result&&<section><h2>Последний результат</h2><p>Резервная копия: <code>{result.backupFileName}</code></p>{result.items.map(i=><p key={i.processId}>{i.processId}: {i.status==='Updated'?'Обновлён':'Пропущен'} {i.reason}</p>)}</section>}
    {scan&&<><p>Кандидатов: {scan.items.length}. Выбрано решений: {Object.keys(choices).length}.</p>{!scan.items.length&&<p>В доступных черновиках нет подходящих неназначенных владельцев или потерянных ссылок.</p>}
      {scan.items.map(i=><article key={i.processId}><h2>{i.processName}</h2><code>{i.processId}</code>{i.reason&&<p>Недоступен: {i.reason}</p>}
        {i.missingOwner&&<label>Подразделение-владелец<select aria-label={'Владелец '+i.processId} disabled={busy||!!i.reason} value={JSON.stringify([choices[ownerKey(i.processId)]?.legalEntityId??'',choices[ownerKey(i.processId)]?.unitId??''])} onChange={e=>{
          const [legalEntityId,unitId]=JSON.parse(e.target.value);choose(ownerKey(i.processId),unitId?{processId:i.processId,kind:'owner',legalEntityId,unitId}:undefined);
        }}><option value={JSON.stringify(['',''])}>Не менять</option>{scan.units.map(u=><option key={JSON.stringify([u.entityId,u.unitId])} value={JSON.stringify([u.entityId,u.unitId])}>{u.entityName} / {u.unitName}</option>)}</select></label>}
        {i.links.map(l=><label key={l.elementId}>{l.elementName} [{l.elementId}] → отсутствует {l.targetId}
          <select aria-label={'Связь '+i.processId+' '+l.elementId} disabled={busy||!!i.reason} value={choices[linkKey(i.processId,l.elementId)]?.clear?'clear':choices[linkKey(i.processId,l.elementId)]?.targetId?'target:'+choices[linkKey(i.processId,l.elementId)].targetId:''} onChange={e=>choose(linkKey(i.processId,l.elementId),!e.target.value?undefined:{processId:i.processId,kind:'link',elementId:l.elementId,...(e.target.value==='clear'?{clear:true}:{targetId:e.target.value.slice(7)})})}>
            <option value="">Не менять</option><option value="clear">Удалить только связь детализации</option>{scan.targets.filter(t=>t.id!==i.processId).map(t=><option key={t.id} value={'target:'+t.id}>{t.name} [{t.id}]</option>)}
          </select></label>)}
      </article>)}
      <button disabled={busy||!Object.keys(choices).length} onClick={()=>void run()}>Подготовить план без записи</button>
      {plan&&<section><h2>Проверьте план</h2>{plan.preview.changes.map((c,index)=><p key={index}><strong>{c.processName}</strong> {c.elementId??'Владелец'}: {c.before||'(пусто)'} → {c.after}</p>)}
        <button disabled={busy} onClick={()=>void run(true)}>Создать резервную копию и применить план</button></section>}
    </>}
  </div></main>;
}
