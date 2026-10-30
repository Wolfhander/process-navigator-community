import { useEffect,useMemo, useState } from 'react';
import type { ProcessDecompositionMap } from './types';
import { decompositionTree, visibleDecompositionRows,decompositionPage } from './decomposition-tree';

export function DecompositionTreeView({ data, query, onOpen }: { data: ProcessDecompositionMap; query: string; onOpen: (id: string) => void }) {
  const tree = useMemo(() => decompositionTree(data), [data]);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [position,setPosition]=useState({query,page:0});
  useEffect(()=>setPosition({query,page:0}),[query]);
  const rows = visibleDecompositionRows(tree.rows, collapsed, query);
  const page=decompositionPage(rows,position.query===query?position.page:0);
  const byKey=new Map(tree.rows.map(row=>[row.key,row]));
  const reset=()=>setPosition({query,page:0});
  return <section className="decomposition-tree" aria-label="Дерево детализации"><div className="home-quick"><button onClick={() => {setCollapsed(new Set());reset();}}>Развернуть всё</button><button onClick={() => {setCollapsed(new Set(tree.rows.filter(row => row.expandable).map(row => row.key)));reset();}}>Свернуть всё</button></div>
    {query && <p>Поиск показывает совпадения и путь к ним независимо от свёрнутых ветвей.</p>}
    <p role="status">Показаны вхождения {page.from}–{page.to} из {page.total} найденных; построено {tree.rows.length} вхождений. Один подпроцесс может встречаться несколько раз. На странице до 100 строк.</p>
    {tree.truncated && <p role="status">Дерево неполное: {tree.rowLimitReached?'достигнут предел 2000 вхождений. ':''}{tree.depthLimitReached?'Раскрытие остановлено на глубине 20. ':''}Поиск работает только внутри построенной части. Для остальных моделей используйте поиск в представлении «По уровням» или каталог.</p>}
    <nav className="home-quick" aria-label="Страницы дерева"><button disabled={page.page===0} onClick={()=>setPosition({query,page:page.page-1})}>Предыдущие вхождения</button><span>Страница {page.page+1} из {page.pages}</span><button disabled={page.page+1>=page.pages} onClick={()=>setPosition({query,page:page.page+1})}>Следующие вхождения</button></nav>
    <ul>{page.rows.map(row => <li key={row.key} style={{ paddingLeft: `${Math.min(row.depth, 8) * 18}px` }}><div className="decomposition-tree-row">{row.expandable ? <button aria-expanded={query ? true : !collapsed.has(row.key)} aria-label={`${collapsed.has(row.key) ? 'Развернуть' : 'Свернуть'} ${row.process?.name ?? row.processId}`} disabled={!!query} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}>{collapsed.has(row.key) && !query ? '+' : '−'}</button> : <span aria-hidden="true">·</span>}<div><button className="decomposition-tree-open" disabled={!row.process} onClick={() => onOpen(row.processId)}>{row.process?.name ?? `Не найден: ${row.processId}`}</button><small>Путь: {row.ancestors.map(key=>byKey.get(key)?.process?.name??byKey.get(key)?.processId??key).concat(row.process?.name??row.processId).join(" → ")}</small><small>ID модели: {row.processId}{row.link?" · ID этапа: "+row.link.elementId:""}</small><small>Глубина ветви {row.depth} · уровень модели {row.process?.level ?? 'неизвестен'}{row.link ? ` · из этапа «${row.link.elementName}»` : ''}</small>{row.depthLimited && <strong className="decomposition-tree-warning">Дальнейшие уровни не показаны: достигнута глубина 20</strong>}{row.cycle && <strong className="decomposition-tree-warning">Циклическая ссылка — дальнейшее раскрытие остановлено</strong>}{row.link && !row.link.boundaryReady && <strong className="decomposition-tree-warning">Границы требуют уточнения: {row.link.missingBoundaries.join(', ') || 'нет данных'}</strong>}</div></div></li>)}</ul>{!rows.length && <p>Совпадений нет.</p>}
  </section>;
}
