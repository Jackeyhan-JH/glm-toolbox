/** JSON 格式化纯逻辑的单元测试（node --test 自动发现），逐条覆盖 issue #3 的验收示例。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runAction,
  parseJson,
  serialize,
  compareKeys,
  countCodePoints,
  locate,
  errorContext,
  analyzeAst,
  MAX_DEPTH,
} from './logic.mjs';

/** issue #3 里的三行缺逗号示例 */
const MISSING_COMMA = '{\n  "a": 1\n  "b": 2\n}';

test('格式化（2 空格）：{"b":1,"a":[1,2,{"c":null}]} 的完整输出', () => {
  const r = runAction('{"b":1,"a":[1,2,{"c":null}]}');
  assert.equal(r.status, 'valid');
  assert.equal(
    r.output,
    '{\n  "b": 1,\n  "a": [\n    1,\n    2,\n    {\n      "c": null\n    }\n  ]\n}',
  );
  assert.equal(r.message, 'JSON 合法');
});

test('同一输入勾选「按键名排序」→ 第一层 "a" 在 "b" 之前（递归排序）', () => {
  const r = runAction('{"b":1,"a":[1,2,{"c":null}]}', { sortKeys: true });
  assert.equal(
    r.output,
    '{\n  "a": [\n    1,\n    2,\n    {\n      "c": null\n    }\n  ],\n  "b": 1\n}',
  );
  // 内层对象同样被排序：{"z":{"y":1,"x":2},"a":3}
  const nested = runAction('{"z":{"y":1,"x":2},"a":3}', { action: 'minify', sortKeys: true });
  assert.equal(nested.output, '{"a":3,"z":{"x":2,"y":1}}');
});

test('压缩：{ "a" : 1 , "b" : [ 1 , 2 ] } → {"a":1,"b":[1,2]}', () => {
  const r = runAction('{ "a" : 1 , "b" : [ 1 , 2 ] }', { action: 'minify' });
  assert.equal(r.status, 'valid');
  assert.equal(r.output, '{"a":1,"b":[1,2]}');
  assert.ok(!r.output.includes(' '), '压缩结果不应包含空白');
});

test('大整数保真：压缩 {"id": 12345678901234567890, "p": 1.10}', () => {
  const r = runAction('{"id": 12345678901234567890, "p": 1.10}', { action: 'minify' });
  assert.equal(r.output, '{"id":12345678901234567890,"p":1.10}');
});

test('数字按原始文本保留：1.0 / 1e3 / -0 / 1E+2 不被改写', () => {
  const r = runAction('{"a":1.0,"b":1e3,"c":-0,"d":1E+2,"e":1.5e-3}', { action: 'minify' });
  assert.equal(r.output, '{"a":1.0,"b":1e3,"c":-0,"d":1E+2,"e":1.5e-3}');
  // 与 JSON.parse + JSON.stringify 的行为对比：大整数会丢精度，本工具不会
  const native = JSON.stringify(JSON.parse('{"id": 12345678901234567890}'));
  assert.notEqual(native, '{"id":12345678901234567890}');
});

test('中文不转义：格式化 {"名字":"码工具箱"} 输出包含 "名字": "码工具箱"', () => {
  const r = runAction('{"名字":"码工具箱"}');
  assert.ok(r.output.includes('"名字": "码工具箱"'), r.output);
  // 输入里的 \uXXXX 中文也会解码为原样字符
  const decoded = runAction('"\\u7801\\u5de5\\u5177\\u7bb1"');
  assert.equal(decoded.output, '"码工具箱"');
});

test('顶层非对象也合法："abc"、123、[]、null、true、false', () => {
  for (const text of ['"abc"', '123', '[]', 'null', 'true', 'false', '-0.5e10']) {
    const r = runAction(text);
    assert.equal(r.status, 'valid', text);
    assert.equal(r.message, 'JSON 合法', text);
  }
  assert.equal(runAction('"abc"').output, '"abc"');
  assert.equal(runAction('123').output, '123');
  assert.equal(runAction('null').output, 'null');
});

test('空对象 / 空数组格式化为 {} / []（不拆成两行）', () => {
  assert.equal(runAction('{}').output, '{}');
  assert.equal(runAction('[]').output, '[]');
  assert.equal(runAction('  { }  ').output, '{}');
  const r = runAction('{"a":{},"b":[]}');
  assert.ok(r.output.includes('"a": {},'), r.output);
  assert.ok(r.output.includes('"b": []'), r.output);
  // 压缩同理
  assert.equal(runAction('{ "a" : { } }', { action: 'minify' }).output, '{"a":{}}');
});

test('错误：{"a":1,} → 第 1 行第 8 列，原因提到多余逗号', () => {
  const r = runAction('{"a":1,}');
  assert.equal(r.status, 'invalid');
  assert.equal(r.error.line, 1);
  assert.equal(r.error.column, 8);
  assert.match(r.error.message, /多余的逗号/);
  assert.equal(r.message, '第 1 行第 8 列：多余的逗号（此处应为属性名）');
});

test('错误：三行缺逗号示例 → 第 3 行第 3 列，原因提到缺少逗号', () => {
  const r = runAction(MISSING_COMMA);
  assert.equal(r.status, 'invalid');
  assert.equal(r.error.line, 3);
  assert.equal(r.error.column, 3);
  assert.match(r.error.message, /缺少逗号/);
  assert.equal(r.message, '第 3 行第 3 列：缺少逗号或右花括号');
});

test('错误：{"a":"abc → 字符串未闭合', () => {
  const r = runAction('{"a":"abc');
  assert.equal(r.status, 'invalid');
  assert.match(r.error.message, /字符串未闭合/);
});

test('错误：[1,2 → 意外的文件结尾', () => {
  const r = runAction('[1,2');
  assert.equal(r.status, 'invalid');
  assert.match(r.error.message, /意外的文件结尾/);
  assert.equal(r.error.line, 1);
});

test("错误：{'a':1} → 第 1 行第 2 列", () => {
  const r = runAction("{'a':1}");
  assert.equal(r.error.line, 1);
  assert.equal(r.error.column, 2);
  assert.match(r.error.message, /属性名必须用双引号/);
});

test('错误：{"a":01} → 数字格式错误', () => {
  const r = runAction('{"a":01}');
  assert.equal(r.status, 'invalid');
  assert.match(r.error.message, /数字格式错误/);
  assert.match(r.error.message, /前导零/);
});

test('错误：{"a":1} x → 第 1 行第 9 列有多余内容', () => {
  const r = runAction('{"a":1} x');
  assert.equal(r.error.line, 1);
  assert.equal(r.error.column, 9);
  assert.match(r.error.message, /多余的内容/);
});

test('空输入或只有空白 → 「请输入 JSON」，不显示为错误', () => {
  for (const text of ['', '   ', '\n\t \r\n']) {
    const r = runAction(text);
    assert.equal(r.status, 'empty', JSON.stringify(text));
    assert.equal(r.message, '请输入 JSON');
    assert.equal(r.error, null);
    assert.equal(r.output, '');
    assert.equal(r.stats, null);
  }
});

/* ---------------- 其他严格 RFC 8259 行为 ---------------- */

test('不接受注释 / NaN / Infinity / 单引号字符串 / 未加引号的键', () => {
  for (const text of [
    '{"a": 1 // 注释\n}',
    '{/* 块注释 */"a":1}',
    '{"a": NaN}',
    '[Infinity, -Infinity]',
    '{a: 1}',
    "{'a': 'b'}",
  ]) {
    const r = runAction(text);
    assert.equal(r.status, 'invalid', text);
    assert.ok(r.message.includes('第'), text);
  }
});

test('不接受非法数字：前导 +、孤立小数点、小数点开头的数字、十六进制', () => {
  for (const text of ['[+1]', '[.5]', '[5.]', '[0x10]', '[-]']) {
    const r = runAction(text);
    assert.equal(r.status, 'invalid', text);
  }
  assert.match(runAction('[+1]').error.message, /无效的字符「\+」/);
  assert.match(runAction('[5.]').error.message, /数字格式错误/);
});

test('不接受非法转义、非法 \\u、字符串中的裸控制字符', () => {
  assert.match(runAction('"a\\x41"').error.message, /无效的转义字符/);
  assert.match(runAction('"\\u12g4"').error.message, /无效的 \\u 转义/);
  assert.match(runAction('"a\nb"').error.message, /控制字符/); // 字符串里裸换行
});

test('缺少冒号 / 缺少右括号给出对应原因', () => {
  assert.match(runAction('{"a" 1}').error.message, /应为冒号/);
  assert.match(runAction('{"a":1').error.message, /意外的文件结尾/);
  assert.match(runAction('[1 2]').error.message, /缺少逗号或右中括号/);
  assert.match(runAction('[1,]').error.message, /多余的逗号/);
});

test('转义在输出中按最小转义还原：控制字符仍转义，斜杠不转义', () => {
  const r = runAction('{"s":"a\\nb\\tc\\/d\\\\e"}');
  assert.ok(r.output.includes('"s": "a\\nb\\tc/d\\\\e"'), r.output);
});

test('孤立代理项转义输出，合法代理对（emoji）原样输出', () => {
  // 😀 是一个代理对，格式化后应原样保留
  const emoji = runAction('"😀"');
  assert.equal(emoji.output, '"😀"');
  // 输入用两个 \u 转义写的 emoji，输出为字面字符
  const pair = runAction('"\\ud83d\\ude00"');
  assert.equal(pair.output, '"😀"');
  // 孤立代理项：输出必须转义成 \ud800 保证文本合法
  const lone = runAction('"\\ud800"');
  assert.equal(lone.output, '"\\ud800"');
});

test('重复键原样保留，不做去重', () => {
  const r = runAction('{"a":1,"a":2}', { action: 'minify' });
  assert.equal(r.output, '{"a":1,"a":2}');
});

test('嵌套超过上限报错而不是栈溢出', () => {
  const deep = '['.repeat(MAX_DEPTH + 1) + ']'.repeat(MAX_DEPTH + 1);
  const r = runAction(deep);
  assert.equal(r.status, 'invalid');
  assert.match(r.error.message, /嵌套层级过深/);
  // 恰好在上限内仍可解析
  const ok = runAction('['.repeat(MAX_DEPTH) + ']'.repeat(MAX_DEPTH));
  assert.equal(ok.status, 'valid');
  assert.equal(ok.stats.depth, MAX_DEPTH);
});

/* ---------------- 缩进选项 ---------------- */

test('缩进 4 空格与 Tab', () => {
  const four = runAction('{"a":[1]}', { indent: 4 });
  assert.equal(four.output, '{\n    "a": [\n        1\n    ]\n}');
  const tab = runAction('{"a":[1]}', { indent: 'tab' });
  assert.equal(tab.output, '{\n\t"a": [\n\t\t1\n\t]\n}');
});

/* ---------------- 统计 ---------------- */

test('统计：字符数（码点）、层级深度、键数量', () => {
  const r = runAction('{"名字":"码工具箱"}');
  assert.equal(r.stats.chars, 13); // {"名字":"码工具箱"} 共 13 个字符
  assert.equal(r.stats.depth, 1);
  assert.equal(r.stats.keys, 1);

  const nested = runAction('{"a":{"b":[1,{"c":2}]},"d":3}');
  assert.equal(nested.stats.depth, 4); // object→object→array→object
  assert.equal(nested.stats.keys, 4); // a b c d

  // 顶层标量深度为 0
  assert.equal(runAction('123').stats.depth, 0);
  // 多码点字符按码点计
  assert.equal(runAction('"👨‍👩‍👧"').stats.chars, 7); // 3 个 emoji + 2 个 ZWJ + 两个引号
  // 出错时不给统计
  assert.equal(runAction('{bad}').stats, null);
});

test('countCodePoints / locate / compareKeys 的边界行为', () => {
  assert.equal(countCodePoints(''), 0);
  assert.equal(countCodePoints('a\r\nb'), 4);
  assert.equal(countCodePoints('👨‍👩‍👧'), 5);

  assert.deepEqual(locate('ab\ncd', 0), { line: 1, column: 1 });
  assert.deepEqual(locate('ab\ncd', 2), { line: 1, column: 3 }); // 指向 \n
  assert.deepEqual(locate('ab\ncd', 3), { line: 2, column: 1 });
  assert.deepEqual(locate('a\r\nb', 3), { line: 2, column: 1 }); // \r\n 算一个换行
  assert.deepEqual(locate('😀x', 2), { line: 1, column: 2 }); // 代理对算 1 列

  // 码点序：B(0x42) < z(0x7A) < 一(0x4E00) < 😀(0x1F600)
  assert.ok(compareKeys('B', 'z') < 0);
  assert.ok(compareKeys('z', '一') < 0);
  assert.ok(compareKeys('一', '😀') < 0);
  assert.equal(compareKeys('abc', 'abc'), 0);
  assert.ok(compareKeys('ab', 'abc') < 0); // 前缀在前
});

test('analyzeAst 与 parseJson 的直接使用', () => {
  const { ok, ast } = parseJson('{"a":[1,2]}');
  assert.equal(ok, true);
  assert.deepEqual(analyzeAst(ast), { depth: 2, keys: 1 });
  assert.equal(serialize(ast, { minify: true }), '{"a":[1,2]}');
  const bad = parseJson('nope');
  assert.equal(bad.ok, false);
});

/* ---------------- 错误上下文 ---------------- */

test('errorContext：前后各约 20 个字符，^ 指向出错位置', () => {
  const r = runAction(MISSING_COMMA);
  const context = errorContext(MISSING_COMMA, r.error.index);
  const [snippetLine, caretLine] = context.split('\n');
  assert.equal(caretLine.trim(), '^');
  // ^ 的列与片段中出错字符（"b" 的双引号）对齐
  const caretCol = caretLine.indexOf('^');
  assert.equal(snippetLine[caretCol], '"');
  // 多行输入压缩为单行展示（换行显示为 ⏎）
  assert.ok(snippetLine.includes('⏎'), snippetLine);
});

test('errorContext：长文本截断时用省略号，^ 仍对齐', () => {
  const text = `${'a'.repeat(50)}X${'b'.repeat(50)}`;
  const context = errorContext(text, 50);
  const [snippetLine, caretLine] = context.split('\n');
  assert.ok(snippetLine.startsWith('…'));
  assert.ok(snippetLine.endsWith('…'));
  assert.equal(snippetLine[caretLine.indexOf('^')], 'X');
  // 不截断时没有省略号
  const short = errorContext('abXcd', 2);
  assert.ok(!short.includes('…'));
  assert.equal(short, 'abXcd\n  ^');
});

/* ---------------- 性能 ---------------- */

test('性能：约 1.2MB 的 JSON（2 万个对象）格式化在 1 秒内完成', () => {
  const parts = [];
  parts.push('[');
  for (let i = 0; i < 20000; i++) {
    if (i > 0) parts.push(',');
    parts.push(`{"id":${i},"名称":"测试项目${i}","tags":["alpha","beta"],"active":true,"score":${i}.25}`);
  }
  parts.push(']');
  const input = parts.join('');
  assert.ok(input.length >= 1024 * 1024, `输入应不小于 1MB，实际 ${input.length}`);

  const start = performance.now();
  const r = runAction(input, { action: 'format', indent: 2, sortKeys: true });
  const elapsed = performance.now() - start;
  assert.equal(r.status, 'valid');

  assert.equal(r.stats.keys, 20000 * 5);
  assert.equal(r.stats.depth, 3); // 顶层数组 → 对象 → tags 数组
  assert.ok(elapsed < 1000, `耗时 ${elapsed}ms，应小于 1000ms`);
});
