export type RoadmapStatus = 'done' | 'partial' | 'verify' | 'planned' | 'later';
export type RoadmapStep = { id: number; title: string; detail: string; status: RoadmapStatus; statusNote: string };
export type RoadmapStage = { title: string; steps: RoadmapStep[] };
export const roadmapStatusLabels: Record<RoadmapStatus, string> = {
  done: 'Реализовано', partial: 'Частично / в работе', verify: 'Проверить на данных', planned: 'Предстоит', later: 'Отложено',
};

export function parseDevelopmentRoadmap(markdown: string): RoadmapStage[] {
  const stages: RoadmapStage[] = [];
  let stage: RoadmapStage | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) { stage = { title: line.slice(3), steps: [] }; stages.push(stage); }
    const match = line.match(/^(\d+)\. \*\*(.+?)\*\*\s*(.*)$/);
    if (!match || !stage) continue;
    const [title, ...notes] = match[2].replace(/\.$/, '').split(' — ');
    const statusNote = notes.join(' — ');
    const status: RoadmapStatus = stage.title.startsWith('Отложенные') || /позже/.test(statusNote) ? 'later'
      : /проверить на данных/.test(statusNote) ? 'verify'
      : /частично|в работе|базово/.test(statusNote) ? 'partial'
      : /готово/.test(statusNote) ? 'done' : 'planned';
    stage.steps.push({ id: Number(match[1]), title, detail: match[3], status, statusNote });
  }
  return stages.filter(item => item.steps.length);
}

export function roadmapProgress(steps: RoadmapStep[]) {
  const done = steps.filter(step => step.status === 'done').length;
  return { done, total: steps.length, percent: steps.length ? Math.round(done / steps.length * 100) : 0 };
}
