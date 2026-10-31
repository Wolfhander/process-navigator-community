import type {ProcessModel,ProcessSummary} from './types';
export type SourceTarget={processId:string;draft:boolean;name:string;kind:'passport'|'attachment';documentVersion:string;elementId?:string;objectId?:string;expectedFingerprint?:string};
export type SourceSnapshot=Omit<SourceTarget,'expectedFingerprint'> & {processName:string;processVersion:string;elementName?:string;objectName?:string;fingerprint:string};
export type SourceMaterial={schemaVersion:number;id:string;fileName:string;size:number;sha256:string;uploadedAt:string;uploadedBy:string;uploadedByName:string;target:SourceSnapshot};
export type SourceList={materials:SourceMaterial[];unreadable:number;limited:boolean};
export type SourceCheck={state:'matches'|'historical'|'unavailable';message:string};
export function initialSourceTarget(catalog:readonly Pick<ProcessSummary,'id'|'status'>[]):SourceTarget {
  return {processId:catalog[0]?.id??'',draft:catalog[0]?.status==='Draft',name:'',kind:'passport',documentVersion:'1'};
}
export function sourceObjects(model:ProcessModel|undefined,elementId:string) {
  const nodes=elementId?model?.nodes.filter(n=>n.id===elementId):model?.nodes;
  const unique=new Map<string,NonNullable<ProcessModel['nodes'][number]['informationObjects']>[number]>();
  for(const object of (nodes??[]).flatMap(n=>n.informationObjects??[]))if(!unique.has(object.objectId))unique.set(object.objectId,object);
  return [...unique.values()];
}
export function sourceTimestamp(value:string) {return new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК';}
