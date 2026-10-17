import { useMemo, useState } from 'react';
import type { ProcessDecompositionMap } from './types';
import { decompositionTree, visibleDecompositionRows } from './decomposition-tree';

export function DecompositionTreeView({ data, query, onOpen }: { data: ProcessDecompositionMap; query: string; onOpen: (id: string) => void }) {
  const tree = useMemo(() => decompositionTree(data), [data]);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const rows = visibleDecompositionRows(tree.rows, collapsed, query);
  return <section className="decomposition-tree" aria-label="Дерево детализации"><div className="home-quick"><button onClick={() => setCollapsed(new Set())}>Развернуть всё</button><button onClick={() => setCollapsed(new Set(tree.rows.filter(row => row.expandable).map(row => row.key)))}>Свернуть всё</button></div>
    {query && <p>Поиск показывает совпадения и путь к ним независимо от свёрнутых ветвей.</p>}
    {tree.truncated && <p role="status">Обзор ограничен 2000 вхождениями. Для полного просмотра используйте представление по уровням.</p>}
    <ul>{rows.map(row => <li key={row.key} style={{ paddingLeft: `${Math.min(row.depth, 8) * 18}px` }}><div className="decomposition-tree-row">{row.expandable ? <button aria-expanded={query ? true : !collapsed.has(row.key)} aria-label={`${collapsed.has(row.key) ? 'Развернуть' : 'Свернуть'} ${row.process?.name ?? row.processId}`} disabled={!!query} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}>{collapsed.has(row.key) && !query ? '+' : '−'}</button> : <span aria-hidden="true">·</span>}<div><button className="decomposition-tree-open" disabled={!row.process} onClick={() => onOpen(row.processId)}>{row.process?.name ?? `Не найден: ${row.processId}`}</button><small>Глубина ветви {row.depth} · уровень модели {row.process?.level ?? 'неизвестен'}{row.link ? ` · из этапа «${row.link.elementName}»` : ''}</small>{row.cycle && <strong className="decomposition-tree-warning">Циклическая ссылка — дальнейшее раскрытие остановлено</strong>}{row.link && !row.link.boundaryReady && <strong className="decomposition-tree-warning">Границы требуют уточнения: {row.link.missingBoundaries.join(', ') || 'нет данных'}</strong>}</div></div></li>)}</ul>{!rows.length && <p>Совпадений нет.</p>}
  </section>;
}
