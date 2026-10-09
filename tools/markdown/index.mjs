/**
 * Markdown 预览 —— 工具入口（外壳在进入 #/markdown 时动态加载本模块）。
 *
 * 布局：工具栏（格式化按钮 + 视图切换 + 外部图片开关）+ 左编辑右预览 +
 * 状态栏（字数 / 渲染耗时）。输入防抖 150ms 实时渲染（约定 ≤ 200ms），
 * 滚动按比例双向同步，内容与视图模式经 ctx.storage 持久化
 * （「允许加载外部图片」按规格默认关闭且不持久化）。
 *
 * 渲染 / 净化 / 导出全部在 ./logic.mjs 的纯函数中完成，本文件只负责 DOM。
 */

import { copyButton, debounce, downloadBlob, el } from '../../assets/js/ui.mjs';
import {
  SAMPLE_DOC,
  TABLE_SNIPPET,
  buildStandaloneHtml,
  countText,
  insertAtCursor,
  renderMarkdown,
  toggleLinePrefix,
  wrapSelection,
} from './logic.mjs';

const RENDER_DEBOUNCE_MS = 150; // 输入 → 预览的防抖（issue 约定 ≤ 200ms）
const STORAGE_TEXT = 'text';
const STORAGE_SEEDED = 'seeded';
const STORAGE_VIEW = 'view';

const VIEWS = [
  { value: 'split', label: '左右' },
  { value: 'edit', label: '仅编辑' },
  { value: 'preview', label: '仅预览' },
];

/** 工具栏：apply(text, start, end) → { text, start, end } */
const TOOLBAR_ACTIONS = [
  { key: 'bold', label: '加粗', title: '加粗（包裹选中文字）', apply: (t, s, e) => wrapSelection(t, s, e, '**', '**') },
  { key: 'italic', label: '斜体', title: '斜体', apply: (t, s, e) => wrapSelection(t, s, e, '*', '*') },
  { key: 'strike', label: '删除线', title: '删除线', apply: (t, s, e) => wrapSelection(t, s, e, '~~', '~~') },
  { key: 'code', label: '行内代码', title: '行内代码', apply: (t, s, e) => wrapSelection(t, s, e, '`', '`') },
  { key: 'heading', label: '标题', title: '标题（切换二级标题前缀）', apply: (t, s, e) => toggleLinePrefix(t, s, e, '## ') },
  { key: 'quote', label: '引用', title: '引用', apply: (t, s, e) => toggleLinePrefix(t, s, e, '> ') },
  { key: 'ul', label: '无序列表', title: '无序列表', apply: (t, s, e) => toggleLinePrefix(t, s, e, '- ') },
  { key: 'ol', label: '有序列表', title: '有序列表', apply: (t, s, e) => toggleLinePrefix(t, s, e, '1. ') },
  {
    key: 'link',
    label: '链接',
    title: '链接',
    apply: (t, s, e) => wrapSelection(t, s, e, '[', '](https://example.com)', { placeholder: '链接文字' }),
  },
  { key: 'table', label: '表格', title: '插入表格模板', apply: (t, s, e) => insertAtCursor(t, s, e, `\n${TABLE_SNIPPET}\n`) },
];

export async function mount(root, ctx) {
  ctx.loadStyle('tools/markdown/style.css');

  /* ---------- 状态（视图模式持久化；外部图片开关不持久化） ---------- */

  const savedView = ctx.storage.get(STORAGE_VIEW, 'split');
  let view = VIEWS.some((v) => v.value === savedView) ? savedView : 'split';
  let allowExternalImages = false;
  let renderCount = 0;

  /* ---------- DOM ---------- */

  const textarea = el('textarea', {
    id: 'markdown-input',
    'data-testid': 'markdown-input',
    'aria-label': 'Markdown 输入',
    placeholder: '输入 Markdown，右侧实时预览…',
    spellcheck: 'false',
  });

  const preview = el('div', {
    class: 'md-preview',
    'data-testid': 'markdown-preview',
    role: 'region',
    'aria-label': '预览区',
  });

  const viewButtons = new Map();
  const viewSeg = el(
    'span',
    { class: 'seg', role: 'group', 'aria-label': '布局', 'data-testid': 'markdown-view' },
    VIEWS.map(({ value, label }) => {
      const btn = el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(value === view),
          'data-testid': `markdown-view-${value}`,
          onClick: () => {
            view = value;
            ctx.storage.set(STORAGE_VIEW, view);
            for (const [v, node] of viewButtons) node.setAttribute('aria-pressed', String(v === view));
            layout.dataset.view = view;
          },
        },
        label,
      );
      viewButtons.set(value, btn);
      return btn;
    }),
  );

  const externalImagesBox = el('input', {
    type: 'checkbox',
    'data-testid': 'markdown-external-images',
    checked: false,
    onChange: () => {
      allowExternalImages = externalImagesBox.checked;
      render(); // 立即重渲染（不等待防抖）
    },
  });

  const toolbar = el(
    'div',
    { class: 'md-toolbar', role: 'toolbar', 'aria-label': '格式化工具栏' },
    TOOLBAR_ACTIONS.map(({ key, label, title, apply }) =>
      el('button', {
        type: 'button',
        class: 'btn btn-sm',
        title,
        'data-testid': `markdown-btn-${key}`,
        onClick: () => applyEdit(apply(textarea.value, textarea.selectionStart, textarea.selectionEnd)),
      }, label),
    ),
    el('span', { class: 'md-toolbar-sep', 'aria-hidden': 'true' }),
    viewSeg,
    el('label', { class: 'md-opt', title: '默认拦截外部图片以保护隐私；开启后仍仅限 http(s) 图片' }, externalImagesBox, el('span', {}, '允许加载外部图片')),
  );

  const stats = el(
    'span',
    { class: 'md-stats', 'data-testid': 'markdown-stats' },
    '0 字 · 0 行',
  );

  const layout = el(
    'div',
    { class: 'md-layout', 'data-view': view, 'data-testid': 'markdown-layout' },
    el(
      'div',
      { class: 'md-pane md-edit-pane' },
      el('label', { class: 'field-label', for: 'markdown-input' }, '编辑'),
      textarea,
    ),
    el(
      'div',
      { class: 'md-pane md-preview-pane' },
      el('div', { class: 'field-label' }, '预览'),
      preview,
    ),
  );

  root.append(
    el(
      'section',
      { class: 'tool markdown' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el(
          'div',
          { class: 'tool-actions' },
          copyButton(() => renderMarkdown(textarea.value, { allowExternalImages }), { label: '复制 HTML' }),
          el('button', { type: 'button', class: 'btn', 'data-testid': 'markdown-download-md', onClick: downloadMarkdown }, '下载 .md'),
          el('button', { type: 'button', class: 'btn btn-primary', 'data-testid': 'markdown-download-html', onClick: downloadHtml }, '下载 .html'),
        ),
      ),
      toolbar,
      layout,
      el('p', { class: 'field-hint md-status' }, stats, el('span', { 'data-testid': 'markdown-render-ms' }, '')),
    ),
  );

  /* ---------- 渲染 ---------- */

  function render() {
    const started = performance.now();
    const html = renderMarkdown(textarea.value, { allowExternalImages });
    const elapsed = performance.now() - started;
    preview.innerHTML = html;
    // GFM 任务列表复选框没有文字标签，补上可访问名称（勾选状态即语义）
    for (const box of preview.querySelectorAll('input[type="checkbox"]')) {
      box.setAttribute('aria-label', box.checked ? '已完成的任务项' : '未完成的任务项');
    }
    renderCount += 1;
    preview.dataset.renderCount = String(renderCount);
    preview.dataset.renderMs = elapsed >= 0.1 ? String(Math.round(elapsed * 10) / 10) : '0';
    const { chars, lines } = countText(textarea.value);
    stats.textContent = `${chars} 字 · ${lines} 行`;
    ctx.storage.set(STORAGE_TEXT, textarea.value);
  }

  const scheduleRender = debounce(render, RENDER_DEBOUNCE_MS);
  textarea.addEventListener('input', scheduleRender);

  /* ---------- 工具栏应用编辑结果 ---------- */

  function applyEdit(result) {
    textarea.value = result.text;
    textarea.focus();
    textarea.setSelectionRange(result.start, result.end);
    render(); // 工具栏操作立即渲染
  }

  /* ---------- 导出 ---------- */

  function downloadMarkdown() {
    downloadBlob(new Blob([textarea.value], { type: 'text/markdown;charset=utf-8' }), 'markdown.md');
  }

  function downloadHtml() {
    const body = renderMarkdown(textarea.value, { allowExternalImages });
    const doc = buildStandaloneHtml('Markdown 导出', body);
    downloadBlob(new Blob([doc], { type: 'text/html;charset=utf-8' }), 'markdown.html');
  }

  /* ---------- 滚动同步（按比例，双向，防回环） ---------- */

  let syncingScroll = false;

  function syncScroll(from, to) {
    const fromMax = from.scrollHeight - from.clientHeight;
    const toMax = to.scrollHeight - to.clientHeight;
    if (fromMax <= 0 || toMax <= 0) return;
    to.scrollTop = (from.scrollTop / fromMax) * toMax;
  }

  textarea.addEventListener('scroll', () => {
    if (syncingScroll) return;
    syncingScroll = true;
    syncScroll(textarea, preview);
    requestAnimationFrame(() => {
      syncingScroll = false;
    });
  });
  preview.addEventListener('scroll', () => {
    if (syncingScroll) return;
    syncingScroll = true;
    syncScroll(preview, textarea);
    requestAnimationFrame(() => {
      syncingScroll = false;
    });
  });

  /* ---------- 初始化：恢复内容；首次打开显示示例文档 ---------- */

  const seeded = ctx.storage.get(STORAGE_SEEDED, false);
  if (seeded) {
    const saved = ctx.storage.get(STORAGE_TEXT, '');
    textarea.value = typeof saved === 'string' ? saved : '';
  } else {
    textarea.value = SAMPLE_DOC;
    ctx.storage.set(STORAGE_SEEDED, true);
    ctx.storage.set(STORAGE_TEXT, SAMPLE_DOC);
  }
  render();

  /* ---------- 清理函数 ---------- */

  return () => {
    scheduleRender.cancel();
  };
}
