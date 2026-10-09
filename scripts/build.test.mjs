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

/* ==================== PWA（Service Worker / manifest） ==================== */

/** 解析 dist/sw.js 中的版本号与预缓存清单 */
function parseServiceWorker(dist) {
  const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
  const version = sw.match(/BUILD_VERSION = '([^']+)'/)?.[1];
  const precache = sw.match(/PRECACHE_URLS = JSON\.parse\('(\[[^\]]*\])'\)/)?.[1];
  assert.ok(version, 'sw.js 应注入版本号');
  assert.ok(precache, 'sw.js 应注入预缓存清单');
  return { version, precacheUrls: JSON.parse(precache) };
}

/** 搭一个带 PWA 模板的临时站点（sw.js + manifest + 注册模块） */
function writePwaFiles(root) {
  fs.writeFileSync(
    path.join(root, 'sw.js'),
    [
      "const BUILD_VERSION = '__GLM_TOOLBOX_SW_VERSION__';",
      "const PRECACHE_URLS = JSON.parse('__GLM_TOOLBOX_SW_PRECACHE__');",
      '// 测试用最小模板',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'manifest.webmanifest'),
    JSON.stringify({ name: '码工具箱', start_url: './', scope: './' }),
    'utf8',
  );
  fs.mkdirSync(path.join(root, 'assets', 'js'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'assets', 'js', 'sw-register.mjs'),
    'export {};\n',
    'utf8',
  );
}

test('PWA：dist 包含 manifest 与注入清单的 sw.js，预缓存覆盖全部文件', () => {
  const root = makeTempRoot();
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><head></head><body></body>', 'utf8');
    fs.mkdirSync(path.join(root, 'assets', 'icons'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'icons', 'icon-512.png'), '\x89PNG-fake', 'utf8');
    writeTool(root, 'demo', { category: 'text' }, { files: { 'style.css': 'body{}\n' } });
    writePwaFiles(root);

    const dist = buildSite({ root, out: path.join(root, 'dist') });
    const files = listFiles(dist);

    // manifest 复制进产物
    assert.ok(files.includes('manifest.webmanifest'), '应包含 manifest.webmanifest');
    // index.html 注入注册脚本（且只在构建产物中）
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    assert.ok(html.includes('assets/js/sw-register.mjs'), 'index.html 应注入 SW 注册脚本');
    assert.ok(
      !fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('sw-register'),
      '源 index.html 不注入（dev 不注册）',
    );

    // 预缓存清单覆盖 dist 全部文件（sw.js 自身除外）
    const { precacheUrls } = parseServiceWorker(dist);
    const expected = files.filter((f) => f !== 'sw.js').map((f) => `./${f}`).sort();
    assert.deepEqual([...precacheUrls].sort(), expected, '预缓存清单应与 dist 文件一一对应');
    assert.ok(precacheUrls.includes('./tools/index.json'), '应预缓存工具索引');
    assert.ok(precacheUrls.includes('./tools/demo/style.css'), '应预缓存工具私有样式');
  } finally {
    removeTempRoot(root);
  }
});

test('PWA：修改任意工具文件后重新构建，缓存版本号变化', () => {
  const root = makeTempRoot();
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><head></head><body></body>', 'utf8');
    writeTool(root, 'demo', { category: 'text' });
    writePwaFiles(root);

    const dist = path.join(root, 'dist');
    buildSite({ root, out: dist });
    const v1 = parseServiceWorker(dist).version;
    // 同输入重复构建：版本稳定
    buildSite({ root, out: dist });
    assert.equal(parseServiceWorker(dist).version, v1, '未变化的构建版本号应稳定');

    // 修改工具文件 → 版本变化
    fs.writeFileSync(path.join(root, 'tools', 'demo', 'style.css'), 'body{color:red}\n', 'utf8');
    buildSite({ root, out: dist });
    const v2 = parseServiceWorker(dist).version;
    assert.notEqual(v2, v1, '工具文件变化后缓存版本号应变化');
  } finally {
    removeTempRoot(root);
  }
});

test('PWA：源目录没有 sw.js 模板时不生成（不影响最小站点）', () => {
  const root = makeTempRoot();
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><head></head><body></body>', 'utf8');
    writeTool(root, 'demo', { category: 'text' });
    const dist = buildSite({ root, out: path.join(root, 'dist') });
    assert.ok(!fs.existsSync(path.join(dist, 'sw.js')), '不应生成 sw.js');
    assert.ok(!fs.existsSync(path.join(dist, 'manifest.webmanifest')), '不应生成 manifest');
  } finally {
    removeTempRoot(root);
  }
});
