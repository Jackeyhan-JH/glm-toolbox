/** Base64 纯逻辑的单元测试（node --test 自动发现），覆盖 issue #7 验收标准中的输入 → 输出示例 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_FILE_BYTES,
  bytesToBase64,
  checkFileSize,
  decodeBytes,
  decodeText,
  detectImageMime,
  encodeText,
  formatFileSize,
  hexPreview,
  mimeToExtension,
  parseDataUrl,
  toDataUrl,
  truncateForDisplay,
  utf8ByteLength,
} from './logic.mjs';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/* ==================== 编码 ==================== */

test('编码：码工具箱 → 56CB5bel5YW3566x', () => {
  assert.equal(encodeText('码工具箱'), '56CB5bel5YW3566x');
});

test('编码：Hi 码 → SGkg56CB', () => {
  assert.equal(encodeText('Hi 码'), 'SGkg56CB');
});

test('编码：hello?>~ → aGVsbG8/Pn4=', () => {
  assert.equal(encodeText('hello?>~'), 'aGVsbG8/Pn4=');
});

test('编码：URL 安全 → + 变 -、/ 变 _、去掉填充（aGVsbG8_Pn4）', () => {
  assert.equal(encodeText('hello?>~', { urlSafe: true }), 'aGVsbG8_Pn4');
  // 含 + 的向量：Pz8+Pw== → Pz8-Pw
  assert.equal(encodeText('??>?', { urlSafe: true }), 'Pz8-Pw');
});

test('编码：空输入 → 空输出', () => {
  assert.equal(encodeText(''), '');
});

test('编码：大文本与 Node Buffer 结果一致（5MB）', () => {
  const text = '码a'.repeat(1024 * 1024) + 'xyz'; // 2MB*2.5 = 5MB
  assert.equal(encodeText(text), Buffer.from(text, 'utf8').toString('base64'));
});

test('bytesToBase64：大 buffer 分块与 Buffer 一致，且与 0x8000 边界对齐', () => {
  for (const size of [0, 1, 0x7fff, 0x8000, 0x8001, 0x10000, 300_000]) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'), `size=${size}`);
  }
});

/* ==================== 解码 ==================== */

test('解码：aGVsbG8（缺填充）→ hello', () => {
  const r = decodeText('aGVsbG8');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'hello');
});

test('解码：aGVs\\nbG8=（含换行）→ hello', () => {
  const r = decodeText('aGVs\nbG8=');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'hello');
});

test('解码：aGVsbG8_Pn4（URL 安全字母表）→ hello?>~', () => {
  const r = decodeText('aGVsbG8_Pn4');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'hello?>~');
});

test('解码：容忍空白、缺失与多余的填充', () => {
  assert.equal(decodeText('aGVsbG8=').text, 'hello');
  assert.equal(decodeText('aGVsbG8==').text, 'hello');
  assert.equal(decodeText(' aGVs\tbG8 \n').text, 'hello');
  assert.deepEqual([...decodeBytes('  YWJj\nZ A=')], [...Buffer.from('abcd')]);
});

test('解码：abc$ → 包含非法字符「$」（第 4 个字符）', () => {
  assert.throws(() => decodeBytes('abc$'), { message: '包含非法字符「$」（第 4 个字符）' });
  const r = decodeText('abc$');
  assert.equal(r.ok, false);
  assert.equal(r.error, '包含非法字符「$」（第 4 个字符）');
});

test('解码：非法字符位置按原始输入计（空白不计入）', () => {
  assert.throws(() => decodeBytes('ab\n c$'), { message: '包含非法字符「$」（第 6 个字符）' });
});

test('解码：= 后再出现有效字符 → 报 = 非法并指明位置', () => {
  assert.throws(() => decodeBytes('ab=cd'), { message: '包含非法字符「=」（第 3 个字符）：填充后不能还有其他字符' });
});

test('解码：长度非法 a → 中文错误提示（Base64 长度不正确）', () => {
  assert.throws(() => decodeBytes('a'), /Base64 长度不正确/);
  const r = decodeText('a');
  assert.equal(r.ok, false);
  assert.match(r.error, /Base64 长度不正确/);
});

test('解码：/w==（字节 0xFF）→ 不是有效 UTF-8，十六进制预览为 ff', () => {
  const r = decodeText('/w==');
  assert.equal(r.ok, false);
  assert.equal(r.error, '解码结果不是有效的 UTF-8 文本');
  assert.ok(r.bytes instanceof Uint8Array);
  assert.deepEqual([...r.bytes], [0xff]);
  assert.equal(hexPreview(r.bytes).hex, 'ff');
  assert.equal(hexPreview(r.bytes).truncated, false);
});

test('解码：空输入 / 纯空白 → 空输出，不报错', () => {
  assert.equal(encodeText(''), '');
  const empty = decodeText('');
  assert.equal(empty.ok, true);
  assert.equal(empty.text, '');
  assert.equal(empty.bytes.length, 0);
  const blank = decodeText(' \n\t ');
  assert.equal(blank.ok, true);
  assert.equal(blank.text, '');
});

test('解码：中文与 emoji 往返', () => {
  for (const text of ['码工具箱', 'Hi 码', '😀 家庭 👨‍👩‍👧', '混合 mixed 换行\n第二行']) {
    assert.equal(decodeText(encodeText(text)).text, text, JSON.stringify(text));
    assert.equal(decodeText(encodeText(text, { urlSafe: true })).text, text);
  }
});

test('解码：URL 安全字母表与标准字母表解出相同字节', () => {
  const std = encodeText('hello?>~'); // 含 /
  assert.equal(std.includes('/'), true);
  const safe = encodeText('hello?>~', { urlSafe: true });
  assert.deepEqual([...decodeBytes(std)], [...decodeBytes(safe)]);
});

/* ==================== data URL / MIME ==================== */

test('parseDataUrl：识别 data URL 并取出 MIME 与数据', () => {
  assert.deepEqual(parseDataUrl('data:image/png;base64,iVBORw0KGgo='), {
    mime: 'image/png',
    base64: 'iVBORw0KGgo=',
  });
  // 数据部分含空白也能解析（解码容忍）
  assert.deepEqual(parseDataUrl('data:image/png;base64,iVBO\nRw0K'), {
    mime: 'image/png',
    base64: 'iVBO\nRw0K',
  });
  // 空 MIME 回退到 application/octet-stream
  assert.equal(parseDataUrl('data:;base64,aGVsbG8=').mime, 'application/octet-stream');
});

test('parseDataUrl：非 data URL 或非 base64 形式返回 null', () => {
  assert.equal(parseDataUrl('aGVsbG8/Pn4='), null);
  assert.equal(parseDataUrl('https://example.com/a.png'), null);
  assert.equal(parseDataUrl('data:text/plain,hello'), null);
  assert.equal(parseDataUrl(''), null);
});

test('toDataUrl：拼接 data URL', () => {
  assert.equal(toDataUrl('image/png', 'aGVs'), 'data:image/png;base64,aGVs');
});

test('detectImageMime：按魔数识别图片类型（含 fixtures/pixel.png）', () => {
  const png = fs.readFileSync(path.join(FIXTURES_DIR, 'pixel.png'));
  assert.equal(detectImageMime(new Uint8Array(png)), 'image/png');
  assert.equal(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'image/gif');
  assert.equal(
    detectImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    'image/webp',
  );
  assert.equal(detectImageMime(new Uint8Array([0x42, 0x4d, 0x00, 0x00])), 'image/bmp');
  assert.equal(detectImageMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), 'image/svg+xml');
  assert.equal(detectImageMime(new TextEncoder().encode('<?xml version="1.0"?><svg/>')), 'image/svg+xml');
  assert.equal(detectImageMime(new Uint8Array([1, 2, 3, 4])), null);
  assert.equal(detectImageMime(new TextEncoder().encode('hello world')), null);
});

test('mimeToExtension：常用扩展名', () => {
  assert.equal(mimeToExtension('image/png'), 'png');
  assert.equal(mimeToExtension('image/svg+xml'), 'svg');
  assert.equal(mimeToExtension('application/octet-stream'), 'bin');
});

/* ==================== 展示辅助 ==================== */

test('hexPreview：小写、空格分隔，超过 256 字节截断', () => {
  assert.deepEqual(hexPreview(new Uint8Array([0x0a, 0xbc, 0xff])), {
    hex: '0a bc ff',
    truncated: false,
    totalBytes: 3,
  });
  const bytes = new Uint8Array(300);
  const p = hexPreview(bytes);
  assert.equal(p.truncated, true);
  assert.equal(p.totalBytes, 300);
  assert.equal(p.hex.split(' ').length, 256);
});

test('formatFileSize：中文可读格式', () => {
  assert.equal(formatFileSize(0), '0 字节');
  assert.equal(formatFileSize(70), '70 字节');
  assert.equal(formatFileSize(1023), '1023 字节');
  assert.equal(formatFileSize(1024), '1.0 KB');
  assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MB');
});

test('checkFileSize：20MB 上限', () => {
  assert.equal(checkFileSize(0), null);
  assert.equal(checkFileSize(MAX_FILE_BYTES), null);
  const err = checkFileSize(MAX_FILE_BYTES + 1);
  assert.match(err, /文件过大/);
  assert.match(err, /20\.0 MB/);
});

test('truncateForDisplay：默认 1 万字符截断', () => {
  assert.deepEqual(truncateForDisplay('hello'), { text: 'hello', truncated: false });
  const long = 'a'.repeat(10001);
  const r = truncateForDisplay(long);
  assert.equal(r.truncated, true);
  assert.equal(r.text.length, 10000);
});

test('utf8ByteLength：UTF-8 字节数', () => {
  assert.equal(utf8ByteLength(''), 0);
  assert.equal(utf8ByteLength('码'), 3);
  assert.equal(utf8ByteLength('Hi 码'), 6);
  assert.equal(utf8ByteLength('😀'), 4);
});
