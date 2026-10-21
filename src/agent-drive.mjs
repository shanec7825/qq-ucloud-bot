/** Fixed-host Drive adapter, using GoogleDrive's already authenticated transport. */
export class AgentDrive {
 constructor({ google, canWrite = () => false }) { this.google = google; this.canWrite = canWrite; }
 async withinRoot(fileId, root) {
  if (!root || fileId === root) return true;
  const queue = [fileId], seen = new Set();
  while (queue.length && seen.size < 20) {
   const id = queue.shift(); if (seen.has(id)) continue; seen.add(id);
   const metadata = JSON.parse(await this.google.get('files/' + encodeURIComponent(id), { fields: 'id,parents' }));
   if (metadata.parents?.includes(root)) return true;
   queue.push(...(metadata.parents || []).filter(parent => !seen.has(parent)));
  }
  return false;
 }
 async agentRequest(operation, a, { beforeWrite = () => {} } = {}) {
  const root = this.google.settings?.().drive.rootFolderId || '';
  const requireInside = async id => { if (!await this.withinRoot(id, root)) throw new Error('资源不在配置的 Drive 根文件夹内。'); };
  if (root) {
   if (a.fileId) await requireInside(a.fileId);
   if (a.parent) await requireInside(a.parent);
   if (a.previousParent) await requireInside(a.previousParent);
  }
  const fields = 'id,name,mimeType,size,parents,webViewLink,modifiedTime';
  const escape = value => value.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const file = 'files/' + encodeURIComponent(a.fileId || '');
  if (operation === 'list' || operation === 'search') {
   const q = operation === 'list' ? `'${escape(a.parent || root || 'root')}' in parents and trashed=false` : `name contains '${escape(a.query)}' and trashed=false`;
   const result = JSON.parse(await this.google.get('files',{q,fields:`nextPageToken,files(${fields})`,pageSize:'50',...(a.pageToken?{pageToken:a.pageToken}:{})}));
   if (root && operation === 'search') { const files = []; for (const candidate of result.files || []) if (await this.withinRoot(candidate.id, root)) files.push(candidate); result.files = files; }
   return result;
  }
  if (operation === 'get') return JSON.parse(await this.google.get(file,{fields}));
  if (operation === 'read') {
   const metadata=JSON.parse(await this.google.get(file,{fields:'name,mimeType,size'}));
   const exports={'application/vnd.google-apps.document':'text/plain','application/vnd.google-apps.spreadsheet':'text/csv','application/vnd.google-apps.presentation':'text/plain'};
   if(exports[metadata.mimeType]) return this.google.get(file+'/export',{mimeType:exports[metadata.mimeType]},32000);
   if(Number(metadata.size)>32000 || !/^(text\/|application\/(json|xml))/.test(metadata.mimeType)) throw new Error('仅读取不超过32KB的文本。');
   return this.google.get(file,{alt:'media'},32000);
  }
  if(!this.canWrite()) throw new Error('需要在管理台明确申请新的 Drive 写入授权。');
  const token=JSON.parse(this.google.vault.get('googleTokens') || '{}');
  if(!token.scopes?.includes('https://www.googleapis.com/auth/drive')) throw new Error('现有 Drive 授权为只读，请重新授权。');
  let method='PATCH',url=new URL('https://www.googleapis.com/drive/v3/'+file),body,headers={'content-type':'application/json'};
  if(operation==='trash') body=JSON.stringify({trashed:true});
  else if(operation==='move'){url.search=new URLSearchParams({addParents:a.parent,removeParents:a.previousParent});body='{}';}
  else if(operation==='update'){url=new URL('https://www.googleapis.com/upload/drive/v3/'+file+'?uploadType=media');headers={'content-type':'text/plain; charset=utf-8'};body=a.content;}
  else if(operation==='create'){
   method='POST';url=new URL('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
   const boundary='slyra_'+crypto.randomUUID();headers={'content-type':'multipart/related; boundary='+boundary};
   body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name:a.name,parents:[a.parent],mimeType:'text/plain'})}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${a.content}\r\n--${boundary}--`;
  } else throw new Error('不支持的 Drive 操作。');
  const accessToken = await this.google.accessToken();
  const currentToken = JSON.parse(this.google.vault.get('googleTokens') || '{}');
  if (!this.canWrite() || (this.google.settings?.().drive.rootFolderId || '') !== root || currentToken.clientId !== token.clientId || currentToken.refresh_token !== token.refresh_token || !currentToken.scopes?.includes('https://www.googleapis.com/auth/drive')) throw new Error('Drive 配置或授权已改变，请重新准备操作。');
  beforeWrite();
  const response=await this.google.fetcher(url,{method,body,headers:{...headers,authorization:'Bearer '+accessToken},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok){await response.body?.cancel();throw new Error('Drive 写入失败。');}
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>64000)throw new Error('Drive 响应过大。');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
}
