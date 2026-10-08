/** 转义工具纯逻辑的单元测试（node --test 自动发现），覆盖 issue #9 验收标准中的输入 → 输出示例 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DETAILS_LIMIT,
  DISPLAY_LIMIT,
  HTML_ESCAPE_MODES,
  NAMED_ENTITIES,
  UNICODE_FORMATS,
  charDetails,
  countCodePoints,
  escapeHtml,
  escapeJsString,
  escapeUnicode,
  formatCodePoint,
  truncateForDisplay,
  unescapeHtml,
  unescapeJsString,
  unescapeUnicode,
  utf8ByteLength,
  utf8Hex,
} from './logic.mjs';

/* ==================== HTML 实体表 ==================== */

test('实体表：HTML 4.01 全部 252 个命名实体 + &apos;，共 253 个', () => {
  assert.equal(Object.keys(NAMED_ENTITIES).length, 253);
  assert.equal(NAMED_ENTITIES.apos, '\u0027');
  assert.equal(NAMED_ENTITIES.nbsp, '\u00A0');
  assert.equal(NAMED_ENTITIES.copy, '©');
  assert.equal(NAMED_ENTITIES.plusmn, '±');
  assert.equal(NAMED_ENTITIES.euro, '€');
  assert.equal(NAMED_ENTITIES.omega, 'ω');
  assert.equal(NAMED_ENTITIES.thetasym, 'ϑ');
  assert.equal(NAMED_ENTITIES.weierp, '℘');
  assert.equal(NAMED_ENTITIES.lang, '\u2329');
  assert.equal(NAMED_ENTITIES.diams, '♦');
});

/* ==================== HTML：转义 ==================== */

test('HTML 转义（仅必要）：<a href="x">码&\'</a> → &lt;a href=&quot;x&quot;&gt;码&amp;&#39;&lt;/a&gt;', () => {
  assert.equal(escapeHtml(`<a href="x">码&'</a>`), '&lt;a href=&quot;x&quot;&gt;码&amp;&#39;&lt;/a&gt;');
});

test('HTML 转义（非 ASCII 全转）：码a → &#x7801;a（必要字符仍转义，产物是纯 ASCII）', () => {
  assert.equal(escapeHtml('码a', { mode: 'nonAscii' }), '&#x7801;a');
  assert.equal(escapeHtml('码&<>"\'a', { mode: 'nonAscii' }), '&#x7801;&amp;&lt;&gt;&quot;&#39;a');
  // 增补平面字符与十六进制小写
  assert.equal(escapeHtml('😀', { mode: 'nonAscii' }), '&#x1f600;');
});

test('HTML 转义（命名优先）：© ± → &copy; &plusmn;；五个必要字符也有命名形式', () => {
  assert.equal(escapeHtml('© ±', { mode: 'named' }), '&copy; &plusmn;');
  assert.equal(escapeHtml('&<>"\'', { mode: 'named' }), '&amp;&lt;&gt;&quot;&apos;');
  // 无命名实体的字符（如汉字）原样保留
  assert.equal(escapeHtml('码ÿ', { mode: 'named' }), '码&yuml;');
});

test('HTML 转义：空输入 → 空输出；未知模式抛中文错误', () => {
  assert.equal(escapeHtml(''), '');
  assert.throws(() => escapeHtml('a', { mode: 'nope' }), /未知的 HTML 转义模式/);
  assert.deepEqual(HTML_ESCAPE_MODES, ['necessary', 'nonAscii', 'named']);
});

/* ==================== HTML：还原 ==================== */

test('HTML 还原：&lt;p&gt;&nbsp;&copy;&#x7801;&#30721;&amp;lt; → <p>、U+00A0、©码码&lt; 依次拼接', () => {
  assert.equal(unescapeHtml('&lt;p&gt;&nbsp;&copy;&#x7801;&#30721;&amp;lt;'), '<p>\u00A0©码码&lt;');
  // 逐码点核对：&nbsp; 确实是 U+00A0 而不是普通空格
  assert.deepEqual(
    [...unescapeHtml('&nbsp;')].map((c) => c.codePointAt(0)),
    [0xa0],
  );
});

test('HTML 还原：非法实体原样保留（&foo; &#xZZ; & 单独 → 原样输出）', () => {
  assert.equal(unescapeHtml('&foo; &#xZZ; & 单独'), '&foo; &#xZZ; & 单独');
});

test('HTML 还原：其他边界情形均原样保留', () => {
  assert.equal(unescapeHtml('&lt'), '&lt'); // 缺分号
  assert.equal(unescapeHtml('&;'), '&;');
  assert.equal(unescapeHtml('&#;'), '&#;');
  assert.equal(unescapeHtml('&#65'), '&#65'); // 数值缺分号
  assert.equal(unescapeHtml('&#x110000;'), '&#x110000;'); // 超出 U+10FFFF
  assert.equal(unescapeHtml('&#0;'), '&#0;'); // 0 不是合法引用
  assert.equal(unescapeHtml('&#xD800;'), '&#xD800;'); // 代理项不是合法引用
  assert.equal(unescapeHtml('&NBSP;'), '&NBSP;'); // 实体名区分大小写
  assert.equal(unescapeHtml('&#X4E2D;'), '中'); // 大写 X 前缀也接受
});

test('HTML 还原：命名（含 &apos;）、十进制、十六进制都支持', () => {
  assert.equal(unescapeHtml('&apos;'), "'");
  assert.equal(unescapeHtml('&#30721;'), '码'); // 十进制
  assert.equal(unescapeHtml('&#x7801;'), '码'); // 十六进制
  assert.equal(unescapeHtml('&amp;amp;'), '&amp;'); // 只还原一层
});

test('HTML 往返：三种模式的转义都能还原回原文', () => {
  const samples = ['plain', '<a href="x">码&\'</a>', '© ± ÷ Ω → €', '😀 混合\n\t文本'];
  for (const mode of HTML_ESCAPE_MODES) {
    for (const text of samples) {
      assert.equal(unescapeHtml(escapeHtml(text, { mode })), text, `mode=${mode} ${JSON.stringify(text)}`);
    }
  }
});

/* ==================== Unicode：转义 ==================== */

test('Unicode 转义（\\uXXXX）：码😀a → \\u7801\\uD83D\\uDE00a（默认只转非 ASCII、大写）', () => {
  assert.equal(escapeUnicode('码😀a'), '\\u7801\\uD83D\\uDE00a');
});

test('Unicode 转义（\\u{} 格式）：码😀a → \\u{7801}\\u{1F600}a', () => {
  assert.equal(escapeUnicode('码😀a', { format: 'u-brace' }), '\\u{7801}\\u{1F600}a');
});

test('Unicode 转义（U+ 格式）：码😀a → U+7801 U+1F600 U+0061（该格式全部转换，空格分隔）', () => {
  assert.equal(escapeUnicode('码😀a', { format: 'u-plus' }), 'U+7801 U+1F600 U+0061');
  // 与「只转非 ASCII」选项无关：开关两种取值结果一致
  assert.equal(
    escapeUnicode('码😀a', { format: 'u-plus', onlyNonAscii: false }),
    'U+7801 U+1F600 U+0061',
  );
  // 输入中的空格也成为一个码点
  assert.equal(escapeUnicode('a b', { format: 'u-plus' }), 'U+0061 U+0020 U+0062');
});

test('Unicode 转义（&#x…; 与 CSS 格式）', () => {
  assert.equal(escapeUnicode('码a', { format: 'html-hex' }), '&#x7801;a');
  assert.equal(escapeUnicode('码😀a', { format: 'css' }), '\\7801 \\1F600 a');
  // CSS 格式：ASCII 也转时长这样
  assert.equal(escapeUnicode('a', { format: 'css', onlyNonAscii: false }), '\\0061 ');
});

test('Unicode 转义：选项（只转非 ASCII / 十六进制大写）', () => {
  // 关闭「只转非 ASCII」后 ASCII 也转
  assert.equal(escapeUnicode('Ma', { onlyNonAscii: false }), '\\u004D\\u0061');
  // 小写十六进制
  assert.equal(escapeUnicode('😀', { upperHex: false }), '\\ud83d\\ude00');
  assert.equal(escapeUnicode('😀', { format: 'u-brace', upperHex: false }), '\\u{1f600}');
  assert.equal(escapeUnicode('😀', { format: 'u-plus', upperHex: false }), 'U+1f600');
  assert.equal(escapeUnicode('😀', { format: 'css', upperHex: false }), '\\1f600 ');
  assert.equal(escapeUnicode('😀', { format: 'html-hex', upperHex: false }), '&#x1f600;');
  assert.equal(escapeUnicode(''), '');
  assert.throws(() => escapeUnicode('a', { format: 'nope' }), /未知的 Unicode 输出格式/);
  assert.deepEqual(UNICODE_FORMATS, ['u-escape', 'u-brace', 'u-plus', 'html-hex', 'css']);
});

/* ==================== Unicode：还原 ==================== */

test('Unicode 还原：\\u7801\\u5DE5 \\u{1F600} U+7BB1 &#x5177; → 码工 😀 箱 具（全格式混合）', () => {
  const r = unescapeUnicode('\\u7801\\u5DE5 \\u{1F600} U+7BB1 &#x5177;');
  assert.deepEqual(r, { text: '码工 😀 箱 具', warning: null });
});

test('Unicode 还原：孤立代理 \\uD83D → 保留原文并提示「存在不成对的代理项」，不抛异常', () => {
  const r = unescapeUnicode('\\uD83D');
  assert.deepEqual(r, { text: '\\uD83D', warning: '存在不成对的代理项' });
  // 孤立低代理同样处理
  assert.deepEqual(unescapeUnicode('\\uDC00'), { text: '\\uDC00', warning: '存在不成对的代理项' });
  // 相邻的高低代理合并为增补平面字符，不提示
  assert.deepEqual(unescapeUnicode('\\uD83D\\uDE00'), { text: '😀', warning: null });
  // 中间隔着普通字符则不合并
  const split = unescapeUnicode('\\uD83Dx\\uDE00');
  assert.equal(split.text, '\\uD83Dx\\uDE00');
  assert.equal(split.warning, '存在不成对的代理项');
});

test('Unicode 还原：CSS \\XXXX 形式（结尾空白作为结束符被吞掉）', () => {
  assert.deepEqual(unescapeUnicode('\\7801 \\1F600 a'), { text: '码😀a', warning: null });
  // 结尾没有空白：转义在最后一个十六进制字符处结束
  assert.deepEqual(unescapeUnicode('\\7801x'), { text: '码x', warning: null });
  // CSS 按最多 6 位贪婪取十六进制：\27801 是 U+27801，不是「码 + 1」
  assert.deepEqual(unescapeUnicode('\\27801 '), { text: '𧠁', warning: null });
  // 想还原「码 + 空格」需要两个空格：一个作结束符、一个是内容
  assert.deepEqual(unescapeUnicode('\\7801  '), { text: '码 ', warning: null });
});

test('Unicode 还原：十进制实体与不识别的内容原样保留', () => {
  assert.equal(unescapeUnicode('&#30721;').text, '码');
  // \u 后不足 4 位十六进制、未知花括号内容都按普通文本处理
  assert.equal(unescapeUnicode('\\uZZZZ').text, '\\uZZZZ');
  assert.equal(unescapeUnicode('\\u{}').text, '\\u{}');
  assert.equal(unescapeUnicode('\\u{110000}').text, '\\u{110000}');
  // \ 后跟十六进制字母按 CSS 转义处理：\b 即 U+000B（CSS 语义，b 是十六进制位）
  assert.deepEqual(unescapeUnicode('a\\b'), { text: 'a\u000B', warning: null });
  assert.equal(unescapeUnicode('\\g').text, '\\g'); // g 不是十六进制
  assert.equal(unescapeUnicode('\\').text, '\\');
  // 小写 u+ 不是 U+ 记法，不转换
  assert.equal(unescapeUnicode('u+7801').text, 'u+7801');
});

test('Unicode 往返：\\uXXXX / \\u{} / &#x…; / CSS 四种格式都能还原回原文', () => {
  const samples = ['码😀a', 'ABC xyz', '混合 😀 文本', 'Ω ≠ ∞'];
  for (const format of ['u-escape', 'u-brace', 'html-hex', 'css']) {
    for (const text of samples) {
      const round = unescapeUnicode(escapeUnicode(text, { format }));
      assert.equal(round.text, text, `format=${format} ${JSON.stringify(text)}`);
      assert.equal(round.warning, null);
    }
  }
});

test('Unicode 往返：U+XXXX 格式以空格分隔，还原后字符之间是空格（格式固有语义）', () => {
  // 单字符可以完整往返
  assert.equal(unescapeUnicode(escapeUnicode('码', { format: 'u-plus' })).text, '码');
  // 多字符：分隔空格会出现在还原结果中
  assert.equal(unescapeUnicode(escapeUnicode('码😀', { format: 'u-plus' })).text, '码 😀');
  // 原文里的空格既是 U+0020 记法又贡献分隔空格
  assert.equal(unescapeUnicode(escapeUnicode('码 a', { format: 'u-plus' })).text, '码   a');
});

/* ==================== JS / JSON 字符串 ==================== */

test('JS 转义：他说："hi" + 换行 + 制表符 + 反斜杠 → 他说：\\"hi\\"\\n\\t\\\\', () => {
  const input = '他说："hi"\n\t\\';
  const expected = '他说：\\"hi\\"\\n\\t\\\\';
  assert.equal(escapeJsString(input), expected);
});

test('JS 还原：上例输出还原后与原输入逐字相同', () => {
  const input = '他说："hi"\n\t\\';
  assert.equal(unescapeJsString(escapeJsString(input)), input);
});

test('JS 转义：控制字符与孤代理；与 JSON.stringify 行为对齐', () => {
  assert.equal(escapeJsString('\u0001\u001f\u007f'), '\\u0001\\u001f\\u007f');
  assert.equal(escapeJsString('\b\f\n\r\t'), '\\b\\f\\n\\r\\t');
  assert.equal(escapeJsString('\uD83D'), '\\ud83d'); // 孤代理 → 合法 JSON
  assert.equal(escapeJsString(''), '');
  const tricky = 'a"b\\c\nd\te😀\u0000\u001b';
  // 产物放进双引号后能被 JSON.parse 还原（孤代理除外，这里没有）
  assert.equal(JSON.parse(`"${escapeJsString(tricky)}"`), tricky);
});

test('JS 还原：支持 \\/ \\xNN \\0 与 \\u 代理对合并', () => {
  assert.equal(unescapeJsString('a\\/b'), 'a/b');
  assert.equal(unescapeJsString('\\x41\\x42'), 'AB');
  assert.equal(unescapeJsString('\\0'), '\u0000');
  assert.equal(unescapeJsString('\\ud83d\\ude00'), '😀');
  assert.equal(unescapeJsString('\\ud83d'), '\uD83D'); // 孤代理还原为孤代理字符
  assert.equal(unescapeJsString('普通文本'), '普通文本');
  assert.equal(unescapeJsString(''), '');
});

test('JS 还原：非法转义 \\x4 → 中文错误并指出位置', () => {
  assert.throws(() => unescapeJsString('\\x4'), {
    message: '非法的转义序列「\\x4」（第 1 个字符）：「\\x」后应跟 2 个十六进制数字',
  });
});

test('JS 还原：其他非法情形的错误信息都含中文与位置', () => {
  assert.throws(() => unescapeJsString('ab\\q'), /非法的转义序列「\\q」（第 3 个字符）/);
  assert.throws(() => unescapeJsString('\\u12'), /（第 1 个字符）：「\\u」后应跟 4 个十六进制数字/);
  assert.throws(() => unescapeJsString('x\\'), /（第 2 个字符）：「\\」之后没有字符/);
  assert.throws(() => unescapeJsString('\\0123'), /八进制转义不受支持/);
  assert.throws(() => unescapeJsString("\\'"), /非法的转义序列「\\'」/);
});

test('JS 往返：任意文本（含全部转义类别）逐字还原', () => {
  const samples = [
    '他说："hi"\n\t\\',
    '😀 emoji 🎉',
    'controls:\u0000\u0001\u001f\u007f',
    'quote " backslash \\ slash /',
    '混合 mixed 文本',
  ];
  for (const text of samples) {
    assert.equal(unescapeJsString(escapeJsString(text)), text, JSON.stringify(text));
  }
});

/* ==================== 字符明细 ==================== */

test('utf8Hex：码 → E7 A0 81；😀 → F0 9F 98 80；代理项返回 null', () => {
  assert.equal(utf8Hex('a'.codePointAt(0)), '61');
  assert.equal(utf8Hex('码'.codePointAt(0)), 'E7 A0 81');
  assert.equal(utf8Hex('😀'.codePointAt(0)), 'F0 9F 98 80');
  assert.equal(utf8Hex('€'.codePointAt(0)), 'E2 82 AC');
  assert.equal(utf8Hex(0xd83d), null);
  assert.equal(utf8Hex(0x10ffff), 'F4 8F BF BF');
});

test('formatCodePoint：至少 4 位、大写', () => {
  assert.equal(formatCodePoint(0x61), 'U+0061');
  assert.equal(formatCodePoint(0x7801), 'U+7801');
  assert.equal(formatCodePoint(0x1f600), 'U+1F600');
});

test('charDetails：每行含字符 / 码点 / UTF-8 字节；超过上限截断', () => {
  const d = charDetails('码 a\t');
  assert.deepEqual(d.rows, [
    { char: '码', codePoint: 'U+7801', utf8: 'E7 A0 81' },
    { char: '␣', codePoint: 'U+0020', utf8: '20' },
    { char: 'a', codePoint: 'U+0061', utf8: '61' },
    { char: '\\t', codePoint: 'U+0009', utf8: '09' },
  ]);
  assert.equal(d.total, 4);
  assert.equal(d.truncated, false);

  const big = charDetails('ab'.repeat(DETAILS_LIMIT + 10));
  assert.equal(big.rows.length, DETAILS_LIMIT);
  assert.equal(big.total, 2 * (DETAILS_LIMIT + 10));
  assert.equal(big.truncated, true);
});

/* ==================== 展示辅助 ==================== */

test('truncateForDisplay：默认 1 万字符截断', () => {
  assert.deepEqual(truncateForDisplay('hello'), { text: 'hello', truncated: false });
  const r = truncateForDisplay('a'.repeat(DISPLAY_LIMIT + 1));
  assert.equal(r.truncated, true);
  assert.equal(r.text.length, DISPLAY_LIMIT);
});

test('countCodePoints / utf8ByteLength', () => {
  assert.equal(countCodePoints(''), 0);
  assert.equal(countCodePoints('码a'), 2);
  assert.equal(countCodePoints('码😀a'), 3); // emoji 按 1 个码点计
  assert.equal(utf8ByteLength('Hi 码'), 6);
  assert.equal(utf8ByteLength('😀'), 4);
});

/* ==================== 性能（验收：10 万字符 1 秒内） ==================== */

test('性能：10 万字符的转义 / 还原都在 1 秒内完成', () => {
  const text = '码a&<> "\'😀\n\t\\'.repeat(10000); // 12 × 10000 = 12 万字符
  assert.ok(text.length > 100000);
  const budget = 1000;

  let t0 = Date.now();
  const html = escapeHtml(text);
  const htmlBack = unescapeHtml(html);
  let ms = Date.now() - t0;
  assert.equal(htmlBack, text);
  assert.ok(ms < budget, `HTML 用时 ${ms}ms`);

  t0 = Date.now();
  const uni = escapeUnicode(text);
  const uniBack = unescapeUnicode(uni);
  ms = Date.now() - t0;
  assert.equal(uniBack.text, text);
  assert.equal(uniBack.warning, null);
  assert.ok(ms < budget, `Unicode 用时 ${ms}ms`);

  t0 = Date.now();
  const js = escapeJsString(text);
  const jsBack = unescapeJsString(js);
  ms = Date.now() - t0;
  assert.equal(jsBack, text);
  assert.ok(ms < budget, `JS 用时 ${ms}ms`);
});
