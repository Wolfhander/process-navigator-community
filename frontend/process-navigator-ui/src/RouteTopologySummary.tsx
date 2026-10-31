import type {ProcessValidationReport} from './types';
export function RouteTopologySummary({topology,onSelect}:{topology:ProcessValidationReport['topology'];onSelect:(id:string)=>void}){
  if(!topology)return null;
  return <details className="route-topology-summary"><summary>Структура маршрута: пар {topology.pairs.length}, компонент повтора {topology.cycles.length}{topology.limited?' · проверка ограничена':''}</summary>
    <p>Это структурное сопоставление, не доказательство исполнения или истинности условий. Неподтверждённая пара не означает автоматически неверный BPMN. Идентификаторы ниже ведут к исходным элементам.</p>
    {topology.limited&&<p role="status">Часть анализа не выполнена. Причина указана в замечаниях; отсутствие других замечаний не подтверждает полную проверку.</p>}
    <h3>Подтверждённые структурные пары</h3><p>Показано {Math.min(100,topology.pairs.length)} из {topology.pairs.length}.</p>
    {topology.pairs.slice(0,100).map((p,i)=><p key={i}><button onClick={()=>onSelect(p.forkId)}>{p.forkId}</button> → <button onClick={()=>onSelect(p.joinId)}>{p.joinId}</button> · исходных ветвей {p.branches}</p>)}
    <h3>Компоненты повторов</h3><p>Показано {Math.min(100,topology.cycles.length)} из {topology.cycles.length}. Это множества элементов, не последовательности переходов; в компоненте показано до 50 ID.</p>
    {topology.cycles.slice(0,100).map((c,i)=><article key={i}><p>Элементов {c.totalNodes}; показано {c.nodeIds.length}. Выходов {c.totalExits}; показано {c.exitEdgeIds.length}. {c.hasLabeledExclusiveExit?'Есть подписанный выход XOR; условие и число повторов требуют проверки.':'Подписанный выход XOR не обнаружен.'}</p>
      <div>{c.nodeIds.map(id=><button key={id} onClick={()=>onSelect(id)}>{id}</button>)}</div><p>Стрелки выхода: {c.exitEdgeIds.join(', ')||'не обнаружены'}.</p></article>)}
  </details>;
}
