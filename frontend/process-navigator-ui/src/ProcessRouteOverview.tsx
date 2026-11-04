import type { ProcessModel, ProcessNode } from './types';
import {useState} from 'react';
import {overviewLaneMap} from './overview-lane-map';
import {OverviewLinkedBranch} from './OverviewLinkedBranch';

/** Read-only index, never an inferred linear execution plan. */
export function ProcessRouteOverview({ process, onSelect, ancestors=[process.id], onOpenLinked }: { process: ProcessModel; onSelect?: (node: ProcessNode) => void; ancestors?:string[]; onOpenLinked?:(id:string)=>void }) {
  const [expanded,setExpanded]=useState<string>();
  if (process.nodes.length > 5000 || process.edges.length > 10000 || process.lanes.length > 2000) return <p>Обзор не построен: превышен предел 5000 элементов, 10000 стрелок или 2000 дорожек. Исходная схема доступна без этого ограничения.</p>;
  const nodes = new Map(process.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, typeof process.edges>();
  for (const edge of process.edges) {const items=outgoing.get(edge.sourceId);if(items)items.push(edge);else outgoing.set(edge.sourceId,[edge]);}
  const known = new Set(process.lanes.map(lane => lane.id));
  const unassigned = {id: '__unassigned_overview', name: 'Без известной дорожки'};
  const lanes = [...process.lanes, ...(process.nodes.some(node => !known.has(node.laneId)) ? [unassigned] : [])];
  const typeName = { task: 'Действие', startEvent: 'Начало', endEvent: 'Завершение', exclusiveGateway: 'Выбор ветви', parallelGateway: 'Параллельные ветви' };
  const link = (id: string) => { const target = nodes.get(id); return target ? onSelect?<button onClick={() => onSelect(target)}>{target.name || id} · {id}</button>:<span>{target.name||id} · {id}</span> : <span>Отсутствует элемент: {id}</span>; };
  const map=overviewLaneMap(process);
  let nodeBudget=300,edgeBudget=1000;
  return <section className="instruction-card"><h2>Обзор маршрута по дорожкам</h2><p>Это сворачиваемый указатель текущей редакции, не новая схема и не линейный план исполнения. Порядок дорожек и карточек не задаёт последовательность: используйте исходные переходы. События, возвраты и шлюзы не исключаются.</p>
    <p>Элементов: {process.nodes.length}; переходов: {process.edges.length}. По умолчанию раскрываются действующие дочерние редакции. Архивную можно выбрать по номеру; это не исторический снимок всей вложенности.</p>
    <section aria-label="Карта переходов между дорожками"><h3>Карта дорожек</h3>
      <ul className="route-map-lanes">{map.lanes.slice(0,30).map(lane=><li key={lane.index}><strong>{lane.name}</strong><span>Действия: {lane.actions} · события и шлюзы: {lane.events}</span></li>)}</ul>
      <p>Внутри дорожек: {map.internal} · оборванных переходов: {map.broken}.</p>
      <ul className="route-map-pairs">{map.pairs.slice(0,50).map(pair=><li key={pair.from.index+':'+pair.to.index}><strong>{pair.from.name}</strong><span aria-label="переход к">→</span><strong>{pair.to.name}</strong><small>Стрелок: {pair.count}</small></li>)}</ul>
      {map.lanes.length>30&&<p>На карте первые 30 из {map.lanes.length} дорожек.</p>}
      {map.pairs.length>50&&<p>На карте первые 50 из {map.pairs.length} направлений.</p>}
    </section>
    {lanes.slice(0, 100).map((lane, index) => {
      const items = process.nodes.filter(node => lane === unassigned ? !known.has(node.laneId) : node.laneId === lane.id);
      const shown=items.slice(0,Math.min(100,nodeBudget));nodeBudget-=shown.length;
      return <details key={index} className="route-overview-lane"><summary>{lane.name} · элементов: {items.length}</summary>
        {shown.map(node => {
          const edges=outgoing.get(node.id)??[],shownEdges=edges.slice(0,Math.min(100,edgeBudget));edgeBudget-=shownEdges.length;
          return <details key={node.id}><summary>{typeName[node.type]} · {node.name || node.id}</summary><p>{link(node.id)}</p>
          {node.type === 'parallelGateway' && <p>Параллельный шлюз не означает выбор одной альтернативы. Условия объединения смотрите на схеме.</p>}
          {node.linkedProcessId && <p>Связанный процесс: {node.linkedProcessId}.</p>}
          {node.linkedProcessId && onOpenLinked && <><button aria-expanded={expanded===node.id} onClick={()=>setExpanded(expanded===node.id?undefined:node.id)}>{expanded===node.id?'Свернуть связанный обзор':'Раскрыть связанный обзор'}</button>
            {expanded===node.id&&<OverviewLinkedBranch key={node.linkedProcessId} id={node.linkedProcessId} ancestors={ancestors} onOpen={onOpenLinked}/>}</>}
          <ul>{shownEdges.map(edge => <li key={edge.id}>{edge.label || 'Без подписи'} → {link(edge.targetId)} <small>({edge.id})</small></li>)}</ul>
          {!(outgoing.get(node.id)?.length) && <p>Исходящих переходов нет.</p>}
          {edges.length>shownEdges.length && <p>Показано переходов: {shownEdges.length} из {edges.length}. Остальные доступны на исходной схеме.</p>}
        </details>;})}
        {items.length>shown.length && <p>Показано элементов: {shown.length} из {items.length}. Остальные доступны на исходной схеме.</p>}
      </details>;
    })}
    {lanes.length > 100 && <p>Показаны первые 100 дорожек. Остальные доступны на исходной схеме.</p>}
    {process.edges.some(edge => !nodes.has(edge.sourceId)) && <p>Есть стрелки без исходного элемента: они не могут быть включены в карточки обзора. Выполните проверку модели.</p>}
    {!process.nodes.length && <p>В модели нет элементов.</p>}
  </section>;
}
