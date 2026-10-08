/**
 * 文本对比 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 结构：
 *   splitLines / tokenizeWords        文本 → 行 / 词序列（字符模式直接 Array.from）
 *   buildTokens(text, 粒度, 选项)     生成 { text, key } 序列（key 已应用忽略选项）
 *   diffSeq(aTokens, bTokens)         自实现 Myers 差分 → op 序列
 *   compare(原文, 新文, 粒度, 选项)    一站式对比（op / 统计 / 是否相同）
 *   computeHunks / toUnifiedDiff      unified diff（上下文默认 3 行，hunk 头 @@ -a,b +c,d @@）
 *   buildSideRows / inlineDiff        并排视图数据（修改行内再做字符级高亮）
 *
 * op 约定：{ type: 'equal' | 'del' | 'add', text, aIndex, bIndex }
 *   equal 两个下标都有；del 只有 aIndex；add 只有 bIndex（均为 0 基）。
 *   同一位置的删除一定排在新增前面（与 unified diff 习惯一致）。
 */

/* ---------------- 选项 ---------------- */

export const DEFAULT_OPTIONS = {
  trimWhitespace: false, // 忽略首尾空白（行模式比较每行 trim；词 / 字符模式去掉整段两端空白）
  ignoreAllWhitespace: false, // 忽略所有空白差异（行模式比较时去掉行内全部空白；词 / 字符模式丢弃空白 token）
  ignoreCase: false, // 忽略大小写
  ignoreBlankLines: false, // 忽略空行（仅行模式有意义）
};

/** UI 用：粒度 / 视图 / 选项清单（顺序即展示顺序） */
export const GRANULARITIES = [
  { value: 'line', label: '按行' },
  { value: 'word', label: '按词' },
  { value: 'char', label: '按字符' },
];

export const VIEWS = [
  { value: 'side', label: '并排' },
  { value: 'merged', label: '合并' },
];

export const OPTION_ITEMS = [
  { key: 'trimWhitespace', label: '忽略首尾空白' },
  { key: 'ignoreAllWhitespace', label: '忽略所有空白差异' },
  { key: 'ignoreCase', label: '忽略大小写' },
  { key: 'ignoreBlankLines', label: '忽略空行', lineOnly: true },
];

/* ---------------- 文本切分 ---------------- */

const SPACE_RE = /\s/;
const HAN_RE = /\p{Script=Han}/u;
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

/**
 * 分行：按 \n 切分；结尾的换行不产生空行；空文本为 0 行。
 * 行内容里的 \r 保留原样用于展示，比较时由 tokenKey 剥掉（兼容 CRLF）。
 */
export function splitLines(text) {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * 分词：汉字逐字成词；字母 / 数字连成词；空白归并成段；其余符号逐字。
 * 如「the quick 码工具」→ ['the', ' ', 'quick', ' ', '码', '工', '具']。
 */
export function tokenizeWords(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (SPACE_RE.test(ch)) {
      let j = i + 1;
      while (j < text.length && SPACE_RE.test(text[j])) j++;
      tokens.push(text.slice(i, j));
      i = j;
    } else if (HAN_RE.test(ch)) {
      tokens.push(ch);
      i += 1;
    } else if (WORD_CHAR_RE.test(ch)) {
      let j = i + 1;
      while (j < text.length && WORD_CHAR_RE.test(text[j]) && !HAN_RE.test(text[j])) j++;
      tokens.push(text.slice(i, j));
      i = j;
    } else {
      tokens.push(ch);
      i += 1;
    }
  }
  return tokens;
}

/** 单个 token 的比较键（应用忽略选项；空白选项对空白 token 得到空键） */
function tokenKey(token, granularity, opts) {
  let key = token;
  if (granularity === 'line') {
    if (key.endsWith('\r')) key = key.slice(0, -1);
    if (opts.ignoreAllWhitespace) key = key.replace(/\s+/g, '');
    else if (opts.trimWhitespace) key = key.trim();
  }
  if (opts.ignoreCase) key = key.toLowerCase();
  return key;
}

/**
 * 文本 → 待比较 token 序列。
 * 每项 { text, key }：text 原样展示，key 用于比较（已应用忽略选项）。
 */
export function buildTokens(text, granularity, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let raw;
  if (granularity === 'line') {
    raw = splitLines(text);
    if (opts.ignoreBlankLines) raw = raw.filter((line) => line.trim() !== '');
  } else if (granularity === 'word') {
    raw = tokenizeWords(text);
    if (opts.ignoreAllWhitespace) raw = raw.filter((t) => !SPACE_RE.test(t[0]));
  } else {
    raw = Array.from(text);
    if (opts.ignoreAllWhitespace) raw = raw.filter((ch) => !SPACE_RE.test(ch));
  }
  if (opts.trimWhitespace && granularity !== 'line') {
    while (raw.length > 0 && SPACE_RE.test(raw[0])) raw.shift();
    while (raw.length > 0 && SPACE_RE.test(raw[raw.length - 1])) raw.pop();
  }
  return raw.map((t) => ({ text: t, key: tokenKey(t, granularity, opts) }));
}

/* ---------------- Myers 差分 ---------------- */

/**
 * 自实现 Myers O(ND) 差分（前向搜索 + V 表快照回溯）：
 *   1. 先剥掉公共前缀 / 后缀（典型输入只有中段不同，一步就能把问题缩小到很小）；
 *   2. 对中段跑前向 Myers，每轮 d 保存 V 表快照供回溯；
 *   3. 编辑距离超过 MYERS_D_CAP（两段文本几乎完全不同）时放弃最优解，
 *      退化为「整段删除 + 整段新增」，保证任何输入都能快速出结果。
 */
export const MYERS_D_CAP = 2048;

const eqOp = (token, i, j) => ({ type: 'equal', text: token.text, aIndex: i, bIndex: j });
const delOp = (token, i) => ({ type: 'del', text: token.text, aIndex: i });
const addOp = (token, j) => ({ type: 'add', text: token.text, bIndex: j });

/** 对 aTokens[aLo..aHi) 与 bTokens[bLo..bHi) 求差分，把 op 追加进 ops */
function myersMiddle(a, aLo, aHi, b, bLo, bHi, ops) {
  const n = aHi - aLo;
  const m = bHi - bLo;
  if (n === 0 && m === 0) return;
  if (n === 0) {
    for (let j = bLo; j < bHi; j++) ops.push(addOp(b[j], j));
    return;
  }
  if (m === 0) {
    for (let i = aLo; i < aHi; i++) ops.push(delOp(a[i], i));
    return;
  }

  const off = n + m + 1; // V 数组偏移：v[off + k] 存对角线 k 上的最远 x
  const v = new Int32Array(2 * (n + m) + 3);
  v[off + 1] = 0;
  const trace = [];
  let found = -1;

  outer: for (let d = 0; d <= n + m; d++) {
    if (d > MYERS_D_CAP) break;
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[aLo + x].key === b[bLo + y].key) {
        x += 1;
        y += 1;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break outer;
      }
    }
    // 下一轮 d+1 只会读 [-d, d]，快照这个区间即可（内存 O(D²)，D 有上限）
    trace.push({ base: -d, arr: v.slice(off - d, off + d + 1) });
  }

  if (found < 0) {
    for (let i = aLo; i < aHi; i++) ops.push(delOp(a[i], i));
    for (let j = bLo; j < bHi; j++) ops.push(addOp(b[j], j));
    return;
  }

  // 回溯：先按逆序收集再反转
  const rev = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 1; d--) {
    const { base, arr } = trace[d - 1];
    const get = (k) => arr[k - base];
    const k = x - y;
    let prevK;
    if (k === -d) prevK = k + 1;
    else if (k === d) prevK = k - 1;
    else prevK = get(k - 1) < get(k + 1) ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    // 先回退本轮末尾的蛇（对角线），再回退那一步水平 / 垂直移动
    const stepX = prevK === k + 1 ? prevX : prevX + 1;
    const stepY = prevK === k + 1 ? prevY + 1 : prevY;
    while (x > stepX && y > stepY) {
      x -= 1;
      y -= 1;
      rev.push(eqOp(a[aLo + x], aLo + x, bLo + y));
    }
    if (prevK === k + 1) {
      y -= 1;
      rev.push(addOp(b[bLo + y], bLo + y));
    } else {
      x -= 1;
      rev.push(delOp(a[aLo + x], aLo + x));
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    rev.push(eqOp(a[aLo + x], aLo + x, bLo + y));
  }
  for (let i = rev.length - 1; i >= 0; i--) ops.push(rev[i]);
}

/** 差分两个 token 序列，返回 op 数组（等价于求最优编辑脚本） */
export function diffSeq(aTokens, bTokens) {
  const n = aTokens.length;
  const m = bTokens.length;
  const ops = [];

  let pre = 0;
  while (pre < n && pre < m && aTokens[pre].key === bTokens[pre].key) pre += 1;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && aTokens[n - 1 - suf].key === bTokens[m - 1 - suf].key) suf += 1;

  for (let i = 0; i < pre; i++) ops.push(eqOp(aTokens[i], i, i));
  myersMiddle(aTokens, pre, n - suf, bTokens, pre, m - suf, ops);
  for (let i = 0; i < suf; i++) {
    const ai = n - suf + i;
    const bi = m - suf + i;
    ops.push(eqOp(aTokens[ai], ai, bi));
  }
  return ops;
}

/* ---------------- 对比入口 / 统计 ---------------- */

/** 一站式对比 */
export function compare(oldText, newText, granularity = 'line', options = {}) {
  const gran = GRANULARITIES.some((g) => g.value === granularity) ? granularity : 'line';
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const aTokens = buildTokens(oldText, gran, opts);
  const bTokens = buildTokens(newText, gran, opts);
  const ops = diffSeq(aTokens, bTokens);
  const stats = computeStats(ops);
  return {
    granularity: gran,
    options: opts,
    aTokens,
    bTokens,
    ops,
    stats,
    identical: stats.added === 0 && stats.deleted === 0,
  };
}

/** 统计新增 / 删除数量 */
export function computeStats(ops) {
  let added = 0;
  let deleted = 0;
  for (const op of ops) {
    if (op.type === 'add') added += 1;
    else if (op.type === 'del') deleted += 1;
  }
  return { added, deleted };
}

/** 统计文案：按行为「行」，按词 / 字符为「个」 */
export function formatStats(stats, granularity = 'line') {
  const unit = granularity === 'line' ? '行' : '个';
  return `新增 ${stats.added} ${unit}，删除 ${stats.deleted} ${unit}`;
}

/* ---------------- unified diff ---------------- */

/**
 * 把 op 序列切成 hunk：相邻变化块之间夹的 equal 段不超过 2 × context 时合并进同一 hunk，
 * 否则分开（context 默认 3：间隔 ≤ 6 行合并，10 行以上分开）。
 */
export function computeHunks(ops, context = 3) {
  const changes = []; // 每个变化块在 ops 中的 [start, end)
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      i += 1;
      continue;
    }
    const start = i;
    while (i < ops.length && ops[i].type !== 'equal') i += 1;
    changes.push([start, i]);
  }
  if (changes.length === 0) return [];

  const merged = [];
  let [cs, ce] = changes[0];
  for (let c = 1; c < changes.length; c++) {
    const [ns, ne] = changes[c];
    if (ns - ce <= 2 * context) {
      ce = ne;
    } else {
      merged.push([cs, ce]);
      [cs, ce] = [ns, ne];
    }
  }
  merged.push([cs, ce]);

  return merged.map(([hs, he]) => {
    const from = Math.max(0, hs - context);
    const to = Math.min(ops.length, he + context);
    let aStart = 0;
    let bStart = 0;
    for (let j = 0; j < from; j++) {
      if (ops[j].type !== 'add') aStart += 1;
      if (ops[j].type !== 'del') bStart += 1;
    }
    let aCount = 0;
    let bCount = 0;
    for (let j = from; j < to; j++) {
      if (ops[j].type !== 'add') aCount += 1;
      if (ops[j].type !== 'del') bCount += 1;
    }
    return { from, to, ops: ops.slice(from, to), aStart, aCount, bStart, bCount };
  });
}

/** hunk 头的一侧范围：count 为 0 时起点为插入位置（0 基），为 1 时省略个数（GNU 惯例） */
function rangeStr(start, count) {
  if (count === 0) return `${start},0`;
  if (count === 1) return `${start + 1}`;
  return `${start + 1},${count}`;
}

/** 生成 unified diff 文本；完全相同时返回空字符串 */
export function toUnifiedDiff(ops, context = 3) {
  const hunks = computeHunks(ops, context);
  if (hunks.length === 0) return '';
  const lines = ['--- 原文', '+++ 新文'];
  for (const hunk of hunks) {
    lines.push(`@@ -${rangeStr(hunk.aStart, hunk.aCount)} +${rangeStr(hunk.bStart, hunk.bCount)} @@`);
    for (const op of hunk.ops) {
      const prefix = op.type === 'equal' ? ' ' : op.type === 'del' ? '-' : '+';
      lines.push(prefix + op.text);
    }
  }
  return lines.join('\n');
}

/* ---------------- 并排视图数据 ---------------- */

/**
 * 修改行内的字符级对比：分别给旧 / 新两侧分段。
 * 返回 { oldSegments, newSegments }，段为 { type: 'equal' | 'del' | 'add', text }。
 */
export function inlineDiff(oldText, newText, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const toChars = (text) =>
    Array.from(text, (ch) => ({ text: ch, key: opts.ignoreCase ? ch.toLowerCase() : ch }));
  const a = toChars(oldText);
  const b = toChars(newText);
  const ops = diffSeq(a, b);
  const oldSegments = [];
  const newSegments = [];
  const push = (list, type, text) => {
    const last = list[list.length - 1];
    if (last && last.type === type) last.text += text;
    else list.push({ type, text });
  };
  for (const op of ops) {
    if (op.type === 'equal') {
      // 两侧各自的原文（忽略大小写时可能字形不同）
      push(oldSegments, 'equal', a[op.aIndex].text);
      push(newSegments, 'equal', b[op.bIndex].text);
    } else if (op.type === 'del') {
      push(oldSegments, 'del', op.text);
    } else {
      push(newSegments, 'add', op.text);
    }
  }
  return { oldSegments, newSegments };
}

/**
 * 把 op 序列展开成并排视图的行记录：
 *   { kind: 'equal' | 'del' | 'add' | 'mod', old?, new?, oldSegments?, newSegments? }
 * mod = 一删一增配成对（行数取较少的一侧，多出来的按纯删 / 纯增展示），
 * 并附带 inlineDiff 的字符级分段供行内高亮。
 */
export function buildSideRows(ops, options = {}) {
  const rows = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      rows.push({ kind: 'equal', old: ops[i], new: ops[i] });
      i += 1;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < ops.length && ops[i].type === 'del') dels.push(ops[i++]);
    while (i < ops.length && ops[i].type === 'add') adds.push(ops[i++]);
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p++) {
      const { oldSegments, newSegments } = inlineDiff(dels[p].text, adds[p].text, options);
      rows.push({ kind: 'mod', old: dels[p], new: adds[p], oldSegments, newSegments });
    }
    for (let p = pairs; p < dels.length; p++) rows.push({ kind: 'del', old: dels[p] });
    for (let p = pairs; p < adds.length; p++) rows.push({ kind: 'add', new: adds[p] });
  }
  return rows;
}
