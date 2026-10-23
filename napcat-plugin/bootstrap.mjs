import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AdminBridge } from './bridge.mjs';

const exec = promisify(execFile), pending = new Map();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function portablePaths(folder) {
  const core = join(dirname(folder), 'napcat-plugin-qq-agent');
  return { core, projectRoot: join(core, 'data/workspace'), nodeBinary: join(core, 'data/runtime/node.exe') };
}
export async function preparePortable(folder) {
  const paths = portablePaths(folder);
  if (pending.has(paths.core)) return pending.get(paths.core);
  const work = (async () => {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('此独立插件包适用于 Windows x64；其他系统请使用源码部署。');
    const { core, projectRoot, nodeBinary } = paths, meta = JSON.parse(await readFile(join(core, 'distribution.json'), 'utf8'));
    const archive = join(core, 'backend.zip'), bytes = await readFile(archive), binary = await readFile(join(core, 'runtime/node.exe'));
    if (digest(bytes) !== meta.backendSHA256 || digest(binary) !== meta.nodeSHA256) throw new Error('插件运行资源校验失败，请重新下载官方发行包。');
    await mkdir(join(core, 'data/runtime'), { recursive: true });
    let runtimeHash; try { runtimeHash = digest(await readFile(nodeBinary)); } catch {}
    if (runtimeHash !== meta.nodeSHA256) await copyFile(join(core, 'runtime/node.exe'), nodeBinary);
    let deployed; try { deployed = (await readFile(join(core, 'data/payload.sha256'), 'utf8')).trim(); } catch {}
    if (deployed !== meta.backendSHA256) {
      const bridge = new AdminBridge(projectRoot);
      let running;
      try { running = await bridge.request('GET', 'state'); } catch {}
      if (running?.status === 200) {
        if (running.data.status.pendingMessages) throw new Error('机器人正在处理消息，请稍后重新启用插件以完成升级。');
        await bridge.request('POST', 'runtime/stop', {});
      }
      await mkdir(projectRoot, { recursive: true });
      const q = value => "'" + value.replaceAll("'", "''") + "'";
      // Use the framework ZIP reader; PowerShell's optional Archive module may be absent.
      const extraction = [
        "$ErrorActionPreference='Stop'",
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        `$destinationRoot=[IO.Path]::GetFullPath(${q(projectRoot)}).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar`,
        `$archiveReader=[IO.Compression.ZipFile]::OpenRead(${q(archive)})`,
        'try { foreach($entry in $archiveReader.Entries) {',
        '  $entryName=$entry.FullName.Replace([char]92,[char]47)',
        "  if($entryName -match '(?:^|/)[.]{1,2}(?:/|$)|(?:^|/)[^/]*[. ](?:/|$)|[:\\x00-\\x1f]') { throw 'Archive path is not a safe relative Windows path.' }",
        "  if($entryName -match '^(?:data|tools|\\.git)/|(?:^|/)\\.env(?:[./]|$)') { throw 'Archive contains personal-data paths.' }",
        '  $targetFile=[IO.Path]::GetFullPath([IO.Path]::Combine($destinationRoot,$entryName))',
        "  if(-not $targetFile.StartsWith($destinationRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes destination.' }",
        '  $checkPath=$targetFile',
        '  while($checkPath -and $checkPath.Length -ge ($destinationRoot.Length-1)) {',
        "    if(([IO.File]::Exists($checkPath) -or [IO.Directory]::Exists($checkPath)) -and (([IO.File]::GetAttributes($checkPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Archive destination contains a reparse point.' }",
        '    $checkPath=[IO.Path]::GetDirectoryName($checkPath)',
        '  }',
        "  if($entryName.EndsWith('/')) { [IO.Directory]::CreateDirectory($targetFile) | Out-Null; continue }",
        '  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($targetFile)) | Out-Null',
        '  $inputStream=$entry.Open(); $outputStream=$null',
        '  try { $outputStream=[IO.File]::Open($targetFile,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None); $inputStream.CopyTo($outputStream) }',
        '  finally { if($outputStream) { $outputStream.Dispose() }; $inputStream.Dispose() }',
        '} } finally { $archiveReader.Dispose() }',
      ].join('\n');
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', extraction], { windowsHide: true, timeout: 120000 });
      await mkdir(join(projectRoot, 'data'), { recursive: true });
      await writeFile(join(projectRoot, 'data/napcat-ui.json'), JSON.stringify({ origin: 'http://127.0.0.1:6099', managedModules: true }));
      await writeFile(join(core, 'data/payload.sha256'), meta.backendSHA256);
    }
    return paths;
  })();
  pending.set(paths.core, work);
  try { return await work; } finally { pending.delete(paths.core); }
}
