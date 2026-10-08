#!/usr/bin/env node
/**
 * 从 OpenCC 原始词典生成 tools/zh-convert/data/zh-dict.json。
 *
 * 这是开发期离线脚本（浏览器运行时只用生成的 JSON，不执行本脚本）：
 *
 *   node tools/zh-convert/data/gen-from-opencc.mjs <OpenCC仓库>/data/dictionary
 *
 * 输入文件（OpenCC 仓库 data/dictionary/ 下）：
 *   STCharacters.txt / STPhrases.txt / TSCharacters.txt / TSPhrases.txt / TWPhrases.txt
 * 来源、许可（Apache-2.0）与裁剪说明见同目录 README.md。
 *
 * 裁剪规则（在不改变转换结果的前提下尽量精简）：
 *   1. 字表：每字只取 OpenCC 首选候选（多候选的消歧交给词表），
 *      首选与原字相同的条目（如 了→了 瞭）略去 —— 转换本就是恒等。
 *      输出用字归一：麪 → 麵（更通行的字形，OpenCC 首选为大陆规范异体）。
 *   2. 词表：只保留「逐字转换结果 ≠ 词表结果」的条目，其余条目对逐字回退
 *      没有修正作用，删去后输出完全不变。恒等条目（如 皇后→皇后）在逐字
 *      转换会改变原文时（后→後）仍然保留 —— 它们本身就是消歧信息。
 *   3. TWPhrases（繁体 → 台湾常用繁体词）整表保留，仅在「台湾常用词」
 *      开关打开时作为简→繁输出后的第二遍替换使用。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 输出用字归一（OpenCC 首选 → 本工具统一采用的字形） */
const OUTPUT_NORMALIZE = new Map([['麪', '麵']]);
const normalize = (text) => Array.from(text, (ch) => OUTPUT_NORMALIZE.get(ch) ?? ch).join('');

/** 解析 OpenCC 词典：每行「键\t候选1 候选2 …」，取首选候选；跳过注释与空行 */
function parseDict(file) {
  const map = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const key = line.slice(0, tab);
    const first = line.slice(tab + 1).split(' ')[0];
    if (key !== '' && first !== '') map.set(key, normalize(first));
  }
  return map;
}

/** 按字逐个转换（字表未命中的原样保留），用于判断词表条目是否冗余 */
function convertByChar(text, charMap) {
  return Array.from(text, (ch) => charMap.get(ch) ?? ch).join('');
}

/** 字表：首选候选，略去恒等条目 */
function buildChars(file) {
  const chars = new Map();
  for (const [key, first] of parseDict(file)) {
    if (first !== key) chars.set(key, first);
  }
  return chars;
}

/** 词表：只保留对逐字转换有修正作用的条目 */
function buildPhrases(file, chars) {
  const phrases = new Map();
  let total = 0;
  for (const [key, value] of parseDict(file)) {
    total += 1;
    if (convertByChar(key, chars) === value) continue;
    phrases.set(key, value);
  }
  return { phrases, total };
}

function main() {
  const [srcDir] = process.argv.slice(2);
  if (!srcDir) {
    console.error('用法：node gen-from-opencc.mjs <OpenCC仓库>/data/dictionary');
    process.exit(1);
  }
  const read = (name) => path.join(srcDir, name);

  const s2tChars = buildChars(read('STCharacters.txt'));
  const t2sChars = buildChars(read('TSCharacters.txt'));
  const s2t = buildPhrases(read('STPhrases.txt'), s2tChars);
  const t2s = buildPhrases(read('TSPhrases.txt'), t2sChars);
  const twPhrases = parseDict(read('TWPhrases.txt'));

  const dict = {
    s2tChars: Object.fromEntries(s2tChars),
    s2tPhrases: Object.fromEntries(s2t.phrases),
    t2sChars: Object.fromEntries(t2sChars),
    t2sPhrases: Object.fromEntries(t2s.phrases),
    twPhrases: Object.fromEntries(twPhrases),
  };
  const out = new URL('./zh-dict.json', import.meta.url);
  fs.writeFileSync(out, JSON.stringify(dict));

  const size = fs.statSync(out).size;
  console.log(`s2tChars=${s2tChars.size}，s2tPhrases=${s2t.phrases.size}/${s2t.total}`);
  console.log(`t2sChars=${t2sChars.size}，t2sPhrases=${t2s.phrases.size}/${t2s.total}`);
  console.log(`twPhrases=${twPhrases.size}`);
  console.log(`zh-dict.json 共 ${(size / 1024).toFixed(1)} KB（上限 1536 KB）`);
  if (size > 1.5 * 1024 * 1024) {
    console.error('超出 1.5MB 数据大小上限');
    process.exit(1);
  }
}

main();
