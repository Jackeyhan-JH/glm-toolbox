/**
 * 随机生成器 —— 工具入口（外壳在进入 #/random 时动态加载本模块）。
 *
 * 五个标签页：UUID（v4 / v7）、ULID、NanoID、密码、解析。
 *   - 生成类标签共用一行工具栏（数量 / 重新生成 / 复制全部 / 下载 .txt）与结果区，
 *     结果区每行一个值；解析标签左侧输入、右侧显示结构化信息；
 *   - 选项变化 150ms 防抖后自动重新生成；「重新生成」与切换标签立即执行；
 *   - 所有选项（含当前标签与数量）经 ctx.storage 记住，刷新后恢复并立即生成一次；
 *   - 随机数与时间全部来自 logic.mjs 的密码学安全随机源，本文件不自行产生随机数。
 */

import { el, copyButton, downloadBlob, debounce, showError, clearError } from '../../assets/js/ui.mjs';
import {
  uuidBatch,
  ulidBatch,
  nanoIdBatch,
  passwordBatch,
  parseId,
  formatIdInfo,
  passwordEntropy,
  formatEntropy,
  passwordStrength,
  passwordPoolSize,
  PASSWORD_STRENGTH_LEVELS,
  NANO_ID_PRESETS,
  NANO_ID_DEFAULT_LENGTH,
  NANO_ID_DEFAULT_ALPHABET,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_DEFAULT_LENGTH,
  COUNT_MIN,
  COUNT_MAX,
} from './logic.mjs';

const STORAGE_TAB = 'tab';
const STORAGE_COUNT = 'count';
const STORAGE_OPTIONS = 'options'; // { uuid, ulid, nanoid, password } 各标签一份
const REGEN_DEBOUNCE_MS = 150;
const PARSE_DEBOUNCE_MS = 200;

const TAB_DEFS = [
  { key: 'uuid', label: 'UUID' },
  { key: 'ulid', label: 'ULID' },
  { key: 'nanoid', label: 'NanoID' },
  { key: 'password', label: '密码' },
  { key: 'parse', label: '解析' },
];

const UUID_VERSION_DEFS = [
  { value: 4, label: 'UUID v4' },
  { value: 7, label: 'UUID v7' },
];

/** 分段切换（.seg）：items = [{ value, label, testId }]，返回 { node, sync } */
function segControl(items, initial, onPick) {
  const buttons = new Map();
  const sync = (value) => {
    for (const [key, btn] of buttons) btn.setAttribute('aria-pressed', String(key === value));
  };
  const node = el(
    'div',
    { class: 'seg', role: 'group' },
    items.map(({ value, label, testId }) => {
      const btn = el(
        'button',
        {
          type: 'button',
          'data-testid': testId ?? null,
          'aria-pressed': 'false',
          onClick: () => {
            sync(value);
            onPick(value);
          },
        },
        label,
      );
      buttons.set(value, btn);
      return btn;
    }),
  );
  sync(initial);
  return { node, sync };
}

/** 复选框行：<label class="random-check"><input type="checkbox">文字</label> */
function checkRow(id, text, { testId, checked = false, onChange } = {}) {
  const input = el('input', {
    type: 'checkbox',
    id,
    'data-testid': testId ?? null,
    onChange: onChange ?? null,
  });
  input.checked = checked;
  return { input, node: el('label', { class: 'random-check', for: id }, input, text) };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function mount(root, ctx) {
  ctx.loadStyle('tools/random/style.css');

  /* ---------- 状态 ---------- */

  const state = {
    tab: 'uuid',
    uuidVersion: 4,
    nanoidPreset: 'default',
    passwordLength: PASSWORD_DEFAULT_LENGTH, // 以状态为准（滑块会把越界值夹回范围）
    values: [], // 当前结果（生成类标签）
    parsed: null, // 当前解析结果
  };

  /* ---------- 生成类工具栏 ---------- */

  const countInput = el('input', {
    type: 'number',
    id: 'random-count',
    'data-testid': 'random-count',
    min: String(COUNT_MIN),
    max: String(COUNT_MAX),
    step: '1',
    value: '1',
  });

  const generateBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-primary',
      'data-testid': 'random-generate',
      onClick: () => regenNow(),
    },
    '重新生成',
  );

  const copyAllBtn = copyButton(() => state.values.join('\n'), { label: '复制全部' });

  const downloadBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'data-testid': 'random-download',
      onClick: () => {
        if (state.values.length === 0) return;
        downloadBlob(
          new Blob([state.values.join('\n')], { type: 'text/plain;charset=utf-8' }),
          `random-${state.tab}.txt`,
        );
      },
    },
    '下载 .txt',
  );

  const generatorBar = el(
    'div',
    { class: 'random-toolbar' },
    el('label', { class: 'random-inline', for: 'random-count' }, '数量', countInput),
    generateBtn,
    el('span', { class: 'random-spacer' }),
    copyAllBtn,
    downloadBtn,
  );

  /* ---------- UUID 面板 ---------- */

  const uuidSeg = segControl(UUID_VERSION_DEFS, 4, (value) => {
    state.uuidVersion = value;
    persist();
    regenNow();
  });

  const uuidUpper = checkRow('random-uuid-uppercase', '大写', {
    testId: 'random-uuid-uppercase',
    onChange: () => {
      persist();
      scheduleRegen();
    },
  });
  const uuidNoHyphens = checkRow('random-uuid-no-hyphens', '去掉连字符', {
    testId: 'random-uuid-no-hyphens',
    onChange: () => {
      persist();
      scheduleRegen();
    },
  });
  const uuidBraces = checkRow('random-uuid-braces', '加花括号', {
    testId: 'random-uuid-braces',
    onChange: () => {
      persist();
      scheduleRegen();
    },
  });

  const uuidPanel = el(
    'div',
    { class: 'random-panel', 'data-testid': 'random-panel-uuid' },
    el('div', { class: 'field-label' }, '版本'),
    uuidSeg.node,
    el(
      'p',
      { class: 'field-hint' },
      'v4 完全随机；v7 带毫秒时间戳、按时间有序，同一毫秒内批量生成保持递增。',
    ),
    el('div', { class: 'field-label' }, '格式'),
    el('div', { class: 'random-checks' }, uuidUpper.node, uuidNoHyphens.node, uuidBraces.node),
  );

  /* ---------- ULID 面板 ---------- */

  const ulidUpper = checkRow('random-ulid-uppercase', '大写', {
    testId: 'random-ulid-uppercase',
    checked: true,
    onChange: () => {
      persist();
      scheduleRegen();
    },
  });

  const ulidPanel = el(
    'div',
    { class: 'random-panel', 'data-testid': 'random-panel-ulid' },
    el('div', { class: 'field-label' }, '格式'),
    el('div', { class: 'random-checks' }, ulidUpper.node),
    el(
      'p',
      { class: 'field-hint' },
      'ULID 为 26 位 Crockford Base32（不含 I / L / O / U），前 10 位是毫秒时间戳，同一毫秒内批量生成保持递增。',
    ),
  );

  /* ---------- NanoID 面板 ---------- */

  const nanoLengthInput = el('input', {
    type: 'number',
    id: 'random-nanoid-length',
    'data-testid': 'random-nanoid-length',
    min: '2',
    max: '256',
    step: '1',
    value: String(NANO_ID_DEFAULT_LENGTH),
  });

  const nanoPresetSelect = el(
    'select',
    { id: 'random-nanoid-preset', 'data-testid': 'random-nanoid-preset' },
    NANO_ID_PRESETS.map(({ key, label }) => el('option', { value: key }, label)),
  );

  const nanoAlphabetInput = el('input', {
    type: 'text',
    id: 'random-nanoid-alphabet',
    'data-testid': 'random-nanoid-alphabet',
    value: NANO_ID_DEFAULT_ALPHABET,
    spellcheck: 'false',
    autocomplete: 'off',
  });

  const nanoPanel = el(
    'div',
    { class: 'random-panel', 'data-testid': 'random-panel-nanoid' },
    el('label', { class: 'field-label', for: 'random-nanoid-preset' }, '预设'),
    nanoPresetSelect,
    el('label', { class: 'field-label', for: 'random-nanoid-length' }, '长度（2–256）'),
    nanoLengthInput,
    el('label', { class: 'field-label', for: 'random-nanoid-alphabet' }, '字母表'),
    nanoAlphabetInput,
    el('p', { class: 'field-hint' }, '默认 A-Za-z0-9_-，可自定义；取字符使用拒绝采样，无取模偏差。'),
  );

  /* ---------- 密码面板 ---------- */

  const pwLengthRange = el('input', {
    type: 'range',
    id: 'random-pw-length',
    'data-testid': 'random-pw-length',
    min: String(PASSWORD_MIN_LENGTH),
    max: String(PASSWORD_MAX_LENGTH),
    step: '1',
    value: String(PASSWORD_DEFAULT_LENGTH),
  });
  const pwLengthNumber = el('input', {
    type: 'number',
    id: 'random-pw-length-input',
    'data-testid': 'random-pw-length-input',
    'aria-label': '密码长度数值',
    min: String(PASSWORD_MIN_LENGTH),
    max: String(PASSWORD_MAX_LENGTH),
    step: '1',
    value: String(PASSWORD_DEFAULT_LENGTH),
  });

  const pwUpper = checkRow('random-pw-upper', '大写字母（A–Z）', {
    testId: 'random-pw-upper',
    checked: true,
    onChange: onPasswordOptionChange,
  });
  const pwLower = checkRow('random-pw-lower', '小写字母（a–z）', {
    testId: 'random-pw-lower',
    checked: true,
    onChange: onPasswordOptionChange,
  });
  const pwDigits = checkRow('random-pw-digits', '数字（0–9）', {
    testId: 'random-pw-digits',
    checked: true,
    onChange: onPasswordOptionChange,
  });
  const pwSymbols = checkRow('random-pw-symbols', '符号（!@#$%^&*()-_=+[]{};:,.?/）', {
    testId: 'random-pw-symbols',
    checked: true,
    onChange: onPasswordOptionChange,
  });
  const pwAmbiguous = checkRow('random-pw-ambiguous', '排除易混淆字符（0 O 1 l I）', {
    testId: 'random-pw-ambiguous',
    onChange: onPasswordOptionChange,
  });
  const pwRequire = checkRow('random-pw-require', '每类至少一个', {
    testId: 'random-pw-require',
    checked: true,
    onChange: onPasswordOptionChange,
  });

  const pwEntropyValue = el('b', { 'data-testid': 'random-pw-entropy' }, '—');
  const pwPoolValue = el('span', { 'data-testid': 'random-pw-pool' }, '—');
  const pwStrengthBadge = el('span', { class: 'strength-badge', 'data-testid': 'random-pw-strength' }, '—');

  const passwordPanel = el(
    'div',
    { class: 'random-panel', 'data-testid': 'random-panel-password' },
    el(
      'div',
      { class: 'random-length-row' },
      el('label', { class: 'field-label', for: 'random-pw-length' }, '长度（4–128）'),
      pwLengthNumber,
    ),
    pwLengthRange,
    el('div', { class: 'field-label' }, '字符类别'),
    el('div', { class: 'random-checks' }, pwUpper.node, pwLower.node, pwDigits.node, pwSymbols.node),
    el('div', { class: 'field-label' }, '选项'),
    el('div', { class: 'random-checks' }, pwAmbiguous.node, pwRequire.node),
    el(
      'p',
      { class: 'random-meta' },
      '熵：',
      pwEntropyValue,
      ' 位（字符池 ',
      pwPoolValue,
      ' 个）· 强度：',
      pwStrengthBadge,
    ),
  );

  /* ---------- 解析面板 ---------- */

  const parseInput = el('textarea', {
    id: 'random-parse-input',
    'data-testid': 'random-parse-input',
    placeholder: '粘贴 UUID 或 ULID，自动识别并解析…',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
  });

  const parsePanel = el(
    'div',
    { class: 'random-panel', 'data-testid': 'random-panel-parse' },
    el('label', { class: 'field-label', for: 'random-parse-input' }, '输入'),
    parseInput,
    el(
      'p',
      { class: 'field-hint' },
      'UUID 支持 32 位十六进制（可带连字符 / 花括号、大小写不限），v1 / v7 会显示内嵌时间；ULID 为 26 位 Crockford Base32。',
    ),
  );

  /* ---------- 结果区 ---------- */

  const outputPre = el('pre', {
    id: 'random-output',
    class: 'output-box random-output',
    'data-testid': 'random-output',
    'aria-label': '生成结果',
    'aria-live': 'polite',
  });

  const resultCount = el('span', { class: 'random-result-count', 'data-testid': 'random-result-count' }, '');

  const outputWrap = el(
    'div',
    { class: 'random-output-wrap' },
    el('div', { class: 'random-result-head' }, el('span', { class: 'field-label' }, '结果'), resultCount),
    outputPre,
  );

  const parseCopyBtn = copyButton(() => (state.parsed ? formatIdInfo(state.parsed) : ''), {
    label: '复制解析结果',
  });

  const parseResultBox = el('div', { 'data-testid': 'random-parse-result' }, '');

  const parseWrap = el(
    'div',
    { class: 'random-parse-wrap' },
    el(
      'div',
      { class: 'random-result-head' },
      el('span', { class: 'field-label' }, '解析结果'),
      el('span', { class: 'random-result-head-actions' }, parseCopyBtn),
    ),
    parseResultBox,
  );

  const errorHost = el('div', { class: 'random-error-host' });

  /* ---------- 标签页 ---------- */

  const tabButtons = new Map();
  const tabSeg = el(
    'div',
    { class: 'seg random-tabs', role: 'group', 'aria-label': '生成类型' },
    TAB_DEFS.map(({ key, label }) => {
      const btn = el(
        'button',
        {
          type: 'button',
          'data-testid': `random-tab-${key}`,
          'aria-pressed': 'false',
          onClick: () => chooseTab(key),
        },
        label,
      );
      tabButtons.set(key, btn);
      return btn;
    }),
  );

  const panels = {
    uuid: uuidPanel,
    ulid: ulidPanel,
    nanoid: nanoPanel,
    password: passwordPanel,
    parse: parsePanel,
  };

  root.append(
    el(
      'section',
      { class: 'tool random' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
      ),
      tabSeg,
      generatorBar,
      el(
        'div',
        { class: 'random-layout two-col' },
        el(
          'div',
          { class: 'random-settings-col' },
          ...TAB_DEFS.map(({ key }) => panels[key]),
          el(
            'p',
            { class: 'field-hint random-privacy' },
            '所有随机数来自浏览器的密码学安全随机源，全程本地生成，不会上传。',
          ),
        ),
        el('div', { class: 'random-result-col' }, outputWrap, parseWrap, errorHost),
      ),
    ),
  );

  /* ---------- 生成 ---------- */

  function readPasswordOptions() {
    return {
      length: state.passwordLength,
      uppercase: pwUpper.input.checked,
      lowercase: pwLower.input.checked,
      digits: pwDigits.input.checked,
      symbols: pwSymbols.input.checked,
      excludeAmbiguous: pwAmbiguous.input.checked,
      requireEach: pwRequire.input.checked,
    };
  }

  function updatePasswordMeta() {
    const options = readPasswordOptions();
    const entropy = passwordEntropy(options);
    const level = PASSWORD_STRENGTH_LEVELS.find(({ min }) => entropy >= min) ?? PASSWORD_STRENGTH_LEVELS[PASSWORD_STRENGTH_LEVELS.length - 1];
    pwEntropyValue.textContent = formatEntropy(entropy);
    pwPoolValue.textContent = String(passwordPoolSize(options));
    pwStrengthBadge.textContent = passwordStrength(entropy);
    pwStrengthBadge.className = `strength-badge ${level.className}`;
  }

  function generate() {
    const count = Number(countInput.value);
    let result = null;
    if (state.tab === 'uuid') {
      result = uuidBatch({
        version: state.uuidVersion,
        count,
        uppercase: uuidUpper.input.checked,
        hyphens: !uuidNoHyphens.input.checked,
        braces: uuidBraces.input.checked,
      });
    } else if (state.tab === 'ulid') {
      result = ulidBatch({ count, uppercase: ulidUpper.input.checked });
    } else if (state.tab === 'nanoid') {
      result = nanoIdBatch({
        count,
        length: Number(nanoLengthInput.value),
        alphabet: nanoAlphabetInput.value,
      });
    } else if (state.tab === 'password') {
      result = passwordBatch({ count, ...readPasswordOptions() });
    }
    if (result === null) return;

    state.values = result.ok ? result.values : [];
    outputPre.textContent = state.values.join('\n');
    resultCount.textContent = state.values.length > 0 ? `共 ${state.values.length} 个` : '';
    if (result.ok) clearError(errorHost);
    else showError(errorHost, result.error);
    copyAllBtn.disabled = state.values.length === 0;
    downloadBtn.disabled = state.values.length === 0;
  }

  /* ---------- 解析 ---------- */

  function runParse() {
    parseResultBox.replaceChildren();
    state.parsed = null;
    const text = parseInput.value.trim();
    if (text === '') {
      clearError(errorHost);
      parseCopyBtn.disabled = true;
      return;
    }
    const parsed = parseId(text);
    state.parsed = parsed.ok ? parsed : null;
    if (!parsed.ok) {
      clearError(errorHost);
      showError(errorHost, parsed.error);
      parseCopyBtn.disabled = true;
      return;
    }
    clearError(errorHost);
    parseResultBox.append(
      el(
        'dl',
        { class: 'random-parse-list', 'data-testid': 'random-parse-list' },
        parsed.rows.map(({ key, label, value }) =>
          el(
            'div',
            { class: 'random-parse-row' },
            el('dt', {}, label),
            el('dd', { 'data-testid': `random-parse-${key}` }, value),
          ),
        ),
      ),
    );
    parseCopyBtn.disabled = false;
  }

  /* ---------- 选项持久化 ---------- */

  function persist() {
    ctx.storage.set(STORAGE_TAB, state.tab);
    ctx.storage.set(STORAGE_COUNT, countInput.value);
    ctx.storage.set(STORAGE_OPTIONS, {
      uuid: {
        version: state.uuidVersion,
        uppercase: uuidUpper.input.checked,
        noHyphens: uuidNoHyphens.input.checked,
        braces: uuidBraces.input.checked,
      },
      ulid: { uppercase: ulidUpper.input.checked },
      nanoid: {
        length: nanoLengthInput.value,
        alphabet: nanoAlphabetInput.value,
        preset: state.nanoidPreset,
      },
      password: readPasswordOptions(),
    });
  }

  /* ---------- 防抖调度 ---------- */

  const scheduleRegen = debounce(() => {
    persist();
    generate();
  }, REGEN_DEBOUNCE_MS);

  const scheduleParse = debounce(() => {
    persist();
    runParse();
  }, PARSE_DEBOUNCE_MS);

  function regenNow() {
    scheduleRegen.cancel();
    scheduleParse.cancel();
    persist();
    generate();
  }

  /* ---------- 密码选项联动 ---------- */

  /** 同步滑块 / 数字输入框与内部长度状态（滑块会把越界值夹回 4–128，故以状态为准） */
  function syncPasswordLength(value) {
    state.passwordLength = Number(value);
    const text = String(value);
    if (pwLengthRange.value !== text) pwLengthRange.value = text;
    if (pwLengthNumber.value !== text) pwLengthNumber.value = text;
  }

  function onPasswordOptionChange() {
    updatePasswordMeta();
    persist();
    scheduleRegen();
  }

  pwLengthRange.addEventListener('input', () => {
    syncPasswordLength(pwLengthRange.value);
    updatePasswordMeta();
    scheduleRegen();
  });
  pwLengthNumber.addEventListener('input', () => {
    syncPasswordLength(pwLengthNumber.value);
    updatePasswordMeta();
    scheduleRegen();
  });

  /* ---------- NanoID 预设与字母表联动 ---------- */

  nanoPresetSelect.addEventListener('change', () => {
    const preset = NANO_ID_PRESETS.find(({ key }) => key === nanoPresetSelect.value);
    if (!preset) return;
    state.nanoidPreset = preset.key;
    if (preset.alphabet !== '') nanoAlphabetInput.value = preset.alphabet;
    regenNow();
  });

  nanoAlphabetInput.addEventListener('input', () => {
    const matched = NANO_ID_PRESETS.find(
      ({ alphabet }) => alphabet !== '' && alphabet === nanoAlphabetInput.value,
    );
    state.nanoidPreset = matched ? matched.key : 'custom';
    nanoPresetSelect.value = state.nanoidPreset;
    scheduleRegen();
  });

  nanoLengthInput.addEventListener('input', () => scheduleRegen());

  countInput.addEventListener('input', () => scheduleRegen());

  parseInput.addEventListener('input', () => scheduleParse());

  /* ---------- 标签切换 ---------- */

  function chooseTab(key) {
    state.tab = key;
    for (const [tabKey, btn] of tabButtons) {
      btn.setAttribute('aria-pressed', String(tabKey === key));
    }
    for (const [tabKey, panel] of Object.entries(panels)) panel.hidden = tabKey !== key;
    const isParse = key === 'parse';
    generatorBar.hidden = isParse;
    outputWrap.hidden = isParse;
    parseWrap.hidden = !isParse;
    clearError(errorHost);
    ctx.storage.set(STORAGE_TAB, key);
    if (isParse) {
      scheduleRegen.cancel();
      runParse();
    } else {
      scheduleParse.cancel();
      generate();
    }
  }

  /* ---------- 恢复上次选项 ---------- */

  const savedOptions = ctx.storage.get(STORAGE_OPTIONS, null);
  if (isPlainObject(savedOptions)) {
    const { uuid, ulid, nanoid, password } = savedOptions;
    if (isPlainObject(uuid)) {
      if (uuid.version === 4 || uuid.version === 7) {
        state.uuidVersion = uuid.version;
        uuidSeg.sync(uuid.version);
      }
      if (typeof uuid.uppercase === 'boolean') uuidUpper.input.checked = uuid.uppercase;
      if (typeof uuid.noHyphens === 'boolean') uuidNoHyphens.input.checked = uuid.noHyphens;
      if (typeof uuid.braces === 'boolean') uuidBraces.input.checked = uuid.braces;
    }
    if (isPlainObject(ulid) && typeof ulid.uppercase === 'boolean') {
      ulidUpper.input.checked = ulid.uppercase;
    }
    if (isPlainObject(nanoid)) {
      if (nanoid.length !== undefined && nanoid.length !== null) nanoLengthInput.value = String(nanoid.length);
      if (typeof nanoid.alphabet === 'string' && nanoid.alphabet !== '') nanoAlphabetInput.value = nanoid.alphabet;
      const matched = NANO_ID_PRESETS.find(({ alphabet }) => alphabet === nanoAlphabetInput.value);
      state.nanoidPreset = matched ? matched.key : 'custom';
      if (nanoid.preset === 'custom') state.nanoidPreset = 'custom';
      nanoPresetSelect.value = state.nanoidPreset;
    }
    if (isPlainObject(password)) {
      const restored = readPasswordOptions();
      for (const key of ['uppercase', 'lowercase', 'digits', 'symbols', 'excludeAmbiguous', 'requireEach']) {
        if (typeof password[key] === 'boolean') restored[key] = password[key];
      }
      pwUpper.input.checked = restored.uppercase;
      pwLower.input.checked = restored.lowercase;
      pwDigits.input.checked = restored.digits;
      pwSymbols.input.checked = restored.symbols;
      pwAmbiguous.input.checked = restored.excludeAmbiguous;
      pwRequire.input.checked = restored.requireEach;
      const length = Number(password.length);
      if (Number.isInteger(length)) syncPasswordLength(length);
    }
  }

  const savedCount = Number(ctx.storage.get(STORAGE_COUNT, 1));
  if (Number.isInteger(savedCount) && savedCount >= COUNT_MIN && savedCount <= COUNT_MAX) {
    countInput.value = String(savedCount);
  }

  updatePasswordMeta();
  const savedTab = ctx.storage.get(STORAGE_TAB, 'uuid');
  chooseTab(TAB_DEFS.some(({ key }) => key === savedTab) ? savedTab : 'uuid');

  /* ---------- 清理函数 ---------- */

  return () => {
    scheduleRegen.cancel();
    scheduleParse.cancel();
  };
}
