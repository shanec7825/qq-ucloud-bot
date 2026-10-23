import test from 'node:test';
import assert from 'node:assert/strict';
import { independentSpeech, repeatsSpeech } from '../src/speech-content.mjs';
import { routeNatural } from '../src/natural-chat.mjs';
import { deliverReply } from '../src/reply-delivery.mjs';

test('ordinary conversation removes exact and near repeat audio, across bubbles', () => {
  for (const spoken of ['今天早点休息，明天我们再继续。', '今天早点休息，明天我们再继续呀。']) {
    const rows = [{text:'今天早点休息。'}, {text:'明天我们再继续。'}], voices=[{text:spoken,style:'温柔'}, {text:'',style:''}];
    assert.ok(repeatsSpeech(spoken, rows.map(row=>row.text).join('')));
    independentSpeech(rows,voices,false);
    assert.equal(voices[0].text,'');assert.equal(rows[0].text,'今天早点休息。');
  }
});

test('required speech keeps the voice and moves its repeated sentences out of text', () => {
  const rows=[{text:'地址是三号门。路上慢一点。'}, {text:'我先过去啦。'}], voices=[{text:'路上慢一点。',style:''}, {text:'',style:''}];
  independentSpeech(rows,voices,true);
  assert.equal(rows[0].text,'地址是三号门。'); assert.equal(rows[1].text,'我先过去啦。'); assert.equal(voices[0].text,'路上慢一点。');
});

test('distinct spoken information and numbers are preserved', () => {
  const rows=[{text:'周六下午三点在南门见。'}], voices=[{text:'周日下午四点在北门见。',style:''}];
  independentSpeech(rows,voices,false);assert.equal(voices[0].text,'周日下午四点在北门见。');
});

test('natural replies complement text; explicit read-aloud still keeps matching audio', async () => {
  const event={message_type:'private',user_id:'20000001'}, text='今天六点见。', audio={type:'record',data:{file:'fixture'}};
  for(const read of [false,true]) {
    const synth=[],sent=[];
    const deps={owner:'20000001',catalog:{list:async()=>[]},speech:{autoReply:true,autoStyle:true,synthesize:async value=>{synth.push(value);return audio;}},ai:async(_q,c)=>{
      assert.equal(c.speechDirection.contentMode,read?'read-aloud':'complementary'); return JSON.stringify({text,speech:{text}});
    }};
    const reply=await routeNatural(read?'用语音朗读这句话':'用语音回答一下',event,deps);
    await deliverReply(reply,{target:{},bot:{send:async(_t,value)=>sent.push(value),sendSegments:async()=>sent.push('voice')}});
    assert.deepEqual(synth,[text]);assert.deepEqual(sent,read?[text,'voice']:['voice']);
  }
});

test('optional repeats never become a second text fallback', async () => {
  const sent=[];const reply={text:'这是一条普通消息。',speechText:'这是一条普通消息。',prepareSpeech:async()=>({error:'HTTP 403 api-key=secret'})};
  await deliverReply(reply,{target:{},onIssue:()=>{},bot:{send:async(_t,text)=>sent.push(text)}});
  assert.deepEqual(sent,['这是一条普通消息。']);
});
