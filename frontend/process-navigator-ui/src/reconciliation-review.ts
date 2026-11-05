import type {SourceRequirement} from './types';
import type {SourceMaterial} from './source-materials';
export type ReconciliationEvent={id:string;requirementId:string;version:string;draft:boolean;fingerprint:string;action:'review'|'reject'|'withdraw';reason:string;
  actorId:string;actorName:string;recordedAt:string;requirement:SourceRequirement;material?:SourceMaterial};
export type ReconciliationReport={processId:string;processName:string;requirementId:string;version:string;draft:boolean;fingerprint:string;
  requirement?:SourceRequirement;state:'unreviewed'|'reviewed'|'rejected'|'withdrawn'|'stale';gaps:string[];history:ReconciliationEvent[]};
export type ReconciliationRequest={expectedVersion:string;expectedFingerprint:string;action:'review'|'reject'|'withdraw';reason:string;materialId?:string;previousEventId?:string|null};
