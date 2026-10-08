/** 字数统计纯逻辑的单元测试（node --test 自动发现） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, countBytes, countHanzi, countLines, countParagraphs, countWords, formatStats } from './logic.mjs';

test('综合示例：Hello 世界！\\n\\n第二段 abc', () => {
  assert.deepEqual(analyze('Hello 世界！\n\n第二段 abc'), {
    charsWithSpace: 16,
    charsNoSpace: 14,
    hanzi: 5,
    words: 2,
    lines: 3,
    paragraphs: 2,
    bytes: 30,
  });
});

test('字形簇：家庭 emoji 是 1 个字符 18 字节', () => {
  assert.equal(analyze('👨‍👩‍👧').charsWithSpace, 1);
  assert.equal(analyze('👨‍👩‍👧').charsNoSpace, 1);
  assert.equal(countBytes('👨‍👩‍👧'), 18);
});

test('字形簇：😀 是 1 个字符 4 字节', () => {
  assert.equal(analyze('😀').charsWithSpace, 1);
  assert.equal(countBytes('😀'), 4);
});

test('字符数（含空格）不计换行符，含空格与制表符', () => {
  assert.equal(analyze('a b\tc\nd').charsWithSpace, 6);
  assert.equal(analyze('a b\tc\nd').charsNoSpace, 4);
  // \r\n 作为一个字形簇，同样不计
  assert.equal(analyze('a\r\nb').charsWithSpace, 2);
});

test('英文单词：允许 don\'t / stop-me 这类连写', () => {
  assert.equal(countWords("don't stop-me now"), 3);
  assert.equal(countWords("don’t stop-me now"), 3);
  assert.equal(countWords('Hello World'), 2);
  assert.equal(countWords(''), 0);
});

test('汉字数：\\p{Script=Han}，标点不算', () => {
  assert.equal(countHanzi('世界，你好！'), 4);
  assert.equal(countHanzi('abc'), 0);
});

test('行数：空文本为 0，否则按 \\n 分割', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('one'), 1);
  assert.equal(countLines('one\ntwo'), 2);
  assert.equal(countLines('one\n'), 2);
});

test('段落数：空行分隔的非空块', () => {
  assert.equal(countParagraphs(''), 0);
  assert.equal(countParagraphs('第一段'), 1);
  assert.equal(countParagraphs('第一段\n\n第二段'), 2);
  assert.equal(countParagraphs('第一段\n \n\n第二段'), 2);
  assert.equal(countParagraphs('\n\n\n'), 0);
});

test('空输入所有数字为 0', () => {
  assert.deepEqual(analyze(''), {
    charsWithSpace: 0,
    charsNoSpace: 0,
    hanzi: 0,
    words: 0,
    lines: 0,
    paragraphs: 0,
    bytes: 0,
  });
});

test('formatStats 输出包含「汉字数：5」格式的每一项', () => {
  const text = formatStats(analyze('Hello 世界！\n\n第二段 abc'));
  assert.ok(text.includes('汉字数：5'), text);
  assert.ok(text.includes('字符数（含空格）：16'), text);
  assert.equal(text.split('\n').length, 7);
});

test('性能：20 万汉字在 1 秒内完成统计', () => {
  const text = '码'.repeat(200000);
  const start = performance.now();
  const stats = analyze(text);
  const elapsed = performance.now() - start;
  assert.equal(stats.hanzi, 200000);
  assert.equal(stats.bytes, 600000);
  assert.ok(elapsed < 1000, `耗时 ${elapsed}ms，应小于 1000ms`);
});
