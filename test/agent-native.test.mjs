import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatGPTConnectorClient } from '../src/chatgpt-connectors.mjs';
import { NativeAgentTools } from '../src/agent-native.mjs';
const schema={type:'object',properties:{repo:{type:'string'},count:{type:'integer',minimum:1,maximum:50},filter:{anyOf:[{type:'null'},{type:'object',properties:{state:{enum:['open','closed']}},required:['state']}] }},required:['repo'],additionalProperties:false};
const row={name:'github.list_issues',description:'Actual description',inputSchema:schema};
test('native catalog uses only available approved read tools and discovered schemas',async()=>{
 const client=new ChatGPTConnectorClient();client.ready=async()=>{};client.apps.set('github',{});client.apps.set('google_drive',{});
 const read={inputSchema:schema,annotations:{readOnlyHint:true},description:'Actual description'};
 client.tools={'github.list_issues':read,'github.get_issue':{...read,annotations:{readOnlyHint:true,destructiveHint:true}},'github.list_commits':{...read,annotations:{readOnlyHint:true,openWorldHint:true}},'github.delete_repository':read,'google_drive.search':read};
 const rows=await client.readCatalog(['github']);assert.deepEqual(rows.map(x=>x.name),['github.list_issues']);assert.deepEqual(rows[0].inputSchema,schema);assert.equal(rows[0].description,'Actual description');
 rows[0].inputSchema.type='string';assert.equal(client.tools['github.list_issues'].inputSchema.type,'object');
});
test('native arguments follow discovered schemas, JSON limits and tool authorization',async()=>{
 let calls=0, available=true;
 const client={readCatalog:async()=>available?[row]:[],call:async(name,args)=>{calls++;return {name,args};}};
 const native=new NativeAgentTools({client,providers:['github']});await native.prepare();
 assert.equal(native.catalog()[0].name,'native.github.list_issues');
 const result=await native.call('native.github.list_issues',{repo:'a/b',count:3,filter:{state:'open'}});assert.equal(result.name,'github.list_issues');
 for(const args of [{repo:'a/b',count:'3'},{repo:'a/b',count:51},{repo:'a/b',unknown:true},{repo:'a/b',filter:{state:'invalid'}},JSON.parse('{"repo":"a/b","__proto__":{}}'),{repo:'x'.repeat(33000)}]) assert.throws(()=>native.validate('native.github.list_issues',args));
 assert.throws(()=>native.validate('native.github.delete_repository',{}));
 let nested={};for(let i=0;i<10;i++) nested={nested};assert.throws(()=>native.validate('native.github.list_issues',{repo:'a/b',filter:nested}));
 available=false;await assert.rejects(native.call('native.github.list_issues',{repo:'a/b'}));assert.equal(calls,1);
});

