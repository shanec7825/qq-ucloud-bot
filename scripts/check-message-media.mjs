import { createCanvas } from '@napi-rs/canvas';
import { MessageMedia } from '../src/message-media.mjs';
import { askCodex } from '../src/codex-ai.mjs';
const canvas = createCanvas(900, 300); const ctx = canvas.getContext('2d');
ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 900, 300); ctx.fillStyle = 'black'; ctx.font = '90px Microsoft YaHei'; ctx.fillText('slyra', 100, 180);
const media = new MessageMedia({ call: () => { throw new Error('此测试不调用 QQ'); } }, async () => canvas.encode('png'));
const result = await media.prepare({ message: [{ type: 'image', data: { url: 'https://gchat.qpic.cn/test' } }] });
try {
  if (result.images.length !== 1) throw new Error('图片转换失败');
  const answer = await askCodex('只根据图片，读出图中的英文名字。不要添加其他文字。', { messageMedia: { images: result.images, notes: result.notes } });
  if (!answer.toLowerCase().includes('slyra')) throw new Error('实际模型回答未通过图中文字校验。');
  console.log('slyra 消息图片到订阅模型真实识别成功；没有向 QQ 发送测试消息。');
} finally { await result.cleanup(); }
