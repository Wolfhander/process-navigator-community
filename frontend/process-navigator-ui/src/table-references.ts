export type ReferenceChoice={kind:string;id:string;name:string;scope:string};
export type ReferenceCell={sheet:string;row:number;column:string;cell:string;token:number;processId:string;stepId:string;relatedCell?:string|null};
export type ReferenceGroup={id:string;kind:string;value:string;scope:string;canKeep:boolean;cells:ReferenceCell[]};
export type ReferenceReport={fingerprint:string;choices:ReferenceChoice[];groups:ReferenceGroup[]};
export type ReferenceRule={groupId:string;targetId?:string;keepNew?:boolean};
export const referenceLabels:Record<string,string>={entity:'Организация',unit:'Подразделение',user:'Сотрудник',system:'Система',object:'Документ / результат (ID)',document:'Документ канала'};
export function referenceChoices(report:ReferenceReport,group:ReferenceGroup,query='') {
  const needle=query.trim().toLocaleLowerCase('ru');
  return report.choices.filter(c=>c.kind===group.kind&&(group.kind!=='unit'||c.scope.toLowerCase()===group.scope.toLowerCase())&&[c.id,c.name,c.scope].join(' ').toLocaleLowerCase('ru').includes(needle));
}
export function referenceGroups(report:ReferenceReport|undefined,kind:string,search:string) {
  const needle=search.toLocaleLowerCase('ru');
  return (report?.groups??[]).filter(g=>(!kind||g.kind===kind)&&[g.value,g.scope,...g.cells.flatMap(c=>[c.processId,c.stepId,c.sheet,c.cell])].join(' ').toLocaleLowerCase('ru').includes(needle));
}
export function referenceOccurrencesCsv(report:ReferenceReport):string {
  const quote=(value:unknown)=>{let text=String(value??'');if(/^[\s\uFEFF]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const rows:unknown[][]=[['Категория','Исходное значение','Организация ID','Лист','Ячейка','Парная ячейка','Колонка','Процесс ID','Этап ID','Позиция в списке']];
  for(const group of report.groups)for(const cell of group.cells)rows.push([referenceLabels[group.kind],group.value,group.scope,cell.sheet,cell.cell,cell.relatedCell,cell.column,cell.processId,cell.stepId,cell.token+1]);
  return '\uFEFF'+rows.map(row=>row.map(quote).join(';')).join('\r\n');
}
