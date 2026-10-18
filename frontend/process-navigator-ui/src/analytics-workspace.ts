import type { PortfolioAnalytics, PortfolioProcess } from './types';
import {analyticsViews,type AnalyticsView} from './analytics-views.ts';
export {analyticsViews};
export type {AnalyticsView};

export const analyticsFilters = ['all', 'attention', 'documents', 'timing', 'draft', 'execution'] as const;
export const analyticsMetrics = {
  processes: 'Процессы', readiness: 'Готовность описания', coverage: 'Охват структуры',
  instances: 'Выполнения', overdue: 'Просроченные шаги', documents: 'Разрывы данных', transfers: 'Передачи между дорожками',
};
export type AnalyticsFilter = typeof analyticsFilters[number];
export type AnalyticsMetric = keyof typeof analyticsMetrics;
export type AnalyticsSelection = { view: AnalyticsView; query: string; filter: AnalyticsFilter; metrics: AnalyticsMetric[] };
export type AnalyticsPreset = { id: string; name: string; selection: AnalyticsSelection };
export const defaultAnalyticsSelection: AnalyticsSelection = { view: 'overview', query: '', filter: 'all', metrics: Object.keys(analyticsMetrics) as AnalyticsMetric[] };
export const analyticsPresetKey = (profileId: string) => 'pn.analytics.views.v1:' + encodeURIComponent(profileId);

function selection(value: unknown): AnalyticsSelection {
  if (!value || typeof value !== 'object') throw Error('Некорректное представление аналитики.');
  const v = value as Record<string, unknown>;
  if (!analyticsViews.includes(v.view as AnalyticsView) || !analyticsFilters.includes(v.filter as AnalyticsFilter)
    || typeof v.query !== 'string' || v.query.length > 300 || !Array.isArray(v.metrics) || !v.metrics.length
    || v.metrics.length > 7 || v.metrics.some(key => typeof key !== 'string' || !Object.hasOwn(analyticsMetrics, key))
    || new Set(v.metrics).size !== v.metrics.length) throw Error('Некорректные фильтры или показатели представления.');
  return { view: v.view as AnalyticsView, filter: v.filter as AnalyticsFilter, query: v.query, metrics: [...v.metrics] as AnalyticsMetric[] };
}

export function readAnalyticsPresets(storage: Pick<Storage, 'getItem'>, key: string): { presets: AnalyticsPreset[]; error: string } {
  try {
    const raw = storage.getItem(key);
    if (raw == null) return { presets: [], error: '' };
    if (raw.length > 100_000) throw Error('Сохранённые представления слишком велики.');
    const data = JSON.parse(raw);
    if (data?.schemaVersion !== 1 || !Array.isArray(data.presets) || data.presets.length > 20) throw Error('Неизвестный формат представлений.');
    const ids = new Set<string>(), names = new Set<string>();
    const presets = data.presets.map((p: Record<string, unknown>) => {
      if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(p.id)
        || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80
        || ids.has(p.id) || names.has(p.name.trim().toLocaleLowerCase('ru'))) throw Error('Некорректное или повторное представление.');
      ids.add(p.id); names.add(p.name.trim().toLocaleLowerCase('ru'));
      return { id: p.id, name: p.name.trim(), selection: selection(p.selection) };
    });
    return { presets, error: '' };
  } catch {
    return { presets: [], error: 'Представления не прочитаны. Данные в хранилище не изменены; явное сохранение заменит их.' };
  }
}

export function writeAnalyticsPresets(storage: Pick<Storage, 'setItem'>, key: string, presets: AnalyticsPreset[]) {
  const raw = JSON.stringify({ schemaVersion: 1, presets });
  if (readAnalyticsPresets({ getItem: () => raw }, key).error) return 'Представления не сохранены: проверьте формат, названия и предел 20 записей.';
  try { storage.setItem(key, raw); return ''; } catch { return 'Браузер не разрешил сохранить представления. Предыдущие настройки не изменены.'; }
}

export function selectAnalyticsProcesses(data: PortfolioAnalytics, query: string, filter: AnalyticsFilter): PortfolioProcess[] {
  const needle = query.trim().toLocaleLowerCase('ru');
  return data.processes.filter(p => (!needle || [p.id, p.name, p.owner, ...p.directions, ...p.legalEntities]
    .some(value => value.toLocaleLowerCase('ru').includes(needle))) && (filter === 'all'
      || (filter === 'attention' && p.issues.length > 0)
      || (filter === 'documents' && p.informationIssueCount > 0)
      || (filter === 'timing' && p.timedTaskCount < p.taskCount)
      || (filter === 'draft' && p.status.toLowerCase() === 'draft')
      || (filter === 'execution' && p.totalInstances > 0)));
}

function csvCell(value: unknown) {
  let text = value == null ? 'нет данных' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function analyticsCsv(data: PortfolioAnalytics, current: AnalyticsSelection, scope: 'processes' | 'portfolio', loadedAt: string) {
  if (!['processes', 'portfolio'].includes(scope) || !Number.isFinite(Date.parse(loadedAt))) throw Error('Не задан состав или дата загрузки отчёта.');
  const valid = selection(current);
  const selected = selectAnalyticsProcesses(data, valid.query, valid.filter);
  const scopeLabel = scope === 'portfolio' ? 'Весь портфель; фильтр списка не применяется' : 'Отфильтрованный список процессов';
  const rows: unknown[][] = [['Область', 'Данные загружены UTC', 'Поиск списка', 'Фильтр списка', 'ID процесса', 'Процесс', 'Код', 'Поле / показатель', 'Значение', 'Единица', 'Основание']];
  const add = (id: string, name: string, code: string, label: string, value: unknown, unit: string, basis: string) =>
    rows.push([scopeLabel, loadedAt, scope === 'processes' ? valid.query : '', scope === 'processes' ? valid.filter : 'не применяется', id, name, code, label, value, unit, basis]);
  add('', '', 'scopeCount', 'Процессов в выгрузке', scope === 'portfolio' ? data.processes.length : selected.length, 'моделей', 'Полный состав ответа API; без постраничного усечения.');
  if (scope === 'portfolio') {
    const metrics: Record<AnalyticsMetric, [unknown, string, string]> = {
      processes: [data.totalProcesses, 'моделей', 'Количество процессов каталога; модель и экземпляр не одно и то же.'],
      readiness: [data.averageReadinessPercent, '%', 'Среднее по моделям: владелец 20 + оргпривязки 35 + описание 25 + нормы 10 + направление 10. Не эффективность.'],
      coverage: [data.totalDepartments ? Math.round(data.participatingDepartments / data.totalDepartments * 100) : 0, '%', 'Участвующие подразделения / все подразделения; при нулевом знаменателе 0.'],
      instances: [data.totalInstances, 'экземпляров', 'Все зарегистрированные экземпляры. Не количество моделей.'],
      overdue: [data.overdueSteps, 'шагов', 'Просрочки зарегистрированного исполнения.'],
      documents: [data.informationIssueCount, 'замечаний', 'Замечания реестра, не количество уникальных документов.'],
      transfers: [data.crossLaneTransferCount, 'переходов', 'Исходные стрелки BPMN между разными дорожками.'],
    };
    for (const key of valid.metrics) { const [value, unit, basis] = metrics[key]; add('', '', key, analyticsMetrics[key], value, unit, basis); }
    for (const [key, value] of Object.entries(data).filter(([key]) => key !== 'processes'))
      add('', '', 'source_' + key, 'Источник API: ' + key, value, typeof value === 'object' ? 'JSON' : '', 'Исходный агрегат всего портфеля; не сумма отфильтрованных процессов. Охват использует participatingDepartments / totalDepartments.');
  }
  // Source rows always accompany totals; no re-aggregation of non-additive global measures.
  for (const p of scope === 'portfolio' ? data.processes : selected) {
    for (const [code, label, value, unit] of [
      ['status','Статус',p.status,''], ['owner','Владелец',p.owner,''], ['legalEntities','Организации',p.legalEntities,'JSON'],
      ['directions','Направления',p.directions,'JSON'], ['level','Уровень',p.level,''],
      ['childProcessCount','Дочерние модели',p.childProcessCount,''],
      ['laneCount','Дорожки',p.laneCount,''], ['mappedLaneCount','Привязанные дорожки',p.mappedLaneCount,''],
      ['taskCount','Действия',p.taskCount,''], ['describedTaskCount','Описанные действия',p.describedTaskCount,''],
      ['timedTaskCount','Действия с нормами',p.timedTaskCount,''], ['systemTaskCount','Действия с системами',p.systemTaskCount,''],
      ['manualTaskCount','Ручные / неуточнённые',p.manualTaskCount,''], ['externalTaskCount','Внешние действия',p.externalTaskCount,''],
      ['systems','Системы',p.systems,'JSON'], ['informationObjectCount','Объекты',p.informationObjectCount,''],
      ['informationIssueCount','Замечания реестра',p.informationIssueCount,''], ['crossLaneTransferCount','Передачи',p.crossLaneTransferCount,''],
      ['totalInstances','Экземпляры',p.totalInstances,''], ['activeInstances','Активные экземпляры',p.activeInstances,''],
      ['averageCycleMinutes','Среднее время цикла',p.averageCycleMinutes,'мин'], ['overdueSteps','Просрочки',p.overdueSteps,''],
      ['readinessPercent','Полнота описания',p.readinessPercent,'%'], ['issues','Замечания',p.issues,'JSON'],
    ]) add(p.id, p.name, String(code), String(label), value, String(unit), 'Текущий ответ API по модели; не факт исполнения каждого шага.');
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
