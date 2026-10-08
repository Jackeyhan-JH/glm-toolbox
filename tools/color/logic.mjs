/**
 * 颜色工具 —— 纯逻辑（不碰 DOM / window，可在 node --test 中直接 import）。
 *
 * 内容：
 *   - parseColor：解析 CSS 颜色（HEX 3/4/6/8 位、rgb()/rgba()、hsl()/hsla()、hwb()、
 *     148 个命名颜色与 transparent；逗号 / 空格语法、百分比、/ alpha 均支持）；
 *   - 格式化：HEX（有透明度时 8 位）、rgb()、hsl()、hwb()、oklch()；
 *   - 最近命名颜色（OKLab 距离，完全相等标注「精确」）；
 *   - WCAG 2.x 对比度（半透明前景先与背景混合）；
 *   - 明度阶梯色板。
 *
 * 约定：内部颜色统一为 { r, g, b }（0–255 整数）+ { a }（0–1 小数）。
 * 超出 CSS 允许范围的数值按规则截断并返回中文提示（notes）；
 * 完全无法识别时返回 { ok: false, message }，不抛异常。
 */

/** 无法识别时的统一中文提示 */
export const INVALID_MESSAGE = '无法识别的颜色';

/** 通道被截断时的提示（CSS 规则：rgb 通道限制在 0–255） */
export const CHANNEL_CLAMP_NOTE = '数值已被限制在 0–255';

/** 透明度被截断时的提示（alpha 限制在 0–1） */
export const ALPHA_CLAMP_NOTE = '透明度已被限制在 0–1';

/** 百分比通道（hsl 的 s/l、hwb 的 w/b）被截断时的提示（限制在 0–100%） */
export const PERCENT_CLAMP_NOTE = '百分比已被限制在 0–100';

/* ============================================================
 * CSS 命名颜色表（CSS Color Module Level 4，共 148 个，不含 transparent）
 * ============================================================ */

export const NAMED_COLORS = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
};

/** 命名颜色 → { r, g, b }（不透明），供解析与最近色查找复用 */
const NAMED_RGB = new Map(
  Object.entries(NAMED_COLORS).map(([name, hex]) => [name, hexToRgb(hex)]),
);

const OPAQUE_WHITE = { r: 255, g: 255, b: 255, a: 1 };

/* ============================================================
 * 基础转换
 * ============================================================ */

/** 6 位 HEX → { r, g, b }（内部使用，不校验） */
export function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function round255(value) {
  return Math.min(255, Math.max(0, Math.round(value * 255)));
}

/** 规范化角度到 [0, 360) */
function normalizeHue(h) {
  return ((h % 360) + 360) % 360;
}

/** hsl → rgb（s、l 为 0–1 小数；结果取整到 0–255） */
export function hslToRgb(h, s, l) {
  const raw = hslToRgbRaw(h, s, l);
  return { r: round255(raw.r), g: round255(raw.g), b: round255(raw.b) };
}

/** hsl → rgb，不取整（0–1 小数），供 hwb 复用 */
function hslToRgbRaw(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = normalizeHue(h) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return { r: rgb[0] + m, g: rgb[1] + m, b: rgb[2] + m };
}

/** rgb → hsl（h 为 0–360 度、s / l 为 0–1 小数；无彩色时 h = 0） */
export function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: normalizeHue(h * 60), s, l };
}

/** hwb → rgb（w、b 为 0–1 小数；w + b ≥ 1 时得到灰色） */
export function hwbToRgb(h, w, b) {
  if (w + b >= 1) {
    const gray = round255(w / (w + b));
    return { r: gray, g: gray, b: gray };
  }
  const base = hslToRgbRaw(h, 1, 0.5); // 纯色相（s = 100%，l = 50%）
  const scale = 1 - w - b;
  return {
    r: round255(base.r * scale + w),
    g: round255(base.g * scale + w),
    b: round255(base.b * scale + w),
  };
}

/** rgb → hwb（w、b 为 0–1 小数） */
export function rgbToHwb({ r, g, b }) {
  const { h } = rgbToHsl({ r, g, b });
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  return { h, w: Math.min(rn, gn, bn), b: 1 - Math.max(rn, gn, bn) };
}

/** sRGB 通道伽马展开（0–1） */
function linearize(channel) {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** 线性 sRGB → OKLab（Björn Ottosson 的参考实现系数） */
export function rgbToOklab({ r, g, b }) {
  const lr = linearize(r);
  const lg = linearize(g);
  const lb = linearize(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/* ============================================================
 * 解析
 * ============================================================ */

const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const NUMBER_PERCENT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(%)?$/;
const HUE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(deg|grad|rad|turn)?$/;

function invalid() {
  return { ok: false, message: INVALID_MESSAGE };
}

function makeColor(r, g, b, a, notes) {
  return { ok: true, color: { r, g, b, a }, notes };
}

/**
 * 解析任意 CSS 颜色字符串。
 * 返回 { ok: true, color: {r,g,b,a}, notes: string[] }
 * 或   { ok: false, message: '无法识别的颜色' }（不抛异常）。
 */
export function parseColor(input) {
  const text = String(input ?? '').trim().toLowerCase();
  if (text === '') return invalid();

  // 命名颜色（含 transparent）
  if (text === 'transparent') return makeColor(0, 0, 0, 0, []);
  const named = NAMED_RGB.get(text);
  if (named) return makeColor(named.r, named.g, named.b, 1, []);

  // HEX：#rgb / #rgba / #rrggbb / #rrggbbaa
  if (text.startsWith('#')) return parseHex(text.slice(1));

  // 函数式：rgb() / rgba() / hsl() / hsla() / hwb()
  const fn = /^([a-z]+)\(([^()]*)\)$/.exec(text);
  if (fn) {
    const name = fn[1];
    const body = fn[2].trim();
    if (name === 'rgb' || name === 'rgba') return parseRgb(body);
    if (name === 'hsl' || name === 'hsla') return parseHsl(body);
    if (name === 'hwb') return parseHwb(body);
  }
  return invalid();
}

function parseHex(body) {
  if (!/^[0-9a-f]+$/.test(body)) return invalid();
  if (body.length !== 3 && body.length !== 4 && body.length !== 6 && body.length !== 8) {
    return invalid();
  }
  const digits =
    body.length === 3 || body.length === 4
      ? [...body].map((ch) => ch + ch).join('') // #f00 → #ff0000
      : body;
  const rgb = hexToRgb(`#${digits.slice(0, 6)}`);
  const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
  return makeColor(rgb.r, rgb.g, rgb.b, a, []);
}

/** rgb 通道：数字（0–255）或百分比（0–100% → 0–255），越界截断并提示 */
function channelValue(token, notes) {
  const m = NUMBER_PERCENT.exec(token);
  if (!m) return null;
  const raw = parseFloat(token);
  const value = m[1] ? (raw * 255) / 100 : raw; // 用 255/100 而非 2.55，避免浮点误差（50% → 127.5 而非 127.499…）
  if (value < 0 || value > 255) notes.push(CHANNEL_CLAMP_NOTE);
  const clamped = Math.min(255, Math.max(0, value));
  return Math.round(clamped);
}

/** 透明度：数字（0–1）或百分比（0–100%），越界截断并提示 */
function alphaValue(token, notes) {
  const m = NUMBER_PERCENT.exec(token);
  if (!m) return null;
  const raw = parseFloat(token);
  const value = m[1] ? raw / 100 : raw;
  if (value < 0 || value > 1) notes.push(ALPHA_CLAMP_NOTE);
  return Math.min(1, Math.max(0, value));
}

/** 色相：数字（度）或 deg / grad / rad / turn，折算到 0–360 */
function hueValue(token) {
  const m = HUE.exec(token);
  if (!m) return null;
  const raw = parseFloat(token);
  switch (m[1]) {
    case 'grad':
      return normalizeHue(raw * 0.9);
    case 'rad':
      return normalizeHue((raw * 180) / Math.PI);
    case 'turn':
      return normalizeHue(raw * 360);
    default:
      return normalizeHue(raw);
  }
}

/** 百分比通道（hsl 的 s/l、hwb 的 w/b）：数字按百分数对待，越界截断并提示 */
function percentValue(token, notes) {
  const m = NUMBER_PERCENT.exec(token);
  if (!m) return null;
  const raw = parseFloat(token);
  if (raw < 0 || raw > 100) notes.push(PERCENT_CLAMP_NOTE);
  return Math.min(100, Math.max(0, raw)) / 100;
}

function parseRgb(body) {
  const notes = [];
  if (body.includes(',')) {
    // 旧语法：逗号分隔，恰好 3 个通道 + 可选 alpha
    const parts = body.split(',').map((s) => s.trim());
    if (parts.length !== 3 && parts.length !== 4) return invalid();
    const values = parts.map((part, i) =>
      i === 3 ? alphaValue(part, notes) : channelValue(part, notes),
    );
    if (values.some((v) => v === null)) return invalid();
    return makeColor(values[0], values[1], values[2], values[3], notes);
  }
  // 现代语法：空格分隔 3 个通道，alpha 必须以 / 分隔
  const pieces = body.split('/');
  if (pieces.length > 2) return invalid();
  const channels = pieces[0].trim().split(/\s+/);
  if (channels.length !== 3) return invalid();
  const values = channels.map((token) => channelValue(token, notes));
  if (values.some((v) => v === null)) return invalid();
  let a = 1;
  if (pieces[1] !== undefined) {
    a = alphaValue(pieces[1].trim(), notes);
    if (a === null) return invalid();
  }
  return makeColor(values[0], values[1], values[2], a, notes);
}

function parseHsl(body) {
  const notes = [];
  let parts; // [hue, s, l] + 可选 alpha
  if (body.includes(',')) {
    const commas = body.split(',').map((s) => s.trim());
    if (commas.length !== 3 && commas.length !== 4) return invalid();
    parts = { hue: commas[0], s: commas[1], l: commas[2], alpha: commas[3] };
  } else {
    const pieces = body.split('/');
    if (pieces.length > 2) return invalid();
    const channels = pieces[0].trim().split(/\s+/);
    if (channels.length !== 3) return invalid();
    parts = { hue: channels[0], s: channels[1], l: channels[2], alpha: pieces[1]?.trim() };
  }
  const h = hueValue(parts.hue);
  const s = percentValue(parts.s, notes);
  const l = percentValue(parts.l, notes);
  if (h === null || s === null || l === null) return invalid();
  let a = 1;
  if (parts.alpha !== undefined) {
    a = alphaValue(parts.alpha, notes);
    if (a === null) return invalid();
  }
  const rgb = hslToRgb(h, s, l);
  return makeColor(rgb.r, rgb.g, rgb.b, a, notes);
}

function parseHwb(body) {
  const notes = [];
  if (body.includes(',')) return invalid(); // hwb() 只有空格语法
  const pieces = body.split('/');
  if (pieces.length > 2) return invalid();
  const channels = pieces[0].trim().split(/\s+/);
  if (channels.length !== 3) return invalid();
  const h = hueValue(channels[0]);
  const w = percentValue(channels[1], notes);
  const b = percentValue(channels[2], notes);
  if (h === null || w === null || b === null) return invalid();
  let a = 1;
  if (pieces[1] !== undefined) {
    a = alphaValue(pieces[1].trim(), notes);
    if (a === null) return invalid();
  }
  const rgb = hwbToRgb(h, w, b);
  return makeColor(rgb.r, rgb.g, rgb.b, a, notes);
}

/* ============================================================
 * 格式化
 * ============================================================ */

/** 透明度文本（保留 2 位小数，去掉末尾的 0：0.5 / 0.53） */
function formatAlpha(a) {
  return String(Math.round(a * 100) / 100);
}

/** HEX：不透明 6 位，有透明度 8 位（#1e90ff / #00000088） */
export function formatHex({ r, g, b, a }) {
  const hex = `#${to2(r)}${to2(g)}${to2(b)}`;
  return a < 1 ? `${hex}${to2(Math.round(a * 255))}` : hex;
}

function to2(value) {
  return value.toString(16).padStart(2, '0');
}

/** rgb() / rgba()：rgb(30, 144, 255)；有透明度时 rgba(0, 0, 0, 0.53) */
export function formatRgb({ r, g, b, a }) {
  return a < 1 ? `rgba(${r}, ${g}, ${b}, ${formatAlpha(a)})` : `rgb(${r}, ${g}, ${b})`;
}

/** hsl() / hsla()：hsl(210, 100%, 56%)；有透明度时 hsla(…, 0.5) */
export function formatHsl(color) {
  const { h, s, l } = rgbToHsl(color);
  const body = `${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
  return color.a < 1 ? `hsla(${body}, ${formatAlpha(color.a)})` : `hsl(${body})`;
}

/** hwb()：hwb(210 12% 0%)；有透明度时 hwb(… / 0.5) */
export function formatHwb(color) {
  const { h, w, b } = rgbToHwb(color);
  const alpha = color.a < 1 ? ` / ${formatAlpha(color.a)}` : '';
  return `hwb(${Math.round(h)} ${Math.round(w * 100)}% ${Math.round(b * 100)}%${alpha})`;
}

/** oklch()：oklch(0.628 0.258 29.234)；L / C 保留 3 位小数，彩度 < 0.0005 时色相记为 0 */
export function formatOklch(color) {
  const { L, a, b } = rgbToOklab(color);
  const c = Math.hypot(a, b);
  let h = 0;
  if (c >= 0.0005) h = normalizeHue((Math.atan2(b, a) * 180) / Math.PI);
  const hueText = String(Math.round(h * 1000) / 1000);
  const alpha = color.a < 1 ? ` / ${formatAlpha(color.a)}` : '';
  return `oklch(${L.toFixed(3)} ${c.toFixed(3)} ${hueText === '360' ? '0' : hueText}${alpha})`;
}

/* ============================================================
 * 最近命名颜色
 * ============================================================ */

function oklabDistance(x, y) {
  const lab1 = rgbToOklab(x);
  const lab2 = rgbToOklab(y);
  return (lab1.L - lab2.L) ** 2 + (lab1.a - lab2.a) ** 2 + (lab1.b - lab2.b) ** 2;
}

/**
 * 最接近的 CSS 命名颜色（按 OKLab 距离）。
 * 完全相等（通道一致且不透明）时 { exact: true }；
 * 全透明色（rgba(0,0,0,0)）对应 transparent（精确）。
 */
export function nearestNamedColor(color) {
  if (color.a === 0 && color.r === 0 && color.g === 0 && color.b === 0) {
    return { name: 'transparent', exact: true };
  }
  if (color.a === 1) {
    const name = exactName(color);
    if (name) return { name, exact: true };
  }
  let best = null;
  let bestDistance = Infinity;
  for (const [name, rgb] of NAMED_RGB) {
    const distance = oklabDistance(color, rgb);
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return { name: best, exact: false };
}

/** 反查：某 RGB 对应的命名颜色（不透明才有；多个别名取表中最先出现的） */
function exactName({ r, g, b }) {
  for (const [name, rgb] of NAMED_RGB) {
    if (rgb.r === r && rgb.g === g && rgb.b === b) return name;
  }
  return null;
}

/* ============================================================
 * 汇总（UI 与测试共用）
 * ============================================================ */

/** 解析 + 全部格式 + 最近命名颜色，一次返回 */
export function describeColor(input) {
  const parsed = parseColor(input);
  if (!parsed.ok) return parsed;
  const { color, notes } = parsed;
  return {
    ok: true,
    color,
    notes,
    formats: {
      hex: formatHex(color),
      rgb: formatRgb(color),
      hsl: formatHsl(color),
      hwb: formatHwb(color),
      oklch: formatOklch(color),
    },
    named: nearestNamedColor(color),
  };
}

/* ============================================================
 * WCAG 对比度
 * ============================================================ */

/** 半透明色混合到不透明底色上（通道四舍五入取整） */
export function blendOver(fg, bg) {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

/** WCAG 2.x 相对亮度 */
export function relativeLuminance({ r, g, b }) {
  const lin = (channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * 前景 / 背景对比度。
 * 前景有透明度时先与背景混合；背景自身有透明度时先与白色混合。
 */
export function contrastRatio(fg, bg) {
  const effBg = bg.a < 1 ? blendOver(bg, OPAQUE_WHITE) : bg;
  const effFg = fg.a < 1 ? blendOver(fg, effBg) : fg;
  const l1 = relativeLuminance(effFg);
  const l2 = relativeLuminance(effBg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** 对比度展示文本：4.48:1 */
export function formatRatio(ratio) {
  return `${ratio.toFixed(2)}:1`;
}

/** WCAG 2.x 判定（≥ 即通过）：AA 普通文本 4.5、AA 大字 3、AAA 普通文本 7、AAA 大字 4.5 */
export function wcagVerdicts(ratio) {
  return {
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,
    aaaLarge: ratio >= 4.5,
  };
}

export const WCAG_ITEMS = [
  { key: 'aaNormal', label: 'AA 普通文本', threshold: 4.5 },
  { key: 'aaLarge', label: 'AA 大字', threshold: 3 },
  { key: 'aaaNormal', label: 'AAA 普通文本', threshold: 7 },
  { key: 'aaaLarge', label: 'AAA 大字', threshold: 4.5 },
];

/* ============================================================
 * 明度阶梯色板
 * ============================================================ */

/** 保持色相与饱和度，按明度均分 steps 级（如 10 级：L = 5%、15%、…、95%），返回 HEX 数组 */
export function lightnessShades(color, steps = 10) {
  const { h, s } = rgbToHsl(color);
  return Array.from({ length: steps }, (_, i) => {
    const l = (i + 0.5) / steps;
    const rgb = hslToRgb(h, s, l);
    return formatHex({ ...rgb, a: 1 });
  });
}
