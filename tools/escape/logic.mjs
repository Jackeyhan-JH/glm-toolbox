/**
 * 转义工具 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 三类转换（见 issue #9）：
 *   1. HTML 实体
 *      - escapeHtml 三种模式：「仅必要字符」（& < > " '）/「非 ASCII 全转 &#x…;」（小写十六进制，
 *        必要字符同样转义，产物是纯 ASCII）/「优先命名实体」（反查 NAMED_ENTITIES，无命名的字符原样保留）。
 *      - unescapeHtml 识别命名实体（HTML 4.01 全部 252 个 + &apos;）、十进制 &#…;、十六进制 &#x…;，
 *        一律要求以 ; 结尾；未知或非法实体（含 0、代理项、超出 U+10FFFF 的数值引用、缺分号）原样保留。
 *        完全基于实体表逐字符实现，绝不借助 innerHTML 解析用户输入（防 XSS）。
 *   2. Unicode
 *      - escapeUnicode 五种输出格式：\uXXXX（超出 BMP 拆代理对）/ \u{XXXXX} / U+XXXX（空格分隔，
 *        该格式始终转换全部字符，与「只转非 ASCII」无关）/ &#x…; / CSS \XXXX （至少 4 位 + 一个空格）。
 *        选项：onlyNonAscii（默认开）、upperHex（默认开）。
 *      - unescapeUnicode 识别以上全部格式（可混合）外加十进制 &#…;；无法识别的内容原样保留；
 *        不成对的代理项转义按原文保留并返回 warning「存在不成对的代理项」，不抛异常。
 *   3. JS / JSON 字符串
 *      - escapeJsString：文本 → 合法双引号字符串内容（\" \\ \b \f \n \r \t，其余控制字符与 DEL 用
 *        小写 \u00xx；孤代理按 \udxxx 转义，保证产物可被 JSON.parse 还原，行为对齐 JSON.stringify）。
 *      - unescapeJsString：反向还原，支持 \" \\ \/ \b \f \n \r \t \uXXXX（相邻代理对合并）\xNN \0；
 *        非法转义抛中文 Error 并指明位置（第 N 个字符）。
 *
 * 另有字符明细（码点 + UTF-8 字节）与展示截断辅助。所有转换均为 O(n) 单趟扫描。
 */

/* ==================== 常量 ==================== */

/** 输出区最多显示的字符数（超出截断，完整内容可复制 / 下载） */
export const DISPLAY_LIMIT = 10000;
/** 字符明细最多列出的字符数 */
export const DETAILS_LIMIT = 200;

const MAX_CODE_POINT = 0x10ffff;
const HIGH_MIN = 0xd800; // 高代理项下界
const LOW_MIN = 0xdc00; // 低代理项下界
const SURROGATE_MAX = 0xdfff; // 代理项上界

/* ==================== HTML 实体表 ==================== */

/**
 * HTML 4.01 全部 252 个命名实体 + &apos;（HTML5 / XML，规格要求包含），共 253 个。
 * 键为实体名（不含 & 与 ;），值为对应字符；源码用 \uXXXX 书写，保证本文件是纯 ASCII。
 */
export const NAMED_ENTITIES = {
  quot: '\u0022',
  amp: '\u0026',
  apos: '\u0027',
  lt: '\u003C',
  gt: '\u003E',
  nbsp: '\u00A0', iexcl: '\u00A1', cent: '\u00A2', pound: '\u00A3', curren: '\u00A4', yen: '\u00A5',
  brvbar: '\u00A6', sect: '\u00A7', uml: '\u00A8', copy: '\u00A9', ordf: '\u00AA', laquo: '\u00AB',
  not: '\u00AC', shy: '\u00AD', reg: '\u00AE', macr: '\u00AF', deg: '\u00B0', plusmn: '\u00B1',
  sup2: '\u00B2', sup3: '\u00B3', acute: '\u00B4', micro: '\u00B5', para: '\u00B6', middot: '\u00B7',
  cedil: '\u00B8', sup1: '\u00B9', ordm: '\u00BA', raquo: '\u00BB', frac14: '\u00BC', frac12: '\u00BD',
  frac34: '\u00BE', iquest: '\u00BF', Agrave: '\u00C0', Aacute: '\u00C1', Acirc: '\u00C2',
  Atilde: '\u00C3', Auml: '\u00C4', Aring: '\u00C5', AElig: '\u00C6', Ccedil: '\u00C7', Egrave: '\u00C8',
  Eacute: '\u00C9', Ecirc: '\u00CA', Euml: '\u00CB', Igrave: '\u00CC', Iacute: '\u00CD', Icirc: '\u00CE',
  Iuml: '\u00CF', ETH: '\u00D0', Ntilde: '\u00D1', Ograve: '\u00D2', Oacute: '\u00D3', Ocirc: '\u00D4',
  Otilde: '\u00D5', Ouml: '\u00D6', times: '\u00D7', Oslash: '\u00D8', Ugrave: '\u00D9', Uacute: '\u00DA',
  Ucirc: '\u00DB', Uuml: '\u00DC', Yacute: '\u00DD', THORN: '\u00DE', szlig: '\u00DF', agrave: '\u00E0',
  aacute: '\u00E1', acirc: '\u00E2', atilde: '\u00E3', auml: '\u00E4', aring: '\u00E5', aelig: '\u00E6',
  ccedil: '\u00E7', egrave: '\u00E8', eacute: '\u00E9', ecirc: '\u00EA', euml: '\u00EB', igrave: '\u00EC',
  iacute: '\u00ED', icirc: '\u00EE', iuml: '\u00EF', eth: '\u00F0', ntilde: '\u00F1', ograve: '\u00F2',
  oacute: '\u00F3', ocirc: '\u00F4', otilde: '\u00F5', ouml: '\u00F6', divide: '\u00F7', oslash: '\u00F8',
  ugrave: '\u00F9', uacute: '\u00FA', ucirc: '\u00FB', uuml: '\u00FC', yacute: '\u00FD', thorn: '\u00FE',
  yuml: '\u00FF',
  OElig: '\u0152', oelig: '\u0153',
  Scaron: '\u0160', scaron: '\u0161',
  Yuml: '\u0178',
  fnof: '\u0192',
  circ: '\u02C6',
  tilde: '\u02DC',
  Alpha: '\u0391', Beta: '\u0392', Gamma: '\u0393', Delta: '\u0394', Epsilon: '\u0395', Zeta: '\u0396',
  Eta: '\u0397', Theta: '\u0398', Iota: '\u0399', Kappa: '\u039A', Lambda: '\u039B', Mu: '\u039C',
  Nu: '\u039D', Xi: '\u039E', Omicron: '\u039F', Pi: '\u03A0', Rho: '\u03A1',
  Sigma: '\u03A3', Tau: '\u03A4', Upsilon: '\u03A5', Phi: '\u03A6', Chi: '\u03A7', Psi: '\u03A8',
  Omega: '\u03A9',
  alpha: '\u03B1', beta: '\u03B2', gamma: '\u03B3', delta: '\u03B4', epsilon: '\u03B5', zeta: '\u03B6',
  eta: '\u03B7', theta: '\u03B8', iota: '\u03B9', kappa: '\u03BA', lambda: '\u03BB', mu: '\u03BC',
  nu: '\u03BD', xi: '\u03BE', omicron: '\u03BF', pi: '\u03C0', rho: '\u03C1', sigmaf: '\u03C2',
  sigma: '\u03C3', tau: '\u03C4', upsilon: '\u03C5', phi: '\u03C6', chi: '\u03C7', psi: '\u03C8',
  omega: '\u03C9',
  thetasym: '\u03D1', upsih: '\u03D2',
  piv: '\u03D6',
  ensp: '\u2002', emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200C', zwj: '\u200D', lrm: '\u200E', rlm: '\u200F',
  ndash: '\u2013', mdash: '\u2014',
  lsquo: '\u2018', rsquo: '\u2019', sbquo: '\u201A',
  ldquo: '\u201C', rdquo: '\u201D', bdquo: '\u201E',
  dagger: '\u2020', Dagger: '\u2021', bull: '\u2022',
  hellip: '\u2026',
  permil: '\u2030',
  prime: '\u2032', Prime: '\u2033',
  lsaquo: '\u2039', rsaquo: '\u203A',
  oline: '\u203E',
  frasl: '\u2044',
  euro: '\u20AC',
  image: '\u2111',
  weierp: '\u2118',
  real: '\u211C',
  trade: '\u2122',
  alefsym: '\u2135',
  larr: '\u2190', uarr: '\u2191', rarr: '\u2192', darr: '\u2193', harr: '\u2194',
  crarr: '\u21B5',
  lArr: '\u21D0', uArr: '\u21D1', rArr: '\u21D2', dArr: '\u21D3', hArr: '\u21D4',
  forall: '\u2200',
  part: '\u2202', exist: '\u2203',
  empty: '\u2205',
  nabla: '\u2207', isin: '\u2208', notin: '\u2209',
  ni: '\u220B',
  prod: '\u220F',
  sum: '\u2211', minus: '\u2212',
  lowast: '\u2217',
  radic: '\u221A',
  prop: '\u221D', infin: '\u221E',
  ang: '\u2220',
  and: '\u2227', or: '\u2228', cap: '\u2229', cup: '\u222A', int: '\u222B',
  there4: '\u2234',
  sim: '\u223C',
  cong: '\u2245',
  asymp: '\u2248',
  ne: '\u2260', equiv: '\u2261',
  le: '\u2264', ge: '\u2265',
  sub: '\u2282', sup: '\u2283', nsub: '\u2284',
  sube: '\u2286', supe: '\u2287',
  oplus: '\u2295',
  otimes: '\u2297',
  perp: '\u22A5',
  sdot: '\u22C5',
  lceil: '\u2308', rceil: '\u2309', lfloor: '\u230A', rfloor: '\u230B',
  lang: '\u2329', rang: '\u232A',
  loz: '\u25CA',
  spades: '\u2660',
  clubs: '\u2663',
  hearts: '\u2665', diams: '\u2666',
};

/** 字符 → 实体名（HTML4 各实体字符唯一；' 映射为 apos）。供「优先命名实体」模式反查。 */
const CHAR_TO_ENTITY = new Map();
for (const [name, ch] of Object.entries(NAMED_ENTITIES)) {
  if (!CHAR_TO_ENTITY.has(ch)) CHAR_TO_ENTITY.set(ch, name);
}

/* ==================== HTML：转义 / 还原 ==================== */

/** HTML 转义模式（escapeHtml 的 mode 取值） */
export const HTML_ESCAPE_MODES = ['necessary', 'nonAscii', 'named'];

/**
 * 文本 → HTML 实体。
 * @param {string} text
 * @param {{ mode?: 'necessary' | 'nonAscii' | 'named' }} [options]
 */
export function escapeHtml(text, { mode = 'necessary' } = {}) {
  if (text === '') return '';
  if (!HTML_ESCAPE_MODES.includes(mode)) throw new Error(`未知的 HTML 转义模式：${mode}`);
  let out = '';
  if (mode === 'necessary' || mode === 'nonAscii') {
    for (const ch of text) {
      switch (ch) {
        case '&': out += '&amp;'; continue;
        case '<': out += '&lt;'; continue;
        case '>': out += '&gt;'; continue;
        case '"': out += '&quot;'; continue;
        case "'": out += '&#39;'; continue;
      }
      const cp = ch.codePointAt(0);
      out += mode === 'nonAscii' && cp > 0x7f ? `&#x${cp.toString(16)};` : ch;
    }
    return out;
  }
  for (const ch of text) {
    const name = CHAR_TO_ENTITY.get(ch);
    out += name === undefined ? ch : `&${name};`;
  }
  return out;
}

function isHexDigit(c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

function isAsciiLetter(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

/** 数值引用的合法范围：非 0、非代理项、不超过 U+10FFFF（越界视为非法实体，原样保留） */
function isValidNumericReference(cp) {
  return cp >= 1 && cp <= MAX_CODE_POINT && !(cp >= HIGH_MIN && cp <= SURROGATE_MAX);
}

/**
 * 从 s[i]（应为 '&'）尝试匹配一个实体，返回 { char, end }（end 为实体后下一字符的下标）；
 * 不匹配返回 null。支持 &name;（区分大小写）、&#…;、&#x…;（x / X 均可），必须以 ; 结尾。
 */
function matchEntity(s, i) {
  const n = s.length;
  if (s[i + 1] === '#') {
    let j = i + 2;
    let radix = 10;
    if (s[j] === 'x' || s[j] === 'X') {
      radix = 16;
      j++;
    }
    const start = j;
    while (j < n && isHexDigit(s[j])) j++;
    if (j === start || s[j] !== ';') return null;
    const cp = parseInt(s.slice(start, j), radix);
    if (!isValidNumericReference(cp)) return null;
    return { char: String.fromCodePoint(cp), end: j + 1 };
  }
  let j = i + 1;
  if (j >= n || !isAsciiLetter(s[j])) return null;
  const start = j;
  while (j < n && j - start < 32) {
    const c = s[j];
    if (isAsciiLetter(c) || (c >= '0' && c <= '9')) {
      j++;
      continue;
    }
    break;
  }
  if (s[j] !== ';') return null;
  const char = NAMED_ENTITIES[s.slice(start, j)];
  return char === undefined ? null : { char, end: j + 1 };
}

/**
 * HTML 实体 → 文本。未知 / 非法实体原样保留，不报错。
 * 逐字符扫描 + 查表实现，全程不使用 innerHTML（防 XSS）。
 * @param {string} input
 * @returns {string}
 */
export function unescapeHtml(input) {
  if (input === '') return '';
  let out = '';
  let i = 0;
  const n = input.length;
  while (i < n) {
    if (input[i] !== '&') {
      out += input[i];
      i++;
      continue;
    }
    const m = matchEntity(input, i);
    if (m === null) {
      out += '&';
      i++;
    } else {
      out += m.char;
      i = m.end;
    }
  }
  return out;
}

/* ==================== Unicode：转义 ==================== */

/** Unicode 输出格式（escapeUnicode 的 format 取值） */
export const UNICODE_FORMATS = ['u-escape', 'u-brace', 'u-plus', 'html-hex', 'css'];

/**
 * 文本 → Unicode 转义。
 * @param {string} text
 * @param {{ format?: string, onlyNonAscii?: boolean, upperHex?: boolean }} [options]
 *   format      u-escape | u-brace | u-plus | html-hex | css
 *   onlyNonAscii  只转非 ASCII（默认开）；u-plus 格式始终转换全部字符，忽略该选项
 *   upperHex      十六进制大写（默认开）
 */
export function escapeUnicode(text, { format = 'u-escape', onlyNonAscii = true, upperHex = true } = {}) {
  if (text === '') return '';
  if (!UNICODE_FORMATS.includes(format)) throw new Error(`未知的 Unicode 输出格式：${format}`);
  const hx = (cp, minWidth) => {
    let s = cp.toString(16);
    if (upperHex) s = s.toUpperCase();
    return s.padStart(minWidth, '0');
  };
  if (format === 'u-plus') {
    const tokens = [];
    for (const ch of text) tokens.push(`U+${hx(ch.codePointAt(0), 4)}`);
    return tokens.join(' ');
  }
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (onlyNonAscii && cp <= 0x7f) {
      out += ch;
      continue;
    }
    switch (format) {
      case 'u-escape': {
        if (cp <= 0xffff) {
          out += `\\u${hx(cp, 4)}`;
        } else {
          const c = cp - 0x10000;
          out += `\\u${hx(HIGH_MIN + (c >> 10), 4)}\\u${hx(LOW_MIN + (c & 0x3ff), 4)}`;
        }
        break;
      }
      case 'u-brace':
        out += `\\u{${hx(cp, 1)}}`;
        break;
      case 'html-hex':
        out += `&#x${hx(cp, 1)};`;
        break;
      case 'css':
        out += `\\${hx(cp, 4)} `;
        break;
    }
  }
  return out;
}

/* ==================== Unicode：还原 ==================== */

const isSurrogateCp = (cp) => cp >= HIGH_MIN && cp <= SURROGATE_MAX;
const isHighCp = (cp) => cp >= HIGH_MIN && cp < LOW_MIN;
const isLowCp = (cp) => cp >= LOW_MIN && cp <= SURROGATE_MAX;
const isCssWhitespace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/**
 * Unicode 转义 → 文本。识别 \uXXXX、\u{XXXXX}、U+XXXX、&#x…; / &#…;、CSS \XXXX（可混合，
 * CSS 形式后会恰好吞掉一个空白作为结束符）；无法识别的内容原样保留，不抛异常。
 * 相邻的两个代理项转义会合并为增补平面字符；不成对的代理项转义按原文保留并置 warning。
 * @param {string} input
 * @returns {{ text: string, warning: string | null }}
 */
export function unescapeUnicode(input) {
  // 先扫描成 token 流：{ cp, source }（转义出的码点）或 { text }（普通字符）
  const tokens = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (ch === '\\') {
      if (input[i + 1] === 'u') {
        if (input[i + 2] === '{') {
          // \u{XXXXX}：1–6 位十六进制 + }
          let j = i + 3;
          const start = j;
          while (j < n && j - start < 6 && isHexDigit(input[j])) j++;
          const cp = parseInt(input.slice(start, j), 16);
          if (j > start && input[j] === '}' && cp >= 0 && cp <= MAX_CODE_POINT) {
            tokens.push({ cp, source: input.slice(i, j + 1) });
            i = j + 1;
            continue;
          }
        } else if (i + 5 < n) {
          // \uXXXX：恰好 4 位十六进制
          let ok = true;
          for (let k = i + 2; k <= i + 5; k++) {
            if (!isHexDigit(input[k])) {
              ok = false;
              break;
            }
          }
          if (ok) {
            tokens.push({ cp: parseInt(input.slice(i + 2, i + 6), 16), source: input.slice(i, i + 6) });
            i += 6;
            continue;
          }
        }
      } else {
        // CSS \XXXX：1–6 位十六进制 + 可选的一个空白（作为结束符被吞掉）
        let j = i + 1;
        const start = j;
        while (j < n && j - start < 6 && isHexDigit(input[j])) j++;
        const cp = parseInt(input.slice(start, j), 16);
        if (j > start && cp >= 0 && cp <= MAX_CODE_POINT) {
          const sourceEnd = j;
          if (isCssWhitespace(input[j])) j++;
          tokens.push({ cp, source: input.slice(i, sourceEnd) });
          i = j;
          continue;
        }
      }
      // 无法识别的反斜杠序列：按普通字符处理，从反斜杠的下一个字符继续
      tokens.push({ text: ch });
      i++;
      continue;
    }
    if (ch === 'U' && input[i + 1] === '+') {
      // U+XXXX：1–6 位十六进制（仅大写 U，避免误伤普通文本）
      let j = i + 2;
      const start = j;
      while (j < n && j - start < 6 && isHexDigit(input[j])) j++;
      const cp = parseInt(input.slice(start, j), 16);
      if (j > start && cp >= 0 && cp <= MAX_CODE_POINT) {
        tokens.push({ cp, source: input.slice(i, j) });
        i = j;
        continue;
      }
    }
    if (ch === '&') {
      const m = matchEntity(input, i);
      if (m !== null) {
        tokens.push({ cp: m.char.codePointAt(0), source: input.slice(i, m.end) });
        i = m.end;
        continue;
      }
    }
    tokens.push({ text: ch });
    i++;
  }

  // 解析 token 流：合并相邻代理对；不成对的代理项转义保留原文并提示
  let out = '';
  let warning = null;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.text !== undefined) {
      out += t.text;
      continue;
    }
    if (isSurrogateCp(t.cp)) {
      const next = tokens[k + 1];
      if (isHighCp(t.cp) && next !== undefined && next.cp !== undefined && isLowCp(next.cp)) {
        out += String.fromCodePoint(0x10000 + ((t.cp - HIGH_MIN) << 10) + (next.cp - LOW_MIN));
        k++;
      } else {
        out += t.source;
        warning = '存在不成对的代理项';
      }
      continue;
    }
    out += String.fromCodePoint(t.cp);
  }
  return { text: out, warning };
}

/* ==================== JS / JSON 字符串 ==================== */

/** 需要短转义的字符 → 转义文本（与 JSON.stringify 的短转义集合一致） */
const JS_SIMPLE_ESCAPES = new Map([
  ['"', '\\"'],
  ['\\', '\\\\'],
  ['\b', '\\b'],
  ['\f', '\\f'],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t'],
]);

/**
 * 文本 → 双引号字符串内容（不含两侧引号）。控制字符用小写 \u00xx，孤代理按 \udxxx
 * 转义（保证 JSON 合法），其余字符原样保留 —— 行为对齐 JSON.stringify。
 * @param {string} text
 */
export function escapeJsString(text) {
  if (text === '') return '';
  let out = '';
  for (let i = 0; i < text.length; i++) {
    // 按 UTF-16 码元遍历：增补平面字符的两个码元都无需转义、原样保留；
    // 孤代理则必须单独转义才能得到合法 JSON。
    const ch = text[i];
    const esc = JS_SIMPLE_ESCAPES.get(ch);
    if (esc !== undefined) {
      out += esc;
      continue;
    }
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || (code >= HIGH_MIN && code <= SURROGATE_MAX)) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * 双引号字符串内容 → 文本。支持 \" \\ \/ \b \f \n \r \t \uXXXX（相邻代理对合并）\xNN \0。
 * 非法转义抛中文 Error 并指明出现位置（按原始输入的字符序号，从 1 起）。
 * @param {string} input
 * @returns {string}
 */
export function unescapeJsString(input) {
  let out = '';
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (ch !== '\\') {
      out += ch;
      i++;
      continue;
    }
    const pos = i + 1; // 「\」是输入的第几个字符（从 1 起）
    const next = input[i + 1];
    if (next === undefined) {
      throw new Error(`非法的转义序列（第 ${pos} 个字符）：「\\」之后没有字符`);
    }
    switch (next) {
      case '"': out += '"'; i += 2; break;
      case '\\': out += '\\'; i += 2; break;
      case '/': out += '/'; i += 2; break;
      case 'b': out += '\b'; i += 2; break;
      case 'f': out += '\f'; i += 2; break;
      case 'n': out += '\n'; i += 2; break;
      case 'r': out += '\r'; i += 2; break;
      case 't': out += '\t'; i += 2; break;
      case '0': {
        if (i + 2 < n && input[i + 2] >= '0' && input[i + 2] <= '9') {
          throw new Error(`非法的转义序列「${input.slice(i, i + 3)}」（第 ${pos} 个字符）：八进制转义不受支持`);
        }
        out += '\u0000';
        i += 2;
        break;
      }
      case 'u': {
        if (i + 5 < n && isHexDigit(input[i + 2]) && isHexDigit(input[i + 3]) && isHexDigit(input[i + 4]) && isHexDigit(input[i + 5])) {
          const unit = parseInt(input.slice(i + 2, i + 6), 16);
          // 相邻的高代理 + 低代理（😀 形式）合并为增补平面字符（与 JSON.parse 一致）
          const followedByLowEscape =
            i + 11 < n &&
            input[i + 6] === '\\' &&
            input[i + 7] === 'u' &&
            isHexDigit(input[i + 8]) &&
            isHexDigit(input[i + 9]) &&
            isHexDigit(input[i + 10]) &&
            isHexDigit(input[i + 11]) &&
            isLowCp(parseInt(input.slice(i + 8, i + 12), 16));
          if (isHighCp(unit) && followedByLowEscape) {
            const low = parseInt(input.slice(i + 8, i + 12), 16);
            out += String.fromCodePoint(0x10000 + ((unit - HIGH_MIN) << 10) + (low - LOW_MIN));
            i += 12;
          } else {
            out += String.fromCharCode(unit); // 孤代理保留为孤代理字符
            i += 6;
          }
        } else {
          throw new Error(`非法的转义序列「${input.slice(i, Math.min(i + 6, n))}」（第 ${pos} 个字符）：「\\u」后应跟 4 个十六进制数字`);
        }
        break;
      }
      case 'x': {
        if (i + 3 < n && isHexDigit(input[i + 2]) && isHexDigit(input[i + 3])) {
          out += String.fromCharCode(parseInt(input.slice(i + 2, i + 4), 16));
          i += 4;
        } else {
          throw new Error(`非法的转义序列「${input.slice(i, Math.min(i + 4, n))}」（第 ${pos} 个字符）：「\\x」后应跟 2 个十六进制数字`);
        }
        break;
      }
      default:
        throw new Error(`非法的转义序列「\\${next}」（第 ${pos} 个字符）`);
    }
  }
  return out;
}

/* ==================== 字符明细 ==================== */

/** 码点的习惯写法：U+XXXX（至少 4 位，大写） */
export function formatCodePoint(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** 码点 → UTF-8 字节（大写十六进制、空格分隔）；代理项在 UTF-8 中无合法编码，返回 null */
export function utf8Hex(cp) {
  if (cp >= HIGH_MIN && cp <= SURROGATE_MAX) return null;
  const bytes = [];
  if (cp < 0x80) {
    bytes.push(cp);
  } else if (cp < 0x800) {
    bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
  } else if (cp < 0x10000) {
    bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  } else {
    bytes.push(
      0xf0 | (cp >> 18),
      0x80 | ((cp >> 12) & 0x3f),
      0x80 | ((cp >> 6) & 0x3f),
      0x80 | (cp & 0x3f),
    );
  }
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/** 明细表里的字符展示：空格显示为 ␣（U+2423），其余控制字符 / 孤代理用转义写法呈现 */
function displayChar(ch, cp) {
  if (ch === ' ') return '␣';
  if (cp < 0x20 || cp === 0x7f || isSurrogateCp(cp)) return escapeJsString(ch);
  return ch;
}

/**
 * 字符明细：前 limit 个字符的 { char, codePoint, utf8 } 行。
 * @returns {{ rows: Array<{ char: string, codePoint: string, utf8: string | null }>, total: number, truncated: boolean }}
 */
export function charDetails(text, limit = DETAILS_LIMIT) {
  const rows = [];
  let total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    total++;
    if (rows.length < limit) {
      rows.push({ char: displayChar(ch, cp), codePoint: formatCodePoint(cp), utf8: utf8Hex(cp) });
    }
  }
  return { rows, total, truncated: total > rows.length };
}

/* ==================== 展示辅助 ==================== */

/**
 * 输出区截断（默认前 1 万字符）。
 * @returns {{ text: string, truncated: boolean }}
 */
export function truncateForDisplay(text, limit = DISPLAY_LIMIT) {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

/** 字符数（按 Unicode 码点统计） */
export function countCodePoints(text) {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    i += text.codePointAt(i) > 0xffff ? 2 : 1; // 增补平面字符占 2 个码元
    count++;
  }
  return count;
}

/** UTF-8 字节数（用于「输入字节数」统计；孤代理按替换符 3 字节计，与实际传输一致） */
export function utf8ByteLength(text) {
  return new TextEncoder().encode(text).length;
}
