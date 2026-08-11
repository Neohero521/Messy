(function() {
/* ============================================================================
 * 正则代码生成器 · Tavern Helper 脚本
 * ----------------------------------------------------------------------------
 * 项目类型：后台脚本（Tavern Helper Script）
 * 运行形式：单文件 JS，导入到酒馆脚本库，点击脚本按钮打开聊天界面
 * 技术栈：原生 JS + 自建 iframe UI（无需构建工具，便于酒馆用户使用）
 *
 * 功能：
 *   - 聊天式交互：用户描述需求，AI 自动生成正则代码
 *   - AI 自动判断模式（正文美化 / 结构化数据）
 *   - 随对话逐步完善代码
 *   - 每条 AI 回复附带「复制」「导入酒馆正则」按钮
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
        if (typeof window[name] !== 'undefined') continue;
        var fn = getApi(name);
        if (fn !== null) {
          try { window[name] = fn; } catch (_) {}
        }
      } catch (_) {}
    }
    try {
      if (!window.toastr) {
        var t = getApi('toastr');
        if (t) window.toastr = t;
      }
    } catch (_) {}
  })();

  // ===== 聊天界面样式表 =====
  var IFRAME_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;width:100%;margin:0;padding:0;overflow:hidden}
:root{
  --bg:#f0f2f5;
  --surface:#ffffff;
  --surface-soft:#f8f9fa;
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
.chat-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0;box-shadow:var(--shadow-soft)}
.chat-header h1{font-size:15px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px}
.chat-header .subtitle{font-size:11px;color:var(--muted);font-weight:400;margin-left:6px}
.header-actions{display:flex;gap:4px;align-items:center}

/* 消息列表 */
.chat-messages{flex:1 1 0;overflow-y:auto;overflow-x:hidden;padding:16px;min-height:0;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch}
.chat-messages::-webkit-scrollbar{width:6px}
.chat-messages::-webkit-scrollbar-track{background:transparent}
.chat-messages::-webkit-scrollbar-thumb{background:rgba(148,163,184,.3);border-radius:3px}

/* 单条消息 */
.message{display:flex;max-width:100%;min-width:0}
.message.user{justify-content:flex-end}
.message.assistant{justify-content:flex-start}

/* 气泡 */
.message-bubble{max-width:85%;padding:10px 14px;border-radius:var(--radius);box-shadow:var(--shadow-bubble);word-wrap:break-word;word-break:break-word;min-width:0}
.user-bubble{background:var(--user-bubble);color:var(--user-bubble-text);border-bottom-right-radius:4px}
.assistant-bubble{background:var(--ai-bubble);color:var(--ai-bubble-text);border-bottom-left-radius:4px;border:1px solid var(--line-soft)}

/* 消息文本 */
.msg-text{font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word}

/* 代码区块（可折叠，借鉴时之写卡器 cp-section）*/
.code-section{margin-top:10px;border-top:1px solid var(--line-soft);padding-top:10px}
.cp-section{margin-top:8px;border:1px solid var(--line-soft);border-radius:var(--radius-sm);overflow:hidden;background:var(--surface-soft)}
.cp-section-header{display:flex;align-items:center;gap:6px;padding:8px 12px;cursor:pointer;user-select:none;transition:background .15s}
.cp-section-header:hover{background:var(--surface-sink,#eef0f3)}
.cp-section-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:var(--accent-soft);color:var(--accent-deep);border-radius:4px;font-size:11px;font-weight:700;flex-shrink:0}
.cp-section-label{font-size:12px;font-weight:600;color:var(--ink-soft);flex-shrink:0}
.cp-section-preview{font-size:11px;color:var(--muted);flex:1 1 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:4px}
.cp-section-toggle{font-size:11px;color:var(--accent);flex-shrink:0;margin-left:auto}
.cp-section-body{padding:0}
.code-label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.code-block{background:var(--code-bg);color:var(--code-text);border-radius:0;padding:12px;overflow:auto;font-family:var(--font-mono);font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-all;max-height:300px}
.code-block::-webkit-scrollbar{width:6px;height:6px}
.code-block::-webkit-scrollbar-thumb{background:rgba(148,163,184,.3);border-radius:3px}

/* 代码操作按钮 */
.code-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}

/* 通用按钮 */
.btn{display:inline-flex;align-items:center;gap:4px;padding:7px 14px;border-radius:var(--radius-sm);font-size:12px;font-weight:500;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink-soft);transition:all .15s;font-family:var(--font)}
.btn:hover{background:var(--surface-soft);color:var(--ink)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-deep);border-color:var(--accent-deep);color:#fff}
.btn-sm{padding:5px 10px;font-size:11px}
.icon-btn{width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;border-radius:8px;cursor:pointer;color:var(--muted);transition:all .15s;font-size:16px}
.icon-btn:hover{background:var(--surface-soft);color:var(--ink)}

/* 输入区 */
.chat-input-area{display:flex;flex-direction:column;gap:6px;padding:12px 16px;background:var(--surface);border-top:1px solid var(--line);flex-shrink:0}
.chat-input-row{display:flex;gap:8px;align-items:flex-end}
.chat-input{flex:1 1 0;min-width:0;padding:10px 14px;border:1px solid var(--line);border-radius:var(--radius);font-family:var(--font);font-size:14px;color:var(--ink);background:var(--surface-soft);outline:none;resize:none;line-height:1.5;min-height:44px;max-height:120px;transition:border-color .15s,box-shadow .15s}
.chat-input:hover:not(:disabled){border-color:var(--accent-border);background:var(--surface)}
.chat-input:focus{border-color:var(--accent);background:var(--surface);box-shadow:0 0 0 3px var(--accent-soft)}
.chat-input::placeholder{color:var(--muted)}
.chat-send{padding:10px 20px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius);font-size:14px;font-weight:600;cursor:pointer;transition:all .15s;font-family:var(--font);flex-shrink:0;min-width:64px;height:44px}
.chat-send:hover:not(:disabled){background:var(--accent-deep);transform:translateY(-1px);box-shadow:0 4px 12px rgba(79,70,229,.25)}
.chat-send:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
.chat-input-foot{display:flex;justify-content:flex-end;align-items:center;padding:0 2px}
.chat-input-hint{font-size:11px;color:var(--muted)}
.kbd{display:inline-block;padding:1px 5px;background:var(--surface-soft);border:1px solid var(--line);border-radius:4px;font-size:10px;font-family:var(--font-mono);color:var(--ink-soft)}

/* 打字指示器 */
.typing-indicator{display:flex;gap:4px;padding:4px 0}
.typing-indicator span{width:8px;height:8px;background:var(--muted);border-radius:50%;animation:typingBounce 1.4s infinite ease-in-out}
.typing-indicator span:nth-child(1){animation-delay:-.32s}
.typing-indicator span:nth-child(2){animation-delay:-.16s}
@keyframes typingBounce{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}

/* Toast */
.toast-container{position:fixed;top:12px;left:12px;right:12px;z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.toast{padding:10px 18px;border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(15,23,42,.15);animation:slideIn .25s ease;pointer-events:auto}
.toast-success{background:var(--sage);color:#fff}
.toast-error{background:var(--terra);color:#fff}
.toast-info{background:var(--accent);color:#fff}
@keyframes slideIn{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}

/* ===== 响应式：手机端（<=768px） ===== */
@media (max-width: 768px) {
  .chat-header{padding:10px 12px}
  .chat-header h1{font-size:14px}
  .chat-header .subtitle{display:none}
  .chat-messages{padding:12px;gap:10px}
  .message-bubble{max-width:90%;padding:9px 12px;font-size:13px}
  .msg-text{font-size:13px;line-height:1.55}
  .code-block{font-size:10px;padding:10px;max-height:240px}
  .chat-input-area{padding:10px 12px;gap:6px}
  .chat-input{padding:9px 12px;font-size:14px}
  .chat-send{padding:9px 16px;font-size:13px;min-width:56px}
  .btn-sm{padding:6px 12px;font-size:11px}
  .icon-btn{width:36px;height:36px}
}

/* ===== 响应式：小手机端（<=380px） ===== */
@media (max-width: 380px) {
  .message-bubble{max-width:94%}
  .code-block{font-size:9px;padding:8px}
  .chat-send{padding:9px 12px;min-width:48px}
}
`;

  // ===== AI 系统提示词 =====
  var SYSTEM_PROMPT = [
    '你是 SillyTavern（酒馆助手）的正则代码生成助手。用户用自然语言描述想要的效果，你生成对应的酒馆正则配置和前端 HTML 代码。',
    '',
    '【输出格式】',
    '每次回复严格按以下格式输出三部分：',
    '',
    '1. 先用中文简要说明你的理解和方案（1-3句话）',
    '',
    '2. 输出正则配置（用 <REGEX_CONFIG> 标签包裹）：',
    '<REGEX_CONFIG>',
    '脚本名称: [界面]xxx',
    '查找正则: <标签名>[\\s\\S]*?</标签名>',
    '</REGEX_CONFIG>',
    '',
    '3. 输出前端 HTML 代码（用 <HTML_CODE> 标签包裹）：',
    '<HTML_CODE>',
    '<!DOCTYPE html> ... 完整 HTML 文档 ...',
    '</HTML_CODE>',
    '',
    '【规则】',
    '- 标签名严禁使用 think、thinking、content',
    '- 自动判断需求类型：',
    '  · 正文美化（小说排版、对话气泡、信件、日记等）→ AI 只需输出 <标签>正文</标签>',
    '  · 结构化数据（状态栏、属性面板、论坛帖子等）→ AI 需按固定格式输出字段',
    '- HTML 中获取消息内容用：getChatMessages(getCurrentMessageId())[0].message',
    '- HTML 中触发指令用：triggerSlash(\'/send 关键词|/trigger\')',
    '- 结构化数据类型需在说明中告诉用户配合世界书规则',
    '- 根据用户后续反馈不断修改完善代码，输出完整的更新版本（不要只输出改动部分）',
    '- 用户没指定标签名时，选一个语义化的英文标签名',
    '- HTML 中 script 标签的结束用 <\\/script> 写法',
    '',
    '【HTML 模板参考】',
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<style>',
    '* { margin:0; padding:0; box-sizing:border-box; }',
    'body { font-family:"Microsoft YaHei",sans-serif; background:transparent; padding:8px; }',
    '/* 根据需求设计样式 */',
    '</style>',
    '</head>',
    '<body>',
    '<div id="content">正在加载...</div>',
    '<script>',
    'function getMessageData() {',
    '  var chatMessages = getChatMessages(getCurrentMessageId());',
    '  if (!chatMessages || chatMessages.length === 0) return null;',
    '  return chatMessages[0].message;',
    '}',
    'function init() {',
    '  try {',
    '    var messageText = getMessageData();',
    '    if (!messageText) { document.getElementById(\'content\').innerHTML=\'❌ 无法获取消息\'; return; }',
    '    /* 解析和渲染逻辑 */',
    '  } catch(e) {',
    '    document.getElementById(\'content\').innerHTML=\'❌ \'+e.message;',
    '  }',
    '}',
    '$(function(){ init(); });',
    '<\\/script>',
    '</body>',
    '</html>'
  ].join('\n');

  // ===== 工具函数 =====
  function escapeHtml(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
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
      toast.style.transform = 'translateY(-100%)';
      toast.style.transition = 'all .25s ease';
      setTimeout(function() { if (toast.parentNode) toast.remove(); }, 250);
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

  // ===== AI 生成参数（借鉴时之写卡器 TAVERN_GENERATION_PARAMS）=====
  var GEN_PARAMS = {
    temperature: 1,
    top_p: 0.9,
    top_k: 500,
    top_a: 0,
    min_p: 0,
    repetition_penalty: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 64000
  };

  // ===== 调用 AI（借鉴时之写卡器 callAI：6 层降级链）=====
  async function callAI(messages) {
    var errors = [];

    // 装配对话历史
    var historyText = messages.map(function(m) {
      return (m.role === 'user' ? '用户' : '助手') + '：' + m.content;
    }).join('\n\n');
    var userPrompt = historyText + '\n\n助手：';

    // 1. generate（最优先，带聊天历史）
    try {
      var generateFn = getApi('generate');
      if (generateFn) {
        var r1 = await generateFn(Object.assign({
          user_input: userPrompt,
          should_silence: true,
          max_chat_history: 0
        }, GEN_PARAMS));
        if (r1 && typeof r1 === 'string' && r1.trim().length > 5) return r1.trim();
        if (r1 && typeof r1 === 'object' && r1.content && String(r1.content).trim().length > 5) return String(r1.content).trim();
        if (r1 && typeof r1 === 'string') errors.push('generate: ' + r1.substring(0, 80));
      }
    } catch (e) { errors.push('generate: ' + e.message); }

    // 2. generateQuietPrompt
    try {
      var gqp = getApi('generateQuietPrompt');
      if (gqp) {
        var r2 = await gqp(userPrompt, false, false, false, 120000);
        if (r2 && typeof r2 === 'string' && r2.trim().length > 5) return r2.trim();
      }
    } catch (e) { errors.push('generateQuietPrompt: ' + e.message); }

    // 3. window.parent.generateQuietPrompt
    try {
      if (window.parent && typeof window.parent.generateQuietPrompt === 'function') {
        var r3 = await window.parent.generateQuietPrompt(userPrompt, false, false, false, 120000);
        if (r3 && typeof r3 === 'string' && r3.trim().length > 5) return r3.trim();
      }
    } catch (e) { errors.push('parent.generateQuietPrompt: ' + e.message); }

    // 4. TavernHelper.generate（带 ordered_prompts system+user）
    try {
      if (typeof window.TavernHelper !== 'undefined' && window.TavernHelper && typeof window.TavernHelper.generate === 'function') {
        var r4 = await window.TavernHelper.generate(Object.assign({
          should_silence: true,
          ordered_prompts: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ]
        }, GEN_PARAMS));
        if (r4 && typeof r4 === 'string' && r4.trim().length > 5) return r4.trim();
      }
    } catch (e) { errors.push('TavernHelper.generate: ' + e.message); }

    // 5. generateRaw（system + user 双消息）
    try {
      var generateRawFn = getApi('generateRaw');
      if (generateRawFn) {
        var r5;
        if (generateRawFn.length <= 1) {
          r5 = await generateRawFn(SYSTEM_PROMPT + '\n\n' + userPrompt);
        } else {
          r5 = await generateRawFn(Object.assign({
            should_silence: true,
            ordered_prompts: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt }
            ]
          }, GEN_PARAMS));
        }
        if (r5 && typeof r5 === 'string' && r5.trim().length > 5) return r5.trim();
        if (r5 && typeof r5 === 'object' && r5.message) return r5.message;
      }
    } catch (e) { errors.push('generateRaw: ' + e.message); }

    // 6. triggerSlash /generate（兜底）
    try {
      var triggerSlashFn = getApi('triggerSlash');
      if (triggerSlashFn) {
        var r6 = await triggerSlashFn('/generate lock=on ' + SYSTEM_PROMPT + '\n\n' + userPrompt);
        if (r6 && typeof r6 === 'string' && r6.trim().length > 5) return r6.trim();
      }
    } catch (e) { errors.push('triggerSlash: ' + e.message); }

    throw new Error('AI 调用失败：' + errors.join('; '));
  }

  // ===== 解析 AI 回复 =====
  function parseAIResponse(text) {
    var result = {
      explanation: '',
      regexConfig: '',
      htmlCode: '',
      scriptName: '',
      findRegex: '',
      tavernRegexObj: null
    };

    // 提取 <REGEX_CONFIG>...</REGEX_CONFIG>
    var regexMatch = text.match(/<REGEX_CONFIG>([\s\S]*?)<\/REGEX_CONFIG>/);
    if (regexMatch) {
      result.regexConfig = regexMatch[1].trim();
      var nameMatch = result.regexConfig.match(/脚本名称\s*[:：]\s*(.+)/);
      var findMatch = result.regexConfig.match(/查找正则\s*[:：]\s*(.+)/);
      if (nameMatch) result.scriptName = nameMatch[1].trim();
      if (findMatch) result.findRegex = findMatch[1].trim();
    }

    // 提取 <HTML_CODE>...</HTML_CODE>
    var htmlMatch = text.match(/<HTML_CODE>([\s\S]*?)<\/HTML_CODE>/);
    if (htmlMatch) {
      result.htmlCode = htmlMatch[1].trim();
    }

    // 提取说明文字（REGEX_CONFIG 之前的内容）
    if (regexMatch) {
      result.explanation = text.substring(0, regexMatch.index).trim();
    } else {
      result.explanation = text.trim();
    }

    // 构造酒馆正则对象（完整字段，借鉴时之写卡器 _convertRegexScript）
    if (result.findRegex && result.htmlCode) {
      result.tavernRegexObj = {
        id: 'regex-gen-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
        script_name: result.scriptName || '[界面]自定义',
        enabled: true,
        find_regex: result.findRegex,
        replace_string: '```\n' + result.htmlCode + '\n```',
        trim_strings: [],
        // source：触发位置（user_input=1, ai_output=2, slash_command=3, world_info=4, reasoning=5）
        source: {
          user_input: false,
          ai_output: true,
          slash_command: false,
          world_info: false,
          reasoning: false
        },
        // destination：display=仅格式显示替换, prompt=仅提示词替换
        destination: {
          display: true,
          prompt: false
        },
        run_on_edit: true,
        min_depth: null,
        max_depth: null,
        substituteRegex: 0
      };
    }

    return result;
  }

  // ===== 创建/销毁 Iframe（参考时之写卡器：iframe 直接 fixed 撑满视口 + DOM API 注入内容）=====
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
        console.log('[正则代码生成器] ① 父窗口/Document/Body OK');

        // iframe 直接 fixed 撑满视口（不用 overlay/wrap 多层嵌套，避免高度链断裂）
        var fr = pDoc.createElement('iframe');
        fr.id = SCRIPT_ID + '_iframe';
        fr.setAttribute('script_id', SCRIPT_ID);
        fr.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;border:none;z-index:100000;background:#f0f2f5;';

        console.log('[正则代码生成器] ② 创建 iframe，等待 load...');

        fr.addEventListener('load', function () {
          try {
            var d = fr.contentDocument || fr.contentWindow.document;
            if (!d) { reject(new Error('无法获取 iframe contentDocument')); return; }

            console.log('[正则代码生成器] ③ iframe load，用 DOM API 注入样式和内容...');

            try {
              var vp = d.createElement('meta');
              vp.name = 'viewport';
              vp.content = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
              d.head.appendChild(vp);
              var charset = d.createElement('meta');
              charset.setAttribute('charset', 'UTF-8');
              d.head.appendChild(charset);
            } catch (_) {}

            var s = d.createElement('style');
            s.textContent = IFRAME_CSS;
            d.head.appendChild(s);

            d.body.innerHTML = getIframeBodyHTML();

            console.log('[正则代码生成器] ④ ✅ 内容注入完成');

            function escFn(e) { if (e.key === 'Escape') closeIframe(); }
            pDoc.addEventListener('keydown', escFn);
            fr._escFn = escFn;

            resolve(d);
          } catch (e) {
            console.error('[正则代码生成器] ❌ iframe load 回调异常：', e);
            reject(e);
          }
        });

        pDoc.body.appendChild(fr);
        iframeEl = fr;

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
      if (iframeEl) {
        if (iframeEl._escFn && pDoc) { try { pDoc.removeEventListener('keydown', iframeEl._escFn); } catch (_) {} }
        if (iframeEl.parentNode) { try { iframeEl.parentNode.removeChild(iframeEl); } catch (_) {} }
      }
    } catch (_) {}
    iframeEl = null;
  }

  // iframe 内部的静态 HTML 结构（聊天界面）
  function getIframeBodyHTML() {
    return '' +
      '<div class="app">' +
        '<div class="chat-header">' +
          '<h1>✨ <span>正则代码生成器</span><span class="subtitle">和 AI 聊天生成代码</span></h1>' +
          '<div class="header-actions">' +
            '<button class="icon-btn" id="btnHelp" title="使用说明">❓</button>' +
            '<button class="icon-btn" id="btnClose" title="关闭">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="chat-messages" id="chatMessages"></div>' +
        '<div class="chat-input-area">' +
          '<div class="chat-input-row">' +
            '<textarea class="chat-input" id="chatInput" rows="1" placeholder="描述你想要的效果，例如：做一个小说正文美化...（Ctrl+Enter 发送）"></textarea>' +
            '<button class="chat-send" id="btnSend">发送</button>' +
          '</div>' +
          '<div class="chat-input-foot"><span class="chat-input-hint" id="chatInputHint"><span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> 发送 · <span class="kbd">Enter</span> 换行</span></div>' +
        '</div>' +
      '</div>';
  }

  // ===== 创建可折叠代码区块（借鉴时之写卡器 cp-section）=====
  function createCollapsibleSection(doc, icon, label, content, type) {
    var section = doc.createElement('div');
    section.className = 'cp-section';

    var header = doc.createElement('div');
    header.className = 'cp-section-header';

    var iconEl = doc.createElement('span');
    iconEl.className = 'cp-section-icon';
    iconEl.textContent = icon;
    header.appendChild(iconEl);

    var labelEl = doc.createElement('span');
    labelEl.className = 'cp-section-label';
    labelEl.textContent = label;
    header.appendChild(labelEl);

    // 预览（折叠时显示前 60 字符）
    var preview = doc.createElement('span');
    preview.className = 'cp-section-preview';
    var previewText = String(content).replace(/\n/g, ' ').trim();
    preview.textContent = previewText.substring(0, 60) + (previewText.length > 60 ? '...' : '');
    header.appendChild(preview);

    var toggle = doc.createElement('span');
    toggle.className = 'cp-section-toggle';
    toggle.textContent = '展开';
    header.appendChild(toggle);

    var body = doc.createElement('div');
    body.className = 'cp-section-body';
    body.style.display = 'none';
    var pre = doc.createElement('pre');
    pre.className = 'code-block';
    pre.textContent = content;
    body.appendChild(pre);

    // 默认折叠，点击切换
    var collapsed = true;
    header.addEventListener('click', function () {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : 'block';
      preview.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? '展开' : '收起';
    });

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  // ===== 打开生成器：聊天界面逻辑 =====
  async function openGenerator() {
    console.log('[正则代码生成器] 🚀 正在打开生成器...');
    var doc = await createModalIframe();
    console.log('[正则代码生成器] ⑤ 拿到 iframe document，开始绑定事件...');

    var win = iframeEl ? iframeEl.contentWindow : window;
    var root = getParentWindow();

    var messages = []; // 对话历史 [{role, content}]
    var isGenerating = false;

    var chatMessagesEl = doc.getElementById('chatMessages');
    var chatInput = doc.getElementById('chatInput');
    var btnSend = doc.getElementById('btnSend');
    var btnClose = doc.getElementById('btnClose');
    var btnHelp = doc.getElementById('btnHelp');

    // ===== 滚动到底部（借鉴时之写卡器 requestAnimationFrame）=====
    function scrollToBottom() {
      try { win.requestAnimationFrame(function () { chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight; }); } catch (_) { chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight; }
    }

    // ===== 添加用户消息 =====
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

    // ===== 添加 AI 消息 =====
    function addAssistantMessage(text, parsed) {
      var msg = doc.createElement('div');
      msg.className = 'message assistant';
      var bubble = doc.createElement('div');
      bubble.className = 'message-bubble assistant-bubble';

      // 说明文字
      var displayText = (parsed && parsed.explanation) ? parsed.explanation : text;
      if (displayText) {
        var txt = doc.createElement('div');
        txt.className = 'msg-text';
        txt.textContent = displayText;
        bubble.appendChild(txt);
      }

      // 正则配置代码块（可折叠 cp-section）
      if (parsed && parsed.regexConfig) {
        var rcSection = createCollapsibleSection(doc, '📝', '正则配置', parsed.regexConfig, 'regex');
        bubble.appendChild(rcSection);
      }

      // HTML 代码块（可折叠 cp-section）
      if (parsed && parsed.htmlCode) {
        var htmlSection = createCollapsibleSection(doc, '🌐', '前端 HTML', parsed.htmlCode, 'html');
        bubble.appendChild(htmlSection);
      }

      // 操作按钮
      if (parsed && parsed.tavernRegexObj) {
        var actions = doc.createElement('div');
        actions.className = 'code-actions';

        // 复制 HTML 按钮
        var btnCopyHtml = doc.createElement('button');
        btnCopyHtml.className = 'btn btn-sm';
        btnCopyHtml.textContent = '📋 复制 HTML';
        btnCopyHtml.addEventListener('click', function () {
          copyToClipboard(win, parsed.htmlCode, function (ok) {
            createToast(win, ok ? '✅ HTML 已复制' : '❌ 复制失败', ok ? 'success' : 'error');
          });
        });
        actions.appendChild(btnCopyHtml);

        // 复制正则配置按钮
        if (parsed.regexConfig) {
          var btnCopyRegex = doc.createElement('button');
          btnCopyRegex.className = 'btn btn-sm';
          btnCopyRegex.textContent = '📋 复制配置';
          btnCopyRegex.addEventListener('click', function () {
            copyToClipboard(win, parsed.regexConfig, function (ok) {
              createToast(win, ok ? '✅ 配置已复制' : '❌ 复制失败', ok ? 'success' : 'error');
            });
          });
          actions.appendChild(btnCopyRegex);
        }

        // 导入酒馆正则按钮
        var btnImport = doc.createElement('button');
        btnImport.className = 'btn btn-sm btn-primary';
        btnImport.textContent = '➕ 导入酒馆正则';
        btnImport.addEventListener('click', async function () {
          var obj = parsed.tavernRegexObj;
          var forbidden = ['think', 'thinking', 'content'];
          var tagCheck = obj.find_regex.match(/<([a-zA-Z_][a-zA-Z0-9_-]*)>/);
          if (tagCheck && forbidden.indexOf(tagCheck[1].toLowerCase()) !== -1) {
            createToast(win, '❌ 标签名 ' + tagCheck[1] + ' 被禁止使用！', 'error');
            return;
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
              copyToClipboard(win, parsed.regexConfig + '\n\n' + parsed.htmlCode, function (ok) {
                createToast(win, ok ? '⚠️ 已复制代码，请手动导入' : '⚠️ 请手动复制', 'info');
              });
            }
          } catch (err) {
            createToast(win, '❌ 导入失败：' + (err.message || String(err)), 'error');
          }
        });
        actions.appendChild(btnImport);

        bubble.appendChild(actions);
      }

      msg.appendChild(bubble);
      chatMessagesEl.appendChild(msg);
      scrollToBottom();
    }

    // ===== 打字指示器（借鉴时之写卡器：思考中...）=====
    function addTypingIndicator() {
      removeTypingIndicator();
      var msg = doc.createElement('div');
      msg.className = 'message assistant';
      msg.id = 'typingIndicator';
      var bubble = doc.createElement('div');
      bubble.className = 'message-bubble assistant-bubble';
      bubble.style.fontStyle = 'italic';
      bubble.style.color = 'var(--muted)';
      bubble.style.fontSize = '13px';
      var ti = doc.createElement('div');
      ti.className = 'typing-indicator';
      ti.innerHTML = '<span></span><span></span><span></span> 思考中...';
      bubble.appendChild(ti);
      msg.appendChild(bubble);
      chatMessagesEl.appendChild(msg);
      scrollToBottom();
    }

    function removeTypingIndicator() {
      var ti = doc.getElementById('typingIndicator');
      if (ti) ti.remove();
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
          addAssistantMessage(parsed.explanation || '已生成代码：', parsed);
        } else {
          addAssistantMessage(response);
        }
      } catch (e) {
        removeTypingIndicator();
        addAssistantMessage('❌ 生成失败：' + (e.message || String(e)) + '\n\n请检查酒馆是否正确配置了 AI API。');
      } finally {
        isGenerating = false;
        btnSend.disabled = false;
        btnSend.textContent = '发送';
        chatInput.focus();
      }
    }

    // ===== 事件绑定 =====
    btnSend.addEventListener('click', sendMessage);

    // 动态检测平台，显示 ⌘ 或 Ctrl（借鉴时之写卡器）
    try {
      var _ua = typeof navigator !== 'undefined' ? (navigator.platform || navigator.userAgent || '') : '';
      var _isMac = /Mac|iPhone|iPad|iPod/i.test(_ua);
      var _mod = _isMac ? '⌘' : 'Ctrl';
      var _hintEl = doc.getElementById('chatInputHint');
      if (_hintEl) _hintEl.innerHTML = '<span class="kbd">' + _mod + '</span>+<span class="kbd">Enter</span> 发送 · <span class="kbd">Enter</span> 换行';
    } catch (_) {}

    chatInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.isComposing) return; // 输入法合成中不触发
      // Ctrl/Cmd+Enter 发送，纯 Enter 换行（借鉴时之写卡器）
      var sendModifier = e.ctrlKey || e.metaKey;
      if (sendModifier) {
        e.preventDefault();
        sendMessage();
      }
    });

    chatInput.addEventListener('input', function () {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });

    btnClose.addEventListener('click', closeIframe);

    btnHelp.addEventListener('click', function () {
      alert('【正则代码生成器使用说明】\n\n💬 聊天生成\n  · 描述你想要的效果，AI 自动生成正则代码\n  · 可以继续对话让 AI 修改完善\n\n💡 示例\n  · "做一个小说正文美化，带段落缩进"\n  · "做一个角色状态栏，显示HP/MP"\n  · "把背景改成深色"\n  · "加一个刷新按钮"\n\n📌 操作\n  · Enter 发送，Shift+Enter 换行\n  · 点「导入酒馆正则」一键导入到酒馆');
    });

    // ===== 欢迎消息 =====
    addAssistantMessage('你好！我是正则代码生成助手。描述你想要的效果，我会帮你生成酒馆正则代码。\n\n例如：\n· "帮我做一个小说正文美化，带段落缩进"\n· "做一个角色状态栏，显示HP/MP/攻击力"\n· "做一个对话气泡样式"');

    chatInput.focus();
    console.log('[正则代码生成器] ⑥ ✅ 聊天界面初始化完成！');
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

  // ===== 脚本按钮（只留 1 个可见按钮在脚本库）=====
  var OFFICIAL_BUTTON_NAME = '正则代码生成器';

  function ensureScriptButtons() {
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
        console.warn('[正则代码生成器] ⚠️ 未获取到 replaceScriptButtons / appendInexistentScriptButtons');
        return false;
      }
    } catch (e) {
      console.warn('[正则代码生成器] 按钮写入脚本库失败：', e && e.message ? e.message : e);
      return false;
    }
  }

  function bindScriptButtonEvents() {
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
    tryBind(OFFICIAL_BUTTON_NAME);
    tryBind('打开正则生成器');
    tryBind('正则生成器');
    tryBind('✨ 打开生成器');
    return bound > 0;
  }

  // ===== 真正的打开入口（统一错误处理）=====
  function openGeneratorWithError() {
    try {
      console.log('[正则代码生成器] 🎯 点击触发：正在打开弹窗…');
      openGenerator().catch(function (e) {
        var msg = (e && e.message) ? e.message : String(e);
        console.error('[正则代码生成器] ❌ 打开失败：', e);
        try {
          alert('❌ 正则代码生成器打开失败\n\n错误信息：' + msg + '\n\n（详细错误请按 F12 查看 Console）');
        } catch (_) {}
      });
    } catch (e) {
      var msg = (e && e.message) ? e.message : String(e);
      console.error('[正则代码生成器] ❌ 打开失败：', e);
      try {
        alert('❌ 正则代码生成器打开失败\n\n错误信息：' + msg + '\n\n（详细错误请按 F12 查看 Console）');
      } catch (_) {}
    }
  }

  // ===== 浮动按钮（双保险）=====
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
        ? 'position:fixed;bottom:72px;right:12px;z-index:99998;padding:9px 15px;background:linear-gradient(135deg,#4f46e5,#4338ca);color:#fff;border:none;border-radius:20px;cursor:pointer;font-weight:600;box-shadow:0 4px 16px rgba(79,70,229,.4);transition:transform .2s;font-size:12px;-webkit-tap-highlight-color:transparent;'
        : 'position:fixed;bottom:80px;right:24px;z-index:99998;padding:11px 20px;background:linear-gradient(135deg,#4f46e5,#4338ca);color:#fff;border:none;border-radius:25px;cursor:pointer;font-weight:600;box-shadow:0 6px 24px rgba(79,70,229,.35);transition:transform .2s;font-size:14px;';
      btn.style.cssText = btnCss;
      btn.onmouseover = function () { try { btn.style.transform = 'scale(1.05)'; } catch (_) {} };
      btn.onmouseout = function () { try { btn.style.transform = 'scale(1)'; } catch (_) {} };
      btn.onclick = function () { openGeneratorWithError(); };
      pDoc.body.appendChild(btn);
      console.log('[正则代码生成器] ✅ 浮动按钮已创建（右下角）');
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
    console.log('[正则代码生成器] 🚀 初始化（版本：聊天式 AI 生成 · 多作用域兼容）');

    try { window.addEventListener('pagehide', cleanupScriptArtifacts); } catch (_) {}
    try {
      var pWin = getParentWindow();
      if (pWin !== window) pWin.addEventListener('pagehide', cleanupScriptArtifacts);
    } catch (_) {}

    var buttonsCreated = false;
    var buttonsBound = false;
    try { buttonsCreated = ensureScriptButtons(); } catch (_) {}
    try { buttonsBound = bindScriptButtonEvents(); } catch (_) {}

    console.log('[正则代码生成器] 📋 脚本库按钮：' + (buttonsCreated ? '已创建' : '未创建') + ' / 事件绑定：' + (buttonsBound ? '已绑定' : '未绑定'));

    addFloatingButton();

    setTimeout(function () {
      if (!buttonsCreated) try { ensureScriptButtons(); } catch (_) {}
      if (!buttonsBound) try { bindScriptButtonEvents(); } catch (_) {}
    }, 1500);

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

  // ===== 启动 =====
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
    var $ = getJQuery();
    if ($) {
      $(function () { startOnce(); });
    } else {
      setTimeout(startOnce, 500);
    }
    setTimeout(startOnce, 3000);
  }

  boot();

})();
