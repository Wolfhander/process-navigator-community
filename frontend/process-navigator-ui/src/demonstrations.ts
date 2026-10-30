import {appSections,type AppSection} from './section-location.ts';
export type DemonstrationScenario={id:string;title:string;page:AppSection;models:string[];role:string;actions:string[];expected:Record<string,string>;evidence:string[]};
export type DemonstrationStep={id:number;title:string;status:string};
export function readDemonstrationScenarios(value:unknown):DemonstrationScenario[]{
  if(!Array.isArray(value))throw Error('Неверный формат матрицы демонстраций.');
  const ids=new Set<string>();
  const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.length>0&&v.every(s=>typeof s==='string'&&s.trim().length>0);
  return value.map(item=>{
    if(!item||typeof item!=='object')throw Error('Неверный сценарий демонстрации.');
    const s=item as Record<string,unknown>;
    if(typeof s.id!=='string'||!s.id.trim()||ids.has(s.id)||typeof s.title!=='string'||!s.title.trim()||typeof s.role!=='string'||!s.role.trim()||!appSections.includes(s.page as AppSection)||!strings(s.models)||!strings(s.actions)||!strings(s.evidence)||s.evidence.some(p=>!p.startsWith('docs/')&&!p.startsWith('master-data/')||p.split('/').includes('..')))throw Error('Неполный или повторный сценарий демонстрации.');
    if(!s.expected||typeof s.expected!=='object'||Array.isArray(s.expected)||!Object.entries(s.expected).length||Object.entries(s.expected).some(([k,v])=>!/^\d+$/.test(k)||!Number.isSafeInteger(Number(k))||Number(k)<1||String(Number(k))!==k||typeof v!=='string'||!v.trim()))throw Error('Не задан ожидаемый результат функции.');
    ids.add(s.id);
    return {id:s.id,title:s.title,role:s.role,page:s.page as AppSection,models:s.models,actions:s.actions,evidence:s.evidence,expected:Object.fromEntries(Object.entries(s.expected).map(([k,v])=>[k,String(v)]))};
  });
}
export function demonstrationCoverage(steps:DemonstrationStep[],scenarios:DemonstrationScenario[]) {
  const done=steps.filter(step=>step.status==='done');
  const byStep=new Map<number,DemonstrationScenario>();
  const duplicates:number[]=[];
  for(const scenario of scenarios)for(const key of Object.keys(scenario.expected)){
    const id=Number(key);if(byStep.has(id))duplicates.push(id);else byStep.set(id,scenario);
  }
  return {done,byStep,missing:done.filter(step=>!byStep.has(step.id)),duplicates,
    stale:[...byStep.keys()].filter(id=>!done.some(step=>step.id===id))};
}
export function selectDemonstrations(steps:DemonstrationStep[],scenarios:DemonstrationScenario[],query:string) {
  const needle=query.trim().toLocaleLowerCase('ru');
  return scenarios.map(scenario=>({...scenario,steps:steps.filter(step=>step.status==='done'&&scenario.expected[String(step.id)]&&
    [step.id,step.title,scenario.title,scenario.role,...scenario.models,...scenario.actions,scenario.expected[String(step.id)]].join(' ').toLocaleLowerCase('ru').includes(needle))})).filter(scenario=>scenario.steps.length);
}
