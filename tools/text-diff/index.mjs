/**
 * 文本对比 —— 工具入口（外壳在进入 #/text-diff 时动态加载本模块）。
 *
 * 输入区：左「原文」右「新文」两个输入框 +「交换」按钮；
 * 控制：对比粒度（按行 / 按词 / 按字符）、视图（并排 / 合并）、
 *       忽略选项（首尾空白 / 所有空白差异 / 大小写 / 空行）；
 * 结果：统计（新增 N 行，删除 M 行）、并排视图（修改行内字符级高亮）或
 *       合并视图（+/- 前缀）、unified diff（可复制、下载 .diff）。
 *
 * 视图按 unified diff 的 hunk（上下文 3 行）渲染，两段差异较大时中间用
 * 「省略 N 行相同内容」占位，保证大输入下 DOM 不会爆炸、页面不卡死。
 * 所有纯逻辑在 ./logic.mjs；公共组件来自 assets/js/ui.mjs。
 */

import { copyButton, debounce, downloadBlob, el } from '../../assets/js/ui.mjs';
import {
  DEFAULT_OPTIONS,
  GRANULARITIES,
  OPTION_ITEMS,
  VIEWS,
  buildSideRows,
  compare,
  computeHunks,
  formatStats,
  toUnifiedDiff,
} from './logic.mjs';

const DEBOUNCE_MS = 250; // 输入自动更新的防抖（约定 ≤ 300ms）
const CONTEXT = 3; // 视图渲染的上下文行数（与 unified diff 一致）
const DOWNLOAD_NAME = 'text-diff.diff';

export async function mount(root, ctx) {
  ctx.loadStyle('tools/text-diff/style.css');

  /* ---------- 状态（从本地存储恢复） ---------- */

  const savedGranularity = ctx.storage.get('granularity', 'line');
  let granularity = GRANULARITIES.some((g) => g.value === savedGranularity) ? savedGranularity : 'line';
  const savedView = ctx.storage.get('view', 'side');
  let view = VIEWS.some((v) => v.value === savedView) ? savedView : 'side';
  const savedOptions = ctx.storage.get('options', {});
  const options = { ...DEFAULT_OPTIONS };
  for (const { key } of OPTION_ITEMS) {
    if (typeof savedOptions[key] === 'boolean') options[key] = savedOptions[key];
  }

  let result = null; // 最近一次 compare 的结果
  let unifiedText = ''; // 最近一次 unified diff 文本

  /* ---------- DOM：控制区 ---------- */

  /**
   * 分段切换（单选组）：一排按钮，aria-pressed 标记当前项。
   * items: [{ value, label }]；返回容器元素。
   */
  function segControl(items, current, onSelect, testid) {
    const buttons = new Map();
    const render = () => {
      for (const [value, btn] of buttons) btn.setAttribute('aria-pressed', String(value === current));
    };
    const seg = el(
      'span',
      { class: 'seg', 'data-testid': testid, role: 'group' },
      items.map(({ value, label }) => {
        const btn = el(
          'button',
          {
            type: 'button',
            'aria-pressed': String(value === current),
            onClick: () => {
              current = value;
              render();
              onSelect(value);
            },
          },
          label,
        );
        buttons.set(value, btn);
        return btn;
      }),
    );
    return seg;
  }

  const granularitySeg = segControl(GRANULARITIES, granularity, (value) => {
    granularity = value;
    ctx.storage.set('granularity', value);
    syncOptionStates();
    recompute();
  }, 'text-diff-granularity');

  const viewSeg = segControl(VIEWS, view, (value) => {
    view = value;
    ctx.storage.set('view', value);
    renderView();
  }, 'text-diff-view');

  const optionBoxes = {}; // key -> input
  const optionControls = OPTION_ITEMS.map(({ key, label, lineOnly }) => {
    const box = el('input', {
      type: 'checkbox',
      'data-testid': `text-diff-opt-${key}`,
      checked: options[key],
      onChange: () => {
        options[key] = box.checked;
        ctx.storage.set('options', options);
        recompute();
      },
    });
    optionBoxes[key] = box;
    return el(
      'label',
      { class: 'diff-opt', title: lineOnly ? '仅按行对比时生效' : null },
      box,
      el('span', {}, label),
    );
  });

  /** 「忽略空行」只在按行模式下可用 */
  function syncOptionStates() {
    for (const { key, lineOnly } of OPTION_ITEMS) {
      optionBoxes[key].disabled = Boolean(lineOnly) && granularity !== 'line';
    }
  }

  /* ---------- DOM：输入区 ---------- */

  const oldArea = el('textarea', {
    id: 'text-diff-old',
    'data-testid': 'text-diff-old',
    'aria-label': '原文',
    placeholder: '粘贴原文…',
    spellcheck: 'false',
  });
  const newArea = el('textarea', {
    id: 'text-diff-new',
    'data-testid': 'text-diff-new',
    'aria-label': '新文',
    placeholder: '粘贴新文…',
    spellcheck: 'false',
  });

  const swapBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'data-testid': 'text-diff-swap',
      'aria-label': '交换原文与新文',
      title: '交换原文与新文',
      onClick: () => {
        const tmp = oldArea.value;
        oldArea.value = newArea.value;
        newArea.value = tmp;
        recompute();
      },
    },
    '⇄ 交换',
  );

  /* ---------- DOM：结果区 ---------- */

  const statsText = el('strong', { 'data-testid': 'text-diff-stats' }, '');
  const sameMsg = el(
    'span',
    { class: 'diff-same', 'data-testid': 'text-diff-same' },
    '✓ 两段文本完全相同',
  );
  sameMsg.hidden = true;

  const viewRoot = el('div', { class: 'diff-view', 'data-testid': 'text-diff-view' });

  const unifiedPre = el('pre', {
    class: 'output-box diff-unified',
    'data-testid': 'text-diff-unified',
    role: 'region', // 允许命名的输出区域（pre 本身的 role 不允许 aria-label）
    'aria-label': 'unified diff 结果',
  });

  const copyBtn = copyButton(() => unifiedText, { label: '复制 unified diff' });
  const downloadBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'data-testid': 'text-diff-download',
      onClick: () => {
        downloadBlob(new Blob([unifiedText], { type: 'text/plain;charset=utf-8' }), DOWNLOAD_NAME);
      },
    },
    '下载 .diff 文件',
  );

  root.append(
    el(
      'section',
      { class: 'tool text-diff' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el('div', { class: 'tool-actions' }, copyBtn, downloadBtn),
      ),
      el(
        'div',
        { class: 'form-row diff-controls' },
        el('span', { class: 'field-label' }, '对比粒度'),
        granularitySeg,
        el('span', { class: 'field-label' }, '视图'),
        viewSeg,
        swapBtn,
        el('span', { class: 'diff-opt-sep' }, '忽略：'),
        ...optionControls,
      ),
      el(
        'div',
        { class: 'diff-inputs two-col' },
        el(
          'div',
          { class: 'diff-input' },
          el('label', { class: 'field-label', for: 'text-diff-old' }, '原文'),
          oldArea,
        ),
        el(
          'div',
          { class: 'diff-input' },
          el('label', { class: 'field-label', for: 'text-diff-new' }, '新文'),
          newArea,
        ),
      ),
      el(
        'p',
        { class: 'diff-statsbar' },
        el('span', { class: 'field-label' }, '统计：'),
        statsText,
        sameMsg,
      ),
      viewRoot,
      el(
        'section',
        { class: 'diff-unified-panel' },
        el('h2', { class: 'diff-panel-title' }, 'unified diff'),
        el(
          'p',
          { class: 'field-hint' },
          '上下文 3 行；两段完全相同时为空。内容只在本地浏览器处理，不会上传。',
        ),
        unifiedPre,
      ),
    ),
  );

  /* ---------- 计算 / 渲染 ---------- */

  const recompute = debounce(() => {
    result = compare(oldArea.value, newArea.value, granularity, options);
    unifiedText = toUnifiedDiff(result.ops);
    ctx.storage.set('old', oldArea.value);
    ctx.storage.set('new', newArea.value);
    statsText.textContent = formatStats(result.stats, granularity);
    sameMsg.hidden = !result.identical;
    unifiedPre.textContent = unifiedText;
    renderView();
  }, DEBOUNCE_MS);

  function renderView() {
    viewRoot.replaceChildren();
    if (!result || result.identical) return;
    viewRoot.append(granularity === 'line' ? lineView() : flowView());
  }

  /** 行模式视图：并排（对齐 + 行号 + 行内字符级高亮）或合并（单栏 +/-） */
  function lineView() {
    const box = el('div', {
      class: view === 'side' ? 'diff-lines diff-lines-side' : 'diff-lines diff-lines-merged',
      'data-testid': view === 'side' ? 'text-diff-side' : 'text-diff-merged',
    });
    const hunks = computeHunks(result.ops, CONTEXT);
    let cursor = 0; // 已渲染到的 op 下标
    for (const hunk of hunks) {
      if (hunk.from > cursor) box.append(collapsedRow(hunk.from - cursor, '行'));
      box.append(...(view === 'side' ? sideRows(hunk) : mergedRows(hunk)));
      cursor = hunk.to;
    }
    if (cursor < result.ops.length) {
      box.append(collapsedRow(result.ops.length - cursor, '行'));
    }
    return box;
  }

  /** 并排视图的行 */
  function sideRows(hunk) {
    const rows = buildSideRows(hunk.ops, options);
    return rows.map((row) => {
      const cells = [];
      const oldCell = cell(
        row.kind === 'equal' ? result.aTokens[row.old.aIndex].text : row.kind === 'mod' ? null : row.old ? row.old.text : null,
        row.kind === 'equal' ? 'is-eq' : row.old ? 'is-del' : 'is-empty',
      );
      const newCell = cell(
        row.kind === 'equal' ? result.bTokens[row.new.bIndex].text : row.kind === 'mod' ? null : row.new ? row.new.text : null,
        row.kind === 'equal' ? 'is-eq' : row.new ? 'is-add' : 'is-empty',
      );
      if (row.kind === 'mod') {
        oldCell.append(...segments(row.oldSegments, 'del'));
        newCell.append(...segments(row.newSegments, 'add'));
      }
      cells.push(el('span', { class: 'diff-ln' }, row.old ? String(row.old.aIndex + 1) : ''));
      cells.push(oldCell);
      cells.push(el('span', { class: 'diff-ln' }, row.new ? String(row.new.bIndex + 1) : ''));
      cells.push(newCell);
      return el('div', { class: `diff-row row-${row.kind}`, 'data-testid': 'text-diff-row' }, ...cells);
    });
  }

  /** 合并视图的行（+/- 前缀） */
  function mergedRows(hunk) {
    return hunk.ops.map((op) => {
      const prefix = op.type === 'equal' ? ' ' : op.type === 'del' ? '-' : '+';
      const text =
        op.type === 'add' ? result.bTokens[op.bIndex].text : result.aTokens[op.aIndex].text;
      return el(
        'div',
        {
          class: `diff-urow urow-${op.type}`,
          'data-testid': op.type === 'equal' ? 'text-diff-urow-eq' : `text-diff-urow-${op.type}`,
        },
        el('span', { class: 'diff-ln' }, op.aIndex !== undefined ? String(op.aIndex + 1) : ''),
        el('span', { class: 'diff-ln' }, op.bIndex !== undefined ? String(op.bIndex + 1) : ''),
        el('span', { class: 'diff-prefix' }, prefix),
        el('span', { class: 'diff-cell-text' }, text),
      );
    });
  }

  /** 词 / 字符模式视图：流式排布，删除 / 新增 token 高亮 */
  function flowView() {
    const box = el('div', {
      class: view === 'side' ? 'diff-flow diff-flow-side' : 'diff-flow diff-flow-merged',
      'data-testid': view === 'side' ? 'text-diff-side' : 'text-diff-merged',
    });
    const hunks = computeHunks(result.ops, CONTEXT);
    let cursor = 0;
    const parts = [];
    for (const hunk of hunks) {
      if (hunk.from > cursor) parts.push(collapsedFlow(hunk.from - cursor));
      if (view === 'side') {
        parts.push(flowColumns(hunk.ops));
      } else {
        const flow = el('div', { class: 'diff-flow-run' });
        for (const op of hunk.ops) flow.append(flowToken(op));
        parts.push(flow);
      }
      cursor = hunk.to;
    }
    if (cursor < result.ops.length) parts.push(collapsedFlow(result.ops.length - cursor));
    box.append(...parts);
    return box;
  }

  function flowColumns(hunkOps) {
    const oldRun = el('div', { class: 'diff-flow-run' });
    const newRun = el('div', { class: 'diff-flow-run' });
    for (const op of hunkOps) {
      if (op.type === 'del') {
        oldRun.append(el('span', { class: 'diff-tok tok-del', 'data-testid': 'text-diff-token-del' }, op.text));
      } else if (op.type === 'add') {
        newRun.append(el('span', { class: 'diff-tok tok-add', 'data-testid': 'text-diff-token-add' }, op.text));
      } else {
        oldRun.append(document.createTextNode(result.aTokens[op.aIndex].text));
        newRun.append(document.createTextNode(result.bTokens[op.bIndex].text));
      }
    }
    return el('div', { class: 'diff-flow-cols' }, oldRun, newRun);
  }

  function flowToken(op) {
    if (op.type === 'del') {
      return el('span', { class: 'diff-tok tok-del', 'data-testid': 'text-diff-token-del' }, '-', op.text);
    }
    if (op.type === 'add') {
      return el('span', { class: 'diff-tok tok-add', 'data-testid': 'text-diff-token-add' }, '+', op.text);
    }
    return document.createTextNode(result.aTokens[op.aIndex].text);
  }

  /* ---------- 小部件 ---------- */

  function cell(content, className) {
    const node = el('span', { class: `diff-cell ${className}` });
    if (typeof content === 'string') node.textContent = content;
    return node;
  }

  function segments(segs, side) {
    return segs.map((seg) =>
      seg.type === 'equal'
        ? document.createTextNode(seg.text)
        : el(
            'span',
            {
              class: `diff-mark mark-${seg.type}`,
              'data-testid': `text-diff-inline-${seg.type}`,
            },
            seg.text,
          ),
    );
  }

  function collapsedRow(count, unit) {
    return el(
      'div',
      { class: 'diff-collapsed', 'data-testid': 'text-diff-collapsed' },
      `⋯ 中间省略 ${count} ${unit}相同内容（见下方 unified diff）⋯`,
    );
  }

  function collapsedFlow(count) {
    return el(
      'span',
      { class: 'diff-collapsed diff-collapsed-inline', 'data-testid': 'text-diff-collapsed' },
      ` ⋯省略 ${count} 个相同内容⋯ `,
    );
  }

  /* ---------- 事件 / 初始化 ---------- */

  oldArea.addEventListener('input', recompute);
  newArea.addEventListener('input', recompute);

  const savedOld = ctx.storage.get('old', '');
  const savedNew = ctx.storage.get('new', '');
  if (typeof savedOld === 'string' && savedOld !== '') oldArea.value = savedOld;
  if (typeof savedNew === 'string' && savedNew !== '') newArea.value = savedNew;

  syncOptionStates();
  // 立即出一次结果（不等防抖）
  result = compare(oldArea.value, newArea.value, granularity, options);
  unifiedText = toUnifiedDiff(result.ops);
  statsText.textContent = formatStats(result.stats, granularity);
  sameMsg.hidden = !result.identical;
  unifiedPre.textContent = unifiedText;
  renderView();

  /* ---------- 清理函数 ---------- */

  return () => {
    recompute.cancel();
  };
}
