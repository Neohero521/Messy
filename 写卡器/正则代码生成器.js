(function() {
/* ============================================================================
 * 正则代码生成器 · Tavern Helper 脚本
 * ----------------------------------------------------------------------------
 * 项目类型：后台脚本（Tavern Helper Script）
 * 运行形式：单文件 JS，导入到酒馆脚本库，点击脚本按钮打开发电机
 * 技术栈：原生 JS + 自建 iframe UI（无需构建工具，便于酒馆用户使用）
 *
 * 功能：
 *   - 模式A：正文美化模板生成器（小说排版、对话气泡、信件等）
 *   - 模式B：结构化数据美化模板生成器（状态栏、论坛、任务面板等）
 *   - 实时预览生成代码
 *   - 一键复制代码
 *   - 一键导入酒馆正则配置
 * ==========================================================================
 */
  const SCRIPT_ID = 'regex-code-generator';

  // ----------------------------------------------------------------------------
  // 【关键】脚本运行在后台 iframe 中，所有全局 Taver Helper API 都可能挂在
  // window 或 window.parent 或 window.top 上。用 getApi() 统一查找，避免失效。
  // ----------------------------------------------------------------------------
  function getApi(name) {
    var candidates = [];
    try { if (typeof window !== 'undefined') candidates.push(window); } catch (_) {}
    try { if (window && window.parent) candidates.push(window.parent); } catch (_) {}
    try { if (window && window.top && window.top !== window) candidates.push(window.top); } catch (_) {}
    try { if (typeof self !== 'undefined') candidates.push(self); } catch (_) {}
    try { if (typeof globalThis !== 'undefined') candidates.push(globalThis); } catch (_) {}
    for (var i = 0; i < candidates.length; i++) {
      try {
        var w = candidates[i];
        if (w && typeof w[name] === 'function') return w[name];
      } catch (_) {}
    }
    try { if (typeof eval(name) === 'function') return eval(name); } catch (_) {}
    return null;
  }

  // 预取最常用的 Tavern Helper API（脚本内必须使用官方 API）
  function getJQuery() {
    // 脚本环境约定：window.$ = window.parent.$（jQuery 直接操作酒馆页面）
    try { if (window.parent && window.parent.$) return window.parent.$; } catch (_) {}
    try { if (window.top && window.top.$) return window.top.$; } catch (_) {}
    try { if (typeof $ !== 'undefined') return $; } catch (_) {}
    try { if (typeof jQuery !== 'undefined') return jQuery; } catch (_) {}
    return null;
  }

  function getParentWindow() {
    try { if (window.parent && window.parent.document) return window.parent; } catch (_) {}
    try { if (window.top && window.top.document) return window.top; } catch (_) {}
    return window;
  }

  // ----------------------------------------------------------------------------
  // 把常用 Tavern Helper API 挂载到脚本 iframe 自己的 window 上，方便
  // getApi(name) 在第一顺位（window）就能找到，避免每次都回溯 parent/top。
  // ----------------------------------------------------------------------------
  (function exposeTavernApiLocally() {
    var names = [
      'eventOn', 'eventOff', 'eventTrigger',
      'getButtonEvent', 'replaceScriptButtons', 'appendInexistentScriptButtons',
      'updateScriptButtonsWith', 'getScriptButtons', 'getScriptId', 'getScriptName',
      'replaceScriptInfo', 'getScriptInfo',
      'getVariables', 'replaceVariables', 'updateVariablesWith',
      'getChatMessages', 'getMessageById', 'getCurrentMessageId',
      'generate', 'generateRaw', 'triggerSlash',
      'replaceWorldbook', 'updateWorldbookWith',
      'updateTavernRegexesWith', 'replaceTavernRegexes',
      'toastr', 'replaceRegex',
      'waitGlobalInitialized', 'getCurrentChatId'
    ];
    for (var i = 0; i < names.length; i++) {
      try {
        var name = names[i];
        if (typeof window[name] !== 'undefined') continue; // 已经有就不覆盖
        var fn = getApi(name);
        if (fn !== null) {
          try { window[name] = fn; } catch (_) {
            // 某些环境只读，直接跳过
          }
        }
      } catch (_) {}
    }
    // toastr 可能是对象
    try {
      if (!window.toastr) {
        var t = getApi('toastr');
        if (t) window.toastr = t;
      }
    } catch (_) {}
  })();

  // ===== Iframe 样式表 =====
  var IFRAME_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;width:100%;margin:0;padding:0;overflow:hidden}
:root{
  --bg:#f7f7f2;
  --surface:#ffffff;
  --surface-soft:#f4f5f7;
  --surface-sink:#eef0f3;
  --ink:#111827;
  --ink-soft:#475467;
  --muted:#667085;
  --accent:#4f46e5;
  --accent-deep:#4338ca;
  --accent-soft:rgba(79,70,229,.08);
  --accent-soft-strong:rgba(79,70,229,.12);
  --accent-border:rgba(79,70,229,.22);
  --accent-text:#4338ca;
  --sage:#16a34a;
  --sage-soft:rgba(22,163,74,.08);
  --sage-text:#15803d;
  --amber:#ca8a04;
  --amber-soft:rgba(202,138,4,.09);
  --amber-text:#a16207;
  --terra:#dc2626;
  --terra-text:#dc2626;
  --line:rgba(15,23,42,.10);
  --line-soft:rgba(15,23,42,.06);
  --radius:12px;
  --radius-sm:8px;
  --radius-lg:16px;
  --shadow-soft:0 6px 20px rgba(15,23,42,.06);
  --shadow-card:0 12px 30px rgba(15,23,42,.08);
  --shadow-float:0 20px 60px rgba(15,23,42,.12);
  --font:'Segoe UI',system-ui,-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei UI','Hiragino Sans GB',sans-serif;
  --font-mono:'Sarasa Mono SC','Cascadia Code','JetBrains Mono','Consolas',Menlo,monospace;
}
body{font-family:var(--font);background:var(--bg);color:var(--ink);font-size:14px;-webkit-font-smoothing:antialiased;height:100%;width:100%;overflow:hidden}
.app{display:flex;flex-direction:column;height:100%;width:100%;overflow:hidden;min-height:0}

/* 顶栏 */
.topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0}
.topbar h1{font-size:15px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px}
.topbar .subtitle{font-size:12px;color:var(--muted);font-weight:400;margin-left:8px}
.top-actions{display:flex;gap:8px}

/* 模式切换 */
.mode-tabs{display:flex;gap:4px;padding:0 20px;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0}
.mode-tab{padding:12px 20px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);font-weight:500;transition:all .2s;display:flex;align-items:center;gap:6px}
.mode-tab:hover{color:var(--ink-soft)}
.mode-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.mode-tab .badge{background:var(--surface-sink);color:var(--ink-soft);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:400}
.mode-tab.active .badge{background:var(--accent-soft);color:var(--accent-text)}

/* 主体区域 */
.main{flex:1 1 0;display:grid;grid-template-columns:380px 1fr;overflow:hidden;min-height:0}

/* 左侧表单区 */
.form-panel{background:var(--surface);border-right:1px solid var(--line);overflow-y:auto;overflow-x:hidden;padding:20px;min-height:0}
.form-section{margin-bottom:24px}
.form-section-title{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--line-soft)}
.form-group{margin-bottom:16px}
.form-label{display:block;font-size:12px;font-weight:500;color:var(--ink-soft);margin-bottom:6px}
.form-label .req{color:var(--terra);margin-left:2px}
.form-label .hint{color:var(--muted);font-weight:400;margin-left:6px;font-size:11px}
.form-input,.form-select,.form-textarea{
  width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:var(--radius-sm);
  font-family:var(--font);font-size:13px;color:var(--ink);background:var(--surface);
  transition:all .15s;outline:none
}
.form-input:focus,.form-select:focus,.form-textarea:focus{
  border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)
}
.form-textarea{min-height:90px;resize:vertical;font-family:var(--font-mono);font-size:12px;line-height:1.6}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-checkbox{display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 12px;background:var(--surface-soft);border-radius:var(--radius-sm);border:1px solid var(--line-soft);transition:all .15s}
.form-checkbox:hover{background:var(--surface-sink)}
.form-checkbox.checked{background:var(--accent-soft);border-color:var(--accent-border)}
.form-checkbox input{width:16px;height:16px;accent-color:var(--accent)}
.form-checkbox label{font-size:13px;color:var(--ink-soft);cursor:pointer}

/* 字段列表编辑器 */
.field-list{border:1px solid var(--line-soft);border-radius:var(--radius-sm);overflow:hidden}
.field-item{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;padding:10px;border-bottom:1px solid var(--line-soft);background:var(--surface-soft)}
.field-item:last-child{border-bottom:none}
.field-item input{padding:7px 10px;font-size:12px;border:1px solid var(--line);border-radius:6px;background:var(--surface)}
.field-item input:focus{border-color:var(--accent);outline:none}
.field-item button{padding:7px 10px;background:var(--terra);color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}
.add-field-btn{width:100%;padding:10px;background:var(--surface-soft);border:1px dashed var(--line);border-radius:var(--radius-sm);font-size:13px;color:var(--accent-text);cursor:pointer;margin-top:8px;transition:all .15s}
.add-field-btn:hover{background:var(--accent-soft);border-color:var(--accent-border)}

/* 右侧预览区 */
.preview-panel{display:flex;flex-direction:column;overflow:hidden;min-height:0;min-width:0}
.preview-tabs{display:flex;gap:0;padding:0 16px;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0}
.preview-tab{padding:10px 16px;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);font-weight:500;transition:all .2s;white-space:nowrap}
.preview-tab:hover{color:var(--ink-soft)}
.preview-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.code-container{flex:1 1 0;overflow:hidden;display:flex;flex-direction:column;padding:16px;min-height:0}
.code-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-shrink:0;gap:8px}
.code-title{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.code-actions{display:flex;gap:8px}
.btn{
  display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:var(--radius-sm);
  font-size:12px;font-weight:500;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink-soft);
  transition:all .15s;font-family:var(--font)
}
.btn:hover{background:var(--surface-soft);color:var(--ink)}
.btn-primary{background:var(--accent);border-color:var(--accent);color:white}
.btn-primary:hover{background:var(--accent-deep);border-color:var(--accent-deep);color:white}
.btn-success{background:var(--sage);border-color:var(--sage);color:white}
.btn-success:hover{background:#15803d;border-color:#15803d;color:white}
.btn-ghost{background:transparent}
.btn-sm{padding:5px 10px;font-size:11px}
.code-block{
  flex:1 1 0;background:#1e1e2e;color:#cdd6f4;border-radius:var(--radius);padding:16px;overflow:auto;
  font-family:var(--font-mono);font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-all;min-height:0
}
.code-block::-webkit-scrollbar{width:8px;height:8px}
.code-block::-webkit-scrollbar-track{background:transparent}
.code-block::-webkit-scrollbar-thumb{background:rgba(148,163,184,.3);border-radius:4px}

/* Toast 提示 */
.toast-container{position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px}
.toast{padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:var(--shadow-float);animation:slideIn .25s ease}
.toast-success{background:var(--sage);color:white}
.toast-error{background:var(--terra);color:white}
.toast-info{background:var(--accent);color:white}
@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}

/* 样式预设网格 */
.style-presets{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.style-preset{padding:14px;border:2px solid var(--line-soft);border-radius:var(--radius-sm);cursor:pointer;transition:all .15s;background:var(--surface-soft)}
.style-preset:hover{border-color:var(--accent-border);background:var(--accent-soft)}
.style-preset.selected{border-color:var(--accent);background:var(--accent-soft)}
.style-preset-name{font-weight:600;font-size:13px;color:var(--ink);margin-bottom:4px}
.style-preset-desc{font-size:11px;color:var(--muted);line-height:1.4}

/* 关闭按钮 */
.icon-btn{width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;border-radius:8px;cursor:pointer;color:var(--muted);transition:all .15s}
.icon-btn:hover{background:var(--surface-soft);color:var(--ink)}

/* 移动端视图切换栏（默认隐藏） */
.view-switch{display:none;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0}
.view-switch-btn{flex:1;padding:12px;text-align:center;font-size:13px;font-weight:500;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;background:none;border-top:none;border-left:none;border-right:none}
.view-switch-btn.active{color:var(--accent);border-bottom-color:var(--accent)}

/* ===== 响应式：手机端（<=768px） ===== */
@media (max-width: 768px) {
  :root{
    --radius:10px;
    --radius-sm:6px;
  }
  body{font-size:13px}

  /* 顶栏紧凑 */
  .topbar{padding:10px 14px}
  .topbar h1{font-size:14px;gap:6px}
  .topbar .subtitle{display:none}

  /* 模式 Tab 紧凑 */
  .mode-tabs{padding:0 8px}
  .mode-tab{padding:10px 14px;font-size:12px;gap:4px}
  .mode-tab .badge{padding:2px 6px;font-size:10px}

  /* 显示移动端视图切换 */
  .view-switch{display:flex}

  /* 主体改为单列堆叠 */
  .main{display:block !important;overflow:hidden;position:relative}
  .form-panel{
    border-right:none !important;
    border-bottom:1px solid var(--line);
    padding:14px;
    height:100%;width:100%
  }
  .preview-panel{height:100%;width:100%}

  /* 手机端默认只显示表单，预览隐藏 */
  .main.mobile-view-form .preview-panel{display:none}
  .main.mobile-view-form .form-panel{display:block}
  .main.mobile-view-preview .form-panel{display:none}
  .main.mobile-view-preview .preview-panel{display:flex}

  /* 表单行改为单列 */
  .form-row{grid-template-columns:1fr !important;gap:10px}

  /* 样式预设单列 */
  .style-presets{grid-template-columns:1fr !important;gap:8px}
  .style-preset{padding:12px}

  /* 输入框增大触摸区域 */
  .form-input,.form-select,.form-textarea{padding:11px 14px;font-size:14px}
  .form-checkbox{padding:10px 14px}
  .form-checkbox label{font-size:14px}
  .form-checkbox input{width:18px;height:18px}

  /* 字段编辑器：删除按钮缩小 */
  .field-item{grid-template-columns:1fr 1fr 36px !important;gap:6px;padding:8px}
  .field-item input{padding:9px 10px;font-size:13px}
  .field-item button{padding:7px 4px;font-size:11px}

  /* 预览区代码容器紧凑 */
  .code-container{padding:12px}
  .code-header{flex-wrap:wrap;gap:8px}
  .code-actions{width:100%;justify-content:flex-end}
  .code-block{font-size:11px;padding:12px}

  /* 按钮增大触摸区域 */
  .btn{padding:9px 16px;font-size:13px}
  .btn-sm{padding:8px 14px;font-size:12px}
  .icon-btn{width:36px;height:36px}

  /* Toast 居中显示 */
  .toast-container{top:10px;left:10px;right:10px;align-items:center}
  .toast{max-width:100%;text-align:center}

  /* 模式 Tab 可横向滚动 */
  .mode-tabs{overflow-x:auto;-webkit-overflow-scrolling:touch}

  /* 预览 Tab 可横向滚动 */
  .preview-tabs{overflow-x:auto;-webkit-overflow-scrolling:touch;padding:0 8px}
  .preview-tab{padding:10px 12px;font-size:11px;white-space:nowrap;flex-shrink:0}
}

/* ===== 响应式：小手机端（<=380px） ===== */
@media (max-width: 380px) {
  .topbar h1 span:not(.subtitle){font-size:13px}
  .mode-tab .badge{display:none}
  .mode-tab{padding:10px 10px;font-size:11px}
  .code-block{font-size:10px;padding:10px}
  .form-input,.form-select,.form-textarea{font-size:13px}
}

/* ===== 响应式：大屏电脑端（>=1200px） ===== */
@media (min-width: 1200px) {
  .main{grid-template-columns:420px 1fr}
  .form-panel{padding:24px}
  .code-container{padding:20px}
  .code-block{font-size:13px;padding:20px}
  .style-presets{grid-template-columns:repeat(2,1fr);gap:12px}
}

/* ===== 响应式：超宽屏（>=1600px） ===== */
@media (min-width: 1600px) {
  .main{grid-template-columns:460px 1fr}
  .form-panel{padding:28px}
  .form-section{margin-bottom:28px}
  .topbar h1{font-size:16px}
}
`;

  // ===== 样式预设定义 =====
  var STYLE_PRESETS_A = {
    novel: {
      name: '小说排版',
      desc: '经典小说样式，段落清晰',
      containerClass: 'novel-style',
      extraCSS: `
        .novel-style {
            background: linear-gradient(180deg, #fdfcf9 0%, #f8f6f0 100%);
            border-radius: 8px;
            border: 1px solid #e8e4da;
            box-shadow: 0 2px 12px rgba(120, 100, 80, 0.08);
        }
        .novel-style .narrative {
            text-indent: 2em;
            color: #3d3d3d;
            margin-bottom: 1em;
        }
        .novel-style .dialogue {
            color: #8b5a3c;
            margin-bottom: 1em;
            padding: 0 1em;
            border-left: 3px solid #c9a87c;
        }
      `
    },
    letter: {
      name: '信纸质感',
      desc: '仿信纸效果，适合信件',
      containerClass: 'letter-style',
      extraCSS: `
        .letter-style {
            background: #fffef8;
            background-image:
                repeating-linear-gradient(
                    transparent,
                    transparent 31px,
                    #e8e0d0 31px,
                    #e8e0d0 32px
                );
            border-radius: 4px;
            border: 1px solid #d4c8b0;
            padding: 32px 40px !important;
            box-shadow: 0 4px 16px rgba(150, 130, 100, 0.12);
            position: relative;
        }
        .letter-style::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 8px;
            background: linear-gradient(90deg, #c9a87c, #d4b896);
            border-radius: 4px 4px 0 0;
        }
        .letter-style p {
            line-height: 32px;
            margin-bottom: 0;
            color: #4a3f35;
        }
      `
    },
    bubble: {
      name: '对话气泡',
      desc: '聊天气泡风格，生动活泼',
      containerClass: 'bubble-style',
      extraCSS: `
        .bubble-style {
            padding: 16px !important;
        }
        .bubble-style .narrative {
            text-align: center;
            color: #888;
            font-size: 13px;
            font-style: italic;
            padding: 8px 0;
            margin: 8px 0;
        }
        .bubble-style .dialogue {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px 18px;
            border-radius: 18px 18px 18px 4px;
            margin: 10px 0;
            max-width: 85%;
            position: relative;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.25);
        }
        .bubble-style .dialogue::before {
            content: '';
            position: absolute;
            bottom: 0; left: -6px;
            width: 12px; height: 12px;
            background: #764ba2;
            border-bottom-right-radius: 12px;
        }
      `
    },
    diary: {
      name: '日记本',
      desc: '温馨日记本样式',
      containerClass: 'diary-style',
      extraCSS: `
        .diary-style {
            background: #fffbeb;
            border: 1px solid #fde68a;
            border-radius: 4px;
            padding: 32px 36px !important;
            box-shadow:
                inset 0 0 60px rgba(253, 230, 138, 0.2),
                0 4px 16px rgba(200, 180, 100, 0.1);
            position: relative;
        }
        .diary-style::before {
            content: '📖';
            position: absolute;
            top: 12px; right: 16px;
            font-size: 20px;
            opacity: 0.4;
        }
        .diary-style .narrative {
            text-indent: 2em;
            color: #78350f;
            margin-bottom: 1em;
        }
        .diary-style .dialogue {
            color: #92400e;
            font-weight: 500;
            padding: 0 0.5em;
            background: rgba(253, 230, 138, 0.3);
            border-radius: 4px;
            display: inline;
            line-height: 2.2;
        }
      `
    }
  };

  // ===== 工具函数 =====
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function createToast(win, message, type) {
    type = type || 'info';
    var container = win.document.querySelector('.toast-container');
    if (!container) {
      container = win.document.createElement('div');
      container.className = 'toast-container';
      win.document.body.appendChild(container);
    }
    var toast = win.document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all .25s ease';
      setTimeout(function() { toast.remove(); }, 250);
    }, 2500);
  }

  function copyToClipboard(win, text, callback) {
    if (win.navigator.clipboard && win.navigator.clipboard.writeText) {
      win.navigator.clipboard.writeText(text).then(function() {
        callback && callback(true);
      }).catch(function() {
        fallbackCopy();
      });
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      var ta = win.document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      win.document.body.appendChild(ta);
      ta.select();
      try {
        win.document.execCommand('copy');
        callback && callback(true);
      } catch (e) {
        callback && callback(false);
      }
      win.document.body.removeChild(ta);
    }
  }

  // ===== 模式A：正文美化代码生成 =====
  function generateModeA(config) {
    var tagName = config.tagName || 'story';
    var scriptName = config.scriptName || '[界面]正文美化';
    var preset = STYLE_PRESETS_A[config.stylePreset] || STYLE_PRESETS_A.novel;

    // 文件一：正则配置文本
    var regexConfig =
`脚本名称: ${scriptName}
查找正则表达式: <${tagName}>[\\s\\S]*?</${tagName}>
替换为: 下方HTML代码
勾选:
  - AI输出 ✓
  - 在编辑时运行 ✓
  - 仅格式显示 ✓

(注：<${tagName}>可以换成你想要的任何标签名，但严禁使用 <think>、<thinking>、<content>)`;

    // 文件二：前端界面HTML
    var htmlCode =
`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>${scriptName.replace(/^\[界面\]/, '')}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: "Microsoft YaHei", sans-serif;
            background: transparent;
            padding: 8px;
        }

        .story-container {
            max-width: 650px;
            margin: 0 auto;
            padding: 24px 32px;
            line-height: 1.9;
            font-size: 15px;
            color: #d4d4d4;
        }

        /* ===== ${preset.name} 样式 ===== */${preset.extraCSS}

        .loading {
            text-align: center;
            padding: 20px;
            color: #999;
        }
    </style>
</head>
<body>
    <div class="story-container ${preset.containerClass}" id="content">
        <div class="loading">正在加载...</div>
    </div>

    <script>
        /* ========== 获取消息内容 ========== */
        function getMessageData() {
            var chatMessages = getChatMessages(getCurrentMessageId());
            if (!chatMessages || chatMessages.length === 0) {
                console.error("无法获取消息内容");
                return null;
            }
            return chatMessages[0].message;
        }

        /* ========== 提取正文 ========== */
        function extractContent(messageText) {
            /* 注意这里的标签名要和正则里的保持一致 */
            var match = messageText.match(/<${tagName}>([\\s\\S]*?)<\\/${tagName}>/);
            if (match && match[1]) {
                return match[1].trim();
            }
            return messageText;
        }

        /* ========== 渲染界面 ========== */
        function renderPage(text) {
            /* 将换行转为段落 */
            var paragraphs = text.split(/\\n\\s*\\n/);
            var html = '';
            paragraphs.forEach(function(p) {
                var trimmed = p.trim();
                if (trimmed) {
                    /* 处理对话行和叙述行 */
                    if (trimmed.startsWith('"') || trimmed.startsWith('「')) {
                        html += '<p class="dialogue">' + trimmed + '</p>';
                    } else {
                        html += '<p class="narrative">' + trimmed + '</p>';
                    }
                }
            });
            document.getElementById('content').innerHTML = html;
        }

        /* ========== 主函数 ========== */
        function init() {
            try {
                var messageText = getMessageData();
                if (!messageText) {
                    document.getElementById('content').innerHTML =
                        '<div class="loading">❌ 无法获取消息内容</div>';
                    return;
                }
                var text = extractContent(messageText);
                renderPage(text);
            } catch (error) {
                console.error("错误:", error);
                document.getElementById('content').innerHTML =
                    '<div class="loading">❌ 加载失败：' + error.message + '</div>';
            }
        }

        $(function() { init(); });
    <\/script>
</body>
</html>`;

    // 酒馆正则对象（用于直接导入）
    var tavernRegexObj = {
      id: 'regex-gen-' + Date.now(),
      script_name: scriptName,
      enabled: true,
      find_regex: '<' + tagName + '>[\\s\\S]*?</' + tagName + '>',
      replace_string: '```\n' + htmlCode + '\n```',
      trim_strings: [],
      source: {
        user_input: false,
        ai_output: true,
        slash_command: false,
        world_info: false,
        reasoning: false
      },
      destination: {
        display: true,
        prompt: false
      },
      run_on_edit: true,
      min_depth: null,
      max_depth: null
    };

    return {
      regexConfig: regexConfig,
      htmlCode: htmlCode,
      tavernRegexObj: tavernRegexObj
    };
  }

  // ===== 模式B：结构化数据美化代码生成 =====
  function generateModeB(config) {
    var tagName = config.tagName || 'status';
    var scriptName = config.scriptName || '[界面]状态栏';
    var pageTitle = config.pageTitle || '状态栏';
    var fields = config.fields || [{ key: 'name', label: '名称' }, { key: 'value', label: '数值' }];
    var keywords = config.keywords || ['查看状态', '打开面板'];
    var dataFormat = config.dataFormat || 'pipe'; // pipe | kv
    var triggerDesc = config.triggerDesc || '当用户提到查看状态、属性面板等信息时使用';

    // 生成字段解析代码
    var fieldParseCode = '';
    if (dataFormat === 'pipe') {
      fields.forEach(function(f, i) {
        if (i === 0) {
          fieldParseCode += '            var match;\n';
        }
        fieldParseCode +=
`            match = content.match(/\\[${f.key}\\|([^\\]]+)\\]/);
            if (match && match[1]) result.${f.key} = match[1].trim();\n`;
      });
    } else {
      fieldParseCode +=
`            var lines = content.trim().split('\\n');
            lines.forEach(function(line) {
                var kv = line.split(':');
                if (kv.length >= 2) {
                    var key = kv[0].trim();
                    var value = kv.slice(1).join(':').trim();
                    result[key] = value;
                }
            });`;
    }

    // 生成渲染HTML代码
    var fieldRowsHtml = fields.map(function(f) {
      return `                <div class="field-row">
                    <span class="field-label">${f.label}：</span>
                    <span class="field-value">\${data.${f.key} || '-'}</span>
                </div>`;
    }).join('\n');

    // 生成关键词列表
    var keywordList = keywords.map(function(k) { return `- "${k}"`; }).join('\n');

    // 生成格式示例
    var formatExample = '';
    if (dataFormat === 'pipe') {
      formatExample = fields.map(function(f) {
        return `[${f.key}|${f.label}的值]`;
      }).join('\n');
    } else {
      formatExample = fields.map(function(f) {
        return `${f.key}: ${f.label}的值`;
      }).join('\n');
    }

    // 文件一：正则配置文本
    var regexConfig =
`脚本名称: ${scriptName}
查找正则表达式: <${tagName}>[\\s\\S]*?</${tagName}>
替换为: 下方HTML代码
勾选:
  - AI输出 ✓
  - 在编辑时运行 ✓
  - 仅格式显示 ✓`;

    // 文件二：世界书
    var worldbookCode =
`<${pageTitle}相关>
** 注意事项说明

<FORMAT_RULE>
#${triggerDesc}
Format:
<${tagName}>
${formatExample}
</${tagName}>
</FORMAT_RULE>

# 注意
- 严禁使用<think>、<thinking>、<content>标签
- 闭合标签后禁止输出其他内容
- (如果使用{{}}占位符)"{{}}"并不是格式的一部分，输出时禁止携带

# 触发词
${keywordList}`;

    // 文件三：前端界面HTML
    var htmlCode =
`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>${pageTitle}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: "Microsoft YaHei", sans-serif;
            background: transparent;
            padding: 8px;
        }

        .container {
            max-width: 600px;
            margin: 0 auto;
            border-radius: 12px;
            padding: 20px;
            background: linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%);
            border: 1px solid rgba(148, 163, 184, 0.2);
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        }

        .panel-title {
            font-size: 18px;
            font-weight: 600;
            color: #e2e8f0;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(148, 163, 184, 0.2);
            text-align: center;
            letter-spacing: 2px;
        }

        .field-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            margin-bottom: 8px;
            background: rgba(148, 163, 184, 0.08);
            border-radius: 8px;
            transition: all 0.2s;
        }

        .field-row:hover {
            background: rgba(148, 163, 184, 0.15);
        }

        .field-label {
            font-size: 13px;
            color: #94a3b8;
            font-weight: 500;
        }

        .field-value {
            font-size: 14px;
            color: #f1f5f9;
            font-weight: 600;
            font-family: 'Consolas', monospace;
        }

        .loading {
            text-align: center;
            padding: 20px;
            color: #999;
        }

        .action-btn {
            margin-top: 16px;
            width: 100%;
            padding: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }

        .action-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
    </style>
</head>
<body>
    <div class="container" id="content">
        <div class="loading">正在加载...</div>
    </div>

    <script>
        /* ========== 获取消息内容 ========== */
        function getMessageData() {
            var chatMessages = getChatMessages(getCurrentMessageId());
            if (!chatMessages || chatMessages.length === 0) {
                console.error("无法获取消息内容");
                return null;
            }
            return chatMessages[0].message;
        }

        /* ========== 解析数据 ========== */
        function parseData(messageText) {
            var result = {};

            /* 从完整消息中提取标签内容 */
            var tagMatch = messageText.match(/<${tagName}>([\\s\\S]*?)<\\/${tagName}>/);
            if (!tagMatch || !tagMatch[1]) {
                console.error("未找到标签内容");
                return result;
            }
            var content = tagMatch[1];

            /* 解析字段 */
${fieldParseCode}

            return result;
        }

        /* ========== 渲染界面 ========== */
        function renderPage(data) {
            var html = \`
                <div class="panel-title">${pageTitle}</div>
${fieldRowsHtml}
                <button class="action-btn" onclick="handleRefresh()">🔄 刷新数据</button>
            \`;
            document.getElementById('content').innerHTML = html;
        }

        /* ========== 交互函数 ========== */
        function handleRefresh() {
            if (typeof triggerSlash === 'function') {
                triggerSlash('/send ${keywords[0] || '刷新面板'}|/trigger');
            }
        }

        /* ========== 主函数 ========== */
        function init() {
            try {
                var messageText = getMessageData();
                if (!messageText) {
                    document.getElementById('content').innerHTML =
                        '<div class="loading">❌ 无法获取消息内容</div>';
                    return;
                }
                var data = parseData(messageText);
                renderPage(data);
            } catch (error) {
                console.error("错误:", error);
                document.getElementById('content').innerHTML =
                    '<div class="loading">❌ 加载失败：' + error.message + '</div>';
            }
        }

        $(function() { init(); });
    <\/script>
</body>
</html>`;

    // 酒馆正则对象
    var tavernRegexObj = {
      id: 'regex-gen-' + Date.now(),
      script_name: scriptName,
      enabled: true,
      find_regex: '<' + tagName + '>[\\s\\S]*?</' + tagName + '>',
      replace_string: '```\n' + htmlCode + '\n```',
      trim_strings: [],
      source: {
        user_input: false,
        ai_output: true,
        slash_command: false,
        world_info: false,
        reasoning: false
      },
      destination: {
        display: true,
        prompt: false
      },
      run_on_edit: true,
      min_depth: null,
      max_depth: null
    };

    return {
      regexConfig: regexConfig,
      worldbookCode: worldbookCode,
      htmlCode: htmlCode,
      tavernRegexObj: tavernRegexObj
    };
  }

  // ===== 创建/销毁 Iframe（参考时之写卡器：空 iframe + load 后用 doc.write 写入）=====
  var iframeEl = null;

  function createModalIframe() {
    return new Promise(function (resolve, reject) {
      try {
        var pWin = getParentWindow();
        if (!pWin) return reject(new Error('无法获取父窗口'));
        var pDoc = pWin.document;
        if (!pDoc) return reject(new Error('父窗口没有 document'));
        if (!pDoc.body) return reject(new Error('document.body 尚未创建'));

        // 清理旧的
        closeIframe();
        console.log('[正则代码生成器] ① 父窗口/Document/Body OK');

        var isMobile = false;
        try { isMobile = !!(pWin.matchMedia && pWin.matchMedia('(max-width: 768px)').matches); } catch (_) {}

        // 遮罩层
        var ov = pDoc.createElement('div');
        ov.id = SCRIPT_ID + '_overlay';
        ov.style.cssText =
          'position:fixed;top:0;left:0;right:0;bottom:0;' +
          'z-index:100000;' +
          'display:flex;align-items:center;justify-content:center;' +
          'background:' + (isMobile ? '#ffffff' : 'rgba(15,23,42,0.55)') + ';' +
          'padding:' + (isMobile ? '0' : '16px') + ';';
        ov.addEventListener('click', function (e) { if (e.target === ov) closeIframe(); });

        // 容器
        var wrap = pDoc.createElement('div');
        wrap.id = SCRIPT_ID + '_wrap';
        wrap.style.cssText =
          'position:relative;' +
          'width:' + (isMobile ? '100%' : 'min(1180px,96vw)') + ';' +
          'height:' + (isMobile ? '100%' : 'min(820px,96vh)') + ';' +
          'max-width:100%;max-height:100%;' +
          'border-radius:' + (isMobile ? '0' : '16px') + ';' +
          'overflow:hidden;' +
          'background:#ffffff;color:#1e293b;' +
          (isMobile ? '' : 'box-shadow:0 30px 80px rgba(15,23,42,0.35);border:1px solid rgba(15,23,42,0.08);');

        // 空 iframe
        var fr = pDoc.createElement('iframe');
        fr.id = SCRIPT_ID + '_iframe';
        fr.style.cssText = 'width:100%;height:100%;border:none;display:block;background:#fff;';

        console.log('[正则代码生成器] ② 创建空 iframe，等待 load...');

        fr.addEventListener('load', function () {
          try {
            var d = fr.contentDocument || fr.contentWindow.document;
            if (!d) { reject(new Error('无法获取 iframe contentDocument')); return; }

            // 写入 HTML 头部 + CSS
            console.log('[正则代码生成器] ③ iframe load，写入 HTML...');
            d.open();
            d.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">');
            d.write('<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">');
            d.write('<style>' + IFRAME_CSS + '</style>');
            d.write('</head><body>');
            d.write(getIframeBodyHTML());
            d.write('</body></html>');
            d.close();
            console.log('[正则代码生成器] ④ ✅ HTML 写入完成');

            // 绑定 ESC + message
            function escFn(e) { if (e.key === 'Escape') closeIframe(); }
            pDoc.addEventListener('keydown', escFn);
            function msgFn(ev) { try { if (ev && ev.data && ev.data.action === 'closeRegexGenerator') closeIframe(); } catch (_) {} }
            pWin.addEventListener('message', msgFn);
            ov._escFn = escFn;
            ov._msgFn = msgFn;

            resolve(d);
          } catch (e) {
            console.error('[正则代码生成器] ❌ iframe load 回调异常：', e);
            reject(e);
          }
        });

        wrap.appendChild(fr);
        ov.appendChild(wrap);
        pDoc.body.appendChild(ov);
        iframeEl = fr;

        // 超时保护
        setTimeout(function () {
          try {
            if (!fr.contentDocument || !fr.contentDocument.body) reject(new Error('iframe load 超时'));
          } catch (e) { reject(e); }
        }, 5000);
      } catch (e) {
        reject(e);
      }
    });
  }

  function closeIframe() {
    try {
      var pWin = getParentWindow();
      var pDoc = pWin ? pWin.document : null;
      var ov = pDoc ? pDoc.getElementById(SCRIPT_ID + '_overlay') : null;
      if (ov) {
        if (ov._escFn && pDoc) { try { pDoc.removeEventListener('keydown', ov._escFn); } catch (_) {} }
        if (ov._msgFn && pWin) { try { pWin.removeEventListener('message', ov._msgFn); } catch (_) {} }
        if (ov.parentNode) { try { ov.parentNode.removeChild(ov); } catch (_) {} }
      }
    } catch (_) {}
    iframeEl = null;
  }

  // iframe 内部的静态 HTML 结构
  function getIframeBodyHTML() {
    return '' +
      '<div class="app">' +
        '<div class="topbar">' +
          '<h1>✨ <span>正则代码生成器</span><span class="subtitle">酒馆助手模板生成工具</span></h1>' +
          '<div class="top-actions">' +
            '<button class="btn btn-sm btn-ghost" id="btnHelp" title="使用说明">❓ 说明</button>' +
            '<button class="icon-btn" id="btnClose" title="关闭">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="mode-tabs">' +
          '<div class="mode-tab active" data-mode="A">📄 模式A<span class="badge">正文美化</span></div>' +
          '<div class="mode-tab" data-mode="B">📊 模式B<span class="badge">结构化数据</span></div>' +
        '</div>' +
        '<div class="view-switch">' +
          '<button class="view-switch-btn active" data-view="form">📝 配置</button>' +
          '<button class="view-switch-btn" data-view="preview">👁️ 预览</button>' +
        '</div>' +
        '<div class="main mobile-view-form">' +
          '<div class="form-panel" id="formPanel"></div>' +
          '<div class="preview-panel">' +
            '<div class="preview-tabs" id="previewTabs"></div>' +
            '<div class="code-container">' +
              '<div class="code-header">' +
                '<span class="code-title" id="codeTitle">📝 酒馆正则配置</span>' +
                '<div class="code-actions">' +
                  '<button class="btn btn-sm" id="btnCopy">📋 复制代码</button>' +
                  '<button class="btn btn-sm btn-primary" id="btnImport">➕ 导入酒馆正则</button>' +
                '</div>' +
              '</div>' +
              '<pre class="code-block" id="codeBlock"></pre>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ===== 打开生成器：拿到 doc 后在闭包中直接操作 DOM（参考时之写卡器 openEditor）=====
  async function openGenerator() {
    console.log('[正则代码生成器] 🚀 正在打开生成器...');
    var doc = await createModalIframe();
    console.log('[正则代码生成器] ⑤ 拿到 iframe document，开始绑定事件...');

    var win = iframeEl ? iframeEl.contentWindow : window;
    var root = getParentWindow();

    // 状态
    var state = {
      mode: 'A',
      activeTab: 0,
      configA: {
        scriptName: '[界面]正文美化',
        tagName: 'story',
        stylePreset: 'novel',
        srcAIOutput: true,
        runOnEdit: true,
        destDisplay: true
      },
      configB: {
        scriptName: '[界面]状态栏',
        tagName: 'status',
        pageTitle: '角色状态栏',
        dataFormat: 'pipe',
        triggerDesc: '当用户提到查看状态、属性面板等信息时使用',
        fields: [
          { key: 'hp', label: '生命值' },
          { key: 'mp', label: '法力值' },
          { key: 'atk', label: '攻击力' },
          { key: 'def', label: '防御力' }
        ],
        keywords: ['查看状态', '打开面板', '属性']
      }
    };

    // ===== 模式切换 =====
    doc.querySelectorAll('.mode-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        doc.querySelectorAll('.mode-tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        state.mode = tab.dataset.mode;
        state.activeTab = 0;
        renderForm();
        renderPreviewTabs();
        updateCode();
      });
    });

    // ===== 表单渲染：模式A =====
    function renderFormA() {
      var panel = doc.getElementById('formPanel');
      var c = state.configA;
      var presetsHtml = Object.keys(STYLE_PRESETS_A).map(function (key) {
        var p = STYLE_PRESETS_A[key];
        var selected = c.stylePreset === key ? ' selected' : '';
        return '<div class="style-preset' + selected + '" data-preset="' + key + '">' +
          '<div class="style-preset-name">' + p.name + '</div>' +
          '<div class="style-preset-desc">' + p.desc + '</div>' +
          '</div>';
      }).join('');

      panel.innerHTML =
        '<div class="form-section">' +
          '<div class="form-section-title">⚙️ 基本配置</div>' +
          '<div class="form-group">' +
            '<label class="form-label">脚本名称<span class="req">*</span><span class="hint">酒馆正则中显示的名字</span></label>' +
            '<input type="text" class="form-input" id="input_scriptName" value="' + escapeHtml(c.scriptName) + '" placeholder="[界面]xxx">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">标签名<span class="req">*</span><span class="hint">不要用 think/thinking/content</span></label>' +
            '<input type="text" class="form-input" id="input_tagName" value="' + escapeHtml(c.tagName) + '" placeholder="story">' +
          '</div>' +
        '</div>' +
        '<div class="form-section">' +
          '<div class="form-section-title">🎨 样式预设</div>' +
          '<div class="style-presets">' + presetsHtml + '</div>' +
        '</div>' +
        '<div class="form-section">' +
          '<div class="form-section-title">✅ 正则选项</div>' +
          '<div class="form-row">' +
            '<div class="form-checkbox' + (c.srcAIOutput ? ' checked' : '') + '" data-opt="srcAIOutput">' +
              '<input type="checkbox" id="opt_srcAIOutput"' + (c.srcAIOutput ? ' checked' : '') + '>' +
              '<label for="opt_srcAIOutput">AI输出</label>' +
            '</div>' +
            '<div class="form-checkbox' + (c.runOnEdit ? ' checked' : '') + '" data-opt="runOnEdit">' +
              '<input type="checkbox" id="opt_runOnEdit"' + (c.runOnEdit ? ' checked' : '') + '>' +
              '<label for="opt_runOnEdit">编辑时运行</label>' +
            '</div>' +
          '</div>' +
          '<div style="height:12px"></div>' +
          '<div class="form-checkbox' + (c.destDisplay ? ' checked' : '') + '" data-opt="destDisplay">' +
            '<input type="checkbox" id="opt_destDisplay"' + (c.destDisplay ? ' checked' : '') + '>' +
            '<label for="opt_destDisplay">仅格式显示（推荐开启）</label>' +
          '</div>' +
        '</div>';
      bindFormAEvents();
    }

    function bindFormAEvents() {
      var c = state.configA;
      doc.getElementById('input_scriptName').addEventListener('input', function (e) { c.scriptName = e.target.value; updateCode(); });
      doc.getElementById('input_tagName').addEventListener('input', function (e) {
        c.tagName = e.target.value.replace(/[<>\/\s]/g, '');
        e.target.value = c.tagName;
        updateCode();
      });
      doc.querySelectorAll('.style-preset').forEach(function (el) {
        el.addEventListener('click', function () {
          doc.querySelectorAll('.style-preset').forEach(function (p) { p.classList.remove('selected'); });
          el.classList.add('selected');
          c.stylePreset = el.dataset.preset;
          updateCode();
        });
      });
      ['srcAIOutput', 'runOnEdit', 'destDisplay'].forEach(function (opt) {
        var wrap = doc.querySelector('[data-opt="' + opt + '"]');
        var cb = doc.getElementById('opt_' + opt);
        function toggle() { c[opt] = !c[opt]; cb.checked = c[opt]; wrap.classList.toggle('checked', c[opt]); updateCode(); }
        wrap.addEventListener('click', function (e) { if (e.target !== cb) { e.preventDefault(); toggle(); } });
        cb.addEventListener('change', toggle);
      });
    }

    // ===== 表单渲染：模式B =====
    function renderFormB() {
      var panel = doc.getElementById('formPanel');
      var c = state.configB;
      var fieldsHtml = c.fields.map(function (f, idx) {
        return '<div class="field-item" data-idx="' + idx + '">' +
          '<input type="text" class="field-key" placeholder="字段key" value="' + escapeHtml(f.key) + '">' +
          '<input type="text" class="field-label" placeholder="显示名称" value="' + escapeHtml(f.label) + '">' +
          '<button class="field-del" data-idx="' + idx + '">删除</button>' +
          '</div>';
      }).join('');

      panel.innerHTML =
        '<div class="form-section">' +
          '<div class="form-section-title">⚙️ 基本配置</div>' +
          '<div class="form-group">' +
            '<label class="form-label">脚本名称<span class="req">*</span></label>' +
            '<input type="text" class="form-input" id="input_scriptName" value="' + escapeHtml(c.scriptName) + '">' +
          '</div>' +
          '<div class="form-row">' +
            '<div class="form-group">' +
              '<label class="form-label">标签名<span class="req">*</span></label>' +
              '<input type="text" class="form-input" id="input_tagName" value="' + escapeHtml(c.tagName) + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">页面标题<span class="req">*</span></label>' +
              '<input type="text" class="form-input" id="input_pageTitle" value="' + escapeHtml(c.pageTitle) + '">' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="form-section">' +
          '<div class="form-section-title">📋 数据格式</div>' +
          '<div class="form-group">' +
            '<label class="form-label">解析方式</label>' +
            '<select class="form-select" id="input_dataFormat">' +
              '<option value="pipe"' + (c.dataFormat === 'pipe' ? ' selected' : '') + '>[字段|值] 管道格式（推荐）</option>' +
              '<option value="kv"' + (c.dataFormat === 'kv' ? ' selected' : '') + '>键:值 行格式</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="form-section">' +
          '<div class="form-section-title">🔑 字段定义</div>' +
          '<div class="field-list">' + fieldsHtml + '</div>' +
          '<button class="add-field-btn" id="btnAddField">+ 添加字段</button>' +
        '</div>' +
        '<div class="form-section">' +
          '<div class="form-section-title">🎯 世界书触发</div>' +
          '<div class="form-group">' +
            '<label class="form-label">触发条件说明</label>' +
            '<input type="text" class="form-input" id="input_triggerDesc" value="' + escapeHtml(c.triggerDesc) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">触发关键词<span class="hint">每行一个</span></label>' +
            '<textarea class="form-textarea" id="input_keywords">' + escapeHtml(c.keywords.join('\n')) + '</textarea>' +
          '</div>' +
        '</div>';
      bindFormBEvents();
    }

    function bindFormBEvents() {
      var c = state.configB;
      doc.getElementById('input_scriptName').addEventListener('input', function (e) { c.scriptName = e.target.value; updateCode(); });
      doc.getElementById('input_tagName').addEventListener('input', function (e) { c.tagName = e.target.value.replace(/[<>\/\s]/g, ''); e.target.value = c.tagName; updateCode(); });
      doc.getElementById('input_pageTitle').addEventListener('input', function (e) { c.pageTitle = e.target.value; updateCode(); });
      doc.getElementById('input_dataFormat').addEventListener('change', function (e) { c.dataFormat = e.target.value; updateCode(); });
      doc.getElementById('input_triggerDesc').addEventListener('input', function (e) { c.triggerDesc = e.target.value; updateCode(); });
      doc.getElementById('input_keywords').addEventListener('input', function (e) { c.keywords = e.target.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); updateCode(); });
      doc.querySelectorAll('.field-key').forEach(function (inp, i) { inp.addEventListener('input', function (e) { c.fields[i].key = e.target.value.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, ''); e.target.value = c.fields[i].key; updateCode(); }); });
      doc.querySelectorAll('.field-label').forEach(function (inp, i) { inp.addEventListener('input', function (e) { c.fields[i].label = e.target.value; updateCode(); }); });
      doc.querySelectorAll('.field-del').forEach(function (btn) { btn.addEventListener('click', function () { var idx = parseInt(btn.dataset.idx); if (c.fields.length <= 1) { createToast(win, '至少保留一个字段', 'error'); return; } c.fields.splice(idx, 1); renderFormB(); updateCode(); }); });
      doc.getElementById('btnAddField').addEventListener('click', function () { c.fields.push({ key: 'field' + (c.fields.length + 1), label: '字段' + (c.fields.length + 1) }); renderFormB(); updateCode(); });
    }

    function renderForm() { if (state.mode === 'A') renderFormA(); else renderFormB(); }

    function renderPreviewTabs() {
      var tabs = doc.getElementById('previewTabs');
      var tabDefs = state.mode === 'A'
        ? [{ key: 'regexConfig', label: '📝 正则配置' }, { key: 'htmlCode', label: '🌐 前端HTML' }]
        : [{ key: 'regexConfig', label: '📝 正则配置' }, { key: 'worldbookCode', label: '📖 世界书规则' }, { key: 'htmlCode', label: '🌐 前端HTML' }];
      state.tabDefs = tabDefs;
      if (state.activeTab >= tabDefs.length) state.activeTab = 0;
      tabs.innerHTML = tabDefs.map(function (t, i) { return '<div class="preview-tab' + (i === state.activeTab ? ' active' : '') + '" data-idx="' + i + '">' + t.label + '</div>'; }).join('');
      tabs.querySelectorAll('.preview-tab').forEach(function (tab) {
        tab.addEventListener('click', function () { state.activeTab = parseInt(tab.dataset.idx); tabs.querySelectorAll('.preview-tab').forEach(function (t) { t.classList.remove('active'); }); tab.classList.add('active'); updateCode(); });
      });
    }

    function updateCode() {
      var result = state.mode === 'A' ? generateModeA(state.configA) : generateModeB(state.configB);
      state.lastResult = result;
      var tab = state.tabDefs[state.activeTab];
      doc.getElementById('codeBlock').textContent = result[tab.key] || '';
      doc.getElementById('codeTitle').textContent = tab.label;
    }

    doc.getElementById('btnCopy').addEventListener('click', function () {
      copyToClipboard(win, doc.getElementById('codeBlock').textContent, function (ok) {
        createToast(win, ok ? '✅ 代码已复制到剪贴板' : '❌ 复制失败', ok ? 'success' : 'error');
      });
    });

    doc.getElementById('btnImport').addEventListener('click', async function () {
      if (!state.lastResult) return;
      var obj = state.lastResult.tavernRegexObj;
      var forbidden = ['think', 'thinking', 'content'];
      var tagCheck = obj.find_regex.match(/<([a-zA-Z_][a-zA-Z0-9_-]*)>/);
      if (tagCheck && forbidden.indexOf(tagCheck[1].toLowerCase()) !== -1) { createToast(win, '❌ 标签名 ' + tagCheck[1] + ' 被禁止使用！', 'error'); return; }
      try {
        createToast(win, '⏳ 正在导入酒馆正则...', 'info');
        if (typeof root.updateTavernRegexesWith === 'function') {
          await root.updateTavernRegexesWith(function (regexes) {
            var existingIdx = -1;
            regexes.forEach(function (r, i) { if (r.script_name === obj.script_name) existingIdx = i; });
            if (existingIdx >= 0) regexes[existingIdx] = obj; else regexes.push(obj);
            return regexes;
          }, { type: 'global' });
          createToast(win, '✅ 正则「' + obj.script_name + '」已成功导入！', 'success');
        } else {
          copyToClipboard(win, state.lastResult.regexConfig, function (ok) {
            createToast(win, ok ? '⚠️ 已复制配置到剪贴板，请手动导入' : '⚠️ 请手动复制配置', 'info');
          });
        }
      } catch (err) { createToast(win, '❌ 导入失败：' + (err.message || String(err)), 'error'); }
    });

    doc.getElementById('btnClose').addEventListener('click', function () { closeIframe(); });
    doc.getElementById('btnHelp').addEventListener('click', function () {
      alert('【正则代码生成器使用说明】\n\n📄 模式A：正文美化\n  · 适用于小说排版、对话气泡、信件等\n  · 只需要AI输出 <标签>正文</标签> 格式\n  · 提供 4 种样式预设可选\n\n📊 模式B：结构化数据\n  · 适用于状态栏、任务面板、论坛帖子等\n  · 需要AI按固定字段格式输出\n  · 自动生成世界书规则约束AI格式\n\n💡 使用步骤：\n  1. 选择模式，填写配置\n  2. 切换预览Tab查看生成代码\n  3. 点「导入酒馆正则」一键导入\n  4. 在世界书中加入生成的规则（模式B）');
    });

    doc.querySelectorAll('.view-switch-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        doc.querySelectorAll('.view-switch-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var main = doc.querySelector('.main');
        var view = btn.dataset.view;
        main.classList.remove('mobile-view-form', 'mobile-view-preview');
        main.classList.add('mobile-view-' + view);
      });
    });

    // ===== 初始化 =====
    renderForm();
    renderPreviewTabs();
    updateCode();
    console.log('[正则代码生成器] ⑥ ✅ 界面初始化完成！');
  }

  // ===== 卸载清理 =====
  function cleanupScriptArtifacts() {
    try { closeIframe(); } catch (_) {}
    try {
      var pDoc = getParentWindow().document;
      var btn = pDoc.getElementById(SCRIPT_ID + '-btn');
      if (btn) btn.remove();
      var $ = getJQuery();
      if ($) { $('#' + SCRIPT_ID + '_overlay, [id^="' + SCRIPT_ID + '_"]', pDoc).remove(); }
    } catch (_) {}
  }

  // ===== 脚本按钮（只留 1 个可见按钮在脚本库）=====
  var OFFICIAL_BUTTON_NAME = '正则代码生成器';

  function ensureScriptButtons() {
    // 官方示例：replaceScriptButtons([{ name: '按钮名', visible: true }])
    var replaceButtons = getApi('replaceScriptButtons');
    var appendButtons = getApi('appendInexistentScriptButtons');
    try {
      var buttons = [{ name: OFFICIAL_BUTTON_NAME, visible: true }];
      if (replaceButtons) {
        replaceButtons(buttons);
        console.log('[正则代码生成器] ✅ 脚本库按钮已创建：' + OFFICIAL_BUTTON_NAME);
        return true;
      } else if (appendButtons) {
        appendButtons(buttons);
        console.log('[正则代码生成器] ✅ 脚本库按钮已追加：' + OFFICIAL_BUTTON_NAME);
        return true;
      } else {
        console.warn('[正则代码生成器] ⚠️ 未获取到 replaceScriptButtons / appendInexistentScriptButtons，可手动在脚本库添加按钮名：' + OFFICIAL_BUTTON_NAME);
        return false;
      }
    } catch (e) {
      console.warn('[正则代码生成器] 按钮写入脚本库失败：', e && e.message ? e.message : e);
      return false;
    }
  }

  function bindScriptButtonEvents() {
    // 官方注册方式：eventOn(getButtonEvent('按钮名'), handler)
    var evtOn = getApi('eventOn');
    var getBtnEvt = getApi('getButtonEvent');
    if (!evtOn || !getBtnEvt) {
      console.warn('[正则代码生成器] ⚠️ 未获取到 eventOn 或 getButtonEvent API');
      return false;
    }
    var bound = 0;
    function tryBind(name) {
      try {
        evtOn(getBtnEvt(name), function () { openGeneratorWithError(); });
        console.log('[正则代码生成器] 🔗 已绑定按钮事件：' + name);
        bound++;
      } catch (e) {
        console.warn('[正则代码生成器] 绑定 ' + name + ' 失败：', e && e.message ? e.message : e);
      }
    }
    // 多名字兼容（绑定 4 个，防止用户改按钮名）
    tryBind(OFFICIAL_BUTTON_NAME);
    tryBind('打开正则生成器');
    tryBind('正则生成器');
    tryBind('✨ 打开生成器');
    return bound > 0;
  }

  // ===== 真正的打开入口（统一错误处理：出错就 alert 具体原因给用户）=====
  function openGeneratorWithError() {
    try {
      console.log('[正则代码生成器] 🎯 点击触发：正在打开弹窗…');
      openGenerator().catch(function (e) {
        var msg = (e && e.message) ? e.message : String(e);
        console.error('[正则代码生成器] ❌ 打开失败：', e);
        try {
          alert('❌ 正则代码生成器打开失败\n\n错误信息：' + msg + '\n\n（详细错误请按 F12 查看 Console 标签页）');
        } catch (_) {}
      });
    } catch (e) {
      var msg = (e && e.message) ? e.message : String(e);
      console.error('[正则代码生成器] ❌ 打开失败：', e);
      try {
        alert('❌ 正则代码生成器打开失败\n\n错误信息：' + msg + '\n\n（详细错误请按 F12 查看 Console 标签页）');
      } catch (_) {}
    }
  }

  // ===== 浮动按钮（无论脚本按钮如何都会创建，双保险）=====
  var floatRetryCount = 0;
  function addFloatingButton() {
    try {
      var pWin = getParentWindow();
      var pDoc = pWin.document;
      if (!pDoc || !pDoc.body) {
        if (floatRetryCount < 20) {
          floatRetryCount++;
          setTimeout(addFloatingButton, 300);
        }
        return false;
      }
      var old = pDoc.getElementById(SCRIPT_ID + '-btn');
      if (old) { try { old.remove(); } catch (_) {} }

      var btn = pDoc.createElement('button');
      btn.id = SCRIPT_ID + '-btn';
      btn.textContent = '✨ 正则生成器';
      btn.title = '点击打开正则代码生成器';
      var isMobileBtn = false;
      try { isMobileBtn = (pWin.matchMedia && pWin.matchMedia('(max-width: 768px)').matches) || false; } catch (_) {}
      var btnCss = isMobileBtn
        ? 'position:fixed;bottom:72px;right:12px;z-index:99998;padding:9px 15px;background:linear-gradient(135deg,#4f46e5,#4338ca);color:#fff;border:none;border-radius:20px;cursor:pointer;font-weight:600;box-shadow:0 4px 16px rgba(79,70,229,.4);transition:transform .2s, box-shadow .2s;font-size:12px;-webkit-tap-highlight-color:transparent;'
        : 'position:fixed;bottom:80px;right:24px;z-index:99998;padding:11px 20px;background:linear-gradient(135deg,#4f46e5,#4338ca);color:#fff;border:none;border-radius:25px;cursor:pointer;font-weight:600;box-shadow:0 6px 24px rgba(79,70,229,.35);transition:transform .2s, box-shadow .2s;font-size:14px;';
      btn.style.cssText = btnCss;
      btn.onmouseover = function () { try { btn.style.transform = 'scale(1.05)'; btn.style.boxShadow = '0 8px 28px rgba(79,70,229,.5)'; } catch (_) {} };
      btn.onmouseout = function () { try { btn.style.transform = 'scale(1)'; } catch (_) {} };
      btn.onclick = function () { openGeneratorWithError(); };
      pDoc.body.appendChild(btn);
      console.log('[正则代码生成器] ✅ 浮动按钮已创建（右下角），可直接点击打开');
      return true;
    } catch (e) {
      if (floatRetryCount < 20) {
        floatRetryCount++;
        setTimeout(addFloatingButton, 300);
      }
      return false;
    }
  }

  // ===== 主初始化流程 =====
  var initialized = false;
  function mainInit() {
    if (initialized) return;
    initialized = true;
    console.log('[正则代码生成器] 🚀 初始化（版本：官方按钮API版 · 多作用域兼容）');

    try { window.addEventListener('pagehide', cleanupScriptArtifacts); } catch (_) {}
    try {
      var pWin = getParentWindow();
      if (pWin !== window) pWin.addEventListener('pagehide', cleanupScriptArtifacts);
    } catch (_) {}

    // 1) 先在脚本库自动创建按钮（replaceScriptButtons）
    var buttonsCreated = false;
    var buttonsBound = false;
    try { buttonsCreated = ensureScriptButtons(); } catch (_) {}
    try { buttonsBound = bindScriptButtonEvents(); } catch (_) {}

    console.log('[正则代码生成器] 📋 脚本库按钮：' + (buttonsCreated ? '已创建' : '未创建') + ' / 事件绑定：' + (buttonsBound ? '已绑定' : '未绑定'));

    // 2) 无论脚本按钮是否生效，都创建浮动按钮（兜底 + 最快可用）
    addFloatingButton();

    // 3) 延迟后再试一次：如果 API 是异步注入的，这时可能才可用
    setTimeout(function () {
      if (!buttonsCreated) try { ensureScriptButtons(); } catch (_) {}
      if (!buttonsBound) try { bindScriptButtonEvents(); } catch (_) {}
    }, 1500);

    // 4) 终极保底：10 秒后如果没看到浮动按钮，再创建一次
    setTimeout(function () {
      try {
        var pDoc = getParentWindow().document;
        if (pDoc && !pDoc.getElementById(SCRIPT_ID + '-btn')) {
          console.log('[正则代码生成器] 🛡️ 保底：未检测到浮动按钮，重新创建');
          addFloatingButton();
        }
      } catch (_) {}
    }, 10000);
  }

  // ===== 启动：按官方示例用 $(cb) jQuery ready =====
  var started = false;
  function startOnce() {
    if (started) return;
    started = true;
    try { mainInit(); } catch (e) {
      console.error('[正则代码生成器] ❌ 主流程异常：', e);
      try { addFloatingButton(); } catch (_) {}
    }
  }

  function boot() {
    // 脚本环境约定：window.$ = window.parent.$（jQuery 直接操作酒馆页面）
    // 所以 $(cb) 就等同于 window.parent.$(cb)
    var $ = getJQuery();
    if ($) {
      $(function () { startOnce(); });
    } else {
      // jQuery 不可用，直接起
      setTimeout(startOnce, 500);
    }
    // 再加一个兜底：3 秒后强制起一次
    setTimeout(startOnce, 3000);
  }

  // 立即尝试启动（大多数环境，脚本加载时全局 API 已经准备好了）
  boot();

})();
