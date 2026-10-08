/**
 * hash 路由：`#/` 或空 hash → 首页；`#/<工具id>` → 对应工具。
 * 只负责解析与分发，页面渲染由 app.mjs 完成。
 */

/** 从 location.hash 解析工具 id；首页返回 null */
export function parseHash(hash) {
  const raw = hash.replace(/^#/, '');
  if (!raw || raw === '/') return null;
  const id = decodeURIComponent(raw.replace(/^\/+/, ''));
  return id;
}

/** 生成某个工具的 hash 路径 */
export function toolHref(id) {
  return `#/${id}`;
}

/**
 * 启动路由监听。onRoute(id) 在首次加载与每次 hash 变化（含前进 / 后退）时被调用。
 */
export function initRouter(onRoute) {
  const dispatch = () => onRoute(parseHash(location.hash));
  window.addEventListener('hashchange', dispatch);
  dispatch();
}
