/** 颜色工具单元测试（对应 issue #19 验收标准；逻辑均为纯函数，无 DOM / 随机 / 时间） */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNEL_CLAMP_NOTE,
  INVALID_MESSAGE,
  NAMED_COLORS,
  blendOver,
  contrastRatio,
  describeColor,
  formatHex,
  formatHsl,
  formatHwb,
  formatOklch,
  formatRatio,
  formatRgb,
  hslToRgb,
  hwbToRgb,
  lightnessShades,
  nearestNamedColor,
  parseColor,
  rgbToHsl,
  rgbToHwb,
  wcagVerdicts,
} from './logic.mjs';

/** 便捷：解析输入并取格式化结果 */
function fmt(input) {
  const result = describeColor(input);
  assert.equal(result.ok, true, `${input} 应可解析`);
  return result.formats;
}

/* ==================== 基本转换（验收：#1e90ff） ==================== */

test('#1e90ff → rgb(30, 144, 255)、hsl(210, 100%, 56%)、命名颜色 dodgerblue（精确）', () => {
  const d = describeColor('#1e90ff');
  assert.equal(d.formats.hex, '#1e90ff');
  assert.equal(d.formats.rgb, 'rgb(30, 144, 255)');
  assert.equal(d.formats.hsl, 'hsl(210, 100%, 56%)');
  assert.equal(d.named.name, 'dodgerblue');
  assert.equal(d.named.exact, true);
});

test('#fff → #ffffff；#0008 → #00000088、rgba(0, 0, 0, 0.53)', () => {
  assert.equal(fmt('#fff').hex, '#ffffff');
  const short = describeColor('#0008');
  assert.equal(short.formats.hex, '#00000088');
  assert.equal(short.formats.rgb, 'rgba(0, 0, 0, 0.53)');
  assert.equal(short.color.a, 136 / 255);
});

test('rgb(255 0 0 / 50%) 与 rgba(255,0,0,.5) → #ff000080', () => {
  assert.equal(fmt('rgb(255 0 0 / 50%)').hex, '#ff000080');
  assert.equal(fmt('rgba(255,0,0,.5)').hex, '#ff000080');
  assert.equal(fmt('rgba(255,0,0,.5)').rgb, 'rgba(255, 0, 0, 0.5)');
});

test('hsl(120, 100%, 25%) → #008000（green，精确）；rebeccapurple → #663399；RED → #ff0000', () => {
  const green = describeColor('hsl(120, 100%, 25%)');
  assert.equal(green.formats.hex, '#008000');
  assert.equal(green.formats.rgb, 'rgb(0, 128, 0)');
  assert.equal(green.named.name, 'green');
  assert.equal(green.named.exact, true);

  assert.equal(fmt('rebeccapurple').hex, '#663399');
  const upper = describeColor('RED');
  assert.equal(upper.formats.hex, '#ff0000');
  assert.equal(upper.named.name, 'red');
  assert.equal(upper.named.exact, true);
});

test('oklch 输出：#ffffff → oklch(1.000 0.000 0)，#ff0000 → oklch(0.628 0.258 29.234)', () => {
  // 彩度 < 0.0005 时色相记为 0（无小数）
  assert.equal(fmt('#ffffff').oklch, 'oklch(1.000 0.000 0)');
  assert.equal(fmt('#ff0000').oklch, 'oklch(0.628 0.258 29.234)');
  // 数值按容差 0.001 复核（避免只测到字符串拼接）
  const lab = describeColor('#ff0000');
  const values = lab.formats.oklch.match(/oklch\((\d+\.\d+) (\d+\.\d+) (\d+\.\d+)\)/);
  assert.ok(values, lab.formats.oklch);
  assert.ok(Math.abs(Number(values[1]) - 0.62796) <= 0.001);
  assert.ok(Math.abs(Number(values[2]) - 0.25768) <= 0.001);
  assert.ok(Math.abs(Number(values[3]) - 29.234) <= 0.001);
});

/* ==================== 各类输入语法 ==================== */

test('HEX 四种长度：#rgb / #rgba / #rrggbb / #rrggbbaa', () => {
  assert.equal(fmt('#f00').hex, '#ff0000');
  assert.equal(fmt('#f008').hex, '#ff000088');
  assert.equal(fmt('#1e90ff').hex, '#1e90ff');
  assert.equal(fmt('#1e90ff80').hex, '#1e90ff80');
});

test('rgb() 逗号 / 空格、百分比、透明度百分比与数字', () => {
  assert.equal(fmt('rgb(255, 0, 0)').hex, '#ff0000');
  assert.equal(fmt('rgb(100% 0% 0%)').hex, '#ff0000');
  assert.equal(fmt('rgb(50%, 50%, 50%)').hex, '#808080');
  assert.equal(fmt('rgb(0 0 0 / 100%)').rgb, 'rgb(0, 0, 0)');
  assert.equal(fmt('rgba(255 0 0 / .25)').hex, '#ff000040');
  // 有透明度时输出 8 位 HEX 与 rgba()
  assert.equal(fmt('rgb(0 0 0 / 50%)').hex, '#00000080');
});

test('hsl() 角度单位（deg / grad / rad / turn）与折算', () => {
  assert.equal(fmt('hsl(120deg, 100%, 25%)').hex, '#008000');
  assert.equal(fmt('hsl(480, 100%, 25%)').hex, '#008000'); // 480 = 120 + 360
  assert.equal(fmt('hsl(-240 100% 25%)').hex, '#008000');
  assert.equal(fmt('hsl(0.5turn, 100%, 25%)').hex, '#008080'); // 0.5 圈 = 180°（青色）
  assert.equal(fmt('hsl(200grad, 100%, 25%)').hex, fmt('hsl(180, 100%, 25%)').hex); // 200grad = 180°
});

test('hwb() 解析与格式化', () => {
  assert.equal(fmt('hwb(0 0% 0%)').hex, '#ff0000');
  assert.equal(fmt('hwb(90 10% 20%)').hex, '#73cc1a');
  assert.equal(fmt('hwb(90 10% 20%)').rgb, 'rgb(115, 204, 26)');
  assert.equal(fmt('hwb(0 60% 60%)').hex, '#808080'); // w + b ≥ 1 → 灰色
  assert.equal(fmt('hwb(0 0% 0% / .5)').hex, '#ff000080');
  // 输出格式：#1e90ff → hwb(210 12% 0%)
  assert.equal(fmt('#1e90ff').hwb, 'hwb(210 12% 0%)');
  assert.equal(fmt('#ffffff').hwb, 'hwb(0 100% 0%)');
  assert.equal(fmt('#000000').hwb, 'hwb(0 0% 100%)');
});

test('transparent 与全透明 HEX', () => {
  const t = describeColor('transparent');
  assert.deepEqual(t.color, { r: 0, g: 0, b: 0, a: 0 });
  assert.equal(t.formats.hex, '#00000000');
  assert.equal(t.formats.rgb, 'rgba(0, 0, 0, 0)');
  assert.equal(t.named.name, 'transparent');
  assert.equal(t.named.exact, true);
  assert.equal(describeColor('#00000000').named.name, 'transparent');
});

/* ==================== 非法输入（不抛异常） ==================== */

test('非法输入 → { ok: false, message: 无法识别的颜色 }，不抛异常', () => {
  const cases = ['#12', 'rgb(300,0,0,0,0)', 'hsl(abc)', 'notacolor', '', '#12345', '#xyz', 'rgb(1 2 3 4)', 'hwb(0,0%,0%)', 'rgb(255 0 0 50%)'];
  for (const input of cases) {
    assert.deepEqual(parseColor(input), { ok: false, message: INVALID_MESSAGE }, input);
  }
  assert.equal(describeColor(null).ok, false);
  assert.equal(describeColor(undefined).ok, false);
});

test('rgb(300,0,0) 按 CSS 规则截断为 #ff0000，并提示「数值已被限制在 0–255」', () => {
  const d = describeColor('rgb(300,0,0)');
  assert.equal(d.formats.hex, '#ff0000');
  assert.deepEqual(d.notes, [CHANNEL_CLAMP_NOTE]);
  // 负值同样截断
  const neg = describeColor('rgb(-20, 0, 0)');
  assert.equal(neg.formats.hex, '#000000');
  assert.deepEqual(neg.notes, [CHANNEL_CLAMP_NOTE]);
  // 百分比越界也提示
  const pct = describeColor('rgb(120%, 0%, 0%)');
  assert.equal(pct.formats.hex, '#ff0000');
  assert.deepEqual(pct.notes, [CHANNEL_CLAMP_NOTE]);
});

test('透明度越界截断并提示；hsl / hwb 百分比越界截断并提示', () => {
  const alpha = describeColor('rgb(0 0 0 / 2)');
  assert.equal(alpha.color.a, 1);
  assert.ok(alpha.notes.includes('透明度已被限制在 0–1'));

  const sat = describeColor('hsl(0, 150%, 50%)');
  assert.equal(sat.formats.hex, '#ff0000');
  assert.ok(sat.notes.includes('百分比已被限制在 0–100'));

  const hwb = describeColor('hwb(0 -10% 0%)');
  assert.ok(hwb.notes.includes('百分比已被限制在 0–100'));
});

/* ==================== 命名颜色表 ==================== */

test('命名颜色共 148 个（不含 transparent），全部可解析、HEX 与精确匹配一致', () => {
  const names = Object.keys(NAMED_COLORS);
  assert.equal(names.length, 148);
  for (const [name, hex] of Object.entries(NAMED_COLORS)) {
    const d = describeColor(name);
    assert.equal(d.ok, true, name);
    assert.equal(d.formats.hex, hex, name);
    assert.equal(d.named.exact, true, name);
    // 灰色系别名（gray / grey 等）映射到同一颜色，允许返回最先出现的别名
    assert.equal(NAMED_COLORS[d.named.name], hex, name);
    // HEX 反解结果一致
    assert.equal(fmt(hex).hex, hex, name);
  }
});

test('别名大小写不敏感；cyan 与 aqua 同色（精确）', () => {
  assert.equal(fmt('Cyan').hex, '#00ffff');
  const cyan = describeColor('cyan');
  assert.equal(cyan.named.exact, true);
  assert.equal(NAMED_COLORS[cyan.named.name], '#00ffff');
});

test('最接近的命名颜色（非精确时按 OKLab 距离）', () => {
  const near = describeColor('#1e90fe');
  assert.equal(near.named.name, 'dodgerblue');
  assert.equal(near.named.exact, false);
  assert.equal(describeColor('#fe0000').named.name, 'red');
  assert.equal(describeColor('#0a0a0a').named.name, 'black');
  // 带透明度时不标「精确」
  assert.equal(describeColor('rgba(30, 144, 255, 0.5)').named.exact, false);
});

/* ==================== 底层转换函数 ==================== */

test('hslToRgb / rgbToHsl 基本值', () => {
  assert.deepEqual(hslToRgb(120, 1, 0.25), { r: 0, g: 128, b: 0 });
  assert.deepEqual(hslToRgb(210, 1, 0.56), { r: 31, g: 143, b: 255 });
  const hsl = rgbToHsl({ r: 30, g: 144, b: 255 });
  assert.ok(Math.abs(hsl.h - 209.6) < 0.01);
  assert.ok(Math.abs(hsl.s - 1) < 1e-9);
  assert.ok(Math.abs(hsl.l - 0.5588) < 1e-3);
  // 无彩色：h = 0, s = 0
  assert.deepEqual(rgbToHsl({ r: 128, g: 128, b: 128 }), { h: 0, s: 0, l: 0.5019607843137255 });
});

test('hwbToRgb / rgbToHwb 基本值', () => {
  assert.deepEqual(hwbToRgb(0, 0, 0), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hwbToRgb(0, 1, 0), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hwbToRgb(0, 0, 1), { r: 0, g: 0, b: 0 });
  const hwb = rgbToHwb({ r: 30, g: 144, b: 255 });
  assert.ok(Math.abs(hwb.h - 209.6) < 0.01);
  assert.ok(Math.abs(hwb.w - 30 / 255) < 1e-9);
  assert.ok(Math.abs(hwb.b) < 1e-9);
});

test('格式化函数：带透明度时 HEX 8 位、rgba()/hsla()/hwb(… / a)/oklch(… / a)', () => {
  const c = parseColor('rgba(30, 144, 255, 0.5)').color;
  assert.equal(formatHex(c), '#1e90ff80');
  assert.equal(formatRgb(c), 'rgba(30, 144, 255, 0.5)');
  assert.equal(formatHsl(c), 'hsla(210, 100%, 56%, 0.5)');
  assert.equal(formatHwb(c), 'hwb(210 12% 0% / 0.5)');
  assert.equal(formatOklch(c), 'oklch(0.652 0.190 253.205 / 0.5)');
  // 透明度文本去掉末尾 0：0.53、0.5
  assert.equal(formatRgb(parseColor('#0008').color), 'rgba(0, 0, 0, 0.53)');
});

/* ==================== 对比度（WCAG 2.x） ==================== */

test('#777777 字 / #ffffff 底 → 4.48:1；AA 大字通过，其余不通过', () => {
  const fg = parseColor('#777777').color;
  const bg = parseColor('#ffffff').color;
  const ratio = contrastRatio(fg, bg);
  assert.ok(Math.abs(ratio - 4.48) <= 0.005, ratio);
  assert.equal(formatRatio(ratio), '4.48:1');
  assert.deepEqual(wcagVerdicts(ratio), {
    aaNormal: false,
    aaLarge: true,
    aaaNormal: false,
    aaaLarge: false,
  });
});

test('#000 / #fff → 21.00:1 全部通过；相同颜色 → 1.00:1 全部不通过', () => {
  const black = parseColor('#000').color;
  const white = parseColor('#fff').color;
  const max = contrastRatio(black, white);
  assert.ok(Math.abs(max - 21) <= 1e-9);
  assert.equal(formatRatio(max), '21.00:1');
  assert.deepEqual(wcagVerdicts(max), { aaNormal: true, aaLarge: true, aaaNormal: true, aaaLarge: true });

  const same = contrastRatio(black, black);
  assert.equal(formatRatio(same), '1.00:1');
  assert.deepEqual(wcagVerdicts(same), { aaNormal: false, aaLarge: false, aaaNormal: false, aaaLarge: false });
});

test('半透明前景先与背景混合：rgba(0,0,0,0.5) 在白底 ≈ #808080 在白底（≈3.95:1，容差 0.03）', () => {
  const blended = blendOver(parseColor('rgba(0,0,0,0.5)').color, parseColor('#ffffff').color);
  assert.deepEqual(blended, { r: 128, g: 128, b: 128, a: 1 }); // 127.5 四舍五入 → 128

  const translucent = contrastRatio(parseColor('rgba(0,0,0,0.5)').color, parseColor('#ffffff').color);
  const solid = contrastRatio(parseColor('#808080').color, parseColor('#ffffff').color);
  assert.ok(Math.abs(translucent - 3.95) <= 0.03, translucent);
  assert.equal(translucent, solid); // 与 #808080 在白底的对比度一致
});

test('对比度与顺序无关（交换前景背景结果不变）', () => {
  const fg = parseColor('#777777').color;
  const bg = parseColor('#ffffff').color;
  assert.ok(Math.abs(contrastRatio(fg, bg) - contrastRatio(bg, fg)) < 1e-12);
});

test('背景有透明度时先与白色混合', () => {
  const ratio = contrastRatio(parseColor('#ffffff').color, parseColor('rgba(0,0,0,0.5)').color);
  const solid = contrastRatio(parseColor('#ffffff').color, parseColor('#808080').color);
  assert.ok(Math.abs(ratio - solid) < 1e-12);
});

/* ==================== 明度阶梯色板 ==================== */

test('色板：10 级明度阶梯，全部为 6 位 HEX，首尾最暗 / 最亮', () => {
  const shades = lightnessShades(parseColor('#1e90ff').color);
  assert.equal(shades.length, 10);
  for (const hex of shades) assert.match(hex, /^#[0-9a-f]{6}$/);
  assert.equal(shades[0], '#000d19');
  assert.equal(shades[9], '#e5f2ff');
  // 单调变亮（按相对亮度）
  const luminance = (hex) => {
    const c = parseColor(hex).color;
    const lin = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  };
  for (let i = 1; i < shades.length; i++) {
    assert.ok(luminance(shades[i]) > luminance(shades[i - 1]), `${shades[i - 1]} → ${shades[i]}`);
  }
});

test('灰色输入的色板仍是灰色；transparent 输入不崩溃', () => {
  const grays = lightnessShades(parseColor('#808080').color);
  for (const hex of grays) {
    const { r, g, b } = parseColor(hex).color;
    assert.equal(r, g);
    assert.equal(g, b);
  }
  const t = lightnessShades(parseColor('transparent').color);
  assert.equal(t.length, 10);
});

test('nearestNamedColor 对全透明色返回 transparent（精确）', () => {
  assert.deepEqual(nearestNamedColor({ r: 0, g: 0, b: 0, a: 0 }), { name: 'transparent', exact: true });
  // 非黑全透明（rgba(255,0,0,0)）不算精确
  assert.equal(nearestNamedColor({ r: 255, g: 0, b: 0, a: 0 }).exact, false);
});
