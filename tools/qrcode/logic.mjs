/**
 * 二维码 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 生成：createQr(text, { level }) 基于 vendored qrcode-generator（MIT），
 *   自动选择最小可用版本（1–40），返回模块矩阵、版本号与模块数；
 *   超出容量返回中文错误「内容过长，当前纠错级别最多约 N 字节」。
 *   文本按 UTF-8 编码（支持中文 / emoji）。
 * 渲染：matrixToRgba(matrix, { margin, scale, foreground, background }) 把矩阵
 *   渲染为 RGBA 像素数组（测试与 fixture 生成用）；matrixToSvg 生成 SVG 字符串。
 * 识别：decodeRgba(data, width, height) 基于 vendored jsQR（Apache-2.0），
 *   输入 RGBA 像素数组，失败返回「未识别到二维码」。
 * 颜色：normalizeHexColor 规范化 hex 颜色；contrastRatio 按 WCAG 相对亮度
 *   计算对比度，低于 MIN_SCAN_CONTRAST（3:1）提示可能无法扫描。
 */

import { qrcode } from './vendor/qrcode-generator/qrcode.mjs';
import jsQR from './vendor/jsQR/jsQR.mjs';

/* ---------- 常量 ---------- */

/** 纠错级别选项（value 与 qrcode-generator / QR 规范一致） */
export const EC_LEVELS = [
  { value: 'L', label: 'L · 纠错约 7%' },
  { value: 'M', label: 'M · 纠错约 15%' },
  { value: 'Q', label: 'Q · 纠错约 25%' },
  { value: 'H', label: 'H · 纠错约 30%' },
];

export const DEFAULT_LEVEL = 'M';
export const DEFAULT_SIZE = 256; // px（128–1024）
export const DEFAULT_MARGIN = 4; // 模块（0–10）
export const MIN_SIZE = 128;
export const MAX_SIZE = 1024;
export const MIN_MARGIN = 0;
export const MAX_MARGIN = 10;

/** 识别对比度阈值（< 3:1 认为可能无法扫描） */
export const MIN_SCAN_CONTRAST = 3;

/**
 * 字节模式在版本 40（最大）各纠错级别下的数据容量（字节，ISO/IEC 18004），
 * 用于「内容过长」提示。实际容量随版本变化，此处取上限作约数。
 */
const MAX_DATA_BYTES = { L: 2953, M: 2331, Q: 1663, H: 1273 };

/** 空输入提示（与页面空态文案一致） */
export const EMPTY_HINT = '请输入要生成的内容';

/* ---------- UTF-8 ---------- */

const utf8Encoder = new TextEncoder();

/** 文本的 UTF-8 字节数 */
export function utf8ByteLength(text) {
  return utf8Encoder.encode(text).length;
}

// 让 vendored 编码器按 UTF-8 处理字符（其默认实现只取低 8 位，会丢中文）。
// qr8BitByte 在 addData 时调用 qrcode.stringToBytes，故只需在模块加载时设置一次。
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

/* ---------- 生成 ---------- */

/**
 * 生成二维码（字节模式，UTF-8，自动选最小版本）。
 *
 * @param {string} text 要编码的文本
 * @param {{ level?: 'L'|'M'|'Q'|'H' }} [options]
 * @returns {{ ok: true, matrix: boolean[][], version: number, moduleCount: number, byteLength: number }}
 *          | { ok: false, error: string }
 *   成功：matrix 为 moduleCount × moduleCount 的模块矩阵（true = 深色）；
 *         版本 1–40，moduleCount = 17 + 4 × version。
 *   失败：error 为中文提示（内容过长 / 空输入）。
 */
export function createQr(text, { level = DEFAULT_LEVEL } = {}) {
  if (typeof text !== 'string' || text === '') {
    return { ok: false, error: EMPTY_HINT };
  }
  const ec = MAX_DATA_BYTES[level] ? level : DEFAULT_LEVEL;

  let built = null;
  for (let version = 1; version <= 40; version += 1) {
    let candidate;
    try {
      candidate = qrcode(version, ec);
      candidate.addData(text, 'Byte');
      candidate.make();
    } catch (err) {
      // qrcode-generator 超容量时抛 'code length overflow. (…)'（字符串而非 Error）
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('overflow')) {
        return { ok: false, error: `二维码编码失败：${message}` };
      }
      continue; // 容量不足，尝试下一个更大的版本
    }
    built = { qr: candidate, version };
    break;
  }

  if (built === null) {
    return {
      ok: false,
      error: `内容过长，当前纠错级别最多约 ${MAX_DATA_BYTES[ec]} 字节（输入 ${utf8ByteLength(text)} 字节），可降低纠错级别或缩短内容`,
    };
  }

  const { qr, version } = built;
  const moduleCount = qr.getModuleCount();
  const matrix = [];
  for (let row = 0; row < moduleCount; row += 1) {
    const modules = new Array(moduleCount);
    for (let col = 0; col < moduleCount; col += 1) {
      modules[col] = qr.isDark(row, col);
    }
    matrix.push(modules);
  }
  return { ok: true, matrix, version, moduleCount, byteLength: utf8ByteLength(text) };
}

/* ---------- 颜色 ---------- */

/** 规范化 hex 颜色：接受 #rgb / #rrggbb（大小写不限），返回 #rrggbb；非法返回 null */
export function normalizeHexColor(hex) {
  if (typeof hex !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const digits = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${digits.toLowerCase()}`;
}

/** hex → [r, g, b]（0–255）；非法返回 null */
export function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (normalized === null) return null;
  const n = Number.parseInt(normalized.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG 相对亮度单通道线性化 */
function srgbLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度 */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(srgbLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度（1–21）；任一颜色非法返回 null */
export function contrastRatio(hex1, hex2) {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (rgb1 === null || rgb2 === null) return null;
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** 前景 / 背景对比度是否过低（可能无法扫描）；颜色非法时也提示 */
export function isLowContrast(foreground, background) {
  const ratio = contrastRatio(foreground, background);
  return ratio === null || ratio < MIN_SCAN_CONTRAST;
}

/* ---------- 渲染 ---------- */

/**
 * 把模块矩阵渲染为 RGBA 像素数组（每模块 scale 个像素，四周 margin 个模块的浅色边）。
 * 供单元测试（喂给 decodeRgba 做往返校验）与 fixture 生成脚本使用。
 *
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}
 */
export function matrixToRgba(matrix, { margin = DEFAULT_MARGIN, scale = 8, foreground = '#000000', background = '#ffffff' } = {}) {
  const fg = hexToRgb(foreground) ?? [0, 0, 0];
  const bg = hexToRgb(background) ?? [255, 255, 255];
  const moduleCount = matrix.length;
  const width = (moduleCount + margin * 2) * scale;
  const data = new Uint8ClampedArray(width * width * 4);

  for (let i = 0; i < width * width; i += 1) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!matrix[row][col]) continue;
      const x0 = (margin + col) * scale;
      const y0 = (margin + row) * scale;
      for (let y = y0; y < y0 + scale; y += 1) {
        for (let x = x0; x < x0 + scale; x += 1) {
          const i = (y * width + x) * 4;
          data[i] = fg[0];
          data[i + 1] = fg[1];
          data[i + 2] = fg[2];
        }
      }
    }
  }
  return { data, width, height: width };
}

/**
 * 把模块矩阵渲染为 SVG 字符串（下载 .svg 用）。
 * viewBox 以模块为单位；width / height 为导出像素尺寸（可选）。
 */
export function matrixToSvg(matrix, { margin = DEFAULT_MARGIN, foreground = '#000000', background = '#ffffff', size = null } = {}) {
  const moduleCount = matrix.length;
  const total = moduleCount + margin * 2;
  const fg = normalizeHexColor(foreground) ?? '#000000';
  const bg = normalizeHexColor(background) ?? '#ffffff';

  const parts = [];
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (matrix[row][col]) parts.push(`M${margin + col} ${margin + row}h1v1h-1z`);
    }
  }

  const dims = size === null ? '' : ` width="${size}" height="${size}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${dims} viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${bg}"/>` +
    (parts.length > 0 ? `<path d="${parts.join('')}" fill="${fg}"/>` : '') +
    `</svg>`
  );
}

/* ---------- 识别 ---------- */

/**
 * 从 RGBA 像素数组识别二维码。
 *
 * @param {Uint8ClampedArray|Uint8Array} data RGBA 像素（长度 = width × height × 4）
 * @param {number} width
 * @param {number} height
 * @returns {{ ok: true, text: string } | { ok: false, error: string }}
 */
export function decodeRgba(data, width, height) {
  if (!ArrayBuffer.isView(data) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { ok: false, error: '识别参数不正确' };
  }
  if (data.length < width * height * 4) {
    return { ok: false, error: '像素数据与尺寸不匹配' };
  }
  // attemptBoth：同时尝试正常与反色二维码（深底浅码）
  const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  if (result && typeof result.data === 'string' && result.data !== '') {
    return { ok: true, text: result.data };
  }
  return { ok: false, error: '未识别到二维码' };
}

/**
 * 识别结果是否应显示为链接（只影响展示，绝不自动打开）。
 * @param {string} text
 */
export function isLinkText(text) {
  return /^[a-z][a-z0-9+.-]*:/i.test(text.trim()) && !/\s/.test(text.trim());
}

/* ---------- 其他 ---------- */

/** 限制数值在 [min, max] 内并取整；NaN 用 fallback */
export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 结果元信息（生成区展示与复制用） */
export function formatMeta(result) {
  if (!result || result.ok !== true) return '';
  return `版本 ${result.version} · ${result.moduleCount} × ${result.moduleCount} 模块 · ${result.byteLength} 字节`;
}
