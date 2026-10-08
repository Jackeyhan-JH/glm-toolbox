/**
 * 生成 e2e 测试用的 fixture 图片（node tools/qrcode/fixtures/generate.mjs 重新生成）。
 *
 * 图片由本工具自己的编码逻辑（../logic.mjs + vendored qrcode-generator）产出，
 * 保证 fixture 内容与页面生成行为一致：
 *   hello.png  「hello 码工具箱」的二维码（纠错 M、边距 4 模块、每模块 4px）
 *   url.png    「https://example.com/glm-toolbox」的二维码（同上）
 *   plain.png  纯色 PNG（不含二维码，用于「未识别到二维码」用例）
 *
 * PNG 用 node:zlib 手写编码：RGB、位深 8、逐行 filter 0 —— 无需任何依赖，
 * logic.test.mjs 也按此格式解码校验。
 */

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createQr, matrixToRgba } from '../logic.mjs';

/* ---------------- PNG 编码（RGB、filter 0） ---------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

/** RGBA 像素 → PNG（丢弃 alpha，输出 RGB） */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // 颜色类型 RGB
  const stride = width * 3 + 1; // 每行前置 filter 字节 0
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = y * stride + 1 + x * 3;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG 签名
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 生成 fixture ---------------- */

function writeQrFixture(name, text) {
  const created = createQr(text, { level: 'M' });
  if (created.ok !== true) throw new Error(`生成 ${name} 失败：${created.error}`);
  const { data, width, height } = matrixToRgba(created.matrix, { margin: 4, scale: 4 });
  writeFileSync(new URL(`./${name}`, import.meta.url), encodePng(data, width, height));
  console.log(`${name}: ${text}（版本 ${created.version}，${width} × ${height}px，${created.byteLength} 字节）`);
}

writeQrFixture('hello.png', 'hello 码工具箱');
writeQrFixture('url.png', 'https://example.com/glm-toolbox');

// 纯色 PNG：不含任何二维码
{
  const size = 96;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    rgba[i * 4] = 0xf5;
    rgba[i * 4 + 1] = 0xf6;
    rgba[i * 4 + 2] = 0xf8;
    rgba[i * 4 + 3] = 255;
  }
  writeFileSync(new URL('./plain.png', import.meta.url), encodePng(rgba, size, size));
  console.log(`plain.png: 纯色 ${size} × ${size}px（无二维码）`);
}
