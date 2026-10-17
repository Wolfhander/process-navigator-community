import { useEffect } from 'react';
import type { ProcessView } from './process-location';
import { prepareProcessViewPrint } from './process-view-print';
import './process-instruction.css';

export function ProcessViewNavigation({ view, onChange }: {view: ProcessView; onChange: (view: ProcessView) => void}) {
  useEffect(() => {
    let restore: (() => void) | undefined;
    const before = () => { restore?.(); const root = document.querySelector('.instruction-page'); if (root) restore = prepareProcessViewPrint(root); };
    const after = () => { restore?.(); restore = undefined; };
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); after(); };
  }, [view]);
  return <nav className="process-view-navigation" aria-label="Представление процесса">
    {([['diagram','Схема'],['overview','Обзор'],['instruction','Инструкция'],['responsibility','Ответственность']] as const).map(([id,label]) =>
      <button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => onChange(id)}>{label}</button>)}
    {view !== 'diagram' && <button onClick={() => window.print()}>Печать / PDF</button>}
  </nav>;
}
