import type { ProcessSummary } from './types';

export type WorkspaceFilter = 'recent' | 'favorites' | 'all';
export type PersonalWorkspace = { favorites: string[]; recent: string[]; filter: WorkspaceFilter };
const ids = (value: unknown, limit: number) => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length < 500))].slice(0, limit) : [];

export function parseWorkspace(raw: string | null): PersonalWorkspace {
  try {
    const data = JSON.parse(raw ?? '{}');
    return { favorites: ids(data?.favorites, 500), recent: ids(data?.recent, 20), filter: ['recent', 'favorites', 'all'].includes(data?.filter) ? data.filter : 'recent' };
  } catch { return { favorites: [], recent: [], filter: 'recent' }; }
}

export function visitProcess(state: PersonalWorkspace, id: string): PersonalWorkspace {
  return { ...state, recent: [id, ...state.recent.filter(value => value !== id)].slice(0, 20) };
}

export function toggleFavorite(state: PersonalWorkspace, id: string): PersonalWorkspace {
  return { ...state, favorites: state.favorites.includes(id) ? state.favorites.filter(value => value !== id) : [...state.favorites, id].slice(-500) };
}

export function workspaceKey(userId: string) { return `process-navigator:workspace:v1:${encodeURIComponent(userId)}`; }

export function personalProcessLists(catalog: ProcessSummary[], state: PersonalWorkspace, canOpenDraft: boolean) {
  const available = catalog.filter(p => canOpenDraft || p.status !== 'Draft');
  const byId = new Map(available.map(p => [p.id, p]));
  const resolve = (values: string[]) => values.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  return { recent: resolve(state.recent), favorites: resolve(state.favorites), all: [...available].sort((a, b) => a.name.localeCompare(b.name, 'ru')) };
}
