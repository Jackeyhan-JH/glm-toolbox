/** gen-index 的单元测试（对应 issue #2「注册机制与脚本」验收标准） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generate } from './gen-index.mjs';
import { listFiles, makeTempRoot, removeTempRoot, runCli, writeTool } from './lib/testing.mjs';

test('排序：data 分类排在 text 前；同分类按 order 再按 name', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'zeta', { category: 'text', order: 5, name: '乙工具' });
    writeTool(root, 'alpha', { category: 'text', order: 10, name: '丙工具' });
    writeTool(root, 'mid-b', { category: 'text', order: 1, name: 'B工具' });
    writeTool(root, 'mid-a', { category: 'text', order: 1, name: 'A工具' });
    writeTool(root, 'json-thing', { category: 'data', order: 99, name: '数据工具' });

    const out = path.join(root, 'tools', 'index.json');
    generate({ toolsDir: path.join(root, 'tools'), out });
    const { tools } = JSON.parse(fs.readFileSync(out, 'utf8'));

    assert.deepEqual(
      tools.map((t) => t.id),
      ['json-thing', 'mid-a', 'mid-b', 'zeta', 'alpha'],
    );
    assert.equal(tools[0].entry, 'tools/json-thing/index.mjs');
  } finally {
    removeTempRoot(root);
  }
});

test('确定性：连续运行两次，输出字节完全一致', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'aaa', { category: 'data', order: 1 });
    writeTool(root, 'bbb', { category: 'text', order: 1 });
    const out1 = path.join(root, 'index-1.json');
    const out2 = path.join(root, 'index-2.json');
    generate({ toolsDir: path.join(root, 'tools'), out: out1 });
    generate({ toolsDir: path.join(root, 'tools'), out: out2 });
    assert.deepEqual(fs.readFileSync(out1), fs.readFileSync(out2));
  } finally {
    removeTempRoot(root);
  }
});

/* ---------------- 报错用例（CLI 以非 0 退出，中文错误含文件路径） ---------------- */

function expectCliFailure(root, expectedFragments) {
  const result = runCli('gen-index.mjs', ['--tools-dir', path.join(root, 'tools')]);
  assert.notEqual(result.status, 0, `应以非 0 退出，实际 ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('失败'), `错误信息应为中文：${result.stderr}`);
  for (const fragment of expectedFragments) {
    assert.ok(result.stderr.includes(fragment), `错误信息应包含「${fragment}」：${result.stderr}`);
  }
}

test('报错：id 与目录名不一致', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'dir-name', { id: 'other-name' });
    expectCliFailure(root, ['dir-name', '不一致', path.join(root, 'tools', 'dir-name', 'tool.json')]);
  } finally {
    removeTempRoot(root);
  }
});

test('报错：重复 id', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'first', {});
    // second 目录的清单把 id 写成 first → 既触发「与目录名不一致」，也触发「重复 id」
    writeTool(root, 'second', { id: 'first' });
    expectCliFailure(root, ['first', '重复']);
  } finally {
    removeTempRoot(root);
  }
});

test('报错：category 不在枚举内', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'bad-cat', { category: 'foo' });
    expectCliFailure(root, ['category', 'foo', 'data']);
  } finally {
    removeTempRoot(root);
  }
});

test('报错：缺少 name', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'no-name', { name: undefined });
    expectCliFailure(root, ['name']);
  } finally {
    removeTempRoot(root);
  }
});

test('报错：tool.json 不是合法 JSON', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'bad-json', {}, { rawManifest: '{ "id": "bad-json",,, }' });
    expectCliFailure(root, ['JSON', path.join(root, 'tools', 'bad-json', 'tool.json')]);
  } finally {
    removeTempRoot(root);
  }
});

test('报错：缺少 logic.mjs', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'no-logic', {}, { files: { 'logic.mjs': null } });
    expectCliFailure(root, ['logic.mjs', path.join(root, 'tools', 'no-logic')]);
  } finally {
    removeTempRoot(root);
  }
});

test('正常仓库：gen-index 产物 entry 指向 tools/<id>/index.mjs 且只含清单字段', () => {
  // 在仓库自身上运行（与 pretest 行为一致）
  const result = runCli('gen-index.mjs', []);
  assert.equal(result.status, 0, result.stderr);
  const { tools } = JSON.parse(fs.readFileSync('tools/index.json', 'utf8'));
  assert.ok(tools.some((t) => t.id === 'word-count' && t.entry === 'tools/word-count/index.mjs'));
  // 产物在 .gitignore 中（tools/index.json 不入库）
  const ignored = runCli('check.mjs', []);
  assert.equal(ignored.status, 0, ignored.stderr);
});
