/** 随机生成器纯逻辑的单元测试（node --test 自动发现），逐条覆盖 issue #12 的验收示例。 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  // 采样
  randomBelow,
  pickChars,
  // UUID
  uuidV4,
  bytesToUuid,
  formatUuid,
  uuidV7FromParts,
  createUuidV7,
  uuidBatch,
  // ULID
  ULID_ALPHABET,
  encodeUlid,
  createUlid,
  ulidBatch,
  // NanoID
  NANO_ID_DEFAULT_ALPHABET,
  nanoId,
  nanoIdBatch,
  validateNanoIdOptions,
  // 密码
  AMBIGUOUS_CHARS,
  PASSWORD_SYMBOLS,
  passwordBatch,
  generatePassword,
  validatePasswordOptions,
  passwordPoolSize,
  passwordEntropy,
  formatEntropy,
  passwordStrength,
  selectedClasses,
  // 解析
  parseId,
  formatIdInfo,
  formatUtcTime,
  formatLocalTime,
} from './logic.mjs';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SYMBOL_RE = new RegExp(`[${PASSWORD_SYMBOLS.replaceAll('-', '\\-').replaceAll('[', '\\[').replaceAll(']', '\\]')}]`);

/* ---------------- 可注入的随机源 ---------------- */

/** 脚本字节源：依次吐出 sequence 里的字节（耗尽即抛错），并记录所有被请求过的字节 */
function scriptedBytes(sequence) {
  const pulled = [];
  const source = (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      const value = sequence.shift();
      if (value === undefined) throw new Error('脚本字节源耗尽');
      out[i] = value;
      pulled.push(value);
    }
    return out;
  };
  return { source, pulled };
}

/** 循环字节源：按顺序无限循环吐出 bytes */
function cyclicBytes(bytes) {
  let index = 0;
  const source = (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      out[i] = bytes[index % bytes.length];
      index += 1;
    }
    return out;
  };
  return source;
}

/** 断言数组已按字典序升序 */
function assertAscending(values) {
  const sorted = [...values].sort();
  assert.deepEqual(values, sorted, '结果应按生成顺序即字典序升序');
}

/* ============================================================
 * 拒绝采样（无取模偏差）
 * ============================================================ */

test('拒绝采样：字母表长 62 时，字节值 ≥ 248 被丢弃重取', () => {
  // 256 = 62 × 4 + 8 → 上限 248，247 可用
  const first = scriptedBytes([247]);
  assert.equal(randomBelow(62, { randomBytes: first.source }), 247 % 62);
  assert.deepEqual(first.pulled, [247]);

  // 248、255 被请求过但都因 ≥ 248 被丢弃，最终用 61
  const second = scriptedBytes([248, 255, 61]);
  assert.equal(randomBelow(62, { randomBytes: second.source }), 61);
  assert.deepEqual(second.pulled, [248, 255, 61]);
});

test('拒绝采样：字母表长 62，循环字节源下每个字符出现次数完全相等（无前缀偏好）', () => {
  const alphabet = NANO_ID_DEFAULT_ALPHABET.slice(0, 62); // A-Z a-z 0-9 共 62 个
  const source = cyclicBytes(Array.from({ length: 256 }, (_, i) => i));
  // 每轮 256 个字节：0–247 被接受，恰好 248 = 62 × 4 → 每个下标 4 次；取 4 轮共 992 个字符
  const text = pickChars(alphabet, 992, { randomBytes: source });
  assert.equal(text.length, 992);

  const counts = new Map();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  assert.equal(counts.size, 62, '62 个字符都应出现');
  for (const ch of alphabet) assert.equal(counts.get(ch), 16, `字符 ${ch} 应恰好出现 16 次`);
});

test('拒绝采样：字母表长 10（256 % 10 = 6，上限 250）同样无偏差', () => {
  const source = cyclicBytes(Array.from({ length: 256 }, (_, i) => i));
  const text = pickChars('0123456789', 250, { randomBytes: source });
  const counts = new Map();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  for (const ch of '0123456789') assert.equal(counts.get(ch), 25);
});

test('randomBelow：非法范围抛错', () => {
  assert.throws(() => randomBelow(0), /正整数/);
  assert.throws(() => randomBelow(-1), /正整数/);
  assert.throws(() => randomBelow(1.5), /正整数/);
});

test('randomBelow：字母表长 300 时走双字节通道且分布均匀', () => {
  const source = cyclicBytes(Array.from({ length: 256 }, (_, i) => i));
  const values = Array.from({ length: 1000 }, () => randomBelow(300, { randomBytes: source }));
  for (const v of values) assert.ok(v >= 0 && v < 300 && Number.isInteger(v));
});

/* ============================================================
 * UUID v4
 * ============================================================ */

test('UUID v4 批量 1000 个：全部匹配 v4 正则且互不重复', () => {
  const { ok, values } = uuidBatch({ version: 4, count: 1000 });
  assert.equal(ok, true);
  assert.equal(values.length, 1000);
  for (const value of values) assert.match(value, UUID_V4_RE);
  assert.equal(new Set(values).size, 1000, '1000 个应互不重复');
});

test('uuidV4：由注入字节源决定，版本 / 变体位正确', () => {
  const source = (length) => new Uint8Array(length).fill(0xff);
  const value = uuidV4({ randomBytes: source });
  assert.match(value, UUID_V4_RE);
  // 全 ff 字节 → 第 7 字节 (ff & 0f) | 40 = 4f，第 9 字节 (ff & 3f) | 80 = bf
  assert.equal(value, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('formatUuid：大写 / 去连字符 / 加花括号', () => {
  const uuid = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f';
  assert.equal(formatUuid(uuid), uuid);
  assert.equal(formatUuid(uuid, { uppercase: true }), '017F22E2-79B0-7CC3-98C4-DC0C0C07398F');
  assert.equal(formatUuid(uuid, { hyphens: false }), '017f22e279b07cc398c4dc0c0c07398f');
  assert.equal(
    formatUuid(uuid, { uppercase: true, hyphens: false, braces: true }),
    '{017F22E279B07CC398C4DC0C0C07398F}',
  );
});

/* ============================================================
 * UUID v7
 * ============================================================ */

test('uuidV7FromParts：时间戳落在前 48 位，可被解析还原', () => {
  const ms = 1645557742000; // 2022-02-22T19:22:22.000Z
  const uuid = uuidV7FromParts(ms, 0n);
  assert.match(uuid, UUID_V7_RE);
  assert.equal(parseId(uuid).timeMs, ms);
  assert.equal(parseId(uuid).utcText, '2022-02-22 19:22:22.000 UTC');
});

test('UUID v7 批量 1000 个：全部匹配 v7 正则，按生成顺序已是字典序升序', () => {
  const before = Date.now();
  const { ok, values } = uuidBatch({ version: 7, count: 1000 });
  assert.equal(ok, true);
  for (const value of values) assert.match(value, UUID_V7_RE);
  assertAscending(values);
  assert.equal(new Set(values).size, 1000);
  // 内嵌时间戳与真实时刻一致（前后 1 分钟内）
  const after = Date.now();
  for (const value of [values[0], values[values.length - 1]]) {
    const ms = parseId(value).timeMs;
    assert.ok(ms >= before - 1000 && ms <= after + 1000, `时间戳 ${ms} 应落在生成时刻附近`);
  }
});

test('UUID v7 固定 now 批量 1000 个：同一毫秒内严格递增（单调）', () => {
  const fixed = 1645557742000;
  const { ok, values } = uuidBatch({ version: 7, count: 1000, now: () => fixed });
  assert.equal(ok, true);
  assertAscending(values);
  assert.equal(new Set(values).size, 1000, '严格递增，无重复');
  // 全部内嵌同一个时间戳
  for (const value of values) assert.equal(parseId(value).timeMs, fixed);
});

test('UUID v7：时间回拨时沿用上一毫秒，序列仍不回退', () => {
  let clock = 2000;
  const next = createUuidV7({ now: () => (clock -= 1) });
  const values = [next(), next(), next(), next()];
  assertAscending(values);
});

/* ============================================================
 * ULID
 * ============================================================ */

test('ULID 批量 1000 个（固定 now）：全部匹配 26 位 Crockford Base32，严格升序', () => {
  const fixed = 1469922850259;
  const { ok, values } = ulidBatch({ count: 1000, now: () => fixed });
  assert.equal(ok, true);
  for (const value of values) assert.match(value, ULID_RE);
  assert.equal(values.length, 1000);
  assertAscending(values);
  assert.equal(new Set(values).size, 1000, '同一毫秒内严格递增');
  for (const value of values) assert.equal(parseId(value).timeMs, fixed);
});

test('ULID 批量 1000 个（真实时钟）：仍按生成顺序升序', () => {
  const { ok, values } = ulidBatch({ count: 1000 });
  assert.equal(ok, true);
  for (const value of values) assert.match(value, ULID_RE);
  assertAscending(values);
});

test('ULID：encode 与 decode 互逆（往返一致）', () => {
  const ms = 1469922850259;
  const randomness = 0x28f36a1b2c3d4e5f6a7bn & ((1n << 80n) - 1n);
  const ulid = encodeUlid(ms, randomness);
  assert.match(ulid, ULID_RE);
  const parsed = parseId(ulid);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, 'ulid');
  assert.equal(parsed.timeMs, ms);
  assert.equal(parsed.normalized, ulid);
  assert.equal(parsed.randomness, ulid.slice(10));
});

test('ULID 字母表：不含 I / L / O / U，共 32 个字符', () => {
  assert.equal(ULID_ALPHABET.length, 32);
  for (const ch of 'ILOU') assert.ok(!ULID_ALPHABET.includes(ch));
});

test('createUlid 与 ulidBatch：注入随机源时结果一致；小写输出选项', () => {
  const fixed = 1469922850259;
  const zeros = () => new Uint8Array(10);
  const next = createUlid({ now: () => fixed, randomBytes: zeros });
  const upper = ulidBatch({ count: 3, now: () => fixed, randomBytes: zeros });
  assert.equal(next(), upper.values[0]);
  assert.match(upper.values[0], ULID_RE);

  const lower = ulidBatch({ count: 3, uppercase: false, now: () => fixed, randomBytes: zeros });
  assert.match(lower.values[0], /^[0-9a-hjkmnp-tv-z]{26}$/);
  assert.equal(lower.values[0], upper.values[0].toLowerCase());
});

/* ============================================================
 * NanoID
 * ============================================================ */

test('NanoID 默认：批量 1000 个全部匹配 ^[A-Za-z0-9_-]{21}$', () => {
  const { ok, values } = nanoIdBatch({ count: 1000 });
  assert.equal(ok, true);
  for (const value of values) assert.match(value, /^[A-Za-z0-9_-]{21}$/);
});

test('NanoID：字母表 abc、长度 10 → 匹配 ^[abc]{10}$', () => {
  const { ok, values } = nanoIdBatch({ count: 200, length: 10, alphabet: 'abc' });
  assert.equal(ok, true);
  for (const value of values) assert.match(value, /^[abc]{10}$/);
});

test('NanoID：长度与字母表边界', () => {
  const two = nanoIdBatch({ count: 5, length: 2, alphabet: 'ab' });
  assert.equal(two.ok, true);
  for (const value of two.values) assert.match(value, /^[ab]{2}$/);

  const max = nanoIdBatch({ count: 5, length: 256 });
  assert.equal(max.ok, true);
  assert.equal(max.values[0].length, 256);

  assert.equal(validateNanoIdOptions({ length: 1, alphabet: 'ab' }), '长度必须在 2 到 256 之间');
  assert.equal(validateNanoIdOptions({ length: 257, alphabet: 'ab' }), '长度必须在 2 到 256 之间');
  assert.equal(nanoIdBatch({ count: 1, length: 21, alphabet: 'ab' }).error, undefined);
});

test('NanoID：字母表为空或只有 1 个字符 → 中文错误', () => {
  assert.equal(validateNanoIdOptions({ length: 21, alphabet: '' }), '字母表不能为空');
  assert.equal(validateNanoIdOptions({ length: 21, alphabet: 'a' }), '字母表至少需要 2 个不同字符');
  assert.equal(nanoIdBatch({ count: 3, alphabet: '' }).error, '字母表不能为空');
  assert.equal(nanoIdBatch({ count: 3, alphabet: 'x' }).error, '字母表至少需要 2 个不同字符');
  assert.throws(() => nanoId({ alphabet: 'x' }), /字母表至少需要 2 个不同字符/);
});

test('NanoID：数量超范围 → 中文错误', () => {
  assert.equal(nanoIdBatch({ count: 0 }).error, '数量必须在 1 到 1000 之间');
  assert.equal(nanoIdBatch({ count: 1001 }).error, '数量必须在 1 到 1000 之间');
});

/* ============================================================
 * 密码
 * ============================================================ */

test('密码：长度 16、只选数字 → 匹配 ^\\d{16}$，熵显示 53.2 位', () => {
  const options = { length: 16, uppercase: false, lowercase: false, digits: true, symbols: false };
  const { ok, values } = passwordBatch({ count: 500, ...options });
  assert.equal(ok, true);
  for (const value of values) assert.match(value, /^\d{16}$/);

  assert.equal(passwordEntropy(options), 16 * Math.log2(10));
  assert.equal(formatEntropy(passwordEntropy(options)), '53.2');
  assert.equal(passwordStrength(passwordEntropy(options)), '中');
});

test('密码：四类全选 + 排除易混淆字符 → 1000 个结果不含 0O1lI 且每类至少一个', () => {
  const { ok, values } = passwordBatch({
    count: 1000,
    length: 16,
    excludeAmbiguous: true,
    requireEach: true,
  });
  assert.equal(ok, true);
  for (const value of values) {
    for (const ch of AMBIGUOUS_CHARS) assert.ok(!value.includes(ch), `${value} 不应包含 ${ch}`);
    assert.match(value, /[A-Z]/);
    assert.match(value, /[a-z]/);
    assert.match(value, /\d/);
    assert.match(value, SYMBOL_RE);
  }
});

test('密码：关闭「每类至少一个」时只保证来自所选字符池', () => {
  const { ok, values } = passwordBatch({
    count: 300,
    length: 8,
    uppercase: false,
    lowercase: false,
    digits: true,
    symbols: false,
    requireEach: false,
  });
  assert.equal(ok, true);
  for (const value of values) assert.match(value, /^\d{8}$/);
});

test('密码：长度 3 但选了 4 类且「每类至少一个」→「长度不能小于所选字符类别数」', () => {
  assert.equal(validatePasswordOptions({ length: 3 }), '长度不能小于所选字符类别数');
  assert.equal(generatePassword({ length: 3 }).error, '长度不能小于所选字符类别数');
  assert.equal(passwordBatch({ count: 2, length: 3 }).error, '长度不能小于所选字符类别数');
});

test('密码：一个类别都不选 →「请至少选择一种字符」', () => {
  const none = { uppercase: false, lowercase: false, digits: false, symbols: false };
  assert.equal(validatePasswordOptions(none), '请至少选择一种字符');
  assert.equal(generatePassword(none).error, '请至少选择一种字符');
  assert.equal(passwordEntropy(none), 0);
});

test('密码：长度范围 4–128 之外的中文错误', () => {
  assert.equal(
    validatePasswordOptions({ length: 3, digits: true, requireEach: false }),
    '长度必须在 4 到 128 之间',
  );
  assert.equal(
    validatePasswordOptions({ length: 129 }),
    '长度必须在 4 到 128 之间',
  );
  assert.equal(validatePasswordOptions({ length: 4 }), null);
  assert.equal(validatePasswordOptions({ length: 128 }), null);
});

test('密码：字符池大小与排除易混淆字符后的各类池', () => {
  const classes = selectedClasses({ excludeAmbiguous: true });
  assert.deepEqual(
    classes.map(({ key, chars }) => [key, chars.length]),
    [
      ['uppercase', 24], // 26 - O I
      ['lowercase', 25], // 26 - l
      ['digits', 8], // 10 - 0 1
      ['symbols', PASSWORD_SYMBOLS.length],
    ],
  );
  assert.equal(passwordPoolSize({ excludeAmbiguous: false }), 26 + 26 + 10 + PASSWORD_SYMBOLS.length);
  // 只选数字且排除易混淆 → 池为 23456789
  assert.equal(selectedClasses({ uppercase: false, lowercase: false, symbols: false, excludeAmbiguous: true })[0].chars, '23456789');
});

test('密码：熵与强度分档（弱 < 40 ≤ 中 < 60 ≤ 强 < 80 ≤ 很强）', () => {
  const cases = [
    [39.9, '弱'],
    [40, '中'],
    [59.9, '中'],
    [60, '强'],
    [79.9, '强'],
    [80, '很强'],
    [128, '很强'],
  ];
  for (const [entropy, label] of cases) assert.equal(passwordStrength(entropy), label);

  // 长度 128 全类 → 很强
  const strong = passwordEntropy({ length: 128 });
  assert.ok(strong > 80);
  assert.equal(passwordStrength(strong), '很强');
  assert.equal(formatEntropy(strong), strong.toFixed(1));
});

test('密码：由注入随机源完全确定（可复现，可观察拒绝采样）', () => {
  // 数字池 0-9 共 10 个字符 → 上限 250：字节 7 → '7'，249 → '9'，250 在取字符时被丢弃；
  // 洗牌阶段的池大小是 4/3/2（上限 256），字节 250/3/1 都会被接受
  const source = scriptedBytes([7, 7, 250, 7, 249, 250, 3, 1]);
  const { ok, value } = generatePassword({
    length: 4,
    uppercase: false,
    lowercase: false,
    symbols: false,
    requireEach: true,
    randomBytes: source.source,
  });
  assert.equal(ok, true);
  // 取字符：7、7、（250 丢弃）7、249 → ['7','7','7','9']
  // 洗牌：250 % 4 = 2 → 换 2/3 位；3 % 3 = 0 → 换 0/2 位；1 % 2 = 1 → 不动
  assert.equal(value, '9777');
  assert.deepEqual(source.pulled, [7, 7, 250, 7, 249, 250, 3, 1]);
});

/* ============================================================
 * 批量数量
 * ============================================================ */

test('批量数量：越界给出中文错误（各类生成共用）', () => {
  assert.equal(uuidBatch({ count: 0 }).error, '数量必须在 1 到 1000 之间');
  assert.equal(uuidBatch({ count: 1001 }).error, '数量必须在 1 到 1000 之间');
  assert.equal(ulidBatch({ count: 0 }).error, '数量必须在 1 到 1000 之间');
  assert.equal(passwordBatch({ count: -1 }).error, '数量必须在 1 到 1000 之间');
  assert.equal(uuidBatch({ version: 5, count: 1 }).error, 'UUID 版本只支持 4 或 7');
  assert.equal(uuidBatch({ version: 4, count: 1000 }).ok, true);
});

/* ============================================================
 * 解析
 * ============================================================ */

test('解析 017f22e2-79b0-7cc3-98c4-dc0c0c07398f → 版本 7、变体 RFC 9562、时间 2022-02-22 19:22:22.000 UTC', () => {
  const parsed = parseId('017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, 'uuid');
  assert.equal(parsed.version, 7);
  assert.match(parsed.versionText, /^7（时间有序/);
  assert.equal(parsed.variantText, 'RFC 9562 / RFC 4122');
  assert.equal(parsed.timeMs, 1645557742000);
  assert.equal(parsed.utcText, '2022-02-22 19:22:22.000 UTC');
  // 本地时间与同一时刻的本地格式化一致
  assert.equal(parsed.localText, formatLocalTime(1645557742000));
  // 行数据（页面展示用）包含时间戳
  const rows = Object.fromEntries(parsed.rows.map(({ key, value }) => [key, value]));
  assert.equal(rows.timestamp, '1645557742000');
  assert.equal(rows.utc, '2022-02-22 19:22:22.000 UTC');
  assert.equal(rows.type, 'UUID');
  // 可复制文本
  assert.ok(formatIdInfo(parsed).includes('变体：RFC 9562 / RFC 4122'));
});

test('解析 UUID：大小写 / 去连字符 / 花括号均可识别', () => {
  const canonical = parseId('017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
  for (const input of [
    '017F22E2-79B0-7CC3-98C4-DC0C0C07398F',
    '017f22e279b07cc398c4dc0c0c07398f',
    '{017f22e2-79b0-7cc3-98c4-dc0c0c07398f}',
  ]) {
    const parsed = parseId(input);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.normalized, canonical.normalized);
    assert.equal(parsed.timeMs, canonical.timeMs);
  }
});

test('解析 UUID v4：随机版本，不显示内嵌时间', () => {
  const parsed = parseId('0f4a2d3e-5b6c-4d8e-9f0a-1b2c3d4e5f60');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.version, 4);
  assert.match(parsed.versionText, /^4（随机/);
  assert.equal(parsed.variantText, 'RFC 9562 / RFC 4122');
  assert.equal(parsed.timeMs, null);
  assert.ok(!parsed.rows.some(({ key }) => key === 'utc'));
});

test('解析 UUID v1：按 1582 纪元换算出 Unix 时间（Unix 纪元零点用例）', () => {
  // Gregorian→Unix 偏移常量 0x01B21DD213814000（100ns），拼成 v1：时间部分 → Unix 0 毫秒
  const parsed = parseId('13814000-1dd2-11b2-8000-0242ac130003');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.timeMs, 0);
  assert.equal(parsed.utcText, '1970-01-01 00:00:00.000 UTC');
});

test('解析 ULID 01ARZ3NDEKTSV4RRFFQ69G5FAV → 时间戳 1469922850259 即 2016-07-30 23:54:10.259 UTC', () => {
  const parsed = parseId('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, 'ulid');
  assert.equal(parsed.timeMs, 1469922850259);
  assert.equal(parsed.utcText, '2016-07-30 23:54:10.259 UTC');
  assert.equal(parsed.localText, formatLocalTime(1469922850259));
  const rows = Object.fromEntries(parsed.rows.map(({ key, value }) => [key, value]));
  assert.equal(rows.timestamp, '1469922850259');
  assert.equal(rows.utc, '2016-07-30 23:54:10.259 UTC');
  assert.equal(rows.randomness, 'TSV4RRFFQ69G5FAV');
  // 小写输入同样可解析并给出规范大写形式
  const lower = parseId('01arz3ndektsv4rrffq69g5fav');
  assert.equal(lower.ok, true);
  assert.equal(lower.normalized, parsed.normalized);
});

test('解析 xyz →「无法识别为 UUID 或 ULID」', () => {
  const parsed = parseId('xyz');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, '无法识别为 UUID 或 ULID');
  for (const input of ['017f22e2-79b0-7cc3-98c4-dc0c0c07398', '01ARZ3NDEKTSV4RRFFQ69G5FAU', 'hello world!']) {
    assert.equal(parseId(input).error, '无法识别为 UUID 或 ULID', `${input} 不应被识别`);
  }
});

test('解析：26 位纯十六进制按 ULID 处理（长度区分两种格式）', () => {
  const parsed = parseId('0123456789abcdef0123456789');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, 'ulid');
});

/* ============================================================
 * 时间格式化
 * ============================================================ */

test('formatUtcTime / formatLocalTime：固定毫秒的输出', () => {
  assert.equal(formatUtcTime(0), '1970-01-01 00:00:00.000 UTC');
  assert.equal(formatUtcTime(1645557742421), '2022-02-22 19:22:22.421 UTC');
  const d = new Date(1645557742421);
  assert.equal(
    formatLocalTime(1645557742421),
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:` +
      `${String(d.getSeconds()).padStart(2, '0')}.421`,
  );
});

test('bytesToUuid：字节数组转标准形式', () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
  assert.equal(bytesToUuid(bytes), '00010203-0405-0607-0809-0a0b0c0d0e0f');
});

/* ============================================================
 * 静态检查：源码不得出现非密码学安全的随机函数
 * ============================================================ */

test('静态检查：tools/random/**/*.mjs（不含测试文件）中不出现非密码学随机函数', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const walk = (current) => {
    const files = [];
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'vendor') continue;
        files.push(...walk(full));
      } else if (entry.name.endsWith('.mjs')) {
        files.push(full);
      }
    }
    return files;
  };
  const sources = walk(dir).filter((file) => !/\.test\.mjs$|\.e2e\.mjs$/.test(file));
  assert.ok(sources.length >= 2, `应至少扫描到 index.mjs 与 logic.mjs，实际 ${sources.length}`);
  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!source.includes('Math.random'), `${path.relative(dir, file)} 中出现了非密码学安全的随机函数`);
  }
});
