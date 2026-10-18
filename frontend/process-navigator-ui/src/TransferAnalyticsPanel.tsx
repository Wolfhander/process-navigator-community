import { useEffect, useState } from 'react';
import { loadTransferAnalytics } from './api';
import { selectTransfers, transferLabels, transfersCsv, type TransferReport } from './transfer-analytics';

export function TransferAnalyticsPanel({ onOpenProcess }: { onOpenProcess: (id: string) => void }) {
  const [report, setReport] = useState<TransferReport>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setReport(undefined); setError(''); setPage(0);
    loadTransferAnalytics(controller.signal).then(value => { if (!controller.signal.aborted) setReport(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Проверка не выполнена.'); });
    return () => controller.abort();
  }, [revision]);
  const rows = report ? selectTransfers(report, code, query) : [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 100) - 1));
  function download() {
    if (!report) return;
    try {
      const url = URL.createObjectURL(new Blob([transfersCsv(report, code, query)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'transfer-analytics.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Не удалось подготовить CSV передач.'); }
  }
  return <section className="portfolio-panel transfer-analysis" aria-label="Проверка каналов и систем">
    <h3>Бумажные каналы и межсистемные переходы</h3>
    <p>Структурная проверка текущих моделей. Бумага — не обязательно разрыв, переход между системами — не доказательство повторного ввода. Автоматический обмен этой проверкой не подтверждается и не исключается.</p>
    <div className="portfolio-toolbar"><label>Поиск<input aria-label="Поиск передач" maxLength={300} value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/></label><select aria-label="Тип передачи" value={code} onChange={e => { setCode(e.target.value); setPage(0); }}><option value="">Все признаки</option>{Object.entries(transferLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><button onClick={() => setRevision(value => value + 1)}>Проверить передачи заново</button><button disabled={!report} onClick={download}>CSV передач</button></div>
    {error && <p role="alert">{error}</p>}{!report && !error && <p role="status">Проверяем модели…</p>}
    {report && <><p>Срез: {new Date(report.generatedAt).toLocaleString('ru-RU')}; процессов: {report.processCount}; найдено: {rows.length} из {report.findings.length}. CSV содержит все отфильтрованные записи.</p>
      <div className="transfer-table"><table><thead><tr><th>Признак</th><th>Процесс и этап</th><th>Системы и документы</th><th>Основание</th></tr></thead><tbody>{rows.slice(currentPage * 100, currentPage * 100 + 100).map((f, index) => <tr key={`${f.processId}:${f.elementId}:${f.code}:${index}`}><td>{transferLabels[f.code] ?? f.code}</td><td><button onClick={() => onOpenProcess(f.processId)}>{f.processName}</button><p>{f.elementName} ({f.elementId}){f.targetId && ` → ${f.targetName} (${f.targetId})`}</p></td><td>{f.sourceSystems.join(', ') || 'Не уточнена'}{f.targetId && ` → ${f.targetSystems.join(', ') || 'не уточнена'}`}<p>ID документов: {f.objectIds.join(', ') || 'не сопоставлены'}</p></td><td>{f.explanation}</td></tr>)}</tbody></table></div>
      {!rows.length && <p>По заданным условиям признаков не найдено. Это не подтверждает полноту описания каналов.</p>}
      <div className="portfolio-toolbar"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Назад</button><span>Страница {currentPage + 1} из {Math.max(1, Math.ceil(rows.length / 100))}</span><button disabled={(currentPage + 1) * 100 >= rows.length} onClick={() => setPage(currentPage + 1)}>Далее</button></div>
      {report.findings.some(f => f.code === 'traversal-limit') && <p role="alert">Некоторые пути не проверены полностью. Отключите фильтр и найдите «Проверка путей неполна» для подробностей.</p>}
      <details><summary>Пути через шлюзы и ограничения проверки</summary><p>Проверяются прямые связи и пути через шлюзы до ближайшей задачи. Для каждой пары показан один кратчайший путь, а не все варианты. Условия ветвей, синхронизация параллельных ветвей и фактическая достижимость не подтверждены. Через промежуточную задачу, событие или дочернюю модель проверка не перескакивает. Предел: 50 000 связей на модель и 128 шлюзов в пути; неполная проверка отмечается отдельно. Входные и выходные системы не считаются системой выполнения задачи. Совпадение ID документа не подтверждает версию фактической передачи. Ниже — пути текущей страницы; все пути доступны в CSV.</p>{rows.slice(currentPage * 100, currentPage * 100 + 100).filter(f => (f.routeElementIds?.length ?? 0) > 2).map((f, i) => <p key={i}>{f.processName}: {f.elementName} → {f.targetName}; путь ID: {f.routeElementIds!.join(' → ')}</p>)}</details>
    </>}
  </section>;
}
