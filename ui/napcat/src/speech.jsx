import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/button';
import { Textarea } from '@heroui/input';
import { Icon, fieldStyle } from './controls.jsx';
import { bridgeRequest } from './workspace.jsx';
import './speech.css';

const fieldName = field => field.key.split('__').at(-1);
const primary = new Set(['enabled', 'autoReply', 'autoStyle', 'style', 'model', 'voice', 'referenceAudio']);
const hidden = new Set(['voiceDescription', 'directiveVersion']);
const MAX_REFERENCE_BASE64 = 10 * 1024 * 1024;
const CLONE_MODEL = 'mimo-v2.5-tts-voiceclone';
const DESIGN_MODEL = 'mimo-v2.5-tts-voicedesign';

function readAudio(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(Error('无法读取音频，请重新选择文件。'));
    reader.onabort = () => reject(Error('音频读取已取消。'));
    reader.readAsDataURL(file);
  });
}

// Reference uploads only stage a file. The parent's save transaction activates its ID.
export function SpeechWorkspace({ fields, renderField, get, onChange, formSession, busy, dirty, view = 'settings', onViewChange }) {
  const [text, setText] = useState('你好，今天也慢慢来，我们一起把事情做好。');
  const [conversation, setConversation] = useState(''), [style, setStyle] = useState('');
  const [audio, setAudio] = useState(''), [previewing, setPreviewing] = useState(false), [error, setError] = useState('');
  const [appliedStyle, setAppliedStyle] = useState('');
  const [reference, setReference] = useState(null), [referenceAudio, setReferenceAudio] = useState('');
  const [uploading, setUploading] = useState(false), [referenceLoading, setReferenceLoading] = useState(false), [uploadError, setUploadError] = useState('');
  const mounted = useRef(true), pending = useRef(false), uploadPending = useRef(false), fileInput = useRef(null);
  const model = get('model'), referenceId = get('referenceAudio') || '';
  const clone = model === CLONE_MODEL, design = model === DESIGN_MODEL;
  const findField = name => fields.find(field => fieldName(field) === name);
  const directive = findField('style'), modelField = findField('model'), voiceField = findField('voice'), referenceField = findField('referenceAudio');
  const enabledField = findField('enabled');
  const toggles = fields.filter(field => ['autoStyle', 'autoReply'].includes(fieldName(field)));
  const advanced = fields.filter(field => !primary.has(fieldName(field)) && !hidden.has(fieldName(field)));
  const limit = Number(get('maxChars')) || 500;
  const signature = JSON.stringify([formSession, dirty, get('style'), model, referenceId, get('voice'), get('autoStyle'), get('enabled'), get('baseURL'), limit, text, conversation, style]);
  const configuration = useRef(signature), identity = useRef({ model, referenceId });
  configuration.current = signature; identity.current = { model, referenceId, formSession, fieldKey: referenceField?.key };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setAudio(''); setError(''); setAppliedStyle(''); }, [signature]);
  useEffect(() => {
    let current = true;
    setReference(null); setReferenceAudio(''); setUploadError('');
    if (!clone || !referenceId) { setReferenceLoading(false); return; }
    setReferenceLoading(true);
    bridgeRequest('POST', 'speech/reference/preview', { id: referenceId }).then(result => {
      if (!current) return;
      if (!/^data:audio\/(?:wav|mpeg);base64,/.test(result.dataURL || '')) throw Error('参考音频格式无效，请重新上传。');
      setReference(result.reference); setReferenceAudio(result.dataURL);
    }).catch(failure => { if (current) setUploadError(failure.message || '参考音频未读取，请重试。'); })
      .finally(() => { if (current) setReferenceLoading(false); });
    return () => { current = false; };
  }, [clone, referenceId]);

  async function upload(file) {
    if (!file || uploadPending.current || busy || !referenceField) return;
    setUploadError('');
    if (!/\.(?:wav|mp3)$/i.test(file.name)) { setUploadError('请选择 WAV 或 MP3 音频。'); return; }
    if (!file.size || Math.ceil(file.size / 3) * 4 > MAX_REFERENCE_BASE64) { setUploadError('音频不能为空，原文件需小于约 7.5 MiB（Base64 上限 10 MiB）。'); return; }
    const captured = { ...identity.current };
    let uploadId;
    uploadPending.current = true; setUploading(true);
    try {
      const base64 = await readAudio(file);
      if (!mounted.current) return;
      ({ uploadId } = await bridgeRequest('POST', 'speech/reference/start', { name: file.name, size: file.size }));
      if (!uploadId) throw Error('无法开始上传，请重试。');
      for (let offset = 0, index = 0; offset < base64.length; offset += 64 * 1024, index++) {
        if (!mounted.current || JSON.stringify(identity.current) !== JSON.stringify(captured)) throw Error('设置页面已更新，请重新选择参考音频。');
        await bridgeRequest('POST', 'speech/reference/chunk', { uploadId, index, base64: base64.slice(offset, offset + 64 * 1024) });
      }
      const result = await bridgeRequest('POST', 'speech/reference/finish', { uploadId });
      uploadId = undefined;
      if (!mounted.current) return;
      if (JSON.stringify(identity.current) !== JSON.stringify(captured)) throw Error('设置页面已更新，请重新选择参考音频。');
      if (!result.reference?.id) throw Error('上传未返回参考音频，请重试。');
      if (await onChange(referenceField, result.reference.id) === false) throw Error('设置正在更新，请稍后重新选择参考音频。');
    } catch (failure) { if (mounted.current) setUploadError(failure.message || '音频上传未完成，请重试。'); }
    finally {
      if (uploadId) { try { await bridgeRequest('POST', 'speech/reference/cancel', { uploadId }); } catch { /* The server expires unfinished uploads after five minutes. */ } }
      uploadPending.current = false; if (mounted.current) setUploading(false); if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function preview() {
    if (pending.current || busy || dirty || uploading || !get('enabled') || clone && !referenceId || !text.trim() || text.length > limit) return;
    const captured = configuration.current;
    pending.current = true; setPreviewing(true); setError(''); setAudio(''); setAppliedStyle('');
    try {
      const result = await bridgeRequest('POST', 'speech/preview', { text: text.trim(), style: style.trim(), autoStyle: !!get('autoStyle'), conversation: conversation.trim() });
      if (typeof result.dataURL !== 'string' || !result.dataURL.startsWith('data:audio/wav;base64,')) throw Error('试听服务未返回有效音频。');
      if (mounted.current && configuration.current === captured) { setAudio(result.dataURL); setAppliedStyle(result.style || ''); }
    } catch (failure) {
      if (mounted.current && configuration.current === captured) setError(failure.message || '试听未生成，请检查连接。');
    } finally { pending.current = false; if (mounted.current) setPreviewing(false); }
  }

  const voiceLabel = clone ? '参考音频复刻' : design ? '文字设计音色' : get('voice') || '预置音色';
  return <div className="speech-workspace">
    <div className="speech-view-tabs" role="tablist" aria-label="语音工作区">
      {[['settings', '声音设置'], ['audition', '试听']].map(([value, label]) => <button key={value} type="button" role="tab" id={'speech-tab-' + value} aria-selected={view === value} aria-controls={'speech-panel-' + value} tabIndex={view === value ? 0 : -1} onClick={() => onViewChange(value)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'settings' : event.key === 'End' ? 'audition' : view === 'settings' ? 'audition' : 'settings';
        onViewChange(next); document.getElementById('speech-tab-' + next)?.focus();
      }}>{label}</button>)}
    </div>

    <section className="speech-settings-view speech-view" id="speech-panel-settings" role="tabpanel" aria-labelledby="speech-tab-settings" hidden={view !== 'settings'}>
      {enabledField && <div className="speech-enable">{renderField(enabledField)}</div>}
      <div className="speech-identity-section">
        {modelField && renderField(modelField)}
        {!clone && !design && voiceField && renderField(voiceField)}
        {clone && <div className="speech-reference" aria-label="参考音频">
          <input hidden ref={fileInput} id="speech-reference-file" aria-label="选择参考音频" type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" disabled={busy || uploading} onChange={event => upload(event.target.files?.[0])}/>
          <div className="speech-reference-row">
            <span className="speech-reference-icon"><Icon name="mic" size={20}/></span>
            <div className="speech-reference-copy"><strong>{reference?.name || (referenceLoading ? '正在读取参考音频…' : '上传一段参考声音')}</strong><span>{reference ? (reference.size / 1024).toFixed(1) + ' KiB · ' + (dirty ? '待保存' : '已选用') : '清晰的单人语音 · WAV / MP3 · 约 7.5 MiB 以内'}</span></div>
            <Button type="button" size="sm" variant="bordered" isLoading={uploading} isDisabled={busy || uploading} onPress={() => fileInput.current?.click()}>{referenceId ? '更换音频' : '选择音频'}</Button>
          </div>
          {referenceId && <div className="speech-reference-playback">{referenceAudio && <audio controls preload="none" src={referenceAudio} aria-label="参考音频原声"/>}<Button type="button" size="sm" variant="light" isDisabled={busy || uploading} onPress={() => onChange(referenceField, '')}>移除选择</Button></div>}
          {!referenceId && <p className="speech-reference-consent">仅使用你有权使用的声音；合成时会将参考音频发送给 MiMo。</p>}
          {uploadError && <p role="alert" className="feedback error">{uploadError}</p>}
        </div>}
        {design ? <div className="speech-directive">{directive && renderField(directive)}</div> : <details className="speech-disclosure speech-expression"><summary>固定表达要求<span>可选</span></summary><div className="speech-directive">{directive && renderField(directive)}</div></details>}
      </div>
      <div className="speech-use-section"><h2>聊天时使用</h2><div className="speech-toggles">{toggles.map(renderField)}</div><p>保持音色一致，按对话微调语气。文字先发送，语音随后补发。</p></div>
      {advanced.length > 0 && <details className="speech-disclosure speech-connection"><summary>连接与高级设置</summary><div className="section-fields">{advanced.map(renderField)}</div></details>}
    </section>

    <section className="speech-audition speech-view" id="speech-panel-audition" role="tabpanel" aria-labelledby="speech-tab-audition" hidden={view !== 'audition'}>
      <div className="speech-audition-intro"><h2>听听现在的声音</h2><span>{voiceLabel}</span></div>
      {dirty || !get('enabled') ? <div className="speech-preview-notice"><span>{dirty ? '声音设置有修改，保存后再试听。' : '先启用并保存声音设置，再来试听。'}</span><button type="button" onClick={() => onViewChange('settings')}>回到声音设置</button></div> : null}
      <Textarea {...fieldStyle} label="试听文字" aria-label="试听文字" minRows={3} maxLength={limit} value={text} onValueChange={setText} isDisabled={busy || previewing}/>
      <details className="speech-disclosure speech-preview-context"><summary>对话情境与本次语气<span>可选</span></summary><div>
        <Textarea {...fieldStyle} label="上一句对话（可选）" aria-label="上一句对话（可选）" description="开启表达微调时，会结合对话生成合适的语气。" minRows={2} maxLength={1000} value={conversation} onValueChange={setConversation} isDisabled={busy || previewing}/>
        <Textarea {...fieldStyle} label="本次表达要求（可选）" aria-label="本次表达要求（可选）" description="留空自动调整；填写后，本次试听优先使用这段要求。" placeholder="例如：轻声安慰，尾句稍慢" minRows={2} maxLength={300} value={style} onValueChange={setStyle} isDisabled={busy || previewing}/>
      </div></details>
      <div className="speech-audition-actions"><Button type="button" color="primary" startContent={!previewing && <Icon name="play"/>} isLoading={previewing} isDisabled={busy || previewing || uploading || dirty || !get('enabled') || clone && !referenceId || !text.trim() || text.length > limit} onPress={preview}>生成试听</Button><span>仅试听，不发送到 QQ</span></div>
      {audio && <audio controls src={audio} aria-label="小米语音试听"/>}
      {error && <p role="alert" className="feedback error">{error}</p>}
      {appliedStyle && <details className="speech-disclosure speech-applied-style"><summary>查看本次表达指导</summary><p>{appliedStyle}</p></details>}
      <p className="speech-command">聊天中也可发送 <code>/语音 [轻声、慢一点] 你好</code></p>
    </section>
  </div>;
}
