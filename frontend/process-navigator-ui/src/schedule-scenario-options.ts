import type { ProcessModel } from './types';

export function scheduleScenarioOptions(model: ProcessModel) {
  if (!Array.isArray(model.nodes) || !Array.isArray(model.edges) || model.nodes.length > 10000 || model.edges.length > 20000) return { gateways: [], returns: [], limited: true };
  if (model.nodes.some(node => !node || typeof node.id !== 'string' || typeof node.name !== 'string' || typeof node.type !== 'string') ||
    model.edges.some(edge => !edge || typeof edge.id !== 'string' || typeof edge.sourceId !== 'string' || typeof edge.targetId !== 'string' || (edge.label != null && typeof edge.label !== 'string')))
    return { gateways: [], returns: [], limited: true };
  const outgoing = new Map<string, typeof model.edges>();
  for (const edge of model.edges) outgoing.set(edge.sourceId, [...outgoing.get(edge.sourceId) ?? [], edge]);
  const all = model.nodes.filter(node => node.type === 'exclusiveGateway' && (outgoing.get(node.id)?.length ?? 0) > 1);
  const gateways = all.slice(0, 200).map(node => ({ id: node.id, name: node.name || node.id, edges: outgoing.get(node.id)! }));
  const returns = [];
  for (const gateway of gateways.filter(value => value.edges.length === 2)) {
    for (const edge of gateway.edges) {
      const visited = new Set<string>(); const pending = [edge.targetId];
      while (pending.length) {
        const id = pending.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        if (id === edge.sourceId) { returns.push({ id: edge.id, gatewayId: gateway.id, label: `${gateway.name} → ${model.nodes.find(node => node.id === edge.targetId)?.name || edge.targetId} (${edge.label || edge.id})` }); break; }
        for (const next of outgoing.get(id) ?? []) if (next.id !== edge.id) pending.push(next.targetId);
      }
    }
  }
  return { gateways, returns, limited: all.length > 200 };
}
