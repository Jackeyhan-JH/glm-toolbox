/**
 * 时间戳转换 —— 工具入口（外壳在进入 #/timestamp 时动态加载本模块）。
 *
 * 三个区域：
 *   当前时间      实时秒 / 毫秒时间戳（每秒刷新，可暂停），一键复制
 *   时间戳 → 日期 自动识别单位（秒 / 毫秒 / 微秒 / 纳秒，可手动指定），
 *                按「时区列表」逐行显示日期时间、星期、UTC 偏移与缩写，
 *                另附 ISO 8601（UTC）、RFC 2822 与相对时间；时区列表可
 *                添加（搜索 IANA 时区）/ 删除 / 排序，保存在 ctx.storage
 *   日期 → 时间戳 输入日期时间并选择所在时区（自带 UTC 偏移时以偏移为准），
 *                处理夏令时跳变（时刻不存在）与回拨（两个候选）
 *
 * 所有纯逻辑在 ./logic.mjs；公共组件来自 assets/js/ui.mjs。
 */

import { clearError, copyButton, debounce, el, showError } from '../../assets/js/ui.mjs';
import {
  DEFAULT_ZONE_LIST,
  LOCAL_ZONE,
  UNIT_OPTIONS,
  dateTimeToTimestamp,
  describeInZone,
  filterTimeZones,
  formatOffset,
  formatRelative,
  isoString,
  listTimeZones,
  parseTimestamp,
  resolveZone,
  rfc2822,
  sanitizeZones,
  zoneOffsetMs,
} from './logic.mjs';

const DEBOUNCE_MS = 200; // 输入自动更新的防抖（约定 ≤ 300ms）
const TICK_MS = 500; // 当前时间刷新间隔（≥ 每秒一次）

export async function mount(root, ctx) {
  ctx.loadStyle('tools/timestamp/style.css');

  /* ---------- 状态（从本地存储恢复） ---------- */

  let zones = sanitizeZones(ctx.storage.get('zones', null)); // 非数组 / 未存过 → 默认列表
  const savedUnit = ctx.storage.get('unit', 'auto');
  let tsUnit = UNIT_OPTIONS.some((u) => u.value === savedUnit) ? savedUnit : 'auto';
  let dateZone = ctx.storage.get('dateZone', LOCAL_ZONE);
  if (!(typeof dateZone === 'string') || !zones.includes(dateZone)) dateZone = zones[0] ?? LOCAL_ZONE;

  const displayName = (zone) => (zone === LOCAL_ZONE ? `本地（${resolveZone(LOCAL_ZONE)}）` : zone);
  const actionName = (zone) => (zone === LOCAL_ZONE ? '本地' : zone);

  /* ==================== 当前时间 ==================== */

  const nowSeconds = el('code', { 'data-testid': 'timestamp-now-seconds' }, '');
  const nowMillis = el('code', { 'data-testid': 'timestamp-now-millis' }, '');
  const nowLocal = el('span', { 'data-testid': 'timestamp-now-local' }, '');

  function tick() {
    const ms = Date.now();
    nowSeconds.textContent = String(Math.floor(ms / 1000));
    nowMillis.textContent = String(ms);
    nowLocal.textContent = describeInZone(ms, '', resolveZone(LOCAL_ZONE)).datetime;
  }

  let tickTimer = null;
  const startTick = () => {
    if (tickTimer === null) {
      tick();
      tickTimer = setInterval(tick, TICK_MS);
    }
  };
  const stopTick = () => {
    if (tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };

  const pauseBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'data-testid': 'timestamp-pause',
      'aria-pressed': 'false',
      onClick: () => {
        if (tickTimer === null) {
          startTick();
          pauseBtn.textContent = '暂停刷新';
          pauseBtn.setAttribute('aria-pressed', 'false');
        } else {
          stopTick();
          pauseBtn.textContent = '继续刷新';
          pauseBtn.setAttribute('aria-pressed', 'true');
        }
      },
    },
    '暂停刷新',
  );

  const nowPanel = el(
    'section',
    { class: 'timestamp-panel timestamp-now', 'data-testid': 'timestamp-panel-now' },
    el('h2', { class: 'timestamp-panel-title' }, '当前时间'),
    el(
      'div',
      { class: 'timestamp-now-grid' },
      el(
        'div',
        { class: 'timestamp-now-item' },
        el('div', { class: 'field-label' }, '秒时间戳'),
        el('div', { class: 'timestamp-now-value' }, nowSeconds, copyButton(() => nowSeconds.textContent, { label: '复制当前秒时间戳' })),
      ),
      el(
        'div',
        { class: 'timestamp-now-item' },
        el('div', { class: 'field-label' }, '毫秒时间戳'),
        el('div', { class: 'timestamp-now-value' }, nowMillis, copyButton(() => nowMillis.textContent, { label: '复制当前毫秒时间戳' })),
      ),
      el(
        'div',
        { class: 'timestamp-now-item timestamp-now-item-wide' },
        el('div', { class: 'field-label' }, '本地时间'),
        el('div', { class: 'timestamp-now-value' }, nowLocal),
      ),
      el('div', { class: 'timestamp-now-item timestamp-now-item-actions' }, pauseBtn),
    ),
  );

  /* ==================== 时间戳 → 日期 ==================== */

  const tsInput = el('input', {
    type: 'text',
    id: 'timestamp-input',
    'data-testid': 'timestamp-input',
    'aria-label': '时间戳',
    placeholder: '如 1700000000、1700000000123 或 -1.5',
    spellcheck: 'false',
    autocomplete: 'off',
    inputmode: 'numeric',
  });
  const unitSelect = el(
    'select',
    { id: 'timestamp-unit', 'data-testid': 'timestamp-unit', 'aria-label': '时间戳单位' },
    UNIT_OPTIONS.map(({ value, label }) => el('option', { value }, label)),
  );
  const tsErrorWrap = el('div', { 'data-testid': 'timestamp-error' });

  const zoneTableBody = el('tbody', {});

  const isoEl = el('code', { 'data-testid': 'timestamp-iso' }, '—');
  const rfcEl = el('code', { 'data-testid': 'timestamp-rfc2822' }, '—');
  const relativeEl = el('span', { 'data-testid': 'timestamp-relative' }, '—');

  let lastParse = null; // 最近一次成功解析的结果（复制摘要用）
  let tsTouched = false; // 用户输入过才对「空」提示，初次打开不报错

  const emptyRow = (text) =>
    el('tr', { class: 'timestamp-empty-row' }, el('td', { colspan: '6' }, el('em', {}, text)));

  function zoneRow(zone, parsed, index) {
    const resolved = resolveZone(zone);
    const cells = parsed
      ? (() => {
          const row = describeInZone(parsed.ms, parsed.fractionText, resolved);
          return [
            el('td', { class: 'timestamp-datetime', 'data-testid': `timestamp-time-${zone}` }, row.datetime),
            el('td', { 'data-testid': `timestamp-weekday-${zone}` }, row.weekday),
            el('td', { class: 'timestamp-offset', 'data-testid': `timestamp-offset-${zone}` }, row.offset),
            el('td', { 'data-testid': `timestamp-abbr-${zone}` }, row.abbr ?? '—'),
          ];
        })()
      : [
          el('td', { class: 'timestamp-datetime', 'data-testid': `timestamp-time-${zone}` }, '—'),
          el('td', { 'data-testid': `timestamp-weekday-${zone}` }, '—'),
          el('td', { class: 'timestamp-offset', 'data-testid': `timestamp-offset-${zone}` }, '—'),
          el('td', { 'data-testid': `timestamp-abbr-${zone}` }, '—'),
        ];

    return el(
      'tr',
      { 'data-testid': `timestamp-zone-row-${zone}` },
      el('th', { scope: 'row', class: 'timestamp-zone-name' }, displayName(zone)),
      ...cells,
      el(
        'td',
        { class: 'timestamp-row-actions' },
        el('button', {
          type: 'button',
          class: 'btn btn-sm btn-ghost',
          'aria-label': `上移 ${actionName(zone)}`,
          disabled: index === 0 ? true : null,
          title: '上移',
          onClick: () => moveZone(index, -1),
        }, '↑'),
        el('button', {
          type: 'button',
          class: 'btn btn-sm btn-ghost',
          'aria-label': `下移 ${actionName(zone)}`,
          disabled: index === zones.length - 1 ? true : null,
          title: '下移',
          onClick: () => moveZone(index, 1),
        }, '↓'),
        el('button', {
          type: 'button',
          class: 'btn btn-sm btn-ghost timestamp-zone-remove',
          'aria-label': `删除 ${actionName(zone)}`,
          title: '删除',
          onClick: () => removeZone(zone),
        }, '删除'),
      ),
    );
  }

  function renderZoneRows(parsed) {
    zoneTableBody.replaceChildren();
    if (zones.length === 0) {
      zoneTableBody.append(emptyRow('时区列表为空，请在下方添加时区'));
      return;
    }
    zones.forEach((zone, index) => zoneTableBody.append(zoneRow(zone, parsed, index)));
  }

  function renderExtra(parsed) {
    if (!parsed) {
      isoEl.textContent = '—';
      rfcEl.textContent = '—';
      relativeEl.textContent = '—';
      return;
    }
    isoEl.textContent = isoString(parsed.ns) ?? '—';
    rfcEl.textContent = rfc2822(parsed.ms);
    relativeEl.textContent = formatRelative(parsed.relativeSeconds, Date.now() / 1000);
  }

  function renderTs() {
    clearError(tsErrorWrap);
    const raw = tsInput.value.trim();
    if (raw === '') {
      lastParse = null;
      renderZoneRows(null);
      renderExtra(null);
      if (tsTouched) showError(tsErrorWrap, '请输入时间戳');
      return;
    }
    const parsed = parseTimestamp(raw, tsUnit);
    if (!parsed.ok) {
      lastParse = null;
      showError(tsErrorWrap, parsed.error);
      renderZoneRows(null);
      renderExtra(null);
      return;
    }
    lastParse = parsed;
    renderZoneRows(parsed);
    renderExtra(parsed);
  }

  function buildSummary() {
    if (!lastParse) return '';
    const lines = [`时间戳 ${tsInput.value.trim()}（${lastParse.unitLabel}）`];
    for (const zone of zones) {
      const row = describeInZone(lastParse.ms, lastParse.fractionText, resolveZone(zone));
      lines.push(`${displayName(zone)}：${row.datetime} ${row.weekday} ${row.offset}${row.abbr ? ` ${row.abbr}` : ''}`);
    }
    lines.push(`ISO 8601（UTC）：${isoEl.textContent}`);
    lines.push(`RFC 2822：${rfcEl.textContent}`);
    lines.push(`相对时间：${relativeEl.textContent}`);
    return lines.join('\n');
  }

  /* ---------- 时区列表：添加 / 删除 / 排序（先定义，供上方面板构建时引用） ---------- */

  const zoneSearch = el('input', {
    type: 'text',
    id: 'timestamp-zone-search',
    'data-testid': 'timestamp-zone-search',
    'aria-label': '搜索时区',
    placeholder: '搜索并添加时区，如 Sydney / Shanghai',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const zoneOptions = el('ul', {
    class: 'timestamp-zone-options',
    role: 'listbox',
    'aria-label': '搜索结果',
    'data-testid': 'timestamp-zone-options',
    hidden: true,
  });
  let zoneMatches = [];

  function renderOptions() {
    zoneMatches = filterTimeZones(zoneSearch.value, listTimeZones(), zones);
    zoneOptions.replaceChildren();
    for (const tz of zoneMatches) {
      // pointerdown 抢在输入框失焦前完成选择
      zoneOptions.append(
        el(
          'li',
          {
            role: 'option',
            'aria-selected': 'false',
            class: 'timestamp-zone-option',
            'data-testid': 'timestamp-zone-option',
            onPointerdown: (event) => {
              event.preventDefault();
              addZone(tz);
            },
          },
          el('span', { class: 'timestamp-zone-option-name' }, tz),
          el('span', { class: 'timestamp-zone-option-offset' }, formatOffset(zoneOffsetMs(Date.now(), tz))),
        ),
      );
    }
    zoneOptions.hidden = zoneMatches.length === 0;
  }

  function hideOptions() {
    zoneOptions.hidden = true;
    zoneMatches = [];
  }

  function addZone(zone) {
    hideOptions();
    zoneSearch.value = '';
    if (zones.includes(zone)) return;
    setZones([...zones, zone]);
  }

  function removeZone(zone) {
    setZones(zones.filter((z) => z !== zone));
  }

  function moveZone(index, delta) {
    const next = [...zones];
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setZones(next);
  }

  function setZones(next) {
    zones = next;
    ctx.storage.set('zones', zones);
    if (!zones.includes(dateZone)) dateZone = zones[0] ?? LOCAL_ZONE;
    rebuildDateZoneOptions();
    renderTs();
  }

  function buildZoneAdder() {
    zoneSearch.addEventListener('input', renderOptions);
    zoneSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (zoneMatches.length > 0) addZone(zoneMatches[0]);
      } else if (event.key === 'Escape') {
        zoneSearch.value = '';
        hideOptions();
      }
    });
    zoneSearch.addEventListener('blur', hideOptions);

    return el(
      'div',
      { class: 'timestamp-zone-add' },
      el('label', { class: 'field-label', for: 'timestamp-zone-search' }, '添加时区'),
      el(
        'div',
        { class: 'timestamp-zone-add-row' },
        zoneSearch,
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn-sm',
            'data-testid': 'timestamp-reset-zones',
            onClick: () => {
              setZones([...DEFAULT_ZONE_LIST]);
              hideOptions();
            },
          },
          '恢复默认时区',
        ),
      ),
      zoneOptions,
    );
  }

  const tsPanel = el(
    'section',
    { class: 'timestamp-panel', 'data-testid': 'timestamp-panel-to-date' },
    el('h2', { class: 'timestamp-panel-title' }, '时间戳 → 日期'),
    el(
      'div',
      { class: 'form-row' },
      tsInput,
      el('label', { class: 'timestamp-inline', for: 'timestamp-unit' }, '单位 ', unitSelect),
      copyButton(buildSummary, { label: '复制转换结果' }),
    ),
    tsErrorWrap,
    el(
      'div',
      { class: 'timestamp-table-wrap' },
      el(
        'table',
        { class: 'timestamp-table', 'data-testid': 'timestamp-table' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { scope: 'col' }, '时区'),
            el('th', { scope: 'col' }, '日期时间'),
            el('th', { scope: 'col' }, '星期'),
            el('th', { scope: 'col' }, 'UTC 偏移'),
            el('th', { scope: 'col' }, '缩写'),
            el('th', { scope: 'col' }, '操作'),
          ),
        ),
        zoneTableBody,
      ),
    ),
    el(
      'dl',
      { class: 'timestamp-extra' },
      el(
        'div',
        { class: 'timestamp-extra-row' },
        el('dt', {}, 'ISO 8601（UTC）'),
        el('dd', {}, isoEl, copyButton(() => isoEl.textContent, { label: '复制 ISO 8601' })),
      ),
      el(
        'div',
        { class: 'timestamp-extra-row' },
        el('dt', {}, 'RFC 2822'),
        el('dd', {}, rfcEl, copyButton(() => rfcEl.textContent, { label: '复制 RFC 2822' })),
      ),
      el('div', { class: 'timestamp-extra-row' }, el('dt', {}, '相对时间'), el('dd', {}, relativeEl)),
    ),
    buildZoneAdder(),
  );

  /* ==================== 日期 → 时间戳 ==================== */

  const dateInput = el('input', {
    type: 'text',
    id: 'timestamp-date-input',
    'data-testid': 'timestamp-date-input',
    'aria-label': '日期时间',
    placeholder: '如 2026-10-08 12:00:00 或 2026-10-08T12:00:00+08:00',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const dateZoneSelect = el(
    'select',
    { id: 'timestamp-date-zone', 'data-testid': 'timestamp-date-zone', 'aria-label': '所在时区' },
  );
  const dateErrorWrap = el('div', { 'data-testid': 'timestamp-date-error' });
  let dateTouched = false; // 用户输入过才对「空」提示，初次打开不报错

  const dateSeconds = el('code', { 'data-testid': 'timestamp-date-seconds' }, '');
  const dateMillis = el('code', { 'data-testid': 'timestamp-date-millis' }, '');
  const dateUtc = el('code', { 'data-testid': 'timestamp-date-utc' }, '');
  const dateUnique = el(
    'dl',
    { class: 'timestamp-extra', 'data-testid': 'timestamp-date-unique', hidden: true },
    el(
      'div',
      { class: 'timestamp-extra-row' },
      el('dt', {}, '秒时间戳'),
      el('dd', {}, dateSeconds, copyButton(() => dateSeconds.textContent, { label: '复制秒时间戳' })),
    ),
    el(
      'div',
      { class: 'timestamp-extra-row' },
      el('dt', {}, '毫秒时间戳'),
      el('dd', {}, dateMillis, copyButton(() => dateMillis.textContent, { label: '复制毫秒时间戳' })),
    ),
    el('div', { class: 'timestamp-extra-row' }, el('dt', {}, '对应 UTC 时刻'), el('dd', {}, dateUtc)),
  );
  const dateAmbiguous = el(
    'dl',
    { class: 'timestamp-extra timestamp-ambiguous', 'data-testid': 'timestamp-date-ambiguous', hidden: true },
  );

  function rebuildDateZoneOptions() {
    dateZoneSelect.replaceChildren();
    for (const zone of zones.length > 0 ? zones : [LOCAL_ZONE]) {
      dateZoneSelect.append(el('option', { value: zone }, displayName(zone)));
    }
    dateZoneSelect.value = dateZone;
  }

  function renderCandidate(result, index) {
    const seconds = el('code', { 'data-testid': `timestamp-amb-${index}-seconds` }, String(result.seconds));
    const millis = el('code', { 'data-testid': `timestamp-amb-${index}-millis` }, String(result.millis));
    return el(
      'div',
      { class: 'timestamp-extra-row timestamp-amb-row' },
      el(
        'dt',
        {},
        `${result.kindLabel}${result.abbr ? ` ${result.abbr}` : ''}（${result.offset}）`,
      ),
      el(
        'dd',
        {},
        seconds,
        ' / ',
        millis,
        copyButton(() => seconds.textContent, {
          label: `复制${result.kindLabel}秒时间戳`,
        }),
      ),
    );
  }

  function renderDate() {
    clearError(dateErrorWrap);
    dateUnique.hidden = true;
    dateAmbiguous.hidden = true;
    dateAmbiguous.replaceChildren();

    const raw = dateInput.value.trim();
    if (raw === '') {
      if (dateTouched) showError(dateErrorWrap, '请输入日期时间');
      return;
    }

    const result = dateTimeToTimestamp(raw, dateZone);
    if (!result.ok) {
      showError(dateErrorWrap, result.error);
      return;
    }
    if (result.status === 'missing') {
      showError(dateErrorWrap, '该时区不存在此时刻（夏令时跳变）');
      return;
    }
    if (result.status === 'unique') {
      dateSeconds.textContent = String(result.seconds);
      dateMillis.textContent = String(result.millis);
      dateUtc.textContent = `${result.utcDatetime} UTC`;
      dateUnique.hidden = false;
      return;
    }
    // 回拨：两个候选都列出
    dateAmbiguous.append(
      el('p', { class: 'ok-box timestamp-amb-note' }, '该时刻在此时区出现了两次（夏令时回拨），请按需选择：'),
    );
    result.candidates.forEach((candidate, index) => dateAmbiguous.append(renderCandidate(candidate, index)));
    dateAmbiguous.hidden = false;
  }

  const datePanel = el(
    'section',
    { class: 'timestamp-panel', 'data-testid': 'timestamp-panel-to-epoch' },
    el('h2', { class: 'timestamp-panel-title' }, '日期 → 时间戳'),
    el(
      'div',
      { class: 'form-row' },
      dateInput,
      el('label', { class: 'timestamp-inline', for: 'timestamp-date-zone' }, '所在时区 ', dateZoneSelect),
    ),
    el(
      'p',
      { class: 'field-hint' },
      '支持 2026-10-08 12:00:00、2026-10-08T12:00、2026/10/08 12:00 等写法；输入自带 UTC 偏移（如 +08:00 或 Z）时以偏移为准。',
    ),
    dateErrorWrap,
    dateUnique,
    dateAmbiguous,
  );

  /* ==================== 组装与交互 ==================== */

  root.append(
    el(
      'section',
      { class: 'tool timestamp' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
      ),
      nowPanel,
      tsPanel,
      datePanel,
    ),
  );

  const refreshTs = debounce(() => {
    ctx.storage.set('tsText', tsInput.value);
    renderTs();
  }, DEBOUNCE_MS);
  const refreshDate = debounce(() => {
    ctx.storage.set('dateText', dateInput.value);
    renderDate();
  }, DEBOUNCE_MS);

  tsInput.addEventListener('input', () => {
    tsTouched = true;
    refreshTs();
  });
  unitSelect.addEventListener('change', () => {
    tsUnit = unitSelect.value;
    ctx.storage.set('unit', tsUnit);
    renderTs();
  });
  dateInput.addEventListener('input', () => {
    dateTouched = true;
    refreshDate();
  });
  dateZoneSelect.addEventListener('change', () => {
    dateZone = dateZoneSelect.value;
    ctx.storage.set('dateZone', dateZone);
    renderDate();
  });

  /* ---------- 恢复上次输入并立即渲染一次 ---------- */

  const savedTsText = ctx.storage.get('tsText', '');
  if (typeof savedTsText === 'string' && savedTsText !== '') tsInput.value = savedTsText;
  const savedDateText = ctx.storage.get('dateText', '');
  if (typeof savedDateText === 'string' && savedDateText !== '') dateInput.value = savedDateText;
  unitSelect.value = tsUnit;
  rebuildDateZoneOptions();
  renderTs();
  renderDate();
  startTick();

  /* ---------- 清理函数（离开工具时由外壳调用） ---------- */

  return () => {
    refreshTs.cancel();
    refreshDate.cancel();
    stopTick();
  };
}
