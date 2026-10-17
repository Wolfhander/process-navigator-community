import type { InformationObject } from './types';

export type ReferenceObject = { id?: string; name: string; kind?: 'Document' | 'Result' };
export const referenceTemplate = [{ id: '', name: 'Наименование документа из контрольного перечня', kind: 'Document' }];
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');

export function parseReferenceObjects(text: string): ReferenceObject[] {
  if (text.length > 1_000_000) throw new Error('Контрольный перечень превышает 1 МБ текста.');
  const data: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!Array.isArray(data) || data.length === 0 || data.length > 5000) throw new Error('Нужен массив от 1 до 5000 объектов.');
  const ids = new Set<string>(); const names = new Set<string>();
  return data.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Строка ${index + 1}: нужен объект.`);
    const item = value as Record<string, unknown>;
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 300) throw new Error(`Строка ${index + 1}: заполните name (до 300 символов).`);
    if (item.id !== undefined && (typeof item.id !== 'string' || item.id.length > 100)) throw new Error(`Строка ${index + 1}: id должен быть строкой до 100 символов.`);
    if (item.kind !== undefined && item.kind !== 'Document' && item.kind !== 'Result') throw new Error(`Строка ${index + 1}: kind — Document или Result.`);
    const id = (item.id as string | undefined)?.trim() || undefined;
    const key = id ? normalize(id) : normalize(item.name);
    const seen = id ? ids : names;
    if (seen.has(key)) throw new Error(`Строка ${index + 1}: повтор ${id ? 'ID' : 'названия без ID'} в контрольном перечне.`);
    seen.add(key);
    return { id, name: item.name.trim(), kind: item.kind as ReferenceObject['kind'] };
  });
}

export function reconcileInformationObjects(expected: ReferenceObject[], actual: InformationObject[]) {
  const byId = new Map<string, InformationObject[]>();
  const byName = new Map<string, InformationObject[]>();
  for (const item of actual) {
    const key = normalize(item.id);
    byId.set(key, [...byId.get(key) ?? [], item]);
    for (const alias of new Set([item.name, ...item.aliases].map(normalize))) byName.set(alias, [...byName.get(alias) ?? [], item]);
  }
  const covered = new Set<string>();
  const rows = expected.map(reference => {
    // An explicit ID is authoritative: no silent fallback to a similarly named object.
    const candidates = (reference.id ? byId.get(normalize(reference.id)) : byName.get(normalize(reference.name))) ?? [];
    const status = candidates.length === 1 ? 'matched' : candidates.length ? 'ambiguous' : 'missing';
    const issues: string[] = [];
    if (candidates.length === 1) {
      const item = candidates[0]; covered.add(item.id);
      if (reference.kind && reference.kind !== item.kind) issues.push('Тип отличается от контрольного перечня');
      if (![item.name, ...item.aliases].some(name => normalize(name) === normalize(reference.name))) issues.push('Название не совпадает с именем или синонимами');
      if (!item.producers.length && !item.consumers.length && !item.references.length) issues.push('Нет привязок к доступным процессам');
    }
    return { reference, status, matchedBy: reference.id ? 'id' : 'name', candidates, issues };
  });
  return { rows, unlisted: actual.filter(item => !covered.has(item.id)) };
}
