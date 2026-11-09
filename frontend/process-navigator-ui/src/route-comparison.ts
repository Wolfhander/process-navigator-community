import type {ProcessModel} from './types';

export type RouteChange = {group:string; id:string; kind:'added'|'removed'|'changed'; before?:string; after?:string};

function groups(model:ProcessModel) {
  return [
    {name:'Дорожки', items:model.lanes.map(l=>({id:l.id, fields:[l.name]}))},
    {name:'Элементы', items:model.nodes.map(n=>({id:n.id,
      fields:[n.name,n.bpmnType ?? n.type,n.laneId]}))},
    {name:'Переходы', items:model.edges.map(e=>({id:e.id,
      fields:[e.sourceId,e.targetId,e.label ?? '']}))},
  ];
}

// Compare by stable BPMN IDs, ignoring array order and diagram geometry.
export function compareRoutes(before:ProcessModel, after:ProcessModel):RouteChange[] {
  if(before.id!==after.id) throw new Error('Можно сравнивать только редакции одного процесса.');
  const target=groups(after);
  return groups(before).flatMap(({name,items},index)=>{
    const oldItems=new Map(items.map(x=>[x.id,x.fields]));
    const newItems=new Map(target[index].items.map(x=>[x.id,x.fields]));
    return [...new Set([...oldItems.keys(),...newItems.keys()])].sort().flatMap((id):RouteChange[]=>{
      const before=oldItems.get(id), after=newItems.get(id);
      const describe=(fields?:string[])=>fields?.map(value=>JSON.stringify(value)).join(' · ');
      return JSON.stringify(before)===JSON.stringify(after)?[]:[{group:name,id,
        kind:before===undefined?'added':after===undefined?'removed':'changed',before:describe(before),after:describe(after)}];
    });
  });
}
