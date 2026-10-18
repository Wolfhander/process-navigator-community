import {readProcessLocation} from './process-location.ts';
import {analyticsViews,type AnalyticsView} from './analytics-views.ts';

export const appSections=['home','map','settings','version','roadmap','analytics','import','importHistory','help','catalog','catalogAudit','evidenceRegister','informationObjects','schedule','organization','users','directions','auditLog'] as const;
export type AppSection=typeof appSections[number];
export type HomeSection=Exclude<AppSection,'analytics'>;
const sectionPermissions:Partial<Record<AppSection,readonly string[]>>={analytics:['analytics.view'],organization:['system.manage'],directions:['system.manage'],auditLog:['system.manage'],users:['users.manage'],import:['process.import'],importHistory:['process.import'],catalogAudit:['process.diagram.edit','process.context.edit','process.publish']};
// Mirrors existing navigation cards; API authorization remains authoritative.
export function isSectionAvailable(section:AppSection,permissions:readonly string[]) {
  return !sectionPermissions[section]||sectionPermissions[section]!.some(permission=>permissions.includes(permission));
}
// Legacy process links retain precedence over section parameters. No external URLs are accepted.
export function readSectionLocation(hash:string):AppSection|undefined {
  if(readProcessLocation(hash))return undefined;
  const values=new URLSearchParams(hash.replace(/^#/,''));
  const pages=values.getAll('page');
  return pages.length===1&&appSections.includes(pages[0] as AppSection)?pages[0] as AppSection:'home';
}
export function readAnalyticsTab(hash:string):AnalyticsView {
  const values=new URLSearchParams(hash.replace(/^#/,''));const tabs=values.getAll('tab');
  return tabs.length===1&&analyticsViews.includes(tabs[0] as AnalyticsView)?tabs[0] as AnalyticsView:'overview';
}
export function sectionLocationHash(section:AppSection,tab:AnalyticsView='overview') {
  if(section==='home')return '';
  const values=new URLSearchParams({page:section});
  if(section==='analytics'&&tab!=='overview')values.set('tab',tab);
  return '#'+values.toString();
}
