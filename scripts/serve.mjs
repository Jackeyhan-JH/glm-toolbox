#!/usr/bin/env node
/**
 * serve：零依赖本地静态服务器（npm run dev）。
 *
 * 用法：node scripts/serve.mjs [--port 4173] [--root <dir>] [--base /]
 *   --port  监听端口（默认 4173）
 *   --root  站点根目录（默认仓库根）
 *   --base  站点挂载的子路径（默认 /；如 --base /glm-toolbox/ 模拟 GitHub Pages）
 *
 * 每次请求 /tools/index.json 都实时扫描 tools/ 生成 ——
 * 新建工具目录后刷新页面即可见，无需重启。
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildIndex } from './lib/manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** 规范化 --base：保证以 / 开头、以 / 结尾 */
function normalizeBase(base) {
  if (!base || base === '/') return '/';
  const withSlashes = `/${String(base).replace(/^\/+|\/+$/g, '')}/`;
  return withSlashes === '//' ? '/' : withSlashes;
}

/**
 * 启动服务器。返回 node:http 的 server（已 listen，未注册进程退出钩子）。
 * 便于测试传入 port: 0 使用随机端口。
 */
export function startServer({ port = 4173, root = REPO_ROOT, base = '/' } = {}) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res, { root: path.resolve(root), base: normalizeBase(base) }).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`服务器内部错误：${err?.stack ?? err}`);
    });
  });
  server.listen(port);
  return server;
}

async function handleRequest(req, res, { root, base }) {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request：路径编码非法');
    return;
  }

  // --base 之外的路径一律 404（子路径部署时避免绕过 base）
  if (base !== '/' && pathname !== base.slice(0, -1) && !pathname.startsWith(base)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 Not Found：站点挂载在 ${base} 下`);
    return;
  }

  // /glm-toolbox → /glm-toolbox/（相对资源才能正确解析）
  if (base !== '/' && pathname === base.slice(0, -1)) {
    res.writeHead(301, { Location: base });
    res.end();
    return;
  }

  const relPath = base === '/' ? pathname : pathname.slice(base.length - 1); // 保留开头的 /

  // 工具索引：每次实时生成
  if (relPath === '/tools/index.json') {
    const { index, errors } = buildIndex(path.join(root, 'tools'));
    if (errors.length > 0) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: errors.join('\n') }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(index));
    return;
  }

  // 静态文件
  let filePath = relPath === '/' ? '/index.html' : relPath;
  filePath = path.normalize(path.join(root, filePath));
  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden：禁止访问站点根之外的路径');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 Not Found：${pathname}`);
    return;
  }
  if (stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try {
      stat = fs.statSync(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found：${pathname}`);
      return;
    }
  }

  const type = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
}

function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '4173' },
      root: { type: 'string' },
      base: { type: 'string', default: '/' },
    },
  });
  const port = Number(values.port);
  const root = values.root ? path.resolve(values.root) : REPO_ROOT;
  const base = normalizeBase(values.base);
  const server = startServer({ port, root, base });
  server.on('listening', () => {
    const actual = server.address();
    console.log(`码工具箱开发服务器已启动：`);
    console.log(`  本地地址   http://localhost:${actual.port}${base === '/' ? '/' : base}`);
    console.log(`  站点根目录 ${root}`);
    console.log(`  工具索引   每次请求实时生成，新增 tools/<id>/ 后刷新即可见`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用，请换一个：node scripts/serve.mjs --port <其他端口>`);
      process.exit(1);
    }
    throw err;
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
