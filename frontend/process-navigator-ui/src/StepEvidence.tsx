import type { StepEvidence } from './types';

const labels = { fact: 'Подтверждённый факт', assumption: 'Предположение', question: 'Открытый вопрос' };

export function StepEvidenceList({ entries = [] }: { entries?: StepEvidence[] }) {
  if (!entries.length) return null;
  return <section className="process-channels"><h3>Источники и вопросы</h3>{entries.map((entry, index) => <div className="collection-card" key={index}>
    <strong>{labels[entry.status] ?? entry.status}</strong><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.statement}</p>
    {entry.source && <p style={{ overflowWrap: 'anywhere' }}>Источник: {entry.source}{entry.locator ? ` · ${entry.locator}` : ''}</p>}
    {!entry.source && entry.locator && <p>{entry.locator}</p>}
    {entry.author && <small>Автор сведений: {entry.author}</small>}
  </div>)}</section>;
}

export function StepEvidenceEditor({ entries, onChange }: { entries: StepEvidence[]; onChange: (entries: StepEvidence[]) => void }) {
  const patch = (index: number, value: Partial<StepEvidence>) => onChange(entries.map((entry, i) => i === index ? { ...entry, ...value } : entry));
  return <section className="context-collection"><h3>Источники и вопросы</h3>
    <p>Отделяйте подтверждённое описание от допущений. Автор сведений — справочное поле, а не электронная подпись. Источники сохраняются как текст и не открываются автоматически.</p>
    {entries.map((entry, index) => <fieldset className="collection-card" key={index}><legend>Запись {index + 1}</legend>
      <label>Статус<select value={entry.status} onChange={event => patch(index, { status: event.target.value as StepEvidence['status'] })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Содержание<textarea required maxLength={2000} rows={3} value={entry.statement} onChange={event => patch(index, { statement: event.target.value })}/></label>
      <label>Источник<input required={entry.status === 'fact'} maxLength={1000} value={entry.source ?? ''} onChange={event => patch(index, { source: event.target.value })} placeholder="Название файла, регламента, ссылка или интервью"/></label>
      <label>Место в источнике<input maxLength={300} value={entry.locator ?? ''} onChange={event => patch(index, { locator: event.target.value })} placeholder="Страница либо лист и строка"/></label>
      <label>Автор сведений<input maxLength={200} value={entry.author ?? ''} onChange={event => patch(index, { author: event.target.value })}/></label>
      <button type="button" onClick={() => onChange(entries.filter((_, i) => i !== index))}>Удалить запись {index + 1}</button>
    </fieldset>)}
    <button type="button" disabled={entries.length >= 20} onClick={() => onChange([...entries, { status: 'question', statement: '' }])}>Добавить основание или вопрос</button>
  </section>;
}
