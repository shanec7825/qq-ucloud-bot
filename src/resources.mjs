import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const root = new URL('../', import.meta.url);

export class PrivateResources {
  constructor(env = process.env, runner = execute) { this.env = env; this.runner = runner; }
  async run(file, args, extraEnv = {}) {
    try {
      const { stdout } = await this.runner(file, args, { windowsHide: true, shell: false, encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, ...extraEnv } });
      return stdout;
    } catch { throw new Error('私人资源读取失败：请检查对应服务的登录、路径和权限，运行 npm run connect:drive 或 npm run connect:github。'); }
  }
  async drive(action, path) {
    if (path.includes(':') || path.startsWith('/') || path.startsWith('\\') || path.split(/[\\/]/).includes('..')) throw new Error('网盘路径应为 privateDrive 下的相对路径。');
    if (action === '读取' && (!path || !/\.(txt|md|csv|json|py|js|ts|html|xml|yaml|yml)$/i.test(path))) throw new Error('仅支持文本文件；Google Docs 导出为 .txt，表格导出为 .csv。PDF 和书籍请先使用目录查看。');
    const config = fileURLToPath(new URL('data/rclone.conf', root));
    const args = ['--config', config, '--drive-scope', 'drive.readonly', '--drive-export-formats', 'txt,csv,html'];
    const target = `privateDrive:${path}`;
    if (action === '列表') {
      const output = await this.run(this.env.RCLONE_BIN || fileURLToPath(new URL('tools/rclone/rclone.exe', root)), [...args, 'lsjson', target, '--max-depth', '1']);
      const rows = JSON.parse(output);
      return rows.slice(0, 100).map(row => `${row.IsDir ? '[目录]' : '[文件]'} ${row.Path}`).join('\n') || '目录为空。';
    }
    return (await this.run(this.env.RCLONE_BIN || fileURLToPath(new URL('tools/rclone/rclone.exe', root)), [...args, 'cat', target, '--head', '32000'])).slice(0, 20000);
  }
  async github(reference = '') {
    const binary = this.env.GH_BIN || fileURLToPath(new URL('tools/gh/bin/gh.exe', root));
    const environment = { GH_CONFIG_DIR: fileURLToPath(new URL('data/gh', root)), GH_HOST: 'github.com' };
    if (!reference.trim()) {
      const result = JSON.parse(await this.run(binary, ['api', '--hostname', 'github.com', '--method', 'GET', '/user/repos?per_page=50&sort=updated'], environment));
      return result.map(repo => `${repo.private ? '[私有]' : '[公开]'} ${repo.full_name}\n${repo.description || ''}`).join('\n\n');
    }
    const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\s+(.+))?$/.exec(reference.trim());
    if (!match) throw new Error('用法：/项目 owner/repo [文件路径]');
    const path = match[3] || 'README.md';
    if (path.split('/').some(part => part === '..' || part === '.')) throw new Error('不支持相对跳转路径。');
    const endpoint = `/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    const json = JSON.parse(await this.run(binary, ['api', '--hostname', 'github.com', '--method', 'GET', endpoint], environment));
    if (Array.isArray(json)) return json.slice(0, 100).map(file => `[${file.type}] ${file.path}`).join('\n');
    if (json.type !== 'file' || json.encoding !== 'base64') throw new Error('该资源不是可读取的小型文件。');
    const bytes = Buffer.from(json.content, 'base64');
    if (bytes.includes(0)) throw new Error('暂不支持二进制文件。');
    return `${json.path}\n${json.html_url}\n\n${bytes.toString('utf8').slice(0, 20000)}`;
  }
}
