import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentDrive } from '../src/agent-drive.mjs';
import { GoogleDrive, DRIVE_SCOPE } from '../src/google-drive.mjs';
test('Drive readonly does not silently request full scope',()=>{
 const google=new GoogleDrive({settings:()=>({drive:{clientId:'id',accessMode:'read'}}),vault:{get:()=> 'secret'}});
 assert.equal(new URL(google.begin('http://localhost','session').url).searchParams.get('scope'),DRIVE_SCOPE);
 assert.throws(()=>google.begin('http://localhost','session',{write:true}));
});
test('Drive write grant needs explicit config and appears in consent URL',()=>{
 const google=new GoogleDrive({settings:()=>({drive:{clientId:'id',accessMode:'write'}}),vault:{get:()=> 'secret'}});
 assert.equal(new URL(google.begin('http://localhost','session',{write:true}).url).searchParams.get('scope'),'https://www.googleapis.com/auth/drive');
});
test('Drive writes require both enabled permission and actual granted scope',async()=>{
 const google={vault:{get:()=>JSON.stringify({scopes:[DRIVE_SCOPE]})},fetcher:()=>assert.fail()};
 const drive=new AgentDrive({google,canWrite:()=>true});
 await assert.rejects(drive.agentRequest('trash',{fileId:'abc'}),/只读/);
});
test('Drive move matches official add/remove parents contract and fixed host',async()=>{
 let observed;const google={vault:{get:()=>JSON.stringify({scopes:['https://www.googleapis.com/auth/drive']})},accessToken:async()=> 'secret',fetcher:async(url,options)=>{observed={url,options};return new Response('{"id":"abc"}');}};
 const drive=new AgentDrive({google,canWrite:()=>true});
 await drive.agentRequest('move',{fileId:'abc',parent:'new',previousParent:'old'});
 assert.equal(observed.url.hostname,'www.googleapis.com');assert.equal(observed.url.searchParams.get('addParents'),'new');assert.equal(observed.url.searchParams.get('removeParents'),'old');assert.equal(observed.options.method,'PATCH');assert.equal(observed.options.redirect,'error');
});
test('Drive search escapes name rather than accepting arbitrary q',async()=>{
 let observed; const google={get:async(path,q)=>{observed=q;return '{"files":[]}';}};
 await new AgentDrive({google}).agentRequest('search',{query:"x' or trashed=true"});
 assert.match(observed.q,/x\\' or trashed=true/);assert.equal(observed.pageSize,'50');
});

test('Drive root confines list, search and direct read/write targets',async()=>{
 const calls=[];
 const google={settings:()=>({drive:{rootFolderId:'allowed'}}),get:async(path,q)=>{
  calls.push({path,q});
  if(path==='files') return JSON.stringify({files:[{id:'inside'},{id:'outside'}]});
  return JSON.stringify({id:path.slice(6),parents:path==='files/inside'?['allowed']:['elsewhere']});
 }};
 const drive=new AgentDrive({google});
 await drive.agentRequest('list',{});assert.match(calls[0].q.q,/'allowed' in parents/);
 assert.deepEqual((await drive.agentRequest('search',{query:'x'})).files,[{id:'inside'}]);
 for(const operation of ['read','get','trash','update','move']) await assert.rejects(drive.agentRequest(operation,{fileId:'outside',parent:'allowed'}),/根文件夹/);
 await assert.rejects(drive.agentRequest('create',{parent:'outside',name:'x',content:'x'}),/根文件夹/);
});
