import { useEffect, useState } from 'react';
import { loadInformationObjects } from './api';
import type { InformationObjectRegistry } from './types';
import { documentAnalyticsCsv, filterDocumentAnalytics } from './document-analytics';

export function DocumentAnalyticsPanel({ onOpenProcess }: { onOpenProcess: (id: string) => void }) {
  const [data, setData] = useState<InformationObjectRegistry>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [attention, setAttention] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setData(undefined); setError('');
    loadInformationObjects(controller.signal).then(value => { if (!controller.signal.aborted) setData(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить документы.'); });
    return () => controller.abort();
  }, [revision]);
  function download() {
    if (!data) return;
    try {
      const url = URL.createObjectURL(new Blob([documentAnalyticsCsv(data, query, attention)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'document-analytics.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Не удалось создать выгрузку документов.'); }
  }
  const rows = data ? filterDocumentAnalytics(data, query, attention) : [];
  return <section className="portfolio-panel" aria-label="Аналитика документов">
    <h3>Документы и результаты</h3>
    <p>Частота — число использований источника и получателя в моделях, не количество фактических отправок. Совпадения названий и псевдонимов — кандидаты на дубли, объекты автоматически не объединяются.</p>
    <div className="portfolio-toolbar"><label>Поиск документов<input aria-label="Поиск документов аналитики" value={query} maxLength={300} onChange={event => setQuery(event.target.value)}/></label><label><input type="checkbox" checked={attention} onChange={event => setAttention(event.target.checked)}/>Только требующие внимания</label><button onClick={() => setRevision(value => value + 1)}>Обновить реестр</button><button disabled={!data} onClick={download}>Выгрузить документы в CSV</button></div>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Загрузка реестра…</p>}
    {data && <><p>Срез: {new Date(data.generatedAt).toLocaleString('ru-RU')}. Показано {rows.length} из {data.objects.length}. Фильтры этого раздела независимы от списка процессов.</p>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Объект</th><th>Использования</th><th>Источники и получатели</th><th>Версии и замечания</th></tr></thead><tbody>{rows.map(row => <tr key={row.object.id}>
        <td style={{ overflowWrap: 'anywhere', minWidth: 180 }}><strong>{row.object.name}</strong><p>{row.object.id} · {row.object.state}</p></td>
        <td>{row.usageCount} использований · {row.processCount} процессов</td>
        <td>{(['producers', 'consumers'] as const).map(kind => <details key={kind}><summary>{kind === 'producers' ? 'Источники' : 'Получатели'}: {row.object[kind].length}</summary>{row.object[kind].map((o, index) => <p key={index}><button onClick={() => onOpenProcess(o.processId)}>{o.processName}</button> — {o.elementName || 'Паспорт процесса'} ({o.elementId || o.processId}); версия {o.version || 'не указана'}{o.condition && `; условие: ${o.condition}`}</p>)}</details>)}</td>
        <td style={{ overflowWrap: 'anywhere', minWidth: 220 }}>Версии использований: {row.versions.join(', ') || 'не указаны'}{row.issues.map((issue, index) => <p key={index}>{issue.message}</p>)}{row.duplicateIds.length > 0 && <p>Возможные дубли: {row.duplicateIds.join(', ')}</p>}</td>
      </tr>)}</tbody></table></div>{!rows.length && <p>По заданным условиям документов нет.</p>}
      <p>Признаки бумажной работы и межсистемных переходов показаны отдельно ниже: это другой срез моделей, а не подтверждённый журнал передач.</p>
    </>}
  </section>;
}
