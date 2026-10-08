/**
 * 全站工具分类枚举（固定，见 issue #1）。
 * 工具 issue 只引用、不新增分类；gen-index / check 也从这里读取，保证单一来源。
 */
export const CATEGORIES = [
  { id: 'data', name: '数据与格式', order: 1 },
  { id: 'encode', name: '编码与转义', order: 2 },
  { id: 'crypto', name: '加密与安全', order: 3 },
  { id: 'time', name: '时间与日期', order: 4 },
  { id: 'text', name: '文本处理', order: 5 },
  { id: 'web', name: '前端与设计', order: 6 },
  { id: 'number', name: '数字与计算', order: 7 },
];

/** 分类 id → 分类对象 的映射 */
export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** 是否为合法分类 id */
export function isValidCategory(id) {
  return CATEGORY_BY_ID.has(id);
}
