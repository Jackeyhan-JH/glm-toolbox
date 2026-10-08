/**
 * 进制转换与位运算 —— 工具入口（外壳在进入 #/number-base 时动态加载本模块）。
 *
 * 页面结构：
 *   选项行    位宽（8 / 16 / 32 / 64，补码视图 / 位运算 / 位网格共用）、
 *             十六进制大小写、分组显示
 *   进制转换  二 / 八 / 十 / 十六进制 + 自定义 2–36 进制输入框，任一框输入其余同步；
 *             支持 0x / 0o / 0b 前缀，忽略空格、_ 与逗号，BigInt 任意精度
 *   补码视图  当前值在所选位宽下的补码二进制与有符号 / 无符号解释，超范围中文提示
 *   位运算    操作数 A / 运算 / 操作数 B（移位运算时为移位量），按位宽计算，
 *             结果给出二 / 十六进制与有符号 / 无符号十进制
 *   位网格    所选位宽的可点击位格子（标注位序号），点击翻转对应位并回写数值
 *
 * 输入防抖 150ms；选项与输入经 ctx.storage 本地记忆；纯逻辑见 ./logic.mjs。
 * mount(root, ctx) 协议见 CONTRIBUTING.md；返回清理函数取消防抖定时器。
 */

import { clearError, copyButton, debounce, el, showError } from '../../assets/js/ui.mjs';
import {
  BASE_MAX,
  BASE_MIN,
  OPERATIONS,
  WIDTHS,
  complementView,
  evaluateOperation,
  formatNumber,
  groupDigits,
  parseNumber,
  toggleBit,
  validateBase,
} from './logic.mjs';

const DEBOUNCE_MS = 150; // 输入自动更新的防抖（约定 ≤ 300ms）
const DEFAULT_WIDTH = 32;
const DEFAULT_CUSTOM_BASE = 36;

const STORAGE_KEYS = {
  width: 'width',
  hexUpper: 'hexUpper',
  group: 'group',
  customBase: 'customBase',
  value: 'value',
  opId: 'opId',
  opA: 'opA',
  opB: 'opB',
};

/** 基础进制行（自定义进制单独处理） */
const FIELD_ROWS = [
  { key: 'bin', base: 2, label: '二进制', placeholder: '如 1111 1111' },
  { key: 'oct', base: 8, label: '八进制', placeholder: '如 377' },
  { key: 'dec', base: 10, label: '十进制', placeholder: '如 255，可输 0x1F、0b1010、1,000,000' },
  { key: 'hex', base: 16, label: '十六进制', placeholder: '如 FF（或 0xFF）' },
];

/** 补码视图行 */
const COMP_ROWS = [
  { key: 'bits', label: '补码二进制', copyLabel: '复制补码' },
  { key: 'unsigned', label: '无符号值', copyLabel: '复制无符号' },
  { key: 'signed', label: '有符号值', copyLabel: '复制有符号' },
];

/** 位运算结果行 */
const RESULT_ROWS = [
  { key: 'bits', label: '二进制', copyLabel: '复制结果二进制' },
  { key: 'hex', label: '十六进制', copyLabel: '复制结果十六进制' },
  { key: 'unsigned', label: '十进制（无符号）', copyLabel: '复制结果无符号' },
  { key: 'signed', label: '十进制（有符号）', copyLabel: '复制结果有符号' },
];

export async function mount(root, ctx) {
  ctx.loadStyle('tools/number-base/style.css');

  /* ---------- 状态 ---------- */

  const savedWidth = ctx.storage.get(STORAGE_KEYS.width, DEFAULT_WIDTH);
  let width = WIDTHS.includes(savedWidth) ? savedWidth : DEFAULT_WIDTH;
  let hexUpper = ctx.storage.get(STORAGE_KEYS.hexUpper, true) !== false;
  let group = ctx.storage.get(STORAGE_KEYS.group, true) !== false;

  let customBase = ctx.storage.get(STORAGE_KEYS.customBase, DEFAULT_CUSTOM_BASE);
  if (validateBase(customBase)) customBase = DEFAULT_CUSTOM_BASE;

  let opId = ctx.storage.get(STORAGE_KEYS.opId, 'AND');
  if (!OPERATIONS.some((o) => o.id === opId)) opId = 'AND';

  let sourceKey = 'dec'; // 最近编辑的进制输入框，其余框由它同步
  let value = 0n; // 当前值（输入为空时按 0 展示补码与位网格）
  let parseError = ''; // 进制输入的解析错误（空串表示无）
  let baseError = ''; // 自定义基数错误（空串表示无）
  let outputsBlank = true; // 最近一次渲染时进制输入框是否留空

  const fmtOptions = () => ({ upper: hexUpper, group });
  const baseOf = (key) => (key === 'custom' ? customBase : FIELD_ROWS.find((r) => r.key === key).base);

  /* ---------- DOM：选项行 ---------- */

  const widthButtons = new Map();
  const widthSeg = el(
    'div',
    { class: 'seg', role: 'group', 'aria-label': '位宽' },
    WIDTHS.map((w) => {
      const btn = el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(w === width),
          'data-testid': `number-base-width-${w}`,
          onClick: () => applyWidth(w),
        },
        `${w} 位`,
      );
      widthButtons.set(w, btn);
      return btn;
    }),
  );

  const caseButtons = new Map();
  const caseSeg = el(
    'div',
    { class: 'seg', role: 'group', 'aria-label': '十六进制大小写' },
    [
      [true, '大写'],
      [false, '小写'],
    ].map(([upperCase, label]) => {
      const btn = el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(hexUpper === upperCase),
          'data-testid': `number-base-case-${upperCase ? 'upper' : 'lower'}`,
          onClick: () => applyHexUpper(upperCase),
        },
        label,
      );
      caseButtons.set(upperCase, btn);
      return btn;
    }),
  );

  const groupCheckbox = el('input', {
    type: 'checkbox',
    id: 'number-base-group',
    'data-testid': 'number-base-group',
  });
  groupCheckbox.checked = group;
  groupCheckbox.addEventListener('change', () => applyGroup(groupCheckbox.checked));

  /* ---------- DOM：进制转换 ---------- */

  const valueInputs = {}; // key → 输入框（bin / oct / dec / hex / custom）
  const convertSection = el('section', {
    class: 'nb-section',
    'data-testid': 'number-base-convert',
  });

  for (const row of FIELD_ROWS) {
    const input = el('input', {
      type: 'text',
      id: `number-base-${row.key}`,
      'data-testid': `number-base-${row.key}`,
      'aria-label': row.label,
      placeholder: row.placeholder,
      spellcheck: 'false',
      autocomplete: 'off',
    });
    input.addEventListener('input', () => {
      sourceKey = row.key;
      convertDebounced();
    });
    valueInputs[row.key] = input;
    convertSection.append(
      el(
        'div',
        { class: 'nb-row' },
        el('label', { class: 'nb-row-label', for: input.id }, row.label),
        input,
        copyButton(() => input.value, { label: `复制${row.label}` }),
      ),
    );
  }

  const customBaseInput = el('input', {
    type: 'number',
    id: 'number-base-custom-base',
    'data-testid': 'number-base-custom-base',
    'aria-label': '自定义进制基数',
    min: String(BASE_MIN),
    max: String(BASE_MAX),
    step: '1',
  });
  customBaseInput.value = String(customBase);
  customBaseInput.addEventListener('input', applyCustomBase);

  const customInput = el('input', {
    type: 'text',
    id: 'number-base-custom',
    'data-testid': 'number-base-custom',
    'aria-label': '自定义进制值',
    placeholder: '如 73',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  customInput.addEventListener('input', () => {
    sourceKey = 'custom';
    convertDebounced();
  });
  valueInputs.custom = customInput;

  convertSection.append(
    el(
      'div',
      { class: 'nb-row' },
      el('label', { class: 'nb-row-label', for: customInput.id }, '自定义'),
      customBaseInput,
      el('span', { class: 'nb-custom-sep' }, '进制'),
      customInput,
      copyButton(() => customInput.value, { label: '复制自定义进制' }),
    ),
    el(
      'p',
      { class: 'field-hint' },
      '任一框输入，其余框自动同步。支持 0x / 0o / 0b 前缀（任一框内均可识别），忽略空格、下划线 _ 与逗号 ，负数用 - 开头；BigInt 任意精度。全部计算在浏览器本地完成，不上传。',
    ),
  );

  /* ---------- DOM：补码视图 ---------- */

  const compSection = el('section', {
    class: 'nb-section',
    'data-testid': 'number-base-complement',
  });
  const compTitle = el('h2', { class: 'nb-section-title' }, `补码视图（${width} 位）`);
  const compEls = {}; // key → <code>
  for (const row of COMP_ROWS) {
    const code = el('code', {
      class: 'nb-value',
      'data-testid': `number-base-comp-${row.key}`,
    });
    compEls[row.key] = code;
    compSection.append(
      el(
        'div',
        { class: 'nb-row' },
        el('span', { class: 'nb-row-label' }, row.label),
        code,
        copyButton(() => code.textContent, { label: row.copyLabel }),
      ),
    );
  }
  const compWarn = el(
    'p',
    { class: 'nb-warn', 'data-testid': 'number-base-comp-warn' },
    '',
  );
  compWarn.hidden = true;
  compSection.append(compWarn);

  /* ---------- DOM：位运算 ---------- */

  const bitwiseSection = el('section', {
    class: 'nb-section',
    'data-testid': 'number-base-bitwise',
  });

  const opAInput = el('input', {
    type: 'text',
    id: 'number-base-op-a',
    'data-testid': 'number-base-op-a',
    'aria-label': '操作数 A',
    placeholder: '如 0b1100、0xF0 或 240',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  opAInput.addEventListener('input', onBitwiseInput);

  const opSelect = el(
    'select',
    { id: 'number-base-op', 'data-testid': 'number-base-op', 'aria-label': '运算' },
    OPERATIONS.map((op) => el('option', { value: op.id }, op.label)),
  );
  opSelect.addEventListener('change', () => applyOperation(opSelect.value));

  const opBLabel = el('label', { class: 'field-label', for: 'number-base-op-b' }, '操作数 B');
  const opBInput = el('input', {
    type: 'text',
    id: 'number-base-op-b',
    'data-testid': 'number-base-op-b',
    placeholder: '如 0b1010、0x0F 或 10',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  opBInput.addEventListener('input', onBitwiseInput);

  bitwiseSection.append(
    el('h2', { class: 'nb-section-title' }, '位运算'),
    el(
      'div',
      { class: 'nb-op-row' },
      el(
        'div',
        { class: 'nb-op-item' },
        el('label', { class: 'field-label', for: opAInput.id }, '操作数 A'),
        opAInput,
      ),
      el(
        'div',
        { class: 'nb-op-item' },
        el('label', { class: 'field-label', for: opSelect.id }, '运算'),
        opSelect,
      ),
      el(
        'div',
        { class: 'nb-op-item' },
        opBLabel,
        opBInput,
      ),
    ),
    el(
      'p',
      { class: 'field-hint' },
      '操作数默认按十进制解析，可带 0x / 0o / 0b 前缀；运算在所选位宽下按补码进行，操作数超范围时按低位截断。',
    ),
  );

  const resultEls = {}; // key → <code>
  for (const row of RESULT_ROWS) {
    const code = el('code', {
      class: 'nb-value',
      'data-testid': `number-base-result-${row.key}`,
    });
    resultEls[row.key] = code;
    bitwiseSection.append(
      el(
        'div',
        { class: 'nb-row' },
        el('span', { class: 'nb-row-label nb-row-label-wide' }, row.label),
        code,
        copyButton(() => code.textContent, { label: row.copyLabel }),
      ),
    );
  }
  const bitwiseWarn = el(
    'p',
    { class: 'nb-warn', 'data-testid': 'number-base-result-warn' },
    '',
  );
  bitwiseWarn.hidden = true;
  bitwiseSection.append(bitwiseWarn);

  /* ---------- DOM：位网格 ---------- */

  const gridSection = el('section', {
    class: 'nb-section',
    'data-testid': 'number-base-grid-section',
  });
  const gridTitle = el('h2', { class: 'nb-section-title' }, `位网格（${width} 位）`);
  const grid = el('div', {
    class: 'nb-grid',
    role: 'group',
    'aria-label': '位网格',
    'data-testid': 'number-base-grid',
  });
  gridSection.append(
    gridTitle,
    grid,
    el(
      'p',
      { class: 'field-hint' },
      '格子显示当前值在所选位宽下的补码（高位在左，下标为位序号），点击翻转对应位，数值按有符号解释回写到上面的输入框。',
    ),
  );

  /* ---------- DOM：组装 ---------- */

  const clearBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'data-testid': 'number-base-clear',
      onClick: clearAll,
    },
    '清空',
  );

  root.append(
    el(
      'section',
      { class: 'tool number-base' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el('div', { class: 'tool-actions' }, clearBtn),
      ),
      el(
        'div',
        { class: 'nb-options' },
        el('span', { class: 'field-label' }, '位宽'),
        widthSeg,
        el('span', { class: 'field-label' }, '十六进制大小写'),
        caseSeg,
        el('label', { class: 'nb-check', for: groupCheckbox.id }, groupCheckbox, ' 分组显示'),
      ),
      el('h2', { class: 'nb-section-title' }, '进制互转'),
      convertSection,
      compSection,
      bitwiseSection,
      gridSection,
    ),
  );

  /* ---------- 渲染 ---------- */

  /** 进制输入框的展示文本（skipKey 指定的框保持用户输入不动） */
  function renderConvertOutputs(skipKey) {
    const customOk = baseError === '';
    for (const row of FIELD_ROWS) {
      if (row.key === skipKey) continue;
      valueInputs[row.key].value = outputsBlank
        ? ''
        : formatNumber(value, row.base, fmtOptions());
    }
    if (skipKey !== 'custom') {
      valueInputs.custom.value =
        outputsBlank || !customOk ? '' : formatNumber(value, customBase, fmtOptions());
    }
  }

  /** 进制转换区的错误提示（解析错误优先于基数错误） */
  function renderConvertError() {
    const message = parseError || baseError;
    if (message) showError(convertSection, message);
    else clearError(convertSection);
  }

  function renderComplement() {
    const view = complementView(value, width);
    compTitle.textContent = `补码视图（${width} 位）`;
    compEls.bits.textContent = group ? groupDigits(view.bits, 4) : view.bits;
    compEls.unsigned.textContent = String(view.unsigned);
    compEls.signed.textContent = String(view.signed);
    compWarn.hidden = view.range === 'fit';
    compWarn.textContent = view.message;
  }

  function renderBitwise() {
    const result = evaluateOperation({
      aText: opAInput.value,
      bText: opBInput.value,
      opId,
      width,
    });
    if (result.status === 'ok') {
      clearError(bitwiseSection);
      resultEls.bits.textContent = group ? groupDigits(result.bits, 4) : result.bits;
      resultEls.hex.textContent = formatNumber(result.pattern, 16, fmtOptions());
      resultEls.unsigned.textContent = String(result.unsigned);
      resultEls.signed.textContent = String(result.signed);
      bitwiseWarn.hidden = result.warnings.length === 0;
      bitwiseWarn.textContent = result.warnings.join('；');
    } else {
      for (const code of Object.values(resultEls)) code.textContent = '';
      bitwiseWarn.hidden = true;
      bitwiseWarn.textContent = '';
      if (result.status === 'error') showError(bitwiseSection, result.message);
      else clearError(bitwiseSection);
    }
  }

  let bitCells = []; // 位序号 → { btn, valueSpan }

  function buildGrid() {
    grid.replaceChildren();
    bitCells = [];
    for (let bit = width - 1; bit >= 0; bit -= 1) {
      const valueSpan = el('span', { class: 'nb-bit-value' }, '0');
      const btn = el(
        'button',
        {
          type: 'button',
          class: 'nb-bit',
          'data-testid': `number-base-bit-${bit}`,
          'aria-label': `第 ${bit} 位，当前 0，点击翻转`,
          onClick: () => onToggleBit(bit),
        },
        valueSpan,
        el('span', { class: 'nb-bit-index' }, String(bit)),
      );
      bitCells[bit] = { btn, valueSpan };
      grid.append(btn);
    }
  }

  function renderGrid() {
    const { bits } = complementView(value, width);
    gridTitle.textContent = `位网格（${width} 位）`;
    for (let bit = 0; bit < width; bit += 1) {
      const cell = bitCells[bit];
      const digit = bits[width - 1 - bit];
      cell.valueSpan.textContent = digit;
      cell.btn.classList.toggle('is-on', digit === '1');
      cell.btn.setAttribute('aria-label', `第 ${bit} 位，当前 ${digit}，点击翻转`);
    }
  }

  /* ---------- 交互 ---------- */

  /** 从最近编辑的输入框解析并同步全部展示 */
  function runConvert() {
    const text = valueInputs[sourceKey].value;
    parseError = '';
    if (text.trim() === '') {
      value = 0n;
      outputsBlank = true;
      ctx.storage.set(STORAGE_KEYS.value, '');
    } else {
      const parsed = parseNumber(text, baseOf(sourceKey));
      if (parsed.status === 'ok') {
        value = parsed.value;
        outputsBlank = false;
        ctx.storage.set(STORAGE_KEYS.value, value.toString());
      } else {
        parseError = parsed.message; // 其余框留空，补码 / 位网格保持上一次的有效值
        outputsBlank = true;
      }
    }
    renderConvertOutputs(sourceKey);
    renderConvertError();
    renderComplement();
    renderGrid();
  }

  function applyCustomBase() {
    const n = Number(customBaseInput.value);
    customBase = n;
    baseError = validateBase(n) ?? '';
    if (baseError === '') ctx.storage.set(STORAGE_KEYS.customBase, n);
    convertDebounced();
  }

  function applyWidth(w) {
    width = w;
    ctx.storage.set(STORAGE_KEYS.width, w);
    for (const [candidate, btn] of widthButtons) {
      btn.setAttribute('aria-pressed', String(candidate === width));
    }
    buildGrid();
    renderConvertOutputs(null);
    renderConvertError();
    renderComplement();
    renderGrid();
    renderBitwise();
  }

  function applyHexUpper(upperCase) {
    hexUpper = upperCase;
    ctx.storage.set(STORAGE_KEYS.hexUpper, hexUpper);
    for (const [candidate, btn] of caseButtons) {
      btn.setAttribute('aria-pressed', String(candidate === hexUpper));
    }
    renderConvertOutputs(null);
    renderComplement();
    renderBitwise();
  }

  function applyGroup(enabled) {
    group = enabled;
    ctx.storage.set(STORAGE_KEYS.group, group);
    renderConvertOutputs(null);
    renderComplement();
    renderBitwise();
  }

  function applyOperation(id) {
    opId = id;
    ctx.storage.set(STORAGE_KEYS.opId, id);
    opSelect.value = id;
    const def = OPERATIONS.find((o) => o.id === id);
    opBLabel.textContent = def.shift ? '移位量' : '操作数 B';
    opBInput.disabled = def.unary;
    opBInput.placeholder = def.unary
      ? 'NOT 为单目运算，无需第二操作数'
      : def.shift
        ? `0 到 ${width - 1} 的整数`
        : '如 0b1010、0x0F 或 10';
    renderBitwise();
  }

  function onToggleBit(bit) {
    value = toggleBit(value, bit, width);
    sourceKey = 'dec';
    parseError = '';
    outputsBlank = false;
    ctx.storage.set(STORAGE_KEYS.value, value.toString());
    renderConvertOutputs(null);
    renderConvertError();
    renderComplement();
    renderGrid();
  }

  function clearAll() {
    for (const input of Object.values(valueInputs)) input.value = '';
    opAInput.value = '';
    opBInput.value = '';
    sourceKey = 'dec';
    value = 0n;
    parseError = '';
    outputsBlank = true;
    ctx.storage.set(STORAGE_KEYS.value, '');
    ctx.storage.set(STORAGE_KEYS.opA, '');
    ctx.storage.set(STORAGE_KEYS.opB, '');
    renderConvertOutputs(null);
    renderConvertError();
    renderComplement();
    renderGrid();
    renderBitwise();
    valueInputs.dec.focus();
  }

  /** 操作数输入：立即持久化原始文本（防抖只作用于重算渲染，快速离开也不丢输入） */
  function onBitwiseInput() {
    ctx.storage.set(STORAGE_KEYS.opA, opAInput.value);
    ctx.storage.set(STORAGE_KEYS.opB, opBInput.value);
    bitwiseDebounced();
  }

  const convertDebounced = debounce(runConvert, DEBOUNCE_MS);
  const bitwiseDebounced = debounce(renderBitwise, DEBOUNCE_MS);

  /* ---------- 恢复上次输入并首次渲染 ---------- */

  const savedValue = ctx.storage.get(STORAGE_KEYS.value, '');
  if (typeof savedValue === 'string' && savedValue !== '') {
    const parsed = parseNumber(savedValue, 10);
    if (parsed.status === 'ok') {
      value = parsed.value;
      outputsBlank = false;
      valueInputs.dec.value = savedValue;
    }
  }
  const savedOpA = ctx.storage.get(STORAGE_KEYS.opA, '');
  const savedOpB = ctx.storage.get(STORAGE_KEYS.opB, '');
  opAInput.value = typeof savedOpA === 'string' ? savedOpA : '';
  opBInput.value = typeof savedOpB === 'string' ? savedOpB : '';

  applyOperation(opId); // 设置标签 / 占位符并渲染一次位运算
  renderConvertOutputs(null);
  renderConvertError();
  renderComplement();
  buildGrid();
  renderGrid();

  /* ---------- 清理函数（离开工具时由外壳调用） ---------- */

  return () => {
    convertDebounced.cancel();
    bitwiseDebounced.cancel();
  };
}
