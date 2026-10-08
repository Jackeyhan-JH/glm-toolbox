/** 简繁转换单元测试（node --test，对应 issue #18 验收标准中的全部「输入 → 输出」例子） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { convert, buildTable, buildTables, DIRECTIONS } from './logic.mjs';

const dict = JSON.parse(
  readFileSync(new URL('./data/zh-dict.json', import.meta.url), 'utf8'),
);
const tables = buildTables(dict);

/** 简体 → 繁体（tw：台湾常用词开关） */
const s2t = (text, tw = false) => convert(text, 's2t', tables, { tw }).text;
/** 繁体 → 简体 */
const t2s = (text) => convert(text, 't2s', tables).text;

test('词表数据：总大小 ≤ 1.5MB，五张表齐全', () => {
  const size = statSync(fileURLToPath(new URL('./data/zh-dict.json', import.meta.url))).size;
  assert.ok(size <= 1.5 * 1024 * 1024, `zh-dict.json ${size} 字节超出 1.5MB`);
  for (const key of ['s2tChars', 's2tPhrases', 't2sChars', 't2sPhrases', 'twPhrases']) {
    assert.ok(dict[key] && Object.keys(dict[key]).length > 0, `缺少词表 ${key}`);
  }
  // 词表键都不含换行：换行天然阻断词组匹配（e2e 大文本按行拼接的前提）
  for (const key of [...Object.keys(dict.s2tPhrases), ...Object.keys(dict.twPhrases)]) {
    assert.ok(!key.includes('\n'), `词表键含换行：${JSON.stringify(key)}`);
  }
});

test('字表覆盖一级常用字中有繁体对应的代表字', () => {
  // 一简对多繁 / 常用转换字必须齐全（完整核验见 data/README.md，1240/1240 全覆盖；
  // 面、表、松 等字的 OpenCC 首选就是原字，恒等条目按生成规则略去）
  const mustHave = ['发', '头', '后', '干', '里', '台', '钟', '条', '净', '郁', '复', '历', '几', '斗', '云', '万', '与', '丰', '为', '门'];
  for (const ch of mustHave) assert.ok(dict.s2tChars[ch], `字表缺少 ${ch}`);
  const covered = Object.keys(dict.s2tChars).length;
  assert.ok(covered >= 3800, `字表条目 ${covered} 异常（约 3881）`);
});

test('简 → 繁：一简对多繁的词组（词表最长匹配优先）', () => {
  assert.equal(s2t('头发'), '頭髮'); // 发 → 髮（不是 發）
  assert.equal(s2t('发展'), '發展');
  assert.equal(s2t('面条'), '麵條'); // 面 → 麵（数据归一为 麵，非 麪）
  assert.equal(s2t('表面'), '表面'); // 表面不变
  assert.equal(s2t('以后'), '以後'); // 后 → 後
  assert.equal(s2t('皇后'), '皇后'); // 词表恒等条目防止 后→後
  assert.equal(s2t('干净'), '乾淨'); // 干 → 乾
  assert.equal(s2t('干部'), '幹部'); // 干 → 幹
  assert.equal(s2t('里面'), '裏面'); // 与数据一致固定为 裏（非 裡）
  assert.equal(s2t('台风'), '颱風'); // 台 → 颱
  assert.equal(s2t('钟表'), '鐘錶'); // 钟 → 鐘，表 → 錶
});

test('简 → 繁：长句', () => {
  // 后台 处理为 後臺，与数据一致并在本断言中固定
  assert.equal(
    s2t('我们的软件开发团队在后台处理头发问题'),
    '我們的軟件開發團隊在後臺處理頭髮問題',
  );
});

test('简 → 繁：台湾常用词开关', () => {
  assert.equal(s2t('软件', true), '軟體');
  assert.equal(s2t('内存', true), '記憶體');
  assert.equal(s2t('网络', true), '網路');
  assert.equal(s2t('软件', false), '軟件'); // 关闭时不做台湾词替换
});

test('繁 → 简', () => {
  assert.equal(t2s('頭髮發展'), '头发发展'); // 頭髮 → 头发，發展 → 发展
  assert.equal(t2s('乾淨'), '干净');
  assert.equal(t2s('後臺'), '后台');
  assert.equal(t2s('軟體'), '软体'); // 繁→简不做台湾词反向替换
});

test('非中文字符两个方向都原样保留', () => {
  assert.equal(s2t('Hello 世界 😀 123'), 'Hello 世界 😀 123'); // 世界 简繁同形
  assert.equal(t2s('Hello 世界 😀 123'), 'Hello 世界 😀 123');
});

test('往返：499 字简体新闻 简 → 繁 → 简 后与原文一致（差异 ≤ 1%）', () => {
  const news = readFileSync(
    new URL('./fixtures/news-simplified.txt', import.meta.url),
    'utf8',
  ).trim();
  const trad = s2t(news);
  const back = t2s(trad);

  // LCS 差异统计（新增 + 删除的字符数 / 较长一方的长度）
  const a = Array.from(news);
  const b = Array.from(back);
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lcs = dp[0][0];
  const diff = a.length - lcs + (b.length - lcs);
  const ratio = diff / Math.max(a.length, b.length);
  assert.ok(ratio <= 0.01, `往返差异 ${ratio.toFixed(4)}（${diff} 字）超过 1%`);
});

test('高亮片段：长度相同的转换逐字比较，只标记真正变化的字', () => {
  // 头发 → 頭髮：两个字都变化
  let result = convert('头发', 's2t', tables);
  assert.deepEqual(
    result.segments.map(({ text, changed }) => ({ text, changed })),
    [{ text: '頭', changed: true }, { text: '髮', changed: true }],
  );
  assert.equal(result.changedChars, 2);

  // 以后 → 以後：只有 後 变化，以 不高亮
  result = convert('以后', 's2t', tables);
  assert.deepEqual(
    result.segments.map(({ text, changed }) => ({ text, changed })),
    [{ text: '以', changed: false }, { text: '後', changed: true }],
  );
  assert.equal(result.changedChars, 1);

  // 皇后 → 皇后：恒等条目，无变化不高亮
  result = convert('皇后', 's2t', tables);
  assert.equal(result.text, '皇后');
  assert.equal(result.changedChars, 0);

  // 非中文与 emoji 不参与统计
  result = convert('Hello 世界 😀 123', 's2t', tables);
  assert.equal(result.changedChars, 0);

  // 台湾常用词：软件 → 軟體，两个字都算转换
  result = convert('软件', 's2t', tables, { tw: true });
  assert.deepEqual(
    result.segments.map(({ text, changed }) => ({ text, changed })),
    [{ text: '軟', changed: true }, { text: '體', changed: true }],
  );
});

test('边界：空串、词组在结尾、词组跨越边界不匹配、换行阻断', () => {
  assert.equal(convert('', 's2t', tables).text, '');
  assert.equal(convert('', 't2s', tables).changedChars, 0);

  // 词组恰好结束在文本末尾（吃 按 OpenCC 首选映射为 喫）
  assert.equal(s2t('干完活吃面条'), '幹完活喫麵條');
  // 剩余长度不足最长词时正确回退（钟表… 后面被截断）
  assert.equal(s2t('钟'), '鍾'); // 字表首选
  assert.equal(s2t('钟表'), '鐘錶');
  // 换行阻断词组匹配：头\n发 不会命中词表 头发
  assert.equal(s2t('头\n发'), '頭\n發');
  // 未收录字符原样保留
  assert.equal(s2t('𠮷ㄅá'), '𠮷ㄅá');
  assert.equal(t2s('𠮷ㄅá'), '𠮷ㄅá');
});

test('buildTable：小型注入词表验证最长匹配优先', () => {
  const table = buildTable({ 软件开发: '軟件開發', 软件: '軟體', 开发: '開發' }, { 件: '件', 好: '好' });
  const run = (text) => convert(text, 's2t', { s2t: table, t2s: table, tw: table });
  // 最长优先：软件开发 整词命中，而不是 软件 + 开发
  assert.equal(run('软件开发').text, '軟件開發');
  assert.equal(run('软件好').text, '軟體好');
  assert.equal(run('件好').text, '件好'); // 恒等字表条目视为无变化
  assert.equal(run('软件好').changedChars, 2); // 只有 软件变化
});

test('性能：10 万字转换在 1 秒内完成（不含词表加载）', () => {
  const news = readFileSync(
    new URL('./fixtures/news-simplified.txt', import.meta.url),
    'utf8',
  ).trim();
  const big = `${news}\n`.repeat(Math.ceil(100_000 / (Array.from(news).length + 1)));
  assert.ok(Array.from(big).length >= 100_000);

  for (const direction of ['s2t', 't2s']) {
    convert(big, direction, tables, { tw: direction === 's2t' }); // 预热
    const start = performance.now();
    const result = convert(big, direction, tables, { tw: direction === 's2t' });
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1000, `${direction} 10 万字耗时 ${elapsed.toFixed(0)}ms 超过 1 秒`);
    assert.ok(result.text.length > 0);
  }
});

test('DIRECTIONS：两个方向', () => {
  assert.deepEqual(
    DIRECTIONS.map((d) => d.value),
    ['s2t', 't2s'],
  );
});
