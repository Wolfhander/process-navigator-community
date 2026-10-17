export type ProcessLocation = { processId: string; elementId?: string; draft: boolean; version?: string; expandedSteps?: string[]; trail?: string[] };

export function readProcessLocation(hash: string): ProcessLocation | undefined {
  const values = new URLSearchParams(hash.replace(/^#/, ''));
  const processId = values.get('process');
  const valid = (value: string | null) => !!value && value.length <= 300 && !/[\u0000-\u001f]/.test(value);
  if (!valid(processId)) return undefined;
  const element = values.get('step');
  const version = values.get('version');
  const list = (key: string) => values.getAll(key).filter(valid).slice(0, 20);
  const expandedSteps = list('expand');
  const trail = [...new Set(list('parent'))].filter(id => id !== processId);
  return { processId: processId!, elementId: valid(element) ? element! : undefined,
    draft: !valid(version) && values.get('edition') === 'draft', version: valid(version) ? version! : undefined,
    ...(expandedSteps.length ? { expandedSteps } : {}), ...(trail.length ? { trail } : {}) };
}

export function processLocationHash(location?: ProcessLocation): string {
  if (!location) return '';
  const values = new URLSearchParams({ process: location.processId });
  if (location.elementId) values.set('step', location.elementId);
  if (location.version) values.set('version', location.version);
  else if (location.draft) values.set('edition', 'draft');
  for (const step of location.expandedSteps?.slice(0, 20) ?? []) values.append('expand', step);
  for (const parent of location.trail?.slice(0, 20) ?? []) values.append('parent', parent);
  return '#' + values.toString();
}
