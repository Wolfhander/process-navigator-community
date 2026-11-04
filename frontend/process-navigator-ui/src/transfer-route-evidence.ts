import type {InformationTransfer} from './information-transfers';
import type {ProcessModel} from './types';

export const transferRouteLabels = {
  reachable:'Путь в BPMN найден', unreachable:'Нет пути в этой схеме', external:'Разные модели — путь не проверен',
  same:'Один этап — не межэтапная передача', unknown:'Недостаточно данных для проверки',
} as const;
export type TransferRoute = keyof typeof transferRouteLabels;

/** A positive result establishes directed reachability only, not execution or document delivery. */
export function transferRouteEvidence(rows:InformationTransfer[],models:Record<string,ProcessModel>) {
  type Graph={nodes:Set<string>; next:Map<string,string[]>; incomplete:boolean; cache:Map<string,Set<string>>};
  const graphs=new Map<string,Graph|undefined>();
  let remaining=200_000;
  const graph=(id:string)=>{
    if(graphs.has(id))return graphs.get(id);
    const model=Object.hasOwn(models,id)?models[id]:undefined;
    if(!model||model.id!==id||model.nodes.length>10_000||model.edges.length>20_000){graphs.set(id,undefined);return;}
    const nodes=new Set(model.nodes.map(n=>n.id)),next=new Map<string,string[]>();
    if(nodes.size!==model.nodes.length){graphs.set(id,undefined);return;}
    let incomplete=false;
    for(const edge of model.edges){
      if(!nodes.has(edge.sourceId)||!nodes.has(edge.targetId)){incomplete=true;continue;}
      const targets=next.get(edge.sourceId);
      if(targets)targets.push(edge.targetId);else next.set(edge.sourceId,[edge.targetId]);
    }
    const result={nodes,next,incomplete,cache:new Map<string,Set<string>>()};graphs.set(id,result);return result;
  };
  return new Map(rows.map(row=>{
    const inspect=():TransferRoute=>{
      const {source,target}=row;
      if(!source||!target||source.scope!=='Step'||target.scope!=='Step'||!source.elementId||!target.elementId)return 'unknown';
      if(source.processId!==target.processId)return 'external';
      const g=graph(source.processId);
      if(!g?.nodes.has(source.elementId)||!g.nodes.has(target.elementId))return 'unknown';
      if(source.elementId===target.elementId)return 'same';
      let visited=g.cache.get(source.elementId);
      if(!visited){
        visited=new Set([source.elementId]);
        const pending=[source.elementId];
        while(pending.length){
          const id=pending.pop()!;
          const adjacent=g.next.get(id)??[];
          remaining-=1+adjacent.length;
          if(remaining<0)return 'unknown';
          for(const next of adjacent)if(!visited.has(next)){visited.add(next);pending.push(next);}
        }
        g.cache.set(source.elementId,visited);
      }
      return visited.has(target.elementId)?'reachable':g.incomplete?'unknown':'unreachable';
    };
    return [row,inspect()] as const;
  }));
}
