/** JSON 转 TS 类型纯逻辑的单元测试（node --test 自动发现）。
 *  覆盖 issue #5「验收标准」中的每一条「输入 → 输出」例子。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrayElementName, generateTypeScript, pascalCase, parseJson } from './logic.mjs';

/** issue #5 验收标准的第一个例子 */
const EXAMPLE_1 =
  '{"id":1,"user_name":"a","tags":["x"],"profile":{"age":3,"avatar":null},' +
  '"items":[{"sku":"A","qty":1},{"sku":"B","price":9.5}]}';

const EXAMPLE_1_EXPECTED = `export interface Root {
  id: number;
  user_name: string;
  tags: string[];
  profile: Profile;
  items: Item[];
}

export interface Profile {
  age: number;
  avatar: null;
}

export interface Item {
  sku: string;
  qty?: number;
  price?: number;
}`;

test('综合示例：对象 / 数组 / 嵌套对象 / 可选键（逐字相等）', () => {
  assert.equal(generateTypeScript(EXAMPLE_1), EXAMPLE_1_EXPECTED);
});

test('特殊键：不是合法标识符的键加双引号', () => {
  const out = generateTypeScript('{"a-b":1,"2x":true,"ok":"y"}');
  assert.equal(
    out,
    `export interface Root {
  "a-b": number;
  "2x": boolean;
  ok: string;
}`,
  );
  assert.ok(out.includes('"a-b": number;'));
  assert.ok(out.includes('"2x": boolean;'));
  assert.ok(out.includes('ok: string;'));
});

test('根为数组：元素类型联合，按首次出现顺序并加括号', () => {
  assert.equal(generateTypeScript('[1,"a",null]'), 'export type Root = (number | string | null)[];');
});

test('空对象 → export interface Root {}；空数组 → export type Root = unknown[]', () => {
  assert.equal(generateTypeScript('{}'), 'export interface Root {}');
  assert.equal(generateTypeScript('[]'), 'export type Root = unknown[];');
});

test('混合元素数组：对象元素生成独立接口，联合类型保持首次出现顺序', () => {
  const out = generateTypeScript('{"v":[1,"a",{"k":1}]}');
  assert.ok(out.includes('v: (number | string | VItem)[];'), out);
  // VItem 为多行格式
  assert.ok(out.includes('export interface VItem {\n  k: number;\n}'), out);
});

test('type 模式：Profile 输出为 export type Profile = { … };', () => {
  const out = generateTypeScript(EXAMPLE_1, { kind: 'type' });
  assert.ok(out.includes('export type Profile = {\n  age: number;\n  avatar: null;\n};'), out);
  assert.ok(out.startsWith('export type Root = {'), out);
  // interface 模式下的关键字不应再出现
  assert.ok(!out.includes('interface'), out);
});

test('去掉 export 选项后输出中不含 export', () => {
  const out = generateTypeScript(EXAMPLE_1, { exportDecl: false });
  assert.ok(!out.includes('export'), out);
  assert.ok(out.startsWith('interface Root {'), out);
});

test('结构复用：结构完全相同的对象只生成一个接口', () => {
  assert.equal(
    generateTypeScript('{"a":{"x":1},"b":{"x":2}}'),
    `export interface Root {
  a: A;
  b: A;
}

export interface A {
  x: number;
}`,
  );
});

test('非法 JSON：抛中文错误提示', () => {
  assert.throws(() => generateTypeScript('{a:1}'), (err) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /^JSON 格式有误，无法解析：/);
    assert.match(err.message, /[一-鿿]/); // 确实含中文
    return true;
  });
  // 其他非法形式同样报中文错误
  assert.throws(() => parseJson('{"a":'), /JSON 格式有误/);
  assert.throws(() => parseJson('no json'), /JSON 格式有误/);
});

test('根类型名：ApiResponse → 第一行为 export interface ApiResponse {', () => {
  const out = generateTypeScript(EXAMPLE_1, { rootName: 'ApiResponse' });
  assert.equal(out.split('\n')[0], 'export interface ApiResponse {');
});

test('性能：1MB JSON 在 1 秒内生成结果', () => {
  const big = JSON.stringify({
    items: Array.from({ length: 12000 }, (_, i) => ({
      id: i,
      name: `name-${i}`,
      active: i % 2 === 0,
      tags: ['a', 'b', 'c'],
      profile: { created: true, score: i * 0.5, city: `city-${i % 99}` },
    })),
  });
  assert.ok(big.length >= 1_000_000, `测试数据应不小于 1MB，实际 ${big.length} 字节`);

  const start = performance.now();
  const out = generateTypeScript(big);
  const elapsed = performance.now() - start;

  assert.ok(out.includes('items: Item[];'), out);
  assert.ok(out.includes('profile: Profile;'), out);
  assert.ok(!out.includes('score?: number;'), out); // 每个元素都有 score，不应可选
  assert.ok(elapsed < 1000, `耗时 ${elapsed}ms，应小于 1000ms`);
});

/* ---------------- 选项与渲染细节 ---------------- */

test('可选属性写法 | undefined：key: T | undefined;（不再用 ?）', () => {
  const out = generateTypeScript('{"items":[{"sku":"A","qty":1},{"sku":"B"}]}', {
    optionalStyle: 'undefined',
  });
  assert.ok(out.includes('qty: number | undefined;'), out);
  assert.ok(!out.includes('?:'), out);
});

test('空输入返回空字符串，不报错', () => {
  assert.equal(generateTypeScript(''), '');
  assert.equal(generateTypeScript('   \n\t '), '');
});

test('根为标量 / null：用 type 别名', () => {
  assert.equal(generateTypeScript('42'), 'export type Root = number;');
  assert.equal(generateTypeScript('"hi"'), 'export type Root = string;');
  assert.equal(generateTypeScript('true'), 'export type Root = boolean;');
  assert.equal(generateTypeScript('null'), 'export type Root = null;');
});

test('根为数组且元素是对象：元素接口名由根名加 Item 派生', () => {
  const out = generateTypeScript('[{"a":1}]');
  assert.ok(out.includes('export type Root = RootItem[];'), out);
  assert.ok(out.includes('export interface RootItem {\n  a: number;\n}'), out);
});

test('数组元素接口名：items → Item；data → DataItem', () => {
  let out = generateTypeScript('{"items":[{"a":1}]}');
  assert.ok(out.includes('interface Item {'), out);
  out = generateTypeScript('{"data":[{"a":1}]}');
  assert.ok(out.includes('interface DataItem {'), out);
});

test('名称冲突时加数字后缀（Item2）', () => {
  const out = generateTypeScript('{"a":{"items":[{"x":1}]},"b":{"items":[{"y":2}]}}');
  assert.ok(out.includes('interface Item {'), out);
  assert.ok(out.includes('interface Item2 {'), out);
  assert.ok(out.includes('a: A;'), out);
  assert.ok(out.includes('b: B;'), out);
});

test('与根类型名冲突时同样加数字后缀', () => {
  const out = generateTypeScript('{"root":{"x":1}}');
  assert.ok(out.includes('root: Root2;'), out);
  assert.ok(out.includes('export interface Root2 {'), out);
});

test('嵌套数组与数组联合类型', () => {
  let out = generateTypeScript('{"matrix":[[1,2],[3]]}');
  assert.ok(out.includes('matrix: number[][];'), out);
  out = generateTypeScript('{"v":[[1],["a"]]}');
  assert.ok(out.includes('v: (number[] | string[])[];'), out);
});

test('对象数组相同键的不同对象结构合并为可选键', () => {
  const out = generateTypeScript('{"list":[{"a":{"x":1}},{"a":{"y":2}}]}');
  // 两个元素都有 a，但结构不同 → 合并为一个接口，x / y 均可选
  assert.ok(out.includes('export interface A {\n  x?: number;\n  y?: number;\n}'), out);
});

test('嵌套对象中的空数组为 unknown[]', () => {
  const out = generateTypeScript('{"tags":[],"name":"a"}');
  assert.ok(out.includes('tags: unknown[];'), out);
});

test('数组内 null 与对象混合生成联合', () => {
  const out = generateTypeScript('{"users":[{"id":1},null]}');
  assert.ok(out.includes('users: (User | null)[];'), out);
});

test('pascalCase：下划线 / 驼峰 / 全大写都归一为 PascalCase', () => {
  assert.equal(pascalCase('user_profile'), 'UserProfile');
  assert.equal(pascalCase('userProfile'), 'UserProfile');
  assert.equal(pascalCase('USER_PROFILE'), 'UserProfile');
  assert.equal(pascalCase('profile'), 'Profile');
  assert.equal(pascalCase('a-b'), 'AB');
});

test('arrayElementName：去结尾 s 或加 Item 后缀', () => {
  assert.equal(arrayElementName('Items'), 'Item');
  assert.equal(arrayElementName('Data'), 'DataItem');
  assert.equal(arrayElementName('Root'), 'RootItem');
});

test('非法 / 残留选项被归一化，不致崩溃', () => {
  // rootName 为空 → 回退 Root；kind 非法 → interface；optionalStyle 非法 → question
  let out = generateTypeScript('{"a":1}', { rootName: '  ', kind: 'weird', optionalStyle: 42 });
  assert.ok(out.startsWith('export interface Root {'), out);
  // rootName 不是合法标识符 → pascalCase 归一化
  out = generateTypeScript('{"a":1}', { rootName: 'api response' });
  assert.ok(out.startsWith('export interface ApiResponse {'), out);
});

test('输出顺序：根在前，其余按首次出现顺序，接口间空一行', () => {
  const out = generateTypeScript('{"z":{"a":1},"a":{"b":2},"m":{"c":3}}');
  const order = out
    .split('\n')
    .filter((line) => line.startsWith('export interface'))
    .map((line) => line.match(/interface (\w+)/)[1]);
  assert.deepEqual(order, ['Root', 'Z', 'A', 'M']);
  assert.ok(out.includes('}\n\nexport interface Z {'), out);
});
