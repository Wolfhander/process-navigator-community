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
      source?.version ?? '', source?.status ?? '', item.slackHours, item.checkpointAt ?? '', item.checkpointDeltaHours ?? '',
      item.maximumDurationHours ?? '', item.maximumStartAt ?? '', item.maximumEndAt ?? '',
      JSON.stringify(result.assumptions.processBranches?.[item.processId] ?? {}),
      result.assumptions.processRepetitions?.[item.processId]?.returnEdgeId ?? '',
      result.assumptions.processRepetitions?.[item.processId]?.plannedRepeats ?? '',
      result.assumptions.processRepetitions?.[item.processId]?.maximumRepeats ?? '']);
  }
  rows[0].push('Предельные рабочие часы', 'Начало при предельных повторах ISO', 'Конец при предельных повторах ISO', 'Решения развилок JSON', 'Возвратная стрелка', 'План дополнительных проходов', 'Предел дополнительных проходов');
  rows.push([], ['Алгоритм', result.sources?.algorithm ?? 'не указан'], ['Направление', result.direction],
    ['Решения всех исходных процессов JSON', JSON.stringify(result.assumptions.processBranches ?? {})],
    ['Повторы всех исходных процессов JSON', JSON.stringify(result.assumptions.processRepetitions ?? {})],
    ['Начальная дата ISO', result.anchorDate], ['Общий коэффициент, %', result.assumptions.durationScalePercent],
    ['Передача в календаре получателя, ч', result.assumptions.transferDelayHours], ['Учитывать ожидание', result.assumptions.includeWaitTime],
    ['Критичность', 'Номинальные рабочие часы; при разных календарях не является точной календарной критичностью']);
  rows.push([],['Оргкалендари',!!result.assumptions.useOrganizationCalendars],['Общий часовой пояс',result.assumptions.timeZoneId??'фиксированный UTC']);
  rows.push([],['Процесс ID','Шаг ID','Источник и график','Начало шага ISO','Конец шага ISO']);
  for(const item of result.processes)for(const step of item.steps??[])rows.push([item.processId,step.elementId,step.calendarSource,step.startAt,step.endAt]);
  rows.push([],['Булевы факты JSON',JSON.stringify(result.assumptions.facts??{})],['Условия объектов JSON',JSON.stringify(result.assumptions.objectRules??[])],['Вероятности XOR JSON',JSON.stringify(result.assumptions.branchProbabilities??[])]);
  if(result.alternativeEnvelope){
    const value=result.alternativeEnvelope;
    rows.push([],['Диапазон полон',value.complete],['Вероятностная масса',value.probabilityMass],['Взвешенные номинальные часы',value.expectedNominalHours],['Гарантия срока','Нет; вероятности и факты — допущения']);
    rows.push(['Сценарий','Вероятность','Начало ISO','Конец ISO','Номинальные часы','Полон','Исходы JSON','Процессы']);
    for(const item of value.cases)rows.push([item.number,item.probability,item.startAt,item.endAt,item.nominalHours,item.complete,JSON.stringify(item.choices),item.processIds.join(',')]);
  }
  return '\uFEFF' + rows.map(row => row.map(scheduleCsvCell).join(';')).join('\r\n');
}
