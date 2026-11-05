import {useEffect,useRef,type ReactNode} from 'react';
import './workspace-tool-page.css';

/** A full workspace, not a dismissible modal. Back never applies form changes. */
export function WorkspaceToolPage({title,onBack,children}:{title:string;onBack:()=>void;children:ReactNode}){
  const root=useRef<HTMLElement>(null),back=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const origin=document.activeElement;
    const changed:{element:HTMLElement;inert:boolean}[]=[];
    let current:HTMLElement|null=root.current;
    while(current?.parentElement){
      for(const sibling of current.parentElement.children){
        if(sibling!==current&&sibling instanceof HTMLElement&&!['SCRIPT','STYLE','LINK'].includes(sibling.tagName)){
          changed.push({element:sibling,inert:sibling.inert});sibling.inert=true;
        }
      }
      current=current.parentElement;
      if(current===document.body)break;
    }
    back.current?.focus();
    return ()=>{for(const item of changed)item.element.inert=item.inert;if(origin instanceof HTMLElement&&origin.isConnected)origin.focus();};
  },[]);
  return <main ref={root} className="workspace-tool-page" aria-label={title}>
    <div className="workspace-tool-shell"><nav aria-label="Путь рабочего раздела" className="feature-breadcrumb">
      <button ref={back} onClick={onBack}>← Вернуться</button><span>›</span><strong>{title}</strong>
    </nav>{children}</div>
  </main>;
}
