/**
 * 哈希计算 —— 工具入口（外壳在进入 #/hash 时动态加载本模块）。
 *
 * 功能：
 *   - 同时计算并显示 MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512（每行可单独复制）；
 *   - 输入支持文本（UTF-8）与文件（点击 / 拖拽，≤ 200MB）；
 *   - HMAC：勾选后输入密钥（文本 / 十六进制 / Base64），5 种算法同步输出；
 *   - 输出格式：小写十六进制（默认）/ 大写十六进制 / Base64，切换即时生效；
 *   - 比对框：粘贴期望摘要，忽略大小写与首尾空白，自动标出匹配 ✓ / ✗；
 *   - 文件计算在 Web Worker（./worker.mjs）中进行，不阻塞界面，可随时取消。
 *
 * 纯逻辑在 ./logic.mjs；公共组件来自 assets/js/ui.mjs。
 */

import { clearError, copyButton, debounce, el, showError } from '../../assets/js/ui.mjs';
import {
  HMAC_ALGORITHMS,
  KEY_FORMATS,
  MAX_FILE_BYTES,
  OUTPUT_FORMATS,
  PLAIN_ALGORITHMS,
  checkFileSize,
  compareDigests,
  computeDigests,
  computeHmacs,
  formatDigest,
  formatFileSize,
  parseKey,
  textToBytes,
} from './logic.mjs';

const DEBOUNCE_MS = 200; // 输入自动更新的防抖（约定 ≤ 300ms）

/* ==================== 小部件辅助 ==================== */

/** 分段切换（.seg）：items = [{ value, label }]，返回 { node } */
function segControl(ariaLabel, items, initial, onPick) {
  const buttons = new Map();
  const node = el(
    'div',
    { class: 'seg', role: 'group', 'aria-label': ariaLabel },
    items.map(({ value, label }) => {
      const btn = el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(value === initial),
          onClick: () => {
            for (const [v, b] of buttons) b.setAttribute('aria-pressed', String(v === value));
            onPick(value);
          },
        },
        label,
      );
      buttons.set(value, btn);
      return btn;
    }),
  );
  return { node };
}

/**
 * 结果行：算法名 + 比对标记（✓ / ✗）+ 复制按钮 + 摘要值。
 * 返回 { row, value, mark }；mark 在比对框有内容时显示。
 */
function resultRow({ id, label }) {
  const value = el('div', { class: 'output-box hash-value', 'data-testid': `hash-value-${id}` }, '');
  const mark = el(
    'span',
    { class: 'hash-mark', 'data-testid': `hash-match-${id}`, 'aria-label': '比对结果', hidden: true },
    '',
  );
  const copy = copyButton(() => value.textContent, { label: `复制${label}` });
  const row = el(
    'div',
    { class: 'hash-row' },
    el(
      'div',
      { class: 'hash-row-head' },
      el('span', { class: 'hash-row-label' }, label),
      mark,
      el('span', { class: 'hash-row-actions' }, copy),
    ),
    value,
  );
  return { row, value, mark };
}

/* ==================== 挂载 ==================== */

export async function mount(root, ctx) {
  ctx.loadStyle('tools/hash/style.css');

  /* ---------- 状态 ---------- */

  const initialMode = ['text', 'file'].includes(ctx.storage.get('mode', 'text'))
    ? ctx.storage.get('mode', 'text')
    : 'text';
  let mode = initialMode;
  let outputFormat = OUTPUT_FORMATS.some((f) => f.value === ctx.storage.get('outputFormat', 'hex-lower'))
    ? ctx.storage.get('outputFormat', 'hex-lower')
    : 'hex-lower';
  let hmacEnabled = ctx.storage.get('hmacEnabled', false) === true;
  let keyFormat = KEY_FORMATS.some((f) => f.value === ctx.storage.get('keyFormat', 'utf8'))
    ? ctx.storage.get('keyFormat', 'utf8')
    : 'utf8';

  let currentFile = null; // 当前（或最近一次）选择的文件
  let plainDigests = null; // 当前展示的 5 种摘要 { md5, sha1, … }
  let hmacDigests = null; // 当前展示的 5 种 HMAC（未启用 / 密钥非法时为 null）
  let lastFileRun = null; // 上一次完成的文件计算 { file, hmacKey, digests, hmacs }，用于复用

  /* ---------- 结果行 ---------- */

  const rows = new Map();
  const plainSection = el(
    'div',
    { class: 'hash-rows' },
    PLAIN_ALGORITHMS.map((a) => {
      const row = resultRow(a);
      rows.set(a.id, row);
      return row.row;
    }),
  );
  const hmacSection = el(
    'div',
    { class: 'hash-rows hash-rows-hmac', 'data-testid': 'hash-hmac-rows', hidden: true },
    el('div', { class: 'field-label' }, 'HMAC'),
    HMAC_ALGORITHMS.map((a) => {
      const row = resultRow(a);
      rows.set(a.id, row);
      return row.row;
    }),
  );

  /* ---------- 比对 ---------- */

  const compareInput = el('input', {
    type: 'text',
    id: 'hash-compare-input',
    class: 'hash-compare-input',
    'data-testid': 'hash-compare-input',
    spellcheck: 'false',
    placeholder: '粘贴期望的摘要，自动标出匹配的算法…',
  });
  const compareStatus = el(
    'p',
    { class: 'hash-compare-status', 'data-testid': 'hash-compare-status', hidden: true },
    '',
  );

  /* ---------- 文本面板 ---------- */

  const textInput = el('textarea', {
    id: 'hash-text-input',
    'data-testid': 'hash-text-input',
    spellcheck: 'false',
    placeholder: '输入要计算的文本，结果实时更新…',
  });
  textInput.setAttribute('aria-label', '要计算的文本');
  const textStats = el('p', { class: 'field-hint', 'data-testid': 'hash-text-stats' }, '');

  const textPanel = el(
    'section',
    { class: 'hash-panel', 'data-testid': 'hash-panel-text' },
    el('label', { class: 'field-label', for: 'hash-text-input' }, '输入文本'),
    textInput,
    textStats,
    el('p', { class: 'field-hint' }, '内容只在本地浏览器处理，不会上传。'),
  );

  /* ---------- 文件面板 ---------- */

  const fileInput = el('input', {
    type: 'file',
    'data-testid': 'hash-file-input',
    'aria-label': '选择要计算的文件',
  });
  const dropzone = el(
    'label',
    { class: 'hash-dropzone', 'data-testid': 'hash-dropzone' },
    fileInput,
    el('p', { class: 'hash-dropzone-title' }, '点击选择文件，或将文件拖拽到此处'),
    el('p', { class: 'field-hint' }, `大小不超过 ${formatFileSize(MAX_FILE_BYTES)}，计算过程不阻塞页面`),
  );
  const fileMeta = el('p', { class: 'field-hint', 'data-testid': 'hash-file-meta' }, '未选择文件');
  const fileErrorWrap = el('div', { 'data-testid': 'hash-file-error' });

  const progressBar = el('div', { class: 'hash-progress-bar', 'data-testid': 'hash-progress-bar' });
  const progressTrack = el(
    'div',
    { class: 'hash-progress-track', role: 'progressbar', 'aria-label': '计算进度', 'aria-valuemin': '0', 'aria-valuemax': '100' },
    progressBar,
  );
  const progressStatus = el('p', { class: 'field-hint', 'data-testid': 'hash-progress-status' }, '');
  const progressWrap = el(
    'div',
    { class: 'hash-progress', 'data-testid': 'hash-progress', hidden: true },
    progressTrack,
    progressStatus,
  );
  const cancelBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'data-testid': 'hash-cancel',
      hidden: true,
      onClick: () => cancelRun(),
    },
    '取消计算',
  );

  const filePanel = el(
    'section',
    { class: 'hash-panel', 'data-testid': 'hash-panel-file', hidden: true },
    el('div', { class: 'field-label' }, `输入文件（不超过 ${formatFileSize(MAX_FILE_BYTES)}）`),
    dropzone,
    fileMeta,
    progressWrap,
    el('div', { class: 'tool-actions' }, cancelBtn),
    fileErrorWrap,
  );

  /* ---------- 选项：输出格式 / HMAC ---------- */

  const formatSeg = segControl('输出格式', OUTPUT_FORMATS, outputFormat, (value) => {
    outputFormat = value;
    ctx.storage.set('outputFormat', value);
    renderResults(); // 只影响展示，无需重新计算
  });

  const hmacCheckbox = el('input', {
    type: 'checkbox',
    id: 'hash-hmac-enable',
    'data-testid': 'hash-hmac-enable',
    checked: hmacEnabled ? true : null,
    onChange: () => {
      hmacEnabled = hmacCheckbox.checked;
      ctx.storage.set('hmacEnabled', hmacEnabled);
      keyRow.hidden = !hmacEnabled;
      refresh();
    },
  });

  const keyFormatSelect = el(
    'select',
    { id: 'hash-key-format', 'data-testid': 'hash-key-format', 'aria-label': '密钥格式' },
    KEY_FORMATS.map(({ value, label }) => el('option', { value }, label)),
  );
  keyFormatSelect.value = keyFormat;

  const keyInput = el('input', {
    type: 'text',
    id: 'hash-key-input',
    class: 'hash-key-input',
    'data-testid': 'hash-key-input',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  keyInput.setAttribute('aria-label', 'HMAC 密钥');
  const keyErrorWrap = el('div', { 'data-testid': 'hash-key-error' });

  function applyKeyPlaceholder() {
    const hints = {
      utf8: '输入密钥文本（UTF-8）…',
      hex: '输入十六进制密钥，如 6b6579…',
      base64: '输入 Base64 密钥，如 a2V5…',
    };
    keyInput.setAttribute('placeholder', hints[keyFormat] ?? hints.utf8);
  }

  const keyRow = el(
    'div',
    { class: 'form-row hash-key-row', hidden: true },
    el('label', { class: 'hash-option', for: 'hash-key-format' }, '密钥格式 ', keyFormatSelect),
    el('label', { class: 'hash-option hash-key-wrap', for: 'hash-key-input' }, '密钥 ', keyInput),
  );

  /* ---------- 计算：文本 ---------- */

  let textSeq = 0;

  /** 解析当前 HMAC 密钥：未启用返回 { key: null }；非法返回中文错误（空密钥也不允许） */
  function effectiveHmacKey() {
    if (!hmacEnabled) return { key: null, error: null };
    try {
      const key = parseKey(keyInput.value, keyFormat);
      if (key.length === 0) {
        return { key: null, error: '请输入 HMAC 密钥（WebCrypto 不支持空密钥）' };
      }
      return { key, error: null };
    } catch (err) {
      return { key: null, error: err.message };
    }
  }

  async function refreshText() {
    const seq = ++textSeq;
    const { key, error } = effectiveHmacKey();
    if (error) showError(keyErrorWrap, error);
    else clearError(keyErrorWrap);

    const text = textInput.value;
    const bytes = textToBytes(text);
    textStats.textContent = `输入 ${[...text].length} 字符 · ${bytes.length} 字节（UTF-8）`;

    const digests = await computeDigests(bytes);
    const hmacs = key ? await computeHmacs(key, bytes) : null;
    if (seq !== textSeq) return; // 期间输入又变化，交给最新一次
    plainDigests = digests;
    hmacDigests = hmacs;
    renderResults();
  }

  /* ---------- 计算：文件（Worker） ---------- */

  let worker = null;
  let runSeq = 0;
  let runStartedAt = 0;

  function ensureWorker() {
    if (worker === null) {
      worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
      worker.addEventListener('message', (event) => onWorkerMessage(event.data));
    }
    return worker;
  }

  function terminateWorker() {
    if (worker !== null) {
      worker.terminate();
      worker = null;
    }
  }

  function onWorkerMessage(msg) {
    if (!msg || msg.id !== runSeq) return; // 过期消息（已取消 / 已被新计算取代）
    if (msg.type === 'progress') {
      setProgress(msg.loaded / msg.total, `已处理 ${formatFileSize(msg.loaded)} / ${formatFileSize(msg.total)}`);
    } else if (msg.type === 'done') {
      plainDigests = msg.digests;
      hmacDigests = msg.hmacs;
      lastFileRun = {
        file: currentFile,
        hmacKey: msg.hmacs ? lastPostedKey : null,
        digests: msg.digests,
        hmacs: msg.hmacs,
      };
      renderResults();
      setProgress(1, `计算完成，耗时 ${((performance.now() - runStartedAt) / 1000).toFixed(1)} 秒`);
      cancelBtn.hidden = true;
    } else if (msg.type === 'error') {
      showError(fileErrorWrap, `计算失败：${msg.message}`);
      progressWrap.hidden = true;
      cancelBtn.hidden = true;
    }
  }

  let lastPostedKey = null; // 与在途请求配套的密钥（Uint8Array | null）

  function setProgress(ratio, statusText) {
    progressWrap.hidden = false;
    const percent = Math.round(ratio * 100);
    progressBar.style.width = `${percent}%`;
    progressTrack.setAttribute('aria-valuenow', String(percent));
    progressStatus.textContent = statusText;
  }

  function bytesEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function runFile(file) {
    const seq = ++runSeq;
    terminateWorker(); // 取消在途计算（换文件 / 改密钥）
    currentFile = file;
    plainDigests = null;
    hmacDigests = null;
    lastFileRun = null;
    clearError(fileErrorWrap);
    renderResults();

    const sizeError = checkFileSize(file.size);
    if (sizeError) {
      fileMeta.textContent = '未选择文件';
      progressWrap.hidden = true;
      cancelBtn.hidden = true;
      showError(fileErrorWrap, sizeError);
      return;
    }

    const { key, error } = effectiveHmacKey();
    if (error) showError(keyErrorWrap, error);
    else clearError(keyErrorWrap);

    fileMeta.textContent = `输入 ${file.name} · ${formatFileSize(file.size)}`;
    setProgress(0, '准备中…');
    cancelBtn.hidden = false;
    runStartedAt = performance.now();
    lastPostedKey = key;
    ensureWorker().postMessage({ type: 'hash', id: seq, file, hmacKey: key });
  }

  function cancelRun() {
    runSeq += 1; // 丢弃在途消息
    terminateWorker();
    plainDigests = null;
    hmacDigests = null;
    lastFileRun = null;
    renderResults();
    progressWrap.hidden = false; // 保留进度区展示「已取消」
    progressStatus.textContent = '已取消';
    cancelBtn.hidden = true;
  }

  /** 进入 / 刷新文件模式：选项未变时复用上一次结果，否则重新计算 */
  function refreshFile() {
    const { key, error } = effectiveHmacKey();
    if (error) showError(keyErrorWrap, error);
    else clearError(keyErrorWrap);
    if (
      currentFile &&
      lastFileRun &&
      lastFileRun.file === currentFile &&
      bytesEqual(lastFileRun.hmacKey, key) &&
      lastFileRun.digests
    ) {
      plainDigests = lastFileRun.digests;
      hmacDigests = lastFileRun.hmacs;
      fileMeta.textContent = `输入 ${currentFile.name} · ${formatFileSize(currentFile.size)}（结果来自上次计算）`;
      progressWrap.hidden = true;
      cancelBtn.hidden = true;
      clearError(fileErrorWrap);
      renderResults();
      return;
    }
    if (currentFile) {
      runFile(currentFile);
      return;
    }
    plainDigests = null;
    hmacDigests = null;
    renderResults();
  }

  /* ---------- 刷新调度 ---------- */

  function refresh() {
    if (mode === 'text') refreshText();
    else refreshFile();
  }
  const refreshDebounced = debounce(refresh, DEBOUNCE_MS);
  const renderCompareDebounced = debounce(renderCompare, DEBOUNCE_MS);

  /* ---------- 渲染 ---------- */

  function renderResults() {
    for (const { id } of PLAIN_ALGORITHMS) {
      rows.get(id).value.textContent = plainDigests ? formatDigest(plainDigests[id], outputFormat) : '';
    }
    hmacSection.hidden = !hmacEnabled;
    for (const { id } of HMAC_ALGORITHMS) {
      // 行 id 是 hmac-md5 等，摘要对象的键是 md5 等
      const algoId = id.replace('hmac-', '');
      rows.get(id).value.textContent = hmacDigests ? formatDigest(hmacDigests[algoId], outputFormat) : '';
    }
    renderCompare();
  }

  function renderCompare() {
    const entries = [
      ...PLAIN_ALGORITHMS.map((a) => ({ id: a.id, label: a.label, bytes: plainDigests?.[a.id] ?? null })),
      ...HMAC_ALGORITHMS.map((a) => ({ id: a.id, label: a.label, bytes: hmacDigests?.[a.id.replace('hmac-', '')] ?? null })),
    ];
    const result = compareDigests(compareInput.value, entries);

    for (const entry of entries) {
      const mark = rows.get(entry.id).mark;
      if (!result.active || !entry.bytes) {
        mark.hidden = true;
        continue;
      }
      mark.hidden = false;
      mark.textContent = result.matches[entry.id] ? '✓' : '✗';
      mark.classList.toggle('is-ok', result.matches[entry.id]);
    }

    if (!result.active || !entries.some((e) => e.bytes)) {
      compareStatus.hidden = true;
      return;
    }
    compareStatus.hidden = false;
    if (result.matched.length > 0) {
      const labels = result.matched.map((id) => entries.find((e) => e.id === id).label).join('、');
      compareStatus.textContent = `✓ 与 ${labels} 匹配`;
      compareStatus.classList.add('is-ok');
      compareStatus.classList.remove('is-bad');
    } else {
      compareStatus.textContent = '✗ 没有任何算法与期望值匹配';
      compareStatus.classList.add('is-bad');
      compareStatus.classList.remove('is-ok');
    }
  }

  /* ---------- 事件 ---------- */

  textInput.addEventListener('input', refreshDebounced);
  keyInput.addEventListener('input', refreshDebounced);
  compareInput.addEventListener('input', renderCompareDebounced);

  keyFormatSelect.addEventListener('change', () => {
    keyFormat = keyFormatSelect.value;
    ctx.storage.set('keyFormat', keyFormat);
    applyKeyPlaceholder();
    refresh();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      currentFile = null;
      lastFileRun = null;
      plainDigests = null;
      hmacDigests = null;
      runSeq += 1;
      terminateWorker();
      clearError(fileErrorWrap);
      fileMeta.textContent = '未选择文件';
      progressWrap.hidden = true;
      cancelBtn.hidden = true;
      renderResults();
      return;
    }
    runFile(file);
  });

  for (const type of ['dragover', 'dragenter']) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-over');
    });
  }
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-over');
    const file = event.dataTransfer?.files?.[0];
    if (file) runFile(file);
  });

  const modeSeg = segControl(
    '输入类型',
    [
      { value: 'text', label: '文本' },
      { value: 'file', label: '文件' },
    ],
    mode,
    (value) => {
      mode = value;
      ctx.storage.set('mode', value);
      textPanel.hidden = value !== 'text';
      filePanel.hidden = value !== 'file';
      progressWrap.hidden = value !== 'file';
      if (value === 'text') refreshText();
      else refreshFile();
    },
  );

  /* ---------- 组装 ---------- */

  root.append(
    el(
      'section',
      { class: 'tool hash' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
      ),
      el(
        'div',
        { class: 'form-row hash-options' },
        modeSeg.node,
        el('span', { class: 'hash-option-sep' }, '输出格式'),
        formatSeg.node,
        el('label', { class: 'hash-option', for: 'hash-hmac-enable' }, hmacCheckbox, '启用 HMAC'),
      ),
      keyRow,
      keyErrorWrap,
      el(
        'div',
        { class: 'two-col' },
        el('div', {}, textPanel, filePanel),
        el(
          'section',
          { class: 'hash-results' },
          el('div', { class: 'field-label' }, '摘要结果'),
          plainSection,
          hmacSection,
          el(
            'div',
            { class: 'hash-compare' },
            el('label', { class: 'field-label', for: 'hash-compare-input' }, '比对'),
            compareInput,
            el('p', { class: 'field-hint' }, '粘贴期望摘要（十六进制或 Base64），忽略首尾空白，十六进制忽略大小写。'),
            compareStatus,
          ),
        ),
      ),
    ),
  );

  /* ---------- 初始化 ---------- */

  keyRow.hidden = !hmacEnabled;
  applyKeyPlaceholder();
  textPanel.hidden = mode !== 'text';
  filePanel.hidden = mode !== 'file';
  refresh();

  /* ---------- 清理函数 ---------- */

  return () => {
    refreshDebounced.cancel();
    renderCompareDebounced.cancel();
    terminateWorker();
  };
}
