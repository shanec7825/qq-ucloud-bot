import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('.',import.meta.url));
const result = await build({entryPoints:[root+'src/main.jsx'],bundle:true,minify:true,format:'esm',target:['es2022'],metafile:true,legalComments:'eof',outfile:root+'../../napcat-plugin/webui/app.js'});
await promisify(execFile)(process.execPath,[root+'node_modules/tailwindcss/lib/cli.js','-c','tailwind.config.mjs','-i','src/style.css','-o','../../napcat-plugin/webui/style.css','--minify'],{cwd:root,windowsHide:true});
const packages = new Set(Object.keys(result.metafile.inputs).map(file => file.replaceAll('\\','/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean));
const notices = ['This settings page uses React, HeroUI, React Aria and Motion. The original NapCat WebUI is not modified.'];
for (const folder of [...packages].sort()) {
  const directory = resolve(root,folder), pkg = JSON.parse(await readFile(directory+'/package.json','utf8'));
  let license;
  for (const name of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','license.txt','License']) {
    try { license = await readFile(directory+'/'+name,'utf8'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!license) license = 'License declaration in package.json: '+pkg.license+'\nAuthor: '+JSON.stringify(pkg.author || pkg.contributors || '')+'\nSource: '+JSON.stringify(pkg.repository || pkg.homepage || '');
  notices.push(pkg.name+' '+pkg.version+'\n'+license);
}
await writeFile(root+'../../napcat-plugin/webui/THIRD-PARTY.txt',notices.join('\n\n---\n\n'));
console.log('已构建 NapCat 同版本 HeroUI 设置页。');
