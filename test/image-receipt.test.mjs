import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OneBot} from '../src/onebot.mjs';
import {deliverReply} from '../src/reply-delivery.mjs';
const bytes=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
const image={type:'image',data:{file:'base64://'+bytes.toString('base64'),sub_type:1}};
const digest=createHash('md5').update(bytes).digest('hex');
const timeout=()=>Object.assign(Error('raw secret or URL'),{deliveryUnknown:true});

test('image timeout recovers a new own-sender matching receipt without resending',async()=>{
  const bot=new OneBot('ws://127.0.0.1:3001','',()=>{});let sends=0,reads=0;
  bot.call=async action=>{
    if(action==='get_login_info')return{user_id:'10000001'};
    if(action==='get_friend_msg_history')return{messages:reads++? [{message_id:2,user_id:'10000001',time:Math.floor(Date.now()/1000),message:[{type:'image',data:{file:digest+'.gif'}}]}]:[]};
    sends++;throw timeout();
  };
  assert.deepEqual(await bot.sendSegments({user_id:'20000001'},[image]),{message_id:2});assert.equal(sends,1);assert.equal(reads,2);
});

test('old, foreign, mismatching or ambiguous images cannot satisfy a failed send',async()=>{
  for(const variant of ['old','foreign','mismatch','ambiguous']){
    const bot=new OneBot('ws://127.0.0.1:3001','',()=>{});let sends=0,reads=0;
    const row={message_id:2,user_id:variant==='foreign'?'20000001':'10000001',time:Math.floor(Date.now()/1000),message:[{type:'image',data:{file:variant==='mismatch'?'a'.repeat(32):digest}}]};
    bot.call=async action=>{
      if(action==='get_login_info')return{user_id:'10000001'};
      if(action==='get_group_msg_history') {reads++;return{messages:reads===1?(variant==='old'?[row]:[]):variant==='ambiguous'?[row,{...row,message_id:3}]:[row]};}
      sends++;throw timeout();
    };
    await assert.rejects(()=>bot.sendSegments({group_id:'30000001'},[image]));assert.equal(sends,1);
  }
});

test('image send failures stay in diagnostics and never become QQ error bubbles',async()=>{
  const sent=[],issues=[];
  const result=await deliverReply({messages:[{text:'正文',segments:[image]},{text:'后续'}]},{target:{},onIssue:(...issue)=>issues.push(issue),bot:{send:async(_t,text)=>sent.push(text),sendSegments:async()=>{throw timeout();}}});
  assert.deepEqual(sent,['正文']);assert.equal(issues[0][0],'image_send_failed');assert.ok(!result.summary.includes('raw secret'));assert.match(result.summary,/媒体发送未完成/);
});
