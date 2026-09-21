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
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error((label || '操作') + ' 超时（' + Math.round(ms / 1000) + 's）'));
      }, ms);
      Promise.resolve(promise).then(
        function (v) { clearTimeout(timer); resolve(v); },
        function (e) { clearTimeout(timer); reject(e); }
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

.agent-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
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

/* ==================== 响应式 ==================== */
@media (max-width: 720px) {
  .agent-sidebar { position: absolute; top: 60px; bottom: 0; left: 0; z-index: 50; box-shadow: var(--ag-shadow); }
  .agent-sidebar.collapsed { transform: translateX(-100%); width: 260px; }
  .reader-content { padding: 20px 16px; font-size: 15px; }
  .agent-header { padding: 10px 14px; min-height: 52px; }
  .agent-title-text h1 { font-size: 14px; }
  .chat-flow { padding: 14px; }
  .chat-msg { max-width: 100%; }
  .agent-input-bar { padding: 10px 14px 12px; }
  .quick-actions { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 4px; }
  .quick-btn { flex-shrink: 0; }
}
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
        <h1>小说续写 Agent</h1>
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
      <button class="agent-icon-btn" id="agent-clear-btn" title="清空当前内容">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
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
             placeholder="输入指令：如「续写 2000 字」「生成图谱」「合并图谱」...">
      <button class="agent-send-btn" id="agent-send-btn">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        发送
      </button>
    </div>
  </footer>
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
    const filteredGraph = JSON.parse(JSON.stringify(mergedGraph));
    if (filteredGraph.全剧情时间线?.全本关键事件时序表) {
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
    if (filteredGraph.世界观设定库?.全本所有隐藏设定与伏笔汇总) {
      filteredGraph.世界观设定库.全本所有隐藏设定与伏笔汇总 = filteredGraph.世界观设定库.全本所有隐藏设定与伏笔汇总.filter(foreshadow => {
        const n = extractChapterNumber(foreshadow.出现章节 || '');
        return n === null || n <= baseChapterId;
      });
    }
    if (filteredGraph.变更与依赖信息) {
      delete filteredGraph.变更与依赖信息.本章内容对后续剧情的影响预判;
    }
    if (filteredGraph.逆向分析与质量评估?.全本隐藏信息汇总) {
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

  function escapeHtml(text) {
    if (typeof text !== 'string') return String(text);
    const div = getDoc().createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function setButtonLoading(selector, isLoading, loadingText = "加载中...") {
    const $btn = typeof selector === 'string' ? getDoc().querySelector(selector) : selector;
    if (!$btn) return;
    const $btnElement = $btn instanceof Element ? $btn : $btn[0];
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
    currentNovelName: ""
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
    const rateLimitEnabled = settings.rateLimitEnabled !== false;
    if (!rateLimitEnabled) return;
    const maxCalls = Math.max(1, parseInt(settings.rateLimitMaxCalls) || MAX_API_CALLS_PER_MINUTE);
    const windowValue = Math.max(1, parseInt(settings.rateLimitWindow) || 60);
    const windowUnitMs = settings.rateLimitUnit === "s" ? 1000 : 60 * 1000;
    const windowMs = windowValue * windowUnitMs;
    const now = Date.now();
    apiCallTimestamps = apiCallTimestamps.filter(t => now - t < windowMs);
    if (apiCallTimestamps.length >= maxCalls) {
      const earliestCallTime = Math.min(...apiCallTimestamps);
      const waitTime = earliestCallTime + windowMs - now;
      if (waitTime > 0) {
        const waitSeconds = (waitTime / 1000).toFixed(1);
        agentNotify(`⏸ 限流保护：等待 ${waitSeconds} 秒`, 'warn');
        const interval = 100;
        let waitedTime = 0;
        while (waitedTime < waitTime) {
          if (stopGenerateFlag || stopSending) throw new Error('用户手动停止生成');
          await new Promise(resolve => setTimeout(resolve, interval));
          waitedTime += interval;
        }
        const newNow = Date.now();
        apiCallTimestamps = apiCallTimestamps.filter(t => newNow - t < windowMs);
      }
    }
    apiCallTimestamps.push(Date.now());
  }

  async function resolveTavernPresetBlock() {
    const settings = extension_settings[extensionName];
    if (!settings.enableTavernPresetInject) return '';
    const context = getContext();
    const sections = [];
    try {
      if (typeof context.getCharacterCardFields === 'function') {
        const fields = context.getCharacterCardFields();
        if (fields?.system) sections.push(`<character_system_prompt>\n${fields.system}\n</character_system_prompt>`);
        if (fields?.description) sections.push(`<character_description>\n${fields.description}\n</character_description>`);
        if (fields?.personality) sections.push(`<character_personality>\n${fields.personality}\n</character_personality>`);
        if (fields?.scenario) sections.push(`<character_scenario>\n${fields.scenario}\n</character_scenario>`);
        if (fields?.creatorNotes) sections.push(`<creator_notes>\n${fields.creatorNotes}\n</creator_notes>`);
        if (fields?.persona) sections.push(`<user_persona>\n${fields.persona}\n</user_persona>`);
      }
    } catch (e) { console.warn('[小说续写Agent] 解析角色卡字段失败:', e); }
    try {
      if (typeof context.getWorldInfoPrompt === 'function') {
        const chat = Array.isArray(context.chat) ? context.chat : [];
        const wi = await context.getWorldInfoPrompt(chat, 8192, true);
        const wiText = [wi?.worldInfoBefore, wi?.worldInfoAfter].filter(t => typeof t === 'string' && t.trim()).join('\n');
        if (wiText) sections.push(`<world_info>\n${wiText}\n</world_info>`);
      }
    } catch (e) { console.warn('[小说续写Agent] 解析世界书激活条目失败:', e); }
    if (sections.length === 0) return '';
    return `<tavern_preset_context>\n以下为酒馆当前启用的提示预设（角色卡、人设、世界书），续写与图谱分析必须严格遵守其中的设定与写作规范：\n\n${sections.join('\n\n')}\n</tavern_preset_context>`;
  }

  async function generateRawWithBreakLimit(params) {
    const context = getContext();
    if (!context || typeof context !== 'object') throw new Error('无法获取上下文');
    const { generateRaw } = context;
    if (typeof generateRaw !== 'function') throw new Error('generateRaw 函数不可用');
    const settings = extension_settings[extensionName];
    let finalParams = { ...params };
    if (settings.enableAutoParentPreset) {
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
    const originalTemperature = finalParams.temperature || 0.7;
    while (retryCount < CONFIG.MAX_RETRY_TIMES) {
      if (stopGenerateFlag || stopSending) { lastError = new Error('用户手动停止生成'); break; }
      try {
        await rateLimitCheck();
        const rawResult = await withTimeout(generateRaw(finalParams), AI_CALL_TIMEOUT_MS, 'AI生成');
        const trimmedResult = rawResult.trim();
        if (isEmptyContent(trimmedResult)) throw new Error('返回内容为空');
        if (isJsonMode) {
          let parsedJson;
          try { parsedJson = JSON.parse(trimmedResult); }
          catch (e) { throw new Error(`JSON解析失败：${e.message}`); }
          const requiredFields = params.jsonSchema?.value?.required || [];
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
        lastError = error;
        retryCount++;
        if (retryCount < CONFIG.MAX_RETRY_TIMES) {
          const retryTemperature = Math.min(originalTemperature + 0.12 * retryCount, 1.2);
          finalParams.systemPrompt = originalSystemPrompt + `\n\n【重试修正】\n上次错误：${error.message}。本次必须严格遵守所有强制规则。`;
          finalParams.temperature = retryTemperature;
          await new Promise(resolve => setTimeout(resolve, TIME_CONSTANTS.RETRY_DELAY));
          if (stopGenerateFlag || stopSending) { lastError = new Error('用户手动停止生成'); break; }
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
      if (context?.getPresetManager) {
        try {
          const presetManager = context.getPresetManager();
          if (presetManager) {
            const presetName = presetManager.getSelectedPresetName();
            const presetData = presetManager.getPresetSettings(presetName);
            if (presetData && typeof presetData === 'object' && Object.keys(presetData).length > 0) presetParams = { ...presetData };
          }
        } catch (e) {}
      }
      if (Object.keys(presetParams).length === 0 && context?.generation_settings && typeof context.generation_settings === 'object') presetParams = { ...context.generation_settings };
      if (Object.keys(presetParams).length === 0 && _pWin().generation_params && typeof _pWin().generation_params === 'object') presetParams = { ..._pWin().generation_params };
      if (Object.keys(presetParams).length === 0 && _pWin().SillyTavern?.presetManager?.currentPreset?.data) presetParams = { ..._pWin().SillyTavern.presetManager.currentPreset.data };
    } else {
      if (_pWin().generation_params && typeof _pWin().generation_params === 'object') presetParams = { ..._pWin().generation_params };
    }
    const excludedKeys = new Set([
      'preset_name', 'preset', 'name', 'id', 'description', 'version',
      'isDefault', 'is_default', 'date_added', 'api_type', 'main_api',
      'preset_type', 'chat_completion_source', 'oai_settings', 'power_user',
      'settings_ui', 'objects',
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
    try {
      const result = await generateRawWithBreakLimit({
        systemPrompt, prompt: userPrompt, jsonSchema: PromptConstants.graphJsonSchema
      });
      return JSON.parse(result.trim());
    } catch (error) {
      console.error(`章节${chapter.title}图谱生成失败:`, error);
      return null;
    }
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
  async function generateNovelWrite(selectedChapterId, wordCount, chapterCount) {
    wordCount = wordCount || parseInt($('#write-word-count').val()) || 2000;
    chapterCount = Math.max(1, Math.min(20, chapterCount || 1));
    const editedChapterContent = $('#write-chapter-content').val()?.trim();
    const mergedGraph = extension_settings[extensionName].mergedGraph || {};

    if (isGeneratingWrite) { agentNotify('⚠ 续写正在进行中', 'warn'); return; }
    if (!selectedChapterId) { agentNotify('❌ 请先在左侧选择基准章节', 'error'); return; }
    if (!editedChapterContent) { agentNotify('❌ 基准章节内容为空', 'error'); return; }

    isGeneratingWrite = true;
    stopGenerateFlag = false;
    setButtonDisabled('.quick-btn', true);
    $('.quick-btn[data-action="stop"]').prop('disabled', false);

    const taskId = agentTaskStart(`正在执行续写前置校验...`);

    try {
      const baseChapterId = parseInt(selectedChapterId);
      const precheckResult = await validateContinuePrecondition(selectedChapterId, editedChapterContent);

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

      for (let chapterRound = 0; chapterRound < chapterCount; chapterRound++) {
        if (stopGenerateFlag) break;
        const roundNumber = chapterRound + 1;
        const roundInfo = chapterCount > 1 ? `（${roundNumber}/${chapterCount}）` : '';
        const currentBaseTitle = chapterRound === 0
          ? (currentParsedChapters.find(c => c.id === baseChapterId)?.title || '基准章节')
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

        agentTaskProgress(taskId, chapterRound, chapterCount, `正在生成续写章节${roundInfo}...`);
        let continueContent = await generateRawWithBreakLimit({ systemPrompt, prompt: userPrompt, ...getActivePresetParams() });
        if (stopGenerateFlag) { agentTaskEnd(taskId, '已停止', 'warn'); return; }
        if (!continueContent.trim()) throw new Error('生成内容为空');
        continueContent = continueContent.trim();

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

        await updateGraphWithContinueContent(newChapter, newChapter.id);
        renderChapterList(currentParsedChapters);
        updateStats();
        generatedCount++;
        currentBaseContent = continueContent;
      }

      const completionMessage = isTimelineSafeMode
        ? `✅ 续写完成（时间线安全），共生成 ${generatedCount} 章`
        : `✅ 续写完成，共生成 ${generatedCount} 章`;
      agentTaskEnd(taskId, completionMessage, 'success');

      // 自动切到阅读面板，展示最新续写结果
      if (generatedCount > 0) {
        const lastChapter = continueWriteChain[continueWriteChain.length - 1];
        switchTab('reader');
        loadChapterToReader(lastChapter.id, 'continue');
      }
    } catch (error) {
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
  function agentTaskProgress(taskId, current, total, text) {
    const msg = chatState.messages.find(m => m.taskId === taskId);
    if (!msg) return;
    msg.progress = { current, total, text };
    const el = getDoc().querySelector(`[data-msg-id="${msg.id}"]`);
    if (el) updateProgressEl(el, msg);
  }
  function agentTaskEnd(taskId, text, type = 'info') {
    const msg = chatState.messages.find(m => m.taskId === taskId);
    if (!msg) { agentNotify(text, type); return; }
    msg.text = text;
    msg.kind = type;
    msg.progress = null;
    const el = getDoc().querySelector(`[data-msg-id="${msg.id}"]`);
    if (el) {
      el.querySelector('.bubble-text').textContent = text;
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
    el.innerHTML = `
      <div class="chat-avatar">${avatarText}</div>
      <div class="chat-bubble">
        <div class="bubble-text"></div>
        ${progressHtml}
      </div>`;
    el.querySelector('.bubble-text').textContent = msg.progress?.text || msg.text;
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
    chatState.messages = saved;
    saved.forEach(msg => renderChatMessage(msg));
    if (saved.length === 0) {
      agentAddMessage('agent', '👋 你好，我是小说续写 Agent。\n\n你可以：\n· 上传小说 TXT，我会自动解析章节\n· 点击左侧章节选中，然后让我生成图谱\n· 在图谱面板合并全量知识图谱\n· 输入「续写 2000 字」让我生成新章节\n· 切换到「阅读」面板阅读原文与续写', { kind: 'welcome' });
    }
  }

  // ============================================================
  // ▌UI 渲染与交互
  // ============================================================
  function renderChapterList(chapters) {
    const $list = $('#chapter-list');
    const graphMap = extension_settings[extensionName].chapterGraphMap || {};
    const selectedIds = new Set(extension_settings[extensionName].selectedChapterIds || []);
    const currentReaderChapterId = extension_settings[extensionName].readerState?.currentChapterId;

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
      const selected = selectedIds.has(chapter.id);
      const hasGraph = !!graphMap[chapter.id];
      const isCurrent = currentReaderChapterId === chapter.id;
      html += `
        <div class="chapter-item ${selected ? 'selected' : ''} ${isCurrent ? 'active' : ''}" data-chapter-id="${chapter.id}" data-chapter-type="original">
          <div class="checkbox"></div>
          <span class="ch-title" title="${escapeHtml(chapter.title)}">${escapeHtml(chapter.title)}</span>
          <span class="ch-badge ${hasGraph ? 'has-graph' : ''}">${hasGraph ? '图谱✓' : '无'}</span>
        </div>`;
    });

    // 续写章节（挂在各自基准章节下面）
    const continuesByBase = {};
    continueWriteChain.forEach(c => {
      if (!continuesByBase[c.baseChapterId]) continuesByBase[c.baseChapterId] = [];
      continuesByBase[c.baseChapterId].push(c);
    });
    Object.keys(continuesByBase).forEach(baseId => {
      continuesByBase[baseId].forEach((c, idx) => {
        const isCurrent = currentReaderChapterId === c.id;
        html += `
          <div class="chapter-item continue-item ${isCurrent ? 'active' : ''}" data-chapter-id="${c.id}" data-chapter-type="continue">
            <div class="checkbox" style="visibility:hidden"></div>
            <span class="ch-title" title="续写章节 ${idx + 1}">↳ 续写章节 ${idx + 1}</span>
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
  }

  // ============ Tab 切换 ============
  function switchTab(tabName) {
    $('.agent-tab').removeClass('active');
    $(`.agent-tab[data-tab="${tabName}"]`).addClass('active');
    $('.agent-panel').removeClass('active');
    $(`#panel-${tabName}`).addClass('active');
    extension_settings[extensionName].activeTab = tabName;
    saveSettingsDebounced();
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
    const savedScroll = readerState.readProgress?.[key] || 0;
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
  // ▌指令解析
  // ============================================================
  function parseCommand(text) {
    const t = text.trim();
    if (!t) return null;
    // 续写 2000 字 / 续写 2000
    const writeMatch = t.match(/续写\s*(\d+)?\s*字?/);
    if (writeMatch) {
      const wordCount = writeMatch[1] ? parseInt(writeMatch[1]) : 2000;
      return { action: 'write', wordCount };
    }
    if (/生成.*图谱|图谱.*生成|解析.*章节/.test(t)) {
      if (/全部|所有/.test(t)) return { action: 'graph-all' };
      return { action: 'graph-selected' };
    }
    if (/合并.*图谱|全量.*合并/.test(t)) return { action: 'merge-all' };
    if (/分批.*合并/.test(t)) return { action: 'merge-batch' };
    if (/检验|校验|检查/.test(t)) return { action: 'validate' };
    if (/停止|取消/.test(t)) return { action: 'stop' };
    if (/清空|清除/.test(t)) return { action: 'clear' };
    return { action: 'chat', text: t };
  }

  async function handleCommand(text) {
    const cmd = parseCommand(text);
    if (!cmd) return;
    if (cmd.action === 'write') {
      const selectedChapterId = extension_settings[extensionName].selectedBaseChapterId
        || (currentParsedChapters.length > 0 ? currentParsedChapters[0].id : null);
      if (!selectedChapterId) { agentNotify('❌ 请先在左侧选择章节', 'error'); return; }
      // 若无基准内容，则从当前选中章节读取
      let content = $('#write-chapter-content').val();
      if (!content) {
        const ch = currentParsedChapters.find(c => c.id === selectedChapterId);
        if (ch) content = ch.content;
      }
      // 用一个隐藏的 textarea 存基准内容（兼容 generateNovelWrite 逻辑）
      ensureHiddenWriteInputs(selectedChapterId, content);
      await generateNovelWrite(selectedChapterId, cmd.wordCount, 1);
    } else if (cmd.action === 'graph-all') {
      await generateChapterGraphBatch(currentParsedChapters);
    } else if (cmd.action === 'graph-selected') {
      const ids = extension_settings[extensionName].selectedChapterIds || [];
      const chapters = currentParsedChapters.filter(c => ids.includes(c.id));
      if (chapters.length === 0) { agentNotify('⚠ 请先勾选章节', 'warn'); return; }
      await generateChapterGraphBatch(chapters);
    } else if (cmd.action === 'merge-all') {
      await mergeAllGraphs();
    } else if (cmd.action === 'merge-batch') {
      await batchMergeGraphs();
    } else if (cmd.action === 'validate') {
      validateChapterGraphStatus();
    } else if (cmd.action === 'stop') {
      stopGenerateFlag = true;
      stopSending = true;
      agentNotify('⏹ 已请求停止', 'info');
    } else if (cmd.action === 'clear') {
      if (confirm('确定清空当前所有解析章节、图谱和续写链？')) {
        clearAllData();
      }
    } else {
      // 当作自定义续写提示词使用
      const selectedChapterId = extension_settings[extensionName].selectedBaseChapterId
        || (currentParsedChapters.length > 0 ? currentParsedChapters[0].id : null);
      if (!selectedChapterId) { agentNotify('❌ 请先选择章节', 'error'); return; }
      agentNotify('⏳ 正在按你的提示续写...', 'info');
      await generateNovelWrite(selectedChapterId, 2000, 1);
    }
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
  // ▌数据加载与保存
  // ============================================================
  async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const savedData = JSON.parse(JSON.stringify(extension_settings[extensionName]));
    extension_settings[extensionName] = deepMerge(defaultSettings, extension_settings[extensionName]);
    for (const key of Object.keys(defaultSettings)) {
      if (!Object.hasOwn(extension_settings[extensionName], key)) {
        extension_settings[extensionName][key] = JSON.parse(JSON.stringify(defaultSettings[key]));
      }
    }
    currentParsedChapters = extension_settings[extensionName].chapterList || [];
    continueWriteChain = extension_settings[extensionName].continueWriteChain || [];
    continueChapterIdCounter = extension_settings[extensionName].continueChapterIdCounter || 1;
    currentPrecheckResult = extension_settings[extensionName].precheckReport || null;
    batchMergedGraphs = extension_settings[extensionName].batchMergedGraphs || [];

    // UI 回填
    $('#chapter-regex-input').val(extension_settings[extensionName].chapterRegex || '');
    const readerState = extension_settings[extensionName].readerState || {};
    $('#reader-content').css('font-size', (readerState.fontSize || 16) + 'px');
    $('#agent-novel-name').text(extension_settings[extensionName].currentNovelName || '未加载小说');

    // 侧栏折叠状态
    if (extension_settings[extensionName].sidebarCollapsed) $('#agent-sidebar').addClass('collapsed');

    // Tab 恢复
    switchTab(extension_settings[extensionName].activeTab || 'chat');

    renderChapterList(currentParsedChapters);
    refreshGraphPanel();
    updateStats();
    restoreChat();

    isInitialized = true;
  }

  function clearAllData() {
    extension_settings[extensionName].chapterList = [];
    extension_settings[extensionName].chapterGraphMap = {};
    extension_settings[extensionName].mergedGraph = {};
    extension_settings[extensionName].continueWriteChain = [];
    extension_settings[extensionName].continueChapterIdCounter = 1;
    extension_settings[extensionName].batchMergedGraphs = [];
    extension_settings[extensionName].selectedChapterIds = [];
    extension_settings[extensionName].currentNovelName = '';
    extension_settings[extensionName].readerState = { fontSize: 16, currentChapterId: null, currentChapterType: 'original', readProgress: {} };
    currentParsedChapters = [];
    continueWriteChain = [];
    continueChapterIdCounter = 1;
    batchMergedGraphs = [];
    saveSettingsDebounced();
    renderChapterList([]);
    refreshGraphPanel();
    updateStats();
    updateCurrentNovelName('');
    $('#reader-content').html('<div class="empty-hint">从左侧选择章节开始阅读</div>');
    $('#reader-title').text('未选择章节');
    agentNotify('🗑 已清空全部数据', 'info');
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
      extension_settings[extensionName].sidebarCollapsed = $sb.hasClass('collapsed');
      saveSettingsDebounced();
    });

    $('#agent-clear-btn').off('click').on('click', function () {
      if (confirm('确定清空当前所有解析章节、图谱和续写链？此操作不可撤销。')) clearAllData();
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
      const cur = parseInt(extension_settings[extensionName].readerState?.fontSize || 16);
      setFontSize(cur - 1);
    });
    $('#reader-font-plus').off('click').on('click', () => {
      const cur = parseInt(extension_settings[extensionName].readerState?.fontSize || 16);
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

    // 图谱编辑器改动 → 存
    $('#graph-preview').off('input').on('input', function () {
      const text = $(this).val();
      const sizeKB = (new Blob([text]).size / 1024).toFixed(1);
      $('#graph-size').text(`${sizeKB} KB`);
      try {
        extension_settings[extensionName].mergedGraph = JSON.parse(text);
        saveSettingsDebounced();
      } catch (_) {}
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
      handleCommand(text);
    }
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