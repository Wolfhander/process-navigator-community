export type RepairChoice={processId:string;kind:'owner'|'link';elementId?:string;legalEntityId?:string;unitId?:string;targetId?:string;clear?:boolean};
export type RepairRequest={baseFingerprint:string;choices:RepairChoice[]};
export type RepairScan={fingerprint:string;items:{processId:string;processName:string;missingOwner:boolean;links:{elementId:string;elementName:string;targetId:string}[];reason?:string}[];targets:{id:string;name:string}[];units:{entityId:string;entityName:string;unitId:string;unitName:string}[]};
export type RepairPlan={proof:string;changes:{processId:string;processName:string;kind:string;elementId?:string;before:string;after:string}[]};
export type RepairResult={backupFileName:string;items:{processId:string;status:string;reason?:string}[]};
