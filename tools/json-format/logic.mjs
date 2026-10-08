/**
 * JSON 格式化 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 核心是一个手写的严格 RFC 8259 解析器（浏览器自带 JSON.parse 会丢失大整数精度、
 * 报错信息是英文且各引擎不一致，所以本工具自带解析）：
 *   - 不接受注释、尾逗号、单引号、NaN / Infinity、前导零等任何扩展；
 *   - 数字按原始文本保留（大整数、1.0、1e3 原样输出，不丢精度、不改写）；
 *   - 字符串解码转义后按「最小转义」重新输出，中文不转成 \uXXXX；
 *   - 出错时给出从 1 开始的行号 / 列号（列号按字符即码点计）与中文原因。
 *
 * 解析产物是 AST（而非 JS 值），节点形状：
 *   { type: 'object',  entries: [{ key, value }, …] }
 *   { type: 'array',   items: […] }
 *   { type: 'string',  value }
 *   { type: 'number',  raw }            // 原始数字文本
 *   { type: 'literal', name: 'true' | 'false' | 'null' }
 */

/* ==================== 解析 ==================== */

class JsonParseError extends Error {
  constructor(message, index) {
    super(message);
    this.name = 'JsonParseError';
    this.index = index;
  }
}

/** RFC 8259 只允许的四种空白字符：空格、水平制表、换行、回车 */
const JSON_WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

/** 递归层级上限：防止刻意构造的深层嵌套把调用栈打爆 */
export const MAX_DEPTH = 1000;

function isDigit(code) {
  return code >= 0x30 && code <= 0x39;
}

function hexValue(code) {
  if (code >= 0x30 && code <= 0x39) return code - 0x30; // 0-9
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10; // a-f
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10; // A-F
  return -1;
}

/** 错误信息里展示单个字符：控制字符显示为 \uXXXX，其余原样 */
function displayChar(ch) {
  const code = ch.codePointAt(0);
  if (code < 0x20) return `\\u${code.toString(16).padStart(4, '0')}`;
  return ch;
}

class Parser {
  constructor(text) {
    this.text = text;
    this.n = text.length;
    this.i = 0;
    this.depth = 0;
  }

  fail(message, index = this.i) {
    throw new JsonParseError(message, index);
  }

  skipWs() {
    while (this.i < this.n && JSON_WS.has(this.text.charCodeAt(this.i))) this.i++;
  }

  parseValue() {
    if (this.depth >= MAX_DEPTH) this.fail(`嵌套层级过深（最多 ${MAX_DEPTH} 层）`);
    this.skipWs();
    if (this.i >= this.n) this.fail('意外的文件结尾');
    const ch = this.text[this.i];
    const code = this.text.charCodeAt(this.i);
    if (code === 0x7b) return this.parseObject(); // {
    if (code === 0x5b) return this.parseArray(); // [
    if (code === 0x22) return { type: 'string', value: this.parseString() }; // "
    if (ch === 't') return this.parseLiteral('true');
    if (ch === 'f') return this.parseLiteral('false');
    if (ch === 'n') return this.parseLiteral('null');
    if (ch === '-' || isDigit(code)) return this.parseNumber();
    this.fail(`无效的字符「${displayChar(ch)}」（此处应为 JSON 值）`);
  }

  parseLiteral(word) {
    if (!this.text.startsWith(word, this.i)) {
      this.fail(`无效的字面量（此处应为 ${word}）`);
    }
    this.i += word.length;
    return { type: 'literal', name: word };
  }

  parseObject() {
    this.depth++;
    try {
      const entries = [];
      this.i++; // {
      this.skipWs();
      if (this.i >= this.n) this.fail('意外的文件结尾');
      if (this.text[this.i] === '}') {
        this.i++;
        return { type: 'object', entries };
      }
      for (;;) {
        this.skipWs();
        if (this.i >= this.n) this.fail('意外的文件结尾');
        const ch = this.text[this.i];
        if (ch === '}' || ch === ',') {
          // {"a":1,} —— 逗号后面直接是右花括号；{,} —— 开头就是逗号
          this.fail('多余的逗号（此处应为属性名）');
        }
        if (ch !== '"') {
          this.fail(`无效的字符「${displayChar(ch)}」（属性名必须用双引号括起）`);
        }
        const key = this.parseString();
        this.skipWs();
        if (this.i >= this.n) this.fail('意外的文件结尾');
        if (this.text[this.i] !== ':') this.fail('此处应为冒号');
        this.i++; // :
        const value = this.parseValue();
        entries.push({ key, value });
        this.skipWs();
        if (this.i >= this.n) this.fail('意外的文件结尾');
        const tail = this.text[this.i];
        if (tail === ',') {
          this.i++;
          continue;
        }
        if (tail === '}') {
          this.i++;
          return { type: 'object', entries };
        }
        this.fail('缺少逗号或右花括号');
      }
    } finally {
      this.depth--;
    }
  }

  parseArray() {
    this.depth++;
    try {
      const items = [];
      this.i++; // [
      this.skipWs();
      if (this.i >= this.n) this.fail('意外的文件结尾');
      if (this.text[this.i] === ']') {
        this.i++;
        return { type: 'array', items };
      }
      for (;;) {
        items.push(this.parseValue());
        this.skipWs();
        if (this.i >= this.n) this.fail('意外的文件结尾');
        const tail = this.text[this.i];
        if (tail === ',') {
          this.i++;
          this.skipWs();
          if (this.i >= this.n) this.fail('意外的文件结尾');
          if (this.text[this.i] === ']') this.fail('多余的逗号（此处应为 JSON 值）');
          continue;
        }
        if (tail === ']') {
          this.i++;
          return { type: 'array', items };
        }
        this.fail('缺少逗号或右中括号');
      }
    } finally {
      this.depth--;
    }
  }

  /** 严格 RFC 8259 数字：-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?，按原始文本保留 */
  parseNumber() {
    const start = this.i;
    if (this.text.charCodeAt(this.i) === 0x2d) this.i++; // -
    if (this.i >= this.n) this.fail('数字格式错误（意外的文件结尾）', start);
    const first = this.text.charCodeAt(this.i);
    if (first === 0x30) {
      this.i++; // 0
      if (this.i < this.n && isDigit(this.text.charCodeAt(this.i))) {
        this.fail('数字格式错误（不允许前导零）');
      }
    } else if (first >= 0x31 && first <= 0x39) {
      this.skipDigits();
    } else {
      this.fail('数字格式错误（此处应为数字）');
    }
    if (this.text.charCodeAt(this.i) === 0x2e) {
      // .
      this.i++;
      if (this.i >= this.n || !isDigit(this.text.charCodeAt(this.i))) {
        this.fail('数字格式错误（小数点后应有数字）');
      }
      this.skipDigits();
    }
    const exp = this.text.charCodeAt(this.i);
    if (exp === 0x65 || exp === 0x45) {
      // e / E
      this.i++;
      const sign = this.text.charCodeAt(this.i);
      if (sign === 0x2b || sign === 0x2d) this.i++;
      if (this.i >= this.n || !isDigit(this.text.charCodeAt(this.i))) {
        this.fail('数字格式错误（指数部分应有数字）');
      }
      this.skipDigits();
    }
    return { type: 'number', raw: this.text.slice(start, this.i) };
  }

  skipDigits() {
    while (this.i < this.n && isDigit(this.text.charCodeAt(this.i))) this.i++;
  }

  /** 解析双引号字符串（调用时 this.i 指向开引号），返回解码后的值 */
  parseString() {
    const openQuote = this.i;
    this.i++;
    let result = '';
    let chunkStart = this.i;
    for (;;) {
      if (this.i >= this.n) this.fail('字符串未闭合', openQuote);
      const code = this.text.charCodeAt(this.i);
      if (code === 0x22) {
        // "
        result += this.text.slice(chunkStart, this.i);
        this.i++;
        return result;
      }
      if (code === 0x5c) {
        // \
        result += this.text.slice(chunkStart, this.i);
        this.i++;
        if (this.i >= this.n) this.fail('字符串未闭合', openQuote);
        const esc = this.text[this.i];
        switch (esc) {
          case '"': result += '"'; this.i++; break;
          case '\\': result += '\\'; this.i++; break;
          case '/': result += '/'; this.i++; break;
          case 'b': result += '\b'; this.i++; break;
          case 'f': result += '\f'; this.i++; break;
          case 'n': result += '\n'; this.i++; break;
          case 'r': result += '\r'; this.i++; break;
          case 't': result += '\t'; this.i++; break;
          case 'u': {
            let hex = 0;
            for (let k = 1; k <= 4; k++) {
              const d = hexValue(this.text.charCodeAt(this.i + k));
              if (d < 0) this.fail('无效的 \\u 转义（应恰好 4 位十六进制数字）', this.i);
              hex = hex * 16 + d;
            }
            result += String.fromCharCode(hex);
            this.i += 5;
            break;
          }
          default:
            this.fail(`无效的转义字符「\\${displayChar(esc)}」`, this.i - 1);
        }
        chunkStart = this.i;
        continue;
      }
      if (code < 0x20) this.fail('字符串中包含未转义的控制字符');
      this.i++;
    }
  }
}

/**
 * 解析 JSON 文本。
 * @returns {{ ok: true, ast: object }}
 *          | { ok: false, error: { line: number, column: number, index: number, message: string } }
 *          行号 / 列号从 1 开始，列号按字符（码点）计。
 */
export function parseJson(text) {
  const parser = new Parser(text);
  try {
    const ast = parser.parseValue();
    parser.skipWs();
    if (parser.i < parser.n) {
      throw new JsonParseError('多余的内容（JSON 值已结束）', parser.i);
    }
    return { ok: true, ast };
  } catch (err) {
    if (err instanceof JsonParseError) {
      const { line, column } = locate(text, err.index);
      return { ok: false, error: { line, column, index: err.index, message: err.message } };
    }
    if (err instanceof RangeError) {
      // 理论上被 MAX_DEPTH 拦截，这里兜底（如超长行导致 locate 递归等异常情况）
      const { line, column } = locate(text, parser.i);
      return { ok: false, error: { line, column, index: parser.i, message: '嵌套层级过深' } };
    }
    throw err;
  }
}

/* ==================== 序列化 ==================== */

const HEX_DIGITS = '0123456789abcdef';

function unicodeEscape(code) {
  return (
    '\\u' +
    HEX_DIGITS[(code >>> 12) & 15] +
    HEX_DIGITS[(code >>> 8) & 15] +
    HEX_DIGITS[(code >>> 4) & 15] +
    HEX_DIGITS[code & 15]
  );
}

/**
 * 按最小转义输出字符串字面量：
 * 只转义必须转义的字符（引号、反斜杠、控制字符），中文等原样输出不转成 \uXXXX；
 * 孤立代理项按 \uXXXX 转义，保证输出是合法的 UTF-16 文本。
 */
function quoteString(s) {
  const pieces = ['"'];
  let start = 0;
  const flush = (i, esc) => {
    if (i > start) pieces.push(s.slice(start, i));
    pieces.push(esc);
    start = i + 1;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) flush(i, '\\"');
    else if (c === 0x5c) flush(i, '\\\\');
    else if (c === 0x08) flush(i, '\\b');
    else if (c === 0x09) flush(i, '\\t');
    else if (c === 0x0a) flush(i, '\\n');
    else if (c === 0x0c) flush(i, '\\f');
    else if (c === 0x0d) flush(i, '\\r');
    else if (c < 0x20) flush(i, unicodeEscape(c));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) i++; // 合法代理对：两个单元原样保留
      else flush(i, unicodeEscape(c)); // 孤立高代理
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      flush(i, unicodeEscape(c)); // 孤立低代理
    }
  }
  pieces.push(s.slice(start), '"');
  return pieces.join('');
}

/** 按码点升序比较（UTF-16 代理对按单个码点参与比较），用于「按键名排序」 */
export function compareKeys(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i);
    const cb = b.codePointAt(j);
    if (ca !== cb) return ca - cb;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  // 剩余 code unit 数为 0 等价于已耗尽；只看符号
  return a.length - i - (b.length - j);
}

/**
 * 把 AST 序列化为 JSON 文本。
 * @param {object} ast parseJson 得到的 AST
 * @param {{ indent?: 2 | 4 | 'tab', sortKeys?: boolean, minify?: boolean }} [options]
 *   indent   缩进：2 / 4 个空格或 'tab'（minify 时忽略）
 *   sortKeys 递归地把对象键按码点升序排列（数组顺序不变）
 *   minify   压缩为一行
 */
export function serialize(ast, { indent = 2, sortKeys = false, minify = false } = {}) {
  const unit = indent === 'tab' ? '\t' : ' '.repeat(indent === 4 ? 4 : 2);
  const parts = [];

  function writeValue(node, depth) {
    if (node.type === 'object') writeObject(node, depth);
    else if (node.type === 'array') writeArray(node, depth);
    else if (node.type === 'string') parts.push(quoteString(node.value));
    else if (node.type === 'number') parts.push(node.raw);
    else parts.push(node.name); // literal: true / false / null
  }

  function writeEntries(nodes, depth, writeOne, open, close) {
    // 空容器不拆行：{} / []
    if (nodes.length === 0) {
      parts.push(open + close);
      return;
    }
    const innerPad = minify ? '' : unit.repeat(depth + 1);
    parts.push(minify ? open : open + '\n');
    for (let k = 0; k < nodes.length; k++) {
      if (k > 0) parts.push(minify ? ',' : ',\n');
      parts.push(innerPad);
      writeOne(nodes[k], depth + 1);
    }
    parts.push(minify ? '' : '\n' + unit.repeat(depth));
    parts.push(close);
  }

  function writeObject(node, depth) {
    const entries = sortKeys ? [...node.entries].sort((a, b) => compareKeys(a.key, b.key)) : node.entries;
    writeEntries(
      entries,
      depth,
      (entry, innerDepth) => {
        parts.push(quoteString(entry.key));
        parts.push(minify ? ':' : ': ');
        writeValue(entry.value, innerDepth);
      },
      '{',
      '}',
    );
  }

  function writeArray(node, depth) {
    writeEntries(node.items, depth, (item, innerDepth) => writeValue(item, innerDepth), '[', ']');
  }

  writeValue(ast, 0);
  return parts.join('');
}

/* ==================== 统计与定位 ==================== */

/** 字符数（按码点计；家庭 emoji 这类多码点字形算多个字符） */
export function countCodePoints(text) {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) i++; // 代理对算 1 个码点
    }
    count++;
  }
  return count;
}

/** 层级深度（容器嵌套层数，顶层标量为 0，{} / [] 为 1）与键数量（递归统计所有对象的键） */
export function analyzeAst(ast) {
  let keys = 0;
  let depth = 0;
  (function walk(node, d) {
    if (node.type === 'object') {
      if (d + 1 > depth) depth = d + 1;
      keys += node.entries.length;
      for (const { value } of node.entries) walk(value, d + 1);
    } else if (node.type === 'array') {
      if (d + 1 > depth) depth = d + 1;
      for (const item of node.items) walk(item, d + 1);
    }
  })(ast, 0);
  return { depth, keys };
}

/**
 * 把码点偏移换算为 1 起始的行号 / 列号（列号按字符即码点计）。
 * \n、\r 各算一个换行，\r\n 合并为一个。
 */
export function locate(text, index) {
  const target = Math.min(Math.max(index, 0), text.length);
  let line = 1;
  let column = 1;
  let i = 0;
  while (i < target) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) {
      line++;
      column = 1;
      i++;
      continue;
    }
    if (c === 0x0d) {
      line++;
      column = 1;
      i++;
      if (text.charCodeAt(i) === 0x0a) i++; // \r\n 算一个换行
      continue;
    }
    i++;
    if (c >= 0xd800 && c <= 0xdbff && text.charCodeAt(i) >= 0xdc00 && text.charCodeAt(i) <= 0xdfff) {
      i++; // 代理对算 1 列
    }
    column++;
  }
  return { line, column };
}

/**
 * 错误上下文：出错位置前后各约 radius 个字符，第二行用 ^ 指出位置。
 * 换行显示为 ⏎、制表符显示为空格，保证单行对齐；截断处用省略号。
 */
export function errorContext(text, index, radius = 20) {
  const safeIndex = Math.min(Math.max(index, 0), text.length);
  let start = Math.max(0, safeIndex - radius);
  let end = Math.min(text.length, safeIndex + radius);
  // 不把代理对从中间切开
  if (start > 0) {
    const c = text.charCodeAt(start);
    if (c >= 0xdc00 && c <= 0xdfff) start++;
  }
  if (end < text.length) {
    const c = text.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end--;
  }
  const toDisplay = (s) => s.replace(/\r\n|\r|\n/g, '⏎').replace(/\t/g, ' ');
  const head = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';
  const snippet = toDisplay(text.slice(start, end));
  const caretOffset = head.length + toDisplay(text.slice(start, safeIndex)).length;
  return `${head}${snippet}${tail}\n${' '.repeat(caretOffset)}^`;
}

/* ==================== 对外主入口 ==================== */

export const ACTIONS = ['format', 'minify', 'validate'];

/**
 * 执行一个操作（格式化 / 压缩 / 校验）。
 * @param {string} input 原始输入
 * @param {{ action?: 'format' | 'minify' | 'validate', indent?: 2 | 4 | 'tab', sortKeys?: boolean }} [options]
 * @returns {{
 *   status: 'empty' | 'valid' | 'invalid',
 *   output: string,          // 结果文本（校验或出错时为 ''）
 *   message: string,         // 「请输入 JSON」/「JSON 合法」/「第 x 行第 y 列：原因」
 *   error: null | { line, column, index, message },
 *   context: null | string,  // 出错时的上下文片段（含 ^ 指示行）
 *   stats: null | { chars, depth, keys },
 * }}
 */
export function runAction(input, { action = 'format', indent = 2, sortKeys = false } = {}) {
  if (typeof input !== 'string' || input.trim() === '') {
    return { status: 'empty', output: '', message: '请输入 JSON', error: null, context: null, stats: null };
  }
  const parsed = parseJson(input);
  if (!parsed.ok) {
    const { line, column, message, index } = parsed.error;
    return {
      status: 'invalid',
      output: '',
      message: `第 ${line} 行第 ${column} 列：${message}`,
      error: parsed.error,
      context: errorContext(input, index),
      stats: null,
    };
  }
  const stats = { chars: countCodePoints(input), ...analyzeAst(parsed.ast) };
  if (action === 'validate') {
    return { status: 'valid', output: '', message: 'JSON 合法', error: null, context: null, stats };
  }
  const output = serialize(parsed.ast, { indent, sortKeys, minify: action === 'minify' });
  return { status: 'valid', output, message: 'JSON 合法', error: null, context: null, stats };
}
