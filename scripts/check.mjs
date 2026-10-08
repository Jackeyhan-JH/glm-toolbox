#!/usr/bin/env node
/**
 * check：校验所有工具的清单与目录约定（npm run check）。
 *
 * 用法：node scripts/check.mjs [--tools-dir <dir>]
 * 检查内容：
 *   1. 每个 tools/<id>/ 必须有 tool.json、index.mjs、logic.mjs、logic.test.mjs、ui.e2e.mjs；
 *   2. 清单字段齐全、类型正确，id 与目录名一致、全局唯一，category 在枚举内；
 *   3. tools 下所有 .mjs 文件中不得出现 http(s):// 的 import / import()（禁止 CDN）。
 * 有任何问题以非 0 退出，并输出中文错误与出错文件路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadTools } from './lib/manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 匹配以 http:// 或 https:// 开头的模块说明符（静态 import/export from 与动态 import()） */
const CDN_IMPORT_PATTERNS = [
  /from\s*['"]https?:\/\//, // import x from 'https://…' / export { x } from 'https://…'（含跨行写法）
  /import\s*['"]https?:\/\//, // 副作用 import 'https://…'
  /import\(\s*['"]https?:\/\//, // 动态 import('https://…')
];

/** 扫描某个 .mjs 文件中的 CDN import，返回错误信息数组 */
export function findCdnImports(file, source) {
  const errors = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (CDN_IMPORT_PATTERNS.some((re) => re.test(lines[i]))) {
      errors.push(`${file}:${i + 1} 检测到以 http(s):// 开头的模块导入（禁止 CDN）：${lines[i].trim()}`);
    }
  }
  return errors;
}

/** 完整检查；返回全部错误（空数组表示通过） */
export function runCheck({ toolsDir = path.join(REPO_ROOT, 'tools') } = {}) {
  const errors = [];

  const { tools, errors: manifestErrors } = loadTools(toolsDir);
  errors.push(...manifestErrors);

  // 扫描所有 .mjs 文件中的 CDN 引用
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'vendor') continue; // vendor 第三方库单独审查
        walk(p);
      } else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) {
        const source = fs.readFileSync(p, 'utf8');
        errors.push(...findCdnImports(p, source));
      }
    }
  };
  walk(path.resolve(toolsDir));

  if (tools.length === 0 && manifestErrors.length === 0) {
    errors.push(`未发现任何有效工具：${path.resolve(toolsDir)}`);
  }
  return errors;
}

function main() {
  const { values } = parseArgs({
    options: {
      'tools-dir': { type: 'string' },
    },
  });
  const toolsDir = values['tools-dir'] ? path.resolve(values['tools-dir']) : path.join(REPO_ROOT, 'tools');
  const errors = runCheck({ toolsDir });
  if (errors.length > 0) {
    console.error(`检查未通过（${errors.length} 个问题）：\n${errors.join('\n')}`);
    process.exit(1);
  }
  console.log(`检查通过：${toolsDir}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
