import { useCallback, useEffect, useState } from 'react';
import { parseWorkspace, toggleFavorite, visitProcess, workspaceKey } from './personalWorkspace';
import type { PersonalWorkspace, WorkspaceFilter } from './personalWorkspace';

function read(key: string) {
  try { return parseWorkspace(localStorage.getItem(key)); } catch { return parseWorkspace(null); }
}

export function usePersonalWorkspace(userId: string) {
  const key = workspaceKey(userId);
  const [snapshot, setSnapshot] = useState(() => ({ key, data: read(key) }));
  const [failedKey, setFailedKey] = useState('');
  // Never display the previous user's data while the profile is changing.
  const data = snapshot.key === key ? snapshot.data : read(key);
  useEffect(() => {
    setSnapshot({ key, data: read(key) });
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setSnapshot({ key, data: read(key) });
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [key]);
  const update = useCallback((transform: (state: PersonalWorkspace) => PersonalWorkspace) => {
    if (!userId) return;
    setSnapshot(current => {
      const next = transform(current.key === key ? current.data : read(key));
      return { key, data: next };
    });
  }, [key, userId]);
  useEffect(() => {
    if (!userId || snapshot.key !== key) return;
    try { localStorage.setItem(key, JSON.stringify(snapshot.data)); setFailedKey(''); }
    catch { setFailedKey(key); }
  }, [snapshot, key, userId]);
  const visit = useCallback((id: string) => update(state => visitProcess(state, id)), [update]);
  const favorite = useCallback((id: string) => update(state => toggleFavorite(state, id)), [update]);
  const filter = (value: WorkspaceFilter) => update(state => ({ ...state, filter: value }));
  const clearRecent = () => update(state => ({ ...state, recent: [] }));
  return { data, visit, favorite, filter, clearRecent, storageFailed: failedKey === key };
}
