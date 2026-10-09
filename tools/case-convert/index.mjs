/**
 * 命名风格转换 —— 工具入口（外壳在进入 #/case-convert 时动态加载本模块）。
 *
 * 输入区：多行文本（每行独立转换，空行保留），下方给出分词预览；
 * 结果区：12 种命名 / 大小写风格 + 全角 → 半角、半角 → 全角共 14 行，
 * 每行可单独复制（复制的是该风格的多行完整结果）。
 *
 * 输入变化后防抖 250ms 自动更新；输入内容经 ctx.storage 本地记忆。
 * 所有纯逻辑在 ./logic.mjs；公共组件来自 assets/js/ui.mjs。
 */

import { copyButton, debounce, el } from '../../assets/js/ui.mjs';
import { ALL_STYLES, convertAll, tokenPreview } from './logic.mjs';

const DEBOUNCE_MS = 250; // 输入自动更新的防抖（约定 ≤ 300ms）

export async function mount(root, ctx) {
  ctx.loadStyle('tools/case-convert/style.css');

  let results = {}; // 最近一次转换结果（风格id → 多行文本）

  /* ---------- DOM：输入区 ---------- */

  const input = el('textarea', {
    id: 'case-convert-input',
    'data-testid': 'case-convert-input',
    'aria-label': '输入文本',
    placeholder: '输入或粘贴多行文本，例如：\nXMLHttpRequest\nuser_id-v2 name',
    spellcheck: 'false',
    rows: 6,
  });

  const tokens = el('code', {
    class: 'case-tokens-value',
    'data-testid': 'case-convert-tokens',
    // 无 aria-label：紧跟可见的「分词：」文字，code 的 role 不允许命名
  });

  const clearBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'data-testid': 'case-convert-clear',
      onClick: () => {
        input.value = '';
        update(true);
        input.focus();
      },
    },
    '清空',
  );

  /* ---------- DOM：结果区 ---------- */

  const valueEls = new Map(); // 风格id → <code>

  const rows = ALL_STYLES.map((style) => {
    const value = el('code', { class: 'case-value', 'data-testid': `case-convert-result-${style.id}` });
    valueEls.set(style.id, value);
    const copyBtn = copyButton(() => results[style.id] ?? '', { label: '复制' });
    copyBtn.setAttribute('aria-label', `复制 ${style.label}`);
    copyBtn.setAttribute('data-testid', `case-convert-copy-${style.id}`);
    return el(
      'div',
      { class: 'case-row', 'data-testid': `case-convert-row-${style.id}` },
      el('span', { class: 'case-name' }, style.label),
      value,
      copyBtn,
    );
  });

  root.append(
    el(
      'section',
      { class: 'tool case-convert' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el('div', { class: 'tool-actions' }, clearBtn),
      ),
      el(
        'div',
        { class: 'case-input-block' },
        el('label', { class: 'field-label', for: 'case-convert-input' }, '输入文本'),
        input,
        el(
          'p',
          { class: 'field-hint' },
          '每行独立转换，空行保留。以空白、_ - . / 分隔，自动识别驼峰与连续大写缩写，数字随前一个词，中文等非拉丁字符原样保留。',
        ),
        el('p', { class: 'case-tokens-row' }, '分词：', tokens),
      ),
      el(
        'section',
        { class: 'case-results' },
        el('h2', { class: 'case-results-title' }, '转换结果'),
        el('p', { class: 'field-hint' }, '内容只在本地浏览器处理，不会上传。'),
        ...rows,
      ),
    ),
  );

  /* ---------- 计算 / 渲染 ---------- */

  /** 立即重算并渲染；persist 为 true 时把输入写入本地存储 */
  function update(persist) {
    const text = input.value;
    results = convertAll(text);
    for (const { id } of ALL_STYLES) {
      const node = valueEls.get(id);
      node.textContent = results[id];
      node.classList.toggle('is-empty', results[id] === '');
    }
    tokens.textContent = tokenPreview(text);
    if (persist) ctx.storage.set('input', text);
  }

  const recompute = debounce(() => update(true), DEBOUNCE_MS);
  input.addEventListener('input', recompute);

  // 恢复上次输入并立即出一次结果（不等防抖）
  const saved = ctx.storage.get('input', '');
  if (typeof saved === 'string' && saved !== '') input.value = saved;
  update(false);

  /* ---------- 清理函数 ---------- */

  return () => {
    recompute.cancel();
  };
}
