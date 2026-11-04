import type {ProcessHierarchyNode} from './types';

export function catalogPage<T>(items:T[],requested:number){
  const size=50,pages=Math.max(1,Math.ceil(items.length/size));
  const index=Math.min(pages-1,Math.max(0,Number.isFinite(requested)?Math.floor(requested):0));
  return {index,pages,items:items.slice(index*size,(index+1)*size),from:items.length?index*size+1:0,to:Math.min(items.length,(index+1)*size)};
}

export function catalogHierarchy(items:ProcessHierarchyNode[]){
  const ids=new Set(items.map(item=>item.id));
  const byParent=new Map<string,ProcessHierarchyNode[]>();
  for(const item of items){
    const key=item.parentProcessId&&ids.has(item.parentProcessId)?item.parentProcessId:'';
    const group=byParent.get(key);
    if(group)group.push(item);else byParent.set(key,[item]);
  }
  for(const group of byParent.values())group.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  const rows:{item:ProcessHierarchyNode;depth:number}[]=[],visited=new Set<string>();
  const walk=(roots:ProcessHierarchyNode[])=>{
    const pending=roots.map(item=>({item,depth:0})).reverse();
    while(pending.length){
      const row=pending.pop()!;
      if(visited.has(row.item.id))continue;
      visited.add(row.item.id);rows.push(row);
      const children=byParent.get(row.item.id)??[];
      for(let i=children.length-1;i>=0;i--)pending.push({item:children[i],depth:row.depth+1});
    }
  };
  walk(byParent.get('')??[]);
  for(const item of items)if(!visited.has(item.id))walk([item]);
  return rows;
}
