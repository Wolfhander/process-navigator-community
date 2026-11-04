import type {Edge} from './types';

export function diagramTaskTypography(name:string) {
  return name.length>105?{size:9.5,line:1.15,density:' is-dense'}:
    name.length>65?{size:11,line:1.2,density:' is-compact'}:{size:13,line:1.3,density:''};
}

export function diagramEdgeLabelPoint(edge:Edge) {
  const points=edge.points??[];
  for(let index=0;index<points.length-1;index++){
    const a=points[index],b=points[index+1];
    const dx=b.x-a.x,dy=b.y-a.y;
    if(Math.abs(dx)>=30&&Math.abs(dx)>=Math.abs(dy))return {x:a.x+Math.sign(dx)*Math.min(52,Math.abs(dx)/2),y:a.y-9};
  }
  const a=points[0]??{x:0,y:0},b=points[1]??a;
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2-9};
}

export type LabelMeasure=(text:string,size:number)=>number;
export function browserLabelMeasure():LabelMeasure|undefined{
  if(typeof document==='undefined')return;
  const context=document.createElement('canvas').getContext('2d');
  if(!context)return;
  return (text,size)=>{context.font='600 '+size+'px Manrope, sans-serif';return context.measureText(text).width;};
}

/** Approximates CSS wrapping with measured glyph widths, including unbroken words. */
export function taskLabelFits(name:string,width:number,height:number,measure:LabelMeasure){
  if(!name.trim())return true;
  const {size,line}=diagramTaskTypography(name);
  const available=width-20,maxLines=Math.floor((height-16)/(size*line));
  if(available<=0||maxLines<1||name.length>2000)return false;
  let lines=1,current='';
  for(const word of name.trim().split(/\s+/u)){
    const joined=current?current+' '+word:word;
    if(measure(joined,size)<=available){current=joined;continue;}
    if(current){if(++lines>maxLines)return false;current='';}
    if(measure(word,size)<=available){current=word;continue;}
    for(const char of word){
      if(measure(char,size)>available)return false;
      if(measure(current+char,size)>available){if(++lines>maxLines)return false;current='';}
      current+=char;
    }
  }
  return true;
}
