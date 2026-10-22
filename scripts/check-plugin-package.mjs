import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, realpath, access } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { PLUGIN_MODULES } from '../napcat-plugin/catalog.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await mkdir(join(root, 'data'), { recursive: true }); const folder = await mkdtemp(join(root, 'data/plugin-package-'));
try {
  const bundle = unzipSync(await readFile(join(root, `release/${pkg.version}/QQ-Agent-Plugins-${pkg.version}-win-x64.zip`)));
  for (const [name, bytes] of Object.entries(bundle)) {
    const target = resolve(folder, name); assert.ok(target.startsWith(folder + sep));
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
  }
  for (const plugin of PLUGIN_MODULES) {
    const files = unzipSync(await readFile(join(root, 'release', pkg.version, plugin.id + '.zip')));
    const meta = JSON.parse(Buffer.from(files['package.json']).toString()), deployment = JSON.parse(Buffer.from(files['deployment.json']).toString());
    assert.equal(meta.name, plugin.id); assert.equal(meta.version, pkg.version); assert.equal(deployment.projectRoot, undefined); assert.equal(deployment.nodeBinary, undefined);
    assert.ok(files['index.mjs']); assert.ok(files['native-config.mjs']); assert.ok(files['speech-config.mjs']);
    for (const name of ['index.html', 'app.js', 'style.css', 'copy.mjs', 'THIRD-PARTY.txt']) assert.ok(files['webui/' + name]);
    assert.ok(!Object.keys(files).some(name => name.startsWith('data/')));
  }
  const core = join(folder, 'napcat-plugin-qq-agent'), bootstrap = await import(pathToFileURL(join(core, 'bootstrap.mjs')));
  const deployed = await bootstrap.preparePortable(core);
  await access(join(deployed.projectRoot, 'src/main.mjs')); await access(deployed.nodeBinary);
  const marker = join(deployed.projectRoot, 'data/user-preservation-test.txt'); await writeFile(marker, 'keep this configuration');
  await writeFile(join(core, 'data/payload.sha256'), 'old payload'); await bootstrap.preparePortable(core);
  assert.equal(await readFile(marker, 'utf8'), 'keep this configuration');
  assert.ok(!deployed.projectRoot.includes('bupt-qq-homework-bot/src'));
  const report = { passed: true, plugins: PLUGIN_MODULES.length, portableDeployment: true, upgradePreservesData: true, noMachinePathsInDeployment: true, noQQOrModelRequests: true };
  await writeFile(join(root, 'release', pkg.version, 'plugin-audit.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  const actual = await realpath(folder), parent = await realpath(join(root, 'data')); if (!actual.startsWith(parent + sep)) throw new Error('Refusing cleanup outside test workspace');
  await rm(actual, { recursive: true, force: true });
}
