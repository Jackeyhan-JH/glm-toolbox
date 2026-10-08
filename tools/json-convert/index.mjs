/**
 * JSON 转换 —— 工具入口（外壳在进入 #/json-convert 时动态加载本模块）。
 *
 * 四种模式（JSON → YAML / YAML → JSON / JSON → CSV / CSV → JSON），
 * 左输入右输出，「交换」把输出放回输入并反转模式；输入变化防抖后自动转换。
 * 纯逻辑在 logic.mjs（及其编排的 json.mjs / yaml.mjs / csv.mjs），本文件只做 DOM 与状态。
 */

import { el, copyButton, showError, clearError, downloadBlob, debounce } from '../../assets/js/ui.mjs';
import { convert, MODES, swapMode, downloadName, CSV_DELIMITERS } from './logic.mjs';

const KEY_MODE = 'mode';
const KEY_INPUT = 'input';
const KEY_DELIMITER = 'csv-delimiter';
const KEY_AUTODETECT = 'csv-auto-detect';
const KEY_BOM = 'csv-bom';
const RUN_DEBOUNCE_MS = 200; // 通用验收：防抖 ≤ 300ms

const PLACEHOLDERS = {
  'json-yaml': '粘贴 JSON，如 {"name":"码工具箱","tags":["json"]}',
  'yaml-json': '粘贴 YAML，如\nname: 码工具箱\ntags:\n  - json',
  'json-csv': '粘贴对象数组 JSON，如 [{"id":1,"name":"张三"}]',
  'csv-json': '粘贴 CSV 文本，第一行为表头，如\nid,name\n1,张三',
};

export async function mount(root, ctx) {
  ctx.loadStyle('tools/json-convert/style.css');

  /* ---------- 读取持久化状态 ---------- */

  const savedMode = ctx.storage.get(KEY_MODE, 'json-yaml');
  const mode0 = MODES.some((m) => m.id === savedMode) ? savedMode : 'json-yaml';
  const delimiter0 = CSV_DELIMITERS.some((d) => d.id === ctx.storage.get(KEY_DELIMITER, 'auto'))
    ? ctx.storage.get(KEY_DELIMITER, 'auto')
    : 'auto';
  const state = {
    mode: mode0,
    delimiter: delimiter0,
    autoDetect: ctx.storage.get(KEY_AUTODETECT, true) !== false,
    bom: ctx.storage.get(KEY_BOM, false) === true,
  };

  /* ---------- 构建 DOM ---------- */

  const modeButtons = MODES.map((m) =>
    el('button', { type: 'button', class: 'seg-btn', 'aria-pressed': 'false', onClick: () => setMode(m.id) }, m.label),
  );

  const delimiterSelect = el(
    'select',
    { id: 'json-convert-delimiter', 'aria-label': '分隔符' },
    CSV_DELIMITERS.map((d) => el('option', { value: d.id }, d.label)),
  );
  const delimiterLabel = el(
    'label',
    { class: 'option-item', for: 'json-convert-delimiter' },
    '分隔符',
  );

  const autoDetectLabel = el(
    'label',
    { class: 'option-item' },
    el('input', { type: 'checkbox', id: 'json-convert-autodetect' }),
    '自动识别数字和布尔',
  );
  const bomLabel = el(
    'label',
    { class: 'option-item' },
    el('input', { type: 'checkbox', id: 'json-convert-bom' }),
    '带 BOM（Excel 打开不乱码）',
  );

  const inputEl = el('textarea', {
    id: 'json-convert-input',
    'data-testid': 'json-convert-input',
    'aria-label': '输入',
    spellcheck: 'false',
  });
  const outputEl = el('textarea', {
    id: 'json-convert-output',
    'data-testid': 'json-convert-output',
    'aria-label': '输出',
    readonly: '',
    spellcheck: 'false',
    placeholder: '转换结果会显示在这里',
  });

  const noticeEl = el('p', { class: 'notice-box', 'data-testid': 'json-convert-notice', hidden: true });
  const statusEl = el('div', { class: 'json-convert-status', 'data-testid': 'json-convert-status' }, noticeEl);

  const swapBtn = el(
    'button',
    { type: 'button', class: 'btn btn-sm', 'data-testid': 'json-convert-swap', title: '把输出放回输入，并反转转换方向' },
    '交换',
  );
  const downloadBtn = el(
    'button',
    { type: 'button', class: 'btn btn-sm', 'data-testid': 'json-convert-download', title: '把结果下载为文件' },
    '下载',
  );

  root.append(
    el(
      'section',
      { class: 'tool json-convert' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el(
          'div',
          { class: 'tool-actions' },
          swapBtn,
          copyButton(() => outputEl.value, { label: '复制结果' }),
          downloadBtn,
        ),
      ),
      el(
        'div',
        { class: 'form-row json-convert-controls' },
        el('div', { class: 'seg', role: 'group', 'aria-label': '转换方向', 'data-testid': 'json-convert-mode' }, modeButtons),
        delimiterLabel,
        delimiterSelect,
        autoDetectLabel,
        bomLabel,
      ),
      statusEl,
      el(
        'div',
        { class: 'two-col json-convert-layout' },
        el(
          'div',
          { class: 'json-convert-pane' },
          el('label', { class: 'field-label', for: 'json-convert-input' }, '输入'),
          inputEl,
          el('p', { class: 'field-hint' }, '所有转换都在浏览器本地完成，不会上传。'),
        ),
        el(
          'div',
          { class: 'json-convert-pane' },
          el('label', { class: 'field-label', for: 'json-convert-output' }, '输出'),
          outputEl,
        ),
      ),
    ),
  );

  /* ---------- 交互 ---------- */

  let running = 0; // 防抖期间的执行序号，避免旧结果覆盖新结果

  function run() {
    const seq = (running += 1);
    const input = inputEl.value;
    try {
      const { output, notice } = convert(state.mode, input, {
        csvDelimiter: state.delimiter,
        csvAutoDetect: state.autoDetect,
      });
      if (seq !== running) return;
      outputEl.value = output;
      if (notice) {
        noticeEl.textContent = notice;
        noticeEl.hidden = false;
      } else {
        noticeEl.hidden = true;
      }
      clearError(statusEl);
    } catch (err) {
      if (seq !== running) return;
      outputEl.value = '';
      noticeEl.hidden = true;
      showError(statusEl, err instanceof Error ? err.message : String(err));
    }
    swapBtn.disabled = outputEl.value === '';
    downloadBtn.disabled = outputEl.value === '';
    ctx.storage.set(KEY_INPUT, input);
  }

  const debouncedRun = debounce(run, RUN_DEBOUNCE_MS);
  inputEl.addEventListener('input', debouncedRun);

  function setMode(id) {
    state.mode = id;
    ctx.storage.set(KEY_MODE, id);
    for (const [i, m] of MODES.entries()) {
      modeButtons[i].setAttribute('aria-pressed', m.id === id ? 'true' : 'false');
    }
    inputEl.placeholder = PLACEHOLDERS[id] ?? '';
    const csvMode = id === 'csv-json' || id === 'json-csv';
    delimiterLabel.hidden = !csvMode;
    delimiterSelect.hidden = !csvMode;
    autoDetectLabel.hidden = id !== 'csv-json';
    bomLabel.hidden = id !== 'json-csv';
    run();
  }

  function setDelimiter(id) {
    state.delimiter = id;
    ctx.storage.set(KEY_DELIMITER, id);
    run();
  }

  delimiterSelect.addEventListener('change', () => setDelimiter(delimiterSelect.value));
  autoDetectLabel.querySelector('input').addEventListener('change', (e) => {
    state.autoDetect = e.target.checked;
    ctx.storage.set(KEY_AUTODETECT, state.autoDetect);
    run();
  });
  bomLabel.querySelector('input').addEventListener('change', (e) => {
    state.bom = e.target.checked;
    ctx.storage.set(KEY_BOM, state.bom);
  });

  swapBtn.addEventListener('click', () => {
    const text = outputEl.value;
    if (text === '') return;
    inputEl.value = text;
    setMode(swapMode(state.mode));
    inputEl.focus();
  });

  downloadBtn.addEventListener('click', () => {
    const text = outputEl.value;
    if (text === '') return;
    const withBom = state.mode === 'json-csv' && state.bom;
    // 带 BOM 时在文件开头写入 U+FEFF（Excel 打开中文 CSV 不乱码的关键）
    const content = withBom ? '\uFEFF' + text : text;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, downloadName(state.mode));
  });

  /* ---------- 初始化 ---------- */

  delimiterSelect.value = state.delimiter;
  autoDetectLabel.querySelector('input').checked = state.autoDetect;
  bomLabel.querySelector('input').checked = state.bom;
  const saved = ctx.storage.get(KEY_INPUT, '');
  if (typeof saved === 'string' && saved !== '') inputEl.value = saved;
  setMode(state.mode); // 同步按钮态与选项可见性，并立即转换一次

  return () => {
    debouncedRun.cancel();
  };
}
