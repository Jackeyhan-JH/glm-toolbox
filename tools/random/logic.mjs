/**
 * 随机生成器 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 约定：
 *   - 所有随机数来自密码学安全的 crypto.getRandomValues，随机源可通过 randomBytes 注入；
 *     涉及时间的函数（UUID v7 / ULID）可注入 now，测试才能确定；
 *   - 从有限字母表取字符一律用「拒绝采样」：只接受小于「字节空间内字母表长度最大整数倍」
 *     的字节再取模，保证每个字符概率严格相等（如字母表长 62 时，字节值 ≥ 248 被丢弃）；
 *   - UUID v7 与 ULID 在同一毫秒内批量生成时保持单调递增（时间相同则递增随机位），
 *     因此批量结果按生成顺序即字典序升序。
 */

/* ============================================================
 * 随机源 / 时间源
 * ============================================================ */

/** 默认随机源：密码学安全的 crypto.getRandomValues（浏览器与 Node 22+ 均内置） */
function defaultRandomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** 默认时间源（Unix 毫秒），可注入 */
function defaultNow() {
  return Date.now();
}

/* ============================================================
 * 拒绝采样
 * ============================================================ */

/**
 * 从 [0, size) 中均匀取一个整数。
 * 字母表长度 ≤ 256 时用 1 字节（空间 256），否则用 2 字节（空间 65536）；
 * 只接受小于 limit = space - (space % size) 的值，其余丢弃重取，
 * 因此取模后每个下标被选中的概率严格相等。
 * @param {number} size 正整数
 * @param {{ randomBytes?: (length: number) => Uint8Array }} [injectable]
 */
export function randomBelow(size, { randomBytes = defaultRandomBytes } = {}) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('随机取值范围必须是正整数');
  }
  const byteCount = size <= 256 ? 1 : 2;
  const space = byteCount === 1 ? 256 : 65536;
  const limit = space - (space % size);
  for (;;) {
    const bytes = randomBytes(byteCount);
    const value = byteCount === 1 ? bytes[0] : bytes[0] * 256 + bytes[1];
    if (value < limit) return value % size;
  }
}

/** 从字母表（字符串）中取 count 个字符（拒绝采样，无取模偏差） */
export function pickChars(alphabet, count, { randomBytes = defaultRandomBytes } = {}) {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    out += alphabet[randomBelow(alphabet.length, { randomBytes })];
  }
  return out;
}

/** 生成 bits 位随机大整数（高位清零到指定位数） */
function randomBigInt(bits, { randomBytes = defaultRandomBytes }) {
  const bytes = randomBytes(Math.ceil(bits / 8));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value & ((1n << BigInt(bits)) - 1n);
}

/* ============================================================
 * 通用：批量数量
 * ============================================================ */

export const COUNT_MIN = 1;
export const COUNT_MAX = 1000;

function validateCount(count) {
  if (!Number.isInteger(count) || count < COUNT_MIN || count > COUNT_MAX) {
    return `数量必须在 ${COUNT_MIN} 到 ${COUNT_MAX} 之间`;
  }
  return null;
}

/* ============================================================
 * UUID
 * ============================================================ */

/** 16 字节 → 标准小写带连字符的 UUID 文本 */
export function bytesToUuid(bytes) {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** UUID v4：除版本 / 变体位外全部随机 */
export function uuidV4({ randomBytes = defaultRandomBytes } = {}) {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // 版本 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // 变体 10xx
  return bytesToUuid(bytes);
}

/**
 * 按选项格式化 UUID 文本。
 * @param {string} uuid 标准小写 UUID
 * @param {{ uppercase?: boolean, hyphens?: boolean, braces?: boolean }} [options]
 */
export function formatUuid(uuid, { uppercase = false, hyphens = true, braces = false } = {}) {
  let out = hyphens ? uuid : uuid.replaceAll('-', '');
  if (uppercase) out = out.toUpperCase();
  return braces ? `{${out}}` : out;
}

/* ---------- UUID v7（RFC 9562：48 位 Unix 毫秒 + 74 位随机） ---------- */

const UUID_V7_RAND_BITS = 74n;
const UUID_V7_RAND_MAX = (1n << UUID_V7_RAND_BITS) - 1n;

/** 由（毫秒时间戳, 74 位随机数）拼出 UUID v7 文本 */
export function uuidV7FromParts(ms, randomness) {
  const randA = (randomness >> 62n) & 0xfffn; // 12 位
  const randB = randomness & ((1n << 62n) - 1n); // 62 位
  const bytes = new Uint8Array(16);
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = 0x70 | Number(randA >> 8n); // 版本 7 + rand_a 高 4 位
  bytes[7] = Number(randA & 0xffn);
  bytes[8] = 0x80 | Number((randB >> 56n) & 0x3fn); // 变体 10xx + rand_b 高 6 位
  for (let i = 0; i < 7; i += 1) {
    bytes[9 + i] = Number((randB >> BigInt(8 * (6 - i))) & 0xffn);
  }
  return bytesToUuid(bytes);
}

/**
 * 创建 UUID v7 生成器：同一毫秒内每次调用在上一个的随机位上加 1，
 * 保证批量生成严格递增；时间回拨时沿用上一次的毫秒（时间不倒退）。
 * @param {{ now?: () => number, randomBytes?: (length: number) => Uint8Array }} [injectable]
 * @returns {() => string}
 */
export function createUuidV7({ now = defaultNow, randomBytes = defaultRandomBytes } = {}) {
  let lastMs = null;
  let lastRandom = 0n;
  return () => {
    let ms = now();
    if (lastMs !== null && ms <= lastMs) ms = lastMs; // 时钟回拨 → 沿用上次毫秒
    if (ms === lastMs) {
      lastRandom += 1n;
      if (lastRandom > UUID_V7_RAND_MAX) {
        // 74 位随机位溢出（实际不可能发生）：顺延到下一毫秒重新取随机
        ms += 1;
        lastRandom = randomBigInt(Number(UUID_V7_RAND_BITS), { randomBytes });
      }
    } else {
      lastRandom = randomBigInt(Number(UUID_V7_RAND_BITS), { randomBytes });
    }
    lastMs = ms;
    return uuidV7FromParts(ms, lastRandom);
  };
}

/** UUID 批量生成：v4（随机）/ v7（时间有序） */
export function uuidBatch({
  version = 4,
  count = 1,
  uppercase = false,
  hyphens = true,
  braces = false,
  now,
  randomBytes,
} = {}) {
  const error =
    validateCount(count) ?? (version === 4 || version === 7 ? null : 'UUID 版本只支持 4 或 7');
  if (error) return { ok: false, error };

  const options = { uppercase, hyphens, braces };
  const values = [];
  if (version === 4) {
    for (let i = 0; i < count; i += 1) {
      values.push(formatUuid(uuidV4({ randomBytes }), options));
    }
  } else {
    const next = createUuidV7({ now, randomBytes });
    for (let i = 0; i < count; i += 1) values.push(formatUuid(next(), options));
  }
  return { ok: true, values };
}

/* ============================================================
 * ULID（48 位 Unix 毫秒 + 80 位随机，Crockford Base32 共 26 位）
 * ============================================================ */

export const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 无 I L O U
export const ULID_LENGTH = 26;
const ULID_RAND_BITS = 80n;
const ULID_RAND_MAX = (1n << ULID_RAND_BITS) - 1n;

/** 由（毫秒时间戳, 80 位随机数）编出 26 位 ULID 文本 */
export function encodeUlid(ms, randomness) {
  let value = (BigInt(ms) << ULID_RAND_BITS) | (randomness & ULID_RAND_MAX);
  let out = '';
  for (let i = 0; i < ULID_LENGTH; i += 1) {
    out = ULID_ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

/**
 * 创建 ULID 生成器：同一毫秒内随机位自增 1，批量生成严格递增。
 * @param {{ now?: () => number, randomBytes?: (length: number) => Uint8Array }} [injectable]
 * @returns {() => string}
 */
export function createUlid({ now = defaultNow, randomBytes = defaultRandomBytes } = {}) {
  let lastMs = null;
  let lastRandom = 0n;
  return () => {
    let ms = now();
    if (lastMs !== null && ms <= lastMs) ms = lastMs;
    if (ms === lastMs) {
      lastRandom += 1n;
      if (lastRandom > ULID_RAND_MAX) {
        ms += 1;
        lastRandom = randomBigInt(Number(ULID_RAND_BITS), { randomBytes });
      }
    } else {
      lastRandom = randomBigInt(Number(ULID_RAND_BITS), { randomBytes });
    }
    lastMs = ms;
    return encodeUlid(ms, lastRandom);
  };
}

/** ULID 文本格式化（默认大写，标准写法） */
export function formatUlid(ulid, { uppercase = true } = {}) {
  return uppercase ? ulid.toUpperCase() : ulid.toLowerCase();
}

/** ULID 批量生成 */
export function ulidBatch({ count = 1, uppercase = true, now, randomBytes } = {}) {
  const error = validateCount(count);
  if (error) return { ok: false, error };
  const next = createUlid({ now, randomBytes });
  const values = [];
  for (let i = 0; i < count; i += 1) values.push(formatUlid(next(), { uppercase }));
  return { ok: true, values };
}

/* ============================================================
 * NanoID
 * ============================================================ */

export const NANO_ID_DEFAULT_LENGTH = 21;
export const NANO_ID_MIN_LENGTH = 2;
export const NANO_ID_MAX_LENGTH = 256;
export const NANO_ID_DEFAULT_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** 易混淆字符集合（密码与 NanoID 预设共用） */
export const AMBIGUOUS_CHARS = '0O1lI';

export const NANO_ID_PRESETS = [
  { key: 'default', label: '默认（字母 + 数字 + _ -）', alphabet: NANO_ID_DEFAULT_ALPHABET },
  { key: 'digits', label: '数字', alphabet: '0123456789' },
  { key: 'lower-digits', label: '小写字母 + 数字', alphabet: '0123456789abcdefghijklmnopqrstuvwxyz' },
  {
    key: 'unambiguous',
    label: '去掉易混淆字符',
    alphabet: NANO_ID_DEFAULT_ALPHABET.replaceAll(/[0Ol1I]/g, ''),
  },
  { key: 'custom', label: '自定义', alphabet: '' },
];

/** 校验 NanoID 选项，返回中文错误信息或 null */
export function validateNanoIdOptions({ length, alphabet }) {
  if (typeof alphabet !== 'string' || alphabet.length === 0) return '字母表不能为空';
  if (alphabet.length < 2) return '字母表至少需要 2 个不同字符';
  if (!Number.isInteger(length) || length < NANO_ID_MIN_LENGTH || length > NANO_ID_MAX_LENGTH) {
    return `长度必须在 ${NANO_ID_MIN_LENGTH} 到 ${NANO_ID_MAX_LENGTH} 之间`;
  }
  return null;
}

/** 生成单个 NanoID */
export function nanoId({
  length = NANO_ID_DEFAULT_LENGTH,
  alphabet = NANO_ID_DEFAULT_ALPHABET,
  randomBytes = defaultRandomBytes,
} = {}) {
  const error = validateNanoIdOptions({ length, alphabet });
  if (error) throw new Error(error);
  return pickChars(alphabet, length, { randomBytes });
}

/** NanoID 批量生成 */
export function nanoIdBatch({
  count = 1,
  length = NANO_ID_DEFAULT_LENGTH,
  alphabet = NANO_ID_DEFAULT_ALPHABET,
  randomBytes,
} = {}) {
  const error = validateCount(count) ?? validateNanoIdOptions({ length, alphabet });
  if (error) return { ok: false, error };
  const values = [];
  for (let i = 0; i < count; i += 1) values.push(pickChars(alphabet, length, { randomBytes }));
  return { ok: true, values };
}

/* ============================================================
 * 密码
 * ============================================================ */

export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_DEFAULT_LENGTH = 16;

/** 符号字符集（见 issue #12） */
export const PASSWORD_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/';

/** 四类字符池（顺序即展示顺序） */
export const PASSWORD_CLASSES = [
  { key: 'uppercase', label: '大写字母', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  { key: 'lowercase', label: '小写字母', chars: 'abcdefghijklmnopqrstuvwxyz' },
  { key: 'digits', label: '数字', chars: '0123456789' },
  { key: 'symbols', label: '符号', chars: PASSWORD_SYMBOLS },
];

/** 合并默认值，得到完整的密码选项对象 */
function normalizePasswordOptions({
  length = PASSWORD_DEFAULT_LENGTH,
  uppercase = true,
  lowercase = true,
  digits = true,
  symbols = true,
  excludeAmbiguous = false,
  requireEach = true,
  randomBytes,
} = {}) {
  return { length, uppercase, lowercase, digits, symbols, excludeAmbiguous, requireEach, randomBytes };
}

/** 当前选中的字符类别（已按需剔除易混淆字符） */
export function selectedClasses(options = {}) {
  const opts = normalizePasswordOptions(options);
  return PASSWORD_CLASSES.filter(({ key }) => opts[key]).map(({ key, label, chars }) => ({
    key,
    label,
    chars: opts.excludeAmbiguous
      ? Array.from(chars, (c) => (AMBIGUOUS_CHARS.includes(c) ? '' : c)).join('')
      : chars,
  }));
}

/** 校验密码选项，返回中文错误信息或 null */
export function validatePasswordOptions(options = {}) {
  const opts = normalizePasswordOptions(options);
  const classes = selectedClasses(opts);
  if (classes.length === 0) return '请至少选择一种字符';
  if (opts.requireEach && opts.length < classes.length) return '长度不能小于所选字符类别数';
  if (!Number.isInteger(opts.length) || opts.length < PASSWORD_MIN_LENGTH || opts.length > PASSWORD_MAX_LENGTH) {
    return `长度必须在 ${PASSWORD_MIN_LENGTH} 到 ${PASSWORD_MAX_LENGTH} 之间`;
  }
  return null;
}

/** 生成单个密码：先每类垫一个（可选），再从合并字符池取满，最后安全洗牌 */
function buildPassword(options) {
  const opts = normalizePasswordOptions(options);
  const randomBytes = opts.randomBytes ?? defaultRandomBytes;
  const classes = selectedClasses(opts);
  const chars = [];
  if (opts.requireEach) {
    for (const { chars: pool } of classes) {
      chars.push(pool[randomBelow(pool.length, { randomBytes })]);
    }
  }
  const combined = classes.map(({ chars: pool }) => pool).join('');
  while (chars.length < opts.length) {
    chars.push(combined[randomBelow(combined.length, { randomBytes })]);
  }
  // Fisher–Yates 洗牌（下标同样走拒绝采样），避免「每类至少一个」的字符集中在前
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomBelow(i + 1, { randomBytes });
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return chars.join('');
}

/** 生成单个密码，统一返回 { ok, value | error } */
export function generatePassword(options = {}) {
  const error = validatePasswordOptions(options);
  if (error) return { ok: false, error };
  return { ok: true, value: buildPassword(options) };
}

/** 密码批量生成 */
export function passwordBatch({ count = 1, ...options } = {}) {
  const error = validateCount(count) ?? validatePasswordOptions(options);
  if (error) return { ok: false, error };
  const values = [];
  for (let i = 0; i < count; i += 1) values.push(buildPassword(options));
  return { ok: true, values };
}

/** 合并字符池大小（用于熵计算） */
export function passwordPoolSize(options = {}) {
  return selectedClasses(options).reduce((sum, { chars }) => sum + chars.length, 0);
}

/** 熵（位）= 长度 × log2(字符池大小) */
export function passwordEntropy(options = {}) {
  const opts = normalizePasswordOptions(options);
  const poolSize = passwordPoolSize(opts);
  if (poolSize <= 1) return 0;
  return opts.length * Math.log2(poolSize);
}

/** 熵显示为一位小数（如 53.2） */
export function formatEntropy(entropy) {
  return entropy.toFixed(1);
}

/** 强度等级：弱 < 40 ≤ 中 < 60 ≤ 强 < 80 ≤ 很强 */
export const PASSWORD_STRENGTH_LEVELS = [
  { min: 80, label: '很强', className: 'is-very-strong' },
  { min: 60, label: '强', className: 'is-strong' },
  { min: 40, label: '中', className: 'is-fair' },
  { min: 0, label: '弱', className: 'is-weak' },
];

/** 按熵取强度等级文本 */
export function passwordStrength(entropy) {
  return PASSWORD_STRENGTH_LEVELS.find((level) => entropy >= level.min).label;
}

/* ============================================================
 * 解析（UUID / ULID）
 * ============================================================ */

const UUID_VERSION_LABELS = {
  0: '0（未知）',
  1: '1（时间戳 + 节点 ID）',
  2: '2（DCE 安全）',
  3: '3（名称 MD5 哈希）',
  4: '4（随机数）',
  5: '5（名称 SHA-1 哈希）',
  6: '6（时间有序，Gregorian）',
  7: '7（时间有序，Unix 毫秒）',
  8: '8（自定义）',
};

const UUID_VARIANT_LABELS = [
  '保留（未来定义）',
  '保留（NCS 向后兼容）',
  'RFC 9562 / RFC 4122',
  '保留（微软 GUID）',
];

function pad(number, width = 2) {
  return String(number).padStart(width, '0');
}

/** UTC 时间文本：2022-02-22 19:22:22.000 UTC */
export function formatUtcTime(ms) {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)} UTC`
  );
}

/** 本地时间文本：2022-02-22 19:22:22.000 */
export function formatLocalTime(ms) {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/** Crockford Base32 单字符取值（宽松：O→0，I/L→1，大小写均可）；非法返回 -1 */
function crockfordValue(char) {
  const c = char.toUpperCase();
  if (c === 'O') return 0;
  if (c === 'I' || c === 'L') return 1;
  return ULID_ALPHABET.indexOf(c);
}

/** 解析 UUID 文本（可带连字符 / 花括号，大小写均可）；不匹配返回 null */
function parseUuid(text) {
  let body = text;
  if (body.startsWith('{') && body.endsWith('}') && body.length > 2) body = body.slice(1, -1);
  if (!/^[0-9a-f-]+$/i.test(body)) return null;
  const hex = body.replaceAll('-', '');
  if (hex.length !== 32) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const normalized = bytesToUuid(bytes);
  const version = bytes[6] >> 4;
  const variantBits = bytes[8] >> 6;
  const versionText = UUID_VERSION_LABELS[version] ?? `${version}（未知）`;
  const variantText = UUID_VARIANT_LABELS[variantBits];

  // 时间戳：v7 = 前 48 位 Unix 毫秒；v1 = 60 位 100ns（自 1582-10-15 起）
  let timeMs = null;
  if (version === 7) {
    timeMs =
      (bytes[0] * 2 ** 40) + (bytes[1] * 2 ** 32) + (bytes[2] * 2 ** 24) +
      (bytes[3] * 2 ** 16) + (bytes[4] * 2 ** 8) + bytes[5];
  } else if (version === 1) {
    let ticks = 0n;
    for (const byte of [bytes[6] & 0x0f, bytes[7], bytes[4], bytes[5], bytes[0], bytes[1], bytes[2], bytes[3]]) {
      ticks = (ticks << 8n) | BigInt(byte);
    }
    timeMs = Number(ticks / 10000n) - 12219292800000; // 100ns → ms，再平移到 Unix 纪元
  }

  const rows = [
    { key: 'type', label: '类型', value: 'UUID' },
    { key: 'version', label: '版本', value: versionText },
    { key: 'variant', label: '变体', value: variantText },
    { key: 'normalized', label: '规范形式', value: normalized },
  ];
  if (timeMs !== null && Number.isFinite(timeMs)) {
    rows.push(
      { key: 'timestamp', label: '时间戳（毫秒）', value: String(timeMs) },
      { key: 'utc', label: 'UTC 时间', value: formatUtcTime(timeMs) },
      { key: 'local', label: '本地时间', value: formatLocalTime(timeMs) },
    );
  }
  const hasTime = timeMs !== null && Number.isFinite(timeMs);
  return {
    ok: true,
    type: 'uuid',
    normalized,
    version,
    versionText,
    variantText,
    timeMs: hasTime ? timeMs : null,
    utcText: hasTime ? formatUtcTime(timeMs) : null,
    localText: hasTime ? formatLocalTime(timeMs) : null,
    rows,
  };
}

/** 解析 ULID 文本（大小写均可，宽松接受 O/I/L 形近写法）；不匹配返回 null */
function parseUlid(text) {
  if (text.length !== ULID_LENGTH) return null;
  let value = 0n;
  for (const char of text) {
    const digit = crockfordValue(char);
    if (digit < 0) return null;
    value = (value << 5n) | BigInt(digit);
  }
  const timeMs = Number(value >> ULID_RAND_BITS);
  const normalized = encodeUlid(timeMs, value & ULID_RAND_MAX);
  const randomnessText = normalized.slice(10);
  const rows = [
    { key: 'type', label: '类型', value: 'ULID' },
    { key: 'normalized', label: '规范形式', value: normalized },
    { key: 'randomness', label: '随机部分', value: randomnessText },
    { key: 'timestamp', label: '时间戳（毫秒）', value: String(timeMs) },
    { key: 'utc', label: 'UTC 时间', value: formatUtcTime(timeMs) },
    { key: 'local', label: '本地时间', value: formatLocalTime(timeMs) },
  ];
  return {
    ok: true,
    type: 'ulid',
    normalized,
    timeMs,
    randomness: randomnessText,
    utcText: formatUtcTime(timeMs),
    localText: formatLocalTime(timeMs),
    rows,
  };
}

/**
 * 解析 UUID 或 ULID。
 * @returns {{ ok: true, ... } | { ok: false, error: '无法识别为 UUID 或 ULID' }}
 */
export function parseId(input) {
  const text = String(input ?? '').trim();
  return parseUuid(text) ?? parseUlid(text) ?? { ok: false, error: '无法识别为 UUID 或 ULID' };
}

/** 把解析结果格式化为可复制的多行文本 */
export function formatIdInfo(parsed) {
  return parsed.rows.map(({ label, value }) => `${label}：${value}`).join('\n');
}
