import type { ProcessNode, SourceRequirement } from './types';
import './source-requirements.css';

export function SourceRequirementsEditor({ entries, nodes, onChange }: { entries: SourceRequirement[]; nodes: ProcessNode[]; onChange: (entries: SourceRequirement[]) => void }) {
  const patch = (index: number, value: Partial<SourceRequirement>) => onChange(entries.map((entry, i) => i === index ? { ...entry, ...value } : entry));
  return <section className="passport-wide"><h3>Сверка с исходным описанием</h3>
    <p>Один пункт — одно действие или условие из источника. Привязка показывает, где он отражён на схеме, но не подтверждает правильность реализации. Для переноса через Excel используйте лист «Сверка». Его наличие заменяет пункты процессов книги, отсутствие сохраняет прежние.</p>
    {entries.map((entry, index) => {
      const missing = (entry.elementIds ?? []).filter(id => !nodes.some(node => node.id === id));
      return <fieldset key={entry.id} className="source-requirement"><legend>Пункт {index + 1}</legend>
        <label>Действие или условие<textarea maxLength={2000} value={entry.text} onChange={event => patch(index, { text: event.target.value })}/></label>
        <label>Источник<input maxLength={1000} value={entry.source} onChange={event => patch(index, { source: event.target.value })}/></label>
        <label>Страница, лист или строка<input maxLength={300} value={entry.locator ?? ''} onChange={event => patch(index, { locator: event.target.value })}/></label>
        <label>Элементы схемы<select multiple className="passport-multiple" value={entry.elementIds ?? []} onChange={event => {
          const selected = Array.from(event.target.selectedOptions, option => option.value);
          const ids = [...(entry.elementIds ?? []).filter(id => selected.includes(id)), ...selected.filter(id => !entry.elementIds?.includes(id))];
          patch(index, { elementIds: ids, checkSequence: ids.length >= 2 && entry.checkSequence });
        }}>{nodes.map(node => <option key={node.id} value={node.id}>{node.name} · {node.id}</option>)}</select></label>
        <small>Несколько элементов — Ctrl или Shift. Пустой выбор означает, что пункт пока не сопоставлен.</small>
        <label><span><input type="checkbox" checked={!!entry.checkSequence} disabled={(entry.elementIds?.length ?? 0) < 2} onChange={event => patch(index, { checkSequence: event.target.checked })}/> Проверять направленный маршрут в указанном порядке</span></label>
        <p>Проверяется наличие пути между соседними элементами, в том числе через промежуточные блоки. Условия развилок и обязательность порядка не доказываются.</p>
        <ol>{(entry.elementIds ?? []).map((id, position) => <li key={id}>{nodes.find(node => node.id === id)?.name ?? id} <button type="button" disabled={!position} onClick={() => { const ids = [...entry.elementIds!]; [ids[position - 1], ids[position]] = [ids[position], ids[position - 1]]; patch(index, { elementIds: ids }); }}>Выше</button> <button type="button" disabled={position === entry.elementIds!.length - 1} onClick={() => { const ids = [...entry.elementIds!]; [ids[position], ids[position + 1]] = [ids[position + 1], ids[position]]; patch(index, { elementIds: ids }); }}>Ниже</button></li>)}</ol>
        {missing.length > 0 && <p role="alert">Не найдены элементы: {missing.join(', ')}. Выберите актуальные элементы или очистите привязки.</p>}
        <button type="button" onClick={() => patch(index, { elementIds: [], checkSequence: false })}>Очистить привязки</button>
        <button type="button" onClick={() => onChange(entries.filter((_, i) => i !== index))}>Удалить пункт</button>
      </fieldset>;
    })}
    <button type="button" disabled={entries.length >= 100} onClick={() => onChange([...entries, { id: crypto.randomUUID(), text: '', source: '', elementIds: [] }])}>Добавить пункт исходного описания</button>
  </section>;
}
