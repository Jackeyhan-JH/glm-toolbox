/**
 * 二维码 —— 工具入口（外壳在进入 #/qrcode 时动态加载本模块）。
 *
 * 生成：
 *   - 输入文本（UTF-8，支持中文 / emoji）实时生成二维码（防抖 ≤ 300ms）；
 *   - 选项：纠错级别 L / M / Q / H（默认 M）、尺寸 128–1024px（默认 256）、
 *     边距 0–10 模块（默认 4）、前景色 / 背景色；
 *   - 显示版本号（1–40）、模块数与输入字节数；
 *   - 超出容量提示「内容过长，当前纠错级别最多约 N 字节」；
 *     前景 / 背景对比度 < 3:1 提示「颜色对比度低，可能无法扫描」；
 *   - 下载 PNG / 下载 SVG / 复制图片到剪贴板（浏览器支持时）。
 *
 * 识别：
 *   - 上传 / 拖拽 / 粘贴（Ctrl + V）图片，在 Web Worker 中识别（大图不卡页面）；
 *   - 识别出的文本可复制；若是 URL 显示为链接（不自动打开）；
 *   - 识别失败提示「未识别到二维码」。
 *
 * 所有输入与选项经 ctx.storage 记忆；纯逻辑在 ./logic.mjs；公共组件来自 assets/js/ui.mjs。
 */

import { clearError, copyButton, debounce, downloadBlob, el, readFileAsDataURL, showError } from '../../assets/js/ui.mjs';
import {
  DEFAULT_LEVEL,
  DEFAULT_MARGIN,
  DEFAULT_SIZE,
  EC_LEVELS,
  EMPTY_HINT,
  MAX_MARGIN,
  MAX_SIZE,
  MIN_MARGIN,
  MIN_SIZE,
  clampInt,
  createQr,
  isLinkText,
  isLowContrast,
  matrixToSvg,
  normalizeHexColor,
} from './logic.mjs';

const DEBOUNCE_MS = 200; // 输入自动更新的防抖（约定 ≤ 300ms）
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 识别图片大小上限
const MAX_DECODE_DIM = 2000; // 超过此边长先等比缩小再识别（纯本地降采样）
const DECODE_TIMEOUT_MS = 15000; // 识别超时（worker 终止）
const DECODE_TIMEOUT_MESSAGE = '识别超时，请换一张小一些的图片重试。';

export async function mount(root, ctx) {
  ctx.loadStyle('tools/qrcode/style.css');

  /* ---------- 状态 ---------- */

  const readString = (key, fallback) => {
    const v = ctx.storage.get(key, fallback);
    return typeof v === 'string' ? v : fallback;
  };
  let level = EC_LEVELS.some((it) => it.value === readString('level', '')) ? readString('level', DEFAULT_LEVEL) : DEFAULT_LEVEL;
  let size = clampInt(ctx.storage.get('size', DEFAULT_SIZE), MIN_SIZE, MAX_SIZE, DEFAULT_SIZE);
  let margin = clampInt(ctx.storage.get('margin', DEFAULT_MARGIN), MIN_MARGIN, MAX_MARGIN, DEFAULT_MARGIN);
  let foreground = normalizeHexColor(readString('fg', '#000000')) ?? '#000000';
  let background = normalizeHexColor(readString('bg', '#ffffff')) ?? '#ffffff';

  let lastQr = null; // 最近一次生成成功的结果（下载 / 复制用）
  let lastDecoded = ''; // 最近一次识别出的文本（复制用）
  let seq = 0; // 识别请求序号：过期的 worker 结果一律忽略
  let worker = null;
  let workerTimer = null;

  /* ==================== 生成区 ==================== */

  const textInput = el('textarea', {
    id: 'qrcode-input',
    'data-testid': 'qrcode-input',
    'aria-label': '要生成的内容',
    placeholder: '输入文本或链接，二维码实时生成…（支持中文与 emoji）',
    spellcheck: 'false',
    rows: '3',
  });

  const levelSelect = el(
    'select',
    { id: 'qrcode-level', 'data-testid': 'qrcode-level' },
    EC_LEVELS.map(({ value, label: text }) => el('option', { value }, text)),
  );
  levelSelect.value = level;

  const sizeInput = el('input', {
    id: 'qrcode-size',
    type: 'number',
    min: String(MIN_SIZE),
    max: String(MAX_SIZE),
    step: '1',
    value: String(size),
    'data-testid': 'qrcode-size',
  });

  const marginInput = el('input', {
    id: 'qrcode-margin',
    type: 'number',
    min: String(MIN_MARGIN),
    max: String(MAX_MARGIN),
    step: '1',
    value: String(margin),
    'data-testid': 'qrcode-margin',
  });

  const fgInput = el('input', {
    id: 'qrcode-fg',
    type: 'color',
    value: foreground,
    'data-testid': 'qrcode-fg',
    'aria-label': '前景色（码点颜色）',
  });
  const bgInput = el('input', {
    id: 'qrcode-bg',
    type: 'color',
    value: background,
    'data-testid': 'qrcode-bg',
    'aria-label': '背景色',
  });

  const genStatus = el('div', {}); // showError 的挂载容器
  const contrastWarning = el(
    'p',
    { class: 'qrcode-warn', 'data-testid': 'qrcode-contrast-warning', hidden: true },
    '颜色对比度低，可能无法扫描',
  );

  const metaVersion = el('span', { 'data-testid': 'qrcode-version' }, '');
  const metaModules = el('span', { 'data-testid': 'qrcode-modules' }, '');
  const metaBytes = el('span', { 'data-testid': 'qrcode-bytes' }, '');
  const metaRow = el(
    'p',
    { class: 'qrcode-meta', 'data-testid': 'qrcode-meta', hidden: true },
    metaVersion,
    el('span', { class: 'qrcode-meta-sep' }, ' · '),
    metaModules,
    el('span', { class: 'qrcode-meta-sep' }, ' · '),
    metaBytes,
  );

  const canvas = el('canvas', {
    class: 'qrcode-canvas',
    'data-testid': 'qrcode-canvas',
    role: 'img',
    'aria-label': '二维码预览',
  });
  const emptyHint = el(
    'p',
    { class: 'qrcode-empty', 'data-testid': 'qrcode-empty', hidden: true },
    EMPTY_HINT,
  );

  const downloadPngBtn = el(
    'button',
    { type: 'button', class: 'btn', 'data-testid': 'qrcode-download-png', onClick: downloadPng },
    '下载 PNG',
  );
  const downloadSvgBtn = el(
    'button',
    { type: 'button', class: 'btn', 'data-testid': 'qrcode-download-svg', onClick: downloadSvg },
    '下载 SVG',
  );
  const copyImageBtn = el(
    'button',
    { type: 'button', class: 'btn', 'data-testid': 'qrcode-copy-image', onClick: copyImage },
    '复制图片',
  );
  // 浏览器不支持图片写剪贴板（如缺少 ClipboardItem）时隐藏复制图片按钮
  const supportsImageClipboard =
    typeof window !== 'undefined' &&
    typeof window.ClipboardItem === 'function' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === 'function';
  if (!supportsImageClipboard) copyImageBtn.hidden = true;

  const generatePanel = el(
    'section',
    { class: 'qrcode-panel', 'aria-label': '生成二维码' },
    el('span', { class: 'field-label' }, '要生成的内容'),
    textInput,
    el(
      'p',
      { class: 'field-hint' },
      '支持中文与 emoji（UTF-8）。纠错级别越高越耐污损，可容纳的内容也越少。所有处理都在本地完成。',
    ),
    el(
      'div',
      { class: 'qrcode-options', role: 'group', 'aria-label': '生成选项' },
      el('label', { class: 'qrcode-option', for: 'qrcode-level' }, '纠错级别', levelSelect),
      el('label', { class: 'qrcode-option', for: 'qrcode-size' }, '尺寸（px）', sizeInput),
      el('label', { class: 'qrcode-option', for: 'qrcode-margin' }, '边距（模块）', marginInput),
      el('label', { class: 'qrcode-option', for: 'qrcode-fg' }, '前景色', fgInput),
      el('label', { class: 'qrcode-option', for: 'qrcode-bg' }, '背景色', bgInput),
    ),
    genStatus,
    contrastWarning,
    metaRow,
    el(
      'div',
      { class: 'qrcode-stage' },
      el('div', { class: 'qrcode-canvas-wrap' }, canvas, emptyHint),
    ),
    el('div', { class: 'tool-actions' }, downloadPngBtn, downloadSvgBtn, copyImageBtn),
  );

  /* ==================== 识别区 ==================== */

  const fileInput = el('input', {
    type: 'file',
    accept: 'image/*',
    'data-testid': 'qrcode-file',
    'aria-label': '选择图片文件',
  });
  const dropzone = el(
    'label',
    { class: 'qrcode-dropzone', 'data-testid': 'qrcode-dropzone' },
    fileInput,
    el('p', { class: 'qrcode-dropzone-title' }, '点击选择图片，或将图片拖拽 / 粘贴（Ctrl + V）到此处'),
    el('p', { class: 'field-hint' }, '识别在本地 Web Worker 中完成，不上传。支持 PNG / JPEG / GIF / WebP / BMP，最大 10MB。'),
  );

  const preview = el('img', { class: 'qrcode-img-preview', alt: '识别图片预览', 'data-testid': 'qrcode-preview' });
  const imageSize = el('dd', { 'data-testid': 'qrcode-image-size' }, '—');
  const imageBytes = el('dd', { 'data-testid': 'qrcode-image-bytes' }, '—');
  const previewMeta = el(
    'dl',
    { class: 'qrcode-meta', 'data-testid': 'qrcode-image-meta' },
    el('div', {}, el('dt', {}, '尺寸'), imageSize),
    el('div', {}, el('dt', {}, '文件大小'), imageBytes),
  );
  const previewWrap = el(
    'div',
    { class: 'qrcode-preview-wrap', hidden: true, 'data-testid': 'qrcode-preview-wrap' },
    preview,
    previewMeta,
  );

  const decodeStatus = el('div', {}); // showError 的挂载容器
  const resultBox = el('div', { class: 'output-box qrcode-result', 'data-testid': 'qrcode-result' });
  const resultWrap = el(
    'div',
    { class: 'qrcode-result-wrap', hidden: true, 'data-testid': 'qrcode-result-wrap' },
    el('span', { class: 'field-label' }, '识别结果'),
    resultBox,
    el(
      'p',
      { class: 'field-hint' },
      '链接仅为展示，不会自动打开；复制后请自行确认内容安全。',
    ),
    el('div', { class: 'tool-actions' }, copyButton(() => lastDecoded, { label: '复制识别结果' })),
  );

  const decodePanel = el(
    'section',
    { class: 'qrcode-panel qrcode-decode', 'aria-label': '识别二维码' },
    el('span', { class: 'field-label' }, '识别图片中的二维码'),
    dropzone,
    previewWrap,
    decodeStatus,
    resultWrap,
  );

  root.append(
    el(
      'section',
      { class: 'tool qrcode' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
      ),
      generatePanel,
      decodePanel,
    ),
  );

  /* ==================== 生成：渲染与下载 ==================== */

  function renderCanvas(result) {
    const total = result.moduleCount + margin * 2; // 含边距的总模块数
    // 先按「每模块 1px」画到离屏位图，再整体放大（关平滑），任意尺寸都是整齐的纯色块
    const offscreen = el('canvas', { width: String(total), height: String(total) });
    const offCtx = offscreen.getContext('2d');
    offCtx.fillStyle = background;
    offCtx.fillRect(0, 0, total, total);
    offCtx.fillStyle = foreground;
    for (let row = 0; row < result.moduleCount; row += 1) {
      for (let col = 0; col < result.moduleCount; col += 1) {
        if (result.matrix[row][col]) offCtx.fillRect(margin + col, margin + row, 1, 1);
      }
    }
    canvas.width = size;
    canvas.height = size;
    const ctx2d = canvas.getContext('2d');
    ctx2d.imageSmoothingEnabled = false;
    ctx2d.drawImage(offscreen, 0, 0, size, size);
  }

  function refresh() {
    // 选项写回存储（记住上次设置）
    ctx.storage.set('level', level);
    ctx.storage.set('size', size);
    ctx.storage.set('margin', margin);
    ctx.storage.set('fg', foreground);
    ctx.storage.set('bg', background);
    ctx.storage.set('text', textInput.value);

    lastQr = null;
    clearError(genStatus);

    if (textInput.value === '') {
      canvas.hidden = true;
      emptyHint.hidden = false;
      metaRow.hidden = true;
      contrastWarning.hidden = true;
      downloadPngBtn.disabled = true;
      downloadSvgBtn.disabled = true;
      copyImageBtn.disabled = true;
      return;
    }

    const result = createQr(textInput.value, { level });
    if (result.ok !== true) {
      canvas.hidden = true;
      emptyHint.hidden = true;
      metaRow.hidden = true;
      contrastWarning.hidden = true;
      showError(genStatus, result.error);
      downloadPngBtn.disabled = true;
      downloadSvgBtn.disabled = true;
      copyImageBtn.disabled = true;
      return;
    }

    lastQr = result;
    renderCanvas(result);
    canvas.hidden = false;
    emptyHint.hidden = true;
    metaVersion.textContent = `版本 ${result.version}`;
    metaModules.textContent = `${result.moduleCount} × ${result.moduleCount} 模块`;
    metaBytes.textContent = `${result.byteLength} 字节`;
    metaRow.hidden = false;
    contrastWarning.hidden = !isLowContrast(foreground, background);
    downloadPngBtn.disabled = false;
    downloadSvgBtn.disabled = false;
    copyImageBtn.disabled = false;
  }

  const scheduleRefresh = debounce(refresh, DEBOUNCE_MS);

  function downloadPng() {
    if (!lastQr) return;
    renderCanvas(lastQr); // 确保与当前尺寸 / 颜色一致
    canvas.toBlob(
      (blob) => {
        if (blob) downloadBlob(blob, 'qrcode.png');
        else showError(genStatus, '生成 PNG 失败，请重试。');
      },
      'image/png',
    );
  }

  function downloadSvg() {
    if (!lastQr) return;
    const svg = matrixToSvg(lastQr.matrix, { margin, foreground, background, size });
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'qrcode.svg');
  }

  async function copyImage() {
    if (!lastQr) return;
    const label = copyImageBtn.textContent;
    try {
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), 'image/png');
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      copyImageBtn.textContent = '已复制';
    } catch {
      copyImageBtn.textContent = '复制失败';
    }
    setTimeout(() => {
      copyImageBtn.textContent = label;
    }, 1500);
  }

  /* ---------- 生成：选项交互 ---------- */

  textInput.addEventListener('input', scheduleRefresh);

  levelSelect.addEventListener('change', () => {
    level = levelSelect.value;
    refresh();
  });
  sizeInput.addEventListener('input', () => {
    size = clampInt(sizeInput.value, MIN_SIZE, MAX_SIZE, DEFAULT_SIZE);
    scheduleRefresh();
  });
  sizeInput.addEventListener('blur', () => {
    size = clampInt(sizeInput.value, MIN_SIZE, MAX_SIZE, DEFAULT_SIZE);
    sizeInput.value = String(size);
    refresh();
  });
  marginInput.addEventListener('input', () => {
    margin = clampInt(marginInput.value, MIN_MARGIN, MAX_MARGIN, DEFAULT_MARGIN);
    scheduleRefresh();
  });
  marginInput.addEventListener('blur', () => {
    margin = clampInt(marginInput.value, MIN_MARGIN, MAX_MARGIN, DEFAULT_MARGIN);
    marginInput.value = String(margin);
    refresh();
  });
  fgInput.addEventListener('input', () => {
    foreground = normalizeHexColor(fgInput.value) ?? foreground;
    scheduleRefresh();
  });
  bgInput.addEventListener('input', () => {
    background = normalizeHexColor(bgInput.value) ?? background;
    scheduleRefresh();
  });

  /* ==================== 识别 ==================== */

  function formatBytes(n) {
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  }

  /** 读取图片为可绘制的位图（优先 createImageBitmap，失败退回 <img>） */
  async function loadImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close(),
        };
      } catch {
        // 落到 <img> 兜底
      }
    }
    const url = URL.createObjectURL(file);
    const img = el('img');
    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = url;
      });
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  }

  /** 图片 → RGBA 像素（超大图等比缩小到 MAX_DECODE_DIM 内，识别更快且足够） */
  async function imageToRgba(file) {
    const image = await loadImage(file);
    try {
      const scale = Math.min(1, MAX_DECODE_DIM / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const offscreen = el('canvas', { width: String(width), height: String(height) });
      const ctx2d = offscreen.getContext('2d', { willReadFrequently: true });
      ctx2d.drawImage(image.source, 0, 0, width, height);
      return ctx2d.getImageData(0, 0, width, height);
    } finally {
      image.close();
    }
  }

  function terminateWorker() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (workerTimer !== null) {
      clearTimeout(workerTimer);
      workerTimer = null;
    }
  }

  function renderDecodeResult(payload) {
    if (payload.ok !== true) {
      resultWrap.hidden = true;
      showError(decodeStatus, payload.error);
      return;
    }
    clearError(decodeStatus);
    lastDecoded = payload.text;
    const text = payload.text;
    if (isLinkText(text)) {
      resultBox.replaceChildren(
        el('a', { href: text, class: 'qrcode-link', target: '_blank', rel: 'noopener noreferrer' }, text),
      );
    } else {
      resultBox.textContent = text;
    }
    resultWrap.hidden = false;
  }

  function runDecode(imageData) {
    seq += 1;
    const id = seq;
    terminateWorker();
    clearError(decodeStatus);
    resultWrap.hidden = true;

    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || msg.type !== 'result' || msg.id !== id) return;
      terminateWorker(); // 本次识别结束，下次重建
      renderDecodeResult(msg);
    });
    worker.addEventListener('error', () => {
      if (id !== seq) return;
      terminateWorker();
      showError(decodeStatus, '识别模块加载失败，请刷新页面重试。');
    });

    const buffer = imageData.data.buffer;
    worker.postMessage(
      { type: 'decode', id, data: buffer, width: imageData.width, height: imageData.height },
      [buffer],
    );
    workerTimer = setTimeout(() => {
      if (id !== seq) return;
      terminateWorker();
      showError(decodeStatus, DECODE_TIMEOUT_MESSAGE);
    }, DECODE_TIMEOUT_MS);
  }

  async function handleImageFile(file) {
    if (!file) return;
    clearError(decodeStatus);
    resultWrap.hidden = true;
    lastDecoded = '';

    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) {
      showError(decodeStatus, '请选择图片文件（PNG / JPEG / GIF / WebP / BMP）。');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showError(decodeStatus, `图片过大（${formatBytes(file.size)}），请不超过 10MB。`);
      return;
    }

    // 预览 + 元信息（用 data URL 而非 blob:URL —— 后者会形成网络请求记录）
    previewWrap.hidden = false;
    imageBytes.textContent = formatBytes(file.size);
    imageSize.textContent = '—';
    preview.addEventListener(
      'load',
      () => {
        imageSize.textContent = `${preview.naturalWidth} × ${preview.naturalHeight}`;
      },
      { once: true },
    );
    try {
      preview.src = await readFileAsDataURL(file);
    } catch {
      // 预览失败不阻断识别
    }

    // 识别（worker）
    try {
      const imageData = await imageToRgba(file);
      runDecode(imageData);
    } catch (err) {
      showError(decodeStatus, `读取图片失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  fileInput.addEventListener('change', () => {
    handleImageFile(fileInput.files?.[0]);
    fileInput.value = ''; // 允许重复选择同一文件
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

  const onPaste = (event) => {
    const item = Array.from(event.clipboardData?.items ?? []).find(
      (i) => i.kind === 'file' && i.type.startsWith('image/'),
    );
    const file = item?.getAsFile();
    if (!file) return;
    event.preventDefault();
    handleImageFile(file);
  };
  document.addEventListener('paste', onPaste);

  /* ==================== 恢复上次输入并立即渲染一次 ==================== */

  textInput.value = readString('text', '');
  refresh();

  /* ==================== 清理函数（离开工具时由外壳调用） ==================== */

  return () => {
    terminateWorker();
    scheduleRefresh.cancel();
    document.removeEventListener('paste', onPaste);
  };
}
