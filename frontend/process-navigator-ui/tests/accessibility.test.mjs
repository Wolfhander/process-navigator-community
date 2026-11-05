import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activateByKeyboard,focusMainContent} from '../src/accessibility.ts';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
test('SVG Enter/Space activate once and prevent scrolling/bubbling; unrelated keys do nothing',()=>{
  for(const key of ['Enter',' ']){
    let prevent=0,stop=0,activated=0;
    const event={key,preventDefault(){prevent++;},stopPropagation(){stop++;}};
    activateByKeyboard(event,()=>activated++);
    assert.deepEqual([prevent,stop,activated],[1,1,1]);
    activateByKeyboard({...event,repeat:true},()=>activated++);assert.equal(activated,1);
  }
  activateByKeyboard({key:'Tab',preventDefault(){throw Error('Tab swallowed');},stopPropagation(){throw Error('Tab swallowed');}},()=>assert.fail());
});
test('skip content focuses last visible non-inert main and safely handles no content',()=>{
  const main=(inert,visible)=>({closest:()=>inert?{}:null,getClientRects:()=>visible?[{}]:[],focus(){this.focused=true;}});
  const first=main(false,true),last=main(false,true),hidden=main(false,false),inert=main(true,true);
  assert.equal(focusMainContent({querySelectorAll:()=>[first,last,hidden,inert]}),true);
  assert.equal(last.focused,true);assert.equal(first.focused,undefined);assert.equal(last.tabIndex,-1);
  assert.equal(focusMainContent({querySelectorAll:()=>[]}),false);
});
test('keyboard helpers are wired to app, SVG accessible names, and search field',()=>{
  assert.match(read('main.tsx'),/installModalKeyboard\(\)/);
  assert.match(read('App.tsx'),/className="skip-content" onClick=\{\(\)=>focusMainContent\(\)\}/);
  assert.match(read('ProcessCanvas.tsx'),/'aria-label': node.name/);
  assert.match(read('ProcessCanvas.tsx'),/activateByKeyboard\(event,onSelect\)/);
  assert.match(read('SearchDialog.tsx'),/aria-label="Поиск процессов и шагов"/);
  assert.match(read('accessibility.css'),/forced-colors:active/);
  assert.match(read('accessibility.css'),/prefers-reduced-motion:reduce/);
});
test('normal text and two-colour focus have adequate contrast on reference surfaces',()=>{
  const luminance=hex=>{
    const [r,g,b]=hex.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
    return .2126*r+.7152*g+.0722*b;
  };
  const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(values[0]+.05)/(values[1]+.05);};
  for(const [fg,bg] of [['1f2923','fbfcf8'],['68736c','fbfcf8'],['ffffff','274f3a'],['164b8a','ffffff']])assert.ok(contrast(fg,bg)>=4.5,fg+'/'+bg);
});
