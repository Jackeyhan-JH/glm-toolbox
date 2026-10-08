/**
 * JWT 解析 —— 工具入口（外壳在进入 #/jwt 时动态加载本模块）。
 *
 *   粘贴 token（自动去掉 Bearer 前缀与空白）→ 分三栏显示头部 / 载荷 JSON
 *   与签名（Base64URL 原文 + 十六进制），三段以不同颜色着色；标准声明附
 *   中文说明，时间类声明显示本地 / UTC / 相对时间；状态徽标（有效 /
 *   已过期 / 尚未生效）基于当前时间。可选 HS256 / HS384 / HS512 验签，
 *   密钥可按 Base64 解码；RS / ES / PS 系列与 alg: none 只解析并提示。
 *
 * 所有纯逻辑在 ./logic.mjs；公共组件来自 assets/js/ui.mjs。
 * 令牌与密钥均不写入 localStorage（只记住「密钥为 Base64 编码」选项）。
 */

import { clearError, copyButton, debounce, el, showError } from '../../assets/js/ui.mjs';
import {
  CLAIM_INFO,
  annotateClaims,
  getTokenStatus,
  localOffsetMinutes,
  normalizeToken,
  parseToken,
  verifyToken,
} from './logic.mjs';

const DEBOUNCE_MS = 200; // 输入自动更新的防抖（约定 ≤ 300ms）

/* ==================== 小部件辅助 ==================== */

/** token 分段着色块：标签 + 可更新的文本节点 */
function partSpan(tagText, kind, testid) {
  const text = document.createTextNode('');
  const node = el(
    'span',
    { class: `jwt-part is-${kind}`, 'data-testid': testid },
    el('i', { class: 'jwt-part-tag' }, tagText),
    text,
  );
  return { node, set: (v) => { text.data = v; } };
}

/** 输出栏（标题 + 色点 + 元信息 + 内容框 + 复制按钮） */
function pane({ title, kind, testid, copyText, copyLabel, boxes }) {
  const box = boxes.map((b) => b.node);
  return el(
    'div',
    { class: `jwt-pane is-${kind}` },
    el(
      'div',
      { class: 'jwt-pane-head' },
      el('span', { class: `jwt-pane-dot is-${kind}`, 'aria-hidden': 'true' }),
      el('h3', {}, title),
      el(
        'div',
        { class: 'tool-actions' },
        copyButton(copyText, { label: copyLabel }),
      ),
    ),
    ...box,
  );
}

function outputBox(testid) {
  const node = el('div', { class: 'output-box', 'data-testid': testid }, '');
  return { node, set: (v) => { node.textContent = v; } };
}

/** 声明表格中的一行 */
function claimRow(entry) {
  const valueCell = el('td', { class: 'jwt-claim-value', 'data-testid': `jwt-claim-${entry.key}` }, entry.valueText);
  if (entry.time) {
    valueCell.append(
      el(
        'div',
        { class: 'jwt-claim-time' },
        el('div', { 'data-testid': `jwt-claim-${entry.key}-local` }, `${entry.time.local}（${entry.time.localLabel}）`),
        el('div', { 'data-testid': `jwt-claim-${entry.key}-utc` }, `${entry.time.utc}（UTC）`),
        el('div', { class: 'jwt-claim-rel', 'data-testid': `jwt-claim-${entry.key}-rel` }, entry.time.relative),
      ),
    );
  }
  return el(
    'tr',
    {},
    el('th', { scope: 'row' }, entry.key),
    valueCell,
    el(
      'td',
      { class: 'jwt-claim-desc', 'data-testid': `jwt-claim-${entry.key}-desc` },
      entry.known ? `${entry.label}：${CLAIM_INFO[entry.key].description}` : '自定义声明',
    ),
  );
}

/* ==================== 挂载 ==================== */

export async function mount(root, ctx) {
  ctx.loadStyle('tools/jwt/style.css');

  let lastParsed = null; // 最近一次成功解析的结果
  let verifySeq = 0; // 防止旧的异步验签结果覆盖新的

  /* ---------- 输入区 ---------- */

  const tokenInput = el('textarea', {
    id: 'jwt-token-input',
    'data-testid': 'jwt-token-input',
    'aria-label': 'JWT 令牌',
    rows: '4',
    spellcheck: 'false',
    placeholder: '粘贴 JWT（自动去掉 Bearer 前缀与空白），头部.载荷.签名 三段以 . 分隔…',
  });
  const tokenErrorWrap = el('div', { 'data-testid': 'jwt-error' });

  /* ---------- 结果区 ---------- */

  const statusBadge = el('span', { class: 'jwt-badge', 'data-testid': 'jwt-status-badge' }, '');
  const statusDetail = el('span', { class: 'jwt-status-detail', 'data-testid': 'jwt-status-detail' }, '');
  const refreshBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'data-testid': 'jwt-refresh',
      title: '按当前时间重新计算状态与相对时间',
      onClick: () => refresh(),
    },
    '刷新',
  );
  const statusBar = el('div', { class: 'jwt-status' }, statusBadge, statusDetail, refreshBtn);

  const warningsWrap = el('div', { class: 'jwt-warnings', 'data-testid': 'jwt-warnings' });

  const partHeader = partSpan('头部', 'header', 'jwt-part-header');
  const partPayload = partSpan('载荷', 'payload', 'jwt-part-payload');
  const partSignature = partSpan('签名', 'signature', 'jwt-part-signature');
  const partsRow = el(
    'div',
    { class: 'jwt-parts', 'data-testid': 'jwt-parts' },
    partHeader.node,
    el('span', { class: 'jwt-parts-dot', 'aria-hidden': 'true' }, '.'),
    partPayload.node,
    el('span', { class: 'jwt-parts-dot', 'aria-hidden': 'true' }, '.'),
    partSignature.node,
  );

  const headerJson = outputBox('jwt-header-json');
  const payloadJson = outputBox('jwt-payload-json');
  const signatureB64 = outputBox('jwt-signature-b64');
  const signatureHex = outputBox('jwt-signature-hex');

  const panes = el(
    'div',
    { class: 'jwt-panes' },
    pane({
      title: '头部',
      kind: 'header',
      testid: 'jwt-pane-header',
      copyLabel: '复制头部',
      copyText: () => lastParsed?.headerJson ?? '',
      boxes: [headerJson],
    }),
    pane({
      title: '载荷',
      kind: 'payload',
      testid: 'jwt-pane-payload',
      copyLabel: '复制载荷',
      copyText: () => lastParsed?.payloadJson ?? '',
      boxes: [payloadJson],
    }),
    pane({
      title: '签名',
      kind: 'signature',
      testid: 'jwt-pane-signature',
      copyLabel: '复制签名',
      copyText: () => lastParsed?.signature.base64Url ?? '',
      boxes: [signatureB64, signatureHex],
    }),
  );

  const claimsBody = el('tbody', {});
  const claimsTable = el(
    'table',
    { class: 'jwt-claims', 'data-testid': 'jwt-claims' },
    el(
      'thead',
      {},
      el('tr', {}, el('th', { scope: 'col' }, '声明'), el('th', { scope: 'col' }, '值'), el('th', { scope: 'col' }, '说明')),
    ),
    claimsBody,
  );

  const resultsSection = el(
    'section',
    { class: 'jwt-results', 'data-testid': 'jwt-results', hidden: true },
    statusBar,
    warningsWrap,
    partsRow,
    panes,
    el(
      'div',
      { class: 'jwt-claims-block' },
      el('div', { class: 'field-label' }, '载荷声明'),
      el('div', { class: 'jwt-table-scroll' }, claimsTable),
    ),
  );

  /* ---------- 验签区 ---------- */

  const keyInput = el('input', {
    type: 'password',
    id: 'jwt-key-input',
    'data-testid': 'jwt-key-input',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'HS 系列密钥',
  });
  const keyToggle = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'aria-pressed': 'false',
      'data-testid': 'jwt-key-toggle',
      onClick: () => {
        const show = keyInput.type === 'password';
        keyInput.type = show ? 'text' : 'password';
        keyToggle.textContent = show ? '隐藏' : '显示';
        keyToggle.setAttribute('aria-pressed', String(show));
      },
    },
    '显示',
  );
  const base64Check = el('input', {
    type: 'checkbox',
    id: 'jwt-key-base64',
    'data-testid': 'jwt-key-base64',
    checked: ctx.storage.get('keyIsBase64', false) ? true : null,
  });
  const verifyResult = el('div', { class: 'jwt-verify-result is-hint', 'data-testid': 'jwt-verify-result', 'aria-live': 'polite' }, '');

  const verifySection = el(
    'section',
    { class: 'jwt-verify', 'data-testid': 'jwt-verify', hidden: true },
    el('h2', {}, '验签（仅支持 HS256 / HS384 / HS512）'),
    el(
      'div',
      { class: 'form-row' },
      el('label', { class: 'field-label', for: 'jwt-key-input' }, '密钥'),
      keyInput,
      keyToggle,
      el('label', { class: 'jwt-option', for: 'jwt-key-base64' }, base64Check, '密钥为 Base64 编码'),
    ),
    el('p', { class: 'field-hint' }, '密钥只在本浏览器中用于计算 HMAC，不会保存或上传；输入后实时验签。'),
    verifyResult,
  );

  /* ---------- 组装 ---------- */

  root.append(
    el(
      'section',
      { class: 'tool jwt' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
      ),
      el(
        'div',
        { class: 'jwt-input-area' },
        el('label', { class: 'field-label', for: 'jwt-token-input' }, 'JWT 令牌'),
        tokenInput,
        el('p', { class: 'field-hint' }, '自动去掉开头的 Bearer 与空白；令牌与密钥只在本地浏览器中解析，不会保存或上传。'),
        tokenErrorWrap,
      ),
      resultsSection,
      verifySection,
    ),
  );

  /* ---------- 刷新 ---------- */

  function refresh() {
    clearError(tokenErrorWrap);

    if (normalizeToken(tokenInput.value) === '') {
      lastParsed = null;
      resultsSection.hidden = true;
      verifySection.hidden = true;
      return;
    }

    const parsed = parseToken(tokenInput.value);
    if (!parsed.ok) {
      lastParsed = null;
      resultsSection.hidden = true;
      verifySection.hidden = true;
      showError(tokenErrorWrap, parsed.error);
      return;
    }

    lastParsed = parsed;
    resultsSection.hidden = false;
    verifySection.hidden = false;

    const now = Math.floor(Date.now() / 1000);
    const status = getTokenStatus(parsed.payload, now);
    statusBadge.textContent = status.label;
    statusBadge.className = `jwt-badge is-${status.state}`;
    statusDetail.textContent = status.detail;

    partHeader.set(parsed.segments[0]);
    partPayload.set(parsed.segments[1]);
    partSignature.set(parsed.segments[2] === '' ? '（无签名）' : parsed.segments[2]);

    headerJson.set(parsed.headerJson);
    payloadJson.set(parsed.payloadJson);
    signatureB64.set(parsed.signature.base64Url === '' ? '（无签名）' : parsed.signature.base64Url);
    signatureHex.set(parsed.signature.hex === '' ? '（无签名）' : parsed.signature.hex);

    claimsBody.replaceChildren();
    for (const entry of annotateClaims(parsed.payload, now, localOffsetMinutes(now))) {
      claimsBody.appendChild(claimRow(entry));
    }

    warningsWrap.replaceChildren();
    for (const w of parsed.warnings) {
      warningsWrap.appendChild(el('div', { class: 'jwt-note is-warn', role: 'note' }, w.text));
    }

    runVerify();
  }

  async function runVerify() {
    const seq = ++verifySeq;
    if (!lastParsed) return;
    const parsed = lastParsed;
    let result;
    try {
      result = await verifyToken(parsed, keyInput.value, { base64: base64Check.checked });
    } catch (err) {
      result = { kind: 'error', message: `验签出错：${err instanceof Error ? err.message : String(err)}`, kindClass: 'bad' };
    }
    if (seq !== verifySeq) return; // 期间已有新一轮验签，丢弃过期结果
    verifyResult.textContent = result.message;
    verifyResult.className = `jwt-verify-result is-${result.kindClass}`;
  }

  /* ---------- 事件 ---------- */

  const refreshDebounced = debounce(refresh, DEBOUNCE_MS);
  tokenInput.addEventListener('input', refreshDebounced);
  const verifyDebounced = debounce(runVerify, DEBOUNCE_MS);
  keyInput.addEventListener('input', verifyDebounced);
  base64Check.addEventListener('change', () => {
    ctx.storage.set('keyIsBase64', base64Check.checked);
    runVerify();
  });

  refresh();

  /* ---------- 清理函数 ---------- */

  return () => {
    refreshDebounced.cancel();
    verifyDebounced.cancel();
  };
}
