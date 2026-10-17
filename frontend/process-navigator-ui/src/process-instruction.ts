import type { ProcessModel } from './types';

export function buildProcessInstruction(process: ProcessModel) {
  if (process.nodes.length > 5000 || process.edges.length > 10000) throw new Error('Инструкция ограничена 5000 элементами и 10000 переходами. Откройте подробную схему.');
  const nodes = new Map(process.nodes.map(node => [node.id, node]));
  if (nodes.size !== process.nodes.length) throw new Error('Повторяются ID элементов. Исправьте модель перед построением инструкции.');
  const incoming = new Map<string, typeof process.edges>();
  const outgoing = new Map<string, typeof process.edges>();
  const broken = process.edges.filter(edge => !nodes.has(edge.sourceId) || !nodes.has(edge.targetId));
  for (const edge of process.edges) {
    if (!nodes.has(edge.sourceId) || !nodes.has(edge.targetId)) continue;
    incoming.set(edge.targetId, [...incoming.get(edge.targetId) ?? [], edge]);
    outgoing.set(edge.sourceId, [...outgoing.get(edge.sourceId) ?? [], edge]);
  }
  const starts = process.nodes.filter(node => node.type === 'startEvent');
  const roots = starts.length ? starts : process.nodes.filter(node => !incoming.has(node.id));
  const distance = new Map(roots.map(node => [node.id, 0]));
  const queue = roots.map(node => node.id);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const edge of outgoing.get(id) ?? []) if (!distance.has(edge.targetId)) {
      distance.set(edge.targetId, distance.get(id)! + 1); queue.push(edge.targetId);
    }
  }
  const degrees = new Map(process.nodes.map(node => [node.id, incoming.get(node.id)?.length ?? 0]));
  const pending = process.nodes.filter(node => degrees.get(node.id) === 0).map(node => node.id);
  for (let index = 0; index < pending.length; index++) for (const edge of outgoing.get(pending[index]) ?? []) {
    const degree = degrees.get(edge.targetId)! - 1; degrees.set(edge.targetId, degree);
    if (degree === 0) pending.push(edge.targetId);
  }
  const tasks = process.nodes.filter(node => node.type === 'task').sort((a, b) =>
    (distance.get(a.id) ?? Infinity) - (distance.get(b.id) ?? Infinity) || a.id.localeCompare(b.id));
  return { tasks, nodes, incoming, outgoing, broken, hasCycle: pending.length !== process.nodes.length,
    hasStart: starts.length > 0, unreachable: tasks.filter(node => !distance.has(node.id)).map(node => node.id) };
}
