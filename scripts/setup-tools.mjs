import { mkdir, writeFile, readFile, readdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const base = new URL('../tools/', import.meta.url);
const specs = [
  { name: 'napcat', repo: 'NapNeko/NapCatQQ', pattern: /^NapCat\.Shell\.Windows\.Node\.zip$/ },
  { name: 'gh', repo: 'cli/cli', pattern: /^gh_.*_windows_amd64\.zip$/ },
  { name: 'rclone', repo: 'rclone/rclone', pattern: /^rclone-.*-windows-amd64\.zip$/ },
];
async function main() {
  await mkdir(base, { recursive: true });
  for (const spec of specs) {
    const destination = new URL(spec.name + '/', base);
    try { await readFile(new URL('.installed', destination)); console.log(`${spec.name} 已准备。`); continue; } catch {}
    const response = await fetch(`https://api.github.com/repos/${spec.repo}/releases/latest`, { headers: { 'user-agent': 'bupt-homework-bot-setup' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`无法取得 ${spec.name} 官方发布信息 HTTP ${response.status}`);
    const release = await response.json();
    const asset = release.assets.find(item => spec.pattern.test(item.name));
    if (!asset) throw new Error(`${spec.name} 无匹配的 Windows 发行包。`);
    console.log(`下载 ${spec.name} ${release.tag_name}（${Math.round(asset.size / 1024 / 1024)} MB）`);
    const archive = new URL(spec.name + '.zip', base);
    const download = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(300000) });
    if (!download.ok) throw new Error(`下载失败 HTTP ${download.status}`);
    const bytes = Buffer.from(await download.arrayBuffer());
    const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    if (!asset.digest || digest !== asset.digest) throw new Error(`${spec.name} 发布包缺少可验证的 SHA256 或校验不一致。`);
    await writeFile(archive, bytes);
    await mkdir(destination, { recursive: true });
    // 路径由脚本生成，不插入下载内容，不执行远端安装脚本。
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(fileURLToPath(archive))} -DestinationPath ${quote(fileURLToPath(destination))} -Force`], { windowsHide: true, timeout: 120000 });
    if (spec.name === 'rclone') {
      const entries = await readdir(destination, { withFileTypes: true });
      const nested = entries.find(item => item.isDirectory() && item.name.startsWith('rclone-'));
      if (nested) await copyFile(new URL(nested.name + '/rclone.exe', destination), new URL('rclone.exe', destination));
    }
    await writeFile(new URL('.installed', destination), JSON.stringify({ version: release.tag_name, digest, url: asset.browser_download_url }));
    console.log(`${spec.name} 准备完成。`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
