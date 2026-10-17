import { useEffect, useRef, useState } from 'react';
import type { ProcessSchedule, ProcessScheduleRequest } from './types';
import { compareScheduleSnapshots, parseScheduleSnapshots, scheduleStorageKey, serializeScheduleSnapshots, type ScheduleSnapshot } from './schedule-snapshots';
import { exportScheduleTransfer, mergeScheduleTransfer, readScheduleTransfer, scheduleTransferMaxBytes } from './schedule-transfer';

export function ScheduleArchive({ userId, result, request, dirty, busy, onRestore }: {
  userId: string; result?: ProcessSchedule; request?: ProcessScheduleRequest; dirty: boolean; busy: boolean; onRestore: (snapshot: ScheduleSnapshot) => void;
}) {
  const [saved, setSaved] = useState<ScheduleSnapshot[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [storageValid, setStorageValid] = useState(false);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<{ file: string; snapshots: ScheduleSnapshot[]; added: number; skipped: number }>();
  const storageRaw = useRef<string | null>(null);
  const sequence = useRef(0);
  const reload = () => {
    sequence.current++; setReading(false); setSaved([]); setSelected(''); setPreview(undefined); setError(''); setMessage(''); setStorageValid(false);
    try { const raw = localStorage.getItem(scheduleStorageKey(userId)); setSaved(parseScheduleSnapshots(raw)); storageRaw.current = raw; setStorageValid(true); }
    catch { setError('Не удалось прочитать локальные снимки. Хранилище не перезаписано.'); }
  };
  useEffect(() => { reload(); return () => { sequence.current++; }; }, [userId]);
  const persist = (next: ScheduleSnapshot[]) => {
    setMessage('');
    try {
      if (!storageValid || localStorage.getItem(scheduleStorageKey(userId)) !== storageRaw.current)
        throw new Error('Хранилище изменилось в другой вкладке или недоступно. Перечитайте снимки перед записью.');
      const raw = serializeScheduleSnapshots(next);
      localStorage.setItem(scheduleStorageKey(userId), raw); storageRaw.current = raw; setSaved(next); setError(''); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить снимок.'); return false; }
  };
  const download = (snapshots: ScheduleSnapshot[]) => {
    try {
      const raw = exportScheduleTransfer(snapshots);
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = snapshots.length === 1 ? 'process-schedule-snapshot.json' : 'process-schedule-snapshots.json';
      link.click(); URL.revokeObjectURL(url); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось выгрузить расчёты.'); }
  };
  const inspectFile = async (file?: File) => {
    const current = ++sequence.current;
    setPreview(undefined); setMessage(''); setError('');
    if (!file) return;
    setReading(true);
    try {
      if (file.size > scheduleTransferMaxBytes) throw new Error('Файл превышает 8 МБ.');
      const snapshots = readScheduleTransfer(await file.text());
      if (sequence.current !== current) return;
      const merged = mergeScheduleTransfer(saved, snapshots, () => crypto.randomUUID());
      setPreview({ file: file.name, snapshots, added: merged.added, skipped: merged.skipped });
    } catch (cause) { if (sequence.current === current) setError(cause instanceof Error ? cause.message : 'Не удалось проверить файл.'); }
    finally { if (sequence.current === current) setReading(false); }
  };
  const confirm = () => {
    if (!preview) return;
    try {
      const merged = mergeScheduleTransfer(saved, preview.snapshots, () => crypto.randomUUID());
      if (persist(merged.next)) { setPreview(undefined); setMessage('Добавлено: ' + merged.added + '. Пропущено точных повторов: ' + merged.skipped + '. Процессы и базовые планы не изменены.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось импортировать расчёты.'); }
  };
  const baseline = saved.find(item => item.id === selected);
  const differences = baseline && result ? compareScheduleSnapshots(baseline.result, result) : [];
  const blocked = busy || reading;
  return <details className="schedule-scenario schedule-archive">
    <summary>Снимки и сравнение расчётов</summary>
    <p>Параметры, результаты и исходные модели хранятся только в этом браузере, отдельно для профиля (не защита доступа). До 10 снимков, суммарно до 2 млн символов. На сервер и в GitHub они не отправляются. JSON может содержать сведения процессов — передавайте его осознанно.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button disabled={blocked} onClick={reload}>Перечитать локальные снимки</button>
    <label>Название снимка<input maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label>
    <button disabled={blocked || !storageValid || !result || !request || dirty || !name.trim()} onClick={() => {
      if (result && request && persist([...saved, { id: crypto.randomUUID(), name: name.trim(), savedAt: new Date().toISOString(), request, result }])) setMessage('Текущий расчёт сохранён.');
    }}>Сохранить текущий расчёт</button>
    {dirty && <p>Сначала пересчитайте изменённые параметры.</p>}
    <section aria-label="Перенос расчётов">
      <h3>Перенос расчётов между компьютерами</h3>
      <button disabled={blocked || !saved.length} onClick={() => download(saved)}>Скачать все снимки JSON</button>
      <label>Проверить файл снимков<input type="file" accept=".json,application/json" disabled={blocked || !storageValid} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void inspectFile(file); }}/></label>
      {reading && <p role="status">Проверяем структуру файла…</p>}
      <p>До 8 МБ и 2 млн символов. Поддерживаются текущий пакет JSON и прежняя выгрузка одного снимка. Файл не создаёт процессы, пользователей, организации или серверные планы и не пересчитывает сроки.</p>
      {preview && <div><h4>Предварительная проверка: {preview.file}</h4>
        <p>В файле: {preview.snapshots.length}. Будет добавлено: {preview.added}. Точных повторов пропущено: {preview.skipped}.</p>
        <ul>{preview.snapshots.map(item => <li key={item.id}>{item.name} · {new Date(item.savedAt).toLocaleString('ru-RU')} · {item.result.processes.length} процессов · алгоритм {item.result.sources?.algorithm ?? 'неизвестен'}</li>)}</ul>
        <p>Содержимое файла — сохранённые данные, а не подтверждённый сервером расчёт. Для применения к текущим моделям откройте снимок и пересчитайте. Существующие снимки не заменяются.</p>
        <button disabled={blocked || !storageValid || preview.added === 0} onClick={confirm}>Подтвердить добавление снимков</button>
        <button disabled={blocked} onClick={() => setPreview(undefined)}>Отменить импорт</button>
      </div>}
    </section>
    <label>Сохранённый снимок<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Выберите снимок</option>{saved.map(item => <option key={item.id} value={item.id}>{item.name} · {new Date(item.savedAt).toLocaleString('ru-RU')}</option>)}</select></label>
    {baseline && <>
      <p>Алгоритм: {baseline.result.sources?.algorithm || 'не указан'} · моделей в снимке: {baseline.result.sources?.processes.length ?? 0}</p>
      <button disabled={blocked} onClick={() => onRestore(structuredClone(baseline))}>Открыть сохранённые параметры и результат</button>
      <button disabled={blocked} onClick={() => download([baseline])}>Скачать снимок JSON</button>
      <button disabled={blocked} onClick={() => { if (window.confirm('Удалить только этот локальный снимок расчёта?') && persist(saved.filter(item => item.id !== baseline.id))) setSelected(''); }}>Удалить снимок</button>
      <p>Открытие не пересчитывает прошлое по новым моделям. Кнопка «Рассчитать» применит параметры к текущим данным. Сравнение ниже — между снимком и показанным результатом, не план/факт выполнения.</p>
      {result && <div className="transfer-table"><table><thead><tr><th>Процесс</th><th>Изменение</th><th>Сдвиг окончания, календарные ч</th><th>Изменение нормы, рабочие ч</th><th>Исходная модель</th><th>Ветви и повторы</th></tr></thead><tbody>{differences.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.state === 'added' ? 'Добавлен' : row.state === 'removed' ? 'Удалён из цепочки' : 'Сопоставлен'}</td><td>{row.finishDeltaHours?.toFixed(2) ?? '—'}</td><td>{row.durationDeltaHours?.toFixed(2) ?? '—'}</td><td>{row.sourceChanged === undefined ? 'Нет данных для сравнения' : row.sourceChanged ? 'Изменилась' : 'Совпадает'}</td><td>{row.routeChanged === undefined ? '—' : row.routeChanged ? 'Изменились' : 'Совпадают'}</td></tr>)}</tbody></table></div>}
    </>}
  </details>;
}
