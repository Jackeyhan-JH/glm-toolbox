/**
 * URL 编解码 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 对外能力（见 issue #8）：
 *   - 编码：组件（encodeURIComponent）/ 完整 URL（encodeURI）两种模式，
 *     可选「空格编码为 +（表单格式）」；
 *   - 解码：可选「+ 当作空格」，失败时返回中文原因与出错位置（第 N 个字符起，按码点计）；
 *   - URL 解析：输入完整 URL 或纯查询字符串，拆出协议 / 用户信息 / 主机 / 端口 /
 *     路径（原样 + 解码后）/ 查询参数（键值均解码、重复键保留）/ hash；
 *   - 参数重建：由编辑后的参数行数组重新拼出查询字符串与完整 URL；
 *   - fullyDecode：把一段文本里的 %-转义全部解码显示（尽力而为，失败的原样保留）。
 */

const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const encoder = new TextEncoder();

/** 编码模式（工具页的分段切换与文档共用） */
export const ENCODE_MODES = [
  { id: 'component', label: '组件（encodeURIComponent）' },
  { id: 'uri', label: '完整 URL（encodeURI）' },
];

/* ==================== 编码 ==================== */

/**
 * 编码文本。
 * @param {string} text
 * @param {{ mode?: 'component' | 'uri', plusForSpace?: boolean }} [options]
 *   mode          component = encodeURIComponent（默认），uri = encodeURI
 *   plusForSpace  true 时把结果里的 %20 换成 +（application/x-www-form-urlencoded 表单格式）
 * @returns {string}
 */
export function encodeText(text, { mode = 'component', plusForSpace = false } = {}) {
  if (text === '') return '';
  let encoded = mode === 'uri' ? encodeURI(text) : encodeURIComponent(text);
  if (plusForSpace) encoded = encoded.replace(/%20/g, '+');
  return encoded;
}

/* ==================== 解码（带中文错误与位置） ==================== */

/**
 * 解码文本。语义与 decodeURIComponent 一致（%-转义与普通字符都按 UTF-8 字节解释），
 * 但失败时给出中文原因与位置，而不是抛 URIError。
 *
 * @param {string} text
 * @param {{ plusAsSpace?: boolean }} [options] plusAsSpace 为 true 时先把 + 替换成空格
 * @returns {{ ok: true, value: string } | { ok: false, message: string, position: number }}
 *   position 为 1 起的字符位置（按 Unicode 码点计），指向出错的 %-转义或字符
 */
export function decodeText(text, { plusAsSpace = false } = {}) {
  const source = plusAsSpace ? text.replace(/\+/g, ' ') : text;

  // 1) 汇总字节流：合法的 %-转义贡献其字节，普通字符贡献自身的 UTF-8 字节；
  //    positions[k] 记录第 k 个字节来自第几个字符（1 起），用于错误定位。
  const bytes = [];
  const positions = [];
  const chars = [...source];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === '%') {
      const hex = `${chars[i + 1] ?? ''}${chars[i + 2] ?? ''}`;
      if (!HEX_PAIR.test(hex)) {
        return { ok: false, message: `% 后缺少两位十六进制数字（第 ${i + 1} 个字符起）`, position: i + 1 };
      }
      bytes.push(parseInt(hex, 16));
      positions.push(i + 1);
      i += 3;
    } else {
      for (const byte of encoder.encode(ch)) {
        bytes.push(byte);
        positions.push(i + 1);
      }
      i += 1;
    }
  }

  // 2) 按严格 UTF-8 规则解码字节流（非法 / 截断 / 代理区 / 过长编码都报错）
  return decodeUtf8(bytes, positions);
}

/** 严格 UTF-8 解码；出错时 message 带上来源位置 */
function decodeUtf8(bytes, positions) {
  const fail = (index, prefix) => ({
    ok: false,
    message: `${prefix}（第 ${positions[index]} 个字符起）`,
    position: positions[index],
  });
  const INCOMPLETE = '不完整的百分号编码 / 非法 UTF-8 序列';
  const INVALID = '非法 UTF-8 序列';

  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i];
    if (lead < 0x80) {
      out += String.fromCharCode(lead);
      i += 1;
      continue;
    }
    let need;
    if (lead >= 0xc2 && lead <= 0xdf) need = 2;
    else if (lead >= 0xe0 && lead <= 0xef) need = 3;
    else if (lead >= 0xf0 && lead <= 0xf4) need = 4;
    else return fail(i, INVALID);

    if (i + need > bytes.length) return fail(i, INCOMPLETE);

    let cp = lead & (need === 2 ? 0x1f : need === 3 ? 0x0f : 0x07);
    for (let k = 1; k < need; k += 1) {
      const byte = bytes[i + k];
      if ((byte & 0xc0) !== 0x80) return fail(i, INCOMPLETE);
      cp = (cp << 6) | (byte & 0x3f);
    }
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || (need === 3 && cp < 0x800) || (need === 4 && cp < 0x10000)) {
      return fail(i, INVALID);
    }
    out += String.fromCodePoint(cp);
    i += need;
  }
  return { ok: true, value: out };
}

/**
 * 尽力解码：先严格解码，失败（如包含非法转义）时逐段解码、能解多少解多少。
 * 用于「路径（解码后）」「全部解码显示」等展示场景，绝不抛错。
 */
export function decodeBestEffort(text) {
  const strict = decodeText(text);
  if (strict.ok) return strict.value;
  // 按连续的 %-转义分段，逐段严格解码，失败的原样保留
  let out = '';
  let last = 0;
  for (const match of text.matchAll(/(?:%[0-9A-Fa-f]{2})+/g)) {
    out += text.slice(last, match.index);
    const piece = decodeText(match[0]);
    out += piece.ok ? piece.value : match[0];
    last = match.index + match[0].length;
  }
  return out + text.slice(last);
}

/* ==================== URL / 查询字符串解析 ==================== */

/**
 * 解析输入：自动识别「完整 URL」或「纯查询字符串」。
 *
 * @param {string} input
 * @returns 成功：
 *   { ok: true, mode: 'url', parts: {...}, params: [{key, value}] }
 *     parts = { protocol, username, password, hostname, port,
 *               pathname, pathnameDecoded, search, hash, prefix, href }
 *     prefix 为去掉查询串与 hash 之后的部分，重建 URL 时直接复用；
 *   { ok: true, mode: 'query', parts: null, params: [...] }
 * 失败：{ ok: false, message }（中文提示）
 */
export function parseInput(input) {
  const trimmed = String(input ?? '').trim();
  if (trimmed === '') {
    return { ok: false, message: '请输入完整的 URL（如 https://example.com/?a=1）或查询字符串（如 a=1&b=2）' };
  }
  if (trimmed.startsWith('?')) {
    return { ok: true, mode: 'query', parts: null, params: parseQuery(trimmed) };
  }
  if (SCHEME_RE.test(trimmed)) return parseUrl(trimmed);
  // 没有 /、? 但含 = 的（如 a=1&b=2）按查询字符串处理
  if (!trimmed.includes('/') && !trimmed.includes('?') && trimmed.includes('=')) {
    return { ok: true, mode: 'query', parts: null, params: parseQuery(trimmed) };
  }
  return { ok: false, message: '不是完整 URL（缺少协议，如 https://）' };
}

/** 用 WHATWG URL 解析带协议的地址 */
function parseUrl(trimmed) {
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: '无法解析此 URL：格式不合法' };
  }
  const { search, hash, href } = url;
  return {
    ok: true,
    mode: 'url',
    parts: {
      protocol: url.protocol,
      username: url.username,
      password: url.password,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      pathnameDecoded: decodeBestEffort(url.pathname),
      search,
      hash,
      href,
      prefix: href.slice(0, href.length - search.length - hash.length),
    },
    params: [...url.searchParams].map(([key, value]) => ({ key, value })),
  };
}

/**
 * 解析查询字符串（可带前导 ?）。键值均已解码（+ 也按空格处理），
 * 重复键保留多行，无 = 的段（如 flag）值为空。
 * @returns {{ key: string, value: string }[]}
 */
export function parseQuery(query) {
  const qs = String(query ?? '').trim().replace(/^[?]+/, '');
  if (qs === '') return [];
  return [...new URLSearchParams(qs)].map(([key, value]) => ({ key, value }));
}

/* ==================== 重建 ==================== */

/**
 * 把参数行数组拼成查询字符串。键值用 encodeURIComponent 编码；
 * 键值都为空的行（用户新增后没填的）跳过，键非空值空的行保留（如 empty=）。
 * @param {{ key: string, value: string }[]} params
 */
export function buildQuery(params) {
  return (params ?? [])
    .filter((p) => p && (p.key !== '' || p.value !== ''))
    .map(({ key, value }) => `${encodeURIComponent(key ?? '')}=${encodeURIComponent(value ?? '')}`)
    .join('&');
}

/**
 * 用编辑后的参数行重建结果。
 * @param {ReturnType<parseInput>} parsed parseInput 的成功结果
 * @param {{ key: string, value: string }[]} params 编辑后的参数行
 * @returns {string} URL 模式返回完整 URL（含 hash），查询串模式只返回查询字符串
 */
export function rebuildUrl(parsed, params) {
  if (!parsed || !parsed.ok) return '';
  const query = buildQuery(params);
  if (parsed.mode === 'query') return query;
  return `${parsed.parts.prefix}${query ? `?${query}` : ''}${parsed.parts.hash}`;
}
