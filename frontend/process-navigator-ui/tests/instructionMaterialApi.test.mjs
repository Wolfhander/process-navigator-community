import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
const api=readFileSync(new URL('../src/api.ts',import.meta.url),'utf8');
const functions=['artifactDownloadUrl','probeInstructionArtifact'].map(name=>api.match(new RegExp('export (?:async )?function '+name+'[\\s\\S]*?\\n}'))[0]).join('\n');
const compiled=await transformWithOxc(functions,'api.ts',{});
test('artifact probe uses authenticated uncached HEAD with exact encoded version and cancellation',async()=>{
  let request;
  const probe=new Function('roleHeaders','fetch',compiled.code.replace(/export /g,'')+';return probeInstructionArtifact;')(()=>({'X-Process-Navigator-User':'test-user'}),async(url,options)=>{request={url,options};return{status:403};});
  const signal=new AbortController().signal;
  assert.equal(await probe('artifact:some/id','2 & 3',signal),403);
  assert.equal(request.url,'/api/artifacts/some%2Fid/content?version=2%20%26%203');
  assert.equal(request.options.method,'HEAD');assert.equal(request.options.signal,signal);
  assert.equal(request.options.cache,'no-store');assert.equal(request.options.redirect,'error');
  assert.equal(request.options.headers['X-Process-Navigator-User'],'test-user');
  await assert.rejects(()=>probe('https://example.test','1',signal),/artifact:/);
});
test('GET and HEAD share the same artifact permission and resolution handler',()=>{
  const server=readFileSync(new URL('../../../backend/ProcessNavigator.Api/Program.cs',import.meta.url),'utf8');
  const handler=server.slice(server.indexOf('app.MapMethods("/api/artifacts/{artifactId}/content"'),server.indexOf('app.MapGet("/api/processes",'));
  assert.match(handler,/\["GET", "HEAD"\]/);
  assert.match(handler,/access.Has\(context, ProcessPermissions.View\)/);
  assert.match(handler,/ResolveAsync\(artifactId, version/);
});
