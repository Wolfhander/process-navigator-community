import type { ProcessHierarchyNode, ProcessHierarchyUpdate } from './types';

export function mergeHierarchyUpdate(item: ProcessHierarchyNode, update: Partial<ProcessHierarchyNode>): ProcessHierarchyUpdate {
  return {
    level: update.level ?? item.level,
    classification: update.classification ?? item.classification,
    parentProcessId: 'parentProcessId' in update ? update.parentProcessId : item.parentProcessId
  };
}
