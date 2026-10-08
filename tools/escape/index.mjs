/**
 * 转义工具 —— 工具入口（外壳在进入 #/escape 时动态加载本模块）。
 *
 * 三种类型 × 双向（转义 / 还原）：
 *   HTML 实体  三种转义模式（仅必要字符 / 非 ASCII 全转 / 优先命名实体）；
 *              还原基于实体表逐字符实现，全程不用 innerHTML（防 XSS），
 *              未知 / 非法实体原样保留
 *   Unicode    五种输出格式（\uXXXX / \u{XXXXX} / U+XXXX / &#x…; / CSS \XXXX），
 *              可选「只转非 ASCII」「十六进制大写」；还原能识别全部格式（可混合），
 *              不成对的代理项按原文保留并给出提示，不报错
 *   JS 字符串  双引号字符串内容 ⇄ 文本；非法转义给出中文错误并指明位置
 *
 * 所有纯逻辑在 ./logic.mjs；公共组件来自 assets/js/ui.mjs。
 */

import { clearError, copyButton, debounce, downloadBlob, el, showError } from '../../assets/js/ui.mjs';
import {
  charDetails,
  countCodePoints,
  escapeHtml,
  escapeJsString,
  escapeUnicode,
  truncateForDisplay,
  unescapeHtml,
  unescapeJsString,
  unescapeUnicode,
  utf8ByteLength,
} from './logic.mjs';

const DEBOUNCE_MS = 200; // 输入自动更新的防抖（约定 ≤ 300ms）

const TYPE_ITEMS = [
  { value: 'html', label: 'HTML 实体' },
  { value: 'unicode', label: 'Unicode' },
  { value: 'js', label: 'JS 字符串' },
];

const DIRECTION_ITEMS = [
  { value: 'escape', label: '转义' },
  { value: 'unescape', label: '还原' },
];

const HTML_MODE_ITEMS = [
  { value: 'necessary', label: '仅必要字符（& < > " \'）' },
  { value: 'nonAscii', label: '非 ASCII 全部转为 &#x…;' },
  { value: 'named', label: '优先使用命名实体' },
];

const UNICODE_FORMAT_ITEMS = [
  { value: 'u-escape', label: '\\uXXXX（超出 BMP 拆代理对）' },
  { value: 'u-brace', label: '\\u{XXXXX}' },
  { value: 'u-plus', label: 'U+XXXX（空格分隔，全部转换）' },
  { value: 'html-hex', label: '&#x…;（HTML 十六进制实体）' },
  { value: 'css', label: 'CSS \\XXXX 转义' },
];

/** 各类型 × 方向的一句说明（也是界面的操作提示） */
const MODE_HINTS = {
  'html:escape': '把 & < > " \' 等字符转成 HTML 实体，输出可直接放进 HTML。',
  'html:unescape': '支持命名实体（HTML 4.01 全部 252 个 + &apos;）、十进制 &#…; 与十六进制 &#x…;，未知或非法实体原样保留。',
  'unicode:escape': '把非 ASCII 字符（可改为全部字符）转为所选格式的 Unicode 转义。',
  'unicode:unescape': '支持 \\uXXXX、\\u{XXXXX}、U+XXXX、&#x…; 与 CSS \\XXXX，可混合使用；无法识别的内容原样保留。',
  'js:escape': '转为合法的双引号字符串内容：\\n \\t \\" \\\\ 及控制字符 \\u00XX，可直接粘进代码。',
  'js:unescape': '支持 \\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX \\xNN \\0；非法转义会提示中文错误并指出位置。',
};

/* ==================== 小部件辅助 ==================== */

/** 分段切换（.seg）：items = [{ value, label }]，返回 { node, set } */
function segControl(items, initial, onPick) {
  const buttons = new Map();
  const node = el(
    'div',
    { class: 'seg', role: 'group' },
    items.map(({ value, label }) => {
      const btn = el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(value === initial),
          onClick: () => set(value),
        },
        label,
      );
      buttons.set(value, btn);
      return btn;
    }),
  );
  function set(value) {
    for (const [v, btn] of buttons) btn.setAttribute('aria-pressed', String(v === value));
    onPick(value);
  }
  return { node, set };
}

/* ==================== 挂载 ==================== */

export async function mount(root, ctx) {
  ctx.loadStyle('tools/escape/style.css');

  let type = ctx.storage.get('type', 'html'); // 'html' | 'unicode' | 'js'
  let direction = ctx.storage.get('direction', 'escape'); // 'escape' | 'unescape'
  let htmlMode = ctx.storage.get('htmlMode', 'necessary');
  let unicodeFormat = ctx.storage.get('unicodeFormat', 'u-escape');
  let onlyNonAscii = ctx.storage.get('onlyNonAscii', true);
  let upperHex = ctx.storage.get('upperHex', true);

  /* ---------- 输入 / 输出 ---------- */

  const input = el('textarea', {
    id: 'escape-input',
    'data-testid': 'escape-input',
    spellcheck: 'false',
  });
  const inputStats = el('p', { class: 'field-hint', 'data-testid': 'escape-input-stats' }, '');
  const errorWrap = el('div', { 'data-testid': 'escape-error' });
  const warningBox = el(
    'p',
    { class: 'escape-note-box', role: 'status', 'data-testid': 'escape-warning', hidden: true },
    '',
  );

  const outputBox = el('div', { class: 'output-box escape-output', 'data-testid': 'escape-output' });
  const outputCount = el('span', { class: 'escape-count', 'data-testid': 'escape-output-count' }, '');
  const truncateNote = el(
    'p',
    { class: 'field-hint escape-truncate-note', 'data-testid': 'escape-output-truncated', hidden: true },
    '已截断显示，可复制 / 下载完整结果',
  );
  let outputFull = '';
  const downloadFull = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      hidden: true,
      onClick: () => {
        downloadBlob(new Blob([outputFull], { type: 'text/plain;charset=utf-8' }), 'escape-result.txt');
      },
    },
    '下载完整结果',
  );

  function renderOutput(text) {
    outputFull = text;
    const t = truncateForDisplay(text);
    outputBox.textContent = t.text;
    outputCount.textContent = `${countCodePoints(text)} 字符`;
    truncateNote.hidden = !t.truncated;
    downloadFull.hidden = !t.truncated;
  }

  /* ---------- 字符明细 ---------- */

  const detailsTbody = el('tbody', {});
  const detailsSummary = el('summary', {}, '字符明细');
  const detailsNote = el('p', { class: 'field-hint', 'data-testid': 'escape-details-note' }, '');
  const details = el(
    'details',
    { class: 'escape-details', 'data-testid': 'escape-details' },
    detailsSummary,
    el(
      'div',
      { class: 'escape-details-scroll' },
      el(
        'table',
        { class: 'escape-details-table' },
        el(
          'thead',
          {},
          el('tr', {}, el('th', {}, '字符'), el('th', {}, '码点'), el('th', {}, 'UTF-8 字节')),
        ),
        detailsTbody,
      ),
    ),
    detailsNote,
  );

  function renderDetails(text) {
    if (text === '') {
      details.hidden = true;
      return;
    }
    details.hidden = false;
    const d = charDetails(text);
    detailsTbody.replaceChildren(
      ...d.rows.map((row) =>
        el(
          'tr',
          {},
          el('td', { class: 'escape-details-char' }, row.char),
          el('td', {}, row.codePoint),
          el('td', {}, row.utf8 ?? '（代理项，无 UTF-8）'),
        ),
      ),
    );
    detailsSummary.textContent = `字符明细（前 ${d.rows.length} / 共 ${d.total} 个字符）`;
    detailsNote.textContent = d.truncated ? '输入较长，仅列出前 200 个字符。' : '码点与 UTF-8 字节（大写十六进制）。';
  }

  /* ---------- 刷新 ---------- */

  function showWarning(message) {
    warningBox.textContent = message;
    warningBox.hidden = false;
  }

  function refresh() {
    clearError(errorWrap);
    warningBox.hidden = true;
    const text = input.value;
    inputStats.textContent = `输入 ${countCodePoints(text)} 字符 · ${utf8ByteLength(text)} 字节（UTF-8）`;
    let out;
    try {
      if (type === 'html') {
        out = direction === 'escape' ? escapeHtml(text, { mode: htmlMode }) : unescapeHtml(text);
      } else if (type === 'unicode') {
        if (direction === 'escape') {
          out = escapeUnicode(text, { format: unicodeFormat, onlyNonAscii, upperHex });
        } else {
          const r = unescapeUnicode(text);
          out = r.text;
          if (r.warning !== null) showWarning(r.warning);
        }
      } else {
        out = direction === 'escape' ? escapeJsString(text) : unescapeJsString(text);
      }
    } catch (err) {
      renderOutput('');
      renderDetails(text);
      showError(errorWrap, err.message);
      return;
    }
    renderOutput(out);
    renderDetails(text);
  }

  const refreshDebounced = debounce(refresh, DEBOUNCE_MS);
  input.addEventListener('input', refreshDebounced);

  /* ---------- 选项区 ---------- */

  const htmlModeSelect = el(
    'select',
    { id: 'escape-html-mode', 'data-testid': 'escape-html-mode' },
    HTML_MODE_ITEMS.map(({ value, label }) => el('option', { value }, label)),
  );
  htmlModeSelect.value = htmlMode;
  htmlModeSelect.addEventListener('change', () => {
    htmlMode = htmlModeSelect.value;
    ctx.storage.set('htmlMode', htmlMode);
    refresh();
  });
  const htmlOptions = el(
    'div',
    { class: 'form-row escape-options', 'data-testid': 'escape-html-options' },
    el('label', { class: 'escape-option', for: 'escape-html-mode' }, '转义模式 ', htmlModeSelect),
  );

  const formatSelect = el(
    'select',
    { id: 'escape-format', 'data-testid': 'escape-format' },
    UNICODE_FORMAT_ITEMS.map(({ value, label }) => el('option', { value }, label)),
  );
  formatSelect.value = unicodeFormat;
  formatSelect.addEventListener('change', () => {
    unicodeFormat = formatSelect.value;
    ctx.storage.set('unicodeFormat', unicodeFormat);
    applyControls();
    refresh();
  });
  const onlyNonAsciiInput = el('input', {
    type: 'checkbox',
    id: 'escape-only-non-ascii',
    'data-testid': 'escape-only-non-ascii',
    checked: onlyNonAscii ? true : null,
  });
  onlyNonAsciiInput.addEventListener('change', () => {
    onlyNonAscii = onlyNonAsciiInput.checked;
    ctx.storage.set('onlyNonAscii', onlyNonAscii);
    refresh();
  });
  const upperHexInput = el('input', {
    type: 'checkbox',
    id: 'escape-upper-hex',
    'data-testid': 'escape-upper-hex',
    checked: upperHex ? true : null,
  });
  upperHexInput.addEventListener('change', () => {
    upperHex = upperHexInput.checked;
    ctx.storage.set('upperHex', upperHex);
    refresh();
  });
  const unicodeOptions = el(
    'div',
    { class: 'form-row escape-options', 'data-testid': 'escape-unicode-options' },
    el('label', { class: 'escape-option', for: 'escape-format' }, '输出格式 ', formatSelect),
    el('label', { class: 'escape-option', for: 'escape-only-non-ascii' }, onlyNonAsciiInput, ' 只转非 ASCII'),
    el('label', { class: 'escape-option', for: 'escape-upper-hex' }, upperHexInput, ' 十六进制大写'),
  );

  const modeHint = el('p', { class: 'field-hint escape-mode-hint', 'data-testid': 'escape-mode-hint' }, '');

  /** 依据当前类型 / 方向 / 格式更新选项区可见性与提示文案 */
  function applyControls() {
    htmlOptions.hidden = !(type === 'html' && direction === 'escape');
    unicodeOptions.hidden = !(type === 'unicode' && direction === 'escape');
    // U+XXXX 格式始终转换全部字符，「只转非 ASCII」不适用
    const formatIgnoresOnlyNonAscii = unicodeFormat === 'u-plus';
    onlyNonAsciiInput.disabled = formatIgnoresOnlyNonAscii;
    onlyNonAsciiInput.parentElement?.classList.toggle('is-disabled', formatIgnoresOnlyNonAscii);
    modeHint.textContent = MODE_HINTS[`${type}:${direction}`];

    if (direction === 'escape') {
      input.setAttribute('aria-label', '要转义的文本');
      input.setAttribute('placeholder', '输入文本，转义结果实时更新…');
    } else {
      input.setAttribute('aria-label', '要还原的文本');
      input.setAttribute('placeholder', '输入转义后的文本，还原结果实时更新…');
    }
  }

  /* ---------- 类型 / 方向切换与交换 ---------- */

  const typeSeg = segControl(TYPE_ITEMS, type, (value) => {
    type = value;
    ctx.storage.set('type', value);
    applyControls();
    refresh();
  });
  const directionSeg = segControl(DIRECTION_ITEMS, direction, (value) => {
    direction = value;
    ctx.storage.set('direction', value);
    applyControls();
    refresh();
  });

  const swapBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'data-testid': 'escape-swap',
      title: '把输出放入输入框并切换方向',
      onClick: () => {
        if (outputFull === '') return;
        input.value = outputFull;
        directionSeg.set(direction === 'escape' ? 'unescape' : 'escape');
      },
    },
    '交换输入输出',
  );

  /* ---------- 组装 ---------- */

  root.append(
    el(
      'section',
      { class: 'tool escape' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
      ),
      el(
        'div',
        { class: 'escape-controls' },
        el('div', { class: 'form-row' }, el('span', { class: 'escape-control-label' }, '类型'), typeSeg.node),
        el('div', { class: 'form-row' }, el('span', { class: 'escape-control-label' }, '方向'), directionSeg.node, swapBtn),
        htmlOptions,
        unicodeOptions,
        modeHint,
      ),
      el(
        'div',
        { class: 'two-col' },
        el(
          'div',
          {},
          el('label', { class: 'field-label', for: 'escape-input' }, '输入'),
          input,
          inputStats,
          el('p', { class: 'field-hint' }, '内容只在本地浏览器处理，不会上传。'),
        ),
        el(
          'div',
          {},
          el('div', { class: 'field-label' }, '输出 ', outputCount),
          outputBox,
          truncateNote,
          el('div', { class: 'tool-actions' }, copyButton(() => outputFull, { label: '复制结果' }), downloadFull),
          warningBox,
          errorWrap,
        ),
      ),
      details,
    ),
  );

  applyControls();
  refresh();

  /* ---------- 清理函数（离开工具时由外壳调用） ---------- */

  return () => {
    refreshDebounced.cancel();
  };
}
