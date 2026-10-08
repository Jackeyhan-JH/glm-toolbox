/** URL 编解码纯逻辑的单元测试（node --test 自动发现），逐条覆盖 issue #8 的「输入 → 输出」示例 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuery,
  decodeBestEffort,
  decodeText,
  encodeText,
  parseInput,
  parseQuery,
  rebuildUrl,
} from './logic.mjs';

const SAMPLE_URL = 'https://user:pw@example.com:8080/a/b%20c?q=%E7%A0%81&tag=1&tag=2&empty=#sec';

/* ==================== 编码 ==================== */

test('组件编码：码 a&b=c/d → %E7%A0%81%20a%26b%3Dc%2Fd', () => {
  assert.equal(encodeText('码 a&b=c/d'), '%E7%A0%81%20a%26b%3Dc%2Fd');
});

test('组件编码勾选「空格编码为 +」→ %E7%A0%81+a%26b%3Dc%2Fd', () => {
  assert.equal(encodeText('码 a&b=c/d', { plusForSpace: true }), '%E7%A0%81+a%26b%3Dc%2Fd');
});

test('完整 URL 编码：https://example.com/码 a?x=1&y=中 → 保留 URL 结构字符', () => {
  assert.equal(
    encodeText('https://example.com/码 a?x=1&y=中', { mode: 'uri' }),
    'https://example.com/%E7%A0%81%20a?x=1&y=%E4%B8%AD',
  );
});

test('完整 URL 编码 + 空格编码为 +：只替换 %20', () => {
  assert.equal(
    encodeText('https://example.com/码 a?x=1', { mode: 'uri', plusForSpace: true }),
    'https://example.com/%E7%A0%81+a?x=1',
  );
});

test('空文本编码为空字符串', () => {
  assert.equal(encodeText(''), '');
  assert.equal(encodeText('', { mode: 'uri', plusForSpace: true }), '');
});

/* ==================== 解码 ==================== */

test('解码：%E7%A0%81%E5%B7%A5 → 码工', () => {
  const result = decodeText('%E7%A0%81%E5%B7%A5');
  assert.equal(result.ok, true);
  assert.equal(result.value, '码工');
});

test('解码 a+b：+ 当空格开 → a b，关 → a+b', () => {
  assert.equal(decodeText('a+b', { plusAsSpace: true }).value, 'a b');
  assert.equal(decodeText('a+b').value, 'a+b');
});

test('解码结果与 decodeURIComponent 一致（普通字符与转义混排）', () => {
  for (const sample of ['%E4%B8%AD%E6%96%87', 'a%20b', '%2Fpath%3Fq%3D1', 'héllo%20wörld', '中%20文']) {
    const result = decodeText(sample);
    assert.equal(result.ok, true, sample);
    assert.equal(result.value, decodeURIComponent(sample), sample);
  }
});

test('解码 %E4%B8 → 报「不完整的百分号编码 / 非法 UTF-8 序列」，第 1 个字符起', () => {
  const result = decodeText('%E4%B8');
  assert.equal(result.ok, false);
  assert.equal(result.message, '不完整的百分号编码 / 非法 UTF-8 序列（第 1 个字符起）');
  assert.equal(result.position, 1);
});

test('解码 100% → 报「% 后缺少两位十六进制」，位置 4', () => {
  const result = decodeText('100%');
  assert.equal(result.ok, false);
  assert.equal(result.message, '% 后缺少两位十六进制数字（第 4 个字符起）');
  assert.equal(result.position, 4);
});

test('解码其他非法输入：%GG、截断的 %E、孤立 %FF、代理区编码都报中文错误', () => {
  const cases = [
    ['%GG', 1],
    ['abc%E', 4],
    ['%FF', 1],
    ['%ED%A0%80', 1],
    ['%C0%AF', 1],
  ];
  for (const [input, position] of cases) {
    const result = decodeText(input);
    assert.equal(result.ok, false, input);
    assert.ok(result.message.includes('（第 '), `${input}：${result.message}`);
    assert.equal(result.position, position, input);
  }
});

test('解码错误位置按码点计：emoji 后的非法转义指向正确字符', () => {
  // 😀 是 1 个码点（2 个 UTF-16 单元），其后第 6 个字符处的 %
  const result = decodeText('😀1234%');
  assert.equal(result.ok, false);
  assert.equal(result.position, 6);
  assert.equal(result.message, '% 后缺少两位十六进制数字（第 6 个字符起）');
});

test('尽力解码 decodeBestEffort：合法部分解码，非法转义原样保留', () => {
  assert.equal(decodeBestEffort('/a/b%20c'), '/a/b c');
  assert.equal(decodeBestEffort('/a%20b%GG'), '/a b%GG');
  assert.equal(decodeBestEffort(''), '');
});

/* ==================== URL 解析 ==================== */

test('解析完整 URL：协议 / 用户信息 / 主机 / 端口 / 路径 / 参数 / hash 全部拆出', () => {
  const result = parseInput(SAMPLE_URL);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'url');
  const { parts, params } = result;
  assert.equal(parts.protocol, 'https:');
  assert.equal(parts.username, 'user');
  assert.equal(parts.password, 'pw');
  assert.equal(parts.hostname, 'example.com');
  assert.equal(parts.port, '8080');
  assert.equal(parts.pathname, '/a/b%20c'); // 原样
  assert.equal(parts.pathnameDecoded, '/a/b c'); // 解码后
  assert.equal(parts.search, '?q=%E7%A0%81&tag=1&tag=2&empty=');
  assert.equal(parts.hash, '#sec');
  assert.deepEqual(params, [
    { key: 'q', value: '码' },
    { key: 'tag', value: '1' },
    { key: 'tag', value: '2' },
    { key: 'empty', value: '' },
  ]);
});

test('解析 example.com/abc → 提示「不是完整 URL（缺少协议，如 https://）」', () => {
  const result = parseInput('example.com/abc');
  assert.equal(result.ok, false);
  assert.equal(result.message, '不是完整 URL（缺少协议，如 https://）');
});

test('解析 ?a=1&b=%20x → 参数 a=1、b=空格x', () => {
  const result = parseInput('?a=1&b=%20x');
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'query');
  assert.deepEqual(result.params, [
    { key: 'a', value: '1' },
    { key: 'b', value: ' x' },
  ]);
});

test('解析纯查询字符串 a=1&b=2（无 ? 前缀）', () => {
  const result = parseInput('a=1&b=2');
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'query');
  assert.deepEqual(result.params, [
    { key: 'a', value: '1' },
    { key: 'b', value: '2' },
  ]);
});

test('parseQuery：重复键、空值、无 = 的段、+ 按空格', () => {
  assert.deepEqual(parseQuery('tag=1&tag=2&empty='), [
    { key: 'tag', value: '1' },
    { key: 'tag', value: '2' },
    { key: 'empty', value: '' },
  ]);
  assert.deepEqual(parseQuery('flag'), [{ key: 'flag', value: '' }]);
  assert.deepEqual(parseQuery('a=b+c'), [{ key: 'a', value: 'b c' }]);
  assert.deepEqual(parseQuery('a=b=c'), [{ key: 'a', value: 'b=c' }]);
  assert.deepEqual(parseQuery('??a=1'), [{ key: 'a', value: '1' }]);
  assert.deepEqual(parseQuery(''), []);
});

test('解析空输入给出中文提示；无法解析的带协议串也给出中文提示', () => {
  assert.equal(parseInput('  ').ok, false);
  assert.ok(parseInput('').message.includes('请输入'));
  const bad = parseInput('https://[bad host]');
  assert.equal(bad.ok, false);
  assert.ok(bad.message.includes('无法解析'));
});

/* ==================== 重建 ==================== */

test('重建：删掉 tag=2、新增 lang=中文 → 得到验收示例的 URL', () => {
  const parsed = parseInput(SAMPLE_URL);
  const params = [
    ...parsed.params.slice(0, 2), // q=码、tag=1
    ...parsed.params.slice(3), // empty=
    { key: 'lang', value: '中文' },
  ];
  assert.equal(
    rebuildUrl(parsed, params),
    'https://user:pw@example.com:8080/a/b%20c?q=%E7%A0%81&tag=1&empty=&lang=%E4%B8%AD%E6%96%87#sec',
  );
});

test('重建：原样不动 → 与输入一致（往返不变）', () => {
  const parsed = parseInput(SAMPLE_URL);
  assert.equal(rebuildUrl(parsed, parsed.params), SAMPLE_URL);
});

test('重建：清空所有参数 → 去掉 ? 只留路径与 hash；查询串模式返回纯查询串', () => {
  const parsed = parseInput(SAMPLE_URL);
  assert.equal(rebuildUrl(parsed, []), 'https://user:pw@example.com:8080/a/b%20c#sec');

  const queryOnly = parseInput('?a=1&b=%20x');
  assert.equal(rebuildUrl(queryOnly, [{ key: 'a', value: '2' }]), 'a=2');
});

test('buildQuery：值里的特殊字符被转义，全空行被跳过', () => {
  assert.equal(buildQuery([{ key: 'k', value: 'a b&c=d' }]), 'k=a%20b%26c%3Dd');
  assert.equal(buildQuery([{ key: '', value: '' }]), '');
  assert.equal(buildQuery([]), '');
});

/* ==================== 性能 ==================== */

test('性能：10 万字符编解码在 1 秒内完成', () => {
  const text = '码 a&b=c/d'.repeat(10000); // 10 万字符
  const start = performance.now();
  const encoded = encodeText(text);
  const decoded = decodeText(encoded);
  const elapsed = performance.now() - start;
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value, text);
  assert.ok(elapsed < 1000, `耗时 ${elapsed}ms，应小于 1000ms`);
});

test('性能：解析 2000 个参数的 URL 在 1 秒内完成', () => {
  const query = Array.from({ length: 2000 }, (_, i) => `k${i}=%E7%A0%81${i}`).join('&');
  const url = `https://example.com/p?${query}`;
  const start = performance.now();
  const parsed = parseInput(url);
  const rebuilt = rebuildUrl(parsed, parsed.params);
  const elapsed = performance.now() - start;
  assert.equal(parsed.params.length, 2000);
  assert.equal(rebuilt, url);
  assert.ok(elapsed < 1000, `耗时 ${elapsed}ms，应小于 1000ms`);
});
