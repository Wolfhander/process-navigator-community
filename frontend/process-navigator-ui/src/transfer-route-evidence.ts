import type {InformationTransfer} from './information-transfers';
import type {ProcessModel} from './types';

export const transferRouteLabels = {
  reachable:'Путь в BPMN найден', nested:'Путь через границу подпроцесса найден', unreachable:'Нет пути в этой схеме', external:'Разные модели — путь не подтверждён',
  same:'Один этап — не межэтапная передача', unknown:'Недостаточно данных для проверки',
} as const;
export type TransferRoute = keyof typeof transferRouteLabels;

/** A positive result establishes directed reachability only, not execution or document delivery. */
export function transferRouteEvidence(rows:InformationTransfer[],models:Record<string,ProcessModel>) {
  type Graph={model:ProcessModel;nodes:Set<string>; next:Map<string,string[]>; incomplete:boolean; cache:Map<string,Set<string>>};
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
    const result={model,nodes,next,incomplete,cache:new Map<string,Set<string>>()};graphs.set(id,result);return result;
  };
  const visit=(g:Graph,source:string)=>{
    const cached=g.cache.get(source);
    if(cached)return cached;
    const visited=new Set([source]),pending=[source];
    while(pending.length){
      const id=pending.pop()!,adjacent=g.next.get(id)??[];
      remaining-=1+adjacent.length;
      if(remaining<0)return;
      for(const next of adjacent)if(!visited.has(next)){visited.add(next);pending.push(next);}
    }
    g.cache.set(source,visited);return visited;
  };
  const crossesBoundary=(parent:Graph,child:Graph,parentStep:string,childStep:string,objectId:string,intoChild:boolean,version?:string)=>{
    if(parent.incomplete||child.incomplete)return false;
    const calls=parent.model.nodes.filter(n=>n.linkedProcessId===child.model.id);
    // A registry occurrence does not identify one of several invocations.
    if(calls.length!==1)return false;
    const call=calls[0];
    if(call.id===parentStep)return false;
    const role=intoChild?'Input':'Output';
    const bindings=[call.informationObjects?.find(b=>b.objectId===objectId&&b.role===role),
      child.model.nodes.find(n=>n.id===childStep)?.informationObjects?.find(b=>b.objectId===objectId&&b.role===role),
      parent.model.nodes.find(n=>n.id===parentStep)?.informationObjects?.find(b=>b.objectId===objectId&&b.role===(intoChild?'Output':'Input'))];
    if(bindings.some(b=>!b))return false;
    const versions=[version,...bindings.map(b=>b?.version)].filter(Boolean);
    if(new Set(versions).size>1||(versions.length&&bindings.some(b=>!b?.version)))return false;
    const parentPath=intoChild?visit(parent,parentStep)?.has(call.id):visit(parent,call.id)?.has(parentStep);
    if(!parentPath)return false;
    const ends=child.model.nodes.filter(n=>n.type===(intoChild?'startEvent':'endEvent'));
    return ends.length===1&&ends[0].id!==childStep&&
      (intoChild?visit(child,ends[0].id)?.has(childStep):visit(child,childStep)?.has(ends[0].id))===true;
  };
  return new Map(rows.map(row=>{
    const inspect=():TransferRoute=>{
      const {source,target}=row;
      if(!source||!target||source.scope!=='Step'||target.scope!=='Step'||!source.elementId||!target.elementId)return 'unknown';
      const g=graph(source.processId);
      if(source.processId!==target.processId){
        const h=graph(target.processId);
        if(!g?.nodes.has(source.elementId)||!h?.nodes.has(target.elementId)||g.incomplete||h.incomplete)return 'unknown';
        const version=source.version||target.version;
        if(source.version&&target.version&&source.version!==target.version)return 'external';
        const nested=crossesBoundary(g,h,source.elementId,target.elementId,row.object.id,true,version)||
          crossesBoundary(h,g,target.elementId,source.elementId,row.object.id,false,version);
        return nested?'nested':remaining<0?'unknown':'external';
      }
      if(!g?.nodes.has(source.elementId)||!g.nodes.has(target.elementId))return 'unknown';
      if(source.elementId===target.elementId)return 'same';
      const visited=visit(g,source.elementId);
      if(!visited)return 'unknown';
      return visited.has(target.elementId)?'reachable':g.incomplete?'unknown':'unreachable';
    };
    return [row,inspect()] as const;
  }));
}
