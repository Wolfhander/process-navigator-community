import type { CatalogAuditItem, ProcessValidationIssue } from './types';

export type CatalogAuditWorkItem = { item: CatalogAuditItem; issue: ProcessValidationIssue };

export function auditWorkItemsCsv(items: CatalogAuditWorkItem[]): string {
  const cell = (value: string) => {
    const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = [['Процесс', 'ID процесса', 'Редакция', 'Категория', 'Важность', 'Код', 'Элемент', 'ID элемента', 'Замечание'],
    ...items.map(({ item, issue }) => [item.processName, item.processId, item.edition, issue.category, issue.severity, issue.code, issue.elementName ?? '', issue.elementId ?? '', issue.message])];
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
}

export function matchesAuditIssue(item: CatalogAuditItem, issue: ProcessValidationIssue,
  category: '' | ProcessValidationIssue['category'] = '', onlyErrors = false, query = ''): boolean {
  if (category && issue.category !== category) return false;
  if (onlyErrors && issue.severity !== 'Error') return false;
  const text = [item.processName, item.processId, item.fileName, issue.code, issue.message, issue.elementName ?? ''].join(' ').toLocaleLowerCase();
  return text.includes(query.trim().toLocaleLowerCase());
}

export function buildCatalogAuditWorkItems(
  items: CatalogAuditItem[],
  category: '' | ProcessValidationIssue['category'] = '',
  onlyErrors = false,
  query = '',
): CatalogAuditWorkItem[] {
  return items.flatMap(item => item.issues
    .filter(issue => matchesAuditIssue(item, issue, category, onlyErrors, query))
    .map(issue => ({ item, issue })))
    .sort((left, right) => (left.issue.severity === right.issue.severity ? 0 : left.issue.severity === 'Error' ? -1 : 1)
      || left.item.processName.localeCompare(right.item.processName, 'ru')
      || left.issue.message.localeCompare(right.issue.message, 'ru'));
}
