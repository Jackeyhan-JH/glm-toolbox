/**
 * Service Worker 注册与新版本提示。
 *
 * 本模块只被注入进构建产物（scripts/build.mjs 在 dist/index.html 里加
 * <script type="module" src="assets/js/sw-register.mjs">）；源目录的
 * index.html 不含该标签 —— npm run dev 下不会注册，避免开发时缓存干扰。
 *
 * 行为：
 *   - 注册当前 scope 下的 sw.js（预缓存全部站点文件，离线可用）；
 *   - 检测到等待接管的新版本时，页面底部出现「有新版本，点击刷新」；
 *   - 点击后向新 Worker 发送 SKIP_WAITING，controllerchange 时刷新页面。
 */

const UPDATE_TOAST_TEXT = '有新版本，点击刷新';

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const swUrl = new URL('sw.js', document.baseURI).href;
  let registration;
  try {
    registration = await navigator.serviceWorker.register(swUrl, { scope: './' });
  } catch (err) {
    // 注册失败不影响站点使用
    console.warn('Service Worker 注册失败：', err);
    return;
  }

  // 已有等待接管的新版本（如后台已更新完）→ 直接提示
  if (registration.waiting && navigator.serviceWorker.controller) {
    showUpdateToast(registration);
    return;
  }

  // 监听后续更新（浏览器在导航时检查 sw.js 字节差）
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdateToast(registration);
      }
    });
  });
}

let toast = null;

function showUpdateToast(registration) {
  if (toast) return; // 已在显示
  toast = document.createElement('button');
  toast.type = 'button';
  toast.className = 'btn btn-primary sw-update';
  toast.dataset.swUpdate = '';
  toast.textContent = UPDATE_TOAST_TEXT;
  toast.addEventListener('click', () => {
    const waiting = registration.waiting;
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      // 等待中的 Worker 已消失（被激活或注销）：直接刷新
      location.reload();
    }
  });
  document.body.appendChild(toast);

  // 新版本接管完成（点击刷新后）→ 重载页面加载新版本
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

let reloading = false;

registerServiceWorker();
