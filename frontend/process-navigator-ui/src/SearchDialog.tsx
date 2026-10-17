import { useEffect, useState } from 'react';
import { Box, FileText, GitBranch, Search, Workflow, X } from 'lucide-react';
import { searchProcesses } from './api';
import type { SearchResult } from './types';

type Props = { onClose: () => void; onOpen: (result: SearchResult) => void };
const icons = { process: Workflow, element: GitBranch, artifact: FileText, action: Box };
const labels = { process: 'Процесс', element: 'Элемент BPMN', artifact: 'Материал', action: 'Действие' };

export function SearchDialog({ onClose, onOpen }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    if (query.trim().length < 2) { setResults([]); setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const timer = window.setTimeout(() => searchProcesses(query, controller.signal)
      .then(setResults).catch(reason => { if (reason.name !== 'AbortError') setError(reason.message); })
      .finally(() => setLoading(false)), 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  return <div className="modal-backdrop search-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="search-dialog" role="dialog" aria-modal="true" aria-label="Поиск по Process Navigator">
      <div className="search-field"><Search size={20}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Процесс, шаг, роль, инструкция или команда…"/><button onClick={onClose} aria-label="Закрыть"><X size={17}/></button></div>
      <div className="search-results">
        {loading && <div className="search-empty"><div className="loader"/>Ищем во всех опубликованных процессах…</div>}
        {error && <div className="search-empty is-error">{error}</div>}
        {!loading && !error && query.trim().length < 2 && <div className="search-empty"><Search size={25}/><strong>Найдите нужное место в работе предприятия</strong><span>Введите не менее двух символов.</span></div>}
        {!loading && !error && query.trim().length >= 2 && !results.length && <div className="search-empty"><strong>Ничего не найдено</strong><span>Попробуйте другое название, роль или документ.</span></div>}
        {!loading && results.map(result => { const Icon = icons[result.kind]; return <button key={`${result.kind}:${result.processId}:${result.elementId ?? ''}:${result.label}`} onClick={() => onOpen(result)}><span className="search-kind"><Icon size={16}/>{labels[result.kind]}</span><span className="search-copy"><strong>{result.label}</strong><small>{result.description}</small><em>{result.processName}{result.elementName && result.elementName !== result.label ? ` → ${result.elementName}` : ''}</em></span></button>; })}
      </div>
      <footer className="search-footer"><span>Поиск по BPMN и данным «под капотом»</span><span>{results.length ? `${results.length} результатов` : 'Esc — закрыть'}</span></footer>
    </section>
  </div>;
}
