import {useEffect,useState} from 'react';
import {ArrowLeft,Download,RefreshCw} from 'lucide-react';
import {tableReferences} from './api';
import {referenceChoices,referenceGroups,referenceLabels,referenceOccurrencesCsv,type ReferenceReport,type ReferenceRule} from './table-references';
import './table-references.css';
type Props={file:File;onBack:()=>void;onResolved:(file:File)=>void};
export function TableReferencesPage({file,onBack,onResolved}:Props) {
  const [working,setWorking]=useState(file),[report,setReport]=useState<ReferenceReport>(),[rules,setRules]=useState<Record<string,ReferenceRule>>({}),[acknowledged,setAcknowledged]=useState<string[]>([]);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[kind,setKind]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(0),[generation,setGeneration]=useState(0),[candidateSearch,setCandidateSearch]=useState<Record<string,string>>({});
  useEffect(()=>{const c=new AbortController();setBusy(true);setError('');setReport(undefined);setRules({});tableReferences(working,undefined,c.signal).then(setReport).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});return()=>c.abort();},[working,generation]);
  const groups=referenceGroups(report,kind,search),pages=Math.max(1,Math.ceil(groups.length/20)),current=Math.min(page,pages-1);
  const selected=Object.values(rules);
  const download=()=>{const url=URL.createObjectURL(working);const a=document.createElement('a');a.href=url;a.download=working.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  async function apply(){
    if(!report||!selected.length)return;setBusy(true);setError('');
    try{const blob=await tableReferences(working,{fingerprint:report.fingerprint,rules:selected}) as Blob;
      setAcknowledged(v=>[...new Set([...v,...selected.filter(r=>r.keepNew).map(r=>r.groupId)])]);
      setWorking(new File([blob],'resolved.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));setPage(0);setRules({});setCandidateSearch({});
    }catch(e){setError(e instanceof Error?e.message:'Исправление не выполнено.');}finally{setBusy(false);}
  }
  return <main className="reference-queue"><div className="reference-shell">
    <nav><button onClick={onBack}><ArrowLeft size={16}/>Вернуться без замены книги</button><span>Разбор значений книги</span></nav>
    <h1>Несопоставленные значения</h1><p>{working.name} · {Math.ceil(working.size/1024)} КБ. Исходный файл не перезаписывается, процессы и справочники не меняются.</p>
    <p>Известные системы и документы взяты из доступного текущего каталога. Неизвестное значение может быть новым, а не ошибочным. Пустые обязательные поля и остальные ошибки проверяет обычный предварительный просмотр импорта.</p>
    {error&&<p role="alert" className="reference-error">{error}</p>}{busy&&<p role="status">Проверяем книгу и справочники…</p>}
    <div className="reference-tools"><button disabled={busy} onClick={()=>{setPage(0);setGeneration(v=>v+1);}}><RefreshCw size={16}/>Повторить разбор</button><button disabled={busy} onClick={download}><Download size={16}/>Скачать текущую копию</button>
      <button disabled={busy||!selected.length} onClick={()=>void apply()}>Применить выбранные решения ({selected.length})</button>
      <button disabled={busy||!report||selected.length>0} onClick={()=>onResolved(working)}>Проверить копию перед импортом</button></div>
    <button disabled={busy||!report} onClick={()=>{if(!report)return;const url=URL.createObjectURL(new Blob([referenceOccurrencesCsv(report)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='reference-queue-all.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Выгрузить все координаты CSV</button>
    <p>Выбранные решения меняют копию только после нажатия «Применить». Действие относится ко всей книге, включая скрытые фильтром группы.</p>
    <details className="reference-help"><summary>Порядок сопоставления и границы изменений</summary>
    <p>Сначала сопоставьте организацию, затем повторно разберите копию для выбора её подразделений. Решение заменяет все перечисленные в группе вхождения. При замене ID объекта обновляется и его парное название. Другие ячейки, стили и формулы не меняются; формулу в исправляемой ячейке нужно изменить в Excel.</p>
    <p>«Оставить новым» — явное решение этой сессии, а не создание записи справочника. Оно доступно только системам и документам; после закрытия страницы потребуется новый разбор. Формулы не пересчитываются на сервере.</p>
    <p>Применяются все выбранные решения во всей книге, включая скрытые текущим фильтром. Чтобы передать копию дальше, нажмите «Проверить копию перед импортом» или скачайте её. Обычный возврат оставляет исходную книгу в импорте.</p>
    </details>
    <div className="reference-filters"><label>Категория<select aria-label="Категория" value={kind} onChange={e=>{setKind(e.target.value);setPage(0);}}><option value="">Все категории</option>{Object.entries(referenceLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>Поиск<input aria-label="Поиск несопоставленных значений" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="Значение, процесс, этап или ячейка"/></label></div>
    {report&&<><p>Групп: {report.groups.length}. Вхождений: {report.groups.reduce((n,g)=>n+g.cells.length,0)}. В выборке: {groups.length}. Оставлено новым в этой сессии: {report.groups.filter(g=>acknowledged.includes(g.id)).length}.</p>
      {!groups.length&&<p>Несопоставленных значений в этой выборке нет. Это не заменяет общую проверку книги.</p>}
      {groups.slice(current*20,(current+1)*20).map(group=>{
        const choices=referenceChoices(report,group,candidateSearch[group.id]??''),rule=rules[group.id];
        const options=choices.slice(0,200),pinned=rule?.targetId?report.choices.find(c=>c.kind===group.kind&&c.id===rule.targetId&&(group.kind!=='unit'||c.scope.toLowerCase()===group.scope.toLowerCase())):undefined;
        if(pinned&&!options.includes(pinned))options.unshift(pinned);
        return <section key={group.id} className="reference-group"><h2>{referenceLabels[group.kind]}: {group.value}</h2>{group.scope&&<p>Организация ID: {group.scope}</p>}
          {acknowledged.includes(group.id)&&<p>Оставлено новым в этой сессии. Запись справочника не создана.</p>}
          <div className="reference-resolution"><label>Найти известную цель<input disabled={busy} aria-label={'Найти цель для '+group.value} value={candidateSearch[group.id]??''} onChange={e=>setCandidateSearch(v=>({...v,[group.id]:e.target.value}))}/></label>
            <label>Решение<select disabled={busy} aria-label={'Решение для '+group.value} value={rule?.keepNew?'@new':rule?.targetId?'known:'+rule.targetId:''} onChange={e=>setRules(v=>{const next={...v};if(!e.target.value)delete next[group.id];else next[group.id]=e.target.value==='@new'?{groupId:group.id,keepNew:true}:{groupId:group.id,targetId:e.target.value.slice(6)};return next;})}><option value="">Не выбрано</option>{group.canKeep&&<option value="@new">Оставить как новое значение</option>}{options.map(c=><option key={c.scope+':'+c.id} value={'known:'+c.id}>{c.name} · {c.id}</option>)}</select></label></div>
          {choices.length>200&&<p>Найдено {choices.length} целей, показано 200. Уточните поиск.</p>}
          {!choices.length&&!group.canKeep&&<p>Подходящих целей нет. Для подразделения сначала сопоставьте организацию; при необходимости дополните справочник и повторите разбор.</p>}
          <details><summary>Вхождения: {group.cells.length}</summary><ul>{group.cells.slice(0,100).map((c,i)=><li key={i}>{c.sheet}!{c.cell} · {c.column}{c.relatedCell?' (также '+c.relatedCell+')':''} · {c.processId} / {c.stepId||'процесс'}{c.token>0?' · позиция '+(c.token+1):''}</li>)}</ul>{group.cells.length>100&&<p>Первые 100 вхождений показаны; решение относится ко всем {group.cells.length}.</p>}</details>
        </section>;
      })}
      {pages>1&&<div className="reference-tools"><button disabled={!current} onClick={()=>setPage(current-1)}>Назад</button><span>Страница {current+1} из {pages}</span><button disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Далее</button></div>}
    </>}
  </div></main>;
}
