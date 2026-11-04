import {useMemo,useState} from 'react';
import type {InformationObject} from './types';
import {compositionIssueLabels,objectCompositionCsv,objectCompositionTree} from './object-composition-tree';

export function InformationObjectCompositionView({item,objects,onOpenObject}:{item:InformationObject;objects:InformationObject[];onOpenObject:(id:string)=>void}){
  const tree=useMemo(()=>objectCompositionTree(item,objects),[item,objects]);
  const [position,setPosition]=useState(0);
  const pages=Math.max(1,Math.ceil(tree.rows.length/50)),page=Math.min(position,pages-1);
  const download=()=>{
    const url=URL.createObjectURL(new Blob([objectCompositionCsv(item,tree)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='object-composition.csv';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="object-detail-history"><h2>Состав комплекта</h2>
    <p>Это описание вложенных частей по реестру. Оно не подтверждает наличие файлов и не меняет расчёт сроков.</p>
    {tree.limited&&<p role="status">Состав показан не полностью: предел 20 уровней или 500 вхождений. Это ограничение указано и в CSV.</p>}
    {!tree.rows.length?<p>Состав не задан — объект рассматривается как отдельный документ или результат.</p>:<>
      <p>Вхождений: {tree.rows.length}; с замечаниями: {tree.rows.filter(row=>row.issue).length}.</p>
      <div className="home-quick"><button onClick={download}>Скачать состав в CSV</button>{pages>1&&<>
        <button disabled={!page} onClick={()=>setPosition(page-1)}>Предыдущие части</button><span>Страница {page+1} из {pages}</span><button disabled={page+1>=pages} onClick={()=>setPosition(page+1)}>Следующие части</button></>}</div>
      <ul>{tree.rows.slice(page*50,(page+1)*50).map((row,i)=><li key={page*50+i}>
        <button disabled={!row.object||row.issue==='cycle'} onClick={()=>row.object&&onOpenObject(row.object.id)}>{row.object?.name??row.component.objectId}</button>
        <p>Путь ID: {row.path.join(' → ')}</p>
        <p>{row.required?'Обязательная по цепочке':'Необязательная по цепочке'}{row.conditional?' · есть условие':''} · требуемая версия {row.component.version||'не задана'} · в реестре {row.object?.version||'неизвестна'}</p>
        {row.component.condition&&<p>Условие части: {row.component.condition}</p>}{row.issue&&<strong>{compositionIssueLabels[row.issue]}</strong>}
      </li>)}</ul>
    </>}
  </section>;
}
