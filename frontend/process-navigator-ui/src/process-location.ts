export type ProcessView = 'diagram' | 'overview' | 'instruction' | 'responsibility';
export type ProcessLocation = { processId: string; elementId?: string; draft: boolean; version?: string; expandedSteps?: string[]; expandedTargets?: string[]; trail?: string[]; view?: ProcessView };

export function readProcessLocation(hash: string): ProcessLocation | undefined {
  const values = new URLSearchParams(hash.replace(/^#/, ''));
  const processId = values.get('process');
  const valid = (value: string | null) => !!value && value.length <= 300 && !/[\u0000-\u001f]/.test(value);
  if (!valid(processId)) return undefined;
  const element = values.get('step');
  const version = values.get('version');
  const view = values.get('view');
  const list = (key: string) => values.getAll(key).filter(valid).slice(0, 20);
  const targetValues=values.getAll('expandTarget');
  const stepValues=values.getAll('expand');
  const paired=targetValues.length>0;
  const validPair=!paired||(stepValues.length===targetValues.length&&stepValues.every(valid)&&targetValues.every(valid));
  const expandedSteps=validPair?list('expand'):[];
  const expandedTargets=paired&&validPair?targetValues.slice(0,20):[];
  const trail = [...new Set(list('parent'))].filter(id => id !== processId);
  return { processId: processId!, elementId: valid(element) ? element! : undefined,
    draft: !valid(version) && values.get('edition') === 'draft', version: valid(version) ? version! : undefined,
    ...(expandedSteps.length ? { expandedSteps } : {}), ...(expandedTargets.length?{expandedTargets}:{}), ...(trail.length ? { trail } : {}),
    ...(view === 'overview' || view === 'instruction' || view === 'responsibility' ? { view } : {}) };
}

export function processLocationHash(location?: ProcessLocation): string {
  if (!location) return '';
  const values = new URLSearchParams({ process: location.processId });
  if (location.elementId) values.set('step', location.elementId);
  if (location.view && location.view !== 'diagram') values.set('view', location.view);
  if (location.version) values.set('version', location.version);
  else if (location.draft) values.set('edition', 'draft');
  const steps=location.expandedSteps?.slice(0,20)??[];
  const targets=location.expandedTargets?.slice(0,20);
  if(!targets?.length||targets.length===steps.length){
    for(const step of steps)values.append('expand',step);
    for(const target of targets??[])values.append('expandTarget',target);
  }
  for (const parent of location.trail?.slice(0, 20) ?? []) values.append('parent', parent);
  return '#' + values.toString();
}
