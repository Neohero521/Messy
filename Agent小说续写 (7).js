/**
 * ============================================================================
 * 小说续写 Agent · Tavern Helper 脚本（单文件版）
 * ----------------------------------------------------------------------------
 * 项目类型：后台脚本（Tavern Helper Script）
 * 运行形式：单文件 JS，通过 import 'CDN_URL' 导入酒馆助手脚本库
 *
 * 布局（完全重做）：
 *   ┌────────────────────────────────────────────────────┐
 *   │  顶部：Agent 状态栏（小说名 · 章节数 · 图谱进度）    │
 *   ├───────────┬────────────────────────────────────────┤
 *   │  左：章节 │  中：Tab 切换 [对话 / 阅读 / 图谱]     │
 *   │  列表     │                                        │
 *   │  (260px)  │  · 对话：Agent 消息流                  │
 *   │           │  · 阅读：沉浸式阅读器                  │
 *   │  [上传]   │  · 图谱：JSON 查看/编辑                │
 *   ├───────────┴────────────────────────────────────────┤
 *   │  底部：快捷指令 + 输入框                            │
 *   └────────────────────────────────────────────────────┘
 *
 * 已移除：书架系统、质量评估、撤销管理器、主题管理、会话管理
 * ============================================================================
 */
(function() {
  'use strict';

  // ---- SECTION 0 脚本元信息 ----
  const SCRIPT_NAME = '小说续写Agent';
  const SCRIPT_ID   = 'novel-agent';

  // ---- Toast 兜底 ----
  function showToast(msg, type) {
    try {
      var pWin = (typeof window !== 'undefined' && window.parent) ? window.parent : window;
      var t = (pWin && pWin.toastr) ? pWin.toastr : (typeof toastr !== 'undefined' ? toastr : null);
      if (t && typeof t[type] === 'function') { t[type](msg); return; }
    } catch(_) {}
    try { console.log('[小说续写Agent][' + (type || 'info') + '] ' + msg); } catch(_) {}
  }

  // ============ 持久化（纯 localStorage） ============
  const LOCAL_VARS_KEY = SCRIPT_ID + ':vars';
  function _getScriptVars() {
    try { var raw = localStorage.getItem(LOCAL_VARS_KEY); return raw ? JSON.parse(raw) : {}; }
    catch (_) { return {}; }
  }
  let _quotaWarnedAt = 0;
  function _setScriptVars(obj) {
    var incoming = (obj && typeof obj === 'object') ? obj : {};
    try {
      var raw = localStorage.getItem(LOCAL_VARS_KEY);
      var stored = raw ? JSON.parse(raw) : {};
      var next = Object.assign({}, stored, incoming);
      var payload = JSON.stringify(next);
      try {
        localStorage.setItem(LOCAL_VARS_KEY, payload);
        _quotaWarnedAt = 0;
      } catch (quotaErr) {
        var now = Date.now();
        if (now - _quotaWarnedAt > 30000) {
          _quotaWarnedAt = now;
          try { console.error('[小说续写Agent] localStorage 写入失败（约 ' + Math.round(payload.length / 1024) + 'KB）', quotaErr); } catch (_) {}
          try { if (typeof toastr !== 'undefined' && toastr && toastr.warning) toastr.warning('本地存储空间已满，请清理浏览器数据。', '小说续写Agent'); } catch (_) {}
        }
      }
    } catch (e) {
      try { console.warn('[小说续写Agent] 持久化异常:', e && e.message); } catch (_) {}
    }
    return true;
  }
  function _getScriptId() { return SCRIPT_ID; }

  // ============ iframe 渲染容器 ============
  let _novelIframe = null;
  let _novelIframeDoc = null;
  let _novelIframeWin = null;
  let _novelIframeJQ = null;

  // ===== mini-jQuery =====
  function _buildMiniJQ(win, doc) {
    function Q(sel) {
      let els = [];
      if (sel == null) els = [];
      else if (typeof sel === 'function') {
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', sel);
        else sel();
        return Q;
      } else if (typeof sel === 'string') {
        if (sel[0] === '<') { const t = doc.createElement('div'); t.innerHTML = sel; els = Array.from(t.children); }
        else els = Array.from(doc.querySelectorAll(sel));
      } else if (sel.nodeType === 1) els = [sel];
      else if (sel.nodeType === 9) els = [sel.documentElement];
      else if (sel.length !== undefined && typeof sel !== 'string') els = Array.from(sel).filter(Boolean);
      else if (sel.els) els = sel.els;
      els = els.filter(Boolean);
      const o = Object.create(Q.fn);
      o.els = els; o.length = els.length;
      els.forEach((e, i) => { o[i] = e; });
      return o;
    }
    Q.fn = {
      each(fn) { this.els.forEach((e, i) => fn.call(e, i, e)); return this; },
      on(evt, delegate, handler) {
        if (typeof delegate === 'function') { handler = delegate; delegate = null; }
        this.els.forEach(el => {
          el.addEventListener(evt, function (e) {
            if (delegate) {
              const t = e.target && e.target.closest ? e.target.closest(delegate) : null;
              if (t && el.contains(t)) {
                try { Object.defineProperty(e, 'currentTarget', { value: t, configurable: true, writable: true }); } catch (_) {}
                handler.call(t, e);
              }
            } else handler.call(el, e);
          });
        });
        return this;
      },
      off() { return this; },
      val(v) { if (v === undefined) return this.els[0] ? this.els[0].value : ''; this.els.forEach(e => e.value = v); return this; },
      text(v) { if (v === undefined) return this.els[0] ? this.els[0].textContent : ''; this.els.forEach(e => e.textContent = v); return this; },
      html(v) { if (v === undefined) return this.els[0] ? this.els[0].innerHTML : ''; this.els.forEach(e => e.innerHTML = v); return this; },
      prop(k, v) {
        const CAMEL = { readonly: 'readOnly', maxlength: 'maxLength', tabindex: 'tabIndex', colspan: 'colSpan', rowspan: 'rowSpan', contenteditable: 'contentEditable', spellcheck: 'spellCheck', crossorigin: 'crossOrigin' };
        const ck = CAMEL[k] || k;
        if (v === undefined) {
          const e0 = this.els[0];
          if (!e0) return undefined;
          return (ck in e0) ? e0[ck] : e0[k];
        }
        this.els.forEach(e => {
          try { e[ck] = v; } catch (_) {}
          if (ck !== k) { try { e[k] = v; } catch (_) {} }
          if (typeof v === 'boolean' && e.setAttribute) {
            if (v) e.setAttribute(k, k); else e.removeAttribute(k);
          }
        });
        return this;
      },
      attr(k, v) { if (v === undefined) return this.els[0] ? this.els[0].getAttribute(k) : null; this.els.forEach(e => e.setAttribute(k, v)); return this; },
      removeAttr(k) { this.els.forEach(e => e.removeAttribute(k)); return this; },
      addClass(c) { this.els.forEach(e => (c || '').split(/\s+/).filter(Boolean).forEach(cl => e.classList.add(cl))); return this; },
      removeClass(c) { this.els.forEach(e => (c || '').split(/\s+/).filter(Boolean).forEach(cl => e.classList.remove(cl))); return this; },
      toggleClass(c, force) { this.els.forEach(e => (c || '').split(/\s+/).filter(Boolean).forEach(cl => e.classList.toggle(cl, force))); return this; },
      hasClass(c) { return this.els.some(e => (c || '').split(/\s+/).filter(Boolean).every(cl => e.classList.contains(cl))); },
      css(k, v) {
        if (typeof k === 'object') { this.els.forEach(e => Object.assign(e.style, k)); return this; }
        if (v === undefined) return this.els[0] ? win.getComputedStyle(this.els[0])[k] : '';
        this.els.forEach(e => e.style[k] = v); return this;
      },
      find(sel) { return Q(this.els.flatMap(e => Array.from(e.querySelectorAll(sel)))); },
      closest(sel) { return Q(this.els[0] && this.els[0].closest ? this.els[0].closest(sel) : null); },
      parent() { return Q(this.els.map(e => e.parentElement).filter(Boolean)); },
      children() { return Q(this.els.flatMap(e => Array.from(e.children))); },
      append(c) { this.els.forEach(e => { if (typeof c === 'string') e.insertAdjacentHTML('beforeend', c); else if (c.nodeType === 1) e.appendChild(c); else if (c.els) c.els.forEach(x => e.appendChild(x)); }); return this; },
      prepend(c) { this.els.forEach(e => { if (typeof c === 'string') e.insertAdjacentHTML('afterbegin', c); else if (c.nodeType === 1) e.insertBefore(c, e.firstChild); }); return this; },
      before(c) { this.els.forEach(e => { if (typeof c === 'string') e.insertAdjacentHTML('beforebegin', c); }); return this; },
      after(c) { this.els.forEach(e => { if (typeof c === 'string') e.insertAdjacentHTML('afterend', c); }); return this; },
      remove() { this.els.forEach(e => e.remove()); return this; },
      empty() { this.els.forEach(e => e.innerHTML = ''); return this; },
      hide() { this.els.forEach(e => e.style.display = 'none'); return this; },
      show() { this.els.forEach(e => e.style.display = ''); return this; },
      trigger(evt) { this.els.forEach(e => e.dispatchEvent(new win.Event(evt, { bubbles: true }))); return this; },
      click(fn) { return fn ? this.on('click', fn) : (this.els.forEach(e => e.click()), this); },
      change(fn) { return fn ? this.on('change', fn) : (this.els.forEach(e => e.dispatchEvent(new win.Event('change', { bubbles: true }))), this); },
      focus() { this.els.forEach(e => e.focus && e.focus()); return this; },
      blur() { this.els.forEach(e => e.blur && e.blur()); return this; },
      is(sel) { return this.els.some(e => e.matches && e.matches(sel)); },
      data(k, v) {
        const key = String(k).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
        if (v === undefined) return this.els[0] ? this.els[0].dataset[key] : undefined;
        this.els.forEach(e => e.dataset[key] = v); return this;
      },
      scrollTop(v) { if (v === undefined) return this.els[0] ? this.els[0].scrollTop : 0; this.els.forEach(e => e.scrollTop = v); return this; },
      get(i) { return i === undefined ? this.els : this.els[i]; },
      map(fn) { return Q(this.els.map(fn).filter(Boolean)); },
      filter(fn) { return Q(this.els.filter(fn)); },
      first() { return Q(this.els[0]); },
      last() { return Q(this.els[this.els.length - 1]); }
    };
    Q.each = (arr, fn) => (arr || []).forEach((v, i) => fn.call(v, i, v));
    Q.extend = Object.assign;
    Q.trim = (s) => (s || '').trim();
    return Q;
  }

  function _buildMiniToast(win) {
    function show(msg, type, title) {
      try {
        const pw = win.parent;
        if (pw && pw.toastr && typeof pw.toastr[type] === 'function') { pw.toastr[type](msg, title); return; }
      } catch (_) {}
      try { console.log('[小说续写Agent][' + type + '] ' + msg); } catch (_) {}
    }
    return {
      success: (m, t) => show(m, 'success', t),
      error: (m, t) => show(m, 'error', t),
      warning: (m, t) => show(m, 'warning', t),
      info: (m, t) => show(m, 'info', t)
    };
  }

  function _createNovelIframe() {
    return new Promise(function (resolve, reject) {
      try {
        const parentDoc = _pDocParent();
        const old = parentDoc.getElementById(SCRIPT_ID + '-iframe');
        if (old) old.remove();

        const iframe = parentDoc.createElement('iframe');
        iframe.id = SCRIPT_ID + '-iframe';
        iframe.setAttribute('script_id', SCRIPT_ID);
        iframe.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;border:none;z-index:99999;background:transparent;visibility:hidden;';

        const escCss = UI_CSS.replace(/<\/(style|script)/gi, '<\\/$1');
        const escHtml = UI_HTML.replace(/<\/(style|script)/gi, '<\\/$1');
        iframe.srcdoc =
          '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">' +
          '<style>' + escCss + '</style></head><body>' + escHtml + '</body></html>';

        let resolved = false;
        iframe.addEventListener('load', function () {
          if (resolved) return; resolved = true;
          try {
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            const win = iframe.contentWindow;
            if (!win.jQuery) { win.$ = win.jQuery = _buildMiniJQ(win, doc); }
            if (!win.toastr) { win.toastr = _buildMiniToast(win); }
            _novelIframe = iframe;
            _novelIframeDoc = doc;
            _novelIframeWin = win;
            _novelIframeJQ = win.jQuery;
            iframe.style.visibility = 'hidden';
            try {
              const _panel = doc.getElementById('novel-agent-panel');
              if (_panel && win.MutationObserver) {
                const syncVis = function () {
                  const open = _panel.classList.contains('show');
                  iframe.style.visibility = open ? 'visible' : 'hidden';
                  const pBtn = parentDoc.getElementById(SCRIPT_ID + '-btn');
                  if (pBtn) pBtn.style.display = open ? 'none' : '';
                };
                const _obs = new win.MutationObserver(syncVis);
                _obs.observe(_panel, { attributes: true, attributeFilter: ['class'] });
              }
            } catch (_) {}
            resolve({ doc: doc, win: win, jq: win.jQuery });
          } catch (e) { reject(e); }
        });

        parentDoc.body.appendChild(iframe);
        setTimeout(function () { if (!resolved) { resolved = true; reject(new Error('iframe 加载超时')); } }, 5000);
      } catch (e) { reject(e); }
    });
  }

  function _destroyNovelIframe() {
    try {
      const iframe = _novelIframe;
      if (iframe) {
        try { iframe.src = 'about:blank'; } catch (_) {}
        try { iframe.remove(); } catch (_) {}
      }
    } catch (_) {}
    _novelIframe = _novelIframeDoc = _novelIframeWin = _novelIframeJQ = null;
  }

  // ===== 配置 =====
  const CONFIG = Object.freeze({
    AI_CALL_TIMEOUT_MS: 120000,
    MAX_RETRY_TIMES: 3,
    RETRY_DELAY_MS: 1200,
    BATCH_MERGE_DELAY_MS: 1500,
    MAX_API_CALLS_PER_MINUTE: 3,
    RATE_LIMIT_WINDOW_MS: 60000,
    SAVE_DEBOUNCE_MS: 250,
    FLOAT_BALL_BASE_SIZE: 64,
    FLOAT_BALL_MIN_SCALE: 50,
    FLOAT_BALL_MAX_SCALE: 200,
    GRAPH_CHAPTERS_PER_GRAPH: 1,
    MAX_CHAPTERS_PER_BATCH: 20,
  });

  const AI_CALL_TIMEOUT_MS = 120000;
  // B8：超时后显式丢弃迟到的结果（onLate 回调），避免遗留 promise 的副作用污染状态
  function withTimeout(promise, ms, label, onLate) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error((label || '操作') + ' 超时（' + Math.round(ms / 1000) + 's）。底层请求可能仍在后台运行，连续超时请检查 API 状态或调低限流窗口'));
        if (typeof onLate === 'function') {
          Promise.resolve(promise).then(
            function (v) { onLate(null, v); },
            function (e) { onLate(e, null); }
          );
        }
      }, ms);
      Promise.resolve(promise).then(
        function (v) { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
        function (e) { if (settled) return; settled = true; clearTimeout(timer); reject(e); }
      );
    });
  }

  const LOG_PREFIX = '[小说续写Agent]';
  function logInfo(scope, msg) {
    try { console.log(LOG_PREFIX + '[' + (scope || '?') + '] ' + (msg == null ? '' : String(msg))); } catch (_) {}
  }
  function logWarn(scope, err) {
    try { console.warn(LOG_PREFIX + '[' + (scope || '?') + ']', err && err.message ? err.message : err); } catch (_) {}
  }

  // 清理句柄
  const _cleanupHandlers = [];
  function addCleanup(fn) { if (typeof fn === 'function') _cleanupHandlers.push(fn); }
  function runCleanup() {
    while (_cleanupHandlers.length) {
      try { _cleanupHandlers.pop()(); } catch (_) {}
    }
  }

  // ===== 父页面访问 =====
  function _pDocParent() {
    try {
      return (typeof window !== 'undefined' && window.parent && window.parent.document)
        ? window.parent.document : document;
    } catch (_) { return document; }
  }
  function _pDoc() {
    if (_novelIframeDoc) return _novelIframeDoc;
    try {
      return (typeof window !== 'undefined' && window.parent && window.parent.document)
        ? window.parent.document : document;
    } catch(_) { return document; }
  }
  function _pWin() {
    try { return (typeof window !== 'undefined' && window.parent) ? window.parent : window; } catch(_) { return window; }
  }
  function _p$(selector) {
    try {
      var pWin = (typeof window !== 'undefined' && window.parent) ? window.parent : window;
      if (pWin && typeof pWin.$ === 'function') return pWin.$(selector);
    } catch(_) {}
    return null;
  }
  var getDoc = _pDoc;
  function setDoc(d) { try { if (d && typeof d === 'object') {} } catch(_) {} }

  var $ = function () {
    if (_novelIframeJQ) return _novelIframeJQ.apply(null, arguments);
    try {
      var pw = (typeof window !== 'undefined' && window.parent) ? window.parent : window;
      if (pw && pw.$ && pw.$.fn && pw.$.fn.jquery) return pw.$.apply(null, arguments);
    } catch (_) {}
    return _p$.apply(null, arguments);
  };
  var jQuery = $;

  var __parentToastr = (function () {
    try {
      var pw = (typeof window !== 'undefined' && window.parent) ? window.parent : window;
      return (pw && pw.toastr) ? pw.toastr : null;
    } catch (_) { return null; }
  })();
  var toastr = new Proxy({}, {
    get: function (_t, type) {
      if (_novelIframeWin && _novelIframeWin.toastr && typeof _novelIframeWin.toastr[type] === 'function') {
        return _novelIframeWin.toastr[type];
      }
      if (__parentToastr && typeof __parentToastr[type] === 'function') {
        return __parentToastr[type];
      }
      return function (msg) { try { console.log('[小说续写Agent][' + type + '] ' + msg); } catch (_) {} };
    }
  });

  var getVariables     = _getScriptVars;
  var replaceVariables = _setScriptVars;
  var getScriptId      = _getScriptId;

  // ============================================================
  // ▌内联 CSS —— Agent 布局（全新设计）
  // ============================================================
  const UI_CSS = `
/* ==================== 基础 & 变量 ==================== */
.agent-root {
  --ag-bg: #0f1116;
  --ag-bg-2: #171a22;
  --ag-bg-3: #1d2029;
  --ag-surface: #232732;
  --ag-surface-2: #2b3040;
  --ag-border: #2e3342;
  --ag-border-light: #3a4055;
  --ag-text: #e6e8ef;
  --ag-text-2: #a8aec2;
  --ag-text-3: #6c7285;
  --ag-accent: #6c8cff;
  --ag-accent-h: #8399ff;
  --ag-accent-dim: rgba(108, 140, 255, 0.15);
  --ag-success: #4ec9a3;
  --ag-warn: #e0b05e;
  --ag-danger: #e37383;
  --ag-radius: 10px;
  --ag-radius-sm: 6px;
  --ag-radius-lg: 14px;
  --ag-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  --ag-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --ag-mono: "SF Mono", Menlo, Consolas, "Roboto Mono", monospace;

  position: fixed;
  top: 0; left: 0;
  width: 100vw; height: 100vh; height: 100dvh;
  background: var(--ag-bg);
  color: var(--ag-text);
  font-family: var(--ag-font);
  font-size: 14px;
  line-height: 1.5;
  display: none;
  flex-direction: column;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}
.agent-root.show { display: flex; }
.agent-root *, .agent-root *::before, .agent-root *::after { box-sizing: border-box; }

.agent-root ::-webkit-scrollbar { width: 8px; height: 8px; }
.agent-root ::-webkit-scrollbar-track { background: transparent; }
.agent-root ::-webkit-scrollbar-thumb { background: #353a4a; border-radius: 4px; }
.agent-root ::-webkit-scrollbar-thumb:hover { background: #454c62; }

/* ==================== 顶部状态栏 ==================== */
.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--ag-bg-2);
  border-bottom: 1px solid var(--ag-border);
  flex-shrink: 0;
  gap: 16px;
  min-height: 60px;
}
.agent-title { display: flex; align-items: center; gap: 12px; min-width: 0; }
.agent-logo {
  width: 36px; height: 36px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--ag-accent) 0%, #9b7cff 100%);
  border-radius: var(--ag-radius-sm);
  color: #fff;
}
.agent-logo svg { width: 20px; height: 20px; }
.agent-title-text { min-width: 0; }
.agent-title-text h1 {
  font-size: 15px; font-weight: 600; color: var(--ag-text);
  margin: 0; letter-spacing: 0.2px;
}
.agent-meta {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--ag-text-3);
  margin-top: 2px;
}
.agent-meta .dot { opacity: 0.4; }
.agent-meta .current-name { color: var(--ag-text-2); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.agent-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; position: relative; /* 更多菜单定位参照 */ }
.agent-icon-btn {
  width: 34px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius-sm);
  color: var(--ag-text-2);
  cursor: pointer;
  transition: all .15s ease;
}
.agent-icon-btn:hover { background: var(--ag-surface); color: var(--ag-text); border-color: var(--ag-border-light); }
.agent-icon-btn svg { width: 16px; height: 16px; }

/* ==================== 主体 ==================== */
.agent-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  position: relative; /* 移动端抽屉定位参照 */
}

/* ==================== 左侧章节栏 ==================== */
.agent-sidebar {
  width: 260px;
  flex-shrink: 0;
  background: var(--ag-bg-2);
  border-right: 1px solid var(--ag-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  transition: width .2s ease;
}
.agent-sidebar.collapsed { width: 0; border-right: none; overflow: hidden; }

.sidebar-header {
  padding: 14px 16px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.sidebar-header .label {
  font-size: 11px; font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--ag-text-3);
}
.sidebar-header .count {
  font-size: 11px; color: var(--ag-text-3);
  background: var(--ag-bg-3);
  padding: 2px 8px; border-radius: 10px;
}

.sidebar-toolbar {
  padding: 0 12px 10px;
  display: flex; flex-direction: column; gap: 8px;
  flex-shrink: 0;
}
.sidebar-input {
  width: 100%;
  background: var(--ag-bg-3);
  border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius-sm);
  color: var(--ag-text);
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--ag-mono);
  outline: none;
  transition: border-color .15s;
}
.sidebar-input:focus { border-color: var(--ag-accent); }
.sidebar-input::placeholder { color: var(--ag-text-3); }

.sidebar-btn {
  width: 100%;
  padding: 9px 12px;
  background: var(--ag-accent);
  border: none;
  border-radius: var(--ag-radius-sm);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  transition: background .15s;
}
.sidebar-btn:hover { background: var(--ag-accent-h); }
.sidebar-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sidebar-btn svg { width: 14px; height: 14px; }

.sidebar-btn.secondary {
  background: var(--ag-surface);
  color: var(--ag-text-2);
  border: 1px solid var(--ag-border);
}
.sidebar-btn.secondary:hover { background: var(--ag-surface-2); color: var(--ag-text); }

/* 章节列表 */
.chapter-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 8px;
  min-height: 0;
}
.chapter-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--ag-text-3);
  font-size: 13px;
}
.chapter-empty svg { width: 40px; height: 40px; opacity: 0.3; margin-bottom: 12px; }

.chapter-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--ag-radius-sm);
  cursor: pointer;
  transition: background .12s;
  margin-bottom: 2px;
  position: relative;
}
.chapter-item:hover { background: var(--ag-bg-3); }
.chapter-item.active {
  background: var(--ag-accent-dim);
  box-shadow: inset 2px 0 0 var(--ag-accent);
}
.chapter-item .checkbox {
  width: 16px; height: 16px;
  border: 1.5px solid var(--ag-border-light);
  border-radius: 4px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: all .12s;
}
.chapter-item.selected .checkbox {
  background: var(--ag-accent);
  border-color: var(--ag-accent);
}
.chapter-item.selected .checkbox::after {
  content: '';
  width: 4px; height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) translate(-1px, -1px);
}
.chapter-item .ch-title {
  flex: 1;
  font-size: 13px;
  color: var(--ag-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chapter-item.active .ch-title { color: var(--ag-text); }
.chapter-item .ch-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--ag-bg-3);
  color: var(--ag-text-3);
  flex-shrink: 0;
}
.chapter-item .ch-badge.has-graph {
  background: rgba(78, 201, 163, 0.15);
  color: var(--ag-success);
}
.chapter-item .ch-badge.continue-chapter {
  background: rgba(155, 124, 255, 0.15);
  color: #b39cff;
}
.chapter-item.continue-item .ch-title { font-style: italic; opacity: 0.9; }

.sidebar-footer {
  padding: 8px 12px 12px;
  border-top: 1px solid var(--ag-border);
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.sidebar-footer button {
  flex: 1;
  padding: 7px 4px;
  background: transparent;
  border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius-sm);
  color: var(--ag-text-3);
  font-size: 11px;
  cursor: pointer;
  transition: all .12s;
}
.sidebar-footer button:hover { color: var(--ag-text); border-color: var(--ag-border-light); background: var(--ag-bg-3); }

/* ==================== 中央主区 ==================== */
.agent-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--ag-bg);
}

/* Tab 切换 */
.agent-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 16px 0;
  background: var(--ag-bg);
  border-bottom: 1px solid var(--ag-border);
  flex-shrink: 0;
}
.agent-tab {
  padding: 10px 18px;
  background: transparent;
  border: none;
  color: var(--ag-text-3);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: color .15s;
  font-family: inherit;
}
.agent-tab:hover { color: var(--ag-text-2); }
.agent-tab.active { color: var(--ag-accent); border-bottom-color: var(--ag-accent); }
.agent-tab svg { width: 14px; height: 14px; }

/* ==================== 移动端当前视图指示（桌面隐藏，移动端媒体查询内开启） ==================== */
.agent-tab-indicator { display: none; }

/* 面板 */
.agent-panel {
  flex: 1;
  display: none;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.agent-panel.active { display: flex; }

/* ==================== 对话流 ==================== */
.chat-flow {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scroll-behavior: smooth;
}

.chat-msg {
  display: flex;
  gap: 12px;
  max-width: 90%;
  animation: msgIn .25s ease;
}
@keyframes msgIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.chat-msg.user { flex-direction: row-reverse; align-self: flex-end; }
.chat-msg.agent { align-self: flex-start; }

.chat-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px;
  font-weight: 600;
}
.chat-msg.agent .chat-avatar {
  background: linear-gradient(135deg, var(--ag-accent) 0%, #9b7cff 100%);
  color: #fff;
}
.chat-msg.user .chat-avatar {
  background: var(--ag-surface);
  color: var(--ag-text-2);
  border: 1px solid var(--ag-border);
}

.chat-bubble {
  padding: 10px 14px;
  border-radius: var(--ag-radius);
  font-size: 13.5px;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
}
.chat-msg.agent .chat-bubble {
  background: var(--ag-bg-2);
  border: 1px solid var(--ag-border);
  color: var(--ag-text);
  border-top-left-radius: 4px;
}
.chat-msg.user .chat-bubble {
  background: var(--ag-accent);
  color: #fff;
  border-top-right-radius: 4px;
}
.chat-msg.system .chat-bubble {
  background: var(--ag-bg-2);
  border: 1px dashed var(--ag-border-light);
  color: var(--ag-text-2);
  font-size: 12.5px;
  text-align: center;
  width: 100%;
  max-width: 100%;
}
.chat-msg.system { align-self: center; max-width: 80%; }

.chat-bubble code {
  background: rgba(0,0,0,0.3);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--ag-mono);
  font-size: 12px;
}
.chat-bubble .bubble-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--ag-text);
}
.chat-bubble .bubble-meta {
  font-size: 11px;
  color: var(--ag-text-3);
  margin-top: 6px;
}

/* 进度条 */
.bubble-progress {
  margin-top: 8px;
  height: 4px;
  background: var(--ag-bg-3);
  border-radius: 2px;
  overflow: hidden;
}
.bubble-progress .fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ag-accent), #9b7cff);
  width: 0%;
  transition: width .3s;
}

/* Agent 打字指示 */
.typing-indicator {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 4px 0;
}
.typing-indicator span {
  width: 6px; height: 6px;
  background: var(--ag-text-3);
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out;
}
.typing-indicator span:nth-child(2) { animation-delay: .2s; }
.typing-indicator span:nth-child(3) { animation-delay: .4s; }
@keyframes typing {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-4px); }
}

/* ==================== 阅读模式 ==================== */
.reader-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--ag-bg-2);
  border-bottom: 1px solid var(--ag-border);
  flex-shrink: 0;
  gap: 12px;
}
.reader-toolbar .chapter-title {
  flex: 1;
  text-align: center;
  font-size: 14px;
  font-weight: 500;
  color: var(--ag-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reader-nav-btn {
  padding: 6px 14px;
  background: var(--ag-surface);
  border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius-sm);
  color: var(--ag-text-2);
  font-size: 12px;
  cursor: pointer;
  transition: all .12s;
  font-family: inherit;
}
.reader-nav-btn:hover:not(:disabled) { background: var(--ag-surface-2); color: var(--ag-text); }
.reader-nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.reader-content {
  flex: 1;
  overflow-y: auto;
  padding: 40px max(40px, calc((100% - 720px) / 2));
  font-size: 16px;
  line-height: 2;
  color: var(--ag-text);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--ag-bg);
  scroll-behavior: smooth;
}
.reader-content .empty-hint {
  text-align: center;
  color: var(--ag-text-3);
  padding: 80px 20px;
  font-size: 14px;
}

.reader-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  background: var(--ag-bg-2);
  border-top: 1px solid var(--ag-border);
  flex-shrink: 0;
}
.reader-progress-bar {
  flex: 1;
  height: 4px;
  background: var(--ag-bg-3);
  border-radius: 2px;
  overflow: hidden;
}
.reader-progress-fill {
  height: 100%;
  background: var(--ag-accent);
  width: 0%;
  transition: width .2s;
}
.reader-progress-text {
  font-size: 11px;
  color: var(--ag-text-3);
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
}
.font-controls { display: flex; gap: 4px; }
.font-controls button {
  width: 26px; height: 26px;
  background: transparent;
  border: 1px solid var(--ag-border);
  border-radius: 4px;
  color: var(--ag-text-2);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.font-controls button:hover { background: var(--ag-surface); color: var(--ag-text); }

/* ==================== 图谱模式 ==================== */
.graph-panel-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--ag-bg-2);
  border-bottom: 1px solid var(--ag-border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.graph-panel-toolbar .spacer { flex: 1; }
.graph-panel-toolbar .graph-size {
  font-size: 11px;
  color: var(--ag-text-3);
  font-variant-numeric: tabular-nums;
}

.graph-editor-wrap {
  flex: 1;
  padding: 16px 20px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.graph-editor {
  flex: 1;
  width: 100%;
  background: var(--ag-bg-2);
  border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius);
  color: var(--ag-text);
  padding: 16px;
  font-family: var(--ag-mono);
  font-size: 12.5px;
  line-height: 1.6;
  resize: none;
  outline: none;
  min-height: 0;
}
.graph-editor:focus { border-color: var(--ag-accent); }

.graph-validate-result {
  padding: 10px 14px;
  background: var(--ag-bg-2);
  border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius-sm);
  font-size: 12.5px;
  color: var(--ag-text-2);
  white-space: pre-wrap;
}
.graph-validate-result.pass { border-color: rgba(78, 201, 163, 0.4); background: rgba(78, 201, 163, 0.08); color: var(--ag-success); }
.graph-validate-result.fail { border-color: rgba(227, 115, 131, 0.4); background: rgba(227, 115, 131, 0.08); color: var(--ag-danger); }

/* ==================== 底部指令栏 ==================== */
.agent-input-bar {
  flex-shrink: 0;
  background: var(--ag-bg-2);
  border-top: 1px solid var(--ag-border);
  padding: 12px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.quick-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.quick-btn {
  padding: 6px 12px;
  background: var(--ag-surface);
  border: 1px solid var(--ag-border);
  border-radius: 20px;
  color: var(--ag-text-2);
  font-size: 12px;
  cursor: pointer;
  transition: all .15s;
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: inherit;
}
.quick-btn:hover { background: var(--ag-surface-2); color: var(--ag-text); border-color: var(--ag-border-light); }
.quick-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.quick-btn.danger { color: var(--ag-danger); border-color: rgba(227, 115, 131, 0.3); }
.quick-btn.danger:hover { background: rgba(227, 115, 131, 0.1); }

.input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--ag-bg-3);
  border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius);
  padding: 4px 4px 4px 16px;
  transition: border-color .15s;
}
.input-row:focus-within { border-color: var(--ag-accent); }
.agent-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--ag-text);
  font-size: 14px;
  font-family: inherit;
  padding: 8px 0;
}
.agent-input::placeholder { color: var(--ag-text-3); }
.agent-send-btn {
  padding: 8px 18px;
  background: var(--ag-accent);
  border: none;
  border-radius: var(--ag-radius-sm);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background .15s;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
}
.agent-send-btn:hover:not(:disabled) { background: var(--ag-accent-h); }
.agent-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ==================== 通用按钮（图谱栏/侧栏） ==================== */
.btn {
  padding: 7px 14px;
  background: var(--ag-surface);
  border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius-sm);
  color: var(--ag-text-2);
  font-size: 12.5px;
  cursor: pointer;
  transition: all .15s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
}
.btn:hover:not(:disabled) { background: var(--ag-surface-2); color: var(--ag-text); border-color: var(--ag-border-light); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.primary { background: var(--ag-accent); color: #fff; border-color: var(--ag-accent); }
.btn.primary:hover:not(:disabled) { background: var(--ag-accent-h); border-color: var(--ag-accent-h); }
.btn.danger { color: var(--ag-danger); border-color: rgba(227, 115, 131, 0.3); }
.btn.danger:hover:not(:disabled) { background: rgba(227, 115, 131, 0.1); }
.btn svg { width: 13px; height: 13px; }

/* ==================== 模态框 ==================== */
.modal-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal-content {
  background: var(--ag-bg-2);
  border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius-lg);
  box-shadow: var(--ag-shadow);
  width: 90%;
  max-width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--ag-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-header h3 { margin: 0; font-size: 15px; font-weight: 600; }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--ag-border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.modal-close {
  background: transparent;
  border: none;
  color: var(--ag-text-3);
  cursor: pointer;
  font-size: 18px;
  padding: 4px 8px;
  border-radius: 4px;
}
.modal-close:hover { background: var(--ag-surface); color: var(--ag-text); }

/* ==================== 空状态 ==================== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--ag-text-3);
  text-align: center;
  height: 100%;
}
.empty-state svg { width: 48px; height: 48px; opacity: 0.3; margin-bottom: 16px; }
.empty-state .title { font-size: 15px; color: var(--ag-text-2); margin-bottom: 6px; }
.empty-state .hint { font-size: 13px; color: var(--ag-text-3); max-width: 320px; line-height: 1.6; }

/* ==================== 加载指示器 ==================== */
.loading-spinner {
  display: inline-block;
  width: 12px; height: 12px;
  border: 2px solid rgba(255,255,255,0.2);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ==================== 响应式（移动端迭代） ==================== */
/* ---------- 基础规则（桌面区块）：更多菜单 / 抽屉遮罩默认隐藏 ---------- */
#agent-more-btn { display: none; }
.agent-more-menu { display: none; }   /* 用类选择器，保证 .open 能覆盖 */

.agent-more-menu {
  position: absolute; top: calc(100% + 8px); right: 0;
  min-width: 190px; padding: 6px; z-index: 200;
  background: var(--ag-bg-2); border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius); box-shadow: var(--ag-shadow);
}
.agent-more-menu.open { display: block; }
.agent-more-menu button {
  display: flex; align-items: center; gap: 10px;
  width: 100%; min-height: 44px; padding: 0 12px;
  background: transparent; border: none; border-radius: var(--ag-radius-sm);
  color: var(--ag-text-2); font-size: 14px; font-family: inherit;
  text-align: left; cursor: pointer;
}
.agent-more-menu button:hover,
.agent-more-menu button:active { background: var(--ag-surface); color: var(--ag-text); }
.agent-more-menu button.danger { color: var(--ag-danger); }

.agent-drawer-backdrop {   /* 类选择器，保证移动端 display:block 能覆盖 */
  position: absolute; inset: 0; z-index: 55;
  background: rgba(0, 0, 0, .5);
  opacity: 0; pointer-events: none; display: none;
  transition: opacity .24s ease;
}

/* ---------- 触屏通用（所有尺寸生效，消除 hover 粘滞） ---------- */
@media (hover: none) and (pointer: coarse) {
  .agent-root button,
  .agent-root .chapter-item,
  .agent-root .agent-icon-btn,
  .agent-root .quick-btn { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }

  .agent-icon-btn:hover,
  .sidebar-btn:hover,
  .quick-btn:hover,
  .btn:hover,
  .card-btn:hover,
  .chapter-item:hover,
  .reader-nav-btn:hover,
  .agent-more-menu button:hover,
  .agent-tab:hover { background: initial; color: initial; border-color: initial; }

  .agent-icon-btn:active,
  .sidebar-btn:active,
  .quick-btn:active,
  .btn:active,
  .card-btn:active,
  .agent-more-menu button:active { background: var(--ag-surface-2); color: var(--ag-text); }
  .chapter-item:active { background: var(--ag-bg-3); }

  .sidebar-resizer { display: none; }  /* 触屏不做拖拽调宽 */
  .chapter-item { -webkit-touch-callout: none; }  /* 长按呼出菜单，屏蔽 iOS 文本选择气泡 */
}

/* ==================== 移动端 ==================== */
@media (max-width: 720px) {
  .agent-root {
    --ag-touch: 44px;
    --ag-drawer-w: min(86vw, 340px);
    font-size: 15px;
  }

  /* ---------- 顶栏：只留 侧栏 / 标题 / 更多 / 关闭 ---------- */
  .agent-header {
    padding: 8px 10px;
    padding-top: calc(8px + env(safe-area-inset-top, 0px));
    min-height: 56px; gap: 8px;
  }
  .agent-logo { width: 30px; height: 30px; }
  .agent-logo svg { width: 17px; height: 17px; }
  .agent-title-text h1 { font-size: 14px; }
  .agent-meta { font-size: 11px; margin-top: 1px; }
  .agent-meta .current-name { max-width: 92px; }

  .agent-header-actions { gap: 6px; }
  .agent-icon-btn { width: var(--ag-touch); height: var(--ag-touch); border-radius: 8px; }
  .agent-icon-btn svg { width: 18px; height: 18px; }

  #agent-status-toggle,
  #agent-theme-btn,
  #agent-settings-btn,
  #agent-clear-btn { display: none; }
  #agent-more-btn { display: flex; }

  /* ---------- 抽屉通用 ---------- */
  .agent-drawer-backdrop { display: block; }
  .agent-drawer-backdrop.show { opacity: 1; pointer-events: auto; }

  .agent-sidebar,
  .agent-status {
    position: absolute; top: 0; bottom: 0; z-index: 60;
    width: var(--ag-drawer-w);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    transition: transform .26s cubic-bezier(.32, .72, 0, 1);
    box-shadow: 0 0 40px rgba(0, 0, 0, .5);
    will-change: transform;
  }
  /* 展开态 */
  .agent-sidebar:not(.collapsed) { transform: translateX(0); }
  .agent-status:not(.collapsed) { transform: translateX(0); }
  /* 收起态：保留宽度，用位移隐藏，避免 reflow */
  .agent-sidebar.collapsed {
    width: var(--ag-drawer-w);
    border-right: 1px solid var(--ag-border);
    overflow: visible;
    transform: translateX(-104%);
    box-shadow: none;
  }
  .agent-status.collapsed {
    width: var(--ag-drawer-w);
    border-left: 1px solid var(--ag-border);
    overflow: visible;
    transform: translateX(104%);
    box-shadow: none;
  }
  .agent-sidebar { left: 0; }
  .agent-status { right: 0; }

  /* ---------- 侧栏内部 ---------- */
  .sidebar-header { padding: 14px 14px 8px; }
  .sidebar-toolbar { padding: 0 12px 8px; gap: 8px; }
  .sidebar-input { font-size: 16px; padding: 11px 12px; }  /* 16px 防 iOS 缩放 */
  .sidebar-btn { min-height: var(--ag-touch); font-size: 14px; border-radius: 8px; }
  .chapter-item { min-height: 52px; padding: 12px 10px; border-radius: 8px; }
  .chapter-item .checkbox { width: 20px; height: 20px; }
  .chapter-item .ch-title { font-size: 14px; }
  .sidebar-footer { padding: 8px 12px calc(10px + env(safe-area-inset-bottom, 0px)); gap: 8px; }
  .sidebar-footer button { min-height: 40px; font-size: 12px; border-radius: 8px; }

  /* ---------- 中央主区：移动端隐藏 Tab 栏，内容铺满中间区域 ---------- */
  /* 说明：对话/阅读/图谱的切换改为左右滑动手势，视觉上只保留内容本身，
     让面板真正占满顶栏与底栏之间的全部空间，不再被 Tab 栏压缩 */
  .agent-tabs { display: none !important; }
  .agent-main {
    width: 100%;
    flex: 1 1 100%;
  }
  .agent-panel {
    flex: 1 1 auto;
    min-height: 0;
  }
  .agent-panel.active {
    display: flex;
    flex: 1 1 auto;
  }

  /* 移动端当前视图指示（挂在标题上） */
  .agent-tab-indicator {
    display: inline;
    color: var(--ag-text-3);
    font-weight: 400;
    font-size: 12px;
    margin-left: 4px;
    letter-spacing: 0;
  }

  /* ---------- 对话流 ---------- */
  .chat-flow { padding: 12px 12px 16px; gap: 12px; }
  .chat-msg { max-width: 100%; gap: 8px; }
  .chat-avatar { width: 28px; height: 28px; font-size: 12px; }
  .chat-bubble { padding: 10px 13px; font-size: 14.5px; line-height: 1.68; border-radius: 12px; }
  .chat-bubble code { font-size: 12.5px; }
  .card-actions { gap: 8px; }
  .card-btn { min-height: 38px; padding: 9px 14px; font-size: 13px; border-radius: 8px; }
  .confirm-btns { gap: 10px; }
  .confirm-btns .card-btn { flex: 1; justify-content: center; }

  /* ---------- 底部指令栏 ---------- */
  .agent-input-bar {
    padding: 8px 12px;
    padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    gap: 8px;
  }
  .quick-actions {
    overflow-x: auto; flex-wrap: nowrap;
    padding: 2px 0 6px; gap: 8px;
    scrollbar-width: none; -webkit-overflow-scrolling: touch;
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%);
    -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%);
  }
  .quick-actions::-webkit-scrollbar { display: none; }
  .quick-btn { flex-shrink: 0; min-height: 38px; padding: 9px 15px; font-size: 13px; }

  .input-row { padding: 4px 4px 4px 14px; border-radius: 12px; }
  .agent-input { font-size: 16px; padding: 11px 0; }   /* 关键：16px 防 iOS 缩放 */
  .agent-send-btn { min-height: 42px; padding: 10px 16px; border-radius: 9px; font-size: 14px; }

  /* ---------- 阅读器 ---------- */
  .reader-toolbar { padding: 8px 10px; gap: 8px; }
  .reader-nav-btn { min-height: 40px; padding: 8px 12px; font-size: 12.5px; border-radius: 8px; }
  .reader-toolbar .chapter-title { font-size: 13px; }
  .reader-content { padding: 20px 16px; font-size: 16.5px; line-height: 2; }
  .reader-footer {
    padding: 8px 12px;
    padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    gap: 10px;
  }
  .font-controls { gap: 6px; }
  .font-controls button { width: 38px; height: 38px; font-size: 14px; border-radius: 8px; }
  #reader-summary-btn, #reader-characters-btn { min-height: 38px; padding: 0 12px; font-size: 13px; }
  .reader-progress-bar { height: 6px; }

  /* ---------- 图谱面板 ---------- */
  .graph-panel-toolbar {
    padding: 8px 12px; gap: 6px;
    flex-wrap: nowrap; overflow-x: auto;
    scrollbar-width: none; -webkit-overflow-scrolling: touch;
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%);
    -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%);
  }
  .graph-panel-toolbar::-webkit-scrollbar { display: none; }
  .graph-panel-toolbar .spacer { display: none; }
  .graph-panel-toolbar .btn { flex-shrink: 0; min-height: 38px; padding: 8px 14px; }
  .graph-panel-toolbar .graph-size { flex-shrink: 0; margin-left: auto; padding-left: 8px; }
  .graph-editor-wrap { padding: 10px 12px; gap: 10px; }
  .graph-editor { font-size: 14px; line-height: 1.65; padding: 12px; border-radius: 10px; }
  .graph-validate-result { font-size: 12.5px; padding: 10px 12px; }

  /* ---------- 状态面板 ---------- */
  .status-section { padding: 4px 14px 10px; }
  .status-section summary { min-height: 40px; display: flex; align-items: center; }
  .cov-chip {
    min-width: 30px; min-height: 30px; font-size: 11px;
    display: inline-flex; align-items: center; justify-content: center;
  }

  /* ---------- 模态 / 命令面板 ---------- */
  .modal, .modal-content {
    width: calc(100% - 20px); max-width: none;
    max-height: 86vh; border-radius: var(--ag-radius);
  }
  .modal-body { padding: 12px 14px; }
  .setting-row { min-height: 46px; gap: 10px; }
  .setting-row input[type="checkbox"] { width: 22px; height: 22px; }
  .setting-row input[type="number"],
  .setting-row select { font-size: 16px; min-height: 38px; width: 104px; }
  .modal-footer {
    padding: 10px 14px;
    padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    gap: 10px;
  }
  .modal-footer .btn { flex: 1; min-height: var(--ag-touch); justify-content: center; font-size: 14px; }

  /* B15：自绘确认模态框（小尺寸 + 主按钮强调） */
  .modal-sm { max-width: 360px; }
  .modal-footer .btn.primary { background: var(--ag-accent); color: #fff; border-color: var(--ag-accent); }
  .modal-footer .btn.primary:active { background: var(--ag-accent-h); }
  #agent-confirm-text { font-size: 14px; color: var(--ag-text-2); line-height: 1.7; white-space: pre-wrap; word-break: break-word; }

  .command-palette {
    padding: calc(8vh + env(safe-area-inset-top, 0px)) 10px 0;
    align-items: flex-start;
  }
  .palette-box { width: 100%; padding: 10px; border-radius: 12px; }
  .palette-input { font-size: 16px; padding: 12px; }
  .palette-hints {
    flex-wrap: nowrap; overflow-x: auto; gap: 6px;
    scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .palette-hints::-webkit-scrollbar { display: none; }
  .palette-hints span { flex-shrink: 0; }

  /* ---------- 章节右键菜单（长按呼出）---------- */
  .chapter-context-menu { min-width: 190px; padding: 6px; border-radius: 10px; }
  .chapter-context-menu .ctx-item { min-height: 46px; padding: 12px 14px; font-size: 14px; }
}

/* ---------- 键盘弹起时压缩快捷栏（由 JS 加 .kb-open，仅移动端）---------- */
.agent-root.kb-open .quick-actions { display: none; }
.agent-root.kb-open .agent-input-bar { padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px)); }

/* ==================== Agent 状态面板（右侧） ==================== */
.agent-status {
  width: 280px;
  flex-shrink: 0;
  background: var(--ag-bg-2);
  border-left: 1px solid var(--ag-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  transition: width .2s ease;
}
.agent-status.collapsed { width: 0; border-left: none; overflow: hidden; }
.status-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 8px; flex-shrink: 0;
}
.status-header .label {
  font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .8px; color: var(--ag-text-3);
}
.status-hint { font-size: 10px; color: var(--ag-text-3); }
.status-section { padding: 4px 16px 12px; }
.status-section-title {
  font-size: 11px; font-weight: 600; color: var(--ag-text-3);
  margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
}
.status-empty { font-size: 12px; color: var(--ag-text-3); padding: 4px 0; }
.plan-item {
  font-size: 12px; color: var(--ag-text-2); padding: 3px 0;
  display: flex; gap: 6px; align-items: center;
}
.plan-item.done { color: var(--ag-success); }
.plan-item.error { color: var(--ag-danger); }
.plan-item.running { color: var(--ag-warn); }
.log-item {
  font-size: 12px; color: var(--ag-text-2); padding: 2px 0;
  display: flex; gap: 6px; align-items: center; font-family: var(--ag-mono);
}
.log-item.log-err { color: var(--ag-danger); }
.log-ms { color: var(--ag-text-3); font-size: 11px; }
.mem-item {
  font-size: 12px; color: var(--ag-text-2); padding: 3px 0;
  border-left: 2px solid var(--ag-border); padding-left: 8px; margin-bottom: 4px;
}
.mem-item.mem-fact { border-left-color: var(--ag-warn); color: var(--ag-text); }
.cov-bar { height: 6px; border-radius: 3px; background: var(--ag-bg-3); overflow: hidden; }
.cov-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ag-success), var(--ag-accent));
  transition: width .3s;
}
.cov-text { font-size: 11px; color: var(--ag-text-3); margin-top: 6px; }

/* ==================== 思考 / 工具调用块 ==================== */
.bubble-thought { background: var(--ag-bg-3) !important; border-left: 3px solid var(--ag-accent); }
.thought-head, .tool-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; cursor: pointer; user-select: none;
  color: var(--ag-text-2); padding: 2px 0;
}
.thought-step { color: var(--ag-text-3); font-size: 11px; }
.thought-toggle, .tool-toggle { margin-left: auto; color: var(--ag-text-3); font-size: 11px; }
.thought-body {
  display: none; font-size: 13px; color: var(--ag-text-2);
  padding-top: 6px; white-space: pre-wrap;
}
.thought-body.open { display: block; }
.bubble-tool { background: var(--ag-bg-3) !important; border-left: 3px solid var(--ag-success); }
.bubble-tool-err { border-left-color: var(--ag-danger); }
.tool-name { font-family: var(--ag-mono); color: var(--ag-accent); font-weight: 600; font-size: 12px; }
.tool-status { color: var(--ag-text-3); font-size: 11px; }
.tool-body { display: none; padding-top: 6px; font-size: 12px; color: var(--ag-text-2); }
.tool-body.open { display: block; }
.tool-args { margin-bottom: 6px; color: var(--ag-text-3); }
.tool-args code {
  font-family: var(--ag-mono); font-size: 11px; color: var(--ag-text-2);
  background: var(--ag-surface); padding: 2px 6px; border-radius: 4px; word-break: break-all;
}
.tool-result {
  white-space: pre-wrap; font-size: 12px; color: var(--ag-text-2);
  max-height: 160px; overflow: auto; background: var(--ag-surface);
  border-radius: var(--ag-radius-sm); padding: 8px;
}

/* ==================== 5.0 流式回显卡片 ==================== */
.bubble-stream { background: var(--ag-bg-3) !important; border-left: 3px solid var(--ag-success); }
.stream-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--ag-text-2); padding-bottom: 6px;
}
.stream-title { font-weight: 600; color: var(--ag-text); }
.stream-state { margin-left: auto; font-size: 11px; color: var(--ag-warn); }
.stream-state.done { color: var(--ag-success); }
.stream-state.fail { color: var(--ag-danger); }
.stream-body {
  white-space: pre-wrap; font-size: 13.5px; line-height: 1.85;
  color: var(--ag-text-2); max-height: 320px; overflow: auto;
  background: var(--ag-surface); border-radius: var(--ag-radius-sm); padding: 8px 10px;
}
.stream-body.stream-done { color: var(--ag-text); }
.stream-note { margin-top: 8px; font-size: 11.5px; color: var(--ag-text-3); }

/* ==================== 需求三A：主题体系（亮色 / 护眼） ==================== */
.agent-root[data-theme="light"] {
  --ag-bg: #f5f6fa; --ag-bg-2: #ffffff; --ag-bg-3: #eef0f6;
  --ag-surface: #e7eaf3; --ag-surface-2: #dde1ee;
  --ag-border: #d8dce8; --ag-border-light: #c3c9dc;
  --ag-text: #232733; --ag-text-2: #4b5165; --ag-text-3: #8a90a5;
  --ag-accent: #4a6cf7; --ag-accent-h: #6c8cff; --ag-accent-dim: rgba(74,108,247,0.12);
  --ag-success: #2fa37f; --ag-warn: #b8860b; --ag-danger: #d4556a;
  --ag-shadow: 0 8px 32px rgba(40,50,90,0.18);
}
.agent-root[data-theme="sepia"] {
  --ag-bg: #f3ead8; --ag-bg-2: #faf3e4; --ag-bg-3: #eee2cb;
  --ag-surface: #e8dcc3; --ag-surface-2: #ddcfb2;
  --ag-border: #d8c8a8; --ag-border-light: #c8b48e;
  --ag-text: #3d3226; --ag-text-2: #6b5c49; --ag-text-3: #99896f;
  --ag-accent: #a06a2d; --ag-accent-h: #b87f3e; --ag-accent-dim: rgba(160,106,45,0.14);
  --ag-success: #4e7a4e; --ag-warn: #a06a2d; --ag-danger: #b04a3c;
  --ag-shadow: 0 8px 32px rgba(80,60,30,0.2);
}
.agent-root[data-theme="sepia"] .reader-content { background: #faf3e4; }

/* ==================== 需求三B：侧栏拖拽 / ⌘K 命令面板 ==================== */
.agent-sidebar { position: relative; }
.sidebar-resizer {
  position: absolute; top: 0; right: -4px; width: 8px; height: 100%;
  cursor: col-resize; z-index: 20;
}
.sidebar-resizer:hover { background: var(--ag-accent-dim); }
.command-palette {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 299;
  display: none; align-items: flex-start; justify-content: center; padding-top: 12vh;
  background: rgba(10,12,18,.45);
}
.command-palette.open { display: flex; }
.palette-box {
  width: 560px; max-width: calc(100% - 32px); background: var(--ag-bg-2);
  border: 1px solid var(--ag-border); border-radius: var(--ag-radius-lg);
  box-shadow: var(--ag-shadow); padding: 12px;
}
.palette-input {
  width: 100%; background: var(--ag-bg-3); border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius-sm); color: var(--ag-text); font-size: 14px;
  padding: 10px 12px; outline: none;
}
.palette-input:focus { border-color: var(--ag-accent); }
.palette-hints { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.palette-hints span {
  font-family: var(--ag-mono); font-size: 11px; color: var(--ag-text-3);
  background: var(--ag-bg-3); border: 1px solid var(--ag-border);
  border-radius: 4px; padding: 2px 6px;
}

/* ==================== 需求一 UI：设置模态框 ==================== */
.modal-overlay {
  position: fixed; inset: 0; z-index: 300; display: none;
  align-items: center; justify-content: center; background: rgba(10,12,18,.55);
}
.modal-overlay.open { display: flex; }
.modal {
  width: 420px; max-width: calc(100% - 32px); max-height: 80vh; overflow-y: auto;
  background: var(--ag-bg-2); border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius-lg); box-shadow: var(--ag-shadow);
  font-size: 13px; color: var(--ag-text);
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--ag-border);
}
.modal-title { font-size: 14px; font-weight: 600; }
.modal-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
.modal-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 16px; border-top: 1px solid var(--ag-border);
}
.setting-group-title {
  font-size: 11px; font-weight: 600; color: var(--ag-text-3);
  text-transform: uppercase; letter-spacing: .6px; margin-top: 6px;
}
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--ag-text-2); }
.setting-row input[type="checkbox"] { accent-color: var(--ag-accent); width: 16px; height: 16px; }
.setting-row input[type="number"], .setting-row select {
  width: 110px; background: var(--ag-bg-3); border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius-sm); color: var(--ag-text); padding: 5px 8px; font-size: 12px;
}

/* ==================== 需求四E：状态面板折叠与覆盖章节跳转 ==================== */
.status-section { padding: 4px 12px 10px; }
.status-section summary {
  cursor: pointer; user-select: none; list-style: none;
  font-size: 11px; font-weight: 600; color: var(--ag-text-3);
  margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
}
.status-section summary::-webkit-details-marker { display: none; }
.status-section summary::before { content: '▸'; transition: transform .15s; color: var(--ag-text-3); }
.status-section[open] summary::before { transform: rotate(90deg); }
.status-log-scroll { max-height: 180px; overflow-y: auto; }
.cov-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.cov-chip {
  font-size: 10px; font-family: var(--ag-mono); color: var(--ag-text-3);
  background: var(--ag-bg-3); border: 1px solid var(--ag-border);
  border-radius: 4px; padding: 1px 5px; cursor: pointer;
}
.cov-chip.has { color: var(--ag-success); border-color: var(--ag-success); }
.cov-chip:hover { border-color: var(--ag-accent); color: var(--ag-text); }

/* ==================== 需求三C：对话卡片化 ==================== */
.bubble-final { border: 1px solid var(--ag-border-light); }
.chapter-card { white-space: pre-wrap; }
.chapter-preview { max-height: 220px; overflow: hidden; position: relative; }
.chapter-preview::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 48px;
  background: linear-gradient(transparent, var(--ag-bg-3));
}
.card-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.card-btn {
  border: 1px solid var(--ag-border); background: var(--ag-surface); color: var(--ag-text-2);
  border-radius: var(--ag-radius-sm); font-size: 12px; padding: 4px 10px;
  cursor: pointer; font-family: inherit;
}
.card-btn:hover { border-color: var(--ag-accent); color: var(--ag-text); }
.confirm-args {
  margin-top: 6px; font-family: var(--ag-mono); font-size: 11px;
  color: var(--ag-text-3); word-break: break-all;
}
.confirm-btns { display: flex; gap: 8px; margin-top: 8px; }
.confirm-btns .confirm-ok { border-color: var(--ag-success); color: var(--ag-success); }
.confirm-btns .confirm-cancel { border-color: var(--ag-danger); color: var(--ag-danger); }

/* ==================== 需求三D：章节右键菜单 / 续写章节样式 ==================== */
.chapter-context-menu {
  position: fixed; z-index: 400; min-width: 180px; padding: 6px;
  background: var(--ag-bg-2); border: 1px solid var(--ag-border);
  border-radius: var(--ag-radius-sm); box-shadow: var(--ag-shadow);
  font-size: 12px; color: var(--ag-text-2);
}
.chapter-context-menu .ctx-item {
  display: block; width: 100%; text-align: left; padding: 6px 10px;
  border: none; background: transparent; color: inherit; font-size: 12px;
  font-family: inherit; cursor: pointer; border-radius: 4px;
}
.chapter-context-menu .ctx-item:hover { background: var(--ag-surface); color: var(--ag-text); }
.chapter-context-menu .ctx-item.ctx-danger { color: var(--ag-danger); }
.continue-item {
  padding-left: 18px; border-left: 2px solid var(--ag-accent);
  background: var(--ag-accent-dim);
}
.continue-item .ch-title { font-size: 12px; }

/* ==================== 阅读器浮动操作（需求三E） ==================== */
#reader-summary-btn, #reader-characters-btn {
  padding: 3px 10px; font-size: 12px; border-radius: var(--ag-radius-sm);
  background: var(--ag-surface); color: var(--ag-text-2);
  border: 1px solid var(--ag-border); cursor: pointer; font-family: inherit;
}
#reader-summary-btn:hover, #reader-characters-btn:hover { border-color: var(--ag-accent); color: var(--ag-text); }

/* ==================== 图谱导入高亮（bug22） ==================== */
.graph-editor.flash-highlight { box-shadow: inset 0 0 0 2px var(--ag-accent); }
`;

  // ============================================================
  // ▌内联 HTML —— Agent 布局
  // ============================================================
  const UI_HTML = `
<div class="agent-root" id="novel-agent-panel" role="dialog" aria-label="小说续写Agent">
  <!-- 顶部状态栏 -->
  <header class="agent-header">
    <div class="agent-title">
      <div class="agent-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
      </div>
      <div class="agent-title-text">
        <h1>小说续写 Agent<span id="agent-tab-indicator" class="agent-tab-indicator"></span></h1>
        <div class="agent-meta">
          <span class="current-name" id="agent-novel-name">未加载小说</span>
          <span class="dot">·</span>
          <span id="agent-stats">0 章 · 0 图谱</span>
        </div>
      </div>
    </div>
    <div class="agent-header-actions">
      <button class="agent-icon-btn" id="agent-sidebar-toggle" title="切换侧栏">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="9" y1="3" x2="9" y2="21"/>
        </svg>
      </button>
      <button class="agent-icon-btn" id="agent-status-toggle" title="切换 Agent 状态面板">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>
        </svg>
      </button>
      <button class="agent-icon-btn" id="agent-theme-btn" title="切换主题（暗色/亮色/护眼）">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      </button>
      <button class="agent-icon-btn" id="agent-settings-btn" title="Agent 设置">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      <button class="agent-icon-btn" id="agent-clear-btn" title="清空当前内容">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
      <!-- 需求三·移动端：更多按钮 + 下拉菜单（桌面隐藏，触屏端收纳次要操作） -->
      <button class="agent-icon-btn" id="agent-more-btn" title="更多">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/>
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>
          <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>
        </svg>
      </button>
      <div class="agent-more-menu" id="agent-more-menu">
        <button data-more-action="status"><span>📊</span>Agent 状态面板</button>
        <button data-more-action="theme"><span>🎨</span>切换主题</button>
        <button data-more-action="settings"><span>⚙️</span>Agent 设置</button>
        <button data-more-action="clear" class="danger"><span>🗑</span>清空数据</button>
      </div>
      <button class="agent-icon-btn" id="agent-close-btn" title="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </header>

  <!-- 主体 -->
  <div class="agent-body">
    <!-- 移动端抽屉遮罩（点击关闭抽屉） -->
    <div class="agent-drawer-backdrop" id="agent-drawer-backdrop"></div>
    <!-- 左侧章节栏 -->
    <aside class="agent-sidebar" id="agent-sidebar">
      <div class="sidebar-header">
        <span class="label">章节</span>
        <span class="count" id="chapter-count-badge">0</span>
      </div>
      <div class="sidebar-toolbar">
        <input type="file" id="novel-file-upload" accept=".txt" hidden>
        <input type="text" class="sidebar-input" id="chapter-regex-input"
               placeholder="章节正则（可留空自动）"
               value="^\\s*第\\s*[0-9零一二三四五六七八九十百千]+\\s*章.*$">
        <input type="text" class="sidebar-input" id="chapter-search"
               placeholder="搜索章节（标题/正文）">
        <button class="sidebar-btn" id="upload-novel-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          上传小说 TXT
        </button>
      </div>
      <div class="chapter-list" id="chapter-list">
        <div class="chapter-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          <div>尚未解析章节</div>
          <div style="margin-top:6px;font-size:12px;opacity:.7">上传小说后自动解析</div>
        </div>
      </div>
      <div class="sidebar-footer">
        <button id="select-all-btn">全选</button>
        <button id="unselect-all-btn">取消</button>
        <button id="validate-graph-btn">检验</button>
      </div>
    </aside>

    <!-- 中央主区 -->
    <main class="agent-main">
      <nav class="agent-tabs" role="tablist">
        <button class="agent-tab active" data-tab="chat" role="tab">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          对话
        </button>
        <button class="agent-tab" data-tab="reader" role="tab">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          阅读
        </button>
        <button class="agent-tab" data-tab="graph" role="tab">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <circle cx="5" cy="6" r="2"/>
            <circle cx="19" cy="6" r="2"/>
            <circle cx="5" cy="18" r="2"/>
            <circle cx="19" cy="18" r="2"/>
            <line x1="10" y1="10" x2="6.5" y2="7.5"/>
            <line x1="14" y1="10" x2="17.5" y2="7.5"/>
            <line x1="10" y1="14" x2="6.5" y2="16.5"/>
            <line x1="14" y1="14" x2="17.5" y2="16.5"/>
          </svg>
          图谱
        </button>
      </nav>

      <!-- 对话面板 -->
      <section class="agent-panel active" id="panel-chat">
        <div class="chat-flow" id="chat-flow"></div>
      </section>

      <!-- 阅读面板 -->
      <section class="agent-panel" id="panel-reader">
        <div class="reader-toolbar">
          <button class="reader-nav-btn" id="reader-prev">← 上一章</button>
          <div class="chapter-title" id="reader-title">未选择章节</div>
          <button class="reader-nav-btn" id="reader-next">下一章 →</button>
        </div>
        <div class="reader-content" id="reader-content">
          <div class="empty-hint">从左侧选择章节开始阅读</div>
        </div>
        <div class="reader-footer">
          <div class="font-controls">
            <button id="reader-font-minus" title="缩小字体">A-</button>
            <button id="reader-font-plus" title="放大字体">A+</button>
            <button id="reader-summary-btn" title="生成本章摘要">摘要</button>
            <button id="reader-characters-btn" title="提取本章人物">人物</button>
          </div>
          <div class="reader-progress-bar">
            <div class="reader-progress-fill" id="reader-progress-fill"></div>
          </div>
          <span class="reader-progress-text" id="reader-progress-text">0%</span>
        </div>
      </section>

      <!-- 图谱面板 -->
      <section class="agent-panel" id="panel-graph">
        <div class="graph-panel-toolbar">
          <button class="btn" id="graph-validate-btn">校验</button>
          <button class="btn" id="graph-copy-btn">复制</button>
          <button class="btn" id="graph-export-btn">导出</button>
          <button class="btn" id="graph-import-btn">导入</button>
          <button class="btn danger" id="graph-clear-btn">清空</button>
          <span class="spacer"></span>
          <span class="graph-size" id="graph-size">0 KB</span>
        </div>
        <div class="graph-editor-wrap">
          <textarea class="graph-editor" id="graph-preview" placeholder="合并后的知识图谱 JSON 会显示在这里..." spellcheck="false"></textarea>
          <div class="graph-validate-result" id="graph-validate-result" style="display:none;"></div>
        </div>
      </section>
    </main>

    <!-- 右侧 Agent 状态面板 -->
    <aside class="agent-status" id="agent-status-panel">
      <div class="status-header">
        <span class="label">Agent 状态</span>
        <span class="status-hint">可折叠</span>
      </div>
      <details class="status-section" open>
        <summary>任务链</summary>
        <div id="status-plan"><div class="status-empty">暂无进行中的任务</div></div>
      </details>
      <details class="status-section" open>
        <summary>工具调用</summary>
        <div id="status-tools"><div class="status-empty">暂无工具调用</div></div>
      </details>
      <details class="status-section" open>
        <summary>长期记忆</summary>
        <div id="status-memory"><div class="status-empty">暂无长期记忆</div></div>
      </details>
      <details class="status-section" open>
        <summary>图谱覆盖</summary>
        <div id="status-coverage"><div class="status-empty">未加载小说</div></div>
      </details>
    </aside>
  </div>

  <!-- 底部指令栏 -->
  <footer class="agent-input-bar">
    <div class="quick-actions">
      <button class="quick-btn" data-action="graph-selected">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15 9 22 9 17 14 18 21 12 17 6 21 7 14 2 9 9 9 12 2"/></svg>
        生成选中图谱
      </button>
      <button class="quick-btn" data-action="graph-all">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15 9 22 9 17 14 18 21 12 17 6 21 7 14 2 9 9 9 12 2"/></svg>
        生成全部图谱
      </button>
      <button class="quick-btn" data-action="merge-batch">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        分批合并
      </button>
      <button class="quick-btn" data-action="merge-all">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        全量合并
      </button>
      <button class="quick-btn danger" data-action="stop" disabled>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14"/></svg>
        停止
      </button>
    </div>
    <div class="input-row">
      <input type="text" class="agent-input" id="agent-input"
             enterkeyhint="send" autocomplete="off"
             placeholder="输入需求：如「把这本书续写到第 20 章」「先补全图谱再续写 3000 字」...（Ctrl+K 命令面板）">
      <button class="agent-send-btn" id="agent-send-btn">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        发送
      </button>
    </div>
  </footer>

  <!-- ⌘K 命令面板（需求三B） -->
  <div class="command-palette" id="command-palette">
    <div class="palette-box">
      <input type="text" class="palette-input" id="command-palette-input"
             placeholder="输入命令：/graph  /write  /merge  /chapter 12  /settings  /theme">
      <div class="palette-hints">
        <span>/graph</span><span>/write</span><span>/merge</span><span>/chapter N</span><span>/settings</span><span>/theme</span><span>Esc 关闭</span>
      </div>
    </div>
  </div>

  <!-- 设置模态框（需求一 UI + 需求二 限流控件） -->
  <div class="modal-overlay" id="agent-settings-modal">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Agent 设置</span>
        <button class="agent-icon-btn" id="settings-close-btn" title="关闭">✕</button>
      </div>
      <div class="modal-body">
        <div class="setting-group-title">质检</div>
        <label class="setting-row"><span>前置校验（续写前检查红线/伏笔）</span><input type="checkbox" id="set-enable-precheck"></label>
        <label class="setting-row"><span>续写质量门（拒绝回复/字数不足自动重写）</span><input type="checkbox" id="set-write-quality-gate"></label>
        <label class="setting-row"><span>质量门最小字数</span><input type="number" id="set-write-quality-min-chars" min="100" max="5000" step="50"></label>
        <div class="setting-group-title">限流</div>
        <label class="setting-row"><span>启用限流</span><input type="checkbox" id="set-rate-limit-enabled"></label>
        <label class="setting-row"><span>窗口内最大调用次数</span><input type="number" id="set-rate-limit-max" min="1" max="60" step="1"></label>
        <label class="setting-row"><span>窗口长度</span><input type="number" id="set-rate-limit-window" min="1" max="120" step="1"></label>
        <label class="setting-row"><span>窗口单位</span>
          <select id="set-rate-limit-unit"><option value="s">秒</option><option value="m">分钟</option></select>
        </label>
        <div class="setting-group-title">Agent</div>
        <label class="setting-row"><span>注入酒馆预设（角色卡/世界书）</span><input type="checkbox" id="set-enable-preset-inject"></label>
        <label class="setting-row"><span>自动父预设参数</span><input type="checkbox" id="set-enable-auto-parent-preset"></label>
        <label class="setting-row"><span>Agent 最大步数</span><input type="number" id="set-agent-max-steps" min="2" max="30" step="1"></label>
        <label class="setting-row"><span>续写后回填章节图谱（每章多一次 AI 调用，默认关）</span><input type="checkbox" id="set-continue-graph-backfill"></label>
        <div class="setting-group-title">完全 Agent（5.0）</div>
        <label class="setting-row"><span>续写流式回显（逐字显示，需宿主支持）</span><input type="checkbox" id="set-enable-streaming"></label>
        <label class="setting-row"><span>只读工具单步并行</span><input type="checkbox" id="set-enable-parallel"></label>
        <label class="setting-row"><span>规划门（重型任务先探查再执行）</span><input type="checkbox" id="set-enable-plan-gate"></label>
        <label class="setting-row"><span>上下文预算（token，超预算自动裁剪）</span><input type="number" id="set-context-budget" min="4000" max="200000" step="1000"></label>
      </div>
      <div class="modal-footer">
        <button class="btn" id="settings-save-btn">保存</button>
        <button class="btn" id="settings-cancel-btn">取消</button>
      </div>
    </div>
  </div>

  <!-- 通用确认模态框（B15：替代 iframe 内可能被浏览器策略屏蔽的 window.confirm） -->
  <div class="modal-overlay" id="agent-confirm-modal">
    <div class="modal modal-sm">
      <div class="modal-header">
        <span class="modal-title">确认操作</span>
      </div>
      <div class="modal-body">
        <div id="agent-confirm-text"></div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="agent-confirm-no">取消</button>
        <button class="btn primary" id="agent-confirm-yes">确认</button>
      </div>
    </div>
  </div>
</div>
`;

  // ============================================================
  // ▌SECTION 1  Prompt 常量（保留）
  // ============================================================
  const graphJsonSchema = {
    name: 'NovelKnowledgeGraph',
    strict: true,
    value: {
      "$schema": "http://json-schema.org/draft-04/schema#",
      "type": "object",
      "required": ["基础章节信息", "人物信息", "世界观设定", "核心剧情线", "文风特点", "实体关系网络", "变更与依赖信息", "逆向分析洞察"],
      "properties": {
        "基础章节信息": { "type": "object", "required": ["章节号","章节版本号","章节节点唯一标识","本章字数","叙事时间线节点"], "properties": { "章节号": { "type": "string"},"章节版本号": { "type": "string","default": "1.0"},"章节节点唯一标识": { "type": "string"},"本章字数": { "type": "number"},"叙事时间线节点": { "type": "string"} } },
        "人物信息": { "type": "array","minItems": 1,"items": { "type": "object","required": ["唯一人物ID","姓名","别名/称号","本章更新的性格特征","本章更新的身份/背景","本章核心行为与动机","本章人物关系变更","本章人物弧光变化"],"properties": { "唯一人物ID": { "type": "string"},"姓名": { "type": "string"},"别名/称号": { "type": "string"},"本章更新的性格特征": { "type": "string"},"本章更新的身份/背景": { "type": "string"},"本章核心行为与动机": { "type": "string"},"本章人物关系变更": { "type": "array","items": { "type": "object","required": ["关系对象","关系类型","关系强度0-1","关系描述","对应原文位置"],"properties": { "关系对象": { "type": "string"},"关系类型": { "type": "string"},"关系强度0-1": { "type": "number","minimum": 0,"maximum": 1 },"关系描述": { "type": "string"},"对应原文位置": { "type": "string"} } } },"本章人物弧光变化": { "type": "string"} } } },
        "世界观设定": { "type": "object","required": ["本章新增/变更的时代背景","本章新增/变更的地理区域","本章新增/变更的力量体系/规则","本章新增/变更的社会结构","本章新增/变更的独特物品/生物","本章新增的隐藏设定/伏笔","对应原文位置"],"properties": { "本章新增/变更的时代背景": { "type": "string"},"本章新增/变更的地理区域": { "type": "string"},"本章新增/变更的力量体系/规则": { "type": "string"},"本章新增/变更的社会结构": { "type": "string"},"本章新增/变更的独特物品/生物": { "type": "string"},"本章新增的隐藏设定/伏笔": { "type": "string"},"对应原文位置": { "type": "string"} } },
        "核心剧情线": { "type": "object","required": ["本章主线剧情描述","本章关键事件列表","本章支线剧情","本章核心冲突进展","本章未回收伏笔"],"properties": { "本章主线剧情描述": { "type": "string"},"本章关键事件列表": { "type": "array","items": { "type": "object","required": ["事件ID","事件名","参与人物","前因","后果","对主线的影响","对应原文位置"],"properties": { "事件ID": { "type": "string"},"事件名": { "type": "string"},"参与人物": { "type": "string"},"前因": { "type": "string"},"后果": { "type": "string"},"对主线的影响": { "type": "string"},"对应原文位置": { "type": "string"} } } },"本章支线剧情": { "type": "string"},"本章核心冲突进展": { "type": "string"},"本章未回收伏笔": { "type": "string"} } },
        "文风特点": { "type": "object","required": ["本章叙事视角","语言风格","对话特点","常用修辞","节奏特点","与全文文风的匹配度说明"],"properties": { "本章叙事视角": { "type": "string"},"语言风格": { "type": "string"},"对话特点": { "type": "string"},"常用修辞": { "type": "string"},"节奏特点": { "type": "string"},"与全文文风的匹配度说明": { "type": "string"} } },
        "实体关系网络": { "type": "array","minItems": 5,"items": { "type": "array","minItems": 3,"maxItems": 3,"items": { "type": "string"} } },
        "变更与依赖信息": { "type": "object","required": ["本章对全局图谱的变更项","本章剧情依赖的前置章节","本章内容对后续剧情的影响预判","本章内容与前文的潜在冲突预警"],"properties": { "本章对全局图谱的变更项": { "type": "string"},"本章剧情依赖的前置章节": { "type": "string"},"本章内容对后续剧情的影响预判": { "type": "string"},"本章内容与前文的潜在冲突预警": { "type": "string"} } },
        "逆向分析洞察": { "type": "string"}
      }
    }
  };

  const mergeGraphJsonSchema = {
    name: 'MergedNovelKnowledgeGraph',
    strict: true,
    value: {
      "$schema": "http://json-schema.org/draft-04/schema#",
      "type": "object",
      "required": ["全局基础信息","人物信息库","世界观设定库","全剧情时间线","全局文风标准","全量实体关系网络","反向依赖图谱","逆向分析与质量评估"],
      "properties": {
        "全局基础信息": { "type": "object","required": ["小说名称","总章节数","已解析文本范围","全局图谱版本号","最新更新时间"],"properties": { "小说名称": { "type": "string"},"总章节数": { "type": "number"},"已解析文本范围": { "type": "string"},"全局图谱版本号": { "type": "string"},"最新更新时间": { "type": "string"} } },
        "人物信息库": { "type": "array","items": { "type": "object","required": ["唯一人物ID","姓名","所有别名/称号","全本最终性格特征","完整身份/背景","全本核心动机","全时间线人物关系网","完整人物弧光","人物关键事件时间线"],"properties": { "唯一人物ID": { "type": "string"},"姓名": { "type": "string"},"所有别名/称号": { "type": "string"},"全本最终性格特征": { "type": "string"},"完整身份/背景": { "type": "string"},"全本核心动机": { "type": "string"},"全时间线人物关系网": { "type": "array","items": { "type": "object","required": ["关系对象","关系类型","关系强度","关系演变过程","对应章节"],"properties": { "关系对象": { "type": "string"},"关系类型": { "type": "string"},"关系强度": { "type": "number","minimum": 0,"maximum": 1 },"关系演变过程": { "type": "string"},"对应章节": { "type": "string"} } } },"完整人物弧光": { "type": "string"},"人物关键事件时间线": { "type": "string"} } } },
        "世界观设定库": { "type": "object","required": ["时代背景","核心地理区域与地图","完整力量体系/规则","社会结构","核心独特物品/生物","全本所有隐藏设定/伏笔汇总","设定变更历史记录"],"properties": { "时代背景": { "type": "string"},"核心地理区域与地图": { "type": "string"},"完整力量体系/规则": { "type": "string"},"社会结构": { "type": "string"},"核心独特物品/生物": { "type": "string"},"全本所有隐藏设定/伏笔汇总": { "type": "array","items": { "type": "object","required": ["伏笔内容","出现章节","当前回收状态","预判回收节点"],"properties": { "伏笔内容": { "type": "string"},"出现章节": { "type": "string"},"当前回收状态": { "type": "string","enum": ["未回收","已回收","待回收"] },"预判回收节点": { "type": "string"} } } },"设定变更历史记录": { "type": "array","items": { "type": "object","required": ["变更章节","变更内容","生效范围"],"properties": { "变更章节": { "type": "string"},"变更内容": { "type": "string"},"生效范围": { "type": "string"} } } } } },
        "全剧情时间线": { "type": "object","required": ["主线剧情完整脉络","全本关键事件时序表","支线剧情汇总与关联关系","全本核心冲突演变轨迹","剧情节点依赖关系图"],"properties": { "主线剧情完整脉络": { "type": "string"},"全本关键事件时序表": { "type": "array","items": { "type": "object","required": ["事件ID","事件名","参与人物","发生章节","前因后果","对主线的影响"],"properties": { "事件ID": { "type": "string"},"事件名": { "type": "string"},"参与人物": { "type": "string"},"发生章节": { "type": "string"},"前因后果": { "type": "string"},"对主线的影响": { "type": "string"} } } },"支线剧情汇总与关联关系": { "type": "string"},"全本核心冲突演变轨迹": { "type": "string"},"剧情节点依赖关系图": { "type": "string"} } },
        "全局文风标准": { "type": "object","required": ["固定叙事视角","核心语言风格","对话写作特点","常用修辞与句式","整体节奏规律","场景描写习惯"],"properties": { "固定叙事视角": { "type": "string"},"核心语言风格": { "type": "string"},"对话写作特点": { "type": "string"},"常用修辞与句式": { "type": "string"},"整体节奏规律": { "type": "string"},"场景描写习惯": { "type": "string"} } },
        "全量实体关系网络": { "type": "array","minItems": 20,"items": { "type": "array","minItems": 3,"maxItems": 3,"items": { "type": "string"} } },
        "反向依赖图谱": { "type": "array","items": { "type": "object","required": ["章节节点ID","生效人设状态","生效设定状态","生效剧情状态","依赖的前置节点"],"properties": { "章节节点ID": { "type": "string"},"生效人设状态": { "type": "string"},"生效设定状态": { "type": "string"},"生效剧情状态": { "type": "string"},"依赖的前置节点": { "type": "array","items": { "type": "string"} } } } },
        "逆向分析与质量评估": { "type": "object","required": ["全本隐藏信息汇总","潜在剧情矛盾预警","设定一致性校验结果","人设连贯性评估","伏笔完整性评估","全文本逻辑自洽性得分"],"properties": { "全本隐藏信息汇总": { "type": "string"},"潜在剧情矛盾预警": { "type": "string"},"设定一致性校验结果": { "type": "string"},"人设连贯性评估": { "type": "string"},"伏笔完整性评估": { "type": "string"},"全文本逻辑自洽性得分": { "type": "number","minimum": 0,"maximum": 100 } } }
      }
    }
  };

  const PRECHECK_JSON_SCHEMA = {
    name: 'ContinuePrecheck',
    strict: true,
    value: {
      type: "object",
      required: ["isPass","preMergedGraph","人设红线清单","设定禁区清单","可呼应伏笔清单","潜在矛盾预警","可推进剧情方向","合规性报告"],
      properties: {
        isPass: { type: "boolean" },
        preMergedGraph: { type: "object" },
        "人设红线清单": { type: "string" },
        "设定禁区清单": { type: "string" },
        "可呼应伏笔清单": { type: "string" },
        "潜在矛盾预警": { type: "string" },
        "可推进剧情方向": { type: "string" },
        "合规性报告": { type: "string" }
      }
    }
  };

  const BATCH_MERGE_GRAPH_SYSTEM_PROMPT = `触发词：合并批次知识图谱JSON、小说批次图谱构建 强制约束（100%遵守）： 输出必须为纯JSON格式，无任何前置/后置内容、注释、markdown 必须以{开头，以}结尾，无其他字符 仅基于提供的当前批次的多组章节图谱合并，不引入任何外部内容 严格去重，同一人物/设定/事件不能重复，不同别名合并为同一条目 同一设定以当前批次内最新章节的生效内容为准，同时保留历史变更记录 严格包含所有要求的字段，不修改字段名 无对应内容设为"暂无"，数组设为[]，不得留空 必须构建完整的反向依赖图谱，支持后续合并与续写 必填字段：全局基础信息、人物信息库、世界观设定库、全剧情时间线、全局文风标准、全量实体关系网络、反向依赖图谱、逆向分析与质量评估`;

  const MERGE_ALL_GRAPH_SYSTEM_PROMPT = `触发词：合并全量知识图谱JSON、小说全局图谱构建 强制约束（100%遵守）： 输出必须为纯JSON格式，无任何前置/后置内容、注释、markdown 必须以{开头，以}结尾，无其他字符 仅基于提供的多组图谱合并，不引入任何外部内容 严格去重，同一人物/设定/事件不能重复，不同别名合并为同一条目 同一设定以最新章节的生效内容为准，同时保留历史变更记录 严格包含所有要求的字段，不修改字段名 无对应内容设为"暂无"，数组设为[]，不得留空 必须构建完整的反向依赖图谱，支持任意章节续写的前置信息提取 必填字段：全局基础信息、人物信息库、世界观设定库、全剧情时间线、全局文风标准、全量实体关系网络、反向依赖图谱、逆向分析与质量评估`;

  const CONTINUE_CHAPTER_GRAPH_SYSTEM_PROMPT = `触发词：构建单章节知识图谱JSON、小说续写章节解析 强制约束（100%遵守）： 输出必须为纯JSON格式，无任何前置/后置内容、注释、markdown 必须以{开头，以}结尾，无其他字符 仅基于提供的续写章节内容分析，不引入任何外部内容 严格包含所有要求的字段，不修改字段名 无对应内容设为"暂无"，数组设为[]，不得留空 必填字段：基础章节信息、人物信息、世界观设定、核心剧情线、文风特点、实体关系网络、变更与依赖信息、逆向分析洞察`;

  function getSingleChapterGraphPrompt(chapter, isModified = false) {
    const trigger = isModified ? '构建单章节知识图谱JSON、小说魔改章节解析' : '构建单章节知识图谱JSON、小说章节解析';
    const contentDesc = isModified ? '魔改后章节内容' : '小说章节内容';
    return `触发词：${trigger} 强制约束（100%遵守）： 输出必须为纯JSON格式，无任何前置/后置内容、注释、markdown 必须以{开头，以}结尾，无其他字符 仅基于提供的${contentDesc}分析，不引入任何外部内容 严格包含所有要求的字段，不修改字段名 无对应内容设为"暂无"，数组设为[]，不得留空 必须实现全链路双向可追溯，所有信息必须关联对应原文位置 同一人物、设定、事件不能重复出现，同一人物的不同别名必须合并为同一个唯一实体条目 基础章节信息必须填写：章节号=${chapter.id}，章节节点唯一标识=chapter_${chapter.id}，本章字数=${chapter.content.length} 必填字段：基础章节信息、人物信息、世界观设定、核心剧情线、文风特点、实体关系网络、变更与依赖信息、逆向分析洞察`;
  }

  function getPrecheckSystemPrompt(baseId) {
    return `触发词：续写节点逆向分析、前置合规性校验 强制约束（100%遵守）： 所有分析只能基于续写节点（章节号${baseId}）及之前的小说内容，绝对不能引入该节点之后的任何剧情、设定、人物变化，禁止剧透 若前文有设定冲突，以续写节点前最后一次出现的内容为准，同时标注冲突预警 优先以用户提供的魔改后基准章节内容为准，更新对应人设、设定、剧情状态 只能基于提供的章节知识图谱分析，绝对不能引入外部信息、主观新增设定 输出必须为纯JSON格式，无任何前置/后置内容、注释、markdown，必须以{开头、以}结尾 必填字段：isPass、preMergedGraph、人设红线清单、设定禁区清单、可呼应伏笔清单、潜在矛盾预警、可推进剧情方向、合规性报告`;
  }

  function getNovelWriteSystemPrompt(options) {
    const { redLines, forbiddenRules, baseLastParagraph, foreshadowList, wordCount, conflictWarning } = options;
    return `小说续写规则（100%遵守）：人设锁定：续写内容必须完全贴合小说的核心人物设定，绝对不能出现人设崩塌（OOC），严格遵守以下人设红线：${redLines}设定合规：续写内容必须完全符合小说的世界观设定，绝对不能出现吃书、新增违规设定、违反原有规则的问题，严格遵守以下设定禁区：${forbiddenRules}文本衔接：续写内容必须紧接在基准章节的最后一段之后开始，从那个地方继续写下去，确保文本连续，逻辑自洽。基准章节的最后一段内容是："${baseLastParagraph}"续写必须从这段文字之后直接开始，不能重复这段内容。剧情承接：续写内容必须承接前文剧情，合理呼应以下伏笔：${foreshadowList}，开启新的章节内容，且与上述文本衔接要求一致。文风统一：续写内容必须完全贴合原小说的叙事风格、语言习惯、对话方式、节奏特点，和原文无缝衔接，无风格割裂剧情合理：续写内容要符合原小说的世界观设定，推动主线剧情发展，有完整的情节起伏、生动的细节、符合人设的对话输出要求：只输出续写的正文内容，不要任何标题、章节名、解释、备注、说明、分割线字数要求：续写约${wordCount}字，误差不超过10%矛盾规避：必须规避以下潜在剧情矛盾：${conflictWarning}小数据适配：若前文内容较少，严格遵循现有文本的叙事范式、对话模式、剧情节奏，不做风格跳脱的续写，不无限新增设定与人物`;
  }

  function getTimelineSafeWriteSystemPrompt(options) {
    const { redLines, forbiddenRules, baseLastParagraph, foreshadowList, wordCount, conflictWarning, baseChapterId } = options;
    const timelineWarning = baseChapterId
      ? `【重要】当前续写基准章节为第${baseChapterId}章，续写内容只能基于第${baseChapterId}章及之前发生的情节，绝对不能提前透露或暗示第${baseChapterId}章之后的剧情发展、角色命运或事件结果。如果前文没有明确铺垫，不能凭空创造角色关系或事件。`
      : '';
    return `小说续写规则（100%遵守）：
${timelineWarning}
人设锁定：续写内容必须完全贴合小说的核心人物设定，绝对不能出现人设崩塌（OOC），严格遵守以下人设红线：${redLines}
设定合规：续写内容必须完全符合小说的世界观设定，绝对不能出现吃书、新增违规设定、违反原有规则的问题，严格遵守以下设定禁区：${forbiddenRules}
文本衔接：续写内容必须紧接在基准章节的最后一段之后开始，从那个地方继续写下去，确保文本连续，逻辑自洽。基准章节的最后一段内容是："${baseLastParagraph}"续写必须从这段文字之后直接开始，不能重复这段内容。
剧情承接：续写内容必须承接前文剧情，合理呼应以下伏笔：${foreshadowList}，开启新的章节内容，且与上述文本衔接要求一致。
文风统一：续写内容必须完全贴合原小说的叙事风格、语言习惯、对话方式、节奏特点，和原文无缝衔接，无风格割裂
剧情合理：续写内容要符合原小说的世界观设定，推动主线剧情发展，有完整的情节起伏、生动的细节、符合人设的对话
输出要求：只输出续写的正文内容，不要任何标题、章节名、解释、备注、说明、分割线
字数要求：续写约${wordCount}字，误差不超过10%
矛盾规避：必须规避以下潜在剧情矛盾：${conflictWarning}
小数据适配：若前文内容较少，严格遵循现有文本的叙事范式、对话模式、剧情节奏，不做风格跳脱的续写，不无限新增设定与人物`;
  }

  function extractChapterNumber(nodeId) {
    if (!nodeId || typeof nodeId !== 'string') return null;
    const patterns = [/chapter[_\s]?(\d+)/i, /第\s*(\d+)\s*章/, /(\d+)\s*章/, /第\s*(\d+)\s*话/, /(\d+)\s*话/];
    for (const pattern of patterns) {
      const match = nodeId.match(pattern);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  }

  function filterGraphByTimeline(mergedGraph, baseChapterId) {
    if (!mergedGraph || typeof mergedGraph !== 'object') return mergedGraph;
    if (!baseChapterId || typeof baseChapterId !== 'number') return mergedGraph;
    // bug11：大图谱深拷贝换 structuredClone，避免每章续写都卡 1-2s
    const filteredGraph = (typeof structuredClone === 'function')
      ? structuredClone(mergedGraph)
      : JSON.parse(JSON.stringify(mergedGraph));
    if (filteredGraph.全剧情时间线 && filteredGraph.全剧情时间线.全本关键事件时序表) {
      filteredGraph.全剧情时间线.全本关键事件时序表 = filteredGraph.全剧情时间线.全本关键事件时序表.filter(event => {
        const n = extractChapterNumber(event.发生章节 || '');
        return !(n !== null && n > baseChapterId);
      });
    }
    if (filteredGraph.全量实体关系网络) {
      filteredGraph.全量实体关系网络 = filteredGraph.全量实体关系网络.filter(relation => {
        if (relation.length < 3) return true;
        for (let i = 0; i < relation.length; i++) {
          const n = extractChapterNumber(relation[i]);
          if (n !== null && n > baseChapterId) return false;
        }
        return true;
      });
    }
    if (filteredGraph.人物信息库) {
      filteredGraph.人物信息库 = filteredGraph.人物信息库.map(character => {
        const filteredChar = { ...character };
        if (filteredChar.全时间线人物关系网) {
          filteredChar.全时间线人物关系网 = filteredChar.全时间线人物关系网.filter(relation => {
            const n = extractChapterNumber(relation.对应章节 || '');
            return !(n !== null && n > baseChapterId);
          });
        }
        if (filteredChar.人物关键事件时间线) {
          const lines = filteredChar.人物关键事件时间线.split('\n').filter(line => {
            const n = extractChapterNumber(line);
            return n === null || n <= baseChapterId;
          });
          filteredChar.人物关键事件时间线 = lines.join('\n');
        }
        return filteredChar;
      });
    }
    // bug1：schema/合并 prompt 里的键是「全本所有隐藏设定/伏笔汇总」（斜杠），必须用方括号访问
    if (filteredGraph.世界观设定库 && filteredGraph.世界观设定库['全本所有隐藏设定/伏笔汇总']) {
      filteredGraph.世界观设定库['全本所有隐藏设定/伏笔汇总'] = filteredGraph.世界观设定库['全本所有隐藏设定/伏笔汇总'].filter(foreshadow => {
        const n = extractChapterNumber(foreshadow.出现章节 || '');
        return n === null || n <= baseChapterId;
      });
    }
    if (filteredGraph.变更与依赖信息) {
      delete filteredGraph.变更与依赖信息.本章内容对后续剧情的影响预判;
    }
    if (filteredGraph.逆向分析与质量评估 && filteredGraph.逆向分析与质量评估.全本隐藏信息汇总) {
      filteredGraph.逆向分析与质量评估.全本隐藏信息汇总 = '';
    }
    return filteredGraph;
  }

  const PromptConstants = {
    graphJsonSchema, mergeGraphJsonSchema, PRECHECK_JSON_SCHEMA,
    BATCH_MERGE_GRAPH_SYSTEM_PROMPT, MERGE_ALL_GRAPH_SYSTEM_PROMPT, CONTINUE_CHAPTER_GRAPH_SYSTEM_PROMPT,
    getSingleChapterGraphPrompt, getPrecheckSystemPrompt, getNovelWriteSystemPrompt,
    filterGraphByTimeline, getTimelineSafeWriteSystemPrompt
  };

  // ============================================================
  // ▌SECTION 2  酒馆适配层（保留核心）
  // ============================================================
  const __SillyTavern = (typeof SillyTavern !== 'undefined')
    ? SillyTavern
    : (window.parent && window.parent.SillyTavern) || {
        eventSource: { on() {}, once() {}, emit() {}, removeListener() {}, makeLast() {}, makeFirst() {} },
        eventTypes: {},
        getContext: () => ({}),
    };
  const eventSource = __SillyTavern.eventSource || { on() {}, once() {}, emit() {}, removeListener() {}, makeLast() {}, makeFirst() {} };
  const event_types = __SillyTavern.eventTypes || {};
  function getContext() { return (__SillyTavern.getContext && __SillyTavern.getContext()) || {}; }

  const extensionName = 'novel_agent';
  let _settingsCache = null;

  function _loadSettingsCache() {
    const vars = _getScriptVars();
    if (!vars || typeof vars !== 'object') { _settingsCache = {}; return; }
    if (vars[extensionName] && typeof vars[extensionName] === 'object') { _settingsCache = vars[extensionName]; return; }
    if (vars.chapterList !== undefined || vars.mergedGraph !== undefined || vars.chapterGraphMap !== undefined) {
      _settingsCache = vars;
      return;
    }
    _settingsCache = {};
  }

  function _persistSettings() {
    if (_settingsCache !== null) _setScriptVars({ [extensionName]: _settingsCache });
  }

  const _saveTimer = { id: null };
  const SAVE_DEBOUNCE_MS = 250;
  function _flushSettings() {
    if (_saveTimer.id !== null) { clearTimeout(_saveTimer.id); _saveTimer.id = null; }
    _persistSettings();
  }
  function saveSettingsDebounced() {
    if (_saveTimer.id !== null) { clearTimeout(_saveTimer.id); _saveTimer.id = null; }
    _saveTimer.id = setTimeout(function () {
      _saveTimer.id = null;
      try { _persistSettings(); } catch (e) { try { console.warn('[小说续写Agent] 持久化失败:', e && e.message); } catch (_) {} }
    }, SAVE_DEBOUNCE_MS);
  }

  const extension_settings = new Proxy({}, {
    get(_t, prop) {
      if (prop === extensionName) {
        if (_settingsCache === null) _loadSettingsCache();
        return _settingsCache;
      }
      return undefined;
    },
    set(_t, prop, value) {
      if (prop === extensionName) { _settingsCache = value; saveSettingsDebounced(); }
      return true;
    }
  });

  // ============================================================
  // ▌SECTION 3  业务逻辑（精简版）
  // ============================================================

  // B7：escapeHtml 纯字符串实现（不依赖 DOM，跨 iframe / Unicode 更稳定）
  function escapeHtml(text) {
    if (text == null) return '';
    const s = String(text);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      switch (c) {
        case 38: out += '&amp;'; break;
        case 60: out += '&lt;'; break;
        case 62: out += '&gt;'; break;
        case 34: out += '&quot;'; break;
        case 39: out += '&#39;'; break;
        default: out += s[i];
      }
    }
    return out;
  }

  function setButtonLoading(selector, isLoading, loadingText = "加载中...") {
    const $btn = typeof selector === 'string' ? getDoc().querySelector(selector) : selector;
    if (!$btn) return;
    // bug23：跨 iframe 时 Element 构造器可能不同，统一用 nodeType === 1 判断 DOM 节点
    const $btnElement = $btn && $btn.nodeType === 1 ? $btn : ($btn && $btn[0]);
    if (!$btnElement) return;
    if (isLoading) {
      $btnElement.dataset.originalText = $btnElement.textContent || '';
      $btnElement.textContent = loadingText;
      $btnElement.disabled = true;
    } else {
      if ($btnElement.dataset.originalText) $btnElement.textContent = $btnElement.dataset.originalText;
      $btnElement.disabled = false;
    }
  }

  function isEmptyContent(text) {
    if (!text) return true;
    for (let i = 0; i < text.length; i++) { if (!/\s/.test(text[i])) return false; }
    return true;
  }
  const REJECT_KEYWORDS = ['不能', '无法', '不符合', '抱歉', '对不起', '无法提供', '请调整', '违规', '敏感', '不予生成'];

  const TIME_CONSTANTS = { RETRY_DELAY: 1200, BATCH_MERGE_DELAY: 1500 };

  const MAX_API_CALLS_PER_MINUTE = 3;
  let apiCallTimestamps = [];

  const presetChapterRegexList = [
    { name: "标准章节", regex: "^\\s*第\\s*[0-9零一二三四五六七八九十百千]+\\s*章.*$" },
    { name: "括号序号", regex: "^\\s*.*\\（[0-9零一二三四五六七八九十百千]+\\）.*$" },
    { name: "英文括号", regex: "^\\s*.*\\([0-9零一二三四五六七八九十百千]+\\) .*$" },
    { name: "标准节", regex: "^\\s*第\\s*[0-9零一二三四五六七八九十百千]+\\s*节.*$" },
    { name: "Chapter", regex: "^\\s*Chapter\\s*[0-9]+\\s*.*$" },
    { name: "标准话", regex: "^\\s*第\\s*[0-9零一二三四五六七八九十百千]+\\s*话.*$" }
  ];

  const defaultSettings = {
    chapterRegex: "^\\s*第\\s*[0-9零一二三四五六七八九十百千]+\\s*章.*$",
    sendTemplate: "/sendas name={{char}} {{pipe}}",
    sendDelay: 100,
    chapterList: [],
    chapterGraphMap: {},
    mergedGraph: {},
    continueWriteChain: [],
    continueChapterIdCounter: 1,
    writeChapterCount: 1,
    graphChaptersPerGraph: 1,
    rateLimitEnabled: true,
    rateLimitMaxCalls: 3,
    rateLimitWindow: 60,
    rateLimitUnit: "m",
    precheckReport: {},
    selectedBaseChapterId: "",
    writeContentPreview: "",
    precheckStatus: "未执行",
    precheckReportText: "",
    enableAutoParentPreset: true,
    enableTavernPresetInject: true,
    readerState: { fontSize: 16, currentChapterId: null, currentChapterType: "original", readProgress: {} },
    activeTab: "chat",
    sidebarCollapsed: false,
    chatMessages: [],
    selectedChapterIds: [],
    currentNovelName: "",
    agentMemory: { preferences: [], facts: [], taskHistory: [] },
    agentMaxSteps: 12,
    statusPanelCollapsed: false,
    enablePrecheck: true,
    enableWriteQualityGate: true,
    writeQualityMinChars: 300,
    agentTheme: "dark",
    agentSidebarWidth: 260,
    agentCheckpoint: null,
    // B5：续写后回填章节图谱（每章多一次 AI 调用，默认关闭，可在设置中打开）
    enableContinueGraphBackfill: false,
    // 5.0 完全 Agent：流式回显 / 只读工具并行 / Plan-Execute 规划门 / 上下文 token 预算
    enableStreaming: true,
    enableParallelTools: true,
    enablePlanGate: true,
    agentContextBudget: 24000
  };

  let currentParsedChapters = [];
  let isGeneratingGraph = false;
  let isGeneratingWrite = false;
  let stopGenerateFlag = false;
  let isSending = false;
  let stopSending = false;
  let continueWriteChain = [];
  let continueChapterIdCounter = 1;
  let currentPrecheckResult = null;
  let isInitialized = false;
  let batchMergedGraphs = [];

  function deepMerge(target, source) {
    const merged = { ...target };
    for (const key in source) {
      if (Object.hasOwn.call(source, key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          merged[key] = deepMerge(merged[key] || {}, source[key]);
        } else if (Array.isArray(source[key])) {
          merged[key] = [...source[key]];
        } else {
          merged[key] = source[key];
        }
      }
    }
    return merged;
  }

  function removeBOM(text) {
    if (!text) return text;
    if (text.charCodeAt(0) === 0xFEFF || text.charCodeAt(0) === 0xFFFE) return text.slice(1);
    return text;
  }

  function setButtonDisabled(selector, disabled) {
    $(selector).prop('disabled', disabled);
  }

  function updateProgress(progressId, statusId, current, total, textPrefix = "进度") {
    const $progressEl = $(`#${progressId}`);
    const $statusEl = $(`#${statusId}`);
    if (total === 0) {
      $progressEl.css('width', '0%');
      $statusEl.text('');
      return;
    }
    const percent = Math.floor((current / total) * 100);
    $progressEl.css('width', `${percent}%`);
    $statusEl.text(`${textPrefix}: ${current}/${total} (${percent}%)`);
  }

  async function rateLimitCheck() {
    const settings = extension_settings[extensionName] || {};
    // 需求二：限流参数全部读自定义设置，改动即时生效（每次调用都读，无需重启）
    if (settings.rateLimitEnabled === false) return;
    const maxCalls = Math.max(1, parseInt(settings.rateLimitMaxCalls, 10) || MAX_API_CALLS_PER_MINUTE);
    const windowValue = Math.max(1, parseInt(settings.rateLimitWindow, 10) || 60);
    const windowUnitMs = settings.rateLimitUnit === 's' ? 1000 : 60 * 1000;
    const windowMs = windowValue * windowUnitMs;
    const now = Date.now();
    apiCallTimestamps = apiCallTimestamps.filter(t => now - t < windowMs);
    if (apiCallTimestamps.length >= maxCalls) {
      const earliestCallTime = Math.min(...apiCallTimestamps);
      const waitTime = earliestCallTime + windowMs - now;
      if (waitTime > 0) {
        const waitSeconds = (waitTime / 1000).toFixed(1);
        agentNotify(`⏸ 限流保护：等待 ${waitSeconds} 秒`, 'warn');
        // 可中断倒计时：每 200ms 检查停止标志，而不是 while(interval=100) 硬轮询
        await sleepInterruptible(waitTime);
        // 等待结束后重新过滤，避免把等待前的旧时间戳算进去导致计时不准
        apiCallTimestamps = apiCallTimestamps.filter(t => Date.now() - t < windowMs);
      }
    }
    apiCallTimestamps.push(Date.now());
  }

  // B10：停止信号哨兵错误 —— 供 sleepInterruptible 与生成循环抛出，调用方据此跳过重试
  function makeStopError() {
    const e = new Error('用户手动停止生成');
    e.isStopSignal = true;
    return e;
  }

  // 可中断倒计时：每 200ms 检查一次停止标志
  async function sleepInterruptible(ms) {
    const step = 200;
    let waited = 0;
    while (waited < ms) {
      if (stopGenerateFlag || stopSending) throw makeStopError();
      await new Promise(resolve => setTimeout(resolve, step));
      waited += step;
    }
  }

  // bug3：酒馆预设块每次 AI 调用都重建很贵（世界书/角色卡读取），加 60 秒缓存
  let _tavernPresetCache = { ts: 0, text: '' };
  async function resolveTavernPresetBlock() {
    const now = Date.now();
    if (_tavernPresetCache.ts && now - _tavernPresetCache.ts < 60000) return _tavernPresetCache.text;
    const settings = extension_settings[extensionName];
    if (!settings.enableTavernPresetInject) return '';
    const context = getContext();
    const sections = [];
    try {
      if (typeof context.getCharacterCardFields === 'function') {
        const fields = context.getCharacterCardFields();
        if (fields && fields.system) sections.push(`<character_system_prompt>\n${fields.system}\n</character_system_prompt>`);
        if (fields && fields.description) sections.push(`<character_description>\n${fields.description}\n</character_description>`);
        if (fields && fields.personality) sections.push(`<character_personality>\n${fields.personality}\n</character_personality>`);
        if (fields && fields.scenario) sections.push(`<character_scenario>\n${fields.scenario}\n</character_scenario>`);
        if (fields && fields.creatorNotes) sections.push(`<creator_notes>\n${fields.creatorNotes}\n</creator_notes>`);
        if (fields && fields.persona) sections.push(`<user_persona>\n${fields.persona}\n</user_persona>`);
      }
    } catch (e) { console.warn('[小说续写Agent] 解析角色卡字段失败:', e); }
    try {
      if (typeof context.getWorldInfoPrompt === 'function') {
        const chat = Array.isArray(context.chat) ? context.chat : [];
        const wi = await context.getWorldInfoPrompt(chat, 8192, true);
        const wiText = [wi && wi.worldInfoBefore, wi && wi.worldInfoAfter].filter(t => typeof t === 'string' && t.trim()).join('\n');
        if (wiText) sections.push(`<world_info>\n${wiText}\n</world_info>`);
      }
    } catch (e) { console.warn('[小说续写Agent] 解析世界书激活条目失败:', e); }
    if (sections.length === 0) { _tavernPresetCache = { ts: now, text: '' }; return ''; }
    const text = `<tavern_preset_context>\n以下为酒馆当前启用的提示预设（角色卡、人设、世界书），续写与图谱分析必须严格遵守其中的设定与写作规范：\n\n${sections.join('\n\n')}\n</tavern_preset_context>`;
    _tavernPresetCache = { ts: now, text };
    return text;
  }

  async function generateRawWithBreakLimit(params) {
    const context = getContext();
    if (!context || typeof context !== 'object') throw new Error('无法获取上下文');
    const { generateRaw } = context;
    if (typeof generateRaw !== 'function') throw new Error('generateRaw 函数不可用');
    const settings = extension_settings[extensionName];
    let finalParams = { ...params };
    // bug2：调用方已注入预设参数（__presetInjected）时不再重复读取，避免每次 AI 调用多跑一次深拷贝
    if (settings.enableAutoParentPreset && !params.__presetInjected) {
      const presetParams = getActivePresetParams();
      const PRESET_OVERRIDE_WHITELIST = new Set(['systemPrompt', 'prompt', 'jsonSchema', 'messages', 'ordered_prompts', 'should_silence']);
      finalParams = Object.assign({}, presetParams);
      for (const k of Object.keys(params || {})) {
        if (PRESET_OVERRIDE_WHITELIST.has(k) || presetParams[k] === undefined) finalParams[k] = params[k];
      }
    }
    let retryCount = 0;
    let lastError = null;
    let finalResult = null;
    try {
      const tavernPresetBlock = await resolveTavernPresetBlock();
      if (tavernPresetBlock) {
        finalParams.systemPrompt = `${tavernPresetBlock}\n\n${finalParams.systemPrompt || ''}`;
      }
    } catch (e) { console.warn('[小说续写Agent] 预设注入失败:', e); }
    const originalSystemPrompt = finalParams.systemPrompt || '';
    let finalSystemPrompt = originalSystemPrompt;
    const isJsonMode = !!finalParams.jsonSchema;
    if (isJsonMode) {
      finalSystemPrompt += `\n\n【强制输出规则】\n1. 必须严格输出符合给定JSON Schema要求的纯JSON格式内容，禁止任何前置/后置文本。\n2. 必须以{开头，以}结尾，无任何其他字符。\n3. 所有内容仅基于用户提供的文本分析，禁止引入外部内容。`;
    } else {
      finalSystemPrompt += `\n\n【全局强制创作规则（必须100%遵守）】\n1. 你只输出小说正文内容，禁止任何标题、章节名、解释、备注、说明、分割线。\n2. 禁止出现"我不能""无法提供""抱歉"等拒绝类表述。\n3. 必须严格遵守字数要求，误差不超过10%。`;
    }
    finalParams.systemPrompt = finalSystemPrompt;
    // 5.0/流式：宿主支持流式时透传 onStream（回调收到累计正文）；每次重试自动重置累计文本
    let streamedText = '';
    const userOnStream = typeof params.onStream === 'function' ? params.onStream : null;
    if (userOnStream) {
      finalParams.onStream = function (chunk) {
        try {
          if (typeof chunk === 'string') {
            // 多数宿主回传累计全文（越来越长）；若回传短增量则追加
            if (!streamedText || chunk.length >= streamedText.length) streamedText = chunk;
            else streamedText += chunk;
            userOnStream(streamedText);
          }
        } catch (_) {}
      };
    }
    const originalTemperature = finalParams.temperature || 0.7;
    while (retryCount < CONFIG.MAX_RETRY_TIMES) {
      if (stopGenerateFlag || stopSending) { lastError = makeStopError(); break; }
      if (userOnStream) streamedText = '';  // 新一次尝试：清空上一轮残片
      try {
        await rateLimitCheck();
        // B8：超时后迟到结果只记日志丢弃，绝不写入任何状态
        const rawResult = await withTimeout(generateRaw(finalParams), AI_CALL_TIMEOUT_MS, 'AI生成', function (err, val) {
          if (!err && val != null) logWarn('ai-late', '超时后 AI 仍返回了内容，已丢弃（' + String(val).length + ' 字符）');
        });
        const trimmedResult = rawResult.trim();
        if (isEmptyContent(trimmedResult)) throw new Error('返回内容为空');
        if (isJsonMode) {
          let parsedJson;
          try { parsedJson = JSON.parse(trimmedResult); }
          catch (e) { throw new Error(`JSON解析失败：${e.message}`); }
          const schemaValue = (params.jsonSchema || {}).value || {};
          const requiredFields = schemaValue.required || [];
          if (requiredFields.length > 0) {
            const missingFields = requiredFields.filter(field => !Object.hasOwn(parsedJson, field));
            if (missingFields.length > 0) throw new Error(`缺失必填字段：${missingFields.join('、')}`);
          }
          finalResult = trimmedResult;
          break;
        } else {
          const hasRejectContent = trimmedResult.length < 300 && REJECT_KEYWORDS.some(keyword => trimmedResult.includes(keyword));
          if (hasRejectContent) throw new Error('返回内容为拒绝生成的提示');
          finalResult = trimmedResult;
          break;
        }
      } catch (error) {
        // B10：停止信号直接退出，不走重试（避免多余的重试等待与日志）
        if (error && error.isStopSignal) { lastError = error; break; }
        lastError = error;
        retryCount++;
        if (retryCount < CONFIG.MAX_RETRY_TIMES) {
          const retryTemperature = Math.min(originalTemperature + 0.12 * retryCount, 1.2);
          finalParams.systemPrompt = originalSystemPrompt + `\n\n【重试修正】\n上次错误：${error.message}。本次必须严格遵守所有强制规则。`;
          finalParams.temperature = retryTemperature;
          await new Promise(resolve => setTimeout(resolve, TIME_CONSTANTS.RETRY_DELAY));
          if (stopGenerateFlag || stopSending) { lastError = makeStopError(); break; }
        }
      }
    }
    if (finalResult === null) throw lastError || new Error('API调用失败');
    return finalResult;
  }

  function getActivePresetParams() {
    const settings = extension_settings[extensionName];
    const context = getContext();
    let presetParams = {};
    if (settings.enableAutoParentPreset) {
      if (context && context.getPresetManager) {
        try {
          const presetManager = context.getPresetManager();
          if (presetManager) {
            const presetName = presetManager.getSelectedPresetName();
            const presetData = presetManager.getPresetSettings(presetName);
            if (presetData && typeof presetData === 'object' && Object.keys(presetData).length > 0) presetParams = { ...presetData };
          }
        } catch (e) {}
      }
      if (Object.keys(presetParams).length === 0 && context && context.generation_settings && typeof context.generation_settings === 'object') presetParams = { ...context.generation_settings };
      if (Object.keys(presetParams).length === 0 && _pWin().generation_params && typeof _pWin().generation_params === 'object') presetParams = { ..._pWin().generation_params };
      const stWin = _pWin().SillyTavern;
      const stPreset = stWin && stWin.presetManager && stWin.presetManager.currentPreset;
      if (Object.keys(presetParams).length === 0 && stPreset && stPreset.data) presetParams = { ...stPreset.data };
    } else {
      if (_pWin().generation_params && typeof _pWin().generation_params === 'object') presetParams = { ..._pWin().generation_params };
    }
    const excludedKeys = new Set([
      'preset_name', 'preset', 'name', 'id', 'description', 'version',
      'isDefault', 'is_default', 'date_added', 'api_type', 'main_api',
      'preset_type', 'chat_completion_source', 'oai_settings', 'power_user',
      'settings_ui',
      'api_key', 'key', 'secret', 'token', 'password', 'authorization', 'auth',
      'reverse_proxy', 'proxy', 'proxy_url', 'custom_headers', 'cookie', 'session',
      'messages', 'prompt', 'systemPrompt', 'system_prompt', 'jsonSchema'
    ]);
    const filteredParams = {};
    for (const key of Object.keys(presetParams)) {
      if (excludedKeys.has(key)) continue;
      const value = presetParams[key];
      if (value === undefined || value === null) continue;
      let targetKey = key;
      if (key === 'temp') targetKey = 'temperature';
      if (key === 'rep_pen') targetKey = 'repetition_penalty';
      if (key === 'top_k_value') targetKey = 'top_k';
      if (key === 'top_p_value') targetKey = 'top_p';
      if (key === 'max_length') targetKey = 'max_new_tokens';
      filteredParams[targetKey] = value;
    }
    const defaultFallback = { temperature: 0.7, top_p: 0.9, top_k: 40, max_new_tokens: 2048, repetition_penalty: 1.1, do_sample: true };
    for (const [key, value] of Object.entries(defaultFallback)) {
      if (filteredParams[key] === undefined || filteredParams[key] === null) filteredParams[key] = value;
    }
    return filteredParams;
  }

  // ============ 章节解析 ============
  function splitNovelIntoChapters(novelText, regexSource) {
    try {
      const cleanText = removeBOM(novelText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const chapterRegex = new RegExp(regexSource, 'gm');
      const matches = [...cleanText.matchAll(chapterRegex)];
      const chapters = [];
      if (matches.length === 0) {
        return [{ id: 0, title: '全文', content: cleanText, hasGraph: false }];
      }
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index + matches[i][0].length;
        const end = i < matches.length - 1 ? matches[i + 1].index : cleanText.length;
        const title = matches[i][0].trim();
        const content = cleanText.slice(start, end).trim();
        if (content) chapters.push({ id: i, title, content, hasGraph: false });
      }
      return chapters;
    } catch (error) {
      console.error('章节拆分失败:', error);
      return [];
    }
  }

  function getSortedRegexList(novelText) {
    const cleanText = removeBOM(novelText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return presetChapterRegexList.map(item => {
      try {
        const regex = new RegExp(item.regex, 'gm');
        const matches = [...cleanText.matchAll(regex)];
        return { ...item, count: matches.length };
      } catch { return { ...item, count: 0 }; }
    }).sort((a, b) => b.count - a.count);
  }

  // ============ 图谱生成 ============
  async function generateSingleChapterGraph(chapter) {
    const systemPrompt = PromptConstants.getSingleChapterGraphPrompt(chapter);
    const userPrompt = `章节标题：${chapter.title}\n章节内容：${chapter.content}`;
    let lastError = null;
    // bug24：JSON 解析失败不再直接返回 null，最多补跑 2 次（配合 generateRawWithBreakLimit 内部重试）
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await generateRawWithBreakLimit({
          systemPrompt, prompt: userPrompt, jsonSchema: PromptConstants.graphJsonSchema
        });
        const parsed = JSON.parse(result.trim());
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (error) {
        lastError = error;
        if (stopGenerateFlag || stopSending) break;
      }
    }
    console.error(`章节${chapter.title}图谱生成失败:`, lastError);
    return null;
  }

  async function generateChapterGraphBatch(chapters) {
    if (isGeneratingGraph) { agentNotify('⚠ 图谱生成正在进行中', 'warn'); return; }
    if (chapters.length === 0) { agentNotify('⚠ 没有选中章节', 'warn'); return; }
    const settings = extension_settings[extensionName];
    const perGraph = Math.max(1, Math.min(20, parseInt(settings.graphChaptersPerGraph) || 1));
    const graphMap = settings.chapterGraphMap || {};
    const pendingChapters = chapters.filter(chapter => !graphMap[chapter.id]);
    const groups = [];
    for (let i = 0; i < pendingChapters.length; i += perGraph) groups.push(pendingChapters.slice(i, i + perGraph));
    if (groups.length === 0) { agentNotify('ℹ 所选章节均已有图谱', 'info'); return; }

    isGeneratingGraph = true;
    stopGenerateFlag = false;
    setButtonDisabled('.quick-btn', true);
    $('.quick-btn[data-action="stop"]').prop('disabled', false);

    const taskId = agentTaskStart(`开始生成图谱（共 ${groups.length} 组，覆盖 ${pendingChapters.length} 章）`);
    let successCount = 0, coveredCount = 0;

    try {
      for (let i = 0; i < groups.length; i++) {
        if (stopGenerateFlag) break;
        const group = groups[i];
        const groupNum = i + 1;
        agentTaskProgress(taskId, groupNum - 1, groups.length, `正在生成第 ${groupNum}/${groups.length} 组图谱...`);
        const firstChapter = group[0];
        const lastChapter = group[group.length - 1];
        const mergedChapter = {
          id: firstChapter.id,
          title: group.length > 1 ? `${firstChapter.title} 至 ${lastChapter.title}` : firstChapter.title,
          content: group.map(chapter => `【${chapter.title}】\n${chapter.content}`).join('\n\n')
        };
        const graphData = await generateSingleChapterGraph(mergedChapter);
        if (graphData) {
          group.forEach(chapter => { graphMap[chapter.id] = graphData; });
          successCount++;
          coveredCount += group.length;
        }
        if (i < groups.length - 1 && !stopGenerateFlag) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      extension_settings[extensionName].chapterGraphMap = graphMap;
      saveSettingsDebounced();
      renderChapterList(currentParsedChapters);
      updateStats();
      if (stopGenerateFlag) agentTaskEnd(taskId, `已停止（完成 ${successCount}/${groups.length} 组）`, 'warn');
      else agentTaskEnd(taskId, `✅ 图谱生成完成：${successCount} 组覆盖 ${coveredCount} 章`, 'success');
    } catch (error) {
      console.error('批量生成图谱失败:', error);
      agentTaskEnd(taskId, `❌ 图谱生成失败：${error.message}`, 'error');
    } finally {
      isGeneratingGraph = false;
      stopGenerateFlag = false;
      setButtonDisabled('.quick-btn', false);
      $('.quick-btn[data-action="stop"]').prop('disabled', true);
    }
  }

  async function batchMergeGraphs() {
    const graphMap = extension_settings[extensionName].chapterGraphMap || {};
    const sortedChapters = [...currentParsedChapters].sort((a, b) => a.id - b.id);
    const graphList = [...new Set(sortedChapters.map(chapter => graphMap[chapter.id]).filter(Boolean))];
    if (graphList.length === 0) { agentNotify('⚠ 没有可合并的图谱', 'warn'); return; }
    const batchCount = 50;
    batchMergedGraphs = [];
    const settings = extension_settings[extensionName];
    settings.batchMergedGraphs = batchMergedGraphs;
    saveSettingsDebounced();

    const batches = [];
    for (let i = 0; i < graphList.length; i += batchCount) batches.push(graphList.slice(i, i + batchCount));

    isGeneratingGraph = true;
    stopGenerateFlag = false;
    setButtonDisabled('.quick-btn', true);
    $('.quick-btn[data-action="stop"]').prop('disabled', false);

    const taskId = agentTaskStart(`开始分批合并，共 ${batches.length} 个批次`);
    let successCount = 0;

    try {
      for (let i = 0; i < batches.length; i++) {
        if (stopGenerateFlag) break;
        const batch = batches[i];
        const batchNum = i + 1;
        agentTaskProgress(taskId, batchNum - 1, batches.length, `正在合并第 ${batchNum}/${batches.length} 批...`);
        const systemPrompt = PromptConstants.BATCH_MERGE_GRAPH_SYSTEM_PROMPT;
        const userPrompt = `待合并的批次${batchNum}章节图谱列表：\n${JSON.stringify(batch, null, 2)}`;
        try {
          const result = await generateRawWithBreakLimit({ systemPrompt, prompt: userPrompt, jsonSchema: PromptConstants.mergeGraphJsonSchema });
          const batchMergedGraph = JSON.parse(result.trim());
          batchMergedGraph.batchInfo = {
            batchNumber: batchNum, totalBatches: batches.length,
            startChapterId: sortedChapters[i * batchCount].id,
            endChapterId: sortedChapters[Math.min((i + 1) * batchCount - 1, sortedChapters.length - 1)].id,
            chapterCount: batch.length
          };
          batchMergedGraphs.push(batchMergedGraph);
          successCount++;
          settings.batchMergedGraphs = batchMergedGraphs;
          saveSettingsDebounced();
        } catch (parseError) {
          console.error(`批次${batchNum}合并失败:`, parseError);
        }
        if (i < batches.length - 1 && !stopGenerateFlag) {
          await new Promise(resolve => setTimeout(resolve, TIME_CONSTANTS.BATCH_MERGE_DELAY));
        }
      }
      if (stopGenerateFlag) agentTaskEnd(taskId, `已停止（完成 ${successCount}/${batches.length} 批）`, 'warn');
      else agentTaskEnd(taskId, `✅ 分批合并完成：共 ${successCount} 个批次`, 'success');
    } catch (error) {
      console.error('分批合并失败:', error);
      agentTaskEnd(taskId, `❌ 分批合并失败：${error.message}`, 'error');
    } finally {
      isGeneratingGraph = false;
      stopGenerateFlag = false;
      setButtonDisabled('.quick-btn', false);
      $('.quick-btn[data-action="stop"]').prop('disabled', true);
    }
  }

  async function mergeAllGraphs() {
    const batchGraphs = extension_settings[extensionName].batchMergedGraphs || [];
    let graphList = [];
    let mergeType = "全量章节";
    if (batchGraphs.length > 0) { graphList = batchGraphs; mergeType = "批次合并结果"; }
    else {
      const graphMap = extension_settings[extensionName].chapterGraphMap || {};
      graphList = [...new Set(Object.values(graphMap))];
    }
    if (graphList.length === 0) { agentNotify('⚠ 没有可合并的图谱', 'warn'); return; }

    setButtonDisabled('.quick-btn', true);
    $('.quick-btn[data-action="stop"]').prop('disabled', false);
    stopGenerateFlag = false;

    const taskId = agentTaskStart(`开始合并${mergeType}（${graphList.length} 组）`);
    const systemPrompt = PromptConstants.MERGE_ALL_GRAPH_SYSTEM_PROMPT;
    const userPrompt = `待合并的${mergeType}图谱列表：\n${JSON.stringify(graphList, null, 2)}`;

    try {
      agentTaskProgress(taskId, 0, 1, '正在合并...');
      const result = await generateRawWithBreakLimit({ systemPrompt, prompt: userPrompt, jsonSchema: PromptConstants.mergeGraphJsonSchema });
      const mergedGraph = JSON.parse(result.trim());
      extension_settings[extensionName].mergedGraph = mergedGraph;
      saveSettingsDebounced();
      refreshGraphPanel();
      updateStats();
      agentTaskEnd(taskId, `✅ 全量知识图谱合并完成（基于 ${mergeType}）`, 'success');
    } catch (error) {
      console.error('图谱合并失败:', error);
      agentTaskEnd(taskId, `❌ 合并失败：${error.message}`, 'error');
    } finally {
      setButtonDisabled('.quick-btn', false);
      $('.quick-btn[data-action="stop"]').prop('disabled', true);
      stopGenerateFlag = false;
    }
  }

  // ============ 前置校验 ============
  async function validateContinuePrecondition(baseChapterId, modifiedChapterContent = null) {
    const graphMap = extension_settings[extensionName].chapterGraphMap || {};
    const baseId = parseInt(baseChapterId);
    const preChapters = currentParsedChapters.filter(chapter => chapter.id <= baseId && chapter.id >= (baseId - 5));
    const preGraphList = [...new Set(preChapters.map(chapter => graphMap[chapter.id]).filter(Boolean))];

    if (preGraphList.length === 0 && modifiedChapterContent) {
      const tempChapter = { id: baseId, title: `临时基准章节${baseId}`, content: modifiedChapterContent };
      const tempGraph = await generateSingleChapterGraph(tempChapter);
      if (tempGraph) preGraphList.push(tempGraph);
    }
    if (preGraphList.length === 0) {
      return {
        isPass: true, preGraph: {}, report: "无前置图谱数据",
        redLines: "无明确人设红线", forbiddenRules: "无明确设定禁区",
        foreshadowList: "无明确可呼应伏笔", conflictWarning: "无潜在矛盾预警"
      };
    }
    const systemPrompt = PromptConstants.getPrecheckSystemPrompt(baseId);
    const userPrompt = `基准章节ID：${baseId} 知识图谱：${JSON.stringify(preGraphList, null, 2)} 魔改内容：${modifiedChapterContent || "无"}`;
    try {
      const result = await generateRawWithBreakLimit({ systemPrompt, prompt: userPrompt, jsonSchema: PromptConstants.PRECHECK_JSON_SCHEMA });
      let precheckResult;
      try { precheckResult = JSON.parse(result.trim()); }
      catch (parseError) {
        return { isPass: true, preGraph: {}, report: "前置校验解析失败", redLines: "无", forbiddenRules: "无", foreshadowList: "无", conflictWarning: "无" };
      }
      currentPrecheckResult = precheckResult;
      extension_settings[extensionName].precheckReport = precheckResult;
      saveSettingsDebounced();
      return {
        isPass: precheckResult.isPass,
        preGraph: precheckResult.preMergedGraph,
        report: `校验结果：${precheckResult.isPass ? "通过" : "不通过"}`,
        redLines: precheckResult["人设红线清单"],
        forbiddenRules: precheckResult["设定禁区清单"],
        foreshadowList: precheckResult["可呼应伏笔清单"],
        conflictWarning: precheckResult["潜在矛盾预警"]
      };
    } catch (error) {
      console.error('前置校验失败:', error);
      return { isPass: true, preGraph: {}, report: "前置校验执行失败", redLines: "无", forbiddenRules: "无", foreshadowList: "无", conflictWarning: "无" };
    }
  }

  // ============ 图谱校验 ============
  async function validateGraphCompliance() {
    const mergedGraph = extension_settings[extensionName].mergedGraph || {};
    const fullRequiredFields = PromptConstants.mergeGraphJsonSchema.value.required;
    const singleRequiredFields = PromptConstants.graphJsonSchema.value.required;
    let isFullGraph = true;
    let missingFields = fullRequiredFields.filter(field => !Object.hasOwn(mergedGraph, field));
    if (missingFields.length > 0) {
      isFullGraph = false;
      missingFields = singleRequiredFields.filter(field => !Object.hasOwn(mergedGraph, field));
    }
    const graphJsonString = JSON.stringify(mergedGraph, null, 2);
    const graphWordCount = graphJsonString.length;
    const minWordCount = 1200;
    let result = "", isPass = false;
    if (missingFields.length > 0) {
      result = `❌ 缺少字段：${missingFields.join('、')}`;
      isPass = false;
    } else if (graphWordCount < minWordCount) {
      result = `❌ 字数不足（${graphWordCount}/${minWordCount}）`;
      isPass = false;
    } else {
      result = `✅ 校验通过，字段完整，字数：${graphWordCount} 字`;
      isPass = true;
    }
    const $r = $('#graph-validate-result');
    $r.text(result).show();
    $r.toggleClass('pass', isPass).toggleClass('fail', !isPass);
    agentNotify(result, isPass ? 'success' : 'warn');
    return isPass;
  }

  function validateChapterGraphStatus() {
    const graphMap = extension_settings[extensionName].chapterGraphMap || {};
    if (currentParsedChapters.length === 0) { agentNotify('⚠ 请先上传小说', 'warn'); return; }
    let hasGraphCount = 0;
    currentParsedChapters.forEach(chapter => {
      const hasGraph = !!graphMap[chapter.id];
      chapter.hasGraph = hasGraph;
      if (hasGraph) hasGraphCount++;
    });
    renderChapterList(currentParsedChapters);
    const total = currentParsedChapters.length;
    agentNotify(`📊 检验完成：${hasGraphCount}/${total} 章已有图谱`, 'info');
  }

  // ============ 更新图谱 ============
  async function updateModifiedChapterGraph(chapterId, modifiedContent) {
    const targetChapter = currentParsedChapters.find(item => item.id === parseInt(chapterId));
    if (!targetChapter) { agentNotify('❌ 目标章节不存在', 'error'); return null; }
    if (!modifiedContent.trim()) { agentNotify('❌ 章节内容不能为空', 'error'); return null; }
    const systemPrompt = PromptConstants.getSingleChapterGraphPrompt({id: targetChapter.id, content: modifiedContent}, true);
    const userPrompt = `章节标题：${targetChapter.title}\n章节内容：${modifiedContent}`;
    try {
      agentNotify('正在更新图谱...', 'info');
      const result = await generateRawWithBreakLimit({ systemPrompt, prompt: userPrompt, jsonSchema: PromptConstants.graphJsonSchema });
      let graphData;
      try { graphData = JSON.parse(result.trim()); }
      catch (parseError) { agentNotify('❌ 图谱数据解析失败', 'error'); return null; }
      const graphMap = extension_settings[extensionName].chapterGraphMap || {};
      graphMap[chapterId] = graphData;
      extension_settings[extensionName].chapterGraphMap = graphMap;
      targetChapter.content = modifiedContent;
      extension_settings[extensionName].chapterList = currentParsedChapters;
      saveSettingsDebounced();
      renderChapterList(currentParsedChapters);
      updateStats();
      agentNotify('✅ 图谱更新完成', 'success');
      return graphData;
    } catch (error) {
      agentNotify(`❌ 更新失败：${error.message}`, 'error');
      return null;
    }
  }

  async function updateGraphWithContinueContent(continueChapter, continueId) {
    const systemPrompt = PromptConstants.CONTINUE_CHAPTER_GRAPH_SYSTEM_PROMPT;
    const userPrompt = `章节标题：续写章节${continueId}\n章节内容：${continueChapter.content}`;
    try {
      const result = await generateRawWithBreakLimit({ systemPrompt, prompt: userPrompt, jsonSchema: PromptConstants.graphJsonSchema });
      const graphData = JSON.parse(result.trim());
      const graphMap = extension_settings[extensionName].chapterGraphMap || {};
      graphMap[`continue_${continueId}`] = graphData;
      extension_settings[extensionName].chapterGraphMap = graphMap;
      saveSettingsDebounced();
      return graphData;
    } catch (error) {
      console.error('续写章节图谱更新失败:', error);
      return null;
    }
  }

  // ============ 续写生成 ============
  async function generateNovelWrite(selectedChapterId, wordCount, chapterCount, extraDirectives) {
    // bug7：隐藏输入可能不存在，安全读取并兜底
    const $wc = $('#write-word-count');
    const hiddenWc = ($wc && $wc.length && typeof $wc.val === 'function') ? parseInt($wc.val(), 10) : NaN;
    wordCount = wordCount || hiddenWc || 2000;
    chapterCount = Math.max(1, Math.min(20, chapterCount || 1));
    // B11：隐藏输入可能不存在，安全读取并兜底（不用可选链，兼容旧内核 WebView）
    const $wcEl = $('#write-chapter-content');
    const editedChapterContent = ($wcEl && $wcEl.length) ? String($wcEl.val() || '').trim() : '';
    const mergedGraph = extension_settings[extensionName].mergedGraph || {};

    if (isGeneratingWrite) { agentNotify('⚠ 续写正在进行中', 'warn'); return; }
    if (!selectedChapterId) { agentNotify('❌ 请先在左侧选择基准章节', 'error'); return; }
    if (!editedChapterContent) { agentNotify('❌ 基准章节内容为空', 'error'); return; }

    isGeneratingWrite = true;
    stopGenerateFlag = false;
    setButtonDisabled('.quick-btn', true);
    $('.quick-btn[data-action="stop"]').prop('disabled', false);

    // bug2：预设参数只取一次（每次续写任务一次，而非每次 AI 调用一次），并打上注入标记避免内部重复读取
    const presetParams = getActivePresetParams();
    const presetInjected = { ...presetParams, __presetInjected: true };

    const taskId = agentTaskStart(`正在执行续写前置校验...`);

    try {
      const baseChapterId = parseInt(selectedChapterId);
      // 需求一/1：前置校验可关闭
      const settings = extension_settings[extensionName];
      let precheckResult;
      if (settings.enablePrecheck !== false) {
        precheckResult = await validateContinuePrecondition(selectedChapterId, editedChapterContent);
      } else {
        precheckResult = {
          isPass: true, preGraph: {},
          redLines: '无', forbiddenRules: '无',
          foreshadowList: '无', conflictWarning: '无',
          report: '前置校验已关闭'
        };
      }

      let useGraph = {};
      if (Object.keys(mergedGraph).length > 0) useGraph = PromptConstants.filterGraphByTimeline(mergedGraph, baseChapterId);
      if (Object.keys(precheckResult.preGraph || {}).length > 0) {
        useGraph = PromptConstants.filterGraphByTimeline(precheckResult.preGraph, baseChapterId);
      }

      if (stopGenerateFlag) { agentTaskEnd(taskId, '已停止', 'warn'); return; }

      const isTimelineSafeMode = Object.keys(useGraph).length > 0 && baseChapterId > 0;
      const runStartChainLength = continueWriteChain.length;
      let generatedCount = 0;
      let currentBaseContent = editedChapterContent;
      let activeStreamCard = null;  // 5.0/流式：当前续写卡片，异常/停止时收尾

      for (let chapterRound = 0; chapterRound < chapterCount; chapterRound++) {
        if (stopGenerateFlag) break;
        const roundNumber = chapterRound + 1;
        const roundInfo = chapterCount > 1 ? `（${roundNumber}/${chapterCount}）` : '';
        const baseChapterObj = currentParsedChapters.find(c => c.id === baseChapterId);
        const currentBaseTitle = chapterRound === 0
          ? (baseChapterObj ? baseChapterObj.title : '基准章节')
          : `续写章节 ${continueWriteChain.length}`;

        const baseParagraphs = currentBaseContent.split('\n').filter(p => p.trim() !== '');
        const baseLastParagraph = baseParagraphs.length > 0 ? baseParagraphs[baseParagraphs.length - 1].trim() : '';

        let fullContextContent = '';
        const preBaseChapters = currentParsedChapters.filter(chapter => chapter.id < baseChapterId && chapter.id >= (baseChapterId - 2));
        preBaseChapters.forEach(chapter => { fullContextContent += `${chapter.title}\n${chapter.content}\n\n`; });
        fullContextContent += `${currentBaseTitle}\n${currentBaseContent}\n\n`;
        const runChapters = continueWriteChain.slice(runStartChainLength);
        runChapters.forEach((chapter, idx) => {
          fullContextContent += `续写章节 ${runStartChainLength + idx + 1}\n${chapter.content}\n\n`;
        });

        let systemPrompt, userPrompt;
        if (isTimelineSafeMode) {
          systemPrompt = PromptConstants.getTimelineSafeWriteSystemPrompt({
            redLines: precheckResult.redLines,
            forbiddenRules: precheckResult.forbiddenRules,
            baseLastParagraph,
            foreshadowList: precheckResult.foreshadowList,
            wordCount,
            conflictWarning: precheckResult.conflictWarning,
            baseChapterId
          });
          userPrompt = `小说核心设定知识图谱（仅包含第${baseChapterId}章及之前的剧情）：${JSON.stringify(useGraph)} 前文上下文：${fullContextContent} 请基于以上内容续写后续章节。`;
        } else {
          systemPrompt = PromptConstants.getNovelWriteSystemPrompt({
            redLines: precheckResult.redLines,
            forbiddenRules: precheckResult.forbiddenRules,
            baseLastParagraph,
            foreshadowList: precheckResult.foreshadowList,
            wordCount,
            conflictWarning: precheckResult.conflictWarning
          });
          userPrompt = `小说核心设定知识图谱：${JSON.stringify(useGraph)} 前文上下文：${fullContextContent} 请基于以上内容续写后续章节。`;
        }

        if (extraDirectives && String(extraDirectives).trim()) {
          userPrompt += `\n【用户补充写作要求（必须严格遵守）】${String(extraDirectives).trim()}`;
        }
        agentTaskProgress(taskId, chapterRound, chapterCount, `正在生成续写章节${roundInfo}...`);
        // 5.0/流式：宿主支持流式时逐 token 回显；不支持则回调不触发，退化为普通等待
        activeStreamCard = settings.enableStreaming !== false ? agentStreamCard(`续写章节${roundInfo}`) : null;
        const streamOnChunk = activeStreamCard ? (text) => { try { activeStreamCard.update(text); } catch (_) {} } : undefined;
        let continueContent = await generateRawWithBreakLimit({ systemPrompt, prompt: userPrompt, ...presetInjected, onStream: streamOnChunk });
        if (stopGenerateFlag) { if (activeStreamCard) activeStreamCard.fail('已停止'); agentTaskEnd(taskId, '已停止', 'warn'); return; }
        if (!continueContent.trim()) throw new Error('生成内容为空');
        continueContent = continueContent.trim();

        // 需求一/3 + 四/B1：续写质量门（轻量检查，不引入额外 AI 审阅调用）——拒绝回复 / 字数不足 → 带反馈重写，最多 2 次
        if (settings.enableWriteQualityGate !== false) {
          const minChars = Math.max(100, parseInt(settings.writeQualityMinChars, 10) || 300);
          let gateIssue = '';
          if (REJECT_KEYWORDS.some(k => continueContent.includes(k)) && continueContent.length < minChars) {
            gateIssue = '输出疑似拒绝回复';
          } else if (continueContent.length < minChars) {
            gateIssue = `字数不足（${continueContent.length} < ${minChars}）`;
          }
          if (gateIssue) {
            agentTaskProgress(taskId, chapterRound, chapterCount, `质量门未通过（${gateIssue}），正在重写...`);
            let gateAttempt = 0;
            while (gateAttempt < 2 && !stopGenerateFlag) {
              const fixPrompt = userPrompt + `\n【质量门修正】上次输出未达标：${gateIssue}。请重新生成完整的小说正文，务必达到 ${minChars} 字以上，且不得出现拒绝类表述。`;
              const retryContent = String(await generateRawWithBreakLimit({ systemPrompt, prompt: fixPrompt, ...presetInjected, onStream: streamOnChunk }) || '').trim();
              let retryIssue = '';
              if (!retryContent) retryIssue = '内容为空';
              else if (REJECT_KEYWORDS.some(k => retryContent.includes(k)) && retryContent.length < minChars) retryIssue = '输出疑似拒绝回复';
              else if (retryContent.length < minChars) retryIssue = `字数不足（${retryContent.length} < ${minChars}）`;
              if (!retryIssue) { continueContent = retryContent; break; }
              gateIssue = retryIssue;
              gateAttempt++;
            }
            if (stopGenerateFlag) { agentTaskEnd(taskId, '已停止', 'warn'); return; }
          }
        }

        const newChapter = {
          id: continueChapterIdCounter++,
          title: `续写章节 ${continueWriteChain.length + 1}`,
          content: continueContent,
          baseChapterId
        };
        continueWriteChain.push(newChapter);
        extension_settings[extensionName].continueWriteChain = continueWriteChain;
        extension_settings[extensionName].continueChapterIdCounter = continueChapterIdCounter;
        saveSettingsDebounced();

        // B5：回填续写章节图谱改为可选（默认关闭，每章一次 AI 调用成本高；开启见设置）
        if (extension_settings[extensionName].enableContinueGraphBackfill === true) {
          try {
            await updateGraphWithContinueContent(newChapter, newChapter.id);
          } catch (e) {
            logWarn('graph-backfill', e);
          }
        }
        renderChapterList(currentParsedChapters);
        updateStats();
        if (activeStreamCard) { activeStreamCard.finish(`已生成 ${continueContent.length} 字，章节 id=${newChapter.id}，可在阅读器查看`); activeStreamCard = null; }
        generatedCount++;
        currentBaseContent = continueContent;
        // 需求四/B2：长任务 checkpoint —— 每章结束后写入（progress 为已完成章数），刷新页面可恢复续写
        extension_settings[extensionName].agentCheckpoint = {
          taskId, step: chapterRound + 1, ts: Date.now(),
          payload: { baseChapterId, wordCount, chapterCount, extraDirectives: extraDirectives || '', progress: generatedCount }
        };
        saveSettingsDebounced();
      }

      const completionMessage = isTimelineSafeMode
        ? `✅ 续写完成（时间线安全），共生成 ${generatedCount} 章`
        : `✅ 续写完成，共生成 ${generatedCount} 章`;
      agentTaskEnd(taskId, completionMessage, 'success');
      // 任务完成：记录任务历史 + 清除断点
      recordTaskHistory(`续写《${extension_settings[extensionName].currentNovelName || '当前小说'}》：${generatedCount} 章（基准第 ${baseChapterId} 章，每章约 ${wordCount} 字）`);
      extension_settings[extensionName].agentCheckpoint = null;
      saveSettingsDebounced();

      // 自动切到阅读面板，展示最新续写结果
      if (generatedCount > 0) {
        const lastChapter = continueWriteChain[continueWriteChain.length - 1];
        switchTab('reader');
        loadChapterToReader(lastChapter.id, 'continue');
      }
    } catch (error) {
      if (activeStreamCard) { try { activeStreamCard.fail(error && error.message ? error.message : '生成失败'); } catch (_) {} activeStreamCard = null; }
      if (!stopGenerateFlag) {
        console.error('续写生成失败:', error);
        agentTaskEnd(taskId, `❌ 生成失败：${error.message}`, 'error');
      }
    } finally {
      isGeneratingWrite = false;
      stopGenerateFlag = false;
      setButtonDisabled('.quick-btn', false);
      $('.quick-btn[data-action="stop"]').prop('disabled', true);
    }
  }

  function renderCommandTemplate(template, charName, chapterContent) {
    const escapedContent = chapterContent.replace(/"/g, '\\"').replace(/\|/g, '\\|');
    return template.replace(/{{char}}/g, charName || '角色').replace(/{{pipe}}/g, escapedContent);
  }

  // ============ 剪贴板 ============
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const textArea = getDoc().createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-99999px';
      getDoc().body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const result = getDoc().execCommand('copy');
      getDoc().body.removeChild(textArea);
      return result;
    } catch (error) { return false; }
  }

  // ============================================================
  // ▌Agent 引擎：工具层 + 记忆 + 图谱检索 + ReAct 主循环（新增）
  // ============================================================
  const AGENT_CFG = {
    MAX_STEPS: 12,
    MAX_HISTORY_TURNS: 6,
    MAX_MEMORY_ITEMS: 14,
    MAX_TOOL_LOG: 30,
    // 5.0：记忆压缩保留最近条数；上下文预算默认 token 数；单条观察字符上限
    MEMORY_KEEP_TAIL: 8,
    MEMORY_SUMMARIZE_MIN: 3,
    DEFAULT_CONTEXT_BUDGET: 24000,
    OBSERVATION_CHAR_LIMIT: 6000
  };

  // 5.0：工具读写分类 —— 只读工具允许单步并行；写/破坏性工具必须规划后串行执行
  const READ_ONLY_TOOLS = new Set(['get_state', 'list_chapters', 'read_chapter', 'search_graph', 'graph_status', 'open_view', 'save_memory', 'recall_task', 'forget_memory', 'export_project']);
  const WRITE_TOOLS = new Set(['generate_graph', 'merge_graphs', 'precheck', 'write_chapters', 'update_chapter_content', 'rename_chapter', 'delete_continue_chapter', 'set_settings']);
  function isReadOnlyTool(name) { return READ_ONLY_TOOLS.has(name) && !(TOOLS[name] && TOOLS[name].danger); }

  // 5.0/预算：粗估 token —— CJK 字符约 1 token，其余按每 3.5 字符 1 token
  function estimateTokens(text) {
    const s = String(text || '');
    let cjk = 0, other = 0;
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xFF00 && code <= 0xFFEF)) cjk++;
      else other++;
    }
    return Math.ceil(cjk + other / 3.5);
  }

  // 5.0/预算：超预算时按「工具观察类消息 → 最早的普通消息」顺序裁剪，始终保留最后一条（当前指令）与首条用户任务
  function trimMessagesToBudget(messages, budgetTokens, systemTokens) {
    const list = (messages || []).slice();
    const budget = Math.max(2000, budgetTokens || AGENT_CFG.DEFAULT_CONTEXT_BUDGET) - (systemTokens || 0);
    const totalTokens = () => list.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const isToolNoise = (m) => m && m.role === 'user' && /^\[(工具|工具结果|并行工具返回|并行被拒绝|规划门|系统拦截|用户确认|解析失败)/.test(String(m.content || '').slice(0, 20));
    const isProtected = (idx) => idx === list.length - 1 || idx === 0;
    let guard = 0;
    while (totalTokens() > budget && guard++ < 200) {
      let removed = false;
      // 第一轮：先删最旧的工具观察
      for (let i = 0; i < list.length - 1; i++) {
        if (!isProtected(i) && isToolNoise(list[i])) { list.splice(i, 1); removed = true; break; }
      }
      if (removed) continue;
      // 第二轮：删最旧的非保护消息
      for (let i = 0; i < list.length - 1; i++) {
        if (!isProtected(i)) { list.splice(i, 1); removed = true; break; }
      }
      if (!removed) break;
    }
    return list;
  }

  // 5.0/规划：Plan-Execute 两阶段门控 —— 未输出 plan 且尚未提醒过时，拦截首个重型写工具，要求先探查再规划
  const PLAN_GATE_TOOLS = new Set(['generate_graph', 'merge_graphs', 'write_chapters']);
  function planGateDecision(ctx) {
    const step = ctx.step || 0;
    if (ctx.planGateDisabled || ctx.planReady || ctx.planNudged) return { gate: false };
    if (step > 2) return { gate: false }; // 兜底：第三步起不再拦截，避免死锁
    if (PLAN_GATE_TOOLS.has(ctx.toolName)) {
      return { gate: true, reason: '执行「' + ctx.toolName + '」这类重型任务前，请先用 get_state / list_chapters / graph_status 探查现状，并在本步输出 plan 数组（字符串数组的任务分解），随后再逐步执行。' };
    }
    return { gate: false };
  }

  // 5.0/观察：为工具成功结果生成「下一步提示」，减少模型猜测
  function buildObservationHint(toolName, result) {
    const g = graphCoverageStatsCached();
    switch (toolName) {
      case 'get_state':
        if (g.total === 0) return '当前没有小说，请提示用户上传 TXT，或等待用户上传后再行动。';
        if (!g.hasMerged && g.total > 0) return '尚无合并图谱：续写多章前建议先 generate_graph（缺 ' + g.missing + ' 章）再 merge_graphs；用户明确要求快速续写时可直接 write_chapters。';
        if (g.missing > 0) return '仍有 ' + g.missing + ' 章缺图谱，可先 generate_graph 补齐；若用户只要求续写，可直接定位基准章节调用 write_chapters。';
        return '图谱齐备，可用 list_chapters 定位基准章节后 write_chapters。';
      case 'list_chapters':
        return '选定基准章节后，把其 id 作为 write_chapters.chapterId；续写多章用 chapterCount。';
      case 'read_chapter':
        return '确认该章为续写基准后调用 write_chapters；如需把握全局设定先 search_graph。';
      case 'search_graph':
        return '若结果为空，换关键词或先 merge_graphs；拿到设定后即可 write_chapters。';
      case 'graph_status':
        if (g.total === 0) return '请先提示用户上传小说。';
        if (g.missing > 0) return '调用 generate_graph 补齐缺失章节图谱。';
        if (!g.hasMerged) return '章节图谱已齐，调用 merge_graphs 生成全局合并图谱。';
        return '图谱已就绪，可定位基准章节并 write_chapters。';
      case 'generate_graph':
        return g.hasMerged ? '新图谱已生成，若改动较大可再次 merge_graphs，然后续写。' : '图谱生成完成，下一步调用 merge_graphs。';
      case 'merge_graphs':
        return '合并图谱已就绪，下一步用 list_chapters 定位基准章节并 write_chapters。';
      case 'precheck':
        return result && result.isPass === false ? '前置校验未通过：按报告中的红线/矛盾调整 directives，或先与用户确认，再决定是否 write_chapters。' : '前置校验通过，可调用 write_chapters 开始续写。';
      case 'write_chapters':
        return '可用 open_view(view=reader, chapterId=最新id) 打开阅读，或继续 write_chapters 写下一章；任务全部完成后用 final 汇报。';
      case 'save_memory':
      case 'set_settings':
        return '设置/记忆已生效，继续执行原任务的下一步。';
      case 'delete_continue_chapter':
      case 'update_chapter_content':
      case 'rename_chapter':
        return '章节已变更，必要时用 list_chapters 刷新章节认知，再继续。';
      case 'export_project':
        return '告知用户导出结果与保存位置，然后用 final 收尾。';
      case 'open_view':
      case 'recall_task':
      case 'forget_memory':
        return '';
      default:
        return '';
    }
  }

  const agentState = {
    running: false,
    currentPlan: [],
    toolLog: [],
    runId: 0,
    // 需求四/B3：未完成任务的上文（允许「继续」续跑）
    pendingMessages: null,
    // 需求四/A：危险工具确认等待中的 Promise
    pendingConfirm: null,
    // B1：最近工具调用签名（重复调用检测）
    recentCalls: [],
    // 完全 Agent：连续失败步数（无进展检测，达到阈值主动中止）
    noProgressStreak: 0
  };

  // ---------- 长期记忆（localStorage，Agent 启动时注入 system） ----------
  function getAgentMemory() {
    const m = extension_settings[extensionName].agentMemory || {};
    return {
      preferences: Array.isArray(m.preferences) ? m.preferences : [],
      facts: Array.isArray(m.facts) ? m.facts : [],
      // 需求四/C：任务历史，记录上次做到哪一步
      taskHistory: Array.isArray(m.taskHistory) ? m.taskHistory : []
    };
  }
  function recordTaskHistory(text) {
    const mem = getAgentMemory();
    mem.taskHistory.push({ text: String(text), time: Date.now() });
    if (mem.taskHistory.length > AGENT_CFG.MAX_MEMORY_ITEMS) scheduleMemoryCompaction();
    saveAgentMemory(mem);
  }
  function saveAgentMemory(mem) {
    extension_settings[extensionName].agentMemory = mem;
    saveSettingsDebounced();
    renderStatusPanel();
  }

  // 5.0/记忆：纯函数 —— 计算哪些旧记忆需要 AI 摘要、哪些近期保留
  function planMemoryCompaction(list, maxItems, keepTail) {
    if (!Array.isArray(list) || list.length <= maxItems) return null;
    const cutoff = list.length - keepTail;
    if (cutoff < AGENT_CFG.MEMORY_SUMMARIZE_MIN) return { older: [], keep: list.slice(cutoff) };
    return { older: list.slice(0, cutoff), keep: list.slice(cutoff) };
  }

  // 5.0/记忆：超阈值时让模型把旧记忆压缩为一条摘要（失败回退直接丢弃最旧），不再无脑 shift
  async function compactMemoryKind(kind) {
    const labelMap = { preferences: '用户偏好', facts: '设定事实', taskHistory: '历史任务' };
    const label = labelMap[kind] || '记忆';
    const mem = getAgentMemory();
    const list = mem[kind];
    const plan = planMemoryCompaction(list, AGENT_CFG.MAX_MEMORY_ITEMS, AGENT_CFG.MEMORY_KEEP_TAIL);
    if (!plan) return false;
    let nextList;
    if (plan.older.length) {
      try {
        const itemsText = plan.older.map((x, i) => `${i + 1}. ${x.text}`).join('\n');
        const summary = String(await generateRawWithBreakLimit({
          systemPrompt: `你是记忆压缩助手。把以下多条${label}去重、合并为一段不超过 200 字的中文摘要，保留所有仍然有效的关键信息，丢弃重复与过时内容。只输出摘要正文，不要解释。`,
          prompt: itemsText
        }) || '').trim();
        if (!summary) throw new Error('摘要为空');
        nextList = [{ text: `【历史${label}摘要】${summary}`, time: Date.now(), summarized: true }].concat(plan.keep);
      } catch (e) {
        logWarn('memory-compact', e);
        nextList = plan.keep;  // AI 压缩失败：回退为仅保留近期记忆
      }
    } else {
      nextList = plan.keep;
    }
    const fresh = getAgentMemory();
    fresh[kind] = nextList;
    saveAgentMemory(fresh);
    return true;
  }

  let _memCompactTimer = null;
  function scheduleMemoryCompaction() {
    if (_memCompactTimer) return;
    _memCompactTimer = setTimeout(async () => {
      _memCompactTimer = null;
      for (const kind of ['preferences', 'facts', 'taskHistory']) {
        try { await compactMemoryKind(kind); } catch (e) { logWarn('memory-compact', e); }
      }
    }, 1500);
  }

  function rememberPreference(text) {
    const mem = getAgentMemory();
    const clean = String(text);
    // bug21：同文本去重，避免同一偏好反复写入
    if (mem.preferences.some(p => p.text === clean)) return;
    mem.preferences.push({ text: clean, time: Date.now() });
    // 5.0/记忆：超阈值改为 AI 摘要压缩（不再无脑丢最早）
    if (mem.preferences.length > AGENT_CFG.MAX_MEMORY_ITEMS) scheduleMemoryCompaction();
    saveAgentMemory(mem);
  }
  function rememberFact(text) {
    const mem = getAgentMemory();
    mem.facts.push({ text: String(text), time: Date.now() });
    if (mem.facts.length > AGENT_CFG.MAX_MEMORY_ITEMS) scheduleMemoryCompaction();
    saveAgentMemory(mem);
  }
  function captureMemoryFromInput(text) {
    const t = String(text || '').trim();
    if (!t) return;
    const captured = [];
    const wm = t.match(/(?:续写|每章|一章)\s*(\d{3,5})\s*字/);
    if (wm) captured.push(`用户偏好每章篇幅约 ${wm[1]} 字`);
    const STYLE_WORDS = ['虐主', '爽文', '感情线', '多女主', '无女主', '单女主', '种田', '升级流', '金手指', '黑暗', '轻松', '搞笑', '严肃', '慢热', '快节奏', '悬疑', '推理', '群像', '第一人称', '第三人称', '不水文', '节奏快点', '细腻', '宏大', '史诗', '文风'];
    for (const w of STYLE_WORDS) {
      if (t.includes(w)) { captured.push(`用户提及风格偏好：「${w}」`); break; }
    }
    const neg = t.match(/(?:不要|别|避免|禁止|别再)([^，。！？,.!?\s]{2,14})/);
    if (neg) captured.push(`用户要求续写时避免：${neg[1]}`);
    if (/记住|记下/.test(t)) {
      const rem = t.replace(/^.*?(记住|记下)\s*[:：]?\s*/, '').replace(/[。！!]+$/, '').trim();
      if (rem && rem.length > 2 && rem.length < 60) captured.push(`用户要求长期记住：${rem}`);
    }
    captured.forEach(rememberPreference);
  }

  // ---------- 图谱检索（返回摘要而非全文，避免上下文膨胀） ----------
  function graphCoverageStats() {
    const graphMap = extension_settings[extensionName].chapterGraphMap || {};
    const total = currentParsedChapters.length;
    let has = 0;
    currentParsedChapters.forEach(c => { if (graphMap[c.id]) has++; });
    const merged = extension_settings[extensionName].mergedGraph || {};
    let mergedKB = 0;
    try { mergedKB = Math.round(new Blob([JSON.stringify(merged)]).size / 1024); } catch (_) {
      // bug15：iframe/SSR 环境 Blob 不可用时，用字符数估算字节
      mergedKB = Math.round(JSON.stringify(merged).length * 2 / 1024);
    }
    return {
      total, has, missing: total - has,
      percent: total ? Math.round(has / total * 100) : 0,
      hasMerged: Object.keys(merged).length > 0,
      mergedKB
    };
  }

  // B6：图谱覆盖率统计加短 TTL 缓存（buildAgentSystemPrompt / renderStatusPanel / updateStats 每步都调用，避免 O(n) 遍历 + 大图谱序列化）
  let _graphStatsCache = { ts: 0, data: null, sig: '' };
  function graphCoverageStatsCached() {
    const map = extension_settings[extensionName].chapterGraphMap || {};
    const sig = currentParsedChapters.length + ':' + Object.keys(map).length;
    const now = Date.now();
    if (_graphStatsCache.data && _graphStatsCache.sig === sig && now - _graphStatsCache.ts < 3000) {
      return _graphStatsCache.data;
    }
    const data = graphCoverageStats();
    _graphStatsCache = { ts: now, data, sig };
    return data;
  }

  function searchMergedGraph(query) {
    const merged = extension_settings[extensionName].mergedGraph || {};
    if (Object.keys(merged).length === 0) {
      return '尚无合并图谱。可先调用 generate_graph 生成章节图谱，再调用 merge_graphs 合并。';
    }
    const keywords = String(query || '').split(/[\s,，、;；]+/).map(k => k.trim()).filter(k => k.length > 0).slice(0, 8);
    if (keywords.length === 0) return '请提供检索关键词。';
    const kwHit = (v) => keywords.some(k => String(v).toLowerCase().includes(k.toLowerCase()));

    const out = { characters: [], settings: [], events: [], foreshadows: [], relations: [], warnings: [] };

    (Array.isArray(merged['人物信息库']) ? merged['人物信息库'] : []).forEach(ch => {
      if (kwHit(JSON.stringify(ch))) {
        const rels = (Array.isArray(ch['全时间线人物关系网']) ? ch['全时间线人物关系网'] : []).slice(0, 4)
          .map(r => `${r['关系对象'] || '?'}（${r['关系类型'] || '?'}${typeof r['关系强度'] === 'number' ? ' ' + r['关系强度'] : ''}）`).join('；');
        out.characters.push(`${ch['姓名'] || ch['唯一人物ID'] || '?'}：${ch['完整身份/背景'] || ''}；性格：${ch['全本最终性格特征'] || '未知'}；动机：${ch['全本核心动机'] || '未知'}${rels ? '；关系：' + rels : ''}`);
      }
    });

    const ws = merged['世界观设定库'] || {};
    Object.keys(ws).forEach(key => {
      if (key === '全本所有隐藏设定/伏笔汇总') return;
      const v = ws[key];
      if (v != null && kwHit(v)) out.settings.push(`${key}：${String(v).slice(0, 120)}`);
    });

    const tl = merged['全剧情时间线'] || {};
    (Array.isArray(tl['全本关键事件时序表']) ? tl['全本关键事件时序表'] : []).forEach(ev => {
      if (kwHit(JSON.stringify(ev))) out.events.push(`${ev['事件名'] || '?'}（第${ev['发生章节'] || '?'}章）：${String(ev['前因后果'] || '').slice(0, 120)}`);
    });

    (Array.isArray(ws['全本所有隐藏设定/伏笔汇总']) ? ws['全本所有隐藏设定/伏笔汇总'] : []).forEach(fs => {
      if (kwHit(JSON.stringify(fs))) out.foreshadows.push(`${fs['伏笔内容'] || '?'}（出现于第${fs['出现章节'] || '?'}章，状态：${fs['当前回收状态'] || '?'}）`);
    });

    (Array.isArray(merged['全量实体关系网络']) ? merged['全量实体关系网络'] : []).forEach(rel => {
      if (Array.isArray(rel) && rel.some(r => kwHit(r))) out.relations.push(rel.join(' → '));
    });

    const qa = merged['逆向分析与质量评估'] || {};
    if (qa['潜在剧情矛盾预警']) out.warnings.push(String(qa['潜在剧情矛盾预警']).slice(0, 200));
    if (qa['伏笔完整性评估']) out.warnings.push(String(qa['伏笔完整性评估']).slice(0, 200));

    const parts = [];
    const hits = out.characters.length + out.settings.length + out.events.length + out.foreshadows.length + out.relations.length;
    if (hits === 0) parts.push('未检索到与关键词相关的条目，可换关键词或先合并图谱。');
    if (out.characters.length) parts.push('【相关人物】\n' + out.characters.slice(0, 5).join('\n'));
    if (out.settings.length) parts.push('【相关设定】\n' + out.settings.slice(0, 6).join('\n'));
    if (out.events.length) parts.push('【相关事件】\n' + out.events.slice(0, 6).join('\n'));
    if (out.foreshadows.length) parts.push('【相关伏笔】\n' + out.foreshadows.slice(0, 5).join('\n'));
    if (out.relations.length) parts.push('【相关关系】\n' + out.relations.slice(0, 8).join('\n'));
    if (out.warnings.length) parts.push('【风险预警】\n' + out.warnings.slice(0, 3).join('\n'));
    return parts.join('\n\n').slice(0, 2400);
  }

  // ---------- 工具层（JSON Schema 描述 + 压缩返回） ----------
  const TOOLS = {
    get_state: {
      desc: '查看小说当前状态：章节数、图谱覆盖率、是否有合并图谱、续写链长度、当前阅读位置。',
      params: { type: 'object', properties: {} },
      danger: false,
      requireConfirm: false,
      run: async () => {
        const g = graphCoverageStats();
        const readerState = extension_settings[extensionName].readerState || {};
        let reading = '未在阅读';
        if (readerState.currentChapterId != null) {
          const ch = readerState.currentChapterType === 'continue'
            ? continueWriteChain.find(c => c.id === readerState.currentChapterId)
            : currentParsedChapters.find(c => c.id === readerState.currentChapterId);
          if (ch) reading = (readerState.currentChapterType === 'continue' ? '续写章节 ' : '第 ') + ch.id + (readerState.currentChapterType === 'continue' ? '' : ' 章');
        }
        return {
          novel: extension_settings[extensionName].currentNovelName || '未加载',
          chapters: g.total, graphCoverage: g.percent + '%', missingGraphs: g.missing,
          hasMergedGraph: g.hasMerged, mergedGraphKB: g.mergedKB,
          continueChain: continueWriteChain.length,
          reading
        };
      }
    },
    list_chapters: {
      desc: '列出章节清单：id、标题、字数、是否有图谱。用于定位续写基准章节。',
      params: {
        type: 'object',
        properties: {
          range: {
            type: 'string',
            enum: ['all', 'recent', 'missing_graph'],
            description: 'all=全部（默认）；recent=最近 8 章；missing_graph=仅无图谱章节'
          }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        const gmap = extension_settings[extensionName].chapterGraphMap || {};
        let list = currentParsedChapters.map(c => ({ id: c.id, title: c.title, words: c.content.length, hasGraph: !!gmap[c.id] }));
        const range = (args && args.range) || 'all';
        if (range === 'recent') list = list.slice(-8);
        if (range === 'missing_graph') list = list.filter(c => !c.hasGraph);
        if (list.length === 0) return '尚无章节，请先上传小说。';
        const rows = list.slice(0, 60).map(c => `#${c.id} 《${c.title}》 ${c.words}字 ${c.hasGraph ? '图谱✓' : '无图谱'}`);
        if (list.length > 60) rows.push(`...共 ${list.length} 章`);
        return rows.join('\n');
      }
    },
    read_chapter: {
      desc: '读取指定章节完整内容（原始章节 id 为数字）。',
      params: {
        type: 'object',
        required: ['chapterId'],
        properties: {
          chapterId: { type: 'number', description: '章节 id，必填' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        const id = parseInt((args && args.chapterId), 10);
        const ch = currentParsedChapters.find(c => c.id === id);
        if (!ch) return { error: `章节 ${id} 不存在，可用 list_chapters 查看章节列表。` };
        return `《${ch.title}》\n${ch.content.slice(0, 6000)}`;
      }
    },
    search_graph: {
      desc: '在合并知识图谱中检索人物/设定/事件/伏笔/关系，返回摘要而非全文。',
      params: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: '检索关键词，必填' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => searchMergedGraph((args && args.query) || '')
    },
    graph_status: {
      desc: '查看图谱进度：每章是否有图谱、合并图谱是否已生成。',
      params: { type: 'object', properties: {} },
      danger: false,
      requireConfirm: false,
      run: async () => {
        const g = graphCoverageStats();
        if (g.total === 0) return '尚未上传小说。';
        return `共 ${g.total} 章：${g.has} 章已有图谱（${g.percent}%），缺 ${g.missing} 章。` +
          (g.hasMerged ? ` 合并图谱已生成（${g.mergedKB} KB）。` : ' 合并图谱未生成。');
      }
    },
    generate_graph: {
      desc: '为章节生成知识图谱（每章一次 AI 调用，耗时较长）。',
      params: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['missing', 'all', 'selected'],
            description: 'missing=只生成缺失的（默认）；all=全部；selected=已勾选章节'
          },
          chapterIds: { type: 'array', items: { type: 'number' }, description: '可选，指定章节 id 数组' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        const scope = (args && args.scope) || 'missing';
        let chapters = [];
        if (Array.isArray(args && args.chapterIds) && args.chapterIds.length) {
          chapters = currentParsedChapters.filter(c => args.chapterIds.map(Number).includes(c.id));
        } else if (scope === 'all') chapters = currentParsedChapters;
        else if (scope === 'selected') chapters = currentParsedChapters.filter(c => (extension_settings[extensionName].selectedChapterIds || []).includes(c.id));
        else chapters = currentParsedChapters.filter(c => !(extension_settings[extensionName].chapterGraphMap || {})[c.id]);
        if (chapters.length === 0) return '没有需要生成图谱的章节。';
        const before = graphCoverageStats();
        await generateChapterGraphBatch(chapters);
        const after = graphCoverageStats();
        return `图谱生成完成：${before.has}/${before.total} → ${after.has}/${after.total}（覆盖 ${after.percent}%）。`;
      }
    },
    merge_graphs: {
      desc: '合并知识图谱（分批 + 全量），生成全局合并图谱。',
      params: { type: 'object', properties: {} },
      danger: false,
      requireConfirm: false,
      run: async () => {
        await batchMergeGraphs();
        const merged = extension_settings[extensionName].mergedGraph || {};
        if (Object.keys(merged).length === 0) await mergeAllGraphs();
        const g = graphCoverageStats();
        return `合并完成：合并图谱 ${g.mergedKB} KB，覆盖 ${g.percent}% 章节。`;
      }
    },
    precheck: {
      desc: '对指定基准章节执行续写前置校验：人设红线、设定禁区、可呼应伏笔、潜在矛盾预警。',
      params: {
        type: 'object',
        required: ['chapterId'],
        properties: {
          chapterId: { type: 'number', description: '基准章节 id，必填' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        // 需求一/1：前置校验可关闭时直接返回关闭提示
        if (extension_settings[extensionName].enablePrecheck === false) return '前置校验已关闭。';
        const id = parseInt((args && args.chapterId), 10);
        const ch = currentParsedChapters.find(c => c.id === id);
        if (!ch) return { error: `章节 ${id} 不存在。` };
        const r = await validateContinuePrecondition(id, ch.content);
        return {
          isPass: r.isPass, report: r.report,
          redLines: r.redLines, forbiddenRules: r.forbiddenRules,
          foreshadowList: r.foreshadowList, conflictWarning: r.conflictWarning
        };
      }
    },
    write_chapters: {
      desc: '续写章节：从基准章节之后继续写，自动做前置校验（可关）；回填续写章节图谱按设置可关（默认关，可先确认设置再决定）。',
      params: {
        type: 'object',
        required: ['chapterId'],
        properties: {
          chapterId: { type: 'number', description: '基准章节 id，必填' },
          wordCount: { type: 'number', minimum: 500, maximum: 10000, description: '每章目标字数，默认 2000' },
          chapterCount: { type: 'number', minimum: 1, maximum: 20, description: '续写章数，默认 1' },
          directives: { type: 'string', description: '用户补充的写作要求（风格 / 剧情方向）' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        const id = parseInt((args && args.chapterId), 10);
        const ch = currentParsedChapters.find(c => c.id === id);
        if (!ch) return { error: `基准章节 ${id} 不存在。` };
        const wordCount = Math.max(500, Math.min(10000, parseInt((args && args.wordCount), 10) || 2000));
        const chapterCount = Math.max(1, Math.min(20, parseInt((args && args.chapterCount), 10) || 1));
        const directives = (args && args.directives) || '';
        ensureHiddenWriteInputs(id, ch.content);
        await generateNovelWrite(id, wordCount, chapterCount, directives);
        const last = continueWriteChain[continueWriteChain.length - 1];
        if (last) {
          // 需求三C：在对话流中插入续写章节缩略预览卡（可去阅读/复制）
          agentAddMessage('agent', last.content, { kind: 'chapter_preview', chapterId: last.id, chapterType: 'continue' });
        }
        return last ? `已续写 ${chapterCount} 章（每章约 ${wordCount} 字），最新续写章节 id=${last.id}。` : '续写未产生新章节。';
      }
    },
    open_view: {
      desc: '切换界面视图：reader（阅读，可指定章节）/ graph（图谱）/ chat（对话）。',
      params: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: ['reader', 'graph', 'chat'], description: 'reader=阅读 / graph=图谱 / chat=对话' },
          chapterId: { type: 'number', description: '可选，阅读指定章节' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        const view = (args && args.view) || 'chat';
        if (view === 'reader') {
          if (args && args.chapterId != null) {
            const id = parseInt(args.chapterId, 10);
            if (currentParsedChapters.some(c => c.id === id)) loadChapterToReader(id, 'original');
            else if (continueWriteChain.some(c => c.id === id)) loadChapterToReader(id, 'continue');
          }
          switchTab('reader');
          return '已打开阅读面板。';
        }
        if (view === 'graph') { switchTab('graph'); return '已打开图谱面板。'; }
        switchTab('chat');
        return '已回到对话面板。';
      }
    },
    save_memory: {
      desc: '保存一条长期记忆（用户偏好或设定事实），后续运行都会参考。',
      params: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', description: '要记住的内容，必填' },
          type: { type: 'string', enum: ['preference', 'fact'], description: 'preference=偏好（默认）/ fact=设定事实' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        const text = String((args && args.text) || '').trim();
        if (!text) return { error: '内容为空。' };
        if (args && args.type === 'fact') rememberFact(text);
        else rememberPreference(text);
        return `已保存记忆：${text}`;
      }
    },
    delete_continue_chapter: {
      desc: '删除一条续写章节（按 id），其图谱一并清理。破坏性操作，需用户确认。',
      params: {
        type: 'object',
        required: ['chapterId'],
        properties: {
          chapterId: { type: 'number', description: '续写章节 id，必填' }
        }
      },
      danger: true,
      requireConfirm: true,
      run: async (args) => {
        const id = parseInt((args && args.chapterId), 10);
        const idx = continueWriteChain.findIndex(c => c.id === id);
        if (idx < 0) return { error: `续写章节 ${id} 不存在。` };
        const [removed] = continueWriteChain.splice(idx, 1);
        const graphMap = extension_settings[extensionName].chapterGraphMap || {};
        delete graphMap[`continue_${id}`];
        extension_settings[extensionName].chapterGraphMap = graphMap;
        extension_settings[extensionName].continueWriteChain = continueWriteChain;
        saveSettingsDebounced();
        renderChapterList(currentParsedChapters);
        updateStats();
        return `已删除续写章节 ${id}《${removed.title}》，并清理其图谱。`;
      }
    },
    update_chapter_content: {
      desc: '就地修改章节内容（原始章节或续写章节均可），避免重新上传 TXT。修改后该章节图谱标记为待重新生成。',
      params: {
        type: 'object',
        required: ['chapterId', 'content'],
        properties: {
          chapterId: { type: 'number', description: '章节 id，必填' },
          content: { type: 'string', description: '新内容，必填' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        const id = parseInt((args && args.chapterId), 10);
        const content = String((args && args.content) || '').trim();
        if (!content) return { error: '内容为空。' };
        const original = currentParsedChapters.find(c => c.id === id);
        if (original) {
          original.content = content;
          extension_settings[extensionName].chapterList = currentParsedChapters;
        } else {
          const cont = continueWriteChain.find(c => c.id === id);
          if (!cont) return { error: `章节 ${id} 不存在。` };
          cont.content = content;
          extension_settings[extensionName].continueWriteChain = continueWriteChain;
        }
        const graphMap = extension_settings[extensionName].chapterGraphMap || {};
        delete graphMap[id];
        delete graphMap[`continue_${id}`];
        extension_settings[extensionName].chapterGraphMap = graphMap;
        saveSettingsDebounced();
        renderChapterList(currentParsedChapters);
        return `已更新章节 ${id} 内容（${content.length} 字），其图谱已标记待重新生成。`;
      }
    },
    rename_chapter: {
      desc: '修改章节标题。',
      params: {
        type: 'object',
        required: ['chapterId', 'title'],
        properties: {
          chapterId: { type: 'number', description: '章节 id，必填' },
          title: { type: 'string', description: '新标题，必填' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        const id = parseInt((args && args.chapterId), 10);
        const title = String((args && args.title) || '').trim();
        if (!title) return { error: '标题为空。' };
        const original = currentParsedChapters.find(c => c.id === id);
        if (original) {
          original.title = title;
          extension_settings[extensionName].chapterList = currentParsedChapters;
        } else {
          const cont = continueWriteChain.find(c => c.id === id);
          if (!cont) return { error: `章节 ${id} 不存在。` };
          cont.title = title;
          extension_settings[extensionName].continueWriteChain = continueWriteChain;
        }
        saveSettingsDebounced();
        renderChapterList(currentParsedChapters);
        return `已将章节 ${id} 改名为《${title}》。`;
      }
    },
    export_project: {
      desc: '导出整本小说 + 全部图谱（合并图谱、章节图谱、续写链）为 JSON 文本，返回预览。',
      params: { type: 'object', properties: {} },
      danger: false,
      requireConfirm: false,
      run: async () => {
        const data = {
          novel: extension_settings[extensionName].currentNovelName || '',
          exportedAt: new Date().toISOString(),
          chapters: currentParsedChapters,
          continueWriteChain,
          chapterGraphMap: extension_settings[extensionName].chapterGraphMap || {},
          mergedGraph: extension_settings[extensionName].mergedGraph || {}
        };
        const text = JSON.stringify(data);
        return `项目导出成功（约 ${Math.round(text.length / 1024)} KB）。完整 JSON 可让用户在图谱面板「导出」按钮保存到本地。\n数据预览：${text.slice(0, 600)}`;
      }
    },
    set_settings: {
      desc: '修改 Agent 设置并立即生效：enablePrecheck / enableWriteQualityGate / writeQualityMinChars / rateLimitEnabled / rateLimitMaxCalls / rateLimitWindow / rateLimitUnit / agentMaxSteps / enableTavernPresetInject / enableAutoParentPreset / enableContinueGraphBackfill / enableStreaming / enableParallelTools / enablePlanGate / agentContextBudget。',
      params: {
        type: 'object',
        required: ['key', 'value'],
        properties: {
          key: { type: 'string', description: '设置键：enablePrecheck / enableWriteQualityGate / writeQualityMinChars / rateLimitEnabled / rateLimitMaxCalls / rateLimitWindow / rateLimitUnit / agentMaxSteps / enableTavernPresetInject / enableAutoParentPreset / enableContinueGraphBackfill / enableStreaming / enableParallelTools / enablePlanGate / agentContextBudget' },
          value: { type: ['number', 'boolean', 'string'], description: '新值' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        const key = String((args && args.key) || '').trim();
        const ALLOWED = new Set(['enablePrecheck', 'enableWriteQualityGate', 'writeQualityMinChars', 'rateLimitEnabled', 'rateLimitMaxCalls', 'rateLimitWindow', 'rateLimitUnit', 'agentMaxSteps', 'enableTavernPresetInject', 'enableAutoParentPreset', 'enableContinueGraphBackfill', 'enableStreaming', 'enableParallelTools', 'enablePlanGate', 'agentContextBudget']);
        if (!ALLOWED.has(key)) return { error: `不允许通过 Agent 修改设置 "${key}"。可用：${[...ALLOWED].join('、')}` };
        if (args && args.value === undefined) return { error: '缺少 value 参数。' };
        const raw = args.value;
        let value = raw;
        const BOOL_KEYS = ['enablePrecheck', 'enableWriteQualityGate', 'rateLimitEnabled', 'enableTavernPresetInject', 'enableAutoParentPreset', 'enableContinueGraphBackfill', 'enableStreaming', 'enableParallelTools', 'enablePlanGate'];
        if (BOOL_KEYS.includes(key)) {
          value = raw === true || raw === 'true' || raw === 1 || raw === '1';
        } else if (key === 'rateLimitMaxCalls' || key === 'rateLimitWindow' || key === 'writeQualityMinChars') {
          value = Math.max(1, parseInt(raw, 10) || 3);
        } else if (key === 'rateLimitUnit') {
          value = raw === 's' ? 's' : 'm';
        } else if (key === 'agentMaxSteps') {
          value = Math.max(2, Math.min(30, parseInt(raw, 10) || 12));
        } else if (key === 'agentContextBudget') {
          value = Math.max(4000, Math.min(200000, parseInt(raw, 10) || AGENT_CFG.DEFAULT_CONTEXT_BUDGET));
        }
        extension_settings[extensionName][key] = value;
        saveSettingsDebounced();
        return `已更新设置 ${key} = ${JSON.stringify(value)}（立即生效）。`;
      }
    },
    recall_task: {
      desc: '读取最近的 Agent 任务历史（完成/进行中的续写与图谱任务）。',
      params: {
        type: 'object',
        properties: {
          count: { type: 'number', minimum: 1, maximum: 20, description: '读取最近 N 条，默认 5' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        const history = getAgentMemory().taskHistory || [];
        const count = Math.max(1, Math.min(20, parseInt((args && args.count), 10) || 5));
        if (history.length === 0) return '暂无任务历史。';
        return history.slice(-count).map(h => `[${new Date(h.time).toLocaleString()}] ${h.text}`).join('\n');
      }
    },
    forget_memory: {
      desc: '删除一条长期记忆（按序号）。不传 index 先查看记忆清单。',
      params: {
        type: 'object',
        properties: {
          index: { type: 'number', description: '记忆序号（preferences 从 0 开始，facts 紧接其后，任务历史单独 T 前缀展示）' }
        }
      },
      danger: false,
      requireConfirm: false,
      run: async (args) => {
        const mem = getAgentMemory();
        if (args && args.index !== undefined && args.index !== null && args.index !== '') {
          const idx = parseInt(args.index, 10);
          const total = mem.preferences.length + mem.facts.length;
          if (isNaN(idx) || idx < 0 || idx >= total) return { error: `序号越界（0-${total - 1}）。` };
          if (idx < mem.preferences.length) mem.preferences.splice(idx, 1);
          else mem.facts.splice(idx - mem.preferences.length, 1);
          saveAgentMemory(mem);
          return '已删除该条记忆。';
        }
        const lines = [];
        mem.preferences.forEach((p, i) => lines.push(`${i}. [偏好] ${p.text}`));
        mem.facts.forEach((f, i) => lines.push(`${mem.preferences.length + i}. [事实] ${f.text}`));
        mem.taskHistory.forEach((h, i) => lines.push(`T${i}. [任务] ${h.text}`));
        return lines.length ? lines.join('\n') : '暂无记忆。调用时传 index 即可删除。';
      }
    }
  };

  // 需求四/A：工具标准化 —— 所有工具补齐 danger / requireConfirm 字段（写操作默认安全，破坏性操作单独标记）
  Object.keys(TOOLS).forEach(name => {
    if (TOOLS[name].danger === undefined) TOOLS[name].danger = false;
    if (TOOLS[name].requireConfirm === undefined) TOOLS[name].requireConfirm = false;
  });

  // ---------- ReAct 主循环：思考 → 行动 → 观察，直到任务完成 ----------
  // B3：严格模式 + anyOf 强制「三选一」—— tool+args（单工具）/ parallel（只读工具并行）/ final
  const AGENT_STEP_SCHEMA = {
    name: 'AgentStep',
    strict: true,
    value: {
      type: 'object',
      anyOf: [
        { required: ['thought', 'tool', 'args'] },
        { required: ['thought', 'parallel'] },
        { required: ['thought', 'final'] }
      ],
      properties: {
        thought: { type: 'string', description: '对当前任务的思考与决策理由' },
        plan: { type: 'array', items: { type: 'string' }, description: '可选：整体任务分解计划，仅在第一步输出' },
        tool: { type: 'string', description: '要调用的工具名（单工具步输出）' },
        args: { type: 'object', description: '工具参数' },
        parallel: {
          type: 'array',
          description: '可选：单步并行调用多个只读工具（如同时 get_state + list_chapters + graph_status），写操作禁止并行',
          items: {
            type: 'object',
            required: ['tool', 'args'],
            properties: {
              tool: { type: 'string', description: '只读工具名' },
              args: { type: 'object', description: '工具参数' }
            }
          }
        },
        final: { type: 'string', description: '任务完成的最终答复（任务完成时输出）' }
      }
    }
  };

  // B4：工具参数从伪 schema 改为标准 JSON Schema 描述生成（枚举/必填/范围一目了然）
  function describeToolParams(schema) {
    if (!schema || !schema.properties) return '';
    const required = new Set(schema.required || []);
    const lines = Object.entries(schema.properties).map(([k, v]) => {
      const req = required.has(k) ? '必填' : '可选';
      let desc = v.description || '';
      if (!desc && Array.isArray(v.enum)) desc = '可选值：' + v.enum.join(' / ');
      if (!desc) desc = Array.isArray(v.type) ? v.type.join('/') : (v.type || '');
      const range = (v.minimum != null || v.maximum != null)
        ? ` [${v.minimum != null ? v.minimum : '-'} ~ ${v.maximum != null ? v.maximum : '-'}]` : '';
      return `    - ${k}（${req}）: ${desc}${range}`;
    });
    return lines.length ? '\n' + lines.join('\n') : '';
  }

  // 需求四/F：Prompt 三段分层 —— Static（工具列表+工作方式，缓存一次）+ Dynamic（小说状态/记忆/覆盖）+ User context
  let _agentStaticPromptCache = null;
  function buildAgentStaticPrompt() {
    if (_agentStaticPromptCache) return _agentStaticPromptCache;
    const toolLines = Object.keys(TOOLS).map(name => {
      const t = TOOLS[name];
      const params = describeToolParams(t.params);
      const confirm = t.requireConfirm ? '  [需用户确认]' : '';
      return `- ${name}：${t.desc}${params}${confirm}`;
    }).join('\n');
    _agentStaticPromptCache = `你是「小说续写 Agent」，运行在 SillyTavern 中的智能写作助手。你可以自主调用工具完成用户的续写需求，而不是让用户手动点按钮。

【可用工具】
${toolLines}

【工作方式】
1. 把用户需求拆解为多步，自主决定调用哪些工具、按什么顺序，逐步执行直到任务完成。
2. 每次只输出一步：thought（思考）+ tool + args；全部完成后输出 final（给用户的最终答复），不要输出多余的收尾步骤。
3. 工具会返回处理后的摘要，不要假设工具没有执行。
4. 复杂任务（续写多章、生成/合并图谱）第一步先用只读工具探查（get_state / list_chapters / graph_status），并输出 plan 数组做任务分解，再执行写工具。
5. 彼此独立的只读探查可以用 parallel 字段在一步内并行调用（如同时 get_state + graph_status）；写操作、破坏性操作禁止并行，必须串行。
6. 续写前如果图谱不完整（覆盖率低或无合并图谱），应先生成/合并图谱再续写；用户要求快速续写时可直接续写。
7. 用户提到的风格、字数、剧情要求必须纳入 write_chapters 的 directives 参数。
8. 某步失败时，根据【强制反思】与工具提示调整策略或换工具，不要原样重试超过 2 次；确实无法完成就直接用 final 说明。
9. 默认续写字数参考长期记忆中的偏好，没有则 2000 字。
10. final 用中文回答用户：说明做了什么、结果如何、建议下一步，简洁清晰。
11. 涉及清空数据等破坏性操作时，先向用户确认再执行。`;
    return _agentStaticPromptCache;
  }

  function buildAgentSystemPrompt() {
    // B6：用短 TTL 缓存替代每步全量统计
    const g = graphCoverageStatsCached();
    const mem = getAgentMemory();
    const readerState = extension_settings[extensionName].readerState || {};
    const settings = extension_settings[extensionName];
    const memLines = [];
    mem.preferences.slice(-6).forEach(p => memLines.push('· ' + p.text));
    mem.facts.slice(-6).forEach(f => memLines.push('· (事实) ' + f.text));
    if (mem.taskHistory.length) memLines.push('· (最近任务) ' + mem.taskHistory.slice(-3).map(h => h.text).join(' | '));
    const extraRules = [];
    if (settings.enablePrecheck === false) extraRules.push('前置校验已关闭，不要调用 precheck 工具，直接续写。');
    if (settings.enableWriteQualityGate === false) extraRules.push('续写质量门已关闭，生成后直接使用，无需反复重写。');
    const dynamic = `【当前小说状态】
- 小说：${settings.currentNovelName || '未加载'}
- 章节：${g.total} 章，图谱覆盖 ${g.percent}%（缺 ${g.missing} 章）
- 合并图谱：${g.hasMerged ? '已生成（' + g.mergedKB + ' KB）' : '未生成'}
- 续写链：${continueWriteChain.length} 章
- 当前阅读：${readerState.currentChapterId != null ? ('第 ' + readerState.currentChapterId + (readerState.currentChapterType === 'continue' ? ' 章（续写）' : ' 章')) : '无'}

【长期记忆】（用户偏好与设定事实，续写时必须遵守）
${memLines.length ? memLines.join('\n') : '（暂无）'}

【本次注意事项】
${extraRules.length ? extraRules.join('\n') : '无特殊限制。'}`;
    return buildAgentStaticPrompt() + '\n\n' + dynamic;
  }

  function extractAgentStep(raw) {
    const t = String(raw || '').trim();
    if (!t) return null;
    try { return JSON.parse(t); } catch (_) {}
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) { try { return JSON.parse(fence[1].trim()); } catch (_) {} }
    const brace = t.indexOf('{');
    if (brace >= 0) {
      // bug12：花括号扫描考虑字符串内的 { }，避免 thought 文本含 } 时截断错位
      let depth = 0, end = -1, inStr = false, esc = false;
      for (let i = brace; i < t.length; i++) {
        const ch = t[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end > brace) { try { return JSON.parse(t.slice(brace, end + 1)); } catch (_) {} }
    }
    return null;
  }

  function buildAgentHistory(excludeMsgId) {
    const out = [];
    const recent = chatState.messages.filter(m =>
      m && m.id !== excludeMsgId && (m.role === 'user' || (m.role === 'agent' && (m.kind === 'final' || !m.kind))) && !m.taskId
    ).slice(-AGENT_CFG.MAX_HISTORY_TURNS * 2);
    recent.forEach(m => {
      out.push({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.text || '').slice(0, 1500) });
    });
    return out;
  }

  // 5.0：单次工具执行 + 可视化 + 日志（单工具与并行路径共用）
  async function executeToolOnce(toolName, args, step) {
    const t0 = Date.now();
    let obs;
    try {
      const toolResult = await TOOLS[toolName].run(args || {});
      if (toolResult && typeof toolResult === 'object' && toolResult.error) obs = { ok: false, error: String(toolResult.error) };
      else obs = { ok: true, result: toolResult };
    } catch (e) {
      obs = { ok: false, error: (e && e.message) || String(e) };
    }
    obs.ms = Date.now() - t0;
    agentRenderToolCall(toolName, args, obs, step);
    agentState.toolLog.push({ tool: toolName, args: args || {}, ok: obs.ok, ms: obs.ms, time: Date.now() });
    while (agentState.toolLog.length > AGENT_CFG.MAX_TOOL_LOG) agentState.toolLog.shift();
    return obs;
  }

  // 5.0/观察：统一观察内容格式 —— 成功带「下一步提示」，失败带「强制反思」
  function formatObservationContent(toolName, obs) {
    if (!obs.ok) {
      return `工具执行失败：${obs.error}

【强制反思】在继续前请先回答自己：
1. 失败的根本原因是什么？（参数错误 / 前置条件不满足 / 工具不适用）
2. 上次调用与这次的关键差异点在哪？
3. 换个思路会用什么工具/参数？
如果 2 次尝试都无法解决，请直接用 final 汇报失败原因和建议，不要继续无效重试。`;
    }
    const dataText = typeof obs.result === 'string' ? obs.result : JSON.stringify(obs.result);
    const hint = buildObservationHint(toolName, obs.result);
    return hint ? (String(dataText) + '\n\n[下一步提示] ' + hint) : String(dataText);
  }

  // 5.0/并行：合并多个并行只读工具的观察
  function formatParallelObservation(results) {
    const allFail = results.length > 0 && results.every(r => !r.obs.ok);
    const parts = results.map(r => `### ${r.toolName}\n${formatObservationContent(r.toolName, r.obs)}`);
    return (allFail ? '本步所有并行工具均失败，请按下方反思调整。\n\n' : '') + parts.join('\n\n');
  }

  async function runAgent(userInput) {
    if (agentState.running) { agentNotify('⚠ Agent 正在执行中，请稍候或先停止', 'warn'); return; }
    const runId = ++agentState.runId;
    agentState.running = true;
    agentState.toolLog = [];
    agentState.currentPlan = [];
    // B1 / 无进展检测：每次任务全新计数
    agentState.recentCalls = [];
    agentState.noProgressStreak = 0;
    // 5.0/规划：Plan-Execute 门控状态（planReady=已输出计划；planNudged=已提醒过一次）
    let planReady = false;
    let planNudged = false;
    // 5.0/预算：上下文 token 预算（system prompt 单独预留）
    const contextBudget = Math.max(4000, parseInt(extension_settings[extensionName].agentContextBudget, 10) || AGENT_CFG.DEFAULT_CONTEXT_BUDGET);
    const planGateEnabled = extension_settings[extensionName].enablePlanGate !== false;
    const parallelEnabled = extension_settings[extensionName].enableParallelTools !== false;
    // bug20：停止标志只在每次 runAgent 开头重置，不放 finally（避免把用户手动停止重置掉）
    stopGenerateFlag = false;
    isSending = true;
    renderStatusPanel();

    const maxSteps = Math.max(2, Math.min(30, parseInt(extension_settings[extensionName].agentMaxSteps, 10) || AGENT_CFG.MAX_STEPS));
    const userContent = String(userInput || '').slice(0, 2000);
    // 需求四/B3：未完成任务允许「继续」—— 仅当输入为空或带「继续/接着」意图时基于上文续跑，新需求一律全新开始
    const inputTrim = String(userInput || '').trim();
    const resumeIntent = /^(继续|接着|continue)/i.test(inputTrim) || inputTrim === '';
    let messages;
    if (Array.isArray(agentState.pendingMessages) && agentState.pendingMessages.length && resumeIntent) {
      const resumeHint = inputTrim ? `[用户要求继续] ${inputTrim}` : '[用户要求继续] 请继续完成上次未完成的任务。';
      messages = [...agentState.pendingMessages, { role: 'user', content: resumeHint }];
    } else {
      // bug10：当前输入已由 sendUserInput 写入 chatState，用消息 id 精确排除同一条，避免重复注入
      const lastMsg = chatState.messages[chatState.messages.length - 1];
      const excludeId = (lastMsg && lastMsg.role === 'user') ? lastMsg.id : null;
      const history = buildAgentHistory(excludeId);
      messages = [...history, { role: 'user', content: userContent }];
    }
    agentState.pendingMessages = null;

    try {
      for (let step = 0; step < maxSteps; step++) {
        if (stopGenerateFlag || stopSending) { agentNotify('⏹ 已停止 Agent', 'info'); return; }
        const systemPrompt = buildAgentSystemPrompt();
        // 5.0/预算：调用前按 token 预算裁剪历史与工具观察（保留首条任务与当前指令）
        messages = trimMessagesToBudget(messages, contextBudget, estimateTokens(systemPrompt));
        const resRaw = await generateRawWithBreakLimit({
          systemPrompt,
          messages,
          jsonSchema: AGENT_STEP_SCHEMA
        });
        const res = extractAgentStep(resRaw);
        if (!res || typeof res !== 'object') {
          const err = 'Agent 决策输出无法解析（非 JSON）。请严格输出 JSON：{"thought":"...","tool":"...","args":{...}} 或 {"thought":"...","final":"..."}';
          agentRenderThought('（模型输出格式异常，已要求重试）', step);
          messages.push({ role: 'assistant', content: String(resRaw || '').slice(0, 2000) });
          messages.push({ role: 'user', content: '[解析失败] ' + err });
          continue;
        }
        const thought = String(res.thought || '').trim() || '（无思考过程）';
        agentRenderThought(thought, step);
        messages.push({ role: 'assistant', content: JSON.stringify({ thought, plan: res.plan, tool: res.tool, args: res.args, final: res.final }) });

        if (Array.isArray(res.plan) && res.plan.length) {
          agentState.currentPlan = res.plan.map(label => ({ label: String(label), status: 'pending' }));
          planReady = true;
          renderStatusPanel();
        }

        const toolName = res.tool;
        const finalText = res.final;
        const parallelCalls = Array.isArray(res.parallel)
          ? res.parallel.filter(c => c && typeof c.tool === 'string')
          : [];

        // ---- 收尾：final ----
        if (!toolName && parallelCalls.length === 0) {
          if (finalText && String(finalText).trim()) {
            agentState.currentPlan.forEach(p => { if (p.status === 'pending') p.status = 'done'; });
            agentAddMessage('agent', String(finalText).trim(), { kind: 'final' });
            renderStatusPanel();
            return String(finalText).trim();
          }
          const msg = 'Agent 未指定工具也未给出最终答复，已中止。可再发一次需求或使用快捷按钮。';
          agentNotify(msg, 'warn');
          return msg;
        }

        const stepIdx = agentState.currentPlan.findIndex(p => p.status === 'pending');

        // ================= 5.0/并行：单步并行调用多个只读工具 =================
        if (parallelCalls.length) {
          if (!parallelEnabled) {
            messages.push({ role: 'user', content: '[系统] 当前已关闭并行工具，请改用单工具步（tool + args）逐个调用。' });
            continue;
          }
          // 混入未知/写/危险工具 → 整步拒绝（写操作必须串行）
          const bad = parallelCalls.find(c => !TOOLS[c.tool] || !isReadOnlyTool(c.tool));
          if (bad) {
            const why = !TOOLS[bad.tool]
              ? `未知工具 "${bad.tool}"`
              : `"${bad.tool}" 属于写/危险操作，不能并行，请改为单工具串行调用`;
            agentRenderThought('（并行请求被拒绝：' + why + '）', step);
            messages.push({ role: 'user', content: '[并行被拒绝] ' + why + '。可并行的只读工具：' + [...READ_ONLY_TOOLS].join('、') });
            continue;
          }
          if (stepIdx >= 0) { agentState.currentPlan[stepIdx].status = 'running'; renderStatusPanel(); }
          // B1 重复检测逐个子调用执行；命中的子调用不实际执行，直接回传拦截观察
          const execList = parallelCalls.map(c => {
            const args = c.args && typeof c.args === 'object' ? c.args : {};
            const sig = c.tool + '|' + JSON.stringify(args);
            agentState.recentCalls.push(sig);
            if (agentState.recentCalls.length > 8) agentState.recentCalls.shift();
            const dup = agentState.recentCalls.filter(s => s === sig).length;
            const blockedObs = dup >= 3 ? { ok: false, error: '系统拦截：近期已用相同参数调用 ' + c.tool + ' 多次，重复无意义，请换工具/参数。' } : null;
            return { toolName: c.tool, args, obs: blockedObs };
          });
          const results = await Promise.all(execList.map(async (item) => {
            if (item.obs) { agentRenderToolCall(item.toolName, item.args, item.obs, step); return item; }
            item.obs = await executeToolOnce(item.toolName, item.args, step);
            return item;
          }));
          if (stepIdx >= 0) agentState.currentPlan[stepIdx].status = results.every(r => r.obs.ok) ? 'done' : 'error';
          renderStatusPanel();
          const allFail = results.every(r => !r.obs.ok);
          agentState.noProgressStreak = allFail ? (agentState.noProgressStreak + 1) : 0;
          if (agentState.noProgressStreak >= 4) {
            agentAddMessage('agent', '⚠ 连续 4 步工具调用失败，已主动中止。可能是 API 异常或参数系统性错误，请检查后重试。', { kind: 'warn' });
            agentState.pendingMessages = messages;
            return 'Agent 已因连续失败主动中止';
          }
          const combined = formatParallelObservation(results);
          messages.push({ role: 'user', content: '[并行工具返回]\n' + String(combined).slice(0, AGENT_CFG.OBSERVATION_CHAR_LIMIT) });
          continue;
        }

        // ================= 单工具路径 =================
        if (!TOOLS[toolName]) {
          const err = `未知工具 "${toolName}"。可用工具：${Object.keys(TOOLS).join('、')}`;
          agentRenderToolCall(toolName, res.args, { ok: false, error: err }, step);
          messages.push({ role: 'user', content: '[工具结果] ' + err });
          continue;
        }

        // 5.0/规划：Plan-Execute 门控 —— 重型写工具开工前要求先探查并输出 plan（仅提醒一次，第三步起放行防死锁）
        const gate = planGateDecision({ step, toolName, planGateDisabled: !planGateEnabled, planReady, planNudged });
        if (gate.gate) {
          planNudged = true;
          agentRenderThought('（规划门：要求先探查现状并输出 plan）', step);
          messages.push({ role: 'user', content: '[规划门] ' + gate.reason });
          continue;
        }

        // 需求四/A：危险工具（requireConfirm）弹确认卡，等用户点「确认/取消」再继续
        if (TOOLS[toolName].requireConfirm) {
          const confirmed = await requestAgentConfirm(toolName, res.args || {});
          if (!confirmed) {
            agentRenderToolCall(toolName, res.args, { ok: false, error: '用户取消了该操作' }, step);
            messages.push({ role: 'user', content: '[用户确认] 已取消调用 ' + toolName });
            continue;
          }
        }

        // B1：重复调用检测 —— 同一工具 + 相同参数在最近 8 步内出现 ≥3 次，直接拦截，不再消耗工具执行
        const callSig = toolName + '|' + JSON.stringify(res.args || {});
        agentState.recentCalls.push(callSig);
        if (agentState.recentCalls.length > 8) agentState.recentCalls.shift();
        const dupCount = agentState.recentCalls.filter(s => s === callSig).length;
        if (dupCount >= 3) {
          messages.push({
            role: 'user',
            content: `[系统拦截] 你已连续 ${dupCount} 次用相同参数调用「${toolName}」，重复不会改变结果。请立刻换工具/换参数，或用 final 汇报现状。`
          });
          agentRenderThought('（系统检测到重复调用，已要求换策略）', step);
          continue;  // 不再消耗工具执行
        }

        if (stepIdx >= 0) { agentState.currentPlan[stepIdx].status = 'running'; renderStatusPanel(); }
        const obs = await executeToolOnce(toolName, res.args || {}, step);
        if (stepIdx >= 0) agentState.currentPlan[stepIdx].status = obs.ok ? 'done' : 'error';
        renderStatusPanel();

        // 完全 Agent：无进展检测 —— 连续 4 步工具失败 → 主动中止并汇报，不再烧 API
        agentState.noProgressStreak = obs.ok ? 0 : (agentState.noProgressStreak + 1);
        if (agentState.noProgressStreak >= 4) {
          agentAddMessage('agent', '⚠ 连续 4 步工具调用失败，已主动中止。可能是 API 异常或参数系统性错误，请检查后重试。', { kind: 'warn' });
          agentState.pendingMessages = messages;
          return 'Agent 已因连续失败主动中止';
        }

        // 5.0/观察：结构化观察 —— 成功带「下一步提示」，失败带「强制反思」
        const obsContent = formatObservationContent(toolName, obs);
        messages.push({ role: 'user', content: '[工具 ' + toolName + ' 返回]\n' + String(obsContent).slice(0, AGENT_CFG.OBSERVATION_CHAR_LIMIT) });
      }
      const msg = `已达到最大步数（${maxSteps}），任务未完全收尾。可以回复「继续」让我接着做，或改用快捷按钮手动操作。`;
      agentNotify(msg, 'warn');
      // 需求四/B3：保存上文，允许「继续」续跑
      agentState.pendingMessages = messages;
      return msg;
    } catch (e) {
      if (!stopGenerateFlag) {
        console.error('[小说续写Agent] Agent 运行失败:', e);
        agentNotify(`❌ Agent 运行失败：${e.message}`, 'error');
      }
    } finally {
      agentState.running = false;
      isSending = false;
      // bug20：这里不再重置 stopGenerateFlag（开头已重置，避免覆盖用户手动停止）
      renderStatusPanel();
    }
  }

  // ---------- 思考 / 工具调用可视化（消息流内嵌可折叠块） ----------
  // bug25：去掉未使用的 runId 参数（step 仍用于 UI 展示）
  function agentRenderThought(text, step) {
    const $flow = $('#chat-flow');
    if (!$flow.length) return;
    const el = getDoc().createElement('div');
    el.className = 'chat-msg agent';
    el.innerHTML = `
      <div class="chat-avatar">AI</div>
      <div class="chat-bubble bubble-thought">
        <div class="thought-head"><span>🧠 思考</span><span class="thought-step">step ${(step || 0) + 1}</span><span class="thought-toggle">展开</span></div>
        <div class="thought-body"></div>
      </div>`;
    el.querySelector('.thought-body').textContent = text;
    el.querySelector('.thought-head').addEventListener('click', function () {
      const body = el.querySelector('.thought-body');
      body.classList.toggle('open');
      el.querySelector('.thought-toggle').textContent = body.classList.contains('open') ? '收起' : '展开';
    });
    $flow.get(0).appendChild(el);
    $flow.get(0).scrollTop = $flow.get(0).scrollHeight;
  }

  function agentRenderToolCall(toolName, args, obs, step) {
    const $flow = $('#chat-flow');
    if (!$flow.length) return;
    const el = getDoc().createElement('div');
    el.className = 'chat-msg agent';
    const ok = !!(obs && obs.ok);
    const argsStr = args && Object.keys(args).length ? JSON.stringify(args).slice(0, 200) : '';
    const resultStr = ok
      ? (typeof obs.result === 'string' ? obs.result : JSON.stringify(obs.result, null, 1))
      : (obs.error || '');
    el.innerHTML = `
      <div class="chat-avatar">⚙</div>
      <div class="chat-bubble bubble-tool ${ok ? '' : 'bubble-tool-err'}">
        <div class="tool-head">
          <span class="tool-name">${escapeHtml(toolName)}</span>
          <span class="tool-status">${ok ? '✓' : '✗'} · ${obs.ms || 0}ms</span>
          <span class="tool-toggle">展开</span>
        </div>
        <div class="tool-body">
          ${argsStr ? '<div class="tool-args">参数：<code>' + escapeHtml(argsStr) + '</code></div>' : ''}
          <div class="tool-result"></div>
        </div>
      </div>`;
    el.querySelector('.tool-result').textContent = String(resultStr).slice(0, 1500);
    el.querySelector('.tool-head').addEventListener('click', function () {
      const body = el.querySelector('.tool-body');
      body.classList.toggle('open');
      el.querySelector('.tool-toggle').textContent = body.classList.contains('open') ? '收起' : '展开';
    });
    $flow.get(0).appendChild(el);
    $flow.get(0).scrollTop = $flow.get(0).scrollHeight;
  }

  // 5.0/流式：续写正文逐 token 回显卡片（宿主不支持流式时回调不触发，退化为普通等待，无副作用）
  function agentStreamCard(title) {
    const noop = { update() {}, finish() {}, fail() {} };
    const $flow = $('#chat-flow');
    if (!$flow || !$flow.length) return noop;
    let el;
    try {
      el = getDoc().createElement('div');
      el.className = 'chat-msg agent';
      el.innerHTML = `
        <div class="chat-avatar">✍</div>
        <div class="chat-bubble bubble-stream">
          <div class="stream-head"><span class="stream-title"></span><span class="stream-state">生成中…</span></div>
          <div class="stream-body"></div>
        </div>`;
      el.querySelector('.stream-title').textContent = String(title || '续写生成中');
      $flow.get(0).appendChild(el);
    } catch (_) { return noop; }
    const bodyEl = el.querySelector('.stream-body');
    const stateEl = el.querySelector('.stream-state');
    const bubbleEl = el.querySelector('.chat-bubble');
    let lastPaint = 0, lastText = '';
    const scroll = () => { try { $flow.get(0).scrollTop = $flow.get(0).scrollHeight; } catch (_) {} };
    const paint = (text, force) => {
      lastText = String(text || '');
      const now = Date.now();
      if (!force && now - lastPaint < 90) return;
      lastPaint = now;
      bodyEl.textContent = lastText;
      scroll();
    };
    return {
      update(text) { paint(text, false); },
      finish(note) {
        paint(lastText, true);
        stateEl.textContent = '已完成';
        stateEl.classList.add('done');
        bodyEl.classList.add('stream-done');
        if (note) {
          const n = getDoc().createElement('div');
          n.className = 'stream-note';
          n.textContent = String(note);
          bubbleEl.appendChild(n);
        }
        scroll();
      },
      fail(reason) {
        paint(lastText, true);
        stateEl.textContent = '已中断' + (reason ? '：' + reason : '');
        stateEl.classList.add('fail');
        scroll();
      }
    };
  }

  // 需求四/A：危险工具确认 —— 生成确认卡并挂起 Promise；B2：120s 超时自动取消，杜绝永久挂起
  function requestAgentConfirm(toolName, args, timeoutMs) {
    if (timeoutMs == null) timeoutMs = 120000;
    return new Promise(resolve => {
      const id = 'confirm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      let settled = false;
      const finish = (ok, reason) => {
        if (settled) return;
        settled = true;
        resolve(ok);
        try {
          const el = getDoc().querySelector(`[data-msg-id="${id}"]`);
          if (el) {
            const btns = el.querySelector('.confirm-btns');
            if (btns) btns.remove();
            const bt = el.querySelector('.bubble-text');
            if (bt) bt.textContent = ok ? '✅ 已确认执行' : `❌ 已取消${reason ? '（' + reason + '）' : ''}`;
          }
          if (agentState.pendingConfirm && agentState.pendingConfirm.id === id) {
            agentState.pendingConfirm = null;
          }
        } catch (_) {}
      };
      const timer = setTimeout(() => {
        if (settled) return;
        finish(false, '确认超时');
        agentNotify('⌛ 危险操作确认超时，已自动取消', 'warn');
      }, timeoutMs);

      const argsStr = args && Object.keys(args).length ? JSON.stringify(args).slice(0, 300) : '';
      const msgId = agentAddMessage('agent', '', {
        kind: 'confirm',
        confirmId: id,
        confirmTool: toolName,
        confirmArgs: argsStr
      });
      // 把 resolve 挂到 pendingConfirm 上，让点击处理器能找到
      agentState.pendingConfirm = {
        id,
        resolve: (ok) => { clearTimeout(timer); finish(ok); }
      };
      // 兼容点击路径：消息本身也持有 resolve（chat-flow 点击处理器读的是 msg.confirmResolve）
      const msg = chatState.messages.find(m => m.id === msgId);
      if (msg) msg.confirmResolve = (ok) => { clearTimeout(timer); finish(ok); };
    });
  }

  // ---------- 状态面板渲染（需求四/E：details 折叠 + 工具日志只渲染最近子集 + 覆盖章节可点击跳转） ----------
  function renderStatusPanel() {
    const $p = $('#agent-status-panel');
    if (!$p || !$p.length) return;
    // B14：计划项过长时截断展示，避免撑爆面板
    const PLAN_SHOWN = 12;
    const planItems = agentState.currentPlan.slice(0, PLAN_SHOWN);
    const planHtml = agentState.currentPlan.length
      ? planItems.map(p => {
          const icon = p.status === 'done' ? '✅' : p.status === 'error' ? '❌' : p.status === 'running' ? '⏳' : '○';
          return `<div class="plan-item ${p.status}"><span>${icon}</span><span>${escapeHtml(p.label)}</span></div>`;
        }).join('') +
        (agentState.currentPlan.length > PLAN_SHOWN ? `<div class="status-empty">…共 ${agentState.currentPlan.length} 项，仅显示前 ${PLAN_SHOWN} 项</div>` : '')
      : '<div class="status-empty">暂无进行中的任务</div>';
    // 工具日志：虚拟化简化版 —— 固定行高容器，只渲染最近 N 条（多时不卡）
    const logItems = agentState.toolLog.slice().reverse();
    let logHtml = '<div class="status-empty">暂无工具调用</div>';
    if (logItems.length) {
      const limit = 30;
      const shown = logItems.slice(0, limit);
      logHtml = `<div class="status-log-scroll" data-count="${logItems.length}">` +
        shown.map(l =>
          `<div class="log-item ${l.ok ? '' : 'log-err'}"><span>${l.ok ? '✓' : '✗'}</span><span>${escapeHtml(l.tool)}</span><span class="log-ms">${l.ms}ms</span></div>`
        ).join('') +
        (logItems.length > limit ? `<div class="status-empty">…共 ${logItems.length} 次，仅显示最近 ${limit} 次</div>` : '') +
        '</div>';
    }
    const mem = getAgentMemory();
    const memItems = [];
    mem.preferences.slice(-5).forEach(p => memItems.push({ text: p.text, fact: false }));
    mem.facts.slice(-5).forEach(f => memItems.push({ text: f.text, fact: true }));
    mem.taskHistory.slice(-3).forEach(h => memItems.push({ text: '🗒 ' + h.text, fact: false }));
    // B14：记忆展示条数改为具名常量
    const MEM_SHOWN = 8;
    const memHtml = memItems.length
      ? memItems.slice(-MEM_SHOWN).map(m => `<div class="mem-item ${m.fact ? 'mem-fact' : ''}">${escapeHtml(m.text)}</div>`).join('')
      : '<div class="status-empty">暂无长期记忆</div>';
    // B6：覆盖率统计走短 TTL 缓存
    const g = graphCoverageStatsCached();
    const graphMap = extension_settings[extensionName].chapterGraphMap || {};
    const covHtml = g.total > 0
      ? `<div class="cov-bar"><div class="cov-fill" style="width:${g.percent}%"></div></div>
         <div class="cov-text">${g.has}/${g.total} 章 · ${g.percent}% · 合并图谱 ${g.hasMerged ? g.mergedKB + ' KB' : '未生成'}</div>
         <div class="cov-chips">` +
         currentParsedChapters.slice(0, 60).map(c => {
           const has = !!graphMap[c.id];
           return `<span class="cov-chip ${has ? 'has' : ''}" data-chapter-id="${c.id}" title="第${c.id}章 ${escapeHtml(c.title)}">${c.id}</span>`;
         }).join('') + '</div>'
      : '<div class="status-empty">未加载小说</div>';
    $('#status-plan').html(planHtml);
    $('#status-tools').html(logHtml);
    $('#status-memory').html(memHtml);
    $('#status-coverage').html(covHtml);
  }

  // ============================================================
  // ▌Agent UI 核心：消息流、通知、任务
  // ============================================================
  const chatState = {
    messages: []  // { id, role: 'user'|'agent'|'system', text, time, taskId?, progress? }
  };

  function agentAddMessage(role, text, options = {}) {
    const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const msg = { id, role, text, time: Date.now(), ...options };
    chatState.messages.push(msg);
    if (chatState.messages.length > 200) chatState.messages = chatState.messages.slice(-200);
    // 只持久化最后 50 条，避免 localStorage 太大
    extension_settings[extensionName].chatMessages = chatState.messages.slice(-50);
    saveSettingsDebounced();
    renderChatMessage(msg);
    return id;
  }

  function agentNotify(text, type = 'info') {
    const roleMap = { info: 'agent', success: 'agent', warn: 'system', error: 'system' };
    const role = roleMap[type] || 'agent';
    agentAddMessage(role, text, { kind: type });
  }

  function agentTaskStart(text) {
    const id = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    agentAddMessage('agent', text, { taskId: id, progress: { current: 0, total: 0, text } });
    return id;
  }
  // bug6/8：消息可能因清空/Tab 重建而不在 DOM，找不到就重新渲染（带防重复插入判断）
  function ensureTaskMsgInDom(msg) {
    let el = getDoc().querySelector(`[data-msg-id="${msg.id}"]`);
    if (!el) {
      renderChatMessage(msg);
      el = getDoc().querySelector(`[data-msg-id="${msg.id}"]`);
    }
    return el;
  }
  function agentTaskProgress(taskId, current, total, text) {
    const msg = chatState.messages.find(m => m.taskId === taskId);
    if (!msg) return;
    msg.progress = { current, total, text };
    const el = ensureTaskMsgInDom(msg);
    if (el) updateProgressEl(el, msg);
  }
  // B13：任务结束默认按「final」完成卡渲染（语义上是任务完成，而非普通 info）
  function agentTaskEnd(taskId, text, type = 'final') {
    const msg = chatState.messages.find(m => m.taskId === taskId);
    if (!msg) { agentNotify(text, type); return; }
    msg.text = text;
    msg.kind = type;
    msg.progress = null;
    const el = ensureTaskMsgInDom(msg);
    if (el) {
      const bt = el.querySelector('.bubble-text');
      if (bt) bt.textContent = text;
      const p = el.querySelector('.bubble-progress');
      if (p) p.remove();
    }
  }

  function updateProgressEl(el, msg) {
    const p = el.querySelector('.bubble-progress');
    if (!p || !msg.progress) return;
    const { current, total, text } = msg.progress;
    const percent = total > 0 ? Math.floor((current / total) * 100) : 0;
    p.querySelector('.fill').style.width = percent + '%';
    const textEl = el.querySelector('.bubble-text');
    if (textEl && text) textEl.textContent = text + ` (${percent}%)`;
  }

  // 需求三/C：对话流卡片化 —— final 完成卡 / chapter_preview 缩略卡 / chapter_full 完整卡 / confirm 确认卡
  function renderChatMessage(msg) {
    const $flow = $('#chat-flow');
    if (!$flow.length) return;
    const el = getDoc().createElement('div');
    el.className = `chat-msg ${msg.role}`;
    el.setAttribute('data-msg-id', msg.id);
    const avatarText = msg.role === 'user' ? '你' : msg.role === 'agent' ? 'AI' : '系统';
    const progressHtml = msg.progress
      ? `<div class="bubble-progress"><div class="fill" style="width:${msg.progress.total > 0 ? Math.floor(msg.progress.current / msg.progress.total * 100) : 0}%"></div></div>`
      : '';
    let inner = '';
    const kindClass = ['final', 'welcome', 'error', 'success', 'warn', 'info'].includes(msg.kind) ? ' bubble-' + msg.kind : '';
    if (msg.kind === 'chapter_preview' || msg.kind === 'chapter_full') {
      const isFull = msg.kind === 'chapter_full';
      inner = `
        <div class="bubble-text chapter-card ${isFull ? 'chapter-full' : 'chapter-preview'}">${escapeHtml(String(msg.text || '').slice(0, isFull ? 3000 : 400))}</div>
        <div class="card-actions">
          <button class="card-btn" data-card-action="read" data-msg-id="${msg.id}">去阅读</button>
          <button class="card-btn" data-card-action="copy" data-msg-id="${msg.id}">复制</button>
          ${isFull ? `<button class="card-btn" data-card-action="adopt" data-msg-id="${msg.id}">采纳</button>` : ''}
        </div>`;
    } else if (msg.kind === 'confirm') {
      inner = `
        <div class="bubble-text">${escapeHtml(msg.confirmTool ? `确认执行「${msg.confirmTool}」？` : '确认操作？')}${msg.confirmArgs ? '<div class="confirm-args"><code>' + escapeHtml(msg.confirmArgs) + '</code></div>' : ''}</div>
        <div class="confirm-btns">
          <button class="card-btn confirm-ok" data-confirm-action="ok" data-confirm-id="${msg.confirmId}">确认</button>
          <button class="card-btn confirm-cancel" data-confirm-action="cancel" data-confirm-id="${msg.confirmId}">取消</button>
        </div>`;
    } else {
      inner = `<div class="bubble-text"></div>${progressHtml}`;
    }
    el.innerHTML = `
      <div class="chat-avatar">${avatarText}</div>
      <div class="chat-bubble ${kindClass}">${inner}</div>`;
    if (msg.kind !== 'chapter_preview' && msg.kind !== 'chapter_full' && msg.kind !== 'confirm') {
      const bt = el.querySelector('.bubble-text');
      if (bt) bt.textContent = (msg.progress && msg.progress.text) ? msg.progress.text : msg.text;
    }
    $flow.get(0).appendChild(el);
    // 自动滚到底
    const flowEl = $flow.get(0);
    flowEl.scrollTop = flowEl.scrollHeight;
  }

  function clearChat() {
    chatState.messages = [];
    extension_settings[extensionName].chatMessages = [];
    saveSettingsDebounced();
    $('#chat-flow').empty();
  }

  function restoreChat() {
    const saved = extension_settings[extensionName].chatMessages || [];
    $('#chat-flow').empty();
    // B9：拷贝数组，避免与持久化数组共享引用（后续 slice(-50) 覆盖写入时不会把旧全量写回去）
    chatState.messages = saved.slice();
    saved.forEach(msg => renderChatMessage(msg));
    if (saved.length === 0) {
      agentAddMessage('agent', '👋 你好，我是小说续写 Agent。\n\n现在我可以自主完成多步任务：\n· 上传小说 TXT，我会自动解析章节\n· 直接说需求，例如「把这本书续写到第 20 章，风格别跑偏」\n· 我会自己：检查图谱 → 补生成 → 合并 → 定位进度 → 逐章续写 → 每章回填图谱\n· 中途发现问题会自己调整；右侧面板可实时查看我的思考、工具调用与记忆\n· 也可用底部快捷按钮手动操作', { kind: 'welcome' });
    }
  }

  // ============================================================
  // ▌UI 渲染与交互
  // ============================================================
  function renderChapterList(chapters) {
    const $list = $('#chapter-list');
    const graphMap = extension_settings[extensionName].chapterGraphMap || {};
    const selectedIds = new Set(extension_settings[extensionName].selectedChapterIds || []);
    const currentReaderChapterId = (extension_settings[extensionName].readerState || {}).currentChapterId;
    // 需求三/D：章节搜索（标题/正文片段）
    const search = String($('#chapter-search').val() || '').trim().toLowerCase();

    const total = chapters.length + continueWriteChain.length;
    $('#chapter-count-badge').text(total);

    if (chapters.length === 0 && continueWriteChain.length === 0) {
      $list.html(`
        <div class="chapter-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          <div>尚未解析章节</div>
          <div style="margin-top:6px;font-size:12px;opacity:.7">上传小说后自动解析</div>
        </div>`);
      return;
    }

    let html = '';
    // 原始章节
    chapters.forEach(chapter => {
      // bug18：标题里的换行会破坏 title 属性，统一压成空格
      const titleClean = String(chapter.title).replace(/[\r\n]+/g, ' ');
      if (search && !(titleClean.toLowerCase().includes(search) || chapter.content.slice(0, 300).toLowerCase().includes(search))) return;
      const selected = selectedIds.has(chapter.id);
      const hasGraph = !!graphMap[chapter.id];
      const isCurrent = currentReaderChapterId === chapter.id;
      html += `
        <div class="chapter-item ${selected ? 'selected' : ''} ${isCurrent ? 'active' : ''}" data-chapter-id="${chapter.id}" data-chapter-type="original">
          <div class="checkbox"></div>
          <span class="ch-title" title="${escapeHtml(titleClean)}">${escapeHtml(chapter.title)}</span>
          <span class="ch-badge ${hasGraph ? 'has-graph' : ''}">${hasGraph ? '图谱✓' : '无'}</span>
        </div>`;
    });

    // 续写章节（挂在各自基准章节下面）
    const continuesByBase = {};
    continueWriteChain.forEach(c => {
      if (!continuesByBase[c.baseChapterId]) continuesByBase[c.baseChapterId] = [];
      continuesByBase[c.baseChapterId].push(c);
    });
    // bug5：续写编号按全局续写顺序（continueWriteChain 全局下标），不再按各基准分组从 1 开始
    let globalContinueIdx = 0;
    Object.keys(continuesByBase).forEach(baseId => {
      continuesByBase[baseId].forEach(c => {
        globalContinueIdx++;
        const isCurrent = currentReaderChapterId === c.id;
        const titleClean = String(c.title || `续写章节 ${globalContinueIdx}`).replace(/[\r\n]+/g, ' ');
        if (search && !titleClean.toLowerCase().includes(search)) return;
        html += `
          <div class="chapter-item continue-item ${isCurrent ? 'active' : ''}" data-chapter-id="${c.id}" data-chapter-type="continue">
            <div class="checkbox" style="visibility:hidden"></div>
            <span class="ch-title" title="${escapeHtml(titleClean)}">↳ ${escapeHtml(c.title || `续写章节 ${globalContinueIdx}`)}</span>
            <span class="ch-badge continue-chapter">续</span>
          </div>`;
      });
    });

    $list.html(html);
  }

  function updateStats() {
    const chapterCount = currentParsedChapters.length;
    const graphCount = Object.keys(extension_settings[extensionName].chapterGraphMap || {}).length;
    $('#agent-stats').text(`${chapterCount} 章 · ${graphCount} 图谱`);
    renderStatusPanel();
  }

  function updateCurrentNovelName(name) {
    if (name) {
      extension_settings[extensionName].currentNovelName = name;
      $('#agent-novel-name').text(name);
    } else {
      $('#agent-novel-name').text('未加载小说');
    }
  }

  function refreshGraphPanel() {
    const mergedGraph = extension_settings[extensionName].mergedGraph || {};
    const isEmpty = Object.keys(mergedGraph).length === 0;
    const text = isEmpty ? '' : JSON.stringify(mergedGraph, null, 2);
    $('#graph-preview').val(text);
    const sizeKB = (new Blob([text]).size / 1024).toFixed(1);
    $('#graph-size').text(`${sizeKB} KB`);
    $('#graph-validate-result').hide();
    renderStatusPanel();
  }

  // ============ Tab 切换 ============
  function switchTab(tabName) {
    $('.agent-tab').removeClass('active');
    $(`.agent-tab[data-tab="${tabName}"]`).addClass('active');
    $('.agent-panel').removeClass('active');
    $(`#panel-${tabName}`).addClass('active');
    extension_settings[extensionName].activeTab = tabName;
    saveSettingsDebounced();
    // 移动端：Tab 栏已隐藏，用顶部标题右侧的小指示器提示当前视图
    try {
      const labels = { chat: '对话', reader: '阅读', graph: '图谱' };
      const $ind = $('#agent-tab-indicator');
      if ($ind.length) $ind.text('· ' + (labels[tabName] || '对话'));
    } catch (_) {}
  }

  // ============ 阅读器 ============
  function loadChapterToReader(chapterId, chapterType = 'original') {
    const readerState = extension_settings[extensionName].readerState || (extension_settings[extensionName].readerState = { fontSize: 16, readProgress: {} });
    let chapterData = null;
    let chapterTitle = '';
    if (chapterType === 'original') {
      chapterData = currentParsedChapters.find(item => item.id === chapterId);
      if (!chapterData) return;
      chapterTitle = chapterData.title;
    } else {
      chapterData = continueWriteChain.find(item => item.id === chapterId);
      if (!chapterData) return;
      const idx = continueWriteChain.filter(c => c.baseChapterId === chapterData.baseChapterId).findIndex(c => c.id === chapterId) + 1;
      chapterTitle = `续写章节 ${idx}`;
    }

    readerState.currentChapterId = chapterId;
    readerState.currentChapterType = chapterType;
    saveSettingsDebounced();

    $('#reader-title').text(chapterTitle);
    const $content = $('#reader-content');
    $content.empty();
    $content.text(chapterData.content);

    // 恢复阅读进度
    const key = `${chapterType}_${chapterId}`;
    const savedScroll = (readerState.readProgress || {})[key] || 0;
    const contentEl = $content.get(0);
    requestAnimationFrame(() => {
      contentEl.scrollTop = savedScroll;
      updateReaderProgress();
    });

    // 更新章节列表高亮
    renderChapterList(currentParsedChapters);
    updatePrevNextBtns(chapterId, chapterType);
  }

  function updateReaderProgress() {
    const contentEl = $('#reader-content').get(0);
    if (!contentEl) return;
    const max = contentEl.scrollHeight - contentEl.clientHeight;
    const percent = max > 0 ? Math.floor((contentEl.scrollTop / max) * 100) : 100;
    $('#reader-progress-fill').css('width', percent + '%');
    $('#reader-progress-text').text(percent + '%');

    const readerState = extension_settings[extensionName].readerState;
    if (readerState) {
      const key = `${readerState.currentChapterType}_${readerState.currentChapterId}`;
      readerState.readProgress = readerState.readProgress || {};
      readerState.readProgress[key] = contentEl.scrollTop;
      saveSettingsDebounced();
    }
  }

  function updatePrevNextBtns(chapterId, chapterType) {
    let hasPrev = false, hasNext = false;
    if (chapterType === 'original') {
      const idx = currentParsedChapters.findIndex(c => c.id === chapterId);
      hasPrev = idx > 0;
      hasNext = idx < currentParsedChapters.length - 1;
      // 检查是否有续写章节挂在这章下面
      if (continueWriteChain.some(c => c.baseChapterId === chapterId)) hasNext = true;
    } else {
      const c = continueWriteChain.find(c => c.id === chapterId);
      if (c) {
        const sameBase = continueWriteChain.filter(x => x.baseChapterId === c.baseChapterId);
        const idx = sameBase.findIndex(x => x.id === chapterId);
        hasPrev = idx > 0 || currentParsedChapters.some(x => x.id === c.baseChapterId);
        hasNext = idx < sameBase.length - 1 || currentParsedChapters.some(x => x.id > c.baseChapterId);
      }
    }
    $('#reader-prev').prop('disabled', !hasPrev);
    $('#reader-next').prop('disabled', !hasNext);
  }

  function readerPrev() {
    const readerState = extension_settings[extensionName].readerState;
    const { currentChapterId, currentChapterType } = readerState;
    if (currentChapterType === 'original') {
      const idx = currentParsedChapters.findIndex(c => c.id === currentChapterId);
      if (idx > 0) loadChapterToReader(currentParsedChapters[idx - 1].id, 'original');
    } else {
      const c = continueWriteChain.find(c => c.id === currentChapterId);
      if (!c) return;
      const sameBase = continueWriteChain.filter(x => x.baseChapterId === c.baseChapterId);
      const idx = sameBase.findIndex(x => x.id === currentChapterId);
      if (idx > 0) loadChapterToReader(sameBase[idx - 1].id, 'continue');
      else loadChapterToReader(c.baseChapterId, 'original');
    }
  }

  function readerNext() {
    const readerState = extension_settings[extensionName].readerState;
    const { currentChapterId, currentChapterType } = readerState;
    if (currentChapterType === 'original') {
      // 先检查是否有续写挂在本章下
      const continues = continueWriteChain.filter(c => c.baseChapterId === currentChapterId);
      if (continues.length > 0) { loadChapterToReader(continues[0].id, 'continue'); return; }
      const idx = currentParsedChapters.findIndex(c => c.id === currentChapterId);
      if (idx < currentParsedChapters.length - 1) loadChapterToReader(currentParsedChapters[idx + 1].id, 'original');
    } else {
      const c = continueWriteChain.find(c => c.id === currentChapterId);
      if (!c) return;
      const sameBase = continueWriteChain.filter(x => x.baseChapterId === c.baseChapterId);
      const idx = sameBase.findIndex(x => x.id === currentChapterId);
      if (idx < sameBase.length - 1) loadChapterToReader(sameBase[idx + 1].id, 'continue');
      else {
        const baseIdx = currentParsedChapters.findIndex(x => x.id === c.baseChapterId);
        if (baseIdx < currentParsedChapters.length - 1) loadChapterToReader(currentParsedChapters[baseIdx + 1].id, 'original');
      }
    }
  }

  function setFontSize(size) {
    const readerState = extension_settings[extensionName].readerState || (extension_settings[extensionName].readerState = { fontSize: 16, readProgress: {} });
    const clamped = Math.max(12, Math.min(28, size));
    readerState.fontSize = clamped;
    saveSettingsDebounced();
    $('#reader-content').css('font-size', clamped + 'px');
  }

  // ============================================================
  // ▌指令入口：控制类指令本地即时处理，其余交给 Agent 自主决策
  // ============================================================
  async function handleCommand(text) {
    const t = String(text || '').trim();
    if (!t) return;
    // 安全/控制类指令本地即时处理（不进 Agent 循环，保证响应速度）
    if (/^(停止|取消|停一下?|stop)/i.test(t)) {
      stopGenerateFlag = true;
      stopSending = true;
      agentNotify('⏹ 已请求停止', 'info');
      return;
    }
    // 需求四B3：继续上次未完成任务（原样传入，由 runAgent 识别续跑意图）
    if (/^(继续|接着|continue)/i.test(t)) {
      if (Array.isArray(agentState.pendingMessages) && agentState.pendingMessages.length) {
        runAgent(t);
      } else {
        agentNotify('ℹ 当前没有可继续的未完成任务', 'info');
      }
      return;
    }
    // B16：仅完整命中「清空/清除」指令才触发全清，避免「清空一下上一段对话」等普通输入误触发
    if (/^(清空|清除)(\s*(全部|所有|一切)?\s*(数据|内容|章节|图谱)?)?$/.test(t)) {
      const keep = await agentConfirmBox('确定清空当前所有解析章节、图谱和续写链？此操作不可撤销。');
      if (keep) clearAllData();
      return;
    }
    // 其余输入全部交给 Agent 主循环：模型自己决定调什么工具、按什么顺序、何时结束
    runAgent(t);
  }

  // 兼容 generateNovelWrite 使用的两个隐藏输入
  function ensureHiddenWriteInputs(chapterId, content) {
    const doc = getDoc();
    if (!doc.getElementById('write-chapter-content')) {
      const ta = doc.createElement('textarea');
      ta.id = 'write-chapter-content';
      ta.style.display = 'none';
      doc.body.appendChild(ta);
    }
    if (!doc.getElementById('write-word-count')) {
      const inp = doc.createElement('input');
      inp.id = 'write-word-count';
      inp.type = 'number';
      inp.style.display = 'none';
      doc.body.appendChild(inp);
    }
    doc.getElementById('write-chapter-content').value = content || '';
    extension_settings[extensionName].selectedBaseChapterId = chapterId;
  }

  // ============================================================
  // ▌主题体系 / 断点恢复 / 命令面板（需求三A + 四B2）
  // ============================================================
  const AGENT_THEMES = ['dark', 'light', 'sepia'];
  function applyAgentTheme(theme) {
    const t = AGENT_THEMES.includes(theme) ? theme : 'dark';
    const root = getDoc().querySelector('.agent-root');
    if (root) root.setAttribute('data-theme', t);
    extension_settings[extensionName].agentTheme = t;
    saveSettingsDebounced();
  }

  // B15：自绘确认框（Promise 化）—— 替代 iframe 内可能被浏览器策略屏蔽的 window.confirm
  function agentConfirmBox(text, okLabel, cancelLabel) {
    return new Promise(resolve => {
      const $m = $('#agent-confirm-modal');
      if (!$m.length) { resolve(false); return; }
      $('#agent-confirm-text').text(String(text || ''));
      if (okLabel) $('#agent-confirm-yes').text(okLabel);
      if (cancelLabel) $('#agent-confirm-no').text(cancelLabel);
      const finish = (v) => {
        $m.removeClass('open');
        $('#agent-confirm-yes').off('click.agcfm');
        $('#agent-confirm-no').off('click.agcfm');
        $m.off('click.agcfm');
        resolve(v);
      };
      $('#agent-confirm-yes').off('click.agcfm').on('click.agcfm', () => finish(true));
      $('#agent-confirm-no').off('click.agcfm').on('click.agcfm', () => finish(false));
      $m.off('click.agcfm').on('click.agcfm', function (e) { if (e.target === this) finish(false); });
      $m.addClass('open');
    });
  }

  function restoreCheckpoint() {
    const cp = extension_settings[extensionName].agentCheckpoint;
    if (!cp || !cp.payload) return;
    const { baseChapterId, wordCount, chapterCount, progress } = cp.payload;
    setTimeout(async () => {
      const keep = await agentConfirmBox(`检测到上次续写任务未完成（基准第 ${baseChapterId} 章，已完成 ${progress || 0}/${chapterCount} 章）。是否继续完成上次任务？`);
      extension_settings[extensionName].agentCheckpoint = null;
      if (keep) {
        // 先移除该任务已生成的续写章节，避免重复
        const written = continueWriteChain.filter(c => c.baseChapterId === baseChapterId).slice(-(progress || 0));
        written.forEach(c => {
          const i = continueWriteChain.findIndex(x => x.id === c.id);
          if (i >= 0) continueWriteChain.splice(i, 1);
        });
        extension_settings[extensionName].continueWriteChain = continueWriteChain;
        const base = currentParsedChapters.find(c => c.id === baseChapterId);
        if (base) {
          ensureHiddenWriteInputs(baseChapterId, base.content);
          saveSettingsDebounced();
          renderChapterList(currentParsedChapters);
          updateStats();
          generateNovelWrite(baseChapterId, wordCount, chapterCount, cp.payload.extraDirectives || '');
        } else {
          agentNotify('⚠ 基准章节已不存在，无法继续上次任务', 'warn');
        }
      }
      saveSettingsDebounced();
    }, 600);
  }

  // ============================================================
  // ▌数据加载与保存
  // ============================================================
  async function loadSettings() {
    const ext = extension_settings[extensionName];
    // bug16：就地合并到现有 settings 对象，不再 new object 替换引用（避免旧引用失效）
    const merged = deepMerge(defaultSettings, ext);
    Object.keys(merged).forEach(k => { ext[k] = merged[k]; });
    for (const key of Object.keys(defaultSettings)) {
      if (!Object.hasOwn(ext, key)) ext[key] = JSON.parse(JSON.stringify(defaultSettings[key]));
    }
    currentParsedChapters = ext.chapterList || [];
    continueWriteChain = ext.continueWriteChain || [];
    continueChapterIdCounter = ext.continueChapterIdCounter || 1;
    currentPrecheckResult = ext.precheckReport || null;
    batchMergedGraphs = ext.batchMergedGraphs || [];

    // UI 回填
    $('#chapter-regex-input').val(ext.chapterRegex || '');
    const readerState = ext.readerState || {};
    $('#reader-content').css('font-size', (readerState.fontSize || 16) + 'px');
    $('#agent-novel-name').text(ext.currentNovelName || '未加载小说');

    // 需求三A：主题 + 需求三B：侧栏宽度恢复
    applyAgentTheme(ext.agentTheme || 'dark');
    if (ext.agentSidebarWidth) $('#agent-sidebar').css('width', ext.agentSidebarWidth + 'px');

    // 侧栏折叠状态
    if (ext.sidebarCollapsed) $('#agent-sidebar').addClass('collapsed');

    // Tab 恢复
    switchTab(ext.activeTab || 'chat');

    // 状态面板恢复
    if (ext.statusPanelCollapsed) $('#agent-status-panel').addClass('collapsed');

    // 移动端：抽屉一律默认收起（不写回持久化，避免污染桌面端）
    if (isMobileLayout()) {
      $('#agent-sidebar').addClass('collapsed');
      $('#agent-status-panel').addClass('collapsed');
      $('#agent-input').attr('placeholder', '说说你的续写需求…');
    }
    updateDrawerBackdrop();

    renderStatusPanel();

    renderChapterList(currentParsedChapters);
    refreshGraphPanel();
    updateStats();
    restoreChat();

    // 需求四B2：断点恢复（询问是否继续上次未完成的续写）
    restoreCheckpoint();

    isInitialized = true;
  }

  function clearAllData() {
    // bug4：白名单清空 —— 用户设置/对话/偏好保留，其余（章节、图谱、续写链、校验报告、画布等）全部重置
    const s = extension_settings[extensionName];
    const KEEP = new Set([
      'chapterRegex',
      'enablePrecheck', 'enableWriteQualityGate', 'writeQualityMinChars',
      'rateLimitEnabled', 'rateLimitMaxCalls', 'rateLimitWindow', 'rateLimitUnit',
      'enableAutoParentPreset', 'enableTavernPresetInject', 'agentMaxSteps',
      'agentTheme', 'agentSidebarWidth'
    ]);
    Object.keys(defaultSettings).forEach(k => {
      if (!KEEP.has(k)) s[k] = JSON.parse(JSON.stringify(defaultSettings[k]));
    });
    // 运行时状态同步（含此前漏清的状态）
    currentParsedChapters = [];
    continueWriteChain = [];
    continueChapterIdCounter = 1;
    batchMergedGraphs = [];
    currentPrecheckResult = null;
    chatState.messages = [];
    saveSettingsDebounced();
    $('#chat-flow').empty();
    renderChapterList([]);
    refreshGraphPanel();
    updateStats();
    updateCurrentNovelName('');
    $('#reader-content').html('<div class="empty-hint">从左侧选择章节开始阅读</div>');
    $('#reader-title').text('未选择章节');
    $('#chapter-regex-input').val(s.chapterRegex || '');
    agentNotify('🗑 已清空全部数据（保留设置与对话记忆）', 'info');
  }

  // ============================================================
  // ▌入口与事件绑定
  // ============================================================
  let _novelWriterOpened = false;

  async function openNovelWriter(opts) {
    opts = opts || {};
    const silent = !!opts.silent;
    if (_novelWriterOpened && _novelIframe) {
      try {
        if (_novelIframe) _novelIframe.style.visibility = 'visible';
        const $panel = _novelIframeJQ ? _novelIframeJQ('#novel-agent-panel') : null;
        if ($panel && !$panel.hasClass('show')) $panel.addClass('show');
        if (!silent && _novelIframeWin && _novelIframeWin.toastr) _novelIframeWin.toastr.info('小说续写 Agent 已打开');
      } catch (_) {}
      return;
    }
    _novelWriterOpened = true;
    _loadSettingsCache();
    try {
      await _createNovelIframe();
      try { await loadSettings(); } catch(e) { console.error('[小说续写Agent] loadSettings 失败:', e); }
      bindAllEvents();
      setTimeout(function () {
        try {
          if (_novelIframe) {
            const panelOpen = _novelIframeJQ && _novelIframeJQ('#novel-agent-panel').hasClass('show');
            _novelIframe.style.visibility = panelOpen ? 'visible' : 'hidden';
          }
        } catch (_) {}
      }, 60);
      if (!silent && _novelIframeWin && _novelIframeWin.toastr) {
        _novelIframeWin.toastr.success('小说续写 Agent 已打开');
      }
    } catch (error) {
      console.error('[小说续写Agent] open 失败:', error);
      _novelWriterOpened = false;
      try { if (_novelIframe) _novelIframe.style.visibility = 'hidden'; } catch(_) {}
      throw error;
    }
  }

  // 需求三B：命令面板路由（/graph /write /merge /chapter N /settings /theme）
  function runCommandPalette(cmd) {
    const t = String(cmd || '').trim();
    if (!t) return;
    if (/^\/graph\b/.test(t)) {
      agentAddMessage('user', '/graph（生成缺失图谱）');
      const missing = currentParsedChapters.filter(c => !(extension_settings[extensionName].chapterGraphMap || {})[c.id]);
      generateChapterGraphBatch(missing);
      return;
    }
    if (/^\/write\b/.test(t)) {
      const $inp = $('#agent-input');
      if ($inp.length) $inp.focus();
      agentNotify('在输入框直接描述续写需求，例如「续写 10 章」', 'info');
      return;
    }
    if (/^\/merge\b/.test(t)) {
      agentAddMessage('user', '/merge（全量合并图谱）');
      mergeAllGraphs();
      return;
    }
    if (/^\/chapter\s+(\d+)/.test(t)) {
      const m = t.match(/^\/chapter\s+(\d+)/);
      const id = parseInt(m[1], 10);
      const isOriginal = currentParsedChapters.some(c => c.id === id);
      const isContinue = continueWriteChain.some(c => c.id === id);
      if (!isOriginal && !isContinue) { agentNotify(`❌ 章节 ${id} 不存在`, 'error'); return; }
      loadChapterToReader(id, isOriginal ? 'original' : 'continue');
      switchTab('reader');
      return;
    }
    if (/^\/settings\b/.test(t)) {
      const $btn = $('#agent-settings-btn');
      if ($btn.length) $btn.trigger('click');
      return;
    }
    if (/^\/theme\b/.test(t)) {
      const cur = extension_settings[extensionName].agentTheme || 'dark';
      applyAgentTheme(AGENT_THEMES[(AGENT_THEMES.indexOf(cur) + 1) % AGENT_THEMES.length]);
      return;
    }
    // 其余命令视为普通输入交给 Agent
    runAgent(t.replace(/^\//, ''));
  }

  // ============================================================
  // ▌移动端适配：抽屉管理 + 触屏语义（新增于 bindAllEvents 之前）
  // ============================================================
  const _mqMobile = (function () {
    try { return window.matchMedia('(max-width: 720px)'); }
    catch (_) { return { matches: false, addEventListener() {}, addListener() {} }; }
  })();
  function isMobileLayout() { return !!_mqMobile.matches; }

  function updateDrawerBackdrop() {
    const open = isMobileLayout() && (
      !$('#agent-sidebar').hasClass('collapsed') ||
      !$('#agent-status-panel').hasClass('collapsed')
    );
    $('#agent-drawer-backdrop').toggleClass('show', open);
  }

  function closeDrawers() {
    if (!isMobileLayout()) return;
    $('#agent-sidebar').addClass('collapsed');
    $('#agent-status-panel').addClass('collapsed');
    updateDrawerBackdrop();
  }

  function bindAllEvents() {
    const doc = getDoc();

    // ========== 顶部按钮 ==========
    $('#agent-close-btn').off('click').on('click', function (e) {
      e.stopPropagation();
      try { _novelIframeJQ('#novel-agent-panel').removeClass('show'); } catch (_) {}
      try { _flushSettings(); } catch (_) {}
      setTimeout(function () { if (_novelIframe) _novelIframe.style.visibility = 'hidden'; }, 150);
    });

    $('#agent-sidebar-toggle').off('click').on('click', function () {
      const $sb = $('#agent-sidebar');
      $sb.toggleClass('collapsed');
      // 移动端不写持久化，避免影响桌面端布局
      if (!isMobileLayout()) {
        extension_settings[extensionName].sidebarCollapsed = $sb.hasClass('collapsed');
        saveSettingsDebounced();
      } else if (!$sb.hasClass('collapsed')) {
        $('#agent-status-panel').addClass('collapsed');  // 左右抽屉互斥
      }
      updateDrawerBackdrop();
    });

    $('#agent-status-toggle').off('click').on('click', function () {
      const $sp = $('#agent-status-panel');
      $sp.toggleClass('collapsed');
      if (!isMobileLayout()) {
        extension_settings[extensionName].statusPanelCollapsed = $sp.hasClass('collapsed');
        saveSettingsDebounced();
      } else if (!$sp.hasClass('collapsed')) {
        $('#agent-sidebar').addClass('collapsed');
      }
      updateDrawerBackdrop();
    });

    // 移动端：遮罩点击关闭抽屉
    $('#agent-drawer-backdrop').off('click').on('click', closeDrawers);

    // 移动端：更多菜单
    $('#agent-more-btn').off('click').on('click', function (e) {
      e.stopPropagation();
      $('#agent-more-menu').toggleClass('open');
    });
    $(doc).off('click.agmore').on('click.agmore', function () { $('#agent-more-menu').removeClass('open'); });
    $('#agent-more-menu').off('click').on('click', function (e) {
      const $item = $(e.target).closest('[data-more-action]');
      if (!$item.length) return;
      const act = $item.data('more-action');
      $('#agent-more-menu').removeClass('open');
      if (act === 'status') {
        $('#agent-status-panel').toggleClass('collapsed');
        $('#agent-sidebar').addClass('collapsed');
        updateDrawerBackdrop();
      } else if (act === 'theme') $('#agent-theme-btn').trigger('click');
      else if (act === 'settings') $('#agent-settings-btn').trigger('click');
      else if (act === 'clear') $('#agent-clear-btn').trigger('click');
    });

    $('#agent-clear-btn').off('click').on('click', function () {
      if (confirm('确定清空当前所有解析章节、图谱和续写链？此操作不可撤销。')) clearAllData();
    });

    // ========== 需求三A：主题切换 ==========
    $('#agent-theme-btn').off('click').on('click', function () {
      const cur = extension_settings[extensionName].agentTheme || 'dark';
      const next = AGENT_THEMES[(AGENT_THEMES.indexOf(cur) + 1) % AGENT_THEMES.length];
      applyAgentTheme(next);
      agentNotify(`🎨 主题已切换为：${next === 'dark' ? '暗色' : next === 'light' ? '亮色' : '护眼'}`, 'info');
    });

    // ========== 需求一 UI + 需求二：设置模态框 ==========
    function populateSettingsModal() {
      const s = extension_settings[extensionName];
      $('#set-enable-precheck').prop('checked', s.enablePrecheck !== false);
      $('#set-write-quality-gate').prop('checked', s.enableWriteQualityGate !== false);
      $('#set-write-quality-min-chars').val(s.writeQualityMinChars || 300);
      $('#set-rate-limit-enabled').prop('checked', s.rateLimitEnabled !== false);
      $('#set-rate-limit-max').val(s.rateLimitMaxCalls || 3);
      $('#set-rate-limit-window').val(s.rateLimitWindow || 60);
      $('#set-rate-limit-unit').val(s.rateLimitUnit === 's' ? 's' : 'm');
      $('#set-enable-preset-inject').prop('checked', s.enableTavernPresetInject !== false);
      $('#set-enable-auto-parent-preset').prop('checked', s.enableAutoParentPreset !== false);
      $('#set-agent-max-steps').val(s.agentMaxSteps || 12);
      $('#set-continue-graph-backfill').prop('checked', s.enableContinueGraphBackfill === true);
      $('#set-enable-streaming').prop('checked', s.enableStreaming !== false);
      $('#set-enable-parallel').prop('checked', s.enableParallelTools !== false);
      $('#set-enable-plan-gate').prop('checked', s.enablePlanGate !== false);
      $('#set-context-budget').val(s.agentContextBudget || 24000);
    }
    function openSettingsModal() {
      populateSettingsModal();
      $('#agent-settings-modal').addClass('open');
    }
    function closeSettingsModal() { $('#agent-settings-modal').removeClass('open'); }
    $('#agent-settings-btn').off('click').on('click', openSettingsModal);
    $('#settings-close-btn, #settings-cancel-btn').off('click').on('click', closeSettingsModal);
    $('#agent-settings-modal').off('click').on('click', function (e) {
      if (e.target === this) closeSettingsModal();
    });
    $('#settings-save-btn').off('click').on('click', function () {
      const s = extension_settings[extensionName];
      s.enablePrecheck = $('#set-enable-precheck').is(':checked');
      s.enableWriteQualityGate = $('#set-write-quality-gate').is(':checked');
      s.writeQualityMinChars = Math.max(100, parseInt($('#set-write-quality-min-chars').val(), 10) || 300);
      s.rateLimitEnabled = $('#set-rate-limit-enabled').is(':checked');
      s.rateLimitMaxCalls = Math.max(1, Math.min(60, parseInt($('#set-rate-limit-max').val(), 10) || 3));
      s.rateLimitWindow = Math.max(1, Math.min(120, parseInt($('#set-rate-limit-window').val(), 10) || 60));
      s.rateLimitUnit = $('#set-rate-limit-unit').val() === 's' ? 's' : 'm';
      s.enableTavernPresetInject = $('#set-enable-preset-inject').is(':checked');
      s.enableAutoParentPreset = $('#set-enable-auto-parent-preset').is(':checked');
      s.agentMaxSteps = Math.max(2, Math.min(30, parseInt($('#set-agent-max-steps').val(), 10) || 12));
      s.enableContinueGraphBackfill = $('#set-continue-graph-backfill').is(':checked');
      s.enableStreaming = $('#set-enable-streaming').is(':checked');
      s.enableParallelTools = $('#set-enable-parallel').is(':checked');
      s.enablePlanGate = $('#set-enable-plan-gate').is(':checked');
      s.agentContextBudget = Math.max(4000, Math.min(200000, parseInt($('#set-context-budget').val(), 10) || 24000));
      saveSettingsDebounced();
      closeSettingsModal();
      agentNotify('✅ 设置已保存（质检、限流、流式、并行、规划门均即时生效）', 'success');
    });

    // ========== 需求三B：⌘K 命令面板 ==========
    function openCommandPalette() {
      $('#command-palette').addClass('open');
      setTimeout(() => {
        const $i = $('#command-palette-input');
        if ($i.length) { $i.focus(); $i.val(''); }
      }, 30);
    }
    function closeCommandPalette() { $('#command-palette').removeClass('open'); }
    $(doc).off('keydown.agpalette').on('keydown.agpalette', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if ($('#command-palette').hasClass('open')) closeCommandPalette();
        else openCommandPalette();
      }
    });
    $('#command-palette').off('click').on('click', function (e) { if (e.target === this) closeCommandPalette(); });
    $('#command-palette-input').off('keydown').on('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = String($(this).val() || '').trim();
        closeCommandPalette();
        if (cmd) runCommandPalette(cmd);
      } else if (e.key === 'Escape') {
        closeCommandPalette();
      }
    });

    // ========== 需求三D：章节搜索 + 右键菜单 ==========
    $('#chapter-search').off('input').on('input', function () { renderChapterList(currentParsedChapters); });

    let $ctxMenu = null;
    function closeCtxMenu() { if ($ctxMenu) { $ctxMenu.remove(); $ctxMenu = null; } }
    // 移动端迭代⑥：抽出右键菜单逻辑，桌面 contextmenu 与触屏长按共用
    function openChapterContextMenu($item, clientX, clientY) {
      closeCtxMenu();
      const chapterId = parseInt($item.data('chapter-id'), 10);
      const chapterType = $item.data('chapter-type');
      const graphMap = extension_settings[extensionName].chapterGraphMap || {};
      const hasGraph = chapterType === 'original' ? !!graphMap[chapterId] : !!graphMap[`continue_${chapterId}`];
      const items = [];
      if (chapterType === 'original') {
        items.push({ label: hasGraph ? '重新生成章节图谱' : '生成本章图谱', action: 'gen-graph' });
        items.push({ label: '作为续写基准', action: 'as-base' });
      } else {
        items.push({ label: '删除续写章节', action: 'del-continue', danger: true });
      }
      items.push({ label: '在阅读器中打开', action: 'open-reader' });
      let menuHtml = '';
      items.forEach(it => { menuHtml += `<button class="ctx-item ${it.danger ? 'ctx-danger' : ''}" data-ctx-action="${it.action}" data-ctx-id="${chapterId}" data-ctx-type="${chapterType}">${it.label}</button>`; });
      const $menu = $(`<div class="chapter-context-menu">${menuHtml}</div>`);
      getDoc().body.appendChild($menu.get(0));
      $ctxMenu = $menu;
      const w = ($menu.outerWidth && $menu.outerWidth()) || 180;
      const h = ($menu.outerHeight && $menu.outerHeight()) || 130;
      const maxX = (getDoc().documentElement.clientWidth || 800) - w;
      const maxY = (getDoc().documentElement.clientHeight || 600) - h;
      $menu.css({ left: Math.max(0, Math.min(clientX, maxX)) + 'px', top: Math.max(0, Math.min(clientY, maxY)) + 'px' });
    }
    $('#chapter-list').off('contextmenu').on('contextmenu', '.chapter-item', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openChapterContextMenu($(this), e.clientX, e.clientY);
    });
    // 触屏长按呼出（替代右键；滑动/抬起即取消计时）
    let _lpTimer = null, _lpFired = false;
    $('#chapter-list')
      .off('touchstart').on('touchstart', '.chapter-item', function (e) {
        const $item = $(this);
        const t = e.touches && e.touches[0];
        if (!t) return;
        _lpFired = false;
        clearTimeout(_lpTimer);
        _lpTimer = setTimeout(function () {
          _lpFired = true;
          if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
          openChapterContextMenu($item, t.clientX, t.clientY);
        }, 460);
      })
      .off('touchmove touchend touchcancel').on('touchmove touchend touchcancel', function () {
        clearTimeout(_lpTimer);
      });
    $(doc).off('click.agctx').on('click.agctx', closeCtxMenu);
    $(doc).off('click', '.ctx-item').on('click', '.ctx-item', function () {
      const action = $(this).data('ctx-action');
      const id = parseInt($(this).data('ctx-id'), 10);
      const type = $(this).data('ctx-type');
      closeCtxMenu();
      if (action === 'gen-graph') {
        const ch = currentParsedChapters.find(c => c.id === id);
        if (ch) generateChapterGraphBatch([ch]);
      } else if (action === 'as-base') {
        const ch = currentParsedChapters.find(c => c.id === id);
        if (!ch) return;
        ensureHiddenWriteInputs(id, ch.content);
        agentNotify(`📌 已将以「${ch.title}」为续写基准`, 'info');
      } else if (action === 'del-continue') {
        if (confirm(`确定删除续写章节 ${id}？`)) {
          const idx = continueWriteChain.findIndex(c => c.id === id);
          if (idx >= 0) {
            continueWriteChain.splice(idx, 1);
            const graphMap = extension_settings[extensionName].chapterGraphMap || {};
            delete graphMap[`continue_${id}`];
            extension_settings[extensionName].chapterGraphMap = graphMap;
            extension_settings[extensionName].continueWriteChain = continueWriteChain;
            saveSettingsDebounced();
            renderChapterList(currentParsedChapters);
            updateStats();
            agentNotify('🗑 已删除续写章节', 'info');
          }
        }
      } else if (action === 'open-reader') {
        loadChapterToReader(id, type);
        switchTab('reader');
      }
    });

    // ========== 需求四E：图谱覆盖章节点击跳转 ==========
    $('#agent-status-panel').off('click', '.cov-chip').on('click', '.cov-chip', function () {
      const id = parseInt($(this).data('chapter-id'), 10);
      if (currentParsedChapters.some(c => c.id === id)) {
        loadChapterToReader(id, 'original');
        switchTab('reader');
      }
    });

    // ========== 需求三C：对话卡片按钮 + 确认卡 ==========
    $('#chat-flow').off('click', '[data-card-action]').on('click', '[data-card-action]', async function () {
      const action = $(this).data('card-action');
      const id = $(this).data('msg-id');
      const msg = chatState.messages.find(m => m.id === id);
      if (!msg) return;
      if (action === 'read') {
        if (msg.chapterId != null) { loadChapterToReader(msg.chapterId, msg.chapterType || 'continue'); switchTab('reader'); }
      } else if (action === 'copy') {
        const ok = await copyToClipboard(String(msg.text || ''));
        agentNotify(ok ? '✅ 已复制到剪贴板' : '❌ 复制失败', ok ? 'success' : 'error');
      } else if (action === 'adopt') {
        agentNotify('ℹ 续写章节已保存在续写链中，可在左侧章节列表查看', 'info');
      }
    });
    $('#chat-flow').off('click', '[data-confirm-action]').on('click', '[data-confirm-action]', function () {
      const id = $(this).data('confirm-id');
      const action = $(this).data('confirm-action');
      const msg = chatState.messages.find(m => m.confirmId === id);
      if (!msg || !msg.confirmResolve) return;
      msg.confirmResolve(action === 'ok');
      msg.confirmResolve = null;
      if (agentState.pendingConfirm && agentState.pendingConfirm.id === id) agentState.pendingConfirm = null;
      const el = getDoc().querySelector(`[data-msg-id="${msg.id}"]`);
      if (el) {
        const btns = el.querySelector('.confirm-btns');
        if (btns) btns.remove();
        const bt = el.querySelector('.bubble-text');
        if (bt) bt.textContent = action === 'ok' ? '✅ 已确认执行' : '❌ 已取消';
      }
    });

    // ========== 需求三B：侧栏拖拽调宽 ==========
    const $resizer = $(`<div class="sidebar-resizer"></div>`);
    $('#agent-sidebar').append($resizer);
    let dragState = null;
    $resizer.on('mousedown', function (e) {
      e.preventDefault();
      dragState = { startX: e.clientX, startW: $('#agent-sidebar').outerWidth() };
      $(doc).on('mousemove.agresize', function (ev) {
        if (!dragState) return;
        const w = Math.max(180, Math.min(480, dragState.startW + (ev.clientX - dragState.startX)));
        $('#agent-sidebar').css('width', w + 'px');
        extension_settings[extensionName].agentSidebarWidth = w;
      });
      $(doc).on('mouseup.agresize', function () {
        if (!dragState) return;
        dragState = null;
        $(doc).off('mousemove.agresize').off('mouseup.agresize');
        saveSettingsDebounced();
      });
    });

    // ========== 需求三E：阅读器摘要 / 人物提取 ==========
    $('#reader-summary-btn').off('click').on('click', async function () {
      const rs = extension_settings[extensionName].readerState || {};
      const id = rs.currentChapterId;
      if (id == null) { agentNotify('⚠ 请先在阅读器打开章节', 'warn'); return; }
      const ch = rs.currentChapterType === 'continue'
        ? continueWriteChain.find(c => c.id === id)
        : currentParsedChapters.find(c => c.id === id);
      if (!ch) { agentNotify('⚠ 章节不存在', 'warn'); return; }
      agentTaskStart('正在生成本章摘要...');
      try {
        const res = await generateRawWithBreakLimit({
          systemPrompt: '你是小说章节摘要助手。只输出摘要正文，不要任何解释。',
          prompt: `章节标题：${ch.title}\n请用 150 字以内概括本章核心剧情、人物进展与新增设定/伏笔。\n章节内容：${ch.content.slice(0, 6000)}`
        });
        agentAddMessage('agent', `📄《${ch.title}》摘要\n${res}`, { kind: 'info' });
      } catch (e) {
        agentNotify(`❌ 摘要生成失败：${e.message}`, 'error');
      }
    });
    $('#reader-characters-btn').off('click').on('click', async function () {
      const rs = extension_settings[extensionName].readerState || {};
      const id = rs.currentChapterId;
      if (id == null) { agentNotify('⚠ 请先在阅读器打开章节', 'warn'); return; }
      const ch = rs.currentChapterType === 'continue'
        ? continueWriteChain.find(c => c.id === id)
        : currentParsedChapters.find(c => c.id === id);
      if (!ch) { agentNotify('⚠ 章节不存在', 'warn'); return; }
      try {
        const res = await generateRawWithBreakLimit({
          systemPrompt: '你是小说人物提取助手。只输出人物清单。',
          prompt: `章节标题：${ch.title}\n请提取本章出现的人物，每人一行：姓名 — 身份 — 本章行为/变化。\n章节内容：${ch.content.slice(0, 6000)}`
        });
        agentAddMessage('agent', `👥《${ch.title}》本章人物\n${res}`, { kind: 'info' });
      } catch (e) {
        agentNotify(`❌ 人物提取失败：${e.message}`, 'error');
      }
    });

    // ========== 左侧上传 ==========
    $('#upload-novel-btn').off('click').on('click', () => $('#novel-file-upload').click());

    $('#novel-file-upload').off('change').on('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const customRegex = $('#chapter-regex-input').val().trim();
      const reader = new FileReader();
      reader.onload = (ev) => {
        const novelText = ev.target.result;
        let chapterList = [];
        if (customRegex) {
          chapterList = splitNovelIntoChapters(novelText, customRegex);
        } else {
          const sorted = getSortedRegexList(novelText);
          if (sorted.length > 0 && sorted[0].count > 0) {
            chapterList = splitNovelIntoChapters(novelText, sorted[0].regex);
          } else {
            chapterList = splitNovelIntoChapters(novelText, '^$');
          }
        }
        if (chapterList.length === 0) {
          agentNotify('❌ 未识别出章节，请检查正则', 'error');
          return;
        }
        currentParsedChapters = chapterList;
        extension_settings[extensionName].chapterList = chapterList;
        extension_settings[extensionName].chapterGraphMap = {};
        extension_settings[extensionName].mergedGraph = {};
        extension_settings[extensionName].continueWriteChain = [];
        extension_settings[extensionName].continueChapterIdCounter = 1;
        extension_settings[extensionName].selectedChapterIds = [];
        extension_settings[extensionName].batchMergedGraphs = [];
        extension_settings[extensionName].currentNovelName = file.name.replace(/\.txt$/i, '');
        continueWriteChain = [];
        continueChapterIdCounter = 1;
        batchMergedGraphs = [];
        saveSettingsDebounced();
        renderChapterList(currentParsedChapters);
        updateStats();
        updateCurrentNovelName(file.name.replace(/\.txt$/i, ''));
        refreshGraphPanel();
        // 自动选中全部章节？不，只做提示
        agentNotify(`✅ 已解析《${file.name.replace(/\.txt$/i, '')}》，共 ${chapterList.length} 章`, 'success');
        // 清空文件输入
        $('#novel-file-upload').val('');
      };
      reader.onerror = () => agentNotify('❌ 文件读取失败（请用 UTF-8 编码）', 'error');
      reader.readAsText(file, 'UTF-8');
    });

    // ========== 章节列表点击 ==========
    $('#chapter-list').off('click', '.chapter-item').on('click', '.chapter-item', function (e) {
      if (_lpFired) { _lpFired = false; e.stopPropagation(); return; }  // 长按后不触发点击
      const $item = $(this);
      const chapterId = parseInt($item.data('chapter-id'));
      const chapterType = $item.data('chapter-type');
      const clickedCheckbox = $(e.target).is('.checkbox') || $(e.target).closest('.checkbox').length > 0;

      if (clickedCheckbox && chapterType === 'original') {
        // 切换选中
        const selected = new Set(extension_settings[extensionName].selectedChapterIds || []);
        if (selected.has(chapterId)) selected.delete(chapterId);
        else selected.add(chapterId);
        extension_settings[extensionName].selectedChapterIds = [...selected];
        saveSettingsDebounced();
        renderChapterList(currentParsedChapters);
        return;
      }
      // 点击章节 → 切到阅读面板
      loadChapterToReader(chapterId, chapterType);
      switchTab('reader');
      closeDrawers();  // 移动端：读完点章节后自动收起抽屉
    });

    // ========== 侧栏底部 ==========
    $('#select-all-btn').off('click').on('click', function () {
      extension_settings[extensionName].selectedChapterIds = currentParsedChapters.map(c => c.id);
      saveSettingsDebounced();
      renderChapterList(currentParsedChapters);
    });
    $('#unselect-all-btn').off('click').on('click', function () {
      extension_settings[extensionName].selectedChapterIds = [];
      saveSettingsDebounced();
      renderChapterList(currentParsedChapters);
    });
    $('#validate-graph-btn').off('click').on('click', validateChapterGraphStatus);

    // ========== Tab ==========
    $('.agent-tab').off('click').on('click', function () {
      switchTab($(this).data('tab'));
    });

    // ========== 阅读器 ==========
    $('#reader-prev').off('click').on('click', readerPrev);
    $('#reader-next').off('click').on('click', readerNext);
    $('#reader-font-minus').off('click').on('click', () => {
      const cur = parseInt((extension_settings[extensionName].readerState || {}).fontSize || 16);
      setFontSize(cur - 1);
    });
    $('#reader-font-plus').off('click').on('click', () => {
      const cur = parseInt((extension_settings[extensionName].readerState || {}).fontSize || 16);
      setFontSize(cur + 1);
    });
    $('#reader-content').off('scroll').on('scroll', updateReaderProgress);

    // ========== 图谱面板 ==========
    $('#graph-validate-btn').off('click').on('click', validateGraphCompliance);
    $('#graph-copy-btn').off('click').on('click', async function () {
      const text = $('#graph-preview').val();
      if (!text) { agentNotify('⚠ 图谱为空', 'warn'); return; }
      const ok = await copyToClipboard(text);
      agentNotify(ok ? '✅ 已复制到剪贴板' : '❌ 复制失败', ok ? 'success' : 'error');
    });
    $('#graph-export-btn').off('click').on('click', function () {
      const text = $('#graph-preview').val();
      if (!text) { agentNotify('⚠ 图谱为空', 'warn'); return; }
      const name = extension_settings[extensionName].currentNovelName || 'novel';
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = `${name}_合并图谱.json`;
      a.click();
      URL.revokeObjectURL(url);
      agentNotify('✅ 图谱已导出', 'success');
    });
    $('#graph-import-btn').off('click').on('click', function () {
      const input = doc.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(removeBOM(ev.target.result.trim()));
            extension_settings[extensionName].mergedGraph = data;
            saveSettingsDebounced();
            refreshGraphPanel();
            updateStats();
            // bug22：导入后滚动到顶部并高亮提示
            const $gp = $('#graph-preview');
            if ($gp.length) {
              $gp.scrollTop(0);
              $gp.focus();
              $gp.addClass('flash-highlight');
              setTimeout(() => $gp.removeClass('flash-highlight'), 1200);
            }
            agentNotify('✅ 图谱导入成功', 'success');
          } catch (err) {
            agentNotify(`❌ 导入失败：${err.message}`, 'error');
          }
        };
        reader.readAsText(file, 'UTF-8');
      };
      input.click();
    });
    $('#graph-clear-btn').off('click').on('click', function () {
      if (!confirm('确定清空合并图谱？')) return;
      extension_settings[extensionName].mergedGraph = {};
      saveSettingsDebounced();
      refreshGraphPanel();
      updateStats();
      agentNotify('🗑 已清空合并图谱', 'info');
    });

    // 图谱编辑器改动 → 存（bug9：300ms debounce，避免每次按键都 JSON.parse 大图谱）
    let graphParseTimer = null;
    $('#graph-preview').attr('autocorrect', 'off').attr('autocapitalize', 'off').attr('spellcheck', 'false');  // 移动端迭代⑧：图谱编辑器禁用移动输入修正
    $('#graph-preview').off('input').on('input', function () {
      const text = $(this).val();
      const sizeKB = (new Blob([text]).size / 1024).toFixed(1);
      $('#graph-size').text(`${sizeKB} KB`);
      clearTimeout(graphParseTimer);
      graphParseTimer = setTimeout(() => {
        try {
          extension_settings[extensionName].mergedGraph = JSON.parse(text);
          saveSettingsDebounced();
        } catch (_) {}
      }, 300);
    });

    // ========== 快捷操作 ==========
    $('.quick-btn').off('click').on('click', async function () {
      const action = $(this).data('action');
      if (action === 'graph-selected') {
        const ids = extension_settings[extensionName].selectedChapterIds || [];
        const chapters = currentParsedChapters.filter(c => ids.includes(c.id));
        if (chapters.length === 0) { agentNotify('⚠ 请先在左侧勾选章节', 'warn'); return; }
        await generateChapterGraphBatch(chapters);
      } else if (action === 'graph-all') {
        await generateChapterGraphBatch(currentParsedChapters);
      } else if (action === 'merge-batch') {
        await batchMergeGraphs();
      } else if (action === 'merge-all') {
        await mergeAllGraphs();
      } else if (action === 'stop') {
        stopGenerateFlag = true;
        stopSending = true;
        agentNotify('⏹ 已请求停止', 'info');
      }
    });

    // ========== 输入栏 ==========
    // 移动端迭代⑦：聚焦自动滚到底；键盘弹起时压缩快捷栏（仅移动端加 .kb-open）
    $('#agent-input').off('focus.agkb').on('focus.agkb', function () {
      if (isMobileLayout()) $('#novel-agent-panel').addClass('kb-open');
      setTimeout(function () {
        const f = $('#chat-flow').get(0);
        if (f) f.scrollTop = f.scrollHeight;
      }, 320);
    });
    $('#agent-input').off('blur.agkb').on('blur.agkb', function () {
      setTimeout(function () { $('#novel-agent-panel').removeClass('kb-open'); }, 200);
    });
    $('#agent-send-btn').off('click').on('click', sendUserInput);
    $('#agent-input').off('keydown').on('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendUserInput();
      }
    });

    function sendUserInput() {
      const text = $('#agent-input').val().trim();
      if (!text) return;
      $('#agent-input').val('');
      agentAddMessage('user', text);
      captureMemoryFromInput(text);
      handleCommand(text);
    }

    // ========== 移动端：主内容区左右滑动切换 Tab ==========
    // 注意：mini-jQuery 的 on() 把事件名原样传给 addEventListener（off() 为 no-op），
    // 不支持 'touchstart.agswipe' 命名空间写法，故统一用纯事件名，仅绑定一次无需解绑。
    (function bindSwipeTabs() {
      var startX = 0, startY = 0, startT = 0, tracking = false;
      var TAB_ORDER = ['chat', 'reader', 'graph'];
      var $main = $('#panel-chat').closest('.agent-main');
      if (!$main.length) return;

      $main.off('touchstart').on('touchstart', function (e) {
        if (!isMobileLayout()) { tracking = false; return; }
        var t = e.touches && e.touches[0];
        if (!t) { tracking = false; return; }
        var tgt = e.target;
        // 输入框 / 文本域 / 可编辑元素：不拦截，避免和文字选择、输入冲突
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) {
          tracking = false; return;
        }
        startX = t.clientX;
        startY = t.clientY;
        startT = Date.now();
        tracking = true;
      });

      $main.off('touchend touchcancel').on('touchend touchcancel', function (e) {
        if (!tracking || !isMobileLayout()) { tracking = false; return; }
        tracking = false;
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        var dx = t.clientX - startX;
        var dy = t.clientY - startY;
        var dt = Date.now() - startT;

        // 触发条件：快、横向位移足够、且明显比纵向更横向
        if (dt > 700) return;                    // 慢速拖动不算滑动
        if (Math.abs(dx) < 60) return;           // 位移太小
        if (Math.abs(dx) < Math.abs(dy) * 1.2) return; // 更像纵向滚动

        var cur = extension_settings[extensionName].activeTab || 'chat';
        var idx = TAB_ORDER.indexOf(cur);
        if (idx < 0) return;

        if (dx < 0 && idx < TAB_ORDER.length - 1) {
          switchTab(TAB_ORDER[idx + 1]);         // 左滑 → 下一个
        } else if (dx > 0 && idx > 0) {
          switchTab(TAB_ORDER[idx - 1]);         // 右滑 → 上一个
        }
      });
    })();
  }

  // ============================================================
  // ▌父页面悬浮球（保留原样式，改名为 Agent）
  // ============================================================
  const FLOAT_BALL_KEY = SCRIPT_ID + ':float-pos';
  const FLOAT_BALL_SIZE = 64;

  function addNovelWriterFloatingButton() {
    try {
      var doc = _pDocParent();
      if (!doc || !doc.body) { setTimeout(addNovelWriterFloatingButton, 500); return false; }
      var pWin = (typeof window !== 'undefined' && window.parent) ? window.parent : window;
      var old = doc.getElementById(SCRIPT_ID + '-btn');
      if (old) old.remove();
      var oldMenu = doc.getElementById(SCRIPT_ID + '-btn-menu');
      if (oldMenu) oldMenu.remove();

      var st = { x: null, y: null, scale: 100 };
      try {
        var raw = localStorage.getItem(FLOAT_BALL_KEY);
        if (raw) {
          var saved = JSON.parse(raw);
          if (saved && typeof saved.x === 'number') st.x = saved.x;
          if (saved && typeof saved.y === 'number') st.y = saved.y;
          if (saved && typeof saved.scale === 'number') st.scale = Math.max(50, Math.min(200, saved.scale));
        }
      } catch (_) {}
      function saveSt() { try { localStorage.setItem(FLOAT_BALL_KEY, JSON.stringify(st)); } catch (_) {} }
      function curSize() { return Math.round(FLOAT_BALL_SIZE * st.scale / 100); }

      var oldStyle = doc.getElementById(SCRIPT_ID + '-btn-style');
      if (oldStyle) oldStyle.remove();
      var styleEl = doc.createElement('style');
      styleEl.id = SCRIPT_ID + '-btn-style';
      styleEl.textContent =
        '#' + SCRIPT_ID + '-btn{position:fixed;z-index:2147483647;box-sizing:border-box;margin:0;padding:0;' +
        'width:64px;height:64px;border-radius:0;background:#171a22;color:#e6e8ef;border:3px solid #2e3342;' +
        'box-shadow:6px 6px 0px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;' +
        'cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;transition:transform .15s ease,box-shadow .15s ease;}' +
        '#' + SCRIPT_ID + '-btn:hover{transform:scale(1.1);box-shadow:8px 8px 0px rgba(0,0,0,.3);}' +
        '#' + SCRIPT_ID + '-btn:active{transform:scale(1.05);}' +
        '#' + SCRIPT_ID + '-btn.nw-dragging{cursor:grabbing;transform:scale(1.25);opacity:.9;box-shadow:0 0 60px rgba(108,140,255,.3),0 12px 40px rgba(0,0,0,.7);}' +
        '#' + SCRIPT_ID + '-btn .ball-inner{position:relative;z-index:2;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;}' +
        '#' + SCRIPT_ID + '-btn .ball-icon{font-size:28.8px;line-height:1;display:flex;align-items:center;justify-content:center;}' +
        '#' + SCRIPT_ID + '-btn .ball-icon svg{width:36px;height:36px;display:block;}' +
        '#' + SCRIPT_ID + '-btn-menu{position:fixed;z-index:2147483646;display:none;flex-direction:column;gap:2px;min-width:180px;padding:8px 6px;' +
        'background:#171a22;border:2px solid #2e3342;border-radius:0;box-shadow:6px 6px 0px rgba(0,0,0,.25);' +
        'font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#e6e8ef;}' +
        '#' + SCRIPT_ID + '-btn-menu .nw-mi{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;background:transparent;' +
        'border-radius:0;color:#e6e8ef;font-size:13px;font-family:inherit;cursor:pointer;text-align:left;transition:background .12s ease;}' +
        '#' + SCRIPT_ID + '-btn-menu .nw-mi:hover{background:#232732;}' +
        '#' + SCRIPT_ID + '-btn-menu .nw-mi .nw-mi-icon{font-size:15px;width:18px;text-align:center;flex-shrink:0;}' +
        '#' + SCRIPT_ID + '-btn-menu .nw-divider{height:1px;background:#2e3342;margin:4px 8px;}' +
        '#' + SCRIPT_ID + '-btn-menu .nw-scale-row{padding:6px 10px 8px;display:flex;flex-direction:column;gap:4px;}' +
        '#' + SCRIPT_ID + '-btn-menu .nw-scale-row label{font-size:11px;color:#a8aec2;display:flex;justify-content:space-between;}' +
        '#' + SCRIPT_ID + '-btn-menu .nw-scale-row .nw-scale-val{color:#e6e8ef;font-weight:600;}' +
        '#' + SCRIPT_ID + '-btn-menu .nw-scale-row input[type=range]{width:100%;accent-color:#6c8cff;cursor:pointer;}';
      (doc.head || doc.documentElement).appendChild(styleEl);

      var btn = doc.createElement('div');
      btn.id = SCRIPT_ID + '-btn';
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', '打开小说续写 Agent');
      btn.title = '小说续写 Agent · 单击打开 · 拖拽移动 · 右键菜单 · 滚轮缩放';
      btn.innerHTML = '<div class="ball-inner"><div class="ball-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div></div>';

      var menu = doc.createElement('div');
      menu.id = SCRIPT_ID + '-btn-menu';
      menu.setAttribute('role', 'menu');
      menu.innerHTML =
        '<button class="nw-mi" data-action="open"><span class="nw-mi-icon">📖</span>打开小说续写 Agent</button>' +
        '<div class="nw-divider"></div>' +
        '<div class="nw-scale-row">' +
        '<label>图标大小 <span class="nw-scale-val">100%</span></label>' +
        '<input type="range" min="50" max="200" step="10" value="100">' +
        '</div>' +
        '<div class="nw-divider"></div>' +
        '<button class="nw-mi" data-action="reset-pos"><span class="nw-mi-icon">📍</span>重置位置</button>' +
        '<button class="nw-mi" data-action="reset-scale"><span class="nw-mi-icon">🔍</span>重置大小</button>' +
        '<div class="nw-divider"></div>' +
        '<button class="nw-mi" data-action="hide"><span class="nw-mi-icon">✕</span>隐藏图标（刷新后恢复）</button>';
      doc.body.appendChild(menu);

      var scaleVal = menu.querySelector('.nw-scale-val');
      var scaleInput = menu.querySelector('input[type=range]');

      function applyScale() {
        var sz = curSize();
        btn.style.width = sz + 'px';
        btn.style.height = sz + 'px';
        var iconSvg = btn.querySelector('.ball-icon svg');
        if (iconSvg) {
          var iconSz = Math.round(36 * st.scale / 100);
          iconSvg.style.width = iconSz + 'px';
          iconSvg.style.height = iconSz + 'px';
        }
        if (scaleVal) scaleVal.textContent = Math.round(st.scale) + '%';
        if (scaleInput) scaleInput.value = st.scale;
        applyPos();
      }
      function applyPos() {
        var w = pWin.innerWidth || 1280;
        var h = pWin.innerHeight || 800;
        var sz = curSize();
        if (st.x == null || st.y == null) { st.x = w - sz - 20; st.y = Math.round(h / 2 - sz / 2); }
        st.x = Math.max(4, Math.min(w - sz - 4, st.x));
        st.y = Math.max(4, Math.min(h - sz - 4, st.y));
        btn.style.left = Math.round(st.x) + 'px';
        btn.style.top = Math.round(st.y) + 'px';
      }
      function showMenu(x, y) {
        menu.style.display = 'flex';
        var w = pWin.innerWidth || 1280, h = pWin.innerHeight || 800;
        var mw = 180, mh = 220;
        menu.style.left = Math.max(8, Math.min(x, w - mw - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(y, h - mh - 8)) + 'px';
        applyScale();
      }
      function hideMenu() { menu.style.display = 'none'; }

      var drag = null;
      btn.addEventListener('pointerdown', function (e) {
        if (e.button === 2) return;
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
        var r = btn.getBoundingClientRect();
        drag = { ox: e.clientX - r.left, oy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
        btn.classList.add('nw-dragging');
        hideMenu();
      });
      btn.addEventListener('pointermove', function (e) {
        if (!drag) return;
        if (Math.abs(e.clientX - drag.sx) > 4 || Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
        var w = pWin.innerWidth || 1280, h = pWin.innerHeight || 800, sz = curSize();
        st.x = Math.max(4, Math.min(w - sz - 4, e.clientX - drag.ox));
        st.y = Math.max(4, Math.min(h - sz - 4, e.clientY - drag.oy));
        btn.style.left = Math.round(st.x) + 'px';
        btn.style.top = Math.round(st.y) + 'px';
      });
      btn.addEventListener('pointerup', function () {
        if (!drag) return;
        var wasClick = !drag.moved;
        drag = null;
        btn.classList.remove('nw-dragging');
        if (wasClick) {
          try { openNovelWriter(); } catch (e) { alert('打开失败: ' + (e && e.message ? e.message : String(e))); }
        } else saveSt();
      });
      btn.addEventListener('pointercancel', function () { drag = null; btn.classList.remove('nw-dragging'); });
      btn.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); showMenu(e.clientX, e.clientY); });
      btn.addEventListener('wheel', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var delta = e.deltaY > 0 ? -10 : 10;
        st.scale = Math.max(50, Math.min(200, st.scale + delta));
        applyScale(); saveSt();
      }, { passive: false });

      menu.addEventListener('click', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
        if (!item) return;
        var act = item.getAttribute('data-action');
        if (act === 'open') { hideMenu(); try { openNovelWriter(); } catch (e) { alert('打开失败: ' + (e && e.message ? e.message : String(e))); } }
        else if (act === 'reset-pos') { st.x = null; st.y = null; applyPos(); saveSt(); hideMenu(); }
        else if (act === 'reset-scale') { st.scale = 100; applyScale(); saveSt(); }
        else if (act === 'hide') { hideMenu(); btn.style.display = 'none'; }
      });

      if (scaleInput) {
        scaleInput.addEventListener('input', function () {
          st.scale = Math.max(50, Math.min(200, parseFloat(scaleInput.value) || 100));
          applyScale(); saveSt();
        });
      }
      doc.addEventListener('click', function (e) {
        if (menu.style.display === 'flex' && !menu.contains(e.target) && !btn.contains(e.target)) hideMenu();
      });

      var _resizeTimer = null;
      pWin.addEventListener('resize', function () {
        if (_resizeTimer) return;
        _resizeTimer = setTimeout(function () { _resizeTimer = null; applyPos(); }, 150);
      });

      applyScale();
      addCleanup(function () {
        try { btn.remove(); } catch (_) {}
        try { menu.remove(); } catch (_) {}
        try { styleEl.remove(); } catch (_) {}
      });
      doc.body.appendChild(btn);
      return true;
    } catch (e) { return false; }
  }

  // ============================================================
  // ▌SECTION 4 入口
  // ============================================================
  function registerNovelWriterButton() {
    try {
      var pWin = (typeof window !== 'undefined' && window.parent) ? window.parent : window;
      var evtOn = typeof eventOn === 'function' ? eventOn : (typeof window.eventOn === 'function' ? window.eventOn : (pWin && typeof pWin.eventOn === 'function' ? pWin.eventOn : null));
      var getBtnEvt = typeof getButtonEvent === 'function' ? getButtonEvent : (typeof window.getButtonEvent === 'function' ? window.getButtonEvent : (pWin && typeof pWin.getButtonEvent === 'function' ? pWin.getButtonEvent : null));
      if (evtOn && getBtnEvt) {
        try { evtOn(getBtnEvt(SCRIPT_NAME), function() { openNovelWriter(); }); } catch(_) {}
        try { evtOn(getBtnEvt('打开小说续写Agent'), function() { openNovelWriter(); }); } catch(_) {}
        try {
          var appISB = typeof appendInexistentScriptButtons === 'function' ? appendInexistentScriptButtons : (typeof window.appendInexistentScriptButtons === 'function' ? window.appendInexistentScriptButtons : (pWin && typeof pWin.appendInexistentScriptButtons === 'function' ? pWin.appendInexistentScriptButtons : null));
          if (appISB) { appISB([{ name: SCRIPT_NAME, visible: true }, { name: '打开小说续写Agent', visible: true }]); }
        } catch(_) {}
        return true;
      }
    } catch(e) { try { console.warn('[小说续写Agent] registerButton:', e && e.message); } catch(_) {} }
    return false;
  }

  let retryCount = 0;
  function tryInit() {
    addNovelWriterFloatingButton();
    if (registerNovelWriterButton()) return;
    if (retryCount < 10) { retryCount++; setTimeout(tryInit, 500); }
  }

  function cleanupNovelWriter() {
    try {
      try { _flushSettings(); } catch(_) {}
      try { _destroyNovelIframe(); } catch(_) {}
      try {
        var doc = _pDocParent();
        var root = doc.getElementById('novel-agent-root');
        if (root) root.remove();
      } catch(_) {}
      _novelWriterOpened = false;
      try { runCleanup(); } catch (_) {}
    } catch(e) {}
  }

  function scriptEntryPoint() {
    try { console.log('[小说续写Agent] scriptEntryPoint'); } catch(_) {}
    try {
      const flushOnUnload = function () { try { _flushSettings(); } catch(_) {} };
      try { window.parent.addEventListener('beforeunload', flushOnUnload); } catch(_) {}
      try { window.addEventListener('beforeunload', flushOnUnload); } catch(_) {}
    } catch(_) {}
    try {
      window.addEventListener('pagehide', function () { try { cleanupNovelWriter(); } catch(_) {} });
    } catch(_) {}
    try { window.openNovelWriter = openNovelWriter; } catch(_) {}

    tryInit();

    // 移动端：视口切换（如旋转/桌面缩放）时同步抽屉状态
    try {
      const onMqChange = function () {
        if (isMobileLayout()) closeDrawers();
        updateDrawerBackdrop();
      };
      if (_mqMobile.addEventListener) _mqMobile.addEventListener('change', onMqChange);
      else if (_mqMobile.addListener) _mqMobile.addListener(onMqChange);
    } catch (_) {}

    (async function bootstrap() {
      try {
        await openNovelWriter({ silent: true });
        console.log('[小说续写Agent] UI 已注入 iframe，悬浮球常驻显示');
      } catch (e) {
        console.warn('[小说续写Agent] 自动初始化失败（入口按钮仍可用）:', e);
      }
    })();
  }

  (function boot() {
    try {
      var pWin = (typeof window !== 'undefined' && window.parent) ? window.parent : window;
      if (typeof $ !== 'undefined') { $(scriptEntryPoint); }
      else if (typeof jQuery !== 'undefined') { jQuery(scriptEntryPoint); }
      else if (pWin && typeof pWin.$ === 'function') { pWin.$(scriptEntryPoint); }
      else if (pWin && typeof pWin.jQuery === 'function') { pWin.jQuery(scriptEntryPoint); }
      else { scriptEntryPoint(); }
    } catch(e) {
      try { console.error('[小说续写Agent] boot fail:', e && e.message); } catch(_) {}
      scriptEntryPoint();
    }
  })();

})();