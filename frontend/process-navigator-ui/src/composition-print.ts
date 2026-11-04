import type { ProcessModel } from './types';

export const escapePrint = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));

type Box = { x: number; y: number; right: number; bottom: number };
type Shape = { box: Box; markup: string };
const width = 960, height = 600, overlap = 64;
const coordinate = (value: number) => Number.isFinite(value) && Math.abs(value) <= 1_000_000;
const intersects = (a: Box, b: Box) => a.x <= b.right && a.right >= b.x && a.y <= b.bottom && a.bottom >= b.y;
const rect = (x:number,y:number,w:number,h:number, extra='') => '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" '+extra+'/>';
const label = (x:number,y:number,value:string) => '<text x="'+x+'" y="'+y+'" text-anchor="middle" stroke="white" stroke-width="3" paint-order="stroke" fill="#172720" font-size="15" font-weight="bold">'+value+'</text>';

/** Geometry only: full labels remain in the paginating key, never inside clipped SVG text. */
export function compositionPrint(model: ProcessModel, sheetLimit: number, section: number) {
  const shapes: Shape[] = [], legend: string[] = [];
  let invalid = 0, points = 0;
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  const include = (box:Box) => { x=Math.min(x,box.x); y=Math.min(y,box.y); right=Math.max(right,box.right); bottom=Math.max(bottom,box.bottom); };
  for (const [index,node] of model.nodes.entries()) {
    const code='N'+(index+1);
    legend.push('<li><strong>'+code+'</strong> — '+escapePrint(node.name || node.id)+' ['+escapePrint(node.id)+']'+(node.linkedProcessId?' → '+escapePrint(node.linkedProcessId):'')+'</li>');
    if (![node.x,node.y,node.width,node.height].every(coordinate) || node.width<=0 || node.height<=0) { invalid++; continue; }
    const {x:nx,y:ny,width:w,height:h}=node, cx=nx+w/2, cy=ny+h/2;
    const box={x:nx-30,y:ny-20,right:nx+w+30,bottom:ny+h+20};
    let body=rect(nx,ny,w,h,'rx="7"');
    if (node.type==='startEvent'||node.type==='endEvent') {
      body='<ellipse cx="'+cx+'" cy="'+cy+'" rx="'+w/2+'" ry="'+h/2+'"/>';
      if(node.type==='endEvent') body+='<ellipse cx="'+cx+'" cy="'+cy+'" rx="'+w*0.4+'" ry="'+h*0.4+'"/>';
    }
    if(node.type==='exclusiveGateway'||node.type==='parallelGateway') {
      body='<polygon points="'+cx+','+ny+' '+(nx+w)+','+cy+' '+cx+','+(ny+h)+' '+nx+','+cy+'"/>';
    }
    const mark=node.type==='exclusiveGateway'?'×':node.type==='parallelGateway'?'+':'';
    shapes.push({box,markup:'<g fill="white" stroke="#29453a" stroke-width="2">'+body+'</g>'+label(cx,cy+5,mark||code)+(mark?label(cx,ny-4,code):'')});
    include(box);
  }
  const edges:Shape[]=[];
  for (const [index,edge] of model.edges.entries()) {
    const code='E'+(index+1);
    legend.push('<li><strong>'+code+'</strong> — '+escapePrint(edge.sourceId)+' → '+escapePrint(edge.targetId)+' ['+escapePrint(edge.id)+']'+(edge.label?' · '+escapePrint(edge.label):'')+'</li>');
    const path=edge.points??[];
    points+=path.length;
    if(points>100_000) return {sheets:0, html:'<p class="warning">Графика не построена: превышен предел точек маршрута. Ниже сохранено текстовое описание.</p>'};
    if(path.length<2 || path.some(p=>!coordinate(p.x)||!coordinate(p.y))) { invalid++; continue; }
    const end=path.at(-1)!;
    let prior=path.length-2;
    while(prior>=0 && path[prior].x===end.x && path[prior].y===end.y) prior--;
    if(prior<0){invalid++;continue;}
    const angle=Math.atan2(end.y-path[prior].y,end.x-path[prior].x)*180/Math.PI;
    const middle=path[Math.floor((path.length-1)/2)],next=path[Math.floor((path.length-1)/2)+1];
    const box=path.reduce<Box>((b,p)=>({x:Math.min(b.x,p.x-30),y:Math.min(b.y,p.y-25),right:Math.max(b.right,p.x+30),bottom:Math.max(b.bottom,p.y+25)}),{x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity});
    edges.push({box,markup:'<polyline fill="none" stroke="#394942" stroke-width="2" points="'+path.map(p=>p.x+','+p.y).join(' ')+'"/><path fill="#394942" d="M 0 0 L -11 -5 L -11 5 Z" transform="translate('+end.x+' '+end.y+') rotate('+angle+')"/>'+label((middle.x+next.x)/2,(middle.y+next.y)/2-7,code)});
    include(box);
  }
  for (const [index,lane] of model.lanes.entries()) {
    legend.push('<li><strong>L'+(index+1)+'</strong> — '+escapePrint(lane.name || lane.id)+' ['+escapePrint(lane.id)+']</li>');
    if(!coordinate(lane.y)||!coordinate(lane.height)||lane.height<=0){invalid++;continue;}
    include({x:Number.isFinite(x)?x:0,y:lane.y,right:Number.isFinite(right)?right:width,bottom:lane.y+lane.height});
  }
  const warning=invalid?'<p class="warning">На схеме пропущено объектов с непригодной геометрией: '+invalid+'. Сверьте их по текстовому разделу.</p>':'';
  if (!Number.isFinite(x)) return {sheets:0,html:warning+'<p>Нет геометрии для печати.</p>'};
  x=Math.floor(x)-8;y=Math.floor(y)-8;right=Math.ceil(right)+8;bottom=Math.ceil(bottom)+8;
  const cols=Math.max(1,Math.ceil((right-x-overlap)/(width-overlap)));
  const rows=Math.max(1,Math.ceil((bottom-y-overlap)/(height-overlap)));
  if(cols*rows>sheetLimit) return {sheets:0,html:'<p class="warning">Графика не включена: нужно листов '+cols*rows+', осталось в лимите '+sheetLimit+'. Ниже сохранено текстовое описание.</p>'+warning};
  const tiles:string[]=[];
  let outputSize=0;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const tx=x+col*(width-overlap),ty=y+row*(height-overlap);
    const tile={x:tx,y:ty,right:tx+width,bottom:ty+height};
    const lanes=model.lanes.map((lane,index)=>{
      if(!coordinate(lane.y)||!coordinate(lane.height)||lane.height<=0||lane.y>tile.bottom||lane.y+lane.height<ty)return '';
      const top=Math.max(ty,lane.y),end=Math.min(tile.bottom,lane.y+lane.height);
      return rect(tx,top,width,end-top,'fill="#f4f7f4" stroke="#91a097"')+(end-top>=22?label(tx+25,top+18,'L'+(index+1)):'');
    }).join('');
    const content='<section class="composition-sheet"><h3>Схема '+section+'</h3><p>Лист '+(row*cols+col+1)+' из '+(rows*cols)+' · ряд '+(row+1)+'/'+rows+' · колонка '+(col+1)+'/'+cols+'</p><svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="'+tx+' '+ty+' '+width+' '+height+'" role="img" aria-label="Фрагмент схемы">'+lanes+edges.filter(e=>intersects(e.box,tile)).map(e=>e.markup).join('')+shapes.filter(s=>intersects(s.box,tile)).map(s=>s.markup).join('')+'</svg></section>';
    outputSize+=content.length;
    if(outputSize>2_000_000) return {sheets:0,html:'<p class="warning">Графика модели превышает предел размера. Ниже сохранено текстовое описание.</p>'};
    tiles.push(content);
  }
  return {sheets:tiles.length,html:warning+'<p>Фрагменты перекрываются на 64 единицы. Полные подписи вынесены в ключ (N — элемент, E — переход, L — дорожка).</p>'+tiles.join('')+'<h3>Ключ схемы</h3><ul>'+legend.join('')+'</ul>'};
}
