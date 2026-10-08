/**
 * 工具注册表：加载 tools/index.json（由 scripts/gen-index.mjs 生成），
 * 并在进入工具页时懒加载对应模块。
 *
 * 注意：所有 URL 都相对文档解析（document.baseURI），
 * 因此站点可以部署在任意子路径（如 /glm-toolbox/）下。
 */

let toolsCache = null;

/** 加载工具索引；带缓存避免重复请求（dev 服务器对 index.json 禁用缓存） */
export async function loadIndex() {
  if (toolsCache) return toolsCache;
  const url = new URL('tools/index.json', document.baseURI);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`工具列表加载失败（HTTP ${res.status}）：${url.pathname}`);
  }
  const data = await res.json();
  toolsCache = Array.isArray(data.tools) ? data.tools : [];
  return toolsCache;
}

/** 仅用于测试 / 调试：清空索引缓存 */
export function resetIndexCache() {
  toolsCache = null;
}

/** 懒加载某个工具模块（entry 形如 "tools/<id>/index.mjs"） */
export async function importTool(entry) {
  const url = new URL(entry, document.baseURI);
  return import(url.href);
}
