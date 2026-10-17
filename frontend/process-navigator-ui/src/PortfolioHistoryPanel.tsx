import { useEffect, useRef, useState } from 'react';
import type { PortfolioAnalytics } from './types';
import { loadPortfolioHistory, loadPortfolioSnapshot, savePortfolioSnapshot } from './api';
import { comparePortfolioSnapshots, portfolioTrend, snapshotCsv, type PortfolioSnapshot, type PortfolioSnapshotSummary } from './portfolio-history';

export function PortfolioHistoryPanel({ data, onOpenProcess }: { data: PortfolioAnalytics; onOpenProcess: (id: string) => void }) {
  const [items, setItems] = useState<PortfolioSnapshotSummary[]>([]), [name, setName] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [beforeId, setBeforeId] = useState(''), [afterId, setAfterId] = useState('');
  const [pair, setPair] = useState<[PortfolioSnapshot, PortfolioSnapshot]>(), [pairError, setPairError] = useState(''), [pairLoading, setPairLoading] = useState(false);
  const [query, setQuery] = useState(''), [changedOnly, setChangedOnly] = useState(true), [page, setPage] = useState(0);
  const refreshSequence = useRef(0);
  async function refresh(signal?: AbortSignal) {
    const sequence = ++refreshSequence.current;
    setLoading(true); setError('');
    try { const result = await loadPortfolioHistory(signal); if (!signal?.aborted && sequence === refreshSequence.current) { setItems(result); setAfterId(id => id || result[0]?.id || ''); setBeforeId(id => id || result[1]?.id || result[0]?.id || ''); } }
    catch (e) { if (!signal?.aborted && sequence === refreshSequence.current) setError(e instanceof Error ? e.message : 'История недоступна.'); }
    finally { if (!signal?.aborted && sequence === refreshSequence.current) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, []);
  useEffect(() => {
    setPair(undefined); setPairError('');
    if (!beforeId || !afterId) { setPairLoading(false); return; }
    const controller = new AbortController(); setPairLoading(true);
    void Promise.all([loadPortfolioSnapshot(beforeId, controller.signal), loadPortfolioSnapshot(afterId, controller.signal)])
      .then(result => { if (!controller.signal.aborted) setPair(result); })
      .catch(e => { if (!controller.signal.aborted) setPairError(e instanceof Error ? e.message : 'Не удалось прочитать срезы.'); })
      .finally(() => { if (!controller.signal.aborted) setPairLoading(false); });
    return () => controller.abort();
  }, [beforeId, afterId]);
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try { const snapshot = await savePortfolioSnapshot(name, data); setNotice('Срез сохранён на сервере. Повтор последнего среза с тем же именем и данными в течение минуты не создаёт дубликат.'); await refresh(); setAfterId(snapshot.id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Срез не сохранён.'); }
    finally { setBusy(false); }
  }
  function download() {
    if (!pair) return;
    try { const url = URL.createObjectURL(new Blob([snapshotCsv(pair[1])], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'analytics-snapshot-' + pair[1].id + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch { setPairError('Не удалось выгрузить срез.'); }
  }
  const comparison = pair && comparePortfolioSnapshots(...pair);
  const trend = portfolioTrend(items);
  const rows = comparison?.processes.filter(p => (!changedOnly || p.status !== 'same') && (p.name + ' ' + p.id + ' ' + p.changes.join(' ')).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))) ?? [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 100) - 1));
  const labels = { added: 'Добавлен', removed: 'Отсутствует в конечном срезе', changed: 'Изменён', same: 'Без изменений' };
  return <section className="portfolio-history portfolio-workspace" aria-label="История аналитики">
    <h3>Исторические срезы и динамика</h3>
    <p>Личная история всего портфеля хранится на сервере и входит в резервные копии. Срез фиксирует текущие показатели; задним числом данные не восстанавливаются. До 30 срезов / 20 МБ, без автоматического удаления. Фильтры списка не применяются.</p>
    <p>Общая панель выгрузки выше относится к текущим данным. Для сохранённого состояния используйте кнопку «CSV конечного сохранённого среза» ниже.</p>
    <div className="portfolio-workspace-row"><label>Название среза<input aria-label="Название среза аналитики" maxLength={100} value={name} onChange={e => setName(e.target.value)}/></label><button disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? 'Сохранение…' : 'Сохранить текущий срез'}</button><button disabled={loading || busy} onClick={() => void refresh()}>Обновить историю</button></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading && <p role="status">Загружаем историю…</p>}
    {!loading && !error && !items.length && <p>Срезов пока нет. Сохраните текущий; изменения станут видны после следующего наблюдения.</p>}
    {!!items.length && <>
      <figure className="portfolio-history-trend"><figcaption>Полнота описания моделей, % — по времени сохранения UTC. Линия соединяет наблюдения, не восстанавливает значения между ними.</figcaption>{trend.length ? <svg viewBox="0 0 560 160" role="img" aria-label="Динамика полноты описания сохранённых срезов"><line x1="30" y1="30" x2="30" y2="130" stroke="#999"/><line x1="30" y1="130" x2="530" y2="130" stroke="#999"/><text x="0" y="34">100</text><text x="10" y="134">0</text><polyline fill="none" stroke="#285b44" strokeWidth="2" points={trend.map(item => item.x + ',' + item.y).join(' ')}/>{trend.map(item => <circle key={item.id} cx={item.x} cy={item.y} r="4" fill="#285b44"><title>{item.capturedAt} · {item.name} · {item.readinessPercent}%</title></circle>)}</svg> : <p>Срезы используют разные методики: общий график не строится.</p>}</figure>
      <div className="portfolio-history-table"><table><caption>Сохранённые наблюдения — время UTC, не равномерные интервалы</caption><thead><tr><th>Дата / название</th><th>Модели</th><th>Полнота, %</th><th>Замечания реестра</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><th scope="row">{item.capturedAt}<br/>{item.name}</th><td>{item.processCount}</td><td>{item.readinessPercent}</td><td>{item.informationIssueCount}</td></tr>)}</tbody></table></div>
      <div className="portfolio-workspace-row">{[['Начальный срез', beforeId, setBeforeId], ['Конечный срез', afterId, setAfterId]].map(([label, id, set]) => <label key={String(label)}>{String(label)}<select aria-label={String(label)} value={String(id)} onChange={e => (set as typeof setBeforeId)(e.target.value)}>{items.map(item => <option key={item.id} value={item.id}>{item.capturedAt} · {item.name}</option>)}</select></label>)}</div>
      {pairLoading && <p role="status">Загружаем сохранённые данные для сравнения…</p>}{pairError && <p role="alert">{pairError}</p>}
      {pair && comparison && <><p>{comparison.reason} Методика: {pair[0].algorithm} / {pair[1].algorithm}. {pair[0].id === pair[1].id && 'Выбран один и тот же срез.'}</p>
        <button onClick={download}>CSV конечного сохранённого среза</button>
        {comparison.comparable && <><div className="portfolio-history-table"><table><caption>Изменения между выбранными наблюдениями</caption><thead><tr><th>Показатель</th><th>Начало</th><th>Конец</th><th>Изменение</th></tr></thead><tbody>{comparison.metrics.map(metric => <tr key={metric.key}><th scope="row">{metric.label}</th><td>{metric.before}</td><td>{metric.after}</td><td>{metric.delta > 0 ? '+' : ''}{metric.delta} {metric.unit}</td></tr>)}</tbody></table></div>
          <h4>Расшифровка моделей ({comparison.processes.length})</h4><p>Добавление и отсутствие модели показаны отдельно: отсутствующее значение не подменяется нулём. Открытие модели ниже ведёт к её текущему состоянию, не к исторической схеме.</p>
          <div className="portfolio-workspace-row"><label>Поиск по изменениям<input value={query} maxLength={300} onChange={e => { setQuery(e.target.value); setPage(0); }}/></label><label><input type="checkbox" checked={changedOnly} onChange={e => { setChangedOnly(e.target.checked); setPage(0); }}/>Только изменённые</label></div>
          <p>Найдено {rows.length} из {comparison.processes.length}; страница {currentPage + 1} из {Math.max(1, Math.ceil(rows.length / 100))}. До 100 моделей на странице; CSV содержит весь конечный срез.</p>
          {rows.slice(currentPage * 100, (currentPage + 1) * 100).map(p => <article key={p.id}><strong>{p.name} · {p.id}</strong><p>{labels[p.status as keyof typeof labels]} · полнота {p.before ?? 'нет данных'} → {p.after ?? 'нет данных'}; изменение {p.delta == null ? 'не сравнивается' : p.delta + ' п.п.'}</p><ul>{p.changes.map((text, i) => <li key={i}>{text}</li>)}</ul><button disabled={!data.processes.some(item => item.id === p.id)} onClick={() => onOpenProcess(p.id)}>{data.processes.some(item => item.id === p.id) ? 'Открыть текущую модель' : 'Текущая модель отсутствует'}</button></article>)}
          <div className="portfolio-workspace-row"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Предыдущие модели</button><button disabled={(currentPage + 1) * 100 >= rows.length} onClick={() => setPage(currentPage + 1)}>Следующие модели</button></div></>}
      </>}
    </>}
  </section>;
}
