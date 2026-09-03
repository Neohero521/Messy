(function() {
  /* ============================================================================
   * 时之写卡器 · 加载器（酒馆脚本库入口）
   * ----------------------------------------------------------------------------
   * 用法：把本文件导入酒馆脚本库（替代原 时之写卡器.js 的入口地位）。
   *       点击脚本按钮 → 在酒馆页面创建全屏同源iframe，加载 user/public 下的
   *       时之写卡器.html（壳）→ 壳再加载 时之写卡器.js（全部逻辑唯一真源）。
   *
   * 文件部署（两个文件放同一目录，即酒馆用户公共目录）：
   *   data/<你的用户名>/user/public/时之写卡器.html
   *   data/<你的用户名>/user/public/时之写卡器.js
   *
   * 好处：以后改功能只需更新 public 目录里的 时之写卡器.js，刷新页面即生效，
   *       无需重新导入酒馆脚本。
   * ============================================================================
   */
  var SCRIPT_ID = 'modelo-char-generator';
  // 壳页面地址：user/public 下的文件经酒馆静态服务直接以 /文件名 提供。
  // 若你的 ST 版本路径不同（如 /user/public/前缀），改成实际可访问的URL即可。
  var SHELL_URL = '/时之写卡器.html';
  var IFRAME_ID = SCRIPT_ID + '-modal';   // 与写卡器内部 closeModal 移除的 id 保持一致

  // 创建/复用壳iframe并显示
  function openShell() {
    var old = document.getElementById(IFRAME_ID);
    if (old) old.remove();
    var iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.setAttribute('script_id', SCRIPT_ID);
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;border:none;z-index:99999;background:#f6f2ea;';
    iframe.src = SHELL_URL;
    document.body.appendChild(iframe);
  }

  function closeShell() {
    var m = document.getElementById(IFRAME_ID);
    if (m) m.remove();
  }

  // ===== 脚本按钮注册（优先事件总线，失败重试，最终浮动按钮兜底）=====
  var _btnEvtOff = null;
  var _retryCount = 0;
  var _retryTimer = null;

  function registerButton() {
    try {
      var evtOn = typeof eventOn === 'function' ? eventOn : (typeof window.eventOn === 'function' ? window.eventOn : null);
      var getBtnEvt = typeof getButtonEvent === 'function' ? getButtonEvent : (typeof window.getButtonEvent === 'function' ? window.getButtonEvent : null);
      if (evtOn && getBtnEvt) {
        var handler = function() { openShell(); };
        evtOn(getBtnEvt('时之写卡器'), handler);
        try {
          var evtOff = typeof eventOff === 'function' ? eventOff : (typeof window.eventOff === 'function' ? window.eventOff : null);
          if (evtOff) _btnEvtOff = function() { try { evtOff(getBtnEvt('时之写卡器'), handler); } catch(_) {} };
        } catch(_) {}
        return true;
      }
    } catch(e) {}
    return false;
  }

  function addFloatingButton() {
    try {
      var old = document.getElementById(SCRIPT_ID + '-btn');
      if (old) old.remove();
      var btn = document.createElement('button');
      btn.id = SCRIPT_ID + '-btn';
      btn.textContent = '⚡ 时之写卡器';
      btn.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:99998;padding:10px 18px;background:linear-gradient(135deg,#4f46e5,#4338ca);color:#fff;border:none;border-radius:25px;cursor:pointer;font-weight:600;box-shadow:0 6px 20px rgba(15,23,42,.12);transition:all .3s;font-size:14px;';
      btn.onmouseover = function() { btn.style.transform = 'scale(1.05)'; };
      btn.onmouseout = function() { btn.style.transform = 'scale(1)'; };
      btn.onclick = openShell;
      document.body.appendChild(btn);
      return true;
    } catch(e) { return false; }
  }

  function tryInit() {
    if (registerButton()) return;
    if (_retryCount < 10) { _retryCount++; _retryTimer = setTimeout(tryInit, 500); }
    else addFloatingButton();
  }

  // ===== 卸载清理：关壳iframe + 浮动按钮 + 注销事件 =====
  function cleanup() {
    try {
      if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
      if (_btnEvtOff) { _btnEvtOff(); _btnEvtOff = null; }
      closeShell();
      var btn = document.getElementById(SCRIPT_ID + '-btn');
      if (btn) btn.remove();
    } catch(_) {}
  }
  window.addEventListener('pagehide', cleanup);

  // ===== 入口：jQuery ready（酒馆环境必定注入），否则直接执行 =====
  function entry() { tryInit(); }
  if (typeof $ !== 'undefined') $(entry);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', entry);
  else entry();
})();
