#!/usr/bin/env node
/**
 * build：生成发布产物 dist/（npm run build，由 pages.yml 调用）。
 *
 * dist/ 只包含：
 *   - index.html
 *   - assets/（全量）
 *   - tools/（去掉 *.test.mjs、*.e2e.mjs、fixtures/）
 *   - 生成的 tools/index.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildIndex } from './lib/manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
