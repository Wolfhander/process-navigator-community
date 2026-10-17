import { useState } from 'react';
import { ArrowRight, Search, Star } from 'lucide-react';
import type { ProcessSummary } from './types';
import type { PersonalWorkspace, WorkspaceFilter } from './personalWorkspace';
import { personalProcessLists } from './personalWorkspace';

type Props = {
  catalog: ProcessSummary[]; preferences: PersonalWorkspace; canOpenDraft: boolean; storageFailed: boolean;
  onOpen: (id: string) => void; onFavorite: (id: string) => void;
  onFilter: (value: WorkspaceFilter) => void; onClearRecent: () => void;
};
export function PersonalProcesses({ catalog, preferences, canOpenDraft, storageFailed, onOpen, onFavorite, onFilter, onClearRecent }: Props) {
  const [query, setQuery] = useState('');
  const lists = personalProcessLists(catalog, preferences, canOpenDraft);
  const term = query.trim().toLocaleLowerCase('ru');
  const items = lists[preferences.filter].filter(p => `${p.name} ${p.id} ${p.owner}`.toLocaleLowerCase('ru').includes(term));
  return <section className="personal-processes" aria-label="Мои процессы">
    <div className="personal-heading"><h2>Мои процессы</h2>{preferences.filter === 'recent' && preferences.recent.length > 0 && <button onClick={onClearRecent}>Очистить историю</button>}</div>
    <p>Избранное и история хранятся в этом браузере отдельно для каждого профиля. Между компьютерами они пока не переносятся.</p>
    {storageFailed && <p role="status">Браузер запретил сохранение настроек. Списки доступны до закрытия страницы.</p>}
    <div className="personal-tools"><div role="group" aria-label="Список процессов">{([['recent', 'Недавние'], ['favorites', 'Избранное'], ['all', 'Все доступные']] as const).map(([value, label]) => <button key={value} aria-pressed={preferences.filter === value} onClick={() => onFilter(value)}>{label} <span>{lists[value].length}</span></button>)}</div><label><Search size={17}/><input aria-label="Поиск в моих процессах" placeholder="Название, код или владелец…" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    <div className="personal-list">{items.map(item => <article key={item.id}><button className="personal-open" onClick={() => onOpen(item.id)}><span><strong>{item.name}</strong><small>{item.id} · {item.status === 'Draft' ? 'Черновик' : 'Опубликован'} · {item.owner || 'Владелец не назначен'}</small></span><ArrowRight size={18}/></button><button className="personal-star" aria-pressed={preferences.favorites.includes(item.id)} aria-label={`${preferences.favorites.includes(item.id) ? 'Убрать из избранного' : 'В избранное'}: ${item.name}`} onClick={() => onFavorite(item.id)}><Star size={19} fill={preferences.favorites.includes(item.id) ? 'currentColor' : 'none'}/></button></article>)}</div>
    {!items.length && <div className="personal-empty">{term ? 'Ничего не найдено. Измените запрос или выберите другой список.' : preferences.filter === 'recent' ? 'Откройте процесс — он появится здесь. Начать можно со списка «Все доступные».' : preferences.filter === 'favorites' ? 'Нажмите звёздочку рядом с процессом здесь или в каталоге.' : 'Нет доступных процессов для этого профиля.'}</div>}
    <small className="personal-count">Показано: {items.length}. В истории сохраняются последние 20 процессов.</small>
  </section>;
}
