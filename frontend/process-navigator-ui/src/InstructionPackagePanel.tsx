import { useEffect, useRef, useState } from 'react';
import { loadArchivedProcess, loadProcess } from './api';
import type { ProcessModel } from './types';
import { collectInstructionPackage, instructionPackageHtml, type InstructionPackage } from './instruction-package';

export function InstructionPackagePanel({ process, edition }: { process: ProcessModel; edition: string }) {
  const [bundle, setBundle] = useState<InstructionPackage>();
  const [versions, setVersions] = useState<Record<string,string>>({});
  const [builtVersions, setBuiltVersions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [allowPartial, setAllowPartial] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    controller.current?.abort(); setBundle(undefined); setVersions({}); setBusy(false); setError(''); setAllowPartial(false);
    return () => controller.current?.abort();
  }, [process, edition]);
  const linked = [...new Set([process,...(bundle?.entries.map(entry => entry.model) ?? [])].flatMap(model => model.nodes.map(node => node.linkedProcessId).filter((id): id is string => !!id)))].slice(0,200);
  const selectionKey = JSON.stringify(Object.entries(versions).filter(([,value]) => value.trim()).sort(([a],[b]) => a.localeCompare(b)));
  const stale = !!bundle && builtVersions !== selectionKey;
  const build = async () => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); setBundle(undefined); setAllowPartial(false);
    try {
      const next = await collectInstructionPackage(process, edition, versions, (id, version, signal) =>
        version ? loadArchivedProcess(id, version, signal) : loadProcess(id, signal), request.signal);
      if (!request.signal.aborted) { setBundle(next); setBuiltVersions(selectionKey); }
    } catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось собрать инструкцию.'); }
    finally { if (!request.signal.aborted) setBusy(false); }
  };
  const download = () => {
    if (!bundle || stale || busy || (bundle.issues.length && !allowPartial)) return;
    try {
      const html = instructionPackageHtml(bundle);
      const url = URL.createObjectURL(new Blob([html], {type:'text/html;charset=utf-8'}));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'process-instruction.html'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сформировать файл.'); }
  };
  return <section className="instruction-card instruction-package-panel"><h2>Сквозная инструкция всех связанных уровней</h2>
    <p>Корень — эта открытая редакция ({process.id}, версия {process.version}). Для дочерних процессов по умолчанию выбирается действующая версия на момент сбора, не черновик. Это не исторический снимок всей иерархии.</p>
    <p>При необходимости укажите точный номер дочерней редакции из истории. После первого сбора здесь появятся ссылки следующих уровней; выбор можно уточнить и собрать документ заново. Один выбор применяется ко всем включениям этого процесса.</p>
    {linked.map(id => <label key={id} className="instruction-version-choice">{id}<input aria-label={'Редакция процесса ' + id} value={versions[id] ?? ''} maxLength={100} placeholder="Пусто — действующая версия" disabled={busy} onChange={event => setVersions(current => ({...current,[id]:event.target.value}))}/></label>)}
    <p>Пределы: 40 включений, 40 запросов моделей, 200 ссылок, глубина 8, 10000 элементов / 20000 переходов. Ошибки и пропуски остаются в документе. Материалы и персональные назначения не проверяются.</p>
    <button disabled={busy} onClick={() => void build()}>{busy ? 'Собираем уровни…' : 'Собрать сквозную инструкцию'}</button>
    {busy && <button onClick={() => { controller.current?.abort(); setBusy(false); }}>Отменить сбор</button>}
    {error && <p role="alert">{error}</p>}
    {bundle && <><h3>Состав документа</h3><p>Включений: {bundle.entries.length}; замечаний: {bundle.issues.length}. Собрано: {bundle.capturedAt}.</p>
      <ul>{bundle.entries.map((entry,index) => <li key={index}>{entry.path.join(' → ')} · {entry.model.id} · версия {entry.model.version} · {entry.edition}</li>)}</ul>
      {!!bundle.issues.length && <><p className="instruction-warning">НЕПОЛНЫЙ ДОКУМЕНТ</p><ul>{bundle.issues.map((issue,index) => <li key={index}>{issue}</li>)}</ul><label><input type="checkbox" checked={allowPartial} onChange={event => setAllowPartial(event.target.checked)}/>Скачать неполный документ с перечисленными замечаниями</label></>}
      {stale && <p role="status">Выбор редакций изменён. Соберите документ заново перед скачиванием.</p>}
      <button disabled={busy || stale || (!!bundle.issues.length && !allowPartial)} onClick={download}>Скачать инструкцию HTML</button>
      <p>Откройте файл в браузере для чтения или печати/PDF: в нём все включённые элементы и переходы, без фильтров и постраничного усечения. Сквозная инструкция не объединяет маршруты в исполняемую последовательность и не подтверждает корректность процессов.</p>
    </>}
  </section>;
}
