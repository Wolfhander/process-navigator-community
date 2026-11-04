import type {ProcessModel} from './types';

export function overviewLaneMap(process:ProcessModel) {
  const lanes=new Map(process.lanes.map((lane,index)=>[lane.id,{id:lane.id,name:lane.name,index,actions:0,events:0}]));
  const unknown:{id:string|null;name:string;index:number;actions:number;events:number}={id:null,name:'Без известной дорожки',index:lanes.size,actions:0,events:0};
  const nodes=new Map<string,typeof unknown>();
  for(const node of process.nodes){
    const lane=lanes.get(node.laneId)??unknown;
    nodes.set(node.id,lane);
    if(node.type==='task')lane.actions++;else lane.events++;
  }
  const groups=new Map<string,{from:typeof unknown;to:typeof unknown;count:number}>();
  let broken=0,internal=0;
  for(const edge of process.edges){
    const from=nodes.get(edge.sourceId),to=nodes.get(edge.targetId);
    if(!from||!to){broken++;continue;}
    if(from===to){internal++;continue;}
    const key=from.index+':'+to.index;
    const group=groups.get(key);
    if(group)group.count++;else groups.set(key,{from,to,count:1});
  }
  return {lanes:[...lanes.values(),...(unknown.actions||unknown.events?[unknown]:[])],pairs:[...groups.values()],broken,internal};
}
