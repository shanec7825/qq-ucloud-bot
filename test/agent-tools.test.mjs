import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentTools, ToolAgent } from '../src/agent-tools.mjs';
import { AgentGitHub } from '../src/agent-github.mjs';
const event = { message_type:'private', user_id:'1', self_id:'2' };
test('confirmation is exact, account bound, expires and is one-use', async () => {
 let now=0, revision=1; const calls=[];
 const tools=new AgentTools({ owner:'1',settings:()=>({writes:true}),now:()=>now,signature:()=>revision,github:{request:async (...args)=>{calls.push(args);return 'ok';}} });
 const prepare=()=>tools.execute('github.issue.create',{repo:'a/b',title:'x',body:'y'},event);
 let preview=await prepare(), code=preview.instruction.split(' ').at(-1); assert.equal(calls.length,0);
 await assert.rejects(tools.confirm(code,{...event,self_id:'3'}));
 await assert.rejects(tools.confirm(code,{...event,user_id:'3'}));
 await tools.confirm(code,event); assert.equal(calls.length,1); await assert.rejects(tools.confirm(code,event));
 preview=await prepare(); revision++; await assert.rejects(tools.confirm(preview.instruction.split(' ').at(-1),event));
 preview=await prepare(); now=300001; await assert.rejects(tools.confirm(preview.instruction.split(' ').at(-1),event));
});
test('group, arbitrary tools, traversal and extra keys denied',async()=>{
 const tools=new AgentTools({owner:'1',github:{request:()=>assert.fail()}});
 await assert.rejects(tools.execute('github.repos',{}, {...event,message_type:'group'}));
 await assert.rejects(tools.execute('shell.exec',{},event));
 await assert.rejects(tools.execute('github.repos',{command:'x'},event));
 await assert.rejects(tools.execute('github.files',{repo:'a/b',path:'../x'},event));
});
test('loop bounded at configured maximum and malformed JSON fails closed',async()=>{
 let calls=0; const tools=new AgentTools({owner:'1',github:{request:async()=>{calls++; return 'data';}}});
 const agent=new ToolAgent({tools,settings:()=>({enabled:true,maxSteps:99}),ai:async()=>JSON.stringify({tool:'github.repos',args:{}})});
 assert.match(await agent.answer('github',event),/上限/); assert.equal(calls,8);
 agent.ai=async()=> 'not JSON'; await assert.rejects(agent.answer('github',event)); assert.equal(calls,8);
});
test('GitHub adapter uses fixed API and encodes file payload',async()=>{
 let request; const github=new AgentGitHub({token:()=> 'private-token',fetcher:async(url,options)=>{request={url,options};return new Response(JSON.stringify({ok:true,token:'secret'}));}});
 const tools=new AgentTools({owner:'1',settings:()=>({writes:true}),github});
 const preview=await tools.execute('github.file.write',{repo:'a/b',path:'x.txt',content:'你好',message:'save',branch:'main'},event);
 const result=await tools.confirm(preview.instruction.split(' ').at(-1),event);
 assert.equal(request.url.hostname,'api.github.com'); assert.equal(request.options.method,'PUT'); assert.equal(JSON.parse(request.options.body).content,Buffer.from('你好').toString('base64')); assert.equal(result.token,undefined);
});


test('agent revocation during planning and reads stops execution and disclosure',async()=>{
 let enabled=true, revision=1, reads=0;
 const tools=new AgentTools({owner:'1',settings:()=>({enabled}),signature:()=>revision,github:{request:async()=>{reads++;revision++;return 'private result';}}});
 const agent=new ToolAgent({tools,settings:()=>({enabled}),ai:async()=>{enabled=false;return JSON.stringify({tool:'github.repos',args:{}});}});
 await assert.rejects(agent.answer('github',event));assert.equal(reads,0);
 enabled=true;agent.ai=async()=>JSON.stringify({tool:'github.repos',args:{}});
 await assert.rejects(agent.answer('github',event),/改变/);assert.equal(reads,1);
});

test('GitHub refs accept branch paths while rejecting invalid refs',()=>{
 const tools=new AgentTools({owner:'1'});
 const args={repo:'a/b',title:'x',body:'y',head:'feature/homework',base:'release/v1'};
 assert.equal(tools.validate('github.pull.create',args).head,'feature/homework');
 for(const head of ['../main','feature//x','a.lock','foo@{bar']) assert.throws(()=>tools.validate('github.pull.create',{...args,head}));
});

test('agent supplies conversation context only for tool conversations',async()=>{
 let contexts=0, observed;
 const tools=new AgentTools({owner:'1'});
 const agent=new ToolAgent({tools,settings:()=>({enabled:true}),context:()=>{contexts++;return {recent:'previous'};},ai:async(q,c)=>{observed=c.context;return JSON.stringify({answer:'done'});}});
 assert.equal(await agent.answer('hello',event),null);assert.equal(contexts,0);
 assert.equal(await agent.answer('github',event),'done');assert.deepEqual(observed.current,{recent:'previous'});
});
