import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, rm, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('.',import.meta.url));
const repo = resolve(root,'../..');
const nodePaths = [resolve(root,'node_modules')];
const run = promisify(execFile);

async function writeBundle(options) {
  const result = await build({ ...options, write: false });
  for (const file of result.outputFiles) {
    let previous;
    try { previous = await readFile(file.path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous?.equals(Buffer.from(file.contents))) continue;
    const temporary = file.path + '.' + process.pid + '.tmp';
    try { await writeFile(temporary, file.contents); await rename(temporary, file.path); }
    finally { await rm(temporary, { force: true }); }
  }
  return result;
}

// Shared theme tokens/components from ui/shared/theme.css plus the page's own styles, built by the same Tailwind CLI.
async function pageCss(entry,output,imports=[]) {
  const shared = await readFile(resolve(root,'../shared/theme.css'),'utf8');
  const page = await readFile(resolve(root,entry),'utf8');
  const input = resolve(root,'.build-'+output.replaceAll(/[\\/]/g,'-')+'.css');
  const imported=await Promise.all(imports.map(path=>readFile(resolve(root,path),'utf8')));
  await writeFile(input,['@tailwind base;','@tailwind components;','@tailwind utilities;',shared,page,...imported].join('\n\n'));
  try {
    await run(process.execPath,[resolve(root,'node_modules/tailwindcss/lib/cli.js'),'-c','tailwind.config.mjs','-i',input,'-o',resolve(repo,output),'--minify'],{cwd:root,windowsHide:true});
  } finally { await rm(input,{force:true}); }
}

async function notices(metafile,header) {
  const packages = new Set(Object.keys(metafile.inputs).map(file => file.replaceAll('\\','/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean));
  const notices = [header];
  for (const folder of [...packages].sort()) {
    const directory = resolve(root,folder), pkg = JSON.parse(await readFile(directory+'/package.json','utf8'));
    let license;
    for (const name of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','license.txt','License']) {
      try { license = await readFile(directory+'/'+name,'utf8'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!license) license = 'License declaration in package.json: '+pkg.license+'\nAuthor: '+JSON.stringify(pkg.author || pkg.contributors || '')+'\nSource: '+JSON.stringify(pkg.repository || pkg.homepage || '');
    notices.push(pkg.name+' '+pkg.version+'\n'+license);
  }
  return notices.join('\n\n---\n\n');
}

// NapCat settings page (unchanged products under napcat-plugin/webui/).
const result = await writeBundle({entryPoints:[root+'src/main.jsx'],bundle:true,minify:true,format:'esm',target:['es2022'],metafile:true,legalComments:'eof',nodePaths,absWorkingDir:root,outfile:repo+'/napcat-plugin/webui/app.js'});
const importedCss=Object.keys(result.metafile.outputs).filter(path=>path.endsWith('.css'));
await pageCss('src/style.css','napcat-plugin/webui/style.css',importedCss);
for(const path of importedCss)await rm(resolve(root,path),{force:true});
await writeFile(repo+'/napcat-plugin/webui/THIRD-PARTY.txt',await notices(result.metafile,'This settings page uses React, HeroUI, React Aria and Motion. The original NapCat WebUI is not modified.'));
await build({entryPoints:[root+'src/host-navigation.js'],bundle:true,minify:true,format:'iife',target:['es2022'],outfile:repo+'/napcat-plugin/webui/shell-navigation.js'});

// Desktop setup wizard: a classic (non-module) script so home.html exposes renderStatus immediately, even over file://.
const desktop = await writeBundle({entryPoints:[root+'../desktop/src/main.jsx'],bundle:true,minify:true,format:'iife',target:['es2022'],metafile:true,legalComments:'eof',nodePaths,absWorkingDir:root,outfile:repo+'/desktop/assets/app.js'});
await pageCss('../desktop/src/style.css','desktop/assets/style.css');
await writeFile(repo+'/desktop/assets/THIRD-PARTY.txt',await notices(desktop.metafile,'The setup wizard uses React. The original NapCat WebUI and its assets are not modified.'));
console.log('已构建 NapCat 同版本 HeroUI 设置页与桌面启动向导。');
