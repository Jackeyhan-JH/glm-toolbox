/**
 * Base64 编解码 —— 工具入口（外壳在进入 #/base64 时动态加载本模块）。
 *
 * 三种模式：
 *   文本  编码 / 解码（UTF-8，可选 URL 安全输出；解码容忍空白 / 缺失填充，
 *        同时接受标准与 URL 安全字母表；结果不是合法 UTF-8 时给出提示、
 *        十六进制预览与「下载为文件」）
 *   图片  上传 / 拖拽 / 粘贴图片 → 预览 + data URL + 纯 Base64；反向粘贴
 *        data URL 或纯 Base64（可选 MIME）→ 预览 + 下载
 *   文件  任意文件（≤ 20MB）→ Base64；Base64 → 下载文件（可填文件名）
 *
 * 所有纯逻辑在 ./logic.mjs；公共组件来自 assets/js/ui.mjs。
 */

import {
  clearError,
  copyButton,
  debounce,
  downloadBlob,
  el,
  readFileAsArrayBuffer,
  showError,
} from '../../assets/js/ui.mjs';
import {
  MAX_FILE_BYTES,
  bytesToBase64,
  checkFileSize,
  decodeBytes,
  decodeText,
  detectImageMime,
  encodeText,
  formatFileSize,
  hexPreview,
  mimeToExtension,
  parseDataUrl,
  toDataUrl,
  truncateForDisplay,
  utf8ByteLength,
} from './logic.mjs';

const DEBOUNCE_MS = 200; // 输入自动更新的防抖（约定 ≤ 300ms）
const MIME_OPTIONS = [
  { value: 'auto', label: '自动检测' },
  { value: 'image/png', label: 'PNG（image/png）' },
  { value: 'image/jpeg', label: 'JPEG（image/jpeg）' },
  { value: 'image/gif', label: 'GIF（image/gif）' },
  { value: 'image/webp', label: 'WebP（image/webp）' },
  { value: 'image/bmp', label: 'BMP（image/bmp）' },
  { value: 'image/svg+xml', label: 'SVG（image/svg+xml）' },
];

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

/**
 * 输出字段：输出框 + 字符计数 + 截断提示（「已截断显示，可复制 / 下载完整结果」）
 * + 复制按钮（复制完整内容）+ 截断时出现的「下载完整结果」按钮。
 */
function outputField({ label, testid, copyLabel, fileBase }) {
  let full = '';
  const box = el('div', { class: 'output-box', 'data-testid': testid });
  const count = el('span', { class: 'base64-count', 'data-testid': `${testid}-count` }, '');
  const note = el(
    'p',
    { class: 'field-hint base64-truncate-note', 'data-testid': `${testid}-truncated`, hidden: true },
    '已截断显示，可复制 / 下载完整结果',
  );
  const copy = copyButton(() => full, { label: copyLabel });
  const downloadFull = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      hidden: true,
      onClick: () => downloadBlob(new Blob([full], { type: 'text/plain;charset=utf-8' }), `${fileBase}.txt`),
    },
    '下载完整结果',
  );

  const field = el(
    'div',
    { class: 'base64-output-field' },
    el('div', { class: 'field-label' }, label, ' ', count),
    box,
    note,
    el('div', { class: 'tool-actions' }, copy, downloadFull),
  );

  return {
    field,
    /** 渲染完整输出（内部截断展示）；countText 缺省为「N 字符」 */
    render(text, countText) {
      full = text;
      const t = truncateForDisplay(text);
      box.textContent = t.text;
      count.textContent = countText ?? `${text.length} 字符`;
      note.hidden = !t.truncated;
      downloadFull.hidden = !t.truncated;
    },
  };
}

/* ==================== 挂载 ==================== */

export async function mount(root, ctx) {
  ctx.loadStyle('tools/base64/style.css');

  /* ---------- 面板：文本 ---------- */

  let textDirection = ctx.storage.get('direction', 'encode'); // 'encode' | 'decode'
  let urlSafe = ctx.storage.get('urlSafe', false);

  const textInput = el('textarea', {
    'data-testid': 'base64-text-input',
    spellcheck: 'false',
  });
  const textInputStats = el('p', { class: 'field-hint', 'data-testid': 'base64-text-input-stats' }, '');
  const textErrorWrap = el('div', { 'data-testid': 'base64-text-error' });

  const hexBox = el('div', { class: 'output-box base64-hex', 'data-testid': 'base64-hex' });
  const hexField = el(
    'div',
    { hidden: true },
    el('div', { class: 'field-label' }, '十六进制预览（前 256 字节）'),
    hexBox,
  );
  const downloadBytesBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      hidden: true,
      'data-testid': 'base64-download-bytes',
      onClick: () => {
        if (lastBytes) downloadBlob(new Blob([lastBytes]), 'decoded.bin');
      },
    },
    '下载为文件',
  );

  let lastBytes = null; // 解码结果不是 UTF-8 时的原始字节

  const textOutput = outputField({
    label: '输出',
    testid: 'base64-text-output',
    copyLabel: '复制结果',
    fileBase: 'base64-result',
  });

  function applyTextLabels() {
    if (textDirection === 'encode') {
      textInput.setAttribute('aria-label', '要编码的文本');
      textInput.setAttribute('placeholder', '输入要编码的文本，结果实时更新…');
    } else {
      textInput.setAttribute('aria-label', '要解码的 Base64');
      textInput.setAttribute('placeholder', '输入要解码的 Base64（容忍空白与缺失的填充）…');
    }
  }

  function refreshText() {
    clearError(textErrorWrap);
    hexField.hidden = true;
    downloadBytesBtn.hidden = true;
    lastBytes = null;

    const value = textInput.value;
    if (textDirection === 'encode') {
      const out = encodeText(value, { urlSafe: urlSafe });
      textOutput.render(out);
      textInputStats.textContent = `输入 ${value.length} 字符 · ${utf8ByteLength(value)} 字节（UTF-8）`;
      return;
    }

    textInputStats.textContent = `输入 ${value.length} 字符`;
    const r = decodeText(value);
    if (r.ok) {
      textOutput.render(r.text, `${r.bytes.length} 字节`);
      return;
    }
    textOutput.render('', '0 字节');
    if (r.bytes === null) {
      // Base64 本身非法
      showError(textErrorWrap, r.error);
      return;
    }
    // 字节合法但不是 UTF-8 文本：提示 + 十六进制预览 + 下载为文件
    lastBytes = r.bytes;
    showError(textErrorWrap, `${r.error}（共 ${r.bytes.length} 字节，可查看十六进制预览或下载为文件）`);
    const p = hexPreview(r.bytes);
    hexBox.textContent = p.hex + (p.truncated ? ` …（共 ${p.totalBytes} 字节，仅显示前 256 字节）` : '');
    hexField.hidden = false;
    downloadBytesBtn.hidden = false;
  }

  const refreshTextDebounced = debounce(refreshText, DEBOUNCE_MS);
  textInput.addEventListener('input', refreshTextDebounced);

  const urlSafeInput = el('input', {
    type: 'checkbox',
    id: 'base64-url-safe',
    'data-testid': 'base64-url-safe',
    checked: urlSafe ? true : null,
    onChange: () => {
      urlSafe = urlSafeInput.checked;
      ctx.storage.set('urlSafe', urlSafe);
      refreshText();
    },
  });

  const directionSeg = segControl(
    [
      { value: 'encode', label: '编码' },
      { value: 'decode', label: '解码' },
    ],
    textDirection,
    (value) => {
      textDirection = value;
      ctx.storage.set('direction', value);
      applyTextLabels();
      refreshText();
    },
  );

  const textPanel = el(
    'section',
    { class: 'base64-panel', 'data-testid': 'base64-panel-text' },
    el(
      'div',
      { class: 'form-row' },
      directionSeg.node,
      el('label', { class: 'base64-option', for: 'base64-url-safe' }, urlSafeInput, 'URL 安全（+ → -、/ → _、无填充）'),
    ),
    el(
      'div',
      { class: 'two-col' },
      el(
        'div',
        {},
        el('label', { class: 'field-label', for: 'base64-text-input' }, '输入'),
        textInput,
        textInputStats,
        el('p', { class: 'field-hint' }, '内容只在本地浏览器处理，不会上传。'),
      ),
      el(
        'div',
        {},
        textOutput.field,
        textErrorWrap,
        hexField,
        el('div', { class: 'tool-actions' }, downloadBytesBtn),
      ),
    ),
  );

  /* ---------- 面板：图片 ---------- */

  const imageFileInput = el('input', {
    type: 'file',
    accept: 'image/*',
    'data-testid': 'base64-image-file',
    'aria-label': '选择图片文件',
  });
  const dropzone = el(
    'label',
    { class: 'base64-dropzone', 'data-testid': 'base64-dropzone' },
    imageFileInput,
    el('p', { class: 'base64-dropzone-title' }, '点击选择图片，或将图片拖拽 / 粘贴（Ctrl + V）到此处'),
    el('p', { class: 'field-hint' }, `支持 PNG / JPEG / GIF / WebP / BMP / SVG，不超过 ${formatFileSize(MAX_FILE_BYTES)}`),
  );

  const imgPreview = el('img', { class: 'base64-img-preview', alt: '图片预览', 'data-testid': 'base64-img-preview' });
  const imgMeta = el(
    'dl',
    { class: 'base64-meta', hidden: true, 'data-testid': 'base64-img-meta' },
    el('div', {}, el('dt', {}, '尺寸'), el('dd', { 'data-testid': 'base64-img-size' }, '—')),
    el('div', {}, el('dt', {}, '文件大小'), el('dd', { 'data-testid': 'base64-img-bytes' }, '—')),
    el('div', {}, el('dt', {}, 'MIME'), el('dd', { 'data-testid': 'base64-img-mime' }, '—')),
  );
  const imageErrorWrap = el('div', { 'data-testid': 'base64-image-error' });
  const dataUrlOutput = outputField({
    label: 'Data URL',
    testid: 'base64-dataurl-output',
    copyLabel: '复制 Data URL',
    fileBase: 'image-data-url',
  });
  const b64Output = outputField({
    label: '纯 Base64',
    testid: 'base64-b64-output',
    copyLabel: '复制 Base64',
    fileBase: 'image-base64',
  });

  imgPreview.addEventListener('load', () => {
    imgMeta.querySelector('[data-testid="base64-img-size"]').textContent =
      `${imgPreview.naturalWidth} × ${imgPreview.naturalHeight}`;
  });
  imgPreview.addEventListener('error', () => showError(imageErrorWrap, '图片加载失败：文件可能已损坏'));

  async function handleImageFile(file) {
    clearError(imageErrorWrap);
    if (!file) return;
    const sizeError = checkFileSize(file.size);
    if (sizeError) {
      showError(imageErrorWrap, sizeError);
      return;
    }
    try {
      const bytes = new Uint8Array(await readFileAsArrayBuffer(file));
      const mime = file.type !== '' ? file.type : detectImageMime(bytes) ?? 'application/octet-stream';
      const base64 = bytesToBase64(bytes);
      dataUrlOutput.render(toDataUrl(mime, base64));
      b64Output.render(base64, `输入 ${formatFileSize(file.size)}`);
      imgMeta.hidden = false;
      imgMeta.querySelector('[data-testid="base64-img-bytes"]').textContent = formatFileSize(file.size);
      imgMeta.querySelector('[data-testid="base64-img-mime"]').textContent = mime;
      imgPreview.src = toDataUrl(mime, base64);
    } catch (err) {
      showError(imageErrorWrap, `读取文件失败：${err.message}`);
    }
  }

  imageFileInput.addEventListener('change', () => {
    handleImageFile(imageFileInput.files?.[0]);
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
    handleImageFile(event.dataTransfer?.files?.[0]);
  });

  /* ----- 图片反向：Base64 → 图片 ----- */

  const revInput = el('textarea', {
    'data-testid': 'base64-img-input',
    rows: '4',
    spellcheck: 'false',
    'aria-label': '要还原的图片 Data URL 或 Base64',
    placeholder: '粘贴 data:image/png;base64,… 或纯 Base64…',
  });
  const mimeSelect = el(
    'select',
    { id: 'base64-mime-select', 'data-testid': 'base64-mime-select', 'aria-label': '图片 MIME 类型' },
    MIME_OPTIONS.map(({ value, label }) => el('option', { value }, label)),
  );
  const revErrorWrap = el('div', { 'data-testid': 'base64-img-rev-error' });
  const revImg = el('img', { class: 'base64-img-preview', alt: '还原的图片预览', 'data-testid': 'base64-img-rev-preview' });
  const revImgWrap = el('div', { class: 'base64-rev-preview', hidden: true }, revImg);
  const revMeta = el(
    'dl',
    { class: 'base64-meta', hidden: true, 'data-testid': 'base64-img-rev-meta' },
    el('div', {}, el('dt', {}, '尺寸'), el('dd', { 'data-testid': 'base64-img-rev-size' }, '—')),
    el('div', {}, el('dt', {}, '数据大小'), el('dd', { 'data-testid': 'base64-img-rev-bytes' }, '—')),
    el('div', {}, el('dt', {}, 'MIME'), el('dd', { 'data-testid': 'base64-img-rev-mime' }, '—')),
  );
  const revStats = el('p', { class: 'field-hint', 'data-testid': 'base64-img-rev-stats' }, '');
  let revBytes = null;
  let revMime = null;
  const revDownload = el(
    'button',
    {
      type: 'button',
      class: 'btn',
      hidden: true,
      'data-testid': 'base64-img-download',
      onClick: () => {
        if (revBytes) downloadBlob(new Blob([revBytes], { type: revMime }), `image.${mimeToExtension(revMime)}`);
      },
    },
    '下载图片',
  );

  revImg.addEventListener('load', () => {
    revMeta.querySelector('[data-testid="base64-img-rev-size"]').textContent =
      `${revImg.naturalWidth} × ${revImg.naturalHeight}`;
  });

  function refreshReverse() {
    clearError(revErrorWrap);
    revImgWrap.hidden = true;
    revMeta.hidden = true;
    revDownload.hidden = true;
    revBytes = null;
    revMime = null;
    // 不清空 src（清空可能触发多余的 error 事件），隐藏预览即可

    const raw = revInput.value;
    if (raw.trim() === '') {
      revStats.textContent = '';
      return;
    }
    const parsed = parseDataUrl(raw);
    let bytes;
    try {
      bytes = decodeBytes(parsed ? parsed.base64 : raw);
    } catch (err) {
      revStats.textContent = '';
      showError(revErrorWrap, err.message);
      return;
    }
    revStats.textContent = `输出 ${formatFileSize(bytes.length)}`;

    let mime;
    if (parsed) {
      mime = parsed.mime;
    } else if (mimeSelect.value !== 'auto') {
      mime = mimeSelect.value;
    } else {
      mime = detectImageMime(bytes);
      if (mime === null) {
        showError(revErrorWrap, '无法识别图片类型，请在「MIME 类型」下拉框中手动选择');
        return;
      }
    }

    revBytes = bytes;
    revMime = mime;
    revImgWrap.hidden = false;
    revMeta.hidden = false;
    revMeta.querySelector('[data-testid="base64-img-rev-bytes"]').textContent = formatFileSize(bytes.length);
    revMeta.querySelector('[data-testid="base64-img-rev-mime"]').textContent = mime;
    revDownload.hidden = false;
    revImg.onerror = () => {
      showError(revErrorWrap, '图片加载失败：Base64 数据可能不是有效的图片');
    };
    revImg.src = toDataUrl(mime, bytesToBase64(bytes));
  }

  const refreshReverseDebounced = debounce(refreshReverse, DEBOUNCE_MS);
  revInput.addEventListener('input', refreshReverseDebounced);
  mimeSelect.addEventListener('change', refreshReverse);

  const imagePanel = el(
    'section',
    { class: 'base64-panel', 'data-testid': 'base64-panel-image', hidden: true },
    el(
      'div',
      { class: 'two-col' },
      el(
        'div',
        {},
        el('div', { class: 'field-label' }, '图片 → Base64'),
        dropzone,
        el('div', { class: 'base64-preview' }, imgPreview, imgMeta),
        imageErrorWrap,
      ),
      el('div', {}, dataUrlOutput.field, b64Output.field),
    ),
    el(
      'div',
      { class: 'base64-reverse' },
      el('div', { class: 'field-label' }, 'Base64 → 图片'),
      el(
        'div',
        { class: 'form-row' },
        el('label', { class: 'base64-option', for: 'base64-mime-select' }, 'MIME 类型 ', mimeSelect),
      ),
      revInput,
      revStats,
      revErrorWrap,
      el('div', { class: 'base64-rev-result' }, revImgWrap, revMeta, el('div', { class: 'tool-actions' }, revDownload)),
    ),
  );

  /* ---------- 面板：文件 ---------- */

  const fileInput = el('input', {
    type: 'file',
    'data-testid': 'base64-file-input',
    'aria-label': '选择要编码的文件',
  });
  const fileMeta = el('p', { class: 'field-hint', 'data-testid': 'base64-file-meta' }, '未选择文件');
  const fileErrorWrap = el('div', { 'data-testid': 'base64-file-error' });
  const fileOutput = outputField({
    label: 'Base64 输出',
    testid: 'base64-file-output',
    copyLabel: '复制结果',
    fileBase: 'base64-result',
  });

  fileInput.addEventListener('change', async () => {
    clearError(fileErrorWrap);
    const file = fileInput.files?.[0];
    if (!file) {
      fileMeta.textContent = '未选择文件';
      fileOutput.render('', '0 字符');
      return;
    }
    const sizeError = checkFileSize(file.size);
    if (sizeError) {
      fileMeta.textContent = '未选择文件';
      fileOutput.render('', '0 字符');
      showError(fileErrorWrap, sizeError);
      return;
    }
    try {
      const bytes = new Uint8Array(await readFileAsArrayBuffer(file));
      fileMeta.textContent = `输入 ${file.name} · ${formatFileSize(file.size)}`;
      fileOutput.render(bytesToBase64(bytes));
    } catch (err) {
      showError(fileErrorWrap, `读取文件失败：${err.message}`);
    }
  });

  /* ----- 文件反向：Base64 → 文件 ----- */

  const fileRevInput = el('textarea', {
    'data-testid': 'base64-file-b64-input',
    rows: '4',
    spellcheck: 'false',
    'aria-label': '要还原为文件的 Base64',
    placeholder: '粘贴 Base64，自动解码，可指定文件名后下载…',
  });
  const fileNameInput = el('input', {
    type: 'text',
    id: 'base64-file-name',
    'data-testid': 'base64-file-name-input',
    'aria-label': '下载文件名',
    value: 'decoded.bin',
  });
  const fileRevErrorWrap = el('div', { 'data-testid': 'base64-file-rev-error' });
  const fileRevStats = el('p', { class: 'field-hint', 'data-testid': 'base64-file-rev-stats' }, '');
  let fileRevBytes = null;
  const fileRevDownload = el(
    'button',
    {
      type: 'button',
      class: 'btn',
      disabled: true,
      'data-testid': 'base64-file-download',
      onClick: () => {
        if (!fileRevBytes) return;
        const name = fileNameInput.value.trim() || 'decoded.bin';
        downloadBlob(new Blob([fileRevBytes]), name);
      },
    },
    '下载文件',
  );

  function refreshFileReverse() {
    clearError(fileRevErrorWrap);
    fileRevBytes = null;
    fileRevDownload.disabled = true;
    const raw = fileRevInput.value;
    if (raw.trim() === '') {
      fileRevStats.textContent = '';
      return;
    }
    try {
      fileRevBytes = decodeBytes(raw);
    } catch (err) {
      fileRevStats.textContent = '';
      showError(fileRevErrorWrap, err.message);
      return;
    }
    fileRevStats.textContent = `输出 ${formatFileSize(fileRevBytes.length)}`;
    fileRevDownload.disabled = false;
  }

  const refreshFileReverseDebounced = debounce(refreshFileReverse, DEBOUNCE_MS);
  fileRevInput.addEventListener('input', refreshFileReverseDebounced);

  const filePanel = el(
    'section',
    { class: 'base64-panel', 'data-testid': 'base64-panel-file', hidden: true },
    el(
      'div',
      { class: 'two-col' },
      el(
        'div',
        {},
        el('label', { class: 'field-label', for: 'base64-file-input' }, `文件 → Base64（不超过 ${formatFileSize(MAX_FILE_BYTES)}）`),
        fileInput,
        fileMeta,
        fileErrorWrap,
      ),
      el('div', {}, fileOutput.field),
    ),
    el(
      'div',
      { class: 'base64-reverse' },
      el('div', { class: 'field-label' }, 'Base64 → 文件'),
      fileRevInput,
      el(
        'div',
        { class: 'form-row' },
        el('label', { class: 'base64-option', for: 'base64-file-name' }, '文件名 ', fileNameInput),
        fileRevDownload,
      ),
      fileRevStats,
      fileRevErrorWrap,
    ),
  );

  /* ---------- 模式切换与组装 ---------- */

  const panels = { text: textPanel, image: imagePanel, file: filePanel };
  const initialMode = panels[ctx.storage.get('mode', 'text')] ? ctx.storage.get('mode', 'text') : 'text';
  const modeSeg = segControl(
    [
      { value: 'text', label: '文本' },
      { value: 'image', label: '图片' },
      { value: 'file', label: '文件' },
    ],
    initialMode,
    (value) => {
      for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== value;
      ctx.storage.set('mode', value);
    },
  );
  for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== initialMode;

  root.append(
    el(
      'section',
      { class: 'tool base64' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        modeSeg.node,
      ),
      textPanel,
      imagePanel,
      filePanel,
    ),
  );

  applyTextLabels();
  refreshText();

  /* ---------- 粘贴图片（仅图片模式生效，挂在 document 上需在清理时移除） ---------- */

  const onPaste = (event) => {
    if (imagePanel.hidden) return;
    const item = Array.from(event.clipboardData?.items ?? []).find(
      (i) => i.kind === 'file' && i.type.startsWith('image/'),
    );
    const file = item?.getAsFile();
    if (!file) return;
    event.preventDefault();
    handleImageFile(file);
  };
  document.addEventListener('paste', onPaste);

  /* ---------- 清理函数 ---------- */

  return () => {
    refreshTextDebounced.cancel();
    refreshReverseDebounced.cancel();
    refreshFileReverseDebounced.cancel();
    document.removeEventListener('paste', onPaste);
  };
}
