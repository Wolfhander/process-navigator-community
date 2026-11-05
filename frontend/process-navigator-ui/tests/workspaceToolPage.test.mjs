import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';

const files=['AssignmentDialog','ExecutionDialog','VersionDialog','LaneOrganizationDialog','ProcessPropertiesDialog','LifecycleDialog','OneCIntegrationDialog','DeploymentDialog','CreateProcessDialog'];
const source=name=>readFileSync(new URL('../src/'+name+'.tsx',import.meta.url),'utf8');
const compiled=await transformWithOxc(source('WorkspaceToolPage'),'WorkspaceToolPage.tsx',{jsx:{runtime:'classic'}});
const code=compiled.code.replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
test('large work forms use a page rather than a dismissible dialog',()=>{
  for(const name of files){
    const text=source(name);
    assert.match(text,/<WorkspaceToolPage title="/,name);
    assert.doesNotMatch(text,/className="modal-backdrop"|role="dialog"|aria-modal="true"/,name);
    assert.match(text,/<\/WorkspaceToolPage>/,name);
  }
});
test('back is explicit and does not run until clicked; focus and background state are restored',()=>{
  class Element{
    constructor(tagName='DIV'){this.tagName=tagName;this.children=[];this.inert=false;this.isConnected=true;}
    focus(){this.focused=true;}
  }
  const body=new Element('BODY'),parent=new Element(),page=new Element('MAIN'),background=new Element(),script=new Element('SCRIPT'),back=new Element('BUTTON'),origin=new Element('BUTTON');
  body.children=[parent];parent.parentElement=body;parent.children=[background,page,script];page.parentElement=parent;
  let ref=0,effect,returned=0;
  const Page=new Function('React','useRef','useEffect','document','HTMLElement',code+';return WorkspaceToolPage;')(
    {createElement},()=>({current:ref++===0?page:back}),fn=>effect=fn,{body,activeElement:origin},Element);
  const tree=Page({title:'Паспорт',onBack(){returned++;},children:createElement('section',null,'Полная форма')});
  const html=renderToStaticMarkup(tree);
  assert.match(html,/<main.*aria-label="Паспорт"/);
  assert.match(html,/Путь рабочего раздела/);assert.doesNotMatch(html,/role="dialog"|aria-modal/);
  const cleanup=effect();
  assert.equal(background.inert,true);assert.equal(script.inert,false);assert.equal(back.focused,true);
  assert.equal(returned,0);
  const shell=tree.props.children,nav=shell.props.children[0],button=nav.props.children[0];
  button.props.onClick();assert.equal(returned,1);
  cleanup();assert.equal(background.inert,false);assert.equal(origin.focused,true);
});
