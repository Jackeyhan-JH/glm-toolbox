/** serve 的单元测试（对应「dev 服务器实时生成索引」「--base 子路径」验收标准） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './serve.mjs';
import { makeTempRoot, removeTempRoot, writeTool } from './lib/testing.mjs';

function minimalSite(root) {
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>测试站点</title>', 'utf8');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'app.css'), 'body{margin:0}', 'utf8');
}

async function withServer(options, fn) {
  const server = startServer(options);
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await new Promise((resolve) => server.on('close', resolve));
  }
}

test('请求 /tools/index.json 时实时生成：新建工具目录后无需重启即可见', async () => {
  const root = makeTempRoot();
  minimalSite(root);
  writeTool(root, 'alpha', { category: 'text', order: 5 });
  try {
    await withServer({ port: 0, root }, async (base) => {
      const first = await (await fetch(`${base}/tools/index.json`)).json();
      assert.deepEqual(first.tools.map((t) => t.id), ['alpha']);

      // 模拟开发中新建 tools/demo/
      writeTool(root, 'demo', { category: 'data', order: 1 });
      const second = await (await fetch(`${base}/tools/index.json`)).json();
      assert.deepEqual(second.tools.map((t) => t.id), ['demo', 'alpha']);
    });
  } finally {
    removeTempRoot(root);
  }
});

test('静态文件：/ 返回 index.html，.mjs 返回 text/javascript，未知路径 404', async () => {
  const root = makeTempRoot();
  minimalSite(root);
  writeTool(root, 'alpha');
  try {
    await withServer({ port: 0, root }, async (base) => {
      const html = await fetch(`${base}/`);
      assert.equal(html.status, 200);
      assert.match(html.headers.get('content-type'), /text\/html/);
      assert.match(await html.text(), /测试站点/);

      const mjs = await fetch(`${base}/tools/alpha/index.mjs`);
      assert.equal(mjs.status, 200);
      assert.match(mjs.headers.get('content-type'), /text\/javascript/);

      const missing = await fetch(`${base}/no-such-file.css`);
      assert.equal(missing.status, 404);

      // 路径穿越被拦截
      const escape = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
      assert.notEqual(escape.status, 200);
    });
  } finally {
    removeTempRoot(root);
  }
});

test('--base /glm-toolbox/：站点挂在子路径下，根路径 404 / 重定向', async () => {
  const root = makeTempRoot();
  minimalSite(root);
  writeTool(root, 'alpha');
  try {
    await withServer({ port: 0, root, base: '/glm-toolbox/' }, async (base) => {
      const page = await fetch(`${base}/glm-toolbox/`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /测试站点/);

      const index = await fetch(`${base}/glm-toolbox/tools/index.json`);
      assert.equal(index.status, 200);
      assert.deepEqual((await index.json()).tools.map((t) => t.id), ['alpha']);

      // /glm-toolbox（无斜杠）301 到 /glm-toolbox/
      const redirect = await fetch(`${base}/glm-toolbox`, { redirect: 'manual' });
      assert.equal(redirect.status, 301);
      assert.equal(redirect.headers.get('location'), '/glm-toolbox/');

      // base 之外的路径不提供
      const outside = await fetch(`${base}/`);
      assert.equal(outside.status, 404);
    });
  } finally {
    removeTempRoot(root);
  }
});
