/** SVG keyboard activation; Space must not scroll the page. */
export function activateByKeyboard(event: {key:string;repeat?:boolean;preventDefault:()=>void;stopPropagation:()=>void}, activate:()=>void) {
  if(event.key!=='Enter'&&event.key!==' ')return;
  event.preventDefault();event.stopPropagation();if(!event.repeat)activate();
}
export function focusMainContent(doc:Document=document) {
  const main=[...doc.querySelectorAll<HTMLElement>('main')].reverse().find(item=>!item.closest('[inert]')&&item.getClientRects().length>0);
  if(!main)return false;main.tabIndex=-1;main.focus();return true;
}
/** Only genuine modal dialogs. Never submits, closes or changes data. */
export function installModalKeyboard(doc:Document=document) {
  const selector='[aria-modal="true"][role="dialog"],[aria-modal="true"][role="alertdialog"]';
  let current:HTMLElement|undefined,lastOutside:Element|null=doc.activeElement;
  const origins=new WeakMap<HTMLElement,Element|null>();
  let changed:{element:HTMLElement;inert:boolean}[]=[];
  const release=()=>{for(const item of changed)item.element.inert=item.inert;changed=[];};
  const controls=()=>current?[...current.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')]
    .filter(item=>!item.matches(':disabled')&&item.tabIndex>=0&&!item.closest('[inert]')&&item.getClientRects().length>0):[];
  const sync=()=>{
    const next=[...doc.querySelectorAll<HTMLElement>(selector)].reverse().find(item=>item.getClientRects().length>0);
    if(next===current)return;
    const previous=current;release();current=next;
    const origin=previous?origins.get(previous):undefined;
    if(!current){
      if(previous&&origin instanceof HTMLElement&&origin.isConnected&&!origin.closest('[inert]')&&
        (doc.activeElement===doc.body||!doc.activeElement?.isConnected||previous.contains(doc.activeElement)))origin.focus();
      return;
    }
    if(!origins.has(current))origins.set(current,previous?doc.activeElement:lastOutside);
    let branch:HTMLElement=current;
    while(branch.parentElement){
      for(const sibling of branch.parentElement.children){
        if(sibling!==branch&&sibling instanceof HTMLElement&&!sibling.inert&&!['SCRIPT','STYLE','LINK'].includes(sibling.tagName)){
          changed.push({element:sibling,inert:sibling.inert});sibling.inert=true;
        }
      }
      branch=branch.parentElement;if(branch===doc.body)break;
    }
    if(!current.contains(doc.activeElement)){
      const target=origin instanceof HTMLElement&&current.contains(origin)?origin:controls()[0]??current;
      if(target===current)target.tabIndex=-1;target.focus();
    }
  };
  const focus=(event:FocusEvent)=>{const target=event.target;if(target instanceof Element&&!target.closest(selector))lastOutside=target;};
  const key=(event:KeyboardEvent)=>{
    sync();if(event.key!=='Tab'||!current)return;
    const items=controls(),first=items[0],last=items.at(-1);
    if(!first){event.preventDefault();current.tabIndex=-1;current.focus();return;}
    if(!current.contains(doc.activeElement)||event.shiftKey&&doc.activeElement===first||!event.shiftKey&&doc.activeElement===last){
      event.preventDefault();(event.shiftKey?last:first)?.focus();
    }
  };
  const observer=new MutationObserver(sync);observer.observe(doc.body,{childList:true,subtree:true});
  doc.addEventListener('keydown',key,true);doc.addEventListener('focusin',focus,true);sync();
  return ()=>{observer.disconnect();doc.removeEventListener('keydown',key,true);doc.removeEventListener('focusin',focus,true);release();};
}
