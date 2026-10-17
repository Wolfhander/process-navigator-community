import type { ProcessSchedule, ProcessScheduleItem, ProcessScheduleRequest } from './types';
export type InstanceSchedulePlan = { id: string; processId: string; instanceId: string; processVersion: string;
  assignedAt: string; assignedBy: string; reason: string; request: ProcessScheduleRequest;
  item: ProcessScheduleItem; sources: NonNullable<ProcessSchedule['sources']> };
