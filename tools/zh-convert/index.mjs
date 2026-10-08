/**
 * 简繁转换 —— 工具入口（外壳在进入 #/zh-convert 时动态加载本模块）。
 *
 * 控制区：转换方向（简 → 繁 / 繁 → 简）、「台湾常用词」（仅简→繁，如
 *         软件→軟體、内存→記憶體、网络→網路）、「高亮变化的字」；
 * 输入 / 输出两栏，输入防抖自动更新，输出区可整段复制。
 *
 * 词表数据（约 343 KB，整理自 OpenCC）进入本工具时才 fetch 加载，
 * 加载期间显示「正在加载词表…」，完成后自动转换当前输入；
 * 加载失败给出中文错误提示。所有转换逻辑在 ./logic.mjs，
 * 公共组件来自 assets/js/ui.mjs。
 */

import { clearError, copyButton, debounce, el, showError } from '../../assets/js/ui.mjs';
import { DIRECTIONS, buildTables, convert } from './logic.mjs';

/** 词表地址：相对站点根（经 document.baseURI 解析，子路径部署同样可用） */
const DATA_URL = 'tools/zh-convert/data/zh-dict.json';
const DEBOUNCE_MS = 250; // 输入自动更新的防抖（约定 ≤ 300ms）
/** 超长输出退化为纯文本渲染，避免上万个高亮元素拖垮页面 */
const MAX_RENDER_CHARS = 20000;

export async function mount(root, ctx) {
  ctx.loadStyle('tools/zh-convert/style.css');

  /* ---------- 状态（从本地存储恢复） ---------- */

  const savedDirection = ctx.storage.get('direction', 's2t');
  let direction = DIRECTIONS.some((d) => d.value === savedDirection) ? savedDirection : 's2t';
  let twEnabled = ctx.storage.get('tw', false) === true;
  let highlight = ctx.storage.get('highlight', false) === true;

  let tables = null; // 词表（加载完成后可用）
  let disposed = false; // 离开工具后不再渲染
  let result = { text: '', segments: [], changedChars: 0 }; // 最近一次转换结果

  /* ---------- DOM：控制区 ---------- */

  /** 方向分段（单选组）：一排按钮，aria-pressed 标记当前项 */
  const directionButtons = new Map();
  const renderDirection = () => {
    for (const [value, btn] of directionButtons) {
      btn.setAttribute('aria-pressed', String(value === direction));
    }
  };
  const directionSeg = el(
    'span',
    { class: 'seg', 'data-testid': 'zh-convert-direction', role: 'group', 'aria-label': '转换方向' },
    DIRECTIONS.map(({ value, label }) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(value === direction),
          onClick: () => {
            direction = value;
            ctx.storage.set('direction', value);
            renderDirection();
            syncTwState();
            recomputeNow();
          },
        },
        label,
      ),
    ),
  );
  // 按钮顺序与 DIRECTIONS 一致，记录 value → 按钮的映射供 renderDirection 刷新
  DIRECTIONS.forEach(({ value }, index) => {
    directionButtons.set(value, directionSeg.children[index]);
  });

  const twBox = el('input', {
    type: 'checkbox',
    id: 'zh-convert-tw',
    'data-testid': 'zh-convert-tw',
    checked: twEnabled,
    onChange: () => {
      twEnabled = twBox.checked;
      ctx.storage.set('tw', twEnabled);
      recomputeNow();
    },
  });

  const highlightBox = el('input', {
    type: 'checkbox',
    id: 'zh-convert-highlight',
    'data-testid': 'zh-convert-highlight',
    checked: highlight,
    onChange: () => {
      highlight = highlightBox.checked;
      ctx.storage.set('highlight', highlight);
      renderOutput(); // 只影响展示，无需重新转换
    },
  });

  /** 「台湾常用词」只在简 → 繁时可用 */
  function syncTwState() {
    twBox.disabled = direction !== 's2t';
    twRow.classList.toggle('is-disabled', twBox.disabled);
  }

  const twRow = el(
    'label',
    { class: 'zh-opt', title: '简 → 繁时把 软件→軟體、内存→記憶體、网络→網路 等替换为台湾常用说法' },
    twBox,
    el('span', {}, '台湾常用词'),
  );
  const highlightRow = el(
    'label',
    { class: 'zh-opt', title: '给输出中被转换的字加底色' },
    highlightBox,
    el('span', {}, '高亮变化的字'),
  );

  /* ---------- DOM：加载状态 / 输入 / 输出 ---------- */

  const loading = el(
    'p',
    { class: 'zh-loading', 'data-testid': 'zh-convert-loading', role: 'status' },
    '正在加载词表…',
  );

  const statusBar = el('p', { class: 'zh-status' }, loading);

  const textarea = el('textarea', {
    id: 'zh-convert-input',
    'data-testid': 'zh-convert-input',
    'aria-label': '要转换的文本',
    placeholder: '输入或粘贴要转换的文本，结果实时更新…',
    spellcheck: 'false',
  });

  const countText = el('strong', { 'data-testid': 'zh-convert-count' }, '0');
  const output = el('div', {
    class: 'output-box zh-output',
    'data-testid': 'zh-convert-output',
    'aria-label': '转换结果',
  });

  root.append(
    el(
      'section',
      { class: 'tool zh-convert' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el('div', { class: 'tool-actions' }, copyButton(() => result.text, { label: '复制结果' })),
      ),
      el(
        'div',
        { class: 'form-row zh-controls' },
        el('span', { class: 'field-label' }, '转换方向'),
        directionSeg,
        twRow,
        highlightRow,
      ),
      statusBar,
      el(
        'div',
        { class: 'zh-layout two-col' },
        el(
          'div',
          { class: 'zh-pane' },
          el('label', { class: 'field-label', for: 'zh-convert-input' }, '输入'),
          textarea,
          el('p', { class: 'field-hint' }, '内容只在本地浏览器中转换，不会上传。'),
        ),
        el(
          'div',
          { class: 'zh-pane' },
          el(
            'div',
            { class: 'zh-output-head' },
            el('span', { class: 'field-label' }, '输出'),
            el(
              'span',
              { class: 'zh-count' },
              '已转换 ',
              countText,
              ' 字',
            ),
          ),
          output,
        ),
      ),
    ),
  );

  /* ---------- 转换与渲染 ---------- */

  function recomputeNow() {
    if (!tables) return;
    const tw = direction === 's2t' && twEnabled;
    result = convert(textarea.value, direction, tables, { tw });
    ctx.storage.set('text', textarea.value);
    renderOutput();
  }

  const recompute = debounce(recomputeNow, DEBOUNCE_MS);

  function renderOutput() {
    countText.textContent = String(result.changedChars);
    output.replaceChildren();
    // 高亮开启且未超长时逐字渲染高亮元素，否则纯文本
    if (!highlight || result.text.length > MAX_RENDER_CHARS) {
      output.append(document.createTextNode(result.text));
      return;
    }
    for (const seg of result.segments) {
      output.append(
        seg.changed
          ? el('mark', { class: 'zh-mark', 'data-testid': 'zh-convert-mark' }, seg.text)
          : document.createTextNode(seg.text),
      );
    }
  }

  /* ---------- 词表异步加载 ---------- */

  (async () => {
    try {
      const url = new URL(DATA_URL, document.baseURI);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (disposed) return;
      tables = buildTables(data);
    } catch {
      if (disposed) return;
      loading.hidden = true;
      showError(
        statusBar,
        '词表加载失败：请确认文件 tools/zh-convert/data/zh-dict.json 可用，然后刷新页面重试。',
      );
      return;
    }
    loading.hidden = true;
    recomputeNow();
  })();

  /* ---------- 事件 / 初始化 ---------- */

  textarea.addEventListener('input', recompute);

  const savedText = ctx.storage.get('text', '');
  if (typeof savedText === 'string' && savedText !== '') textarea.value = savedText;

  renderDirection();
  syncTwState();
  recomputeNow(); // 词表未就绪时只渲染空结果，就绪后由加载回调再转换

  /* ---------- 清理函数（离开工具时由外壳调用） ---------- */

  return () => {
    disposed = true;
    recompute.cancel();
    clearError(statusBar);
  };
}
