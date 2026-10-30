import type { ProcessDecompositionMap, ProcessDecompositionLink, ProcessHierarchyNode } from './types';
export type DecompositionTreeRow = { key: string; ancestors: string[]; processId: string; process?: ProcessHierarchyNode; link?: ProcessDecompositionLink; depth: number; cycle: boolean; expandable: boolean; depthLimited:boolean };

export function decompositionTree(data: ProcessDecompositionMap, limit = 2000) {
  const rows: DecompositionTreeRow[] = [];
  const byId = new Map(data.processes.map(item => [item.id, item]));
  const outgoing = new Map<string, ProcessDecompositionLink[]>();
  const incoming = new Set<string>();
  for (const link of data.links) {
    if(!outgoing.has(link.sourceProcessId))outgoing.set(link.sourceProcessId,[]);
    outgoing.get(link.sourceProcessId)!.push(link);
    if (byId.has(link.sourceProcessId)) incoming.add(link.targetProcessId);
  }
  const covered = new Set<string>();
  let truncated = false,rowLimitReached=false,depthLimitReached=false;
  const cover=(id:string)=>{
    const pending=[id];
    while(pending.length){const current=pending.pop()!;if(covered.has(current))continue;covered.add(current);for(const link of outgoing.get(current)??[])if(!covered.has(link.targetProcessId))pending.push(link.targetProcessId);}
  };
  const visit = (id: string, ancestors: string[], path: string[], link?: ProcessDecompositionLink, index = 0) => {
    if (rows.length >= limit) { truncated = true;rowLimitReached=true; return; }
    const key = `${ancestors.at(-1) ?? ''}/${encodeURIComponent(id)}:${index}`;
    const cycle = path.includes(id);
    const expandable = !cycle && path.length < 20 && !!outgoing.get(id)?.length;
    const depthLimited=!cycle&&path.length>=20&&!!outgoing.get(id)?.length;
    if(depthLimited){depthLimitReached=true;truncated=true;}
    rows.push({ key, ancestors, processId: id, process: byId.get(id), link, depth: path.length, cycle, expandable,depthLimited });
    if (expandable) {
      const children=outgoing.get(id)!;
      for(let childIndex=0;childIndex<children.length;childIndex++){
        if(rows.length>=limit){truncated=true;rowLimitReached=true;break;}
        const child=children[childIndex];visit(child.targetProcessId,[...ancestors,key],[...path,id],child,childIndex);
      }
    }
  };
  data.processes.filter(item => !incoming.has(item.id)).forEach((item, index) => {cover(item.id);visit(item.id, [], [], undefined, index);});
  // Cyclic components have no root; still make them inspectable.
  data.processes.forEach((item, index) => { if (!covered.has(item.id)) {cover(item.id);visit(item.id, [], [], undefined, index);} });
  return { rows, truncated,rowLimitReached,depthLimitReached };
}

export function decompositionPage<T>(rows:T[],page:number,size=100) {
  const pageSize=Number.isInteger(size)&&size>0?Math.min(size,100):100;
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));
  const current=Number.isFinite(page)?Math.max(0,Math.min(Math.floor(page),pages-1)):0;
  const start=current*pageSize;
  return {rows:rows.slice(start,start+pageSize),page:current,pages,total:rows.length,from:rows.length?start+1:0,to:Math.min(start+pageSize,rows.length)};
}

export function visibleDecompositionRows(rows: DecompositionTreeRow[], collapsed: Set<string>, query: string) {
  const term = query.trim().toLocaleLowerCase();
  if (term) {
    const matching = rows.filter(row => [row.processId,row.process?.name??'',row.link?.elementId??'',row.link?.elementName??'',row.link?.sourceProcessId??''].join(' ').toLocaleLowerCase().includes(term));
    const keys = new Set(matching.flatMap(row => [row.key, ...row.ancestors]));
    return rows.filter(row => keys.has(row.key));
  }
  return rows.filter(row => !row.ancestors.some(key => collapsed.has(key)));
}
