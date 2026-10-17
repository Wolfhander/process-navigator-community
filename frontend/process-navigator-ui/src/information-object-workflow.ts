import type { InformationObject, InformationObjectBinding, InformationObjectOccurrence } from './types';

export function relatedInformationOccurrences(
  item: InformationObject,
  role: InformationObjectBinding['role'],
  currentProcessId: string,
  currentElementId: string,
) {
  const values = role === 'Input'
    ? item.producers
    : role === 'Output'
      ? item.consumers
      : [...item.producers, ...item.consumers, ...item.references];
  const seen = new Set<string>();

  return values.filter(value => {
    if (value.processId === currentProcessId && value.elementId === currentElementId) return false;
    const key = `${value.processId}:${value.elementId ?? ''}:${value.direction}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function informationRelationLabel(role: InformationObjectBinding['role']) {
  return role === 'Input' ? 'Создают до этого шага' : role === 'Output' ? 'Получают после этого шага' : 'Связанные участники';
}

export function missingInformationRelationLabel(role: InformationObjectBinding['role']) {
  return role === 'Input' ? 'Источник не найден' : role === 'Output' ? 'Следующий получатель не найден' : 'Другие участники не найдены';
}

export function informationOccurrenceKey(occurrence: InformationObjectOccurrence) {
  return `${occurrence.processId}:${occurrence.elementId ?? ''}:${occurrence.direction}`;
}
