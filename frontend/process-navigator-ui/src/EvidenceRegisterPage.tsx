import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { loadProcess } from './api';
import type { ProcessSummary } from './types';
import { collectEvidence, evidenceReportCsv, filterEvidence } from './evidence-register';
import type { EvidenceEntry } from './evidence-register';
import './evidence-register.css';

export function EvidenceRegisterPage({ catalog, onBack, onOpen }: { catalog: ProcessSummary[]; onBack: () => void; onOpen: (entry: EvidenceEntry) => void }) {
  const [entries, setEntries] = useState<EvidenceEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState('unresolved');
  const [edition, setEdition] = useState('all');
  const [processId, setProcessId] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [status, edition, processId, query, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const tasks = catalog.flatMap(item => [
      ...(item.status !== 'Draft' ? [{ item, draft: false }] : []),
      ...(item.hasDraft || item.status === 'Draft' ? [{ item, draft: true }] : []),
    ]);
    let cursor = 0;
    const found: EvidenceEntry[] = [];
    const failures: string[] = [];
    setBusy(true); setEntries([]); setErrors([]);
    async function worker() {
      while (cursor < tasks.length && !controller.signal.aborted) {
        const { item, draft } = tasks[cursor++];
        try { found.push(...collectEvidence(await loadProcess(item.id, controller.signal, draft), draft ? 'Draft' : 'Published', true)); }
        catch (error) { if (!controller.signal.aborted) failures.push(`${item.name} · ${draft ? 'черновик' : 'действующая'}: ${error instanceof Error ? error.message : 'не удалось загрузить'}`); }
      }
    }
    Promise.all(Array.from({ length: Math.min(3, tasks.length) }, worker)).then(() => {
      if (controller.signal.aborted) return;
      setEntries(found.sort((a, b) => a.processName.localeCompare(b.processName, 'ru') || a.elementName.localeCompare(b.elementName, 'ru') || a.edition.localeCompare(b.edition) || a.index - b.index));
      setErrors(failures); setBusy(false);
    });
    return () => controller.abort();
  }, [catalog, refresh]);
  const visible = filterEvidence(entries, status, edition, processId, query);
  const lastPage = Math.max(0, Math.ceil(visible.length / 50) - 1);
  const currentPage = Math.min(page, lastPage);
  const labels = { fact: 'Факт', assumption: 'Предположение', question: 'Открытый вопрос', missing: 'Не указан источник действия', unmapped: 'Пункт источника не сопоставлен', stale: 'Привязка содержит отсутствующий элемент', mapped: 'Пункт привязан, смысл требует проверки', routeMismatch: 'Нет маршрута в указанном порядке' };
  const scoped = filterEvidence(entries, 'all', edition, processId, '');
  const missingCount = scoped.filter(entry => entry.status === 'missing').length;
  const downloadReport = () => {
    const url = URL.createObjectURL(new Blob([evidenceReportCsv(visible, errors, new Date().toISOString())], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'process-evidence-report.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <main className="evidence-register"><header><button onClick={onBack}><ArrowLeft size={16}/>Рабочее пространство</button><button disabled={busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16}/>Обновить</button></header>
    <span className="eyebrow">Качество описания</span><h1>Источники и вопросы</h1>
    <p>Записи шагов действующих моделей и черновиков. Это отдельные редакции: одинаковый вопрос может встречаться в обеих. Архивные версии не включены.</p>
    <p>Проверка заполнения также показывает действия без источника. Наличие источника не подтверждает правильность описания автоматически; события и развилки в эту проверку пока не входят.</p>
    <p>Пункты исходного описания задаются в паспорте черновика. Фильтр «Пункты с замечаниями сверки» показывает несопоставленные пункты, ссылки на отсутствующие элементы и разрывы проверяемого маршрута. Привязка не означает предметного подтверждения.</p>
    <div className="evidence-filters"><label>Найти<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Текст, источник, автор, шаг…"/></label>
      <label>Статус<select value={status} onChange={event => setStatus(event.target.value)}><option value="unresolved">Вопросы и предположения</option><option value="requirements">Все пункты источника</option><option value="gaps">Пункты с замечаниями сверки</option><option value="missing">Действия без источника</option><option value="all">Все записи и замечания</option><option value="question">Открытые вопросы</option><option value="assumption">Предположения</option><option value="fact">Факты</option></select></label>
      <label>Редакция<select value={edition} onChange={event => setEdition(event.target.value)}><option value="all">Все текущие редакции</option><option value="Draft">Черновики</option><option value="Published">Действующие</option></select></label>
      <label>Процесс<select value={processId} onChange={event => setProcessId(event.target.value)}><option value="">Все процессы</option>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    {busy ? <p role="status">Загружаем сведения…</p> : <><p role="status">Найдено позиций: {visible.length} из {entries.length}.{errors.length > 0 && ' Результат неполный: часть редакций не загружена.'}</p><p>В выбранных процессах и редакциях действий без источника: {missingCount}. Действующая модель и черновик считаются отдельно. Поиск на этот счётчик не влияет. <button onClick={() => { setStatus('missing'); setQuery(''); }}>Показать действия без источника</button></p></>}
    {errors.length > 0 && <section role="alert"><h2>Не удалось проверить редакции</h2><ul>{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></section>}
    <button disabled={busy} onClick={downloadReport}>Выгрузить отчёт CSV по выбранным условиям</button>
    {!busy && !visible.length && <p>{entries.length ? 'Нет записей по выбранным условиям.' : errors.length ? 'Нет загруженных записей. Исправьте ошибки и повторите загрузку.' : 'В текущих моделях ещё нет записей об источниках и вопросах. Добавьте их в описании шага черновика.'}</p>}
    {!busy && visible.length > 50 && <nav aria-label="Страницы записей"><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Предыдущая</button><span> Страница {currentPage + 1} из {lastPage + 1} </span><button disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>Следующая</button></nav>}
    <div className="evidence-entries">{visible.slice(currentPage * 50, (currentPage + 1) * 50).map(entry => <article key={`${entry.processId}:${entry.edition}:${entry.elementId}:${entry.index}`}>
      <div className="evidence-entry-heading"><strong>{labels[entry.status] ?? entry.status}</strong><span>{entry.edition === 'Draft' ? 'Черновик' : 'Действующая'} · {entry.version}</span></div>
      <h2>{entry.processName}</h2><h3>{entry.elementName}</h3><p className="evidence-statement">{entry.statement}</p>
      {entry.source && <p>Источник: {entry.source}</p>}{entry.locator && <p>Место: {entry.locator}</p>}{entry.author && <p>Автор сведений: {entry.author}</p>}
      <button onClick={() => onOpen(entry)}>Открыть {entry.elementId ? 'элемент' : 'процесс'} {entry.edition === 'Draft' ? 'черновика' : 'действующей модели'}</button>
    </article>)}</div>
  </main>;
}
