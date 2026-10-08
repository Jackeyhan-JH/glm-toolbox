/**
 * 简繁转换 —— 纯逻辑（不碰 DOM / window，node --test 直接测试）。
 *
 * 词表数据（./data/zh-dict.json，整理自 OpenCC，Apache-2.0）分五张表：
 *   s2tChars / s2tPhrases   简体 → 繁体（字表 / 词表）
 *   t2sChars / t2sPhrases   繁体 → 简体（字表 / 词表）
 *   twPhrases               繁体 → 台湾常用繁体词（软件→軟體 等，仅词表）
 *
 * 转换算法：正向最长匹配 —— 每个位置先用词表从长到短试词组，
 * 未命中再查字表，都未命中原样保留。「台湾常用词」是简→繁输出后的
 * 第二遍词表替换（繁→简不做反向替换）。
 */

/** 转换方向（UI 分段按钮用） */
export const DIRECTIONS = [
  { value: 's2t', label: '简 → 繁' },
  { value: 't2s', label: '繁 → 简' },
];

/**
 * 把一张词表 + 字表编译成查找表。
 * 返回 { phrases, chars, lensByFirst }；lensByFirst 是「首字 → 该首字开头的
 * 词表键长列表（降序）」索引，让绝大多数位置一次探测就能跳过词表扫描，
 * 10 万字转换可在几十毫秒内完成。
 */
export function buildTable(phrasesObj, charsObj) {
  const phrases = new Map(Object.entries(phrasesObj ?? {}));
  const chars = new Map(Object.entries(charsObj ?? {}));
  const lengthsByFirst = new Map();
  for (const key of phrases.keys()) {
    const keyChars = Array.from(key);
    const set = lengthsByFirst.get(keyChars[0]) ?? new Set();
    set.add(keyChars.length);
    lengthsByFirst.set(keyChars[0], set);
  }
  const lensByFirst = new Map();
  for (const [first, set] of lengthsByFirst) {
    lensByFirst.set(first, [...set].sort((a, b) => b - a));
  }
  return { phrases, chars, lensByFirst };
}

/** 由 zh-dict.json 内容构建全部查找表 */
export function buildTables(data) {
  return {
    s2t: buildTable(data.s2tPhrases, data.s2tChars),
    t2s: buildTable(data.t2sPhrases, data.t2sChars),
    tw: buildTable(data.twPhrases, {}),
  };
}

/**
 * 单遍转换。cells 是 [{ ch, changed }]（changed 表示之前的遍已转换过该字），
 * 返回同构的新数组：词表命中时输出整词、长度相同则逐字保留变化标记，
 * 否则整个输出词标记为已转换；字表命中或原样保留时单字处理。
 */
function convertCells(cells, { phrases, chars, lensByFirst }) {
  const out = [];
  let i = 0;
  while (i < cells.length) {
    const lens = lensByFirst.get(cells[i].ch);
    let matched = false;
    if (lens !== undefined) {
      for (const len of lens) {
        if (i + len > cells.length) continue;
        const source = cells.slice(i, i + len).map((cell) => cell.ch).join('');
        const hit = phrases.get(source);
        if (hit === undefined) continue;
        const src = Array.from(source);
        const dst = Array.from(hit);
        if (src.length === dst.length) {
          for (let k = 0; k < dst.length; k += 1) {
            out.push({ ch: dst[k], changed: cells[i + k].changed || src[k] !== dst[k] });
          }
        } else {
          // 长度变化的词（如 台湾常用词 B超→超音波）整体视为已转换
          for (const ch of dst) out.push({ ch, changed: true });
        }
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ch = chars.get(cells[i].ch) ?? cells[i].ch;
    out.push({ ch, changed: cells[i].changed || ch !== cells[i].ch });
    i += 1;
  }
  return out;
}

/**
 * 转换文本。
 *
 *   convert('头发', 's2t', tables)             → { text: '頭髮', … }
 *   convert('软件', 's2t', tables, { tw: true }) → { text: '軟體', … }
 *
 * direction 为 's2t' 或 't2s'；options.tw 仅简→繁有效（台湾常用词）。
 * 返回：
 *   text         转换结果
 *   segments     [{ text, changed }] 渲染用片段：变化的字逐字一段（高亮元素），
 *                未变化的合并成连续段；长度相同的转换逐字比较，
 *                只标记真正变化的字（以后→以後 只标 後）
 *   changedChars 结果中发生变化的字数
 */
export function convert(text, direction, tables, options = {}) {
  const source = String(text ?? '');
  let cells = Array.from(source, (ch) => ({ ch, changed: false }));
  if (direction === 't2s') {
    cells = convertCells(cells, tables.t2s);
  } else {
    cells = convertCells(cells, tables.s2t);
    if (options.tw) cells = convertCells(cells, tables.tw);
  }
  // 片段化：变化的字逐字成段（每个字一个高亮元素），未变化的合并成连续段
  const segments = [];
  for (const { ch, changed } of cells) {
    const last = segments[segments.length - 1];
    if (!changed && last && !last.changed) last.text += ch;
    else segments.push({ text: ch, changed });
  }
  const changedChars = cells.filter((cell) => cell.changed).length;
  return { text: cells.map((cell) => cell.ch).join(''), segments, changedChars };
}
