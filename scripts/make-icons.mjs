#!/usr/bin/env node
/**
 * make-icons：生成 PWA 图标（assets/icons/，仓库内自制，无第三方依赖）。
 *
 * 图形：蓝色渐变圆角底 + 白色 2×2 圆角方格（「工具箱格子」），与站点主题色一致。
 * 直接以解析式抗锯齿（有符号距离场）光栅化，用 node 内置 zlib 输出 PNG。
 *
 * 用法：node scripts/make-icons.mjs [--out assets/icons]
 * 产物：icon-192.png、icon-512.png、icon-maskable-512.png（中心 60% 安全区）
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- PNG 编码（RGBA 8bit） ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
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

/** RGBA 像素（Uint8ClampedArray，长度 w*h*4）→ PNG Buffer */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型：RGBA
  // 每行前置过滤字节 0（None）
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, rowStart + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- 图形（有符号距离场抗锯齿） ---------------- */

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** 点到圆角矩形的带符号距离（负值在内部） */
function roundedRectSdf(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** 覆盖率：0.5 - 距离（像素单位）截断到 [0,1] */
const coverage = (sd) => clamp(0.5 - sd);

const GRADIENT_TOP = [93, 157, 255]; // --accent（深色主题）
const GRADIENT_BOTTOM = [45, 95, 231]; // --accent（浅色主题）
const WHITE = [255, 255, 255];

/**
 * 绘制图标。
 * @param {number} size 画布边长
 * @param {{ maskable?: boolean }} options maskable：全出血背景，图形收进中心 60% 安全区
 */
function drawIcon(size, { maskable = false } = {}) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const bgRadius = maskable ? 0 : size * 0.2; // 常规图标圆角底；maskable 全出血
  const cellSpan = maskable ? size * 0.26 : size * 0.21; // 单个格子边长
  const gap = cellSpan * 0.3; // 格子间距
  const cellRadius = cellSpan * 0.24;
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const i = (y * size + x) * 4;

      // 背景：垂直渐变的圆角（或全出血）矩形
      let bgAlpha = 1;
      if (bgRadius > 0) {
        bgAlpha = coverage(roundedRectSdf(px, py, cx, cy, size / 2, size / 2, bgRadius));
      }
      const t = y / size;
      let r = GRADIENT_TOP[0] + (GRADIENT_BOTTOM[0] - GRADIENT_TOP[0]) * t;
      let g = GRADIENT_TOP[1] + (GRADIENT_BOTTOM[1] - GRADIENT_TOP[1]) * t;
      let b = GRADIENT_TOP[2] + (GRADIENT_BOTTOM[2] - GRADIENT_TOP[2]) * t;

      // 白色 2×2 圆角格子
      let cellAlpha = 0;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cellCx = cx + (sx * (cellSpan + gap)) / 2;
        const cellCy = cy + (sy * (cellSpan + gap)) / 2;
        cellAlpha = Math.max(cellAlpha, coverage(roundedRectSdf(px, py, cellCx, cellCy, cellSpan / 2, cellSpan / 2, cellRadius)));
      }

      r = r + (WHITE[0] - r) * cellAlpha;
      g = g + (WHITE[1] - g) * cellAlpha;
      b = b + (WHITE[2] - b) * cellAlpha;
      const alpha = bgAlpha * 255;

      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = alpha;
    }
  }
  return rgba;
}

/* ---------------- 入口 ---------------- */

export function generateIcons({ outDir = path.join(REPO_ROOT, 'assets', 'icons') } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const targets = [
    { name: 'icon-192.png', size: 192 },
    { name: 'icon-512.png', size: 512 },
    { name: 'icon-maskable-512.png', size: 512, maskable: true },
  ];
  const written = [];
  for (const { name, size, maskable } of targets) {
    const file = path.join(outDir, name);
    fs.writeFileSync(file, encodePng(size, size, drawIcon(size, { maskable })));
    written.push(file);
  }
  return written;
}

function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const outDir = values.out ? path.resolve(values.out) : path.join(REPO_ROOT, 'assets', 'icons');
  for (const file of generateIcons({ outDir })) {
    console.log(`已生成 ${file}`);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
