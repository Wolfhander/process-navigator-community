import type { ServerScheduleCheck } from './api';
import { compareScheduleSnapshots } from './schedule-snapshots';

export function ScheduleArchiveComparison({ report, disabled, onApply }: { report: ServerScheduleCheck; disabled: boolean; onApply: () => void }) {
  const current = report.currentResult;
  const previous = report.baseline.result;
  const rows = current ? compareScheduleSnapshots(previous, current) : [];
  const before = new Map(previous.processes.map(item => [item.processId, item]));
  const after = new Map(current?.processes.map(item => [item.processId, item]) ?? []);
  const date = (value?: string) => value ? new Date(value).toLocaleString('ru-RU') : '—';
  const hours = (value?: number) => value === undefined ? '—' : (value > 0 ? '+' : '') + value.toFixed(2);
  return <section aria-label="Сравнение серверного снимка с пересчётом"><h3>{report.baseline.name}</h3>
    <p role="status">{report.status === 'Current' ? 'Исходники и результат совпадают' : report.status === 'Changed' ? 'Обнаружены изменения' : 'Актуальность не установлена'} · {date(report.checkedAt)}</p>
    <p>Проверяются сохранённые параметры и дата запуска, а не текущая форма или ход выполнения. Для опубликованного снимка используются опубликованные модели; для снимка с черновиками — доступные текущие черновики. Архивная запись не изменяется.</p>
    {report.changes.map((message, index) => <p key={index}>{message}</p>)}
    {current && <><p>Окончание: {date(previous.endAt)} → {date(current.endAt)}. Старый расчёт: {previous.complete ? 'полный' : 'предварительный'}, новый: {current.complete ? 'полный' : 'предварительный'}.</p>
      <div className="transfer-table"><table><thead><tr><th>Процесс</th><th>Состав</th><th>Прежнее окончание</th><th>Новое окончание</th><th>Сдвиг, календарные ч</th><th>Изменение расчётной длительности, рабочие ч</th><th>Модель</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>
        <td>{row.name}</td><td>{row.state === 'added' ? 'Добавлен' : row.state === 'removed' ? 'Исключён' : 'Сопоставлен'}</td><td>{date(before.get(row.id)?.endAt)}</td><td>{date(after.get(row.id)?.endAt)}</td><td>{hours(row.finishDeltaHours)}</td><td>{hours(row.durationDeltaHours)}</td><td>{row.sourceChanged === undefined ? 'Нет исходников для сравнения' : row.sourceChanged ? 'Изменилась' : 'Совпадает'}</td>
      </tr>)}</tbody></table></div>
      <p>Замечаний нового расчёта: {current.issues.length}. {current.issues.length > 20 ? 'Показаны первые 20.' : ''}</p>
      {current.issues.slice(0, 20).map((issue, index) => <p key={index}>{issue.message}</p>)}
      <button disabled={disabled} onClick={onApply}>Показать новый пересчёт в калькуляторе</button>
    </>}
    <p>Совпадение не гарантирует бизнес-корректность. Это не прогноз по факту выполнения и не повторный запуск старого движка. Новый результат автоматически не сохраняется и не назначается базовым планом.</p>
  </section>;
}
