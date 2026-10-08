/**
 * 工具清单（tool.json）的读取、校验与排序。
 * gen-index / check / build / serve 共用，保证规则单一来源。
 * 校验均返回「中文错误信息 + 出错文件路径」的数组，不直接抛错。
 */

import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES } from '../../assets/js/categories.mjs';

/** 每个工具目录必须包含的文件 */
export const REQUIRED_FILES = ['tool.json', 'index.mjs', 'logic.mjs', 'logic.test.mjs', 'ui.e2e.mjs'];

export const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
export const NAME_MAX = 12;
export const DESCRIPTION_MAX = 40;

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

/** 单个字符计数（按 Unicode 码点，粗略对齐「字」的概念） */
function charCount(s) {
  return [...s].length;
}

function manifestPath(toolDir) {
  return path.join(toolDir, 'tool.json');
}

/** 只解析 JSON，不校验；失败返回 null（用于 id 查重） */
function loadManifestQuiet(toolDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath(toolDir), 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 读取并校验单个工具目录。
 * @returns {{ tool: object|null, entry: string, errors: string[] }}
 */
export function loadToolDir(toolDir) {
  const errors = [];
  const file = manifestPath(toolDir);
  const dirName = path.basename(toolDir);

  if (!fs.existsSync(file)) {
    return { tool: null, entry: null, errors: [toolDirError(dirName, `缺少清单文件 ${file}`)] };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { tool: null, entry: null, errors: [toolDirError(dirName, `清单 JSON 解析失败：${file}：${err.message}`)] };
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return { tool: null, entry: null, errors: [toolDirError(dirName, `清单必须是 JSON 对象：${file}`)] };
  }

  // id
  const id = manifest.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    errors.push(
      toolDirError(dirName, `清单字段 id 必须是匹配 ${ID_PATTERN} 的字符串，实际为 ${JSON.stringify(id)}：${file}`),
    );
  } else if (id !== dirName) {
    errors.push(toolDirError(dirName, `清单 id "${id}" 与目录名 "${dirName}" 不一致：${file}`));
  }

  // name
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    errors.push(toolDirError(dirName, `清单字段 name 必须是非空字符串：${file}`));
  } else if (charCount(manifest.name) > NAME_MAX) {
    errors.push(toolDirError(dirName, `清单字段 name 不能超过 ${NAME_MAX} 个字，当前 ${charCount(manifest.name)} 个：${file}`));
  }

  // description
  if (typeof manifest.description !== 'string' || manifest.description.trim() === '') {
    errors.push(toolDirError(dirName, `清单字段 description 必须是非空字符串：${file}`));
  } else if (charCount(manifest.description) > DESCRIPTION_MAX) {
    errors.push(
      toolDirError(dirName, `清单字段 description 不能超过 ${DESCRIPTION_MAX} 个字，当前 ${charCount(manifest.description)} 个：${file}`),
    );
  }

  // category
  if (typeof manifest.category !== 'string' || !CATEGORY_IDS.has(manifest.category)) {
    errors.push(
      toolDirError(
        dirName,
        `清单字段 category 必须是 ${[...CATEGORY_IDS].join(' / ')} 之一，实际为 ${JSON.stringify(manifest.category)}：${file}`,
      ),
    );
  }

  // keywords
  if (
    !Array.isArray(manifest.keywords) ||
    manifest.keywords.length === 0 ||
    manifest.keywords.some((k) => typeof k !== 'string' || k.trim() === '')
  ) {
    errors.push(toolDirError(dirName, `清单字段 keywords 必须是非空字符串数组：${file}`));
  }

  // order
  if (typeof manifest.order !== 'number' || !Number.isFinite(manifest.order)) {
    errors.push(toolDirError(dirName, `清单字段 order 必须是有限数字，实际为 ${JSON.stringify(manifest.order)}：${file}`));
  }

  // 必需文件
  for (const name of REQUIRED_FILES) {
    const p = path.join(toolDir, name);
    if (!fs.existsSync(p)) {
      errors.push(toolDirError(dirName, `缺少必需文件 ${p}`));
    }
  }

  return {
    tool: errors.length === 0 ? manifest : null,
    manifest, // 即使校验失败也返回解析结果，便于全局查重
    errors,
  };
}

function toolDirError(dirName, message) {
  return `工具目录 tools/${dirName}/ 校验失败：${message}`;
}

/**
 * 扫描 tools 目录，返回 { tools, errors }。
 * tools 已按「分类顺序 → order → name（码点序）」排好序。
 */
export function loadTools(toolsDir) {
  const errors = [];
  const tools = [];

  const absDir = path.resolve(toolsDir);
  if (!fs.existsSync(absDir)) {
    return { tools: [], errors: [`工具目录不存在：${absDir}`] };
  }

  const entries = fs
    .readdirSync(absDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (entries.length === 0) {
    errors.push(`工具目录为空，至少需要一个工具（tools/<id>/tool.json）：${absDir}`);
  }

  for (const name of entries) {
    const result = loadToolDir(path.join(absDir, name));
    errors.push(...result.errors);
    if (result.tool) tools.push(result.tool);
  }

  // id 全局唯一：即使某清单其他字段非法，其 id 也参与查重（否则重复会被掩盖）
  const seen = new Map();
  for (const name of entries) {
    const manifest = loadManifestQuiet(path.join(absDir, name));
    if (!manifest || typeof manifest.id !== 'string' || manifest.id === '') continue;
    const file = manifestPath(path.join(absDir, name));
    const prev = seen.get(manifest.id);
    if (prev) {
      errors.push(`工具 id 重复："${manifest.id}" 同时出现在 ${prev} 与 ${file}`);
    } else {
      seen.set(manifest.id, file);
    }
  }

  return { tools: sortTools(tools), errors };
}

const CATEGORY_ORDER = new Map(CATEGORIES.map((c) => [c.id, c.order]));

/** 排序：分类顺序 → order（升序）→ name（码点序，保证跨机器确定性） */
export function sortTools(tools) {
  return [...tools].sort((a, b) => {
    const ca = CATEGORY_ORDER.get(a.category) ?? Number.MAX_SAFE_INTEGER;
    const cb = CATEGORY_ORDER.get(b.category) ?? Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;
    if (a.order !== b.order) return a.order - b.order;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/**
 * 生成索引对象：{"tools":[{...清单字段, "entry":"tools/<id>/index.mjs"}]}
 * 输出只依赖输入，可重复（无时间戳、无绝对路径）。
 */
export function buildIndex(toolsDir) {
  const { tools, errors } = loadTools(toolsDir);
  if (errors.length > 0) {
    return { index: null, errors };
  }
  return {
    index: {
      tools: tools.map((tool) => ({
        ...tool,
        entry: `tools/${tool.id}/index.mjs`,
      })),
    },
    errors: [],
  };
}
