/** check 的单元测试（对应 issue #2「注册机制与脚本」验收标准） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findCdnImports, runCheck } from './check.mjs';
import { makeTempRoot, removeTempRoot, runCli, writeTool } from './lib/testing.mjs';

test('能发现 index.mjs 中以 https:// 开头的 import 并给出文件与行号', () => {
  const file = '/repo/tools/x/index.mjs';
  const source = [
    "import helper from './logic.mjs';",
    "import x from 'https://cdn.example.com/x.js';",
    "const mod = await import('https://cdn.example.com/dynamic.js');",
  ].join('\n');
  const errors = findCdnImports(file, source);
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.ok(errors[0].startsWith(`${file}:2`), `应包含文件路径与行号：${errors[0]}`);
  assert.ok(errors[0].includes('https://cdn.example.com/x.js'), errors[0]);
  assert.ok(errors[1].includes('dynamic.js'), errors[1]);
});

test('合法的相对导入不误报', () => {
  const errors = findCdnImports('/repo/tools/x/index.mjs', [
    "import { el } from '../../assets/js/ui.mjs';",
    "const mod = await import('./heavy.mjs');",
    "// 文档里写着 https://example.com/ 但不是 import",
  ].join('\n'));
  assert.deepEqual(errors, []);
});

test('check（CLI）：发现 CDN import 时以非 0 退出，错误含文件路径', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'uses-cdn');
    // 覆盖 index.mjs，加入 CDN 导入
    fs.writeFileSync(
      path.join(root, 'tools', 'uses-cdn', 'index.mjs'),
      "import x from 'https://cdn.example.com/x.js';\nexport async function mount() {}\n",
      'utf8',
    );
    const result = runCli('check.mjs', ['--tools-dir', path.join(root, 'tools')]);
    assert.notEqual(result.status, 0, `应以非 0 退出：${result.stdout}${result.stderr}`);
    assert.ok(result.stderr.includes('禁止 CDN'), result.stderr);
    assert.ok(
      result.stderr.includes(path.join(root, 'tools', 'uses-cdn', 'index.mjs')),
      `错误应包含出错文件路径：${result.stderr}`,
    );
  } finally {
    removeTempRoot(root);
  }
});

test('check：清单非法时以非 0 退出（复用清单校验规则）', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'bad', { category: 'foo' });
    const result = runCli('check.mjs', ['--tools-dir', path.join(root, 'tools')]);
    assert.notEqual(result.status, 0, result.stderr);
    assert.ok(result.stderr.includes('category'), result.stderr);
  } finally {
    removeTempRoot(root);
  }
});

test('runCheck：合法工具目录通过（空错误数组）', () => {
  const root = makeTempRoot();
  try {
    writeTool(root, 'good-one', { category: 'data' });
    const errors = runCheck({ toolsDir: path.join(root, 'tools') });
    assert.deepEqual(errors, []);
  } finally {
    removeTempRoot(root);
  }
});
