const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function boundedJSON(value) {
 let nodes = 0;
 function inspect(item, depth) {
  if (++nodes > 4000 || depth > 8) throw new Error('插件参数过深或过大。');
  if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
  if (!item || typeof item !== 'object' || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('插件参数必须是 JSON 数据。');
  for (const [key, child] of Object.entries(item)) { if (forbidden.has(key)) throw new Error('不允许的插件参数字段。'); inspect(child, depth + 1); }
 }
 inspect(value, 0);
 const encoded = JSON.stringify(value); if (Buffer.byteLength(encoded) > 32000) throw new Error('插件参数过大。');
 return JSON.parse(encoded);
}
function matches(value, schema, root, depth = 0) {
 if (depth > 24) return false;
 if (schema === true) return true;
 if (!schema || typeof schema !== 'object') return false;
 if (schema.$ref) {
  if (!schema.$ref.startsWith('#/')) return false;
  const resolved = schema.$ref.slice(2).split('/').reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
  if (!resolved || !matches(value, resolved, root, depth + 1)) return false;
 }
 if (schema.anyOf && !schema.anyOf.some(s => matches(value,s,root,depth+1))) return false;
 if (schema.oneOf && schema.oneOf.filter(s => matches(value,s,root,depth+1)).length !== 1) return false;
 if (schema.allOf && !schema.allOf.every(s => matches(value,s,root,depth+1))) return false;
 if (schema.not && matches(value,schema.not,root,depth+1)) return false;
 if (schema.enum && !schema.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) return false;
 if (Object.hasOwn(schema,'const') && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
 const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
 if (schema.type && !(Array.isArray(schema.type)?schema.type:[schema.type]).some(t => t === type || t === 'integer' && type === 'number' && Number.isSafeInteger(value))) return false;
 if (type === 'object' && (schema.properties || schema.required || Object.hasOwn(schema, 'additionalProperties'))) {
  if ((schema.required || []).some(key => !Object.hasOwn(value,key))) return false;
  if (Object.keys(value).length < (schema.minProperties ?? 0) || Object.keys(value).length > (schema.maxProperties ?? Infinity)) return false;
  for (const [key,child] of Object.entries(value)) {
   const property = schema.properties?.[key];
   if (property) { if (!matches(child,property,root,depth+1)) return false; }
   else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') { if (!matches(child,schema.additionalProperties,root,depth+1)) return false; }
   else return false;
  }
 }
 if (type === 'array') {
  if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return false;
  if (schema.uniqueItems && new Set(value.map(v=>JSON.stringify(v))).size !== value.length) return false;
  if (schema.items && !value.every(v=>matches(v,schema.items,root,depth+1))) return false;
 }
 if (type === 'string') {
  if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) return false;
  if (schema.pattern && !new RegExp(schema.pattern,'u').test(value)) return false;
 }
 if (type === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity) || value <= (schema.exclusiveMinimum ?? -Infinity) || value >= (schema.exclusiveMaximum ?? Infinity))) return false;
 return true;
}
/** Exposes only connector tools that passed the client's read-only discovery. */
export class NativeAgentTools {
 constructor({client, providers = ['github','google_drive']}) { this.client=client; this.providers=providers; this.tools=new Map(); }
 async prepare() {
  const rows=await this.client.readCatalog(this.providers);
  this.tools=new Map(rows.map(row=>['native.'+row.name,{...row,name:'native.'+row.name,originalName:row.name}]));
 }
 catalog() { return [...this.tools.values()].map(({name,inputSchema,description})=>({name,inputSchema:structuredClone(inputSchema),description,write:false})); }
 validate(name,args) {
  const tool=this.tools.get(name); if (!tool) throw new Error('未知或未授权的插件工具。');
  const clean=boundedJSON(args);
  if (!clean || Array.isArray(clean) || typeof clean!=='object' || !matches(clean,tool.inputSchema,tool.inputSchema)) throw new Error('插件参数不符合实际工具定义。');
  return clean;
 }
 async call(name,args,{beforeCall=()=>{}}={}) {
  const clean=this.validate(name,args), original=this.tools.get(name).originalName;
  await this.prepare();
  this.validate(name,clean);
  beforeCall();
  return this.client.call(original,clean,{beforeCall});
 }
}

