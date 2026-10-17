import type { ProcessSchedule, ProcessScheduleItem, ProcessScheduleRequest } from './types';
export type InstanceSchedulePlan = { id: string; processId: string; instanceId: string; processVersion: string;
  assignedAt: string; assignedBy: string; reason: string; request: ProcessScheduleRequest;
  item: ProcessScheduleItem; sources: NonNullable<ProcessSchedule['sources']> };
export type SchedulePlanFreshness = { planId: string | null; checkedAt: string;
  status: 'Current' | 'Changed' | 'Unavailable' | 'NoPlan' | 'Superseded';
  changes: { kind: string; id: string; name: string; message: string }[]; totalChanges: number;
  currentItem?: ProcessScheduleItem | null; finishShiftHours?: number | null };
