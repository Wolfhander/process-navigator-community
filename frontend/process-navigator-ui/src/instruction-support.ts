import type { Artifact, ProcessAssignments, ProcessInstance, ProcessModel, ProcessNode } from './types';

export type MaterialCheck = { reference: string; version: string; status: 'available' | 'missing' | 'forbidden' | 'unknown' | 'external' | 'unpinned' | 'limit'; message: string };
export const materialKey = (artifact: Artifact) => JSON.stringify([artifact.reference ?? '',artifact.version ?? '']);

/** Exact repository references only. Never probe external URLs, file paths or implicit current versions. */
export async function checkInstructionMaterials(process: ProcessModel, probe: (reference:string,version:string,signal:AbortSignal)=>Promise<number>, signal: AbortSignal) {
  if(process.nodes.length>5000)throw new Error('Проверка ограничена 5000 элементами модели.');
  const unique = new Map<string, Artifact>();
  let references=0;
  for (const node of process.nodes) for (const artifact of node.artifacts ?? []) {
    if(++references>20000)throw new Error('Проверка ограничена 20000 упоминаний материалов.');
    unique.set(materialKey(artifact),artifact);
  }
  const entries = [...unique.entries()];
  const results: Record<string, MaterialCheck> = Object.create(null);
  let cursor = 0, requests = 0;
  async function worker() {
    while (cursor < entries.length && !signal.aborted) {
      const [key, artifact] = entries[cursor++];
      const reference = artifact.reference ?? '', version = artifact.version?.trim() ?? '';
      const set = (status: MaterialCheck['status'],message:string) => { if (!signal.aborted) results[key]={reference,version,status,message}; };
      if (!reference.startsWith('artifact:') || reference.length <= 9) { set('external','Ссылка отсутствует или находится вне репозитория; не проверялась.'); continue; }
      if (!version) { set('unpinned','Точная версия материала не задана; действующая версия не подставлялась.'); continue; }
      if (++requests > 200) { set('limit','Предел 200 запросов; материал не проверялся.'); continue; }
      try {
        const status = await probe(reference,version,signal);
        if (status === 200) set('available','Точная версия доступна по HEAD на момент проверки; содержание и актуальность не подтверждены.');
        else if (status === 404) set('missing','Точная версия или файл не найдены.');
        else if (status === 401 || status === 403) set('forbidden','Нет доступа у текущего профиля.');
        else set('unknown','Доступность не подтверждена: HTTP ' + status + '.');
      } catch (cause) {
        if (!signal.aborted) set('unknown',cause instanceof Error ? cause.message : 'Ошибка проверки.');
      }
    }
  }
  await Promise.all([worker(),worker(),worker()]);
  if (signal.aborted) throw new Error('Проверка материалов отменена.');
  return results;
}

export function instructionAssignment(process: ProcessModel, node: ProcessNode, assignments?: ProcessAssignments, instance?: ProcessInstance) {
  const scoped = assignments?.processId === process.id ? assignments : undefined;
  const users = new Map(scoped?.users.map(user => [user.id,user]) ?? []);
  const names = scoped?.lanes.find(lane => lane.laneId === node.laneId)?.userIds.map(id => {
    const user = users.get(id); return user ? user.displayName + (user.isActive ? '' : ' (неактивен)') : 'Неизвестный пользователь: ' + id;
  }) ?? [];
  const matching = instance?.processId === process.id && instance.processVersion === process.version;
  const assignedId = matching ? instance?.steps.find(step => step.elementId === node.id)?.assignedUserId : undefined;
  const user = assignedId ? users.get(assignedId) : undefined;
  return { lane: scoped ? names.join('; ') || 'Назначений на дорожку нет.' : 'Назначения не загружены или относятся к другому процессу.',
    personal: !matching ? 'Совпадающий экземпляр не выбран.' : !assignedId ? 'Персональное назначение шага отсутствует.' : user ? user.displayName + (user.isActive ? '' : ' (неактивен)') : 'Назначен ID ' + assignedId + '; сведения пользователя недоступны.',
    instanceName: matching ? instance?.name : undefined };
}
