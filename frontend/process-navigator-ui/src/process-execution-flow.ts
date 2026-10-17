import type { ProcessInstance, ProcessModel } from './types';

export type StepReadiness = {
  available: boolean;
  blockerIds: string[];
  blockerNames: string[];
};

export type ProcessExecutionGuidance = {
  steps: Record<string, StepReadiness>;
  availableStepIds: string[];
};

export type ReturnStepOption = { elementId: string; name: string; distance: number };

export function buildReturnStepOptions(process: ProcessModel, instance: ProcessInstance | undefined, sourceElementId: string): ReturnStepOption[] {
  if (!instance || instance.status !== 'Active') return [];
  const source = instance.steps.find(step => step.elementId === sourceElementId);
  if (!source || source.status !== 'InProgress') return [];
  const nodes = new Map(process.nodes.map(node => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const edge of process.edges) incoming.set(edge.targetId, [...(incoming.get(edge.targetId) ?? []), edge.sourceId]);
  const completed = new Set(instance.steps.filter(step => step.status === 'Completed').map(step => step.elementId));
  const distance = new Map<string, number>([[sourceElementId, 0]]);
  const pending = [sourceElementId];
  while (pending.length) {
    const current = pending.shift()!;
    const nextDistance = (distance.get(current) ?? 0) + 1;
    for (const previous of incoming.get(current) ?? []) {
      if (distance.has(previous)) continue;
      distance.set(previous, nextDistance);
      pending.push(previous);
    }
  }
  return [...completed]
    .filter(elementId => elementId !== sourceElementId && distance.has(elementId) && nodes.get(elementId)?.type === 'task')
    .map(elementId => ({ elementId, name: nodes.get(elementId)?.name ?? elementId, distance: distance.get(elementId)! }))
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name, 'ru'));
}

export function buildExecutionGuidance(process: ProcessModel, instance?: ProcessInstance): ProcessExecutionGuidance {
  if (!instance || instance.status !== 'Active') return { steps: {}, availableStepIds: [] };
  const nodes = new Map(process.nodes.map(node => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const edge of process.edges) incoming.set(edge.targetId, [...(incoming.get(edge.targetId) ?? []), edge.sourceId]);
  const status = new Map(instance.steps.map(step => [step.elementId, step.status]));

  const pathSatisfied = (nodeId: string, visited: Set<string>): boolean => {
    if (visited.has(nodeId)) return false;
    const nextVisited = new Set(visited).add(nodeId);
    const node = nodes.get(nodeId);
    if (!node) return false;
    if (node.type === 'task') return status.get(nodeId) === 'Completed';
    if (node.type === 'startEvent') return true;
    const sources = incoming.get(nodeId) ?? [];
    if (sources.length === 0) return true;
    return node.type === 'parallelGateway' && sources.length > 1
      ? sources.every(sourceId => pathSatisfied(sourceId, nextVisited))
      : sources.some(sourceId => pathSatisfied(sourceId, nextVisited));
  };

  const findBlockers = (nodeId: string, visited: Set<string>): string[] => {
    if (visited.has(nodeId)) return [];
    const nextVisited = new Set(visited).add(nodeId);
    const node = nodes.get(nodeId);
    if (!node || node.type === 'startEvent') return [];
    if (node.type === 'task') return status.get(nodeId) === 'Completed' ? [] : [nodeId];
    const sources = incoming.get(nodeId) ?? [];
    const alternatives = sources.map(sourceId => findBlockers(sourceId, nextVisited));
    if (node.type === 'parallelGateway' && sources.length > 1) return alternatives.flat();
    return alternatives.find(items => items.length === 0) ?? alternatives.flat();
  };

  const steps: Record<string, StepReadiness> = {};
  for (const step of instance.steps) {
    const sources = incoming.get(step.elementId) ?? [];
    const available = step.status === 'Skipped' ? false : step.status !== 'NotStarted' || sources.length === 0 || sources.some(sourceId => pathSatisfied(sourceId, new Set()));
    const blockerIds = available ? [] : [...new Set(sources.flatMap(sourceId => findBlockers(sourceId, new Set())))];
    steps[step.elementId] = {
      available,
      blockerIds,
      blockerNames: blockerIds.map(id => nodes.get(id)?.name ?? id)
    };
  }

  return {
    steps,
    availableStepIds: instance.steps.filter(step => step.status === 'NotStarted' && steps[step.elementId]?.available).map(step => step.elementId)
  };
}
