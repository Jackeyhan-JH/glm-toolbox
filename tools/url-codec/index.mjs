/**
 * URL 编解码 —— 工具入口（外壳在进入 #/url-codec 时动态加载本模块）。
 *
 * 页面分两个功能页签：
 *   编解码     编码（组件 / 完整 URL 两种模式，可选「空格编码为 +」）
 *              与解码（可选「+ 当作空格」，失败给中文原因与位置）
 *   URL 解析   输入完整 URL 或查询字符串 → 部件表格 + 可编辑参数表，
 *              参数增删改 / 上下移动后实时重建 URL，支持「全部解码显示」
 *
 * mount(root, ctx) 协议见 CONTRIBUTING.md；返回清理函数取消防抖定时器。
 */

import { clearError, copyButton, debounce, el, showError } from '../../assets/js/ui.mjs';
import { ENCODE_MODES, decodeBestEffort, decodeText, encodeText, parseInput, rebuildUrl } from './logic.mjs';

const CODEC_DEBOUNCE_MS = 150; // 输入防抖（验收要求 ≤ 300ms）
const PARSE_DEBOUNCE_MS = 200;

const STORAGE_KEYS = {
  tab: 'tab',
  mode: 'encode-mode',
  plusForSpace: 'encode-plus-for-space',
  plusAsSpace: 'decode-plus-as-space',
  url: 'url-input',
};

/** URL 模式部件表格的行定义（键与展示名；键同时用于 data-testid） */
const PART_ROWS = [
  ['protocol', '协议'],
  ['username', '用户名'],
  ['password', '密码'],
  ['hostname', '主机'],
  ['port', '端口'],
  ['pathname', '路径（原样）'],
  ['pathnameDecoded', '路径（解码后）'],
  ['search', '查询字符串（原样）'],
  ['hash', '哈希（hash）'],
];

export async function mount(root, ctx) {
  ctx.loadStyle('tools/url-codec/style.css');

  /* ---------- 状态 ---------- */

  let encodeMode = ctx.storage.get(STORAGE_KEYS.mode, 'component');
  if (!ENCODE_MODES.some((m) => m.id === encodeMode)) encodeMode = 'component';
  let plusForSpace = ctx.storage.get(STORAGE_KEYS.plusForSpace, false) === true;
  let plusAsSpace = ctx.storage.get(STORAGE_KEYS.plusAsSpace, false) === true;

  /** 最近一次解析成功的结果（parseInput 的返回值），失败 / 清空时为 null */
  let parsed = null;
  /** 参数表当前内容（键、值均为解码后的文本，与表中输入框一一对应） */
  let paramRows = [];

  /* ---------- 页签 ---------- */

  let activeTab = ctx.storage.get(STORAGE_KEYS.tab, 'codec');
  if (activeTab !== 'codec' && activeTab !== 'parse') activeTab = 'codec';

  const codecTabBtn = el('button', { type: 'button' }, '编解码');
  const parseTabBtn = el('button', { type: 'button' }, 'URL 解析');

  /* ---------- 编码面板 ---------- */

  const modeButtons = new Map(
    ENCODE_MODES.map(({ id, label }) => {
      const btn = el('button', { type: 'button' }, label);
      btn.addEventListener('click', () => {
        encodeMode = id;
        ctx.storage.set(STORAGE_KEYS.mode, id);
        renderModeSeg();
        runEncode();
      });
      return [id, btn];
    }),
  );
  const modeSeg = el('div', { class: 'seg', role: 'group', 'aria-label': '编码模式' }, [...modeButtons.values()]);

  const plusSpaceCheck = el('input', { type: 'checkbox' });
  const plusSpaceLabel = el(
    'label',
    { class: 'check' },
    plusSpaceCheck,
    el('span', {}, '空格编码为 +（表单格式）'),
  );

  const encodeInput = el('textarea', {
    id: 'url-codec-encode-input',
    'data-testid': 'url-codec-encode-input',
    placeholder: '输入或粘贴要编码的文本…',
    spellcheck: 'false',
  });

  const encodeOutput = el('div', { class: 'output-box', 'data-testid': 'url-codec-encode-output' }, '');
  const encodeCopy = copyButton(() => encodeOutput.textContent, { label: '复制编码结果' });

  const encodeSection = el(
    'section',
    { class: 'codec-card' },
    el('h2', { class: 'panel-title' }, '编码'),
    el('div', { class: 'form-row' }, modeSeg, plusSpaceLabel),
    el('label', { class: 'field-label', for: 'url-codec-encode-input' }, '要编码的文本'),
    encodeInput,
    el('div', { class: 'result-head' }, el('span', { class: 'field-label' }, '编码结果'), encodeCopy),
    encodeOutput,
  );

  /* ---------- 解码面板 ---------- */

  const plusAsSpaceCheck = el('input', { type: 'checkbox' });
  const plusAsSpaceLabel = el(
    'label',
    { class: 'check' },
    plusAsSpaceCheck,
    el('span', {}, '将 + 解码为空格'),
  );

  const decodeInput = el('textarea', {
    id: 'url-codec-decode-input',
    'data-testid': 'url-codec-decode-input',
    placeholder: '输入或粘贴要解码的文本，如 %E7%A0%81…',
    spellcheck: 'false',
  });

  const decodeOutput = el('div', { class: 'output-box', 'data-testid': 'url-codec-decode-output' }, '');
  const decodeCopy = copyButton(() => decodeOutput.textContent, { label: '复制解码结果' });

  const decodeSection = el(
    'section',
    { class: 'codec-card' },
    el('h2', { class: 'panel-title' }, '解码'),
    el('div', { class: 'form-row' }, plusAsSpaceLabel),
    el('label', { class: 'field-label', for: 'url-codec-decode-input' }, '要解码的文本'),
    decodeInput,
    el('div', { class: 'result-head' }, el('span', { class: 'field-label' }, '解码结果'), decodeCopy),
    decodeOutput,
  );

  const codecPanel = el(
    'div',
    { class: 'panel', 'data-testid': 'url-codec-panel-codec' },
    el('div', { class: 'two-col' }, encodeSection, decodeSection),
  );

  /* ---------- URL 解析面板 ---------- */

  const urlInput = el('input', {
    type: 'text',
    id: 'url-codec-url-input',
    'data-testid': 'url-codec-url-input',
    class: 'mono',
    placeholder: 'https://example.com/path?a=1 或 a=1&b=2',
    spellcheck: 'false',
    autocomplete: 'off',
  });

  const partsTbody = el('tbody');
  const partsTable = el(
    'table',
    { class: 'parts-table' },
    el(
      'thead',
      {},
      el('tr', {}, el('th', { scope: 'col' }, '部件'), el('th', { scope: 'col' }, '内容')),
    ),
    partsTbody,
  );

  const queryNote = el(
    'p',
    { class: 'field-hint query-note' },
    '输入的是查询字符串：参数见下方表格；补全协议（如 https://）后可解析完整 URL。',
  );

  const parseResult = el(
    'div',
    { class: 'parse-result', 'data-testid': 'url-codec-parse-result' },
    queryNote,
    el('div', { class: 'table-wrap' }, partsTable),
  );

  const rebuiltOutput = el('div', { class: 'output-box', 'data-testid': 'url-codec-rebuilt' }, '');
  const rebuiltCopy = copyButton(() => rebuiltOutput.textContent, { label: '复制重建 URL' });

  const showDecodedCheck = el('input', { type: 'checkbox' });
  const showDecodedLabel = el('label', { class: 'check' }, showDecodedCheck, el('span', {}, '全部解码显示'));
  const decodedOutput = el(
    'div',
    { class: 'output-box', 'data-testid': 'url-codec-decoded-url', hidden: true },
    '',
  );
  const decodedCopy = copyButton(() => decodedOutput.textContent, { label: '复制解码后 URL' });

  const rebuildSection = el(
    'section',
    { class: 'block', hidden: true },
    el('div', { class: 'result-head' }, el('h2', { class: 'panel-title' }, '重建 URL'), rebuiltCopy),
    rebuiltOutput,
    el('div', { class: 'form-row decoded-row' }, showDecodedLabel, decodedCopy),
    decodedOutput,
  );

  const paramsTbody = el('tbody', { 'data-testid': 'url-codec-params' });
  const paramsTable = el(
    'table',
    { class: 'params-table' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col' }, '键'),
        el('th', { scope: 'col' }, '值'),
        el('th', { scope: 'col' }, '操作'),
      ),
    ),
    paramsTbody,
  );
  const addParamBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm btn-primary',
      onClick: () => {
        paramRows.push({ key: '', value: '' });
        renderParams();
        paramsTbody.querySelector('tr:last-child input')?.focus();
      },
    },
    '新增参数',
  );

  const paramsSection = el(
    'section',
    { class: 'block', hidden: true },
    el('div', { class: 'result-head' }, el('h2', { class: 'panel-title' }, '查询参数'), addParamBtn),
    el('p', { class: 'field-hint' }, '在表中增删改、上下移动参数行，上方 URL 实时重建；键、值均按解码后内容编辑。'),
    el('div', { class: 'table-wrap' }, paramsTable),
  );

  const parsePanel = el(
    'div',
    { class: 'panel', 'data-testid': 'url-codec-panel-parse', hidden: true },
    el('label', { class: 'field-label', for: 'url-codec-url-input' }, 'URL 或查询字符串'),
    urlInput,
    el('p', { class: 'field-hint' }, '内容只在浏览器本地解析，不会请求该地址。'),
    parseResult,
    rebuildSection,
    paramsSection,
  );

  /* ---------- 组装 ---------- */

  root.append(
    el(
      'section',
      { class: 'tool url-codec' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
      ),
      el('div', { class: 'seg tabs', role: 'group', 'aria-label': '功能选择' }, codecTabBtn, parseTabBtn),
      codecPanel,
      parsePanel,
    ),
  );

  /* ---------- 渲染 ---------- */

  function renderModeSeg() {
    for (const [id, btn] of modeButtons) btn.setAttribute('aria-pressed', String(id === encodeMode));
  }

  function renderParts(parts) {
    partsTbody.replaceChildren(
      ...PART_ROWS.map(([key, label]) =>
        el(
          'tr',
          {},
          el('th', { scope: 'row' }, label),
          el('td', { class: 'mono', 'data-testid': `url-codec-part-${key}` }, parts[key]),
        ),
      ),
    );
  }

  function renderParams() {
    paramsTbody.replaceChildren();
    if (paramRows.length === 0) {
      paramsTbody.append(el('tr', {}, el('td', { colspan: '3', class: 'empty-cell' }, '暂无参数')));
      return;
    }
    paramRows.forEach((row, index) => {
      const keyInput = el('input', {
        type: 'text',
        value: row.key,
        'aria-label': '参数键',
        'data-testid': 'url-codec-param-key',
        spellcheck: 'false',
      });
      keyInput.addEventListener('input', () => {
        row.key = keyInput.value;
        refreshRebuild();
      });
      const valueInput = el('input', {
        type: 'text',
        value: row.value,
        'aria-label': '参数值',
        'data-testid': 'url-codec-param-value',
        spellcheck: 'false',
      });
      valueInput.addEventListener('input', () => {
        row.value = valueInput.value;
        refreshRebuild();
      });
      paramsTbody.append(
        el(
          'tr',
          { 'data-testid': 'url-codec-param-row' },
          el('td', {}, keyInput),
          el('td', {}, valueInput),
          el(
            'td',
            { class: 'ops' },
            el(
              'button',
              {
                type: 'button',
                class: 'btn btn-sm btn-ghost',
                disabled: index === 0,
                onClick: () => moveRow(index, -1),
              },
              '上移',
            ),
            el(
              'button',
              {
                type: 'button',
                class: 'btn btn-sm btn-ghost',
                disabled: index === paramRows.length - 1,
                onClick: () => moveRow(index, 1),
              },
              '下移',
            ),
            el(
              'button',
              {
                type: 'button',
                class: 'btn btn-sm btn-ghost',
                onClick: () => {
                  paramRows.splice(index, 1);
                  renderParams();
                },
              },
              '删除',
            ),
          ),
        ),
      );
    });
    refreshRebuild(); // 结构变化（增删移）不触发 input 事件，这里统一刷新重建结果
  }

  function moveRow(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= paramRows.length) return;
    [paramRows[index], paramRows[target]] = [paramRows[target], paramRows[index]];
    renderParams();
  }

  function refreshRebuild() {
    const rebuilt = parsed ? rebuildUrl(parsed, paramRows) : '';
    rebuiltOutput.textContent = rebuilt;
    decodedOutput.textContent = rebuilt === '' ? '' : decodeBestEffort(rebuilt);
  }

  /* ---------- 编解码 ---------- */

  function runEncode() {
    try {
      encodeOutput.textContent = encodeText(encodeInput.value, { mode: encodeMode, plusForSpace });
      clearError(encodeSection);
    } catch {
      // encodeURIComponent 遇到孤立代理项会抛错，兜底成中文提示
      encodeOutput.textContent = '';
      showError(encodeSection, '包含无法编码的字符（孤立的 UTF-16 代理项）');
    }
  }

  function runDecode() {
    const result = decodeText(decodeInput.value, { plusAsSpace });
    if (result.ok) {
      decodeOutput.textContent = result.value;
      clearError(decodeSection);
    } else {
      decodeOutput.textContent = '';
      showError(decodeSection, result.message);
    }
  }

  const refreshEncode = debounce(runEncode, CODEC_DEBOUNCE_MS);
  const refreshDecode = debounce(runDecode, CODEC_DEBOUNCE_MS);

  /* ---------- 解析 ---------- */

  function runParse() {
    const raw = urlInput.value;
    ctx.storage.set(STORAGE_KEYS.url, raw);

    if (raw.trim() === '') {
      applyParseResult(null);
      return;
    }
    applyParseResult(parseInput(raw));
  }

  /** 统一应用解析结果：成功渲染部件与参数表，失败只显示中文提示 */
  function applyParseResult(result) {
    parsed = result && result.ok ? result : null;
    paramRows = parsed ? parsed.params.map((p) => ({ key: p.key, value: p.value })) : [];

    if (!result || !result.ok) {
      clearError(parseResult);
      partsTable.hidden = true;
      queryNote.hidden = true;
      rebuildSection.hidden = true;
      paramsSection.hidden = true;
      if (result && !result.ok) showError(parseResult, result.message);
      renderParams(); // 显示「暂无参数」
      refreshRebuild();
      return;
    }

    clearError(parseResult);
    if (result.mode === 'url') {
      renderParts(result.parts);
      partsTable.hidden = false;
      queryNote.hidden = true;
    } else {
      partsTable.hidden = true;
      queryNote.hidden = false;
    }
    rebuildSection.hidden = false;
    paramsSection.hidden = false;
    renderParams();
    refreshRebuild();
  }

  const refreshParse = debounce(runParse, PARSE_DEBOUNCE_MS);

  /* ---------- 页签与选项 ---------- */

  function setTab(tab) {
    activeTab = tab;
    codecTabBtn.setAttribute('aria-pressed', String(tab === 'codec'));
    parseTabBtn.setAttribute('aria-pressed', String(tab === 'parse'));
    codecPanel.hidden = tab !== 'codec';
    parsePanel.hidden = tab !== 'parse';
    ctx.storage.set(STORAGE_KEYS.tab, tab);
  }

  codecTabBtn.addEventListener('click', () => setTab('codec'));
  parseTabBtn.addEventListener('click', () => setTab('parse'));

  plusSpaceCheck.addEventListener('change', () => {
    plusForSpace = plusSpaceCheck.checked;
    ctx.storage.set(STORAGE_KEYS.plusForSpace, plusForSpace);
    runEncode();
  });

  plusAsSpaceCheck.addEventListener('change', () => {
    plusAsSpace = plusAsSpaceCheck.checked;
    ctx.storage.set(STORAGE_KEYS.plusAsSpace, plusAsSpace);
    runDecode();
  });

  showDecodedCheck.addEventListener('change', () => {
    const on = showDecodedCheck.checked;
    decodedOutput.hidden = !on;
    decodedCopy.hidden = !on;
    refreshRebuild();
  });

  encodeInput.addEventListener('input', refreshEncode);
  decodeInput.addEventListener('input', refreshDecode);
  urlInput.addEventListener('input', refreshParse);

  /* ---------- 恢复上次状态并首刷 ---------- */

  plusSpaceCheck.checked = plusForSpace;
  plusAsSpaceCheck.checked = plusAsSpace;
  renderModeSeg();
  setTab(activeTab);

  const savedUrl = ctx.storage.get(STORAGE_KEYS.url, '');
  if (typeof savedUrl === 'string' && savedUrl !== '') urlInput.value = savedUrl;

  runEncode();
  runDecode();
  runParse();

  /* ---------- 清理（离开工具时由外壳调用） ---------- */

  return () => {
    refreshEncode.cancel();
    refreshDecode.cancel();
    refreshParse.cancel();
  };
}
