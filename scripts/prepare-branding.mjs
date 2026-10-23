import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = new URL('../', import.meta.url);
const source = await loadImage(await readFile(new URL('desktop/assets/qlyra-source.png', root)));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];
for (const size of [...sizes, 512]) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, size, size);
  const png = await canvas.encode('png');
  if (size === 512) await writeFile(new URL('desktop/assets/qlyra.png', root), png);
  else images.push(png);
}
const directory = Buffer.alloc(6 + images.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(images.length, 4);
let offset = directory.length;
for (const [index, png] of images.entries()) {
  const start = 6 + index * 16;
  directory[start] = directory[start + 1] = sizes[index] === 256 ? 0 : sizes[index];
  directory.writeUInt16LE(1, start + 4);
  directory.writeUInt16LE(32, start + 6);
  directory.writeUInt32LE(png.length, start + 8);
  directory.writeUInt32LE(offset, start + 12);
  offset += png.length;
}
await writeFile(new URL('desktop/assets/qlyra.ico', root), Buffer.concat([directory, ...images]));
for (const target of ['napcat-plugin/webui/qlyra.png', 'web/qlyra.png']) {
  await copyFile(new URL('desktop/assets/qlyra.png', root), new URL(target, root));
}
console.log('Qlyra PNG and Windows ICO prepared (16/24/32/48/64/128/256).');
