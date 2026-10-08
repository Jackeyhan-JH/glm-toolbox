/**
 * Markdown 预览 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 自写 CommonMark（含 GFM 扩展：表格 / 任务列表 / 删除线 / 自动链接）子集解析器
 * + 白名单净化，零第三方依赖：
 *
 *   renderMarkdown(md, options) → 安全的 HTML 字符串
 *
 * 为什么不用 vendored marked + DOMPurify：DOMPurify 依赖浏览器 DOM，
 * 无法在 node --test 里对净化结果做断言；自写「解析 → 白名单 AST → 序列化」
 * 流水线让每条「输入 → 输出」用例（含 XSS 向量）都能在单元测试里验证，
 * 预览区与导出的 HTML 走同一份纯函数。
 *
 * 安全模型：
 *   1. 解析器自身只生成白名单内的标签 / 属性（对齐 / 复选框等均由渲染器生成）；
 *   2. 文本内容一律转义后输出（实体先解码再转义，保证 &amp; 之类按原文显示）；
 *   3. 文档里的原生 HTML 经 filterHtml 白名单过滤：
 *      - 危险标签（script / iframe / style 等）连同内容一起移除；
 *      - 未列白名单的标签移除标签本身、保留内部文本；
 *      - 属性白名单 + URL scheme 白名单（链接 http/https/mailto，图片另允许 data:image/*）；
 *      - 注释 / 处理指令 / 声明 / CDATA 一律移除；
 *   4. http(s):// 与协议相对 // 的外部图片默认拦截为「外部图片已拦截」占位，
 *      由 options.allowExternalImages 显式放行。
 */

/* ==================== 基础工具：转义与实体 ==================== */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** 文本节点转义（raw 文本；普通文本应先 decodeEntities 再转义） */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ESCAPE_MAP[ch]);
}

/** 属性值转义 */
export function escapeAttr(text) {
  return escapeHtml(text);
}

/** 常用命名实体（完整 HTML5 实体表太大，收录高频项；未命名的保持原样） */
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  deg: '°', plusmn: '±', times: '×', divide: '÷', middot: '·', bull: '•',
  dagger: '†', prime: '′', euro: '€', pound: '£', yen: '¥', cent: '¢',
  sect: '§', para: '¶', sup2: '²', sup3: '³', frac12: '½', check: '✓',
};

/** 解码 Markdown / HTML 中的字符实体（命名 + 十进制 / 十六进制数字实体） */
export function decodeEntities(text) {
  if (!text.includes('&')) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code === 0 || code > 0x10ffff) return '�';
      if (code >= 0xd800 && code <= 0xdfff) return '�';
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : whole;
  });
}

/** Markdown 反斜杠转义可用的 ASCII 标点（字符类） */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

function isAsciiPunctuation(ch) {
  return ch !== undefined && ch !== '' && ASCII_PUNCTUATION.test(ch);
}

function isPunctuation(ch) {
  if (ch === undefined || ch === '') return false;
  return isAsciiPunctuation(ch) || /[\p{P}\p{S}]/u.test(ch);
}

function isWhitespace(ch) {
  if (ch === undefined || ch === '') return true; // 串首 / 串尾视作空白
  return /\s/.test(ch);
}

/* ==================== URL 净化 ==================== */

/**
 * 规整 URL：去掉首尾空白，去掉串中制表符 / 换行等控制字符
 * （浏览器解析 URL 时会忽略这些字符，先去掉再判断 scheme 才安全）。
 */
function cleanUrl(raw) {
  return String(raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

/** 是否为外部 http(s) 资源（含协议相对 //example.com/x） */
export function isExternalUrl(raw) {
  const url = cleanUrl(raw);
  return /^https?:/i.test(url) || url.startsWith('//');
}

/**
 * URL 白名单校验：通过返回净化后的 URL，不通过返回 null。
 * - 链接：http / https / mailto / 相对路径；
 * - 图片：相对路径、data:image/*；http(s) 仅在 allowExternalImages 时放行；
 * - 其余 scheme（javascript: / vbscript: / file: / data: 非 image…）一律拒绝。
 */
export function sanitizeUrl(raw, { isImage = false, allowExternalImages = false } = {}) {
  const url = cleanUrl(raw);
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (!schemeMatch) {
    if (url === '') return null;
    if (isImage && url.startsWith('//')) return allowExternalImages ? url : null;
    return url;
  }
  const scheme = schemeMatch[1].toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    if (isImage && !allowExternalImages) return null;
    return url;
  }
  if (scheme === 'mailto') return isImage ? null : url;
  if (scheme === 'data') {
    if (isImage && /^data:image\//i.test(url)) return url;
    return null;
  }
  return null;
}

/* ==================== 原生 HTML 白名单过滤 ==================== */

/** 白名单标签 → 允许的属性（小写） */
const ALLOWED_TAGS = new Map([
  ['a', ['href', 'title']],
  ['img', ['src', 'alt', 'title', 'width', 'height']],
  ['abbr', ['title']],
  ['time', ['datetime']],
  ['td', ['colspan', 'rowspan', 'align']],
  ['th', ['colspan', 'rowspan', 'align']],
  ['details', ['open']],
  ...[
    'b', 'i', 'em', 'strong', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup',
    'br', 'wbr', 'span', 'cite', 'code', 'kbd', 'samp', 'var', 'q', 'small',
    'bdi', 'bdo', 'dfn', 'ruby', 'rt', 'rp', 'p', 'div', 'section', 'article',
    'aside', 'header', 'footer', 'nav', 'main', 'figure', 'figcaption',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'blockquote', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'hr',
  ].map((tag) => [tag, ['title']]),
]);

/** 标签连同其内部内容一起移除（script / iframe / 样式与可嵌脚本的容器） */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'applet', 'noscript', 'template',
  'svg', 'math', 'title', 'textarea', 'xmp', 'noembed', 'noframes',
]);

/** 数值型属性 */
const NUMERIC_ATTRS = new Set(['width', 'height', 'colspan', 'rowspan']);

const RAW_HTML_RE =
  /<!--[\s\S]*?(?:-->|$)|<\?[\s\S]*?(?:\?>|$)|<![A-Za-z][^>]*>?|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;

const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** 「外部图片已拦截」占位 */
export function blockedImageHtml(url) {
  return `<span class="md-ext-img">外部图片已拦截：<code>${escapeHtml(url)}</code></span>`;
}

/** 解析属性串 → Map（小写属性名 → 原始值，布尔属性值为 null） */
function parseAttrs(source) {
  const attrs = new Map();
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(source)) !== null) {
    const name = m[1].toLowerCase();
    if (attrs.has(name)) continue;
    attrs.set(name, m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : null);
  }
  return attrs;
}

/** 重建经过白名单过滤的开标签；img 外部图片被拦截时返回占位 */
function rebuildTag(name, attrs, selfClose, opts) {
  const allowed = ALLOWED_TAGS.get(name);
  const parts = [`<${name}`];
  for (const attr of allowed) {
    const rawValue = attrs.get(attr);
    if (rawValue === undefined) continue;
    if (attr === 'href') {
      const href = sanitizeUrl(decodeEntities(rawValue), { isImage: false, allowExternalImages: opts.allowExternalImages });
      if (href !== null) {
        parts.push(` href="${escapeAttr(href)}" rel="noopener noreferrer" target="_blank"`);
      }
      continue;
    }
    if (attr === 'src') {
      const raw = decodeEntities(rawValue);
      if (isExternalUrl(raw) && !opts.allowExternalImages) return blockedImageHtml(raw);
      const src = sanitizeUrl(raw, { isImage: true, allowExternalImages: opts.allowExternalImages });
      if (src !== null) parts.push(` src="${escapeAttr(src)}"`);
      continue;
    }
    if (NUMERIC_ATTRS.has(attr)) {
      if (/^\d{1,7}$/.test(rawValue)) parts.push(` ${attr}="${rawValue}"`);
      continue;
    }
    if (attr === 'align') {
      if (/^(left|center|right)$/i.test(rawValue)) parts.push(` align="${rawValue.toLowerCase()}"`);
      continue;
    }
    if (attr === 'open') {
      parts.push(' open');
      continue;
    }
    parts.push(` ${attr}="${escapeAttr(decodeEntities(rawValue))}"`);
  }
  parts.push(selfClose ? ' />' : '>');
  return parts.join('');
}

/**
 * 白名单过滤一段原生 HTML：
 * 文本被转义输出；白名单标签重建（属性 / URL 校验）；危险标签连同内容移除；
 * 注释 / 处理指令 / 声明 / CDATA 移除；未知标签移除标签本身、保留内容。
 */
export function filterHtml(raw, opts = {}) {
  const options = { allowExternalImages: false, ...opts };
  let out = '';
  let pos = 0;
  RAW_HTML_RE.lastIndex = 0;
  let m;
  while ((m = RAW_HTML_RE.exec(raw)) !== null) {
    out += escapeHtml(decodeEntities(raw.slice(pos, m.index)));
    pos = m.index + m[0].length;
    if (m[1] !== undefined) {
      // 闭标签：白名单内的重建，其余丢弃
      const name = m[1].toLowerCase();
      if (ALLOWED_TAGS.has(name)) out += `</${name}>`;
      continue;
    }
    if (m[2] !== undefined) {
      const name = m[2].toLowerCase();
      if (DROP_WITH_CONTENT.has(name)) {
        // 跳过整个元素（含内容）；没有闭标签则丢弃剩余全部内容
        const rest = raw.slice(pos);
        const close = new RegExp(`</${name}(?=[\\s/>]|$)`, 'i').exec(rest);
        pos = close ? pos + close.index : raw.length;
        RAW_HTML_RE.lastIndex = pos;
        continue;
      }
      if (ALLOWED_TAGS.has(name)) out += rebuildTag(name, parseAttrs(m[3]), m[4] === '/', options);
      // 未知标签：丢弃标签本身，继续扫描其内容
      continue;
    }
    // 注释 / PI / 声明 / CDATA：丢弃
  }
  out += escapeHtml(decodeEntities(raw.slice(pos)));
  return out;
}

/* ==================== 行内解析 ==================== */

const AUTOLINK_URL_RE = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}):([^<>\u0000- ]*)>/;
const AUTOLINK_EMAIL_RE = /^<([a-zA-Z0-9._+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)>/;
const RAW_TAG_RE =
  /^<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|^<!--[\s\S]*?-->|^<\?[\s\S]*?\?>|^<![A-Za-z][^>]*>|^<!\[CDATA\[[\s\S]*?\]\]>/;

/**
 * 行内词法分析：产出 text / code / html / delim / brk / closebrk / link / br 节点。
 * 每个 token 记录源码起始位置 pos：链接解析据此跳过已消费的目标部分
 * （如 [a](b) 的 "(b)"，其中的 token 不能再进入输出流）。
 */
function tokenizeInline(src) {
  const tokens = [];
  let buf = '';
  let bufStart = 0;
  let i = 0;

  const flush = (at) => {
    if (buf !== '') {
      tokens.push({ t: 'text', v: buf, pos: bufStart });
      buf = '';
    }
    bufStart = at;
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\') {
      const next = src[i + 1];
      if (next && isAsciiPunctuation(next)) {
        flush(i);
        tokens.push({ t: 'text', v: next, raw: true, pos: i });
        bufStart = i + 2;
        i += 2;
      } else {
        buf += '\\';
        i += 1;
      }
      continue;
    }

    if (ch === '`') {
      let run = 1;
      while (src[i + run] === '`') run += 1;
      // 找下一个恰好等长的反引号串
      let j = i + run;
      let close = -1;
      while (j < src.length) {
        if (src[j] === '`') {
          let r = 1;
          while (src[j + r] === '`') r += 1;
          if (r === run) {
            close = j;
            break;
          }
          j += r;
        } else {
          j += 1;
        }
      }
      if (close === -1) {
        buf += '`'.repeat(run);
        i += run;
        continue;
      }
      let content = src.slice(i + run, close).replace(/\r\n|\r/g, '\n');
      if (content.length >= 2 && content.startsWith(' ') && content.endsWith(' ') && !/^ +$/.test(content)) {
        content = content.slice(1, -1);
      }
      flush(i);
      tokens.push({ t: 'code', v: content, pos: i });
      bufStart = close + run;
      i = close + run;
      continue;
    }

    if (ch === '<') {
      const rest = src.slice(i);
      const autolink = AUTOLINK_URL_RE.exec(rest);
      if (autolink) {
        flush(i);
        tokens.push({
          t: 'link',
          pos: i,
          href: `${autolink[1]}:${autolink[2]}`,
          title: null,
          children: [{ t: 'text', v: `${autolink[1]}:${autolink[2]}`, raw: true }],
        });
        bufStart = i + autolink[0].length;
        i += autolink[0].length;
        continue;
      }
      const email = AUTOLINK_EMAIL_RE.exec(rest);
      if (email) {
        flush(i);
        tokens.push({
          t: 'link',
          pos: i,
          href: `mailto:${email[1]}`,
          title: null,
          children: [{ t: 'text', v: email[1], raw: true }],
        });
        bufStart = i + email[0].length;
        i += email[0].length;
        continue;
      }
      const tag = RAW_TAG_RE.exec(rest);
      if (tag) {
        flush(i);
        tokens.push({ t: 'html', v: tag[0], pos: i });
        bufStart = i + tag[0].length;
        i += tag[0].length;
        continue;
      }
      buf += '<';
      i += 1;
      continue;
    }

    // GFM 扩展自动链接：裸 https://… 与 www.…（前一个字符不能是主机名字符）
    if ((ch === 'h' || ch === 'H' || ch === 'w' || ch === 'W') && (i === 0 || !/[a-zA-Z0-9._-]/.test(src[i - 1]))) {
      const rest = src.slice(i);
      const urlMatch = /^https?:\/\/[^\s<>]+/i.exec(rest) ?? /^www\.[^\s<>]+/i.exec(rest);
      if (urlMatch) {
        let url = urlMatch[0];
        // 末尾标点不属于链接；括号不配平时同样剥离
        while (/[?!.,:*_~'";&]/.test(url.slice(-1)) || (url.endsWith(')') && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length)) {
          url = url.slice(0, -1);
        }
        const schemeOk = /^https?:\/\/..+/i.test(url);
        if (schemeOk || /^www\.[^\s.]/i.test(url)) {
          flush(i);
          const href = schemeOk ? url : `https://${url}`;
          tokens.push({ t: 'link', pos: i, href, title: null, children: [{ t: 'text', v: url, raw: true }] });
          bufStart = i + url.length;
          i += url.length;
          continue;
        }
      }
    }

    if (ch === '!' && src[i + 1] === '[') {
      flush(i);
      bufStart = i + 2;
      tokens.push({ t: 'brk', image: true, active: true, pos: i, end: i + 2 });
      i += 2;
      continue;
    }

    if (ch === '[') {
      flush(i);
      bufStart = i + 1;
      tokens.push({ t: 'brk', image: false, active: true, pos: i, end: i + 1 });
      i += 1;
      continue;
    }

    if (ch === ']') {
      flush(i);
      bufStart = i + 1;
      tokens.push({ t: 'closebrk', pos: i });
      i += 1;
      continue;
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      let run = 1;
      while (src[i + run] === ch) run += 1;
      const before = i > 0 ? src[i - 1] : undefined;
      const after = src[i + run];
      const leftFlanking = !isWhitespace(after) && (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
      const rightFlanking = !isWhitespace(before) && (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
      flush(i);
      bufStart = i + run;
      tokens.push({
        t: 'delim',
        ch,
        n: run,
        pos: i,
        open: ch === '_' ? leftFlanking && (!rightFlanking || isPunctuation(before)) : leftFlanking,
        close: ch === '_' ? rightFlanking && (!leftFlanking || isPunctuation(after)) : rightFlanking,
      });
      i += run;
      continue;
    }

    if (ch === '\n') {
      // 行尾两个及以上空格 → 硬换行
      const trailing = / +$/.exec(buf);
      if (trailing) {
        buf = buf.slice(0, -trailing[0].length);
        flush(i);
        tokens.push({ t: 'br', pos: i });
        bufStart = i + 1;
      } else {
        buf += '\n';
        flush(i);
        bufStart = i + 1;
      }
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }
  flush(src.length);
  return tokens;
}

/** 解析 `]` 后面的行内链接目标 `(dest "title")`；失败返回 null */
function parseInlineTail(src, j) {
  if (src[j] !== '(') return null;
  let k = j + 1;
  while (k < src.length && /[\n ]/.test(src[k])) k += 1;
  let dest = '';
  if (src[k] === '<') {
    const close = src.indexOf('>', k + 1);
    if (close === -1 || src.slice(k + 1, close).includes('<')) return null;
    dest = src.slice(k + 1, close);
    k = close + 1;
  } else {
    let depth = 0;
    while (k < src.length && !/[\n ]/.test(src[k])) {
      if (src[k] === '(') depth += 1;
      if (src[k] === ')') {
        if (depth === 0) break;
        depth -= 1;
      }
      dest += src[k];
      k += 1;
    }
  }
  while (k < src.length && /[\n ]/.test(src[k])) k += 1;
  let title = null;
  if (src[k] === '"' || src[k] === "'" || src[k] === '(') {
    const quote = src[k];
    const closeCh = quote === '(' ? ')' : quote;
    const close = src.indexOf(closeCh, k + 1);
    if (close !== -1) {
      title = src.slice(k + 1, close);
      k = close + 1;
    }
  }
  while (k < src.length && /[\n ]/.test(src[k])) k += 1;
  if (src[k] !== ')') return null;
  return { dest, title, next: k + 1 };
}

/** 解析 `]` 后面的引用式目标 `[label]` / `[]`；失败返回 null */
function parseReferenceTail(src, j, fallbackLabel) {
  if (src[j] !== '[') return null;
  const close = src.indexOf(']', j + 1);
  if (close === -1) return null;
  const label = src.slice(j + 1, close).trim();
  return { label: label === '' ? fallbackLabel : label, next: close + 1 };
}

function normalizeLabel(label) {
  return decodeEntities(label).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 把 [ / ![ / ] 结构解析成 link / image 节点。
 * 匹配不到目标的括号退化为字面文本；链接内不能再嵌链接（内层按字面处理）。
 */
function resolveBrackets(tokens, src, refMap) {
  const nodes = [];
  const stack = []; // 未闭合的 [ / ![
  let skipUntil = 0; // 已被链接目标（(dest) / [label]）消费的源码终点

  for (const tok of tokens) {
    if (tok.pos !== undefined && tok.pos < skipUntil) continue; // 目标部分不进入输出
    if (tok.t === 'brk') {
      stack.push({ tok, nodePos: nodes.length });
      nodes.push(tok);
      continue;
    }
    if (tok.t !== 'closebrk') {
      nodes.push(tok);
      continue;
    }

    let openerIdx = -1;
    for (let k = stack.length - 1; k >= 0; k -= 1) {
      if (stack[k].tok.active) {
        openerIdx = k;
        break;
      }
    }
    if (openerIdx === -1) {
      nodes.push({ t: 'text', v: ']', raw: true });
      continue;
    }
    const { tok: opener, nodePos } = stack[openerIdx];
    stack.splice(openerIdx);

    const fallbackLabel = src.slice(opener.end, tok.pos);
    const tailPos = tok.pos + 1;
    let linkDef = null;
    const inlineTail = parseInlineTail(src, tailPos);
    if (inlineTail) {
      linkDef = inlineTail;
    } else {
      const refTail = parseReferenceTail(src, tailPos, fallbackLabel);
      const label = refTail ? refTail.label : fallbackLabel; // 无尾随部分 → 快捷引用
      const target = refMap[normalizeLabel(label)];
      if (target) linkDef = { dest: target.dest, title: target.title, next: refTail ? refTail.next : tailPos };
    }

    if (!linkDef) {
      nodes.push({ t: 'text', v: ']', raw: true });
      opener.active = false;
      continue;
    }
    skipUntil = Math.max(skipUntil, linkDef.next);

    const children = nodes.splice(nodePos); // 括号内的节点（含开括号 token 本身）
    children.shift();
    if (opener.image) {
      nodes.push({ t: 'image', src: linkDef.dest, title: linkDef.title, children });
    } else {
      nodes.push({ t: 'link', href: linkDef.dest, title: linkDef.title, children });
      // 链接内不允许再嵌链接：更早的未闭合括号全部失效
      for (const entry of stack) entry.tok.active = false;
    }
  }

  // 残留的括号 token 转为字面文本
  for (let k = 0; k < nodes.length; k += 1) {
    if (nodes[k].t === 'brk') {
      nodes[k] = { t: 'text', v: nodes[k].image ? '![' : '[', raw: true };
    }
  }
  return nodes;
}

/**
 * 强调匹配（* / _ → em / strong，~ → del）：openers 栈 + CommonMark 简化规则，
 * 在节点列表上就地重组。剩余未匹配的分隔符由 convertLeftover 转回字面文本。
 */
function processEmphasis(nodes) {
  const openers = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (node.t !== 'delim') {
      i += 1;
      continue;
    }
    if (!node.close) {
      openers.push(node);
      i += 1;
      continue;
    }

    let matched = false;
    while (!matched) {
      let k = openers.length - 1;
      while (k >= 0 && openers[k].ch !== node.ch) k -= 1;
      if (k === -1) break;
      const opener = openers[k];

      // ~ 需要等长（1 或 2）的一对；* / _ 受「3 的倍数」规则限制
      let usable = true;
      if (node.ch === '~') {
        if (opener.n !== node.n || opener.n > 2) usable = false;
      } else if (
        (opener.close || node.open) &&
        (opener.n + node.n) % 3 === 0 &&
        !(opener.n % 3 === 0 && node.n % 3 === 0)
      ) {
        usable = false;
      }
      if (!usable) {
        openers.splice(k, 1);
        continue;
      }

      const take = node.ch === '~' ? node.n : Math.min(opener.n, node.n) >= 2 ? 2 : 1;
      const openerPos = nodes.indexOf(opener);
      const closerPos = nodes.indexOf(node);
      const inner = nodes.splice(openerPos + 1, closerPos - openerPos - 1);
      opener.n -= take;
      node.n -= take;
      const wrapper =
        node.ch === '~' ? { t: 'del', children: inner } : take === 2 ? { t: 'strong', children: inner } : { t: 'em', children: inner };
      nodes.splice(openerPos + 1, 0, wrapper);
      if (opener.n === 0) {
        nodes.splice(nodes.indexOf(opener), 1);
        openers.splice(k, 1);
      }
      if (node.n === 0) {
        const idx = nodes.indexOf(node);
        if (idx !== -1) nodes.splice(idx, 1);
        matched = true;
      }
      i = nodes.indexOf(wrapper) + 1; // 从包裹节点之后继续扫描
    }
    if (!matched && !node.open) {
      // 纯闭分隔符且无配对 → 字面文本
      const idx = nodes.indexOf(node);
      nodes[idx] = { t: 'text', v: node.ch.repeat(node.n), raw: true };
      i = idx + 1;
    } else if (!matched) {
      // 还能当开分隔符使用（可能是部分消耗后的剩余）
      openers.push(node);
      i = nodes.indexOf(node) + 1;
    }
  }
  return nodes;
}

/** 把剩余未匹配的分隔符 / 括号 token 转为可序列化文本节点（递归子树） */
function convertLeftover(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.t === 'delim') {
      out.push({ t: 'text', v: node.ch.repeat(node.n), raw: true });
    } else if (node.t === 'brk') {
      out.push({ t: 'text', v: node.image ? '![' : '[', raw: true });
    } else if (node.children) {
      out.push({ ...node, children: convertLeftover(node.children) });
    } else {
      out.push(node);
    }
  }
  return out;
}

function parseInline(src, refMap) {
  const tokens = tokenizeInline(src);
  const nodes = resolveBrackets(tokens, src, refMap);
  return convertLeftover(processEmphasis(nodes));
}

/* ==================== 行内序列化 ==================== */

/** 提取纯文本（用于图片 alt） */
function inlineToPlainText(nodes) {
  let out = '';
  for (const node of nodes) {
    if (node.t === 'text') out += node.raw ? node.v : decodeEntities(node.v);
    else if (node.t === 'code') out += node.v;
    else if (node.children) out += inlineToPlainText(node.children);
  }
  return out;
}

/** 行内节点 → 安全 HTML 字符串 */
function renderInlineNodes(nodes, opts) {
  let out = '';
  for (const node of nodes) {
    switch (node.t) {
      case 'text':
        out += escapeHtml(node.raw ? node.v : decodeEntities(node.v));
        break;
      case 'br':
        out += '<br>\n';
        break;
      case 'code':
        out += `<code>${escapeHtml(node.v)}</code>`;
        break;
      case 'em':
        out += `<em>${renderInlineNodes(node.children, opts)}</em>`;
        break;
      case 'strong':
        out += `<strong>${renderInlineNodes(node.children, opts)}</strong>`;
        break;
      case 'del':
        out += `<del>${renderInlineNodes(node.children, opts)}</del>`;
        break;
      case 'link': {
        const href = sanitizeUrl(decodeEntities(node.href), {
          isImage: false,
          allowExternalImages: opts.allowExternalImages,
        });
        const inner = renderInlineNodes(node.children, opts);
        if (href === null) {
          out += inner;
        } else {
          const title = node.title ? ` title="${escapeAttr(decodeEntities(node.title))}"` : '';
          out += `<a href="${escapeAttr(href)}"${title} rel="noopener noreferrer" target="_blank">${inner}</a>`;
        }
        break;
      }
      case 'image': {
        const raw = decodeEntities(node.src);
        const alt = escapeAttr(inlineToPlainText(node.children));
        const title = node.title ? ` title="${escapeAttr(decodeEntities(node.title))}"` : '';
        if (isExternalUrl(raw) && !opts.allowExternalImages) {
          out += blockedImageHtml(raw);
          break;
        }
        const src = sanitizeUrl(raw, { isImage: true, allowExternalImages: opts.allowExternalImages });
        if (src !== null) out += `<img src="${escapeAttr(src)}" alt="${alt}"${title}>`;
        else out += alt;
        break;
      }
      case 'html':
        out += filterHtml(node.v, opts);
        break;
      default:
        break;
    }
  }
  return out;
}

/* ==================== 块级解析 ==================== */

/** 行首制表符按 4 列停靠位展开，便于统一按空格缩进处理 */
function expandLeadingTabs(line) {
  let i = 0;
  let col = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    col += line[i] === '\t' ? 4 - (col % 4) : 1;
    i += 1;
  }
  return ' '.repeat(col) + line.slice(i);
}

function indentOf(line) {
  const m = /^[ \t]*/.exec(line);
  return m[0].length;
}

function isBlank(line) {
  return /^[ \t]*$/.test(line);
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;
const HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE_RE = /^ {0,3}>/;
const LIST_RE = /^ {0,3}([-+*]|[0-9]{1,9}[.)])([ \t]+(.*))?$/;
const EMPTY_ITEM_RE = /^ {0,3}([-+*]|[0-9]{1,9}[.)])[ \t]*$/;
const REF_DEF_RE =
  /^ {0,3}\[([^\]]*)\]:[ \t]*(?:<([^<>\n]*)>|(\S+))(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)\n]*)\)))?[ \t]*$/;

/** 允许打断段落的原生 HTML 块级标签（CommonMark 第 6 类的超集） */
const BLOCK_HTML_TAGS = new Set([
  'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
  'figure', 'figcaption', 'blockquote', 'pre', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'hr', 'form', 'fieldset', 'address', 'details',
  'summary', 'dialog', 'center', 'script', 'style', 'pre', 'textarea', 'iframe',
]);

/** 行首 HTML 块判定：返回标签名（小写；注释 / 指令等返回 ''），不是则 null */
function htmlBlockStartTag(line) {
  const m = /^ {0,3}<\/?([a-zA-Z][a-zA-Z0-9-]*)[\s/>]/.exec(line);
  if (m) return m[1].toLowerCase();
  if (/^ {0,3}<(?:!--|\?|![A-Za-z]|!\[CDATA\[)/.test(line)) return '';
  return null;
}

/** 该行是否能作为某个块级结构的起始（用于惰性延续判断） */
function isBlockStart(line) {
  if (FENCE_RE.test(line) || ATX_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line)) return true;
  if (LIST_RE.test(line) && !EMPTY_ITEM_RE.test(line)) return true;
  return htmlBlockStartTag(line) !== null;
}

/** 按 | 拆分表格行（不动 \| 转义，交给行内解析处理） */
function splitTableRow(line) {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells = [];
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      current += '\\|';
      i += 1;
      continue;
    }
    if (body[i] === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += body[i];
  }
  cells.push(current.trim());
  return cells;
}

/** 分隔行 → 各列对齐方式（null / 'left' / 'center' / 'right'），不是分隔行返回 null */
function parseDelimiterRow(line) {
  const cells = splitTableRow(line);
  if (cells.length === 0 || cells.every((c) => c === '')) return null;
  const align = [];
  for (const cell of cells) {
    const m = /^(:?)(-+)(:?)$/.exec(cell.replace(/\s+/g, ''));
    if (!m) return null;
    if (m[1] === ':' && m[3] === ':') align.push('center');
    else if (m[3] === ':') align.push('right');
    else if (m[1] === ':') align.push('left');
    else align.push(null);
  }
  return align;
}

/** 解析块级结构。refMap 由引用式链接定义填充（跨段落共享） */
function parseBlocks(lines, refMap) {
  const blocks = [];
  let i = 0;
  const n = lines.length;
  let paraLines = [];

  const flushPara = () => {
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
      paraLines = [];
    }
  };

  while (i < n) {
    const line = lines[i];

    if (isBlank(line)) {
      flushPara();
      i += 1;
      continue;
    }

    const ind = indentOf(line);

    // 缩进代码块（不能打断段落）
    if (ind >= 4 && paraLines.length === 0) {
      const content = [];
      while (i < n && (isBlank(lines[i]) || indentOf(lines[i]) >= 4)) {
        content.push(isBlank(lines[i]) ? '' : lines[i].slice(4));
        i += 1;
      }
      while (content.length > 0 && content[content.length - 1] === '') content.pop();
      if (content.length > 0) blocks.push({ type: 'code', info: '', fenced: false, content: `${content.join('\n')}\n` });
      continue;
    }

    // 围栏代码块
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const info = fence[2].trim();
      if (!(fence[1][0] === '`' && info.includes('`'))) {
        flushPara();
        const fenceChar = fence[1][0];
        const closeRe = new RegExp(`^ {0,3}\\${fenceChar}{${fence[1].length},}[ \\t]*$`);
        const fenceIndent = line.length - line.trimStart().length;
        const content = [];
        i += 1;
        while (i < n) {
          if (closeRe.test(lines[i])) {
            i += 1;
            break;
          }
          content.push(lines[i].slice(Math.min(fenceIndent, indentOf(lines[i]))));
          i += 1;
        }
        blocks.push({ type: 'code', info, fenced: true, content: `${content.join('\n')}\n` });
        continue;
      }
    }

    // ATX 标题
    const atx = ATX_RE.exec(line);
    if (atx) {
      flushPara();
      const text = (atx[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
      blocks.push({ type: 'heading', level: atx[1].length, text });
      i += 1;
      continue;
    }

    // Setext 标题（只能出现在段落之后；--- 优先于分割线 / 列表）
    const setext = paraLines.length > 0 ? SETEXT_RE.exec(line) : null;
    if (setext) {
      blocks.push({ type: 'heading', level: setext[1][0] === '=' ? 1 : 2, text: paraLines.join('\n') });
      paraLines = [];
      i += 1;
      continue;
    }

    // 主题分割线
    if (HR_RE.test(line)) {
      flushPara();
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // 引用块
    if (QUOTE_RE.test(line)) {
      flushPara();
      const quoteLines = [];
      while (i < n) {
        const current = lines[i];
        const marker = /^ {0,3}> ?(.*)$/.exec(current);
        if (marker) {
          quoteLines.push(marker[1]);
          i += 1;
          continue;
        }
        if (isBlank(current)) {
          let j = i + 1;
          while (j < n && isBlank(lines[j])) j += 1;
          if (j < n && QUOTE_RE.test(lines[j])) {
            quoteLines.push('');
            i += 1;
            continue;
          }
          break;
        }
        // 惰性延续：普通文本行并入引用内的段落
        if (!isBlockStart(current)) {
          quoteLines.push(current.replace(/^ {0,3}/, ''));
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: 'quote', children: parseBlocks(quoteLines, refMap) });
      continue;
    }

    // 原生 HTML 块
    const htmlTag = htmlBlockStartTag(line);
    if (htmlTag !== null && (paraLines.length === 0 || BLOCK_HTML_TAGS.has(htmlTag) || htmlTag === '')) {
      flushPara();
      const raw = [];
      const trimmedStart = line.trim();
      let endRe = null; // null：空行结束（第 6/7 类）
      const contentClosers = { script: /<\/script>/i, pre: /<\/pre>/i, style: /<\/style>/i, textarea: /<\/textarea>/i };
      if (htmlTag !== '' && contentClosers[htmlTag]) endRe = contentClosers[htmlTag];
      else if (trimmedStart.startsWith('<!--')) endRe = /-->/;
      else if (trimmedStart.startsWith('<?')) endRe = /\?>/;
      else if (/^<![A-Za-z]/.test(trimmedStart)) endRe = />/;
      else if (trimmedStart.startsWith('<![CDATA[')) endRe = /\]\]>/;
      while (i < n) {
        if (endRe === null && isBlank(lines[i])) break;
        raw.push(lines[i]);
        i += 1;
        if (endRe !== null && endRe.test(raw[raw.length - 1])) break;
      }
      blocks.push({ type: 'html', text: raw.join('\n') });
      continue;
    }

    // 列表
    const listMatch = LIST_RE.exec(line);
    if (listMatch) {
      const ordered = /[0-9]/.test(listMatch[1][0]);
      const canInterrupt =
        paraLines.length === 0 ||
        (!ordered && listMatch[3] !== undefined) ||
        (ordered && parseInt(listMatch[1], 10) === 1 && listMatch[3] !== undefined);
      if (canInterrupt) {
        flushPara();
        const bullet = ordered ? listMatch[1].slice(-1) : listMatch[1];
        const start = ordered ? parseInt(listMatch[1], 10) : 1;
        const items = [];
        let loose = false;

        while (i < n) {
          if (isBlank(lines[i])) {
            // 列表项之间的空行：若下一项仍是本列表 → 松散列表
            let j = i + 1;
            while (j < n && isBlank(lines[j])) j += 1;
            const next = j < n ? LIST_RE.exec(lines[j]) : null;
            const sameList =
              next && (ordered ? /[0-9]/.test(next[1][0]) && next[1].slice(-1) === bullet : next[1] === bullet);
            if (sameList) {
              loose = true;
              i = j;
              continue;
            }
            break;
          }
          const itemMatch = LIST_RE.exec(lines[i]);
          const itemOrdered = itemMatch ? /[0-9]/.test(itemMatch[1][0]) : false;
          const sameList =
            itemMatch && (ordered ? itemOrdered && itemMatch[1].slice(-1) === bullet : !itemOrdered && itemMatch[1] === bullet);
          if (!sameList) break;

          const itemIndent = indentOf(lines[i]) + itemMatch[1].length;
          let contentIndent;
          let firstLine;
          if (itemMatch[3] === undefined) {
            contentIndent = itemIndent + 1;
            firstLine = '';
          } else {
            const wsLen = itemMatch[2].length - itemMatch[3].length;
            if (wsLen >= 5) {
              contentIndent = itemIndent + 1;
              firstLine = ' '.repeat(wsLen - 1) + itemMatch[3];
            } else {
              contentIndent = itemIndent + wsLen;
              firstLine = itemMatch[3];
            }
          }

          const content = [firstLine];
          i += 1;
          while (i < n) {
            const current = lines[i];
            if (isBlank(current)) {
              let j = i + 1;
              while (j < n && isBlank(lines[j])) j += 1;
              if (j < n && indentOf(lines[j]) >= contentIndent) {
                for (let k = i; k < j; k += 1) content.push('');
                i = j;
                continue;
              }
              break;
            }
            if (indentOf(current) >= contentIndent) {
              content.push(current.slice(contentIndent));
              i += 1;
              continue;
            }
            // 惰性延续：段落文本行并入当前项（要求上一行非空）
            if (content[content.length - 1] !== '' && !isBlockStart(current)) {
              content.push(current.replace(/^ {0,3}/, ''));
              i += 1;
              continue;
            }
            break;
          }

          // 项内空行夹着内容 → 松散列表
          let seenContent = false;
          for (const l of content) {
            if (isBlank(l)) {
              if (seenContent) loose = true;
            } else {
              seenContent = true;
            }
          }
          while (content.length > 0 && content[content.length - 1] === '') content.pop();
          items.push({ children: parseBlocks(content, refMap), task: null });
        }

        // 任务列表标记 [x] / [ ]（只识别首段行首）
        for (const item of items) {
          const first = item.children[0];
          if (!first || first.type !== 'paragraph') continue;
          const m = /^\[([ xX])\][ \t]+([\s\S]*)$/.exec(first.text) ?? /^\[([ xX])\][ \t]*$/.exec(first.text);
          if (m) {
            item.task = { checked: m[1] !== ' ' };
            first.text = m[2] ?? '';
            if (first.text === '') item.children.shift();
          }
        }

        blocks.push({ type: 'list', ordered, start, tight: !loose, items });
        continue;
      }
    }

    // 表格（表头 + 分隔行两行确定；不打断段落）
    if (paraLines.length === 0 && line.includes('|') && i + 1 < n && !isBlank(lines[i + 1])) {
      const align = parseDelimiterRow(lines[i + 1]);
      const header = align ? splitTableRow(line) : null;
      if (align && header && header.length === align.length && header.some((c) => c !== '')) {
        i += 2;
        const rows = [];
        while (i < n && !isBlank(lines[i]) && lines[i].includes('|')) {
          const cells = splitTableRow(lines[i]);
          while (cells.length < header.length) cells.push('');
          rows.push(cells);
          i += 1;
        }
        blocks.push({ type: 'table', header, align, rows });
        continue;
      }
    }

    // 段落：段首先吸收引用式链接定义
    if (paraLines.length === 0) {
      const refDef = REF_DEF_RE.exec(line);
      if (refDef) {
        refMap[normalizeLabel(refDef[1])] = {
          dest: refDef[2] ?? refDef[3] ?? '',
          title: refDef[4] ?? refDef[5] ?? refDef[6] ?? null,
        };
        i += 1;
        continue;
      }
    }

    paraLines.push(line);
    i += 1;
  }
  flushPara();
  return blocks;
}

/* ==================== 块级序列化 ==================== */

const LANG_CLASS_RE = /^[A-Za-z0-9_+.#-]*$/;

function renderBlocks(blocks, opts, tight = false) {
  const parts = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        parts.push(`<h${block.level}>${renderInlineNodes(parseInline(block.text, opts.refMap), opts)}</h${block.level}>`);
        break;
      case 'paragraph': {
        const inner = renderInlineNodes(parseInline(block.text, opts.refMap), opts);
        parts.push(tight ? inner : `<p>${inner}</p>`);
        break;
      }
      case 'code': {
        const lang = block.info.split(/\s+/)[0] ?? '';
        const cls = lang && LANG_CLASS_RE.test(lang) ? ` class="language-${lang}"` : '';
        parts.push(`<pre><code${cls}>${escapeHtml(block.content)}</code></pre>`);
        break;
      }
      case 'quote':
        parts.push(`<blockquote>\n${renderBlocks(block.children, opts)}\n</blockquote>`);
        break;
      case 'hr':
        parts.push('<hr>');
        break;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        const startAttr = block.ordered && block.start !== 1 ? ` start="${block.start}"` : '';
        const items = block.items.map((item) => {
          const checkbox = item.task
            ? `<input type="checkbox" disabled${item.task.checked ? ' checked' : ''}> `
            : '';
          return `<li>${checkbox}${renderBlocks(item.children, opts, block.tight)}</li>`;
        });
        parts.push(`<${tag}${startAttr}>\n${items.join('\n')}\n</${tag}>`);
        break;
      }
      case 'table': {
        const cell = (content, align, tag) => {
          const style = align ? ` style="text-align: ${align}"` : '';
          return `<${tag}${style}>${renderInlineNodes(parseInline(content, opts.refMap), opts)}</${tag}>`;
        };
        const head = block.header.map((h, idx) => cell(h, block.align[idx], 'th')).join('');
        const body = block.rows
          .map((row) => `<tr>${row.map((c, idx) => cell(c, block.align[idx] ?? null, 'td')).join('')}</tr>`)
          .join('\n');
        parts.push(
          `<table>\n<thead>\n<tr>${head}</tr>\n</thead>\n${body ? `<tbody>\n${body}\n</tbody>\n` : ''}</table>`,
        );
        break;
      }
      case 'html':
        parts.push(filterHtml(block.text, opts));
        break;
      default:
        break;
    }
  }
  return parts.join('\n');
}

/* ==================== 对外入口 ==================== */

/**
 * 渲染 Markdown 为安全的 HTML 字符串。
 * @param {string} md Markdown 源文本
 * @param {{ allowExternalImages?: boolean }} [options] http(s) 图片默认拦截
 * @returns {string} HTML
 */
export function renderMarkdown(md, options = {}) {
  const opts = { allowExternalImages: false, ...options, refMap: {} };
  const normalized = String(md ?? '').replace(/\r\n|\r/g, '\n');
  const lines = normalized.split('\n').map(expandLeadingTabs);
  const blocks = parseBlocks(lines, opts.refMap);
  return renderBlocks(blocks, opts);
}

/* ==================== 编辑器辅助（工具栏） ==================== */

/**
 * 包裹 / 解包选中文本（加粗、斜体、行内代码、链接…）。
 * 选区两侧已是指定包裹符时执行解包（再次点击取消格式）。
 * 空选区时插入 before + placeholder + after 并选中占位文字。
 * @returns {{ text: string, start: number, end: number }}
 */
export function wrapSelection(text, start, end, before, after, { placeholder = '' } = {}) {
  const len = text.length;
  const s = Math.max(0, Math.min(start, len));
  const e = Math.max(s, Math.min(end, len));
  const selected = text.slice(s, e);
  if (selected !== '') {
    const beforeOk = text.slice(Math.max(0, s - before.length), s) === before;
    const afterOk = text.slice(e, Math.min(len, e + after.length)) === after;
    if (beforeOk && afterOk) {
      const newStart = s - before.length;
      return {
        text: text.slice(0, newStart) + selected + text.slice(e + after.length),
        start: newStart,
        end: newStart + selected.length,
      };
    }
    return {
      text: text.slice(0, s) + before + selected + after + text.slice(e),
      start: s + before.length,
      end: s + before.length + selected.length,
    };
  }
  return {
    text: text.slice(0, s) + before + placeholder + after + text.slice(e),
    start: s + before.length,
    end: s + before.length + placeholder.length,
  };
}

/**
 * 给选区覆盖到的每一行加 / 去前缀（标题、引用、列表）。
 * 全部非空行都已有该前缀时执行移除（再次点击取消）。
 * @returns {{ text: string, start: number, end: number }}
 */
export function toggleLinePrefix(text, start, end, prefix) {
  const len = text.length;
  const s = Math.max(0, Math.min(start, len));
  const e = Math.max(s, Math.min(end, len));
  const lineStart = text.lastIndexOf('\n', s - 1) + 1;
  const nl = text.indexOf('\n', e);
  const lineEnd = nl === -1 ? len : nl;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const meaningful = lines.filter((l) => l.trim() !== '');
  const allPrefixed = meaningful.length > 0 && meaningful.every((l) => l.trimStart().startsWith(prefix));
  const next = lines.map((l) => {
    if (l.trim() === '') return l;
    if (allPrefixed) return l.trimStart().slice(prefix.length);
    return prefix + l.trimStart();
  });
  const joined = next.join('\n');
  return { text: text.slice(0, lineStart) + joined + text.slice(lineEnd), start: lineStart, end: lineStart + joined.length };
}

/** 在光标处插入片段（表格模板等），光标移到片段末尾 */
export function insertAtCursor(text, start, end, snippet) {
  const len = text.length;
  const s = Math.max(0, Math.min(start, len));
  const e = Math.max(s, Math.min(end, len));
  return { text: text.slice(0, s) + snippet + text.slice(e), start: s + snippet.length, end: s + snippet.length };
}

/** 表格模板（插入到光标处） */
export const TABLE_SNIPPET = '| 列一 | 列二 | 列三 |\n| :-- | :--: | --: |\n| 内容 | 内容 | 内容 |';

/* ==================== 字数统计 ==================== */

/** 简单字数统计（按码点）：字数不含空白，行数按 \n 计（空文本为 0） */
export function countText(text) {
  const source = String(text ?? '');
  const chars = [...source.replace(/\s/g, '')].length;
  const lines = source === '' ? 0 : source.split('\n').length;
  return { chars, lines };
}

/* ==================== 独立 HTML 导出 ==================== */

/** 导出文档内嵌的基础排版样式（无任何外部引用） */
const EXPORT_CSS = `:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;line-height:1.7;color:#1f2430;background:#ffffff;margin:0;padding:32px 20px}
main{max-width:820px;margin:0 auto}
h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.4em 0 .6em}
h1,h2{border-bottom:1px solid #dde0e6;padding-bottom:.3em}
p,ul,ol,dl,blockquote,pre,table{margin:.6em 0}
ul,ol{padding-left:1.8em}
li+li{margin-top:.2em}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:#f0f2f5;border-radius:4px;padding:1px 5px}
pre{background:#f5f6f8;border:1px solid #e3e6eb;border-radius:8px;padding:12px 14px;overflow:auto}
pre code{background:none;padding:0;font-size:.9em}
blockquote{border-left:3px solid #c6cad2;padding:2px 14px;color:#4b5261}
table{border-collapse:collapse}
th,td{border:1px solid #dde0e6;padding:6px 12px}
th{background:#f0f2f5}
img{max-width:100%}
hr{border:0;border-top:1px solid #dde0e6;margin:1.6em 0}
.md-ext-img{display:inline-block;border:1px dashed #9a6700;color:#9a6700;border-radius:6px;padding:0 8px;font-size:.9em}
@media (prefers-color-scheme:dark){body{color:#e8eaf0;background:#15171c}h1,h2{border-color:#2e333d}code{background:#262a32}pre{background:#1a1d23;border-color:#2e333d}blockquote{border-color:#3d4350;color:#b7bdc9}th,td{border-color:#2e333d}th{background:#22262e}hr{border-color:#2e333d}}`;

/**
 * 生成可独立打开的 HTML 文档（内联基础样式，不引用任何外部资源）。
 * @param {string} title 文档标题
 * @param {string} bodyHtml 已渲染（已净化）的正文 HTML
 */
export function buildStandaloneHtml(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${EXPORT_CSS}
</style>
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>
`;
}

/* ==================== 首次打开的示例文档 ==================== */

const SAMPLE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4' +
  '//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

export const SAMPLE_DOC = `# 码工具箱 · Markdown 预览

在左侧编辑 **Markdown**，右侧实时预览。所有内容只在本地浏览器处理，不会上传。

## 行内语法

支持 *斜体*、**加粗**、~~删除线~~、\`行内代码\`、[链接](https://github.com)，
以及自动链接 https://github.com 。

## 列表

- 无序列表项一
- 无序列表项二
  - 嵌套列表项
1. 有序列表项
2. 有序列表项

任务列表：

- [x] 已完成任务
- [ ] 待办任务

## 引用与代码块

> 简单胜于复杂。
> —— Python 之禅

\`\`\`js
// 代码块带语言标注（不做语法高亮）
const greeting = '你好，世界';
console.log(greeting);
\`\`\`

## 表格

| 左对齐 | 居中 | 右对齐 |
| :-- | :--: | --: |
| 1 | 2 | 3 |
| 甲 | 乙 | 丙 |

## 图片

为保护隐私，外部图片默认拦截并显示占位：

![外部图片示例](https://example.com/remote.png)

\`data:\` 图片可以正常显示：

![本地示例图片](${SAMPLE_PNG})

---

内容会自动保存在本地浏览器，刷新页面不丢失；工具栏可插入常用语法模板。
`;
