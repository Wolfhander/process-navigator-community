import type { ProcessDecompositionMap, ProcessDecompositionLink, ProcessHierarchyNode } from './types';
export type DecompositionTreeRow = { key: string; ancestors: string[]; processId: string; process?: ProcessHierarchyNode; link?: ProcessDecompositionLink; depth: number; cycle: boolean; expandable: boolean };

export function decompositionTree(data: ProcessDecompositionMap, limit = 2000) {
  const rows: DecompositionTreeRow[] = [];
  const byId = new Map(data.processes.map(item => [item.id, item]));
  const outgoing = new Map<string, ProcessDecompositionLink[]>();
  const incoming = new Set<string>();
  for (const link of data.links) {
    outgoing.set(link.sourceProcessId, [...outgoing.get(link.sourceProcessId) ?? [], link]);
    if (byId.has(link.sourceProcessId)) incoming.add(link.targetProcessId);
  }
  const seen = new Set<string>();
  let truncated = false;
  const visit = (id: string, ancestors: string[], path: string[], link?: ProcessDecompositionLink, index = 0) => {
    if (rows.length >= limit) { truncated = true; return; }
    const key = `${ancestors.at(-1) ?? ''}/${encodeURIComponent(id)}:${index}`;
    const cycle = path.includes(id);
    const expandable = !cycle && path.length < 20 && !!outgoing.get(id)?.length;
    rows.push({ key, ancestors, processId: id, process: byId.get(id), link, depth: path.length, cycle, expandable });
    seen.add(id);
    if (expandable) outgoing.get(id)!.forEach((child, childIndex) => visit(child.targetProcessId, [...ancestors, key], [...path, id], child, childIndex));
  };
  data.processes.filter(item => !incoming.has(item.id)).forEach((item, index) => visit(item.id, [], [], undefined, index));
  // Cyclic components have no root; still make them inspectable.
  data.processes.forEach((item, index) => { if (!seen.has(item.id)) visit(item.id, [], [], undefined, index); });
  return { rows, truncated };
}

export function visibleDecompositionRows(rows: DecompositionTreeRow[], collapsed: Set<string>, query: string) {
  const term = query.trim().toLocaleLowerCase();
  if (term) {
    const matching = rows.filter(row => `${row.process?.name ?? row.processId} ${row.link?.elementName ?? ''}`.toLocaleLowerCase().includes(term));
    const keys = new Set(matching.flatMap(row => [row.key, ...row.ancestors]));
    return rows.filter(row => keys.has(row.key));
  }
  return rows.filter(row => !row.ancestors.some(key => collapsed.has(key)));
}
