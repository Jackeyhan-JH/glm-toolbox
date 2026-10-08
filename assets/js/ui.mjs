/**
 * 公共 UI 组件与工具函数（工具模块只读引用，不得修改本文件）。
 * 依赖 base.css 中对应的样式类。
 */

/* ------------------------------------------------------------
 * el(tag, attrs, ...children) —— 简易 DOM 构建辅助
 *
 * el('a', { class: 'card', href: '#/' }, '返回首页')
 * el('button', { type: 'button', 'data-testid': 'x-run', onClick: fn }, '运行')
 *
 * attrs 约定：
 *   - class / for 等普通属性直接设置；
 *   - 值为 true → 设为空属性；false / null / undefined → 跳过；
 *   - on 开头且值为函数（如 onClick）→ 绑定事件；
 *   - style 为对象 → 逐条赋给 node.style；
 *   - 子节点：字符串 / 数字转文本节点，数组递归展开，null / undefined / false 跳过。
 * ------------------------------------------------------------ */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'style' && typeof value === 'object') {
        Object.assign(node.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) {
        node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) {
      append(node, child);
    } else if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
}

/* ------------------------------------------------------------
 * debounce(fn, ms) —— 返回带 .cancel() 的防抖函数
 * ------------------------------------------------------------ */
export function debounce(fn, ms = 200) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

/* ------------------------------------------------------------
 * copyButton(getText, options) —— 复制按钮
 *
 * const btn = copyButton(() => textarea.value, { label: '复制结果' });
 * 点击把 getText() 的返回值写入剪贴板，并短暂显示「已复制」。
 * ------------------------------------------------------------ */
export function copyButton(getText, options = {}) {
  const {
    label = '复制',
    copiedLabel = '已复制',
    failedLabel = '复制失败',
    duration = 1500,
    className = 'btn btn-sm copy-btn',
  } = options;
  const labelSpan = el('span', { class: 'copy-btn-label' }, label);
  const btn = el('button', { type: 'button', class: className }, labelSpan);
  let timer = null;

  btn.addEventListener('click', async () => {
    if (timer !== null) clearTimeout(timer);
    const text = typeof getText === 'function' ? getText() : getText;
    try {
      await writeClipboard(String(text ?? ''));
      labelSpan.textContent = copiedLabel;
      btn.classList.add('is-copied');
      btn.classList.remove('is-failed');
    } catch {
      labelSpan.textContent = failedLabel;
      btn.classList.add('is-failed');
      btn.classList.remove('is-copied');
    }
    timer = setTimeout(() => {
      labelSpan.textContent = label;
      btn.classList.remove('is-copied', 'is-failed');
    }, duration);
  });

  return btn;
}

async function writeClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // 非安全上下文（如局域网 IP 访问）的兜底
  const ta = el('textarea', { 'aria-hidden': 'true', style: { position: 'fixed', opacity: '0' } });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('剪贴板不可用');
}

/* ------------------------------------------------------------
 * showError(container, message) / clearError(container)
 * 统一样式的中文错误提示；同一容器内只有一个提示框。
 * ------------------------------------------------------------ */
export function showError(container, message) {
  if (!(container instanceof HTMLElement)) return;
  let box = container.querySelector(':scope > [data-error-box]');
  if (!box) {
    box = el('div', { class: 'error-box', role: 'alert', 'data-error-box': '' });
    container.appendChild(box);
  }
  box.textContent = String(message);
  box.hidden = false;
}

export function clearError(container) {
  if (!(container instanceof HTMLElement)) return;
  container.querySelector(':scope > [data-error-box]')?.remove();
}

/* ------------------------------------------------------------
 * 文件读取（基于 FileReader，返回 Promise）
 * ------------------------------------------------------------ */
function readWith(method, file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader[method](file);
  });
}

export const readFileAsText = (file) => readWith('readAsText', file);
export const readFileAsDataURL = (file) => readWith('readAsDataURL', file);
export const readFileAsArrayBuffer = (file) => readWith('readAsArrayBuffer', file);

/* ------------------------------------------------------------
 * downloadBlob(blob, filename) —— 触发浏览器下载
 * ------------------------------------------------------------ */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename || 'download' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
