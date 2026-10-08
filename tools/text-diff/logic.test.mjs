/** 文本对比单元测试（对应 issue #16 验收标准中的每条「输入 → 输出」例子） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OPTIONS,
  buildSideRows,
  buildTokens,
  compare,
  computeHunks,
  diffSeq,
  formatStats,
  inlineDiff,
  splitLines,
  tokenizeWords,
  toUnifiedDiff,
} from './logic.mjs';

const lineOps = (oldText, newText, options) => compare(oldText, newText, 'line', options).ops;

test('splitLines：结尾换行不产生空行，空文本为 0 行', () => {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('a\nb\nc'), ['a', 'b', 'c']);
  assert.deepEqual(splitLines('a\nb\nc\n'), ['a', 'b', 'c']);
  assert.deepEqual(splitLines('\n'), ['']);
});

test('tokenizeWords：汉字逐字、英文连写、空白归并', () => {
  assert.deepEqual(tokenizeWords('the quick brown fox'), [
    'the', ' ', 'quick', ' ', 'brown', ' ', 'fox',
  ]);
  assert.deepEqual(tokenizeWords('码工具'), ['码', '工', '具']);
  assert.deepEqual(tokenizeWords('a=1,b=2'), ['a', '=', '1', ',', 'b', '=', '2']);
});

test('diffSeq：公共前后缀剥离、纯增、纯删、双空', () => {
  const t = (arr) => arr.map((text) => ({ text, key: text }));

  assert.deepEqual(
    diffSeq(t(['a', 'b']), t(['a', 'b'])).map((o) => o.type),
    ['equal', 'equal'],
  );
  assert.deepEqual(
    diffSeq(t([]), t(['a', 'b'])).map((o) => [o.type, o.text]),
    [['add', 'a'], ['add', 'b']],
  );
  assert.deepEqual(
    diffSeq(t(['a', 'b']), t([])).map((o) => [o.type, o.text]),
    [['del', 'a'], ['del', 'b']],
  );
  assert.deepEqual(diffSeq(t([]), t([])), []);
  // 前后相同、中间不同：dels 排在 adds 前面
  assert.deepEqual(
    diffSeq(t(['x', 'b', 'y']), t(['x', 'B', 'y'])).map((o) => o.type),
    ['equal', 'del', 'add', 'equal'],
  );
});

test('按行：a/b/c → a/B/c/d，删除 b、新增 B 与 d，统计与 unified diff 逐字一致', () => {
  const result = compare('a\nb\nc', 'a\nB\nc\nd');
  assert.deepEqual(
    result.ops.map((o) => [o.type, o.text]),
    [
      ['equal', 'a'],
      ['del', 'b'],
      ['add', 'B'],
      ['equal', 'c'],
      ['add', 'd'],
    ],
  );
  assert.deepEqual(result.stats, { added: 2, deleted: 1 });
  assert.equal(formatStats(result.stats, 'line'), '新增 2 行，删除 1 行');
  assert.equal(
    toUnifiedDiff(result.ops),
    ['--- 原文', '+++ 新文', '@@ -1,3 +1,4 @@', ' a', '-b', '+B', ' c', '+d'].join('\n'),
  );
  assert.equal(result.identical, false);
});

test('按行 + 忽略大小写：只剩新增 d', () => {
  const result = compare('a\nb\nc', 'a\nB\nc\nd', 'line', { ignoreCase: true });
  assert.deepEqual(result.stats, { added: 1, deleted: 0 });
  assert.equal(formatStats(result.stats, 'line'), '新增 1 行，删除 0 行');
  assert.deepEqual(
    result.ops.map((o) => [o.type, o.text]),
    [['equal', 'a'], ['equal', 'b'], ['equal', 'c'], ['add', 'd']],
  );
  // 展示仍是原文内容 b / B（只有比较键忽略大小写）
  assert.equal(result.ops[1].text, 'b');
});

test('忽略所有空白差异：a␣␣b 与 a␣b 相同', () => {
  const result = compare('a  b', 'a b', 'line', { ignoreAllWhitespace: true });
  assert.equal(result.identical, true);
  // 不开选项时是不同的
  assert.equal(compare('a  b', 'a b').identical, false);
});

test('忽略首尾空白：x 与 x␣␣（行尾空格）相同', () => {
  const result = compare('x', 'x  ', 'line', { trimWhitespace: true });
  assert.equal(result.identical, true);
  assert.equal(compare('x', 'x  ').identical, false);
  // 行首空白同理；多行各自行首尾空白
  assert.equal(compare('  a\n b ', 'a\nb', 'line', { trimWhitespace: true }).identical, true);
});

test('忽略空行：a/空/b 与 a/b 相同', () => {
  const result = compare('a\n\nb', 'a\nb', 'line', { ignoreBlankLines: true });
  assert.equal(result.identical, true);
  assert.equal(compare('a\n\nb', 'a\nb').identical, false);
  // 空行差异在默认选项下被计为一行删除
  assert.deepEqual(compare('a\n\nb', 'a\nb').stats, { added: 0, deleted: 1 });
});

test('按字符：码工具箱 vs 码具箱子 → 删除「工」、新增「子」', () => {
  const result = compare('码工具箱', '码具箱子', 'char');
  assert.deepEqual(
    result.ops.map((o) => [o.type, o.text]),
    [
      ['equal', '码'],
      ['del', '工'],
      ['equal', '具'],
      ['equal', '箱'],
      ['add', '子'],
    ],
  );
  assert.deepEqual(result.stats, { added: 1, deleted: 1 });
  assert.equal(formatStats(result.stats, 'char'), '新增 1 个，删除 1 个');
});

test('按词：the quick brown fox vs the slow brown dog', () => {
  const result = compare('the quick brown fox', 'the slow brown dog', 'word');
  assert.deepEqual(
    result.ops.map((o) => [o.type, o.text]),
    [
      ['equal', 'the'],
      ['equal', ' '],
      ['del', 'quick'],
      ['add', 'slow'],
      ['equal', ' '],
      ['equal', 'brown'],
      ['equal', ' '],
      ['del', 'fox'],
      ['add', 'dog'],
    ],
  );
  assert.deepEqual(result.stats, { added: 2, deleted: 2 });
  assert.equal(formatStats(result.stats, 'word'), '新增 2 个，删除 2 个');
});

test('完全相同（含两边都为空）→「两段文本完全相同」，unified diff 为空', () => {
  for (const [a, b] of [['a\nb\nc', 'a\nb\nc'], ['', ''], ['同一段文案', '同一段文案']]) {
    const result = compare(a, b);
    assert.equal(result.identical, true, JSON.stringify([a, b]));
    assert.deepEqual(result.stats, { added: 0, deleted: 0 });
    assert.equal(toUnifiedDiff(result.ops), '');
  }
  // 结尾换行不产生差异
  assert.equal(compare('a\nb\nc', 'a\nb\nc\n').identical, true);
});

test('原文为空、新文 a/b → 全部新增，hunk 头 @@ -0,0 +1,2 @@', () => {
  const result = compare('', 'a\nb');
  assert.deepEqual(
    result.ops.map((o) => [o.type, o.text]),
    [['add', 'a'], ['add', 'b']],
  );
  assert.equal(
    toUnifiedDiff(result.ops),
    ['--- 原文', '+++ 新文', '@@ -0,0 +1,2 @@', '+a', '+b'].join('\n'),
  );
});

test('新文为空 → 全部删除，hunk 头 @@ -1,2 +0,0 @@', () => {
  const result = compare('a\nb', '');
  assert.deepEqual(result.stats, { added: 0, deleted: 2 });
  assert.equal(
    toUnifiedDiff(result.ops),
    ['--- 原文', '+++ 新文', '@@ -1,2 +0,0 @@', '-a', '-b'].join('\n'),
  );
});

/** 生成 n 行文本；changes 是 { line, text } 的列表（line 为 1 基行号） */
function makeLines(n, changes = []) {
  const map = new Map(changes.map((c) => [c.line, c.text]));
  return Array.from({ length: n }, (_, i) => map.get(i + 1) ?? `第${i + 1}行`);
}

test('上下文：相距 10 行以上的两处修改生成 2 个 hunk', () => {
  const oldText = makeLines(20).join('\n');
  // 修改第 2 行与第 15 行：两处变化之间隔 12 行未变
  const newText = makeLines(20, [
    { line: 2, text: '第二行改' },
    { line: 15, text: '第十五行改' },
  ]).join('\n');
  const { ops } = compare(oldText, newText);
  const unified = toUnifiedDiff(ops);
  assert.equal((unified.match(/@@/g) || []).length, 4); // 每个 hunk 头 2 个 @，2 个 hunk
  assert.equal(computeHunks(ops).length, 2);
});

test('上下文：相距 6 行的两处修改合并为 1 个 hunk；相距 7 行分开', () => {
  const oldText = makeLines(20).join('\n');
  const mk = (line2, line3) => makeLines(20, [
    { line: 2, text: '第二行改' },
    { line: line3, text: '第三处改' },
  ]).join('\n');
  // 第 2 行与第 9 行：中间 6 行未变（3..8）→ 合并
  assert.equal(computeHunks(compare(oldText, mk(2, 9)).ops).length, 1);
  // 第 2 行与第 10 行：中间 7 行未变（3..9）→ 分开
  assert.equal(computeHunks(compare(oldText, mk(2, 10)).ops).length, 2);
});

test('hunk 头遵循 GNU 惯例：个数为 1 时省略「,1」', () => {
  const { ops } = compare('x', '');
  assert.equal(
    toUnifiedDiff(ops),
    ['--- 原文', '+++ 新文', '@@ -1 +0,0 @@', '-x'].join('\n'),
  );
});

test('buildSideRows：修改行配对并附字符级分段，多余删除 / 新增单独成行', () => {
  const rows = buildSideRows(lineOps('a\nb\nc\nd', 'a\nB\nc\nd\ne'));
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['equal', 'mod', 'equal', 'equal', 'add'],
  );
  const mod = rows[1];
  assert.equal(mod.old.text, 'b');
  assert.equal(mod.new.text, 'B');
  assert.deepEqual(mod.oldSegments, [{ type: 'del', text: 'b' }]);
  assert.deepEqual(mod.newSegments, [{ type: 'add', text: 'B' }]);

  // 删除 2 行新增 1 行：第一对配成 mod，第二个删除单独展示
  const rows2 = buildSideRows(lineOps('x\ny\nz', 'x\nY2\nz'));
  assert.deepEqual(
    rows2.map((r) => r.kind),
    ['equal', 'mod', 'equal'],
  );
  const rows3 = buildSideRows(lineOps('a\nb\nc', 'a\nc'));
  assert.deepEqual(
    rows3.map((r) => r.kind),
    ['equal', 'del', 'equal'],
  );
});

test('inlineDiff：行内字符分段（等 / 删 / 增）', () => {
  const { oldSegments, newSegments } = inlineDiff('端口=80', '端口=8080');
  assert.deepEqual(oldSegments, [{ type: 'equal', text: '端口=80' }]);
  assert.deepEqual(newSegments, [
    { type: 'equal', text: '端口=80' },
    { type: 'add', text: '80' },
  ]);

  const both = inlineDiff('abc', 'adc');
  assert.deepEqual(both.oldSegments, [
    { type: 'equal', text: 'a' },
    { type: 'del', text: 'b' },
    { type: 'equal', text: 'c' },
  ]);
  assert.deepEqual(both.newSegments, [
    { type: 'equal', text: 'a' },
    { type: 'add', text: 'd' },
    { type: 'equal', text: 'c' },
  ]);
  // 忽略大小写时 X 与 x 行内不再有差异标记
  const segs = inlineDiff('X=100', 'x=100', { ignoreCase: true });
  assert.deepEqual(segs.oldSegments, [{ type: 'equal', text: 'X=100' }]);
  assert.deepEqual(segs.newSegments, [{ type: 'equal', text: 'x=100' }]);
});

test('按词 / 按字符模式的忽略选项', () => {
  // 词模式：忽略所有空白差异 → 空白 token 不参与比较
  assert.equal(
    compare('a b', 'a  b', 'word', { ignoreAllWhitespace: true }).identical,
    true,
  );
  // 字符模式：忽略大小写
  assert.equal(compare('Abc', 'aBC', 'char', { ignoreCase: true }).identical, true);
  // 词 / 字符模式：忽略首尾空白去掉整段两端空白
  assert.equal(compare(' x ', 'x', 'char', { trimWhitespace: true }).identical, true);
});

test('CRLF：\\r\\n 与 \\n 的行在比较时视为相同', () => {
  assert.equal(compare('a\r\nb\r\n', 'a\nb\n').identical, true);
});

test('大输入性能：两段各 5000 行、约 5% 不同，2 秒内完成', () => {
  const oldLines = makeLines(5000);
  const newLines = oldLines.map((line, i) => (i % 20 === 0 ? `${line}（改）` : line));
  const start = Date.now();
  const result = compare(oldLines.join('\n'), newLines.join('\n'));
  const elapsed = Date.now() - start;
  assert.deepEqual(result.stats, { added: 250, deleted: 250 });
  assert.ok(elapsed < 2000, `耗时 ${elapsed}ms，应小于 2000ms`);
});

test('两段几乎完全不同（编辑距离超过上限）也能出结果：退化为整段替换', () => {
  const n = 3000;
  const oldText = Array.from({ length: n }, (_, i) => `旧-${i}`).join('\n');
  const newText = Array.from({ length: n }, (_, i) => `新-${i}`).join('\n');
  const result = compare(oldText, newText);
  assert.deepEqual(result.stats, { added: n, deleted: n });
  // 仍然是合法的 unified diff（一个 hunk）
  assert.equal(computeHunks(result.ops).length, 1);
});

test('大量相同内容 + 局部修改：前后缀剥离后正确（万行相同文本无差异）', () => {
  const same = makeLines(10000).join('\n');
  assert.equal(compare(same, same).identical, true);
});

test('DEFAULT_OPTIONS 全部默认关闭', () => {
  assert.deepEqual(DEFAULT_OPTIONS, {
    trimWhitespace: false,
    ignoreAllWhitespace: false,
    ignoreCase: false,
    ignoreBlankLines: false,
  });
  // buildTokens 默认不丢空白
  const tokens = buildTokens('a b', 'word');
  assert.deepEqual(tokens.map((t) => t.text), ['a', ' ', 'b']);
});
