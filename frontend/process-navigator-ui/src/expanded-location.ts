import type { ProcessModel } from './types';

export type ExpandedProcess = { process: ProcessModel; sourceProcessId: string; sourceProcessName: string; sourceElementId: string; sourceElementName: string };

export async function restoreExpandedProcesses(root: ProcessModel, steps: string[],
  load: (id: string) => Promise<ProcessModel>, signal: AbortSignal) {
  const entries: ExpandedProcess[] = [];
  const visited = new Set([root.id]);
  let parent = root;
  for (const stepId of steps.slice(0, 20)) {
    if (signal.aborted) return { entries, error: '' };
    const source = parent.nodes.find(node => node.id === stepId);
    if (!source?.linkedProcessId || visited.has(source.linkedProcessId)) return { entries, error: 'Сохранённая ветвь изменилась или содержит цикл. Восстановлена доступная часть.' };
    try {
      const child = await load(source.linkedProcessId);
      if (signal.aborted) return { entries, error: '' };
      entries.push({ process: child, sourceProcessId: parent.id, sourceProcessName: parent.name, sourceElementId: source.id, sourceElementName: source.name });
      visited.add(child.id); parent = child;
    } catch {
      return { entries, error: 'Часть сохранённой детализации недоступна. Восстановленные уровни остаются открытыми.' };
    }
  }
  return { entries, error: '' };
}
