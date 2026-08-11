(function() {
/* ============================================================================
 * 正则代码生成器 · Tavern Helper 脚本
 * ----------------------------------------------------------------------------
 * 功能：
 *   - 聊天式 AI 生成正则代码（模式A 正文美化 / 模式B 结构化数据）
 *   - 代码区标签页：正则配置 / HTML 代码 / 世界书源文件（B模式）
 *   - HTML 实时预览（mock 酒馆 API，无需真实消息）
 *   - 一键复制 / 一键导入酒馆正则
 *   - 移动端三 tab 切换（聊天/代码/预览）
 * ==========================================================================
 */
  const SCRIPT_ID = 'regex-code-generator';

  function getApi(name) {
    var candidates = [];
    try { if (typeof window !== 'undefined') candidates.push(window); } catch (_) {}
    try { if (window && window.parent) candidates.push(window.parent); } catch (_) {}
    try { if (window && window.top && window.top !== window) candidates.push(window.top); } catch (_) {}
    try { if (typeof self !== 'undefined') candidates.push(self); } catch (_) {}
    try { if (typeof globalThis !== 'undefined') candidates.push(globalThis); } catch (_) {}
    for (var i = 0; i < candidates.length; i++) {
      try { var w = candidates[i]; if (w && typeof w[name] === 'function') return w[name]; } catch (_) {}
    }
    try { if (typeof eval(name) === 'function') return eval(name); } catch (_) {}
    return null;
  }

  function getJQuery() {
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

  (function exposeTavernApiLocally() {
    var names = [
      'eventOn', 'eventOff', 'eventTrigger',
      'getButtonEvent', 'replaceScriptButtons', 'appendInexistentScriptButtons',
      'updateScriptButtonsWith', 'getScriptButtons', 'getScriptId', 'getScriptName',
      'replaceScriptInfo', 'getScriptInfo',
      'getVariables', 'replaceVariables', 'updateVariablesWith',
      'getChatMessages', 'getMessageById', 'getCurrentMessageId',
      'generate', 'generateRaw', 'generateQuietPrompt', 'triggerSlash',
      'replaceWorldbook', 'updateWorldbookWith',
      'updateTavernRegexesWith', 'replaceTavernRegexes',
      'toastr', 'replaceRegex',
      'waitGlobalInitialized', 'getCurrentChatId'
    ];
    for (var i = 0; i < names.length; i++) {
      try {
        var name = names[i];
        if (typeof window[name] !== 'undefined') continue;
        var fn = getApi(name);
        if (fn !== null) { try { window[name] = fn; } catch (_) {} }
      } catch (_) {}
    }
    try { if (!window.toastr) { var t = getApi('toastr'); if (t) window.toastr = t; } } catch (_) {}
  })();

  // ===== 样式表 =====
  var IFRAME_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;width:100%;margin:0;padding:0;overflow:hidden}
:root{
  --bg:#f0f2f5;
  --surface:#ffffff;
  --surface-soft:#f8f9fa;
  --surface-sink:#eef0f3;
  --ink:#1a1a2e;
  --ink-soft:#495057;
  --muted:#868e96;
  --accent:#4f46e5;
  --accent-deep:#4338ca;
  --accent-soft:rgba(79,70,229,.08);
  --accent-border:rgba(79,70,229,.22);
  --accent-text:#4338ca;
  --user-bubble:#4f46e5;
  --user-bubble-text:#ffffff;
  --ai-bubble:#ffffff;
  --ai-bubble-text:#1a1a2e;
  --code-bg:#1e1e2e;
  --code-text:#cdd6f4;
  --sage:#16a34a;
  --terra:#dc2626;
  --amber:#ca8a04;
  --line:rgba(15,23,42,.08);
  --line-soft:rgba(15,23,42,.04);
  --radius:12px;
  --radius-sm:8px;
  --shadow-soft:0 2px 8px rgba(15,23,42,.04);
  --shadow-bubble:0 1px 2px rgba(15,23,42,.06);
  --font:'Segoe UI',system-ui,-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei UI',sans-serif;
  --font-mono:'Cascadia Code','JetBrains Mono','Consolas',Menlo,monospace;
}
body{font-family:var(--font);background:var(--bg);color:var(--ink);font-size:14px;-webkit-font-smoothing:antialiased;height:100%;width:100%;overflow:hidden}
.app{display:flex;flex-direction:column;height:100%;width:100%;overflow:hidden;min-height:0}

/* 顶栏 */
.chat-header{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0;box-shadow:var(--shadow-soft)}
.chat-header h1{font-size:15px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px}
.chat-header .subtitle{font-size:11px;color:var(--muted);font-weight:400;margin-left:6px}
.header-actions{display:flex;gap:4px;align-items:center}
.mode-badge{font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600;flex-shrink:0}
.mode-badge.a{background:rgba(22,163,74,.1);color:#15803d}
.mode-badge.b{background:rgba(202,138,4,.1);color:#a16207}
.mode-badge.none{background:var(--surface-soft);color:var(--muted)}

/* 移动端 tab（默认隐藏）*/
.mobile-tabs{display:none;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0}
.mobile-tab{flex:1;padding:10px;text-align:center;font-size:13px;font-weight:500;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;background:none;border-top:none;border-left:none;border-right:none}
.mobile-tab.active{color:var(--accent);border-bottom-color:var(--accent)}

/* 主体三栏 */
.main{flex:1 1 0;display:grid;grid-template-columns:1fr 1fr;overflow:hidden;min-height:0}

/* 聊天面板 */
.chat-panel{display:flex;flex-direction:column;overflow:hidden;min-height:0;min-width:0;border-right:1px solid var(--line);background:var(--bg)}
.chat-messages{flex:1 1 0;overflow-y:auto;overflow-x:hidden;padding:14px;min-height:0;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
.chat-messages::-webkit-scrollbar{width:6px}
.chat-messages::-webkit-scrollbar-thumb{background:rgba(148,163,184,.3);border-radius:3px}
.message{display:flex;max-width:100%;min-width:0}
.message.user{justify-content:flex-end}
.message.assistant{justify-content:flex-start}
.message-bubble{max-width:88%;padding:9px 13px;border-radius:var(--radius);box-shadow:var(--shadow-bubble);word-wrap:break-word;word-break:break-word;min-width:0}
.user-bubble{background:var(--user-bubble);color:var(--user-bubble-text);border-bottom-right-radius:4px}
.assistant-bubble{background:var(--ai-bubble);color:var(--ai-bubble-text);border-bottom-left-radius:4px;border:1px solid var(--line-soft)}
.msg-text{font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.typing-indicator{display:flex;gap:4px;padding:4px 0;font-style:italic;color:var(--muted);font-size:12px;align-items:center}
.typing-indicator span:not(.typing-text){width:7px;height:7px;background:var(--accent);border-radius:50%;animation:typingBounce 1.4s infinite ease-in-out}
.typing-indicator span:nth-child(2){animation-delay:.2s}
.typing-indicator span:nth-child(3){animation-delay:.4s}
@keyframes typingBounce{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}

/* 输入区 */
.chat-input-area{display:flex;flex-direction:column;gap:4px;padding:10px 12px;background:var(--surface);border-top:1px solid var(--line);flex-shrink:0}
.chat-input-row{display:flex;gap:8px;align-items:flex-end}
.chat-input{flex:1 1 0;min-width:0;padding:9px 12px;border:1px solid var(--line);border-radius:var(--radius);font-family:var(--font);font-size:13px;color:var(--ink);background:var(--surface-soft);outline:none;resize:none;line-height:1.5;min-height:40px;max-height:100px;transition:border-color .15s,box-shadow .15s}
.chat-input:hover:not(:disabled){border-color:var(--accent-border);background:var(--surface)}
.chat-input:focus{border-color:var(--accent);background:var(--surface);box-shadow:0 0 0 3px var(--accent-soft)}
.chat-input::placeholder{color:var(--muted)}
.chat-send{padding:9px 18px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;font-family:var(--font);flex-shrink:0;min-width:56px;height:40px}
.chat-send:hover:not(:disabled){background:var(--accent-deep);transform:translateY(-1px);box-shadow:0 4px 12px rgba(79,70,229,.25)}
.chat-send:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
.chat-input-foot{display:flex;justify-content:flex-end;padding:0 2px}
.chat-input-hint{font-size:10px;color:var(--muted)}
.kbd{display:inline-block;padding:0 4px;background:var(--surface-soft);border:1px solid var(--line);border-radius:3px;font-size:9px;font-family:var(--font-mono);color:var(--ink-soft)}

/* 右侧面板（代码+预览）*/
.right-panel{display:flex;flex-direction:column;overflow:hidden;min-height:0;min-width:0;background:var(--surface)}

/* 代码区 */
.code-section-wrap{display:flex;flex-direction:column;border-bottom:1px solid var(--line);min-height:0;flex:1 1 0}
.code-tabs{display:flex;gap:0;background:var(--surface-soft);border-bottom:1px solid var(--line);flex-shrink:0;overflow-x:auto}
.code-tab{padding:9px 14px;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);font-weight:500;transition:all .15s;white-space:nowrap;background:none;border-top:none;border-left:none;border-right:none;font-family:var(--font)}
.code-tab:hover{color:var(--ink-soft)}
.code-tab.active{color:var(--accent);border-bottom-color:var(--accent);background:var(--surface)}
.code-tab:disabled{opacity:.4;cursor:not-allowed}
.code-body{flex:1 1 0;overflow:hidden;min-height:0;display:flex;flex-direction:column;position:relative}
.code-actions-bar{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line-soft);flex-shrink:0;align-items:center;background:var(--surface)}
.code-actions-bar .code-title{font-size:11px;color:var(--muted);margin-right:auto}
.code-content{flex:1 1 0;overflow:auto;background:var(--code-bg);color:var(--code-text);padding:12px;font-family:var(--font-mono);font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-all;min-height:0}
.code-content::-webkit-scrollbar{width:6px;height:6px}
.code-content::-webkit-scrollbar-thumb{background:rgba(148,163,184,.3);border-radius:3px}
.code-empty{display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:13px;text-align:center;padding:20px}

/* 预览区 */
.preview-section-wrap{display:flex;flex-direction:column;min-height:0;flex:1 1 0;border-top:2px solid var(--line)}
.preview-header{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line-soft);flex-shrink:0;background:var(--surface-soft)}
.preview-header .pv-title{font-size:12px;font-weight:600;color:var(--ink-soft);margin-right:auto;display:flex;align-items:center;gap:6px}
.preview-input-row{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line-soft);flex-shrink:0;align-items:flex-end;background:var(--surface)}
.preview-input{flex:1 1 0;min-width:0;padding:7px 10px;border:1px solid var(--line);border-radius:6px;font-family:var(--font);font-size:11px;color:var(--ink);background:var(--surface-soft);outline:none;resize:none;line-height:1.5;min-height:32px;max-height:80px}
.preview-input:focus{border-color:var(--accent);background:var(--surface)}
.btn{display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:500;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink-soft);transition:all .15s;font-family:var(--font)}
.btn:hover{background:var(--surface-soft);color:var(--ink)}
.btn-primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-deep);border-color:var(--accent-deep);color:#fff}
.btn-success{background:var(--sage);border-color:var(--sage);color:#fff}
.btn-success:hover{background:#15803d;border-color:#15803d;color:#fff}
.btn-sm{padding:5px 10px;font-size:10px}
.icon-btn{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;border-radius:6px;cursor:pointer;color:var(--muted);transition:all .15s;font-size:14px}
.icon-btn:hover{background:var(--surface-soft);color:var(--ink)}
.preview-frame-wrap{flex:1 1 0;overflow:hidden;min-height:0;background:#fff;position:relative}
.preview-frame{width:100%;height:100%;border:none;background:#fff}
.preview-empty{display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:12px;text-align:center;padding:20px}

/* Toast */
.toast-container{position:fixed;top:12px;left:12px;right:12px;z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.toast{padding:8px 16px;border-radius:8px;font-size:12px;box-shadow:0 4px 16px rgba(15,23,42,.15);animation:slideIn .25s ease;pointer-events:auto}
.toast-success{background:var(--sage);color:#fff}
.toast-error{background:var(--terra);color:#fff}
.toast-info{background:var(--accent);color:#fff}
@keyframes slideIn{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}

/* ===== 响应式 ===== */
@media (max-width: 768px) {
  .chat-header{padding:8px 12px}
  .chat-header h1{font-size:14px}
  .chat-header .subtitle{display:none}
  .mobile-tabs{display:flex}
  .main{display:block !important;overflow:hidden;position:relative}
  .chat-panel{border-right:none;width:100%;height:100%}
  .right-panel{display:none;width:100%;height:100%;border-top:1px solid var(--line)}
  .main.tab-code .chat-panel{display:none}
  .main.tab-code .right-panel{display:flex}
  .main.tab-preview .chat-panel{display:none}
  .main.tab-preview .right-panel{display:flex}
  .main.tab-preview .code-section-wrap{display:none}
  .main.tab-preview .preview-section-wrap{border-top:none;flex:1 1 0}
  .chat-messages{padding:10px;gap:8px}
  .message-bubble{max-width:92%;padding:8px 11px;font-size:12px}
  .msg-text{font-size:12px;line-height:1.5}
  .chat-input-area{padding:8px 10px;gap:3px}
  .chat-input{padding:8px 10px;font-size:13px;min-height:38px}
  .chat-send{padding:8px 14px;font-size:12px;min-width:48px;height:38px}
  .code-tab{padding:8px 11px;font-size:11px}
  .code-content{font-size:10px;padding:10px}
  .preview-input{font-size:10px}
  .icon-btn{width:34px;height:34px;font-size:15px}
}
@media (max-width: 380px) {
  .message-bubble{max-width:95%}
  .code-content{font-size:9px;padding:8px}
  .chat-send{padding:8px 10px;min-width:44px}
}
`;

  // ===== AI 系统提示词 =====
  var SYSTEM_PROMPT = [
    '# 角色定位',
    '你是 SillyTavern（酒馆助手）的「正则代码生成器」。每次用户提出需求，你必须输出完整的、可直接使用的代码，严禁只输出文字说明而不输出代码。',
    '',
    '# 两种工作模式',
    '## 模式A：正文美化模板',
    '适用场景：小说排版、对话气泡、信件、日记、便签、笔记等。',
    '特点：AI 只需输出 <标签>正文</标签>，前端从消息中提取正文做 HTML 排版展示，不需要解析特定字段。',
    '必须产出：2 个文件（正则配置 + 前端 HTML）',
    '',
    '## 模式B：结构化数据美化模板',
    '适用场景：角色状态栏、属性面板、任务清单、背包界面、论坛帖子、排行榜、数据仪表盘等。',
    '特点：AI 必须按固定数据格式输出字段值，前端解析这些字段后渲染成界面，通常有交互按钮（发送关键词触发对话）。',
    '必须产出：3 个文件（正则配置 + 前端 HTML + 世界书源文件）',
    '',
    '# ⚠️ 绝对禁止',
    '- 严禁只输出文字说明、设计思路、伪代码，每次回复**必须**包含完整代码',
    '- 标签名严禁使用：think、thinking、content、system、format_rule',
    '- HTML 中 <script> 结束标签必须写作 <\\/script>',
    '',
    '# 输出格式（每次回复必须严格遵守）',
    '第 1 行：用中文简要说明方案（1-2 句），并以 [模式A] 或 [模式B] 开头标注模式',
    '第 2 部分：<REGEX_CONFIG> 包裹的正则配置文本',
    '第 3 部分：<HTML_CODE> 包裹的完整 HTML 文档',
    '第 4 部分：<WORLDBOOK_SOURCE> 包裹的世界书源文件（仅模式B需要，模式A禁止输出此标签）',
    '',
    '# ==================== 完整示例 A：正文美化（小说排版） ====================',
    '',
    '用户需求："做一个小说正文美化，首行缩进，对话用引号标出，文字颜色米黄色"',
    '',
    '你的输出：',
    '[模式A] 采用信纸风格，首行缩进 2em，叙述段落浅灰色，对话段落用引号标识并加左侧色条。',
    '',
    '<REGEX_CONFIG>',
    '脚本名称: [界面]正文美化',
    '查找正则: <story>[\\s\\S]*?</story>',
    '</REGEX_CONFIG>',
    '',
    '<HTML_CODE>',
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<title>正文美化</title>',
    '<style>',
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'body { font-family: "Microsoft YaHei", sans-serif; background: transparent; padding: 8px; }',
    '.story-container { max-width: 650px; margin: 0 auto; padding: 24px 32px; line-height: 1.9; font-size: 15px; color: #d4c9a8; }',
    '.story-container p { text-indent: 2em; margin-bottom: 14px; }',
    '.story-container .dialogue { text-indent: 0; padding-left: 12px; border-left: 3px solid #b8860b; color: #e6d5a7; }',
    '.loading { text-align: center; padding: 20px; color: #999; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="story-container" id="content"><div class="loading">正在加载...</div></div>',
    '<script>',
    'function getMessageData() {',
    '  var chatMessages = getChatMessages(getCurrentMessageId());',
    '  if (!chatMessages || chatMessages.length === 0) { console.error("无法获取消息内容"); return null; }',
    '  return chatMessages[0].message;',
    '}',
    'function extractContent(messageText) {',
    '  var match = messageText.match(/<story>([\\s\\S]*?)<\\/story>/);',
    '  if (match && match[1]) { return match[1].trim(); }',
    '  return messageText;',
    '}',
    'function renderPage(text) {',
    '  var paragraphs = text.split(/\\n\\s*\\n/);',
    '  var html = "";',
    '  paragraphs.forEach(function(p) {',
    '    var trimmed = p.trim();',
    '    if (trimmed) {',
    '      if (trimmed.startsWith("\\"") || trimmed.startsWith("\u201c") || trimmed.startsWith("\u300c")) {',
    '        html += \'<p class="dialogue">\' + trimmed + "</p>";',
    '      } else {',
    '        html += "<p>" + trimmed + "</p>";',
    '      }',
    '    }',
    '  });',
    '  document.getElementById("content").innerHTML = html;',
    '}',
    'function init() {',
    '  try {',
    '    var messageText = getMessageData();',
    '    if (!messageText) { document.getElementById("content").innerHTML = \'<div class="loading">\u274c \u65e0\u6cd5\u83b7\u53d6\u6d88\u606f\u5185\u5bb9</div>\'; return; }',
    '    var text = extractContent(messageText);',
    '    renderPage(text);',
    '  } catch (error) {',
    '    console.error("错误:", error);',
    '    document.getElementById("content").innerHTML = \'<div class="loading">\u274c \u52a0\u8f7d\u5931\u8d25\uff1a\' + error.message + "</div>";',
    '  }',
    '}',
    '$(function() { init(); });',
    '<\\/script>',
    '</body>',
    '</html>',
    '</HTML_CODE>',
    '',
    '# ==================== 完整示例 B：角色状态栏（结构化数据） ====================',
    '',
    '用户需求："做一个角色状态栏，显示 HP、MP、攻击力、防御力，加上回复 HP 按钮"',
    '',
    '你的输出：',
    '[模式B] 采用游戏卡片风格，使用 [字段|值] 格式输出，HP/MP 显示为进度条，各按钮点击发送触发词。',
    '',
    '<REGEX_CONFIG>',
    '脚本名称: [界面]角色状态栏',
    '查找正则: <status>[\\s\\S]*?</status>',
    '</REGEX_CONFIG>',
    '',
    '<WORLDBOOK_SOURCE>',
    '<角色状态栏>',
    '** 用于展示角色当前属性面板',
    '',
    '<FORMAT_RULE>',
    '#当用户提到查看状态、属性面板、角色信息等需求时，使用本格式输出',
    'Format:',
    '<status>',
    '[HP|当前值|最大值]',
    '[MP|当前值|最大值]',
    '[攻击力|数值]',
    '[防御力|数值]',
    '</status>',
    '</FORMAT_RULE>',
    '',
    '# 注意',
    '- 严禁使用<think>、<thinking>、<content>标签',
    '- </status> 闭合标签后禁止输出其他内容',
    '',
    '# 触发词',
    '- "查看状态"',
    '- "打开面板"',
    '- "属性"',
    '- "状态栏"',
    '</WORLDBOOK_SOURCE>',
    '',
    '<HTML_CODE>',
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<title>角色状态栏</title>',
    '<style>',
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'body { font-family: "Microsoft YaHei", sans-serif; background: transparent; padding: 8px; }',
    '.container { max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 12px; padding: 16px 20px; color: #f1f5f9; border: 1px solid rgba(148,163,184,.2); box-shadow: 0 10px 30px rgba(0,0,0,.4); }',
    '.title { font-size: 16px; font-weight: 700; margin-bottom: 14px; color: #fbbf24; text-align: center; letter-spacing: 2px; }',
    '.stat { margin-bottom: 12px; }',
    '.stat-label { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; color: #cbd5e1; }',
    '.bar { height: 14px; background: rgba(0,0,0,.4); border-radius: 7px; overflow: hidden; border: 1px solid rgba(148,163,184,.2); }',
    '.bar-fill-hp { height: 100%; background: linear-gradient(90deg, #22c55e, #16a34a); transition: width .3s; }',
    '.bar-fill-mp { height: 100%; background: linear-gradient(90deg, #3b82f6, #2563eb); transition: width .3s; }',
    '.stat-numbers { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }',
    '.num-card { background: rgba(255,255,255,.05); padding: 10px; border-radius: 8px; text-align: center; border: 1px solid rgba(148,163,184,.1); }',
    '.num-card .k { font-size: 11px; color: #94a3b8; margin-bottom: 4px; }',
    '.num-card .v { font-size: 20px; font-weight: 700; color: #f8fafc; }',
    '.actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }',
    '.btn { flex: 1 1 0; min-width: 80px; padding: 8px 12px; background: rgba(79,70,229,.85); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all .15s; font-family: inherit; }',
    '.btn:hover { background: rgba(79,70,229,1); transform: translateY(-1px); }',
    '.loading { text-align: center; padding: 20px; color: #94a3b8; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="container" id="content"><div class="loading">正在加载...</div></div>',
    '<script>',
    'function getMessageData() {',
    '  var chatMessages = getChatMessages(getCurrentMessageId());',
    '  if (!chatMessages || chatMessages.length === 0) { console.error("无法获取消息内容"); return null; }',
    '  return chatMessages[0].message;',
    '}',
    'function parseData(messageText) {',
    '  var result = { hp: 0, hpMax: 100, mp: 0, mpMax: 100, atk: 0, def: 0 };',
    '  var tagMatch = messageText.match(/<status>([\\s\\S]*?)<\\/status>/);',
    '  if (!tagMatch || !tagMatch[1]) { console.error("未找到 status 标签内容"); return result; }',
    '  var content = tagMatch[1];',
    '  var hp = content.match(/\\[HP\\|([^|\\]]+)\\|?([^\\]]*)\\]/);',
    '  if (hp) { result.hp = parseInt(hp[1]) || 0; result.hpMax = hp[2] ? (parseInt(hp[2]) || 100) : 100; }',
    '  var mp = content.match(/\\[MP\\|([^|\\]]+)\\|?([^\\]]*)\\]/);',
    '  if (mp) { result.mp = parseInt(mp[1]) || 0; result.mpMax = mp[2] ? (parseInt(mp[2]) || 100) : 100; }',
    '  var atk = content.match(/\\[攻击力\\|([^\\]]+)\\]/);',
    '  if (atk) { result.atk = parseInt(atk[1]) || 0; }',
    '  var def = content.match(/\\[防御力\\|([^\\]]+)\\]/);',
    '  if (def) { result.def = parseInt(def[1]) || 0; }',
    '  return result;',
    '}',
    'function handleClick(keyword) {',
    '  if (typeof triggerSlash === "function") { triggerSlash("/send " + keyword + "|/trigger"); }',
    '}',
    'function renderPage(data) {',
    '  var hpPct = data.hpMax > 0 ? Math.min(100, Math.round(data.hp / data.hpMax * 100)) : 0;',
    '  var mpPct = data.mpMax > 0 ? Math.min(100, Math.round(data.mp / data.mpMax * 100)) : 0;',
    '  var html = \'<div class="title">\u2694 \u89d2\u8272\u72b6\u6001\u680f</div>\';',
    '  html += \'<div class="stat"><div class="stat-label"><span>HP \u751f\u547d\u503c</span><span>\' + data.hp + " / " + data.hpMax + "</span></div><div class=\'bar\'><div class=\'bar-fill-hp\' style=\'width:" + hpPct + "%\'></div></div></div>";',
    '  html += \'<div class="stat"><div class="stat-label"><span>MP \u6cd5\u529b\u503c</span><span>\' + data.mp + " / " + data.mpMax + "</span></div><div class=\'bar\'><div class=\'bar-fill-mp\' style=\'width:" + mpPct + "%\'></div></div></div>";',
    '  html += \'<div class="stat-numbers">\';',
    '  html += \'<div class="num-card"><div class="k">\u653b\u51fb\u529b</div><div class="v">\' + data.atk + "</div></div>";',
    '  html += \'<div class="num-card"><div class="k">\u9632\u5fa1\u529b</div><div class="v">\' + data.def + "</div></div>";',
    '  html += "</div>";',
    '  html += \'<div class="actions">\';',
    '  html += \'<button class="btn" onclick="handleClick(\'\u56de\u590dHP\')">\u2764 \u56de\u590d HP</button>\';',
    '  html += \'<button class="btn" onclick="handleClick(\'\u56de\u590dMP\')">\ud83d\udd35 \u56de\u590d MP</button>\';',
    '  html += \'<button class="btn" onclick="handleClick(\'\u67e5\u770b\u72b6\u6001\')">\ud83d\udd04 \u5237\u65b0</button>\';',
    '  html += "</div>";',
    '  document.getElementById("content").innerHTML = html;',
    '}',
    'function init() {',
    '  try {',
    '    var messageText = getMessageData();',
    '    if (!messageText) { document.getElementById("content").innerHTML = \'<div class="loading">\u274c \u65e0\u6cd5\u83b7\u53d6\u6d88\u606f\u5185\u5bb9</div>\'; return; }',
    '    var data = parseData(messageText);',
    '    renderPage(data);',
    '  } catch (error) {',
    '    console.error("错误:", error);',
    '    document.getElementById("content").innerHTML = \'<div class="loading">\u274c \u52a0\u8f7d\u5931\u8d25\uff1a\' + error.message + "</div>";',
    '  }',
    '}',
    '$(function() { init(); });',
    '<\\/script>',
    '</body>',
    '</html>',
    '</HTML_CODE>',
    '',
    '# ==================== ⚠️ 核心约束：必须以示例为基底修改 ====================',
    '你输出的 HTML 代码**必须以上方对应模式的示例代码为基底**进行修改，不允许从零重写、不允许换函数名、不允许改函数结构。',
    '',
    '## 模式A 必须保留的代码骨架（来自示例A）：',
    '- getMessageData()：原样保留',
    '- extractContent(messageText)：原样保留，仅把正则里的标签名改成你选的标签',
    '- renderPage(text)：可以改样式和段落处理逻辑，但函数签名和调用方式不变',
    '- init()：原样保留',
    '- $(function() { init(); });：原样保留',
    '- <div id="content"> 容器结构保留',
    '- 修改范围仅限：CSS 样式、标签名、段落判断逻辑、HTML 容器 class 名',
    '',
    '## 模式B 必须保留的代码骨架（来自示例B）：',
    '- getMessageData()：原样保留',
    '- parseData(messageText)：保留函数签名，可增删字段解析行（如新增 [速度|x] 解析）',
    '- handleClick(keyword)：原样保留',
    '- renderPage(data)：可以改 UI 布局和样式，但函数签名不变',
    '- init()：原样保留',
    '- $(function() { init(); });：原样保留',
    '- <div class="container" id="content"> 容器结构保留',
    '- 世界书源文件 <WORLDBOOK_SOURCE> 必须包含 <FORMAT_RULE>、Format、触发词 三部分，字段定义和 parseData 解析的字段一一对应',
    '',
    '# ==================== 模式判断规则 ====================',
    '- 需要 AI 输出「字段数据」「属性数值」「项目列表」「可点击按钮」→ 模式B',
    '- 常见 B 模式关键词：状态栏、属性面板、角色信息、任务面板、背包、装备、商店、论坛、排行榜、技能、数据展示',
    '- 只需要排版文字内容、段落、对话 → 模式A',
    '- 拿不准时默认模式B，因为B更通用',
    '',
    '# ==================== 通用技术规范 ====================',
    '- 正则表达式统一写法：<标签名>[\\s\\S]*?</标签名>',
    '- 标签名用英文语义化（story/status/task/inventory/letter/forum 等），不要中文',
    '- 脚本名称统一前缀：[界面]xxx',
    '- 每次都输出完整代码，不要输出部分代码或"只改了xx行"',
    '- HTML 中 <script> 结束标签必须写作 <\\/script>',
    '- 标签名严禁使用：think、thinking、content、system、format_rule'
  ].join('\n');

  // ===== AI 生成参数 =====
  var GEN_PARAMS = {
    temperature: 1, top_p: 0.9, top_k: 500, top_a: 0, min_p: 0,
    repetition_penalty: 1, frequency_penalty: 0, presence_penalty: 0, max_tokens: 64000
  };

  // ===== 调用 AI（6 层降级链）=====
  async function callAI(messages) {
    var errors = [];
    var historyText = messages.map(function(m) {
      return (m.role === 'user' ? '用户' : '助手') + '：' + m.content;
    }).join('\n\n');
    var userPrompt = historyText + '\n\n助手：';

    // 1. generate
    try {
      var generateFn = getApi('generate');
      if (generateFn) {
        var r1 = await generateFn(Object.assign({ user_input: userPrompt, should_silence: true, max_chat_history: 0 }, GEN_PARAMS));
        if (r1 && typeof r1 === 'string' && r1.trim().length > 5) return r1.trim();
        if (r1 && typeof r1 === 'object' && r1.content && String(r1.content).trim().length > 5) return String(r1.content).trim();
        if (r1 && typeof r1 === 'string') errors.push('generate: ' + r1.substring(0, 80));
      }
    } catch (e) { errors.push('generate: ' + e.message); }

    // 2. generateQuietPrompt
    try {
      var gqp = getApi('generateQuietPrompt');
      if (gqp) { var r2 = await gqp(userPrompt, false, false, false, 120000); if (r2 && typeof r2 === 'string' && r2.trim().length > 5) return r2.trim(); }
    } catch (e) { errors.push('generateQuietPrompt: ' + e.message); }

    // 3. parent.generateQuietPrompt
    try { if (window.parent && typeof window.parent.generateQuietPrompt === 'function') { var r3 = await window.parent.generateQuietPrompt(userPrompt, false, false, false, 120000); if (r3 && typeof r3 === 'string' && r3.trim().length > 5) return r3.trim(); } } catch (e) { errors.push('parent.generateQuietPrompt: ' + e.message); }

    // 4. TavernHelper.generate
    try {
      if (typeof window.TavernHelper !== 'undefined' && window.TavernHelper && typeof window.TavernHelper.generate === 'function') {
        var r4 = await window.TavernHelper.generate(Object.assign({ should_silence: true, ordered_prompts: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }] }, GEN_PARAMS));
        if (r4 && typeof r4 === 'string' && r4.trim().length > 5) return r4.trim();
      }
    } catch (e) { errors.push('TavernHelper.generate: ' + e.message); }

    // 5. generateRaw
    try {
      var generateRawFn = getApi('generateRaw');
      if (generateRawFn) {
        var r5;
        if (generateRawFn.length <= 1) { r5 = await generateRawFn(SYSTEM_PROMPT + '\n\n' + userPrompt); }
        else { r5 = await generateRawFn(Object.assign({ should_silence: true, ordered_prompts: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }] }, GEN_PARAMS)); }
        if (r5 && typeof r5 === 'string' && r5.trim().length > 5) return r5.trim();
        if (r5 && typeof r5 === 'object' && r5.message) return r5.message;
      }
    } catch (e) { errors.push('generateRaw: ' + e.message); }

    // 6. triggerSlash /generate
    try {
      var triggerSlashFn = getApi('triggerSlash');
      if (triggerSlashFn) { var r6 = await triggerSlashFn('/generate lock=on ' + SYSTEM_PROMPT + '\n\n' + userPrompt); if (r6 && typeof r6 === 'string' && r6.trim().length > 5) return r6.trim(); }
    } catch (e) { errors.push('triggerSlash: ' + e.message); }

    throw new Error('AI 调用失败：' + errors.join('; '));
  }

  // ===== 解析 AI 回复 =====
  function parseAIResponse(text) {
    var result = { explanation: '', mode: '', regexConfig: '', htmlCode: '', worldbookSource: '', scriptName: '', findRegex: '', tavernRegexObj: null };

    var regexMatch = text.match(/<REGEX_CONFIG>([\s\S]*?)<\/REGEX_CONFIG>/);
    if (regexMatch) {
      result.regexConfig = regexMatch[1].trim();
      var nameMatch = result.regexConfig.match(/脚本名称\s*[:：]\s*(.+)/);
      var findMatch = result.regexConfig.match(/查找正则\s*[:：]\s*(.+)/);
      if (nameMatch) result.scriptName = nameMatch[1].trim();
      if (findMatch) result.findRegex = findMatch[1].trim();
    }

    var htmlMatch = text.match(/<HTML_CODE>([\s\S]*?)<\/HTML_CODE>/);
    if (htmlMatch) result.htmlCode = htmlMatch[1].trim();

    var wbMatch = text.match(/<WORLDBOOK_SOURCE>([\s\S]*?)<\/WORLDBOOK_SOURCE>/);
    if (wbMatch) result.worldbookSource = wbMatch[1].trim();

    if (regexMatch) {
      result.explanation = text.substring(0, regexMatch.index).trim();
    } else {
      result.explanation = text.trim();
    }

    // 识别模式
    var modeMatch = result.explanation.match(/\[模式([AB])\]/i);
    if (modeMatch) {
      result.mode = modeMatch[1].toUpperCase();
      result.explanation = result.explanation.replace(/\[模式[AB]\]/i, '').trim();
    } else if (result.worldbookSource) {
      result.mode = 'B';
    } else {
      result.mode = 'A';
    }

    // 构造酒馆正则对象
    if (result.findRegex && result.htmlCode) {
      result.tavernRegexObj = {
        id: 'regex-gen-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
        script_name: result.scriptName || '[界面]自定义',
        enabled: true,
        find_regex: result.findRegex,
        replace_string: '```\n' + result.htmlCode + '\n```',
        trim_strings: [],
        source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
        destination: { display: true, prompt: false },
        run_on_edit: true,
        min_depth: null,
        max_depth: null,
        substituteRegex: 0
      };
    }

    return result;
  }

  // ===== 工具函数 =====
  function copyToClipboard(win, text, callback) {
    if (win.navigator.clipboard && win.navigator.clipboard.writeText) {
      win.navigator.clipboard.writeText(text).then(function() { callback && callback(true); }).catch(function() { fallbackCopy(); });
    } else { fallbackCopy(); }
    function fallbackCopy() {
      var ta = win.document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      win.document.body.appendChild(ta); ta.select();
      try { win.document.execCommand('copy'); callback && callback(true); } catch (e) { callback && callback(false); }
      win.document.body.removeChild(ta);
    }
  }

  function createToast(win, message, type) {
    type = type || 'info';
    var container = win.document.querySelector('.toast-container');
    if (!container) { container = win.document.createElement('div'); container.className = 'toast-container'; win.document.body.appendChild(container); }
    var toast = win.document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() { toast.style.opacity = '0'; toast.style.transform = 'translateY(-100%)'; toast.style.transition = 'all .25s ease'; setTimeout(function() { if (toast.parentNode) toast.remove(); }, 250); }, 2500);
  }

  // ===== iframe 创建/销毁 =====
  var iframeEl = null;

  function createModalIframe() {
    return new Promise(function (resolve, reject) {
      try {
        var pWin = getParentWindow();
        if (!pWin) return reject(new Error('无法获取父窗口'));
        var pDoc = pWin.document;
        if (!pDoc) return reject(new Error('父窗口没有 document'));
        if (!pDoc.body) return reject(new Error('document.body 尚未创建'));

        closeIframe();

        var fr = pDoc.createElement('iframe');
        fr.id = SCRIPT_ID + '_iframe';
        fr.setAttribute('script_id', SCRIPT_ID);
        fr.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;border:none;z-index:100000;background:#f0f2f5;';

        fr.addEventListener('load', function () {
          try {
            var d = fr.contentDocument || fr.contentWindow.document;
            if (!d) { reject(new Error('无法获取 iframe contentDocument')); return; }

            try {
              var vp = d.createElement('meta');
              vp.name = 'viewport'; vp.content = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
              d.head.appendChild(vp);
              var charset = d.createElement('meta'); charset.setAttribute('charset', 'UTF-8'); d.head.appendChild(charset);
            } catch (_) {}

            var s = d.createElement('style'); s.textContent = IFRAME_CSS; d.head.appendChild(s);
            d.body.innerHTML = getIframeBodyHTML();

            function escFn(e) { if (e.key === 'Escape') closeIframe(); }
            pDoc.addEventListener('keydown', escFn);
            fr._escFn = escFn;

            resolve(d);
          } catch (e) { console.error('[正则代码生成器] ❌ iframe load 异常：', e); reject(e); }
        });

        pDoc.body.appendChild(fr);
        iframeEl = fr;

        setTimeout(function () { try { if (!fr.contentDocument || !fr.contentDocument.body) reject(new Error('iframe load 超时')); } catch (e) { reject(e); } }, 5000);
      } catch (e) { reject(e); }
    });
  }

  function closeIframe() {
    try {
      var pWin = getParentWindow();
      var pDoc = pWin ? pWin.document : null;
      if (iframeEl) {
        if (iframeEl._escFn && pDoc) { try { pDoc.removeEventListener('keydown', iframeEl._escFn); } catch (_) {} }
        if (iframeEl.parentNode) { try { iframeEl.parentNode.removeChild(iframeEl); } catch (_) {} }
      }
    } catch (_) {}
    iframeEl = null;
  }

  // ===== iframe HTML 结构 =====
  function getIframeBodyHTML() {
    return '' +
      '<div class="app">' +
        '<div class="chat-header">' +
          '<h1>✨ <span>正则代码生成器</span><span class="subtitle">AI 生成 · 实时预览</span></h1>' +
          '<div class="header-actions">' +
            '<span class="mode-badge none" id="modeBadge">未生成</span>' +
            '<button class="icon-btn" id="btnHelp" title="使用说明">❓</button>' +
            '<button class="icon-btn" id="btnClose" title="关闭">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="mobile-tabs">' +
          '<button class="mobile-tab active" data-tab="chat">💬 聊天</button>' +
          '<button class="mobile-tab" data-tab="code">📝 代码</button>' +
          '<button class="mobile-tab" data-tab="preview">👁 预览</button>' +
        '</div>' +
        '<div class="main" id="mainArea">' +
          // 左：聊天面板
          '<div class="chat-panel">' +
            '<div class="chat-messages" id="chatMessages"></div>' +
            '<div class="chat-input-area">' +
              '<div class="chat-input-row">' +
                '<textarea class="chat-input" id="chatInput" rows="1" placeholder="描述你想要的效果...（Ctrl+Enter 发送）"></textarea>' +
                '<button class="chat-send" id="btnSend">发送</button>' +
              '</div>' +
              '<div class="chat-input-foot"><span class="chat-input-hint" id="chatInputHint"><span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> 发送</span></div>' +
            '</div>' +
          '</div>' +
          // 右：代码+预览
          '<div class="right-panel">' +
            // 代码区
            '<div class="code-section-wrap">' +
              '<div class="code-tabs">' +
                '<button class="code-tab active" data-code-tab="regex">📝 正则配置</button>' +
                '<button class="code-tab" data-code-tab="html">🌐 HTML 代码</button>' +
                '<button class="code-tab" data-code-tab="worldbook" id="tabWorldbook" disabled>📚 世界书源文件</button>' +
              '</div>' +
              '<div class="code-actions-bar">' +
                '<span class="code-title" id="codeTitle">正则配置</span>' +
                '<button class="btn btn-sm" id="btnCopyCode">📋 复制</button>' +
                '<button class="btn btn-sm btn-primary" id="btnImport">➕ 导入酒馆</button>' +
              '</div>' +
              '<div class="code-body">' +
                '<div class="code-content" id="codeContent"></div>' +
                '<div class="code-empty" id="codeEmpty">和 AI 对话生成代码后<br>这里会显示正则配置和 HTML 代码</div>' +
              '</div>' +
            '</div>' +
            // 预览区
            '<div class="preview-section-wrap">' +
              '<div class="preview-header">' +
                '<span class="pv-title">👁 实时预览</span>' +
                '<button class="btn btn-sm" id="btnRefreshPreview">🔄 刷新</button>' +
              '</div>' +
              '<div class="preview-input-row">' +
                '<textarea class="preview-input" id="previewInput" rows="2" placeholder="输入测试内容（模拟 AI 输出的标签内容），如：&#10;<story>这是正文内容</story>"></textarea>' +
                '<button class="btn btn-sm btn-success" id="btnRenderPreview">渲染</button>' +
              '</div>' +
              '<div class="preview-frame-wrap">' +
                '<iframe class="preview-frame" id="previewFrame" sandbox="allow-scripts"></iframe>' +
                '<div class="preview-empty" id="previewEmpty">生成 HTML 代码后<br>点击「渲染」查看效果</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ===== 打开生成器 =====
  async function openGenerator() {
    console.log('[正则代码生成器] 🚀 正在打开生成器...');
    var doc = await createModalIframe();
    console.log('[正则代码生成器] ⑤ 拿到 iframe document，开始绑定事件...');

    var win = iframeEl ? iframeEl.contentWindow : window;
    var root = getParentWindow();

    var messages = [];
    var isGenerating = false;
    var currentParsed = null; // 当前 AI 生成的解析结果
    var activeCodeTab = 'regex'; // 当前代码标签页

    var chatMessagesEl = doc.getElementById('chatMessages');
    var chatInput = doc.getElementById('chatInput');
    var btnSend = doc.getElementById('btnSend');
    var btnClose = doc.getElementById('btnClose');
    var btnHelp = doc.getElementById('btnHelp');
    var modeBadge = doc.getElementById('modeBadge');
    var mainArea = doc.getElementById('mainArea');
    var codeContent = doc.getElementById('codeContent');
    var codeEmpty = doc.getElementById('codeEmpty');
    var codeTitle = doc.getElementById('codeTitle');
    var tabWorldbook = doc.getElementById('tabWorldbook');
    var btnCopyCode = doc.getElementById('btnCopyCode');
    var btnImport = doc.getElementById('btnImport');
    var previewFrame = doc.getElementById('previewFrame');
    var previewEmpty = doc.getElementById('previewEmpty');
    var previewInput = doc.getElementById('previewInput');
    var btnRenderPreview = doc.getElementById('btnRenderPreview');
    var btnRefreshPreview = doc.getElementById('btnRefreshPreview');

    function scrollToBottom() {
      try { win.requestAnimationFrame(function () { chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight; }); } catch (_) { chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight; }
    }

    function addUserMessage(text) {
      var msg = doc.createElement('div');
      msg.className = 'message user';
      var bubble = doc.createElement('div');
      bubble.className = 'message-bubble user-bubble';
      var txt = doc.createElement('div');
      txt.className = 'msg-text';
      txt.textContent = text;
      bubble.appendChild(txt);
      msg.appendChild(bubble);
      chatMessagesEl.appendChild(msg);
      scrollToBottom();
    }

    function addAssistantMessage(text) {
      var msg = doc.createElement('div');
      msg.className = 'message assistant';
      var bubble = doc.createElement('div');
      bubble.className = 'message-bubble assistant-bubble';
      var txt = doc.createElement('div');
      txt.className = 'msg-text';
      txt.textContent = text;
      bubble.appendChild(txt);
      msg.appendChild(bubble);
      chatMessagesEl.appendChild(msg);
      scrollToBottom();
    }

    function addTypingIndicator() {
      removeTypingIndicator();
      var msg = doc.createElement('div');
      msg.className = 'message assistant';
      msg.id = 'typingIndicator';
      var bubble = doc.createElement('div');
      bubble.className = 'message-bubble assistant-bubble';
      var ti = doc.createElement('div');
      ti.className = 'typing-indicator';
      ti.innerHTML = '<span></span><span></span><span></span><span class="typing-text">思考中...</span>';
      bubble.appendChild(ti);
      msg.appendChild(bubble);
      chatMessagesEl.appendChild(msg);
      scrollToBottom();
    }

    function removeTypingIndicator() {
      var ti = doc.getElementById('typingIndicator');
      if (ti) ti.remove();
    }

    // ===== 更新代码区显示 =====
    function updateCodeDisplay() {
      if (!currentParsed) {
        codeContent.style.display = 'none';
        codeEmpty.style.display = 'flex';
        codeTitle.textContent = '正则配置';
        tabWorldbook.disabled = true;
        modeBadge.className = 'mode-badge none';
        modeBadge.textContent = '未生成';
        return;
      }

      codeContent.style.display = 'block';
      codeEmpty.style.display = 'none';

      // 模式标识
      modeBadge.className = 'mode-badge ' + currentParsed.mode.toLowerCase();
      modeBadge.textContent = currentParsed.mode === 'A' ? '模式A 正文美化' : '模式B 结构化数据';

      // 世界书标签页
      if (currentParsed.worldbookSource) {
        tabWorldbook.disabled = false;
      } else {
        tabWorldbook.disabled = true;
        if (activeCodeTab === 'worldbook') activeCodeTab = 'regex';
      }

      // 显示当前标签页内容
      var content = '';
      var title = '';
      if (activeCodeTab === 'regex') {
        content = currentParsed.regexConfig || '(无正则配置)';
        title = '正则配置';
      } else if (activeCodeTab === 'html') {
        content = currentParsed.htmlCode || '(无 HTML 代码)';
        title = '前端 HTML 代码';
      } else if (activeCodeTab === 'worldbook') {
        content = currentParsed.worldbookSource || '(无世界书源文件)';
        title = '世界书源文件（写入世界书规范 AI 输出）';
      }
      codeContent.textContent = content;
      codeTitle.textContent = title;

      // 更新标签页激活状态
      var tabs = doc.querySelectorAll('.code-tab');
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        if (t.getAttribute('data-code-tab') === activeCodeTab) t.classList.add('active');
        else t.classList.remove('active');
      }
    }

    // ===== 渲染预览 =====
    function renderPreview() {
      if (!currentParsed || !currentParsed.htmlCode) {
        previewFrame.style.display = 'none';
        previewEmpty.style.display = 'flex';
        previewEmpty.innerHTML = '生成 HTML 代码后<br>点击「渲染」查看效果';
        return;
      }

      var testInput = previewInput.value.trim();
      if (!testInput) {
        // 自动从正则提取标签名生成示例
        var tagMatch = (currentParsed.findRegex || '').match(/<([a-zA-Z_][a-zA-Z0-9_-]*)>/);
        if (tagMatch) {
          var tagName = tagMatch[1];
          if (currentParsed.mode === 'A') {
            testInput = '<' + tagName + '>\n这是第一段正文内容。\n\n这是第二段正文内容，用于演示排版效果。\n</' + tagName + '>';
          } else {
            testInput = '<' + tagName + '>\n生命值: 100\n法力值: 50\n攻击力: 30\n防御力: 20\n</' + tagName + '>';
          }
          previewInput.value = testInput;
        } else {
          testInput = '<story>测试正文内容</story>';
        }
      }

      var htmlCode = currentParsed.htmlCode;

      // 注入 mock 酒馆 API，让 HTML 代码在预览环境正常运行
      var mockScript = [
        '<script>',
        'window.getCurrentMessageId = function() { return 0; };',
        'window.getChatMessages = function(id) {',
        '  return [{ message: ' + JSON.stringify(testInput) + ' }];',
        '};',
        'window.triggerSlash = function(cmd) { console.log("[预览] triggerSlash:", cmd); };',
        'window.$ = function(fn) { if (typeof fn === "function") fn(); };',
        'window.jQuery = window.$;',
        '<\\/script>'
      ].join('\n');

      // 把 mock 注入到 <head> 后、原脚本前
      var fullHtml;
      if (htmlCode.indexOf('</head>') !== -1) {
        fullHtml = htmlCode.replace('</head>', mockScript + '\n</head>');
      } else if (htmlCode.indexOf('<body') !== -1) {
        fullHtml = htmlCode.replace('<body', mockScript + '\n<body');
      } else {
        fullHtml = mockScript + '\n' + htmlCode;
      }

      previewFrame.style.display = 'block';
      previewEmpty.style.display = 'none';

      // 用 srcdoc 写入（sandbox="allow-scripts" 保证安全）
      previewFrame.srcdoc = fullHtml;
    }

    // ===== 发送消息 =====
    async function sendMessage() {
      var text = chatInput.value.trim();
      if (!text || isGenerating) return;

      isGenerating = true;
      btnSend.disabled = true;
      btnSend.textContent = '生成中...';
      chatInput.value = '';
      chatInput.style.height = 'auto';

      addUserMessage(text);
      messages.push({ role: 'user', content: text });

      addTypingIndicator();

      try {
        var response = await callAI(messages);
        removeTypingIndicator();
        messages.push({ role: 'assistant', content: response });

        var parsed = parseAIResponse(response);
        if (parsed.tavernRegexObj || parsed.regexConfig || parsed.htmlCode) {
          currentParsed = parsed;
          addAssistantMessage(parsed.explanation || '已生成代码：');
          updateCodeDisplay();
          renderPreview();
        } else {
          addAssistantMessage(response);
        }
      } catch (e) {
        removeTypingIndicator();
        addAssistantMessage('❌ 生成失败：' + (e.message || String(e)) + '\n\n请检查酒馆是否配置了 AI API。');
      } finally {
        isGenerating = false;
        btnSend.disabled = false;
        btnSend.textContent = '发送';
        chatInput.focus();
      }
    }

    // ===== 事件绑定 =====
    btnSend.addEventListener('click', sendMessage);

    // 动态平台提示
    try {
      var _ua = typeof navigator !== 'undefined' ? (navigator.platform || navigator.userAgent || '') : '';
      var _isMac = /Mac|iPhone|iPad|iPod/i.test(_ua);
      var _mod = _isMac ? '⌘' : 'Ctrl';
      var _hintEl = doc.getElementById('chatInputHint');
      if (_hintEl) _hintEl.innerHTML = '<span class="kbd">' + _mod + '</span>+<span class="kbd">Enter</span> 发送';
    } catch (_) {}

    chatInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.isComposing) return;
      var sendModifier = e.ctrlKey || e.metaKey;
      if (sendModifier) { e.preventDefault(); sendMessage(); }
    });

    chatInput.addEventListener('input', function () {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
    });

    btnClose.addEventListener('click', closeIframe);

    btnHelp.addEventListener('click', function () {
      alert('【正则代码生成器使用说明】\n\n💬 聊天\n  · 描述需求，AI 自动生成正则配置 + HTML 代码\n  · 模式A：正文美化（小说/对话/信件）\n  · 模式B：结构化数据（状态栏/论坛/面板）\n\n📝 代码区（右上标签页切换）\n  · 正则配置：酒馆正则脚本设置\n  · HTML 代码：前端界面\n  · 世界书源文件（模式B）：规范 AI 输出格式\n\n👁 预览区（右下）\n  · 输入测试内容（模拟 AI 输出的标签）\n  · 点击「渲染」查看实际效果\n\n📌 操作\n  · Ctrl+Enter 发送 · Enter 换行\n  · 点「导入酒馆」一键导入正则\n  · 点「复制」复制当前代码');
    });

    // 代码标签页切换
    var codeTabs = doc.querySelectorAll('.code-tab');
    for (var i = 0; i < codeTabs.length; i++) {
      codeTabs[i].addEventListener('click', function () {
        if (this.disabled) return;
        activeCodeTab = this.getAttribute('data-code-tab');
        updateCodeDisplay();
      });
    }

    // 复制代码
    btnCopyCode.addEventListener('click', function () {
      if (!currentParsed) { createToast(win, '请先生成代码', 'info'); return; }
      var content = '';
      if (activeCodeTab === 'regex') content = currentParsed.regexConfig;
      else if (activeCodeTab === 'html') content = currentParsed.htmlCode;
      else if (activeCodeTab === 'worldbook') content = currentParsed.worldbookSource;
      if (!content) { createToast(win, '当前无内容', 'info'); return; }
      copyToClipboard(win, content, function (ok) {
        createToast(win, ok ? '✅ 已复制' : '❌ 复制失败', ok ? 'success' : 'error');
      });
    });

    // 导入酒馆正则
    btnImport.addEventListener('click', async function () {
      if (!currentParsed || !currentParsed.tavernRegexObj) { createToast(win, '请先生成代码', 'info'); return; }
      var obj = currentParsed.tavernRegexObj;
      var forbidden = ['think', 'thinking', 'content'];
      var tagCheck = obj.find_regex.match(/<([a-zA-Z_][a-zA-Z0-9_-]*)>/);
      if (tagCheck && forbidden.indexOf(tagCheck[1].toLowerCase()) !== -1) {
        createToast(win, '❌ 标签名 ' + tagCheck[1] + ' 被禁止', 'error'); return;
      }
      try {
        createToast(win, '⏳ 正在导入...', 'info');
        if (typeof root.updateTavernRegexesWith === 'function') {
          await root.updateTavernRegexesWith(function (regexes) {
            var existingIdx = -1;
            regexes.forEach(function (r, i) { if (r.script_name === obj.script_name) existingIdx = i; });
            if (existingIdx >= 0) regexes[existingIdx] = obj; else regexes.push(obj);
            return regexes;
          }, { type: 'global' });
          createToast(win, '✅ 正则「' + obj.script_name + '」已导入！', 'success');
        } else {
          copyToClipboard(win, (currentParsed.regexConfig || '') + '\n\n' + (currentParsed.htmlCode || ''), function (ok) {
            createToast(win, ok ? '⚠️ 已复制代码，请手动导入' : '⚠️ 请手动复制', 'info');
          });
        }
      } catch (err) {
        createToast(win, '❌ 导入失败：' + (err.message || String(err)), 'error');
      }
    });

    // 预览渲染
    btnRenderPreview.addEventListener('click', renderPreview);
    btnRefreshPreview.addEventListener('click', renderPreview);

    // 移动端 tab 切换
    var mobileTabs = doc.querySelectorAll('.mobile-tab');
    for (var j = 0; j < mobileTabs.length; j++) {
      mobileTabs[j].addEventListener('click', function () {
        var tab = this.getAttribute('data-tab');
        mainArea.className = 'main' + (tab === 'code' ? ' tab-code' : tab === 'preview' ? ' tab-preview' : '');
        for (var k = 0; k < mobileTabs.length; k++) {
          mobileTabs[k].classList.toggle('active', mobileTabs[k].getAttribute('data-tab') === tab);
        }
      });
    }

    // 欢迎消息
    addAssistantMessage('你好！我是正则代码生成助手。\n\n描述你想要的效果，我会生成：\n· 模式A：正文美化（小说排版/对话气泡/信件）\n· 模式B：结构化数据（状态栏/论坛/面板）\n\n生成后可在右侧查看代码和实时预览。\n\n例如：\n· "做一个小说正文美化，带段落缩进"\n· "做一个角色状态栏，显示HP/MP"');

    chatInput.focus();
    updateCodeDisplay();
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
      if ($) { $('#' + SCRIPT_ID + '_iframe, [id^="' + SCRIPT_ID + '_"]', pDoc).remove(); }
    } catch (_) {}
  }

  // ===== 脚本按钮 =====
  var OFFICIAL_BUTTON_NAME = '正则代码生成器';

  function ensureScriptButtons() {
    var replaceButtons = getApi('replaceScriptButtons');
    var appendButtons = getApi('appendInexistentScriptButtons');
    try {
      var buttons = [{ name: OFFICIAL_BUTTON_NAME, visible: true }];
      if (replaceButtons) { replaceButtons(buttons); return true; }
      else if (appendButtons) { appendButtons(buttons); return true; }
      return false;
    } catch (e) { return false; }
  }

  function bindScriptButtonEvents() {
    var evtOn = getApi('eventOn');
    var getBtnEvt = getApi('getButtonEvent');
    if (!evtOn || !getBtnEvt) return false;
    var bound = 0;
    function tryBind(name) {
      try { evtOn(getBtnEvt(name), function () { openGeneratorWithError(); }); bound++; } catch (e) {}
    }
    tryBind(OFFICIAL_BUTTON_NAME);
    tryBind('打开正则生成器');
    tryBind('正则生成器');
    tryBind('✨ 打开生成器');
    return bound > 0;
  }

  function openGeneratorWithError() {
    try {
      openGenerator().catch(function (e) {
        var msg = (e && e.message) ? e.message : String(e);
        console.error('[正则代码生成器] ❌ 打开失败：', e);
        try { alert('❌ 正则代码生成器打开失败\n\n错误信息：' + msg + '\n\n（详细错误请按 F12 查看 Console）'); } catch (_) {}
      });
    } catch (e) {
      var msg = (e && e.message) ? e.message : String(e);
      console.error('[正则代码生成器] ❌ 打开失败：', e);
      try { alert('❌ 正则代码生成器打开失败\n\n错误信息：' + msg); } catch (_) {}
    }
  }

  // ===== 浮动按钮 =====
  var floatRetryCount = 0;
  function addFloatingButton() {
    try {
      var pWin = getParentWindow();
      var pDoc = pWin.document;
      if (!pDoc || !pDoc.body) {
        if (floatRetryCount < 20) { floatRetryCount++; setTimeout(addFloatingButton, 300); }
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
      btn.style.cssText = isMobileBtn
        ? 'position:fixed;bottom:72px;right:12px;z-index:99998;padding:9px 15px;background:linear-gradient(135deg,#4f46e5,#4338ca);color:#fff;border:none;border-radius:20px;cursor:pointer;font-weight:600;box-shadow:0 4px 16px rgba(79,70,229,.4);transition:transform .2s;font-size:12px;-webkit-tap-highlight-color:transparent;'
        : 'position:fixed;bottom:80px;right:24px;z-index:99998;padding:11px 20px;background:linear-gradient(135deg,#4f46e5,#4338ca);color:#fff;border:none;border-radius:25px;cursor:pointer;font-weight:600;box-shadow:0 6px 24px rgba(79,70,229,.35);transition:transform .2s;font-size:14px;';
      btn.onmouseover = function () { try { btn.style.transform = 'scale(1.05)'; } catch (_) {} };
      btn.onmouseout = function () { try { btn.style.transform = 'scale(1)'; } catch (_) {} };
      btn.onclick = function () { openGeneratorWithError(); };
      pDoc.body.appendChild(btn);
      return true;
    } catch (e) {
      if (floatRetryCount < 20) { floatRetryCount++; setTimeout(addFloatingButton, 300); }
      return false;
    }
  }

  // ===== 主初始化 =====
  var initialized = false;
  function mainInit() {
    if (initialized) return;
    initialized = true;
    console.log('[正则代码生成器] 🚀 初始化（版本：聊天+代码+预览）');

    try { window.addEventListener('pagehide', cleanupScriptArtifacts); } catch (_) {}
    try { var pWin = getParentWindow(); if (pWin !== window) pWin.addEventListener('pagehide', cleanupScriptArtifacts); } catch (_) {}

    var buttonsCreated = false, buttonsBound = false;
    try { buttonsCreated = ensureScriptButtons(); } catch (_) {}
    try { buttonsBound = bindScriptButtonEvents(); } catch (_) {}

    addFloatingButton();

    setTimeout(function () {
      if (!buttonsCreated) try { ensureScriptButtons(); } catch (_) {}
      if (!buttonsBound) try { bindScriptButtonEvents(); } catch (_) {}
    }, 1500);

    setTimeout(function () {
      try {
        var pDoc = getParentWindow().document;
        if (pDoc && !pDoc.getElementById(SCRIPT_ID + '-btn')) addFloatingButton();
      } catch (_) {}
    }, 10000);
  }

  var started = false;
  function startOnce() {
    if (started) return;
    started = true;
    try { mainInit(); } catch (e) { console.error('[正则代码生成器] ❌ 主流程异常：', e); try { addFloatingButton(); } catch (_) {} }
  }

  function boot() {
    var $ = getJQuery();
    if ($) { $(function () { startOnce(); }); }
    else { setTimeout(startOnce, 500); }
    setTimeout(startOnce, 3000);
  }

  boot();

})();
