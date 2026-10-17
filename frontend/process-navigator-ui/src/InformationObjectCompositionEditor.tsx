import type { InformationObject, InformationObjectComponent } from './types';

export function InformationObjectCompositionEditor({ id, objects, value = [], onChange }: {
  id: string; objects: InformationObject[]; value?: InformationObjectComponent[]; onChange: (value: InformationObjectComponent[]) => void;
}) {
  const patch = (index: number, update: Partial<InformationObjectComponent>) => onChange(value.map((item, i) => i === index ? { ...item, ...update } : item));
  const available = objects.filter(item => item.id !== id && !value.some(component => component.objectId === item.id));
  return <section className="composition-editor"><h3>Состав комплекта</h3><p>Добавляйте документы или результаты из реестра. Состав не подтверждает фактическую комплектность и пока не разворачивает автоматически зависимости расчёта сроков.</p>
    {value.map((component, index) => <fieldset key={index}><legend>Часть {index + 1}</legend><label>Объект<select value={component.objectId} onChange={event => patch(index, { objectId: event.target.value })}>{!objects.some(item => item.id === component.objectId) && <option value={component.objectId}>Не найден: {component.objectId}</option>}{objects.filter(item => item.id !== id && (item.id === component.objectId || !value.some(value => value.objectId === item.id))).map(item => <option key={item.id} value={item.id}>{item.name} [{item.id}]</option>)}</select></label><label><input type="checkbox" checked={component.required} onChange={event => patch(index, { required: event.target.checked })}/>Обязательная часть</label><label>Требуемая версия<input maxLength={50} value={component.version ?? ''} onChange={event => patch(index, { version: event.target.value })} placeholder="Не задана"/></label><label>Условие включения<input maxLength={500} value={component.condition ?? ''} onChange={event => patch(index, { condition: event.target.value })} placeholder="Например, при наличии испытаний"/></label><button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>Убрать из состава</button></fieldset>)}
    <button type="button" disabled={!available.length || value.length >= 100} onClick={() => available[0] && onChange([...value, { objectId: available[0].id, required: true }])}>Добавить часть</button>
  </section>;
}
