export type RoadmapStatus = 'done' | 'partial' | 'verify' | 'planned' | 'later';
export type RoadmapSubtask = { id: string; title: string; status: 'done' | 'verify' | 'planned' };
export type RoadmapStep = { id: number; title: string; detail: string; status: RoadmapStatus; statusNote: string; subtasks: RoadmapSubtask[] };
export type RoadmapStage = { title: string; steps: RoadmapStep[] };
export const roadmapStatusLabels: Record<RoadmapStatus, string> = {
  done: 'Реализовано', partial: 'Частично / в работе', verify: 'Проверить на данных', planned: 'Предстоит', later: 'Отложено',
};

export function parseDevelopmentRoadmap(markdown: string): RoadmapStage[] {
  const stages: RoadmapStage[] = [];
  let stage: RoadmapStage | undefined;
  let currentStep: RoadmapStep | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('#')) currentStep = undefined;
    if (line.startsWith('## ')) { stage = { title: line.slice(3), steps: [] }; stages.push(stage); }
    const child = line.match(/^  - \[([x! ])\] \*\*(\d+\.\d+)\*\* (.+)$/);
    if (child) {
      if (!currentStep || !child[2].startsWith(currentStep.id + '.')) throw new Error('Подзадача не соответствует пункту: ' + child[2]);
      if (currentStep.subtasks.some(item => item.id === child[2])) throw new Error('Повтор подзадачи: ' + child[2]);
      currentStep.subtasks.push({ id: child[2], title: child[3], status: child[1] === 'x' ? 'done' : child[1] === '!' ? 'verify' : 'planned' });
      continue;
    }
    const match = line.match(/^(\d+)\. \*\*(.+?)\*\*\s*(.*)$/);
    if (!match || !stage) continue;
    const [title, ...notes] = match[2].replace(/\.$/, '').split(' — ');
    const statusNote = notes.join(' — ');
    const status: RoadmapStatus = stage.title.startsWith('Отложенные') || /позже/.test(statusNote) ? 'later'
      : /проверить на данных/.test(statusNote) ? 'verify'
      : /частично|в работе|базово/.test(statusNote) ? 'partial'
      : /готово/.test(statusNote) ? 'done' : 'planned';
    currentStep = { id: Number(match[1]), title, detail: match[3], status, statusNote, subtasks: [] };
    stage.steps.push(currentStep);
  }
  return stages.filter(item => item.steps.length);
}

export function roadmapSubtaskProgress(steps: RoadmapStep[]) {
  const tracked = steps.filter(step => step.subtasks.length);
  const tasks = tracked.flatMap(step => step.subtasks);
  return { tracked: tracked.length, total: tasks.length, done: tasks.filter(task => task.status === 'done').length,
    verify: tasks.filter(task => task.status === 'verify').length, planned: tasks.filter(task => task.status === 'planned').length };
}

export function roadmapProgress(steps: RoadmapStep[]) {
  const done = steps.filter(step => step.status === 'done').length;
  return { done, total: steps.length, percent: steps.length ? Math.round(done / steps.length * 100) : 0 };
}
