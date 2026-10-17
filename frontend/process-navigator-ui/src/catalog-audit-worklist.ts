import type { CatalogAuditItem, ProcessValidationIssue } from './types';

export type CatalogAuditWorkItem = { item: CatalogAuditItem; issue: ProcessValidationIssue };

export function buildCatalogAuditWorkItems(
  items: CatalogAuditItem[],
  category: '' | ProcessValidationIssue['category'] = '',
): CatalogAuditWorkItem[] {
  return items.flatMap(item => item.issues
    .filter(issue => !category || issue.category === category)
    .map(issue => ({ item, issue })))
    .sort((left, right) => (left.issue.severity === right.issue.severity ? 0 : left.issue.severity === 'Error' ? -1 : 1)
      || left.item.processName.localeCompare(right.item.processName, 'ru')
      || left.issue.message.localeCompare(right.issue.message, 'ru'));
}
