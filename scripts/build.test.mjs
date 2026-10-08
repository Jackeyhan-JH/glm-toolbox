/** build 的单元测试（发布产物只含 index.html / assets / tools，且排除测试文件） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSite } from './build.mjs';
import { listFiles, makeTempRoot, removeTempRoot, writeTool } from './lib/testing.mjs';

test('dist 包含 index.html / assets / tools/index.json，不含 *.test.mjs 与 *.e2e.mjs', () => {
  const root = makeTempRoot();
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>构建</title>', 'utf8');
    fs.mkdirSync(path.join(root, 'assets', 'js'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'js', 'app.mjs'), 'export {};\n', 'utf8');
    writeTool(root, 'demo', { category: 'text' });

    const dist = buildSite({ root, out: path.join(root, 'dist') });
    const files = listFiles(dist);

    assert.ok(files.includes('index.html'), `应包含 index.html：${files}`);
    assert.ok(files.includes('assets/js/app.mjs'), `应包含 assets：${files}`);
    assert.ok(files.includes('tools/demo/index.mjs'), `应包含工具入口：${files}`);
    assert.ok(files.includes('tools/demo/logic.mjs'), `应包含工具逻辑：${files}`);
    assert.ok(files.includes('tools/index.json'), `应包含生成的索引：${files}`);

    const testFiles = files.filter((f) => f.endsWith('.test.mjs') || f.endsWith('.e2e.mjs'));
    assert.deepEqual(testFiles, [], `发布产物不应包含测试文件：${testFiles}`);

    const index = JSON.parse(fs.readFileSync(path.join(dist, 'tools', 'index.json'), 'utf8'));
    assert.equal(index.tools[0].id, 'demo');
    assert.equal(index.tools[0].entry, 'tools/demo/index.mjs');

    // 不夹带站点之外的内容（如 README、scripts、tests、node_modules）
    assert.ok(!files.some((f) => f.startsWith('scripts/') || f.startsWith('tests/') || f.startsWith('node_modules/')));
  } finally {
    removeTempRoot(root);
  }
});

test('清单非法时构建失败', () => {
  const root = makeTempRoot();
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>', 'utf8');
    writeTool(root, 'bad', { category: 'nope' });
    assert.throws(() => buildSite({ root, out: path.join(root, 'dist') }), /category/);
  } finally {
    removeTempRoot(root);
  }
});
