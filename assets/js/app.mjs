/**
 * 应用外壳启动：装配主题、侧边栏（搜索 + 分类列表）、hash 路由与主区域渲染。
 * 工具模块通过 mount(root, ctx) 挂载；协议见 issue #1 / CONTRIBUTING.md。
 */

import { CATEGORIES } from './categories.mjs';
import { initRouter, toolHref } from './router.mjs';
import { loadIndex, importTool } from './registry.mjs';
import { initTheme, currentTheme, toggleTheme, onThemeChange } from './theme.mjs';
import { el } from './ui.mjs';

const SITE_NAME = '码工具箱';
const HOME_TITLE = `${SITE_NAME} - 离线开发者工具`;

/* ---------- DOM 引用 ---------- */

const sidebar = document.getElementById('sidebar');
const navList = document.getElementById('tool-nav');
const searchInput = document.getElementById('search-input');
const content = document.getElementById('content');
const menuBtn = document.getElementById('menu-btn');
const themeBtn = document.getElementById('theme-btn');
const themeBtnIcon = document.getElementById('theme-btn-icon');
const topbarTitle = document.getElementById('topbar-title');

/* ---------- 全局状态 ---------- */

let tools = []; // tools/index.json 中的数组
let currentCleanup = null; // 当前工具返回的清理函数
let routeSeq = 0; // 防止快速切换时旧路由的异步结果覆盖新页面

/* ==================== 主题 ==================== */

function renderThemeIcon() {
  themeBtnIcon.textContent = currentTheme() === 'dark' ? '☀️' : '🌙';
}

initTheme();
renderThemeIcon();
themeBtn.addEventListener('click', () => {
  toggleTheme();
  renderThemeIcon();
});

/* ==================== 侧边栏 ==================== */

/** name / description / keywords 不区分大小写的子串匹配 */
function matchesQuery(tool, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [tool.name, tool.description, ...(tool.keywords ?? [])]
    .filter((s) => typeof s === 'string')
    .join('\n')
    .toLowerCase();
  return haystack.includes(q);
}

function renderNav(query = '') {
  const visible = tools.filter((t) => matchesQuery(t, query));
  navList.replaceChildren();

  if (visible.length === 0) {
    navList.appendChild(el('p', { class: 'nav-empty' }, '没有匹配的工具'));
    return;
  }

  for (const category of CATEGORIES) {
    const items = visible.filter((t) => t.category === category.id);
    if (items.length === 0) continue;
    const group = el(
      'div',
      { class: 'nav-group', 'data-category': category.id },
      el('div', { class: 'nav-group-title' }, category.name),
    );
    for (const tool of items) {
      const link = el(
        'a',
        { class: 'nav-item', href: toolHref(tool.id), 'data-tool-id': tool.id },
        el('span', {}, tool.name),
      );
      group.appendChild(link);
    }
    navList.appendChild(group);
  }
}

function setActiveNav(id) {
  for (const link of navList.querySelectorAll('.nav-item')) {
    if (link.dataset.toolId === id) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
}

/* 搜索：实时过滤；回车打开第一个结果；Esc 清空 */
searchInput.addEventListener('input', () => renderNav(searchInput.value));
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const first = navList.querySelector('.nav-item');
    if (first) {
      location.hash = first.getAttribute('href');
      searchInput.blur();
    }
  } else if (event.key === 'Escape') {
    searchInput.value = '';
    renderNav('');
  }
});

/* 在非输入控件中按 / 聚焦搜索框 */
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  const active = document.activeElement;
  const tag = active?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) {
    return;
  }
  event.preventDefault();
  searchInput.focus();
  searchInput.select();
});

/* 移动端菜单抽屉 */
let backdrop = null;

function closeSidebar() {
  sidebar.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');
  backdrop?.remove();
  backdrop = null;
}

menuBtn.addEventListener('click', () => {
  const open = !sidebar.classList.contains('open');
  if (open) {
    sidebar.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
    backdrop = el('button', {
      class: 'sidebar-backdrop',
      'aria-label': '关闭菜单',
      onClick: closeSidebar,
    });
    document.body.appendChild(backdrop);
  } else {
    closeSidebar();
  }
});

sidebar.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeSidebar();
});

/* ==================== 工具模块协议 ctx ==================== */

function makeCtx(tool) {
  return {
    /** 本工具的清单（tool.json 内容） */
    tool,

    /** 命名空间化的本地存储：实际键为 glm-toolbox:<id>:<key> */
    storage: {
      get(key, fallback = null) {
        try {
          const raw = localStorage.getItem(storageKey(tool.id, key));
          return raw === null ? fallback : JSON.parse(raw);
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          localStorage.setItem(storageKey(tool.id, key), JSON.stringify(value ?? null));
        } catch {
          // 存储不可用（隐私模式 / 已满）时静默失败
        }
      },
      remove(key) {
        try {
          localStorage.removeItem(storageKey(tool.id, key));
        } catch {
          /* 同上 */
        }
      },
    },

    /**
     * 加载工具私有样式表（相对站点根的路径，如 "tools/<id>/style.css"），
     * 切换工具时由外壳自动移除。
     */
    loadStyle(url) {
      const href = new URL(url, document.baseURI).href;
      const link = el('link', {
        rel: 'stylesheet',
        href,
        'data-tool-style': tool.id,
      });
      document.head.appendChild(link);
    },

    /** 当前主题（动态读取） */
    get theme() {
      return currentTheme();
    },

    /** 订阅主题变更；返回取消订阅函数 */
    onThemeChange(fn) {
      return onThemeChange(fn);
    },
  };
}

function storageKey(toolId, key) {
  return `glm-toolbox:${toolId}:${key}`;
}

/** 移除某工具注入的所有私有样式 */
function removeToolStyles(toolId) {
  for (const link of document.head.querySelectorAll(`link[data-tool-style="${toolId}"]`)) {
    link.remove();
  }
}

/* ==================== 页面渲染 ==================== */

function renderHome() {
  document.title = HOME_TITLE;
  topbarTitle.textContent = SITE_NAME;
  setActiveNav(null);

  const home = el(
    'div',
    { class: 'home' },
    el(
      'div',
      { class: 'home-hero' },
      el('h1', {}, '离线开发者工具箱'),
      el('p', {}, '全部在浏览器本地运行，不上传任何数据。'),
    ),
  );

  for (const category of CATEGORIES) {
    const items = tools.filter((t) => t.category === category.id);
    if (items.length === 0) continue;
    home.appendChild(
      el(
        'section',
        { class: 'home-section' },
        el('h2', {}, category.name),
        el(
          'div',
          { class: 'card-grid' },
          items.map((tool) =>
            el(
              'a',
              { class: 'card', href: toolHref(tool.id) },
              el('div', { class: 'card-name' }, tool.name),
              el('div', { class: 'card-desc' }, tool.description ?? ''),
            ),
          ),
        ),
      ),
    );
  }

  content.replaceChildren(home);
}

function renderNotFound(id) {
  document.title = `找不到工具 - ${SITE_NAME}`;
  topbarTitle.textContent = SITE_NAME;
  setActiveNav(null);
  content.replaceChildren(
    el(
      'div',
      { class: 'state-page' },
      el('h2', {}, `找不到工具「${id}」`),
      el('p', { class: 'state-detail' }, '它可能尚未发布，或地址有误。'),
      el('a', { class: 'btn btn-primary', href: '#/' }, '返回首页'),
    ),
  );
}

function renderToolError(id, err) {
  document.title = `工具加载失败 - ${SITE_NAME}`;
  const detail = err instanceof Error ? err.message : String(err);
  content.replaceChildren(
    el(
      'div',
      { class: 'state-page', role: 'alert' },
      el('h2', {}, '工具加载失败'),
      el('p', { class: 'state-detail' }, `工具「${id}」加载或初始化时出错，其他工具不受影响。`),
      el('pre', {}, detail),
      el('a', { class: 'btn btn-primary', href: '#/' }, '返回首页'),
    ),
  );
}

async function mountTool(tool) {
  const seq = routeSeq;
  document.title = `${tool.name} - ${SITE_NAME}`;
  topbarTitle.textContent = tool.name;
  setActiveNav(tool.id);

  const mod = await importTool(tool.entry);
  if (seq !== routeSeq) return; // 等待期间已切换到其他页面

  const ctx = makeCtx(tool);
  const maybeCleanup = await mod.mount(content, ctx);
  if (seq !== routeSeq) {
    // 竞争失败：立即清理刚挂载的工具，不展示
    if (typeof maybeCleanup === 'function') {
      try {
        maybeCleanup();
      } catch {
        /* 清理失败不影响后续 */
      }
    }
    removeToolStyles(tool.id);
    return;
  }

  currentCleanup = typeof maybeCleanup === 'function' ? maybeCleanup : null;
  content.dataset.toolReady = tool.id; // openTool(page, id) 依赖此属性
}

/* ==================== 路由分发 ==================== */

async function onRoute(id) {
  routeSeq += 1;

  // 卸载上一个工具：先调用清理函数，再移除私有样式并清空容器
  if (currentCleanup) {
    try {
      currentCleanup();
    } catch (err) {
      console.warn('工具清理函数执行出错：', err);
    }
    currentCleanup = null;
  }
  for (const link of document.head.querySelectorAll('link[data-tool-style]')) link.remove();
  delete content.dataset.toolReady;
  content.replaceChildren();

  if (!id) {
    renderHome();
    return;
  }
  const tool = tools.find((t) => t.id === id);
  if (!tool) {
    renderNotFound(id);
    return;
  }

  try {
    await mountTool(tool);
  } catch (err) {
    console.error(`工具「${id}」加载失败：`, err);
    renderToolError(id, err);
  }
}

/* ==================== 启动 ==================== */

(async () => {
  try {
    tools = await loadIndex();
  } catch (err) {
    navList.replaceChildren(
      el('p', { class: 'nav-empty' }, `工具列表加载失败：${err instanceof Error ? err.message : err}`),
    );
    content.replaceChildren(
      el(
        'div',
        { class: 'state-page', role: 'alert' },
        el('h2', {}, '工具列表加载失败'),
        el('p', { class: 'state-detail' }, String(err instanceof Error ? err.message : err)),
      ),
    );
    return;
  }

  renderNav('');
  initRouter(onRoute);
})();
