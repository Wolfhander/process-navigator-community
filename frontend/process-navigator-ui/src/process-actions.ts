import type { ProcessAction, ProcessActionKind } from './types';

export const actionKindLabels: Record<ProcessActionKind, string> = {
  manual: 'Ручное действие',
  url: 'Ссылка или внутренняя форма',
  file: 'Файл репозитория',
  report: 'Отчёт',
  erp: 'Команда ERP',
};

export function normalizedActionKind(kind: string): ProcessActionKind | undefined {
  const value = kind.trim().toLowerCase();
  return value in actionKindLabels ? value as ProcessActionKind : undefined;
}

export function safeNavigationTarget(target?: string) {
  const value = target?.trim();
  if (!value) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : undefined;
  } catch { return undefined; }
}

export function actionLaunchTarget(action: ProcessAction, artifactUrl: (reference: string) => string | undefined) {
  const kind = normalizedActionKind(action.kind);
  if (kind === 'file') return action.target ? artifactUrl(action.target) : undefined;
  if (kind === 'url' || kind === 'report') return safeNavigationTarget(action.target);
  return undefined;
}

export function actionTargetHint(kind: string) {
  switch (normalizedActionKind(kind)) {
    case 'file': return 'Выберите или укажите ссылку artifact:… из репозитория';
    case 'url': return 'https://… или внутренний путь /…';
    case 'report': return 'Необязательная ссылка на отчёт или внутреннюю форму';
    case 'erp': return 'Например, Документ.ЗаказПоставщику';
    default: return 'Для ручного действия цель не требуется';
  }
}
