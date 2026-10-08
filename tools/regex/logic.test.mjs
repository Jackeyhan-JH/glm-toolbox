/** 正则测试单元测试（对应 issue #15「验收标准」中的每条输入 → 输出示例） */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLAG_ITEMS,
  MAX_RENDERED_HIGHLIGHTS,
  PRESETS,
  compileRegex,
  findMatches,
  formatMatchesText,
  normalizeFlags,
  parsePatternLiteral,
  replaceWith,
  run,
} from './logic.mjs';

const DATE_TEXT = '开始 2026-10-07，结束 2026-12-31。';
const DATE_RE = '(\\d{4})-(\\d{2})-(\\d{2})';

const groupValues = (m) => m.groups.map((g) => g.value);

/* ==================== 匹配 ==================== */

test('日期正则 + g：2 个匹配，位置与编号分组正确', () => {
  const r = findMatches(DATE_TEXT, DATE_RE, 'g');
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.matches.length, 2);

  const [m1, m2] = r.matches;
  assert.equal(m1.text, '2026-10-07');
  assert.equal(m1.index, 3);
  assert.equal(m1.end, 13);
  assert.deepEqual(groupValues(m1), ['2026', '10', '07']);
  assert.deepEqual(
    m1.groups.map((g) => g.label),
    ['1', '2', '3'],
  );

  assert.equal(m2.text, '2026-12-31');
  assert.equal(m2.index, 17);
  assert.equal(m2.end, 27);
});

test('不带 g 标志：只取第 1 个匹配', () => {
  const r = findMatches(DATE_TEXT, DATE_RE, '');
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].text, '2026-10-07');
});

test('命名分组：明细包含 year / month，值正确（命名分组同时占编号位）', () => {
  const r = findMatches('2026-10-07', '(?<year>\\d{4})-(?<month>\\d{2})', 'g');
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  const groups = r.matches[0].groups;
  assert.deepEqual(
    groups.map((g) => ({ label: g.label, value: g.value })),
    [
      { label: '1', value: '2026' },
      { label: '2', value: '10' },
      { label: 'year', value: '2026' },
      { label: 'month', value: '10' },
    ],
  );
});

test('可选分组 a(b)?c：第 1 个匹配的分组 1 未匹配（null）', () => {
  const r = findMatches('ac abc', 'a(b)?c', 'g');
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.matches[0].text, 'ac');
  assert.equal(r.matches[0].groups[0].value, null);
  assert.equal(r.matches[1].text, 'abc');
  assert.equal(r.matches[1].groups[0].value, 'b');
});

test('命名可选分组未参与匹配时值同样为 null', () => {
  const r = findMatches('ac', 'a(?<x>b)?c', 'g');
  assert.deepEqual(
    r.matches[0].groups.map((g) => ({ label: g.label, value: g.value })),
    [
      { label: '1', value: null },
      { label: 'x', value: null },
    ],
  );
});

test('空匹配不死循环：a* + g 在 baaac 上恰好 4 个匹配', () => {
  const r = findMatches('baaac', 'a*', 'g');
  assert.equal(r.ok, true);
  assert.equal(r.count, 4);
  assert.deepEqual(
    r.matches.map((m) => ({ text: m.text, index: m.index, end: m.end })),
    [
      { text: '', index: 0, end: 0 },
      { text: 'aaa', index: 1, end: 4 },
      { text: '', index: 4, end: 4 },
      { text: '', index: 5, end: 5 },
    ],
  );
});

test('空文本与不匹配的正则都得到 count 0', () => {
  assert.equal(findMatches('', 'a', 'g').count, 0);
  assert.equal(findMatches('bbb', 'a', 'g').count, 0);
  assert.equal(findMatches('bbb', 'a', 'g').countedAll, true);
});

test('明细上限：count 继续累计，matches 截断到 maxStored', () => {
  const r = findMatches('a'.repeat(50), 'a', 'g', { maxStored: 10 });
  assert.equal(r.count, 50);
  assert.equal(r.matches.length, 10);
});

test('统计上限：达到 maxCounted 即停止并标记 countedAll=false', () => {
  const r = findMatches('a'.repeat(50), 'a', 'g', { maxCounted: 5 });
  assert.equal(r.count, 5);
  assert.equal(r.countedAll, false);
});

test('y（粘性）标志：只匹配开头位置', () => {
  assert.equal(findMatches('aab', 'a', 'y').count, 2);
  assert.equal(findMatches('baa', 'a', 'y').count, 0);
});

/* ==================== 标志语义 ==================== */

test('标志 i：HELLO 匹配 hello', () => {
  const r = findMatches('hello', 'HELLO', 'i');
  assert.equal(r.count, 1);
  assert.equal(r.matches[0].text, 'hello');
});

test('标志 m：^b 匹配 a\\nb 中的 b；不带 m 则不匹配', () => {
  assert.equal(findMatches('a\nb', '^b', 'gm').count, 1);
  assert.equal(findMatches('a\nb', '^b', 'g').count, 0);
});

test('标志 s：a.b 匹配 a\\nb；不带 s 则不匹配', () => {
  assert.equal(findMatches('a\nb', 'a.b', 'gs').count, 1);
  assert.equal(findMatches('a\nb', 'a.b', 'g').count, 0);
});

test('normalizeFlags：数组 / 字符串 / 非法字符 / 重复项', () => {
  assert.equal(normalizeFlags(['g', 'i']), 'gi');
  assert.equal(normalizeFlags('gg'), 'g');
  assert.equal(normalizeFlags('gx!i'), 'gi');
  assert.equal(normalizeFlags(null), '');
});

/* ==================== 字面量解析 ==================== */

test('粘贴 /hello/gi → 拆出 hello 与标志 g、i', () => {
  assert.deepEqual(parsePatternLiteral('/hello/gi'), { source: 'hello', flags: ['g', 'i'] });
});

test('字面量解析：边界形式', () => {
  assert.deepEqual(parsePatternLiteral('/hello/'), { source: 'hello', flags: [] });
  assert.deepEqual(parsePatternLiteral('/a\\/b/g'), { source: 'a\\/b', flags: ['g'] }); // 转义斜杠不闭合
  assert.deepEqual(parsePatternLiteral('/[/]\\//'), { source: '[/]\\/', flags: [] }); // 字符类内的斜杠不闭合
  assert.equal(parsePatternLiteral('hello'), null); // 普通源文本
  assert.equal(parsePatternLiteral('/foo/bar'), null); // 斜杠后不是合法标志
  assert.equal(parsePatternLiteral('/a/gg'), null); // 重复标志不合法
  assert.equal(parsePatternLiteral('/api/\\d+'), null); // 以 / 开头的普通模式
  assert.equal(parsePatternLiteral(''), null);
  assert.equal(parsePatternLiteral('/'), null);
});

test('字面量拆出的源文本与标志可直接编译出等价正则', () => {
  const parsed = parsePatternLiteral('/(\\d{4})-(\\d{2})/g');
  const compiled = compileRegex(parsed.source, parsed.flags);
  assert.equal(compiled.ok, true);
  assert.equal(compiled.regex.test('2026-10'), true);
});

/* ==================== 编译错误 ==================== */

test('语法错误 ([a-z：中文提示并附原始信息', () => {
  const compiled = compileRegex('([a-z', '');
  assert.equal(compiled.ok, false);
  assert.ok(compiled.message.startsWith('正则语法错误'));
  assert.ok(compiled.message.length > '正则语法错误：'.length); // 附原始信息

  const r = findMatches('x', '([a-z', 'g');
  assert.equal(r.ok, false);
  assert.ok(r.message.includes('正则语法错误'));

  const replaced = replaceWith('x', '([a-z', 'g', '-');
  assert.equal(replaced.ok, false);
  assert.ok(replaced.message.includes('正则语法错误'));

  const whole = run({ source: '([a-z', flags: ['g'], text: 'x', replacement: '-' });
  assert.equal(whole.ok, false);
  assert.ok(whole.message.includes('正则语法错误'));
});

test('u 与 v 标志互斥：同时给出报语法错误', () => {
  assert.equal(compileRegex('a', 'uv').ok, false);
});

test('空正则源是合法的（匹配空串）', () => {
  const compiled = compileRegex('', 'g');
  assert.equal(compiled.ok, true);
});

/* ==================== 替换 ==================== */

test('替换 $3/$2/$1：日期改为 日/月/年', () => {
  const r = replaceWith(DATE_TEXT, DATE_RE, 'g', '$3/$2/$1');
  assert.equal(r.ok, true);
  assert.equal(r.result, '开始 07/10/2026，结束 31/12/2026。');
});

test('替换不带 g：只替换第 1 处', () => {
  const r = replaceWith('foo', 'o', '', '-');
  assert.equal(r.result, 'f-o');
});

test('命名分组替换 $<month>月 生效', () => {
  const r = replaceWith('2026-10-07', '(?<year>\\d{4})-(?<month>\\d{2})', 'g', '$<month>月');
  assert.equal(r.ok, true);
  assert.equal(r.result, '10月-07');
});

test('替换特殊符号：[$&$$] 在 foo 上 → f[o$][o$]', () => {
  const r = replaceWith('foo', 'o', 'g', '[$&$$]');
  assert.equal(r.ok, true);
  assert.equal(r.result, 'f[o$][o$]');
});

test('替换 $`（之前）与 $\'（之后）', () => {
  assert.equal(replaceWith('hello world', '(world)', 'g', "[$`|$']").result, 'hello [hello |]');
  assert.equal(replaceWith('abc', 'b', 'g', '<$&>').result, 'a<b>c');
  assert.equal(replaceWith('价格 $5', '\\$', 'g', '$$').result, '价格 $5');
});

test('空替换串：等价于删除全部匹配', () => {
  assert.equal(replaceWith('aab', 'a', 'g', '').result, 'b');
});

/* ==================== run（worker 单次往返） ==================== */

test('run：匹配与替换一次返回', () => {
  const r = run({ source: DATE_RE, flags: ['g'], text: DATE_TEXT, replacement: '$3/$2/$1' });
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.matches[0].text, '2026-10-07');
  assert.equal(r.replaceResult, '开始 07/10/2026，结束 31/12/2026。');
});

/* ==================== 速查与格式化 ==================== */

test('常用正则速查：六个条目都可编译且能命中样例', () => {
  const names = PRESETS.map((p) => p.name);
  for (const name of ['邮箱', '中国大陆手机号', 'IPv4 地址', '日期 YYYY-MM-DD', '中文字符', 'URL']) {
    assert.ok(names.includes(name), `缺少速查条目：${name}`);
  }
  const samples = [
    ['邮箱', '联系 jack@example.com', 'jack@example.com'],
    ['中国大陆手机号', '电话 13800138000', '13800138000'],
    ['IPv4 地址', '网关 192.168.1.1', '192.168.1.1'],
    ['日期 YYYY-MM-DD', '今天 2026-10-07', '2026-10-07'],
    ['中文字符', 'hello 世界', '世界'],
    ['URL', '见 https://example.com/a', 'https://example.com/a'],
  ];
  for (const [name, text, expected] of samples) {
    const preset = PRESETS.find((p) => p.name === name);
    const r = findMatches(text, preset.source, preset.flags);
    assert.equal(r.ok, true, `${name} 编译失败`);
    assert.equal(r.count, 1, `${name} 应命中 1 处`);
    assert.equal(r.matches[0].text, expected, `${name} 命中内容不符`);
  }
});

test('速查「邮箱」不会把普通词误判为邮箱', () => {
  const preset = PRESETS.find((p) => p.name === '邮箱');
  assert.equal(findMatches('abc def', preset.source, preset.flags).count, 0);
});

test('formatMatchesText：包含序号、内容、位置与分组；截断时给出汇总行', () => {
  const r = findMatches(DATE_TEXT, DATE_RE, 'g');
  const text = formatMatchesText(r);
  assert.ok(text.includes('#1 "2026-10-07" 位置 3-13'));
  assert.ok(text.includes('1="2026"'));

  const truncated = formatMatchesText(r, 1);
  assert.ok(truncated.includes('共 2 个匹配，仅列出前 1 条'));

  assert.equal(formatMatchesText({ matches: [], count: 0 }), '（无匹配）');
  assert.equal(formatMatchesText(null), '（暂无匹配结果）');
});

/* ==================== 常量约定 ==================== */

test('渲染上限常量符合验收约定（高亮 1 万）', () => {
  assert.equal(MAX_RENDERED_HIGHLIGHTS, 10000);
  assert.deepEqual(
    FLAG_ITEMS.map((f) => f.flag),
    ['g', 'i', 'm', 's', 'u', 'y', 'd', 'v'],
  );
});
