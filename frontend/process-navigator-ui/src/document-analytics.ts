import type { InformationObjectRegistry } from './types';

const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
export function documentAnalytics(registry: InformationObjectRegistry) {
  const names = new Map<string, Set<string>>();
  for (const object of registry.objects) {
    for (const name of [object.name, ...object.aliases]) {
      const key = normalized(name);
      if (!key) continue;
      const ids = names.get(key) ?? new Set<string>(); ids.add(object.id); names.set(key, ids);
    }
  }
  return registry.objects.map(object => {
    const duplicateIds = new Set<string>();
    for (const name of [object.name, ...object.aliases]) for (const id of names.get(normalized(name)) ?? []) if (id !== object.id) duplicateIds.add(id);
    const occurrences = [...object.producers, ...object.consumers];
    const versions = [...new Set(occurrences.map(o => o.version?.trim()).filter((v): v is string => !!v))];
    const issues = registry.issues.filter(issue => issue.objectId === object.id);
    return { object, duplicateIds: [...duplicateIds].sort(), versions, issues,
      usageCount: occurrences.length, processCount: new Set(occurrences.map(o => o.processId)).size,
      attention: duplicateIds.size > 0 || issues.length > 0 };
  }).sort((a, b) => b.usageCount - a.usageCount || a.object.id.localeCompare(b.object.id));
}

export function documentAnalyticsCsv(registry: InformationObjectRegistry, query = '', attentionOnly = false) {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows: unknown[][] = [['Дата реестра', 'ID', 'Название', 'Состояние', 'Источников', 'Получателей', 'Использований в модели', 'Процессов', 'Версии', 'Возможные дубли ID', 'Проблемы', 'Источники JSON', 'Получатели JSON']];
  for (const row of filterDocumentAnalytics(registry, query, attentionOnly)) rows.push([registry.generatedAt, row.object.id, row.object.name, row.object.state, row.object.producers.length, row.object.consumers.length, row.usageCount, row.processCount, JSON.stringify(row.versions), JSON.stringify(row.duplicateIds), row.issues.map(i => i.message).join('; '), JSON.stringify(row.object.producers), JSON.stringify(row.object.consumers)]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
}

export function filterDocumentAnalytics(registry: InformationObjectRegistry, query: string, attentionOnly: boolean) {
  const needle = normalized(query);
  return documentAnalytics(registry).filter(row => (!attentionOnly || row.attention) && (!needle || [row.object.id, row.object.name, ...row.object.aliases, ...row.object.producers.map(o => o.processName), ...row.object.consumers.map(o => o.processName)].some(value => normalized(value).includes(needle))));
}
