import type { ProcessSchedule } from './types';

export function scheduleCsvCell(value: string | number | boolean) {
  const text = String(value);
  return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
}
export function scheduleCsv(result: ProcessSchedule) {
  const rows: (string | number | boolean)[][] = [['Процесс', 'ID', 'Начало ISO', 'Окончание ISO', 'Рабочие часы', 'Даты достоверны', 'Причины неопределённости', 'Начало рабочего дня', 'Конец рабочего дня', 'UTC, минуты', 'Дни недели', 'Нерабочие даты', 'Версия модели', 'Редакция', 'Резерв, номинальные ч', 'Контрольная дата ISO', 'Отклонение контроля, рабочие ч']];
  for (const item of result.processes) {
    const calendar = result.assumptions.processCalendars?.[item.processId] ?? result.assumptions;
    const source = result.sources?.processes.find(model => model.id === item.processId);
    rows.push([item.processName, item.processId, item.startAt, item.endAt, item.durationHours, item.isDateReliable, item.uncertaintyReasons.join(' | '),
      calendar.workdayStart, calendar.workdayEnd, calendar.utcOffsetMinutes ?? 0, calendar.workingDays.join(','), calendar.nonWorkingDates.join(','),
      source?.version ?? '', source?.status ?? '', item.slackHours, item.checkpointAt ?? '', item.checkpointDeltaHours ?? '']);
  }
  rows.push([], ['Алгоритм', result.sources?.algorithm ?? 'не указан'], ['Направление', result.direction],
    ['Начальная дата ISO', result.anchorDate], ['Общий коэффициент, %', result.assumptions.durationScalePercent],
    ['Передача в календаре получателя, ч', result.assumptions.transferDelayHours], ['Учитывать ожидание', result.assumptions.includeWaitTime],
    ['Критичность', 'Номинальные рабочие часы; при разных календарях не является точной календарной критичностью']);
  return '\uFEFF' + rows.map(row => row.map(scheduleCsvCell).join(';')).join('\r\n');
}
