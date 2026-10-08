#!/usr/bin/env node
/**
 * gen-index：扫描各 tools/<id>/tool.json → 校验 → 排序 → 生成 tools/index.json。
 *
 * 用法：node scripts/gen-index.mjs [--tools-dir <dir>] [--out <file>]
 * 输出格式：{"tools":[{...清单字段, "entry":"tools/<id>/index.mjs"}]}
 * 输出内容确定（无时间戳），相同输入得到字节完全一致的结果。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildIndex } from './lib/manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 生成并写出索引；成功返回写入路径，失败抛出带全部错误的 Error */
export function generate({ toolsDir = path.join(REPO_ROOT, 'tools'), out } = {}) {
  const { index, errors } = buildIndex(toolsDir);
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  const outFile = path.resolve(out ?? path.join(toolsDir, 'index.json'));
  const json = JSON.stringify(index, null, 2) + '\n';
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, json, 'utf8');
  return outFile;
}

function main() {
  const { values } = parseArgs({
    options: {
      'tools-dir': { type: 'string' },
      out: { type: 'string' },
    },
  });
  try {
    const toolsDir = values['tools-dir'] ? path.resolve(values['tools-dir']) : path.join(REPO_ROOT, 'tools');
    const outFile = generate({ toolsDir, out: values.out });
    console.log(`已生成 ${outFile}`);
  } catch (err) {
    console.error(`生成 tools/index.json 失败：\n${err.message}`);
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
