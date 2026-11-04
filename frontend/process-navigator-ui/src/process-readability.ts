import type { ProcessModel } from './types';
import {diagramEdgeLabelPoint,taskLabelFits,type LabelMeasure} from './diagram-labels.ts';

export type ReadabilityAdvice = { code: string; message: string; nodeIds: string[]; edgeIds?: string[] };

// Open rectangle intersection: merely touching a border is not a crossing.
function crossesInterior(a: {x: number; y: number}, b: {x: number; y: number}, box: {x: number; y: number; width: number; height: number}) {
  if (a.x === b.x && a.y === b.y) return false;
  let lower = 0, upper = 1;
  for (const [position, delta, min, max] of [
    [a.x, b.x - a.x, box.x, box.x + box.width],
    [a.y, b.y - a.y, box.y, box.y + box.height]
  ]) {
    if (!delta) { if (position <= min || position >= max) return false; }
    else {
      const t1 = (min - position) / delta, t2 = (max - position) / delta;
      lower = Math.max(lower, Math.min(t1, t2));
      upper = Math.min(upper, Math.max(t1, t2));
    }
  }
  return lower < upper && upper > 0 && lower < 1;
}

/** Advisory geometry heuristics only: never a validity or execution gate. */
export function inspectReadability(process: ProcessModel, measure?:LabelMeasure): { advice: ReadabilityAdvice[]; limited: boolean } {
  const advice: ReadabilityAdvice[] = [];
  if (process.nodes.length > 5000 || process.edges.length > 10000) return {
    advice: [{ code: 'limit', message: 'Рекомендации не рассчитаны: превышен предел 5000 элементов / 10000 стрелок. Модель не блокируется.', nodeIds: [] }], limited: true
  };
  const add = (code: string, message: string, nodeIds: string[]) => advice.push({ code, message, nodeIds });
  const nodes = process.nodes.filter(node => [node.x, node.y, node.width, node.height].every(Number.isFinite) && node.width > 0 && node.height > 0);
  const validNodes = new Set(nodes);
  const invalid = process.nodes.filter(node => !validNodes.has(node));
  if (invalid.length) add('geometry', 'Есть элементы с некорректной геометрией; оценка их подписей и наложений пропущена.', invalid.map(node => node.id));
  let measuredCharacters=0,textLimited=false;
  const long = nodes.filter(node => {
    if(node.type!=='task')return false;
    const name=node.name||'';
    if(measure&&measuredCharacters+Math.min(name.length,2000)<=100_000){
      measuredCharacters+=Math.min(name.length,2000);
      return !taskLabelFits(name,node.width,node.height,measure);
    }
    if(measure)textLimited=true;
    return name.length > Math.max(1, Math.floor((node.width - 20) / 7)) * Math.max(1, Math.floor((node.height - 16) / 16));
  });
  if (long.length) add('text', 'Подпись может не поместиться: сократите название или увеличьте блок. '+(measure?'Ширина символов измерена в браузере; перенос оценён приблизительно.':'Оценка приблизительная, без измерения шрифта.'), long.map(node => node.id));
  const counts=new Map<string,number>();
  for(const node of process.nodes)if(node.type==='task')counts.set(node.laneId,(counts.get(node.laneId)??0)+1);
  const crowded=new Set(process.lanes.filter(lane=>(counts.get(lane.id)??0)>12).map(lane=>lane.id));
  if (crowded.size) add('density', 'На отдельных дорожках больше 12 действий. Рассмотрите декомпозицию или укрупнённое представление; это подсказка, не универсальный предел модели.', process.nodes.filter(node => crowded.has(node.laneId) && node.type === 'task').map(node => node.id));
  let comparisons = 0;
  let limited = false;
  if(textLimited){limited=true;add('text-limit','Для части подписей использована приблизительная оценка: достигнут предел измерения шрифтом.',[]);}
  const overlapping = new Set<string>();
  // Sweep by X avoids quadratic work for ordinary left-to-right diagrams.
  const ordered = [...nodes].sort((a, b) => a.x - b.x);
  outer: for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    for (let j = i + 1; j < ordered.length && ordered[j].x < a.x + a.width; j++) {
      if (++comparisons > 100000) { limited = true; break outer; }
      const b = ordered[j];
      if (Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)) { overlapping.add(a.id); overlapping.add(b.id); }
    }
  }
  if (overlapping.size) add('overlap', 'Блоки геометрически перекрываются. Проверьте расположение на схеме; вложенные контейнеры могут давать допустимые совпадения.', [...overlapping]);
  let segmentCount = 0, crossingChecks = 0;
  let edgesLimited = false;
  const crossedNodes = new Set<string>(), crossedEdges = new Set<string>(), invalidEdges = new Set<string>();
  edgeLoop: for (const edge of process.edges) {
    if (!Array.isArray(edge.points) || edge.points.length < 2) { invalidEdges.add(edge.id); continue; }
    for (let i = 1; i < edge.points.length; i++) {
      if (++segmentCount > 20000) { edgesLimited = true; break edgeLoop; }
      const a = edge.points[i - 1], b = edge.points[i];
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) { invalidEdges.add(edge.id); continue; }
      for (const node of nodes) {
        if (node.id === edge.sourceId || node.id === edge.targetId) continue;
        if (++crossingChecks > 100000) { edgesLimited = true; break edgeLoop; }
        if (crossesInterior(a, b, node)) { crossedNodes.add(node.id); crossedEdges.add(edge.id); }
      }
    }
  }
  if (crossedEdges.size) advice.push({ code: 'edge-crossing', message: 'Стрелки проходят через прямоугольные области посторонних блоков. Проверьте трассировку: для событий/шлюзов используется ограничивающий прямоугольник, для контейнеров пересечение может быть допустимым.', nodeIds: [...crossedNodes], edgeIds: [...crossedEdges] });
  if (invalidEdges.size) advice.push({ code: 'edge-geometry', message: 'Геометрия части стрелок отсутствует или некорректна; пересечения этих участков не проверены.', nodeIds: [], edgeIds: [...invalidEdges] });
  if (edgesLimited) { limited = true; add('edge-limit', 'Проверка стрелок остановлена: предел 20000 сегментов или 100000 сравнений. Результат неполный.', []); }
  const labels:{id:string;x:number;y:number;width:number;height:number}[]=[];
  let labelPoints=0,labelChecks=0,labelLimited=false;
  for(const edge of process.edges){
    if(!edge.label?.trim()||!Array.isArray(edge.points)||edge.points.length<2)continue;
    labelPoints+=edge.points.length;
    if(labelPoints>20000||labels.length>=2000){labelLimited=true;break;}
    if(edge.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))continue;
    const p=diagramEdgeLabelPoint(edge),text=edge.label.trim().replace(/\s+/g,' ');
    const w=(measure?measure(text.slice(0,2000),12):Math.min(text.length,2000)*7)+6;
    if(text.length>2000)labelLimited=true;
    if(Number.isFinite(w))labels.push({id:edge.id,x:p.x-w/2,y:p.y-13,width:w,height:17});
  }
  const overlaps=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>
    a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
  const labelEdges=new Set<string>(),labelNodes=new Set<string>();
  labelLoop:for(let i=0;i<labels.length;i++){
    const label=labels[i];
    for(const node of nodes){
      if(++labelChecks>100000){labelLimited=true;break labelLoop;}
      if(overlaps(label,node)){labelEdges.add(label.id);labelNodes.add(node.id);}
    }
    for(let j=i+1;j<labels.length;j++){
      if(++labelChecks>100000){labelLimited=true;break labelLoop;}
      if(overlaps(label,labels[j])){labelEdges.add(label.id);labelEdges.add(labels[j].id);}
    }
  }
  if(labelEdges.size)advice.push({code:'edge-label-overlap',message:'Подписи стрелок могут перекрывать блоки или друг друга. Проверьте расположение в режиме просмотра.',nodeIds:[...labelNodes],edgeIds:[...labelEdges]});
  if(labelLimited){limited=true;add('edge-label-limit','Проверка подписей стрелок неполна: достигнут предел текста, подписей, точек или сравнений.',[]);}
  if (nodes.length) {
    const width = Math.max(...nodes.map(node => node.x + node.width)) - Math.min(...nodes.map(node => node.x));
    const height = Math.max(...nodes.map(node => node.y + node.height)) - Math.min(...nodes.map(node => node.y));
    if (width / height > 8 || height / width > 8) add('aspect', 'Схема сильно вытянута. Проверьте читаемость в режиме «Весь процесс» и возможность разделения на уровни.', []);
  }
  if (comparisons > 100000) add('limit', 'Проверка наложений остановлена после 100000 сравнений; список может быть неполным.', []);
  return { advice, limited };
}
