import { confirmAction } from './confirm.js';
import React, { useEffect, useState } from 'react';
import { Button } from '@heroui/button';
import { Input } from '@heroui/input';
import { bridgeRequest, ContactPicker } from './workspace.jsx';
import { fieldStyle, searchStyle } from './controls.jsx';
import { OnlineGallery } from './online-gallery.jsx';

export function MediaWorkspace({ onBusyChange }) {
  const [settings,setSettings]=useState(null),[items,setItems]=useState([]),[accountId,setAccount]=useState('*');
  const [kind,setKind]=useState('account'),[targetId,setTarget]=useState(''),[type,setType]=useState('sticker'),[name,setName]=useState(''),[file,setFile]=useState(null),[query,setQuery]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false),[selected,setSelected]=useState(null),[preview,setPreview]=useState('');
  useEffect(()=>{let active=true;Promise.all([bridgeRequest('GET','state'),bridgeRequest('GET','media')]).then(([state,media])=>{if(active){setSettings(state.settings);setItems(media.items);}}).catch(e=>{if(active){setError(true);setMessage(e.message);}});return()=>{active=false;};},[]);
  async function run(work){if(busy)return;setBusy(true);onBusyChange(true);setMessage('');setError(false);try{await work();}catch(e){setError(true);setMessage(e.message);}finally{setBusy(false);onBusyChange(false);}}
  async function upload(event){event.preventDefault();await run(async()=>{
    if(!file||file.size>8*1024*1024)throw Error('请选择 8MB 以内的 PNG、JPEG、GIF 或 WebP。');
    if(!name.trim())throw Error('请给素材起一个名称。');
    const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败，请重选。'));reader.readAsDataURL(file);});
    const result=await bridgeRequest('POST','media',{accountId,kind,targetId:kind==='account'?'':targetId,name,type,base64});
    setItems(old=>[...old,result.item]);setName('');setFile(null);document.getElementById('media-file').value='';setMessage('上传成功，可在对应 QQ 会话中使用。');
  });}
  async function show(item){await run(async()=>{const result=await bridgeRequest('POST','media/preview',{id:item.id});setSelected(item.id);setPreview(result.dataURL);});}
  async function remove(item){if(!confirmAction('删除素材“'+item.name+'”？'))return;await run(async()=>{await bridgeRequest('DELETE','media/'+item.id);setItems(old=>old.filter(row=>row.id!==item.id));if(selected===item.id){setSelected(null);setPreview('');}setMessage('已删除素材。');});}
  return <div className="media-workspace">
    <OnlineGallery disabled={busy} savedItems={items} onBusyChange={value=>{setBusy(value);onBusyChange(value);}} onAdded={item=>setItems(old=>[...old.filter(row=>row.id!==item.id),item])}/>
    <details className="media-upload-details"><summary>导入自己的素材</summary>
    <p className="media-help">上传后可发送“/图片 名称”或“/表情包 名称”。也可在 QQ 附图或引用图片后发送“/收藏图片 名称”或“/收藏表情包 名称”；聊天收藏仅在当前会话使用。机器人会根据话题选择已上传素材配图。</p>
    <form onSubmit={upload} className="media-upload" aria-label="上传素材">
      <div className="media-fields"><span className="media-global-label">所有登录 QQ 共用素材</span>
      {kind!=='account'&&<ContactPicker label={kind==='group'?'素材群号':'素材好友 QQ'} value={targetId} onChange={setTarget} accountId={accountId} kind={kind==='group'?'groups':'friends'} disabled={busy}/>}
      <label className="media-select-label">素材类型<select aria-label="素材类型" value={type} disabled={busy} onChange={e=>setType(e.target.value)}><option value="sticker">表情包</option><option value="image">图片</option></select></label>
      <Input {...fieldStyle} label="素材名称" aria-label="素材名称" maxLength={60} value={name} onValueChange={setName} isDisabled={busy}/>
      <label className="media-file-label" htmlFor="media-file">选择文件（最大 8MB）<input id="media-file" aria-label="素材文件" type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={busy} onChange={e=>{const next=e.target.files?.[0];setFile(next||null);if(next&&!name)setName(next.name.replace(/\.[^.]+$/,'').slice(0,60));}}/></label></div>
      <Button type="submit" color="primary" isLoading={busy} isDisabled={busy||!settings||!file}>上传素材</Button>
    </form>
    </details>
    <div className="library-heading"><h2>已保存素材<span className="record-count">{items.length} / 1000</span></h2><Button variant="light" isDisabled={busy} onPress={()=>run(async()=>setItems((await bridgeRequest('GET','media')).items))}>刷新素材</Button></div>
    <Input {...searchStyle} aria-label="搜索素材" placeholder="搜索素材名称" value={query} onValueChange={setQuery}/>
    <div className="media-grid">{items.filter(item=>(item.name+' '+item.targetId).includes(query)).map(item=><article className="media-card" key={item.id}>
      {selected===item.id&&preview&&<img className="media-preview" src={preview} alt={item.name}/>}
      <h3>{item.name}</h3><p>{item.type==='sticker'?'表情包':'图片'} · {Math.ceil(item.size/1024)} KB</p><p>{item.accountId==='*'?'所有聊天':item.kind==='account'?'共享素材':item.kind==='group'?'群 '+item.targetId:'私聊 '+item.targetId}</p>{item.source&&<a href={item.source.url} target="_blank" rel="noopener noreferrer" className="online-gallery-source">{item.source.name}</a>}
      <code>/{item.type==='sticker'?'表情包':'图片'} {item.name}</code>
      <div className="media-card-actions"><Button size="sm" variant="flat" isDisabled={busy} onPress={()=>show(item)}>预览</Button><Button size="sm" variant="light" color="danger" isDisabled={busy} onPress={()=>remove(item)}>删除</Button></div>
    </article>)}</div>
    {!items.length&&<p className="empty-label">还没有素材。上传图片，或在 QQ 中引用图片进行收藏。</p>}
    <p role="status" aria-live="polite" className={'feedback '+(error?'error':'success')}>{message}</p>
  </div>;
}

export function SpeechPreview({ disabled }) {
  const [text,setText]=useState('你好，这是小米语音试听。'),[style,setStyle]=useState(''),[url,setURL]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function preview(){if(busy)return;setBusy(true);setError('');setURL('');try{setURL((await bridgeRequest('POST','speech/preview',{text,style})).dataURL);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="speech-preview" aria-label="语音试听"><h2>试听声音</h2><p>先保存并启用语音。试听可填写本次表达指令；会调用小米服务，不会向 QQ 发消息。聊天开启自动表达后，模型会按当前回复生成指令。</p><Input {...fieldStyle} label="试听文字" aria-label="试听文字" value={text} onValueChange={setText} isDisabled={disabled||busy}/><Input {...fieldStyle} label="本次表达指令（可选）" aria-label="本次表达指令" placeholder="例如：温柔安慰，语速稍慢，句末轻停顿" maxLength={300} value={style} onValueChange={setStyle} isDisabled={disabled||busy}/><Button variant="bordered" isDisabled={disabled||busy||!text.trim()} isLoading={busy} onPress={preview}>生成试听</Button>{url&&<audio controls src={url} aria-label="小米语音试听"/>}<p role="status" className="feedback error">{error}</p><p>QQ 中发送“/语音 要说的文字”，或“用语音回答：你的问题”。也可发送“/语音 [温柔、慢一点] 没关系，我在。”指定本条表达方式。最终发送 QQ 原生语音条。</p></section>;
}
