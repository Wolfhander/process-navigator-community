import type { OrganizationMap, ProcessAssignments, ProcessModel } from './types';

export function buildResponsibilityView(process: ProcessModel, organization?: OrganizationMap, assignments?: ProcessAssignments) {
  assignments = assignments?.processId === process.id ? assignments : undefined;
  if (process.nodes.length > 5000 || process.edges.length > 10000 || process.lanes.length > 2000) throw new Error('Представление ограничено 5000 элементами / 10000 стрелками / 2000 дорожками. Используйте схему.');
  const unitsByEntity = new Map(organization?.legalEntities.map(entity => [entity.id, new Map(entity.units?.map(unit => [unit.id, unit]) ?? [])]) ?? []);
  const users = new Map(assignments?.users.map(user => [user.id, user]) ?? []);
  const mapping = organization?.crossCompanyProcesses.find(item => item.processId === process.id);
  const rows = process.lanes.map(lane => {
    const link = mapping?.laneOrganizations.find(item => item.laneId === lane.id);
    const entity = organization?.legalEntities.find(item => item.id === link?.legalEntityId);
    const unit = entity?.units?.find(item => item.id === link?.unitId);
    const warnings: string[] = [];
    if (organization && (!link || !entity || !unit)) warnings.push('Организация или подразделение не сопоставлены.');
    const units = unitsByEntity.get(entity?.id ?? '') ?? new Map();
    const path: string[] = [];
    const visited = new Set<string>();
    let current = unit;
    while (current) {
      if (visited.has(current.id) || visited.size >= 100) { warnings.push('Цикл или слишком глубокая иерархия подразделений.'); break; }
      visited.add(current.id); path.unshift(current.shortName || current.name);
      const parent = current.parentId;
      current = parent ? units.get(parent) : undefined;
      if (parent && !current) warnings.push('Родительское подразделение не найдено.');
    }
    const ids = assignments?.lanes.find(item => item.laneId === lane.id)?.userIds ?? [];
    const people = ids.map(id => users.get(id)).filter(user => !!user);
    if (assignments && !ids.length) warnings.push('На дорожку никто не назначен.');
    if (people.length !== ids.length) warnings.push('Часть назначенных пользователей отсутствует в справочнике.');
    if (people.some(user => !user.isActive)) warnings.push('Есть назначения неактивным пользователям.');
    return { lane, entity, unit, people, assignedCount: ids.length, path, warnings, tasks: process.nodes.filter(node => node.type === 'task' && node.laneId === lane.id) };
  });
  const nodes = new Map(process.nodes.map(node => [node.id, node]));
  if (nodes.size !== process.nodes.length) throw new Error('Повторяются ID элементов схемы.');
  const outgoing = new Map<string, typeof process.edges>();
  const broken = process.edges.filter(edge => !nodes.has(edge.sourceId) || !nodes.has(edge.targetId)).length;
  for (const edge of process.edges) if (nodes.has(edge.sourceId) && nodes.has(edge.targetId)) outgoing.set(edge.sourceId, [...outgoing.get(edge.sourceId) ?? [], edge]);
  const transfers: { fromId: string; toId: string; edgeIds: string[]; labels: string[]; throughParallel: boolean }[] = [];
  let visits = 0, limited = false;
  for (const source of process.nodes.filter(node => node.type === 'task')) {
    const queue:{id:string;edgeIds:string[];labels:string[];path:Set<string>;parallel:boolean}[]=[{id:source.id,edgeIds:[],labels:[],path:new Set([source.id]),parallel:false}];
    for(let index=0;index<queue.length;index++){
      const entry=queue[index];
      if(++visits>100_000||transfers.length>=2000){limited=true;break;}
      for(const edge of outgoing.get(entry.id)??[]){
        if(++visits>100_000){limited=true;break;}
        const target=nodes.get(edge.targetId)!;
        const edgeIds=[...entry.edgeIds,edge.id],labels=edge.label?[...entry.labels,edge.label]:entry.labels;
        const throughParallel=entry.parallel||nodes.get(entry.id)?.type==='parallelGateway';
        if(entry.path.has(target.id)){limited=true;continue;}
        if(target.type==='task'){
          if(source.laneId!==target.laneId)transfers.push({fromId:source.id,toId:target.id,edgeIds,labels,throughParallel});
          continue;
        }
        if(edgeIds.length>=200||queue.length>=10000){limited=true;continue;}
        queue.push({id:target.id,edgeIds,labels,path:new Set([...entry.path,target.id]),parallel:throughParallel});
      }
      if(visits>100_000||transfers.length>=2000)break;
    }
    if(visits>100_000||transfers.length>=2000)break;
  }
  return { rows, nodes, transfers, broken, limited,
    tasksWithoutLane: process.nodes.filter(node => node.type === 'task' && !process.lanes.some(lane => lane.id === node.laneId)).length };
}
