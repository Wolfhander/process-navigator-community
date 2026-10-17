import { useEffect, useRef, useState } from 'react';
import { checkServerSchedule, deleteServerSchedule, listServerSchedules, loadServerSchedule, saveServerSchedule, type ServerScheduleSummary, type ServerScheduleCheck } from './api';
import { ScheduleArchiveComparison } from './ScheduleArchiveComparison';
import type { ProcessSchedule, ProcessScheduleRequest } from './types';
import type { ScheduleSnapshot } from './schedule-snapshots';
import { exportScheduleTransfer } from './schedule-transfer';

export function ScheduleServerArchive({ result, request, dirty, busy, onRestore }: {
  result?: ProcessSchedule; request?: ProcessScheduleRequest; dirty: boolean; busy: boolean; onRestore: (snapshot: ScheduleSnapshot) => void;
}) {
  const [items, setItems] = useState<ServerScheduleSummary[]>();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [check, setCheck] = useState<ServerScheduleCheck>();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = async (action: () => Promise<void>) => {
    setPending(true); setError(''); setMessage('');
    try { await action(); } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Ошибка серверного архива.'); }
    finally { if (alive.current) setPending(false); }
  };
  const refresh = async () => { const list = await listServerSchedules(); if (alive.current) setItems(list); };
  const save = () => run(async () => {
    if (!request || !result) return;
    await saveServerSchedule(name.trim(), request, result);
    if (!alive.current) return;
    setMessage('Расчёт сохранён на сервере.'); await refresh();
  });
  const open = (id: string, download: boolean) => run(async () => {
    const snapshot = await loadServerSchedule(id);
    if (!alive.current) return;
    if (!download) { onRestore(structuredClone(snapshot)); setMessage('Открыт сохранённый результат без пересчёта.'); return; }
    const raw = exportScheduleTransfer([snapshot]);
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'process-schedule-snapshot.json'; link.click(); URL.revokeObjectURL(url);
  });
  const remove = (id: string) => {
    if (!window.confirm('Удалить этот снимок из личного серверного архива? Процессы и базовые планы не изменятся.')) return;
    void run(async () => { await deleteServerSchedule(id); if (alive.current) { setCheck(undefined); setMessage('Архивный снимок удалён.'); await refresh(); } });
  };
  const inspect = (id: string) => {
    setCheck(undefined);
    void run(async () => { const report = await checkServerSchedule(id); if (alive.current) setCheck(report); });
  };
  const disabled = busy || pending;
  const date = (value: string) => new Date(value).toLocaleString('ru-RU');
  return <details className="schedule-scenario schedule-archive" onToggle={event => { if (event.currentTarget.open && !items && !pending && !error) void run(refresh); }}>
    <summary>Личный серверный архив расчётов</summary>
    <p>До 20 снимков и 20 МБ на профиль. Доступны на другом устройстве при подключении к тому же серверу с тем же профилем. Это не облачная синхронизация между отдельными установками.</p>
    <p>Сохранение повторно рассчитывает текущие доступные модели и сверяет показанный результат. Записи не заменяются по названию; точный повтор с тем же названием не создаёт дубль. Снимки с черновиками доступны только при наличии прав редактирования.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <label>Название серверного снимка<input maxLength={100} value={name} disabled={disabled} onChange={event => setName(event.target.value)}/></label>
    <button disabled={disabled || dirty || !name.trim() || !result || !request} onClick={save}>Сохранить показанный расчёт на сервере</button>
    <button disabled={disabled} onClick={() => void run(refresh)}>Обновить список</button>
    {pending && <p role="status">Выполняем операцию…</p>}
    {items?.length === 0 && <p>Доступных архивных расчётов нет.</p>}
    {items?.map(item => <section key={item.id}><strong>{item.name}</strong><p>{date(item.savedAt)} · {item.processCount} процессов · {item.complete ? 'полный расчёт' : 'предварительный расчёт'}</p><p>{date(item.startAt)} → {date(item.endAt)}</p>
      <button disabled={disabled} onClick={() => void open(item.id, false)}>Открыть без пересчёта</button>
      <button disabled={disabled} onClick={() => inspect(item.id)}>Проверить и сравнить с пересчётом</button>
      <button disabled={disabled} onClick={() => void open(item.id, true)}>Скачать JSON</button>
      <button disabled={disabled} onClick={() => remove(item.id)}>Удалить серверный снимок</button>
    </section>)}
    {check && (
      <ScheduleArchiveComparison report={check} disabled={disabled} onApply={() => {
        if (check.currentResult) onRestore(structuredClone({ ...check.baseline, id: 'recheck-' + check.baseline.id, savedAt: check.checkedAt, result: check.currentResult }));
      }}/>
    )}
    <p>Архив хранит прошлые исходники и даты, не запускает старую версию движка и не назначает план выполнению. Для применения параметров к текущим моделям откройте снимок и пересчитайте. Данные входят в резервные копии сервера и не отправляются в Git.</p>
  </details>;
}
