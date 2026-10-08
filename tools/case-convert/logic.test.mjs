/** 命名风格转换单元测试（对应 issue #17 验收标准中的每条「输入 → 输出」例子） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_STYLES,
  CASE_STYLES,
  convertAll,
  convertLine,
  tokenizeLine,
  toFullwidth,
  toHalfwidth,
  tokenPreview,
} from './logic.mjs';

/* ---------------- 分词规则 ---------------- */

test('tokenizeLine：分隔符切分，首尾与连续分隔符忽略', () => {
  assert.deepEqual(tokenizeLine('user_id-v2 name'), ['user', 'id', 'v2', 'name']);
  assert.deepEqual(tokenizeLine('__init__'), ['init']);
  assert.deepEqual(tokenizeLine('  hello   world  '), ['hello', 'world']);
  assert.deepEqual(tokenizeLine('a.b/c d'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(tokenizeLine(''), []);
  assert.deepEqual(tokenizeLine('___'), []);
  // 全角空格 U+3000 也是分隔符
  assert.deepEqual(tokenizeLine('用户　name'), ['用户', 'name']);
});

test('tokenizeLine：小写 → 大写断开、连续大写缩写在末位前断开', () => {
  assert.deepEqual(tokenizeLine('userName'), ['user', 'Name']);
  assert.deepEqual(tokenizeLine('XMLHttpRequest'), ['XML', 'Http', 'Request']);
  assert.deepEqual(tokenizeLine('getHTTPResponse'), ['get', 'HTTP', 'Response']);
});

test('tokenizeLine：数字归属前词、数字开头的词保持', () => {
  assert.deepEqual(tokenizeLine('v2Api'), ['v2', 'Api']);
  assert.deepEqual(tokenizeLine('user2'), ['user2']);
  assert.deepEqual(tokenizeLine('2fa'), ['2fa']);
});

test('tokenizeLine：中文等非拉丁字符整体成词，原样保留', () => {
  assert.deepEqual(tokenizeLine('用户 name'), ['用户', 'name']);
  assert.deepEqual(tokenizeLine('用户Name'), ['用户', 'Name']);
  assert.deepEqual(tokenizeLine('获取HTTP状态码'), ['获取', 'HTTP', '状态码']);
});

/* ---------------- 验收标准：XMLHttpRequest 的全部风格 ---------------- */

test('XMLHttpRequest → 12 种风格全部正确', () => {
  assert.deepEqual(convertAll('XMLHttpRequest'), {
    camel: 'xmlHttpRequest',
    pascal: 'XmlHttpRequest',
    snake: 'xml_http_request',
    screaming: 'XML_HTTP_REQUEST',
    kebab: 'xml-http-request',
    train: 'Xml-Http-Request',
    dot: 'xml.http.request',
    path: 'xml/http/request',
    title: 'Xml Http Request',
    sentence: 'Xml http request',
    lower: 'xml http request',
    upper: 'XML HTTP REQUEST',
    half: 'XMLHttpRequest',
    full: 'ＸＭＬＨｔｔｐＲｅｑｕｅｓｔ',
  });
});

/* ---------------- 验收标准：其余输入 → 输出 ---------------- */

test('getHTTPResponseCode → snake 为 get_http_response_code', () => {
  assert.equal(convertAll('getHTTPResponseCode').snake, 'get_http_response_code');
});

test('user_id-v2 name → camel 为 userIdV2Name、kebab 为 user-id-v2-name', () => {
  const result = convertAll('user_id-v2 name');
  assert.equal(result.camel, 'userIdV2Name');
  assert.equal(result.kebab, 'user-id-v2-name');
});

test('__init__ → snake 为 init；首尾多余空白忽略', () => {
  assert.equal(convertAll('__init__').snake, 'init');
  assert.equal(convertAll('  hello   world  ').camel, 'helloWorld');
});

test('iPhone15Pro → snake 为 i_phone15_pro', () => {
  assert.equal(convertAll('iPhone15Pro').snake, 'i_phone15_pro');
});

test('用户 name → camel 为 用户Name、snake 为 用户_name', () => {
  const result = convertAll('用户 name');
  assert.equal(result.camel, '用户Name');
  assert.equal(result.snake, '用户_name');
});

test('多行：每行独立转换，空行保留', () => {
  assert.equal(convertAll('foo bar\n\nbaz_qux').camel, 'fooBar\n\nbazQux');
  assert.equal(convertAll('foo bar\n\nbaz_qux').snake, 'foo_bar\n\nbaz_qux');
});

test('全角 → 半角：ＡＢＣ１２３，！　ｘ → ABC123，! x（中文逗号保持不变）', () => {
  assert.equal(convertAll('ＡＢＣ１２３，！　ｘ').half, 'ABC123，! x');
  assert.equal(toHalfwidth('ＡＢＣ１２３，！　ｘ'), 'ABC123，! x');
});

test('半角 → 全角：Hi 1! → Ｈｉ　１！', () => {
  assert.equal(convertAll('Hi 1!').full, 'Ｈｉ　１！');
  assert.equal(toFullwidth('Hi 1!'), 'Ｈｉ　１！');
});

test('全半角映射细节：可见字符区互转，逗号与区间外字符保持', () => {
  // ASCII 可见字符 !–~ 与 ！–～ 一一对应
  assert.equal(toHalfwidth('！＂＃＄％＆'), '!"#$%&');
  assert.equal(toFullwidth('!"#$%&'), '！＂＃＄％＆');
  // 半角逗号与中文逗号不互转（中文标点保持）
  assert.equal(toHalfwidth('a，b'), 'a，b');
  assert.equal(toFullwidth('a,b'), 'ａ,ｂ');
  // 中文句号、汉字等区间外字符保持不变
  assert.equal(toHalfwidth('你好。'), '你好。');
  assert.equal(toFullwidth('你好。'), '你好。');
  // 多行原样保留
  assert.equal(toHalfwidth('Ａ\nｂ'), 'A\nb');
  assert.equal(toFullwidth('A\nb'), 'Ａ\nｂ');
});

test('空输入 → 所有结果为空字符串，不报错', () => {
  const result = convertAll('');
  for (const { id } of ALL_STYLES) {
    assert.equal(result[id], '', `风格 ${id} 应为空字符串`);
  }
  assert.equal(tokenPreview(''), '');
});

/* ---------------- 补充：风格清单与预览 ---------------- */

test('风格清单：12 种命名风格 + 2 个全半角结果，id 唯一', () => {
  assert.equal(CASE_STYLES.length, 12);
  assert.equal(ALL_STYLES.length, 14);
  const ids = ALL_STYLES.map((style) => style.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('convertLine：一行同时给出全部结果', () => {
  const result = convertLine('hello world');
  assert.equal(result.camel, 'helloWorld');
  assert.equal(result.pascal, 'HelloWorld');
  assert.equal(result.screaming, 'HELLO_WORLD');
  assert.equal(result.train, 'Hello-World');
  assert.equal(result.dot, 'hello.world');
  assert.equal(result.path, 'hello/world');
  assert.equal(result.title, 'Hello World');
  assert.equal(result.sentence, 'Hello world');
  assert.equal(result.lower, 'hello world');
  assert.equal(result.upper, 'HELLO WORLD');
});

test('tokenPreview：单词用 | 连接，按行展示', () => {
  assert.equal(tokenPreview('XMLHttpRequest'), 'XML|Http|Request');
  assert.equal(tokenPreview('foo bar\n\nbaz_qux'), 'foo|bar\n\nbaz|qux');
});

test('大小写变形只作用于 ASCII 字母，全角字母等原样保留', () => {
  // ＡＢＣ 是全角字母，属于非拉丁词，不参与大小写转换
  assert.equal(convertAll('ＡＢＣ ｘｙｚ').upper, 'ＡＢＣ ｘｙｚ');
  // def 是第二个词，驼峰下首字母大写；ＡＢＣ 原样
  assert.equal(convertAll('ＡＢＣ def').camel, 'ＡＢＣDef');
});
