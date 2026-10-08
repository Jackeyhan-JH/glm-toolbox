/**
 * 主题管理：浅色 / 深色。
 * - 默认跟随系统 prefers-color-scheme；
 * - 手动切换后写入 localStorage（键 glm-toolbox:theme），刷新保持；
 * - 通过 onThemeChange 订阅变更（ctx.onThemeChange 即由此实现）。
 */

export const THEME_STORAGE_KEY = 'glm-toolbox:theme';

const listeners = new Set();
let current = 'light';
let initialized = false;

function readStored() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null; // 隐私模式等场景下 localStorage 可能不可用
  }
}

function systemTheme() {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
}

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn(current);
    } catch (err) {
      console.error('onThemeChange 回调执行出错：', err);
    }
  }
}

/** 初始化主题（app.mjs 启动时调用一次；index.html 的内联脚本已先行设置避免闪烁） */
export function initTheme() {
  if (initialized) return current;
  initialized = true;
  current = readStored() ?? systemTheme();
  apply(current);
  // 用户未手动选择时，跟随系统变化
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (readStored()) return;
    current = e.matches ? 'dark' : 'light';
    apply(current);
    notify();
  });
  return current;
}

/** 当前主题：'light' | 'dark' */
export function currentTheme() {
  return current;
}

/** 设置主题并持久化 */
export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  current = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 忽略存储失败（本次会话内仍生效）
  }
  apply(theme);
  notify();
}

/** 在浅色 / 深色之间切换 */
export function toggleTheme() {
  setTheme(current === 'dark' ? 'light' : 'dark');
}

/**
 * 订阅主题变更，返回取消订阅函数。
 * 订阅会立即以当前主题回调一次，方便工具初始化样式。
 */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
