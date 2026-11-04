import { useEffect, useMemo, useState } from 'react';
import { loadInformationObjects } from './api';
import type { InformationObjectOccurrence, InformationObjectRegistry } from './types';
import { documentAnalytics, documentAnalyticsCsv, documentAnalyticsSummary, documentScopes, pageDocumentAnalytics, selectDocumentAnalytics, type DocumentScope } from './document-analytics';

function DocumentOccurrences({items,label,onOpenProcess}:{items:InformationObjectOccurrence[];label:string;onOpenProcess:(id:string)=>void}) {
  const [open,setOpen]=useState(false);
  const [offset,setOffset]=useState(0);
  return <details onToggle={event=>{setOpen(event.currentTarget.open);if(!event.currentTarget.open)setOffset(0);}}>
    <summary>{label}: {items.length}</summary>
    {open&&<>{items.slice(offset,offset+20).map((o,index)=><p key={offset+index}><button onClick={()=>onOpenProcess(o.processId)}>{o.processName}</button> — {o.elementName || 'Паспорт процесса'} ({o.elementId || o.processId}); версия {o.version || 'не указана'}{o.condition && `; условие: ${o.condition}`}</p>)}
      {items.length>20&&<nav aria-label={label}><button disabled={!offset} onClick={()=>setOffset(offset-20)}>Назад</button> {offset+1}–{Math.min(items.length,offset+20)} из {items.length} <button disabled={offset+20>=items.length} onClick={()=>setOffset(offset+20)}>Далее</button></nav>}</>}
  </details>;
}

export function DocumentAnalyticsPanel({ onOpenProcess }: { onOpenProcess: (id: string) => void }) {
  const [data, setData] = useState<InformationObjectRegistry>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<DocumentScope>('all');
  const [position, setPosition] = useState(0);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setData(undefined); setError('');
    loadInformationObjects(controller.signal).then(value => { if (!controller.signal.aborted) setData(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить документы.'); });
    return () => controller.abort();
  }, [revision]);
  const indexed = useMemo(()=>data?documentAnalytics(data):[],[data]);
  const totals = useMemo(()=>documentAnalyticsSummary(indexed),[indexed]);
  const rows = useMemo(()=>selectDocumentAnalytics(indexed,query,scope),[indexed,query,scope]);
  const page = pageDocumentAnalytics(rows,position);
  function download() {
    if (!data) return;
    try {
      const url = URL.createObjectURL(new Blob([documentAnalyticsCsv(data, query, false, scope, rows)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'document-analytics.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Не удалось создать выгрузку документов.'); }
  }
  return <section className="portfolio-panel" aria-label="Аналитика документов">
    <h3>Документы и результаты</h3>
    <p>Частота — число использований источника и получателя в моделях, не количество фактических отправок. Совпадения названий и псевдонимов — кандидаты на дубли, объекты автоматически не объединяются.</p>
    <div className="portfolio-toolbar"><label>Поиск документов<input aria-label="Поиск документов аналитики" value={query} maxLength={300} onChange={event => {setQuery(event.target.value);setPosition(0);}}/></label><button onClick={() => {setPosition(0);setRevision(value => value + 1);}}>Обновить реестр</button><button disabled={!rows.length} onClick={download}>Выгрузить всю выборку в CSV</button></div>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Загрузка реестра…</p>}
    {data && <><nav className="home-quick" aria-label="Категории замечаний">{(Object.keys(documentScopes) as DocumentScope[]).map(key=><button key={key} aria-pressed={scope===key} onClick={()=>{setScope(key);setPosition(0);}}>{documentScopes[key]} · {totals[key]}</button>)}</nav>
      <p>Счётчики относятся ко всему срезу; категории могут пересекаться. Срез: {new Date(data.generatedAt).toLocaleString('ru-RU')}.</p>
      <p role="status">Найдено {rows.length} из {indexed.length}. Страница {page.page+1} из {page.pages}.</p>
      {page.pages>1&&<nav className="home-quick" aria-label="Страницы аналитики документов"><button disabled={page.page===0} onClick={()=>setPosition(page.page-1)}>Предыдущая</button><button disabled={page.page+1>=page.pages} onClick={()=>setPosition(page.page+1)}>Следующая</button></nav>}
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Объект</th><th>Использования</th><th>Источники и получатели</th><th>Версии и замечания</th></tr></thead><tbody>{page.rows.map(row => <tr key={row.object.id}>
        <td style={{ overflowWrap: 'anywhere', minWidth: 180 }}><strong>{row.object.name}</strong><p>{row.object.id} · {row.object.state}</p></td>
        <td>{row.usageCount} использований · {row.processCount} процессов</td>
        <td><DocumentOccurrences items={row.object.producers} label="Источники" onOpenProcess={onOpenProcess}/><DocumentOccurrences items={row.object.consumers} label="Получатели" onOpenProcess={onOpenProcess}/></td>
        <td style={{ overflowWrap: 'anywhere', minWidth: 220 }}>Версии использований: {row.versions.join(', ') || 'не указаны'}{row.issues.map((issue, index) => <p key={index}>{issue.message}</p>)}{row.duplicateIds.length > 0 && <p>Возможные дубли: {row.duplicateIds.join(', ')}</p>}</td>
      </tr>)}</tbody></table></div>{!rows.length && <p>По заданным условиям документов нет.</p>}
      <p>Признаки бумажной работы и межсистемных переходов показаны отдельно ниже: это другой срез моделей, а не подтверждённый журнал передач.</p>
    </>}
  </section>;
}
