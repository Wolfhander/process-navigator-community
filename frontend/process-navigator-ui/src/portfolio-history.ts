import type { PortfolioAnalytics } from './types';
import { analyticsCsv, defaultAnalyticsSelection } from './analytics-workspace.ts';
export type PortfolioSnapshot = { id: string; name: string; capturedAt: string; algorithm: string; fingerprint: string; data: PortfolioAnalytics };
export type PortfolioSnapshotSummary = Omit<PortfolioSnapshot, 'data'> & { processCount: number; readinessPercent: number; informationIssueCount: number };
export function portfolioTrend(items: PortfolioSnapshotSummary[]) {
  if (!items.length || new Set(items.map(item => item.algorithm)).size !== 1) return [];
  const sorted = [...items].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const start = Date.parse(sorted[0].capturedAt), span = Date.parse(sorted.at(-1)!.capturedAt) - start;
  if (!Number.isFinite(start) || !Number.isFinite(span)) return [];
  return sorted.map(item => ({ ...item, x: span ? 30 + 500 * (Date.parse(item.capturedAt) - start) / span : 280,
    y: 130 - Math.min(100, Math.max(0, item.readinessPercent)) }));
}
export function comparePortfolioSnapshots(before: PortfolioSnapshot, after: PortfolioSnapshot) {
  if (![before.capturedAt, after.capturedAt].every(date => Number.isFinite(Date.parse(date)))) return { comparable: false, reason: 'Некорректная дата среза; сравнение отключено.', metrics: [], processes: [] };
  if (before.algorithm !== after.algorithm) return { comparable: false, reason: 'Версии методики отличаются; числовое сравнение отключено.', metrics: [], processes: [] };
  if (Date.parse(before.capturedAt) > Date.parse(after.capturedAt)) return { comparable: false, reason: 'Начальный срез позже конечного. Поменяйте выбор.', metrics: [], processes: [] };
  const round = (value: number) => Math.round(value * 10) / 10;
  const metrics = [
    { key: 'totalProcesses', label: 'Модели', unit: '' },
    { key: 'averageReadinessPercent', label: 'Полнота описания', unit: 'п.п.' },
    { key: 'informationIssueCount', label: 'Замечания реестра', unit: '' },
    { key: 'crossLaneTransferCount', label: 'Междорожечные передачи', unit: '' },
    { key: 'totalInstances', label: 'Экземпляры', unit: '' },
    { key: 'overdueSteps', label: 'Просроченные шаги', unit: '' },
  ].map(item => { const key = item.key as keyof PortfolioAnalytics; const a = before.data[key] as number, b = after.data[key] as number; return { ...item, before: a, after: b, delta: round(b - a) }; });
  const previous = new Map(before.data.processes.map(p => [p.id.toLowerCase(), p])), current = new Map(after.data.processes.map(p => [p.id.toLowerCase(), p]));
  const processes = [...new Set([...previous.keys(), ...current.keys()])].sort().map(id => {
    const a = previous.get(id), b = current.get(id);
    const changes: string[] = [];
    if (a && b) {
      for (const [key, label] of [['name', 'Название'], ['owner', 'Владелец'], ['status', 'Статус'], ['readinessPercent', 'Полнота описания'], ['informationIssueCount', 'Замечания реестра'], ['timedTaskCount', 'Нормативы'], ['taskCount', 'Действия'], ['describedTaskCount', 'Описанные действия'], ['laneCount', 'Дорожки'], ['mappedLaneCount', 'Оргпривязки'], ['level', 'Уровень'], ['childProcessCount', 'Дочерние модели'], ['informationObjectCount', 'Объекты'], ['crossLaneTransferCount', 'Передачи'], ['systemTaskCount', 'Системные действия'], ['manualTaskCount', 'Ручные действия'], ['externalTaskCount', 'Внешние действия'], ['totalInstances', 'Экземпляры'], ['activeInstances', 'Активные экземпляры'], ['averageCycleMinutes', 'Средний цикл, мин'], ['overdueSteps', 'Просрочки']] as const)
        if (a[key] !== b[key]) changes.push(label + ': ' + (a[key] ?? 'нет данных') + ' → ' + (b[key] ?? 'нет данных'));
      for (const [key, label] of [['systems','Системы'],['legalEntities','Организации'],['directions','Направления'],['issues','Замечания']] as const)
        if (JSON.stringify([...(a[key] ?? [])].sort()) !== JSON.stringify([...(b[key] ?? [])].sort())) changes.push(label + ': ' + (a[key] ?? []).join('; ') + ' → ' + (b[key] ?? []).join('; '));
    }
    return { id: b?.id ?? a!.id, name: b?.name ?? a!.name, status: !a ? 'added' : !b ? 'removed' : changes.length ? 'changed' : 'same',
      before: a?.readinessPercent, after: b?.readinessPercent, delta: a && b ? round(b.readinessPercent - a.readinessPercent) : null, changes };
  });
  return { comparable: true, reason: 'Сравниваются сохранённые наблюдения, не причины изменений и не фактическая скорость работы.', metrics, processes };
}
export function snapshotCsv(snapshot: PortfolioSnapshot) {
  const data = Object.assign({}, snapshot.data, { snapshotId: snapshot.id, snapshotName: snapshot.name, snapshotAlgorithm: snapshot.algorithm, snapshotFingerprint: snapshot.fingerprint });
  return analyticsCsv(data, defaultAnalyticsSelection, 'portfolio', snapshot.capturedAt);
}
