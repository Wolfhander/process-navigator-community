import type { ProcessModel, ProcessNode } from './types';

/** Read-only index, never an inferred linear execution plan. */
export function ProcessRouteOverview({ process, onSelect }: { process: ProcessModel; onSelect: (node: ProcessNode) => void }) {
  if (process.nodes.length > 5000 || process.edges.length > 10000 || process.lanes.length > 2000) return <p>Обзор не построен: превышен предел 5000 элементов, 10000 стрелок или 2000 дорожек. Исходная схема доступна без этого ограничения.</p>;
  const nodes = new Map(process.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, typeof process.edges>();
  for (const edge of process.edges) outgoing.set(edge.sourceId, [...(outgoing.get(edge.sourceId) ?? []), edge]);
  const known = new Set(process.lanes.map(lane => lane.id));
  const unassigned = {id: '__unassigned_overview', name: 'Без известной дорожки'};
  const lanes = [...process.lanes, ...(process.nodes.some(node => !known.has(node.laneId)) ? [unassigned] : [])];
  const typeName = { task: 'Действие', startEvent: 'Начало', endEvent: 'Завершение', exclusiveGateway: 'Выбор ветви', parallelGateway: 'Параллельные ветви' };
  const link = (id: string) => { const target = nodes.get(id); return target ? <button onClick={() => onSelect(target)}>{target.name || id} · {id}</button> : <span>Отсутствует элемент: {id}</span>; };
  return <section className="instruction-card"><h2>Обзор маршрута по дорожкам</h2><p>Это сворачиваемый указатель текущей редакции, не новая схема и не линейный план исполнения. Порядок дорожек и карточек не задаёт последовательность: используйте исходные переходы. События, возвраты и шлюзы не исключаются.</p>
    <p>Элементов: {process.nodes.length}; переходов: {process.edges.length}. Детализацию связанных процессов раскрывайте кнопкой «+» на исходной схеме — здесь дочерние редакции не загружаются.</p>
    {lanes.slice(0, 100).map((lane, index) => {
      const items = process.nodes.filter(node => lane === unassigned ? !known.has(node.laneId) : node.laneId === lane.id);
      return <details key={index} className="route-overview-lane"><summary>{lane.name} · элементов: {items.length}</summary>
        {items.slice(0, 100).map(node => <details key={node.id}><summary>{typeName[node.type]} · {node.name || node.id}</summary><p>{link(node.id)}</p>
          {node.type === 'parallelGateway' && <p>Параллельный шлюз не означает выбор одной альтернативы. Условия объединения смотрите на схеме.</p>}
          {node.linkedProcessId && <p>Связанный процесс: {node.linkedProcessId}. Откройте исходный элемент для раскрытия.</p>}
          <ul>{(outgoing.get(node.id) ?? []).slice(0, 100).map(edge => <li key={edge.id}>{edge.label || 'Без подписи'} → {link(edge.targetId)} <small>({edge.id})</small></li>)}</ul>
          {!(outgoing.get(node.id)?.length) && <p>Исходящих переходов нет.</p>}
          {(outgoing.get(node.id)?.length ?? 0) > 100 && <p>Показаны первые 100 исходящих переходов.</p>}
        </details>)}
        {items.length > 100 && <p>Показаны первые 100 элементов дорожки. Остальные доступны на исходной схеме.</p>}
      </details>;
    })}
    {lanes.length > 100 && <p>Показаны первые 100 дорожек. Остальные доступны на исходной схеме.</p>}
    {process.edges.some(edge => !nodes.has(edge.sourceId)) && <p>Есть стрелки без исходного элемента: они не могут быть включены в карточки обзора. Выполните проверку модели.</p>}
    {!process.nodes.length && <p>В модели нет элементов.</p>}
  </section>;
}
