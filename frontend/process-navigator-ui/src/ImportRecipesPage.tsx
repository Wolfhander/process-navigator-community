import {useEffect,useState} from 'react';
import {ArrowLeft,Download,RefreshCw} from 'lucide-react';
import {addRecipeBatch,importRecipeCall,previewRecipe,recipeFile} from './api';
import type {ImportRecipe,RecipePreview} from './import-recipes';
import {referenceLabels} from './table-references';
import './import-recipes.css';
type Props={onBack:()=>void;onPrepared:(file:File)=>void};
export function ImportRecipesPage({onBack,onPrepared}:Props) {
  const [items,setItems]=useState<ImportRecipe[]>([]),[unreadable,setUnreadable]=useState(0),[selected,setSelected]=useState(''),[batchId,setBatchId]=useState(''),[files,setFiles]=useState<File[]>([]);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[report,setReport]=useState<RecipePreview>(),[reload,setReload]=useState(0),[fileKey,setFileKey]=useState(0);
  useEffect(()=>{const c=new AbortController();setBusy(true);setError('');importRecipeCall<{recipes:ImportRecipe[];unreadable:number}>('',{signal:c.signal}).then(data=>{setItems(data.recipes);setUnreadable(data.unreadable);}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});return()=>c.abort();},[reload]);
  const recipe=items.find(r=>r.id===selected),batch=recipe?.batches.find(b=>b.id===batchId);
  async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Операция не выполнена.');}finally{setBusy(false);}}
  function saveBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <main className="import-recipes"><div className="recipe-shell">
    <nav><button onClick={onBack}><ArrowLeft size={16}/>Назад к импорту</button><span>Регламенты повторной загрузки</span></nav>
    <h1>Регламенты повторной загрузки</h1><p>Сохранённые исходники и явные правила текущего профиля. Проверка каждого набора выполняется заново. Автоматического импорта процессов нет.</p>
    <p>Создайте регламент в разборе несопоставленных значений после применения решений. Для другой настройки создайте новый регламент: старые правила и пакеты не перезаписываются.</p>
    {error&&<p role="alert" className="recipe-error">{error}</p>}{busy&&<p role="status">Выполняется операция…</p>}
    {unreadable>0&&<p role="alert">Недоступных регламентов: {unreadable}. Они не удалены; требуется разбор хранилища.</p>}
    <button disabled={busy} onClick={()=>{setReport(undefined);setReload(v=>v+1);}}><RefreshCw size={16}/>Обновить список</button>
    {!busy&&!items.length&&<p>Регламентов пока нет. Вернитесь в импорт, загрузите книгу и сохраните исходник с правилами в разборе значений.</p>}
    <label>Регламент<select aria-label="Регламент" disabled={busy} value={selected} onChange={e=>{const r=items.find(x=>x.id===e.target.value);setSelected(e.target.value);setBatchId(r?.batches.at(-1)?.id??'');setReport(undefined);setFiles([]);setFileKey(v=>v+1);}}><option value="">Выберите регламент</option>{items.map(r=><option key={r.id} value={r.id}>{r.name} · пакетов {r.batches.length} · версия {r.revision}</option>)}</select></label>
    {recipe&&<>
      <details><summary>Правила: {recipe.rules.length} · исходники и контрольные суммы</summary><p>Ничего не применяется по сходству названий. Совпадение — область, исходное значение и организация для подразделения.</p><ul>{recipe.rules.slice(0,100).map((r,i)=><li key={i}>{referenceLabels[r.kind]}: {r.value} [{r.scope||'без области'}] → {r.keepNew?'оставить новым текстом':r.targetId}</li>)}</ul>{recipe.rules.length>100&&<p>Показаны первые 100. Полное описание доступно в JSON.</p>}<button onClick={()=>saveBlob(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}),'import-recipe.json')}>Скачать полное описание JSON</button></details>
      <section className="recipe-card"><h2>Следующий набор исходников</h2><p>До 10 XLSX, каждый до 10 МБ, суммарно до 50 МБ. Файлы сохраняются новым неизменяемым пакетом. Имена могут повторяться — файлы различаются ID и SHA-256.</p>
        <input key={fileKey} aria-label="Следующий набор XLSX" type="file" multiple accept=".xlsx" disabled={busy} onChange={e=>setFiles(Array.from(e.target.files??[]))}/><ul>{files.map((f,i)=><li key={i}>{f.name} · {Math.ceil(f.size/1024)} КБ</li>)}</ul>
        <button disabled={busy||!files.length||recipe.batches.length>=10} onClick={()=>void run(async()=>{setReport(undefined);const next=await addRecipeBatch(recipe,files);setItems(v=>v.map(r=>r.id===next.id?next:r));setBatchId(next.batches.at(-1)!.id);setFiles([]);setFileKey(v=>v+1);})}>Сохранить новый набор</button>
      </section>
      <label>Пакет исходников<select aria-label="Пакет исходников" disabled={busy} value={batchId} onChange={e=>{setBatchId(e.target.value);setReport(undefined);}}>{recipe.batches.map((b,i)=><option key={b.id} value={b.id}>{i+1}. {new Date(b.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК · файлов {b.files.length}</option>)}</select></label>
      <button disabled={busy||!batch} onClick={()=>void run(async()=>{setReport(undefined);setReport(await previewRecipe(recipe,batchId));})}>Проверить пакет по регламенту</button>
      {batch?.files.map(f=>{const result=report?.recipeId===recipe.id&&report.revision===recipe.revision&&report.batchId===batch.id?report.files.find(r=>r.fileId===f.id):undefined;return <section className="recipe-card" key={f.id}><h2>{f.fileName}</h2><p>{Math.ceil(f.size/1024)} КБ · {f.id}</p><details><summary>SHA-256</summary><p>{f.sha256}</p></details>
        <button disabled={busy} onClick={()=>void run(async()=>saveBlob(await recipeFile(recipe,batch.id,f.id),f.fileName))}><Download size={16}/>Скачать оригинал</button>
        {!result?<p>Этот файл ещё не проверен в текущей версии регламента.</p>:<><h3>{result.state==='ready'?'Готова копия для проверки импорта':result.state==='needsMapping'?'Нужны дополнительные решения':'Обработка заблокирована'}</h3><p>Применено правил: {result.appliedRules}; без применения: {result.unusedRules}; нерешённых групп: {result.remainingGroups}; ошибок: {result.errorCount}; предупреждений: {result.warningCount}.</p><ul>{result.messages.map((m,i)=><li key={i}>{m}</li>)}</ul>
          <button disabled={busy||result.state!=='ready'||!result.fingerprint} onClick={()=>void run(async()=>{const blob=await recipeFile(recipe,batch.id,f.id,result.fingerprint);onPrepared(new File([blob],f.fileName,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));})}>Передать копию в импорт</button>
        </>}
      </section>;})}
    </>}
    <p>Пределы: 20 регламентов на профиль, 100 в хранилище, 10 пакетов на регламент, 2000 правил, 1 ГБ файлов. Автоудаления нет. Исходники входят в резервную копию, но не отправляются в Git. Новые значения и недоступные цели требуют ручного разбора; пересчёт формул на сервере не выполняется.</p>
  </div></main>;
}
