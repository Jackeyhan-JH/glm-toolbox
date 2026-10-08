/** 二维码单元测试（对应 issue #21「验收标准」中的非 🖥 条目） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import {
  EMPTY_HINT,
  MAX_SIZE,
  MIN_SIZE,
  clampInt,
  contrastRatio,
  createQr,
  decodeRgba,
  formatMeta,
  hexToRgb,
  isLinkText,
  isLowContrast,
  matrixToRgba,
  matrixToSvg,
  normalizeHexColor,
  utf8ByteLength,
} from './logic.mjs';

const SITE_URL = 'https://jackeyhan-jh.github.io/glm-toolbox/';

/** 编码 → 渲染成像素 → 识别解码，返回解码结果 */
function roundtrip(text, { level = 'M', scale = 4, margin = 4 } = {}) {
  const created = createQr(text, { level });
  assert.equal(created.ok, true, `createQr 失败：${created.error ?? ''}`);
  const { data, width, height } = matrixToRgba(created.matrix, { scale, margin });
  return { created, decoded: decodeRgba(data, width, height) };
}

/* ==================== 生成：编码 → 解码往返 ==================== */

test('编码 https://jackeyhan-jh.github.io/glm-toolbox/（纠错 M）→ 模块矩阵 → 渲染像素 → 解码得原文', () => {
  const { created, decoded } = roundtrip(SITE_URL, { level: 'M' });
  assert.equal(created.ok, true);
  assert.equal(decoded.ok, true, decoded.error);
  assert.equal(decoded.text, SITE_URL);
});

test('编码 → 解码往返：URL 在纠错 L 与 H 下都还原为原文（M 见首个用例）', () => {
  for (const level of ['L', 'H']) {
    const { decoded } = roundtrip(SITE_URL, { level });
    assert.equal(decoded.ok, true, `级别 ${level}：${decoded.error}`);
    assert.equal(decoded.text, SITE_URL, `级别 ${level} 解码不符`);
  }
});

test('「码工具箱 ✓ 2026 😀」生成 → 解码往返一致（UTF-8，含 emoji）', () => {
  const text = '码工具箱 ✓ 2026 😀';
  const { created, decoded } = roundtrip(text);
  assert.equal(created.byteLength, utf8ByteLength(text)); // 12 + 1 + 1 + 1 + 1 + 1 + 4 = 21 字节
  assert.equal(decoded.ok, true, decoded.error);
  assert.equal(decoded.text, text);
});

test('不同边距与缩放的渲染都能解码（margin 0 / 4 / 10，scale 2 / 4）', () => {
  const cases = [
    { margin: 0, scale: 4 },
    { margin: 4, scale: 2 },
    { margin: 10, scale: 4 },
  ];
  for (const { margin, scale } of cases) {
    const text = `码工具箱 m${margin}s${scale}`;
    const { decoded } = roundtrip(text, { margin, scale });
    assert.equal(decoded.ok, true, `margin=${margin} scale=${scale}：${decoded.error}`);
    assert.equal(decoded.text, text);
  }
});

test('自定义前景 / 背景色（深蓝底浅黄码、反色）也能解码', () => {
  for (const [fg, bg] of [
    ['#123c8c', '#ffefc2'],
    ['#ffffff', '#111111'], // 反色（浅码深底）
  ]) {
    const created = createQr('自定义颜色 ' + fg);
    const { data, width, height } = matrixToRgba(created.matrix, { foreground: fg, background: bg });
    const decoded = decodeRgba(data, width, height);
    assert.equal(decoded.ok, true, `${fg}/${bg}：${decoded.error}`);
    assert.equal(decoded.text, '自定义颜色 ' + fg);
  }
});

/* ==================== 版本与容量 ==================== */

test('同一文本：纠错 H 的版本号 ≥ 纠错 L 的版本号', () => {
  for (const text of [SITE_URL, 'A'.repeat(100), '码工具箱'.repeat(20)]) {
    const atL = createQr(text, { level: 'L' });
    const atH = createQr(text, { level: 'H' });
    assert.equal(atL.ok, true);
    assert.equal(atH.ok, true);
    assert.ok(atH.version >= atL.version, `H(${atH.version}) 应 ≥ L(${atL.version})：${text.slice(0, 20)}…`);
  }
});

test('「A」在 L 级别为版本 1（21 × 21 模块）', () => {
  const r = createQr('A', { level: 'L' });
  assert.equal(r.ok, true);
  assert.equal(r.version, 1);
  assert.equal(r.moduleCount, 21);
  assert.equal(r.matrix.length, 21);
  assert.equal(r.matrix[0].length, 21);
  assert.equal(r.byteLength, 1);
});

test('moduleCount = 17 + 4 × version（多个长度的输入）', () => {
  for (const n of [1, 10, 100, 500, 1000]) {
    const r = createQr('x'.repeat(n), { level: 'M' });
    assert.equal(r.ok, true);
    assert.equal(r.moduleCount, 17 + 4 * r.version);
  }
});

test('3000 个「码」（9000 字节）在 H 级别 → 返回「内容过长」错误', () => {
  const text = '码'.repeat(3000);
  assert.equal(utf8ByteLength(text), 9000);
  const r = createQr(text, { level: 'H' });
  assert.equal(r.ok, false);
  assert.match(r.error, /内容过长/);
  assert.match(r.error, /1273/); // 版本 40 · H 的字节模式容量上限
  assert.match(r.error, /9000/);
});

test('接近上限的内容仍可编码：980 个「码」（2940 字节）在 L 级别成功（版本 40）', () => {
  const r = createQr('码'.repeat(980), { level: 'L' });
  assert.equal(utf8ByteLength('码'.repeat(980)), 2940);
  assert.equal(r.ok, true);
  assert.equal(r.version, 40); // 版本 39 · L 容量约 2884 字节 < 2940
  assert.equal(r.moduleCount, 177);
});

test('空文本 / 非字符串 → 返回「请输入要生成的内容」', () => {
  assert.deepEqual(createQr(''), { ok: false, error: EMPTY_HINT });
  assert.deepEqual(createQr(undefined), { ok: false, error: EMPTY_HINT });
});

/* ==================== 渲染：像素与 SVG ==================== */

test('matrixToRgba：尺寸、alpha 与模块像素正确（margin 0、scale 1）', () => {
  const { matrix } = createQr('A', { level: 'L' }); // 版本 1
  const { data, width, height } = matrixToRgba(matrix, { margin: 0, scale: 1, foreground: '#000000', background: '#ffffff' });
  assert.equal(width, 21);
  assert.equal(height, 21);
  assert.equal(data.length, 21 * 21 * 4);

  const px = (x, y) => [data[(y * 21 + x) * 4], data[(y * 21 + x) * 4 + 1], data[(y * 21 + x) * 4 + 2]];
  // 版本 1 左上定位图形：外圈深色、内一圈浅色、中心 3×3 深色
  assert.deepEqual(px(0, 0), [0, 0, 0]); // 深色
  assert.deepEqual(px(1, 1), [255, 255, 255]); // 浅色
  assert.deepEqual(px(3, 3), [0, 0, 0]); // 中心深色
  // alpha 全不透明
  assert.equal(data[3], 255);
  assert.equal(data[21 * 21 * 4 - 1], 255);
});

test('matrixToSvg：以 <svg 开头、含 viewBox 与模块数、含前景 / 背景色', () => {
  const margin = 4;
  const created = createQr('svg 码');
  const total = created.moduleCount + margin * 2;
  const svg = matrixToSvg(created.matrix, { margin, foreground: '#123456', background: '#fedcba', size: 256 });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes(`viewBox="0 0 ${total} ${total}"`));
  assert.ok(svg.includes('width="256"'));
  assert.ok(svg.includes('height="256"'));
  assert.ok(svg.includes('fill="#fedcba"')); // 背景 rect
  assert.ok(svg.includes('fill="#123456"')); // 前景 path
  assert.ok(svg.endsWith('</svg>'));
  // path 模块数与矩阵深色模块数一致
  const darkCount = created.matrix.flat().filter(Boolean).length;
  const pathMoves = svg.match(/M\d+ \d+h1v1h-1z/g);
  assert.equal(pathMoves.length, darkCount);
});

test('matrixToSvg 不传 size 时 <svg> 开标签不含 width/height（只有 viewBox）', () => {
  const { matrix } = createQr('A');
  const svg = matrixToSvg(matrix, { margin: 2 });
  const openTag = svg.slice(0, svg.indexOf('>') + 1);
  assert.ok(openTag.startsWith('<svg'));
  assert.ok(openTag.includes('viewBox'));
  assert.ok(!openTag.includes('width='));
  assert.ok(!openTag.includes('height='));
});

/* ==================== 识别失败与参数 ==================== */

test('纯色 / 无二维码的像素 → 「未识别到二维码」', () => {
  const size = 64;
  const data = new Uint8ClampedArray(size * size * 4).fill(240); // 浅灰
  const r = decodeRgba(data, size, size);
  assert.equal(r.ok, false);
  assert.equal(r.error, '未识别到二维码');
});

test('decodeRgba 参数不正确：非像素数组 / 尺寸不匹配 → 中文错误', () => {
  assert.equal(decodeRgba(null, 10, 10).error, '识别参数不正确');
  assert.equal(decodeRgba(new Uint8ClampedArray(4), 0, 0).error, '识别参数不正确');
  assert.equal(decodeRgba(new Uint8ClampedArray(100), 10, 10).error, '像素数据与尺寸不匹配');
});

/* ==================== 颜色与对比度 ==================== */

test('对比度：#eeeeee / #ffffff ≈ 1.16（< 3:1 判定过低），#000000 / #ffffff = 21', () => {
  const low = contrastRatio('#eeeeee', '#ffffff');
  assert.ok(Math.abs(low - 1.16) < 0.01, `实际 ${low}`);
  assert.equal(isLowContrast('#eeeeee', '#ffffff'), true);
  assert.equal(isLowContrast('#000000', '#ffffff'), false);
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  // 顺序无关
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
});

test('normalizeHexColor / hexToRgb：#abc → #aabbcc，非法输入返回 null', () => {
  assert.equal(normalizeHexColor('#abc'), '#aabbcc');
  assert.equal(normalizeHexColor('#AABBCC'), '#aabbcc');
  assert.equal(normalizeHexColor('aabbcc'), '#aabbcc');
  assert.equal(normalizeHexColor('#12345'), null);
  assert.equal(normalizeHexColor('#gggggg'), null);
  assert.deepEqual(hexToRgb('#abc'), [0xaa, 0xbb, 0xcc]);
  assert.equal(hexToRgb('nope'), null);
});

test('isLinkText：http(s) / mailto 判定为链接，普通文本不是', () => {
  assert.equal(isLinkText('https://example.com/a?b=1'), true);
  assert.equal(isLinkText('HTTP://EXAMPLE.COM'), true);
  assert.equal(isLinkText('mailto:a@b.c'), true);
  assert.equal(isLinkText('hello 码工具箱'), false);
  assert.equal(isLinkText('https://example.com/a b'), false); // 含空格不作链接
});

/* ==================== 杂项 ==================== */

test('clampInt：尺寸 / 边距取值范围与取整', () => {
  assert.equal(clampInt(256, MIN_SIZE, MAX_SIZE, 256), 256);
  assert.equal(clampInt(50, MIN_SIZE, MAX_SIZE, 256), MIN_SIZE);
  assert.equal(clampInt(9999, MIN_SIZE, MAX_SIZE, 256), MAX_SIZE);
  assert.equal(clampInt('300.6', 0, 10, 4), 10); // 数值字符串四舍五入 301 → 钳到上限
  assert.equal(clampInt(NaN, 0, 10, 4), 4);
});

test('formatMeta：版本、模块数与字节数', () => {
  assert.equal(formatMeta(createQr('A', { level: 'L' })), '版本 1 · 21 × 21 模块 · 1 字节');
  assert.equal(formatMeta({ ok: false, error: 'x' }), '');
});

/* ==================== fixtures 往返（node 内解码 PNG） ==================== */

/**
 * 解码本工具 fixtures/ 下由 generate.mjs 生成的 PNG（RGB、逐行 filter 0），
 * 转成 RGBA 后交给 decodeRgba，验证 fixture 与识别逻辑端到端可用。
 */
async function decodeFixturePng(name) {
  const bytes = new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
  assert.equal(bytes[0], 0x89, 'PNG 签名');
  assert.equal(bytes[1], 0x50);
  assert.equal(bytes[2], 0x4e);
  assert.equal(bytes[3], 0x47);

  // IHDR：宽、高、位深 8、颜色类型 2（RGB）
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  assert.equal(bytes[24], 8);
  assert.equal(bytes[25], 2);

  // 拼接所有 IDAT 后 inflate；每行前置 filter 字节 0
  const idat = [];
  let pos = 8;
  while (pos < bytes.length) {
    const len = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    if (type === 'IDAT') idat.push(bytes.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const stride = width * 3;
  for (let y = 0; y < height; y += 1) {
    assert.equal(raw[y * (stride + 1)], 0, 'fixture PNG 应使用 filter 0');
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < width; x += 1) {
      rgba[(y * width + x) * 4] = row[x * 3];
      rgba[(y * width + x) * 4 + 1] = row[x * 3 + 1];
      rgba[(y * width + x) * 4 + 2] = row[x * 3 + 2];
      rgba[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { rgba, width, height };
}

test('fixture hello.png（内容 hello 码工具箱）解码得原文', async () => {
  const { rgba, width, height } = await decodeFixturePng('hello.png');
  const r = decodeRgba(rgba, width, height);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.text, 'hello 码工具箱');
});

test('fixture url.png 解码得其中的 URL', async () => {
  const { rgba, width, height } = await decodeFixturePng('url.png');
  const r = decodeRgba(rgba, width, height);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.text, 'https://example.com/glm-toolbox');
});

test('fixture plain.png（纯色，无二维码）→ 未识别到二维码', async () => {
  const { rgba, width, height } = await decodeFixturePng('plain.png');
  const r = decodeRgba(rgba, width, height);
  assert.equal(r.ok, false);
  assert.equal(r.error, '未识别到二维码');
});
