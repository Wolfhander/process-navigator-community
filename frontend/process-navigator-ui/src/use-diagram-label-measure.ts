import {useEffect,useState} from 'react';
import {browserLabelMeasure,type LabelMeasure} from './diagram-labels';

export function useDiagramLabelMeasure(){
  const [measure,setMeasure]=useState<LabelMeasure>();
  useEffect(()=>{
    let active=true;
    const update=()=>{if(active)setMeasure(()=>browserLabelMeasure());};
    update();
    if(document.fonts){
      void document.fonts.ready.then(update).catch(()=>{});
      document.fonts.addEventListener('loadingdone',update);
    }
    return ()=>{active=false;document.fonts?.removeEventListener('loadingdone',update);};
  },[]);
  return measure;
}
