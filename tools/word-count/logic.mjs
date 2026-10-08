/**
 * 字数统计 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 计数规则（见 issue #2）：
 *   - 字符按字形簇计（Intl.Segmenter, granularity: 'grapheme'）；
 *     「字符数（含空格）」不计换行符 \n / \r；「字符数（不含空白）」再排除空格、制表符等空白；
 *   - 汉字：\p{Script=Han}；
 *   - 英文单词：字母序列，允许撇号（' ’）与连字符(-)连写（如 don't、stop-me），正则见 countWords；
 *   - 行数：空文本为 0，否则按 \n 分割的行数；
 *   - 段落数：以空行分隔的非空块数；
 *   - 字节数：整段文本 UTF-8 编码字节数（含换行）。
 */

let segmenter = null;

function getSegmenter() {
  if (!segmenter) {
    segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  }
  return segmenter;
}

/** 换行簇：\n、\r 或 \r\n（\r\n 是一个字形簇） */
function isBreakCluster(segment) {
  return /^[\r\n]+$/.test(segment);
}

/** 空白簇（空格、制表符、不间断空格等，不含换行——换行单独判断） */
function isWhitespaceCluster(segment) {
  return /\s/.test(segment);
}

/** 汉字数 */
export function countHanzi(text) {
  const matches = text.match(/\p{Script=Han}/gu);
  return matches ? matches.length : 0;
}

/** 英文单词数 */
export function countWords(text) {
  const matches = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g);
  return matches ? matches.length : 0;
}

/** 行数：空文本为 0，否则按 \n 分割的行数 */
export function countLines(text) {
  if (text === '') return 0;
  return text.split('\n').length;
}

/** 段落数：以空行分隔的非空块数 */
export function countParagraphs(text) {
  let count = 0;
  let inParagraph = false;
  for (const line of text.split('\n')) {
    const blank = line.trim() === '';
    if (!blank && !inParagraph) count += 1;
    inParagraph = !blank;
  }
  return count;
}

/** UTF-8 字节数（含换行） */
export function countBytes(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * 完整统计。一次遍历字形簇得到两项字符数，其余用正则。
 * @param {string} text
 * @param {{ segmenter?: Intl.Segmenter }} [injectable] 便于测试注入
 */
export function analyze(text, { segmenter: injectedSegmenter } = {}) {
  const seg = injectedSegmenter ?? getSegmenter();
  let charsWithSpace = 0;
  let charsNoSpace = 0;

  for (const { segment } of seg.segment(text)) {
    if (isBreakCluster(segment)) continue;
    charsWithSpace += 1;
    if (!isWhitespaceCluster(segment)) charsNoSpace += 1;
  }

  return {
    charsWithSpace,
    charsNoSpace,
    hanzi: countHanzi(text),
    words: countWords(text),
    lines: countLines(text),
    paragraphs: countParagraphs(text),
    bytes: countBytes(text),
  };
}

/** 统计项（key 与展示名），工具页与「复制统计结果」共用，保证展示与复制一致 */
export const STAT_ITEMS = [
  { key: 'charsWithSpace', label: '字符数（含空格）' },
  { key: 'charsNoSpace', label: '字符数（不含空白）' },
  { key: 'hanzi', label: '汉字数' },
  { key: 'words', label: '英文单词数' },
  { key: 'lines', label: '行数' },
  { key: 'paragraphs', label: '段落数' },
  { key: 'bytes', label: 'UTF-8 字节数' },
];

/** 把统计结果格式化为可复制的多行文本 */
export function formatStats(stats) {
  return STAT_ITEMS.map(({ key, label }) => `${label}：${stats[key]}`).join('\n');
}
