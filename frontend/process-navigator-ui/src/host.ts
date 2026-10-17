export type HostContext = {
  mode: 'standalone' | 'one-c';
  userId?: string;
  infobase?: string;
  product?: string;
};

export function readHostContext(): HostContext {
  const parameters = new URLSearchParams(window.location.search);
  const embedded = parameters.get('host') === '1c';
  return {
    mode: embedded ? 'one-c' : 'standalone',
    userId: embedded ? parameters.get('userId') ?? undefined : undefined,
    infobase: embedded ? parameters.get('infobase') ?? undefined : undefined,
    product: embedded ? parameters.get('product') ?? '1С:ERP' : undefined
  };
}

export function announceReady(context: HostContext, userId: string) {
  if (context.mode !== 'one-c' || window.parent === window) return;
  window.parent.postMessage({ type: 'process-navigator.ready', version: 1, userId, infobase: context.infobase }, '*');
}
