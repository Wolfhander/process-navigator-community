import type { InformationObject } from './types';

export type DependencyObject = { id: string; name: string; kind: InformationObject['kind']; required: boolean; hasIssue: boolean };
export type ProcessDependency = { sourceId: string; sourceName: string; targetId: string; targetName: string; objects: DependencyObject[] };

export function buildProcessDependencies(objects: InformationObject[], issueObjectIds: ReadonlySet<string> = new Set()): ProcessDependency[] {
  const grouped = new Map<string, ProcessDependency>();
  for (const object of objects) {
    const producers = [...new Map(object.producers.map(item => [item.processId, item])).values()];
    const consumers = [...new Map(object.consumers.map(item => [item.processId, item])).values()];
    for (const producer of producers) for (const consumer of consumers) {
      if (producer.processId === consumer.processId) continue;
      const key = `${producer.processId}\u001f${consumer.processId}`;
      const dependency = grouped.get(key) ?? { sourceId: producer.processId, sourceName: producer.processName, targetId: consumer.processId, targetName: consumer.processName, objects: [] };
      if (!dependency.objects.some(item => item.id === object.id)) dependency.objects.push({
        id: object.id,
        name: object.name,
        kind: object.kind,
        required: object.consumers.some(item => item.processId === consumer.processId && item.required),
        hasIssue: issueObjectIds.has(object.id),
      });
      grouped.set(key, dependency);
    }
  }
  return [...grouped.values()].sort((left, right) => left.sourceName.localeCompare(right.sourceName, 'ru') || left.targetName.localeCompare(right.targetName, 'ru'));
}
