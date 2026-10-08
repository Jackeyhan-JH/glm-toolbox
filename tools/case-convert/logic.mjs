/**
 * 命名风格转换 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 结构：
 *   tokenizeLine / splitSegment   一行文本 → 单词序列（分词规则见下）
 *   wordCase 系列                 单词大小写变形（只改 ASCII 字母，非拉丁词原样保留）
 *   convertLine / convertAll      一行 / 多行文本 → 全部风格的结果
 *   toHalfwidth / toFullwidth     全角 ⇄ 半角（ASCII 可见字符与空格）
 *
 * 分词规则（验收标准）：
 *   - 以空白（含全角空格 U+3000）、_、-、.、/ 分隔，首尾和连续分隔符忽略；
 *   - 小写 / 数字 → 大写处断开（userName → user|Name，v2Api → v2|Api）；
 *   - 连续大写缩写在最后一个大写前断开（XMLHttpRequest → XML|Http|Request，
 *     getHTTPResponse → get|HTTP|Response）；
 *   - 数字归属前一个词，不单独拆开（user2 → user2）；数字开头的词保持（2fa → 2fa）；
 *   - 中文等非拉丁字符（含全角字母、标点）整体作为一个词，原样保留不改大小写。
 */

/* ---------------- 字符分类 ---------------- */

/** 分隔符：空白（\s 含全角空格 U+3000）、下划线、短横线、点、斜杠；连续的分隔符合并 */
const DELIMITER_RE = /[\s_./-]+/;

const isUpper = (ch) => ch >= 'A' && ch <= 'Z';
const isLower = (ch) => ch >= 'a' && ch <= 'z';
const isDigit = (ch) => ch >= '0' && ch <= '9';

/* ---------------- 分词 ---------------- */

/**
 * 一个不含分隔符的片段 → 单词数组。
 * 在相邻字符间判断是否断词（isBoundary），断点之间的片段即一个单词。
 */
function splitSegment(segment) {
  const words = [];
  let start = 0;
  for (let i = 1; i < segment.length; i++) {
    if (!isBoundary(segment, i)) continue;
    words.push(segment.slice(start, i));
    start = i;
  }
  if (start < segment.length) words.push(segment.slice(start));
  return words;
}

/**
 * segment[i - 1] 与 segment[i] 之间是否断词。ASCII 字母 / 数字之外的一切字符
 * （中文、全角字母等）视为「非拉丁」，与字母数字交界处必断，彼此之间不断。
 */
function isBoundary(s, i) {
  const prev = s[i - 1];
  const cur = s[i];
  const next = i + 1 < s.length ? s[i + 1] : null;
  const prevLatin = isUpper(prev) || isLower(prev) || isDigit(prev);
  const curLatin = isUpper(cur) || isLower(cur) || isDigit(cur);
  if (prevLatin !== curLatin) return true; // 非拉丁词与字母数字的交界
  if (isUpper(cur) && (isLower(prev) || isDigit(prev))) return true; // 小写 / 数字 → 大写
  // 连续大写的末位（后面跟小写）另起新词：XMLHttp → XML|Http
  if (isUpper(cur) && isUpper(prev) && next !== null && isLower(next)) return true;
  return false; // 其余不断：数字并入前词、大写 → 小写（缩写末位已提前断开）、同类相连
}

/** 一行文本 → 单词数组（空行 / 纯分隔符 → 空数组） */
export function tokenizeLine(line) {
  const words = [];
  for (const segment of line.split(DELIMITER_RE)) {
    if (segment !== '') words.push(...splitSegment(segment));
  }
  return words;
}

/* ---------------- 单词大小写变形（只改 ASCII 字母，全角字母等原样保留） ---------------- */

function asciiLower(word) {
  let out = '';
  for (const ch of word) out += isUpper(ch) ? String.fromCharCode(ch.charCodeAt(0) + 32) : ch;
  return out;
}

function asciiUpper(word) {
  let out = '';
  for (const ch of word) out += isLower(ch) ? String.fromCharCode(ch.charCodeAt(0) - 32) : ch;
  return out;
}

/** 首字母大写、其余小写；数字开头的词（如 2fa）整体小写；非拉丁词原样 */
function capitalize(word) {
  if (word === '' || !isUpper(word[0]) && !isLower(word[0])) {
    return isDigit(word[0]) ? asciiLower(word) : word;
  }
  return asciiUpper(word[0]) + asciiLower(word.slice(1));
}

/* ---------------- 风格清单 ---------------- */

/**
 * 12 种命名 / 大小写风格。first / rest 是首词与其余词的变形函数，sep 为连接符。
 * UI 按此顺序展示，id 即 data-testid 后缀。
 */
export const CASE_STYLES = [
  { id: 'camel', label: 'camelCase', first: asciiLower, rest: capitalize, sep: '' },
  { id: 'pascal', label: 'PascalCase', first: capitalize, rest: capitalize, sep: '' },
  { id: 'snake', label: 'snake_case', first: asciiLower, rest: asciiLower, sep: '_' },
  { id: 'screaming', label: 'SCREAMING_SNAKE_CASE', first: asciiUpper, rest: asciiUpper, sep: '_' },
  { id: 'kebab', label: 'kebab-case', first: asciiLower, rest: asciiLower, sep: '-' },
  { id: 'train', label: 'Train-Case', first: capitalize, rest: capitalize, sep: '-' },
  { id: 'dot', label: 'dot.case', first: asciiLower, rest: asciiLower, sep: '.' },
  { id: 'path', label: 'path/case', first: asciiLower, rest: asciiLower, sep: '/' },
  { id: 'title', label: 'Title Case', first: capitalize, rest: capitalize, sep: ' ' },
  { id: 'sentence', label: 'Sentence case', first: capitalize, rest: asciiLower, sep: ' ' },
  { id: 'lower', label: 'lowercase', first: asciiLower, rest: asciiLower, sep: ' ' },
  { id: 'upper', label: 'UPPERCASE', first: asciiUpper, rest: asciiUpper, sep: ' ' },
];

/* ---------------- 全角 / 半角 ---------------- */

/**
 * 中文逗号「，」(U+FF0C) 虽落在全角区 ！–～ (U+FF01–U+FF5E) 内，
 * 但按本工具验收样例它属于中文标点、不参与互转（半角逗号「,」同样保留），
 * 其余 ASCII 可见字符 !–~ 与 ！–～ 一一对应，空格与全角空格 U+3000 互转。
 */
const FULLWIDTH_COMMA = 0xff0c;
const HALFWIDTH_COMMA = 0x2c;

/** 全角 → 半角：ＡＢＣ１２３，！　ｘ → ABC123，! x */
export function toHalfwidth(text) {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0x3000) out += ' ';
    else if (cp >= 0xff01 && cp <= 0xff5e && cp !== FULLWIDTH_COMMA) {
      out += String.fromCharCode(cp - 0xfee0);
    } else {
      out += ch;
    }
  }
  return out;
}

/** 半角 → 全角：Hi 1! → Ｈｉ　１！ */
export function toFullwidth(text) {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0x20) out += '　';
    else if (cp >= 0x21 && cp <= 0x7e && cp !== HALFWIDTH_COMMA) {
      out += String.fromCharCode(cp + 0xfee0);
    } else {
      out += ch;
    }
  }
  return out;
}

/** 全角 / 半角两个额外结果（对原始整行做转换，不走分词） */
export const WIDTH_STYLES = [
  { id: 'half', label: '全角 → 半角', convert: toHalfwidth },
  { id: 'full', label: '半角 → 全角', convert: toFullwidth },
];

/** UI 用：全部结果项（12 种风格 + 全半角），顺序即展示顺序 */
export const ALL_STYLES = [...CASE_STYLES, ...WIDTH_STYLES];

/* ---------------- 转换 ---------------- */

/** 一行文本 → { 风格id: 结果 }，包含全部风格与全半角 */
export function convertLine(line) {
  const words = tokenizeLine(line);
  const result = {};
  for (const { id, first, rest, sep } of CASE_STYLES) {
    result[id] = words.map((word, i) => (i === 0 ? first(word) : rest(word))).join(sep);
  }
  for (const { id, convert } of WIDTH_STYLES) result[id] = convert(line);
  return result;
}

/**
 * 多行文本 → { 风格id: 多行结果 }。每行独立转换，空行保留；
 * 空输入返回各项均为空字符串，不抛错。
 */
export function convertAll(text) {
  const lineResults = String(text).split('\n').map(convertLine); // 每行只分词一次
  const result = {};
  for (const { id } of ALL_STYLES) {
    result[id] = lineResults.map((line) => line[id]).join('\n');
  }
  return result;
}

/** 分词预览：每行单词用 | 连接（如 XMLHttpRequest → XML|Http|Request），行间换行 */
export function tokenPreview(text) {
  return String(text)
    .split('\n')
    .map((line) => tokenizeLine(line).join('|'))
    .join('\n');
}
