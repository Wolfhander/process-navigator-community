import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, GitBranch, Search, Unlink } from 'lucide-react';
import { loadProcessDecomposition } from './api';
import { DecompositionTreeView } from './DecompositionTreeView';
import type { ProcessDecompositionMap as DecompositionData } from './types';
import './process-decomposition.css';

export function ProcessDecompositionMap({ onOpenProcess }: { onOpenProcess: (processId: string) => void }) {
  const [data, setData] = useState<DecompositionData>();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'levels' | 'tree'>('levels');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    loadProcessDecomposition(controller.signal).then(setData).catch(reason => reason.name !== 'AbortError' && setError(reason.message));
    return () => controller.abort();
  }, []);
  const visible = useMemo(() => {
    if (!data) return [];
    const term = query.trim().toLocaleLowerCase('ru');
    if (!term) return data.processes;
    const matchingIds = new Set(data.processes.filter(item => `${item.name} ${item.id} ${item.classification}`.toLocaleLowerCase('ru').includes(term)).map(item => item.id));
    data.links.forEach(link => { if (`${link.elementName} ${link.targetProcessName ?? ''}`.toLocaleLowerCase('ru').includes(term)) { matchingIds.add(link.sourceProcessId); matchingIds.add(link.targetProcessId); } });
    return data.processes.filter(item => matchingIds.has(item.id));
  }, [data, query]);

  if (error) return <section className="decomposition-state"><AlertTriangle size={25}/><strong>Карта детализации недоступна</strong><span>{error}</span></section>;
  if (!data) return <section className="decomposition-state"><div className="loader"/><span>Строим связи между уровнями…</span></section>;
  const broken = data.links.filter(link => !link.targetProcessName);
  const incomplete = data.links.filter(link => link.targetProcessName && !link.boundaryReady);
  const levels = Array.from({ length: Math.max(3, ...data.processes.map(item => item.level)) + 1 }, (_, level) => level);

  return <section className="decomposition-map">
    <header><div><span className="eyebrow">Архитектура процессов</span><h2>Уровни и детализация</h2><p>Каждая связь показывает, какая задача верхнего уровня раскрывается отдельной BPMN-схемой.</p></div><label><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти процесс или этап…"/></label></header>
    <div className="decomposition-summary"><span><GitBranch size={18}/><strong>{data.links.length}</strong> связей</span><span className={broken.length ? 'is-error' : ''}><Unlink size={18}/><strong>{broken.length}</strong> потерянных</span><span className={incomplete.length ? 'is-warning' : ''}><CheckCircle2 size={18}/><strong>{incomplete.length}</strong> без согласованных границ</span></div>
    {data.links.length === 0 && <div className="decomposition-hint"><GitBranch size={18}/><span><strong>Связи детализации пока не назначены</strong><small>Откройте черновик процесса, выберите задачу и укажите детальную схему в её контексте.</small></span></div>}
    <nav className="home-quick" aria-label="Представление детализации"><button aria-pressed={view === 'levels'} onClick={() => setView('levels')}>По уровням</button><button aria-pressed={view === 'tree'} onClick={() => setView('tree')}>Дерево связей</button></nav>
    {view === 'tree' ? <DecompositionTreeView data={data} query={query} onOpen={onOpenProcess}/> : <div className="decomposition-levels">{levels.map(level => {
      const items = visible.filter(item => item.level === level);
      return <section className="decomposition-level" key={level}><header><strong>Уровень {level}</strong><span>{items.length}</span></header><div>{items.map(item => {
        const outgoing = data.links.filter(link => link.sourceProcessId === item.id);
        const incoming = data.links.filter(link => link.targetProcessId === item.id);
        return <article key={item.id}><button className="decomposition-process" onClick={() => onOpenProcess(item.id)}><span><strong>{item.name}</strong><small>{item.classification} · {item.status}</small></span><ArrowRight size={16}/></button>{(outgoing.length > 0 || incoming.length > 0) && <div className="decomposition-relations">{incoming.length > 0 && <small>Используется в {incoming.length} {incoming.length === 1 ? 'процессе' : 'процессах'}</small>}{outgoing.map(link => <div className="decomposition-link" key={`${link.elementId}:${link.targetProcessId}`}><button className={!link.targetProcessName ? 'is-broken' : !link.boundaryReady ? 'is-incomplete' : ''} onClick={() => link.targetProcessName && onOpenProcess(link.targetProcessId)} disabled={!link.targetProcessName} title={link.elementName}><GitBranch size={12}/><span>{link.targetProcessName ?? `Не найден: ${link.targetProcessId}`}</span></button>{link.missingBoundaries.length > 0 && <small>Не заполнено: {link.missingBoundaries.join(', ')}</small>}</div>)}</div>}</article>;
      })}{!items.length && <p>Нет процессов</p>}</div></section>;
    })}</div>}
  </section>;
}
