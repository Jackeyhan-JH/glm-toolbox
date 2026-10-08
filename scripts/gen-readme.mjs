#!/usr/bin/env node
/**
 * gen-readme：从各 tools/<id>/tool.json（与 tools/index.json 同源）生成 README 的
 * 工具清单表，写入 README.md 中 <!-- tools:start --> 与 <!-- tools:end --> 之间。
 *
 * 用法：
 *   node scripts/gen-readme.mjs          生成并写回 README.md
 *   node scripts/gen-readme.mjs --check  只校验 README 是否最新（过期时非 0 退出，CI 使用）
 *
 * 数据来自 scripts/lib/manifest.mjs 的 buildIndex（与 tools/index.json 完全同源、
 * 字节一致），因此 CI 里无需先生成 index.json。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildIndex } from './lib/manifest.mjs';
import { CATEGORIES } from '../assets/js/categories.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const SITE_URL = 'https://jackeyhan-jh.github.io/glm-toolbox/';

const START_MARKER = '<!-- tools:start -->';
const END_MARKER = '<!-- tools:end -->';

const CATEGORY_NAME = new Map(CATEGORIES.map((c) => [c.id, c.name]));

/** 生成工具清单表（Markdown） */
export function generateToolsTable(toolsDir = path.join(REPO_ROOT, 'tools')) {
  const { index, errors } = buildIndex(toolsDir);
  if (errors.length > 0) {
    throw new Error(`工具清单校验失败：\n${errors.join('\n')}`);
  }

  const lines = ['| 分类 | 工具 | 说明 |', '| --- | --- | --- |'];
  for (const tool of index.tools) {
    const category = CATEGORY_NAME.get(tool.category) ?? tool.category;
    const link = `[${tool.name}](${SITE_URL}#/${tool.id})`;
    const desc = String(tool.description ?? '').replaceAll('|', '\\|');
    lines.push(`| ${category} | ${link} | ${desc} |`);
  }
  return lines.join('\n');
}

/** 把清单表替换进 README 内容的标记区间（纯函数） */
export function renderReadme(source, table) {
  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README 缺少 ${START_MARKER} / ${END_MARKER} 标记区间`);
  }
  return source.slice(0, start + START_MARKER.length) + '\n' + table + '\n' + source.slice(end);
}

/** 生成清单表并写回 README（内容未变化时不写）；返回最新内容 */
export function updateReadme({ readmePath = README_PATH, toolsDir } = {}) {
  const table = generateToolsTable(toolsDir);
  const source = fs.readFileSync(readmePath, 'utf8');
  const updated = renderReadme(source, table);
  if (updated !== source) {
    fs.writeFileSync(readmePath, updated, 'utf8');
  }
  return updated;
}

function main() {
  const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
  try {
    if (values.check) {
      const current = fs.readFileSync(README_PATH, 'utf8');
      const expected = renderReadme(current, generateToolsTable());
      if (current !== expected) {
        console.error('README 的工具清单不是最新：请运行 node scripts/gen-readme.mjs 后提交。');
        process.exit(1);
      }
      console.log('README 工具清单已是最新。');
    } else {
      updateReadme();
      console.log(`已更新 ${README_PATH} 的工具清单表。`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
