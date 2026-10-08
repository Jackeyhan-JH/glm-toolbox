/** gen-readme 的单元测试（标记区间替换 / --check 语义） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderReadme, generateToolsTable } from './gen-readme.mjs';
import { makeTempRoot, removeTempRoot, writeTool } from './lib/testing.mjs';

const START = '<!-- tools:start -->';
const END = '<!-- tools:end -->';

test('generateToolsTable：按分类输出全部工具，链接指向线上 #/<id>', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'alpha', { name: '甲工具', category: 'data', order: 20 });
    writeTool(root, 'beta', { name: '乙工具', category: 'data', order: 10 });
    const table = generateToolsTable(path.join(root, 'tools'));

    const lines = table.split('\n');
    assert.equal(lines[0], '| 分类 | 工具 | 说明 |');
    // order 小的在前
    assert.ok(lines[2].includes('[乙工具](https://jackeyhan-jh.github.io/glm-toolbox/#/beta)'));
    assert.ok(lines[3].includes('[甲工具](https://jackeyhan-jh.github.io/glm-toolbox/#/alpha)'));
  } finally {
    removeTempRoot(root);
  }
});

test('renderReadme：只替换标记区间，区间外内容保持不变', () => {
  const source = ['# 标题', '', START, '旧内容', END, '', '尾部说明'].join('\n');
  const rendered = renderReadme(source, '| 新表 |');
  assert.ok(rendered.startsWith('# 标题\n\n' + START));
  assert.ok(rendered.includes('\n| 新表 |\n' + END));
  assert.ok(rendered.endsWith('尾部说明'));
  assert.ok(!rendered.includes('旧内容'));
});

test('renderReadme：缺少标记时报错', () => {
  assert.throws(() => renderReadme('没有标记的 README', '| 表 |'), /tools:start/);
});

test('renderReadme：相同表内容幂等（再渲染一次不变）', () => {
  const once = renderReadme(`# t\n${START}\n${END}\n`, '| 表 |');
  assert.equal(renderReadme(once, '| 表 |'), once);
});
