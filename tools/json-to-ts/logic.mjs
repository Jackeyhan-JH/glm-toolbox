/**
 * JSON 转 TS 类型 —— 纯逻辑模块（不碰 DOM / window，node --test 直接测试）。
 *
 * 推断规则（见 issue #5）：
 *   - 基本类型 string / number / boolean / null；嵌套对象生成独立接口，
 *     接口名为键名的 PascalCase（user_profile → UserProfile）；
 *   - 数组：元素类型合并；对象数组合并为一个接口，「不是每个元素都有的键」标为可选；
 *     元素类型不同时生成联合类型（按首次出现顺序）；空数组为 unknown[]；
 *   - 数组元素接口名：键名 PascalCase 去掉结尾的 s（items → Item），
 *     不以 s 结尾则加 Item 后缀（data → DataItem）；
 *   - 名称冲突时加数字后缀（Item2）；结构完全相同的对象复用同一接口；
 *   - 不是合法标识符的键加双引号（"a-b"、"2x"）；
 *   - 输出顺序：根类型在前，其余按首次出现顺序；接口之间空一行，缩进 2 空格，行尾分号。
 *
 * 确定性：不使用当前时间与随机数，同样输入永远得到同样输出。
 */

/* ==================== 选项 ==================== */

export const DEFAULT_OPTIONS = {
  /** 根类型名 */
  rootName: 'Root',
  /** 对象声明方式：'interface' | 'type' */
  kind: 'interface',
  /** 是否加 export */
  exportDecl: true,
  /** 可选属性写法：'question'（key?: T） | 'undefined'（key: T | undefined） */
  optionalStyle: 'question',
};

/** 属性键 / 类型名是否为合法标识符（Unicode，含 ZWJ / ZWNJ） */
const IDENTIFIER_RE = /^[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*$/u;

/* ==================== JSON 解析 ==================== */

/** 解析 JSON；失败时抛出中文错误（不精确定位，见 issue） */
export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`JSON 格式有误，无法解析：${detail}`);
  }
}

/* ==================== 命名 ==================== */

/** 把键名分词：按非「字母 / 数字 / $」字符分隔，再按驼峰边界（aB、ABc）细分 */
function splitWords(key) {
  return String(key)
    .split(/[^$\p{L}\p{N}]+/u)
    .flatMap((run) =>
      run
        .replace(/([a-z\d])([A-Z])/g, '$1\u0000$2')
        .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1\u0000$2')
        .split('\u0000'),
    )
    .filter((word) => word !== '');
}

/**
 * 键名 → PascalCase 类型名：user_profile / userProfile / USER_PROFILE → UserProfile。
 * 结果不是合法标识符开头（如纯数字）时补下划线前缀，空结果用 Type。
 */
export function pascalCase(key) {
  const name = splitWords(key)
    .map((word) => {
      const cps = [...word];
      return cps[0].toUpperCase() + cps.slice(1).join('').toLowerCase();
    })
    .join('');
  if (name === '') return 'Type';
  return /^[$\p{L}]/u.test(name) ? name : `_${name}`;
}

/** 数组元素接口名：PascalCase 去掉结尾 s（Items → Item），否则加 Item（Data → DataItem） */
export function arrayElementName(pascal) {
  return pascal.length > 1 && /s$/i.test(pascal) ? pascal.slice(0, -1) : `${pascal}Item`;
}

/** 根类型名：去空白；为空或不是合法标识符时回退（回退用 pascalCase 归一化） */
function normalizeRootName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name === '') return DEFAULT_OPTIONS.rootName;
  return IDENTIFIER_RE.test(name) ? name : pascalCase(name);
}

/* ==================== 类型描述符（未命名阶段） ====================
 *
 * { kind: 'primitive', name: 'string'|'number'|'boolean'|'null' }
 * { kind: 'unknown' }                                    空数组元素
 * { kind: 'object', props: [{ key, optional, type }] }
 * { kind: 'array', elem }                                空数组时 elem 为 unknown
 * { kind: 'union', members: [type…] }                    已按首次出现顺序去重
 *
 * typeKey() 为每个描述符生成稳定的结构键（_key 缓存），用于去重与接口复用。
 * ---------------------------------------------------- */

const UNKNOWN = { kind: 'unknown', name: 'unknown' };

function typeKey(t) {
  if (t._key !== undefined) return t._key;
  let key;
  switch (t.kind) {
    case 'primitive':
      key = `p:${t.name}`;
      break;
    case 'unknown':
      key = 'u';
      break;
    case 'array':
      key = `a[${typeKey(t.elem)}]`;
      break;
    case 'union':
      key = `(${t.members.map(typeKey).join('|')})`;
      break;
    case 'object':
      key = `o[${t.props
        .map((p) => `${p.optional ? '?' : ''}${JSON.stringify(p.key)}:${typeKey(p.type)}`)
        .join(',')}]`;
      break;
    default:
      key = '?';
  }
  t._key = key;
  return key;
}

/** 按结构键去重，保持首次出现顺序 */
function dedupe(types) {
  const seen = new Map();
  for (const t of types) {
    const key = typeKey(t);
    if (!seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()];
}

/** JSON 值 → 类型描述符 */
function inferValue(value) {
  if (value === null) return { kind: 'primitive', name: 'null' };
  switch (typeof value) {
    case 'string':
      return { kind: 'primitive', name: 'string' };
    case 'number':
      return { kind: 'primitive', name: 'number' };
    case 'boolean':
      return { kind: 'primitive', name: 'boolean' };
    case 'object':
      return Array.isArray(value) ? inferArray(value) : inferObject(value);
    default:
      return UNKNOWN;
  }
}

function inferObject(obj) {
  const props = [];
  for (const [key, value] of Object.entries(obj)) {
    props.push({ key, optional: false, type: inferValue(value) });
  }
  return { kind: 'object', props };
}

function inferArray(arr) {
  if (arr.length === 0) return { kind: 'array', elem: UNKNOWN };
  return { kind: 'array', elem: mergeTypes(arr.map(inferValue)) };
}

/**
 * 合并一组类型描述符（数组元素 / 对象数组各元素共有的键的取值）：
 *   - 全部相同 → 该类型；
 *   - 全是对象 → 合并为一个对象：键按首次出现顺序，缺的标可选（与数组元素同规则）；
 *   - 否则 → 联合类型，按首次出现顺序去重。
 */
function mergeTypes(types) {
  const distinct = dedupe(types);
  if (distinct.length === 1) return distinct[0];
  if (distinct.every((t) => t.kind === 'object')) return mergeObjects(distinct);
  return { kind: 'union', members: distinct };
}

/** 合并多个对象描述符：键按首次出现顺序，不是每个对象都有的键标为可选 */
function mergeObjects(objects) {
  const ordered = [];
  const byKey = new Map(); // key -> { key, types: [] }
  for (const obj of objects) {
    for (const prop of obj.props) {
      let entry = byKey.get(prop.key);
      if (!entry) {
        entry = { key: prop.key, types: [] };
        byKey.set(prop.key, entry);
        ordered.push(entry);
      }
      entry.types.push(prop.type);
    }
  }
  return {
    kind: 'object',
    props: ordered.map((entry) => ({
      key: entry.key,
      optional: entry.types.length < objects.length,
      type: mergeTypes(entry.types),
    })),
  };
}

/* ==================== 命名与解析（第二遍） ====================
 *
 * 遍历描述符树，为每个对象结构分配接口名（结构相同 → 复用），
 * 输出「解析后的根描述符 + 按首次出现顺序排列的接口列表」。
 * 解析后对象变成 { kind: 'ref', name } 引用。
 * ---------------------------------------------------- */

function createNamer() {
  const byStruct = new Map(); // 结构键 → 接口名
  const interfaces = []; // 按首次出现顺序：{ name, props }
  const used = new Set(); // 已占用的类型名

  function uniqueName(base) {
    if (!used.has(base)) return base;
    const match = /^(.*?)(\d+)$/.exec(base);
    let n = match ? Number(match[2]) : 1;
    const stem = match ? match[1] : base;
    let name;
    do {
      n += 1;
      name = `${stem}${n}`;
    } while (used.has(name));
    return name;
  }

  /** 声明一个新接口（占用名字，占位后递归解析属性） */
  function declare(base) {
    const name = uniqueName(base);
    used.add(name);
    const entry = { name, props: [] };
    interfaces.push(entry);
    return entry;
  }

  /**
   * 解析描述符：hint 为该位置的类型名提示（对象 → pascalCase(键名)，
   * 数组元素 → arrayElementName(hint)）。
   */
  function resolve(t, hint) {
    switch (t.kind) {
      case 'primitive':
      case 'unknown':
        return t;
      case 'array':
        return { kind: 'array', elem: resolve(t.elem, arrayElementName(hint)) };
      case 'union':
        return { kind: 'union', members: t.members.map((m) => resolve(m, hint)) };
      case 'object': {
        const structKey = typeKey(t);
        const existing = byStruct.get(structKey);
        if (existing) return { kind: 'ref', name: existing };
        const entry = declare(hint);
        byStruct.set(structKey, entry.name);
        entry.props = t.props.map((prop) => ({
          key: prop.key,
          optional: prop.optional,
          type: resolve(prop.type, pascalCase(prop.key)),
        }));
        return { kind: 'ref', name: entry.name };
      }
      default:
        return t;
    }
  }

  return { resolve, interfaces, used };
}

/* ==================== 渲染 ==================== */

/** 属性键：合法标识符裸写，否则 JSON 字符串形式加双引号 */
function renderKey(key) {
  return IDENTIFIER_RE.test(key) ? key : JSON.stringify(key);
}

function renderType(t) {
  switch (t.kind) {
    case 'primitive':
    case 'unknown':
    case 'ref':
      return t.name;
    case 'array': {
      const inner = renderType(t.elem);
      return t.elem.kind === 'union' ? `(${inner})[]` : `${inner}[]`;
    }
    case 'union':
      return t.members.map(renderType).join(' | ');
    default:
      return 'unknown';
  }
}

/** 渲染接口条目：interface 或 type 两种声明方式；空对象单行 */
function renderInterface(entry, opts) {
  const prefix = opts.exportDecl ? 'export ' : '';
  const lines = entry.props.map((prop) => {
    const optional = prop.optional && opts.optionalStyle === 'question' ? '?' : '';
    const suffix = prop.optional && opts.optionalStyle === 'undefined' ? ' | undefined' : '';
    return `  ${renderKey(prop.key)}${optional}: ${renderType(prop.type)}${suffix};`;
  });
  if (lines.length === 0) {
    return opts.kind === 'type'
      ? `${prefix}type ${entry.name} = {};`
      : `${prefix}interface ${entry.name} {}`;
  }
  const head =
    opts.kind === 'type' ? `${prefix}type ${entry.name} = {` : `${prefix}interface ${entry.name} {`;
  return [head, ...lines, opts.kind === 'type' ? '};' : '}'].join('\n');
}

/** 校验并归一化选项（容忍传入残留 / 非法值） */
function normalizeOptions(options = {}) {
  const raw = options && typeof options === 'object' ? options : {};
  return {
    rootName: normalizeRootName(raw.rootName),
    kind: raw.kind === 'type' ? 'type' : 'interface',
    exportDecl: raw.exportDecl === undefined ? DEFAULT_OPTIONS.exportDecl : Boolean(raw.exportDecl),
    optionalStyle: raw.optionalStyle === 'undefined' ? 'undefined' : 'question',
  };
}

/**
 * 从已解析的 JSON 值生成 TypeScript 定义文本。
 * @param {*} value JSON.parse 的结果
 * @param {object} [options] 见 DEFAULT_OPTIONS
 * @returns {{ code: string, interfaces: Array<{name, props}> }}
 */
export function renderTypes(value, options = {}) {
  const opts = normalizeOptions(options);
  const namer = createNamer();

  const rootDesc = inferValue(value);
  let resolvedRoot;
  if (rootDesc.kind === 'object') {
    resolvedRoot = namer.resolve(rootDesc, opts.rootName); // 根对象优先占用根名
  } else {
    namer.used.add(opts.rootName); // 根是 type 别名，同样占用根名
    resolvedRoot = namer.resolve(rootDesc, opts.rootName);
  }

  const parts = [];
  if (resolvedRoot.kind === 'ref') {
    // 根是对象：interfaces[0] 即根接口，其余从 1 开始
    parts.push(renderInterface(namer.interfaces[0], opts));
    for (const entry of namer.interfaces.slice(1)) {
      parts.push(renderInterface(entry, opts));
    }
  } else {
    // 根是 type 别名（数组 / 标量）：interfaces 里没有根，全部输出
    const prefix = opts.exportDecl ? 'export ' : '';
    parts.push(`${prefix}type ${opts.rootName} = ${renderType(resolvedRoot)};`);
    for (const entry of namer.interfaces) {
      parts.push(renderInterface(entry, opts));
    }
  }
  return { code: parts.join('\n\n'), interfaces: namer.interfaces };
}

/**
 * 主入口：JSON 文本 → TypeScript 定义文本。
 * 空白输入返回 ''；JSON 非法抛中文 Error。
 * @param {string} jsonText
 * @param {object} [options] 见 DEFAULT_OPTIONS
 * @returns {string}
 */
export function generateTypeScript(jsonText, options = {}) {
  const text = typeof jsonText === 'string' ? jsonText.trim() : '';
  if (text === '') return '';
  return renderTypes(parseJson(text), options).code;
}
