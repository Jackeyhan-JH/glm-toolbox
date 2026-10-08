/** 脚本单测的公共辅助：临时目录、构造工具目录、运行 CLI。仅测试使用。 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..');

/** 创建带 tools/ 子目录的临时根 */
export function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-toolbox-test-'));
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  return root;
}

export function removeTempRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * 在 root/tools/<id>/ 写一个（默认合法的）工具目录。
 * @param {string} root 临时根
 * @param {string} id 目录名
 * @param {object} manifestOverrides 覆盖清单字段（含非法值用于报错用例）
 * @param {{ rawManifest?: string, files?: Record<string, string> }} options
 */
export function writeTool(root, id, manifestOverrides = {}, options = {}) {
  const dir = path.join(root, 'tools', id);
  fs.mkdirSync(dir, { recursive: true });
  if (options.rawManifest !== undefined) {
    fs.writeFileSync(path.join(dir, 'tool.json'), options.rawManifest, 'utf8');
  } else {
    const manifest = {
      id,
      name: `工具${id}`,
      description: '测试用工具',
      category: 'text',
      keywords: ['test', id],
      order: 10,
      ...manifestOverrides,
    };
    fs.writeFileSync(path.join(dir, 'tool.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }
  const files = options.files ?? {};
  for (const required of ['index.mjs', 'logic.mjs', 'logic.test.mjs', 'ui.e2e.mjs']) {
    if (files[required] === null) continue; // null 表示刻意不写（缺文件用例）
    fs.writeFileSync(path.join(dir, required), files[required] ?? `// ${required}\n`, 'utf8');
  }
  for (const [name, content] of Object.entries(files)) {
    if (name === null || content === null) continue;
    if (['index.mjs', 'logic.mjs', 'logic.test.mjs', 'ui.e2e.mjs'].includes(name)) continue;
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

/** 运行某个 CLI 脚本，返回 { status, stdout, stderr } */
export function runCli(script, args) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, script), ...args], {
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** 递归收集目录下所有文件的相对路径 */
export function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}
