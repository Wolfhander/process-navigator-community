import type { InformationObjectRegistry } from './types';

export const documentScopes = {
  all: 'Все объекты', attention: 'Требуют внимания', gaps: 'Нет источника или получателя',
  versions: 'Проверка версий', duplicates: 'Возможные дубли', lifecycle: 'Статус объекта', sources: 'Несколько источников',
} as const;
export type DocumentScope = keyof typeof documentScopes;
const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
export function documentAnalytics(registry: InformationObjectRegistry) {
  const names = new Map<string, Set<string>>();
  const byObject = new Map<string, InformationObjectRegistry['issues']>();
  for (const issue of registry.issues) {
    const issues = byObject.get(issue.objectId);
    if (issues) issues.push(issue); else byObject.set(issue.objectId,[issue]);
  }
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
    const issues = byObject.get(object.id) ?? [];
    const search = [object.id,object.name,...object.aliases,...occurrences.flatMap(o=>[o.processId,o.processName,o.elementId??'',o.elementName??'',o.version??''])].map(normalized);
    return { object, duplicateIds: [...duplicateIds].sort(), versions, issues,
      usageCount: occurrences.length, processCount: new Set(occurrences.map(o => o.processId)).size,
      search, attention: duplicateIds.size > 0 || issues.length > 0 };
  }).sort((a, b) => b.usageCount - a.usageCount || a.object.id.localeCompare(b.object.id));
}

type AnalyticsRow = ReturnType<typeof documentAnalytics>[number];
const inScope = (row:AnalyticsRow, scope:DocumentScope) => {
  switch(scope) {
    case 'all': return true;
    case 'attention': return row.attention;
    case 'duplicates': return row.duplicateIds.length>0;
    case 'gaps': return row.issues.some(issue=>issue.code==='missing-producer'||issue.code==='missing-consumer');
    case 'versions': return row.issues.some(issue=>issue.code.startsWith('version-'));
    case 'sources': return row.issues.some(issue=>issue.code==='multiple-producers');
    case 'lifecycle': return row.issues.some(issue=>issue.code==='archived-in-use'||issue.code==='draft-in-use');
  }
};
export function selectDocumentAnalytics(rows:AnalyticsRow[],query:string,scope:DocumentScope) {
  const term=normalized(query);
  return rows.filter(row=>inScope(row,scope)&&(!term||row.search.some(value=>value.includes(term))));
}
export function documentAnalyticsSummary(rows:AnalyticsRow[]) {
  const scopes=Object.keys(documentScopes) as DocumentScope[];
  const totals=Object.fromEntries(scopes.map(scope=>[scope,0])) as Record<DocumentScope,number>;
  for(const row of rows) for(const scope of scopes) if(inScope(row,scope)) totals[scope]++;
  return totals;
}
export function pageDocumentAnalytics(rows:AnalyticsRow[],requested:number) {
  const size=50, pages=Math.max(1,Math.ceil(rows.length/size));
  const page=Math.min(pages-1,Math.max(0,Number.isFinite(requested)?Math.floor(requested):0));
  return {page,pages,rows:rows.slice(page*size,(page+1)*size)};
}
export function documentAnalyticsCsv(registry: InformationObjectRegistry, query = '', attentionOnly = false, scope:DocumentScope=attentionOnly?'attention':'all', selected?:AnalyticsRow[]) {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^(?:[\t\r\n]|[\s\uFEFF]*[=+@-])/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows: unknown[][] = [['Дата реестра', 'ID', 'Название', 'Состояние', 'Источников', 'Получателей', 'Использований в модели', 'Процессов', 'Версии', 'Возможные дубли ID', 'Проблемы', 'Источники JSON', 'Получатели JSON','Коды замечаний JSON','Фильтр','Поиск']];
  for (const row of selected ?? selectDocumentAnalytics(documentAnalytics(registry),query,scope)) rows.push([registry.generatedAt, row.object.id, row.object.name, row.object.state, row.object.producers.length, row.object.consumers.length, row.usageCount, row.processCount, JSON.stringify(row.versions), JSON.stringify(row.duplicateIds), row.issues.map(i => i.message).join('; '), JSON.stringify(row.object.producers), JSON.stringify(row.object.consumers),JSON.stringify(row.issues.map(i=>i.code)),documentScopes[scope],query]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
}

export function filterDocumentAnalytics(registry: InformationObjectRegistry, query: string, attentionOnly: boolean) {
  return selectDocumentAnalytics(documentAnalytics(registry),query,attentionOnly?'attention':'all');
}
