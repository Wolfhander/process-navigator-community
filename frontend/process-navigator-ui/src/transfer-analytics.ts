export type TransferFinding = { processId: string; processName: string; code: string; elementId: string; elementName: string; targetId?: string; targetName?: string; sourceSystems: string[]; targetSystems: string[]; objectIds: string[]; explanation: string; routeElementIds?: string[] };
export type TransferReport = { generatedAt: string; processCount: number; findings: TransferFinding[] };
export const transferLabels: Record<string, string> = { 'outside-system': 'Вне системы', 'system-unspecified': 'Система не уточнена', 'paper-primary': 'Основной бумажный канал', 'paper-parallel': 'Параллельная бумага', 'paper-alternative': 'Бумага как альтернатива', 'system-transition': 'Межсистемный переход', 'traversal-limit': 'Проверка путей неполна' };
export function selectTransfers(report: TransferReport, code: string, query: string) {
  const needle = query.trim().toLocaleLowerCase('ru');
  return report.findings.filter(f => (!code || f.code === code) && (!needle || [f.processId, f.processName, f.elementId, f.elementName, f.targetId ?? '', f.targetName ?? '', ...f.sourceSystems, ...f.targetSystems, ...f.objectIds, ...(f.routeElementIds ?? [])].some(text => text.toLocaleLowerCase('ru').includes(needle))));
}
export function transfersCsv(report: TransferReport, code: string, query: string) {
  const cell = (value: unknown) => '"' + String(value ?? '').replace(/^(\s*[=+@-])/, "'$1").replaceAll('"', '""') + '"';
  const rows: unknown[][] = [['Дата', 'Процесс ID', 'Процесс', 'Признак', 'Этап ID', 'Этап', 'Следующий этап ID', 'Следующий этап', 'Системы источника JSON', 'Системы получателя JSON', 'Документы ID JSON', 'Основание и ограничения', 'Путь элементов JSON']];
  for (const f of selectTransfers(report, code, query)) rows.push([report.generatedAt, f.processId, f.processName, f.code, f.elementId, f.elementName, f.targetId, f.targetName, JSON.stringify(f.sourceSystems), JSON.stringify(f.targetSystems), JSON.stringify(f.objectIds), f.explanation, JSON.stringify(f.routeElementIds ?? [])]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
}
