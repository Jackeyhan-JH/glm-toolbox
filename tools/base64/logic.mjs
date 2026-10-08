/**
 * Base64 编解码 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 约定（见 issue #7）：
 *   - 文本按 UTF-8 编解码；
 *   - 「URL 安全」输出：+ → -、/ → _，去掉 = 填充；
 *   - 解码容忍空白 / 换行、缺失或多余的 = 填充，同时接受标准与 URL 安全字母表；
 *   - 解码结果不是合法 UTF-8 时返回 error: '解码结果不是有效的 UTF-8 文本' 与原始字节，
 *     由界面提供「下载为文件」与十六进制预览（前 256 字节）；
 *   - 文件 ≤ 20MB；输出区超长时只显示前 1 万字符（完整内容可复制 / 下载）。
 *
 * btoa / atob / TextEncoder / TextDecoder 在浏览器与 Node 22 中都是全局可用，
 * 不涉及 DOM，因此本模块仍是纯逻辑。
 */

/** 标准 + URL 安全字母表（解码时两者都接受） */
const WHITESPACE = /\s/;

/** 字符码是否属于 Base64 字母表（标准 + URL 安全） */
function isBase64Code(code) {
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x2b || // +
    code === 0x2f || // /
    code === 0x2d || // -
    code === 0x5f // _
  );
}

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** 输出区最多显示的字符数（超出截断，完整内容可复制 / 下载） */
export const DISPLAY_LIMIT = 10000;
/** 十六进制预览最多显示的字节数 */
export const HEX_PREVIEW_LIMIT = 256;

/* ==================== 编码 ==================== */

/** Uint8Array → Base64（分块拼接，避免大文件时 apply 溢出调用栈） */
export function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 文本 → Base64（UTF-8）。
 * @param {string} text
 * @param {{ urlSafe?: boolean }} [options] urlSafe：+ → -、/ → _、去掉 = 填充
 */
export function encodeText(text, { urlSafe = false } = {}) {
  if (text === '') return '';
  let b64 = bytesToBase64(new TextEncoder().encode(text));
  if (urlSafe) {
    b64 = b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }
  return b64;
}

/* ==================== 解码 ==================== */

/**
 * Base64（字符串）→ 字节。容忍空白与换行、缺失 / 多余的 = 填充、
 * 标准与 URL 安全两种字母表；非法输入抛中文 Error（指明非法字符位置）。
 * @param {string} input
 * @returns {Uint8Array}
 */
export function decodeBytes(input) {
  if (typeof input !== 'string') {
    throw new Error('输入必须是字符串');
  }

  // 单趟扫描：跳过空白；= 只能出现在结尾（记录首个 = 的位置，其后若再出现
  // 有效字符则报 = 非法）；其余字符必须在两种字母表的并集内。
  // 热路径（字母表内字符）只做字符码比较，保证大输入也够快。
  let core = '';
  let firstPadding = -1;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (isBase64Code(code)) {
      if (firstPadding !== -1) {
        throw new Error(`包含非法字符「=」（第 ${firstPadding + 1} 个字符）：填充后不能还有其他字符`);
      }
      core += input[i];
      continue;
    }
    if (code === 0x3d) {
      // '='
      if (firstPadding === -1) firstPadding = i;
      continue;
    }
    if (WHITESPACE.test(input[i])) continue;
    throw new Error(`包含非法字符「${input[i]}」（第 ${i + 1} 个字符）`);
  }

  const rem = core.length % 4;
  if (rem === 1) {
    throw new Error(`Base64 长度不正确：有效字符共 ${core.length} 个，除以 4 余 1，无法解码`);
  }

  // URL 安全字母表归一化为标准字母表，再补齐缺失的填充
  let normalized = core.replaceAll('-', '+').replaceAll('_', '/');
  normalized += '='.repeat((4 - rem) % 4);

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Base64 → 文本（UTF-8，严格模式）。
 * @param {string} input
 * @returns {{ ok: true, text: string, bytes: Uint8Array } | { ok: false, error: string, bytes: Uint8Array | null }}
 *          输入非法时 bytes 为 null；字节合法但不是 UTF-8 时 bytes 保留，供下载 / 十六进制预览。
 */
export function decodeText(input) {
  let bytes;
  try {
    bytes = decodeBytes(input);
  } catch (err) {
    return { ok: false, error: err.message, bytes: null };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, text, bytes };
  } catch {
    return { ok: false, error: '解码结果不是有效的 UTF-8 文本', bytes };
  }
}

/* ==================== data URL / MIME ==================== */

/**
 * 解析 data URL（`data:<mime>;base64,<数据>`）。不是 data URL 时返回 null
 * （调用方按纯 Base64 处理）。数据部分允许包含空白（解码时会容忍）。
 * @returns {{ mime: string, base64: string } | null}
 */
export function parseDataUrl(input) {
  if (typeof input !== 'string' || !input.trimStart().startsWith('data:')) return null;
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(input.trim());
  if (!m || !m[2]) return null; // 只支持 base64 形式的 data URL
  return { mime: m[1] === '' ? 'application/octet-stream' : m[1], base64: m[3] };
}

/** `data:<mime>;base64,<数据>` */
export function toDataUrl(mime, base64) {
  return `data:${mime};base64,${base64}`;
}

/**
 * 按魔数猜测图片 MIME（PNG / JPEG / GIF / WebP / BMP / SVG），识别不出返回 null。
 */
export function detectImageMime(bytes) {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return 'image/gif';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return 'image/webp';
  }
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) {
    return 'image/bmp';
  }
  // SVG 是文本格式：开头（允许 BOM / 空白 / <?xml 声明）出现 <svg
  let head = '';
  for (let i = 0; i < Math.min(b.length, 512); i++) {
    const c = b[i];
    if (c === 0 || c > 0x7f) break; // 二进制内容不当作 SVG
    head += String.fromCharCode(c);
  }
  const compact = head.replace(/<!--[\s\S]*?-->/g, '').trimStart();
  if (compact.startsWith('<svg') || (compact.startsWith('<?xml') && compact.includes('<svg'))) {
    return 'image/svg+xml';
  }
  return null;
}

/** MIME → 常用扩展名（下载图片时用作默认文件名） */
export function mimeToExtension(mime) {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  };
  return map[mime] ?? 'bin';
}

/* ==================== 展示辅助 ==================== */

/**
 * 十六进制预览（默认前 256 字节，小写、空格分隔）。
 * @returns {{ hex: string, truncated: boolean, totalBytes: number }}
 */
export function hexPreview(bytes, limit = HEX_PREVIEW_LIMIT) {
  const shown = bytes.subarray(0, limit);
  let hex = '';
  for (let i = 0; i < shown.length; i++) {
    if (i > 0) hex += ' ';
    hex += shown[i].toString(16).padStart(2, '0');
  }
  return { hex, truncated: bytes.length > limit, totalBytes: bytes.length };
}

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

/**
 * 输出区截断（默认前 1 万字符）。
 * @returns {{ text: string, truncated: boolean }}
 */
export function truncateForDisplay(text, limit = DISPLAY_LIMIT) {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

/** UTF-8 字节数（用于「输入 / 输出字节数」统计） */
export function utf8ByteLength(text) {
  return new TextEncoder().encode(text).length;
}
