import type { ProcessModel } from './types';

export type InstructionEntry = { path: string[]; model: ProcessModel; edition: string };
export type InstructionPackage = { entries: InstructionEntry[]; issues: string[]; capturedAt: string };
export type InstructionLoader = (id: string, version: string | undefined, signal: AbortSignal) => Promise<ProcessModel>;

/** Bounded, sequential read-only traversal. A repeated child under another branch is retained. */
export async function collectInstructionPackage(root: ProcessModel, rootEdition: string, selections: Record<string, string>, load: InstructionLoader, signal: AbortSignal): Promise<InstructionPackage> {
  const result: InstructionPackage = { entries: [], issues: [], capturedAt: new Date().toISOString() };
  const cache = new Map<string, ProcessModel>();
  let nodes = 0, edges = 0, loads = 0, links = 0;
  const check = () => { if (signal.aborted) throw new Error('Сбор инструкции отменён.'); };
  async function visit(model: ProcessModel, edition: string, path: string[], ancestors: string[]) {
    check();
    if (result.entries.length >= 40 || nodes + model.nodes.length > 10000 || edges + model.edges.length > 20000) {
      result.issues.push(path.join(' → ') + ': предел 40 включений / 10000 элементов / 20000 переходов.'); return;
    }
    if (new Set(model.nodes.map(node => node.id)).size !== model.nodes.length) {
      result.issues.push(path.join(' → ') + ': повторяются ID элементов; модель не включена.'); return;
    }
    nodes += model.nodes.length; edges += model.edges.length;
    result.entries.push({ model, edition, path });
    for (const node of model.nodes) {
      check();
      if (!node.linkedProcessId) continue;
      if (++links > 200) { result.issues.push('Достигнут предел 200 ссылок детализации; оставшиеся ссылки не обходились.'); break; }
      const id = node.linkedProcessId;
      const childPath = [...path, node.name || node.id];
      if (ancestors.includes(id)) { result.issues.push(childPath.join(' → ') + ': цикл детализации (' + id + ').'); continue; }
      if (path.length >= 8) { result.issues.push(childPath.join(' → ') + ': достигнут предел глубины 8.'); continue; }
      if (result.entries.length >= 40) { result.issues.push(childPath.join(' → ') + ': достигнут предел 40 включений.'); continue; }
      const version = Object.prototype.hasOwnProperty.call(selections, id) ? selections[id]?.trim() || undefined : undefined;
      try {
        let child = cache.get(id);
        if (!child) {
          if (++loads > 40) throw new Error('Достигнут предел 40 запросов дочерних моделей.');
          child = await load(id, version, signal); check();
          if (child.id !== id || (version ? child.version !== version : child.status !== 'Published')) throw new Error('Получена другая модель/версия либо вместо действующей версии доступен только черновик.');
          cache.set(id, child);
        }
        await visit(child, version ? 'Выбранная версия ' + version : 'Действующая на момент сбора', childPath, [...ancestors, id]);
      } catch (cause) {
        check();
        result.issues.push(childPath.join(' → ') + ': ' + (cause instanceof Error ? cause.message : 'Не удалось загрузить уровень.'));
      }
    }
  }
  await visit(root, rootEdition, [root.name || root.id], [root.id]);
  return result;
}

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const paragraph = (label: string, value: unknown) => '<p><strong>' + escape(label) + ':</strong> ' + escape(value || 'Не заполнено') + '</p>';

/** Standalone report; input strings never become HTML, URLs or executable commands. */
export function instructionPackageHtml(bundle: InstructionPackage) {
  const parts: string[] = [];
  let size = 0;
  const append = (part: string) => { size += part.length; if (size > 8000000) throw new Error('Документ превышает предел 8 млн символов. Разделите инструкцию на ветви.'); parts.push(part); };
  append('<!doctype html><html lang="ru"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Сквозная инструкция</title><style>body{font:15px system-ui;max-width:1100px;margin:24px auto;padding:16px;line-height:1.5;color:#182c23}p,li,h1,h2,h3{overflow-wrap:anywhere;white-space:pre-wrap}article{border:1px solid #ccd7cf;border-radius:8px;padding:16px;margin:16px 0}h2{border-bottom:2px solid #285b44;padding-bottom:8px}h1,h2,h3{break-after:avoid}.warning{color:#9b3d20}@media print{@page{size:A4;margin:15mm}body{font-size:10.5pt;line-height:1.35;margin:0;max-width:none;padding:0}p{margin:6px 0}h3{margin:4px 0 8px}article{break-inside:avoid;padding:10px;margin:10px 0}p,li{orphans:3;widows:3}.transitions{break-inside:avoid}}</style><body><h1>Сквозная инструкция</h1>');
  append(paragraph('Сбор исходников', bundle.capturedAt) + '<p>Это справочный документ, не исполняемый линейный план. Порядок разделов не выбирает ветви. Дочерние уровни не заменяют стрелки родительской модели; команды и ссылки не запускаются. Материалы и назначения сотрудников здесь не проверены.</p>');
  append('<h2>Полнота загрузки</h2><p>' + (bundle.issues.length ? 'НЕПОЛНЫЙ ДОКУМЕНТ: замечаний ' + bundle.issues.length : 'Все найденные ссылки загружены в пределах выбранного обхода. Это не подтверждение корректности процессов.') + '</p><ul>' + bundle.issues.map(issue => '<li class="warning">' + escape(issue) + '</li>').join('') + '</ul>');
  append('<h2>Использованные модели</h2><ul>' + bundle.entries.map(entry => '<li>' + escape(entry.path.join(' → ')) + ' · ' + escape(entry.model.id) + ' · версия ' + escape(entry.model.version) + ' · ' + escape(entry.edition) + '</li>').join('') + '</ul>');
  for (const entry of bundle.entries) {
    const model = entry.model;
    append('<section><h2>' + escape(entry.path.join(' → ')) + '</h2>' + paragraph('Модель / версия / редакция', model.id + ' / ' + model.version + ' / ' + entry.edition));
    append(paragraph('Цель',model.passport?.purpose) + paragraph('Запуск',model.passport?.trigger) + paragraph('Результат процесса',model.passport?.result));
    append('<p>Элементов: ' + model.nodes.length + '; переходов: ' + model.edges.length + '. В этом разделе все элементы, без фильтров и постраничного усечения.</p>');
    for (const node of model.nodes) {
      append('<article><h3>' + escape(node.name || node.id) + '</h3>' + paragraph('ID / тип',node.id + ' / ' + (node.bpmnType || node.type)) +
        paragraph('Дорожка',model.lanes.find(lane => lane.id === node.laneId)?.name || 'Неизвестная: ' + node.laneId) +
        paragraph('Описание',node.description) + paragraph('Инструкция',node.instruction) + paragraph('Ответственный (текст модели)',node.responsible) +
        paragraph('Исполнитель',node.executorKind === 'system' ? 'Система' : node.executorKind === 'human' ? 'Сотрудник' : 'Не уточнён') +
        paragraph('Система',node.systemName) + paragraph('Норма / работа / ожидание',[node.duration,node.workDuration,node.waitDuration].map(value => value || 'не задано').join(' / ')) +
        paragraph('Входы',node.inputs?.join('; ')) + paragraph('Результат',node.expectedResult) + paragraph('Критерий завершения',node.completionCriteria));
      for (const object of node.informationObjects ?? []) append(paragraph('Объект',object.name + ' [' + object.objectId + '] · ' + object.role + ' · ' + (object.required ? 'обязательный' : 'необязательный') + ' · версия: ' + (object.version || 'не задана') + ' · условие: ' + (object.condition || 'не задано')));
      for (const channel of node.channels ?? []) append(paragraph('Канал', [channel.label,channel.kind,channel.direction,channel.flow,channel.systemName,channel.documentName].filter(Boolean).join(' · ')));
      for (const artifact of node.artifacts ?? []) append(paragraph('Материал (доступность не проверена)',[artifact.name,artifact.kind,artifact.version,artifact.reference].filter(Boolean).join(' · ')));
      for (const action of node.actions ?? []) append(paragraph('Действие (не выполняется)',[action.label,action.kind,action.target].filter(Boolean).join(' · ')));
      for (const evidence of node.evidence ?? []) if (evidence) append(paragraph('Основание / вопрос', [evidence.status,evidence.statement,evidence.source,evidence.locator,evidence.author].filter(Boolean).join(' · ')));
      if (node.linkedProcessId) append(paragraph('Детализация',node.linkedProcessId));
      for(const rule of node.workRules??[]) append(paragraph(rule.kind==='document'?'Требование документа (инструкция, не проверка факта)':'Правило исключения (не меняет маршрут)',[rule.objectId,rule.requiredState,rule.condition,rule.response,rule.responsible].filter(Boolean).join(' · ')));
      if (node.type === 'parallelGateway') append('<p>Параллельный шлюз — не выбор одной альтернативы.</p>');
      append('</article>');
    }
    append('<div class="transitions"><h3>Все исходные переходы</h3>');
    const ids = new Set(model.nodes.map(node => node.id));
    for (const edge of model.edges) append(paragraph(edge.id,edge.sourceId + ' → ' + edge.targetId + ' · ' + (edge.label || 'без подписи') + (!ids.has(edge.sourceId) || !ids.has(edge.targetId) ? ' · ОБРЫВ ССЫЛКИ' : '')));
    append('</div></section>');
  }
  append('</body></html>');
  return parts.join('');
}
