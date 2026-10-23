import { abortable } from './chat-abort.mjs';

const incomplete = () => new Error('模型回复未完整生成，请缩短问题后重试。');

// Decode SSE as frames, retaining UTF-8 and line boundaries across network
// chunks. Never expose reasoning, tool parameters or provider diagnostics.
export async function readChatStream(response, { signal, onDelta } = {}) {
  if (!response.body) throw incomplete();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', answer = '', size = 0, finished = false, done = false, data = [];
  const frame = async () => {
    const source = data.join('\n'); data = [];
    if (!source) return;
    if (source === '[DONE]') { done = true; return; }
    let json;
    try { json = JSON.parse(source); } catch { throw incomplete(); }
    if (json.error) throw new Error('模型流式请求失败，请检查服务连接和额度。');
    if (json.choices?.some(item => item.index != null && item.index !== 0)) throw incomplete();
    const choice = json.choices?.[0];
    if (!choice) return; // Usage-only frame.
    if (choice.delta?.tool_calls?.length || choice.delta?.function_call) throw incomplete();
    if (choice.finish_reason != null && choice.finish_reason !== 'stop') throw incomplete();
    if (finished && choice.delta?.content) throw incomplete();
    const delta = choice.delta?.content;
    if (delta != null && typeof delta !== 'string') throw incomplete();
    if (delta) {
      answer += delta;
      if (answer.length > 64000) throw incomplete();
      await onDelta?.(delta);
    }
    if (choice.finish_reason === 'stop') finished = true;
  };
  const lines = async final => {
    let index;
    while (!done && (index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/u, ''); buffer = buffer.slice(index + 1);
      if (!line) await frame();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /u, ''));
    }
    if (final && !done) {
      if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /u, '').replace(/\r$/u, ''));
      buffer = ''; await frame();
    }
  };
  try {
    while (!done) {
      signal?.throwIfAborted();
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) { buffer += decoder.decode(); await lines(true); break; }
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw incomplete();
      buffer += decoder.decode(chunk.value, { stream: true }); await lines(false);
    }
    signal?.throwIfAborted();
    if (!finished || !done || !answer.trim()) throw incomplete();
    return answer;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
