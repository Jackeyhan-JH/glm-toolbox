/**
 * JSON 转换单元测试（对应 issue #4 的每条「输入 → 输出」验收例子，
 * 以及错误提示、保型、往返、性能等约定）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convert,
  swapMode,
  parseJson,
  parseYaml,
  stringifyYaml,
  parseCsv,
  stringifyCsv,
  detectDelimiter,
  ConvertError,
} from './logic.mjs';

/** 断言 convert 抛出的中文错误信息包含给定关键字 */
function assertThrowsWith(fn, ...keywords) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ConvertError, `应抛 ConvertError，实际 ${err?.name}：${err?.message}`);
    for (const kw of keywords) assert.ok(err.message.includes(kw), `错误信息应包含「${kw}」，实际：「${err.message}」`);
    return err;
  }
  assert.fail(`应抛出错误（期望信息含：${keywords.join(' / ')}），但正常返回了`);
}

test.describe('JSON → YAML', () => {
  test('验收例：映射、序列在父键下缩进、嵌套映射', () => {
    const input = '{"name":"码工具箱","tags":["json","yaml"],"meta":{"stars":5,"draft":false}}';
    const expected = [
      'name: 码工具箱',
      'tags:',
      '  - json',
      '  - yaml',
      'meta:',
      '  stars: 5',
      '  draft: false',
      '',
    ].join('\n');
    assert.equal(convert('json-yaml', input).output, expected);
  });

  test('验收例：字符串保型——会被误读为数字 / 布尔 / null 的字符串必须加引号', () => {
    const out = convert('json-yaml', '{"v":"123","b":"true","n":"null"}').output;
    // 三个值都带引号；键 n 也会被 YAML 1.1 解析器读成布尔，因此同样加引号（见下一条用例）
    assert.equal(out, "v: '123'\nb: 'true'\n'n': 'null'\n");
    // 再转回 JSON 仍是字符串
    const back = JSON.parse(convert('yaml-json', out).output);
    assert.deepEqual(back, { v: '123', b: 'true', n: 'null' });
  });

  test('保型扩展：空串、0x 十六进制、科学计数、.inf、特殊字符的字符串都加引号', () => {
    const out = stringifyYaml({
      empty: '',
      hex: '0x1A',
      sci: '1e5',
      inf: '.inf',
      colon: 'a: b',
      hash: 'x #y',
      dash: '- x',
      lead: ' x',
      numLike: '0o17',
      dot: '5.',
    });
    assert.equal(
      out,
      [
        "empty: ''",
        "hex: '0x1A'",
        "sci: '1e5'",
        "inf: '.inf'",
        "colon: 'a: b'",
        "hash: 'x #y'",
        "dash: '- x'",
        "lead: ' x'",
        "numLike: '0o17'",
        "dot: '5.'",
        '',
      ].join('\n'),
    );
    assert.deepEqual(parseYaml(out).value, {
      empty: '',
      hex: '0x1A',
      sci: '1e5',
      inf: '.inf',
      colon: 'a: b',
      hash: 'x #y',
      dash: '- x',
      lead: ' x',
      numLike: '0o17',
      dot: '5.',
    });
  });

  test('不需要引号的字符串保持普通写法（冒号不跟空格、# 不在空白后）', () => {
    const out = stringifyYaml({ url: 'http://example.com', plain: 'a#b', q: 'a:b' });
    assert.equal(out, 'url: http://example.com\nplain: a#b\nq: a:b\n');
  });

  test('会被 YAML 1.1 解析器误读的字符串加引号（解析方向仍按 1.2）', () => {
    const value = {
      a: 'yes',
      b: 'no',
      c: 'on',
      off: 'off',
      y: 'y',
      n: 'n',
      date: '2024-01-01',
      datetime: '2024-01-01T10:30:00Z',
      time: '12:30',
      hms: '1:59:59',
      underscore: '1_000',
    };
    const out = stringifyYaml(value);
    // 每个值都用单引号包住，避免 PyYAML / Ansible 等 YAML 1.1 解析器读成布尔 / 日期 / 六十进制
    for (const v of Object.values(value)) {
      assert.ok(out.includes(`'${v}'`), `输出应包含带引号的「${v}」：\n${out}`);
    }
    // 本工具按 YAML 1.2 解析，转回来仍是字符串
    assert.deepEqual(parseYaml(out).value, value);
  });

  test('含换行 / 制表符的字符串用双引号转义，且能转回', () => {
    const out = stringifyYaml({ multi: 'a\nb\tc' });
    assert.equal(out, 'multi: "a\\nb\\tc"\n');
    assert.equal(parseYaml(out).value.multi, 'a\nb\tc');
  });

  test('空对象 / 空数组、序列里的对象与嵌套序列', () => {
    assert.equal(stringifyYaml({ a: [], b: {}, c: [{}] }), 'a: []\nb: {}\nc:\n  - {}\n');
    assert.equal(
      stringifyYaml([
        [1, 2],
        { x: 1 },
      ]),
      '- - 1\n  - 2\n- x: 1\n',
    );
  });

  test('顶层标量', () => {
    assert.equal(stringifyYaml('文本'), '文本\n');
    assert.equal(stringifyYaml(42), '42\n');
    assert.equal(stringifyYaml(null), 'null\n');
    assert.equal(stringifyYaml(true), 'true\n');
  });
});

test.describe('YAML → JSON', () => {
  test('验收例：普通映射、流式序列、嵌套映射、~ 为 null', () => {
    const { value, docs } = parseYaml('a: 1\nb: [x, y]\nc:\n  d: true\n  e: ~');
    assert.equal(docs, 1);
    assert.deepEqual(value, { a: 1, b: ['x', 'y'], c: { d: true, e: null } });
  });

  test('验收例：多行字符串 |', () => {
    assert.deepEqual(parseYaml('s: |\n  第一行\n  第二行\n').value, { s: '第一行\n第二行\n' });
  });

  test('| 与 > 的裁剪指示符：- 去尾、+ 保留', () => {
    assert.deepEqual(parseYaml('s: |-\n  a\n  b\n').value, { s: 'a\nb' });
    assert.deepEqual(parseYaml('s: |+\n  a\n\n').value, { s: 'a\n\n' });
    assert.deepEqual(parseYaml('s: >\n  a\n  b\n').value, { s: 'a b\n' });
    assert.deepEqual(parseYaml('s: >-\n  a\n  b\n').value, { s: 'a b' });
  });

  test('> 折叠：空行变换行、更缩进的行保留换行', () => {
    assert.deepEqual(parseYaml('s: >\n  a\n\n  b\n').value, { s: 'a\nb\n' });
    // 块内容缩进取首行（2 空格），「   b」去掉 2 空格后是「 b」——比普通行更缩进，换行保留
    assert.deepEqual(parseYaml('s: >\n  a\n   b\n  c\n').value, { s: 'a\n b\nc\n' });
  });

  test('验收例：流式序列未闭合 → 中文错误 + 行号', () => {
    const err = assertThrowsWith(() => parseYaml('a: [1, 2'), '第 1 行', '未闭合');
    assert.equal(err.line, 1);
  });

  test('验收例：缩进错误 → 报错含第 2 行', () => {
    const err = assertThrowsWith(() => parseYaml('a: 1\n  b: 2'), '第 2 行', '缩进');
    assert.equal(err.line, 2);
  });

  test('锚点 / 别名 / 标签 / 复杂键 / % 指令：给出中文不支持提示', () => {
    assertThrowsWith(() => parseYaml('a: &base 1'), '锚点');
    assertThrowsWith(() => parseYaml('a: *base'), '别名');
    assertThrowsWith(() => parseYaml('a: !!str 123'), '标签');
    assertThrowsWith(() => parseYaml('? complex\n: value'), '复杂键');
    assertThrowsWith(() => parseYaml('%YAML 1.2\n---\na: 1'), '%');
  });

  test('缩进里的 Tab → 中文错误 + 行号', () => {
    assertThrowsWith(() => parseYaml('a:\n\tb: 1'), '第 2 行', 'Tab');
  });

  test('键值对缺少冒号 → 中文错误', () => {
    assertThrowsWith(() => parseYaml('a: 1\noops\n'), '第 2 行', '缺少「:」');
  });

  test('多文档（---）转为 JSON 数组，convert 给出提示', () => {
    const input = '---\na: 1\n---\nb: 2\n';
    const { value, docs } = parseYaml(input);
    assert.equal(docs, 2);
    assert.deepEqual(value, [{ a: 1 }, { b: 2 }]);
    const r = convert('yaml-json', input);
    assert.deepEqual(JSON.parse(r.output), [{ a: 1 }, { b: 2 }]);
    assert.match(r.notice, /2 个 YAML 文档/);
  });

  test('多文档中的空文档保留为 null（---\\n---\\na: 1 → [null, {"a":1}]）', () => {
    assert.deepEqual(parseYaml('---\n---\na: 1').value, [null, { a: 1 }]);
    assert.deepEqual(parseYaml('---\n---\n').value, [null, null]);
    // 第一个 --- 之前、以及只有注释的内容不算文档
    assert.deepEqual(parseYaml('a: 1\n---\nb: 2\n').value, [{ a: 1 }, { b: 2 }]);
    assert.deepEqual(parseYaml('# 说明\n---\na: 1\n').value, { a: 1 });
  });

  test('重复键：中文报错并定位到重复的那一行（块映射与流式映射）', () => {
    const err = assertThrowsWith(() => parseYaml('a: 1\na: 2'), '第 2 行', '重复的键「a」');
    assert.equal(err.line, 2);
    assertThrowsWith(() => parseYaml('"a": 1\nx:\n  b: 1\n  b: 2'), '第 4 行', '重复的键「b」');
    assertThrowsWith(() => parseYaml('{a: 1, a: 2}'), '重复的键「a」');
  });

  test('__proto__ 作为键保留为自有属性（与 JSON.parse 一致）', () => {
    const expected = JSON.parse('{"__proto__":{"x":1},"b":2}');
    assert.deepEqual(parseYaml('__proto__:\n  x: 1\nb: 2').value, expected);
    assert.deepEqual(Object.keys(parseYaml('__proto__:\n  x: 1\nb: 2').value), ['__proto__', 'b']);
    assert.deepEqual(parseYaml('{__proto__: {x: 1}, b: 2}').value, expected);
  });

  test('文档结束标记 ... 之后不应再有内容', () => {
    assertThrowsWith(() => parseYaml('a: 1\n...\nb: 2'), '第 3 行', '...');
    assert.deepEqual(parseYaml('a: 1\n...\n').value, { a: 1 });
  });

  test('块序列与键同级（tags:\\n- a）也是合法 YAML', () => {
    assert.deepEqual(parseYaml('tags:\n- json\n- yaml\nk: 1').value, {
      tags: ['json', 'yaml'],
      k: 1,
    });
  });

  test('序列项内的紧凑映射与嵌套序列', () => {
    assert.deepEqual(parseYaml('- a: 1\n  b: 2\n- c: 3').value, [
      { a: 1, b: 2 },
      { c: 3 },
    ]);
    assert.deepEqual(parseYaml('- - 1\n  - 2\n- 3').value, [[1, 2], 3]);
    assert.deepEqual(parseYaml('top:\n  - - x\n').value, { top: [['x']] });
  });

  test('流式集合跨行、流式映射、引号字符串跨行', () => {
    assert.deepEqual(parseYaml('a: [1,\n  2]\nb: {x: 1, y: 2}\nc: "第一行\n  第二行"').value, {
      a: [1, 2],
      b: { x: 1, y: 2 },
      c: '第一行 第二行',
    });
  });

  test('引号：单引号转义、双引号转义、数字 / 布尔键转字符串', () => {
    assert.deepEqual(parseYaml("a: 'it''s'\nb: \"a\\nb\"\n1: x\ntrue: y").value, {
      a: "it's",
      b: 'a\nb',
      1: 'x',
      true: 'y',
    });
  });

  test('标量类型：YAML 1.2 核心（yes / no / on 不算布尔）', () => {
    assert.deepEqual(
      parseYaml('a: 0x1A\nb: 0o17\nc: 1.5e3\nd: -7\ne: yes\nf: no\ng: on\nh: True\ni: NULL\nj: 2024-01-01').value,
      {
        a: 26,
        b: 15,
        c: 1500,
        d: -7,
        e: 'yes',
        f: 'no',
        g: 'on',
        h: true,
        i: null,
        j: '2024-01-01',
      },
    );
  });

  test('注释：整行注释与行尾注释，引号内的 # 不算注释', () => {
    assert.deepEqual(parseYaml('# 顶部\na: 1 # 行尾\nb: "x # y"').value, {
      a: 1,
      b: 'x # y',
    });
  });

  test('CRLF 与 BOM 输入', () => {
    assert.deepEqual(parseYaml('a: 1\r\nb: 2\r\n').value, { a: 1, b: 2 });
    assert.deepEqual(parseYaml('﻿a: 1\n').value, { a: 1 });
  });

  test('空输入与只有注释的输入 → null', () => {
    assert.deepEqual(parseYaml(''), { value: null, docs: 1 });
    assert.deepEqual(parseYaml('# 只有注释\n'), { value: null, docs: 1 });
  });

  test('.inf / .nan 无法用 JSON 表示 → 中文错误', () => {
    assertThrowsWith(() => convert('yaml-json', 'a: .inf'), '无法用 JSON 表示');
    assertThrowsWith(() => convert('yaml-json', 'a: .nan'), '无法用 JSON 表示');
  });

  test('输出是 2 空格缩进的格式化 JSON', () => {
    assert.equal(convert('yaml-json', 'a:\n  b: 1\n').output, '{\n  "a": {\n    "b": 1\n  }\n}\n');
  });
});

test.describe('JSON 解析（中文错误 + 行列号）', () => {
  test('常见语法错误的定位与提示', () => {
    assertThrowsWith(() => parseJson('{"a":1,}'), '第 1 行', '逗号');
    assertThrowsWith(() => parseJson('{\n  "a": 1\n  "b": 2\n}'), '第 3 行');
    assertThrowsWith(() => parseJson('{\n  "a": [1,\n   2\n}'), '第 4 行');
    assertThrowsWith(() => parseJson('{a: 1}'), '键必须是双引号字符串');
    assertThrowsWith(() => parseJson("{'a': 1}"), '单引号');
    assertThrowsWith(() => parseJson('[1,]'), '逗号');
    assertThrowsWith(() => parseJson('"abc'), '字符串没有闭合');
    assertThrowsWith(() => parseJson('"a\nb"'), '换行');
    assertThrowsWith(() => parseJson('[01]'), '数字');
    assertThrowsWith(() => parseJson('1 2'), '多余内容');
    assertThrowsWith(() => parseJson(''), '意外结束');
    assertThrowsWith(() => parseJson('{"a" 1}'), '冒号');
  });

  test('合法输入正常解析（含 Unicode 转义、嵌套）', () => {
    assert.deepEqual(parseJson('{"a": [1, 2.5, true, null], "b": {"c": "\\u4e2d"}}'), {
      a: [1, 2.5, true, null],
      b: { c: '中' },
    });
  });

  test('__proto__ 作为键保留为自有属性且顺序与 JSON.parse 一致', () => {
    const expected = JSON.parse('{"__proto__":{"x":1},"b":2}');
    const parsed = parseJson('{"__proto__":{"x":1},"b":2}');
    assert.deepEqual(parsed, expected);
    assert.deepEqual(Object.keys(parsed), ['__proto__', 'b']);
    assert.equal(Object.getPrototypeOf(parsed), Object.prototype); // 没被当成原型设定
  });
});

test.describe('JSON → CSV', () => {
  test('验收例：表头并集、引号转义、缺失写空', () => {
    const input = '[{"id":1,"name":"张三","note":"a,b"},{"id":2,"name":"李\\"四","extra":true}]';
    assert.equal(
      convert('json-csv', input).output,
      'id,name,note,extra\r\n1,张三,"a,b",\r\n2,"李""四",,true',
    );
  });

  test('验收例：嵌套对象 / 数组写成 JSON 字符串', () => {
    assert.equal(convert('json-csv', '[{"a":{"x":1},"b":[1,2]}]').output, 'a,b\r\n"{""x"":1}","[1,2]"');
  });

  test('验收例：非对象数组 → 「CSV 转换需要对象数组」', () => {
    assertThrowsWith(() => convert('json-csv', '{"a":1}'), 'CSV 转换需要对象数组');
    assertThrowsWith(() => convert('json-csv', '[1,2]'), 'CSV 转换需要对象数组');
  });

  test('空数组 → 空输出；null / 缺失 / 布尔 / 数字的写法', () => {
    assert.equal(convert('json-csv', '[]').output, '');
    assert.equal(
      convert('json-csv', '[{"a":null,"b":0,"c":false,"d":"x\\ny"}]').output,
      'a,b,c,d\r\n,0,false,"x\ny"',
    );
  });

  test('分隔符选项：分号 / 制表符输出', () => {
    assert.equal(
      convert('json-csv', '[{"a":1,"b":"x;y"}]', { csvDelimiter: 'semicolon' }).output,
      'a;b\r\n1;"x;y"',
    );
    assert.equal(
      convert('json-csv', '[{"a":1,"b":"x"}]', { csvDelimiter: 'tab' }).output,
      'a\tb\r\n1\tx',
    );
  });
});

test.describe('CSV → JSON', () => {
  test('验收例：自动识别数字和布尔（默认开）、CRLF、引号内换行', () => {
    const out = convert('csv-json', 'id,ok,name\r\n1,true,"多\n行"\r\n2,,x');
    assert.deepEqual(JSON.parse(out.output), [
      { id: 1, ok: true, name: '多\n行' },
      { id: 2, ok: '', name: 'x' },
    ]);
  });

  test('验收例：关闭自动识别 → 全部是字符串', () => {
    const out = convert('csv-json', 'id,ok,name\r\n1,true,x', { csvAutoDetect: false });
    assert.deepEqual(JSON.parse(out.output), [{ id: '1', ok: 'true', name: 'x' }]);
  });

  test('验收例：分号与制表符在自动识别下正确解析', () => {
    assert.deepEqual(JSON.parse(convert('csv-json', 'a;b\n1;2').output), [{ a: 1, b: 2 }]);
    assert.deepEqual(JSON.parse(convert('csv-json', 'a\tb\n1\t2').output), [{ a: 1, b: 2 }]);
    assert.match(convert('csv-json', 'a;b\n1;2').notice, /分号/);
    assert.match(convert('csv-json', 'a\tb\n1\t2').notice, /制表符/);
  });

  test('验收例：引号未闭合 → 中文错误含第 2 行', () => {
    const err = assertThrowsWith(() => convert('csv-json', 'a,b\n"1,2'), '第 2 行', '引号未闭合');
    assert.equal(err.line, 2);
  });

  test('验收例：JSON → CSV 再转回，id / name / note 与原值一致', () => {
    const input = '[{"id":1,"name":"张三","note":"a,b"},{"id":2,"name":"李\\"四","extra":true}]';
    const csv = convert('json-csv', input).output;
    const back = JSON.parse(convert('csv-json', csv).output);
    assert.deepEqual(
      back.map((r) => ({ id: r.id, name: r.name, note: r.note })),
      [
        { id: 1, name: '张三', note: 'a,b' },
        { id: 2, name: '李"四', note: '' },
      ],
    );
  });

  test('表头重复时后者加 _2 后缀', () => {
    assert.deepEqual(JSON.parse(convert('csv-json', 'a,a,a\n1,2,3').output), [
      { a: 1, a_2: 2, a_3: 3 },
    ]);
  });

  test('BOM 开头的输入可正常解析', () => {
    assert.deepEqual(JSON.parse(convert('csv-json', '﻿a,b\n1,2').output), [{ a: 1, b: 2 }]);
  });

  test('显式分隔符选项覆盖自动识别', () => {
    assert.deepEqual(
      JSON.parse(convert('csv-json', 'a;b\n1;2', { csvDelimiter: 'comma' }).output),
      [{ 'a;b': '1;2' }],
    );
  });

  test('detectDelimiter：首行出现最多的候选者胜出，平手按逗号', () => {
    assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
    assert.equal(detectDelimiter('a\tb\tc\n1'), '\t');
    assert.equal(detectDelimiter('a,b;c\n1'), ',');
    assert.equal(detectDelimiter('abc'), ',');
  });

  test('数字识别：整数、负数、浮点；往返不变的才转数字', () => {
    // 1e3 / .5 / 2.0 这类「Number 转回字符串与原文不同」的写法保留原样，不改变用户输入
    const values = JSON.parse(convert('csv-json', 'v\n-3\n2.5\n1e3\n.5\n2.0\n0x1f\n中国').output).map((r) => r.v);
    assert.deepEqual(values, [-3, 2.5, '1e3', '.5', '2.0', '0x1f', '中国']);
  });

  test('自动识别不篡改超出安全整数范围的长数字（身份证号 / 雪花 ID）', () => {
    const input = 'id,phone,zip\n110101199001011234,13800138000,007\n1234567890123456789,0123,00100';
    const rows = JSON.parse(convert('csv-json', input).output);
    assert.equal(rows[0].id, '110101199001011234');
    assert.equal(rows[0].zip, '007');
    assert.equal(rows[1].id, '1234567890123456789');
    assert.equal(rows[1].phone, '0123');
    assert.equal(rows[1].zip, '00100');
    // 安全范围内的数字仍正常识别为数字
    assert.equal(rows[0].phone, 13800138000);
    const plain = JSON.parse(convert('csv-json', 'n\n42\n-7\n2.5\n0').output).map((r) => r.n);
    assert.deepEqual(plain, [42, -7, 2.5, 0]);
  });

  test('引号未闭合资报引号开始的那一行（不是文件末尾）', () => {
    const err = assertThrowsWith(() => convert('csv-json', 'a,b\n"1,2\n3,4\n5,6\n7,8'), '第 2 行', '引号未闭合');
    assert.equal(err.line, 2);
    // 中间行未闭合：定位到该行而不是最后一行
    const err2 = assertThrowsWith(() => convert('csv-json', 'a,b\n1,2\n3,"x\n5,6'), '第 3 行', '引号未闭合');
    assert.equal(err2.line, 3);
  });

  test('整行为空的行跳过（含结尾多余空行）', () => {
    const rows = JSON.parse(convert('csv-json', 'a,b\n1,2\n\n3,4\n\n').output);
    assert.deepEqual(rows, [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
  });

  test('某行列数比表头多：给出提示，多出的列忽略', () => {
    const r = convert('csv-json', 'a,b\n1,2\n3,4,5');
    assert.match(r.notice, /1 行的列数比表头多，多出的列已忽略/);
    assert.deepEqual(JSON.parse(r.output), [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
  });

  test('__proto__ 作为表头时保留为自有属性（与 JSON.parse 一致）', () => {
    const rows = JSON.parse(convert('csv-json', '__proto__,b\n1,2').output);
    assert.deepEqual(rows, [JSON.parse('{"__proto__":1,"b":2}')]);
    assert.deepEqual(Object.keys(rows[0]), ['__proto__', 'b']);
  });
});

test.describe('模式与整体行为', () => {
  test('swapMode：四种模式两两反转', () => {
    assert.equal(swapMode('json-yaml'), 'yaml-json');
    assert.equal(swapMode('yaml-json'), 'json-yaml');
    assert.equal(swapMode('json-csv'), 'csv-json');
    assert.equal(swapMode('csv-json'), 'json-csv');
  });

  test('空输入 → 空输出、无提示、不报错', () => {
    for (const mode of ['json-yaml', 'yaml-json', 'json-csv', 'csv-json']) {
      assert.deepEqual(convert(mode, '   \n '), { output: '', notice: '' });
    }
  });

  test('JSON ↔ YAML 全量往返', () => {
    const value = {
      name: '码工具箱',
      tags: ['json', 'yaml'],
      meta: { stars: 5, draft: false, empty: '', tricky: { 'a: b': '- x', '123': 'true' } },
      lines: ['第一行\n第二行'],
      nested: [[1, [2]], { deep: { deeper: null } }],
    };
    const yaml = convert('json-yaml', JSON.stringify(value)).output;
    assert.deepEqual(JSON.parse(convert('yaml-json', yaml).output), value);
  });
});

test.describe('性能', () => {
  test('1 万行 × 10 列 CSV → JSON 在 1 秒内完成', () => {
    const header = Array.from({ length: 10 }, (_, i) => `col${i}`);
    const rows = Array.from({ length: 10000 }, (_, r) => header.map((_, c) => (c === 0 ? r : `v${r}-${c}`)));
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const started = performance.now();
    const { rows: parsed } = parseCsv(csv, { delimiter: 'auto', autoDetect: true });
    const elapsed = performance.now() - started;
    assert.equal(parsed.length, 10000);
    assert.equal(parsed[9999].col0, 9999);
    assert.equal(parsed[42].col9, 'v42-9');
    assert.ok(elapsed < 1000, `耗时 ${elapsed.toFixed(0)}ms，应小于 1000ms`);
  });
});
