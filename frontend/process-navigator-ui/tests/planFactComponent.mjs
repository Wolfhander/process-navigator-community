import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {createElement} from 'react';
import {planFactReport,planFactCsv} from '../src/plan-fact-report.ts';
const source=readFileSync(new URL('../src/PlanFactComparison.tsx',import.meta.url),'utf8');
const code=(await transformWithOxc(source,'PlanFactComparison.tsx',{jsx:{runtime:'classic'}})).code
  .replace(/^import[^\n]*\n/gm,'').replace('export function ','function ');
export const PlanFactComparison=new Function('React','planFactReport','planFactCsv',code+';return PlanFactComparison;')({createElement},planFactReport,planFactCsv);
