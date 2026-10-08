/**
 * SQL 格式化 —— 工具入口（外壳在进入 #/sql-format 时动态加载本模块）。
 *
 * 文件约定见仓库 CONTRIBUTING.md：
 *   tool.json 清单 / logic.mjs 纯逻辑 / logic.test.mjs 单测 /
 *   index.mjs UI（本文件，导出 mount(root, ctx)）/ ui.e2e.mjs 端到端测试 / style.css 私有样式。
 */

import { el, copyButton, debounce, showError, clearError } from '../../assets/js/ui.mjs';
import { formatSql, compressSql, SqlFormatError } from './logic.mjs';

/** 输入防抖（通用验收：输入变化后 ≤ 300ms 自动更新结果） */
const RUN_DEBOUNCE_MS = 150;

/** 「填入示例」按钮的内容：issue #6 的验收例 1 */
const SAMPLE_SQL =
  "select id,name from users u left join orders o on o.user_id=u.id where u.age>18 and o.status='已支付' order by o.created_at desc limit 10";

const DIALECT_OPTIONS = [
  { value: 'standard', label: '标准 SQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlite', label: 'SQLite' },
];

const CASE_OPTIONS = [
  { value: 'upper', label: '大写' },
  { value: 'lower', label: '小写' },
  { value: 'preserve', label: '保持原样' },
];

const INDENT_OPTIONS = [
  { value: '2', label: '2 空格' },
  { value: '4', label: '4 空格' },
];

export async function mount(root, ctx) {
  ctx.loadStyle('tools/sql-format/style.css');

  /* ---------- 状态（选项与输入经 ctx.storage 持久化，实际键形如 glm-toolbox:sql-format:<key>） ---------- */

  const state = {
    mode: ctx.storage.get('mode', 'format'),
    dialect: ctx.storage.get('dialect', 'standard'),
    keywordCase: ctx.storage.get('keywordCase', 'upper'),
    indent: ctx.storage.get('indent', 2),
    removeComments: ctx.storage.get('removeComments', false),
  };

  /* ---------- 构建 DOM ---------- */

  const input = el('textarea', {
    id: 'sql-format-input',
    'data-testid': 'sql-format-input',
    'aria-label': 'SQL 输入',
    placeholder: '输入或粘贴 SQL 语句，结果实时更新…',
    spellcheck: 'false',
  });

  const output = el('textarea', {
    id: 'sql-format-output',
    'data-testid': 'sql-format-output',
    'aria-label': '结果',
    placeholder: '格式化结果将显示在这里',
    readonly: '',
    spellcheck: 'false',
  });

  const statusBox = el('div', { class: 'sql-format-status', 'data-testid': 'sql-format-status' });

  const modeButtons = {};
  const modeSeg = el(
    'div',
    { class: 'seg', role: 'group', 'aria-label': '操作', 'data-testid': 'sql-format-mode' },
    ['format', 'compress'].map((mode) => {
      const btn = el(
        'button',
        {
          type: 'button',
          'aria-pressed': 'false',
          'data-testid': `sql-format-mode-${mode}`,
          onClick: () => setMode(mode),
        },
        mode === 'format' ? '格式化' : '压缩',
      );
      modeButtons[mode] = btn;
      return btn;
    }),
  );

  const dialectSelect = el(
    'select',
    { id: 'sql-format-dialect', 'aria-label': '方言', onChange: () => onOptionChange() },
    DIALECT_OPTIONS.map(({ value, label }) =>
      el('option', { value, selected: state.dialect === value || null }, label),
    ),
  );

  const caseSelect = el(
    'select',
    { id: 'sql-format-case', 'aria-label': '关键字大小写', onChange: () => onOptionChange() },
    CASE_OPTIONS.map(({ value, label }) =>
      el('option', { value, selected: state.keywordCase === value || null }, label),
    ),
  );

  const indentSelect = el(
    'select',
    { id: 'sql-format-indent', 'aria-label': '缩进', onChange: () => onOptionChange() },
    INDENT_OPTIONS.map(({ value, label }) =>
      el('option', { value, selected: String(state.indent) === value || null }, label),
    ),
  );

  const removeCommentsInput = el('input', {
    type: 'checkbox',
    id: 'sql-format-remove-comments',
    checked: state.removeComments || null,
    onChange: () => onOptionChange(),
  });

  root.append(
    el(
      'section',
      { class: 'tool sql-format' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el(
          'div',
          { class: 'tool-actions' },
          el(
            'button',
            { type: 'button', class: 'btn btn-sm', onClick: () => fillSample() },
            '填入示例',
          ),
          el('button', { type: 'button', class: 'btn btn-sm', onClick: () => clearAll() }, '清空'),
          copyButton(() => output.value, { label: '复制结果' }),
        ),
      ),
      el(
        'div',
        { class: 'form-row sql-format-options' },
        modeSeg,
        el(
          'div',
          { class: 'sql-format-opt' },
          el('label', { class: 'field-label', for: 'sql-format-dialect' }, '方言'),
          dialectSelect,
        ),
        el(
          'div',
          { class: 'sql-format-opt' },
          el('label', { class: 'field-label', for: 'sql-format-case' }, '关键字大小写'),
          caseSelect,
        ),
        el(
          'div',
          { class: 'sql-format-opt' },
          el('label', { class: 'field-label', for: 'sql-format-indent' }, '缩进'),
          indentSelect,
        ),
        el(
          'label',
          { class: 'sql-format-check', for: 'sql-format-remove-comments' },
          removeCommentsInput,
          el('span', {}, '压缩时删除注释'),
        ),
      ),
      el(
        'div',
        { class: 'sql-format-layout two-col' },
        el(
          'div',
          { class: 'sql-format-editor' },
          el('label', { class: 'field-label', for: 'sql-format-input' }, 'SQL 输入'),
          input,
          el('p', { class: 'field-hint' }, '支持单引号字符串、反引号 / 双引号标识符、注释与多语句；内容只在本地浏览器处理，不会上传。'),
        ),
        el(
          'div',
          { class: 'sql-format-result' },
          el('label', { class: 'field-label', for: 'sql-format-output' }, '结果'),
          output,
        ),
      ),
      statusBox,
    ),
  );

  /* ---------- 交互 ---------- */

  const getOptions = () => ({
    dialect: state.dialect,
    keywordCase: state.keywordCase,
    indent: state.indent,
    removeComments: state.removeComments,
  });

  const persist = () => {
    ctx.storage.set('mode', state.mode);
    ctx.storage.set('dialect', state.dialect);
    ctx.storage.set('keywordCase', state.keywordCase);
    ctx.storage.set('indent', state.indent);
    ctx.storage.set('removeComments', state.removeComments);
    ctx.storage.set('text', input.value);
  };

  /** 执行格式化 / 压缩；语法明显错误时给中文提示（含行列号），不让异常冒泡 */
  const run = () => {
    clearError(statusBox);
    const sql = input.value;
    if (sql.trim() === '') {
      output.value = '';
      persist();
      return;
    }
    try {
      output.value = state.mode === 'compress' ? compressSql(sql, getOptions()) : formatSql(sql, getOptions());
    } catch (err) {
      output.value = '';
      showError(
        statusBox,
        err instanceof SqlFormatError
          ? err.message
          : `处理失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    persist();
  };

  const debouncedRun = debounce(run, RUN_DEBOUNCE_MS);

  function setMode(mode) {
    state.mode = mode === 'compress' ? 'compress' : 'format';
    for (const [key, btn] of Object.entries(modeButtons)) {
      btn.setAttribute('aria-pressed', key === state.mode ? 'true' : 'false');
    }
    run();
  }

  function onOptionChange() {
    state.dialect = dialectSelect.value;
    state.keywordCase = caseSelect.value;
    state.indent = Number(indentSelect.value);
    state.removeComments = removeCommentsInput.checked;
    run();
  }

  function fillSample() {
    input.value = SAMPLE_SQL;
    run();
  }

  function clearAll() {
    input.value = '';
    run();
  }

  input.addEventListener('input', debouncedRun);

  /* ---------- 初始化：恢复上次输入并同步控件（先恢复输入，再触发首次运行，避免空跑覆写存储） ---------- */

  const savedText = ctx.storage.get('text', '');
  if (typeof savedText === 'string' && savedText !== '') input.value = savedText;

  dialectSelect.value = state.dialect;
  caseSelect.value = state.keywordCase;
  indentSelect.value = String(state.indent);
  removeCommentsInput.checked = Boolean(state.removeComments);
  setMode(state.mode); // 内部会 run() 一次

  /* ---------- 清理函数（离开工具时由外壳调用） ---------- */

  return () => {
    debouncedRun.cancel();
  };
}
