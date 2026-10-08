/**
 * JWT 解析 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 约定（见 issue #11）：
 *   - 输入自动去掉开头的 Bearer 前缀（不区分大小写）与所有空白字符；
 *   - JWT 由 3 段组成（以 . 分隔），各段按 Base64URL 严格解码（只接受
 *     A-Z a-z 0-9 - _ 与结尾的 = 填充），UTF-8 解码后必须是 JSON 对象；
 *   - 出错时给出中文提示并指明是第几段（头部 / 载荷 / 签名）出了什么问题；
 *   - 时间类声明（exp / nbf / iat）按注入的 now（Unix 秒）计算状态徽标与相对时间；
 *   - HS256 / HS384 / HS512 用 crypto.subtle 的 HMAC 验签（浏览器与 Node 22
 *     中均为全局对象，不涉及 DOM）；RS / ES / PS 等非对称算法只解析、不验签。
 *
 * btoa / atob / TextEncoder / TextDecoder / crypto 在浏览器与 Node 22 中都是
 * 全局可用，不涉及 DOM，因此本模块仍是纯逻辑。
 */

/* ==================== 标准声明 ==================== */

/** 注册声明（RFC 7519）的中文说明；time: true 表示是 NumericDate 时间类声明 */
export const CLAIM_INFO = {
  iss: { label: '签发者', description: 'Issuer，签发该 JWT 的一方' },
  sub: { label: '主题', description: 'Subject，JWT 所代表的主体（通常是用户 ID）' },
  aud: { label: '受众', description: 'Audience，该 JWT 的预期接收方' },
  exp: { label: '过期时间', time: true, description: 'Expiration Time，超过此时间后令牌失效' },
  nbf: { label: '生效时间', time: true, description: 'Not Before，在此之前令牌不应被接受' },
  iat: { label: '签发时间', time: true, description: 'Issued At，令牌的签发时刻' },
  jti: { label: '编号', description: 'JWT ID，令牌的唯一标识' },
};

/** 支持验签的算法 → crypto.subtle 的哈希名 */
const HMAC_HASH = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };

/** alg → 算法家族（HS / RS / PS / ES / none / other） */
export function algFamily(alg) {
  if (alg === 'none') return 'none';
  if (/^(HS|RS|PS|ES)/.test(alg)) return alg.slice(0, 2);
  return 'other';
}

/* ==================== 输入规整 ==================== */

/**
 * 规整用户输入：去掉首尾空白、开头的 Bearer 前缀（不区分大小写），
 * 以及正文中的所有空白（换行粘贴等场景）。空输入返回 ''。
 */
export function normalizeToken(input) {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .replace(/^bearer\s+/i, '')
    .replace(/\s+/g, '');
}

/* ==================== Base64URL / Base64 解码 ==================== */

/** 字符码是否属于 Base64URL 字母表 */
function isUrlCode(code) {
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x2d || // -
    code === 0x5f // _
  );
}

/** 字母表内字符（含 = 填充与可选空白）→ 字节；错误信息前缀为 errorPrefix */
function coreToBytes(core, errorPrefix) {
  const rem = core.length % 4;
  if (rem === 1) {
    throw new Error(`${errorPrefix}：有效长度不正确（共 ${core.length} 个字符，除以 4 余 1，无法解码）`);
  }
  let normalized = core.replaceAll('-', '+').replaceAll('_', '/');
  normalized += '='.repeat((4 - rem) % 4);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 扫描一段输入，提取字母表内字符；errorPrefix 用于拼错误信息 */
function scanAlphabet(input, { extraCodes = [], errorPrefix }) {
  let core = '';
  let firstPadding = -1;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const code = input.charCodeAt(i);
    if (isUrlCode(code) || extraCodes.includes(code)) {
      if (firstPadding !== -1) {
        throw new Error(`${errorPrefix}：包含非法字符「=」（第 ${firstPadding + 1} 个字符），填充后不能还有其他字符`);
      }
      core += ch;
      continue;
    }
    if (code === 0x3d) {
      // '=' 只允许出现在结尾
      if (firstPadding === -1) firstPadding = i;
      continue;
    }
    if (/\s/.test(ch)) continue;
    throw new Error(`${errorPrefix}：包含非法字符「${ch}」（第 ${i + 1} 个字符）`);
  }
  return core;
}

/** JWT 段（严格 Base64URL）→ 字节；errorPrefix 形如「第 2 段（载荷）解码失败」 */
export function decodeSegment(segment, errorPrefix) {
  return coreToBytes(scanAlphabet(segment, { errorPrefix }), errorPrefix);
}

/** 验签密钥 → 字节。base64 为 true 时按（宽容的）Base64 解码，否则按 UTF-8 文本 */
export function decodeKey(text, { base64 = false } = {}) {
  if (typeof text !== 'string') throw new Error('密钥必须是字符串');
  if (!base64) return new TextEncoder().encode(text);
  // 同时接受标准与 URL 安全字母表、空白与缺失 / 多余的填充
  const core = scanAlphabet(text, { extraCodes: [0x2b, 0x2f], errorPrefix: '密钥不是合法的 Base64' });
  return coreToBytes(core, '密钥不是合法的 Base64');
}

/** 字节 → 连续小写十六进制串 */
export function bytesToHex(bytes) {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/* ==================== 解析 ==================== */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function utf8Text(bytes) {
  return new TextDecoder().decode(bytes);
}

/**
 * 解析 JWT。
 * @param {string} raw 用户输入（自动规整）
 * @returns {{
 *   ok: true,
 *   token: string, segments: [string, string, string],
 *   header: object, payload: object, headerJson: string, payloadJson: string,
 *   signature: { base64Url: string, bytes: Uint8Array, hex: string, byteLength: number },
 *   headerByteLength: number, payloadByteLength: number,
 *   alg: string, algFamily: string, warnings: Array<{ code: string, text: string }>,
 * } | { ok: false, error: string }}
 */
export function parseToken(raw) {
  const token = normalizeToken(raw);
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, error: `JWT 应由 3 段组成（以 . 分隔），当前为 ${parts.length} 段` };
  }

  const SEGMENTS = [
    ['第 1 段（头部）', 0],
    ['第 2 段（载荷）', 1],
    ['第 3 段（签名）', 2],
  ];
  let headerBytes;
  let payloadBytes;
  let signatureBytes;
  try {
    headerBytes = decodeSegment(parts[0], `${SEGMENTS[0][0]}解码失败`);
    payloadBytes = decodeSegment(parts[1], `${SEGMENTS[1][0]}解码失败`);
    signatureBytes = decodeSegment(parts[2], `${SEGMENTS[2][0]}解码失败`);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  let header;
  let payload;
  try {
    header = JSON.parse(utf8Text(headerBytes));
  } catch {
    return { ok: false, error: '第 1 段（头部）不是合法 JSON' };
  }
  if (!isPlainObject(header)) return { ok: false, error: '第 1 段（头部）不是 JSON 对象' };
  try {
    payload = JSON.parse(utf8Text(payloadBytes));
  } catch {
    return { ok: false, error: '第 2 段（载荷）不是合法 JSON' };
  }
  if (!isPlainObject(payload)) return { ok: false, error: '第 2 段（载荷）不是 JSON 对象' };

  const alg = typeof header.alg === 'string' ? header.alg : '';
  const warnings = [];
  if (alg === 'none') {
    warnings.push({
      code: 'alg-none',
      text: '安全警告：该 JWT 的 alg 为 none（未签名），内容可被任意伪造，请勿在生产环境信任此类令牌。',
    });
  }
  if (alg === '') {
    warnings.push({ code: 'alg-missing', text: '头部缺少 alg 声明，无法确定签名算法。' });
  }

  return {
    ok: true,
    token,
    segments: parts,
    header,
    payload,
    headerJson: JSON.stringify(header, null, 2),
    payloadJson: JSON.stringify(payload, null, 2),
    signature: {
      base64Url: parts[2],
      bytes: signatureBytes,
      hex: bytesToHex(signatureBytes),
      byteLength: signatureBytes.length,
    },
    headerByteLength: headerBytes.length,
    payloadByteLength: payloadBytes.length,
    alg,
    algFamily: algFamily(alg),
    warnings,
  };
}

/* ==================== 时间 ==================== */

/** 取 NumericDate 声明的数值（接受数字或数字字符串），不合法返回 null */
export function toTimeClaim(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** 时长的人类可读形式（四舍五入到所选单位，进位到上一级，如 60 分钟 → 1 小时） */
const DURATION_UNITS = [
  { name: '年', seconds: 365 * 86400 },
  { name: '个月', seconds: 30 * 86400 },
  { name: '天', seconds: 86400 },
  { name: '小时', seconds: 3600 },
  { name: '分钟', seconds: 60 },
  { name: '秒', seconds: 1 },
];

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  let idx = DURATION_UNITS.findIndex((u) => s >= u.seconds);
  if (idx === -1) return '0 秒';
  let n = Math.round(s / DURATION_UNITS[idx].seconds);
  if (idx > 0 && n * DURATION_UNITS[idx].seconds >= DURATION_UNITS[idx - 1].seconds) {
    idx -= 1;
    n = Math.round(s / DURATION_UNITS[idx].seconds);
  }
  return `${n} ${DURATION_UNITS[idx].name}`;
}

/** Unix 秒 → 「YYYY-MM-DD HH:mm:ss」（offsetMinutes 为相对 UTC 的分钟偏移，0 即 UTC） */
export function formatUnixTime(seconds, offsetMinutes = 0) {
  if (!Number.isFinite(seconds)) return '';
  const d = new Date(seconds * 1000 + offsetMinutes * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** UTC 偏移 → 标签（UTC+8 / UTC-5 / UTC+5:30 / UTC） */
export function offsetLabel(offsetMinutes) {
  if (offsetMinutes === 0) return 'UTC';
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`}`;
}

/** atSeconds 时刻所在环境的本地 UTC 偏移（分钟）；测试请显式传 offsetMinutes */
export function localOffsetMinutes(atSeconds = Math.floor(Date.now() / 1000)) {
  return -new Date(atSeconds * 1000).getTimezoneOffset();
}

/** 相对时间描述：「30 分钟后」/「2 天前」 */
export function describeRelative(atSeconds, now) {
  const diff = atSeconds - now;
  return diff >= 0 ? `${formatDuration(diff)}后` : `${formatDuration(-diff)}前`;
}

/**
 * 状态徽标（基于注入的 now，Unix 秒）。
 * 优先级：已过期 > 尚未生效 > 有效；无 exp 时视为有效但无法判断过期时间。
 * @returns {{ state: 'valid'|'expired'|'not-yet-valid', label: string, detail: string }}
 */
export function getTokenStatus(payload, now) {
  const exp = toTimeClaim(payload?.exp);
  const nbf = toTimeClaim(payload?.nbf);
  if (exp !== null && now >= exp) {
    return { state: 'expired', label: '已过期', detail: `已过期 ${formatDuration(now - exp)}` };
  }
  if (nbf !== null && now < nbf) {
    return { state: 'not-yet-valid', label: '尚未生效', detail: `距生效还有 ${formatDuration(nbf - now)}` };
  }
  if (exp !== null) {
    return { state: 'valid', label: '有效', detail: `${formatDuration(exp - now)}后过期` };
  }
  return { state: 'valid', label: '有效', detail: '未声明 exp，无法判断过期时间' };
}

/**
 * 载荷声明逐条标注（保持原始顺序），时间类声明附带本地 / UTC / 相对时间。
 * @param {object} payload
 * @param {number} now Unix 秒
 * @param {number} [offsetMinutes] 本地 UTC 偏移（分钟），缺省取运行环境
 * @returns {Array<{ key: string, valueText: string, known: boolean, label?: string,
 *            time?: { unix: number, local: string, localLabel: string, utc: string, relative: string } }>}
 */
export function annotateClaims(payload, now, offsetMinutes = localOffsetMinutes(now)) {
  const entries = [];
  for (const [key, value] of Object.entries(payload ?? {})) {
    const info = CLAIM_INFO[key] ?? null;
    const entry = { key, valueText: JSON.stringify(value), known: Boolean(info) };
    if (info) entry.label = info.label;
    if (info?.time) {
      const t = toTimeClaim(value);
      if (t !== null) {
        entry.time = {
          unix: t,
          local: formatUnixTime(t, offsetMinutes),
          localLabel: offsetLabel(offsetMinutes),
          utc: formatUnixTime(t, 0),
          relative: describeRelative(t, now),
        };
      }
    }
    entries.push(entry);
  }
  return entries;
}

/* ==================== 验签（HS 系列） ==================== */

/** 恒定时间比较，避免时序侧信道 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 用 crypto.subtle 的 HMAC 计算 `header.payload` 的签名并与给定字节比较 */
export async function verifyHmacSignature(segments, signatureBytes, keyBytes, hashName) {
  const data = new TextEncoder().encode(`${segments[0]}.${segments[1]}`);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: hashName }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  return timingSafeEqual(mac, signatureBytes);
}

const VERIFY_KIND_CLASS = {
  valid: 'ok',
  invalid: 'bad',
  'key-error': 'bad',
  unsupported: 'warn',
  unsigned: 'warn',
  'empty-key': 'hint',
};

/**
 * 验签（可选）。返回 { kind, message }：
 *   valid / invalid    HS 系列验签结果
 *   empty-key          尚未输入密钥（提示输入）
 *   key-error          密钥不是合法的 Base64
 *   unsupported        该算法不支持验签（RS / ES / PS / 未知 / 缺少 alg）
 *   unsigned           alg 为 none，未签名
 */
export async function verifyToken(parsed, keyText, { base64 = false } = {}) {
  const kindClass = (kind) => VERIFY_KIND_CLASS[kind];
  const alg = typeof parsed?.header?.alg === 'string' ? parsed.header.alg : '';
  if (alg === '') {
    return { kind: 'unsupported', message: '头部缺少 alg 声明，无法验签，仅解析', kindClass: kindClass('unsupported') };
  }
  if (algFamily(alg) === 'none') {
    return { kind: 'unsigned', message: '该 JWT 未签名（alg 为 none），无需验签', kindClass: kindClass('unsigned') };
  }
  if (!(alg in HMAC_HASH)) {
    return { kind: 'unsupported', message: `暂不支持该算法（${alg}）验签，仅解析`, kindClass: kindClass('unsupported') };
  }
  if (typeof keyText !== 'string' || keyText.trim() === '') {
    return { kind: 'empty-key', message: '输入密钥后自动验签', kindClass: kindClass('empty-key') };
  }
  let keyBytes;
  try {
    keyBytes = decodeKey(keyText, { base64 });
  } catch (err) {
    return { kind: 'key-error', message: err.message, kindClass: kindClass('key-error') };
  }
  const valid = await verifyHmacSignature(parsed.segments, parsed.signature.bytes, keyBytes, HMAC_HASH[alg]);
  return valid
    ? { kind: 'valid', message: '签名有效', kindClass: kindClass('valid') }
    : { kind: 'invalid', message: '签名无效', kindClass: kindClass('invalid') };
}
