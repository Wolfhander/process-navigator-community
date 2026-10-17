import type { ProcessLocation, ProcessView } from './process-location';

/** Restoration is local only within exactly the same source edition. */
export function canRestoreProcessView(current: ProcessLocation | undefined, target: ProcessLocation | undefined) {
  return !!current && !!target && current.processId === target.processId &&
    current.draft === target.draft && current.version === target.version;
}

export function processViewLocation(location: ProcessLocation, view: ProcessView): ProcessLocation {
  return { ...location, view };
}
