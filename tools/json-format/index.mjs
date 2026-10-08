/**
 * JSON 格式化 —— 工具入口（外壳在进入 #/json-format 时动态加载本模块）。
 *
 * 布局：左侧输入（带行号栏，出错行标红）＋ 右侧输出 / 状态 / 统计。
 * 行为：
 *   - 输入变化后 200ms 防抖自动执行当前操作（格式化 / 压缩 / 校验）；
 *   - 输入超过 1MB 时暂停自动执行（提示「输入较大…请点击按钮」），点按钮手动执行；
 *   - 出错时状态区显示「第 x 行第 y 列：原因」与上下文（^ 指示位置），行号栏标记出错行；
 *   - 输入（≤ 1MB）与选项经 ctx.storage 记住，刷新后恢复。
 */

import { el, copyButton, downloadBlob, debounce } from '../../assets/js/ui.mjs';
import { runAction } from './logic.mjs';

const STORAGE_KEY_INPUT = 'input'; // 实际存储键为 glm-toolbox:json-format:input
const STORAGE_KEY_OPTIONS = 'options'; // { action, indent, sortKeys }

const INPUT_MAX_AUTO_CHARS = 1024 * 1024; // 超过 1MB 暂停自动执行
const INPUT_MAX_STORE_CHARS = 1024 * 1024; // 超过 1MB 不写入 localStorage
const GUTTER_MAX_LINES = 5000; // 行号栏渲染上限，防止超大输入拖垮页面
const DEBOUNCE_MS = 200;

const ACTION_DEFS = [
  { key: 'format', label: '格式化' },
  { key: 'minify', label: '压缩' },
  { key: 'validate', label: '校验' },
];
const INDENT_VALUES = ['2', '4', 'tab'];
const STAT_DEFS = [
  { key: 'chars', label: '字符数' },
  { key: 'depth', label: '层级深度' },
  { key: 'keys', label: '键数量' },
];

export async function mount(root, ctx) {
  ctx.loadStyle('tools/json-format/style.css');

  /* ---------- 状态 ---------- */

  let action = 'format';
  let paused = false;
  let gutterLineCount = -1;
  let gutterErrorLine = null;
  let lastRevealedLine = null;

  /* ---------- DOM ---------- */

  const actionButtons = {};
  const statValues = {};

  const actionSeg = el(
    'div',
    { class: 'seg', role: 'group', 'aria-label': '操作' },
    ACTION_DEFS.map(({ key, label }) => {
      const btn = el(
        'button',
        {
          type: 'button',
          'data-testid': `json-format-${key}`,
          'aria-pressed': 'false',
          onClick: () => chooseAction(key),
        },
        label,
      );
      actionButtons[key] = btn;
      return btn;
    }),
  );

  const indentSelect = el(
    'select',
    {
      id: 'json-format-indent',
      'data-testid': 'json-format-indent',
      onChange: () => {
        persistOptions();
        runNow();
      },
    },
    [
      el('option', { value: '2' }, '2 空格'),
      el('option', { value: '4' }, '4 空格'),
      el('option', { value: 'tab' }, 'Tab'),
    ],
  );

  const sortCheckbox = el('input', {
    type: 'checkbox',
    id: 'json-format-sort',
    'data-testid': 'json-format-sort',
    onChange: () => {
      persistOptions();
      runNow();
    },
  });

  const gutter = el('div', { class: 'jf-gutter', 'data-testid': 'json-format-gutter', 'aria-hidden': 'true' });

  const inputTa = el('textarea', {
    id: 'json-format-input',
    'data-testid': 'json-format-input',
    'aria-label': 'JSON 输入',
    placeholder: '输入或粘贴 JSON，自动格式化；也可以粘贴日志片段查找语法错误…',
    spellcheck: 'false',
    wrap: 'off',
    autocapitalize: 'off',
    autocomplete: 'off',
    autocorrect: 'off',
  });

  const pauseHint = el(
    'p',
    { class: 'field-hint jf-pause-hint', 'data-testid': 'json-format-pause-hint', hidden: true },
    '输入较大，已暂停自动格式化，请点击按钮',
  );

  const outputTa = el('textarea', {
    id: 'json-format-output',
    'data-testid': 'json-format-output',
    'aria-label': '处理结果',
    placeholder: '结果会显示在这里',
    readonly: true,
    spellcheck: 'false',
    wrap: 'off',
  });

  const statusBox = el('div', {
    class: 'jf-status',
    'data-testid': 'json-format-status',
    role: 'status',
    'aria-live': 'polite',
  });

  const statsList = el(
    'dl',
    { class: 'stat-grid jf-stats', 'data-testid': 'json-format-stats' },
    STAT_DEFS.map(({ key, label }) => {
      const value = el('dd', { 'data-testid': `json-format-${key}` }, '—');
      statValues[key] = value;
      return el('div', { class: 'stat' }, el('dt', {}, label), value);
    }),
  );

  const copyBtn = copyButton(() => outputTa.value, { label: '复制结果' });

  const downloadBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'data-testid': 'json-format-download',
      onClick: () => {
        if (outputTa.value === '') return;
        downloadBlob(new Blob([outputTa.value], { type: 'application/json' }), 'data.json');
      },
    },
    '下载 .json',
  );

  const clearBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm btn-ghost',
      onClick: () => {
        inputTa.value = '';
        renderGutter(null);
        runNow();
        inputTa.focus();
      },
    },
    '清空',
  );

  root.append(
    el(
      'section',
      { class: 'tool json-format' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el('div', { class: 'tool-actions' }, copyBtn, downloadBtn),
      ),
      el(
        'div',
        { class: 'jf-toolbar' },
        actionSeg,
        el(
          'label',
          { class: 'jf-inline', for: 'json-format-indent' },
          '缩进',
          indentSelect,
        ),
        el(
          'label',
          { class: 'jf-inline jf-check', for: 'json-format-sort' },
          sortCheckbox,
          '按键名排序',
        ),
        el('span', { class: 'jf-spacer' }),
        clearBtn,
      ),
      el(
        'div',
        { class: 'jf-layout two-col' },
        el(
          'div',
          { class: 'jf-input-col' },
          el('label', { class: 'field-label', for: 'json-format-input' }, '输入'),
          el('div', { class: 'jf-editor' }, gutter, inputTa),
          pauseHint,
          el('p', { class: 'field-hint' }, '内容只保存在本地浏览器中，不会上传。'),
        ),
        el(
          'div',
          { class: 'jf-output-col' },
          el('label', { class: 'field-label', for: 'json-format-output' }, '输出'),
          outputTa,
          statusBox,
          statsList,
        ),
      ),
    ),
  );

  /* ---------- 行号栏 ---------- */

  function renderGutter(errorLine) {
    const text = inputTa.value;
    const count = text === '' ? 1 : text.split('\n').length;
    if (count === gutterLineCount && errorLine === gutterErrorLine) return;
    gutterLineCount = count;
    gutterErrorLine = errorLine;

    const limited = Math.min(count, GUTTER_MAX_LINES);
    const cells = [];
    for (let line = 1; line <= limited; line++) {
      cells.push(
        el(
          'div',
          {
            class: `jf-gutter-line${line === errorLine ? ' is-error' : ''}`,
            'data-line': String(line),
            'data-error': line === errorLine ? 'true' : null,
          },
          String(line),
        ),
      );
    }
    if (count > limited) cells.push(el('div', { class: 'jf-gutter-line jf-gutter-more' }, '…'));
    gutter.replaceChildren(...cells);
  }

  /** 出错行滚动到输入区可视范围内（只在出错行变化时执行） */
  function revealErrorLine(line) {
    if (line === lastRevealedLine) return;
    lastRevealedLine = line;
    const lineHeight = parseFloat(getComputedStyle(inputTa).lineHeight) || 21;
    const target = Math.max(0, (line - 1) * lineHeight - inputTa.clientHeight / 2 + lineHeight);
    if (Math.abs(target - inputTa.scrollTop) > inputTa.clientHeight * 0.5) {
      inputTa.scrollTop = target;
      gutter.scrollTop = inputTa.scrollTop;
    }
  }

  inputTa.addEventListener('scroll', () => {
    gutter.scrollTop = inputTa.scrollTop;
  });

  /* ---------- 执行 ---------- */

  function currentIndent() {
    return indentSelect.value === 'tab' ? 'tab' : Number(indentSelect.value);
  }

  function run() {
    const result = runAction(inputTa.value, {
      action,
      indent: currentIndent(),
      sortKeys: sortCheckbox.checked,
    });
    renderResult(result);
  }

  function renderResult(result) {
    outputTa.value = result.output;
    copyBtn.disabled = result.output === '';
    downloadBtn.disabled = result.output === '';

    statusBox.replaceChildren();
    if (result.status === 'empty') {
      statusBox.append(el('p', { class: 'jf-empty' }, result.message));
    } else if (result.status === 'valid') {
      statusBox.append(el('div', { class: 'ok-box', 'data-testid': 'json-format-ok' }, result.message));
    } else {
      statusBox.append(
        el('div', { class: 'error-box', 'data-testid': 'json-format-error' }, result.message),
        el('pre', { class: 'jf-error-context', 'data-testid': 'json-format-error-context' }, result.context),
      );
    }

    const errorLine = result.status === 'invalid' ? result.error.line : null;
    renderGutter(errorLine);
    if (errorLine !== null) revealErrorLine(errorLine);
    else lastRevealedLine = null;

    for (const { key } of STAT_DEFS) {
      statValues[key].textContent = result.stats ? String(result.stats[key]) : '—';
    }
  }

  function saveInput(text) {
    if (text.length <= INPUT_MAX_STORE_CHARS) ctx.storage.set(STORAGE_KEY_INPUT, text);
    else ctx.storage.remove(STORAGE_KEY_INPUT); // 超大输入不保存，同时清掉旧值
  }

  function syncPause(text) {
    paused = text.length > INPUT_MAX_AUTO_CHARS;
    pauseHint.hidden = !paused;
  }

  /** 输入变化：防抖自动执行；超大输入暂停自动执行 */
  const debouncedRun = debounce(() => {
    const text = inputTa.value;
    syncPause(text);
    saveInput(text);
    if (!paused) run();
  }, DEBOUNCE_MS);

  /** 立即执行（按钮 / 选项变化 / 清空），不受暂停限制 */
  function runNow() {
    debouncedRun.cancel();
    syncPause(inputTa.value);
    saveInput(inputTa.value);
    run();
  }

  function chooseAction(key) {
    action = key;
    syncActionSeg();
    persistOptions();
    runNow();
  }

  function syncActionSeg() {
    for (const { key } of ACTION_DEFS) {
      actionButtons[key].setAttribute('aria-pressed', key === action ? 'true' : 'false');
    }
  }

  function persistOptions() {
    ctx.storage.set(STORAGE_KEY_OPTIONS, {
      action,
      indent: indentSelect.value,
      sortKeys: sortCheckbox.checked,
    });
  }

  inputTa.addEventListener('input', () => {
    renderGutter(null); // 行号先跟上输入，错误标记等下一次执行再恢复
    debouncedRun();
  });

  /* ---------- 恢复上次输入与选项 ---------- */

  const savedOptions = ctx.storage.get(STORAGE_KEY_OPTIONS, null);
  if (savedOptions && typeof savedOptions === 'object') {
    if (ACTION_DEFS.some(({ key }) => key === savedOptions.action)) action = savedOptions.action;
    if (INDENT_VALUES.includes(savedOptions.indent)) indentSelect.value = savedOptions.indent;
    if (typeof savedOptions.sortKeys === 'boolean') sortCheckbox.checked = savedOptions.sortKeys;
  }
  syncActionSeg();

  const savedInput = ctx.storage.get(STORAGE_KEY_INPUT, '');
  if (typeof savedInput === 'string' && savedInput !== '') inputTa.value = savedInput;

  renderGutter(null);
  syncPause(inputTa.value);
  if (!paused) run(); // 恢复的内容立即执行一次；超大输入等用户点按钮

  /* ---------- 清理函数 ---------- */

  return () => {
    debouncedRun.cancel();
  };
}
