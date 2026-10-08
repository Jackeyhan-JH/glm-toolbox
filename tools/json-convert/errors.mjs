/**
 * 转换错误：所有解析 / 序列化失败都抛这个类型，message 为中文（尽量带行列号）。
 * UI 直接把 message 显示在错误框里（showError）。
 */
export class ConvertError extends Error {
  /**
   * @param {string} message 中文错误描述（需要位置时由调用方编进 message，
   *   或用下面的 atPosition 便捷构造）
   */
  constructor(message) {
    super(message);
    this.name = 'ConvertError';
    this.line = undefined;
    this.column = undefined;
  }
}

/** 便捷构造：把位置信息编进中文消息（「第 X 行」或「第 X 行第 Y 列」） */
export function atPosition(message, line, column) {
  const err = new ConvertError(
    column === undefined ? `第 ${line} 行：${message}` : `第 ${line} 行第 ${column} 列：${message}`,
  );
  err.line = line;
  err.column = column;
  return err;
}
