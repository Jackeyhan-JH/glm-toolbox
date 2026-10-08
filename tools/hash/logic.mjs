/**
 * 哈希计算 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 约定（见 issue #10）：
 *   - 算法：MD5、SHA-1、SHA-256、SHA-384、SHA-512 同时计算；
 *   - SHA 系列走 crypto.subtle（浏览器与 Node 22 的全局 WebCrypto，worker 中同样可用）；
 *   - MD5 与 HMAC-MD5 自行实现（WebCrypto 不支持 MD5），Md5 类支持分块增量计算；
 *   - HMAC 密钥支持三种格式：文本（UTF-8）/ 十六进制 / Base64，非法输入抛中文错误；
 *   - 输出格式：小写十六进制（默认）/ 大写十六进制 / Base64；
 *   - 比对：忽略首尾空白，十六进制再忽略大小写，自动标出匹配的算法；
 *   - 文件 ≤ 200MB。
 *
 * btoa / atob / TextEncoder / crypto 在浏览器与 Node 22 中都是全局可用，
 * 不涉及 DOM，因此本模块仍是纯逻辑。
 */

/** 文件大小上限（issue #10：≤ 200MB） */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** 全部摘要算法（展示顺序） */
export const PLAIN_ALGORITHMS = [
  { id: 'md5', label: 'MD5' },
  { id: 'sha1', label: 'SHA-1' },
  { id: 'sha256', label: 'SHA-256' },
  { id: 'sha384', label: 'SHA-384' },
  { id: 'sha512', label: 'SHA-512' },
];

/** crypto.subtle 支持的算法（MD5 除外） */
export const SUBTLE_IDS = ['sha1', 'sha256', 'sha384', 'sha512'];
const SUBTLE_NAMES = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };

/** HMAC 版本（与 PLAIN_ALGORITHMS 一一对应） */
export const HMAC_ALGORITHMS = PLAIN_ALGORITHMS.map((a) => ({ id: `hmac-${a.id}`, label: `HMAC-${a.label}` }));

/** 输出格式选项 */
export const OUTPUT_FORMATS = [
  { value: 'hex-lower', label: '小写十六进制' },
  { value: 'hex-upper', label: '大写十六进制' },
  { value: 'base64', label: 'Base64' },
];

/** 密钥格式选项 */
export const KEY_FORMATS = [
  { value: 'utf8', label: '文本（UTF-8）' },
  { value: 'hex', label: '十六进制' },
  { value: 'base64', label: 'Base64' },
];

/* ==================== MD5（自实现，RFC 1321） ==================== */

/** K[i] = floor(2^32 × |sin(i+1)|)，|0 转成 int32 位 pattern */
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
}

/** 每轮的循环左移位数 */
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/**
 * 增量 MD5：new Md5().update(分块).digest()。
 * 大文件分块喂入，避免一次性处理；digest() 幂等（缓存结果，返回副本）。
 */
export class Md5 {
  constructor() {
    this._a = 0x67452301 | 0;
    this._b = 0xefcdab89 | 0;
    this._c = 0x98badcfe | 0;
    this._d = 0x10325476 | 0;
    this._bytes = 0; // 已输入的字节总数（< 2^53，按 Number 精确）
    this._pending = new Uint8Array(64); // 未凑满一个分组的数据
    this._pendingLen = 0;
    this._m = new Int32Array(16); // 分组复用缓冲
    this._result = null;
  }

  /** 喂入一段字节（Uint8Array / ArrayBuffer）；支持链式调用 */
  update(data) {
    if (this._result !== null) throw new Error('MD5 已生成摘要，不能继续输入数据');
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this._bytes += bytes.length;
    let pos = 0;

    // 先把 pending 补满一个分组
    if (this._pendingLen > 0) {
      const take = Math.min(64 - this._pendingLen, bytes.length);
      this._pending.set(bytes.subarray(0, take), this._pendingLen);
      this._pendingLen += take;
      pos = take;
      if (this._pendingLen === 64) {
        this._processBlock(this._pending, 0);
        this._pendingLen = 0;
      }
    }

    // 直接在输入上处理完整分组（不复制）
    while (bytes.length - pos >= 64) {
      this._processBlock(bytes, pos);
      pos += 64;
    }

    // 余下的暂存
    const rest = bytes.length - pos;
    if (rest > 0) {
      this._pending.set(bytes.subarray(pos), 0);
      this._pendingLen = rest;
    }
    return this;
  }

  /** 生成 16 字节摘要（小端序 a/b/c/d）；重复调用返回相同结果 */
  digest() {
    if (this._result !== null) return this._result.slice();

    const bitLen = this._bytes * 8; // < 2^53，精确
    const lo = bitLen % 4294967296;
    const hi = Math.floor(bitLen / 4294967296);

    // 填充：0x80 + 0 …0 + 8 字节小端位长度。pendingLen ≤ 63，追加 0x80 必然放得下。
    this._pending[this._pendingLen++] = 0x80;
    if (this._pendingLen > 56) {
      while (this._pendingLen < 64) this._pending[this._pendingLen++] = 0;
      this._processBlock(this._pending, 0);
      this._pendingLen = 0;
    }
    while (this._pendingLen < 56) this._pending[this._pendingLen++] = 0;
    this._pending[56] = lo & 0xff;
    this._pending[57] = (lo >>> 8) & 0xff;
    this._pending[58] = (lo >>> 16) & 0xff;
    this._pending[59] = (lo >>> 24) & 0xff;
    this._pending[60] = hi & 0xff;
    this._pending[61] = (hi >>> 8) & 0xff;
    this._pending[62] = (hi >>> 16) & 0xff;
    this._pending[63] = (hi >>> 24) & 0xff;
    this._processBlock(this._pending, 0);

    const out = new Uint8Array(16);
    writeLe32(out, 0, this._a);
    writeLe32(out, 4, this._b);
    writeLe32(out, 8, this._c);
    writeLe32(out, 12, this._d);
    this._result = out;
    return out.slice();
  }

  /** 处理 offset 起的一个 64 字节分组（RFC 1321 的 4 轮共 64 步） */
  _processBlock(block, offset) {
    const M = this._m;
    for (let j = 0; j < 16; j++) {
      const i = offset + j * 4;
      M[j] = block[i] | (block[i + 1] << 8) | (block[i + 2] << 16) | (block[i + 3] << 24);
    }
    let a = this._a;
    let b = this._b;
    let c = this._c;
    let d = this._d;
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + K[i] + M[g]) | 0;
      const s = S[i];
      b = (b + ((sum << s) | (sum >>> (32 - s)))) | 0;
      a = tmp;
    }
    this._a = (this._a + a) | 0;
    this._b = (this._b + b) | 0;
    this._c = (this._c + c) | 0;
    this._d = (this._d + d) | 0;
  }
}

function writeLe32(out, offset, word) {
  out[offset] = word & 0xff;
  out[offset + 1] = (word >>> 8) & 0xff;
  out[offset + 2] = (word >>> 16) & 0xff;
  out[offset + 3] = (word >>> 24) & 0xff;
}

/** 一次性 MD5 */
export function md5(bytes) {
  return new Md5().update(bytes).digest();
}

/* ==================== SHA 系列（crypto.subtle） ==================== */

/** 用 crypto.subtle 计算摘要，返回 Uint8Array */
export async function subtleDigest(algorithm, data) {
  const buf = await crypto.subtle.digest(algorithm, data);
  return new Uint8Array(buf);
}

/** 文本（UTF-8）→ 字节 */
export function textToBytes(text) {
  return new TextEncoder().encode(text);
}

/** 一次性计算全部 5 种摘要：{ md5, sha1, sha256, sha384, sha512 } */
export async function computeDigests(bytes) {
  const digests = { md5: md5(bytes) };
  for (const id of SUBTLE_IDS) {
    digests[id] = await subtleDigest(SUBTLE_NAMES[id], bytes);
  }
  return digests;
}

/* ==================== HMAC ==================== */

/** HMAC 的块大小（MD5 与 SHA-1/256/384/512 相同） */
const HMAC_BLOCK = 64;

/**
 * 开始一次可增量输入的 HMAC-MD5：先吸收 ipad，update() 喂消息分块，
 * digest() 时补 opad 与内层摘要。密钥 > 64 字节时先用 MD5 压缩（RFC 2104）。
 */
export function beginHmacMd5(key) {
  let k = key instanceof Uint8Array ? key : new Uint8Array(key);
  if (k.length > HMAC_BLOCK) k = md5(k);
  const padded = new Uint8Array(HMAC_BLOCK);
  padded.set(k);
  const innerInput = new Uint8Array(HMAC_BLOCK); // key ^ ipad
  const outerInput = new Uint8Array(HMAC_BLOCK); // key ^ opad
  for (let i = 0; i < HMAC_BLOCK; i++) {
    innerInput[i] = padded[i] ^ 0x36;
    outerInput[i] = padded[i] ^ 0x5c;
  }
  const inner = new Md5().update(innerInput);
  return {
    update(chunk) {
      inner.update(chunk);
      return this;
    },
    digest() {
      return new Md5().update(outerInput).update(inner.digest()).digest();
    },
  };
}

/** 一次性 HMAC-MD5 */
export function hmacMd5(key, message) {
  const state = beginHmacMd5(key);
  state.update(message);
  return state.digest();
}

/** crypto.subtle 的 HMAC-SHA 系列 */
export async function hmacSha(algorithm, key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, message));
}

/** 一次性计算全部 5 种 HMAC：{ md5, sha1, sha256, sha384, sha512 } */
export async function computeHmacs(key, bytes) {
  const hmacs = { md5: hmacMd5(key, bytes) };
  for (const id of SUBTLE_IDS) {
    hmacs[id] = await hmacSha(SUBTLE_NAMES[id], key, bytes);
  }
  return hmacs;
}

/* ==================== 密钥解析 ==================== */

/** 十六进制字符 → 数值，非法返回 -1 */
function hexValue(code) {
  if (code >= 0x30 && code <= 0x39) return code - 0x30; // 0-9
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10; // a-f
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10; // A-F
  return -1;
}

/**
 * 按格式解析密钥文本 → Uint8Array。非法输入抛中文 Error（指出位置）。
 * @param {string} text
 * @param {'utf8'|'hex'|'base64'} format
 */
export function parseKey(text, format) {
  if (typeof text !== 'string') throw new Error('密钥必须是字符串');

  if (format === 'utf8') {
    return textToBytes(text);
  }

  if (format === 'hex') {
    // 允许字节间空白（换行也容忍）；有效字符须为偶数个
    let compact = '';
    for (const ch of text) {
      if (/\s/.test(ch)) continue;
      compact += ch;
    }
    if (compact === '') return new Uint8Array(0);
    if (compact.length % 2 !== 0) {
      throw new Error(`十六进制密钥长度非法：有效字符 ${compact.length} 个，必须成对（偶数）`);
    }
    const out = new Uint8Array(compact.length / 2);
    for (let i = 0; i < compact.length; i += 2) {
      const hi = hexValue(compact.charCodeAt(i));
      if (hi < 0) throw new Error(`十六进制密钥包含非法字符「${compact[i]}」（第 ${i + 1} 个字符）`);
      const lo = hexValue(compact.charCodeAt(i + 1));
      if (lo < 0) throw new Error(`十六进制密钥包含非法字符「${compact[i + 1]}」（第 ${i + 2} 个字符）`);
      out[i / 2] = (hi << 4) | lo;
    }
    return out;
  }

  if (format === 'base64') {
    // 容忍空白与缺失的 = 填充；同时接受标准与 URL 安全字母表。
    // 先校验「=」只出现在结尾（最多 2 个），再校验其余字符集，保证错误信息准确。
    const core = text.replace(/\s+/g, '');
    if (core === '') return new Uint8Array(0);
    const body = core.replace(/=+$/, '');
    const padding = core.length - body.length;
    if (padding > 2) throw new Error('Base64 密钥的「=」填充不能超过 2 个');
    if (body.includes('=')) throw new Error('Base64 密钥的「=」只能出现在结尾');
    for (let i = 0; i < body.length; i++) {
      if (!/[A-Za-z0-9+/_-]/.test(body[i])) {
        throw new Error(`Base64 密钥包含非法字符「${body[i]}」（第 ${i + 1} 个有效字符）`);
      }
    }
    if (body.length % 4 === 1) {
      throw new Error(`Base64 密钥长度非法：有效字符 ${body.length} 个，除以 4 余 1，无法解码`);
    }
    let normalized = body.replaceAll('-', '+').replaceAll('_', '/');
    normalized += '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(normalized);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  throw new Error(`未知的密钥格式：${format}`);
}

/* ==================== 输出格式 ==================== */

const HEX_CHARS = '0123456789abcdef';

/** 字节 → 十六进制字符串 */
export function bytesToHex(bytes, { upper = false } = {}) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += HEX_CHARS[bytes[i] >> 4] + HEX_CHARS[bytes[i] & 0xf];
  }
  return upper ? out.toUpperCase() : out;
}

/** 字节 → Base64（分块拼接，避免大输入时 apply 溢出） */
export function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 按输出格式渲染摘要 */
export function formatDigest(bytes, format) {
  switch (format) {
    case 'hex-upper':
      return bytesToHex(bytes, { upper: true });
    case 'base64':
      return bytesToBase64(bytes);
    case 'hex-lower':
    default:
      return bytesToHex(bytes);
  }
}

/* ==================== 比对 ==================== */

/**
 * 比对期望值与各摘要：忽略首尾空白；十六进制再忽略大小写；
 * 十六进制与 Base64 两种粘贴形式都接受（Base64 区分大小写）。
 *
 * @param {string} expected 期望值文本
 * @param {{ id: string, bytes: Uint8Array | null }[]} entries 参与比对的摘要
 * @returns {{ active: boolean, matches: Record<string, boolean>, matched: string[] }}
 */
export function compareDigests(expected, entries) {
  const trimmed = String(expected ?? '').trim();
  const asHex = trimmed.toLowerCase();
  const matches = {};
  const matched = [];
  for (const entry of entries) {
    const bytes = entry.bytes;
    const ok =
      trimmed !== '' &&
      bytes instanceof Uint8Array &&
      (asHex === bytesToHex(bytes) || trimmed === bytesToBase64(bytes));
    matches[entry.id] = ok;
    if (ok) matched.push(entry.id);
  }
  return { active: trimmed !== '', matches, matched };
}

/* ==================== 展示辅助 ==================== */

/** 文件大小的人类可读形式（全中文界面：< 1KB 显示「N 字节」） */
export function formatFileSize(n) {
  if (!Number.isFinite(n) || n < 0) return '0 字节';
  if (n < 1024) return `${n} 字节`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 文件大小校验：超限返回中文错误信息，否则返回 null */
export function checkFileSize(size) {
  if (size > MAX_FILE_BYTES) {
    return `文件过大：${formatFileSize(size)}，超过 ${formatFileSize(MAX_FILE_BYTES)} 上限`;
  }
  return null;
}
