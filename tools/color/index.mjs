/**
 * 颜色工具 —— 工具入口（外壳在进入 #/color 时动态加载本模块）。
 *
 * 功能：
 *   - 输入任意 CSS 颜色（HEX / rgb() / hsl() / hwb() / 命名颜色，含各种透明度写法），
 *     也可用原生取色器选色，输入框与取色器双向同步；
 *   - 同时输出 HEX（有透明度时 8 位）、rgb()、hsl()、hwb()、oklch() 与最近的
 *     CSS 命名颜色（完全相等标注「精确」），每项可复制；大色块预览（透明色显示棋盘格）；
 *   - 对比度检查：前景 + 背景 → WCAG 2.x 判定（AA / AAA、普通 / 大字），
 *     示例文字预览，「交换前景 / 背景」按钮；半透明前景先与背景混合再计算；
 *   - 明度阶梯色板（10 级），点击色块复制对应 HEX；
 *   - 输入实时更新（防抖 120ms），上次输入经 ctx.storage 记忆。
 *
 * 纯逻辑在 ./logic.mjs；公共组件来自 assets/js/ui.mjs。
 */

import { clearError, copyButton, debounce, el, showError } from '../../assets/js/ui.mjs';
import {
  WCAG_ITEMS,
  blendOver,
  contrastRatio,
  describeColor,
  formatHex,
  formatRatio,
  formatRgb,
  lightnessShades,
  parseColor,
  relativeLuminance,
  wcagVerdicts,
} from './logic.mjs';

const DEBOUNCE_MS = 120; // 输入自动更新的防抖（约定 ≤ 300ms）
const DEFAULT_INPUT = '#1e90ff';
const DEFAULT_FG = '#777777';
const DEFAULT_BG = '#ffffff';
const SHADE_STEPS = 10;
const EMPTY_PLACEHOLDER = '—';

export async function mount(root, ctx) {
  ctx.loadStyle('tools/color/style.css');

  /* ---------- 状态 ---------- */

  const readString = (key, fallback) => {
    const value = ctx.storage.get(key, fallback);
    return typeof value === 'string' && value !== '' ? value : fallback;
  };
  let shadeCopiedTimer = null;

  /* ---------- DOM：转换区 ---------- */

  const mainInput = el('input', {
    id: 'color-input',
    type: 'text',
    class: 'color-input',
    'data-testid': 'color-input',
    'aria-label': '颜色输入',
    placeholder: '如 #1e90ff、rgb(30 144 255)、hsl(210 100% 56%)、dodgerblue',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const mainPicker = el('input', {
    id: 'color-picker',
    type: 'color',
    'data-testid': 'color-picker',
    'aria-label': '取色器',
    value: '#1e90ff',
  });

  const mainStatus = el('div', { class: 'color-status' }); // showError 的挂载容器
  const noteBox = el('div', {
    class: 'color-note',
    role: 'status',
    'data-testid': 'color-note',
    hidden: true,
  });

  const swatchFill = el('div', { class: 'color-swatch-fill', 'data-testid': 'color-swatch' });
  const swatchHex = el('code', { class: 'color-swatch-hex', 'data-testid': 'color-swatch-hex' }, EMPTY_PLACEHOLDER);

  const FORMAT_ITEMS = [
    { key: 'hex', label: 'HEX' },
    { key: 'rgb', label: 'RGB' },
    { key: 'hsl', label: 'HSL' },
    { key: 'hwb', label: 'HWB' },
    { key: 'oklch', label: 'OKLCH' },
  ];
  const formatValueById = {};
  const formatRows = el(
    'div',
    { class: 'color-formats' },
    FORMAT_ITEMS.map(({ key, label }) => {
      const value = el('code', { class: 'color-format-value', 'data-testid': `color-${key}` }, EMPTY_PLACEHOLDER);
      formatValueById[key] = value;
      return el(
        'div',
        { class: 'color-format' },
        el('span', { class: 'color-format-label' }, label),
        value,
        copyButton(() => value.textContent, { label: `复制 ${label}` }),
      );
    }),
    el(
      'div',
      { class: 'color-format' },
      el('span', { class: 'color-format-label' }, '命名颜色'),
      (() => {
        const named = el('code', { class: 'color-format-value', 'data-testid': 'color-named' }, EMPTY_PLACEHOLDER);
        formatValueById.named = named;
        return named;
      })(),
      el('span', { class: 'color-exact-badge', 'data-testid': 'color-named-exact', hidden: true }, '精确'),
      copyButton(() => formatValueById.named.textContent, { label: '复制命名颜色' }),
    ),
  );

  /* ---------- DOM：对比度检查 ---------- */

  const fgInput = el('input', {
    id: 'color-fg',
    type: 'text',
    class: 'color-input',
    'data-testid': 'color-fg',
    'aria-label': '前景色',
    placeholder: '前景色，如 #777777',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const fgPicker = el('input', {
    id: 'color-fg-picker',
    type: 'color',
    'data-testid': 'color-fg-picker',
    'aria-label': '前景色取色器',
    value: '#777777',
  });
  const bgInput = el('input', {
    id: 'color-bg',
    type: 'text',
    class: 'color-input',
    'data-testid': 'color-bg',
    'aria-label': '背景色',
    placeholder: '背景色，如 #ffffff',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const bgPicker = el('input', {
    id: 'color-bg-picker',
    type: 'color',
    'data-testid': 'color-bg-picker',
    'aria-label': '背景色取色器',
    value: '#ffffff',
  });
  const swapButton = el(
    'button',
    { type: 'button', class: 'btn', 'data-testid': 'color-swap', onClick: swapColors },
    '交换前景 / 背景',
  );

  const contrastStatus = el('div', { class: 'color-status' });
  const ratioValue = el('span', { class: 'color-ratio-value', 'data-testid': 'color-ratio' }, EMPTY_PLACEHOLDER);
  const blendNote = el('p', { class: 'field-hint', 'data-testid': 'color-blend-note', hidden: true });
  const verdictValueById = {};
  const verdictList = el(
    'ul',
    { class: 'color-verdicts' },
    WCAG_ITEMS.map(({ key, label, threshold }) => {
      const value = el('span', { class: 'color-verdict-value' }, EMPTY_PLACEHOLDER);
      verdictValueById[key] = value;
      return el(
        'li',
        { class: 'color-verdict', 'data-testid': `color-wcag-${key}` },
        el('span', { class: 'color-verdict-label' }, `${label}（≥ ${threshold}）`),
        value,
      );
    }),
  );
  const sampleNormal = el('p', { class: 'color-sample-normal' }, '普通文字：码工具箱 Aa 123');
  const sampleLarge = el('p', { class: 'color-sample-large' }, '大字：颜色对比度示例');
  const sampleBox = el(
    'div',
    { class: 'color-sample', 'data-testid': 'color-sample', 'aria-label': '对比度示例预览' },
    sampleNormal,
    sampleLarge,
  );

  /* ---------- DOM：色板 ---------- */

  const shadesBox = el('div', { class: 'color-shades', 'data-testid': 'color-shades', role: 'list' });
  const shadeCopied = el(
    'span',
    { class: 'field-hint color-shade-copied', 'data-testid': 'color-shade-copied', 'aria-live': 'polite' },
    '',
  );

  /** 全部格式汇总文本（复制按钮用） */
  function formatsSummary() {
    return FORMAT_ITEMS.map(({ key, label }) => `${label}: ${formatValueById[key].textContent}`).join('\n');
  }

  /* ---------- 组装 ---------- */

  root.append(
    el(
      'section',
      { class: 'tool color' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el(
          'div',
          { class: 'tool-actions' },
          copyButton(() => formatsSummary(), { label: '复制全部格式' }),
        ),
      ),
      el(
        'div',
        { class: 'color-panel' },
        el('label', { class: 'field-label', for: 'color-input' }, '颜色输入'),
        el('div', { class: 'color-input-row' }, mainInput, mainPicker),
        el(
          'p',
          { class: 'field-hint' },
          '支持 #rgb / #rrggbb / #rrggbbaa、rgb()、hsl()、hwb() 与 148 个 CSS 命名颜色；所有处理都在本地浏览器完成。',
        ),
        mainStatus,
        noteBox,
        el(
          'div',
          { class: 'two-col color-workbench' },
          el(
            'div',
            { class: 'color-preview-col' },
            el('span', { class: 'field-label' }, '预览'),
            el('div', { class: 'color-swatch', role: 'img', 'aria-label': '颜色预览色块' }, swatchFill, swatchHex),
            el('p', { class: 'field-hint' }, '透明色下方显示棋盘格。'),
          ),
          el(
            'div',
            { class: 'color-formats-col' },
            el('span', { class: 'field-label' }, '输出格式'),
            formatRows,
          ),
        ),
      ),
      el(
        'div',
        { class: 'color-panel' },
        el('h2', { class: 'color-section-title' }, '对比度检查（WCAG 2.x）'),
        el(
          'div',
          { class: 'form-row color-contrast-row' },
          el('label', { class: 'field-label', for: 'color-fg' }, '前景色'),
          fgInput,
          fgPicker,
          el('label', { class: 'field-label', for: 'color-bg' }, '背景色'),
          bgInput,
          bgPicker,
          swapButton,
        ),
        contrastStatus,
        el(
          'div',
          { class: 'two-col color-contrast-grid' },
          el(
            'div',
            { class: 'color-ratio-col' },
            el(
              'div',
              { class: 'color-ratio' },
                el('span', { class: 'field-label' }, '对比度'),
                ratioValue,
                copyButton(() => ratioValue.textContent, { label: '复制对比度' }),
            ),
            blendNote,
            verdictList,
          ),
          el('div', { class: 'color-sample-col' }, el('span', { class: 'field-label' }, '示例预览'), sampleBox),
        ),
      ),
      el(
        'div',
        { class: 'color-panel' },
        el('h2', { class: 'color-section-title' }, '明度阶梯色板'),
        el('p', { class: 'field-hint' }, `保持色相与饱和度，按明度均分 ${SHADE_STEPS} 级；点击色块复制对应 HEX。`),
        shadesBox,
        shadeCopied,
      ),
    ),
  );

  /* ---------- 交互：转换区 ---------- */

  /** 渲染转换结果；message 为空串时只复位显示、不报错（输入为空的情形） */
  function renderMainResult(result) {
    clearError(mainStatus);
    noteBox.hidden = true;
    if (!result.ok) {
      swatchFill.style.backgroundColor = '';
      swatchHex.textContent = EMPTY_PLACEHOLDER;
      swatchHex.style.color = '';
      for (const { key } of FORMAT_ITEMS) formatValueById[key].textContent = EMPTY_PLACEHOLDER;
      formatValueById.named.textContent = EMPTY_PLACEHOLDER;
      shadesBox.replaceChildren();
      if (result.message) showError(mainStatus, result.message);
      return;
    }
    const { formats, named, color, notes } = result;
    if (notes.length > 0) {
      noteBox.textContent = [...new Set(notes)].join('；');
      noteBox.hidden = false;
    }
    swatchFill.style.backgroundColor = formats.hex; // 透明色露出下方棋盘格
    swatchHex.textContent = formats.hex;
    swatchHex.style.color = relativeLuminance(color) > 0.45 ? '#000000' : '#ffffff';
    for (const { key } of FORMAT_ITEMS) formatValueById[key].textContent = formats[key];
    formatValueById.named.textContent = named.name;
    const badge = formatRows.querySelector('[data-testid="color-named-exact"]');
    badge.hidden = !named.exact;
    mainPicker.value = formatHex({ ...color, a: 1 }); // 取色器只支持 6 位 HEX
    renderShades(color);
  }

  function renderShades(color) {
    const shades = lightnessShades(color, SHADE_STEPS);
    shadesBox.replaceChildren(
      ...shades.map((hex, i) => {
        const shade = parseColor(hex).color;
        return el(
          'button',
          {
            type: 'button',
            class: 'color-shade',
            role: 'listitem',
            'data-testid': `color-shade-${i}`,
            style: { backgroundColor: hex },
            title: hex,
            'aria-label': `复制色阶 ${i + 1}：${hex}`,
            onClick: () => copyShade(hex),
          },
          // 色阶文字按明度取黑 / 白，保证在深浅色块上都可读
          el(
            'span',
            {
              class: 'color-shade-hex',
              style: { color: relativeLuminance(shade) > 0.45 ? '#000000' : '#ffffff' },
            },
            hex,
          ),
        );
      }),
    );
  }

  async function copyShade(hex) {
    if (await writeClipboard(hex)) {
      shadeCopied.textContent = `已复制 ${hex}`;
    } else {
      shadeCopied.textContent = `复制失败：${hex}`;
    }
    if (shadeCopiedTimer !== null) clearTimeout(shadeCopiedTimer);
    shadeCopiedTimer = setTimeout(() => {
      shadeCopied.textContent = '';
      shadeCopiedTimer = null;
    }, 1500);
  }

  /** 剪贴板写入（安全上下文用 API，否则 execCommand 兜底） */
  async function writeClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // 落到兜底方案
    }
    const ta = el('textarea', { 'aria-hidden': 'true', style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }

  const updateMain = debounce(() => {
    ctx.storage.set('input', mainInput.value);
    const text = mainInput.value.trim();
    if (text === '') {
      renderMainResult({ ok: false, message: '' }); // 清空：只复位显示，不报错
      return;
    }
    renderMainResult(describeColor(text));
  }, DEBOUNCE_MS);

  function onMainPickerInput() {
    mainInput.value = mainPicker.value; // 程序赋值不触发 input，无循环
    ctx.storage.set('input', mainInput.value);
    renderMainResult(describeColor(mainPicker.value));
  }

  mainInput.addEventListener('input', updateMain);
  mainPicker.addEventListener('input', onMainPickerInput);

  /* ---------- 交互：对比度检查 ---------- */

  function renderContrastResult(fgResult, bgResult) {
    clearError(contrastStatus);
    const empty = fgResult === null || bgResult === null; // 有输入为空 → 复位显示
    const failed = !empty && (!fgResult.ok || !bgResult.ok);
    blendNote.hidden = true;
    if (empty || failed) {
      ratioValue.textContent = EMPTY_PLACEHOLDER;
      for (const { key } of WCAG_ITEMS) {
        verdictValueById[key].textContent = EMPTY_PLACEHOLDER;
        verdictValueById[key].classList.remove('is-ok', 'is-fail');
      }
      sampleBox.style.backgroundColor = '';
      sampleNormal.style.color = '';
      sampleLarge.style.color = '';
      if (failed) {
        showError(contrastStatus, !fgResult.ok ? fgResult.message : bgResult.message);
      }
      return;
    }
    const fg = fgResult.color;
    const bg = bgResult.color;
    const ratio = contrastRatio(fg, bg);
    ratioValue.textContent = formatRatio(ratio);
    const verdicts = wcagVerdicts(ratio);
    for (const { key } of WCAG_ITEMS) {
      const pass = verdicts[key];
      verdictValueById[key].textContent = pass ? '通过' : '不通过';
      verdictValueById[key].classList.toggle('is-ok', pass);
      verdictValueById[key].classList.toggle('is-fail', !pass);
    }
    sampleBox.style.backgroundColor = formatHex(bg);
    sampleNormal.style.color = formatRgb(fg);
    sampleLarge.style.color = formatRgb(fg);
    if (fg.a < 1 || bg.a < 1) {
      const blendedFg = fg.a < 1 ? blendOver(fg, bg.a < 1 ? blendOver(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg) : fg;
      const blendedBg = bg.a < 1 ? blendOver(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg;
      const source = fg.a < 1 ? blendedFg : blendedBg;
      blendNote.textContent =
        fg.a < 1
          ? `半透明前景已与背景混合为 ${formatHex(source)} 后再计算。`
          : `半透明背景已与白色混合为 ${formatHex(source)} 后再计算。`;
      blendNote.hidden = false;
    }
  }

  function readContrastInputs() {
    const fgText = fgInput.value.trim();
    const bgText = bgInput.value.trim();
    return {
      fg: fgText === '' ? null : describeColor(fgText),
      bg: bgText === '' ? null : describeColor(bgText),
    };
  }

  const updateContrast = debounce(() => {
    ctx.storage.set('fg', fgInput.value);
    ctx.storage.set('bg', bgInput.value);
    const { fg, bg } = readContrastInputs();
    renderContrastResult(fg, bg);
  }, DEBOUNCE_MS);

  function onContrastPickerInput(textInput, picker) {
    textInput.value = picker.value;
    ctx.storage.set(textInput === fgInput ? 'fg' : 'bg', textInput.value);
    const { fg, bg } = readContrastInputs();
    renderContrastResult(fg, bg);
  }

  function swapColors() {
    const temp = fgInput.value;
    fgInput.value = bgInput.value;
    bgInput.value = temp;
    fgPicker.value = pickerHexOf(fgInput.value, fgPicker.value);
    bgPicker.value = pickerHexOf(bgInput.value, bgPicker.value);
    ctx.storage.set('fg', fgInput.value);
    ctx.storage.set('bg', bgInput.value);
    const { fg, bg } = readContrastInputs();
    renderContrastResult(fg, bg);
  }

  /** 输入合法时取其 6 位 HEX，否则保留取色器当前值 */
  function pickerHexOf(text, fallback) {
    const parsed = parseColor(text);
    return parsed.ok ? formatHex({ ...parsed.color, a: 1 }) : fallback;
  }

  fgInput.addEventListener('input', updateContrast);
  bgInput.addEventListener('input', updateContrast);
  fgPicker.addEventListener('input', () => onContrastPickerInput(fgInput, fgPicker));
  bgPicker.addEventListener('input', () => onContrastPickerInput(bgInput, bgPicker));

  /* ---------- 恢复上次输入并立即渲染一次 ---------- */

  mainInput.value = readString('input', DEFAULT_INPUT);
  fgInput.value = readString('fg', DEFAULT_FG);
  bgInput.value = readString('bg', DEFAULT_BG);
  const initialMain = describeColor(mainInput.value.trim() || DEFAULT_INPUT);
  if (initialMain.ok) {
    mainPicker.value = formatHex({ ...initialMain.color, a: 1 });
  }
  const initialFg = pickerHexOf(fgInput.value, fgPicker.value);
  const initialBg = pickerHexOf(bgInput.value, bgPicker.value);
  fgPicker.value = initialFg;
  bgPicker.value = initialBg;
  renderMainResult(mainInput.value.trim() === '' ? { ok: false, message: '' } : initialMain);
  const { fg, bg } = readContrastInputs();
  renderContrastResult(fg, bg);

  /* ---------- 清理函数（离开工具时由外壳调用） ---------- */

  return () => {
    updateMain.cancel();
    updateContrast.cancel();
    if (shadeCopiedTimer !== null) clearTimeout(shadeCopiedTimer);
  };
}
