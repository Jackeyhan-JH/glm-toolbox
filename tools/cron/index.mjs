/**
 * Cron 解析 —— 工具入口（外壳在进入 #/cron 时动态加载本模块）。
 *
 * 页面结构：
 *   表达式输入 + 常用示例按钮 + 「显示次数 / 时区」两个选项
 *     → 中文描述（可复制）
 *     → 逐段解释表（每段的原文与展开后的取值）
 *     → 未来执行时间（所选时区的本地时间 + 距现在多久 + UTC 偏移）
 *
 * mount(root, ctx) 协议见 CONTRIBUTING.md；返回清理函数取消防抖定时器。
 */

import { clearError, copyButton, debounce, el, showError } from '../../assets/js/ui.mjs';
import {
  SEARCH_LIMIT_YEARS,
  analyze,
  formatOffset,
  formatRunTime,
  humanizeDuration,
  localTimeZone,
} from './logic.mjs';

const REFRESH_DEBOUNCE_MS = 150; // 输入防抖（验收要求 ≤ 300ms）

const STORAGE_KEYS = { expr: 'expr', count: 'count', tz: 'tz' };
const COUNT_OPTIONS = [5, 10, 20, 50];
const DEFAULT_EXPR = '*/15 9-18 * * 1-5';

/** 常用示例（点击填入输入框）；标签即按钮文字 */
const EXAMPLES = [
  { label: '每分钟', expr: '* * * * *' },
  { label: '每小时', expr: '0 * * * *' },
  { label: '每天 0 点', expr: '0 0 * * *' },
  { label: '工作日 9 点', expr: '0 9 * * 1-5' },
  { label: '每月 1 号', expr: '0 0 1 * *' },
  { label: '每 15 分钟（工作时段）', expr: '*/15 9-18 * * 1-5' },
  { label: '每天 00:12:30（6 段含秒）', expr: '30 12 0 * * *' },
];

/** Intl.supportedValuesOf 不可用时的兜底时区列表 */
const FALLBACK_ZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export async function mount(root, ctx) {
  ctx.loadStyle('tools/cron/style.css');

  /* ---------- 状态 ---------- */

  let savedCount = ctx.storage.get(STORAGE_KEYS.count, 10);
  if (!COUNT_OPTIONS.includes(savedCount)) savedCount = 10;
  const localTz = localTimeZone();
  let savedTz = ctx.storage.get(STORAGE_KEYS.tz, localTz);
  if (typeof savedTz !== 'string' || savedTz === '') savedTz = localTz;

  /** 最近一次渲染的结果（复制按钮取值用） */
  let lastDescription = '';
  let lastRunsText = '';

  /* ---------- 输入区 ---------- */

  const input = el('input', {
    type: 'text',
    id: 'cron-expr-input',
    'data-testid': 'cron-input',
    class: 'mono',
    placeholder: '如 */15 9-18 * * 1-5（分 时 日 月 周），6 段时首段为秒',
    spellcheck: 'false',
    autocomplete: 'off',
  });

  const inputCard = el(
    'section',
    { class: 'cron-card' },
    el('label', { class: 'field-label', for: 'cron-expr-input' }, 'Cron 表达式'),
    input,
    el(
      'p',
      { class: 'field-hint' },
      '支持 5 段（分 时 日 月 周）或 6 段（秒 分 时 日 月 周）；月 / 周可用英文缩写（JAN、MON），宏如 @daily、@weekly。所有解析都在浏览器本地完成。',
    ),
  );

  /* ---------- 常用示例 ---------- */

  const exampleButtons = EXAMPLES.map(({ label, expr }) =>
    el(
      'button',
      {
        type: 'button',
        class: 'btn btn-sm btn-ghost',
        'data-testid': 'cron-example',
        title: `填入 ${expr}`,
        onClick: () => {
          input.value = expr;
          runRefresh();
        },
      },
      label,
    ),
  );

  /* ---------- 选项 ---------- */

  const countSelect = el(
    'select',
    { id: 'cron-count', 'data-testid': 'cron-count' },
    COUNT_OPTIONS.map((n) => el('option', { value: String(n), selected: n === savedCount }, `${n} 次`)),
  );
  const tzSelect = el('select', { id: 'cron-tz', 'data-testid': 'cron-tz' });
  buildTimeZoneOptions(tzSelect, savedTz, localTz);

  /* ---------- 结果区 ---------- */

  const descriptionBox = el('div', { class: 'output-box', 'data-testid': 'cron-description' }, '');
  const descriptionCopy = copyButton(() => lastDescription, { label: '复制描述' });
  const macroHint = el('p', { class: 'field-hint', 'data-testid': 'cron-macro-hint', hidden: true }, '');
  const descriptionSection = el(
    'section',
    { class: 'cron-block' },
    el('div', { class: 'result-head' }, el('h2', { class: 'panel-title' }, '中文描述'), descriptionCopy),
    descriptionBox,
    macroHint,
  );

  const fieldsTbody = el('tbody');
  const fieldsTable = el(
    'table',
    { class: 'cron-table' },
    el(
      'thead',
      {},
      el('tr', {}, el('th', { scope: 'col' }, '字段'), el('th', { scope: 'col' }, '原文'), el('th', { scope: 'col' }, '展开后的取值')),
    ),
    fieldsTbody,
  );
  const fieldsSection = el(
    'section',
    { class: 'cron-block' },
    el('h2', { class: 'panel-title' }, '逐段解释'),
    el('div', { class: 'table-wrap' }, fieldsTable),
  );

  const runsList = el('ol', { class: 'cron-runs', 'data-testid': 'cron-runs' });
  const runsCopy = copyButton(() => lastRunsText, { label: '复制执行时间' });
  const neverBox = el(
    'div',
    { class: 'cron-never', 'data-testid': 'cron-never', hidden: true },
    `该表达式永远不会执行（或 ${SEARCH_LIMIT_YEARS} 年内不会执行）`,
  );
  const runsSection = el(
    'section',
    { class: 'cron-block' },
    el('div', { class: 'result-head' }, el('h2', { class: 'panel-title' }, '未来执行时间'), runsCopy),
    el('p', { class: 'field-hint' }, '按所选时区的本地时间显示；夏令时跳变时不存在的时刻自动跳过。'),
    runsList,
    neverBox,
  );

  const results = el(
    'div',
    { class: 'cron-results' },
    descriptionSection,
    fieldsSection,
    runsSection,
  );

  /* ---------- 组装 ---------- */

  root.append(
    el(
      'section',
      { class: 'tool cron' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
      ),
      inputCard,
      el(
        'div',
        { class: 'cron-examples', role: 'group', 'aria-label': '常用示例' },
        el('span', { class: 'field-label' }, '常用示例：'),
        ...exampleButtons,
      ),
      el(
        'div',
        { class: 'form-row cron-controls' },
        el('label', { class: 'field-label', for: 'cron-count' }, '显示次数'),
        countSelect,
        el('label', { class: 'field-label', for: 'cron-tz' }, '时区'),
        tzSelect,
      ),
      results,
    ),
  );

  /* ---------- 渲染 ---------- */

  function renderResults(result, nowMs) {
    clearError(inputCard);
    descriptionBox.textContent = result.description;
    lastDescription = result.description;
    macroHint.hidden = result.macro === null;
    macroHint.textContent = result.macro === null ? '' : `${result.macro} 等价于 ${result.expanded}`;

    fieldsTbody.replaceChildren(
      ...result.fields.map(({ label, source, values }) =>
        el(
          'tr',
          {},
          el('th', { scope: 'row' }, label),
          el('td', { class: 'mono' }, source),
          el('td', { class: 'mono' }, values),
        ),
      ),
    );

    runsList.replaceChildren(
      ...result.runs.map((run) =>
        el(
          'li',
          { class: 'cron-run', 'data-testid': 'cron-run' },
          el('span', { class: 'cron-run-time mono' }, formatRunTime(run, { withSeconds: result.hasSeconds })),
          el(
            'span',
            { class: 'cron-run-meta' },
            `距现在 ${humanizeDuration(run.epoch - nowMs).replace(/后$/, '')}（${formatOffset(run.offsetMs)}）`,
          ),
        ),
      ),
    );
    lastRunsText = result.runs
      .map((run) => {
        const time = formatRunTime(run, { withSeconds: result.hasSeconds });
        return `${time}（${humanizeDuration(run.epoch - nowMs)}，${formatOffset(run.offsetMs)}）`;
      })
      .join('\n');
    neverBox.hidden = result.runs.length > 0;
    results.hidden = false;
  }

  function renderEmpty() {
    clearError(inputCard);
    results.hidden = true;
    lastDescription = '';
    lastRunsText = '';
  }

  function renderError(message) {
    renderEmpty();
    showError(inputCard, message);
  }

  function runRefresh() {
    const text = input.value.trim();
    ctx.storage.set(STORAGE_KEYS.expr, input.value);
    ctx.storage.set(STORAGE_KEYS.count, Number(countSelect.value));
    ctx.storage.set(STORAGE_KEYS.tz, tzSelect.value);

    if (text === '') {
      renderEmpty();
      return;
    }
    const nowMs = Date.now();
    const result = analyze(text, { now: nowMs, tz: tzSelect.value, count: Number(countSelect.value) });
    if (result.ok) renderResults(result, nowMs);
    else renderError(result.message);
  }

  const refresh = debounce(runRefresh, REFRESH_DEBOUNCE_MS);

  /* ---------- 事件 ---------- */

  input.addEventListener('input', refresh);
  countSelect.addEventListener('change', runRefresh);
  tzSelect.addEventListener('change', runRefresh);

  /* ---------- 恢复上次状态并首刷 ---------- */

  const savedExpr = ctx.storage.get(STORAGE_KEYS.expr, DEFAULT_EXPR);
  if (typeof savedExpr === 'string' && savedExpr.trim() !== '') input.value = savedExpr;
  else input.value = DEFAULT_EXPR;

  runRefresh();

  /* ---------- 清理（离开工具时由外壳调用） ---------- */

  return () => {
    refresh.cancel();
  };
}

/** 填充时区下拉框：本地时区放最前，其余按地区分组 */
function buildTimeZoneOptions(select, current, localTz) {
  let zones;
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = FALLBACK_ZONES;
  }
  if (!Array.isArray(zones) || zones.length === 0) zones = FALLBACK_ZONES;

  const known = new Set([localTz, ...zones]);
  select.append(el('option', { value: localTz }, `本地（${localTz}）`));

  const groups = new Map();
  for (const zone of zones) {
    const area = zone.includes('/') ? zone.split('/')[0] : '通用';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(zone);
  }
  for (const area of [...groups.keys()].sort((a, b) => (a < b ? -1 : 1))) {
    select.append(
      el('optgroup', { label: area }, groups.get(area).map((zone) => el('option', { value: zone }, zone))),
    );
  }
  select.value = known.has(current) ? current : localTz;
}
