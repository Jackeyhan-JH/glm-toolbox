/**
 * 字数统计 —— 工具入口（外壳在进入 #/word-count 时动态加载本模块）。
 *
 * 本目录是所有工具的样板，约定如下（详见仓库 CONTRIBUTING.md）：
 *   tool.json       清单（id / name / category / keywords / order）
 *   logic.mjs       纯逻辑，不碰 DOM，供 node --test 直接测试
 *   logic.test.mjs  单元测试
 *   index.mjs       UI 挂载（本文件），导出 mount(root, ctx)
 *   ui.e2e.mjs      Playwright 端到端测试
 *   style.css       工具私有样式（经 ctx.loadStyle 加载，切换工具时外壳自动移除）
 *
 * mount(root, ctx) 协议：
 *   root  外壳提供的空容器（HTMLElement）
 *   ctx   { tool, storage, loadStyle, theme, onThemeChange }
 *   返回值 可选的清理函数：离开本工具时由外壳调用（取消定时器 / 事件等）
 */

import { el, copyButton, debounce } from '../../assets/js/ui.mjs';
import { analyze, formatStats, STAT_ITEMS } from './logic.mjs';

const STORAGE_KEY_TEXT = 'text'; // 实际存储键为 glm-toolbox:word-count:text
const SAVE_DEBOUNCE_MS = 150;

export async function mount(root, ctx) {
  ctx.loadStyle('tools/word-count/style.css');

  /* ---------- 构建 DOM ---------- */

  const valueById = {}; // 每个 stat 的取值元素
  const statsList = el(
    'dl',
    { class: 'stat-grid', 'data-testid': 'word-count-stats' },
    STAT_ITEMS.map(({ key, label }) => {
      const value = el('dd', { 'data-testid': `word-count-${key}` }, '0');
      valueById[key] = value;
      return el('div', { class: 'stat' }, el('dt', {}, label), value);
    }),
  );

  const textarea = el('textarea', {
    id: 'word-count-input',
    'data-testid': 'word-count-input',
    'aria-label': '要统计的文本',
    placeholder: '输入或粘贴文本，统计结果实时更新…',
    spellcheck: 'false',
  });

  root.append(
    el(
      'section',
      { class: 'tool word-count' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el(
          'div',
          { class: 'tool-actions' },
          copyButton(() => formatStats(analyze(textarea.value)), { label: '复制统计结果' }),
        ),
      ),
      el(
        'div',
        { class: 'word-count-layout two-col' },
        el(
          'div',
          { class: 'word-count-editor' },
          el('label', { class: 'field-label', for: 'word-count-input' }, '文本'),
          textarea,
          el('p', { class: 'field-hint' }, '内容只保存在本地浏览器中，不会上传。'),
        ),
        el(
          'div',
          { class: 'word-count-stats' },
          el('div', { class: 'field-label' }, '统计结果'),
          statsList,
        ),
      ),
    ),
  );

  /* ---------- 交互 ---------- */

  const refresh = debounce(() => {
    const stats = analyze(textarea.value);
    for (const { key } of STAT_ITEMS) valueById[key].textContent = String(stats[key]);
    ctx.storage.set(STORAGE_KEY_TEXT, textarea.value); // 记住上次输入
  }, SAVE_DEBOUNCE_MS);

  textarea.addEventListener('input', refresh);

  // 恢复上次输入并立即统计一次
  const saved = ctx.storage.get(STORAGE_KEY_TEXT, '');
  if (typeof saved === 'string' && saved !== '') {
    textarea.value = saved;
  }
  refresh();

  /* ---------- 清理函数（离开工具时由外壳调用） ---------- */

  return () => {
    refresh.cancel();
  };
}
