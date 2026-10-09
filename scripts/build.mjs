#!/usr/bin/env node
/**
 * build：生成发布产物 dist/（npm run build，由 pages.yml 调用）。
 *
 * dist/ 只包含：
 *   - index.html（注入 Service Worker 注册脚本）
 *   - assets/（全量）
 *   - tools/（去掉 *.test.mjs、*.e2e.mjs、fixtures/）
 *   - 生成的 tools/index.json
 *   - manifest.webmanifest 与注入预缓存清单的 sw.js（源目录有模板时）
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildIndex } from './lib/manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SW_VERSION_TOKEN = '__GLM_TOOLBOX_SW_VERSION__';
const SW_PRECACHE_TOKEN = '__GLM_TOOLBOX_SW_PRECACHE__';
const SW_REGISTER_TAG = '<script type="module" src="assets/js/sw-register.mjs"></script>';

/** 复制文件 / 目录（递归），不覆盖已存在的内容则报错 */
function copy(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copy(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/** 复制目录树，跳过匹配的名字（对每一层生效） */
function copyDirFiltered(src, dest, skip) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (skip(entry.name)) continue;
    if (entry.isDirectory()) {
      copyDirFiltered(path.join(src, entry.name), path.join(dest, entry.name), skip);
    } else {
      fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
    }
  }
}

/** 递归列出目录下全部文件（相对目录的 POSIX 路径，按字典序） */
export function listFilesRelative(dir) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else out.push(child);
    }
  };
  walk('');
  return out;
}

/** 文件内容 SHA-1（用于预缓存清单的逐文件指纹） */
function fileHash(filePath) {
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * 生成注入预缓存清单的 sw.js（源目录有 sw.js 模板时）。
 * 返回 { version, precacheUrls }；没有模板返回 null。
 */
export function generateServiceWorker(rootDir, distDir) {
  const templatePath = path.join(rootDir, 'sw.js');
  if (!fs.existsSync(templatePath)) return null;

  const template = fs.readFileSync(templatePath, 'utf8');
  if (!template.includes(SW_VERSION_TOKEN) || !template.includes(SW_PRECACHE_TOKEN)) {
    throw new Error('sw.js 模板缺少注入占位符（版本号 / 预缓存清单）');
  }

  // 预缓存 dist/ 下全部文件（sw.js 自身除外）
  const files = listFilesRelative(distDir).filter((f) => f !== 'sw.js');
  const precacheUrls = files.map((f) => `./${f}`);
  // 版本号 = 清点清单（路径 + 内容哈希）的哈希：任何文件变化即变化
  const manifestText = files
    .map((f) => `${f}:${fileHash(path.join(distDir, f))}`)
    .join('\n');
  const version = crypto.createHash('sha256').update(manifestText).digest('hex').slice(0, 16);

  const sw = template.replaceAll(SW_VERSION_TOKEN, version).replaceAll(SW_PRECACHE_TOKEN, JSON.stringify(precacheUrls));
  fs.writeFileSync(path.join(distDir, 'sw.js'), sw, 'utf8');
  return { version, precacheUrls };
}

/** 把 Service Worker 注册脚本注入 dist/index.html（已注入则跳过） */
function injectSwRegister(distDir) {
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) return;
  let html = fs.readFileSync(indexPath, 'utf8');
  if (html.includes(SW_REGISTER_TAG)) return;
  html = html.replace('</head>', `    ${SW_REGISTER_TAG}\n  </head>`);
  fs.writeFileSync(indexPath, html, 'utf8');
}

/**
 * 构建站点。返回 dist 路径。
 * @param {{ root?: string, out?: string }} options
 */
export function buildSite({ root = REPO_ROOT, out } = {}) {
  const rootDir = path.resolve(root);
  const distDir = path.resolve(out ?? path.join(rootDir, 'dist'));

  // 校验清单（有问题直接失败，而不是带着坏产物发布）
  const { index, errors } = buildIndex(path.join(rootDir, 'tools'));
  if (errors.length > 0) {
    throw new Error(`工具清单校验失败，无法构建：\n${errors.join('\n')}`);
  }

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  // 入口与静态资源
  copy(path.join(rootDir, 'index.html'), path.join(distDir, 'index.html'));
  if (fs.existsSync(path.join(rootDir, 'assets'))) {
    copy(path.join(rootDir, 'assets'), path.join(distDir, 'assets'));
  }
  if (fs.existsSync(path.join(rootDir, 'manifest.webmanifest'))) {
    copy(path.join(rootDir, 'manifest.webmanifest'), path.join(distDir, 'manifest.webmanifest'));
  }

  // 工具目录：排除测试与夹具
  const toolsSrc = path.join(rootDir, 'tools');
  if (fs.existsSync(toolsSrc)) {
    copyDirFiltered(toolsSrc, path.join(distDir, 'tools'), (name) =>
      name.endsWith('.test.mjs') || name.endsWith('.e2e.mjs') || name === 'fixtures',
    );
  }

  // 生成的索引（覆盖可能的拷贝残留）
  const indexPath = path.join(distDir, 'tools', 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');

  // PWA：预缓存全部文件的 sw.js + index.html 注册脚本（源目录有模板时）
  if (generateServiceWorker(rootDir, distDir)) {
    injectSwRegister(distDir);
  }

  return distDir;
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      out: { type: 'string' },
    },
  });
  try {
    const distDir = buildSite({ root: values.root, out: values.out });
    const fileCount = fs
      .readdirSync(distDir, { recursive: true })
      .filter((f) => fs.statSync(path.join(distDir, String(f))).isFile()).length;
    console.log(`已生成 ${distDir}（${fileCount} 个文件）`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
