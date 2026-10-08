/**
 * JSON 转 TS 类型 —— 工具入口（外壳在进入 #/json-to-ts 时动态加载本模块）。
 *
 * 目录约定见 CONTRIBUTING.md：
 *   tool.json       清单（id / name / category / keywords / order）
 *   logic.mjs       纯逻辑，不碰 DOM，供 node --test 直接测试
 *   logic.test.mjs  单元测试
 *   index.mjs       UI 挂载（本文件），导出 mount(root, ctx)
 *   ui.e2e.mjs      Playwright 端到端测试
 *   style.css       工具私有样式（经 ctx.loadStyle 加载，切换工具时外壳自动移除）
 */

import { el, copyButton, debounce, showError, clearError } from '../../assets/js/ui.mjs';
import { DEFAULT_OPTIONS, generateTypeScript } from './logic.mjs';

const STORAGE_KEY_TEXT = 'text'; // 实际存储键为 glm-toolbox:json-to-ts:text
const STORAGE_KEY_OPTIONS = 'options';
const UPDATE_DEBOUNCE_MS = 200; // ≤ 300ms，输入 / 选项变化后自动更新

/** 读取本地存储中的选项，逐字段校验后与默认值合并（避免残留脏数据） */
function loadSavedOptions(storage) {
  const saved = storage.get(STORAGE_KEY_OPTIONS, null);
  if (saved === null || typeof saved !== 'object') return { ...DEFAULT_OPTIONS };
  return {
    rootName: typeof saved.rootName === 'string' ? saved.rootName : DEFAULT_OPTIONS.rootName,
    kind: saved.kind === 'type' ? 'type' : 'interface',
    exportDecl:
      saved.exportDecl === undefined ? DEFAULT_OPTIONS.exportDecl : Boolean(saved.exportDecl),
    optionalStyle: saved.optionalStyle === 'undefined' ? 'undefined' : 'question',
  };
}

export async function mount(root, ctx) {
  ctx.loadStyle('tools/json-to-ts/style.css');

  const opts = loadSavedOptions(ctx.storage);

  /* ---------- 构建 DOM ---------- */

  const input = el('textarea', {
    id: 'json-to-ts-input',
    'data-testid': 'json-to-ts-input',
    placeholder: '粘贴 JSON 样例，TypeScript 类型定义实时生成…',
    spellcheck: 'false',
  });

  const output = el('pre', {
    class: 'output-box json-to-ts-output',
    'data-testid': 'json-to-ts-output',
    'aria-label': 'TypeScript 输出',
  });

  const feedback = el('div', { class: 'json-to-ts-feedback' });

  const rootNameInput = el('input', {
    type: 'text',
    id: 'json-to-ts-root-name',
    'data-testid': 'json-to-ts-root-name',
    value: opts.rootName,
    autocomplete: 'off',
    spellcheck: 'false',
  });

  /** 分段切换按钮（interface / type、?: / | undefined） */
  function segButton(name, pressed, onPress) {
    return el('button', {
      type: 'button',
      'aria-pressed': String(pressed),
      onClick: () => onPress(),
    }, name);
  }

  const kindButtons = {
    interface: null,
    type: null,
  };
  const optionalButtons = {
    question: null,
    undefined: null,
  };

  function syncSegButtons() {
    for (const [kind, button] of Object.entries(kindButtons)) {
      button.setAttribute('aria-pressed', String(opts.kind === kind));
    }
    for (const [style, button] of Object.entries(optionalButtons)) {
      button.setAttribute('aria-pressed', String(opts.optionalStyle === style));
    }
  }

  kindButtons.interface = segButton('interface', opts.kind === 'interface', () => {
    opts.kind = 'interface';
    syncSegButtons();
    update();
  });
  kindButtons.type = segButton('type', opts.kind === 'type', () => {
    opts.kind = 'type';
    syncSegButtons();
    update();
  });

  const exportCheckbox = el('input', { type: 'checkbox' });
  exportCheckbox.checked = opts.exportDecl;

  optionalButtons.question = segButton('?:', opts.optionalStyle === 'question', () => {
    opts.optionalStyle = 'question';
    syncSegButtons();
    update();
  });
  optionalButtons.undefined = segButton('| undefined', opts.optionalStyle === 'undefined', () => {
    opts.optionalStyle = 'undefined';
    syncSegButtons();
    update();
  });

  root.append(
    el(
      'section',
      { class: 'tool json-to-ts' },
      el(
        'header',
        { class: 'tool-header' },
        el('h1', { class: 'tool-title' }, ctx.tool.name),
        el('p', { class: 'tool-desc' }, ctx.tool.description),
        el(
          'div',
          { class: 'tool-actions' },
          copyButton(() => output.textContent, { label: '复制类型定义' }),
        ),
      ),
      el(
        'div',
        { class: 'form-row json-to-ts-options' },
        el('label', { class: 'option', for: 'json-to-ts-root-name' }, '根类型名'),
        rootNameInput,
        el(
          'div',
          { class: 'seg', role: 'group', 'aria-label': '声明方式' },
          kindButtons.interface,
          kindButtons.type,
        ),
        el(
          'label',
          { class: 'option' },
          exportCheckbox,
          '加 export',
        ),
        el(
          'div',
          { class: 'seg', role: 'group', 'aria-label': '可选属性写法' },
          optionalButtons.question,
          optionalButtons.undefined,
        ),
      ),
      el(
        'div',
        { class: 'json-to-ts-layout two-col' },
        el(
          'div',
          { class: 'json-to-ts-editor' },
          el('label', { class: 'field-label', for: 'json-to-ts-input' }, 'JSON 输入'),
          input,
          el('p', { class: 'field-hint' }, '内容只在浏览器本地处理，不会上传。'),
        ),
        el(
          'div',
          { class: 'json-to-ts-result' },
          el('div', { class: 'field-label' }, 'TypeScript 输出'),
          output,
          feedback,
          el(
            'p',
            { class: 'field-hint' },
            '输入或选项变化后自动更新；嵌套对象与数组元素会生成独立的接口。',
          ),
        ),
      ),
    ),
  );

  /* ---------- 交互 ---------- */

  const update = debounce(() => {
    opts.rootName = rootNameInput.value; // 归一化（空白 / 非法标识符回退）由 logic 处理
    const text = input.value;
    ctx.storage.set(STORAGE_KEY_TEXT, text); // 记住上次输入
    ctx.storage.set(STORAGE_KEY_OPTIONS, opts);

    if (text.trim() === '') {
      output.textContent = '';
      clearError(feedback);
      return;
    }
    try {
      output.textContent = generateTypeScript(text, opts);
      clearError(feedback);
    } catch (err) {
      // JSON 非法：中文错误提示，且不残留半截类型
      output.textContent = '';
      showError(feedback, err instanceof Error ? err.message : String(err));
    }
  }, UPDATE_DEBOUNCE_MS);

  input.addEventListener('input', update);
  rootNameInput.addEventListener('input', update);
  exportCheckbox.addEventListener('change', () => {
    opts.exportDecl = exportCheckbox.checked;
    update();
  });

  // 恢复上次输入并立即生成一次
  const saved = ctx.storage.get(STORAGE_KEY_TEXT, '');
  if (typeof saved === 'string' && saved !== '') {
    input.value = saved;
  }
  update();

  /* ---------- 清理函数（离开工具时由外壳调用） ---------- */

  return () => {
    update.cancel();
  };
}
