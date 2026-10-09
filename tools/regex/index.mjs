/**
 * 正则测试 —— 工具入口（外壳在进入 #/regex 时动态加载本模块）。
 *
 * 功能：
 *   - 正则输入不带两侧斜杠；粘贴 /pattern/flags 字面量自动拆出源文本与标志；
 *   - 标志复选框 g i m s u y d v（u 与 v 互斥，勾选其一会取消另一个）；
 *   - 测试文本实时高亮所有匹配（两种颜色交替，空匹配以细竖线标出）；
 *   - 匹配列表：序号、内容、起止位置（UTF-16 下标）、编号与命名分组（未匹配显示「未匹配」）；
 *   - 匹配数量统计；超过 1 万个匹配只高亮前 1 万个并提示，列表只显示前 200 条；
 *   - 替换预览支持 $1、$<name>、$&、$`、$'、$$，结果可复制；
 *   - 匹配与替换都在 Web Worker（./worker.mjs）中执行，超过 1 秒终止 worker 并提示
 *     「匹配超时，可能存在灾难性回溯」，页面始终可操作；
 *   - 常用正则速查（邮箱 / 手机号 / IPv4 / 日期 / 中文字符 / URL），点击填入；
 *   - 正则、标志、测试文本、替换串经 ctx.storage 记忆。
 *
 * 纯逻辑在 ./logic.mjs；公共组件来自 assets/js/ui.mjs。
 */

import { clearError, copyButton, debounce, el, showError } from '../../assets/js/ui.mjs';
import {
  FLAG_ITEMS,
  MAX_RENDERED_HIGHLIGHTS,
  MAX_RENDERED_MATCH_ROWS,
  PRESETS,
  formatMatchesText,
  parsePatternLiteral,
} from './logic.mjs';

const DEBOUNCE_MS = 120; // 输入自动更新的防抖（约定 ≤ 300ms）
const WORKER_TIMEOUT_MS = 1000; // 超过 1 秒终止 worker（验收要求 2 秒内提示）
const TIMEOUT_MESSAGE = '匹配超时，可能存在灾难性回溯。可修正正则或缩短文本后重试。';
const IDLE_HINT = '输入正则表达式后，匹配结果会实时高亮显示。';

export async function mount(root, ctx) {
  ctx.loadStyle('tools/regex/style.css');

  /* ---------- 状态 ---------- */

  const readString = (key, fallback) => {
    const v = ctx.storage.get(key, fallback);
    return typeof v === 'string' ? v : fallback;
  };
  const savedFlags = ctx.storage.get('flags', null);
  let flags = new Set(
    Array.isArray(savedFlags) ? savedFlags.filter((f) => typeof f === 'string' && /^[gimsuydv]$/.test(f)) : ['g'],
  );
  let seq = 0; // 运行序号：过期的 worker 结果一律忽略
  let worker = null;
  let workerTimer = null;
  let lastResult = null; // 最近一次成功结果（复制匹配列表用）

  /* ---------- DOM ---------- */

  const patternInput = el('input', {
    id: 'regex-pattern',
    type: 'text',
    class: 'regex-pattern-input',
    'data-testid': 'regex-pattern',
    placeholder: '如 (\\d{4})-(\\d{2})-(\\d{2})，也可直接粘贴 /…/gi 自动拆分',
    spellcheck: 'false',
    autocomplete: 'off',
  });

  const checkboxes = {}; // flag -> input[type=checkbox]
  const flagsGroup = el(
    'div',
    { class: 'regex-flags', role: 'group', 'aria-label': '正则标志', 'data-testid': 'regex-flags' },
    FLAG_ITEMS.map(({ flag, desc }) => {
      const box = el('input', {
        type: 'checkbox',
        'data-testid': `regex-flag-${flag}`,
        'aria-label': `标志 ${flag}（${desc}）`,
        title: `${desc}（${flag}）`,
        onChange: () => onFlagChange(flag, box.checked),
      });
      box.checked = flags.has(flag);
      checkboxes[flag] = box;
      return el('label', { class: 'regex-flag' }, box, el('span', { class: 'regex-flag-text' }, `${flag} ${desc}`));
    }),
  );

  const statusBox = el('div', { class: 'regex-status' }); // showError 的挂载容器

  const presetsGroup = el(
    'div',
    { class: 'regex-presets', 'aria-label': '常用正则速查' },
    PRESETS.map((p) =>
      el(
        'button',
        { type: 'button', class: 'btn btn-sm regex-preset', title: p.source, onClick: () => applyPreset(p) },
        p.name,
      ),
    ),
  );

  const textInput = el('textarea', {
    id: 'regex-text',
    'data-testid': 'regex-text',
    'aria-label': '测试文本',
    placeholder: '输入或粘贴测试文本，匹配结果实时更新…',
    spellcheck: 'false',
  });

  const countValue = el(
    'span',
    { class: 'regex-count-num', 'data-testid': 'regex-match-count', 'aria-label': '匹配数量' },
    '0',
  );
  const truncatedHint = el(
    'span',
    { class: 'regex-truncated', 'data-testid': 'regex-truncated', hidden: true },
    '',
  );
  const highlightBox = el('div', {
    class: 'output-box regex-highlight',
    'data-testid': 'regex-highlight',
    'aria-label': '匹配高亮',
  });
  highlightBox.textContent = IDLE_HINT;

  const emptyState = el(
    'p',
    { class: 'regex-empty', 'data-testid': 'regex-empty', hidden: true },
    '没有匹配结果',
  );
  const matchListBox = el('div', { class: 'regex-match-list', 'data-testid': 'regex-match-list' });

  const replacementInput = el('input', {
    id: 'regex-replacement',
    type: 'text',
    class: 'regex-replacement-input',
    'data-testid': 'regex-replacement',
    placeholder: '如 $3/$2/$1 或 $<month>月',
    spellcheck: 'false',
    autocomplete: 'off',
  });

  const replaceResultBox = el('div', {
    class: 'output-box regex-replace-result',
    'data-testid': 'regex-replace-result',
    role: 'region', // 允许命名的输出区域（div 本身的 role 不允许 aria-label）
    'aria-label': '替换结果',
  });

  root.append(
    el(
      'section',
      { class: 'tool regex' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el('div', { class: 'tool-actions' }, copyButton(() => formatMatchesText(lastResult), { label: '复制匹配列表' })),
      ),
      el(
        'div',
        { class: 'regex-panel' },
        el('label', { class: 'field-label', for: 'regex-pattern' }, '正则表达式'),
        el('div', { class: 'regex-pattern-row' }, patternInput, flagsGroup),
        el(
          'p',
          { class: 'field-hint' },
          '不带两侧斜杠；粘贴 /pattern/flags 形式会自动拆出标志。所有处理都在本地浏览器完成。',
        ),
        statusBox,
        el('span', { class: 'field-label regex-presets-label' }, '常用正则速查'),
        presetsGroup,
      ),
      el(
        'div',
        { class: 'two-col regex-workbench' },
        el(
          'div',
          { class: 'regex-text-col' },
          el('label', { class: 'field-label', for: 'regex-text' }, '测试文本'),
          textInput,
        ),
        el(
          'div',
          { class: 'regex-preview-col' },
          el(
            'div',
            { class: 'regex-stats' },
            el('span', { class: 'regex-count' }, '匹配 ', countValue, ' 个'),
            truncatedHint,
          ),
          highlightBox,
        ),
      ),
      el(
        'div',
        { class: 'regex-matches' },
        el('span', { class: 'field-label' }, '匹配列表'),
        el(
          'p',
          { class: 'field-hint' },
          '位置为 UTF-16 下标（起–止）；未参与匹配的分组显示「未匹配」。',
        ),
        emptyState,
        matchListBox,
      ),
      el(
        'div',
        { class: 'regex-replace' },
        el('label', { class: 'field-label', for: 'regex-replacement' }, '替换为'),
        el('div', { class: 'regex-replace-row' }, replacementInput, copyButton(() => replaceResultBox.textContent, { label: '复制替换结果' })),
        el('p', { class: 'field-hint' }, '支持 $1 编号分组、$<name> 命名分组、$& 整个匹配、$` 之前、$\' 之后、$$ 字面量 $。'),
        replaceResultBox,
      ),
    ),
  );

  /* ---------- 交互 ---------- */

  const scheduleRun = debounce(runNow, DEBOUNCE_MS);

  function syncFlagChecks() {
    for (const { flag } of FLAG_ITEMS) checkboxes[flag].checked = flags.has(flag);
  }

  function setFlags(list) {
    flags = new Set(list);
    syncFlagChecks();
  }

  function onFlagChange(flag, checked) {
    if (checked) {
      flags.add(flag);
      if (flag === 'u' && flags.has('v')) flags.delete('v'); // u 与 v 互斥
      if (flag === 'v' && flags.has('u')) flags.delete('u');
    } else {
      flags.delete(flag);
    }
    syncFlagChecks();
    scheduleRun();
  }

  function onPatternInput() {
    const literal = parsePatternLiteral(patternInput.value);
    if (literal) {
      // 粘贴 /pattern/flags：拆出源文本与标志（程序赋值不再触发 input，无循环）
      patternInput.value = literal.source;
      setFlags(literal.flags);
    }
    scheduleRun();
  }

  function applyPreset(preset) {
    patternInput.value = preset.source;
    setFlags(preset.flags);
    runNow();
  }

  function persistState() {
    ctx.storage.set('pattern', patternInput.value);
    ctx.storage.set('flags', [...flags]);
    ctx.storage.set('text', textInput.value);
    ctx.storage.set('replacement', replacementInput.value);
  }

  /* ---------- worker ---------- */

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

  function onWorkerMessage(id, msg) {
    if (id !== seq || !msg || msg.type !== 'result') return; // 过期结果
    if (workerTimer !== null) {
      clearTimeout(workerTimer);
      workerTimer = null;
    }
    terminateWorker(); // 本次运行结束，下次运行重建
    if (!msg.ok) {
      showError(statusBox, msg.message);
      renderCleared();
      return;
    }
    lastResult = msg;
    renderResult(msg);
  }

  /* ---------- 渲染 ---------- */

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 高亮视图：普通文本片段 + <mark>，两种颜色交替；空匹配渲染成细竖线 */
  function renderHighlight(text, matches) {
    const limit = Math.min(matches.length, MAX_RENDERED_HIGHLIGHTS);
    const parts = [];
    let pos = 0;
    for (let i = 0; i < limit; i++) {
      const m = matches[i];
      if (m.index > pos) parts.push(escapeHtml(text.slice(pos, m.index)));
      const cls = m.text === '' ? 'rx-empty' : i % 2 === 0 ? 'rx-a' : 'rx-b';
      parts.push(`<mark class="rx-hl ${cls}">${escapeHtml(m.text)}</mark>`);
      pos = m.end;
    }
    if (pos < text.length) parts.push(escapeHtml(text.slice(pos)));
    highlightBox.classList.remove('is-idle');
    highlightBox.innerHTML = parts.join('');
  }

  function groupValueText(value) {
    if (value === null) return '未匹配';
    if (value === '') return '空串';
    return value;
  }

  function matchRow(i, m) {
    return el(
      'div',
      { class: 'regex-match', 'data-testid': `regex-match-${i}` },
      el(
        'div',
        { class: 'regex-match-head' },
        el('span', { class: 'regex-match-no' }, `#${i + 1}`),
        el('code', { class: 'regex-match-text' }, m.text === '' ? '（空匹配）' : m.text),
        el('span', { class: 'regex-match-pos' }, `${m.index}–${m.end}`),
      ),
      m.groups.length > 0
        ? el(
            'div',
            { class: 'regex-match-groups' },
            m.groups.map((g) =>
              el(
                'span',
                { class: `regex-group${g.value === null ? ' is-null' : ''}` },
                `${g.label}: `,
                el('code', {}, groupValueText(g.value)),
              ),
            ),
          )
        : null,
    );
  }

  function renderMatchList(matches, count) {
    matchListBox.replaceChildren();
    if (count === 0) {
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;
    const limit = Math.min(matches.length, MAX_RENDERED_MATCH_ROWS);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < limit; i++) frag.append(matchRow(i, matches[i]));
    if (count > limit) {
      frag.append(
        el(
          'p',
          { class: 'field-hint', 'data-testid': 'regex-match-list-hint' },
          `匹配较多，列表仅显示前 ${limit} 条（共 ${count} 个）。`,
        ),
      );
    }
    matchListBox.append(frag);
  }

  function renderResult(msg) {
    const { matches, count, countedAll, replaceResult } = msg;
    countValue.textContent = String(count);

    if (count > MAX_RENDERED_HIGHLIGHTS || !countedAll) {
      truncatedHint.textContent = `共 ${count}${countedAll ? '' : '+'} 个匹配，仅高亮前 ${MAX_RENDERED_HIGHLIGHTS} 个`;
      truncatedHint.hidden = false;
    } else {
      truncatedHint.hidden = true;
    }

    renderMatchList(matches, count);
    replaceResultBox.textContent = replaceResult ?? '';
    renderHighlight(textInput.value, matches);
  }

  /** 结果区清空（语法错误等）：保留输入，只清结果 */
  function renderCleared() {
    countValue.textContent = '0';
    truncatedHint.hidden = true;
    emptyState.hidden = true;
    matchListBox.replaceChildren();
    replaceResultBox.textContent = '';
    highlightBox.classList.remove('is-idle');
    highlightBox.innerHTML = '';
    lastResult = null;
  }

  /** 空闲态（未输入正则 / 匹配超时后重置） */
  function renderIdle() {
    countValue.textContent = '0';
    truncatedHint.hidden = true;
    emptyState.hidden = true;
    matchListBox.replaceChildren();
    replaceResultBox.textContent = '';
    highlightBox.innerHTML = '';
    highlightBox.classList.add('is-idle');
    highlightBox.textContent = IDLE_HINT;
    lastResult = null;
  }

  /* ---------- 一次运行 ---------- */

  function runNow() {
    persistState();
    seq += 1;
    const id = seq;
    terminateWorker(); // 丢弃上一次（可能仍在计算的）请求：每次运行独立 worker
    clearError(statusBox);

    if (patternInput.value === '') {
      renderIdle();
      return;
    }

    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => onWorkerMessage(id, event.data));
    worker.addEventListener('error', () => {
      if (id !== seq) return;
      if (workerTimer !== null) {
        clearTimeout(workerTimer);
        workerTimer = null;
      }
      showError(statusBox, '正则模块加载失败，请刷新页面重试。');
      renderCleared();
    });
    worker.postMessage({
      type: 'run',
      id,
      source: patternInput.value,
      flags: [...flags],
      text: textInput.value,
      replacement: replacementInput.value,
    });
    workerTimer = setTimeout(() => {
      if (id !== seq) return;
      terminateWorker();
      showError(statusBox, TIMEOUT_MESSAGE);
      renderIdle();
    }, WORKER_TIMEOUT_MS);
  }

  patternInput.addEventListener('input', onPatternInput);
  textInput.addEventListener('input', scheduleRun);
  replacementInput.addEventListener('input', scheduleRun);

  /* ---------- 恢复上次输入并立即运行一次 ---------- */

  patternInput.value = readString('pattern', '');
  replacementInput.value = readString('replacement', '');
  textInput.value = readString('text', '');
  syncFlagChecks();
  runNow();

  /* ---------- 清理函数（离开工具时由外壳调用） ---------- */

  return () => {
    terminateWorker();
    scheduleRun.cancel();
  };
}
