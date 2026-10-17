import type { Artifact, ProcessAction, ProcessNode } from './types';
import { actionKindLabels, normalizedActionKind } from './process-actions';

export type CapabilityKind = 'action' | 'artifact';

export type ElementCapability = {
  id: string;
  kind: CapabilityKind;
  label: string;
  badge: string;
  action?: ProcessAction;
  artifact?: Artifact;
};

type CapabilityProvider = (node: ProcessNode) => ElementCapability[];

const providers: CapabilityProvider[] = [
  node => (node.actions ?? []).map(action => ({
    id: `action:${action.id}`,
    kind: 'action',
    label: action.label,
    badge: actionKindLabels[normalizedActionKind(action.kind) ?? 'manual'],
    action
  })),
  node => (node.artifacts ?? []).map((artifact, index) => ({
    id: `artifact:${node.id}:${index}`,
    kind: 'artifact',
    label: artifact.name,
    badge: artifact.kind === 'Шаблон' ? 'DOC' : 'INFO',
    artifact
  }))
];

export function registerCapabilityProvider(provider: CapabilityProvider) {
  providers.push(provider);
  return () => {
    const index = providers.indexOf(provider);
    if (index >= 0) providers.splice(index, 1);
  };
}

export function resolveCapabilities(node: ProcessNode): ElementCapability[] {
  return providers.flatMap(provider => provider(node));
}
