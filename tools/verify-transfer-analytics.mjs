import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const origin = 'http://127.0.0.1:5087';
const root = path.resolve('artifacts/master-acceptance/Data');
const headers = {'X-Process-Navigator-User':'demo-superadministrator'};
const catalogResponse = await fetch(origin + '/api/processes', {headers});
assert.equal(catalogResponse.status, 200);
const catalog = await catalogResponse.json();
assert.ok(catalog.every(p => ['md-order','md-engineering','md-design','md-documentation','md-drawing','md-transfer'].includes(p.id)), 'Only the isolated master catalog may be changed');
const fixture = JSON.parse(await readFile('master-data/transfers/process.json', 'utf8'));
const escape = s => String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const xml = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"><b:process id="md-transfer" name="${escape(fixture.name)}"><b:laneSet id="ls"><b:lane id="lane" name="Учебный отдел">${fixture.nodes.map(n=>`<b:flowNodeRef>${n.id}</b:flowNodeRef>`).join('')}</b:lane></b:laneSet>${fixture.nodes.map(n=>`<b:userTask id="${n.id}" name="${escape(n.name)}"/>`).join('')}${fixture.edges.map(e=>`<b:sequenceFlow id="${e.id}" sourceRef="${e.sourceId}" targetRef="${e.targetId}"/>`).join('')}</b:process><bi:BPMNDiagram id="diagram"><bi:BPMNPlane id="plane" bpmnElement="md-transfer"><bi:BPMNShape id="lane-shape" bpmnElement="lane"><dc:Bounds x="0" y="0" width="1000" height="200"/></bi:BPMNShape>${fixture.nodes.map(n=>`<bi:BPMNShape id="${n.id}-shape" bpmnElement="${n.id}"><dc:Bounds x="${n.x+40}" y="50" width="${n.width}" height="${n.height}"/></bi:BPMNShape>`).join('')}${fixture.edges.map(e=>`<bi:BPMNEdge id="${e.id}-edge" bpmnElement="${e.id}"><di:waypoint x="220" y="90"/><di:waypoint x="290" y="90"/></bi:BPMNEdge>`).join('')}</bi:BPMNPlane></bi:BPMNDiagram></b:definitions>`;
// Generated QA artifacts only: never write the user's runtime Data directory.
await writeFile(path.join(root, 'md-transfer.bpmn'), xml);
await writeFile(path.join(root, 'md-transfer.context.json'), JSON.stringify({version:'1',status:'Published',owner:'Учебный отдел',elements:Object.fromEntries(fixture.nodes.map(n=>[n.id,{channels:n.channels ?? [],informationObjects:n.informationObjects ?? []}]))},null,2));
const response = await fetch(origin + '/api/analytics/transfers', {headers}); assert.equal(response.status, 200);
const report = await response.json();
const findings = report.findings.filter(f=>f.processId==='md-transfer');
assert.equal(findings.length, 6); assert.equal(report.processCount, 6);
assert.deepEqual(findings.find(f=>f.code==='system-transition').objectIds,['drawing']);
for(const user of ['demo-employee','no-such-user']) {
  const denied = await fetch(origin + '/api/analytics/transfers', {headers:{'X-Process-Navigator-User':user}});
  assert.equal(denied.status,403);
}
await writeFile('artifacts/master-acceptance/transfer-actual.json', JSON.stringify(report,null,2));
console.log('Transfer HTTP checks: master fixture six findings, stable ID and two denied profiles PASS.');
