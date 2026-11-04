import type {InformationObject,InformationObjectComponent} from './types';

export type CompositionRow={path:string[];component:InformationObjectComponent;object?:InformationObject;issue?:'missing'|'cycle'|'version'|'unknown-version'|'inactive';conditional:boolean;required:boolean};
export const compositionIssueLabels={missing:'Часть не найдена',cycle:'Циклическая ссылка',version:'Версия отличается','unknown-version':'Версия части неизвестна',inactive:'Часть не действует'} as const;

/** Each occurrence is preserved: the same part can belong to different nested kits. */
export function objectCompositionTree(root:InformationObject,objects:InformationObject[]){
  const index=new Map(objects.map(item=>[item.id.toLowerCase(),item]));
  index.set(root.id.toLowerCase(),root);
  const rows:CompositionRow[]=[];
  let limited=false;
  const walk=(parent:InformationObject,path:string[],required:boolean,conditional:boolean)=>{
    if(path.length>=21){if(parent.components?.length)limited=true;return;}
    for(const component of parent.components??[]){
      if(rows.length>=500){limited=true;return;}
      const object=index.get(component.objectId.toLowerCase());
      const id=object?.id??component.objectId;
      const cycle=path.some(value=>value.toLowerCase()===id.toLowerCase());
      const next=[...path,id];
      const expected=component.version?.trim(),actual=object?.version?.trim();
      const issue:CompositionRow['issue']=cycle?'cycle':!object?'missing':expected&&!actual?'unknown-version':expected&&actual!==expected?'version':
        object.lifecycleState==='Draft'||object.lifecycleState==='Archived'?'inactive':undefined;
      const must=required&&component.required;
      const when=conditional||!!component.condition?.trim();
      rows.push({path:next,component,object,issue,required:must,conditional:when});
      if(object&&!cycle)walk(object,next,must,when);
    }
  };
  walk(root,[root.id],true,false);
  return {rows,limited};
}

export function objectCompositionCsv(root:InformationObject,result:ReturnType<typeof objectCompositionTree>){
  const cell=(value:unknown)=>{
    const raw=String(value??'');
    return '"'+(/^(?:[\t\r\n]|[\s\uFEFF]*[=+@-])/.test(raw)?"'"+raw:raw).replaceAll('"','""')+'"';
  };
  const header=['ID комплекта','Версия комплекта','Путь ID JSON','Часть','Обязательна по цепочке','Есть условие по цепочке','Условие части','Требуемая версия','Версия в реестре','Состояние реестра','Замечание','Охват'];
  return '\uFEFF'+[header,...result.rows.map(row=>[root.id,root.version,JSON.stringify(row.path),row.object?.name??row.component.objectId,row.required?'Да':'Нет',row.conditional?'Да':'Нет',row.component.condition,row.component.version,row.object?.version,row.object?.lifecycleState,row.issue?compositionIssueLabels[row.issue]:'',result.limited?'Неполный':'В пределах доступного реестра'])].map(row=>row.map(cell).join(';')).join('\r\n');
}
