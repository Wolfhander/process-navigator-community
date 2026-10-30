import type { InformationObject, InformationObjectOccurrence } from './types';
export type InformationTransfer = { object: InformationObject; source?: InformationObjectOccurrence; target?: InformationObjectOccurrence };

export function informationTransfers(objects: InformationObject[], limit = 1000) {
  const rows: InformationTransfer[] = [];
  let limited = false;
  outer: for (const object of objects) {
    const sources = object.producers.length ? object.producers : [undefined];
    const targets = object.consumers.length ? object.consumers : [undefined];
    if (!object.producers.length && !object.consumers.length) continue;
    for (const source of sources) for (const target of targets) {
      if (rows.length >= limit) { limited = true; break outer; }
      rows.push({ object, source, target });
    }
  }
  return { rows, limited };
}
