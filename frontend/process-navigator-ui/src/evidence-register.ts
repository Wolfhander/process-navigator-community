import type { ProcessModel, StepEvidence } from './types';

export type EvidenceEntry = Omit<StepEvidence, 'status'> & { status: StepEvidence['status'] | 'missing' | 'unmapped' | 'stale' | 'mapped' | 'routeMismatch'; processId: string; processName: string; elementId: string; elementName: string; edition: 'Draft' | 'Published'; version: string; index: number };
export function sourceRouteGaps(process: ProcessModel, ids: string[]): string[] {
  const known = new Set(process.nodes.map(node => node.id));
  const outgoing = new Map<string, string[]>();
  for (const edge of process.edges ?? []) if (known.has(edge.sourceId) && known.has(edge.targetId)) outgoing.set(edge.sourceId, [...(outgoing.get(edge.sourceId) ?? []), edge.targetId]);
  const gaps: string[] = [];
  for (let i = 1; i < ids.length; i++) {
    if (!known.has(ids[i - 1]) || !known.has(ids[i])) continue;
    const seen = new Set<string>(); const queue = [ids[i - 1]];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor]; if (seen.has(id)) continue;
      seen.add(id); queue.push(...(outgoing.get(id) ?? []).filter(next => !seen.has(next)));
    }
    if (!seen.has(ids[i])) gaps.push(`${ids[i - 1]} → ${ids[i]}`);
  }
  return gaps;
}
export function collectEvidence(process: ProcessModel, edition: EvidenceEntry['edition'], includeMissing = false): EvidenceEntry[] {
  const entries = process.nodes.flatMap(node => {
    const target = { processId: process.id, processName: process.name, elementId: node.id, elementName: node.name, edition, version: process.version };
    const entries: EvidenceEntry[] = (node.evidence ?? []).map((entry, index) => ({ ...entry, ...target, index }));
    if (includeMissing && node.type === 'task' && !(node.evidence ?? []).some(entry => entry.source?.trim()))
      entries.push({ ...target, index: -1, status: 'missing', statement: 'У действия не указан источник описания. Это результат проверки заполнения, а не сохранённый вопрос и не доказательство ошибки маршрута.' });
    return entries;
  });
  for (const [index, requirement] of (process.passport?.sourceRequirements ?? []).entries()) {
    const ids = [...new Set(requirement.elementIds ?? [])];
    const nodes = ids.map(id => process.nodes.find(node => node.id === id));
    const gaps = requirement.checkSequence ? sourceRouteGaps(process, ids) : [];
    const status = !ids.length ? 'unmapped' : nodes.some(node => !node) ? 'stale' : gaps.length || (requirement.checkSequence && ids.length < 2) ? 'routeMismatch' : 'mapped';
    entries.push({ processId: process.id, processName: process.name, version: process.version, edition,
      elementId: nodes.find(node => node)?.id ?? '', elementName: ids.length ? nodes.map((node, i) => node?.name ?? `Не найден: ${ids[i]}`).join('; ') : 'Нет привязки к схеме',
      status, statement: requirement.text + (requirement.checkSequence ? `\nПроверка пути: ${ids.length < 2 ? 'недостаточно элементов' : nodes.some(node => !node) ? 'есть отсутствующие элементы, полная проверка невозможна' : gaps.length ? 'нет маршрута ' + gaps.join('; ') : 'разрывов между соседними элементами не найдено'}. Условия переходов и обязательность порядка не проверены.` : ''), source: requirement.source, locator: requirement.locator, index: -1000 - index });
  }
  return entries;
}
export function filterEvidence(entries: EvidenceEntry[], status: string, edition: string, processId: string, query: string): EvidenceEntry[] {
  const needle = query.trim().toLocaleLowerCase('ru');
  return entries.filter(entry => (status === 'all' || (status === 'unresolved' ? entry.status === 'question' || entry.status === 'assumption' : status === 'requirements' ? ['unmapped', 'stale', 'mapped', 'routeMismatch'].includes(entry.status) : status === 'gaps' ? ['unmapped', 'stale', 'routeMismatch'].includes(entry.status) : entry.status === status))
    && (edition === 'all' || entry.edition === edition) && (!processId || entry.processId === processId)
    && (!needle || [entry.processName, entry.elementName, entry.statement, entry.source, entry.locator, entry.author].some(value => value?.toLocaleLowerCase('ru').includes(needle))));
}

export function evidenceReportCsv(entries: EvidenceEntry[], errors: string[], createdAt: string): string {
  const labels = { fact: 'Факт', assumption: 'Предположение', question: 'Открытый вопрос', missing: 'Не указан источник действия', unmapped: 'Пункт источника не сопоставлен', stale: 'Привязка содержит отсутствующий элемент', mapped: 'Пункт привязан, смысл требует проверки', routeMismatch: 'Нет маршрута в указанном порядке' };
  const rows = [
    ['Отчёт по выбранным условиям', createdAt],
    ['Полнота загрузки', errors.length ? 'Неполный: часть редакций не загружена' : 'Все запрошенные редакции загружены'],
    ['Примечание', 'Наличие источника не подтверждает правильность описания. Замечания об отсутствии источника вычислены, не сохранены как вопросы. Это отчёт, не шаблон импорта.'],
    ...errors.map(error => ['Ошибка загрузки', error]),
    ['ID процесса', 'Процесс', 'Редакция', 'Версия', 'ID шага', 'Шаг', 'Статус', 'Содержание', 'Источник', 'Место', 'Автор'],
    ...entries.map(entry => [entry.processId, entry.processName, entry.edition === 'Draft' ? 'Черновик' : 'Действующая', entry.version, entry.elementId, entry.elementName, labels[entry.status], entry.statement, entry.source ?? '', entry.locator ?? '', entry.author ?? '']),
  ];
  // Quote every field and neutralize spreadsheet formulas in user-controlled text.
  const cell = (value: string) => `"${(/^[\s]*[=+\-@]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
}
