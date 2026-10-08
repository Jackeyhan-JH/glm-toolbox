/**
 * YAML 子集解析与序列化（自写，不依赖第三方库）。
 *
 * 支持范围（YAML 1.2 核心模式的常用子集，见 issue #4）：
 *   - 块映射 / 块序列（含「键:」后序列与键同级、序列项内紧凑映射 `- a: 1`、`- - a`）
 *   - 流式写法 [a, b] / {a: 1}（可跨行）
 *   - 单 / 双引号字符串（可跨行折叠）
 *   - 多行字符串块 | 与 >（含 - / + 裁剪指示符与数字缩进指示符）
 *   - 注释（# 需位于行首或空白之后，引号内的 # 不算）
 *   - 多文档（--- / ... 分隔，多文档解析为 JSON 数组）
 *   - 核心标量类型：null（~ / null / 空）、true / false、整数（十进制 / 0x / 0o）、浮点、.inf / .nan
 *
 * 明确不支持（给出中文提示而不是崩溃）：锚点 &、别名 *、标签 !!、复杂键 ?、% 指令。
 * 所有解析错误抛 ConvertError，message 含「第 X 行」。
 */

import { ConvertError, atPosition } from './errors.mjs';

/* ==================== 标量类型识别（YAML 1.2 核心） ==================== */

/**
 * 普通文本（不带引号）应识别成什么类型；解析与「JSON → YAML 需不需要加引号」共用，
 * 保证往返一致（字符串保型）。
 * @param {string} s
 * @returns {null|boolean|number|string}
 */
export function resolvePlain(s) {
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (/^[+-]?[0-9]+$/.test(s)) return Number(s);
  if (/^0x[0-9a-fA-F]+$/.test(s)) return Number.parseInt(s.slice(2), 16);
  if (/^0o[0-7]+$/.test(s)) return Number.parseInt(s.slice(2), 8);
  if (/^[+-]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][+-]?[0-9]+)?$/.test(s)) return Number(s);
  if (/^[+-]?\.(inf|Inf|INF)$/.test(s)) return s[0] === '-' ? -Infinity : Infinity;
  if (/^[+-]?\.(nan|NaN|NAN)$/.test(s)) return NaN;
  return s;
}

/* ==================== 引号字符串扫描 ==================== */

const DOUBLE_ESCAPES = {
  0: '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  n: '\n',
  v: '\x0b',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
};

/**
 * 从 src[start]（必须是 ' 或 "）扫描一个引号字符串。
 * @returns {{ value: string, end: number }} end 为结束引号之后的位置
 * @throws {ConvertError} 未闭合或非法转义
 */
export function scanQuoted(src, start, lineNo) {
  const quote = src[start];
  let out = '';
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (quote === "'") {
      if (c === "'") {
        if (src[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        return { value: out, end: i + 1 };
      }
      out += c;
      i += 1;
      continue;
    }
    if (c === '"') return { value: out, end: i + 1 };
    if (c === '\\') {
      const e = src[i + 1];
      if (e === 'x' && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 2, i + 4))) {
        out += String.fromCharCode(Number.parseInt(src.slice(i + 2, i + 4), 16));
        i += 4;
        continue;
      }
      if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
        out += String.fromCharCode(Number.parseInt(src.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      }
      if (e === 'U' && /^[0-9a-fA-F]{8}$/.test(src.slice(i + 2, i + 10))) {
        out += String.fromCodePoint(Number.parseInt(src.slice(i + 2, i + 10), 16));
        i += 10;
        continue;
      }
      if (e in DOUBLE_ESCAPES) {
        out += DOUBLE_ESCAPES[e];
        i += 2;
        continue;
      }
      throw atPosition(`双引号字符串里的转义「\\${e ?? ''}」不合法`, lineNo);
    }
    out += c;
    i += 1;
  }
  throw atPosition(
    quote === "'" ? "单引号字符串未闭合（缺少结束的 '）" : '双引号字符串未闭合（缺少结束的 "）',
    lineNo,
  );
}

/* ==================== 小工具 ==================== */

function isMeaningfulLine(text) {
  const t = text.trim();
  return t !== '' && !t.startsWith('#');
}

/** 去掉行尾注释（# 需位于行首或空白后；引号内的 # 不算注释） */
function stripTrailingComment(s) {
  let inDouble = false;
  let inSingle = false;
  let escape = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inDouble) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (c === "'") {
        if (s[i + 1] === "'") i += 1;
        else inSingle = false;
      }
      continue;
    }
    if (c === '"') inDouble = true;
    else if (c === "'") inSingle = true;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

/** 求一行的缩进空格数与去缩进后的内容；缩进里出现 Tab 直接报错 */
function splitIndent(text, lineNo) {
  let i = 0;
  while (i < text.length && text[i] === ' ') i += 1;
  if (text[i] === '\t') {
    throw atPosition('缩进不能使用 Tab（制表符），请改用空格', lineNo);
  }
  return { indent: i, text: text.slice(i) };
}

const isSeqEntry = (bare) => bare === '-' || /^-\s/.test(bare);

/** 建立自有属性：__proto__ 这类键不会变成原型设定而被丢掉，顺序与插入顺序一致 */
function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

/** 该行是否是「键: 值」形式（先粗判，真正取键在 parseKey） */
function isKeyLine(bare) {
  if (bare.startsWith('"') || bare.startsWith("'")) {
    try {
      const { end } = scanQuoted(bare, 0, 0);
      return bare.slice(end).replace(/^[ \t]*/, '').startsWith(':');
    } catch {
      return false; // 引号未闭合：交给标量解析路径给出更明确的错误
    }
  }
  for (let i = 0; i < bare.length; i += 1) {
    if (bare[i] === ':' && (i + 1 === bare.length || bare[i + 1] === ' ')) return true;
  }
  return false;
}

/* ==================== 行游标 ==================== */

class LineCursor {
  constructor(lines) {
    this.lines = lines;
    this.i = 0;
  }

  current() {
    return this.i < this.lines.length ? this.lines[this.i] : null;
  }

  advance() {
    this.i += 1;
  }

  /** 跳过空行与整行注释 */
  skipIgnorable() {
    while (this.i < this.lines.length && !isMeaningfulLine(this.lines[this.i].text)) this.i += 1;
  }

  /** 只看下一个有效行，不移动游标 */
  peekMeaningful() {
    const save = this.i;
    this.skipIgnorable();
    const line = this.current();
    this.i = save;
    return line;
  }
}

/* ==================== 文档切分 ==================== */

/**
 * 按 --- / ... 切分多文档。
 * 每段是 { lines, startsAfterEnd }；lines 为 { text, no }（no 是 1 起始的物理行号）。
 */
function splitDocuments(rawLines) {
  const segments = [];
  let current = { lines: [], startsAfterEnd: false };
  for (const line of rawLines) {
    const t = line.text.trimEnd();
    if (/^---(\s|$)/.test(t)) {
      segments.push(current);
      const rest = t.slice(3).replace(/^[ \t]+/, '');
      current =
        rest === ''
          ? { lines: [], startsAfterEnd: false }
          : { lines: [{ text: ' '.repeat(t.length - rest.length) + rest, no: line.no }], startsAfterEnd: false };
      continue;
    }
    if (/^\.\.\.(\s|$)/.test(t)) {
      segments.push(current);
      current = { lines: [], startsAfterEnd: true };
      continue;
    }
    current.lines.push(line);
  }
  segments.push(current);
  return { segments };
}

/* ==================== 块级解析 ==================== */

/**
 * 解析一个块节点（映射 / 序列 / 流式集合 / 单行标量）。
 * 若下一个有效行缩进小于 minIndent（或没有更多行）返回 null。
 * 约定：进入时游标指向本节点的首行（未消费）；返回时该行已被消费。
 */
function parseNodeAt(cursor, minIndent) {
  cursor.skipIgnorable();
  const line = cursor.current();
  if (!line) return null;
  const { indent, text } = splitIndent(line.text, line.no);
  if (indent < minIndent) return null;
  const bare = stripTrailingComment(text);
  if (isSeqEntry(bare)) return parseSequence(cursor, indent);
  if (bare[0] === '{' || bare[0] === '[') {
    // 流式集合优先于键判断：{a: 1} 会被冒号探测误判成映射
    cursor.advance();
    return { value: parseFlowAcrossLines(cursor, bare, line.no) };
  }
  if (isKeyLine(bare)) return parseMapping(cursor, indent);
  cursor.advance(); // 标量节点：本行即刻消费，跨行部分由 parseInlineValue 继续
  return { value: parseInlineValue(cursor, bare, line.no) };
}

function parseSequence(cursor, seqIndent) {
  const items = [];
  for (;;) {
    const line = cursor.peekMeaningful();
    if (!line) break;
    const { indent, text } = splitIndent(line.text, line.no);
    if (indent < seqIndent) break;
    if (indent > seqIndent) {
      throw atPosition(`缩进错误：这一行比序列项（${seqIndent} 个空格）缩进更深，无法确定归属`, line.no);
    }
    const bare = stripTrailingComment(text);
    if (!isSeqEntry(bare)) break; // 同层出现非序列行：序列结束，交还上层

    cursor.advance();
    const rest = bare === '-' ? '' : bare.slice(2);
    let pad = 0;
    while (rest[pad] === ' ') pad += 1;
    const content = rest.slice(pad);
    if (content === '') {
      // 「-」后面为空：值在后续更深的行里
      const child = parseNodeAt(cursor, seqIndent + 1);
      items.push(child ? child.value : null);
    } else {
      // 把「- 」替换成等宽空格，内容列对齐后当作新节点解析（支持 - a: 1 / - - a 等紧凑写法）
      const contentCol = indent + 2 + pad;
      line.text = ' '.repeat(contentCol) + content;
      cursor.i -= 1;
      const child = parseNodeAt(cursor, contentCol);
      items.push(child ? child.value : null);
    }
  }
  return { value: items };
}

function parseMapping(cursor, mapIndent) {
  const result = {};
  const seenKeys = new Set();
  for (;;) {
    const line = cursor.peekMeaningful();
    if (!line) break;
    const { indent, text } = splitIndent(line.text, line.no);
    if (indent < mapIndent) break;
    if (indent > mapIndent) {
      throw atPosition(
        '缩进错误：这一行比当前层级缩进更深，无法确定它属于哪个键（若要写跨行文本，请用 | 或 > 块字符串，或加引号）',
        line.no,
      );
    }
    const bare = stripTrailingComment(text);
    if (isSeqEntry(bare)) break; // 同层序列：映射结束，交还上层
    if (bare.startsWith('%')) throw atPosition('暂不支持 % 指令（如 %YAML）', line.no);

    const { key, rest } = parseKey(bare, line.no);
    if (seenKeys.has(key)) {
      throw atPosition(`重复的键「${key}」：YAML 要求同一层级的键唯一`, line.no);
    }
    seenKeys.add(key);
    const cleanRest = rest.replace(/^[ \t]+/, '');
    cursor.advance(); // 键值行已分析完，接下来消费它的值

    if (cleanRest === '') {
      // 值在后续行：更深的任意节点；或与本键同级的序列（tags:\n- a 也是合法 YAML）
      const child = parseNodeAt(cursor, mapIndent + 1);
      if (child) {
        setOwn(result, key, child.value);
        continue;
      }
      const nxt = cursor.peekMeaningful();
      if (nxt) {
        const peek = splitIndent(nxt.text, nxt.no);
        const peekBare = stripTrailingComment(peek.text);
        if (peek.indent === mapIndent && isSeqEntry(peekBare)) {
          setOwn(result, key, parseSequence(cursor, mapIndent).value);
          continue;
        }
      }
      setOwn(result, key, null);
      continue;
    }

    const first = cleanRest[0];
    if (first === '|' || first === '>') {
      setOwn(result, key, parseBlockScalar(cursor, mapIndent, stripTrailingComment(cleanRest), line.no));
      continue;
    }
    setOwn(result, key, parseInlineValue(cursor, cleanRest, line.no));
  }
  return { value: result };
}

/** 解析「键: …」行里的键；返回 { key: string, rest: string } */
function parseKey(bare, lineNo) {
  if (bare === '?' || bare.startsWith('? ')) {
    throw atPosition('暂不支持复杂键（? 写法），请改成普通的「键: 值」', lineNo);
  }
  if (bare.startsWith('"') || bare.startsWith("'")) {
    const { value, end } = scanQuoted(bare, 0, lineNo);
    const after = bare.slice(end).replace(/^[ \t]*/, '');
    if (!after.startsWith(':')) {
      throw atPosition('键后面缺少冒号（键与冒号之间只能有空格）', lineNo);
    }
    return { key: value, rest: after.slice(1) };
  }
  for (let i = 0; i < bare.length; i += 1) {
    if (bare[i] === ':' && (i + 1 === bare.length || bare[i + 1] === ' ')) {
      const resolved = resolvePlain(bare.slice(0, i).trimEnd());
      return { key: resolved === null ? 'null' : String(resolved), rest: bare.slice(i + 1) };
    }
  }
  throw atPosition('缺少「:」：不是合法的键值对（冒号后要跟一个空格，或写在行尾）', lineNo);
}

/**
 * 行内值（或独立成节点的单行标量 / 流式集合）。
 * 进入时所在行已被消费；跨行的引号字符串与流式集合会继续消费后续行。
 */
function parseInlineValue(cursor, rest, lineNo) {
  const first = rest[0];
  if (first === undefined) return null;
  if (first === '&') throw atPosition('暂不支持锚点（&锚点名），请直接写内容', lineNo);
  if (first === '*') throw atPosition('暂不支持别名引用（*锚点名），请直接写内容', lineNo);
  if (first === '!') throw atPosition('暂不支持标签（! 或 !!），请去掉标签直接写值', lineNo);
  if (first === '?') throw atPosition('暂不支持复杂键（? 写法），请改成普通的「键: 值」', lineNo);
  if (first === '%') throw atPosition('暂不支持 % 指令（如 %YAML）', lineNo);
  if (first === '{' || first === '[') return parseFlowAcrossLines(cursor, rest, lineNo);
  if (first === '"' || first === "'") return parseQuotedValue(cursor, rest, lineNo);

  const clean = stripTrailingComment(rest);
  if (clean.includes(': ') || clean.endsWith(':')) {
    throw atPosition('值里包含「: 」，如果它是文本的一部分，请给整个值加引号', lineNo);
  }
  return resolvePlain(clean);
}

/** 引号字符串作值：本行没闭合时继续吃后续行（换行折叠为空格，空行变换行） */
function parseQuotedValue(cursor, rest, lineNo) {
  let buffer = rest;
  let currentLineNo = lineNo;
  for (;;) {
    let scanned;
    try {
      scanned = scanQuoted(buffer, 0, lineNo);
    } catch (err) {
      if (!(err instanceof ConvertError) || !/未闭合/.test(err.message)) throw err;
      const next = cursor.current();
      if (!next) throw atPosition('引号字符串未闭合（缺少结束引号）', currentLineNo);
      const t = next.text.trim();
      buffer += t === '' ? '\n' : ` ${t}`;
      currentLineNo = next.no;
      cursor.advance();
      continue;
    }
    const tail = buffer.slice(scanned.end).trim();
    if (tail !== '' && !tail.startsWith('#')) {
      throw atPosition(`引号字符串后面有多余内容「${tail.slice(0, 20)}」`, currentLineNo);
    }
    return scanned.value;
  }
}

/* ==================== 流式集合（可跨行） ==================== */

/**
 * 从 rest（以 [ 或 { 开头）收集一段配平的流式文本（跨行时行与行之间视为空格），
 * 再交给递归下降的 flow 解析器。
 */
function parseFlowAcrossLines(cursor, rest, lineNo) {
  let text = rest;
  for (;;) {
    const state = scanFlowBalance(text);
    if (state.closed) {
      const trailing = text.slice(state.end).trim();
      if (trailing !== '' && !trailing.startsWith('#')) {
        throw atPosition(`流式集合后面有多余内容「${trailing.slice(0, 20)}」`, lineNo);
      }
      return parseFlowValue(text.slice(0, state.end), 0, lineNo)[0];
    }
    const next = cursor.current();
    if (!next) {
      throw atPosition(
        rest[0] === '[' ? '流式序列 [ 未闭合（缺少 ]）' : '流式映射 { 未闭合（缺少 }）',
        lineNo,
      );
    }
    cursor.advance();
    text += ` ${next.text.trim()}`;
  }
}

/** 扫描流式文本的括号配平；closed 且 end 为闭合括号之后的位置 */
function scanFlowBalance(text) {
  let depth = 0;
  let inDouble = false;
  let inSingle = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inDouble) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (c === "'") {
        if (text[i + 1] === "'") i += 1;
        else inSingle = false;
      }
      continue;
    }
    if (c === '"') inDouble = true;
    else if (c === "'") inSingle = true;
    else if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return { closed: true, end: i + 1 };
    }
  }
  return { closed: false, end: -1 };
}

/** 流式里冒号何时结束普通标量：后跟空格或流式符号（http://x 这种不算） */
function flowColonEnds(s, j) {
  const next = s[j + 1];
  return next === undefined || next === ' ' || ',[]{}'.includes(next);
}

/** 流式递归下降解析：返回 [值, 结束下标]；错误统一报流式起始行 */
function parseFlowValue(s, i, lineNo) {
  const skipWs = (j) => {
    while (j < s.length && /\s/.test(s[j])) j += 1;
    return j;
  };
  i = skipWs(i);
  if (i >= s.length) throw atPosition('流式集合不完整（意外结束）', lineNo);

  const c = s[i];
  if (c === '[') {
    i = skipWs(i + 1);
    const arr = [];
    if (s[i] === ']') return [arr, i + 1];
    for (;;) {
      const [v, ni] = parseFlowValue(s, i, lineNo);
      arr.push(v);
      i = skipWs(ni);
      if (s[i] === ',') {
        i = skipWs(i + 1);
        if (s[i] === ']') return [arr, i + 1]; // 允许尾逗号
        continue;
      }
      if (s[i] === ']') return [arr, i + 1];
      throw atPosition(`流式序列里应为「,」或「]」，实际是「${s[i] ?? '结束'}」`, lineNo);
    }
  }
  if (c === '{') {
    i = skipWs(i + 1);
    const obj = {};
    const seenKeys = new Set();
    if (s[i] === '}') return [obj, i + 1];
    for (;;) {
      let key;
      if (s[i] === '"' || s[i] === "'") {
        const scanned = scanQuoted(s, i, lineNo);
        key = scanned.value;
        i = skipWs(scanned.end);
      } else {
        let j = i;
        while (j < s.length && !',{}[]"'.includes(s[j]) && !(s[j] === ':' && flowColonEnds(s, j))) j += 1;
        const raw = s.slice(i, j).trim();
        if (raw === '') throw atPosition('流式映射里的键不能为空', lineNo);
        const resolved = resolvePlain(raw);
        key = resolved === null ? 'null' : String(resolved);
        i = skipWs(j);
      }
      if (seenKeys.has(key)) {
        throw atPosition(`流式映射里重复的键「${key}」：YAML 要求同一层级的键唯一`, lineNo);
      }
      seenKeys.add(key);
      let value = null;
      if (s[i] === ':') {
        i = skipWs(i + 1);
        if (s[i] !== ',' && s[i] !== '}') {
          const [v, ni] = parseFlowValue(s, i, lineNo);
          value = v;
          i = skipWs(ni);
        }
      }
      setOwn(obj, key, value);
      if (s[i] === ',') {
        i = skipWs(i + 1);
        if (s[i] === '}') return [obj, i + 1]; // 允许尾逗号
        continue;
      }
      if (s[i] === '}') return [obj, i + 1];
      throw atPosition(`流式映射里应为「,」或「}」，实际是「${s[i] ?? '结束'}」`, lineNo);
    }
  }
  if (c === '"' || c === "'") {
    const scanned = scanQuoted(s, i, lineNo);
    return [scanned.value, scanned.end];
  }
  // 普通标量：读到 , ] } 或「: 」（后跟空格 / 流式符号）为止
  let j = i;
  while (j < s.length && !',]}'.includes(s[j]) && !(s[j] === ':' && flowColonEnds(s, j))) j += 1;
  const raw = s.slice(i, j).trim();
  if (raw === '') throw atPosition('应为值（数字、字符串、[ ] 或 { }）', lineNo);
  return [resolvePlain(raw), j];
}

/* ==================== 块字符串（| 与 >） ==================== */

/**
 * @param {LineCursor} cursor
 * @param {number} parentIndent 键所在行的缩进
 * @param {string} rest 「|」「>-」「|2」等头部（已去行尾注释）
 * @param {number} lineNo 头部所在行号
 */
function parseBlockScalar(cursor, parentIndent, rest, lineNo) {
  const m = /^([|>])([+-]?\d?|\d[+-]?)?\s*$/.exec(rest);
  if (!m) throw atPosition('块字符串头部写法不正确（应为 |、|+、|-、>-、|2 这类形式）', lineNo);
  const style = m[1];
  const mods = m[2] ?? '';
  const chomp = mods.includes('+') ? 'keep' : mods.includes('-') ? 'strip' : 'clip';
  const digit = /\d/.exec(mods);
  const explicitIndent = digit ? parentIndent + Number(digit[0]) : null;

  // 找内容缩进并收集属性行（空行照收，遇到更浅的非空行即结束）
  const lines = [];
  let detectedIndent = explicitIndent;
  while (cursor.i < cursor.lines.length) {
    const entry = cursor.lines[cursor.i];
    if (entry.text.trim() === '') {
      lines.push('');
      cursor.i += 1;
      continue;
    }
    const { indent } = splitIndent(entry.text, entry.no);
    if (detectedIndent === null) {
      if (indent <= parentIndent) break; // 块字符串为空
      detectedIndent = indent;
    }
    if (indent < detectedIndent) break; // 更浅的非空行：块结束（是否合法由上层判断）
    lines.push(entry.text.slice(detectedIndent));
    cursor.i += 1;
  }

  const hasContent = lines.some((t) => t !== '');
  let value;
  if (!hasContent) {
    value = '';
  } else if (style === '|') {
    value = lines.map((t) => `${t}\n`).join('');
  } else {
    value = foldLines(lines);
  }
  if (chomp === 'strip') return value.replace(/\n+$/, '');
  if (chomp === 'keep') return value;
  return hasContent ? `${value.replace(/\n+$/, '')}\n` : '';
}

/** 折叠（>）：普通相邻行并为空格；空行变换行；与「更缩进行」相邻的换行保留 */
function foldLines(lines) {
  let out = '';
  let prev = 'start'; // start | normal | more | blank
  for (const t of lines) {
    if (t === '') {
      out += '\n';
      prev = 'blank';
    } else if (t.startsWith(' ')) {
      out += (prev === 'start' ? '' : '\n') + t;
      prev = 'more';
    } else if (prev === 'start' || prev === 'blank') {
      out += t;
      prev = 'normal';
    } else if (prev === 'more') {
      out += `\n${t}`;
      prev = 'normal';
    } else {
      out += ` ${t}`;
      prev = 'normal';
    }
  }
  return out === '' || out.endsWith('\n') ? out : `${out}\n`;
}

/* ==================== 入口：parseYaml ==================== */

/**
 * 解析 YAML 文本。
 * @param {string} text
 * @returns {{ value: unknown, docs: number }} 多文档时 value 为数组
 * @throws {ConvertError}
 */
export function parseYaml(text) {
  if (typeof text !== 'string') throw new ConvertError('YAML 解析失败：输入必须是文本');
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const split = normalized.split('\n');
  if (split.length > 1 && split[split.length - 1] === '') split.pop(); // 行尾换行是终止符，不是空行
  const rawLines = split.map((t, idx) => ({ text: t, no: idx + 1 }));

  const { segments } = splitDocuments(rawLines);
  const docs = [];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const meaningful = seg.lines.filter((l) => isMeaningfulLine(l.text));
    if (meaningful.length === 0) {
      // 空段：首个 --- 之前、以及 ... 之后（文档未开始）的不算文档；
      // --- 之后的空文档保留为 null（如「---\n---\na: 1」→ [null, {a:1}]）。
      if (i > 0 && !seg.startsAfterEnd) docs.push(null);
      continue;
    }
    if (seg.startsAfterEnd) {
      throw atPosition('文档结束标记「...」之后不应再有内容（新文档请用「---」开始）', meaningful[0].no);
    }
    const cursor = new LineCursor(seg.lines);
    const node = parseNodeAt(cursor, 0);
    cursor.skipIgnorable();
    const leftover = cursor.current();
    if (leftover) {
      throw atPosition('这一行无法解析：请检查缩进或多余的符号', leftover.no);
    }
    docs.push(node ? node.value : null);
  }

  if (docs.length <= 1) return { value: docs[0] ?? null, docs: 1 };
  return { value: docs, docs: docs.length };
}

/* ==================== 序列化：stringifyYaml ==================== */

const ALWAYS_UNSAFE_FIRST = '#,[]{}&*!|>\'"%@`';

/**
 * 会被 YAML 1.1 解析器（PyYAML、Ansible、Ruby、不少 K8s / CI 工具）读成
 * 布尔 / 日期 / 六十进制数字的普通写法。本工具解析方向按 YAML 1.2 保持不变，
 * 但序列化时要加引号，免得生成的配置拿去别处用被误读（如「挪威问题」的 no → false）。
 */
const YAML11_BOOL_RE = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF)$/;
const YAML11_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}/;
const YAML11_SEXAGESIMAL_RE = /^\d+(?::[0-5]?\d)+$/;
const YAML11_UNDERSCORE_NUM_RE = /^[-+]?\d[\d_]*$/;

/** 字符串是否必须加引号（会被误读为其他类型，或普通写法在语法上不安全） */
export function plainNeedsQuote(s) {
  if (s === '') return true;
  if (typeof resolvePlain(s) !== 'string') return true; // 会被识别成 null / 布尔 / 数字
  if (/[\n\r\t\u0000-\u001f\u007f]/.test(s)) return true; // 控制字符：需要双引号转义
  if (YAML11_BOOL_RE.test(s)) return true; // 会被 YAML 1.1 读成布尔
  if (YAML11_TIMESTAMP_RE.test(s)) return true; // 会被 YAML 1.1 读成日期
  if (YAML11_SEXAGESIMAL_RE.test(s)) return true; // 会被 YAML 1.1 读成六十进制数字
  if (YAML11_UNDERSCORE_NUM_RE.test(s)) return true; // 会被 YAML 1.1 读成带下划线数字
  if (ALWAYS_UNSAFE_FIRST.includes(s[0])) return true;
  if (/^[-?:]( |$)/.test(s)) return true;
  if (s.startsWith(' ') || s.endsWith(' ')) return true;
  if (s.includes(': ') || s.endsWith(':')) return true;
  if (s.includes(' #')) return true;
  if (s === '---' || s === '...') return true;
  return false;
}

const DQ_ESCAPES = {
  '"': '\\"',
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\0': '\\0',
  '\x07': '\\a',
  '\b': '\\b',
  '\x0b': '\\v',
  '\f': '\\f',
  '\x1b': '\\e',
  '\u007f': '\\u007f',
};

/** 标量 → YAML 文本（必要时加引号；含控制字符的用双引号转义） */
function scalarText(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : v > 0 ? '.inf' : '-.inf';
  if (typeof v === 'boolean') return String(v);
  if (typeof v !== 'string') return String(v);
  if (!plainNeedsQuote(v)) return v;
  if (/[\n\r\t\u0000-\u001f\u007f]/.test(v)) {
    return `"${v.replace(/["\\\n\r\t\u0000-\u001f\u007f]/g, (ch) => DQ_ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
  }
  return `'${v.replace(/'/g, "''")}'`;
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isScalarValue = (v) => v === null || v === undefined || typeof v !== 'object';

/** 映射 → 带缩进的行数组（每行已含自身缩进，便于序列项复用首行） */
function mapLines(obj, indent) {
  const pad = ' '.repeat(indent);
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = scalarText(k);
    if (isScalarValue(v)) {
      out.push(`${pad}${key}: ${scalarText(v)}`);
    } else if (Array.isArray(v)) {
      if (v.length === 0) out.push(`${pad}${key}: []`);
      else {
        out.push(`${pad}${key}:`);
        out.push(...seqLines(v, indent + 2));
      }
    } else if (isPlainObject(v)) {
      if (Object.keys(v).length === 0) out.push(`${pad}${key}: {}`);
      else {
        out.push(`${pad}${key}:`);
        out.push(...mapLines(v, indent + 2));
      }
    }
  }
  return out;
}

/** 序列 → 带缩进的行数组；序列项整体缩进到父键之下（issue 约定） */
function seqLines(arr, indent) {
  const pad = ' '.repeat(indent);
  const out = [];
  for (const item of arr) {
    if (isScalarValue(item)) {
      out.push(`${pad}- ${scalarText(item)}`);
    } else if (Array.isArray(item)) {
      if (item.length === 0) {
        out.push(`${pad}- []`);
      } else {
        const nested = seqLines(item, indent + 2);
        out.push(`${pad}- ${nested[0].slice(indent + 2)}`, ...nested.slice(1));
      }
    } else if (isPlainObject(item)) {
      if (Object.keys(item).length === 0) {
        out.push(`${pad}- {}`);
      } else {
        const nested = mapLines(item, indent + 2);
        out.push(`${pad}- ${nested[0].slice(indent + 2)}`, ...nested.slice(1));
      }
    }
  }
  return out;
}

/**
 * JS 值 → YAML 文本（缩进 2，序列项在父键下缩进，会被误读的字符串加引号）。
 * @param {unknown} value
 * @returns {string}
 */
export function stringifyYaml(value) {
  if (isScalarValue(value)) return `${scalarText(value)}\n`;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]\n';
    return `${seqLines(value, 0).join('\n')}\n`;
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 0) return '{}\n';
    return `${mapLines(value, 0).join('\n')}\n`;
  }
  throw new ConvertError('无法转换为 YAML：值里含有不支持的数据类型');
}
