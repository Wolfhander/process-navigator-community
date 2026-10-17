import type { InformationObjectOccurrence, ProcessModel } from './types';

/** Structural route context only: no claim of reachability or mandatory execution. */
export function informationObjectRoute(value: InformationObjectOccurrence, model?: ProcessModel) {
  const obligation = value.required ? value.condition?.trim() ? 'Обязателен при указанном условии' : 'Обязателен по описанию' : 'Необязательный';
  const branches: { id: string; gateway: string; label: string }[] = [];
  if (!model || value.scope !== 'Step') return { obligation, branches, limited: false };
  const nodes = new Map(model.nodes.map(node => [node.id, node]));
  const incoming = new Map<string, typeof model.edges>();
  for (const edge of model.edges) incoming.set(edge.targetId, [...incoming.get(edge.targetId) ?? [], edge]);
  const visited = new Set<string>();
  const pending = [value.elementId ?? ''];
  let limited = false;
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    if (visited.size >= 200) { limited = true; break; }
    visited.add(id);
    const node = nodes.get(id);
    // Do not attribute pre-merge branch conditions to a shared downstream result.
    if (!node || (incoming.get(id)?.length ?? 0) > 1) continue;
    for (const edge of incoming.get(id) ?? []) {
      const source = nodes.get(edge.sourceId);
      if (source?.type === 'exclusiveGateway' && model.edges.filter(item => item.sourceId === source.id).length > 1) {
        branches.push({ id: edge.id, gateway: source.name || source.id, label: edge.label?.trim() || 'Условие ветви не указано' });
      } else if (source?.type !== 'parallelGateway') pending.push(edge.sourceId);
    }
  }
  return { obligation, branches, limited };
}
