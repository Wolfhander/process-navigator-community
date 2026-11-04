import test from 'node:test';
import assert from 'node:assert/strict';
import {masterModels} from '../../../tools/master-data.mjs';
import {compositionPrint} from '../src/composition-print.ts';
import {collectInstructionPackage,instructionPackageHtml} from '../src/instruction-package.ts';

test('wide and tall master variant covers negative and remote coordinates with overlap',()=>{
  const model=structuredClone(masterModels()[0]);
  const name='<script>'+('Длинная подпись '.repeat(50))+'</script>';
  model.nodes[0]={...model.nodes[0],x:-500,y:-400,name};
  model.nodes[1]={...model.nodes[1],x:1600,y:900};
  model.edges[0].points=[{x:-470,y:-380},{x:1800,y:-380},{x:1800,y:930},{x:1600,y:930}];
  model.lanes.push({id:'empty',name:'Резервная дорожка',y:1100,height:200});
  const result=compositionPrint(model,120,2);
  const tiles=[...result.html.matchAll(/viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/g)].map(([, ...box])=>box.map(Number));
  assert.equal(result.sheets,tiles.length);
  assert.ok(tiles.length>4);
  assert.equal(tiles[1][0]-tiles[0][0],896);
  assert.ok(tiles.some(([x,y,w,h])=>x<=1800&&x+w>=1800&&y<=930&&y+h>=930));
  assert.ok(tiles.some(([,y,,h])=>y<=1300&&y+h>=1300));
  assert.ok(result.html.includes('translate(1600 930) rotate(180)'));
  assert.ok(result.html.includes('Резервная дорожка'));
  assert.ok(result.html.includes('Длинная подпись '.repeat(50)));
  assert.doesNotMatch(result.html,/<script>/);
  assert.equal(compositionPrint(model,1,2).sheets,0);
  assert.match(compositionPrint(model,1,2).html,/осталось в лимите/);
});

test('graphic export follows chosen master depth and falls back to text for invalid geometry',async()=>{
  const models=masterModels();
  const root=structuredClone(models[0]);
  root.nodes[0].x=Infinity;
  const bundle=await collectInstructionPackage(root,'Эталон',{},async id=>models.find(model=>model.id===id),new AbortController().signal,1);
  const graphic=instructionPackageHtml(bundle,true);
  assert.match(graphic,/непригодной геометрией: 1/);
  assert.match(graphic,/A4 landscape/);
  assert.match(graphic,/Схема 1/);
  assert.ok(bundle.entries.length>1);
  for(const [i,entry] of bundle.entries.entries()){
    assert.equal(entry.path.length<=2,true);
    assert.ok(graphic.includes('Схема '+(i+1)));
  }
  assert.doesNotMatch(instructionPackageHtml(bundle),/<svg/);
  assert.ok(graphic.includes(root.nodes[0].name));
  assert.doesNotMatch(graphic,/Infinity/);
});
