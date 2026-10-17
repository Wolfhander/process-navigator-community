import type { InformationObject, InformationObjectOccurrence, OrganizationMap, ProcessModel } from './types';

const channelKinds: Record<string, string> = { system: 'Информационная система', email: 'Электронная почта', paper: 'Бумажный документ', phone: 'Телефон', memo: 'Служебная записка', meeting: 'Совещание / личное обращение', other: 'Другой канал' };
const channelDirections: Record<string, string> = { input: 'вход', output: 'выход', work: 'выполнение' };

export function informationObjectVersions(item: InformationObject) {
  return [...new Set([item.version, ...item.producers.map(value => value.version), ...item.consumers.map(value => value.version), ...item.references.map(value => value.version)].filter((value): value is string => !!value?.trim()))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
}

export function occurrenceDetails(occurrence: InformationObjectOccurrence, process?: ProcessModel, organization?: OrganizationMap) {
  const node = occurrence.scope === 'Step' ? process?.nodes.find(item => item.id === occurrence.elementId) : undefined;
  const binding = node ? organization?.crossCompanyProcesses.find(item => item.processId === occurrence.processId)?.laneOrganizations.find(item => item.laneId === node.laneId) : undefined;
  const entity = organization?.legalEntities.find(item => item.id === binding?.legalEntityId);
  const unit = entity?.units?.find(item => item.id === binding?.unitId);
  return {
    available: !!process && (occurrence.scope === 'Process' || !!node),
    responsibility: occurrence.scope === 'Process' ? process?.owner : unit ? `${unit.name} · ${entity?.name}` : binding?.department ?? node?.responsible,
    systems: [...new Set(node ? [node.systemName, ...(node.channels ?? []).filter(channel => channel.kind === 'system').map(channel => channel.systemName)].filter((value): value is string => !!value) : occurrence.scope === 'Process' ? process?.passport?.systems ?? [] : [])],
    channels: (node?.channels ?? []).map(channel => ({ ...channel, kind: channelKinds[channel.kind] ?? channel.kind, direction: channelDirections[channel.direction] ?? channel.direction })),
  };
}
