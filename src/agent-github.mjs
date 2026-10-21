/** Fixed-host GitHub REST adapter. Credentials are supplied at request time. */
export class AgentGitHub {
 constructor({ token, fetcher = fetch }) { this.token = token; this.fetcher = fetcher; }
 async request(method, path, body, { beforeWrite = () => {} } = {}) {
  if (!['GET','POST','PATCH','PUT'].includes(method) || !/^\/(?:user\/repos\?|search\/(?:repositories|code|issues)\?|repos\/)[^\r\n#]*$/.test(path)) throw new Error('不允许的 GitHub 接口。');
  const secret = await this.token(); if (!secret) throw new Error('GitHub Token 未连接。');
  if (method !== 'GET') beforeWrite();
  const response = await this.fetcher(new URL(path, 'https://api.github.com'), { method, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { authorization: 'Bearer ' + secret, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) { await response.body?.cancel(); throw new Error('GitHub 请求失败。'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 512000) { await response.body?.cancel().catch(() => {}); throw new Error('GitHub 响应过大。'); } chunks.push(chunk); }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  // Do not relay temporary credentials embedded in API metadata to the model.
  return JSON.parse(JSON.stringify(result, (key, value) => /token|secret|authorization/i.test(key) ? undefined : value));
 }
}
