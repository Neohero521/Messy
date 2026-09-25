(function() {
  'use strict';
  /* ============================================================================
   * 时之写卡器 · Tavern Helper 脚本（整理版）
   * ----------------------------------------------------------------------------
   * 项目类型：后台脚本（Tavern Helper Script · 相当于模板里的 index.ts）
   * 运行形式：单文件 JS，导入到酒馆脚本库，点击脚本按钮打开写卡器
   * 技术栈：原生 JS + 自建 iframe UI（无需构建工具，便于酒馆用户使用）
   *
   * 依据 tavern-helper-template 脚本规范 + sillytavern-dev 技能进行整理：
   *   1) 入口/卸载时序：用 $(() => scriptEntryPoint()) 替代顶层 tryInit()
   *                     pagehide 时统一 cleanupScriptArtifacts()
   *   2) 常量与模板集中在顶部：IFRAME_CSS、SVG 图标库、cardData 模板等
   *   3) 工具函数在业务逻辑之前
   *   4) 所有写卡/酒馆 API 调用封装在 "酒馆适配层" 中
   *   5) 脚本自身 UI（写卡器 iframe） 的样式和 JS 分离
   *
   * 本文件分块索引（按代码顺序从上到下）：
   *   ▌SECTION 0  脚本元信息 & 全局常量
   *   ▌SECTION 1  IFRAME 外观样式（已抽到顶部 IFRAME_CSS 常量）
   *   ▌SECTION 2  通用工具函数（Toast、SVG图标、Token估算、iframe创建/销毁）
   *   ▌SECTION 3  卡片数据模板 + 世界书条目模板 + MVU美化模板
   *   ▌SECTION 4  写卡预设 + 系统提示词（含 AI 输出格式约束）
   *   ▌SECTION 5  条目匹配 + 智能合并引擎（mergePartial · 去重/删除屏障）
   *   ▌SECTION 6  AI 调用适配层 + 响应清洗（callAI · cleanAIReply · JSON修复）
   *   ▌SECTION 7  MVU 8步工作流 + 提示词构建（buildPrompt · 角色卡/MVU Tab 隔离）
   *   ▌SECTION 8  酒馆 SillyTavern API 适配层（_tavern() 封装 · 导入导出）
   *   ▌SECTION 9  写卡器主界面 UI 渲染（欢迎页 · 聊天页 · 预览面板）
   *   ▌SECTION 10 聊天消息发送与 AI 流式回复（callAIChat · 写卡流程主循环）
   *   ▌SECTION 11 脚本注册按钮 + 浮动按钮 + 入口 / 卸载清理
   * ==========================================================================
   */
  const SCRIPT_ID = 'modelo-char-generator';

  // ============================================================================
  // 全局调参常量（唯一事实源）：阈值/超时/防抖统一在此，禁止再散落魔法数字
  // ============================================================================
  const CONFIG = Object.freeze({
    // —— 定时器 / 防抖（毫秒）——
    IFRAME_LOAD_TIMEOUT_MS: 4000,   // iframe 加载超时
    PREVIEW_DEBOUNCE_MS: 80,        // 预览面板刷新防抖
    INPUT_TOKEN_DEBOUNCE_MS: 150,   // 输入框 token 估算防抖（字数显示仍即时）
    CTX_BAR_DEBOUNCE_MS: 0,         // 上下文操作条合并刷新（0=下一个事件循环即执行，保持即时）
    RESIZE_THROTTLE_MS: 100,        // 视口 resize 节流
    // —— 条目匹配引擎（findEntryMatch）——
    MATCH_SUFFIX_SIM: 0.60,         // 同前缀唯一条目：后缀名「编辑距离+前缀+字符集」混合相似度阈值
    MATCH_CONTENT_SIM: 0.45,        // 同前缀多条目：正文 bigram Dice 相似度阈值
    MATCH_CONTENT_MIN_LEN: 20,      // 正文参与相似度匹配的最小长度
    MATCH_CONTENT_HEAD: 300,        // 正文比较仅取前 N 字符（控 CPU；中文按字符计）
    // —— 文本 / UI ——
    AI_ERROR_PREVIEW_CHARS: 300,    // AI 解析失败时回显的原文片段长度
    DERIVE_KEYWORD_HEAD_CHARS: 300, // 触发词派生：仅扫描正文前 N 字
    DERIVE_KEYWORD_MAX: 12,         // 触发词派生：候选词数量上限
    UNDO_STACK_LIMIT: 10            // 撤销快照保留步数
  });


  // ===== Iframe 样式表（已从 createModalIframe 中抽出，便于维护和复用）=====
  const IFRAME_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;width:100%;overflow:hidden}
:root{
  /* 简洁中性配色：暖白底 + 石墨字 + 靛蓝主色（参考 IDE 工作区，干净舒服）*/
  --bg:#f7f7f2;            /* 主背景：暖白 */
  --surface:#ffffff;       /* 卡面：纯白 */
  --surface-soft:#f4f5f7;  /* 次级面：浅石墨 */
  --surface-sink:#eef0f3;  /* 下沉面：浅灰 */
  --ink:#111827;           /* 主文字：墨黑 */
  --ink-soft:#475467;      /* 次文字：石墨 */
  --muted:#667085;         /* 弱文字：中灰（AA 达标）*/
  --accent:#4f46e5;        /* 主色：靛蓝 */
  --accent-deep:#4338ca;   /* 主色深：靛蓝深 */
  --accent-soft:rgba(79,70,229,.08);   /* 主色浅 */
  --accent-soft-strong:rgba(79,70,229,.12);
  --accent-border:rgba(79,70,229,.22);
  --accent-border-strong:rgba(79,70,229,.55);
  --accent-text:#4338ca;
  --sage:#16a34a;          /* 成功：绿 */
  --sage-soft:rgba(22,163,74,.08);
  --sage-soft-strong:rgba(22,163,74,.16);
  --sage-border:rgba(22,163,74,.20);
  --sage-border-strong:rgba(22,163,74,.40);
  --sage-text:#15803d;
  --amber:#ca8a04;         /* 提醒：琥珀 */
  --amber-soft:rgba(202,138,4,.09);
  --amber-soft-strong:rgba(202,138,4,.16);
  --amber-border:rgba(202,138,4,.22);
  --amber-border-strong:rgba(202,138,4,.45);
  --amber-text:#a16207;
  --terra:#dc2626;         /* 危险：赤红 */
  --terra-soft:rgba(220,38,38,.08);
  --terra-soft-strong:rgba(220,38,38,.14);
  --terra-border:rgba(220,38,38,.22);
  --terra-border-strong:rgba(220,38,38,.45);
  --terra-text:#dc2626;
  --line:rgba(15,23,42,.10);          /* 描边：石墨 */
  --line-soft:rgba(15,23,42,.06);     /* 弱描边 */
  --radius:12px;           /* 圆角基线（简洁）*/
  --radius-sm:8px;
  --radius-lg:16px;
  --shadow-soft:0 6px 20px rgba(15,23,42,.06);
  --shadow-card:0 12px 30px rgba(15,23,42,.08);
  --shadow-float:0 20px 60px rgba(15,23,42,.12);
  --font:'Segoe UI',system-ui,-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei UI','Hiragino Sans GB',sans-serif;
  --font-mono:'Sarasa Mono SC','Cascadia Code','JetBrains Mono','Consolas',Menlo,monospace;
  --app-font-scale: 1;   /* 全局字体缩放（0.85~1.20），由JS按钮调整 */
  /* 滚动条 */
  --scrollbar-thumb:rgba(148,163,184,.4);
  --scrollbar-track:transparent;
  /* 链接色（走变量，便于主题化）*/
  --link:#2563eb;
}
/* ============ 暗黑主题：跟随系统（未显式选择时）或 html[data-theme="dark"] ============ */
:root[data-theme="dark"]{
  --bg:#14161c;
  --surface:#1d2027;
  --surface-soft:#23272f;
  --surface-sink:#2a2f3a;
  --ink:#e6e8ee;
  --ink-soft:#c3c9d6;
  --muted:#8f97a8;
  --accent:#818cf8;
  --accent-deep:#a5b4fc;
  --accent-soft:rgba(129,140,248,.16);
  --accent-soft-strong:rgba(129,140,248,.24);
  --accent-border:rgba(129,140,248,.32);
  --accent-border-strong:rgba(129,140,248,.6);
  --accent-text:#a5b4fc;
  --sage:#4ade80;
  --sage-soft:rgba(74,222,128,.12);
  --sage-soft-strong:rgba(74,222,128,.2);
  --sage-border:rgba(74,222,128,.26);
  --sage-border-strong:rgba(74,222,128,.45);
  --sage-text:#4ade80;
  --amber:#fbbf24;
  --amber-soft:rgba(251,191,36,.12);
  --amber-soft-strong:rgba(251,191,36,.2);
  --amber-border:rgba(251,191,36,.28);
  --amber-border-strong:rgba(251,191,36,.5);
  --amber-text:#fbbf24;
  --terra:#f87171;
  --terra-soft:rgba(248,113,113,.12);
  --terra-soft-strong:rgba(248,113,113,.2);
  --terra-border:rgba(248,113,113,.28);
  --terra-border-strong:rgba(248,113,113,.5);
  --terra-text:#f87171;
  --line:rgba(255,255,255,.10);
  --line-soft:rgba(255,255,255,.06);
  --shadow-soft:0 6px 20px rgba(0,0,0,.3);
  --shadow-card:0 12px 30px rgba(0,0,0,.38);
  --shadow-float:0 20px 60px rgba(0,0,0,.5);
  --scrollbar-thumb:rgba(255,255,255,.22);
  --link:#93b4ff;
  color-scheme:dark;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]):not([data-theme="dark"]){
  --bg:#14161c;--surface:#1d2027;--surface-soft:#23272f;--surface-sink:#2a2f3a;
  --ink:#e6e8ee;--ink-soft:#c3c9d6;--muted:#8f97a8;
  --accent:#818cf8;--accent-deep:#a5b4fc;
  --accent-soft:rgba(129,140,248,.16);--accent-soft-strong:rgba(129,140,248,.24);
  --accent-border:rgba(129,140,248,.32);--accent-border-strong:rgba(129,140,248,.6);--accent-text:#a5b4fc;
  --sage:#4ade80;--sage-soft:rgba(74,222,128,.12);--sage-soft-strong:rgba(74,222,128,.2);
  --sage-border:rgba(74,222,128,.26);--sage-border-strong:rgba(74,222,128,.45);--sage-text:#4ade80;
  --amber:#fbbf24;--amber-soft:rgba(251,191,36,.12);--amber-soft-strong:rgba(251,191,36,.2);
  --amber-border:rgba(251,191,36,.28);--amber-border-strong:rgba(251,191,36,.5);--amber-text:#fbbf24;
  --terra:#f87171;--terra-soft:rgba(248,113,113,.12);--terra-soft-strong:rgba(248,113,113,.2);
  --terra-border:rgba(248,113,113,.28);--terra-border-strong:rgba(248,113,113,.5);--terra-text:#f87171;
  --line:rgba(255,255,255,.10);--line-soft:rgba(255,255,255,.06);
  --shadow-soft:0 6px 20px rgba(0,0,0,.3);--shadow-card:0 12px 30px rgba(0,0,0,.38);--shadow-float:0 20px 60px rgba(0,0,0,.5);
  --scrollbar-thumb:rgba(255,255,255,.22);--link:#93b4ff;color-scheme:dark;
  }
}
body{font-family:var(--font);background:var(--bg);color:var(--ink);font-size:calc(14px * var(--app-font-scale,1));-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
/* 顶栏为固定尺寸工具条：基准字号在 .topbar 上固定为 14px，内部 em 均为定值，不随字体缩放变化；
   其余工作区关键模块的字体大小仍随缩放走，但保持最小字号保证可读性 */
.quick-btn,.qa-mini{font-size:calc(.8em * var(--app-font-scale,1))}
.pv-section h3{font-size:calc(.86em * var(--app-font-scale,1))}
.pv-section .pv-entry-content,.pv-section .pv-entry summary,.pv-section .pv-code,.pv-section .pv-content{font-size:calc(.82em * var(--app-font-scale,1));line-height:calc(1.65 * var(--app-font-scale,1))}
.bubble.user,.bubble.assistant{font-size:calc(.88em * var(--app-font-scale,1))}
.chat-input{font-size:calc(.9em * var(--app-font-scale,1))}
/* SVG 图标基线：统一对齐、currentColor 继承 */
svg.ic{display:inline-block;vertical-align:-.18em;flex-shrink:0;transition:color .2s}
.ic-spin{animation:spin 0.8s linear infinite}
.app{position:fixed;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden;padding-bottom:env(safe-area-inset-bottom,0)}
.topbar{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:0 14px;font-size:14px;background:linear-gradient(180deg,var(--surface) 0%,var(--surface) 70%,rgba(79,70,229,.02) 100%);border-bottom:1px solid var(--line);min-height:50px;position:relative}
.topbar::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(79,70,229,.18),transparent)}
.topbar-left{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.topbar-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.topbar h1{font-size:.95em;color:var(--accent-deep);font-weight:700;white-space:nowrap;display:flex;align-items:center;gap:7px;flex-shrink:0;letter-spacing:.2px}
.topbar h1 .topbar-ic{color:var(--accent);filter:drop-shadow(0 1px 2px rgba(79,70,229,.2))}
.topbar .phase{font-size:.8em;color:var(--accent-text);background:linear-gradient(135deg,var(--accent-soft),rgba(79,70,229,.12));padding:4px 13px;border-radius:999px;font-weight:600;white-space:nowrap;flex-shrink:0;border:1px solid var(--accent-border);letter-spacing:.2px;box-shadow:0 1px 3px rgba(79,70,229,.08);transition:all .2s ease}
.topbar .phase:hover{border-color:var(--accent-border-strong);box-shadow:0 2px 8px rgba(79,70,229,.12)}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:32px;padding:0 11px;background:var(--surface);border:1px solid var(--line);border-radius:8px;color:var(--ink-soft);cursor:pointer;transition:all .18s cubic-bezier(.4,0,.2,1);font-size:.82em;font-weight:600;font-family:inherit;white-space:nowrap;position:relative;overflow:hidden}
.icon-btn svg{width:15px;height:15px;transition:transform .18s ease}
.icon-btn:hover:not(:disabled){background:linear-gradient(135deg,var(--surface),var(--accent-soft));color:var(--accent-deep);border-color:var(--accent-border);box-shadow:0 3px 10px rgba(79,70,229,.1);transform:translateY(-1px)}
.icon-btn:hover:not(:disabled) svg{transform:scale(1.1)}
.icon-btn:active:not(:disabled){transform:translateY(0) scale(.98)}
.icon-btn.icon-btn-square{width:32px;padding:0}
.icon-btn.icon-btn-square svg{width:16px;height:16px}
.icon-btn.danger:hover:not(:disabled){background:linear-gradient(135deg,var(--surface),var(--terra-soft));color:var(--terra-text);border-color:var(--terra-border);box-shadow:0 3px 10px rgba(220,38,38,.1)}
/* 通用按钮焦点环（无障碍）*/
.quick-btn:focus-visible,.qa-mini:focus-visible,.ctx-mod:focus-visible,.icon-btn:focus-visible,.tab-btn:focus-visible,.pv-mini-btn:focus-visible,.btn-send:focus-visible,.btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-soft-strong),0 0 0 1px var(--accent)}
.main{flex:1 1 0;display:flex;min-height:0;overflow:hidden}
.chat-panel{flex:1.4 1 0;display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--line);min-height:0;overflow:hidden;background:var(--bg)}
.preview-panel{flex:1 1 0;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--surface-soft)}
.chat-messages{flex:1 1 0;overflow-y:auto;padding:14px 14px;min-height:0;-webkit-overflow-scrolling:touch}
.chat-msg{display:flex;flex-direction:column;gap:4px;margin-bottom:14px;align-items:flex-start}
.chat-msg.user{align-items:flex-end}
.chat-msg .avatar-row{display:flex;align-items:center;gap:6px}
.chat-msg .avatar{width:72px;height:72px;border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;font-size:36px;flex-shrink:0;position:relative}
.chat-msg .avatar svg{width:40px;height:40px}
.chat-msg.assistant .avatar{background:var(--accent-soft);color:var(--accent-deep)}
.chat-msg.user .avatar{background:var(--surface-sink);color:var(--ink-soft)}
/* 头像旁铅笔编辑按钮 */
.msg-edit-btn{width:28px;height:28px;border:1px solid var(--line);border-radius:50%;background:var(--surface);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s ease;box-shadow:var(--shadow-soft)}
.msg-edit-btn:hover{background:var(--accent-soft);color:var(--accent-deep);border-color:var(--accent-border);transform:scale(1.1)}
.msg-edit-btn:active{transform:scale(.95)}
.msg-edit-btn svg{width:14px;height:14px}
/* 头像点击弹出菜单（展开在头像旁边） */
.avatar-menu{position:absolute;z-index:500;background:linear-gradient(135deg,var(--surface) 0%,var(--surface-soft) 100%);border:1px solid var(--line);border-radius:999px;box-shadow:0 12px 36px rgba(15,23,42,.12),0 2px 6px rgba(15,23,42,.06);padding:5px 4px;display:flex;flex-direction:row;align-items:center;gap:3px;font-size:.84em;animation:avatarMenuPop .14s cubic-bezier(.34,1.56,.64,1)}
@keyframes avatarMenuPop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
/* AI头像在左→菜单向右展开（贴在头像右侧）；用户头像在右→菜单向左展开（贴在头像左侧） */
.avatar-menu.am-right{left:calc(100% + 8px);top:50%;transform:translateY(-50%);transform-origin:left center}
.avatar-menu.am-left{right:calc(100% + 8px);top:50%;transform:translateY(-50%);transform-origin:right center}
/* 弹出动画需保留 translateY，单独处理 */
.avatar-menu.am-right{animation:avatarMenuPopRight .14s cubic-bezier(.34,1.56,.64,1)}
.avatar-menu.am-left{animation:avatarMenuPopLeft .14s cubic-bezier(.34,1.56,.64,1)}
@keyframes avatarMenuPopRight{from{opacity:0;transform:translateY(-50%) translateX(-8px) scale(.6)}to{opacity:1;transform:translateY(-50%) translateX(0) scale(1)}}
@keyframes avatarMenuPopLeft{from{opacity:0;transform:translateY(-50%) translateX(8px) scale(.6)}to{opacity:1;transform:translateY(-50%) translateX(0) scale(1)}}
.avatar-menu-item{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;cursor:pointer;color:var(--ink-soft);transition:background .15s ease,color .15s ease,transform .15s ease,box-shadow .15s ease;position:relative}
.avatar-menu-item:hover{background:var(--surface);color:var(--accent-deep);transform:scale(1.08);box-shadow:0 2px 8px rgba(79,70,229,.12)}
.avatar-menu-item:active{transform:scale(.95)}
.avatar-menu-item.danger{color:var(--terra-text)}
.avatar-menu-item.danger:hover{background:var(--terra-soft);color:var(--terra-text);box-shadow:0 0 0 1px var(--terra-border),0 2px 8px rgba(220,38,38,.12)}
.avatar-menu-item svg{flex-shrink:0;transition:transform .15s ease}
.avatar-menu-item:hover svg{transform:scale(1.08)}
.avatar-menu-item .am-tip{position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%) translateY(3px);background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;padding:4px 10px;border-radius:6px;font-size:.7em;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;z-index:501;font-weight:500;box-shadow:0 6px 18px rgba(15,23,42,.22);letter-spacing:.2px}
.avatar-menu-item:hover .am-tip{opacity:1;transform:translateX(-50%) translateY(0)}
.avatar-menu-sep{width:1px;height:22px;background:linear-gradient(180deg,transparent,var(--line),transparent);margin:0 3px;flex-shrink:0}
.chat-msg .bubble{max-width:82%;padding:10px 14px;border-radius:var(--radius);font-size:.85em;line-height:1.65;word-break:break-word}
.chat-msg.assistant .bubble{background:var(--surface);border:1px solid var(--line-soft);color:var(--ink);font-size:1em;padding:12px 16px;max-width:100%;width:100%;border-radius:var(--radius);box-shadow:var(--shadow-soft)}
.chat-msg.user .bubble{background:var(--surface);border:1px solid var(--line);color:var(--ink);border-bottom-right-radius:var(--radius-sm);box-shadow:var(--shadow-soft)}
.chat-msg .bubble b{color:var(--accent-deep)}
.chat-msg .bubble code{background:var(--surface-sink);padding:1px 6px;border-radius:var(--radius-sm);font-size:.82em;color:var(--accent-deep);font-family:var(--font-mono)}
.chat-msg .bubble pre{background:var(--surface-soft);border:1px solid var(--line);border-radius:var(--radius-sm);padding:10px;overflow-x:auto;font-size:1em;margin:6px 0;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto}
.chat-msg .bubble pre code{background:none;padding:0;color:inherit}
.chat-msg .bubble .md-table-wrap{margin:8px 0;overflow-x:auto}
.chat-msg .bubble table{border-collapse:collapse;font-size:.92em}
.chat-msg .bubble th,.chat-msg .bubble td{border:1px solid var(--line);padding:6px 10px;vertical-align:top;min-width:60px}
.chat-msg .bubble th{background:var(--surface-sink);font-weight:700;color:var(--ink)}
.chat-msg .bubble tbody tr:nth-child(even) td{background:var(--surface-soft)}
.chat-msg .bubble h2{font-size:1.15em;font-weight:700;margin:10px 0 4px;color:var(--ink);border-bottom:1px solid var(--line-soft);padding-bottom:3px}
.chat-msg .bubble h3{font-size:1.05em;font-weight:700;margin:8px 0 3px;color:var(--ink)}
.chat-msg .bubble h4{font-size:1em;font-weight:700;margin:6px 0 2px;color:var(--ink)}
.chat-msg .bubble ul,.chat-msg .bubble ol{margin:4px 0 4px 18px;padding:0}
.chat-msg .bubble li{margin:2px 0}
.chat-msg .bubble blockquote{border-left:3px solid var(--accent-soft);margin:6px 0;padding:4px 12px;background:var(--surface-soft);color:var(--ink-soft);font-size:.92em;border-radius:0 var(--radius-sm) var(--radius-sm) 0}
.chat-msg .bubble hr{border:none;border-top:1px solid var(--line-soft);margin:8px 0}
.chat-msg .bubble i{font-style:italic;color:var(--ink-soft)}
.chat-msg .bubble del{color:var(--muted);text-decoration:line-through}
.chat-msg .bubble a{color:var(--link);text-decoration:underline}
.html-render-frame{display:block;margin:6px 0}
.typing{color:var(--muted);font-style:italic;font-size:.8em;padding:4px 8px}
.typing span{display:inline-block;animation:blink 1.4s infinite;color:var(--accent)}
.typing span:nth-child(2){animation-delay:.2s}
.typing span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}
.quick-actions{flex-shrink:0;display:flex;gap:8px;padding:10px 14px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--line-soft);background:linear-gradient(180deg,var(--surface-soft) 0%,var(--surface) 30%);max-height:110px;overflow-y:auto}
.quick-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;background:var(--surface);color:var(--ink-soft);border:1px solid var(--line);border-radius:999px;cursor:pointer;font-size:.82em;transition:all .18s cubic-bezier(.4,0,.2,1);white-space:nowrap;flex-shrink:0;font-weight:500;position:relative;overflow:hidden}
.quick-btn svg{width:14px;height:14px;transition:transform .18s ease}
.quick-btn:hover:not(:disabled){background:var(--surface);color:var(--accent-deep);border-color:var(--accent-border);box-shadow:0 4px 14px rgba(79,70,229,.12),0 1px 3px rgba(15,23,42,.06);transform:translateY(-1px)}
.quick-btn:hover:not(:disabled) svg{transform:scale(1.1)}
.quick-btn:active:not(:disabled){transform:translateY(0) scale(.98)}
.quick-btn.hl{border-color:var(--accent-border-strong);color:var(--accent-deep);background:linear-gradient(135deg,var(--accent-soft) 0%,rgba(79,70,229,.14) 100%);box-shadow:0 2px 10px rgba(79,70,229,.1)}
.quick-btn.hl:hover:not(:disabled){background:linear-gradient(135deg,var(--accent-soft-strong) 0%,var(--accent-soft) 100%);color:var(--accent-deep);border-color:var(--accent);box-shadow:0 6px 18px rgba(79,70,229,.18),0 2px 4px rgba(79,70,229,.1)}
.quick-btn:disabled{opacity:.4;cursor:not-allowed}
.qa-mini{margin-left:auto;display:inline-flex;align-items:center;gap:5px;padding:7px 13px;background:var(--surface);color:var(--ink-soft);border:1px solid var(--line);border-radius:999px;cursor:pointer;font-size:.82em;line-height:1;transition:all .18s cubic-bezier(.4,0,.2,1);flex-shrink:0;font-weight:500}
.qa-mini svg{width:14px;height:14px;transition:transform .18s ease}
.qa-mini+.qa-mini{margin-left:8px}
.qa-mini:hover:not(:disabled){background:var(--surface);color:var(--accent-deep);border-color:var(--accent-border);box-shadow:0 4px 14px rgba(79,70,229,.12),0 1px 3px rgba(15,23,42,.06);transform:translateY(-1px)}
.qa-mini:hover:not(:disabled) svg{transform:scale(1.1)}
.qa-mini:active:not(:disabled){transform:translateY(0) scale(.98)}
.qa-mini:disabled{opacity:.4;cursor:not-allowed}
/* 常驻指令组：继续/重做/查看进度（轻量填充样式，与右侧写入/清空区分）*/
.qa-cmd-sep{flex:1 1 auto;min-width:6px}
.qa-mini.qa-cmd{margin-left:0;background:var(--surface-soft);font-size:.78em;padding:6px 11px}
.qa-mini.qa-cmd+.qa-mini.qa-cmd{margin-left:6px}
#saveBtn{margin-left:10px}
.chat-input-area{flex-shrink:0;padding:12px 14px;border-top:1px solid var(--line-soft);background:linear-gradient(180deg,var(--surface) 0%,var(--surface) 60%,rgba(79,70,229,.02) 100%)}
.chat-input-row{display:flex;gap:9px;align-items:flex-end}
.chat-input{width:100%;padding:11px 15px;background:linear-gradient(135deg,var(--surface-soft) 0%,var(--surface) 100%);border:1px solid var(--line);border-radius:var(--radius);color:var(--ink);font-size:14px;resize:none;min-height:44px;max-height:140px;font-family:inherit;line-height:1.55;transition:border-color .25s cubic-bezier(.4,0,.2,1),box-shadow .25s cubic-bezier(.4,0,.2,1),background .2s;box-shadow:inset 0 1px 3px rgba(15,23,42,.03);overflow-y:auto}
.chat-input-row .chat-input{flex:1;width:auto}
.chat-input:hover:not(:disabled){border-color:var(--accent-soft);background:var(--surface)}
.chat-input:focus{outline:none;border-color:var(--accent);background:var(--surface);box-shadow:0 0 0 3px var(--accent-soft-strong),0 4px 14px rgba(79,70,229,.08)}
.chat-input::placeholder{color:var(--muted)}
.chat-input:disabled{opacity:.5}
.btn-send{flex-shrink:0;width:44px;height:44px;border:none;border-radius:var(--radius);background:linear-gradient(135deg,var(--accent) 0%,var(--accent-deep) 100%);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .25s cubic-bezier(.4,0,.2,1);box-shadow:0 4px 14px rgba(79,70,229,.25),0 1px 3px rgba(79,70,229,.15);position:relative;overflow:hidden}
.btn-send::before{content:'';position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(135deg,rgba(255,255,255,.15),transparent 50%);opacity:0;transition:opacity .25s ease}
.btn-send:hover:not(:disabled){background:linear-gradient(135deg,var(--accent-deep) 0%,#3730a3 100%);box-shadow:0 6px 20px rgba(79,70,229,.32),0 2px 6px rgba(79,70,229,.2);transform:translateY(-1px)}
.btn-send:hover:not(:disabled)::before{opacity:1}
.btn-send:hover:not(:disabled) svg{transform:scale(1.08) translateX(1px)}
.btn-send:active:not(:disabled){transform:translateY(0) scale(.97)}
.btn-send:disabled{background:var(--surface-sink);color:var(--muted);cursor:not-allowed;box-shadow:inset 0 1px 2px rgba(15,23,42,.04);transform:none}
.btn-send:disabled::before{display:none}
.btn-send svg{display:block;transition:transform .25s ease}
.btn-send .send-spinner{animation:spin .8s linear infinite;display:none}
.btn-send.is-waiting .send-icon{display:none}
.btn-send.is-waiting .send-spinner{display:block}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 17px;border:none;border-radius:var(--radius-sm);font-size:.8em;cursor:pointer;font-weight:600;transition:all .2s cubic-bezier(.4,0,.2,1);font-family:inherit;letter-spacing:.15px;position:relative;overflow:hidden}
.btn svg{width:15px;height:15px;transition:transform .2s ease}
.btn:hover:not(:disabled) svg{transform:scale(1.1)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent-deep));color:#fff;box-shadow:0 4px 12px rgba(79,70,229,.2)}
.btn-primary:hover:not(:disabled){background:linear-gradient(135deg,var(--accent-deep),#3730a3);box-shadow:0 6px 18px rgba(79,70,229,.28);transform:translateY(-1px)}
.btn-success{background:linear-gradient(135deg,var(--sage),#15803d);color:#fff;box-shadow:0 4px 12px rgba(22,163,74,.2)}
.btn-success:hover:not(:disabled){background:linear-gradient(135deg,#15803d,#166534);box-shadow:0 6px 18px rgba(22,163,74,.28);transform:translateY(-1px)}
.btn-ghost{background:linear-gradient(135deg,var(--surface-soft),var(--surface));color:var(--ink-soft);border:1px solid var(--line)}
.btn-ghost:hover:not(:disabled){background:var(--surface);color:var(--accent-deep);border-color:var(--accent-soft);box-shadow:0 3px 10px rgba(79,70,229,.08);transform:translateY(-1px)}
.preview-header{flex-shrink:0;padding:10px 14px;background:var(--surface);border-bottom:1px solid var(--line-soft);font-size:.86em;color:var(--accent-deep);display:flex;justify-content:space-between;align-items:center;gap:8px}
.preview-header .pv-title{display:inline-flex;align-items:center;gap:6px;font-weight:600}
.preview-header .pv-title svg{width:15px;height:15px;color:var(--accent)}
.preview-header .pv-export{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-soft);color:var(--muted);cursor:pointer;transition:all .15s}
.preview-header .pv-export:hover{background:var(--surface);color:var(--accent-deep);border-color:var(--accent-border)}
.preview-header .pv-export svg{width:15px;height:15px}
.preview-body{flex:1;overflow-y:auto;padding:14px;min-height:0;-webkit-overflow-scrolling:touch}
.pv-section{background:var(--surface);border:1px solid var(--line-soft);border-radius:var(--radius);padding:13px 15px;margin-bottom:11px;transition:all .2s cubic-bezier(.4,0,.2,1);position:relative;overflow:hidden}
.pv-section::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--accent-soft),transparent);opacity:0;transition:opacity .25s ease}
.pv-section:hover{box-shadow:0 8px 24px rgba(15,23,42,.08),0 2px 6px rgba(15,23,42,.04);border-color:var(--accent-soft);transform:translateY(-1px)}
.pv-section:hover::before{opacity:1}
.pv-section h3{font-size:.86em;color:var(--accent-deep);margin-bottom:9px;display:flex;align-items:center;gap:6px;justify-content:space-between;padding-bottom:7px;border-bottom:1px solid var(--line-soft);transition:border-color .2s}
.pv-section:hover h3{border-color:var(--accent-soft)}
.pv-section h3 .sec-left{display:flex;align-items:center;gap:6px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-section h3 .sec-right{font-size:.8em;color:var(--muted);font-weight:400;flex-shrink:0;display:inline-flex;align-items:center;gap:5px}
.pv-section .pv-content{font-size:.86em;color:var(--ink-soft);line-height:1.7;white-space:pre-wrap;word-break:break-word}
.pv-section.collapsed .pv-content,.pv-section.collapsed .pv-entry-list,.pv-section.collapsed .pv-sub{max-height:0;overflow:hidden;margin:0;padding:0}
.pv-section .pv-toggle{cursor:pointer;font-size:.82em;color:var(--muted);user-select:none;flex-shrink:0;padding:0 4px;transition:color .2s}
.pv-section:hover .pv-toggle{color:var(--accent-deep)}
.pv-section .pv-toggle::before{content:'▾';display:inline-block;transition:transform .25s cubic-bezier(.4,0,.2,1)}
.pv-section.collapsed .pv-toggle::before{transform:rotate(-90deg)}
.pv-section .pv-empty{color:var(--muted);font-style:italic;font-size:.82em}
.pv-editable{border-radius:var(--radius-sm);transition:background .18s ease,box-shadow .18s ease;position:relative}
.pv-editable:hover{background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent-border)}
.pv-edit-hint{font-size:.7em;color:var(--muted);cursor:pointer;flex-shrink:0;opacity:.6;transition:opacity .18s}
.pv-edit-hint:hover{opacity:1}
.pv-section .pv-entry{background:var(--surface-soft);padding:0;border-radius:var(--radius-sm);margin-bottom:8px;border-left:3px solid var(--accent-soft);transition:all .18s ease}
.pv-section .pv-entry:last-child{margin-bottom:0}
.pv-section .pv-entry:hover{background:var(--surface);border-left-color:var(--accent);box-shadow:0 2px 8px rgba(15,23,42,.05)}
.pv-section .pv-entry summary{cursor:pointer;font-size:.84em;color:var(--accent-deep);font-weight:600;padding:10px 12px;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:6px;transition:color .18s ease,background .18s ease;border-radius:0 var(--radius-sm) var(--radius-sm) 0}
.pv-section .pv-entry summary:hover{color:var(--accent)}
.pv-section .pv-entry summary::-webkit-details-marker{display:none}
.pv-section .pv-entry summary::before{content:'▸';color:var(--muted);font-size:.9em;transition:transform .25s cubic-bezier(.4,0,.2,1);flex-shrink:0}
.pv-section .pv-entry[open] summary::before{transform:rotate(90deg);color:var(--accent)}
/* —— 预览面板条目折叠头的悬浮删除按钮（不用点进去编辑弹窗再删）—— */
.pv-entry-summary-main{flex:1;min-width:0;display:inline-flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis}
.pv-entry-summary-tags{flex-shrink:0;display:inline-flex;align-items:center;gap:6px}
.pv-entry-del{flex-shrink:0;display:none;align-items:center;justify-content:center;width:20px;height:20px;border:none;border-radius:4px;background:transparent;color:var(--muted);cursor:pointer;font-size:12px;line-height:1;padding:0;margin-left:2px}
.pv-section .pv-entry summary:hover .pv-entry-del{display:inline-flex}
.pv-entry-del:hover{background:var(--terra-soft);color:var(--terra-text)}
/* —— 预览-世界书：搜索/筛选/批量操作工具条 —— */
.pv-filter-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 2px 8px}
.pv-f-search{flex:1 1 140px;min-width:120px;padding:5px 10px;font-size:.78em;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink)}
.pv-f-search:focus{outline:none;border-color:var(--accent-border);box-shadow:0 0 0 2px var(--accent-soft)}
.pv-f-kind,.pv-f-group{padding:5px 8px;font-size:.76em;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink-soft);cursor:pointer;max-width:130px}
.pv-f-batch{padding:5px 12px;font-size:.76em;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink-soft);cursor:pointer;transition:all .18s;flex-shrink:0}
.pv-f-batch:hover{border-color:var(--accent-border);color:var(--accent-deep)}
.pv-f-batch.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.pv-batch-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;margin:0 0 8px;background:var(--accent-soft);border:1px solid var(--accent-border);border-radius:var(--radius-sm);font-size:.76em}
.pv-batch-bar button{padding:4px 10px;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--ink-soft);cursor:pointer;font-size:1em;transition:all .15s}
.pv-batch-bar button:hover{border-color:var(--accent-border);color:var(--accent-deep)}
.pv-batch-bar button.danger{color:var(--terra-text)}
.pv-batch-bar button.danger:hover{background:var(--terra-soft);border-color:var(--terra-text)}
.pv-batch-bar select{padding:3px 6px;font-size:1em;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--ink-soft)}
.pv-batch-all{display:inline-flex;align-items:center;gap:4px;color:var(--ink-soft);cursor:pointer;font-weight:600}
.pv-batch-count{margin-left:auto;color:var(--muted);white-space:nowrap}
.pv-batch-check{flex-shrink:0;width:14px;height:14px;cursor:pointer;accent-color:var(--accent);margin:0 4px 0 2px}
.pv-entry.selected{border-left-color:var(--accent);background:var(--accent-soft)}
.pv-tag.grp{background:var(--sage-soft-strong);color:var(--sage-text)}
.pv-section .pv-entry .pv-entry-body{padding:0 12px 10px 12px}
.pv-section .pv-entry-content{font-size:.82em;color:var(--ink-soft);white-space:pre-wrap;word-break:break-word;line-height:1.65}
/* 合并 diff 闪光：新增=绿，更新=琥珀；3.2s 淡出，仅提示不打扰 */
.pv-entry.pv-flash-add{animation:pvFlashAdd 3.2s ease-out;border-left-color:#34a86b}
.pv-entry.pv-flash-upd{animation:pvFlashUpd 3.2s ease-out;border-left-color:#d9922b}
@keyframes pvFlashAdd{0%{background:#dff7e9;box-shadow:0 0 0 2px rgba(52,168,107,.45)}100%{background:transparent;box-shadow:none}}
@keyframes pvFlashUpd{0%{background:#fdf0da;box-shadow:0 0 0 2px rgba(217,146,43,.45)}100%{background:transparent;box-shadow:none}}
@media (prefers-reduced-motion: reduce){.pv-entry.pv-flash-add,.pv-entry.pv-flash-upd{animation:none}}
.pv-section .pv-code{font-family:var(--font-mono);font-size:.8em;color:var(--ink);background:linear-gradient(135deg,var(--surface-soft) 0%,var(--surface) 100%);border:1px solid var(--line-soft);border-radius:var(--radius-sm);padding:10px 12px;white-space:pre-wrap;word-break:break-all;line-height:1.6;max-height:260px;overflow:auto;transition:border-color .2s,box-shadow .2s}
.pv-section .pv-code:hover{border-color:var(--accent-soft);box-shadow:inset 0 1px 3px rgba(79,70,229,.04)}
.pv-section .pv-tag{display:inline-flex;align-items:center;font-size:.76em;padding:3px 10px;border-radius:999px;background:linear-gradient(135deg,var(--accent-soft) 0%,rgba(79,70,229,.1) 100%);color:var(--accent-deep);border:1px solid var(--accent-border);margin:0 6px 6px 0;white-space:nowrap;font-weight:500;transition:all .18s ease;letter-spacing:.2px}
.pv-section .pv-tag:hover{transform:translateY(-1px);box-shadow:0 3px 10px rgba(79,70,229,.12)}
.pv-section .pv-tag.off{color:var(--muted);background:linear-gradient(135deg,var(--surface-soft),var(--surface));border-color:var(--line-soft)}
.pv-section .pv-tag.off:hover{box-shadow:none;transform:none;border-color:var(--line)}
.pv-section .pv-tag.ok{color:var(--sage-text);background:linear-gradient(135deg,var(--sage-soft),rgba(22,163,74,.12));border-color:var(--sage-border)}
.pv-section .pv-tag.ok:hover{box-shadow:0 3px 10px rgba(22,163,74,.15)}
.pv-section .pv-mini-btn{font-size:.8em;padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--accent-deep);cursor:pointer;flex-shrink:0;transition:all .18s cubic-bezier(.4,0,.2,1);font-weight:500;display:inline-flex;align-items:center;gap:5px}
.pv-section .pv-mini-btn svg{width:13px;height:13px}
.pv-section .pv-mini-btn:hover{background:linear-gradient(135deg,var(--accent-soft),var(--surface));border-color:var(--accent-border);color:var(--accent);transform:translateY(-1px);box-shadow:0 4px 12px rgba(79,70,229,.1)}
.pv-sub{margin-top:7px}
.pv-book-name{font-size:.82em;color:var(--accent-deep);background:linear-gradient(135deg,var(--accent-soft),rgba(79,70,229,.1));padding:4px 12px;border-radius:999px;cursor:pointer;border:1px solid transparent;transition:all .2s ease;display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.pv-book-name:hover{border-color:var(--accent-border);transform:translateY(-1px);box-shadow:0 4px 12px rgba(79,70,229,.12)}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0;transition:all .2s ease}
.dot.full{background:linear-gradient(135deg,var(--sage),#22c55e);box-shadow:0 0 0 2px var(--sage-soft)}
.dot.empty{background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--line-soft)}
.progress-bar{height:5px;background:var(--line-soft);border-radius:999px;overflow:hidden;margin:5px 0}
.progress-bar-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--amber));transition:width .35s cubic-bezier(.4,0,.2,1);border-radius:999px;box-shadow:0 0 8px rgba(79,70,229,.2)}
.module-progress{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:5px}
.module-item{font-size:.82em;padding:7px 10px;background:var(--surface-soft);border-radius:var(--radius-sm);text-align:center;display:inline-flex;align-items:center;justify-content:center;gap:4px;line-height:1.4;transition:all .18s cubic-bezier(.4,0,.2,1);border:1px solid transparent}
.module-item svg{width:12px;height:12px;flex-shrink:0;transition:transform .18s ease}
.module-item:hover{background:var(--surface);box-shadow:0 4px 12px rgba(15,23,42,.08);transform:translateY(-1px)}
.module-item:hover svg{transform:scale(1.1)}
.module-item.done{color:var(--sage-text);background:linear-gradient(135deg,var(--sage-soft),rgba(22,163,74,.12));border:1px solid var(--sage-border);font-weight:500}
.module-item.done:hover{box-shadow:0 4px 12px rgba(22,163,74,.15)}
.module-item.partial{color:var(--amber-text);background:linear-gradient(135deg,var(--amber-soft),rgba(202,138,4,.12));border:1px solid var(--amber-border);font-weight:500}
.module-item.partial:hover{box-shadow:0 4px 12px rgba(202,138,4,.15)}
.module-item.todo{color:var(--muted);background:var(--surface-soft);border:1px solid var(--line-soft)}
.json-modal,.modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(15,23,42,.32);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:100001}
.modal-content{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);padding:16px;width:90%;max-width:800px;max-height:85vh;display:flex;flex-direction:column;box-shadow:var(--shadow-card)}
.modal-body{flex:1;overflow-y:auto;min-height:200px}
.welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px;overflow:auto}
.welcome h2{font-size:1.5em;color:var(--accent-deep);margin-bottom:14px;display:inline-flex;align-items:center;gap:9px;font-weight:700}
.welcome h2 .welcome-ic{color:var(--accent)}
.welcome p{color:var(--ink-soft);font-size:.88em;line-height:1.85;max-width:480px;margin-bottom:20px}
.welcome .start-btn{display:inline-flex;align-items:center;gap:8px;padding:13px 36px;background:var(--accent);color:#fff;border:none;border-radius:999px;font-size:.96em;font-weight:600;cursor:pointer;transition:all .3s;box-shadow:var(--shadow-soft)}
.welcome .start-btn svg{width:18px;height:18px}
.welcome .start-btn:hover{transform:translateY(-1px);background:var(--accent-deep);box-shadow:var(--shadow-card)}
.welcome-features{display:grid;grid-template-columns:repeat(2,1fr);gap:11px;margin:18px 0;max-width:480px}
.wf-item{background:var(--surface);border:1px solid var(--line-soft);border-radius:var(--radius);padding:13px;text-align:left;display:flex;gap:10px;align-items:flex-start;transition:box-shadow .2s,border-color .2s}
.wf-item:hover{box-shadow:var(--shadow-soft);border-color:var(--accent-soft)}
.wf-icon{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;background:var(--accent-soft);color:var(--accent-deep);flex-shrink:0}
.wf-icon svg{width:18px;height:18px}
.wf-copy{min-width:0}
.wf-title{font-size:.8em;color:var(--accent-deep);font-weight:600;margin-bottom:3px}
.wf-desc{font-size:.72em;color:var(--ink-soft);line-height:1.45}
.qc-item{background:var(--surface-soft);border:1px solid var(--line-soft);border-radius:var(--radius-sm);padding:9px 11px;margin-bottom:7px}
.qc-item.pass{border-color:var(--sage-border)}
.qc-item.fail{border-color:var(--terra-border);background:var(--terra-soft)}
.qc-title{font-size:.78em;font-weight:600;display:flex;align-items:center;gap:6px;margin-bottom:3px}
.qc-pass{color:var(--sage)}
.qc-fail{color:var(--terra)}
.qc-desc{font-size:.72em;color:var(--ink-soft);line-height:1.5}
.qc-fix{font-size:.72em;color:var(--amber);margin-top:3px}
.opt-compare{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}
.opt-pane{background:var(--surface-soft);border:1px solid var(--line);border-radius:var(--radius-sm);padding:9px;font-size:.72em;line-height:1.55;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
.opt-pane.before{border-color:var(--line)}
.opt-pane.after{border-color:var(--sage-border)}
.opt-label{font-size:.72em;font-weight:600;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid var(--line-soft)}
.opt-label.before{color:var(--ink-soft)}
.opt-label.after{color:var(--sage-text)}
.opt-field-select{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
.opt-field-tag{padding:3px 9px;background:var(--surface-soft);border:1px solid var(--line);border-radius:var(--radius-sm);font-size:.72em;cursor:pointer;transition:all .2s}
.opt-field-tag.selected{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-deep)}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:11px;padding-top:11px;border-top:1px solid var(--line-soft);flex-shrink:0}
/* ===== statusblock 容器：Markdown 渲染后的样式 ===== */
.sb-wrap{display:block;margin-top:10px;padding:12px 14px;background:var(--surface-soft);border-radius:var(--radius);font-size:.88em;line-height:1.65;border:1px solid var(--line-soft)}
.sb-wrap h3{font-size:1em;color:var(--accent-deep);margin:4px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--line-soft)}
.sb-wrap h3:first-child{margin-top:0}
.sb-wrap h4{font-size:.95em;color:var(--accent-deep);margin:6px 0 4px}
.sb-wrap ul,.sb-wrap ol{margin:4px 0 6px 20px;padding:0}
.sb-wrap li{margin:3px 0;color:var(--ink-soft);line-height:1.55}
.sb-wrap li b,.sb-wrap li strong{color:var(--ink)}
.sb-wrap p{margin:4px 0;color:var(--ink-soft)}
.sb-wrap p b,.sb-wrap p strong{color:var(--accent-deep)}
.sb-wrap hr{border:none;border-top:1px solid var(--line-soft);margin:8px 0}
.sb-wrap blockquote{margin:6px 0;padding:4px 12px;border-left:3px solid var(--accent-soft);color:var(--ink-soft);background:var(--surface)}

/* ===== 美化包裹元素溢出保护：字体放大时不超出容器 ===== */
/* 覆盖 MVU 美化模板 (status-notice / loading-notice) 的内联样式，防止溢出 */
.status-notice, .loading-notice,
.chat-msg .bubble .status-notice,
.chat-msg .bubble .loading-notice{
  max-width:100% !important;
  width:100% !important;
  box-sizing:border-box !important;
  margin:8px 0 !important;
  overflow-wrap:break-word !important;
  word-break:break-word !important;
}
.status-notice > div, .loading-notice > div,
.status-notice > div > div, .loading-notice > div > div{
  max-width:100% !important;
  width:100% !important;
  box-sizing:border-box !important;
}
/* 美化模板的 summary/标题栏：不超宽、自适应 */
.status-notice summary, .loading-notice summary,
.status-notice summary > span:first-child,
.loading-notice summary > span:first-child{
  max-width:100% !important;
  width:100% !important;
  box-sizing:border-box !important;
  height:auto !important;
  min-height:34px;
}
/* 美化模板的内容面板：不超宽、自适应换行、高度跟随字体缩放（不锁死）*/
.status-notice > div > div:last-child,
.loading-notice > div > div:last-child,
.status-notice details > div,
.loading-notice details > div{
  max-width:100% !important;
  width:100% !important;
  box-sizing:border-box !important;
  max-height:calc(360px * var(--app-font-scale,1));
  overflow-y:auto;
  overflow-x:hidden;
  word-break:break-word;
  overflow-wrap:break-word;
}
/* 美化包裹内的 code/pre/table 元素：防止横向溢出，支持滚动 */
.status-notice pre, .loading-notice pre,
.status-notice code, .loading-notice code,
.status-notice table, .loading-notice table,
.sb-wrap pre, .sb-wrap code, .sb-wrap table{
  max-width:100% !important;
  overflow-x:auto !important;
  box-sizing:border-box !important;
  word-break:break-word !important;
  overflow-wrap:break-word !important;
}
.status-notice pre, .loading-notice pre,
.sb-wrap pre{
  white-space:pre-wrap !important;
}
/* 通用保护：气泡内任意元素(含美化包裹)最大宽度不超过气泡宽度 */
.chat-msg .bubble > *,
.chat-msg .bubble > * > *,
.chat-msg .bubble > * > * > *{
  max-width:100%;
  box-sizing:border-box;
}
.chat-msg .bubble{
  overflow-wrap:break-word;
  word-break:break-word;
  overflow:hidden;
}

/* ===== 上下文操作条：替代旧 mod-focus + mod-dash + mvu-info-panel 三件套 ===== */
.ctx-bar{flex-shrink:0;display:flex;align-items:center;gap:12px;padding:10px 14px;background:linear-gradient(180deg,var(--surface) 0%,var(--surface-soft) 100%);border-bottom:1px solid var(--line-soft);min-height:46px;position:relative}
.ctx-bar::after{content:'';position:absolute;bottom:0;left:14px;right:14px;height:1px;background:linear-gradient(90deg,transparent,var(--accent-soft),transparent);opacity:.6}
.ctx-stage{font-size:.8em;color:var(--muted);white-space:nowrap;flex-shrink:0;display:inline-flex;align-items:center;gap:6px;padding:4px 12px 4px 8px;background:var(--surface);border:1px solid var(--line-soft);border-radius:999px;box-shadow:0 1px 3px rgba(15,23,42,.03)}
.ctx-stage svg{width:13px;height:13px;color:var(--accent)}
.ctx-stage strong{color:var(--accent-deep);font-weight:600}
.ctx-actions{display:flex;align-items:center;gap:7px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.ctx-actions::-webkit-scrollbar{display:none}
.ctx-mod{display:inline-flex;align-items:center;gap:5px;padding:7px 13px;background:var(--surface);border:1px solid var(--line);border-radius:999px;font-size:.82em;color:var(--ink-soft);cursor:pointer;transition:all .18s cubic-bezier(.4,0,.2,1);white-space:nowrap;flex-shrink:0;font-weight:500;font-family:inherit;position:relative}
.ctx-mod svg{width:13px;height:13px;transition:transform .18s ease}
.ctx-mod:hover:not(:disabled){background:var(--surface);color:var(--accent-deep);border-color:var(--accent-border);box-shadow:0 4px 12px rgba(79,70,229,.1);transform:translateY(-1px)}
.ctx-mod:hover:not(:disabled) svg{transform:scale(1.1)}
.ctx-mod:active:not(:disabled){transform:translateY(0) scale(.98)}
.ctx-mod.done{color:var(--sage-text);background:linear-gradient(135deg,var(--sage-soft),rgba(22,163,74,.12));border-color:var(--sage-border);font-weight:500}
.ctx-mod.done:hover:not(:disabled){box-shadow:0 4px 12px rgba(22,163,74,.15);color:var(--sage-text)}
.ctx-mod.prog{color:var(--amber-text);background:linear-gradient(135deg,var(--amber-soft),rgba(202,138,4,.12));border-color:var(--amber-border);font-weight:500}
.ctx-mod.prog:hover:not(:disabled){box-shadow:0 4px 12px rgba(202,138,4,.15);color:var(--amber-text)}
.ctx-chip{display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border-radius:999px;font-size:.78em;font-weight:500;white-space:nowrap;flex-shrink:0;transition:all .18s ease;cursor:default}
.ctx-chip svg{transition:transform .18s ease}
.ctx-chip:hover svg{transform:scale(1.15)}
.ctx-chip.ok{color:var(--sage-text);background:linear-gradient(135deg,var(--sage-soft),rgba(22,163,74,.12));border:1px solid var(--sage-border)}
.ctx-chip.todo{color:var(--muted);background:var(--surface);border:1px solid var(--line)}
.ctx-chip.info{color:var(--accent-text);background:linear-gradient(135deg,var(--accent-soft),rgba(79,70,229,.12));border:1px solid var(--accent-border)}
/* 状态栏8步进度step方块 */
.sb-step{flex:1;min-width:38px;text-align:center;padding:5px 3px;font-size:.72em;font-weight:600;border-radius:8px;cursor:default;transition:all .18s cubic-bezier(.4,0,.2,1);display:inline-flex;align-items:center;justify-content:center;gap:3px;letter-spacing:.3px}
.sb-step:hover{transform:translateY(-1px)}
.sb-step.ok{background:linear-gradient(135deg,var(--sage) 0%,#22c55e 100%);color:#fff;border:1px solid var(--sage-border);box-shadow:0 2px 8px rgba(22,163,74,.2)}
.sb-step.ok svg{color:#fff}
.sb-step.ok:hover{box-shadow:0 4px 14px rgba(22,163,74,.28)}
.sb-step.todo{background:linear-gradient(135deg,var(--surface) 0%,var(--surface-soft) 100%);color:var(--muted);border:1px solid var(--line)}
.sb-step.todo:hover{border-color:var(--accent-soft);color:var(--ink-soft);box-shadow:0 2px 8px rgba(15,23,42,.06)}

.chat-input-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 6px 0}
.chat-input-hint{font-size:.76em;color:var(--muted);display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.chat-input-hint .kbd{display:inline-block;min-width:18px;padding:1px 6px;border-radius:5px;background:linear-gradient(180deg,var(--surface-soft),#fff);border:1px solid var(--line);border-bottom-width:2px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em;font-weight:600;color:var(--ink-soft);line-height:1.3;box-shadow:0 1px 0 rgba(15,23,42,.04)}
.chat-input-char-count{font-size:.78em;color:var(--muted);text-align:right;transition:color .2s;white-space:nowrap}
.chat-input-char-count.warn{color:var(--amber)}
.chat-input-char-count.over{color:var(--terra)}

.send-btn-pulse{animation:pulse-send 2s infinite}
@keyframes pulse-send{0%,100%{box-shadow:var(--shadow-soft)}50%{box-shadow:var(--shadow-card)}}

.welcome-actions{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;justify-content:center}
.welcome-actions .btn{flex:1;min-width:120px;max-width:180px}

.scroll-btns{position:absolute;right:12px;bottom:8px;display:flex;flex-direction:column;gap:3px;z-index:10;opacity:0;transition:opacity .2s;pointer-events:none}
.scroll-btns.show{opacity:1;pointer-events:auto}
.scroll-btns button{width:26px;height:26px;border-radius:50%;background:var(--surface);border:1px solid var(--line);color:var(--ink-soft);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;line-height:1;box-shadow:var(--shadow-soft)}
.scroll-btns button svg{width:14px;height:14px}
.scroll-btns button:hover{background:var(--accent);color:#fff;border-color:var(--accent)}

.import-dropzone{padding:22px;text-align:center;border:2px dashed var(--accent-soft);border-radius:var(--radius);margin-bottom:11px;cursor:pointer;transition:all .2s}
.import-dropzone:hover{border-color:var(--accent);background:var(--accent-soft-strong)}
.import-dropzone .dz-icon{display:inline-flex;color:var(--accent);margin-bottom:8px}
.import-dropzone .dz-icon svg{width:36px;height:36px}
.import-dropzone .dz-text{font-size:.78em;color:var(--ink-soft)}
.import-tabs{display:flex;gap:5px;margin-bottom:11px}
.import-tab{flex:1;padding:7px 9px;background:var(--surface-soft);border:1px solid var(--line-soft);border-radius:var(--radius-sm);font-size:.75em;color:var(--ink-soft);cursor:pointer;text-align:center;transition:all .15s}
.import-tab.active{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-deep)}

/* Tab 切换器（角色卡 / MVU）*/
.tab-switcher{display:flex;gap:3px;padding:4px;background:linear-gradient(135deg,var(--surface-soft) 0%,var(--surface-sink) 100%);border:1px solid var(--line-soft);border-radius:10px;flex-shrink:0;box-shadow:inset 0 1px 3px rgba(15,23,42,.04)}
.tab-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:transparent;border:none;border-radius:7px;font-size:.78em;color:var(--ink-soft);cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1);font-weight:600;font-family:inherit;white-space:nowrap;position:relative}
.tab-btn .tab-icon{display:inline-flex;color:inherit}
.tab-btn .tab-icon svg{width:14px;height:14px;transition:transform .2s ease}
.tab-btn:hover:not(.active){color:var(--accent-deep);background:rgba(255,255,255,.5)}
.tab-btn:hover:not(.active) .tab-icon svg{transform:scale(1.1)}
.tab-btn.active{background:linear-gradient(135deg,var(--surface),#fff);color:var(--accent-deep);box-shadow:0 3px 10px rgba(15,23,42,.08),0 1px 2px rgba(15,23,42,.04);font-weight:700}
.tab-btn.active::after{content:'';position:absolute;bottom:0;left:20%;right:20%;height:2px;background:linear-gradient(90deg,var(--accent),var(--accent-deep));border-radius:2px 2px 0 0}

.wv-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
.wv-stat{background:var(--surface-soft);border:1px solid var(--line-soft);border-radius:var(--radius-sm);padding:7px 9px;text-align:center}
.wv-stat .wv-stat-val{font-size:1.1em;font-weight:700;display:block}
.wv-stat .wv-stat-lbl{font-size:.72em;color:var(--ink-soft);display:block;margin-top:2px}
.wv-legend{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;font-size:.72em}
.wv-legend-item{display:flex;align-items:center;gap:3px;color:var(--ink-soft)}
.wv-legend-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.wv-entry{background:var(--surface-soft);border:1px solid var(--line-soft);border-radius:var(--radius-sm);padding:7px 9px;margin-bottom:6px;border-left:3px solid var(--accent-soft)}
.wv-entry-header{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap}
.wv-entry-name{font-size:.78em;font-weight:600;color:var(--ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wv-entry-level{font-size:.72em;padding:2px 8px;border-radius:var(--radius-sm);font-weight:600;white-space:nowrap}
.wv-entry-token{font-size:.72em;color:var(--ink-soft);flex-shrink:0}
.wv-entry-meta{display:flex;flex-wrap:wrap;gap:4px;font-size:.72em;color:var(--ink-soft)}
.wv-entry-meta .wv-tag{background:var(--surface);border:1px solid var(--line-soft);border-radius:var(--radius-sm);padding:1px 6px;white-space:nowrap}
.wv-entry-meta .wv-tag.const{color:var(--sage-text);border-color:var(--sage-border)}
.wv-entry-meta .wv-tag.trig{color:var(--accent-deep);border-color:var(--accent-border)}
.wv-entry-meta .wv-tag.dyn{color:var(--amber-text);border-color:var(--amber-border)}
.wv-entry-meta .wv-tag.warn{color:var(--terra-text);border-color:var(--terra-border)}
.wv-group-header{font-size:.72em;font-weight:600;color:var(--accent-deep);margin:8px 0 4px;padding-bottom:3px;border-bottom:1px solid var(--line-soft);display:flex;justify-content:space-between;align-items:center}
.wv-group-count{font-size:.85em;color:var(--ink-soft);font-weight:400}


.group-mgr-list{margin:8px 0}
.group-mgr-item{display:flex;align-items:center;gap:6px;padding:6px 9px;background:var(--surface-soft);border:1px solid var(--line-soft);border-radius:8px;margin-bottom:5px;font-size:.72em}
.group-mgr-item .gm-color{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.group-mgr-item .gm-name{flex:1;color:var(--ink);font-weight:600}
.group-mgr-item .gm-count{color:var(--ink-soft);font-size:.85em}
.group-mgr-item .gm-toggle{padding:3px 9px;border-radius:7px;font-size:.85em;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink-soft);transition:all .15s}
.group-mgr-item .gm-toggle.on{background:var(--sage-soft-strong);color:var(--sage-text);border-color:var(--sage-border)}
@media(max-width:768px){
  /* 移动端：对话/预览两面板横向并排等宽，靠 transform 滑入滑出（左滑进预览、右滑回对话）；
     垂直滚动交给原生（touch-action:pan-y），水平滑动由手势脚本接管 */
  .main{touch-action:pan-y}
  .chat-panel,.preview-panel{flex:0 0 100%;max-width:100%;width:100%;border:none;min-height:0;transition:transform .28s cubic-bezier(.22,.61,.36,1);will-change:transform}
  /* 行排中 chat 自然位[0,w]、preview 自然位[w,2w]（已在屏外），故初始无需位移；
     切到预览时两页同时 translateX(-100%)：chat→[-w,0]、preview→[0,w] */
  .preview-panel{display:flex}
  .main.tab-preview .chat-panel{transform:translateX(-100%)}
  .main.tab-preview .preview-panel{transform:translateX(-100%)}
  .main.swiping .chat-panel,.main.swiping .preview-panel{transition:none}
  .topbar h1{font-size:.9em}
  .topbar .phase{font-size:.7em}
  .chat-msg .bubble{max-width:78%}
  .opt-compare{grid-template-columns:1fr}
  .quick-actions{max-height:70px}
}
@media(max-height:500px){
  .topbar{padding:6px 10px}
  .topbar h1{font-size:.85em;margin:0}
  .topbar .phase{font-size:.7em}
  .ctx-bar{padding:5px 10px;min-height:36px}
  .ctx-mod{font-size:.72em;padding:4px 8px}
  .chat-input-area{padding:6px 10px;gap:4px}
  .chat-input{min-height:36px;padding:6px;max-height:120px}
  .quick-actions{gap:4px}
  .quick-btn{font-size:.7em;padding:4px 8px}
  .preview-panel .preview-header{padding:6px 10px;font-size:.8em}
  .pv-section h3{font-size:.78em;margin-bottom:2px}
  .pv-section{padding:6px 10px}
  .pv-content{font-size:.72em;line-height:1.4}
.modal-content{padding:10px;max-height:90vh}
  .modal-body{max-height:60vh}
}
@media(orientation:landscape) and (max-height:600px){
  .app{height:100%;height:100vh}
  .topbar{padding:5px 8px;min-height:32px;padding-top:max(5px,env(safe-area-inset-top));padding-left:max(8px,env(safe-area-inset-left));padding-right:max(8px,env(safe-area-inset-right))}
  .topbar h1{font-size:.85em}
  .ctx-bar{padding:4px 8px;min-height:34px}
  .ctx-mod{font-size:.7em;padding:3px 8px}
  .chat-input-area{padding:4px 8px;gap:3px;padding-bottom:max(4px,env(safe-area-inset-bottom))}
  .chat-input{min-height:32px;padding:5px;font-size:.85em;max-height:110px}
  .btn-send{width:34px;height:34px}
  .quick-actions{gap:3px;max-height:60px}
  .quick-btn{font-size:.68em;padding:3px 6px}
  .pv-section{padding:4px 8px}
  .pv-section h3{font-size:.78em}
  .pv-content{font-size:.72em;line-height:1.4}
  .welcome{padding:16px}
  .welcome h2{font-size:1.1em;margin-bottom:6px}
  .welcome p{font-size:.8em;margin-bottom:8px}
}
/* ===== 平板端精细适配（481px-768px）===== */
@media(min-width:481px) and (max-width:768px){
  .chat-panel{flex:1.3 1 0}
  .preview-panel{flex:1 1 0}
  .chat-msg .bubble{max-width:80%}
  .quick-actions{gap:5px;padding:6px 10px}
  .quick-btn{font-size:11px;padding:5px 10px}
  .qa-mini{font-size:11px;padding:5px 10px}
  .pv-section .pv-entry summary{padding:6px 10px}
  .pv-section .pv-entry-content{font-size:.72em}
  .welcome-features{grid-template-columns:repeat(2,1fr);gap:12px}
  .wf-item{padding:12px}
  /* tab-switcher：平板端适中 */
  .tab-switcher{padding:4px 8px;gap:3px}
  .tab-btn{padding:5px 10px;font-size:.78em}
  /* ctx-bar：平板端适中 */
  .ctx-bar{padding:6px 12px}
  .ctx-mod{font-size:.76em;padding:4px 10px}
  /* 模块进度：平板端4列保持 */
  .module-progress{grid-template-columns:repeat(4,1fr);gap:6px}
  .module-item{font-size:.76em;padding:5px 6px}
  .module-item svg{width:11px;height:11px}
}
/* ===== 手机端精细适配（≤480px）：追求"好用"而非"能用" ===== */
@media(max-width:480px){
  /* 安全区适配（刘海屏/全面屏）*/
  .app{padding-top:env(safe-area-inset-top,0);padding-left:env(safe-area-inset-left,0);padding-right:env(safe-area-inset-right,0);padding-bottom:env(safe-area-inset-bottom,0)}
  .topbar{padding:8px 12px;min-height:42px}
  .topbar h1{font-size:.88em}
  .topbar .phase{font-size:.68em}
  .topbar-right{gap:3px}
  /* 聊天气泡：手机端更宽，提升阅读体验 */
  .chat-messages{padding:10px 6px}
  .chat-msg .bubble{max-width:88%;font-size:.88em;padding:8px 11px}
  .chat-msg.assistant .bubble{font-size:.92em}
  .chat-msg .avatar{width:64px;height:64px;font-size:32px;border-radius:12px}
  /* 输入区：防止 iOS 聚焦缩放（≥16px），增大触摸区 */
  .chat-input-area{padding:8px 10px;padding-bottom:max(8px,env(safe-area-inset-bottom))}
  .chat-input{font-size:16px;min-height:42px;padding:10px 14px;border-radius:12px;max-height:160px}
  .btn-send{width:42px;height:42px;border-radius:12px}
  /* 手机端：无实体 Ctrl 键，隐藏快捷键提示，字符计数居中 */
  .chat-input-hint{display:none}
  .chat-input-foot{justify-content:flex-end}
  /* 快捷按钮：手机端横向滚动，避免拥挤换行 */
  .quick-actions{gap:5px;padding:6px 8px;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;max-height:none;-webkit-overflow-scrolling:touch}
  .quick-actions::-webkit-scrollbar{display:none}
  .quick-btn{font-size:11.5px;padding:6px 12px;min-height:32px;white-space:nowrap}
  .qa-mini{font-size:11.5px;padding:6px 10px;min-height:32px}
  /* 预览面板：手机端全屏切换 */
  .preview-panel .preview-header{padding:8px 10px;font-size:.86em}
  .pv-section{padding:10px 11px}
  .pv-section h3{font-size:.84em}
  .pv-section .pv-entry summary{padding:7px 9px}
  .pv-section .pv-entry-content{font-size:.78em;line-height:1.55}
  .pv-section .pv-code{font-size:.76em;padding:7px}
  .pv-section .pv-tag{font-size:.74em;padding:2px 7px}
  .pv-section .pv-mini-btn{font-size:.74em;padding:5px 10px;min-height:30px}
  /* 欢迎页：手机端单列 */
  .welcome{padding:16px 12px}
  .welcome h2{font-size:1.15em;margin-bottom:10px}
  .welcome p{font-size:.82em;line-height:1.7;max-width:100%}
  .welcome .start-btn{padding:14px 36px;font-size:1em;border-radius:28px}
  .welcome-features{grid-template-columns:1fr;gap:8px;max-width:100%}
  .wf-item{padding:10px}
  .wf-icon{font-size:1.2em}
  .wf-title{font-size:.82em}
  .wf-desc{font-size:.7em}
  /* 选项对比：手机端单列 */
  .opt-compare{grid-template-columns:1fr;gap:6px}
  .opt-pane{max-height:240px;font-size:.74em}
  /* 关闭按钮：避开刘海 */
  /* 模块进度：手机端2列 */
  .module-progress{grid-template-columns:repeat(2,1fr);gap:6px}
  .module-item{font-size:.76em;padding:5px 6px}
  /* 模态框：手机端全屏化 */
.modal-content{width:96%;max-width:none;padding:12px;border-radius:10px;max-height:92vh}
  .modal-body{max-height:70vh}
  /* 群组管理：手机端紧凑 */
  .group-mgr-item{padding:6px 8px}
  .group-mgr-item .gm-name{font-size:.88em}
  .group-mgr-item .gm-count{font-size:.78em}
  .group-mgr-item .gm-toggle{font-size:.78em;padding:3px 9px;min-height:30px}
  /* mobile 指示器已移除：面板切换改为左右滑动手势 */
  /* tab-switcher：手机端紧凑 + 更大触摸区 */
  .tab-switcher{padding:3px 6px;gap:3px}
  .tab-btn{padding:6px 10px;font-size:.76em}
  .tab-btn .tab-icon svg{width:13px;height:13px}
  /* ctx-bar：手机端紧凑 */
  .ctx-bar{padding:6px 10px;min-height:40px}
  .ctx-mod{font-size:.74em;padding:5px 9px;min-height:30px}
  .ctx-chip{font-size:.7em;padding:3px 8px}
  /* 代码块/表格：手机端可横向滚动 */
  .chat-msg .bubble pre{font-size:.85em;max-height:180px}
  .chat-msg .bubble table{font-size:.85em}
  .chat-msg .bubble th,.chat-msg .bubble td{padding:4px 7px;min-width:50px}
}
/* ===== 触摸设备优化（pointer:coarse）===== */
@media(pointer:coarse){
  .quick-btn,.qa-mini,.btn,.pv-section .pv-mini-btn,.pv-book-name,.group-mgr-item .gm-toggle{cursor:default;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;user-select:none}
  .quick-btn:active:not(:disabled),.qa-mini:active:not(:disabled),.btn:active:not(:disabled){transform:scale(.96);transition:transform .1s}
  .chat-msg .bubble a{-webkit-tap-highlight-color:rgba(91,141,184,.2)}
}
/* ===== 大屏平板/桌面端优化（≥769px）===== */
@media(min-width:769px){
  .chat-panel{flex:1.4 1 0}
  .preview-panel{flex:1.1 1 0}
  .chat-msg .bubble{max-width:80%}
}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:var(--scrollbar-track)}
::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--accent-border-strong)}

/* Tab 隔离已由 updateCtxBar 按 activeTab 分支渲染，无需 CSS 切换 */

/* ===== 消息 section 分区（参考专家工作区设计）===== */
.cp-section{margin:6px 0;border-radius:var(--radius-sm);overflow:hidden}
.cp-section-header{display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;user-select:none;transition:background .15s;border-radius:var(--radius-sm)}
.cp-section-header:hover{background:var(--surface-sink)}
.cp-section-icon{width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;background:var(--surface-sink);color:var(--muted)}
.cp-section-label{font-size:.78em;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp-section-preview{font-size:.72em;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}
.cp-section-toggle{font-size:.68em;color:var(--accent);flex-shrink:0;padding:0 4px}
.cp-section-body{padding:8px 12px 10px 28px;font-size:.88em;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.cp-section-body.collapsed{display:none}
/* section 类型着色 */
.cp-section-thinking .cp-section-header{background:var(--amber-soft)}
.cp-section-thinking .cp-section-label,.cp-section-thinking .cp-section-icon{color:var(--amber-text)}
.cp-section-thinking .cp-section-body{color:var(--ink-soft);font-size:.85em;font-style:italic}
.cp-section-content .cp-section-header{background:var(--sage-soft)}
.cp-section-content .cp-section-label,.cp-section-content .cp-section-icon{color:var(--sage-text)}
.cp-section-code .cp-section-body{font-family:var(--font-mono);font-size:.82em;background:var(--surface-soft);border:1px solid var(--line-soft);border-radius:8px;margin:4px 8px 8px 28px;padding:10px 12px;tab-size:2;overflow-x:auto}
.cp-section-opblock .cp-section-header{background:var(--accent-soft)}
.cp-section-opblock .cp-section-label,.cp-section-opblock .cp-section-icon{color:var(--accent-text)}
.cp-opblock-pre{font-family:var(--font-mono);font-size:.82em;background:var(--surface-soft);border:1px solid var(--accent-border);border-radius:8px;margin:4px 8px 8px 28px;padding:10px 12px;tab-size:2;overflow-x:auto;white-space:pre-wrap;word-break:break-word;color:var(--ink-soft)}

/* ===== Work Toast 顶部工作提示 ===== */
.work-toast-layer{position:fixed;top:56px;left:50%;transform:translateX(-50%);width:min(340px,calc(100% - 32px));display:flex;flex-direction:column;gap:8px;z-index:200;pointer-events:none}
.work-toast{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:var(--radius);border:1px solid var(--line);background:var(--surface);color:var(--ink);box-shadow:var(--shadow-card);backdrop-filter:blur(8px);opacity:0;transform:translateY(-8px);transition:opacity .24s ease,transform .24s ease}
.work-toast.show{opacity:1;transform:translateY(0)}
.work-toast.is-working{border-color:var(--accent-border);background:color-mix(in srgb,var(--surface) 84%,var(--accent-soft));color:var(--accent-text)}
.work-toast.is-done{border-color:var(--sage-border);background:color-mix(in srgb,var(--surface) 84%,var(--sage-soft));color:var(--sage-text)}
.work-toast .wt-icon{width:18px;height:18px;flex-shrink:0}
.work-toast .wt-text{flex:1;font-size:.85em;font-weight:500}

/* ===== 工作区下拉菜单 ===== */
.ws-dropdown-wrap{position:relative;display:inline-block}
.ws-dropdown{position:absolute;top:100%;left:0;margin-top:4px;min-width:200px;max-height:480px;overflow-y:auto;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-float);z-index:150;padding:4px 0;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .18s ease,transform .18s ease}
.ws-dropdown.show{opacity:1;transform:translateY(0);pointer-events:auto}
.ws-dropdown-section{padding:6px 14px 4px;font-size:.68em;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.ws-dropdown-divider{height:1px;background:var(--line-soft);margin:4px 0}
.ws-dropdown-item{display:flex;align-items:center;gap:8px;padding:8px 14px;font-size:.82em;color:var(--ink-soft);cursor:pointer;transition:background .12s;border-radius:0}
.ws-dropdown-item:hover{background:var(--surface-sink);color:var(--ink)}
.ws-dropdown-item.active{color:var(--accent-deep);background:var(--accent-soft)}
.ws-dropdown-item svg{width:15px;height:15px;flex-shrink:0;opacity:.7}
.ws-dropdown-item:hover svg{opacity:1}
.ws-dropdown-item .ws-item-badge{margin-left:auto;font-size:.72em;padding:1px 6px;border-radius:4px;background:var(--accent-soft);color:var(--accent-deep)}
.ws-dropdown-item .ws-item-badge.done{background:var(--sage-soft);color:var(--sage-text)}
/* 工作区下拉中的字体控件展开栏 */
.ws-font-expand{padding:8px 14px 10px;background:var(--surface-soft);border-top:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft);margin:2px 0}
.ws-font-expand .ws-font-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;cursor:pointer;user-select:none;font-size:.78em;color:var(--ink-soft);font-weight:600}
.ws-font-expand .ws-font-header:hover{color:var(--accent-deep)}
.ws-font-expand .ws-font-arrow{display:inline-block;transition:transform .15s;font-size:.9em;margin-left:4px}
.ws-font-expand.collapsed .ws-font-arrow{transform:rotate(-90deg)}
.ws-font-expand.collapsed .ws-font-body{display:none}
.ws-font-body{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ws-font-ctrl{display:inline-flex;align-items:center;gap:3px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:2px 4px}
.ws-font-ctrl .ws-font-btn{height:26px;width:26px;font-size:.74em;font-weight:700;padding:0;color:var(--ink-soft);border:1px solid var(--line-soft);background:var(--surface-soft);border-radius:6px;cursor:pointer;font-family:inherit;transition:all .15s}
.ws-font-ctrl .ws-font-btn:hover:not(:disabled){background:var(--surface);color:var(--accent-deep);border-color:var(--accent-border)}
.ws-font-ctrl .ws-font-btn:disabled{opacity:.4;cursor:not-allowed}
.ws-font-ctrl .ws-font-size-label{font-size:.72em;color:var(--ink-soft);min-width:40px;text-align:center;font-weight:600}

/* ===== 手机竖版顶栏：始终保持单行，绝不换行；顶栏字号基准已固定14px，不随应用字体缩放变化 =====
   欢迎页顶栏无 .topbar--main 修饰类，不受以下规则影响 */
@media(max-width:560px){
  .topbar--main{flex-wrap:nowrap;gap:8px;padding:0 12px}
  .topbar--main .topbar-left{gap:6px;flex:0 1 auto;min-width:0}
  .topbar--main .topbar-right{gap:4px;margin-left:auto}
  /* 长副标题隐藏（分隔符已移入span内一并隐藏），Tab按钮已表达当前模式 */
  .topbar--main h1 span{display:none}
  .topbar--main h1{flex:0 1 auto;min-width:0;overflow:hidden}
  /* Tab 切换器收紧，保持 ≥32px 触摸高度 */
  .topbar--main .tab-switcher{padding:3px 6px;gap:2px}
  .topbar--main .tab-btn{padding:6px 10px;gap:5px}
  /* 「工作区」收为图标方块，文字以 title 提示 */
  .topbar--main #wsMenuWrap .icon-btn{width:32px;padding:0;font-size:0;gap:0}
  .topbar--main .phase{padding:4px 10px}
}
/* 窄屏竖版（≤480px，主流手机）：标题文字让位，仅留18px品牌图标槽，保证单行宽松不挤 */
@media(max-width:480px){
  .topbar--main{gap:4px;padding:0 8px}
  .topbar--main .topbar-left{gap:0}
  .topbar--main h1{flex:0 0 auto;width:18px;gap:0;font-size:0;overflow:hidden}
  .topbar--main .topbar-right{gap:3px}
  .topbar--main .tab-switcher{padding:3px 5px;gap:2px}
  .topbar--main .tab-btn{padding:6px 8px;gap:4px}
  .topbar--main .phase{padding:4px 7px}
  .topbar--main #wsMenuWrap .icon-btn,
  .topbar--main .icon-btn.icon-btn-square{width:30px;height:30px}
}
`;

  function showToast(msg, type) {
    type = type || 'info';
    if (type === 'warn') type = 'warning';
    try {
      if (window.parent && window.parent.toastr && window.parent.toastr[type]) window.parent.toastr[type](msg);
      else if (typeof toastr !== 'undefined' && toastr && toastr[type]) toastr[type](msg);
      else if (window.parent && window.parent.toastr) window.parent.toastr.info(msg);
      else alert(msg);
    } catch (e) {
      try {
        alert(msg);
      } catch (_) {
        console.log(msg);
      }
    }
  }

  // ============================================================================
  // 分级日志与空值守卫（SECTION 2 基础工具）
  //  - logWarn：可降级错误（图标缺失、解析回退等），仅 console 留痕，不打断用户
  //  - logError：严重错误（AI 响应解析/合并失败等），console 带 scope 输出 + 可选 toast
  // 空值兜底统一语义：safeStr→''，safeArr→[]，safeObj→{}
  // ============================================================================
  function logWarn(scope, err) {
    try {
      console.warn('[时之写卡器·' + scope + ']', err === undefined ? '' : err);
    } catch (_) {}
  }
  function logError(scope, err, userMsg) {
    try {
      console.error('[时之写卡器·' + scope + ']', err && err.stack ? err.stack : err);
    } catch (_) {}
    if (userMsg) {
      try {
        showToast(userMsg, 'error', 6000);
      } catch (_) {}
    }
  }
  function safeStr(v) {
    return v == null ? '' : String(v);
  }
  function safeArr(v) {
    return Array.isArray(v) ? v : [];
  }
  function safeObj(v) {
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  }

  // ============================================================================
  // SECTION 2  通用工具函数
  // ============================================================================
  // ===== Token估算 =====
  function countTokens(text) {
    if (!text) return 0;
    const t = String(text);
    const cn = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    const enWords = t.replace(/[\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean).length;
    return cn + Math.ceil(enWords * 0.75);
  }

  // ===== SvgIcons 组件系统 =====
  // 统一大小/描边，颜色继承 currentColor，与主题完美融合（参考文件7 stroke 风格）
  const SVG_PATHS = {
    // 通用操作
    close: 'M6 6l12 12M18 6L6 18',
    send: 'M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z',
    spinner: 'M21 12a9 9 0 1 1-6.219-8.56',
    arrowDown: 'M12 5v14M5 12l7 7 7-7',
    bolt: 'M13 2L3 14h7v8l10-12h-7V2z',
    download: 'M12 3v12m0 0l-4-4m4 4l4-4M5 21h14',
    folderOpen: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H5a2 2 0 0 0-2 2V7zm0 4l1.5 6a2 2 0 0 0 2 1.5h11A2 2 0 0 0 21 17l-1.5-6H3z',
    // 视图/导航
    chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z',
    clipboard: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM6 4h2v2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2V4h2',
    sliders: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5M14 4v4M6 10v4M11 16v4',
    chart: 'M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    // 状态
    check: 'M5 13l4 4L19 7',
    checkCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-5',
    alert: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8h.01M11 12h1v4h1',
    wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.4-2.4 2.1-2.1z',
    trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7',
    edit: 'M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
    save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
    refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
    // 模块/体系
    axiom: 'M12 2l9 5v10l-9 5-9-5V7l9-5zM12 2v20M3 7l9 5 9-5',
    handshake: 'M11 17l-2 2a2 2 0 0 1-3-3M13 17l2 2a2 2 0 0 0 3-3M3 12l3-3 4 1 2-2 2 2 4-1 3 3M3 12v3a2 2 0 0 0 2 2h1M21 12v3a2 2 0 0 1-2 2h-1',
    lock: 'M6 10V8a6 6 0 0 1 12 0v2M5 10h14a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a1 1 0 0 1 1-1z',
    target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    sword: 'M14 4l6 6-4 4-6-6V4h4zM5 19l3-3 3 3-3 3-3-3zM9 15l6-6',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5H6.5A2.5 2.5 0 0 0 4 19.5z',
    refreshCycle: 'M3 12a9 9 0 1 0 9-9M3 12l3-3M3 12l3 3',
    table: 'M5 4h14v16H5zM5 10h14M5 16h14M9 4v16M15 4v16',
    docVar: 'M8 3h7l5 5v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v6h6M10 13h6M10 17h4',
    // 角色/MVU
    mask: 'M3 12c0-4 4-7 9-7s9 3 9 7-4 7-9 7-9-3-9-7zM8 12h.01M16 12h.01M9 15c1 1 5 1 6 0',
    gauge: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 12l4-2M12 12l-3 4',
    sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
    play: 'M6 4l14 8-14 8V4z',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    fileExport: 'M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-4-5zM12 18v-6m0 0l-2 2m2-2l2 2',
    // 扩展图标（预览区/快捷动作专用）
    globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
    film: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
    scroll: 'M8 3h11a2 2 0 0 1 2 2v3h-3M8 3H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h3M8 3v18M19 8v11a2 2 0 0 1-2 2H8M12 8h4M12 12h4',
    layers: 'M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
    circle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    bot: 'M12 4v4M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 13h.01M15 13h.01M9 17h6',
    // 工作区图标
    code: 'M8 9l-3 3 3 3M16 9l3 3-3 3M14 5l-4 14',
    menu: 'M3 12h18M3 6h18M3 18h18',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
    // 头像菜单专用
    undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4',
    image: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 16l-5-5L5 21',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42'
  };

  /**
   * 渲染内联 SVG 图标。统一 viewBox=24，描边风格，颜色继承 currentColor。
   * @param {string} name SVG_PATHS 键名
   * @param {number|string} [size=18] 图标尺寸(px)
   * @param {string} [cls] 附加 class
   * @returns {string} 内联 SVG 字符串
   */
  function svgIcon(name, size, cls) {
    const path = SVG_PATHS[name];
    if (!path) return '';
    const s = (size == null ? 18 : size);
    const c = cls ? (' ' + cls) : '';
    // 圆形/方框型图标使用填充风格，其余使用描边风格（参考文件7统一风格）
    const filled = (name === 'checkCircle' || name === 'info' || name === 'alert' || name === 'sparkle' || name === 'play');
    if (filled) {
      return '<svg class="ic' + c + '" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="currentColor" aria-hidden="true"><path d="' + path + '"/></svg>';
    }
    return '<svg class="ic' + c + '" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
  }


  // ============================================================================
  // SECTION 2（续） 通用工具：Modal Iframe 创建与样式注入
  // ============================================================================
  // ===== Iframe创建 =====
  function createModalIframe() {
    return new Promise(function(resolve, reject) {
      try {
        const parentDoc = (window.parent && window.parent.document) ? window.parent.document : document;
        const old = parentDoc.getElementById(SCRIPT_ID + '-modal');
        if (old) old.remove();
        const iframe = parentDoc.createElement('iframe');
        iframe.id = SCRIPT_ID + '-modal';
        iframe.setAttribute('script_id', SCRIPT_ID);
        iframe.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;border:none;z-index:99999;background:#f6f2ea;';
        iframe.addEventListener('load', function() {
          try {
            const d = iframe.contentDocument || iframe.contentWindow.document;
            const s = d.createElement('style');
            s.textContent = IFRAME_CSS;
            d.head.appendChild(s);
            // viewport meta：确保移动端正确渲染（禁止缩放，支持 dvh）
            try {
              const vp = d.createElement('meta');
              vp.name = 'viewport';
              vp.content = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
              d.head.appendChild(vp);
              const charset = d.createElement('meta');
              charset.setAttribute('charset', 'UTF-8');
              d.head.appendChild(charset);
            } catch (e) { logWarn("createModalIframe", e); }
            resolve(d);
          } catch (e) {
            reject(e);
          }
        });
        parentDoc.body.appendChild(iframe);
        const _iframeTimer = setTimeout(function() {
          try {
            if (!iframe.contentDocument || !iframe.contentDocument.body) reject(new Error('iframe timeout'));
          } catch (e) {
            reject(e);
          }
        }, CONFIG.IFRAME_LOAD_TIMEOUT_MS);
        // ⚠️修复：正常 resolve/reject 后清理超时定时器（原先 timer 持有 iframe 引用最多延迟 4 秒回收，
        // 且 closeModal 后触发 reject 属于脏操作）
        const _origResolve = resolve,
          _origReject = reject;
        resolve = function(v) {
          clearTimeout(_iframeTimer);
          _origResolve(v);
        };
        reject = function(e) {
          clearTimeout(_iframeTimer);
          _origReject(e);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  function closeModal() {
    try {
      const pDoc = (window.parent && window.parent.document) ? window.parent.document : document;
      const m = pDoc.getElementById(SCRIPT_ID + '-modal');
      if (!m) return;
      // 1) iframe 内部软清理钩子（界面代码可挂载 window.__cwBeforeClose 主动清业务定时器/监听）
      try {
        const cw = m.contentWindow;
        if (cw && typeof cw.__cwBeforeClose === 'function') {
          try {
            cw.__cwBeforeClose();
          } catch (e) {
            logWarn('closeModal.hook', e);
          }
        }
      } catch (_) {}
      // 2) 导航到 about:blank：旧 iframe document/window 随之销毁，
      //    其内部 setInterval/setTimeout、事件监听、闭包引用一并释放（仅 remove() 不会终止定时器）
      try {
        m.src = 'about:blank';
      } catch (_) {}
      // 3) 移除 DOM
      m.remove();
    } catch (e) { logWarn("closeModal", e); }
  }

  // ⚠️修复（卸载清理不完整）：openEditor 把 __cardData / __getChatSessions / __getCurrentMessages 等
  // 访问器挂在脚本上下文的 window 上（弹窗 iframe 之外的持久 window）。弹窗关闭后这些全局仍持有
  // 整份 cardData + 双Tab聊天历史的强引用——每次"打开→关闭"泄漏一整份会话数据，直到脚本重载才释放。
  // 关闭弹窗（无后台生成时）与 pagehide 统一调用本函数切断引用。
  // 注意：有后台生成任务时不能立即释放（后台闭包经 window.__cardData 读写数据），此时保留，
  // 由下一次 openEditor 整体覆盖或脚本卸载时释放。
  function _releaseEditorGlobals() {
    try {
      if (typeof window === 'undefined') return;
      const keys = ['__cardData', '__tab_activeTab', '__getActiveTab', '__getCurrentTab',
        '__getCurrentMessages', '__setCurrentMessages', '__getChatSessions',
        '__setChatSessionsCardMessages', '__setChatSessionsMvuMessages',
        '__mvuDiscussMode', 'setMvuDiscussMode'
      ];
      for (let i = 0; i < keys.length; i++) {
        try {
          delete window[keys[i]];
        } catch (_) {
          try {
            window[keys[i]] = undefined;
          } catch (_2) {}
        }
      }
    } catch (_) {}
  }

  // ============================================================================
  // SECTION 3  卡片数据模板 + 世界书条目模板 + MVU 美化 HTML 模板
  // ============================================================================
  // ===== 世界书条目模板（通用标签默认配置 · 完整12项原生参数） =====
  // 参数体系：触发精准类(keys/secondary_keys/use_regex/match_whole_words/scan_depth)
  //          生效控制类(sticky/cooldown/delay) 递归安全类(prevent_recursion/exclude_recursion/delay_until_recursion)
  //          数量控制类(selectiveLogic/probability/use_probability) 分组管理类(group/groupWeight)
  // WI参数规范（对齐 ST world_info_logic / world_info_position）：
  //   scan_depth: 常驻=0（不扫描），触发类=3-8（限制关键词扫描的消息深度）
  //   useProbability: 常驻=false（无需概率掷骰），触发类=true（probability 才生效）
  //   group: 空字符串=无互斥分组（多条可共存）；非空=同组仅注入1条（用于叙事类互斥）
  //   selectiveLogic: 0=AND_ANY 1=NOT_ALL 2=NOT_ANY 3=AND_ALL（次级关键词逻辑，非随机选择）

  // ===== MVU 美化正则 HTML 模板（柔和高对比版本，括号内内容清晰可读）=====
  const MVU_BEAUTIFY_COMPLETE = '<div style="text-align:center;margin:10px 0;width:100%;max-width:680px">\n<div style="display:inline-block;width:100%;text-align:left">\n  <details class="status-notice" style="border:none;background:none;margin:0">\n    <summary style="list-style:none;cursor:pointer;display:flex;align-items:center;gap:0;padding:0;width:100%">\n      <span style="flex:1;display:flex;align-items:center;height:34px;padding:0 18px;background:linear-gradient(135deg,#f7fafd 0%,#eef3fb 100%);border:1px solid rgba(130,150,185,0.35);border-radius:14px;box-shadow:0 2px 8px rgba(130,155,190,0.12);position:relative;z-index:2">\n        <span style="flex:1;font-size:0.92em;font-weight:600;color:#2d3a52">变量完成</span>\n        <small style="font-size:0.78em;color:#556680;margin-left:10px"><span class="toggle-btn" data-close="展开 ▶" data-open="收起 ▼"></span></small>\n      </span>\n    </summary>\n    <!-- 内容面板：高对比浅灰蓝底+深灰字，确保括号/列表/JSON全部清晰 -->\n    <div style="width:100%;max-height:360px;overflow-y:auto;margin:7px 0 0 0;padding:12px 18px;color:#1f2937;line-height:1.78;white-space:pre-wrap;background:#f4f7fb;border:1px solid rgba(130,150,185,0.32);border-radius:12px;font-size:0.92em;box-shadow:0 2px 10px rgba(130,155,190,0.1)">\n    $1\n    </div>\n  </details>\n</div>\n</div>\n\n<style>\n  .status-notice summary::marker { display: none; }\n  .status-notice[open] > div { animation: slideUp 0.35s ease forwards; }\n  .status-notice[open] .toggle-btn::after { content: attr(data-open); }\n  .status-notice:not([open]) .toggle-btn::after { content: attr(data-close); }\n  /* 内容区嵌套元素增强：列表、括号、JSON代码块全部加强对比度 */\n  .status-notice ul, .status-notice ol { padding-left: 22px; color: #1f2937; }\n  .status-notice li { margin: 3px 0; color: #1f2937; }\n  .status-notice code, .status-notice pre { font-size: 0.88em; color: #111827; background: #e8eef7; border: 1px solid #c7d3e6; border-radius: 5px; padding: 2px 5px; }\n  .status-notice pre { padding: 8px 12px; overflow-x: auto; }\n  .status-notice strong, .status-notice b { color: #0f172a; }\n  @keyframes slideUp {\n    from { opacity: 0; transform: translateY(-6px); }\n    to { opacity: 1; transform: translateY(0); }\n  }\n</style>';

  const MVU_BEAUTIFY_THINKING = '<div style="text-align:center;margin:10px 0;width:100%;max-width:680px">\n<div style="display:inline-block;width:100%;text-align:left">\n  <details class="loading-notice" style="border:none;background:none;margin:0">\n    <summary style="list-style:none;cursor:pointer;display:flex;align-items:center;gap:0;padding:0;width:100%">\n      <span style="flex:1;display:flex;align-items:center;height:34px;padding:0 18px;background:linear-gradient(135deg,#f7fafd 0%,#eef3fb 100%);border:1px solid rgba(130,150,185,0.35);border-radius:14px;box-shadow:0 2px 8px rgba(130,155,190,0.12);position:relative;overflow:hidden;z-index:2">\n        <span style="flex:1;font-size:0.92em;font-weight:600;color:#2d3a52">正在变量更新</span>\n        <small style="font-size:0.78em;color:#556680;margin-left:10px"><span class="toggle-btn" data-close="展开 ▶" data-open="收起 ▼"></span></small>\n        <span class="flow-light" style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(130,160,210,0.12),transparent);animation:slide-flow 3s linear infinite;pointer-events:none"></span>\n      </span>\n    </summary>\n    <div style="width:100%;max-height:360px;overflow-y:auto;margin:7px 0 0 0;padding:12px 18px;color:#1f2937;line-height:1.78;white-space:pre-wrap;background:#f4f7fb;border:1px solid rgba(130,150,185,0.32);border-radius:12px;font-size:0.92em;box-shadow:0 2px 10px rgba(130,155,190,0.1)">\n    $1\n    </div>\n  </details>\n</div>\n</div>\n\n<style>\n  .loading-notice summary::marker { display: none; }\n  .loading-notice[open] .flow-light { animation: none; opacity: 0; }\n  .loading-notice[open] > div { animation: slideUp 0.35s ease forwards; }\n  .loading-notice[open] .toggle-btn::after { content: attr(data-open); }\n  .loading-notice:not([open]) .toggle-btn::after { content: attr(data-close); }\n  /* 内容区嵌套元素增强 */\n  .loading-notice ul, .loading-notice ol { padding-left: 22px; color: #1f2937; }\n  .loading-notice li { margin: 3px 0; color: #1f2937; }\n  .loading-notice code, .loading-notice pre { font-size: 0.88em; color: #111827; background: #e8eef7; border: 1px solid #c7d3e6; border-radius: 5px; padding: 2px 5px; }\n  .loading-notice pre { padding: 8px 12px; overflow-x: auto; }\n  .loading-notice strong, .loading-notice b { color: #0f172a; }\n  @keyframes slide-flow {\n    0% { transform: translateX(-100%); }\n    100% { transform: translateX(100%); }\n  }\n  @keyframes slideUp {\n    from { opacity: 0; transform: translateY(-6px); }\n    to { opacity: 1; transform: translateY(0); }\n  }\n</style>';

  // ===== MVU 状态栏 HTML 模板（用户模板标准：populateCharacterData + getAllVariables + eventOn + errorCatched）=====
  // 用途：渲染 <StatusPlaceHolderImpl/> 占位符为可视化状态栏
  // 配套正则：markdownOnly=true, promptOnly=false, runOnEdit=false, 用 ``` 代码块包裹（不指定语言）
  // MVU_STATUS_BAR_TEMPLATE：用户提供的标准模板（CSS和body为占位注释，由AI按需填充）
  // MVU_STATUS_BAR_HTML：兜底模板（填充默认CSS+自动遍历stat_data，AI未生成时使用）
  // 设计要点（对齐用户模板标准实现）：
  //   1. 完整 <!doctype html> 文档结构
  //   2. populateCharacterData() 函数：直接 getAllVariables() 读变量（不再用_getVars helper）
  //   3. 逐变量 $('#id').text(value) 手动填充（不再用renderTree递归渲染）
  //   4. eventOn(Mvu.events.VARIABLE_UPDATE_ENDED) 事件驱动刷新（不再用setInterval轮询）
  //   5. $(errorCatched(init)) 入口（不再用 $(async function(){try/catch}) ）
  //   6. await waitGlobalInitialized('Mvu') 等MVU就绪
  //   7. body内每个变量有唯一id
  //   8. 兜底模板自动遍历stat_data所有键填入#render-root（因兜底不知具体变量名）
  const MVU_STATUS_BAR_TEMPLATE = '<!doctype html>\n' +
    '<html lang="zh-CN">\n' +
    '<head>\n' +
    '  <style>\n' +
    '  body {\n' +
    '    margin: 0;\n' +
    '    padding: 0;\n' +
    '  }\n' +
    '\n' +
    '  /* 在这里根据用户要求的UI风格自由设计样式 */\n' +
    '  </style>\n' +
    '  <script type="module">\n' +
    '    function populateCharacterData() {\n' +
    '      const all_variables = getAllVariables();\n' +
    '\n' +
    '      // 注意：所有变量路径必须以 \'stat_data.\' 开头\n' +
    '\n' +
    '      // 普通变量\n' +
    '      const variable1 = _.get(all_variables, \'stat_data.xxx\', \'N/A\');\n' +
    '      $(\'#id1\').text(variable1);\n' +
    '\n' +
    '      // 数组类型变量（如背包、记忆列表）\n' +
    '      const items = _.get(all_variables, \'stat_data.背包\', []);\n' +
    '      const html = items.map(i => `<li>${i}</li>`).join(\'\');\n' +
    '      $(\'#items-list\').html(html);\n' +
    '\n' +
    '      // 对象类型变量（如NPCs）\n' +
    '      const npcs = _.get(all_variables, \'stat_data.NPCs\', {});\n' +
    '      Object.entries(npcs).forEach(([name, data]) => {\n' +
    '        const relation = _.get(data, \'关系值\', 0);\n' +
    '        console.log(`${name}: 关系${relation}`);\n' +
    '      });\n' +
    '\n' +
    '      // 嵌套对象（推荐使用可选链）\n' +
    '      const user = _.get(all_variables, \'stat_data.用户信息\', {});\n' +
    '      const weapon = user.法宝?.本命法宝 || \'无\';\n' +
    '      $(\'#weapon\').text(weapon);\n' +
    '\n' +
    '      // ... 更多变量\n' +
    '    }\n' +
    '\n' +
    '    async function init() {\n' +
    '      await waitGlobalInitialized(\'Mvu\');\n' +
    '      populateCharacterData();\n' +
    '\n' +
    '      // 监听变量更新事件，实现自动刷新\n' +
    '      eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => {\n' +
    '        populateCharacterData();\n' +
    '      });\n' +
    '\n' +
    '      $(\'.section-header\').on(\'click\', function () {\n' +
    '        toggleSection($(this));\n' +
    '      });\n' +
    '    }\n' +
    '\n' +
    '    $(errorCatched(init));\n' +
    '  </script>\n' +
    '</head>\n' +
    '<body>\n' +
    '  <!-- 在这里根据用户要求的UI风格自由设计HTML结构 -->\n' +
    '  <!-- 每个需要显示的变量必须有唯一的 id，在 populateCharacterData 中用 $(\'#id\').text(value) 填充 -->\n' +
    '</body>\n' +
    '</html>';
  const MVU_STATUS_BAR_HTML = MVU_STATUS_BAR_TEMPLATE;

  const ENTRY_TEMPLATES = {
    '世界元数据': {
      constant: true,
      selective: false,
      position: 0,
      depth: 0,
      order: 240,
      prevent_recursion: true,
      exclude_recursion: false,
      delay_until_recursion: 0,
      cooldown: null,
      delay: null,
      sticky: null,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 0,
      selectiveLogic: 0,
      probability: 100,
      useProbability: false,
      group: '',
      group_weight: 100
    },
    '状态栏': {
      constant: false,
      selective: true,
      position: 2,
      depth: 2,
      order: 35,
      sticky: null,
      cooldown: null,
      delay: null,
      prevent_recursion: false,
      exclude_recursion: false,
      delay_until_recursion: 0,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 3,
      selectiveLogic: 0,
      probability: 100,
      useProbability: true,
      group: '',
      group_weight: 100
    },
    '统一输出格式': {
      constant: true,
      selective: false,
      position: 0,
      depth: 1,
      order: 85,
      prevent_recursion: true,
      exclude_recursion: false,
      delay_until_recursion: 0,
      cooldown: null,
      delay: null,
      sticky: null,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 0,
      selectiveLogic: 0,
      probability: 100,
      useProbability: false,
      group: '',
      group_weight: 100
    },
    '角色边界': {
      constant: true,
      selective: false,
      position: 0,
      depth: 2,
      order: 80,
      prevent_recursion: true,
      exclude_recursion: false,
      delay_until_recursion: 0,
      cooldown: null,
      delay: null,
      sticky: null,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 0,
      selectiveLogic: 0,
      probability: 100,
      useProbability: false,
      group: '',
      group_weight: 100
    },
    '禁止项': {
      constant: true,
      selective: false,
      position: 0,
      depth: 3,
      order: 70,
      prevent_recursion: true,
      exclude_recursion: true,
      delay_until_recursion: 0,
      cooldown: null,
      delay: null,
      sticky: null,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 0,
      selectiveLogic: 0,
      probability: 100,
      useProbability: false,
      group: '',
      group_weight: 100
    },
    '自定义条目': {
      constant: false,
      selective: true,
      position: 1,
      depth: 4,
      order: 55,
      cooldown: null,
      delay: null,
      sticky: null,
      prevent_recursion: false,
      exclude_recursion: false,
      delay_until_recursion: 0,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 5,
      selectiveLogic: 0,
      probability: 100,
      useProbability: true,
      group: '',
      group_weight: 100
    },
    '[InitVar]初始变量': {
      constant: true,
      selective: false,
      position: 0,
      order: 100,
      insertion_order: 100,
      prevent_recursion: true,
      exclude_recursion: false,
      delay_until_recursion: 0,
      cooldown: null,
      delay: null,
      sticky: null,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 0,
      selectiveLogic: 0,
      probability: 100,
      useProbability: false,
      group: '',
      group_weight: 100,
      enabled: false
    },
    '变量列表': {
      constant: true,
      selective: false,
      position: 4,
      depth: 0,
      order: 200,
      prevent_recursion: true,
      exclude_recursion: false,
      delay_until_recursion: 0,
      cooldown: null,
      delay: null,
      sticky: null,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 0,
      selectiveLogic: 0,
      probability: 100,
      useProbability: false,
      group: '',
      group_weight: 100
    },
    '变量更新规则': {
      constant: true,
      selective: false,
      position: 4,
      depth: 0,
      order: 200,
      prevent_recursion: true,
      exclude_recursion: false,
      delay_until_recursion: 0,
      cooldown: null,
      delay: null,
      sticky: null,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 0,
      selectiveLogic: 0,
      probability: 100,
      useProbability: false,
      group: '',
      group_weight: 100
    },
    '变量输出格式': {
      constant: true,
      selective: false,
      position: 4,
      depth: 0,
      order: 200,
      prevent_recursion: true,
      exclude_recursion: false,
      delay_until_recursion: 0,
      cooldown: null,
      delay: null,
      sticky: null,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 0,
      selectiveLogic: 0,
      probability: 100,
      useProbability: false,
      group: '',
      group_weight: 100
    },
    '变量输出格式强调': {
      constant: true,
      selective: false,
      position: 4,
      depth: 0,
      order: 200,
      prevent_recursion: true,
      exclude_recursion: false,
      delay_until_recursion: 0,
      cooldown: null,
      delay: null,
      sticky: null,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 0,
      selectiveLogic: 0,
      probability: 100,
      useProbability: false,
      group: '',
      group_weight: 100,
      enabled: false
    },
    '状态变量输出': {
      constant: false,
      selective: true,
      position: 2,
      depth: 2,
      order: 45,
      sticky: null,
      cooldown: null,
      delay: null,
      prevent_recursion: false,
      exclude_recursion: false,
      delay_until_recursion: 0,
      use_regex: true,
      match_whole_words: null,
      scan_depth: 3,
      selectiveLogic: 0,
      probability: 100,
      useProbability: true,
      group: '',
      group_weight: 100,
      secondary_keys: []
    }
  };

  // ===== 权重等级映射（用于权重可视化预览） =====
  // 权重从低到高：极低/低/中低/中/中高/高/极高/最高
  const WEIGHT_LEVELS = {
    '世界元数据': {
      level: '极低',
      color: '#b3aa98',
      desc: 'position=0 常驻，底层背景'
    },
    '状态栏': {
      level: '极高',
      color: '#c98b7a',
      desc: 'position=2 depth=2 sticky粘性'
    },
    '统一输出格式': {
      level: '极低',
      color: '#b3aa98',
      desc: 'position=0 常驻'
    },
    '角色边界': {
      level: '极低',
      color: '#b3aa98',
      desc: 'position=0 常驻'
    },
    '禁止项': {
      level: '极低',
      color: '#b3aa98',
      desc: 'position=0 常驻，禁止规则'
    },
    '自定义条目': {
      level: '中',
      color: '#15803d',
      desc: '用户自定义'
    },
    '[InitVar]初始变量': {
      level: '极低',
      color: '#b3aa98',
      desc: '第2条 | position=0(before_character_definition) insertion_order=100 常驻(enabled=false)，MVU变量初始化YAML'
    },
    '变量列表': {
      level: '极低',
      color: '#b3aa98',
      desc: '第3条 | position=4(at_depth d=0) 常驻，注入当前变量值给LLM'
    },
    '[mvu_update]变量更新规则': {
      level: '低',
      color: '#667085',
      desc: '第4条 | position=4(at_depth d=0) 常驻，依据schema生成check/type/range'
    },
    '[mvu_update]变量输出格式': {
      level: '低',
      color: '#667085',
      desc: '第5条 | position=4(at_depth d=0) 常驻，固定YAML定义<UpdateVariable>输出格式'
    },
    '[mvu_update]变量输出格式强调': {
      level: '低',
      color: '#667085',
      desc: '第6条 | position=4(at_depth d=0) 默认enabled=false，AI不输出<UpdateVariable>时启用'
    },
    '<状态栏>占位符提醒': {
      level: '极低',
      color: '#b3aa98',
      desc: '第7条 | position=4(at_depth d=0) 常驻，提醒AI输出<StatusPlaceHolderImpl/>'
    },
    '状态变量输出': {
      level: '中',
      color: '#15803d',
      desc: 'position=2 触发，输出当前变量状态给LLM'
    }
  };


  function getEntryTemplate(comment) {
    if (!comment) return null;
    // 1. 支持 [InitVar]xxx 前缀格式（MVU变量系统，兼容大小写）
    const commentLower = comment.toLowerCase();
    if (commentLower.indexOf('[initvar]') === 0) {
      return ENTRY_TEMPLATES['[InitVar]初始变量'];
    }
    // 2. 支持 <xxx> 前缀格式（标准条目）
    const m = comment.match(/^<([^>]+)>/);
    if (m) {
      const key = m[1];
      if (ENTRY_TEMPLATES[key]) return ENTRY_TEMPLATES[key];
      const fuzzyMatch = Object.keys(ENTRY_TEMPLATES).find(function(k) {
        return key.indexOf(k) >= 0 || k.indexOf(key) >= 0;
      });
      if (fuzzyMatch) return ENTRY_TEMPLATES[fuzzyMatch];
    }
    // 3. 支持 MVU 变量系统条目（无需前缀，直接匹配关键字）
    if (commentLower.indexOf('[mvu_update]') >= 0) {
      if (comment.indexOf('变量更新规则') >= 0) return ENTRY_TEMPLATES['变量更新规则'];
      if (comment.indexOf('变量输出格式强调') >= 0) return ENTRY_TEMPLATES['变量输出格式强调'];
      if (comment.indexOf('变量输出格式') >= 0) return ENTRY_TEMPLATES['变量输出格式'];
    }
    if (comment.indexOf('变量列表') >= 0) return ENTRY_TEMPLATES['变量列表'];
    if (comment.indexOf('状态变量输出') >= 0) return ENTRY_TEMPLATES['状态变量输出'];
    // 第7条：<状态栏>占位符提醒条目（含"状态栏"+"占位符"或"提醒"）
    if (comment.indexOf('状态栏') >= 0 && (comment.indexOf('占位') >= 0 || comment.indexOf('提醒') >= 0)) {
      // 复用"状态栏"模板（selective触发式），但实际第7条应为constant=true常驻
      // 这里返回变量列表模板作为基础（constant=true, position=4, depth=0）
      return ENTRY_TEMPLATES['变量列表'];
    }
    // 4. 通用匹配：遍历模板键找最长匹配
    const keys = Object.keys(ENTRY_TEMPLATES);
    let bestKey = null;
    let bestLen = 0;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (comment.indexOf(k) >= 0 && k.length > bestLen) {
        bestKey = k;
        bestLen = k.length;
      }
    }
    if (bestKey) return ENTRY_TEMPLATES[bestKey];
    return null;
  }

  // ===== 剥去字符串最外层装饰括号（⟦⟧【】「」等，最多2层）=====
  // 顶层共享工具：_deriveEntryKeys 与 mergePartial 内的 normKey 共用（原先只在 mergePartial 内有局部定义，
  // 导致 _deriveEntryKeys 引用未定义函数而静默抛错，触发词自动派生全链路失效）
  function _stripOuterBrackets(s) {
    if (!s) return '';
    let r = String(s).trim();
    for (let iter = 0; iter < 2; iter++) {
      const pairs = [
        ['⟦', '⟧'],
        ['【', '】'],
        ['「', '」'],
        ['『', '』'],
        ['［', '］'],
        ['《', '》'],
        ['〈', '〉'],
        ['(', ')'],
        ['[', ']'],
        ['{', '}']
      ];
      let matched = false;
      for (let pi = 0; pi < pairs.length; pi++) {
        const L = pairs[pi][0],
          R = pairs[pi][1];
        if (r.length >= 4 && r.charAt(0) === L && r.charAt(r.length - 1) === R) {
          r = r.slice(1, -1).trim();
          matched = true;
          break;
        }
      }
      if (!matched) break;
    }
    return r;
  }

  // ===== 条目 comment 核心名提取：剥装饰括号 + 剥 [xxx]/<xxx> 前缀（可多层）=====
  // 用于判定 comment 是否为某个 MVU 系统条目"本体"，避免宽泛子串误伤普通条目
  // （如 <自定义条目>变量列表使用说明 的核心名是"变量列表使用说明"，不等于"变量列表"，不应被规范化）
  function _entryCommentCore(comment) {
    if (!comment) return '';
    let c = _stripOuterBrackets(String(comment)).trim();
    let prev = null;
    while (prev !== c) {
      prev = c;
      c = c.replace(/^\[[^\]]*\]\s*/, '').replace(/^<[^>]*>\s*/, '').trim();
    }
    return c;
  }

  // ===== 判定是否为 [InitVar] 初始变量条目（大小写不敏感）=====
  function _isInitVarComment(comment, content) {
    const c = String(comment || '');
    if (/^\s*\[initvar\]/i.test(c)) return true;
    const core = _entryCommentCore(c);
    if (core === '初始变量') return true;
    return core.indexOf('初始变量') === 0 && typeof content === 'string' && content.indexOf('stat_data') >= 0;
  }

  // ===== 判定是否为"变量列表"MVU条目 =====
  // ⚠️ 原先多处写成 comment 同时含"变量列表"和"format_message_variable"才识别——
  // 但 comment 本身就是"变量列表"，永远不含 format_message_variable，导致该条目在
  // 角色卡Tab过滤/MVU Tab收集/解析拦截三处全部漏网（隔离失效+重复建条）
  function _isVarListEntry(comment, content) {
    const c = String(comment || '');
    if (_entryCommentCore(c) === '变量列表') return true;
    if (c.indexOf('变量列表') >= 0) {
      const ct = String(content || '');
      // 新格式 <status_current_variables>null</...> 或旧宏 format_message_variable
      if (ct.indexOf('format_message_variable') >= 0 || ct.indexOf('status_current_variables') >= 0) return true;
    }
    return false;
  }

  // ===== 🔑 自动派生触发词（写卡器兜底防线 · 对齐 StageDog 绿灯/向量化/蓝灯策略）=====
  // 仅当 keys 为空时才派生；蓝灯(constant=true)与向量化(vectorized=true)保持空不变
  function _deriveEntryKeys(comment, tmpl, content) {
    if (!comment) return [];
    const template = tmpl || getEntryTemplate(comment);
    const isConst = template && template.constant === true;
    if (isConst) return []; // 蓝灯：constant常驻，保持空
    const stripped = _stripOuterBrackets(comment); // 先剥最外层装饰（⟦⟧【】等）
    const m = stripped.match(/^<([^>]+)>\s*([\s\S]*)$/); // <标签>名字后缀 → 取名字部分
    const prefix = m ? m[1] : '';
    const namePart = (m ? m[2] : stripped).trim();
    // 中文字符片段（2字以上，过滤<标签>、通用停用词）作为触发词种子
    const stopSet = {
      '的': 1,
      '是': 1,
      '有': 1,
      '我': 1,
      '你': 1,
      '他': 1,
      '她': 1,
      '它': 1,
      '在': 1,
      '和': 1,
      '了': 1,
      '与': 1,
      '及': 1,
      '个': 1,
      '相关': 1,
      '条目': 1,
      '内容': 1,
      '设定': 1,
      '体系': 1,
      '背景': 1,
      '机制': 1,
      '规则': 1,
      '玩法': 1,
      '流程': 1,
      '系统': 1,
      '功能': 1,
      '模块': 1,
      '部分': 1,
      '通用': 1,
      '主要': 1,
      '核心': 1,
      '基础': 1,
      '扩展': 1,
      '补充': 1,
      '细化': 1,
      '深度': 1,
      '类型': 1,
      '状态': 1,
      '当前': 1,
      '阶段': 1,
      '模式': 1
    };
    const candidates = [];
    // 1) 先提取 名字后缀中"·中文点号"切分出的多段，作为多维度命名（如 白娅·人际关系 → 白娅/人际关系）
    if (namePart) {
      namePart.split(/[·\/,，、\-\\]+/).forEach(function(seg) {
        const s = seg.trim();
        if (!s) return;
        if (/[\u4e00-\u9fa5A-Za-z0-9]{2,}/.test(s) && !stopSet[s]) candidates.push(s);
      });
    }
    // 2) 再从 content 前 N 字中抽取中文词组（2-6字）+ 典型实体特征词，去重追加
    const headContent = (content || '').slice(0, CONFIG.DERIVE_KEYWORD_HEAD_CHARS);
    try {
      const re = /[\u4e00-\u9fa5]{2,6}|[A-Za-z][A-Za-z0-9_]{1,15}/g;
      let mm;
      while ((mm = re.exec(headContent)) !== null) {
        const w = mm[0];
        if (stopSet[w]) continue;
        if (/^(姓名|身份|外貌|性格|背景|关系|人际关系|物品|地点|时间|年龄|特征|爱好|特长|家庭|称呼|位置|心情|智慧|魅力|体质|状态|好感度|好感|当前|内容|说明|描述|定义|介绍|概要|摘要|标签|以上|例如|比如|如果|因为|所以|但是|并且|或者|不是|还是|这是|一个|一种|一类|一下|一些|一起)$/.test(w)) continue;
        if (candidates.indexOf(w) < 0) candidates.push(w);
        if (candidates.length >= CONFIG.DERIVE_KEYWORD_MAX) break;
      }
    } catch (e) { logWarn("_deriveEntryKeys", e); }
    // 3) 根据 <标签前缀> 语义补齐语义锚点（典型触发词），和 StageDog 绿灯策略一致
    const categoryAnchors = {
      '自定义条目': []
    };
    if (prefix && categoryAnchors[prefix]) {
      categoryAnchors[prefix].forEach(function(a) {
        if (candidates.indexOf(a) < 0) candidates.push(a);
      });
    }
    if (candidates.length < 1 && namePart) candidates.push(namePart);
    // 去重 + 限制数量 3-10 个
    const uniq = [];
    for (let ci = 0; ci < candidates.length; ci++) {
      const c = String(candidates[ci]).trim();
      if (!c || c.length < 1 || c.length > 24) continue;
      if (uniq.indexOf(c) < 0) uniq.push(c);
      if (uniq.length >= 10) break;
    }
    return uniq;
  }

  // ===== 🧹 清洗 MVU 条目 content 中混入的条目配置字段（缩进感知版极简 YAML 解析）=====
  // AI 生成 [InitVar] 等 MVU 条目时，有时把整个条目当 YAML 对象输出，
  // 导致 content 正文里出现 enabled: false / content: | / comment: xxx 等配置字段。
  // 本函数只解析「缩进层级 + 根键值对 + 块字符串」三类语法，不依赖固定行号：
  //   · 识别根级（缩进0）content: | / > 块字符串，按块缩进反缩进提取正文，遇同级键即结束
  //   · content: 行内值直接采用
  //   · 其余根级配置字段（含其子缩进块/列表）整体剔除
  // 仅对 MVU 变量条目生效，其他条目原样返回；清洗结果为空时保留原文防数据丢失。
  function _stripEntryConfigFromContent(comment, content) {
    if (!content || typeof content !== 'string') return content;
    const c = (comment || '').toLowerCase();
    const isMvu = c.indexOf('[initvar]') >= 0 || c.indexOf('变量列表') >= 0 ||
      c.indexOf('变量更新规则') >= 0 || c.indexOf('变量输出格式') >= 0 ||
      c.indexOf('mvu_update') >= 0 || c.indexOf('状态变量输出') >= 0;
    if (!isMvu) return content;

    const lines = content.split(/\r?\n/);
    // 条目配置字段名（ST 世界书条目原生参数，不会作为 MVU 正文的业务键）
    const CONFIG_KEYS = {
      enabled: 1, content: 1, comment: 1, constant: 1, keys: 1, secondary_keys: 1,
      selective: 1, selectivelogic: 1, position: 1, depth: 1, order: 1, insertion_order: 1,
      use_regex: 1, probability: 1, sticky: 1, cooldown: 1, delay: 1, vectorized: 1,
      prevent_recursion: 1, exclude_recursion: 1, displayindex: 1, display_index: 1,
      uid: 1, name: 1, group: 1, group_weight: 1, useprobability: 1, scan_depth: 1,
      match_whole_words: 1, delay_until_recursion: 1, role: 1
    };
    // 行 -> {indent, key, value(冒号后原文), isKey}
    function parseLine(line) {
      const m = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s?(.*)$/);
      if (!m) return null;
      return { indent: m[1].replace(/\t/g, '  ').length, key: m[2].toLowerCase(), value: m[3] };
    }

    // 前置扫描：根级配置字段（仅看前 12 行且缩进为 0；正文业务 YAML 即使同名键也在更深缩进）
    let hasContentKey = false;
    const rootConfigSeen = {};
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const t = lines[i].trim();
      if (t === '' || t.charAt(0) === '#') continue;
      const p = parseLine(lines[i]);
      if (p && p.indent === 0 && CONFIG_KEYS[p.key]) {
        if (p.key === 'content') hasContentKey = true;
        rootConfigSeen[p.key] = 1;
      }
    }
    const rootConfigCount = Object.keys(rootConfigSeen).length;
    // 触发条件：出现 content 根键（条目被对象化的铁证），或 ≥2 个不同根级配置字段
    if (!hasContentKey && rootConfigCount < 2) return content;

    // 找根级 content 键
    let contentIdx = -1;
    let contentMeta = null;
    if (hasContentKey) {
      for (let i2 = 0; i2 < Math.min(lines.length, 12); i2++) {
        const p2 = parseLine(lines[i2]);
        if (p2 && p2.indent === 0 && p2.key === 'content') {
          contentIdx = i2;
          contentMeta = p2;
          break;
        }
      }
    }

    // 情况 A：content 块字符串（| / >，含可选 chomping 指示符 -/+）
    if (contentMeta && /^[|>][+-]?\s*$/.test(contentMeta.value.trim())) {
      let blockIndent = -1;
      for (let j = contentIdx + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') continue;
        const pm = lines[j].match(/^(\s*)\S/);
        blockIndent = pm ? pm[1].replace(/\t/g, '  ').length : 0;
        break;
      }
      if (blockIndent > 0) {
        const out = [];
        for (let j2 = contentIdx + 1; j2 < lines.length; j2++) {
          if (lines[j2].trim() === '') { out.push(''); continue; }
          const ind = (lines[j2].match(/^(\s*)/) || ['', ''])[1].replace(/\t/g, '  ').length;
          if (ind < blockIndent) break; // 同级或更浅的根键出现 → 块结束
          const expanded = lines[j2].replace(/\t/g, '  ');
          out.push(expanded.slice(blockIndent));
        }
        const result = out.join('\n').replace(/\s+$/g, '').trim();
        return result || content;
      }
    }

    // 情况 B：content 行内值（排除 | / > 块指示符——块内容缺失时交情况 C 处理）
    if (contentMeta && contentMeta.value.trim() !== '' && !/^[|>]/.test(contentMeta.value.trim())) {
      return contentMeta.value.trim();
    }

    // 情况 C：无 content 键（或块异常）——剔除根级配置字段行及其缩进子块，其余保留
    const kept = [];
    let skipUntilIndent = -1; // >0 时正在跳过某根级配置字段的嵌套内容
    for (let i3 = 0; i3 < lines.length; i3++) {
      const raw = lines[i3];
      const trimmed = raw.trim();
      const p3 = parseLine(raw);
      const ind = p3 ? p3.indent : ((raw.match(/^(\s*)/) || ['', ''])[1].replace(/\t/g, '  ').length);
      if (skipUntilIndent >= 0) {
        if (trimmed === '' || ind > skipUntilIndent || trimmed.charAt(0) === '-' ||
          trimmed.charAt(0) === '#') {
          continue;
        }
        skipUntilIndent = -1; // 回到根级，落到后续判定
      }
      if (p3 && p3.indent === 0 && CONFIG_KEYS[p3.key]) {
        skipUntilIndent = 0; // 跳过本行 + 后续更深缩进的子块/列表
        continue;
      }
      if (ind === 0 && (trimmed === '---' || trimmed === '...')) continue; // YAML 文档标记
      kept.push(raw);
    }
    const result2 = kept.join('\n').replace(/^\s+/, '').trim();
    return result2 || content;
  }

  // 判断条目是否属于MVU变量系统
  // 兼容大小写前缀：[InitVar]/[initvar]、[mvu_update] 等
  // 扩展：包含8条工作流条目 + 附加条目（阶段判定/人设切换/派生字段/状态机/联动规则等）也视为MVU体系条目
  // ⚠️变量分段/EJS 已按六大标准模板规范移除，不再视为 MVU 体系条目
  function isMVUEntry(comment) {
    const c = (comment || '').toLowerCase();
    return c.indexOf('[initvar]') >= 0 || c.indexOf('变量列表') >= 0 ||
      c.indexOf('变量更新规则') >= 0 || c.indexOf('变量输出格式') >= 0 ||
      c.indexOf('状态变量输出') >= 0 || c.indexOf('updatevariable') >= 0 ||
      c.indexOf('状态栏') >= 0 || c.indexOf('statusplaceholder') >= 0 ||
      c.indexOf('阶段判定') >= 0 || c.indexOf('阶段切换') >= 0 ||
      c.indexOf('人设切换') >= 0 || c.indexOf('人设规则') >= 0 ||
      c.indexOf('动态注入') >= 0 || c.indexOf('派生字段') >= 0 ||
      c.indexOf('衍生字段') >= 0 || c.indexOf('联动规则') >= 0 ||
      c.indexOf('阈值触发') >= 0 || c.indexOf('控制器') >= 0 ||
      c.indexOf('阶段变量') >= 0 || c.indexOf('状态机') >= 0 ||
      c.indexOf('分阶段') >= 0 || c.indexOf('多阶段') >= 0 ||
      c.indexOf('关系阶段') >= 0 || c.indexOf('剧情进度') >= 0 ||
      c.indexOf('系统模式') >= 0 || c.indexOf('境界等级') >= 0 ||
      c.indexOf('阶段标记') >= 0 || c.indexOf('判定逻辑') >= 0 ||
      c.indexOf('联动变更') >= 0 || c.indexOf('只读字段') >= 0;
  }

  // ST规范：转换 regex_scripts 格式（导入/导出共用）
  function normalizeRegexScripts(rxScripts) {
    if (!rxScripts || !Array.isArray(rxScripts)) return [];
    return rxScripts.map(function(script, idx) {
      const findRegex = script.findRegex || script.find_regex || script.find || '';
      const replaceString = script.replaceString || script.replace_string || script.replace || '';
      const rawPlacement = script.placement !== undefined ? script.placement :
        (script.source ? (function(s) {
          const arr = [];
          if (s.user_input) arr.push(1);
          if (s.ai_output) arr.push(2);
          if (s.slash_command) arr.push(3);
          if (s.world_info) arr.push(4);
          if (s.reasoning) arr.push(5);
          return arr.length ? arr : [2];
        })(script.source) : 2);
      const placement = Array.isArray(rawPlacement) ? rawPlacement : [rawPlacement];
      // 兼容 destination 字段（部分实现用 destination.display/prompt 而非 markdownOnly/promptOnly）
      const dest = script.destination || {};
      const markdownOnly = script.markdownOnly !== undefined ? script.markdownOnly :
        (script.markdown_only !== undefined ? script.markdown_only :
          (dest.display !== undefined ? !!dest.display : false));
      const promptOnly = script.promptOnly !== undefined ? script.promptOnly :
        (script.prompt_only !== undefined ? script.prompt_only :
          (dest.prompt !== undefined ? !!dest.prompt : false));
      return {
        id: script.id || ('regex_script_' + Date.now() + '_' + idx),
        scriptName: script.scriptName || script.script_name || script.name || '正则脚本',
        findRegex: findRegex,
        replaceString: replaceString,
        trimStrings: script.trimStrings || script.trim_strings || [],
        placement: placement,
        disabled: script.disabled !== undefined ? script.disabled : (script.enabled !== undefined ? !script.enabled : false),
        markdownOnly: markdownOnly,
        promptOnly: promptOnly,
        runOnEdit: script.runOnEdit !== undefined ? script.runOnEdit : (script.run_on_edit !== undefined ? script.run_on_edit : false),
        /* 改进K：默认false与ST一致 */
        substituteRegex: script.substituteRegex !== undefined ? script.substituteRegex : (script.substitute_regex !== undefined ? script.substitute_regex : 0),
        minDepth: script.minDepth !== undefined ? script.minDepth : (script.min_depth !== undefined ? script.min_depth : null),
        maxDepth: script.maxDepth !== undefined ? script.maxDepth : (script.max_depth !== undefined ? script.max_depth : null)
      };
    });
  }

  // UI显示分组（基于条目类型，非ST group字段）
  function getDisplayGroup(e) {
    e = e || {};
    const comment = e.comment || '';
    // 变量系统优先判断（避免被 constant=true 的常驻体系拦截）
    if (isMVUEntry(comment)) return '变量系统';
    // 常驻体系判断
    const tmpl = getEntryTemplate(comment);
    const isConst = e.constant !== undefined ? e.constant : (tmpl ? tmpl.constant : false);
    if (isConst) return '常驻体系';
    const m = comment.match(/^<([^>]+)>/);
    const prefixKey = m ? m[1] : '';
    if (['状态栏'].indexOf(prefixKey) >= 0) return '动态系统';
    return '触发体系';
  }

  // ============================================================================
  // SECTION 4  写卡预设 + 系统提示词（注入到每一次 AI 请求的 system prompt）
  // ============================================================================
  // ===== 【写卡预设】生成参数默认值（对齐写卡.json 数值） =====
  const TAVERN_GENERATION_PARAMS = {
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

  // ===== 系统提示词（世界书JSON自由生成规则 + MVU变量系统 + 写卡预设注入） =====
  const SYS_PROMPT = 
    '你是一位专业的世界书（World Info / Lorebook）条目生成大师，基于SillyTavern原生机制，通过自然对话帮助用户自由生成世界书条目。用户描述任何想写入世界书的内容，你直接将其转化为符合SillyTavern世界书JSON规范的结构化条目，以代码形式输出。\n' +
    '\n' +
    '=== 世界书JSON权威结构（必须严格遵循，这是SillyTavern真实导出格式） ===\n' +
    '\n' +
    '【顶层结构】\n' +
    '世界书导出为JSON对象，顶层固定为：\n' +
    '{\n' +
    '  "entries": { "0": { ...条目0... }, "1": { ...条目1... } }\n' +
    '}\n' +
    '- entries 是【对象】（不是数组），键为字符串 uid（"0"、"1"、"2"...），连续编号\n' +
    '- 每条目内部也有数字 uid，且与外层键一致（这是ST导出态的真实格式）\n' +
    '\n' +
    '【条目字段（40个官方字段名，禁止臆造字段名）】\n' +
    'key、keysecondary、comment、content、constant、vectorized、selective、selectiveLogic、addMemo、order、position、disable、ignoreBudget、excludeRecursion、preventRecursion、matchPersonaDescription、matchCharacterDescription、matchCharacterPersonality、matchCharacterDepthPrompt、matchScenario、matchCreatorNotes、delayUntilRecursion、probability、useProbability、depth、outletName、group、groupOverride、groupWeight、scanDepth、caseSensitive、matchWholeWords、useGroupScoring、automationId、role、sticky、cooldown、delay、triggers、characterFilter\n' +
    '\n' +
    '【禁止字段名】\n' +
    'ignoreMaxBudget、matchCharacterNote、matchCreatorsNotes、excludeFilter —— 一律不得使用\n' +
    '\n' +
    '【characterFilter 结构】\n' +
    '对象：{"names": [], "tags": [], "isExclude": false}；无绑定时整字段可省略（ST导出会删除空对象）\n' +
    '\n' +
    '【position 枚举（插入位置，0-7）】\n' +
    '0=before（角色定义前）  1=after（角色定义后）  2=ANTop（作者注顶部）  3=ANBottom（作者注底部）\n' +
    '4=atDepth（@深度）  5=EMTop（示例消息前）  6=EMBottom（示例消息后）  7=outlet（输出口）\n' +
    '\n' +
    '【selectiveLogic 枚举（触发逻辑，0-3）】\n' +
    '0=AND_ANY（任一关键词命中即触发）  1=NOT_ALL（非全部）  2=NOT_ANY（非任一）  3=AND_ALL（全部命中才触发）\n' +
    '\n' +
    '【role 枚举（仅 position=4 时有意义）】\n' +
    '0=system、1=user、2=assistant；position≠4 时 role 为 null\n' +
    '\n' +
    '【默认值（源码级权威默认）】\n' +
    'caseSensitive、matchWholeWords、useGroupScoring = null（继承全局设置）\n' +
    'sticky、cooldown、delay = null\n' +
    'delayUntilRecursion = 0、depth = 4、order = 100\n' +
    '\n' +
    '【中文场景硬规则】\n' +
    'matchWholeWords 必须显式设为 false（中文无空格分词，开启全词匹配会导致触发失效）\n' +
    '\n' +
    '【常用生成基线】\n' +
    'disable:false、order:100、position:0、probability:100、matchWholeWords:false\n' +
    '\n' +
    '【★★★条目元素逐项决策清单（每次生成/修改条目，必须逐项过一遍以下40个元素，一个都不能漏）】\n' +
    '生成或修改任何条目时，你必须对条目内的每一个元素做出明确决策，然后输出到操作块中。决策方式：\n' +
    '- 使用默认值 → 不必写进操作块（工具自动按默认值处理）；\n' +
    '- 需要自定义 → 用元信息行（字段名=值）写进操作块。\n' +
    '逐项决策顺序与依据如下（★=生成时必须主动判断的字段）：\n' +
    '①★key（触发词）：根据条目内容与世界观术语拟定2-6个简洁中文触发词，逗号分隔\n' +
    '②keysecondary（次要关键词）：仅当需要 secondary 过滤时填写，否则留空\n' +
    '③★comment（条目名）：按内容类型自由命名（<自定义条目>XX 等）\n' +
    '④★content（正文）：YAML中文格式（见正文格式规范），完整独立不依赖其他条目\n' +
    '⑤★constant（常驻/触发）：常驻设定用true，随关键词出现用false\n' +
    '⑥vectorized（向量匹配）：默认false；用户要求语义检索时可true\n' +
    '⑦★selective（次要过滤开关）：需要 secondary 逻辑时true，否则false\n' +
    '⑧★selectiveLogic（次要逻辑0-3）：selective=true时按枚举选，默认0=AND_ANY\n' +
    '⑨addMemo（备注进正文）：默认false；需把comment随正文一起注入时true\n' +
    '⑩order（排序）：默认100；多条同位置需要顺序时调整（数值小靠前）\n' +
    '⑪★position（插入位置0-7）：常驻全局设定→0(before)；当前剧情/场景动态→4(atDepth)；作者注→2/3；示例消息→5/6；输出口→7\n' +
    '⑫disable（禁用）：默认false；暂时不启用某条时true\n' +
    '⑬ignoreBudget（忽略预算）：默认false；重要常驻内容强制注入时true\n' +
    '⑭excludeRecursion（不被递归激活）：默认false\n' +
    '⑮preventRecursion（不触发递归条目）：默认false\n' +
    '⑯delayUntilRecursion（递归延迟层级）：默认0\n' +
    '⑰probability（触发概率）：默认100；低频/概率性条目可调低（如30/50）\n' +
    '⑱useProbability（启用概率）：默认true\n' +
    '⑲depth（扫描深度）：默认4；仅在position=4时生效\n' +
    '⑳role（角色0-3）：仅position=4时有意义：0=system、1=user、2=assistant；其余情况null\n' +
    '㉑outletName（输出口名）：仅position=7时填写，其余情况省略\n' +
    '㉒group（互斥分组）：同组条目同时触发仅选一条时填分组名\n' +
    '㉓groupOverride（分组顺序优先）：默认false；同组按order而非随机时true\n' +
    '㉔groupWeight（分组权重）：默认100；同组随机时调权重\n' +
    '㉕scanDepth（条目级扫描深度）：默认null=继承全局\n' +
    '㉖caseSensitive（大小写敏感）：中文条目默认null；英文场景按需true/false\n' +
    '㉗★matchWholeWords（全词匹配）：中文必须false！\n' +
    '㉘useGroupScoring（组评分）：默认null=继承全局\n' +
    '㉙automationId（脚本自动化ID）：默认""；无ST脚本自动化不填\n' +
    '㉚sticky（黏性持续）：默认null；需要持续注入N条消息时填数字\n' +
    '㉛cooldown（冷却）：默认null；触发后冷却N条消息时填数字\n' +
    '㉜delay（触发延迟）：默认null；延迟N条消息后触发时填数字\n' +
    '㉝triggers（生成触发器）：默认空[]=所有场景；可选值normal/continue/impersonate/swipe/regenerate/quiet\n' +
    '㉞characterFilter（角色过滤）：无绑定时省略；格式{"names":[],"tags":[],"isExclude":false}\n' +
    '㉟matchCharacterDescription（匹配角色描述）：默认false\n' +
    '㊱matchCharacterPersonality（匹配角色性格）：默认false\n' +
    '㊲matchScenario（匹配角色场景）：默认false\n' +
    '㊳matchPersonaDescription（匹配人设描述）：默认false\n' +
    '㊴matchCharacterDepthPrompt（匹配角色备注）：默认false\n' +
    '㊵matchCreatorNotes（匹配创作者注释）：默认false\n' +
    '⚠️禁止事项：禁止字段名 ignoreMaxBudget/matchCharacterNote/matchCreatorsNotes/excludeFilter；sticky/cooldown/delay 无效果时写null禁止写0；entries禁止写成数组；characterFilter禁止写成扁平数组。\n' +
    '\n' +
    '=== 输出协议（★只允许使用 :::操作块协议，禁止输出```json代码块） ===\n' +
    '\n' +
    '【:::操作块总格式】\n' +
    '::: 动作 对象名\n' +
    '（可选元信息行：字段名=值，每行一个，遇到空行或非"字段名="行即止）\n' +
    '（空行）\n' +
    '正文内容\n' +
    ':::\n' +
    '\n' +
    '【动作类型】\n' +
    '- upsert 条目名 —— 新增或覆盖条目（覆盖时正文必须包含完整旧内容+改动部分，严禁只写变动字段）\n' +
    '- update 条目名 —— 仅修改已有条目的部分内容（同样要完整输出改动上下文）\n' +
    '- delete 条目名 —— 删除条目\n' +
    '- set 顶层字段名 —— 修改顶层字段（name/description/first_mes/alternate_greetings等）\n' +
    '- rename 旧名 → 新名 —— 重命名条目\n' +
    '\n' +
    '【条目元信息行（必须写在正文前，每行一个，AI可直接理解并逐项调整；覆盖ST世界书全部可配置字段）】\n' +
    'keys=触发词1,触发词2       （逗号分隔，中文触发词不加空格）\n' +
    'secondary_keys=次要词1,次要词2 （可选：次要过滤关键词）\n' +
    'constant=true|false        （true=常驻，false=关键词触发）\n' +
    'position=0-7               （插入位置，见上方枚举）\n' +
    'selectiveLogic=0-3         （触发逻辑，见上方枚举）\n' +
    'depth=4                    （扫描深度，默认4；仅position=4生效）\n' +
    'role=0|1|2                 （仅position=4时：0=system、1=user、2=assistant）\n' +
    'probability=100            （触发概率，默认100）\n' +
    'useProbability=true|false  （启用概率控制，默认true）\n' +
    'order=100                  （排序权重，默认100）\n' +
    'enabled=true|false         （false=禁用该条目）\n' +
    'match_whole_words=false    （中文必须false）\n' +
    'case_sensitive=true|false  （英文区分大小写；中文不用写）\n' +
    'vectorized=true|false      （向量匹配，默认false）\n' +
    'group=分组名                （可选：互斥分组）\n' +
    'group_weight=100           （可选：分组内权重）\n' +
    'group_override=true|false  （可选：同组按order而非随机）\n' +
    'use_group_scoring=true|false （可选：组评分机制）\n' +
    'prevent_recursion=true|false （可选：防止递归）\n' +
    'exclude_recursion=true|false （可选：排除递归）\n' +
    'delay_until_recursion=0    （可选：递归延迟层级）\n' +
    'sticky=null                （可选：黏性持续N条消息；无效果必须null禁止0）\n' +
    'cooldown=null              （可选：冷却N条消息；无效果必须null禁止0）\n' +
    'delay=null                 （可选：延迟N条消息触发；无效果必须null禁止0）\n' +
    'ignore_budget=true|false   （可选：忽略token预算强制注入）\n' +
    'addMemo=true|false         （可选：把comment加入正文）\n' +
    'outlet_name=输出口名        （仅position=7时填写）\n' +
    'automation_id=脚本ID        （可选：ST脚本自动化ID）\n' +
    'triggers=normal,continue    （可选：生成触发器，空=所有场景）\n' +
    'match_persona_description=true|false （可选：匹配人设描述）\n' +
    'match_character_description=true|false （可选：匹配角色描述）\n' +
    'match_character_personality=true|false （可选：匹配角色性格）\n' +
    'match_character_depth_prompt=true|false （可选：匹配角色备注）\n' +
    'match_scenario=true|false  （可选：匹配角色场景）\n' +
    'match_creator_notes=true|false （可选：匹配创作者注释）\n' +
    'scan_depth=null            （可选：条目级扫描深度，null=继承全局）\n' +
    '\n' +
    '【条目生成示例（严格按此格式）】\n' +
    '::: upsert <自定义条目>白娅\n' +
    'keys=白娅,白娅小姐,白娅公主\n' +
    'constant=false\n' +
    'selectiveLogic=0\n' +
    'position=4\n' +
    'depth=4\n' +
    'probability=100\n' +
    'order=100\n' +
    'match_whole_words=false\n' +
    '\n' +
    '身份：绯月大陆王城首席宫廷法师\n' +
    '年龄：28岁\n' +
    '外貌：银发紫瞳，常穿白色法袍，手持秘银法杖\n' +
    '性格：高傲护短，外冷内热，对认可之人绝对信任\n' +
    '能力：\n' +
    '  - 高阶元素魔法（火/冰/雷精通）\n' +
    '  - 结界术：可展开覆盖整座王城的防护结界\n' +
    '  - 禁忌咒文：仅掌握三种，使用需付出代价\n' +
    '背景：出身平民，12岁被测出魔法天赋后被王室收养，师从大法师奥伦\n' +
    '与主角关系：师徒（白娅是主角的魔法导师）\n' +
    '当前立场：支持主角继承王位，暗中清理反对势力\n' +
    ':::\n' +
    '\n' +
    '【条目正文格式规范（★必须遵守，让AI和玩家都容易理解）】\n' +
    '- 正文使用「YAML中文格式」：键名用中文，冒号后接内容，缩进表达层级，短横线-表达列表项\n' +
    '- 一个维度一行：身份/外貌/性格/能力/背景/关系/立场 等，每行一个「维度：内容」\n' +
    '- 列表型内容（能力/装备/事件等）用 缩进+短横线 逐项列出，每项独立一行\n' +
    '- 内容较长时先写核心结论，再展开细节；禁止写成一大段无结构文字\n' +
    '- 键名命名自由但须简洁（2-8字为宜），与世界观术语一致\n' +
    '- 禁止在正文中出现 JSON/代码语法，禁止把 keys= 等元信息写进正文\n' +
    '- 世界观描述(description)、开场白(first_mes/alternate_greetings) 同样用分段/分点结构，禁止整段糊成一团\n' +
    '- 【内容独立完整】酒馆只把 content 注入上下文，触发词/标题/备注一律不进上下文。因此每个条目正文必须自包含、完整可独立理解，禁止写"见其他条目"、"详见上方"、依赖标题才能读懂的内容\n' +
    '- 【递归联动】条目正文可以主动提及另一条目的触发词（如正文写"她的伙伴露芙"），酒馆会自动递归激活对应条目，让设定按需展开；涉及关联设定的条目内容应互相串起触发词\n' +
    '- 【长度控制】条目要兼顾完整与精炼：常驻设定 100-300 字为宜，触发条目 50-150 字为宜，信息密度优先，避免冗长挤占上下文预算\n' +
    '\n' +
    '【世界观描述与开场白生成（参考 chara_card_v3 模板字段结构）】\n' +
    '- 世界观描述：::: set description\n（完整世界观描述正文，覆盖世界核心设定：地理/历史/势力/规则/种族等，用分段+要点列出）\n:::\n' +
    '- 开场白1：::: set first_mes\n（开场白正文，尽量详细（建议500字以上），结构：场景描写→动作驱动→内心独白→自然对话→结尾留钩；开场白决定角色的交流风格，越长后续回复越不容易过短）\n:::\n' +
    '- 开场白2/3（以此类推，多条用---分割）：::: set alternate_greetings\n（开场白2正文）\n---分割---\n（开场白3正文）\n:::\n' +
    '- 性格总结：::: set personality\n（简短概括世界/角色性格特征，如"沉稳睿智、外冷内热"，一句话到几句话即可）\n:::\n' +
    '- 场景：::: set scenario\n（互动发生的环境与背景设定，包括地点、氛围、当前状态）\n:::\n' +
    '- 对话示例：::: set mes_example\n（1-2组示例对话，每组前用<START>标签分隔，{{user}}代表用户、{{char}}代表角色，示范角色的说话风格与语气）\n:::\n' +
    '- 角色名：::: set name\n（世界/角色名称）\n:::\n' +
    '- ★可写字段参照（chara_card_v3 / v2CharData 官方顶层字段，需要哪个用 ::: set 输出哪个）：name、description（世界观描述）、personality（性格总结）、scenario（场景）、first_mes（开场白1）、alternate_greetings（备用开场白数组，酒馆聊天界面可切换，{{charFirstMessage::N}} 取第N条）、mes_example（对话示例）、creator_notes（创作者注释）、tags（标签）、system_prompt（角色主提示词覆盖，可用 {{original}} 占位原始内容）、post_history_instructions（历史后指令覆盖）、depth_prompt（@深度提示）。内容文本字段（description/first_mes/alternate_greetings/mes_example/条目content）中才可用酒馆宏；结构化字段（name/tags/system_prompt/post_history_instructions 等）保持纯文本。\n' +
    '\n' +
    '【条目生成原则（★必须遵守）】\n' +
    '- ★★★【逐项决策】每次生成或修改条目，必须按上方「条目元素逐项决策清单」把40个元素全部过一遍：需要自定义的写进操作块元信息行，用默认值的不用写。禁止只写 keys/content 就完事，禁止遗漏任何影响触发的字段（constant/position/selectiveLogic/depth/probability/match_whole_words 等）\n' +
    '- ★生成条目时，必须参考上方「当前角色卡已有内容」中 name/description/开场白/已有条目 的全部信息，让新条目的触发词（keys）、常驻或触发（constant）、插入位置（position）、扫描深度（depth）、触发逻辑（selectiveLogic）、分组（group）等元素与整体世界观协调一致，不冲突、不重复\n' +
    '- ★条目正文必须用YAML中文格式（见上方「条目正文格式规范」），结构化、易读\n' +
    '- 已有条目覆盖时必须完整输出旧content+改动部分\n' +
    '- 中文 matchWholeWords 必须 false\n' +
    '- 未确定的信息不要写，只写用户已确认的内容\n' +
    '- ★概率条目：需要"低概率随机事件"（如深夜有1%概率出现神秘访客、战斗中5%概率触发暴击事件）时，用 useProbability true + probability 设目标概率值（1-99），触发型而非常驻\n' +
    '- ★递归联动：条目正文主动提及关联条目的触发词，让相关设定被递归激活；已开启递归扫描的设定勿用 excludeRecursion 误伤\n' +
    '- 只处理用户最新一条消息的指令，不要重复处理旧指令\n' +
    '\n' +
    '【宏规范（对齐 SillyTavern 官方宏引擎，用于角色卡描述/开场白/世界书正文/对话示例）】\n' +
    '■ 适用边界（★最高优先，务必遵守）\n' +
    '- 本段落所有宏（{{...}}）都是 SillyTavern 在【角色卡聊天界面】运行时才解析的；它们只能写进会进入最终角色卡的"内容文本"字段：description、first_mes、alternate_greetings、世界书条目的 content（叙事/设定/开场白类）、mes_example。\n' +
    '- 严禁在"写卡器内部 / MVU 代码 / 结构化配置"里使用酒馆宏，包括：[InitVar]初始变量的 YAML、stat_data 结构定义、zod 变量结构脚本、状态栏与控制器的 JavaScript（getAllVariables / UpdateVariable / 渲染脚本）、::: 操作指令的指令名与字段名、JSON 的键名与非 content 数值。\n' +
    '- 区分两套变量，绝不混用：写卡器 MVU 内部变量走 stat_data 路径（getAllVariables()、_.get(x,"stat_data.名")），在 MVU 状态栏 Tab 配置；酒馆宏 {{getvar::名}}、{{.名}}、{{$名}} 属于另一层、仅在酒馆聊天界面解析。两套不能互相替代，写 MVU 代码时用 stat_data，写最终角色卡内容时才用酒馆宏。\n' +
    '- ★注意：酒馆原生变量（{{getvar}}/{{setvar}}/{{.名}}/{{$名}} 等）并不依赖 MVU，非 MVU 的普通角色卡同样可以、且应当按用户意愿用它们来记录各种信息（详见下文"变量简写"与"分场景灵活运用"）。\n' +
    '■ 基础语法\n' +
    '- {{宏名}} 不区分大小写；参数用 {{宏名::参数}} 或 {{宏名 参数}}（单冒号 {{宏名:参数}} 为旧版语法，不推荐）；宏可嵌套（{{getvar::{{char}}_mood}}，内层宏先解析）；宏名、分隔符、参数之间的空白字符会被忽略；要显示字面花括号用 \\{\\{ 转义。\n' +
    '- 作用域语法：任何接受至少一个参数的宏，都可把最后一个参数放在开闭标签之间，如 {{setvar::背景}}多行内容{{/setvar}}；默认自动去首尾空白和统一缩进，加 # 标志保留全部空白（{{#setvar::背景}}...{{/setvar}}）。\n' +
    '- 宏标志（放在开花括号与宏名之间，可组合）：/ =闭合块标记、# =保留空白；! 立即执行、? 延迟执行、~ 重新求值、> 输出过滤器是官方计划中【尚未实现】的标志，一律禁止使用。\n' +
    '- 不确定有哪些宏可用时，可让用户在酒馆输入框敲 /? macros 查看全部已注册宏及描述，或输入 {{ 触发自动补全（其他宏支持字段按 Ctrl+Space）。\n' +
    '■ 条件宏（让内容按状态显示）\n' +
    '- {{if 条件}}内容{{/if}}；支持 {{else}} 分支，如 {{if personality}}{{personality}}{{else}}暂无性格设定{{/if}}。\n' +
    '- 条件前加 ! 反转（{{if !personality}}）；条件可用变量简写、嵌套宏或任意文本；空串/false/0/off/no 判定为假。\n' +
    '■ 变量简写（酒馆原生聊天变量，★与 MVU 无关，普通卡 / MVU 卡都能用）\n' +
    '- .变量名=本聊天局部变量、$变量名=跨聊天全局变量。变量名以字母开头，可含字母、数字、下划线、连字符，最后一个字符不能是下划线或连字符；不符合该规则的变量名必须用完整宏（{{getvar::名}}）。\n' +
    '- 全套运算符（局部用 .、全局用 $，写法相同）：{{.x}} 取值、{{.x=值}} 设置（返回空串）、{{.x++}}/{{.x--}} 递增/递减（返回新值）、{{.x+=5}} 加法（当原值与加数都非数字时为字符串连接，返回空串）、{{.x-=5}} 减法（返回空串，非有效数字则不变）、{{.x||回退}} 假值回退、{{.x??回退}} 仅未定义时回退（回退值惰性求值）、{{.x||=回退}}/{{.x??=回退}} 满足条件时赋值并返回新值；比较 {{.x==值}}/{{.x!=值}}/{{.x>5}}/{{.x>=5}}/{{.x<5}}/{{.x<=5}} 返回字符串 true/false，常配合 {{if}} 做条件分支。\n' +
    '- ★变量要因卡而异：根据这张角色卡的题材、玩法和用户要求来设计，服务于叙事与玩法，不要每张卡都套用同一组（例如逢卡就加好感度）。用户明确要什么系统 / 信息就建什么变量；用户没点名时，可按题材主动设计少量最贴合的变量，不堆砌、不套路。\n' +
    '- 按题材举一反三（仅为启发，实际以本卡与用户要求为准）：\n' +
    '  · 恋爱 / 养成：好感、信任、心动值、关系阶段、约会次数\n' +
    '  · 冒险 / RPG：生命、魔力、等级、经验、金币、位置、任务进度\n' +
    '  · 战斗：HP / MP、攻击 / 防御、回合数、敌人血量、buff / debuff\n' +
    '  · 经营 / 模拟：资金、天数、店铺等级、库存、员工、声望\n' +
    '  · 推理 / 悬疑：线索、怀疑度、已掌握证据、推理进度、真凶标记\n' +
    '  · 生存：饥饿、口渴、体力、体温、存活天数、物资\n' +
    '  · 校园：成绩、体力、社团声望、朋友数、学期 / 周次\n' +
    '  · 恐怖：理智、恐惧值、安全度、逃生进度\n' +
    '  · 通用：玩家名 / 称呼、当前章节 / 场景、关键选择与"是否完成"的开关标记、事件计数、天数时间、关系网\n' +
    '- 变量名用贴合该世界观的叫法（中文或卡内术语），随聊天持久保存；普通卡无需 MVU 即可直接使用。\n' +
    '■ 完整宏清单（官方全部常用宏，按需选用，禁止臆造）\n' +
    '· 名称：{{user}}/{{char}}/{{group}}（群组列表含静音）/{{groupNotMuted}}（排除静音）/{{charIfNotGroup}}/{{notChar}}。\n' +
    '· 角色卡/人设字段：{{description}}/{{personality}}/{{scenario}}/{{persona}}（用户人设描述）/{{charFirstMessage}}（{{charFirstMessage::1}}取第2条备用问候）/{{mesExamples}}（已格式化示例）/{{mesExamplesRaw}}（原始未格式化示例）/{{charVersion}}/{{charCreatorNotes}}/{{charPrompt}}（角色主提示词覆盖）/{{charInstruction}}（历史后指令覆盖）/{{charDepthPrompt}}（角色@深度注释）/{{original}}（被覆盖的原始消息，提示词覆盖中使用）。\n' +
    '· 消息与范围：{{lastMessage}}/{{lastMessageId}}/{{lastUserMessage}}/{{lastCharMessage}}/{{firstIncludedMessageId}}/{{firstDisplayedMessageId}}/{{lastSwipeId}}/{{currentSwipeId}}/{{allChatRange}}（整个聊天范围）/{{summary}}（聊天摘要）。\n' +
    '· 时间：{{time}}（{{time::UTC+9}}带偏移）/{{date}}/{{weekday}}/{{isotime}}/{{isodate}}/{{datetimeformat::YYYY-MM-DD HH:mm}}/{{idleDuration}}（离开时长）/{{timeDiff::左::右}}（时间差）。\n' +
    '· 随机：{{random::a::b::c}}（每次重随机）/{{pick::a::b::c}}（稳定随机）/{{roll::1d20}}。\n' +
    '· 变量（局部）：{{getvar::名}}/{{setvar::名::值}}/{{addvar::名::值}}/{{incvar::名}}/{{decvar::名}}/{{hasvar::名}}/{{deletevar::名}}；全局：{{getglobalvar::名}}/{{setglobalvar::名::值}}/{{addglobalvar::名::值}}/{{incglobalvar::名}}/{{decglobalvar::名}}/{{hasglobalvar::名}}/{{deleteglobalvar::名}}；对象/数组按索引读写：{{getvarkey::名::键}}/{{setvarkey::名::键::值}}（局部）、{{getglobalvarkey::名::键}}/{{setglobalvarkey::名::键::值}}（全局），键支持嵌套对象路径（如 角色.好感度）。\n' +
    '· 运行时：{{model}}（模型名）/{{isMobile}}/{{hasExtension::扩展名}}/{{maxPrompt}}/{{maxContextTokens}}/{{maxResponseTokens}}/{{lastGenerationType}}。\n' +
    '· 表情/视觉（配合表情扩展）：{{lastExpression::角色名?}}（最近一次表情）/{{defaultExpression}}（全局默认表情）/{{availableExpressions}}（当前可用表情列表）。\n' +
    '· 提示词模板（编写系统指令/对齐当前指令格式时使用）：{{systemPrompt}}/{{defaultSystemPrompt}}/{{authorsNote}}/{{charAuthorsNote}}/{{defaultAuthorsNote}}；故事字符串 {{instructStoryStringPrefix}}/{{instructStoryStringSuffix}}；指令序列 {{instructSystemPrefix}}/{{instructSystemSuffix}}/{{instructUserPrefix}}/{{instructUserSuffix}}/{{instructAssistantPrefix}}/{{instructAssistantSuffix}}/{{instructSeparator}}/{{instructStop}}/{{instructUserFiller}}/{{instructSystemInstructionPrefix}}/{{instructFirstAssistantPrefix}}/{{instructLastAssistantPrefix}}/{{instructFirstUserPrefix}}/{{instructLastUserPrefix}}；{{chatSeparator}}/{{chatStart}}；推理块 {{reasoningPrefix}}/{{reasoningSuffix}}/{{reasoningSeparator}}；图像生成提示词前缀 {{charPrefix}}/{{charNegativePrefix}}。\n' +
    '· 实用：{{newline}}（{{newline::3}}多个）/{{space}}/{{noop}}（空串占位）/{{trim}}/{{reverse::文本}}/{{input}}/{{banned::词}}（文本补全后端禁用词）/{{outlet::出口键}}（世界书出口内容）。\n' +
    '· 注释：{{// 这是备注，不会出现在最终输出里}}；多行注释用作用域写法 {{//}}整段备注{{///}}。\n' +
    '· 旧版尖括号（处理时自动转换为等效宏，新内容不推荐使用）：<USER>={{user}}、<BOT>/<CHAR>={{char}}、<GROUP>={{group}}、<CHARIFNOTGROUP>={{charIfNotGroup}}。\n' +
    '■ 分场景灵活运用（★按内容类型选宏，不堆砌、不滥用）\n' +
    '- 世界观描述(description)：角色名用 {{char}}、玩家用 {{user}}；需要按变量/条件展示的段落用 {{if}}；引用当前设定值用 {{getvar}}。\n' +
    '- 开场白(first_mes/alternate_greetings)：{{char}}/{{user}} 代替硬编码名字，{{time}}/{{date}} 显示真实时间，{{random}}/{{pick}} 随机天气/心情/开场细节，{{idleDuration}} 响应玩家离开时长，可用 {{roll}} 制造随机开局事件。\n' +
    '- 世界书条目正文：动态数值用 {{getvar}} 或 {{.变量}}，条件段落用 {{if}}；出口类条目(position=7)的内容会注入到 {{outlet::出口名}} 对应位置。\n' +
    '- ★非 MVU 普通卡也能记录信息（酒馆原生变量，不依赖 MVU）：需要记住任何随剧情变化的信息时（变量种类按本卡题材与用户要求设计，见上文"按题材举一反三"，不限于好感度）——开场白里用 {{setvar::变量名::初值}} 或 {{.变量名=初值}} 初始化，正文用 {{getvar::变量名}} 或 {{.变量名}} 读取，事件后用 {{incvar::变量名}}、{{addvar::变量名::值}} 或 {{.变量名+=值}} 改变，再用 {{if 条件}}对应反应{{else}}其他反应{{/if}} 呈现分支；用户没要求记录信息时不强行加。\n' +
    '- 对话示例(mes_example)：每组前加 <START>，用 {{char}}: / {{user}}: 前缀，示范角色语气。\n' +
    '- 系统提示词/指令覆盖(charPrompt/charInstruction)：用 {{original}} 占位被覆盖的原始消息内容，需要对齐当前指令格式时引用 {{instructUserPrefix}}/{{instructAssistantPrefix}} 等模板宏。\n' +
    '- 总原则：①以用户要求为准——用户明确点名要动态/随机/条件/变量联动效果时，必须用对应宏实现；用户要求静态、纯文本或未要求动态时，不强行加宏。②只在"本该随游戏状态变化"的地方用宏，静态设定保持纯文本。③禁止臆造官方不存在的宏名。\n' +
    '- 触发词(keys)正则写法：/(?:{{char}}|他) (?:看向|望着) (?:天空|月亮)/i，合法正则自动识别，配合 use_regex。\n' +
    '- 世界书顶层可选元数据：description/scan_depth/token_budget/recursive_scanning，有明确设定时输出到 character_book 顶层。\n' +
    '\n' +
    '【酒馆官方命令/字段一致性参照（生成内容必须能被酒馆直接操作，禁止臆造字段）】\n' +
    '- 世界书条目字段与酒馆命令完全一致：/createentry（创建条目）、/setentryfield field=字段名（修改字段）、/findentry、/getentryfield（查询）；字段枚举同上方40个官方字段名，生成条目的 keys/content/position/constant/selective/probability/group/sticky/cooldown/delay/triggers 等必须与酒馆世界书编辑器完全一致。\n' +
    '- 角色卡顶层字段与 /char-create、/char-update 参数一致：name、description、personality、scenario、firstMessage(first_mes)、messageExamples(mes_example)、creatorNotes(creator_notes)、systemPrompt(system_prompt)、postHistoryInstructions(post_history_instructions)、characterVersion、tags、world(世界书)、depthPrompt(深度提示，含depth/prompt/role)。\n' +
    '- 运行时命令（知识参照，写卡器内部不使用，生成的角色卡内容应与这些命令/宏协作兼容）：/setvar、/getvar、/addvar、/incvar、/decvar、/flushvar、/listvar 管理聊天变量；/gen、/genraw 生成文本；/inject 注入提示词；/trigger 触发生成。\n' ;


  // ============================================================================
  // SECTION 5  条目匹配 + 智能合并引擎（mergePartial · 去重/删除屏障）
  // ============================================================================
  // MVU 固定资产（bundle.js）：禁止 AI 删除/覆盖；按固定 id 或内容特征识别。
  // mergePartial 与 applyOps 共用同一判定（原先两处各有一份相同实现）。
  const MVU_FIXED_SCRIPT_IDS = {
    '961f366d-e403-45c2-8155-3d14ec86de53': 'MVU (bundle.js)'
  };
  function isFixedMvuScript(scr) {
    if (!scr) return false;
    if (scr.id && MVU_FIXED_SCRIPT_IDS[scr.id]) return true;
    const c = String(scr.content || '');
    // 特征兜底：bundle.js / MagVarUpdate = MVU本体（唯一受保护的固定资产）
    return c.indexOf('MagVarUpdate') >= 0 || c.indexOf('bundle.js') >= 0;
  }
  // ===== 提取条目的规范前缀（用于智能匹配） =====
  function extractEntryPrefix(comment) {
    if (!comment) return '';
    const m = String(comment).match(/^<([^>]+)>/);
    if (m) return m[1];
    const m2 = String(comment).match(/^\[([^\]]+)\]/);
    if (m2) return '[' + m2[1] + ']';
    return '';
  }

  // ===== 智能查找匹配条目：精确匹配 -> 同类型单条匹配 -> 内容相似度匹配 =====
  function findMatchingEntry(newEntry, existingArr) {
    if (!newEntry || !existingArr || !existingArr.length) return {
      index: -1,
      mode: 'none'
    };
    const neComment = newEntry.comment || '';
    const neContent = (newEntry.content || '').trim();
    const nePrefix = extractEntryPrefix(neComment);

    const normMatchKey = function(s) {
      return _stripOuterBrackets(safeStr(s)).trim().toLowerCase();
    };

    // 辅助：提取 comment 去掉前缀后的后缀（去掉首尾空白和常见分隔符）
    const getSuffix = function(comment, prefix) {
      if (!comment || !prefix) return String(comment || '');
      // 🐛修复：extractEntryPrefix 对 <xxx> 返回 'xxx'(无括号)，对 [xxx] 返回 '[xxx]'(带括号)
      // 所以 prefixLen 必须区分：<> 前缀加2还原括号，[] 前缀本身就是带括号的不加
      let prefixLen = 0;
      if (prefix.charAt(0) === '[') {
        prefixLen = prefix.length; // [xxx] → extractEntryPrefix 返回 '[xxx]'，本身已含括号
      } else {
        prefixLen = prefix.length + 2; // <xxx> → extractEntryPrefix 返回 'xxx'，需+2还原 <xxx>
      }
      const suffix = String(comment).slice(prefixLen);
      return suffix.replace(/^[\s\-·:：_]+|[\s\-·:：_]+$/g, '');
    };
    // 辅助：短字符串字符集 Jaccard（保留作为混合分量，解决「白娅/白夜」这类单字差）
    const jaccardSim = function(a, b) {
      if (!a || !b) return 0;
      const setA = {},
        setB = {};
      for (let i = 0; i < a.length; i++) setA[a[i]] = true;
      for (let j = 0; j < b.length; j++) setB[b[j]] = true;
      let inter = 0,
        uni = 0;
      for (let k in setA) {
        if (setA.hasOwnProperty(k)) {
          if (setB[k]) inter++;
          uni++;
        }
      }
      for (let k2 in setB) {
        if (setB.hasOwnProperty(k2) && !setA[k2]) uni++;
      }
      return uni > 0 ? inter / uni : 0;
    };
    // 辅助：莱文斯坦编辑距离相似度 = 1 - dist / maxLen（同前缀漏字/错字场景敏感）
    const levenshteinSim = function(a, b) {
      if (!a || !b) return 0;
      const la = a.length,
        lb = b.length;
      if (la === 0 || lb === 0) return 0;
      const dp = new Array(la + 1);
      for (let i = 0; i <= la; i++) {
        dp[i] = new Array(lb + 1);
        dp[i][0] = i;
      }
      for (let j = 0; j <= lb; j++) dp[0][j] = j;
      for (let i2 = 1; i2 <= la; i2++) {
        for (let j2 = 1; j2 <= lb; j2++) {
          const cost = a.charAt(i2 - 1) === b.charAt(j2 - 1) ? 0 : 1;
          dp[i2][j2] = Math.min(dp[i2 - 1][j2] + 1, dp[i2][j2 - 1] + 1, dp[i2 - 1][j2 - 1] + cost);
        }
      }
      return 1 - dp[la][lb] / Math.max(la, lb);
    };
    // 辅助：公共前缀占比（同「姓」人名/同根地名加权，如 林月/林月如）
    const commonPrefixRatio = function(a, b) {
      const m = Math.min(a.length, b.length);
      let n = 0;
      while (n < m && a[n] === b[n]) n++;
      return n / Math.max(a.length, b.length);
    };
    // 后缀名混合相似度：编辑距离 50% + 字符集 Jaccard 30% + 公共前缀 20%
    // 校准：白娅/白夜≈0.45（不匹配），林月/林月如≈0.67（匹配），阈值见 CONFIG.MATCH_SUFFIX_SIM
    const suffixNameSim = function(a, b) {
      if (!a || !b) return 0;
      return 0.5 * levenshteinSim(a, b) + 0.3 * jaccardSim(a, b) + 0.2 * commonPrefixRatio(a, b);
    };
    // 正文相似度：相邻字符 bigram 的 Dice 系数（比单字 Jaccard 更能识别「同文微调」）；
    // 双方条目核心名（后缀）互现在对方正文中时 +0.15 加权（核心实体一致性）
    const contentBigramSim = function(a, b, neSuf, exSuf) {
      if (!a || !b) return 0;
      const bigrams = function(t) {
        const map = {};
        for (let i = 0; i < t.length - 1; i++) {
          const bg = t.substr(i, 2);
          map[bg] = (map[bg] || 0) + 1;
        }
        return map;
      };
      const ba = bigrams(a),
        bb = bigrams(b);
      let inter = 0,
        totB = 0;
      for (const bg in bb) totB += bb[bg];
      for (const bg2 in ba) if (bb[bg2]) inter += Math.min(ba[bg2], bb[bg2]);
      const totA = a.length - 1;
      let dice = (totA > 0 && totB > 0) ? (2 * inter) / (totA + totB) : 0;
      if (neSuf && exSuf && neSuf.length >= 2 && exSuf.length >= 2 &&
        b.indexOf(neSuf) >= 0 && a.indexOf(exSuf) >= 0) {
        dice = Math.min(1, dice + 0.15);
      }
      return dice;
    };

    // 第1优先级：规范化精确 comment 匹配（去掉⟦⟧/【】等外层装饰括号 + trim + 大小写不敏感）
    const nk = normMatchKey(neComment);
    let exactIdx = -1;
    if (nk !== '') {
      for (let fi = 0; fi < existingArr.length; fi++) {
        if (normMatchKey(existingArr[fi].comment) === nk) {
          exactIdx = fi;
          break;
        }
      }
    }
    if (exactIdx < 0) {
      // 兜底：原始字符串全等比较也保留，应对极端情况
      exactIdx = existingArr.findIndex(function(e) {
        return (e.comment || '') === neComment;
      });
    }
    if (exactIdx >= 0) return {
      index: exactIdx,
      mode: 'exact'
    };

    // 第2优先级：同规范前缀下只有1条现有条目 + 后缀有相关性（AI改了comment后缀但前缀一致，如<自定义条目>魔法→<自定义条目>魔力）
    // ⚠️修复：必须检查「后缀相关性」，否则 AI 批量新增同前缀多条目时(如<人物>主角/<人物>女配/<人物>反派)会相互覆盖！
    if (nePrefix) {
      const samePrefixEntries = existingArr.map(function(e, i) {
        return {
          i: i,
          p: extractEntryPrefix(e.comment),
          c: (e.content || '').trim(),
          ec: e.comment || ''
        };
      }).filter(function(x) {
        return x.p === nePrefix;
      });
      if (samePrefixEntries.length === 1) {
        const onlyOne = samePrefixEntries[0];
        const neSuffix = getSuffix(neComment, nePrefix);
        const exSuffix = getSuffix(onlyOne.ec, nePrefix);
        let suffixRelated = false;
        if (neSuffix && exSuffix) {
          // 判定「后缀有相关性」= 微调关系（而非完全不同的新条目主题）：
          //   1. 其中一个为空（只有前缀无后缀），或
          //   2. 其中一个后缀是另一个的子串（如"世界"⊆"世界基础规则"），或
          //   3. 后缀名混合相似度（编辑距离+前缀+字符集）≥ CONFIG.MATCH_SUFFIX_SIM
          if (neSuffix.length === 0 || exSuffix.length === 0) {
            suffixRelated = true;
          } else if (neSuffix.indexOf(exSuffix) >= 0 || exSuffix.indexOf(neSuffix) >= 0) {
            suffixRelated = true;
          } else if (neSuffix.length >= 2 && exSuffix.length >= 2 && suffixNameSim(neSuffix, exSuffix) >= CONFIG.MATCH_SUFFIX_SIM) {
            suffixRelated = true;
          }
        } else {
          // 某一方没有后缀（如只有 <基础设定>），认为可能相关
          suffixRelated = true;
        }
        if (suffixRelated) {
          return {
            index: onlyOne.i,
            mode: 'prefix-single'
          };
        }
        // 后缀不相关 → 这是同前缀下的不同新条目（如主角/女配/反派），不匹配，进入新增分支
      }
      // 第3优先级：同前缀下正文 bigram Dice 相似度最高（阈值 CONFIG.MATCH_CONTENT_SIM）
      // ⚠️修复：必须 `length > 1`（同前缀至少2条才用相似度匹配）
      //   原代码 `length > 0` 会导致：同前缀只有1条时，第2优先级后缀相关性检查不通过，
      //   却在第3优先级被内容字符集相似度（中文通用字符重叠>35%）误判为同一条 → 新条目覆盖旧条目！
      //   场景：已有<自定义条目>白娅，AI新增<自定义条目>林月 → 第2优先级"林月/白娅"后缀不相关→不匹配
      //   → 第3优先级（若>0）内容字符集重叠>0.35→覆盖白娅！改成>1后第3优先级不触发→正确新增林月
      if (samePrefixEntries.length > 1 && neContent.length >= CONFIG.MATCH_CONTENT_MIN_LEN) {
        const neHead = neContent.slice(0, CONFIG.MATCH_CONTENT_HEAD);
        const _neSuf = getSuffix(neComment, nePrefix);
        let best = null;
        samePrefixEntries.forEach(function(x) {
          const exHead = x.c.slice(0, CONFIG.MATCH_CONTENT_HEAD);
          const _exSuf = getSuffix(x.ec, nePrefix);
          const sim = contentBigramSim(neHead, exHead, _neSuf, _exSuf);
          if (sim >= CONFIG.MATCH_CONTENT_SIM && (!best || sim > best.sim)) best = {
            i: x.i,
            sim: sim
          };
        });
        if (best) return {
          index: best.i,
          mode: 'prefix-similarity'
        };
      }
    }
    return {
      index: -1,
      mode: 'none'
    };
  }

  // ===== 条目集合简易 diff（合并后变更统计 + 预览面板高亮用）=====
  // 以 comment 为主键对比前后 entries：
  //   added/deleted：新增/消失的 comment；updated：content 有差异，统计新增/删除行数
  // 行数统计口径：content 按行切分、trim 后做多重集合差（能直观反映「多了几行/少了几行」，
  // 行内改写表现为同时 +1/-1）；不做 LCS，成本 O(n)，足够预览提示使用。
  function computeEntryDiff(beforeArr, afterArr) {
    const toMap = function(arr) {
      const m = {};
      safeArr(arr).forEach(function(e) {
        if (e && e.comment != null) m[String(e.comment)] = e;
      });
      return m;
    };
    const lineBag = function(text) {
      const bag = {};
      safeStr(text).split(/\r?\n/).forEach(function(line) {
        const t = line.trim();
        if (t) bag[t] = (bag[t] || 0) + 1;
      });
      return bag;
    };
    const bm = toMap(beforeArr),
      am = toMap(afterArr);
    const diff = {
      added: [],
      deleted: [],
      updated: []
    };
    for (const k in am) {
      if (!am.hasOwnProperty(k)) continue;
      if (!bm[k]) {
        diff.added.push(k);
        continue;
      }
      if ((bm[k].content || '') !== (am[k].content || '')) {
        const bb = lineBag(bm[k].content),
          ab = lineBag(am[k].content);
        let addLines = 0,
          delLines = 0;
        for (const ln in ab) {
          if (ab.hasOwnProperty(ln)) addLines += Math.max(0, ab[ln] - (bb[ln] || 0));
        }
        for (const ln2 in bb) {
          if (bb.hasOwnProperty(ln2)) delLines += Math.max(0, bb[ln2] - (ab[ln2] || 0));
        }
        diff.updated.push({
          comment: k,
          addLines: addLines,
          delLines: delLines
        });
      }
    }
    for (const k2 in bm) {
      if (bm.hasOwnProperty(k2) && !am[k2]) diff.deleted.push(k2);
    }
    return diff;
  }

  // ===== 增量合并（修复版：智能匹配 + 变更记录 + 删改可追溯） =====
  // 共享：把 {prompt,depth,role} 可能的"JSON 字符串" / "纯 prompt 字符串" / null 统一规范化为对象
  //   - null/undefined: 返回空默认对象
  //   - 形如 '{...}' 的字符串：尝试 JSON.parse，失败就退回纯 prompt 文本
  //   - 其他字符串：视为纯 prompt 文本（旧规范）
  function normalizeDepthPrompt(v, _defaultDepth) {
    if (v == null) return {
      prompt: '',
      depth: typeof _defaultDepth === 'number' ? _defaultDepth : 0,
      role: 'system'
    };
    if (typeof v === 'object') {
      return {
        prompt: typeof v.prompt === 'string' ? v.prompt : '',
        depth: (typeof v.depth === 'number' && v.depth >= 0) ? v.depth : (typeof _defaultDepth === 'number' ? _defaultDepth : 0),
        role: (v.role === 0 || v.role === 1 || v.role === 2 || v.role === 'system' || v.role === 'user' || v.role === 'assistant') ? v.role : 'system'
      };
    }
    if (typeof v === 'string') {
      const s = v.trim();
      if (s.length > 0 && s.charAt(0) === '{') {
        try {
          const p = JSON.parse(s);
          if (p && typeof p === 'object') {
            return {
              prompt: typeof p.prompt === 'string' ? p.prompt : (typeof v === 'string' ? v : ''),
              depth: (typeof p.depth === 'number' && p.depth >= 0) ? p.depth : (typeof _defaultDepth === 'number' ? _defaultDepth : 0),
              role: (p.role === 0 || p.role === 1 || p.role === 2 || p.role === 'system' || p.role === 'user' || p.role === 'assistant') ? p.role : 'system'
            };
          }
        } catch (_e) {
          /* 不是合法 JSON，按纯 prompt 文本处理 */ }
      }
      return {
        prompt: v,
        depth: typeof _defaultDepth === 'number' ? _defaultDepth : 0,
        role: 'system'
      };
    }
    return {
      prompt: '',
      depth: typeof _defaultDepth === 'number' ? _defaultDepth : 0,
      role: 'system'
    };
  }

  // ======================================================================
  // 世界书JSON归一化：ST 独立世界书导出格式 → 工具内部 chara_card_v3 格式
  // 用户锁定的世界书规则为 ST 导出格式（顶层 entries 对象 + 平铺字段）：
  //   {"entries": {"0": {"uid":0,"key":"...","comment":"...","position":0,"order":100,...}}}
  // 工具内部 character_book.entries 使用 keys数组 / extensions.position / insertion_order。
  // 本函数在 mergePartial 入口统一转换，使 AI 按规则输出的 JSON 可直接落盘。
  // ======================================================================
  // ⚠️完善：ST position 字符串枚举 → 内部数字（官方世界书导出格式兼容）
  //   before_char→0  after_char→1  before_an/before_example_messages→2  after_an/after_example_messages→3
  //   @深度(如@4)→4  EMTop→5  EMBottom→6  outlet→7；数字字符串"0"~"7"也转数字
  function _posToNum(posRaw) {
    if (typeof posRaw === 'number') return posRaw;
    if (typeof posRaw !== 'string') return 4;
    const s = posRaw.trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s.charAt(0) === '@') {
      const pn = parseInt(s.slice(1), 10);
      return isNaN(pn) ? 4 : pn;
    }
    const map = {
      'before_char': 0,
      'after_char': 1,
      'before_an': 2,
      'before_example_messages': 2,
      'after_an': 3,
      'after_example_messages': 3,
      'emtop': 5,
      'embottom': 6,
      'outlet': 7
    };
    const hit = map[s.toLowerCase()];
    return hit !== undefined ? hit : 4;
  }

  function normalizeWorldInfoJSON(partial) {
    if (!partial || typeof partial !== 'object') return partial;
    // ---- 1. 顶层 entries 对象 → 数组 ----
    // ST 世界书独立导出：{"entries": {"0": {...}, "1": {...}}}
    if (partial.entries && !Array.isArray(partial.entries) && typeof partial.entries === 'object') {
      const obj = partial.entries;
      const arr = Object.keys(obj).map(function(k) {
        return obj[k];
      }).filter(function(e) {
        return e && typeof e === 'object';
      });
      partial.entries = arr;
    }
    // character_book.entries 对象 → 数组（同理）
    if (partial.character_book && partial.character_book.entries && !Array.isArray(partial.character_book.entries) && typeof partial.character_book.entries === 'object') {
      const obj = partial.character_book.entries;
      const arr = Object.keys(obj).map(function(k) {
        return obj[k];
      }).filter(function(e) {
        return e && typeof e === 'object';
      });
      partial.character_book.entries = arr;
    }
    // ---- 2. 每条目：ST 平铺字段 → 内部字段 ----
    const lists = [];
    if (partial.entries && Array.isArray(partial.entries)) lists.push(partial.entries);
    if (partial.character_book && partial.character_book.entries && Array.isArray(partial.character_book.entries)) lists.push(partial.character_book.entries);
    lists.forEach(function(entryList) {
      entryList.forEach(function(ne) {
        if (!ne || typeof ne !== 'object') return;
        // key/keysecondary（逗号分隔字符串 或 数组）→ keys/secondary_keys（数组）
        if (ne.key !== undefined && ne.keys === undefined) {
          ne.keys = Array.isArray(ne.key) ? ne.key.slice() : String(ne.key).split(/[,，、\n]/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
          delete ne.key;
        }
        if (ne.keysecondary !== undefined && ne.secondary_keys === undefined) {
          ne.secondary_keys = Array.isArray(ne.keysecondary) ? ne.keysecondary.slice() : String(ne.keysecondary).split(/[,，、\n]/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
          delete ne.keysecondary;
        }
        // order → insertion_order
        if (ne.order !== undefined && ne.insertion_order === undefined) {
          ne.insertion_order = ne.order;
          delete ne.order;
        }
        // disable → enabled
        if (ne.disable !== undefined && ne.enabled === undefined) {
          ne.enabled = !ne.disable;
          delete ne.disable;
        }
        // 其余平铺字段 → extensions.*（ST导出格式字段名 → 内部扩展字段名）
        if (!ne.extensions) ne.extensions = {};
        const ext = ne.extensions;
        const flatMap = {
          position: 'position',
          depth: 'depth',
          role: 'role',
          probability: 'probability',
          useProbability: 'useProbability',
          selectiveLogic: 'selectiveLogic',
          preventRecursion: 'prevent_recursion',
          excludeRecursion: 'exclude_recursion',
          delayUntilRecursion: 'delay_until_recursion',
          sticky: 'sticky',
          cooldown: 'cooldown',
          delay: 'delay',
          scanDepth: 'scan_depth',
          caseSensitive: 'case_sensitive',
          matchWholeWords: 'match_whole_words',
          useGroupScoring: 'use_group_scoring',
          group: 'group',
          groupWeight: 'group_weight',
          groupOverride: 'group_override',
          automationId: 'automation_id',
          matchPersonaDescription: 'match_persona_description',
          matchCharacterDescription: 'match_character_description',
          matchCharacterPersonality: 'match_character_personality',
          matchCharacterDepthPrompt: 'match_character_depth_prompt',
          matchScenario: 'match_scenario',
          matchCreatorNotes: 'match_creator_notes',
          ignoreBudget: 'ignore_budget',
          addMemo: 'addMemo',
          outletName: 'outlet_name',
          triggers: 'triggers',
          characterFilter: 'character_filter',
          useRegex: 'use_regex',
          vectorized: 'vectorized'
        };
        Object.keys(flatMap).forEach(function(flatKey) {
          if (ne[flatKey] !== undefined && ext[flatMap[flatKey]] === undefined) {
            ext[flatMap[flatKey]] = ne[flatKey];
            delete ne[flatKey];
          }
        });
        // ⚠️完善：position 字符串枚举（官方导出格式）→ 内部数字
        if (ext.position !== undefined) ext.position = _posToNum(ext.position);
      });
    });
    return partial;
  }

  function mergePartial(partial, cd, options) {
    if (!partial || typeof partial !== 'object') return false;
    // 入口归一化：ST 世界书导出格式 → 内部格式
    try {
      normalizeWorldInfoJSON(partial);
    } catch (_ne) {}
    options = options || {};
    let modified = false;
    const changeLog = {
      added: 0,
      updated: 0,
      deleted: 0,
      fieldUpdates: 0
    };

    // ======================================================================
    // ========== Tab 隔离：mergePartial 入口处的双向硬拦截 ==========
    // ======================================================================
    // 这是实际写入 cardData 前的最后一道统一防线
    // 1. 角色卡Tab：拦截所有 MVU/变量/状态栏 相关的写入（comment/content/字段都拦截）
    // 2. MVU Tab：只允许修改白名单字段，禁止改动角色卡主体
    // ======================================================================
    // 注意：这里需要从全局作用域拿到 activeTab，优先顺序与 buildPrompt 保持一致，避免Tab错位
    let _activeTab = 'card';
    if (typeof window !== 'undefined') {
      // 1. 优先 window.__getActiveTab()（最新闭包，每次switchTab都会重新绑定）
      if (typeof window.__getActiveTab === 'function') {
        try {
          const _t = window.__getActiveTab();
          if (_t === 'card' || _t === 'mvu') _activeTab = _t;
        } catch (_eTabA) {}
      }
      // 2. 降级 window.__tab_activeTab（同步标记值）
      if (_activeTab !== 'mvu' && window.__tab_activeTab) {
        _activeTab = (window.__tab_activeTab === 'mvu') ? 'mvu' : 'card';
      }
    }
    // 3. 最后作用域 activeTab/currentTab 兜底
    try {
      if (typeof activeTab !== 'undefined' && (activeTab === 'card' || activeTab === 'mvu')) _activeTab = activeTab;
      else if (typeof currentTab !== 'undefined' && (currentTab === 'card' || currentTab === 'mvu')) _activeTab = currentTab;
    } catch (_eSc) {}

    // ====== MVU关键词库（升级版）：拆分强弱两档，支持灰色模式 + 扩展附加条目识别 ======
    //   MVU_STRONG_RE = 功能性/结构性强特征（出现即代表真实MVU条目，永远拦截）
    //   MVU_WEAK_RE    = 讨论性弱特征（仅严格模式拦截；灰色模式开启时放行，允许AI讨论/规划变量结构）
    //   MVU_EXTRA_RE   = MVU体系附加条目关键词（8条工作流条目之外的功能性附加条目：阶段判定/EJS控制器/人设切换/派生字段等，仅用于MVU Tab放宽识别，不参与角色卡Tab拦截）
    // 灰色模式（window.__mvuDiscussMode=true）：角色卡Tab允许讨论变量结构，但仍禁止生成真实MVU条目
    const MVU_STRONG_RE = /(\[InitVar\]|\[mvu_update\]|StatusPlaceHolderImpl|<UpdateVariable>|format_message_variable|initvar|mvu_update|stat_data|waitGlobalInitialized|registerMvuSchema)/i;
    const MVU_WEAK_RE = /(变量更新规则|变量输出格式|变量输出格式强调|占位符提醒|状态栏占位|状态变量输出|变量更新函数|动态状态栏|变量渲染函数|MVU变量系统|MVU状态栏)/i;
    // 附加条目关键词：用于MVU Tab识别"变量体系附加条目"——这些条目不是8条工作流核心条目，但仍属于变量系统的配套功能
    const MVU_EXTRA_RE = /(阶段判定|阶段切换|人设切换|人设规则|EJS|ejs|动态注入|injectPrompts|派生字段|衍生字段|只读字段|联动规则|联动变更|阈值触发|控制器|阶段变量|状态机|分阶段|多阶段|关系阶段|剧情进度|系统模式|境界等级|阶段标记|判定逻辑|分段提示|变量分段)/i;
    const _mvuDiscussMode = (typeof window !== 'undefined') && (window.__mvuDiscussMode === true);
    /* MVU_KEYWORDS_RE：完整集（强弱+附加条目关键词合并），供 MVU Tab 判定"是否MVU条目"使用，不受灰色模式影响 */
    const MVU_KEYWORDS_RE = new RegExp('(' + MVU_STRONG_RE.source.slice(1, -1) + '|' + MVU_WEAK_RE.source.slice(1, -1) + '|' + MVU_EXTRA_RE.source.slice(1, -1) + ')', 'i');
    const MVU_CONTENT_KEYWORDS_RE = /(format_message_variable::stat_data|enabled=false.*初始变量|INITVAR_.*MVU|<UpdateVariable>|\[MVU\]|MVU变量系统|MVU.*变量|变量.*MVU|MVU状态栏|状态栏.*MVU|getvar\(|injectPrompts|EJS|ejs)/i;
    /* 改进10：角色卡Tab拦截判定（灰色模式感知 + 弱特征降误拦）
       - 强特征（功能性标记）：comment 或 content 命中即拦截（真实MVU条目必有）
       - 弱特征（讨论性词）：仅 comment（条目标题）命中才拦截；正文偶发提及不拦，降低误拦率
       - 灰色模式：弱特征完全放行，允许讨论/规划变量结构 */
    const _isMvuCardEntry = function(e) {
      if (!e) return false;
      const cmt = e.comment || '';
      const cnt = e.content || '';
      if (MVU_STRONG_RE.test(cmt) || MVU_STRONG_RE.test(cnt)) return true;
      if (!_mvuDiscussMode && (MVU_WEAK_RE.test(cmt) || MVU_CONTENT_KEYWORDS_RE.test(cmt))) return true;
      return false;
    };

    if (_activeTab === 'card') {
      // ===================== 角色卡Tab：硬拦截所有MVU写入 =====================
      // 拦截 entries / character_book.entries
      const mvuBlockedCounts = {
        entries: 0,
        fields: 0,
        regex_scripts: 0
      };
      ['entries', 'character_book'].forEach(function(blockKey) {
        if (blockKey === 'entries' && partial.entries && Array.isArray(partial.entries)) {
          const before = partial.entries.length;
          partial.entries = partial.entries.filter(function(e) {
            if (!e) return false;
            const isMvu = _isMvuCardEntry(e);
            if (isMvu) {
              console.warn('[Tab隔离·角色卡Tab] 拦截MVU条目: comment=', e.comment);
            }
            return !isMvu;
          });
          mvuBlockedCounts.entries += (before - partial.entries.length);
        }
        if (blockKey === 'character_book' && partial.character_book && partial.character_book.entries && Array.isArray(partial.character_book.entries)) {
          const beforeC = partial.character_book.entries.length;
          partial.character_book.entries = partial.character_book.entries.filter(function(e) {
            if (!e) return false;
            const isMvu = _isMvuCardEntry(e);
            if (isMvu) {
              console.warn('[Tab隔离·角色卡Tab] 拦截character_book MVU条目: comment=', e.comment);
            }
            return !isMvu;
          });
          mvuBlockedCounts.entries += (beforeC - partial.character_book.entries.length);
        }
      });
      // 拦截 regex_scripts：角色卡Tab绝对不能写 regex_scripts（MVU专属）
      if (partial.extensions && partial.extensions.regex_scripts) {
        mvuBlockedCounts.regex_scripts += (Array.isArray(partial.extensions.regex_scripts) ? partial.extensions.regex_scripts.length : 1);
        console.warn('[Tab隔离·角色卡Tab] 拦截 regex_scripts 写入（MVU Tab专属）：已丢弃', mvuBlockedCounts.regex_scripts, '条正则脚本');
        delete partial.extensions.regex_scripts;
      }
      if (partial.regex_scripts) {
        mvuBlockedCounts.regex_scripts += (Array.isArray(partial.regex_scripts) ? partial.regex_scripts.length : 1);
        console.warn('[Tab隔离·角色卡Tab] 拦截顶层 regex_scripts 写入（MVU Tab专属）');
        delete partial.regex_scripts;
      }
      // 拦截顶层 MVU 敏感字段写入（如果AI写了的话）
      ['status_bar', 'statusbar', 'mvu_variables', 'mvu_config', 'variable_list', 'var_list', 'update_rules', 'output_format'].forEach(function(badKey) {
        if (partial[badKey] !== undefined) {
          console.warn('[Tab隔离·角色卡Tab] 拦截MVU敏感字段写入：', badKey);
          delete partial[badKey];
          mvuBlockedCounts.fields++;
        }
      });
      if (mvuBlockedCounts.entries > 0 || mvuBlockedCounts.fields > 0 || mvuBlockedCounts.regex_scripts > 0) {
        changeLog._mvuBlockedOnCardTab = mvuBlockedCounts;
        if (_mvuDiscussMode) changeLog._mvuDiscussMode = true;
        if (typeof showToast === 'function') {
          const _msgParts = [];
          if (mvuBlockedCounts.entries > 0) _msgParts.push('拦截MVU世界书条目 ' + mvuBlockedCounts.entries + ' 条');
          if (mvuBlockedCounts.regex_scripts > 0) _msgParts.push('拦截正则脚本 ' + mvuBlockedCounts.regex_scripts + ' 条');
          if (mvuBlockedCounts.fields > 0) _msgParts.push('拦截MVU字段写入 ' + mvuBlockedCounts.fields + ' 项');
          if (_msgParts.length > 0) {
            const _mvuTip = _mvuDiscussMode ?
              '（灰色模式：已放行变量结构讨论，仅拦截真实MVU条目；如需生成请切换MVU Tab）' :
              '（请切换到MVU变量状态栏Tab进行操作）';
            try {
              showToast('角色卡Tab已' + _msgParts.join('，') + _mvuTip, 'warning');
            } catch (e) { logWarn("mergePartial", e); }
          }
        }
      }
    } else if (_activeTab === 'mvu') {
      // ===================== MVU Tab：只允许修改白名单字段，禁止改动角色卡主体 =====================
      // 白名单：只有以下允许
      //   1. character_book.entries 中的MVU工作流条目（第2-7条，由 MVU_KEYWORDS_RE 判定）
      //   2. extensions.regex_scripts （状态栏正则）
      //   3. extensions.tavern_helper.scripts （zod脚本）
      //   4. extensions.tavern_helper.variables （变量定义，如果有的话）
      const mvuWlBlocked = {
        fields: 0,
        entries: 0
      };
      // 过滤顶层字段（name/description/first_mes等一律禁改）
      const MVU_ALLOWED_TOP_KEYS = ['entries', 'character_book', 'extensions', 'deleted_entries', 'delete', '_delete', 'deletes', 'remove', 'removes', '_nochange'];
      Object.keys(partial).forEach(function(topKey) {
        if (MVU_ALLOWED_TOP_KEYS.indexOf(topKey) < 0) {
          console.warn('[Tab隔离·MVU Tab] 拦截非白名单顶层字段写入（角色卡主体禁改）：', topKey);
          delete partial[topKey];
          mvuWlBlocked.fields++;
        }
      });
      // 过滤 entries/character_book.entries：
      // 允许所有MVU体系条目通过（8条工作流条目+附加条目），只拦截明确是角色卡Tab专属的内容
      // 允许通过的：MVU变量条目（InitVar/变量列表/更新规则/输出格式/格式强调/占位提醒等）/ 阶段判定 / EJS控制器 / 人设切换 / 派生字段 / 状态机 / 自定义变量相关条目 等
      // 拦截的：明确属于角色卡Tab常驻体系/世界观体系的专有模板条目（世界元数据/统一输出格式/角色边界等）
      const CARD_ONLY_TEMPLATES_RE = /^<(世界元数据|统一输出格式|角色边界|禁止项|自定义条目|观察锚点)>/i;
      const filterMvuOnlyEntries = function(arr, srcName) {
        if (!arr || !Array.isArray(arr)) return arr;
        const before = arr.length;
        arr = arr.filter(function(e) {
          if (!e) return false;
          const cmt = String(e.comment || '');
          const cnt = String(e.content || '');
          // 允许：删除动作（删除任意条目都允许，MVU/非MVU都能删，避免用户需要切Tab删）
          if (e._action === 'delete' || e._action === 'remove' || e.delete === true) {
            return true;
          }
          // 判定1：命中MVU关键词（核心+附加）→ 是MVU体系条目 → 通过
          const isMvuEntry = MVU_KEYWORDS_RE.test(cmt) || MVU_KEYWORDS_RE.test(cnt) || isMVUEntry(cmt);
          if (isMvuEntry) return true;
          // 判定2：命中角色卡Tab专属模板条目（<世界元数据>、<统一输出格式>等）→ 拦截
          const isCardOnlyTemplate = CARD_ONLY_TEMPLATES_RE.test(cmt);
          if (isCardOnlyTemplate) {
            console.warn('[Tab隔离·MVU Tab] 拦截角色卡Tab专属条目：', cmt, '→请切换到角色卡Tab修改该类条目');
            return false;
          }
          // 判定3：未命中任何角色卡专属特征 → 默认放行（属于MVU体系的自定义附加条目、或用户自定义内容）
          // 注：因为角色卡Tab已做了严格的MVU→角色卡方向拦截，两边完全隔离，所以MVU Tab这边不需要反向过度拦截
          return true;
        });
        mvuWlBlocked.entries += (before - arr.length);
        return arr;
      };
      if (partial.entries && Array.isArray(partial.entries)) partial.entries = filterMvuOnlyEntries(partial.entries, 'entries');
      if (partial.character_book && partial.character_book.entries && Array.isArray(partial.character_book.entries)) {
        partial.character_book.entries = filterMvuOnlyEntries(partial.character_book.entries, 'character_book.entries');
      }
      // 过滤 extensions：只允许 regex_scripts / tavern_helper.scripts / tavern_helper.variables
      if (partial.extensions && typeof partial.extensions === 'object') {
        const extWhiteList = ['regex_scripts', 'tavern_helper', 'depth_prompt'];
        Object.keys(partial.extensions).forEach(function(extKey) {
          if (extWhiteList.indexOf(extKey) < 0) {
            console.warn('[Tab隔离·MVU Tab] 拦截非白名单 extensions 字段：', extKey);
            delete partial.extensions[extKey];
            mvuWlBlocked.fields++;
          }
        });
        // tavern_helper 再细过滤：只允许 scripts / variables
        if (partial.extensions.tavern_helper && typeof partial.extensions.tavern_helper === 'object') {
          Object.keys(partial.extensions.tavern_helper).forEach(function(thKey) {
            if (['scripts', 'variables'].indexOf(thKey) < 0) {
              console.warn('[Tab隔离·MVU Tab] 拦截非白名单 tavern_helper 字段：', thKey);
              delete partial.extensions.tavern_helper[thKey];
              mvuWlBlocked.fields++;
            }
          });
        }
      }
      if (mvuWlBlocked.fields > 0 || mvuWlBlocked.entries > 0) {
        changeLog._mvuWlBlockedOnMvuTab = mvuWlBlocked;
        if (typeof showToast === 'function') {
          const _wlParts = [];
          if (mvuWlBlocked.entries > 0) _wlParts.push('拦截非MVU世界书条目 ' + mvuWlBlocked.entries + ' 条');
          if (mvuWlBlocked.fields > 0) _wlParts.push('拦截非白名单字段写入 ' + mvuWlBlocked.fields + ' 项');
          if (_wlParts.length > 0) {
            try {
              showToast('MVU Tab已' + _wlParts.join('，') + '（角色卡主体字段/普通世界书条目请切换到角色卡Tab）', 'warning');
            } catch (e) { logWarn("mergePartial", e); }
          }
        }
      }
    }
    // ======================================================================
    // ========== 硬拦截结束 =================================================
    // ======================================================================

    // ====== MVU Tab 专属：写入前对已有数据做去重清理 ======
    // 问题根因：AI 多次生成 MVU 条目时，comment 可能稍有不同（如 [mvu_update]变量更新规则 vs 变量更新规则），
    // findMatchingEntry 无法匹配 → 产生重复条目。正则脚本也有类似问题。
    // 解决方案：在 MVU Tab 下，写入新数据前先清理已有数据中的重复项。
    if (_activeTab === 'mvu') {
      // ---- 1. MVU 世界书条目去重：按 MVU 类型分类，同类型只保留最后一条 ----
      if (cd.character_book && cd.character_book.entries && Array.isArray(cd.character_book.entries)) {
        const mvuTypeMap = {}; // type → index in entries
        const indicesToRemove = [];
        for (let ei = 0; ei < cd.character_book.entries.length; ei++) {
          const e = cd.character_book.entries[ei];
          if (!e) continue;
          const cmt = String(e.comment || '');
          const cnt = String(e.content || '');
          let mvuType = null;
          // 分类 MVU 条目类型（注意：先检查"格式强调"再检查"输出格式"，否则前者会被后者误匹配）
          if (_isInitVarComment(cmt, cnt)) mvuType = 'initvar';
          else if (_isVarListEntry(cmt, cnt)) mvuType = 'varlist';
          else if (cmt.indexOf('变量更新规则') >= 0 || cmt.indexOf('[mvu_update]变量更新规则') >= 0) mvuType = 'updaterule';
          else if (cmt.indexOf('变量输出格式强调') >= 0) mvuType = 'outputfmt_emph';
          else if (cmt.indexOf('变量输出格式') >= 0 || (cmt.indexOf('mvu_update') >= 0 && cnt.indexOf('UpdateVariable') >= 0)) mvuType = 'outputfmt';
          else if (cmt.indexOf('<状态栏>') >= 0 || cmt.indexOf('StatusPlaceHolder') >= 0 || (cmt.indexOf('状态栏') >= 0 && (cmt.indexOf('占位') >= 0 || cmt.indexOf('提醒') >= 0))) mvuType = 'statusbar_placeholder';
          if (mvuType) {
            if (mvuTypeMap[mvuType] !== undefined) {
              // 已有同类型条目 → 标记旧的为待删除（保留新的，因为新的在数组后面 = 更新生成）
              indicesToRemove.push(mvuTypeMap[mvuType]);
            }
            mvuTypeMap[mvuType] = ei;
          }
        }
        // 降序删除重复的旧条目
        if (indicesToRemove.length > 0) {
          indicesToRemove.sort(function(a, b) {
            return b - a;
          });
          indicesToRemove.forEach(function(idx) {
            console.warn('[Tab隔离·MVU Tab] 去重：删除重复的旧MVU条目:', cd.character_book.entries[idx].comment);
            cd.character_book.entries.splice(idx, 1);
          });
          changeLog._mvuDedupRemoved = indicesToRemove.length;
          modified = true;
        }
      }
      // ---- 2. 正则脚本去重：按「美化(markdownOnly且非promptOnly)」和「隐藏(promptOnly)」分类，各类只保留最后一条 ----
      // ⚠️旧逻辑只按 findRegex 含 StatusPlaceHolder 去重，会把功能完全不同的「[美化]MVU状态栏」
      //   (markdownOnly, 显示用) 和「[不发送]隐藏状态栏标记」(promptOnly, 提示词清理用) 混在一起，
      //   误删隐藏脚本。现改为分类去重，且按 id === 'mvu-status-bar' 精确匹配美化脚本。
      if (cd.extensions && cd.extensions.regex_scripts && Array.isArray(cd.extensions.regex_scripts)) {
        const rxList = cd.extensions.regex_scripts;
        // 分类收集：beautify=美化显示脚本，hide=提示词清理脚本
        const beautifyIdxList = [];
        const hideIdxList = [];
        for (let ri = 0; ri < rxList.length; ri++) {
          if (!rxList[ri]) continue;
          const rxr = rxList[ri];
          const rxFind = (rxr.findRegex || '');
          const hasStatusPH = rxFind.indexOf('StatusPlaceHolder') >= 0 || rxr.id === 'mvu-status-bar';
          if (!hasStatusPH) continue;
          // 区分两类：promptOnly 的是「隐藏占位符」脚本，markdownOnly 且非 promptOnly 的是「美化状态栏」脚本
          if (rxr.promptOnly) {
            hideIdxList.push(ri);
          } else {
            beautifyIdxList.push(ri);
          }
        }
        // 美化脚本去重：多于1个时只保留最后一个（最新的）
        let totalRemoved = 0;
        const allRxRemoveIndices = []; // 🐛修复：合并所有要删的索引，统一降序删除，避免分类splice导致的索引错位
        if (beautifyIdxList.length > 1) {
          const removeBeautify = beautifyIdxList.slice(0, -1);
          removeBeautify.forEach(function(idx) {
            console.warn('[Tab隔离·MVU Tab] 去重：删除重复的[美化]MVU状态栏脚本:', rxList[idx].scriptName || rxList[idx].name);
            allRxRemoveIndices.push(idx);
          });
          totalRemoved += removeBeautify.length;
        }
        // 隐藏脚本去重：多于1个时只保留最后一个
        if (hideIdxList.length > 1) {
          const removeHide = hideIdxList.slice(0, -1);
          removeHide.forEach(function(idx) {
            console.warn('[Tab隔离·MVU Tab] 去重：删除重复的[不发送]隐藏状态栏标记脚本:', rxList[idx].scriptName || rxList[idx].name);
            allRxRemoveIndices.push(idx);
          });
          totalRemoved += removeHide.length;
        }
        // 🐛修复：统一降序排序后一次性 splice，避免第一类 splice 后第二类索引失效
        if (allRxRemoveIndices.length > 0) {
          allRxRemoveIndices.sort(function(a, b) {
            return b - a;
          });
          const seenRxIdx = {};
          allRxRemoveIndices.forEach(function(idx) {
            if (!seenRxIdx[idx] && idx < rxList.length) {
              seenRxIdx[idx] = true;
              rxList.splice(idx, 1);
            }
          });
        }
        if (totalRemoved > 0) {
          changeLog._mvuRxScriptDedupRemoved = totalRemoved;
          modified = true;
        }
      }
    }

    if (partial.character && !partial.spec) {
      const ch = partial.character;
      delete partial.character;
      for (const k in ch) {
        if (ch.hasOwnProperty(k)) partial[k] = ch[k];
      }
    }

    // ================================================================
    // ===== 🐛修复#1：删除声明收集阶段（建立「删除屏障」deletedCommentKeySet） =====
    // ================================================================
    // 执行顺序：先收集所有删除意图，再执行条目合并，最后统一删除。
    // 目的：避免 AI 把"删除声明"写在 entries 而"该条目重写内容"写在 character_book.entries，
    //       导致"先删掉又被后面 processEntriesFn 重新加回来"的问题。
    // 同时 processEntriesFn 中命中删除屏障的条目会被直接丢弃（既不新增也不更新）。
    // ================================================================
    let deletePaths = [];
    if (partial.deleted_entries && Array.isArray(partial.deleted_entries)) {
      partial.deleted_entries.forEach(function(c) {
        deletePaths.push('character_book.entries.' + c);
      });
      delete partial.deleted_entries;
    }
    ['_delete', 'delete', 'deletes', 'remove', 'removes'].forEach(function(dk) {
      if (partial[dk] && Array.isArray(partial[dk])) {
        deletePaths = deletePaths.concat(partial[dk]);
        delete partial[dk];
      }
    });
    // 规范化 key：trim + 大小写不敏感 + 剥去⟦⟧/【】等外层装饰括号（解决AI一会儿加括号一会儿不加）
    // 注：_stripOuterBrackets 已提升为 IIFE 顶层共享函数（见 _deriveEntryKeys 上方）
    const normKey = function(s) {
      return _stripOuterBrackets(s).trim().toLowerCase();
    };
    const deletedCommentKeySet = {}; // 命中则：新增丢弃 + 更新丢弃（整轮彻底消失）
    const entryPrefixForScan = 'character_book.entries.';
    // 从 deletePaths 中提取所有 comment 形式的 key 放入屏障集合
    deletePaths.forEach(function(p) {
      const sp = String(p);
      if (sp.indexOf(entryPrefixForScan) === 0) {
        const rawKey = sp.slice(entryPrefixForScan.length);
        if (!/^\d+$/.test(rawKey)) deletedCommentKeySet[normKey(rawKey)] = true; // 纯数字是索引，不是comment
      } else if (sp.indexOf('.') < 0 && !/^\d+$/.test(sp)) {
        deletedCommentKeySet[normKey(sp)] = true; // 裸数字是不稳定索引，不进删除屏障
      }
    });
    const inlineEntryDeletes = [];
    const scanInlineDeletes = function(arr) {
      if (!arr || !Array.isArray(arr)) return;
      for (let di = arr.length - 1; di >= 0; di--) {
        if (arr[di] && (arr[di]._action === 'delete' || arr[di]._action === 'remove' || arr[di].delete === true)) {
          if (arr[di].comment) {
            inlineEntryDeletes.push(arr[di].comment);
            deletedCommentKeySet[normKey(arr[di].comment)] = true; // 加入删除屏障
          }
          arr.splice(di, 1);
        }
      }
    };
    scanInlineDeletes(partial.entries);
    if (partial.character_book && partial.character_book.entries) scanInlineDeletes(partial.character_book.entries);
    inlineEntryDeletes.forEach(function(ic) {
      deletePaths.push('character_book.entries.' + ic);
    });

    // ================================================================
    // ===== 🐛修复"条目被清空"：删写配对=替换语义 =====
    // ================================================================
    // 优化场景下 AI 常按"先 _action:delete 旧条目，再输出同 comment 新内容"的配对写法表达"重写"。
    // 旧逻辑一律执行删除 + 删除屏障吞掉同轮新条目 → 旧的删了、新的没进来 → 条目净减少，
    // AI 对每条都这么写时整张世界书被清空（用户实测）。
    // 规则：同一轮里，若某 comment 既出现在删除声明中、又作为有效条目出现在写入数组中，
    // 判定为"替换/覆盖"意图——取消该 comment 的删除（含屏障），让新内容按正常 upsert 覆盖旧条目。
    // 只有"只删不写"的 comment 才真正删除（真精简/去重）。
    const _replacementKeys = {};
    const _collectWrites = function(arr) {
      if (!arr || !Array.isArray(arr)) return;
      arr.forEach(function(e) {
        if (e && typeof e === 'object' && e.comment) {
          const k = normKey(e.comment);
          if (k) _replacementKeys[k] = true;
        }
      });
    };
    _collectWrites(partial.entries);
    if (partial.character_book) _collectWrites(partial.character_book.entries);
    Object.keys(_replacementKeys).forEach(function(rk) {
      if (deletedCommentKeySet[rk]) {
        delete deletedCommentKeySet[rk];
        // 同步从 deletePaths 移除该 comment 的删除（保留数字索引路径，下面单独收紧）
        deletePaths = deletePaths.filter(function(p) {
          const sp = String(p);
          if (sp.indexOf(entryPrefixForScan) === 0) {
            return normKey(sp.slice(entryPrefixForScan.length)) !== rk;
          }
          return sp.indexOf('.') >= 0 || normKey(sp) !== rk;
        });
        changeLog._replacePairs = (changeLog._replacePairs || 0) + 1;
      }
    });

    // ================================================================
    // ===== 处理 entries（在删除执行之前先合并，但会过滤掉"删除屏障"命中的条目）=====
    // ================================================================
    // ---- 处理 entries（修复：智能匹配+content过短时也允许更新非content字段 + 删除屏障丢弃） ----
    const processEntriesFn = function(newEntries) {
      if (!newEntries || !Array.isArray(newEntries)) return;
      cd.character_book = cd.character_book || {
        entries: []
      };
      const existing = cd.character_book.entries || [];
      const SB_ENTRY_BLOCK_RE = /状态栏.*Step\s*[2-7]|Step\s*[2-7].*状态栏|状态栏.*(配色|HTML骨架|CSS样式|变量读取|渲染函数|事件绑定)|(配色|HTML骨架|CSS样式|变量读取|渲染函数|事件绑定).*状态栏/;
      // 拦截 AI 误将 regex 脚本配置写成世界书条目（正则脚本由写卡器自动维护）
      const REGEX_ENTRY_BLOCK_RE = /^regex[:：]/i;
      newEntries = newEntries.filter(function(ne) {
        if (!ne || typeof ne !== 'object') return true;
        const cmt = String(ne.comment || '');
        if (SB_ENTRY_BLOCK_RE.test(cmt)) {
          console.warn('[statusbar] 拦截状态栏模块条目，不写入世界书:', cmt);
          return false;
        }
        // 拦截 regex: 脚本配置误写为世界书条目
        if (REGEX_ENTRY_BLOCK_RE.test(cmt)) {
          console.warn('[sanitize] 拦截regex脚本配置条目，不写入世界书:', cmt);
          return false;
        }
        const cnt = String(ne.content || '');
        if (cnt.length > 50) {
          const hasSbCodeMarker = (cnt.indexOf('StatusPlaceHolderImpl') >= 0) ||
            (cnt.indexOf('waitGlobalInitialized') >= 0 && cnt.indexOf('eventOn') >= 0) ||
            (cnt.indexOf('/* === Step') >= 0 && cnt.indexOf('===') >= 0 && /Step\s*[2-7]/.test(cnt));
          if (hasSbCodeMarker && /状态栏|statusbar/i.test(cmt)) {
            console.warn('[statusbar] 拦截状态栏代码内容条目，不写入世界书:', cmt);
            return false;
          }
        }
        return true;
      });
      // ===== 防御 newEntries 里混入字符串（AI/用户误传 depth_prompt.prompt 直接进数组）=====
      newEntries = newEntries.map(function(ne) {
        if (typeof ne === 'string' && ne.trim()) {
          const firstLine = ne.split('\n')[0].trim().slice(0, 40) || '未命名文本块';
          console.warn('[mergePartial] newEntries含字符串元素，已包装为条目:', firstLine);
          return {
            comment: firstLine,
            content: ne
          };
        }
        return ne;
      });
      newEntries.forEach(function(ne) {
        if (!ne || typeof ne !== 'object') return;
        if (!ne.comment || !String(ne.comment).trim()) {
          if (ne.name && String(ne.name).trim()) {
            ne.comment = String(ne.name).trim();
          } else if (ne.title && String(ne.title).trim()) {
            ne.comment = String(ne.title).trim();
          } else if (ne.content && typeof ne.content === 'string') {
            const firstLine = ne.content.split('\n')[0].trim();
            const prefixMatch = firstLine.match(/^(<[^>]+>[^<\n]{0,40})/);
            if (prefixMatch) {
              ne.comment = prefixMatch[1].trim();
            } else if (firstLine.length <= 40) {
              ne.comment = firstLine;
            } else {
              ne.comment = '条目' + (existing.length + 1);
            }
          } else {
            ne.comment = '条目' + (existing.length + 1);
          }
        }
        // ===== 🐛修复#2.5：入存前剥去⟦⟧/【】等外层装饰括号，统一 entries.comment 风格，避免一会儿带括号一会儿不带 =====
        // （注意：保留内部的 <xxx> / [xxx] 前缀，只剥最外层装饰用括号；若剥完为空则保留原值）
        if (ne.comment && typeof ne.comment === 'string') {
          const stripped = _stripOuterBrackets(ne.comment);
          if (stripped && stripped.length > 0) ne.comment = stripped;
        }
        // ===== 🐛修复#2：命中删除屏障 → 整轮直接丢弃（既不新增也不更新）=====
        if (deletedCommentKeySet[normKey(ne.comment)]) {
          console.warn('[mergePartial·删除屏障] 丢弃命中删除声明的条目（用户已要求删除，即使AI重写内容也不写入）:', ne.comment);
          return;
        }
        const hasComment = !!(ne.comment && String(ne.comment).trim());
        const hasMeaningfulContent = !!(ne.content && String(ne.content).trim().length >= 20);
        if (!hasComment && !hasMeaningfulContent) return;

        const tmpl = getEntryTemplate(ne.comment || '');
        // ⚠️ enabled 保留策略：模板显式配置 > AI 显式传值 > 更新时继承旧值 > 新增默认 true
        // （原先无条件设 true + Object.assign 覆盖，导致用户手动禁用的条目被任何 upsert 静默重新启用）
        const aiProvidedEnabled = ne.enabled !== undefined && ne.enabled !== null;
        if (tmpl && tmpl.enabled !== undefined) {
          ne.enabled = tmpl.enabled; // 模板显式配置优先（如 [InitVar] enabled=false）
        } else if (!aiProvidedEnabled) {
          delete ne.enabled; // 未指定：更新时继承旧值；新增时在 push 前统一补默认值
        }
        // ===== 🧹先清洗 MVU 条目 content 中混入的 enabled/content/comment 等配置字段 =====
        if (typeof ne.content === 'string') {
          ne.content = _stripEntryConfigFromContent(ne.comment || '', ne.content);
        }
        // ===== 再规范化（确保规范化结果是最终值，不被后续清洗破坏）=====
        // ⚠️ 用核心名严格匹配（_entryCommentCore 剥前缀后 === 系统名），不再用宽泛子串 indexOf：
        // 原先 <自定义条目>变量列表使用说明 这类普通条目会被 normalizeVarListContent 无条件覆盖为固定串，内容被摧毁
        const neCore = _entryCommentCore(ne.comment || '');
        if (_isInitVarComment(ne.comment, ne.content)) {
          if (typeof ne.content === 'string') ne.content = normalizeInitVarContent(ne.content);
        }
        if (neCore === '变量列表' && typeof ne.content === 'string') {
          ne.content = normalizeVarListContent(ne.content);
        }
        // 变量输出格式/强调条目：强制使用固定YAML模板，丢弃AI混入的变量值/配置字段
        if ((neCore === '变量输出格式' || neCore === '变量输出格式强调') && typeof ne.content === 'string') {
          ne.content = normalizeVarOutputFormatContent(ne.comment || '', ne.content);
        }
        // 变量更新规则条目：规范化缩进/range格式/移除string的type字段
        if (neCore === '变量更新规则' && typeof ne.content === 'string') {
          ne.content = normalizeVarUpdateRuleContent(ne.content);
        }
        if (tmpl) {
          // MVU 系统条目（变量输出格式/变量更新规则/InitVar等）的 selective/constant 必须强制使用模板值
          // AI 经常误写 selective:true，导致条目变为选择性触发而非常驻
          const isMvuSystemEntry = (neCore === '变量输出格式' || neCore === '变量输出格式强调' || neCore === '变量更新规则' ||
            _isInitVarComment(ne.comment, ne.content) || neCore === '变量列表');
          if (isMvuSystemEntry) {
            ne.selective = tmpl.selective;
            ne.constant = tmpl.constant;
          } else {
            if (ne.selective === undefined) ne.selective = tmpl.selective;
            if (ne.constant === undefined) ne.constant = tmpl.constant;
          }
          if (ne.insertion_order === undefined) ne.insertion_order = tmpl.order;
          if (ne.use_regex === undefined) ne.use_regex = tmpl.use_regex;
          if (ne.secondary_keys === undefined) ne.secondary_keys = tmpl.secondary_keys || [];
          if (!ne.extensions) ne.extensions = {};
          const ext = ne.extensions;
          if (ext.position === undefined) ext.position = tmpl.position;
          if (ext.depth === undefined) ext.depth = tmpl.depth;
          if (ext.role === undefined) ext.role = 0;
          if (ext.probability === undefined) ext.probability = tmpl.probability;
          if (ext.selectiveLogic === undefined) ext.selectiveLogic = tmpl.selectiveLogic;
          if (ext.prevent_recursion === undefined) ext.prevent_recursion = tmpl.prevent_recursion;
          if (ext.exclude_recursion === undefined) ext.exclude_recursion = tmpl.exclude_recursion;
          if (ext.delay_until_recursion === undefined) ext.delay_until_recursion = tmpl.delay_until_recursion;
          if (ext.sticky === undefined) ext.sticky = tmpl.sticky || 0;
          if (ext.cooldown === undefined) ext.cooldown = tmpl.cooldown;
          if (ext.delay === undefined) ext.delay = tmpl.delay;
          if (ext.match_whole_words === undefined) ext.match_whole_words = tmpl.match_whole_words;
          if (ext.scan_depth === undefined) ext.scan_depth = tmpl.scan_depth;
          if (ext.group === undefined) ext.group = tmpl.group;
          if (ext.group_weight === undefined) ext.group_weight = tmpl.group_weight;
          if (ext.useProbability === undefined) ext.useProbability = tmpl.useProbability;
        } else {
          if (ne.selective === undefined) ne.selective = true;
          if (ne.constant === undefined) ne.constant = false;
          if (!ne.extensions) ne.extensions = {
            position: 4,
            depth: 4,
            role: 0,
            probability: 100,
            selectiveLogic: 0,
            prevent_recursion: false,
            sticky: 0,
            cooldown: 0,
            delay: 0,
            group: '',
            group_weight: 100,
            useProbability: true
          };
        }
        // ⚠️修复：keys/secondary_keys 可能被 AI 写成字符串（如 "白娅,诗织"），统一归一化为数组
        if (typeof ne.keys === 'string') {
          ne.keys = ne.keys.split(/[,，、\n]/).map(function(k) {
            return k.trim();
          }).filter(function(k) {
            return k;
          });
        }
        if (typeof ne.secondary_keys === 'string') {
          ne.secondary_keys = ne.secondary_keys.split(/[,，、\n]/).map(function(k) {
            return k.trim();
          }).filter(function(k) {
            return k;
          });
        }
        if (!ne.keys) ne.keys = [];
        if (!ne.secondary_keys) ne.secondary_keys = [];
        // ===== ✅新增：processEntriesFn 空 keys 自动派生（mergePartial 路径的兜底）=====
        if (ne.keys.length === 0 && !(tmpl && tmpl.constant) && ne.constant !== true) {
          try {
            const dk = _deriveEntryKeys(ne.comment || '', tmpl, ne.content || '');
            if (dk && dk.length > 0) ne.keys = dk;
          } catch (e3) { logWarn("mergePartial", e3); }
        }

        const match = findMatchingEntry(ne, existing);
        if (match.index >= 0) {
          // 更新：深合并content优先（如果新content有内容就覆盖，没内容保留旧content）
          const oldEntry = existing[match.index];
          if (ne.content === undefined || String(ne.content).trim().length === 0) {
            const tmpContent = oldEntry.content;
            existing[match.index] = Object.assign({}, oldEntry, ne);
            existing[match.index].content = tmpContent;
          } else {
            existing[match.index] = Object.assign({}, oldEntry, ne);
          }
          // ⚠️ enabled 未显式指定时继承旧值（delete ne.enabled 后 Object.assign 不会覆盖，
          // 但 oldEntry 自身 enabled 为 undefined 的极端情况下兜底补 true）
          if (existing[match.index].enabled === undefined) existing[match.index].enabled = (oldEntry.enabled === undefined) ? true : oldEntry.enabled;
          modified = true;
          changeLog.updated++;
        } else {
          if (ne.enabled === undefined) ne.enabled = true; // 新增条目默认启用
          existing.push(ne);
          modified = true;
          changeLog.added++;
        }
      });
      cd.character_book.entries = existing;
    };

    // 顶层 entries 优先处理
    if (partial.entries && Array.isArray(partial.entries)) {
      processEntriesFn(partial.entries);
      delete partial.entries;
    }
    // character_book.entries 后处理
    if (partial.character_book && partial.character_book.entries && Array.isArray(partial.character_book.entries)) {
      processEntriesFn(partial.character_book.entries);
      delete partial.character_book.entries;
      if (Object.keys(partial.character_book).length === 0) delete partial.character_book;
    }

    // ================================================================
    // ===== 🐛修复#3：条目合并完成后统一执行删除（最后一道防线）=====
    // ================================================================
    // - comment 匹配使用规范化比较（trim + 大小写不敏感）
    // - 先删条目，再删其他字段（字段删除不影响 entries 索引）
    if (deletePaths.length > 0) {
      const entryPrefix = 'character_book.entries.';
      const fieldDeletes = [];
      const numericIndices = [];
      const commentDeletionIndices = []; // 🐛修复：comment匹配删除也收集索引，最后与数字索引统一降序删除
      deletePaths.forEach(function(path) {
        if (String(path).indexOf(entryPrefix) === 0) {
          const entryKey = String(path).slice(entryPrefix.length);
          if (cd.character_book && cd.character_book.entries) {
            const beforeLen = cd.character_book.entries.length;
            const idx = parseInt(entryKey);
            if (!isNaN(idx) && String(idx) === entryKey && idx >= 0 && idx < beforeLen) {
              // 🐛修复"优化清空条目"：禁止按数字索引删除。AI 只被教过用精确 comment 删除，
              // 它对卡片实时索引毫无认知（索引随合并/去重不断变化），按索引删除极易误删/连环删错，
              // 曾导致优化后整批条目消失。索引删除改为拒绝并上报，引导改用 comment。
              console.warn('[mergePartial] 拒绝数字索引删除（请改用精确comment）:', entryKey);
              changeLog._deleteFailures = changeLog._deleteFailures || [];
              changeLog._deleteFailures.push('条目索引#' + entryKey + '（已拒绝：索引不稳定，请使用条目精确名称 comment 删除）');
            } else {
              // 规范化比较：trim + 大小写不敏感 + 去装饰括号
              const nk = normKey(entryKey);
              const exactMatches = [];
              const fuzzyMatches = [];
              cd.character_book.entries.forEach(function(e, i) {
                const ek = normKey(e.comment);
                if (ek === nk && ek !== '') {
                  exactMatches.push(i);
                } else if (nk.length >= 6 && ek.length >= 6) {
                  if (ek.indexOf(nk) >= 0) fuzzyMatches.push(i);
                }
              });
              let toDelete = [];
              if (exactMatches.length > 0) {
                toDelete = exactMatches;
              } else if (fuzzyMatches.length === 1) {
                toDelete = fuzzyMatches;
              } else if (fuzzyMatches.length > 1) {
                console.warn('[mergePartial] 删除关键词"' + entryKey + '"模糊匹配到' + fuzzyMatches.length + '条条目，为防止误删已跳过。请使用精确comment。');
                // 模糊匹配多条导致未删除，把失败 key 记下来，外层 Toast 会提醒用户
                changeLog._deleteFailures = changeLog._deleteFailures || [];
                changeLog._deleteFailures.push(String(entryKey || '').slice(0, 120) + '（模糊匹配到' + fuzzyMatches.length + '条，已跳过）');
              }
              // 精确匹配 / 模糊单条 路径下，如果依然没有任何 toDelete，同样记录失败（精确也完全没匹配到）
              if (toDelete.length === 0 && exactMatches.length === 0 && fuzzyMatches.length === 0) {
                changeLog._deleteFailures = changeLog._deleteFailures || [];
                changeLog._deleteFailures.push(String(entryKey || '').slice(0, 120) + '（未匹配到任何条目）');
              }
              // 🐛修复：不立即 splice，改为收集索引，最后统一删除
              for (let di = 0; di < toDelete.length; di++) {
                commentDeletionIndices.push(toDelete[di]);
              }
            }
          }
        } else {
          const rawPath = String(path);
          const knownTopFields = ['name', 'description', 'first_mes', 'system_prompt', 'personality', 'scenario', 'creator_notes', 'alternate_greetings'];
          if (/^\d+$/.test(rawPath)) {
            // 裸数字=不稳定索引，拒绝按索引删除并上报（与 entryPrefix 数字路径一致）
            console.warn('[mergePartial] 拒绝裸数字索引删除（请改用精确comment）:', rawPath);
            changeLog._deleteFailures = changeLog._deleteFailures || [];
            changeLog._deleteFailures.push('条目索引#' + rawPath + '（已拒绝：索引不稳定，请使用条目精确名称 comment 删除）');
          } else if (rawPath.indexOf('.') < 0 && knownTopFields.indexOf(rawPath) < 0 && cd.character_book && cd.character_book.entries) {
            const nrp = normKey(rawPath);
            for (let fi = 0; fi < cd.character_book.entries.length; fi++) {
              if (normKey(cd.character_book.entries[fi].comment) === nrp) {
                commentDeletionIndices.push(fi); // 🐛修复：收集而非立即删
                break;
              }
            }
          } else {
            fieldDeletes.push(path);
          }
        }
      });
      // 🐛修复：合并数字索引 + comment匹配索引，去重后统一降序删除，避免索引移位
      const allEntryDeletions = numericIndices.concat(commentDeletionIndices);
      if (allEntryDeletions.length > 0) {
        // 降序排序
        allEntryDeletions.sort(function(a, b) {
          return b - a;
        });
        // 去重（降序后相邻重复）
        const uniqueIdx = [];
        allEntryDeletions.forEach(function(n) {
          if (uniqueIdx.indexOf(n) < 0) uniqueIdx.push(n);
        });
        uniqueIdx.forEach(function(uIdx) {
          if (uIdx < cd.character_book.entries.length) {
            cd.character_book.entries.splice(uIdx, 1);
            modified = true;
            changeLog.deleted++;
          }
        });
      }
      fieldDeletes.forEach(function(p) {
        const parts = String(p).split('.');
        let node = cd;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!node || typeof node !== 'object' || !(parts[i] in node)) {
            node = null;
            break;
          }
          node = node[parts[i]];
        }
        if (node && typeof node === 'object' && parts[parts.length - 1] in node) {
          delete node[parts[parts.length - 1]];
          modified = true;
          changeLog.deleted++;
        }
      });
    }
    delete partial._nochange;

    const fields = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'nickname', 'creator_notes', 'system_prompt', 'creator', 'character_version', 'alternate_greetings', 'group_only_greetings'];
    fields.forEach(function(f) {
      if (partial[f] !== undefined) {
        const val = partial[f];
        const oldVal = cd[f];
        if (f === 'first_mes' || f === 'description') {
          // 放宽占位符过滤：只有同时满足「文本非常短(<80字)」+「整段内容几乎全是占位词」时才跳过
          if (typeof val === 'string') {
            const vTrim = val.trim();
            if (vTrim.length < 80) {
              const hasPlaceholder = /正文已在上方|见上方|参见上文|见上文|已在上方|请见上文/.test(vTrim);
              const isOnlyPlaceholder = vTrim.length < 30 && hasPlaceholder;
              if (isOnlyPlaceholder) return;
            }
          }
          // 极短内容且仅含"输出"提示词时跳过（长度<30字+含「已输出/上文输出/见上文输出」）
          if (typeof val === 'string' && val.trim().length < 30 && /(已输出|上文输出|见上文.*输出)/.test(val)) {
            return;
          }
        }
        if (JSON.stringify(oldVal) !== JSON.stringify(val)) {
          cd[f] = val;
          modified = true;
          changeLog.fieldUpdates++;
        }
      }
    });

    if (partial.depth_prompt !== undefined) {
      cd.extensions = cd.extensions || {};
      // 防御：旧卡 extensions.depth_prompt / depth_prompt 可能是字符串（非空字符串 truthy，|| 不会替换）
      // 或更严重：JSON.stringify 后的字符串对象，导致 ".depth = ..." 抛 "Cannot create property 'depth' on string"
      cd.extensions.depth_prompt = normalizeDepthPrompt(cd.extensions.depth_prompt, 0);
      cd.depth_prompt = normalizeDepthPrompt(cd.depth_prompt, 0);
      const dp = partial.depth_prompt;
      let dpModified = false;
      if (typeof dp === 'string') {
        if (dp.trim().length > 0 && cd.extensions.depth_prompt.prompt !== dp) {
          cd.extensions.depth_prompt.prompt = dp;
          cd.depth_prompt.prompt = dp;
          dpModified = true;
        }
      } else if (dp && typeof dp === 'object') {
        if (dp.prompt !== undefined && typeof dp.prompt === 'string') {
          // 放宽：允许空字符串（显式清空），只有 undefined 才跳过
          if (cd.extensions.depth_prompt.prompt !== dp.prompt) {
            cd.extensions.depth_prompt.prompt = dp.prompt;
            cd.depth_prompt.prompt = dp.prompt;
            dpModified = true;
          }
        }
        if (dp.depth !== undefined && typeof dp.depth === 'number' && dp.depth >= 0 && cd.extensions.depth_prompt.depth !== dp.depth) {
          cd.extensions.depth_prompt.depth = dp.depth;
          cd.depth_prompt.depth = dp.depth;
          dpModified = true;
        }
        if (dp.role !== undefined && ['system', 'user', 'assistant', 0, 1, 2].indexOf(dp.role) >= 0 && cd.extensions.depth_prompt.role !== dp.role) {
          cd.extensions.depth_prompt.role = dp.role;
          cd.depth_prompt.role = dp.role;
          dpModified = true;
        }
      }
      if (dpModified) {
        modified = true;
        changeLog.fieldUpdates++;
      }
      delete partial.depth_prompt;
    }

    // ---- 智能合并 regex_scripts：支持增量更新、按名替换、_action:delete ----
    // ⚠️ MVU固定正则白名单拦截：正则1-5（仅格式思维链/只发送最新2楼变量更新/[美化]变量完成/[美化]变量更新中/[不发送]隐藏状态栏标记）
    //   由写卡器导出时自动注入，禁止AI写入cardData（避免导出时重复注入2份）
    //   只允许AI修改：正则6 [美化]MVU状态栏（id=mvu-status-bar 或 StatusPlaceHolderImpl + markdownOnly + 非promptOnly）
    const MVU_FIXED_REGEX_IDS = {
      'd668c8a6-fa6a-444d-a5d6-8f68b73a3c36': '仅格式思维链',
      '5bb4b588-23ca-4564-8df5-882104eff764': '只发送最新2楼的变量更新',
      '6fb572ae-a9ea-436d-9779-ad100f1ff7f5': '[美化]变量完成',
      'bf1b7441-5cf1-426d-bd6c-911332be9923': '[美化]变量更新中',
      'mvu-status-hide': '[不发送]隐藏状态栏标记'
    };

    function isFixedMvuRegex(r) {
      if (!r) return false;
      if (r.id && MVU_FIXED_REGEX_IDS[r.id]) return true;
      const rxFind = String(r.findRegex || '');
      const scriptName = String(r.scriptName || r.name || '');
      // 固定正则特征匹配（兜底，防止AI改id）
      if (rxFind.indexOf('Analysis') >= 0 && r.promptOnly) return true; // 正则1
      if (rxFind.indexOf('UpdateVariable') >= 0 && r.promptOnly) return true; // 正则2
      if (rxFind.indexOf('UpdateVariable') >= 0 && r.markdownOnly && !r.promptOnly) return true; // 正则3/4
      if (rxFind.indexOf('StatusPlaceHolderImpl') >= 0 && r.promptOnly && !r.markdownOnly) return true; // 正则5
      return false;
    }

    function isAllowedMvuRegex(r) {
      if (!r) return false;
      if (r.id === 'mvu-status-bar') return true;
      const rxFind = String(r.findRegex || '');
      if (rxFind.indexOf('StatusPlaceHolderImpl') >= 0 && r.markdownOnly && !r.promptOnly) return true; // 正则6 美化状态栏
      return false;
    }
    const mergeRegexScripts = function(newRxList) {
      if (!Array.isArray(newRxList)) return;
      cd.extensions = cd.extensions || {};
      let existingRx = cd.extensions.regex_scripts || [];
      const beforeSnapshot = JSON.stringify(existingRx);
      newRxList.forEach(function(s) {
        if (!s || typeof s !== 'object') return;
        // === MVU固定正则拦截：删除请求也拦截（固定正则由写卡器注入，AI无权删除）===
        if (isFixedMvuRegex(s)) {
          const blockName = (s.id && MVU_FIXED_REGEX_IDS[s.id]) || s.scriptName || s.name || '(MVU固定正则)';
          console.warn('[Tab隔离·MVU] 拦截写入：MVU固定正则「' + blockName + '」由写卡器导出时自动注入，无需AI写入cardData，避免重复。');
          changeLog._mvuFixedRegexBlocked = (changeLog._mvuFixedRegexBlocked || 0) + 1;
          return;
        }
        // === 白名单放行：允许写入的MVU正则只有 [美化]MVU状态栏（正则6）===
        // 其他不属于 MVU 固定正则 / 不属于 MVU 状态栏 的自定义正则也允许（如角色剧情替换等）
        const isMvuRelatedRegex = isFixedMvuRegex(s) || isAllowedMvuRegex(s);
        if (isMvuRelatedRegex && !isAllowedMvuRegex(s)) {
          console.warn('[Tab隔离·MVU] 拦截写入：非白名单MVU正则被丢弃:', s.scriptName || s.id || s.findRegex);
          return;
        }
        // 删除：_action:delete 或 delete:true
        if (s._action === 'delete' || s._action === 'remove' || s.delete === true) {
          // 先检查目标是否是固定正则，是的话也拦截删除
          if (isFixedMvuRegex({
              id: s.id,
              scriptName: s.scriptName,
              name: s.name,
              findRegex: s.findRegex,
              promptOnly: true,
              markdownOnly: true
            })) {
            console.warn('[Tab隔离·MVU] 拦截删除：MVU固定正则由写卡器注入，AI无权删除。');
            return;
          }
          const beforeLen = existingRx.length;
          existingRx = existingRx.filter(function(es) {
            // 固定正则即使 id/name 匹配也不允许被删
            if (isFixedMvuRegex(es)) return true;
            if (s.id && es.id === s.id) return false;
            if (s.scriptName && es.scriptName === s.scriptName) return false;
            if (s.name && !es.scriptName && es.name === s.name) return false;
            // 关键词匹配删除
            if (s.findRegex && es.findRegex === s.findRegex) return false;
            return true;
          });
          if (existingRx.length !== beforeLen) {
            changeLog.deleted += (beforeLen - existingRx.length);
          }
          return;
        }
        if (!s.findRegex || !String(s.findRegex).trim()) return;
        if (s.replaceString === undefined) return;
        // 更新/新增：按 id 或 scriptName/name 或 findRegex 匹配
        const idx = existingRx.findIndex(function(es) {
          if (s.id && es.id === s.id) return true;
          if (s.scriptName && es.scriptName === s.scriptName) return true;
          if (s.name && !es.scriptName && es.name === s.name) return true;
          if (s.findRegex && es.findRegex === s.findRegex) return true;
          return false;
        });
        if (idx >= 0) {
          existingRx[idx] = Object.assign({}, existingRx[idx], s);
          delete existingRx[idx]._action;
          changeLog.updated++;
        } else {
          existingRx.push(s);
          changeLog.added++;
        }
      });
      cd.extensions.regex_scripts = existingRx;
      if (JSON.stringify(existingRx) !== beforeSnapshot) modified = true;
    };

    let _topRegexScriptsProcessed = false; // 🐛修复：标记顶层 regex_scripts 是否已处理，防止 extensions 内的副本二次合并
    if (partial.regex_scripts !== undefined) {
      mergeRegexScripts(partial.regex_scripts);
      delete partial.regex_scripts;
      _topRegexScriptsProcessed = true;
    }

    // 名称变化时自动更新世界书名称
    if (partial.name && cd.character_book) {
      // 参考文件中 character_book 不包含 name 字段，此处无需更新
    }

    if (partial.extensions) {
      cd.extensions = cd.extensions || {};
      for (const ek in partial.extensions) {
        if (partial.extensions.hasOwnProperty(ek)) {
          if (ek === 'depth_prompt') {
            // 顶层已处理过 depth_prompt（delete partial.depth_prompt 已执行），这里仅当 partial.extensions 有独立配置时处理
            // 防御：旧卡 extensions.depth_prompt 可能是字符串（非空字符串 truthy，|| 不会替换）
            // 或 JSON.stringify 后的字符串对象，需要反序列化为对象
            cd.extensions.depth_prompt = normalizeDepthPrompt(cd.extensions.depth_prompt, 0);
            const dp2 = partial.extensions.depth_prompt;
            const beforeDp = JSON.stringify(cd.extensions.depth_prompt);
            if (typeof dp2 === 'string') {
              if (dp2.trim().length > 0) cd.extensions.depth_prompt.prompt = dp2;
            } else if (dp2 && typeof dp2 === 'object') {
              if (dp2.prompt !== undefined) cd.extensions.depth_prompt.prompt = dp2.prompt;
              if (dp2.depth !== undefined && typeof dp2.depth === 'number' && dp2.depth >= 0) cd.extensions.depth_prompt.depth = dp2.depth;
              if (dp2.role !== undefined) cd.extensions.depth_prompt.role = dp2.role;
            }
            if (JSON.stringify(cd.extensions.depth_prompt) !== beforeDp) {
              modified = true;
              changeLog.fieldUpdates++;
            }
          } else if (ek === 'regex_scripts') {
            // 🐛修复：用标记判断顶层是否已处理，不能用 === undefined（因 delete 后恒为 undefined）
            if (!_topRegexScriptsProcessed) mergeRegexScripts(partial.extensions.regex_scripts);
          } else if (ek === 'tavern_helper') {
            // 修复版：支持脚本删除 / 按 id/name 替换，不再只追加
            // ⚠️ MVU固定脚本白名单拦截：bundle.js（MVU本体）由写卡器自动注入，
            //   禁止AI写入cardData（避免导出时重复注入2份）
            //   允许AI修改：变量结构 (id=mvu-schema 或 name='变量结构' 或 含 mvu_zod)、WTC（世界书调用，AI按需生成）
            function isAllowedMvuScript(scr) {
              if (!scr) return false;
              if (scr.id === 'mvu-schema') return true;
              if (String(scr.name || '').indexOf('变量结构') >= 0) return true;
              if (String(scr.content || '').indexOf('mvu_zod') >= 0) return true;
              // WTC（世界书调用）由 AI 按需生成，允许修改
              if (scr.id === 'wtc-lorebook-call') return true;
              if (String(scr.content || '').indexOf('LorebookToolCall') >= 0) return true;
              return false;
            }
            if (partial.extensions[ek] && typeof partial.extensions[ek] === 'object') {
              cd.extensions = cd.extensions || {};
              if (!cd.extensions[ek]) cd.extensions[ek] = {
                scripts: [],
                variables: {}
              };
              const thBefore = JSON.stringify(cd.extensions[ek]);
              // === scripts：支持替换/删除/追加 ===
              let thScripts = cd.extensions[ek].scripts || [];
              const newTHScripts = partial.extensions[ek].scripts || [];
              // 如果 AI 明确输出 _action:reset 或 scripts 显式置空数组，允许清空（用于「重写 tavern_helper」场景）
              const resetScripts = partial.extensions[ek]._action === 'reset' || partial.extensions[ek].reset_scripts === true;
              if (resetScripts) {
                thScripts = [];
              }
              newTHScripts.forEach(function(ns) {
                if (!ns || typeof ns !== 'object') return;
                // === MVU固定脚本拦截：写入请求也拦截（固定脚本由写卡器注入，AI无权写入/删除）===
                if (isFixedMvuScript(ns)) {
                  const blockName = (ns.id && MVU_FIXED_SCRIPT_IDS[ns.id]) || ns.name || '(MVU固定脚本)';
                  console.warn('[Tab隔离·MVU] 拦截写入：MVU固定脚本「' + blockName + '」由写卡器导出时自动注入，无需AI写入cardData，避免重复。');
                  changeLog._mvuFixedScriptBlocked = (changeLog._mvuFixedScriptBlocked || 0) + 1;
                  return;
                }
                // === 白名单放行：只允许 [变量结构] 被AI写入 ===
                // 其他不属于 MVU 固定脚本 / 不属于 MVU 变量结构 的自定义脚本也允许
                const isMvuRelatedScript = isFixedMvuScript(ns) || isAllowedMvuScript(ns);
                if (isMvuRelatedScript && !isAllowedMvuScript(ns)) {
                  console.warn('[Tab隔离·MVU] 拦截写入：非白名单MVU脚本被丢弃:', ns.name || ns.id);
                  return;
                }
                if (ns._action === 'delete' || ns._action === 'remove' || ns.delete === true) {
                  // 先检查目标是否是固定脚本，是的话拦截删除
                  if (isFixedMvuScript({
                      id: ns.id,
                      name: ns.name,
                      content: ns.content
                    })) {
                    console.warn('[Tab隔离·MVU] 拦截删除：MVU固定脚本由写卡器注入，AI无权删除。');
                    return;
                  }
                  thScripts = thScripts.filter(function(es) {
                    // 固定脚本即使 id/name 匹配也不允许被删
                    if (isFixedMvuScript(es)) return true;
                    if (ns.id && es.id === ns.id) return false;
                    if (ns.name && es.name === ns.name) return false;
                    return true;
                  });
                  return;
                }
                const existsIdx = thScripts.findIndex(function(es) {
                  return (ns.id && es.id === ns.id) || (ns.name && es.name === ns.name);
                });
                if (existsIdx >= 0) {
                  thScripts[existsIdx] = Object.assign({}, thScripts[existsIdx], ns);
                  delete thScripts[existsIdx]._action;
                } else {
                  thScripts.push(ns);
                }
              });
              cd.extensions[ek].scripts = thScripts;
              // === variables：支持删除/替换 ===
              if (partial.extensions[ek].variables) {
                const vars = partial.extensions[ek].variables;
                if (vars && typeof vars === 'object') {
                  const curVars = cd.extensions[ek].variables || {};
                  // 支持 { key: null } 或 { key: {_action:"delete"} } 表示删除
                  Object.keys(vars).forEach(function(vk) {
                    if (vars[vk] === null || vars[vk] === undefined || (vars[vk] && typeof vars[vk] === 'object' && (vars[vk]._action === 'delete' || vars[vk].delete === true))) {
                      if (vk in curVars) delete curVars[vk];
                    } else {
                      curVars[vk] = vars[vk];
                    }
                  });
                  cd.extensions[ek].variables = curVars;
                }
              }
              if (JSON.stringify(cd.extensions[ek]) !== thBefore) {
                modified = true;
                changeLog.fieldUpdates++;
              }
            }
          } else {
            if (JSON.stringify(cd.extensions[ek]) !== JSON.stringify(partial.extensions[ek])) {
              cd.extensions[ek] = partial.extensions[ek];
              modified = true;
              changeLog.fieldUpdates++;
            }
          }
        }
      }
    }
    // 注意：character_book.entries 已在前面的 processEntriesFn 中处理（避免双路径重复合并）
    // 此处仅处理 character_book 下除 entries 以外的其他字段
    if (partial.character_book && typeof partial.character_book === 'object') {
      cd.character_book = cd.character_book || {
        entries: []
      };
      for (let cbk in partial.character_book) {
        if (partial.character_book.hasOwnProperty(cbk) && cbk !== 'entries') {
          if (JSON.stringify(cd.character_book[cbk]) !== JSON.stringify(partial.character_book[cbk])) {
            cd.character_book[cbk] = partial.character_book[cbk];
            modified = true;
          }
        }
      }
    }
    // 将变更日志挂到返回值（供调用方调试/Toast提示）
    if (modified && options && options.returnLog) {
      return {
        modified: true,
        log: changeLog
      };
    }
    return modified;
  }

  // ============================================================================
  // SECTION 6  AI 调用适配层 + 响应清洗（callAI · cleanAIReply · JSON修复）
  // ============================================================================
  // ===== AI调用 =====
  // ⚠️改进：
  //   1) 每个后端尝试均带超时（300s）——原先任一后端永久 pending 时整个调用链无限挂起，
  //      isGenerating 永远为 true，Tab 切换/发送/撤回全部被锁死，用户只能刷新页面
  //   2) 成功阈值 length>0（原先 >5 会把合法回复"本次无修改"当作失败继续降级重试）
  //   3) triggerSlash 兜底路径：prompt 用双引号包裹并转义——原先多行 prompt 裸拼进
  //      STScript 会在首个换行处截断，后续行被当作新命令解析执行（命令注入面）
  const CALLAI_TIMEOUT_MS = 300000; // 单后端 5 分钟
  function withTimeout(promise, ms, label) {
    label = label || 'AI调用';
    return new Promise(function(resolve, reject) {
      const timer = setTimeout(function() {
        reject(new Error(label + ' 超时(' + (ms / 1000) + 's)'));
      }, ms);
      Promise.resolve(promise).then(
        function(v) {
          clearTimeout(timer);
          resolve(v);
        },
        function(e) {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  function isValidAIReply(r) {
    return !!(r && typeof r === 'string' && r.trim().length > 0);
  }
  async function callAI(prompt) {
    const errors = [];
    // ===== 【写卡预设】AI生成参数（与写卡.json数值一致） =====
    const p = TAVERN_GENERATION_PARAMS || {};
    const genParams = {
      temperature: typeof p.temperature === 'number' ? p.temperature : 1,
      top_p: typeof p.top_p === 'number' ? p.top_p : 0.9,
      top_k: typeof p.top_k === 'number' ? p.top_k : 500,
      top_a: typeof p.top_a === 'number' ? p.top_a : 0,
      min_p: typeof p.min_p === 'number' ? p.min_p : 0,
      repetition_penalty: typeof p.repetition_penalty === 'number' ? p.repetition_penalty : 1,
      frequency_penalty: typeof p.frequency_penalty === 'number' ? p.frequency_penalty : 0,
      presence_penalty: typeof p.presence_penalty === 'number' ? p.presence_penalty : 0,
      max_tokens: typeof p.max_tokens === 'number' ? p.max_tokens : 64000
    };
    // system prompt：创作原则与输出格式（不绑定特定人格身份）
    const sysPrompt =
      '<writing_principles>\n' +
      '禁用词：模糊词（似乎/仿佛/宛如）、劣质比喻（像小兽/投石入湖）、微表情（嘴角上扬/眼里闪过光芒）、语气描写（带着xx的口吻）、极端情绪词（极度羞耻/无比愤怒）、否定转折句（不是...而是...）、心理描写（心想/暗自思忖）。\n' +
      '创作准则：客观叙述（只写镜头能拍到的内容，禁止写内心想法）；白描事实（只写谁做了什么说了什么，禁止修饰渲染）；名词动词造句（禁止形容词做谓语，禁止副词修饰形容词）；具体名词代替代词（禁止用他/她/它作主语）；行为展现性格（写具体动作和对话，禁止写"她是温柔的人"）；纯对话体现特点（只写原话，禁止附加"她温柔地说"）。\n' +
      '</writing_principles>\n\n' +
      '<output_format>\n' +
      '当输出实际创作内容（角色卡/故事/世界观/场景等）时，条目的content字段必须使用YAML中文格式，用缩进+冒号+短横线表达层级关系，键名和内容均为中文，保持结构清晰。解释说明或回答问题时直接用自然语言。\n' +
      '</output_format>\n\n' +
      '你同时是时之写卡器助手，基于SillyTavern原生世界书（World Info）机制，帮助用户自由生成符合ST官方Schema的世界书条目。';
    try {
      if (typeof generate === 'function') {
        const result = await withTimeout(generate(Object.assign({
          user_input: prompt,
          should_silence: true,
          max_chat_history: 0
        }, genParams)), CALLAI_TIMEOUT_MS, 'generate');
        if (isValidAIReply(result)) return result.trim();
        if (result && typeof result === 'object' && result.content && String(result.content).trim().length > 0) return String(result.content).trim();
        if (result && typeof result === 'string') errors.push('generate returned: ' + result.substring(0, 80));
      }
    } catch (e) {
      errors.push('generate: ' + e.message);
    }
    try {
      if (typeof generateQuietPrompt === 'function') {
        const r6 = await withTimeout(generateQuietPrompt(prompt, false, false, false), CALLAI_TIMEOUT_MS, 'generateQuietPrompt');
        if (isValidAIReply(r6)) return r6.trim();
      }
    } catch (e) {
      errors.push('generateQuietPrompt: ' + e.message);
    }
    try {
      if (window.parent && typeof window.parent.generateQuietPrompt === 'function') {
        const r5 = await withTimeout(window.parent.generateQuietPrompt(prompt, false, false, false), CALLAI_TIMEOUT_MS, 'parent.generateQuietPrompt');
        if (isValidAIReply(r5)) return r5.trim();
      }
    } catch (e) {
      errors.push('parent.generateQuietPrompt: ' + e.message);
    }
    try {
      if (window.TavernHelper && typeof window.TavernHelper.generate === 'function') {
        const r2 = await withTimeout(window.TavernHelper.generate(Object.assign({
          user_input: prompt,
          should_silence: true,
          max_chat_history: 0
        }, genParams)), CALLAI_TIMEOUT_MS, 'TavernHelper.generate');
        if (isValidAIReply(r2)) return r2.trim();
      }
    } catch (e) {
      errors.push('TavernHelper.generate: ' + e.message);
    }
    try {
      if (typeof generateRaw === 'function') {
        const r3 = await withTimeout(generateRaw(Object.assign({
          should_silence: true,
          ordered_prompts: [{
              role: 'system',
              content: sysPrompt
            },
            {
              role: 'user',
              content: prompt
            }
          ]
        }, genParams)), CALLAI_TIMEOUT_MS, 'generateRaw');
        if (isValidAIReply(r3)) return r3.trim();
      }
    } catch (e) {
      errors.push('generateRaw: ' + e.message);
    }
    try {
      if (typeof triggerSlash === 'function') {
        // ⚠️ 取消截断：之前 .substring(0, 8000) 会导致提示词丢失后半部分内容，
        // 现在传递完整 prompt；多行内容用双引号包裹+转义，避免在换行处被 STScript 截断
        // （已知局限：prompt 中的 {{宏}} 仍会被 triggerSlash 替换，此为第5级兜底路径的固有行为）
        const _tsEscaped = String(prompt).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const r4 = await withTimeout(triggerSlash('/generate "' + _tsEscaped + '"'), CALLAI_TIMEOUT_MS, 'triggerSlash');
        if (isValidAIReply(r4)) return r4.trim();
      }
    } catch (e) {
      errors.push('triggerSlash: ' + e.message);
    }
    throw new Error('AI调用失败: ' + errors.join('; '));
  }

  // ====================================================================
  // 公共函数：检查MVU 8条目工作流的前7条完成情况（第8条=状态栏本身，单独判断）
  // 返回：{ done: [bool×7], doneCount: int, all7Done: bool, missing: [string], missingCount: int }
  // 说明：消除 updateQuickActions / start_sb / isSBRequest 三处重复检查代码
  // ====================================================================
  function checkMvu8Entries(_cardData) {
    // ⚠️ 本函数在 IIFE 顶层定义，cardData 在 openEditor() 内部定义，作用域不通
    //    必须通过参数传入 cardData，否则报 "cardData is not defined"
    let cd = _cardData;
    if (!cd) {
      if (typeof window !== 'undefined' && window.__cardData) cd = window.__cardData;
      else {
        try {
          if (typeof cardData !== 'undefined') cd = cardData;
        } catch (_e) {}
      }
    }
    if (!cd) return {
      done: [false, false, false, false, false, false, false],
      doneCount: 0,
      all7Done: false,
      missing: ['第1条 变量结构脚本(zod)', '第2条 [InitVar]初始变量', '第3条 [mvu_update]更新规则', '第4条 变量列表', '第5条 [mvu_update]输出格式', '第6条 [mvu_update]输出格式强调', '第7条 <状态栏>占位提醒'],
      missingCount: 7,
      has8: false
    };
    const entries = (cd.character_book || {}).entries || [];
    const thScripts = (cd.extensions && cd.extensions.tavern_helper && cd.extensions.tavern_helper.scripts) || [];
    const rxScripts = (cd.extensions && cd.extensions.regex_scripts) || [];
    // 前7条检测（按8条工作流顺序：第3条=更新规则，第4条=变量列表）
    // ⚠️脚本存为对象（含content/name/id字段），非string；兼容两种形态
    const has1 = thScripts.some(function(s) {
      if (!s) return false;
      const c = typeof s === 'string' ? s : (s.content || '');
      return c.indexOf('registerMvuSchema') >= 0 || c.indexOf('z.object') >= 0;
    });
    const has2 = entries.some(function(e) {
      return (e.comment || '').toLowerCase().indexOf('[initvar]') >= 0;
    });
    const has3 = entries.some(function(e) {
      return (e.comment || '').toLowerCase().indexOf('[mvu_update]') >= 0 && (e.comment || '').indexOf('变量更新规则') >= 0;
    });
    const has4 = entries.some(function(e) {
      return (e.comment || '').indexOf('变量列表') >= 0;
    });
    const has5 = entries.some(function(e) {
      const c = (e.comment || '');
      return c.indexOf('变量输出格式') >= 0 && c.indexOf('强调') < 0;
    });
    const has6 = entries.some(function(e) {
      return (e.comment || '').indexOf('变量输出格式强调') >= 0;
    });
    const has7 = entries.some(function(e) {
      const c = (e.comment || '');
      return c.indexOf('状态栏') >= 0 && (c.indexOf('占位符') >= 0 || c.indexOf('提醒') >= 0);
    });
    // 第8条检测（状态栏HTML正则）
    const has8 = rxScripts.some(function(r) {
      return (r.findRegex || '').indexOf('StatusPlaceHolder') >= 0 && r.markdownOnly === true && r.promptOnly !== true;
    });
    const done = [has1, has2, has3, has4, has5, has6, has7];
    const doneCount = done.filter(Boolean).length;
    const all7Done = doneCount === 7;
    const names7 = ['第1条 变量结构脚本(zod)', '第2条 [InitVar]初始变量', '第3条 [mvu_update]更新规则', '第4条 变量列表', '第5条 [mvu_update]输出格式', '第6条 [mvu_update]输出格式强调', '第7条 <状态栏>占位提醒'];
    const missing = [];
    for (let i = 0; i < 7; i++) {
      if (!done[i]) missing.push(names7[i]);
    }
    return {
      done: done,
      doneCount: doneCount,
      all7Done: all7Done,
      missing: missing,
      missingCount: missing.length,
      has8: has8
    };
  }

  // 公共函数：生成"缺失条目提示文本"（供 isSBRequest / start_sb 共用）
  function buildMissingMvuHint(missing) {
    missing = safeArr(missing);
    const hint = missing.map(function(item, i) {
      return '  ' + (i + 1) + '. ' + item;
    }).join('\n');
    return '⚠️ 前7条未齐全（第8条=状态栏HTML，必须前7条完成后才生成）。\n' +
      '当前缺失 ' + missing.length + ' 条：\n' + hint + '\n\n' +
      '请在 MVU Tab 按以下8条固定顺序**一条一条**生成，每生成一条说"继续"再写下一条：\n' +
      '  第1条：变量结构脚本（zod 4 schema）\n' +
      '  第2条：[InitVar]初始变量\n' +
      '  第3条：[mvu_update]变量更新规则\n' +
      '  第4条：变量列表\n' +
      '  第5条：[mvu_update]变量输出格式\n' +
      '  第6条：[mvu_update]变量输出格式强调\n' +
      '  第7条：<状态栏>占位符提醒条目\n' +
      '  第8条：正则6 [美化]MVU状态栏（即状态栏 HTML）—— 前7条完成后才生成\n\n' +
      '⚠️ 铁律：每生成一条立即停下，等用户说"继续"再写下一条。禁止一次性输出多条！';
  }

  // ====================================================================
  // 公共常量：MVU 8条工作流规范文本（供 mvuPrompts.init_var / var_update_rule / buildMissingMvuHint 引用，避免多处重复维护）
  // ====================================================================
  // 逐条生成铁则（最高优先级）
  const MVU_SEQUENTIAL_RULE =
    '【逐条生成铁则（最高优先级）】\n' +
    '⚠️ 一次只输出1条内容（脚本/条目/正则），输出后立即停下，不要写后面的。结尾只问用户："已生成第N条，说\'继续\'生成下一条"——不要一次性输出多条！\n' +
    '用户说"继续"后，再按顺序生成下一条。前7条全部完成后，才生成第8条（状态栏HTML）。\n\n';
  // 8条固定顺序（含每条详细规范）—— 第3/4条顺序已调整为：更新规则在前，变量列表在后
  const MVU_8STEPS_DETAIL =
    '【8条固定顺序（严格按此顺序，不能跳步）】\n' +
    '  第1条：变量结构脚本（tavern_helper.scripts，zod 4 Schema + registerMvuSchema注册）\n' +
    '       · 文件头固定：import { registerMvuSchema } from \'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js\';\n' +
    '       · 文件尾固定：$(() => { registerMvuSchema(Schema); })\n' +
    '       · 严格遵循zod 4规范（详见MVU变量结构脚本创作指导）\n' +
    '  第2条：[InitVar]初始变量（世界书条目，enabled=false）—— YAML格式，严格依据第1条schema生成；schema有z.prefault()的字段可省略；enabled必须=false\n' +
    '  第3条：[mvu_update]变量更新规则（世界书条目，constant=true）—— 依据第1条schema生成每个变量路径的type/range/format/check\n' +
    '  第4条：变量列表（世界书条目，constant=true depth=0）—— 固定内容（模板4原样）：---\\n<status_current_variables>\\nnull\\n</status_current_variables>\n' +
    '  第5条：[mvu_update]变量输出格式（世界书条目，constant=true depth=0）—— 固定YAML格式，<UpdateVariable>+<Analysis>+<JSONPatch>（5种操作：replace/delta/insert/remove/move）\n' +
    '  第6条：[mvu_update]变量输出格式强调（世界书条目，constant=true，默认enabled=false）—— 固定YAML原样输出，AI不输出<UpdateVariable>时启用\n' +
    '  第7条：<状态栏>占位符提醒（世界书条目，constant=true）—— 提醒AI每条回复底部必须输出 <StatusPlaceHolderImpl/>\n' +
    '  第8条：正则6 [美化]MVU状态栏（regex_scripts，markdownOnly=true promptOnly=false）—— 前7条完成后才生成！走状态栏Step 2-6共5模块生成流程\n\n';
  // 通用生成规范（适用于所有8条）—— 第3/4条顺序已调整
  const MVU_8STEPS_COMMON_RULES =
    '【通用生成规范（适用于所有8条）】\n' +
    '1. 第2/3条必须严格依据第1条schema生成，schema一改这两条必跟改\n' +
    '2. 第4/5/6条是固定内容模板，原封不动输出（第5条的示例路径可参考schema字段名）\n' +
    '3. 禁止AI自行追加8条以外的额外条目（阶段判定/人设切换/EJS/派生字段等），除非用户明确要求\n' +
    '4. 每生成一条立即写入cardData并触发预览更新，用户可实时看到\n\n';
  // 修改场景防漏铁律 —— 第3/4条顺序已调整
  const MVU_MODIFY_RULE =
    '【修改场景防漏铁律】：修改变量结构时（哪怕只加一个字段），必须按顺序把第1/2/3/8条全部跟改一遍（第4/5/6/7条原样保留）。';
  // 8条简短列表（供 mvuPrompts.next/summary 等引用）—— 第3/4条顺序已调整
  const MVU_8STEPS_SHORT =
    '①zod脚本 ②InitVar ③更新规则 ④变量列表 ⑤输出格式 ⑥格式强调 ⑦占位提醒 ⑧状态栏HTML';
  // MVU变量系统创作指导（第1-6条详细规范）—— 供 mvuPrompts 按用户"写变量xxx"指令逐条输出对应规范
  const MVU_VAR_SPEC =
    '═══════════════════════════════════════════════════════════════════\n' +
    '📋 MVU变量系统创作指导（第1-6条详细规范）\n' +
    '═══════════════════════════════════════════════════════════════════\n\n' +
    '===== 第1条：变量结构脚本（zod 4 Schema）=====\n\n' +
    '【任务】帮助用户创作一个完全符合zod 4库的MVU变量结构脚本\n\n' +
    '【工作流程】\n' +
    '第一步：了解需求\n' +
    '  询问用户：\n' +
    '  1. 这是什么类型的角色卡/世界观？（如：角色扮演、模拟经营、军事模拟等）\n' +
    '  2. 需要追踪哪些主要内容？\n' +
    '     - 有哪些角色？（主角、配角、NPC等）\n' +
    '     - 需要什么系统变量？（时间、日期、金钱等）\n' +
    '     - 每个角色需要追踪什么？（好感度、位置、状态等）\n' +
    '  3. 哪些部分需要限定值情况？\n' +
    '     - 数值和文本是否有特定取值范围或格式？\n' +
    '     - 可以添加新角色吗？\n' +
    '     - 哪些对象可以增删键？（如物品栏、成就、技能等）\n' +
    '     - 是否要限制对象的键数量？\n\n' +
    '第二步：确认结构\n' +
    '  根据用户需求，先用自然语言列出结构大纲，让用户确认是否符合需求\n\n' +
    '第三步：编写初始变量\n' +
    '  按照zod 4编写javascript文件\n\n' +
    '【额外zod要求】\n' +
    '\n' +
    '  rule:\n' +
    '    - libraries: "`z` from zod 4.x (stick to it instead of 3.x!) and `_` from lodash are available by default, so you can use them directly and should prefer to use them; don\'t import them in the generated code"\n' +
    '    - idempotent operation: the schema is intended to parse the updates of the world status incrementally, thus, the output of `Schema.parse(input)` must be a valid input of `Schema.parse` itself; that is, you should use z.transform carefully, keeping `Schema.parse(Schema.parse(input))` equal to `Schema.parse(input)`\n' +
    '    - for number schema: prefer `z.coerce.number()` over `z.number()` whenever you expect a number since it will try to convert the input to a number if it\'s not a number; but don\'t use other `z.coerce.xxx()` such as `z.coerce.boolean()`, just use `z.boolean()` directly\n' +
    '    - prefer object schema over array schema: "the array index is hard to understand and maintain, so you should use `物品栏: z.record(z.string().describe(\'物品名\'), z.object({ 描述: z.string(), ... }))` instead of `物品栏: z.array(z.object({ 名称: z.string(), 描述: z.string(), ... }))`"\n' +
    '    - for object schema:\n' +
    '        - fixed required keys + the same type: use `z.record(z.enum([\'key1\', \'key2\', ...]), ${value type})`\n' +
    '          fixed optional keys + the same type: use `z.partialRecord(z.enum([\'key1\', \'key2\', ...]), ${value type})`\n' +
    '          dynamic optional keys + the same type: use `z.record(z.string(), ${value type})`\n' +
    '          fixed required keys + different types: \'use `z.object({ key1: ${type1}, key2: ${type2}, ... })`\'\n' +
    '          dynamic keys but some keys are required + the same type: \'use `z.intersection(z.object({ requiredKey1: ${type1}, requiredKey2: ${type2}, ... }), z.record(z.string(), ${value type}))`\'\n' +
    '        - on clearable object: \'if the object is clearable by JSON patch `{ "op": "remove", "path": "/path/to/object" }`, set `z.object({ ${field}: ${type}.prefault(...), ... }).prefault({})` instead of `z.object({ ... }).optional()` for better compatibility with the incremental update\'\n' +
    '    - for special format (rare to happen): prefer `z.templateLiteral` over regex or manual parsing\n' +
    '    - for restrictions: when accepting a update that breaks the schema, users are tend to expect the update takes some effect instead of being discarded completely; therefore, you should try your best to use `z.transform` to convert the broken input to a valid input. For example, if Explorer requests a value to be between 0 and 100, prefer `z.number().transform(value => _.clamp(value, 0, 100))` over `z.number().min(0).max(100)`; if an object could only contain 10 keys, when a new key comes, discard the oldest key instead. **but only impose these restrictions when Explorer requests**\n' +
    '    - on default value:\n' +
    '        - prefer `z.prefault` over `z.default`\n' +
    '        - if a `z.object` or the whole Schema is complicated enough, set `.prefault(\'${suitable default value}\')` or `.or(z.literal(\'待初始化\')).prefault(\'待初始化\')` for every field of it\n' +
    '        - if a compund type is prefault-ed, all its fields should be prefault-ed as well\n' +
    '        - don\'t set `z.prefault` for other situatioins unless Explorer requests it\n' +
    '    - when to describe: use `z.describe` only when there\'s no field name to explain the usage of the schema such as the key type of `z.record`; in contrast, you should never use `z.describe` if the field name has already explained the usage well\n' +
    '    - determine the order of keys: \'if Explorer requests you to do something with the insertion time of keys, prefer to use `_(data).entries()` which almost always lists keys in insertion order, e.g. you can remove old keys with a simple `_(data).entries().takeRight(10)`; when keys are already additionally sorted inside `z.transform`, you should use `$time: z.coerce.number().prefault(() => Date.now())` to automatically assign a timestamp\'\n' +
    '    - don\'t repeat yourself: merge the same variable schemas whenever possible, but don\'t define extra variables to do so - you can only define schema inside `export const Schema = z.object({ ... })`\n' +
    '    - some function definition corrections:\n' +
    '        z.transform:\n' +
    '          type: \'(fn: (value: Output) => NewOutput) => z.ZodType\'\n' +
    '          limit: \'`fn` can only take the parsed output as input, never ever use `context`. i.e. `z.string().transform(value => value)` is valid, while `z.string().transform((value, context) => value)` is not\'\n' +
    '          example: \'z.object({ 好感度: z.coerce.number() }).transform(data => ({ 好感度: _.clamp(data.好感度, 0, 100) }))\'\n' +
    '        z.prefault:\n' +
    '          type: \'(value: Input | (() => Input)) => z.ZodType\'\n' +
    '          limit: \'`value` must be a valid input of the schema itself. i.e. `z.object({ 好感度: z.coerce.number().prefault(0) }).prefault({})` is valid, while `z.object({ 好感度: z.coerce.number() }).prefault({})` is not (the input must contain the `好感度` field in this case)\'\n' +
    '        z.extend:\n' +
    '          limit: only `z.object`、`z.looseObject`、`z.strictObject` can be extended, even if `z.object(...).prefault({})` could not be extended! i.e. `z.object({...}).extend({...})` is valid, while `z.object({...}).prefault({}).extend({...})` is not\n' +
    '        z.passthrough、z.strict: they are not exist, never ever use them!\n' +
    '        z.transform:\n' +
    '          type: \'(fn: (value: Output) => NewOutput) => z.ZodType\'\n' +
    '          limit: \'`fn` can only take the parsed output as input, never ever use `context`. i.e. `z.string().transform(value => value)` is valid, while `z.string().transform((value, context) => value)` is not\'\n' +
    '          example: \'z.object({ 好感度: z.coerce.number() }).transform(data => ({ 好感度: _.clamp(data.好感度, 0, 100) }))\'\n' +
    '        z.prefault:\n' +
    '          type: \'(value: Input | (() => Input)) => z.ZodType\'\n' +
    '          limit: \'`value` must be a valid input of the schema itself. i.e. `z.object({ 好感度: z.coerce.number().prefault(0) }).prefault({})` is valid, while `z.object({ 好感度: z.coerce.number() }).prefault({})` is not (the input must contain the `好感度` field in this case)\'\n\n' +
    '【变量结构脚本模板】\n' +
    '  import { registerMvuSchema } from \'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js\';\n' +
    '\n' +
    '  export const Schema = z.object({\n' +
    '    ...\n' +
    '  });\n' +
    '\n' +
    '  $(() => {\n' +
    '    registerMvuSchema(Schema);\n' +
    '  })\n' +
    '  必须原封不动地照抄头尾。\n\n' +
    '【输出要求】\n' +
    '  - 结构清晰：合理使用嵌套，不要过度扁平或过度嵌套\n' +
    '  - 遵循额外要求：严格遵循额外给出的zod要求\n\n' +
    '【完整示例】\n' +
    '  import { registerMvuSchema } from \'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js\';\n' +
    '\n' +
    '  export const Schema = z.object({\n' +
    '    世界: z.object({\n' +
    '      当前时间: z.string(),\n' +
    '      当前地点: z.string(),\n' +
    '      近期事务: z.record(z.string().describe(\'事务名\'), z.string().describe(\'事务描述\')),\n' +
    '    }),\n' +
    '\n' +
    '    白娅: z\n' +
    '      .object({\n' +
    '        依存度: z.coerce.number().prefault(0).transform(v => _.clamp(v, 0, 100)),\n' +
    '        着装: z.record(z.enum([\'上装\', \'下装\', \'内衣\', \'袜子\', \'鞋子\', \'饰品\']), z.string().describe(\'服装描述\')),\n' +
    '        称号: z.record(\n' +
    '          z.string().describe(\'称号名\'),\n' +
    '          z.object({\n' +
    '            效果: z.string(),\n' +
    '            自我评价: z.string(),\n' +
    '          }),\n' +
    '        ),\n' +
    '      })\n' +
    '      .transform(data => {\n' +
    '        data.称号 = _(data.称号)\n' +
    '          .entries()\n' +
    '          .takeRight(Math.ceil(data.依存度 / 10))\n' +
    '          .fromPairs()\n' +
    '          .value();\n' +
    '        return data;\n' +
    '      }),\n' +
    '\n' +
    '    主角: z.object({\n' +
    '      物品栏: z\n' +
    '        .record(\n' +
    '          z.string().describe(\'物品名\'),\n' +
    '          z.object({\n' +
    '            描述: z.string(),\n' +
    '            数量: z.coerce.number(),\n' +
    '          }),\n' +
    '        )\n' +
    '        .transform(data => _.pickBy(data, ({ 数量 }) => 数量 > 0)),\n' +
    '    }),\n' +
    '  });\n' +
    '\n' +
    '  $(() => {\n' +
    '    registerMvuSchema(Schema);\n' +
    '  })\n\n' +
    '【注意事项】\n' +
    '  - 中文兼容：变量名可以用中文\n\n' +
    '  下一步：创建初始变量。对我说"写初始变量"。\n\n' +
    '===== 第2条：初始变量（YAML格式）=====\n\n' +
    '【任务】帮助用户创作一个结构正确的MVU初始变量文件，设定剧情开始时各变量的初始值\n\n' +
    '【前置条件】用户应该已经完成MVU变量结构脚本\n\n' +
    '【工作流程】\n' +
    '第一步：了解需求\n' +
    '  询问用户：\n' +
    '  1. 剧情开始时有什么关键情节？\n' +
    '  2. 根据变量结构脚本中列出的变量继续询问\n' +
    '     - xxx变量在该剧情下是否有特殊设定？\n\n' +
    '第二步：确认结构\n' +
    '  根据变量结构脚本使用YAML编写初始变量\n\n' +
    '【示例】\n' +
    '  络络:\n' +
    '    亲密度: 0\n' +
    '    阅读日记数量: 0\n' +
    '    拥有联系方式: false\n' +
    '    物品栏: {}\n' +
    '  世界:\n' +
    '    当前日期: 2025-07-26\n' +
    '    当前星期: 星期五\n' +
    '    当前时间: 17:36\n\n' +
    '【注意事项】\n' +
    '  1. 条目命名：[initvar]变量初始化勿开\n' +
    '  2. 合理初始值：根据故事开局设置合理的初始值\n' +
    '  3. 后续配置：提醒用户这只是初始变量，还需要配置世界书条目和变量规则\n\n' +
    '【沟通风格】\n' +
    '  - 用自然语言和用户交流\n' +
    '  - 逐步确认需求，不要一次性问太多\n' +
    '  - 给出建议但尊重用户选择\n' +
    '  - 完成后询问是否需要调整\n\n' +
    '  开始协作吧！\n\n' +
    '  ---\n\n' +
    '  完成后的引导\n\n' +
    '  当初始变量创作完成并输出后：\n\n\n' +
    '  下一步：创建变量更新规则。对我说"写变量更新规则"。\n\n' +
    '===== 第3条：变量更新规则 =====\n\n' +
    '【任务】帮用户写MVU变量的更新规则文件，告诉AI什么情况下应该更新变量、更新成什么值\n\n' +
    '【前置条件】用户应该已经完成MVU变量结构脚本\n\n' +
    '【变量规则文件结构】\n' +
    '  ---\n' +
    '  变量更新规则:\n' +
    '    ${变量名}:\n' +
    '      type: ${变量类型，如果类型是string则省略这一字段，否则要么是number、boolean等基础类型，要么使用typescript类型定义或zod schema定义（使用|-字符串块）}\n' +
    '      ${其他合适字段，仅当非常需要时才添加如format、range等...}\n' +
    '      check:\n' +
    '        - ${该变量更新时需要检查的更新规则，如：根据角色对行为的反应调整，单次不超过±5}\n' +
    '        - ...$(根据需要列出更新条件)\n' +
    '    ...\n\n' +
    '【要求】\n' +
    '  - 合并同类型变量规则：\n' +
    '    * 固定键：z.object({...})和z.record(z.enum(...), ...)的键总是存在，可合并为 主角.能力面板.${力量|敏捷|体质}\n' +
    '    * 动态键：z.record(z.string(), ...)和z.partialRecord(z.enum(...), ...)可能为空，将key放入type的索引签名\n' +
    '  - 嵌套同对象字段：主角.能力面板和主角.装备栏都是主角的字段，嵌套在主角下\n' +
    '  - string类型变量省略type字段\n' +
    '  - 不更新只读字段：_开头字段只读，不列更新规则\n' +
    '  - 避免为自解释变量列规则（除非用户指定特殊规则）\n\n' +
    '【字段说明】\n' +
    '  - type: 变量支持的类型（number/boolean/typescript类型定义/zod schema定义）\n' +
    '  - range: 仅当 zod 未做数值 clamp 处理时才填写，否则删除此字段（zod已约束，更新规则侧不重复约束）\n' +
    '  - format: 变量必须满足的特定格式（如YYYY年MM月DD日 星期X HH:MM）\n' +
    '  - check: AI在更新变量时应该考虑的因素（自然语言描述）——更新规则的核心，应侧重描述"何时更新"、"更新幅度"、"触发条件"等\n\n' +
    '【示例】（zod已对数值做clamp时，删除 range 重复约束，侧重建check逻辑）\n' +
    '  ---\n' +
    '  变量更新规则:\n' +
    '    世界:\n' +
    '      当前时间:\n' +
    '        format: ${xx历}-${YYYY/MM/DD}-${HH:MM}\n' +
    '        check:\n' +
    '          - 每次事件推进、休息或旅行后更新，保持时间流逝合理\n' +
    '          - 若场景跳转跨度较大，应说明跳跃原因\n' +
    '    角色.好感度:\n' +
    '      type: number\n' +
    '      check:\n' +
    '        - 仅在{{user}}有显著互动且角色感知到时更新\n' +
    '        - 单次变动建议 ±(1~3)\n' +
    '    主角:\n' +
    '      能力面板.${力量|敏捷|体质|感知|意志|魅力}.数值:\n' +
    '        type: number\n' +
    '        check:\n' +
    '          - 训练、战斗、重伤、系统奖励等显著事件才调整\n' +
    '          - 单次变化不超过 ±10，除非剧情有明确强化/削弱\n' +
    '      装备栏.${部位}:\n' +
    '        type: |-\n' +
    '          {\n' +
    '            装备: string; // 装备名称 + 状态; 若未装备，使用"空置"或"无"\n' +
    '            主角评价: string;\n' +
    '          }\n' +
    '        check:\n' +
    '          - 穿戴、损毁、替换装备时更新装备描述\n' +
    '    _只读字段:\n' +
    '      check:\n' +
    '        - ❌禁止更新：此字段由系统脚本自动维护\n' +
    '    任务列表:\n' +
    '      type: |-\n' +
    '        {\n' +
    '          [任务名: string]: {\n' +
    '            类型: \'主线\' | \'支线\' | \'每日\' | \'临危受命\' ;\n' +
    '            说明: string; # 面向主角的任务背景或细则\n' +
    '            目标: string; # 明确可执行的目标描述，可包含步骤\n' +
    '            奖励: string;\n' +
    '            惩罚: string; # 失败后触发的负面效果\n' +
    '          }\n' +
    '        }\n' +
    '      check:\n' +
    '        - 避免一次性添加超过3个主线任务，保持焦点\n' +
    '        - 日常任务完成后可重置但需记录冷却\n' +
    '  ${变量}.主角评价:\n' +
    '    check:\n' +
    '      - 在对应变量值发生变化或遭遇相关事件后可更新，其他情况不应更新\n' +
    '      - 语言应保持第一人称/贴近主角口吻\n' +
    '      - 主角的评价并不会被主角本人看到，也不会在剧情中出现\n\n' +
    '  开始协作吧！\n\n' +
    '  ---\n\n' +
    '  完成后的引导\n\n' +
    '  当变量更新规则创作完成并输出后：\n\n' +
    '  下一步：创建变量列表。对我说"写变量列表"。\n\n' +
    '===== 第4条：变量列表（固定格式，原样输出）=====\n\n' +
    '  ---\n' +
    '  <status_current_variables>\n' +
    '  null\n' +
    '  </status_current_variables>\n\n' +
    '  重点：这就是你要输出给用户的完整格式！整个内容用代码块包裹，一次性完整输出！\n\n' +
    '  开始协作吧！\n\n' +
    '  ---\n\n' +
    '  完成后的引导\n\n' +
    '  当变量列表创作完成并输出后：\n\n\n' +
    '  下一步：创建变量输出格式。对我说"写变量输出格式"。\n\n' +
    '===== 第5条：变量输出格式（固定格式，原样输出）=====\n\n' +
    '  ---\n' +
    '  变量输出格式:\n' +
    '    rule:\n' +
    '      - you must output the update analysis and the actual update commands at once in the end of the next reply\n' +
    '      - the update commands works like the **JSON Patch (RFC 6902)** standard, must be a valid JSON array containing operation objects, but supports the following operations instead:\n' +
    '        - replace: replace the value of existing paths\n' +
    '        - delta: update the value of existing number paths by a delta value\n' +
    '        - insert: insert new items into an object or array (using `-` as array index intends appending to the end)\n' +
    '        - remove\n' +
    '        - move\n' +
    '      - don\'t update field names starts with `_` as they are readonly, such as `_变量`\n' +
    '    format: |-\n' +
    '      <UpdateVariable>\n' +
    '      <Analysis>$(IN ENGLISH, no more than 80 words)\n' +
    '      - ${calculate time passed: ...}\n' +
    '      - ${decide whether dramatic updates are allowed as it\'s in a special case or the time passed is more than usual: yes/no}\n' +
    '      - ${analyze every variable based on its corresponding `check`, according only to current reply instead of previous plots: ...}\n' +
    '      </Analysis>\n' +
    '      <JSONPatch>\n' +
    '      [\n' +
    '        { "op": "replace", "path": "${/path/to/variable}", "value": "${new_value}" },\n' +
    '        { "op": "delta", "path": "${/path/to/number/variable}", "value": "${positive_or_negative_delta}" },\n' +
    '        { "op": "insert", "path": "${/path/to/object/new_key}", "value": "${new_value}" },\n' +
    '        { "op": "insert", "path": "${/path/to/array/-}", "value": "${new_value}" },\n' +
    '        { "op": "remove", "path": "${/path/to/object/key}" },\n' +
    '        { "op": "remove", "path": "${/path/to/array/0}" },\n' +
    '        { "op": "move", "from": "${/path/to/variable}", "to": "${/path/to/another/path}" },\n' +
    '        ...\n' +
    '      ]\n' +
    '      </JSONPatch>\n' +
    '      </UpdateVariable>\n\n' +
    '  重点：这就是你要输出给用户的完整格式！整个内容用代码块包裹，一次性完整输出！\n\n' +
    '  开始协作吧！\n\n' +
    '  ---\n\n' +
    '  完成后的引导\n\n' +
    '  当变量输出格式创作完成并输出后：\n\n' +
    '  下一步：创建变量输出格式强调。对我说"写变量输出格式强调"。\n\n' +
    '===== 第6条：变量输出格式强调（固定格式，原样输出）=====\n\n' +
    '  注意：这个条目只在测试时发现AI不输出 <UpdateVariable> 块时才需要启用。\n\n' +
    '  ---\n' +
    '  变量输出格式强调:\n' +
    '    rule: The following must be inserted to the end of reply, and cannot be omitted\n' +
    '    format: |-\n' +
    '      <UpdateVariable>\n' +
    '      ...\n' +
    '      </UpdateVariable>\n\n' +
    '  重点：这就是你要输出给用户的完整格式！整个内容用代码块包裹，一次性完整输出！\n\n' +
    '  开始协作吧！\n\n' +
    '  ---\n\n' +
    '  完成后的引导\n\n' +
    '  注意：这个条目只在测试时发现AI不输出 <UpdateVariable> 块时才需要启用。';

  // ============================================================================
  // SECTION 7  MVU 8步工作流 + 提示词构建（buildPrompt · Tab隔离）
  // ============================================================================
  // ===== 构建完整提示词 =====
  function buildPrompt(cardData, cardGenerated, messages) {
    // ========== Tab 隔离系统：根据当前 Tab 返回完全不同的提示词，两边互不干扰 ==========
    // 优先顺序：window.__getActiveTab()（最新闭包）→ window.__tab_activeTab → activeTab/currentTab（作用域降级）
    let __tab = 'card';
    if (typeof window !== 'undefined') {
      if (typeof window.__getActiveTab === 'function') {
        try {
          __tab = window.__getActiveTab() || 'card';
        } catch (_eTab1) {}
      } else if (window.__tab_activeTab) {
        __tab = window.__tab_activeTab;
      }
    }
    if (__tab !== 'card' && __tab !== 'mvu') __tab = 'card';
    // （已删除死代码：原先这里用 typeof 读取 activeTab/currentTab 兜底，但这两个变量声明在
    //  openEditor() 内部而 buildPrompt 定义在 IIFE 顶层，词法上永不可见，整块永不生效；
    //  且即便可见也会覆盖上方 window.__getActiveTab() 的权威值，属优先级倒置）
    if (__tab === 'mvu') {
      // ===== MVU变量状态栏 Tab：只发角色卡内容 + MVU专属指令，完全不发角色卡生成逻辑 =====
      return buildMvuTabPrompt(cardData, messages);
    }
    // ===== 角色卡生成 Tab：继续走原逻辑，但严格剥离/禁止所有MVU内容 =====
    let existingInfo = '';
    const cd = cardData;
    if (cd && (cd.name || cd.description || cd.first_mes || (cd.character_book && cd.character_book.entries && cd.character_book.entries.length > 0))) {
      const parts = [];
      if (cd.name) parts.push('世界/角色名称：' + cd.name);
      if (cd.description) parts.push('世界观描述(完整' + (cd.description || '').length + '字，不截断)：' + (cd.description || ''));
      if (cd.system_prompt) parts.push('系统指令(完整' + (cd.system_prompt || '').length + '字，不截断)：' + (cd.system_prompt || ''));
      if (cd.personality) parts.push('性格总结(完整' + (cd.personality || '').length + '字，不截断)：' + (cd.personality || ''));
      if (cd.scenario) parts.push('场景(完整' + (cd.scenario || '').length + '字，不截断)：' + (cd.scenario || ''));
      if (cd.first_mes) parts.push('开场白1(完整' + (cd.first_mes || '').length + '字，不截断)：' + (cd.first_mes || ''));
      if (cd.mes_example) parts.push('对话示例(完整' + (cd.mes_example || '').length + '字，不截断)：' + (cd.mes_example || ''));
      if (Array.isArray(cd.alternate_greetings) && cd.alternate_greetings.length > 0) {
        const altList = cd.alternate_greetings.map(function(g, gi) {
          return '开场白' + (gi + 2) + '(完整' + (typeof g === 'string' ? g.length : 0) + '字，不截断)：' + (typeof g === 'string' ? g : '');
        }).join('\n');
        parts.push('备选开场白（alternate_greetings，共' + cd.alternate_greetings.length + '条，开场白2/3以此类推）：\n' + altList);
      }
      const entries = (cd.character_book || {}).entries || [];
      if (entries.length > 0) {
        // ========== 角色卡Tab：过滤掉MVU相关条目，不让AI看到MVU内容，也禁止它生成 ==========
        const filteredEntries = entries.filter(function(e) {
          const c = (e.comment || '').toLowerCase();
          // 只保留非MVU条目：剔除[InitVar]、变量列表、变量更新规则、变量输出格式、状态变量输出这5类MVU专属条目
          if (c.indexOf('[initvar]') >= 0) return false;
          if (_isVarListEntry(e.comment, e.content)) return false;
          if (c.indexOf('变量更新规则') >= 0) return false;
          if (c.indexOf('变量输出格式') >= 0 || c.indexOf('mvu_update') >= 0) return false;
          if (c.indexOf('状态变量输出') >= 0) return false;
          if (c.indexOf('<状态栏>') >= 0) return false; // 角色卡Tab也不处理<状态栏>条目，MVU Tab专属
          return true;
        });
        let entryText = '世界书条目（' + filteredEntries.length + '条，不含MVU变量系统内容）：';
        filteredEntries.forEach(function(e, i) {
          // ⚠️修复：发送完整 content（不再截断200字），让 AI 在修改条目时能看到完整旧内容，
          //   避免AI基于200字摘要重新生成完全不同的内容覆盖旧条目
          entryText += '\n  ' + (i + 1) + '. [' + (e.comment || '条目' + (i + 1)) + '] keys:' + (e.keys || []).join(',') + '\n     content(' + (e.content || '').length + '字): ' + (e.content || '');
        });
        parts.push(entryText);
        // 精确 comment 清单（只列非MVU条目）
        let commentListText = '⚠️【世界书条目精确 comment 清单 - 删改时务必使用下列精确字符串匹配】\n';
        commentListText += '删除条目写法：\n';
        commentListText += '  方式1: { "_delete": ["character_book.entries.<这里粘贴完整comment>"] }\n';
        commentListText += '  方式2: entries数组里加 { "_action":"delete", "comment":"<这里粘贴完整comment>" }\n';
        commentListText += '修改条目写法（确保成功覆盖）：comment必须与下面「精确字符串」完全相同，字符级匹配，空格标点都不能变！\n';
        commentListText += '----------------------------------------\n';
        filteredEntries.forEach(function(e, i) {
          const comment = e.comment || ('条目' + (i + 1));
          commentListText += (i + 1) + '. 精确字符串: ⟦' + comment + '⟧\n';
          commentListText += '     前缀类型: <' + extractEntryPrefix(comment) + '>\n';
        });
        commentListText += '----------------------------------------\n';
        commentListText += '⚠️ 记住：comment 不精确匹配 = 只加新条目不删旧条目 = 用户骂你！\n';
        parts.push(commentListText);
      }
      if (parts.length > 0) existingInfo = '\n\n=== 当前角色卡已有内容（不要重复输出，除非增/删/改）【角色卡Tab：不含MVU变量系统内容】 ===\n' + parts.join('\n');
    }

    // 注入实际世界书条目统计（供AI了解当前已有哪些条目，避免重复/覆盖）
    let qcBlock = '';
    if (cd) {
      const entries = (cd.character_book || {}).entries || [];
      // 角色卡Tab：过滤MVU条目后再统计条目总数
      const nonMvuEntries = entries.filter(function(e) {
        const c = (e.comment || '').toLowerCase();
        if (c.indexOf('[initvar]') >= 0) return false;
        if (_isVarListEntry(e.comment, e.content)) return false;
        if (c.indexOf('变量更新规则') >= 0) return false;
        if (c.indexOf('变量输出格式') >= 0 || c.indexOf('mvu_update') >= 0) return false;
        if (c.indexOf('状态变量输出') >= 0) return false;
        return true;
      });
      const constCount = nonMvuEntries.filter(function(e) {
        return e.constant === true;
      }).length;
      const trigCount = nonMvuEntries.length - constCount;
      qcBlock = '\n\n=== 📋 当前世界书条目统计（权威标准，你必须以此为准）【角色卡Tab：不含MVU变量条目】 ===\n';
      qcBlock += '实际世界书条目总数（不含MVU变量条目）：' + nonMvuEntries.length + ' 条\n';
      qcBlock += '常驻条目：' + constCount + ' 条 · 触发条目：' + trigCount + ' 条\n';
      qcBlock += '如需新增条目直接upsert；修改已有条目必须输出完整旧content+改动部分；删除用delete。\n';
    }

    const stateInfo = cardGenerated ?
      '\n\n=== 当前状态：世界书条目已具备【角色卡Tab生成模式】 ===\n用户可继续完善细节，或要求生成完整世界书/角色卡。' :
      '\n\n=== 当前状态：创作进行中【角色卡Tab生成模式】 ===\n请继续根据用户描述自由生成世界书条目。';

    // 角色卡Tab：永远不开启状态栏生成模式（即使模块级变量被污染也要强制屏蔽）
    const statusBarStateInfo = '';
    // 角色卡Tab下的核心铁律注入：严格禁止生成任何MVU相关条目
    const antiMvuBlock = '\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '⚠️【角色卡Tab核心铁律 · MVU隔离禁令 · 最高优先级，违反即失败】\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '1. ❌禁止生成任何与MVU变量系统相关的条目！包括但不限于：\n' +
      '   · [InitVar]初始变量 / 变量列表 / 变量更新规则 / 变量输出格式 四类MVU专属条目\n' +
      '   · 变量列表条目（<status_current_variables> 标签内为 null 的条目）\n' +
      '   · [mvu_update]前缀或<UpdateVariable>JSON Patch相关内容的条目\n' +
      '   · <状态变量输出>前缀的条目\n' +
      '   · 任何其他变量相关、变量更新、变量渲染的条目\n' +
      '2. ❌禁止生成<状态栏>条目或任何状态栏相关的世界书条目！\n' +
      '   · MVU变量系统和状态栏完全由「MVU变量状态栏」Tab独立管理，不属于角色卡生成范畴\n' +
      '   · 如果用户明确提到MVU/变量/状态栏，回复:「请切换到「MVU变量状态栏」Tab进行MVU变量系统和状态栏的设计」\n' +
      '3. ❌禁止在任何生成的JSON字段（description/system_prompt/entries等）中包含MVU相关内容！\n' +
      '4. ❌禁止在regex_scripts中生成任何与MVU相关的正则脚本！\n' +
      '5. ✅除上述MVU相关条目外，正常生成所有世界书条目（自由命名，不限制标签前缀）\n' +
      '6. ✅如果角色卡中已经存在MVU相关条目，请保留原样、不要修改、不要删除、不要重新生成——它们由MVU Tab负责管理。\n' +
      '═══════════════════════════════════════════════════════════════════\n';

    // 构建系统提示词（角色卡Tab：过滤SYS_PROMPT中的MVU段落 + 追加MVU隔离禁令）
    const filteredSysPrompt = filterOutMvuSectionsFromSysPrompt(SYS_PROMPT);
    const sysPrompt = filteredSysPrompt + stateInfo + existingInfo + qcBlock + statusBarStateInfo + antiMvuBlock;

    // jsonReminder：角色卡Tab统一使用 :::操作块协议（用户指定：只用:::操作块，禁止输出```json代码块）
    let jsonReminder = '';
    jsonReminder = '\n\n⚠️【输出格式提醒 - 每次回复必须遵守（角色卡Tab）】\n' +
      '1. ★★★【只用:::操作块】禁止输出```json代码块、禁止输出JSON、禁止输出任何代码块——所有增删改一律用 :::操作块协议：\n' +
      '   ::: upsert 条目名\n   keys=触发词1,触发词2\n   constant=false\n   position=4\n   selectiveLogic=0\n   depth=4\n   probability=100\n   order=100\n   match_whole_words=false\n\n   身份：……\n   外貌：……\n   性格：……\n   能力：\n     - ……\n     - ……\n   :::\n' +
      '2. 五种动作：upsert增改 / update只改 / delete删 / set顶层字段 / rename重命名；set可修改 description(世界观描述)/first_mes(开场白)/alternate_greetings(备选开场白)/name 等顶层字段\n' +
      '3. 用户要求"生成世界观/开场白/完整世界书"时：用 set 设置 description/first_mes/alternate_greetings，用 upsert 生成条目\n' +
      '4. 状态栏完全不在此Tab处理——如果用户要做MVU/变量/状态栏，请引导切换到MVU Tab\n' +
      '5. 先输出1-2句自然语言说明，再输出操作块，操作块后不再解释\n' +
      '6. 没有需要修改的内容就回复"本次无修改"\n' +
      '7. ⚠️严禁只聊天不输出操作块！严禁生成任何MVU相关条目（见上方MVU隔离禁令）\n' +
      '8. ⚠️【语义优先】用户说话=要增删改！反问句/不满句=隐含修改需求，不要当聊天。例如"白娅是不是太普通"=要改白娅，不是回答"是/否"\n' +
      '9. ⚠️【混合打包】改+增+删可以混在同一回复，按语义→操作组合自由搭配，无需分多次\n' +
      '10. ⚠️【upsert覆盖必填完整】当要改已有条目：先读上方「当前角色卡已有内容」拿完整旧content，:::upsert时输出完整旧内容+改动部分，严禁只输出变化字段（会导致原信息清空）\n' +
      '11. ⚠️只处理用户「最新一条」消息的指令！不要重复处理之前已经回答过的旧指令！\n' +
      '12. ★★★【只增不删·冲突才改·不冲突保留】用户每条新信息都是在丰富世界书，不是重写。新信息=新条目直接upsert；与旧内容不冲突=⟦⟧补充条目或upsert追加；与旧内容同一字段矛盾=才upsert覆盖该字段（其余旧内容原样保留）。禁止因"觉得旧内容不够好"就覆盖或删除。\n' +
      '13. ★★★【自由生成】不要受任何固定体系/标签前缀束缚！用户要什么就生成什么条目，条目标签自由命名（如"自定义条目""自定义"等），字段配置按上方ST世界书JSON规则设置。\n' +
      '14. ★★★【结合已有内容调整条目元素】生成或修改条目时，必须参考上方「当前角色卡已有内容」（name/description/开场白/已有条目），据此调整新条目的 keys触发词、constant常驻或触发、position位置、depth深度、selectiveLogic逻辑、group分组等元素，使其与世界观描述和已有条目协调一致，不重复不冲突。\n' +
      '15. ★★★【正文YAML中文格式】条目正文（content）禁止写成一大段无结构文字！必须用YAML中文格式：每行一个「维度：内容」（身份/外貌/性格/能力/背景/关系等），列表用缩进+短横线逐项列出，层级用缩进表达。描述类正文（世界观/开场白）同样分段分点。\n' +
      '16. ★★★【逐项决策40元素】每次生成/修改条目，必须把条目内的每一个元素过一遍（触发词/常驻/位置/深度/触发逻辑/概率/全词匹配/分组/递归/黏性冷却延迟/匹配字段等，完整清单见上方系统提示「条目元素逐项决策清单」）：需自定义的写进操作块元信息行，默认值的不用写。禁止漏掉影响触发的字段，禁止只写keys和content。';

    let fullPrompt = sysPrompt + jsonReminder + '\n\n=== 对话历史（角色卡Tab专属，与MVU Tab完全隔离） ===\n';

    // ★ 优先使用传入的 messages 参数（callAIChat 传的是 curTabMessages=当前Tab的消息，权威），
    //   未传时再降级到 getCurrentMessages()/window.__getCurrentMessages()，避免上下文与实际发送的Tab错位
    const tabMessages = (messages && Array.isArray(messages) && messages.length > 0) ?
      messages :
      (typeof getCurrentMessages === 'function' && Array.isArray(getCurrentMessages())) ?
      getCurrentMessages() :
      (typeof window !== 'undefined' && typeof window.__getCurrentMessages === 'function' && Array.isArray(window.__getCurrentMessages())) ?
      window.__getCurrentMessages() :
      (Array.isArray(messages) ? messages : []);
    tabMessages.forEach(function(m, idx) {
      const isLast = (idx === tabMessages.length - 1);
      const roleLabel = (m.role === 'user' ? '用户' : '助手');
      // 🐛修复：助手消息中的:::操作块、```代码块、<statusblock>都是给写卡器解析用的
      // AI不需要再看这些格式指令（它只需要看到自然语言对话+角色卡当前状态）
      // 发送给AI前全部清理掉，避免AI模仿格式、浪费token、产生混淆
      let msgContent = m.content || '';
      if (m.role === 'assistant') {
        msgContent = msgContent
          // 清理:::操作块（含开始::: action key 到结束:::）
          .replace(/:::\s*(?:upsert|update|delete|set|rename)\s+[^\n\r]*[\s\S]*?(?=\n\s*:::|\n\n|$)/gi, '')
          .replace(/:::\s*(?:upsert|update|delete|set|rename)\s+[^\n\r]*/gi, '')
          .replace(/^\s*:::\s*$/gim, '')
          // 清理```代码块（JSON/CSS/HTML等所有代码块）
          .replace(/```[\s\S]*?```/g, '')
          // 清理折叠块和状态栏
          .replace(/<details[\s\S]*?<\/details>/gi, '')
          .replace(/<statusblock>[\s\S]*?<\/statusblock>/gi, '')
          // 清理多余空行
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (!msgContent || msgContent.length <= 5) msgContent = '（已应用修改）';
      }
      if (isLast && m.role === 'user') {
        fullPrompt += '>>>【当前需要处理的最新指令】<<<\n' + roleLabel + ': ' + msgContent + '\n\n';
      } else {
        fullPrompt += roleLabel + ': ' + msgContent + '\n\n';
      }
    });
    fullPrompt += '助手: ';

    // 额外追加一句"只回答最新指令"的锚点提示
    fullPrompt += '（请只针对上方>>>标记的最新指令回复，不要重复处理已回答过的旧指令。严格遵守MVU隔离禁令，绝对不要生成任何MVU变量相关条目。）';

    return fullPrompt;
  }

  // ========== 工具函数：从SYS_PROMPT中剔除MVU相关段落（角色卡Tab用） ==========
  function filterOutMvuSectionsFromSysPrompt(originalPrompt) {
    if (!originalPrompt) return originalPrompt;
    // 通过关键词过滤掉MVU专属的大型段落：
    // （正则脚本文档/示例、状态栏Step生成流程、MVU脚本API等已从SYS_PROMPT源头删除，无需运行时过滤）
    // 1. 条目命名规范中 [InitVar]/变量列表/变量更新规则/变量输出格式/<状态变量输出>
    // 2. 条目配置规范中 MVU 相关行
    // 3. MVU变量系统设计模式区块（模式1-5 + zod安装清单）
    // 4. 步骤7：配变量系统区块
    // 简单起见，用分段+正则过滤掉关键词区域
    let p = originalPrompt;
    // 条目命名规范中移除7个MVU相关条目前缀说明
    // ⚠️ 宽松锚点：SYS_PROMPT 实际文本为 "- [InitVar]初始变量（第2条）：MVU变量系统..."
    // （原先正则要求字面 ":MVU变量系统" 无（第N条）编号，导致永不匹配、MVU条目说明泄漏）
    const mvuPrefixPattern = /- \[InitVar\]初始变量[^\n]*MVU变量系统[\s\S]*?- <状态变量输出>：输出当前变量状态给LLM的触发条目/;
    if (mvuPrefixPattern.test(p)) {
      p = p.replace(mvuPrefixPattern, '- 【MVU专属条目已剥离 - 请在MVU变量状态栏Tab查看】');
    }
    // 条目配置规范表中移除 MVU 相关行（最后5行左右的 MVU 条目配置）
    const mvuConfigPattern = /\| \[InitVar\]初始变量[\s\S]*?\| <状态变量输出>.*?\n/;
    if (mvuConfigPattern.test(p)) {
      p = p.replace(mvuConfigPattern, '| 【MVU条目配置已剥离 - 请在MVU变量状态栏Tab查看】 |\n');
    }
    // 注5、注6（MVU相关的注）也删掉
    p = p.replace(/注5：\[InitVar\].*?\n/g, '注5：【MVU相关注已剥离】\n');
    p = p.replace(/注6：MVU脚本.*?\n/g, '注6：【MVU相关注已剥离】\n');
    /* 注：MVU变量系统设计模式区块（模式1-5 + zod安装清单）已从SYS_PROMPT源头删除，无需运行时过滤 */
    /* 改进B：过滤"步骤7：配变量系统"区块（变量系统配置说明，MVU Tab专属） */
    // ⚠️ 前瞻补全为三个等号（(?==== ...)）：实际标题为 "=== 质量检查标准"，原先两个等号会在
    // 标题第一个 = 处提前截断，替换后标题被腐蚀成 "== 质量检查标准"
    const mvuStep7Pattern = /\*\*步骤7：配变量系统\*\*[\s\S]*?(?==== 质量检查标准)/;
    if (mvuStep7Pattern.test(p)) {
      p = p.replace(mvuStep7Pattern, '**步骤7：配变量系统**（MVU变量系统，进阶可选）- 【已剥离，请在MVU变量状态栏Tab查看】\n\n');
    }
    return p;
  }

  // ========== MVU Tab 专属提示词：完全不发角色卡生成逻辑，只发角色卡内容 + MVU指令 ==========
  function buildMvuTabPrompt(cardData, messages) {
    const cd = cardData || {};
    // 1. 收集当前角色卡的「纯内容上下文」（仅用于参考，不发送角色卡生成逻辑）
    let cardContext = '';
    const ctxParts = [];
    if (cd.name) ctxParts.push('角色/世界名称：' + cd.name);
    if (cd.description) ctxParts.push('世界观描述(完整' + (cd.description || '').length + '字，不截断)：' + (cd.description || ''));
    if (cd.first_mes) ctxParts.push('开场白(完整' + (cd.first_mes || '').length + '字，不截断)：' + (cd.first_mes || ''));
    // 从现有角色卡条目中，提取MVU专属条目（如果存在）——只提取这些，其他世界书条目不发给AI（避免干扰）
    const entries = (cd.character_book || {}).entries || [];
    // ========== 消除过度隔离：注入常规世界书条目摘要（只读上下文） ==========
    // MVU Tab 设计变量时需要知道世界里有哪些实体/属性/机制，才能设计出有意义的变量
    // 只发 comment + content 前300字摘要，不发完整内容（节省 token），且明确标注「只读、不可修改」
    const nonMvuEntries = entries.filter(function(e) {
      const c = (e.comment || '').toLowerCase();
      if (c.indexOf('[initvar]') >= 0) return false;
      if (_isVarListEntry(e.comment, e.content)) return false;
      if (c.indexOf('变量更新规则') >= 0) return false;
      if (c.indexOf('变量输出格式') >= 0 || c.indexOf('mvu_update') >= 0) return false;
      if (c.indexOf('状态变量输出') >= 0) return false;
      return true;
    });
    if (nonMvuEntries.length > 0) {
      let nonMvuText = '世界书常规条目完整内容（' + nonMvuEntries.length + '条 · 只读上下文，用于设计变量参考，❌禁止修改这些条目）：\n';
      nonMvuEntries.forEach(function(e, i) {
        const content = (e.content || '');
        nonMvuText += '  ' + (i + 1) + '. [' + (e.comment || '条目' + (i + 1)) + '] (完整' + content.length + '字，不截断):\n' + content + '\n';
      });
      ctxParts.push(nonMvuText);
    }
    const mvuOnlyEntries = entries.filter(function(e) {
      const c = (e.comment || '').toLowerCase();
      if (c.indexOf('[initvar]') >= 0) return true;
      if (_isVarListEntry(e.comment, e.content)) return true;
      if (c.indexOf('变量更新规则') >= 0) return true;
      if (c.indexOf('变量输出格式') >= 0 || c.indexOf('mvu_update') >= 0) return true;
      if (c.indexOf('状态变量输出') >= 0) return true;
      return false;
    });
    if (mvuOnlyEntries.length > 0) {
      let mvuEntryText = '当前已有MVU变量条目（' + mvuOnlyEntries.length + '条）：\n';
      mvuEntryText += '⚠️ 下方每条条目的「实际content」被 <<<content 开始>>> ... <<<content 结束>>> 包裹。\n';
      mvuEntryText += '⚠️ upsert 时只输出 <<<content 开始>>> 和 <<<content 结束>>> 之间的部分作为 content，\n';
      mvuEntryText += '   绝对不要把 comment/enabled/keys 这些字段名当 YAML 变量写进 content！\n\n';
      mvuOnlyEntries.forEach(function(e, i) {
        mvuEntryText += '── 条目 ' + (i + 1) + ' ──\n';
        mvuEntryText += '【comment】' + (e.comment || '(空)') + '\n';
        mvuEntryText += '【enabled】' + (e.enabled === false ? 'false' : 'true') + '\n';
        mvuEntryText += '【keys】' + (e.keys || []).join(', ') + '\n';
        mvuEntryText += '【content】（以下 <<<>>> 之间的才是真实 content，upsert 时只输出这部分）：\n';
        mvuEntryText += '<<<content 开始>>>\n' + (e.content || '(空)') + '\n<<<content 结束>>>\n\n';
      });
      ctxParts.push(mvuEntryText);
      // 追加精确comment清单（供:::操作块精确匹配用）
      let mvuCmtList = '⚠️【MVU条目精确 comment 清单 - :::操作块增删改时务必使用精确字符串】\n';
      mvuOnlyEntries.forEach(function(e, i) {
        mvuCmtList += (i + 1) + '. ⟦' + (e.comment || '') + '⟧ enabled=' + (e.enabled === false ? 'false' : 'true') + '\n';
      });
      mvuCmtList += '----------------------------------------\n';
      mvuCmtList += '删除条目：::: delete ' + (mvuOnlyEntries[0] ? mvuOnlyEntries[0].comment : '精确comment') + '\n:::\n';
      mvuCmtList += '修改条目：::: upsert 精确comment\n新内容\n:::\n';
      mvuCmtList += '⚠️ comment必须精确匹配，字符级一致！\n';
      ctxParts.push(mvuCmtList);
    }
    // 提取已有的正则脚本中 MVU 相关内容
    const regexScripts = (cd.extensions || {}).regex_scripts || [];
    const mvuRegexScripts = regexScripts.filter(function(s) {
      const name = (s.scriptName || '').toLowerCase();
      const find = (s.findRegex || '').toLowerCase();
      return name.indexOf('mvu') >= 0 || name.indexOf('status') >= 0 || find.indexOf('statusplaceholderimpl') >= 0 || find.indexOf('updatevariable') >= 0;
    });
    if (mvuRegexScripts.length > 0) {
      let rxText = '当前已有MVU相关正则脚本（' + mvuRegexScripts.length + '条）：\n';
      mvuRegexScripts.forEach(function(r, i) {
        rxText += '── 正则 ' + (i + 1) + ' ──\n';
        rxText += '名称: ' + (r.scriptName || '(空)') + '\n';
        rxText += 'disabled: ' + (!!r.disabled) + '\n\n';
      });
      ctxParts.push(rxText);
    }
    if (ctxParts.length > 0) {
      cardContext = '\n' +
        '═══════════════════════════════════════════════════════════════════\n' +
        '📋 当前角色卡内容上下文（仅作MVU设计参考用）\n' +
        '═══════════════════════════════════════════════════════════════════\n' +
        ctxParts.join('\n───\n') + '\n' +
        '═══════════════════════════════════════════════════════════════════\n';
    }

    // 2. 状态栏已统一使用单一模板（MVU_STATUS_BAR_TEMPLATE），不再有分步模式状态信息

    // 3. MVU 专属系统指令（SYS_PROMPT中 MVU 部分的精简提取）
    const mvuSystemPrompt = '' +
      '你是「MVU变量与状态栏设计师」——专门负责设计和维护MVU变量系统与HTML状态栏。\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🎯 你的专属职责（只有这些，别的都不管）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      'A. MVU变量系统8条工作流的设计与维护（详见MVU_VAR_SPEC第1-6条，每条停下等"继续"）：\n' +
      '   第1条：变量结构脚本（zod 4 schema + registerMvuSchema）\n' +
      '   第2条：[InitVar]初始变量（enabled=false，YAML格式，严格依据schema）\n' +
      '   第3条：[mvu_update]变量更新规则（依据schema生成check/type/range）\n' +
      '   第4条：变量列表（标签内为 null）\n' +
      '   第5条：[mvu_update]变量输出格式（<UpdateVariable>+<JSONPatch>5种操作）\n' +
      '   第6条：[mvu_update]变量输出格式强调（固定YAML，默认enabled=false）\n' +
      '   第7条：<状态栏>占位符提醒（constant=true）\n' +
      '   第8条：正则6 [美化]MVU状态栏（前7条完成后才生成，输出完整HTML文档）\n' +
      'B. 动态HTML状态栏设计与实现（第8条）：依据用户需求设计一个完整的HTML状态栏文档，直接输出完整代码，写卡器自动保存为正则脚本\n' +
      'C. MVU系统的修改、调试、预览\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '⚠️ MVU Tab 核心铁律（最高优先级）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '1. ❌绝对不要生成任何世界书条目、角色卡字段、角色卡生成相关内容！\n' +
      '   · 所有世界书条目（含触发词/常驻/规则/角色/地点等）都与你无关\n' +
      '   · 不要修改name、description、first_mes等角色卡字段\n' +
      '   · 不要生成角色卡JSON代码块——MVU条目修改用:::操作块协议\n' +
      '   · 如果用户明确要设计世界观/角色卡/剧情，回复:「请切换到「角色卡生成」Tab进行角色卡/世界书的创作」\n' +
      '2. ❌不要输出完整的角色卡JSON（chara_card_v3格式）——MVU Tab不负责生成角色卡\n' +
      '3. ✅所有输出只聚焦在：MVU 8条工作流条目（第1-7条用:::操作块）、状态栏完整HTML代码块\n' +
      '4. ✅MVU变量系统和状态栏之间要相互配合——变量的路径决定了状态栏的渲染路径，设计时要保证一致\n' +
      '5. ✅修改MVU条目时，使用:::操作块协议输出修改指令（与角色卡Tab相同），不要输出```json代码块\n' +
      '6. ✅状态栏：输出一个完整的HTML文档代码块（```html 或纯```），写卡器自动保存\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '📚 MVU变量系统技术规范速查\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '【MVU 8条工作流条目速查表】（第1-6条详细生成规范见MVU_VAR_SPEC常量，此处仅列字段配置速查）\n' +
      '第1条: 变量结构脚本 → tavern_helper.scripts，zod 4 Schema + registerMvuSchema（详见MVU_VAR_SPEC第1条）\n' +
      '第2条: comment="[InitVar]初始变量", constant=true, position=0(before_character_definition), insertion_order=100, enabled=false\n' +
      '       content=YAML格式（缩进表示层级），严格依据第1条schema（详见MVU_VAR_SPEC第2条）\n' +
      '第3条: comment="[mvu_update]变量更新规则", constant=true, position=4, depth=0, order=200\n' +
      '       content=依据第1条schema为每个变量路径生成 type/range/check（详见MVU_VAR_SPEC第3条）\n' +
      '第4条: comment="变量列表", constant=true, position=4, depth=0, order=200\n' +
      '       content 标签内为 null，由 MVU 脚本展开后显示变量快照（详见MVU_VAR_SPEC第4条）\n' +
      '第5条: comment="[mvu_update]变量输出格式", constant=true, position=4, depth=0, order=200\n' +
      '       content=固定YAML原样输出，<UpdateVariable>+<Analysis>+<JSONPatch>（详见MVU_VAR_SPEC第5条）\n' +
      '第6条: comment="[mvu_update]变量输出格式强调", constant=true, position=4, depth=0, order=200, enabled=false\n' +
      '       content=固定YAML原样输出，AI不输出<UpdateVariable>时启用强制提醒（详见MVU_VAR_SPEC第6条）\n' +
      '第7条: comment="<状态栏>占位符提醒", constant=true, position=4, depth=0, order=200\n' +
      '       content=提醒AI每条回复底部输出 <StatusPlaceHolderImpl/>\n' +
      '第8条: 正则6 [美化]MVU状态栏 → regex_scripts, markdownOnly=true, promptOnly=false（前7条完成后才生成）\n\n' +
      '【状态栏设计流程】（统一使用单一模板，直接输出完整HTML文档）\n' +
      '⚠️ 设计状态栏前，先做需求收集（用户已在消息中描述了需求则直接按描述生成，不重复询问）：\n' +
      '   1️⃣ 想要什么UI风格？（如：简约白卡/暗黑赛博朋克/古风水墨/科幻全息/可爱圆润/极简扁平）\n' +
      '   2️⃣ 想显示哪些变量？按什么分组？（如：只显示核心3个变量 / 按角色分组 / 按世界-角色-状态分层）\n' +
      '   3️⃣ 配色偏好？（主色调、背景色、强调色，或直接说"你看着办"）\n' +
      '   4️⃣ 是否要进度条？是否要嵌套分组？\n' +
      '   ⚠️用户回答前禁止输出状态栏代码块！用户说"直接生成"或"简单就行"或"你看着办"才可跳过询问，按默认风格生成\n\n' +
      '→ 需求明确后，输出一个完整HTML文档代码块（```html 或纯```）：\n' +
      '   · 完整 <!doctype html> 文档结构，<head>放<style>和<script type="module">，<body>放需要显示的变量DOM\n' +
      '   · body内每个需要显示的变量必须有唯一id（如id1/items-list/weapon等），populateCharacterData中用$(\'#id\').text(value)填充\n' +
      '   · <script>中实现 populateCharacterData() 函数：直接 getAllVariables() 读变量；_.get(all_variables,"stat_data.xxx",默认值)逐变量读取；$(\'#id\').text(value)逐变量手动填充\n' +
      '   · <script>中实现 async init()：await waitGlobalInitialized(\'Mvu\'); populateCharacterData(); eventOn(Mvu.events.VARIABLE_UPDATE_ENDED,()=>{populateCharacterData();}); $(\'.section-header\').on(\'click\',function(){toggleSection($(this));}); 最后 $(errorCatched(init));\n' +
      '   · 数组用items.map(i=>...).join()生成HTML后$(\'#list\').html(html)；对象用Object.entries遍历；嵌套对象用可选链?.\n' +
      '   · 注意：所有变量路径必须以 stat_data. 开头\n' +
      '   · 写卡器会自动提取该代码块保存为正则6脚本，无需分步、无需多次输出\n\n' +
      '【状态栏预览命令】\n' +
      '· 需要向用户展示当前状态栏效果时，在消息中输出: <preview_statusbar> 标记\n' +
      '· 写卡器会自动检测并渲染预览\n\n' +
      '【通用关键实现要求】\n' +
      '· 可用库：jquery、lodash、yaml、zod（无需import直接使用）\n' +
      '· DOM操作：必须用 document.getElementById("render-root")（标准实现模式），禁止为每个变量写id=stat-xxx再用jQuery选择\n' +
      '· 注释：禁止输出任何注释（/* */ 和 // 都不要写），注释会显示在状态栏上或导致渲染失败\n' +
      '· CSS/布局：禁用vh；禁用position:absolute；禁min-height/overflow:auto；用width+aspect-ratio适配\n' +
      '· 跳过隐藏变量：key以_或$开头的跳过不渲染\n' +
      '· 布尔值仅✓/✕：不要加是/否文字\n' +
      '\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🔗 路径一致性与覆盖铁律（状态栏能否显示的关键，违反=纯文字状态栏）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '⚠️状态栏显示为纯文字/占位符不消失，99%是以下路径不一致导致 populateCharacterData 读不到值、写不进DOM：\n' +
      '1. 【键名语言统一】InitVar 的 YAML 键名 ↔ populateCharacterData 的 _.get 路径 ↔ 变量更新规则引用的路径，三者必须字字相同。\n' +
      '   · 键名语言不限（中文键如 stat_data.世界.当前时间 / 英文键均可，MVU 官方模板两种都支持），但必须三处逐字一致\n' +
      '   · 若上方「当前角色卡内容上下文」已列出 InitVar 的实际键名，populateCharacterData 的 _.get 路径必须逐字引用那些键名，不得自创翻译\n' +
      '2. 【_.get 根路径统一】populateCharacterData 必须从 _.get(allVars, "stat_data", {}) 取根节点，再逐变量 _.get(statData, "顶层键.子键", 默认值)——MVU 底层自动把 InitVar 的顶层键挂载到 stat_data 下（InitVar 正文**不写** stat_data 根键），变量列表条目标签内为 null，由 MVU 脚本读取 stat_data 注入。\n' +
      '3. 【逐变量id填充模式统一（用户模板标准核心）】HTML 中每个需显示的变量必须有**唯一id** ↔ populateCharacterData 中用 $(\'#id\').text(value) / $(\'#id\').html(html) 对应选择器逐变量填充。禁止使用递归 renderTree！\n' +
      '   · HTML 骨架 id 命名 ↔ populateCharacterData $(\'#id\') 选择器必须字字一一对应（错一个字母=该变量永远不显示）\n' +
      '   · 禁止"不为每个变量写id，让递归renderTree自动生成"的旧模式——用户模板已废弃该做法\n' +
      '4. 【覆盖而非新增】修改 MVU 条目或状态栏脚本时，必须用相同的 comment / id 覆盖现有条目，禁止新增重复条目。\n' +
      '   · 美化状态栏正则脚本固定只有一个（id=mvu-status-bar, findRegex=/<StatusPlaceHolderImpl\\\\/>/g），写卡器自动覆盖，你不要在JSON里重复输出\n' +
      '   · MVU变量条目各自只保留一条：[InitVar]初始变量 / 变量列表 / 变量更新规则 / 变量输出格式 / 变量输出格式强调 / <状态栏>占位符提醒\n' +
      '\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🚫 纯文字状态栏禁令\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '⚠️生成状态栏时「必须」输出完整的HTML代码块，绝对不允许只用文字描述「已设计配色/已编写函数」而不给代码！\n' +
      '· 错误示范：「状态栏已设计完成…」后面没有代码块 → 状态栏无法生成\n' +
      '· 正确示范：输出完整的 ```html ... ``` 代码块 → 写卡器自动保存\n' +
      '· 如果你发现自己只写了文字没写代码块，立即补上代码块再结束本轮回复\n' +
      '\n' +
      '【MVU条目输出格式提醒（MVU Tab）】\n' +
      '· 修改或新建MVU变量条目时，使用:::操作块协议（与角色卡Tab相同），不要输出```json代码块\n' +
      '· :::操作块格式：::: upsert 条目名\\n内容\\n:::\n' +
      '· 5种动作：upsert(增改) / update(只改) / delete(删) / set(顶层字段) / rename(重命名)\n' +
      '· 修改变量结构脚本：::: upsert script:变量结构\\nzod代码\\n:::\n' +
      '· 删除脚本：::: delete script:脚本名\\n:::\n' +
      '· 变量结构、条目、状态栏三者元素相互关联——变量的路径决定了状态栏的渲染路径，修改时必须保证一致\n' +
      '· 状态栏只输出完整HTML代码块（```html 或纯```），不要用JSON包\n';

    // 4. JSON/输出格式提醒（MVU Tab版）
    const jsonReminder = '\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '⚠️【输出格式提醒（MVU Tab）】\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '· 如果用户要求设计/修改MVU变量条目（第1-7条）：使用:::操作块协议输出修改指令，不要输出```json代码块\n' +
      '  格式：::: upsert [InitVar]初始变量\\n---\\n变量名: 值\\n---\\n:::\n' +
      '  ⚠️【InitVar正文纯净铁律】::: upsert 块的 content 部分**只写 YAML 变量内容**（不包含 stat_data 根键，MVU底层自动挂载）！\n' +
      '  ❌ 绝对不要把 enabled/content/comment 这些条目配置字段写进 content！它们由写卡器自动维护！\n' +
      '  ✅ 正确：::: upsert [InitVar]初始变量\\n世界:\\n  境界: 炼气\\n:::\n' +
      '  ❌ 错误：::: upsert [InitVar]初始变量\\nenabled: false\\ncontent: |\\n  stat_data:\\n    境界: 炼气\\n:::\n' +
      '· 如果用户要求修改变量结构脚本：::: upsert script:变量结构\\nzod代码\\n:::\n' +
      '  5种动作：upsert(增改) / update(只改) / delete(删) / set(顶层字段) / rename(重命名)\n' +
      '· 如果用户要求设计状态栏（第8条）：输出一个完整的HTML文档代码块（```html 或纯```），写卡器自动提取保存为正则脚本\n' +
      '· ⚠️严禁把状态栏HTML代码放进JSON的entries数组！状态栏代码不属于世界书条目。\n' +
      '· 不要生成任何角色卡/世界书相关的JSON（name/description/entries非MVU条目）\n' +
      '· 没有需要修改的内容就输出简短的文字说明\n' +
      '· ⚠️只处理用户「最新一条」消息的指令！不要重复处理之前已经回答过的旧指令！\n';

    // 5. 组装完整提示词
    // ⚠️修复：原先系统提示词只写"详见MVU_VAR_SPEC第N条"的引用文字，从未实际拼接规范内容——
    // AI 根本看不到六大模板详细规范，被迫依赖快捷按钮把整段规范当用户消息发送（用户看到一大段文字）。
    // 现在把全部规范常量拼入后台系统提示词，用户消息只需简短指令。
    const specBlock = '\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '📖 MVU六大模板 + 8条工作流完整规范（后台注入，无需用户复述）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      MVU_SEQUENTIAL_RULE + '\n' +
      MVU_8STEPS_DETAIL + '\n' +
      MVU_VAR_SPEC + '\n\n' +
      MVU_8STEPS_COMMON_RULES + '\n' +
      MVU_MODIFY_RULE + '\n';
    let fullPrompt = mvuSystemPrompt + specBlock + cardContext + jsonReminder +
      '\n\n═══════════════════════════════════════════════════════════════════\n' +
      '📜 对话历史（MVU Tab专属，与角色卡Tab完全隔离）\n' +
      '═══════════════════════════════════════════════════════════════════\n';

    // ★ 优先使用传入的 messages 参数（callAIChat 传的是 curTabMessages=当前Tab的消息，权威），
    //   未传时再降级到 getCurrentMessages()/window.__getCurrentMessages()，避免上下文与实际发送的Tab错位
    const tabMessages = (messages && Array.isArray(messages) && messages.length > 0) ?
      messages :
      (typeof getCurrentMessages === 'function' && Array.isArray(getCurrentMessages())) ?
      getCurrentMessages() :
      (typeof window !== 'undefined' && typeof window.__getCurrentMessages === 'function' && Array.isArray(window.__getCurrentMessages())) ?
      window.__getCurrentMessages() :
      (Array.isArray(messages) ? messages : []);
    tabMessages.forEach(function(m, idx) {
      const isLast = (idx === tabMessages.length - 1);
      const roleLabel = (m.role === 'user' ? '用户' : '助手');
      // 🐛修复：助手消息中的:::操作块、```代码块、<statusblock>都是给写卡器解析用的
      // AI不需要再看这些格式指令（它只需要看到自然语言对话+角色卡当前状态）
      // 发送给AI前全部清理掉，避免AI模仿格式、浪费token、产生混淆
      let msgContent = m.content || '';
      if (m.role === 'assistant') {
        msgContent = msgContent
          // 清理:::操作块（含开始::: action key 到结束:::）
          .replace(/:::\s*(?:upsert|update|delete|set|rename)\s+[^\n\r]*[\s\S]*?(?=\n\s*:::|\n\n|$)/gi, '')
          .replace(/:::\s*(?:upsert|update|delete|set|rename)\s+[^\n\r]*/gi, '')
          .replace(/^\s*:::\s*$/gim, '')
          // 清理```代码块（JSON/CSS/HTML等所有代码块）
          .replace(/```[\s\S]*?```/g, '')
          // 清理折叠块和状态栏
          .replace(/<details[\s\S]*?<\/details>/gi, '')
          .replace(/<statusblock>[\s\S]*?<\/statusblock>/gi, '')
          // 清理多余空行
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (!msgContent || msgContent.length <= 5) msgContent = '（已应用修改）';
      }
      if (isLast && m.role === 'user') {
        fullPrompt += '>>>【当前需要处理的最新指令】<<<\n' + roleLabel + ': ' + msgContent + '\n\n';
      } else {
        fullPrompt += roleLabel + ': ' + msgContent + '\n\n';
      }
    });
    fullPrompt += '助手: ';
    fullPrompt += '（请只针对上方>>>标记的最新指令回复。严格遵守MVU Tab核心铁律：不要生成任何角色卡/世界书条目。）';

    return fullPrompt;
  }

  // ========== 工具函数：角色卡Tab专属 - 从AI返回的parsed JSON中剔除MVU相关内容 ==========
  // 这是最后一道防线：即使AI违反prompt禁令生成了MVU内容，这里也会硬性拦截过滤
  function filterMvuEntriesFromParsed(parsed) {
    /* 改进M：浅拷贝+entries数组单独拷贝（避免整卡深拷贝的性能开销） */
    const result = Object.assign({}, parsed);
    if (Array.isArray(parsed.entries)) result.entries = parsed.entries.slice();
    if (Array.isArray(parsed.regex_scripts)) result.regex_scripts = parsed.regex_scripts.slice();
    if (Array.isArray(parsed._delete)) result._delete = parsed._delete.slice();
    let strippedCount = 0;
    let regexScriptStripped = false;

    // 1. 过滤 entries 数组中的MVU条目
    if (result.entries && Array.isArray(result.entries)) {
      const beforeCount = result.entries.length;
      result.entries = result.entries.filter(function(e) {
        const c = ((e.comment || '') + ' ' + (e.content || '')).toLowerCase();
        let isMvuEntry = false;
        // comment匹配：MVU条目的精确comment
        const cmt = (e.comment || '').toLowerCase();
        if (cmt.indexOf('[initvar]') >= 0) isMvuEntry = true;
        if (_isVarListEntry(e.comment, e.content)) isMvuEntry = true;
        if (cmt.indexOf('变量更新规则') >= 0) isMvuEntry = true;
        if (cmt.indexOf('变量输出格式') >= 0 || c.indexOf('mvu_update') >= 0 || c.indexOf('<updatevariable>') >= 0) isMvuEntry = true;
        if (cmt.indexOf('状态变量输出') >= 0) isMvuEntry = true;
        if (cmt.indexOf('<状态栏>') >= 0) isMvuEntry = true;
        // content匹配：即使comment伪装正常，如果内容里有MVU关键特征也拦
        if (c.indexOf('format_message_variable::stat_data') >= 0) isMvuEntry = true;
        if (c.indexOf('[mvu_update]') >= 0) isMvuEntry = true;
        if (c.indexOf('enabled=false') >= 0 && c.indexOf('初始变量') >= 0) isMvuEntry = true;
        return !isMvuEntry;
      });
      strippedCount += (beforeCount - result.entries.length);
      if (result.entries.length === 0) delete result.entries;
    }

    // 2. 过滤 _delete 数组中的MVU条目删除请求（角色卡Tab无权操作MVU条目，删除/修改都拦）
    if (result._delete && Array.isArray(result._delete)) {
      result._delete = result._delete.filter(function(target) {
        if (typeof target !== 'string') return true; // 非字符串的保留（通常是字段名，MVU用comment字符串匹配）
        const t = target.toLowerCase();
        let isMvuTarget = false;
        if (t.indexOf('character_book.entries.') >= 0) {
          // 提取entry comment部分并检查
          const entryCmt = t.replace(/^.*character_book\.entries\./, '');
          if (entryCmt.indexOf('[initvar]') >= 0) isMvuTarget = true;
          if (entryCmt.indexOf('变量列表') >= 0) isMvuTarget = true;
          if (entryCmt.indexOf('变量更新规则') >= 0) isMvuTarget = true;
          if (entryCmt.indexOf('变量输出格式') >= 0) isMvuTarget = true;
          if (entryCmt.indexOf('状态变量输出') >= 0) isMvuTarget = true;
          if (entryCmt.indexOf('<状态栏>') >= 0) isMvuTarget = true;
        }
        // regex_scripts 中的MVU相关正则删除也拦
        if (t.indexOf('regex_scripts') >= 0 && t.toLowerCase().indexOf('status') >= 0) isMvuTarget = true;
        if (t.indexOf('regex_scripts') >= 0 && t.toLowerCase().indexOf('mvu') >= 0) isMvuTarget = true;
        return !isMvuTarget;
      });
      if (result._delete.length === 0) delete result._delete;
      // 注：删除MVU条目的操作不计入strippedCount，因为删除本身是"不做"
    }

    // 3. 过滤 entries 数组中带 _action: "delete" / "update" 的MVU条目操作
    if (result.entries && Array.isArray(result.entries)) {
      const beforeAct = result.entries.length;
      result.entries = result.entries.filter(function(e) {
        if (e._action) {
          const cmt = (e.comment || '').toLowerCase();
          if (cmt.indexOf('[initvar]') >= 0) return false;
          if (cmt.indexOf('变量列表') >= 0) return false;
          if (cmt.indexOf('变量更新规则') >= 0) return false;
          if (cmt.indexOf('变量输出格式') >= 0) return false;
          if (cmt.indexOf('状态变量输出') >= 0) return false;
          if (cmt.indexOf('<状态栏>') >= 0) return false;
        }
        return true;
      });
      strippedCount += (beforeAct - result.entries.length);
      if (result.entries.length === 0) delete result.entries;
    }

    // 4. 过滤 extensions.regex_scripts 中的MVU相关正则脚本（角色卡Tab无权修改MVU正则）
    if (result.extensions && result.extensions.regex_scripts && Array.isArray(result.extensions.regex_scripts)) {
      result.extensions.regex_scripts = result.extensions.regex_scripts.filter(function(rx) {
        const name = ((rx.scriptName || '') + ' ' + (rx.findRegex || '')).toLowerCase();
        // MVU特征：MVU/StatusPlaceHolderImpl/UpdateVariable/status正则
        let isMvuRegex = false;
        if (name.indexOf('mvu') >= 0) isMvuRegex = true;
        if (name.indexOf('statusplaceholderimpl') >= 0) isMvuRegex = true;
        if (name.indexOf('updatevariable') >= 0) isMvuRegex = true;
        if (name.indexOf('状态栏') >= 0 && (name.indexOf('美化') >= 0 || name.indexOf('status') >= 0)) isMvuRegex = true;
        if (isMvuRegex) regexScriptStripped = true;
        return !isMvuRegex;
      });
      if (result.extensions.regex_scripts.length === 0) delete result.extensions.regex_scripts;
      if (Object.keys(result.extensions).length === 0) delete result.extensions;
    }

    // 5. 直接检查顶层描述字段是否夹带MVU内容（通常不会，但防一手）
    ['description', 'system_prompt', 'first_mes', 'personality', 'scenario'].forEach(function(f) {
      if (typeof result[f] === 'string') {
        const s = result[f].toLowerCase();
        if (s.indexOf('format_message_variable') >= 0 || s.indexOf('[mvu_update]') >= 0 || s.indexOf('<updatevariable>') >= 0) {
          // 这些字段里不应该出现MVU关键宏/标记，如果有则剔除相关段或整个字段
          // 简单处理：替换掉MVU标记
          result[f] = result[f].replace(/\{\{format_message_variable::[^\}]+\}\}/gi, '')
            .replace(/\[mvu_update\][\s\S]*?(?=\n\n|$)/gi, '')
            .replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi, '');
          strippedCount += 1;
        }
      }
    });

    return {
      parsed: result,
      _mvuStrippedCount: strippedCount,
      _mvuRegexScriptStripped: regexScriptStripped
    };
  }

  // ===== 世界书条目统计（角色卡Tab 口径） =====

  // ===== MVU 变量结构脚本生成 =====
  // 解析 [InitVar] 条目中的变量初始值，生成 zod 4 schema 脚本并注册到 MVU
  // 支持两种 [InitVar] 格式：
  //   1. 标准 YAML（缩进表示层级，冒号后空格建立从属）：
  //        白娅:
  //          依存度: 35
  //          着装:
  //            上装: 深蓝色校服
  //   2. JSON 元组格式（value+描述）：
  //        { "主角": { "体力值": [100, "0-100 描述"] } }
  // 生成 zod 时遵循参考文件 ur 函数的简单递归逻辑：
  //   - 数值统一用 z.coerce.number()（防 AI 把 0 写成 "0"）
  //   - 好感度类字段加 .transform(value => _.clamp(value, 0, 100))（钳制 0~100）
  //   - 默认值用 .prefault()（MVU 扩展，缺失时自动补默认值）
  //   - 对象用 z.object({...}).prefault({ inline默认值 })，递归生成嵌套结构
  //   - 字符串用 z.string().prefault('值')，布尔用 z.boolean().prefault(值)
  /* === 顶层 YAML/InitVar 解析函数（供 generateMvuSchemaScript 和 showMvuStatusBarPreview 共用）=== */
  function parseYamlSimple(text) {
    const cleaned = (text || '').replace(/```ya?ml\s*/gi, '').replace(/```\s*$/g, '').trim();
    if (!cleaned) return null;
    const lines = cleaned.split('\n');
    const root = {};
    const stack = [{
      indent: -1,
      node: root,
      parentNode: null,
      key: null
    }];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.trim() || raw.trim().indexOf('#') === 0) continue;
      let indent = 0;
      while (indent < raw.length && (raw[indent] === ' ' || raw[indent] === '\t')) {
        indent += raw[indent] === '\t' ? 2 : 1;
      }
      const content = raw.slice(indent).trim();

      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const top = stack[stack.length - 1];

      if (content.charAt(0) === '-') {
        const itemStr = content.slice(1).trim();
        const itemVal = parseInlineObj(itemStr);
        if (top.key !== null && top.parentNode) {
          if (!Array.isArray(top.parentNode[top.key])) {
            top.parentNode[top.key] = [];
          }
          top.parentNode[top.key].push(itemVal);
          if (itemVal && typeof itemVal === 'object' && !Array.isArray(itemVal)) {
            stack.push({
              indent: indent,
              node: itemVal,
              parentNode: top.parentNode[top.key],
              key: top.parentNode[top.key].length - 1
            });
          }
        }
        continue;
      }

      const colonIdx = content.indexOf(':');
      if (colonIdx < 0) continue;
      const key = content.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
      const valStr = content.slice(colonIdx + 1).trim();

      if (valStr === '') {
        top.node[key] = {};
        stack.push({
          indent: indent,
          node: top.node[key],
          parentNode: top.node,
          key: key
        });
      } else {
        top.node[key] = parseScalar(valStr);
      }
    }

    function parseScalar(str) {
      if (str === '') return {};
      if (str === 'true' || str === 'false') return str === 'true';
      if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str);
      // ⚠️模板2修复：对象变量: {} / 数组变量: [] 必须解析为空对象/空数组，
      // 原先落入字符串分支（"{}"）导致 zod 兜底生成 z.string() 而非 record/object
      if (str === '{}') return {};
      if (str === '[]') return [];
      // 内联 JSON 对象/数组（如 物品栏: {"钥匙": 1}）：尝试解析，失败退回字符串
      if (str.charAt(0) === '{' || str.charAt(0) === '[') {
        try {
          return JSON.parse(str);
        } catch (_eJson) {}
      }
      if (str === 'null' || str === '~') return null;
      return str.replace(/^['"]|['"]$/g, '');
    }

    function parseInlineObj(str) {
      const colonIdx = str.indexOf(':');
      if (colonIdx < 0 || str.charAt(0) === '"' || str.charAt(0) === "'") {
        return parseScalar(str);
      }
      const key = str.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
      const valStr = str.slice(colonIdx + 1).trim();
      const obj = {};
      obj[key] = parseScalar(valStr);
      return obj;
    }

    return root;
  }

  function normalizeTupleValues(obj) {
    if (Array.isArray(obj)) {
      if (obj.length >= 1) return normalizeTupleValues(obj[0]);
      return null;
    }
    if (obj && typeof obj === 'object') {
      const result = {};
      Object.keys(obj).forEach(function(k) {
        const v = normalizeTupleValues(obj[k]);
        if (v !== null && v !== undefined) result[k] = v;
      });
      return result;
    }
    return obj;
  }

  function parseInitVar(text) {
    if (!text || !text.trim()) return null;
    const cleaned = (text || '').replace(/```ya?ml\s*/gi, '').replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
    if (cleaned.charAt(0) === '{') {
      try {
        const jsonObj = JSON.parse(cleaned);
        return normalizeTupleValues(stripStatDataRoot(jsonObj));
      } catch (e) { logWarn("parseInitVar", e); }
    }
    const parsed = parseYamlSimple(text);
    return stripStatDataRoot(parsed);
  }

  // ⚠️防御性过滤：剥离 AI 误写的 stat_data 根键（MVU 底层会自动挂载到 stat_data，再写一层会套娃）
  // 同时过滤 _/$ 开头的只读派生字段（由 zod prefault/transform 生成，不应出现在初始变量中）
  function stripStatDataRoot(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    // 若顶层只有一个键且为 stat_data，则下钻一层
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === 'stat_data') {
      const inner = obj.stat_data;
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        return stripStatDataRoot(inner);
      }
    }
    // 递归过滤 _/$ 开头字段（只读派生字段不应出现在初始变量）
    const filtered = {};
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.charAt(0) === '_' || k.charAt(0) === '$') continue;
      const v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        filtered[k] = stripStatDataRoot(v);
      } else {
        filtered[k] = v;
      }
    }
    return filtered;
  }

  // 规范化 InitVar 条目内容：剥离 AI 误写的 stat_data 根键
  // MVU 底层自动挂载到 stat_data，InitVar 中再写一层会导致套娃
  // ⚠️ 按需规范化：仅当检测到 stat_data 根键 / _,$ 只读字段 / 代码围栏 / JSON 格式时才重建 YAML，
  // 其余情况原样返回（避免无条件 round-trip 丢失注释、破坏字符串类型）
  // 注：本文件曾有第二个同名激进版本（无条件重建）因函数声明提升将其遮蔽，已删除合并至此
  function normalizeInitVarContent(content) {
    if (!content || !content.trim()) return generateInitVarYaml([]);
    const text = content.replace(/```ya?ml\s*/gi, '').replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
    const parsed = parseInitVar(text);
    if (!parsed || typeof parsed !== 'object') return text;
    // 检测是否真的需要重建：
    const trimmed = text.replace(/^---\s*\n/, '');
    const hasStatDataRoot = /^stat_data\s*:/.test(trimmed);
    const hadFence = /```/.test(content);
    const wasJson = trimmed.charAt(0) === '{';
    const hasDerivedFields = (function scan(o) {
      if (!o || typeof o !== 'object') return false;
      const ks = Object.keys(o);
      for (let i = 0; i < ks.length; i++) {
        if (ks[i].charAt(0) === '_' || ks[i].charAt(0) === '$') return true;
        const v = o[ks[i]];
        if (v && typeof v === 'object' && scan(v)) return true;
      }
      return false;
    })(parsed);
    if (hasStatDataRoot || hadFence || wasJson || hasDerivedFields) {
      // stripStatDataRoot 已在 parseInitVar 内调用，此处再保险调一次
      return yamlDumpSimple(stripStatDataRoot(parsed));
    }
    return content;
  }

  function generateMvuSchemaScript(initVarContent) {
    // ⚠️对齐用户规范（zod 4 + lodash 默认可用，不需要 import
    // 1. HEADER 只 import registerMvuSchema（z 和 _ 运行期全局可用，不要 import）
    // 2. FOOTER 补 registerMvuSchema(Schema) 注册
    // 3. transform 用 _.clamp（_ 默认可用
    const HEADER = "import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';\n\nexport const Schema = z.object({";

    function isAffinityLike(name) {
      return /好感|依存|信任|忠诚|友好|亲密/.test(name);
    }

    function escapeKey(key) {
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) || /^[\u4e00-\u9fff\w]+$/.test(key)) {
        return key;
      }
      return "'" + String(key).replace(/'/g, "\\'") + "'";
    }

    // 转义字符串字面量（用于 z.string().prefault('...')）
    function escStr(val) {
      return String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    // 生成值的 zod 表达式（⚠️严格规范：prefault 必须优先于 default；复合类型 prefault 时所有子字段也必须 prefault）
    function genValueZod(key, val) {
      if (val === null || val === undefined) {
        return "z.string().prefault('')";
      }
      if (typeof val === 'boolean') {
        // 布尔：z.boolean() + .prefault 默认值
        return 'z.boolean().prefault(' + String(val) + ')';
      }
      if (typeof val === 'number') {
        // ⚠️严格顺序：coerce 转换 + prefault 默认值 + transform 约束
        const base = 'z.coerce.number().prefault(' + val + ')';
        if (isAffinityLike(key)) {
          // lodash _ 默认可用，_.clamp 做范围约束（优于 min/max，超范围部分生效不整体丢弃）
          return base + '.transform(v => _.clamp(v, 0, 100))';
        }
        return base;
      }
      if (typeof val === 'string') {
        // 字符串：z.string() + .prefault 默认值
        return "z.string().prefault('" + escStr(val) + "')";
      }
      if (Array.isArray(val)) {
        // 数组：z.array(子类型) + .prefault([])；所有数组元素必为同一子类型（zod要求）
        // ⚠️修复：对象数组递归生成 z.object(...)，原先一律 z.string() 导致 schema 与数据不符、
        // 运行期校验必失败（如 物品栏: [{名: x, 数量: 1}]）
        let itemType = 'z.string()';
        if (val.length > 0) {
          if (typeof val[0] === 'number') itemType = 'z.coerce.number().prefault(0)';
          else if (typeof val[0] === 'boolean') itemType = 'z.boolean().prefault(false)';
          else if (val[0] && typeof val[0] === 'object' && !Array.isArray(val[0])) {
            itemType = 'z.object({\n' + genObjectLines(val[0], 4) + '\n    })' +
              (Object.keys(val[0]).length > 0 ? '.prefault(' + genObjectDefaultInline(val[0]) + ')' : '');
          }
        }
        return 'z.array(' + itemType + ').prefault([])';
      }
      return "z.string().prefault('')";
    }

    // 生成默认值字面量（用于 .prefault(...) 和 inline 对象默认值）
    function genDefaultLiteral(val) {
      if (val === null || val === undefined) return "''";
      if (typeof val === 'number') return String(val);
      if (typeof val === 'boolean') return String(val);
      if (typeof val === 'string') return "'" + escStr(val) + "'";
      if (Array.isArray(val)) return JSON.stringify(val);
      return genObjectDefaultInline(val);
    }

    // 生成对象的 inline 默认值
    function genObjectDefaultInline(obj) {
      const parts = Object.keys(obj).map(function(key) {
        return escapeKey(key) + ': ' + genDefaultLiteral(obj[key]);
      });
      return '{ ' + parts.join(', ') + ' }';
    }

    // 递归生成对象字段的 zod 代码行
    function genObjectLines(obj, indent) {
      const padStr = new Array(indent + 1).join(' ');
      let lines = [];
      const keys = Object.keys(obj);
      keys.forEach(function(key, i) {
        const val = obj[key];
        const comma = i < keys.length - 1 ? ',' : '';
        if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
          if (Object.keys(val).length === 0) {
            // ⚠️模板2修复：空对象（对象变量: {}）按 StageDog 规范生成动态键 record
            // （数组索引难维护，物品栏/成就等可增删键对象优先 z.record），
            // 原先生成 z.object({}).prefault({}) 属无效兜底
            lines.push(padStr + escapeKey(key) + ": z.record(z.string(), z.string())" + comma);
          } else {
            lines.push(padStr + escapeKey(key) + ': z.object({');
            lines = lines.concat(genObjectLines(val, indent + 2));
            lines.push(padStr + '}).prefault(' + genObjectDefaultInline(val) + ')' + comma);
          }
        } else {
          lines.push(padStr + escapeKey(key) + ': ' + genValueZod(key, val) + comma);
        }
      });
      return lines;
    }

    let parsed = parseInitVar(initVarContent);
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
      parsed = {
        '世界': {
          '当前日期': '2025-07-26',
          '当前时间': '17:36'
        }
      };
    }

    const bodyLines = genObjectLines(parsed, 2);
    const bodyStr = bodyLines.join('\n');
    // FOOTER：固定 $(() => { registerMvuSchema(Schema); })
    const FOOTER = "});\n\n$(() => {\n  registerMvuSchema(Schema);\n})";
    return HEADER + '\n' + bodyStr + '\n' + FOOTER;
  }

  // ===== 变量列表内容规范化 =====
  // MVU 规范的变量列表固定格式（**严格使用复数标签**，单数标签会导致酒馆助手宏不识别）：
  //   ---
  //   <status_current_variables>
  //   null
  //   </status_current_variables>
  // ⚠️注意：标签内是 `null`，不是 `{{format_message_variable::stat_data}}` 宏
  function normalizeVarListContent(content) {
    // ⚠️强制重建为固定格式（不管 AI 写了什么）：标签内为 null
    return '---\n<status_current_variables>\nnull\n</status_current_variables>';
  }

  // ⚠️已删除：_getParsedInitForEntries —— 模板5为完全固定格式（不按本卡 schema 动态生成
  // JSON Patch 示例路径），解析 InitVar 的需求已随 fixVarOutputFormatPaths 一并移除

  // ===== 🧹 规范化变量输出格式/变量输出格式强调条目 content =====
  // 这两个条目的 content 是固定 YAML 模板（用户模板5/6），AI 不应修改。
  // 如果 AI 把变量实际值/配置字段混入，强制重建为标准模板。
  function normalizeVarOutputFormatContent(comment, content) {
    const c = (comment || '').toLowerCase();
    const isFormat = c.indexOf('变量输出格式强调') >= 0 || c.indexOf('变量输出格式') >= 0;
    if (!isFormat) return content;
    // 强制使用固定模板（原封不动，不修改字段、不加注释、不替换占位符）
    if (c.indexOf('变量输出格式强调') >= 0) {
      return generateVarOutputEmphasis();
    }
    return generateVarOutputFormat();
  }

  // ===== MVU 条目内容自动生成 =====
  // 从角色名列表自动生成 initvar YAML / 变量更新规则 / 变量输出格式 / 变量输出格式强调
  // 角色 { name, ... } 数组 → 各条目的 content 字符串

  // 【写卡预设对齐】生成 [initvar] 变量初始化 YAML（br 函数）
  // ⚠️用户规范：InitVar 只含核心字段（不写 _/$ 开头的只读/派生系统变量占位）
  //  - _开头只读系统变量 → 改由 zod 脚本通过 .prefault() 自动生成，保持初始 YAML 干净
  //  - $开头派生显示字段 → 改由 zod 的 .transform(data => { ... return data }) 自动派生
  // ⚠️模板2标准顺序：角色名在前、世界在后（变量名1: 0 / 变量名2: false / 对象变量: {} / 世界: 当前日期+当前时间）
  function generateInitVarYaml(charNames) {
    // ⚠️纯净初始态：不包含 stat_data 根键；不包含 _/$ 开头字段（由 zod prefault/transform 生成）
    const lines = [];
    (charNames || []).forEach(function(name) {
      lines.push(name + ':');
      lines.push('  好感度: 0');
      lines.push('  状态: 正常');
      if (name === '主角') lines.push('  物品栏: {}');
    });
    // 如果没有主角，补一个主角最小核心字段
    if (!charNames || charNames.indexOf('主角') < 0) {
      lines.push('主角:');
      lines.push('  好感度: 0');
      lines.push('  状态: 正常');
      lines.push('  物品栏: {}');
    }
    // 世界字段固定放最后（对齐模板2）
    lines.push('世界:');
    lines.push('  当前日期: 2025-07-26');
    lines.push('  当前时间: 17:36');
    return lines.join('\n');
  }

  // 生成变量列表内容（固定格式：标签内为 null）
  function generateVarListContent() {
    return '---\n<status_current_variables>\nnull\n</status_current_variables>';
  }

  // ⚠️已删除：generateVarSegmentedPrompt（变量分段/EJS 提示模板）——
  // 不属于用户规定的 MVU 六大标准模板（结构脚本/初始变量/更新规则/变量列表/输出格式/格式强调），
  // 且 EJS 分段提示属于8条工作流之外的额外条目，按规范全部移除

  // 生成变量更新规则内容（xr 函数）
  // ⚠️严格对齐用户模板3结构：
  //   变量更新规则: → ${变量名}: → type（string省略） → ${其他合适字段仅当非常需要} → check列表
  //   check 示例即用户模板原文："根据角色对行为的反应调整，单次不超过±5"
  function generateVarUpdateRule(charNames) {
    const lines = [
      '---',
      '变量更新规则:',
      '  ${角色}.好感度:',
      '    type: number',
      '    check:',
      '      - 根据角色对行为的反应调整，单次不超过±5',
      '  ${角色}.状态:',
      '    check:',
      '      - 仅剧情本质推进时更新（正常/异常/濒死等）'
    ];
    return lines.join('\n');
  }

  // ⚠️规范化 AI 生成的变量更新规则内容，修复高频错误：
  //   1. 缺失「变量更新规则:」YAML 根节点 → 自动补全
  //   2. 路径带 stat_data. 前缀（如 stat_data.basic.identity）→ 剥离前缀
  //   3. check 写成单行字符串而非列表 → 转为列表格式
  //   4. string 类型变量的 type: string 行 → 移除（string 应省略 type 字段）
  function normalizeVarUpdateRuleContent(content) {
    if (!content || !content.trim()) return generateVarUpdateRule([]);
    let text = content.replace(/```ya?ml\s*/gi, '').replace(/```\s*$/g, '').trim();
    // 去除可能的前导 --- 分隔符（保留一个）
    text = text.replace(/^---\s*\n/, '');
    // 若缺失根节点，补全
    if (!/^变量更新规则\s*:/.test(text)) {
      // 去除可能存在的旧根名误写
      text = text.replace(/^(更新规则|变量规则|规则)\s*:\s*\n/, '');
      text = '变量更新规则:\n' + text;
    }
    // 剥离 stat_data. 前缀（行首或缩进后的路径键）
    text = text.replace(/(^|\n)(\s*)stat_data\./g, '$1$2');
    // 移除 string 变量的 type: string 行（规范要求 string 类型省略 type 字段）
    text = text.replace(/^[ \t]*type\s*:\s*string[ \t]*\r?\n?/gm, '');
    // ⚠️清理孤立键：type:string 行删除后空悬的变量名（如"主角.心情:"后面直接是下一个同级键）。
    // 判定：任意缩进的键行，若下一个非空行的缩进不深于本键 → 无子内容，属孤立键。
    // 根键"变量更新规则:"（缩进0）始终保留
    const _il = text.split('\n');
    const _iout = [];
    for (let _ii = 0; _ii < _il.length; _ii++) {
      const _cur = _il[_ii];
      const _km = _cur.match(/^(\s+)(\S[^\n]*):\s*$/); // 有缩进的键行（跳过根键/---）
      if (_km) {
        let _next = '';
        for (let _nj = _ii + 1; _nj < _il.length; _nj++) {
          if (_il[_nj].trim() !== '') {
            _next = _il[_nj];
            break;
          }
        }
        if (_next) {
          const _ni = (_next.match(/^(\s*)/))[1].length;
          if (_ni <= _km[1].length) {
            continue;
          } // 下一行不深于本键 → 孤立键，删除
        }
      }
      _iout.push(_cur);
    }
    text = _iout.join('\n');
    // 清理因删除行可能产生的多余空行（连续 3 个及以上换行压成 2 个）
    text = text.replace(/\n{3,}/g, '\n\n');
    // check 单行字符串转列表：将 "  check: 某段文字" 转为 "  check:\n      - 某段文字"
    text = text.replace(/^(\s*)check:\s*([^\n]+)$/gm, function(m, indent, desc) {
      const descTrim = desc.trim();
      if (!descTrim || descTrim.charAt(0) === '-') return m;
      const itemIndent = new Array(indent.length + 2 + 1).join(' ');
      return indent + 'check:\n' + itemIndent + '- ' + descTrim;
    });
    // 补回前导 ---
    if (!/^---/.test(text)) text = '---\n' + text;
    return text;
  }

  // （已删除：此处曾有第二个 normalizeInitVarContent 激进版本，因函数声明提升遮蔽上方按需规范化版本；
  //  行为已合并至上方定义——按需重建，避免无条件 round-trip 丢失注释/破坏类型）

  // 简易 YAML 序列化（仅支持 plain object/数组/标量，用于 InitVar 输出）
  function yamlDumpSimple(obj, indent) {
    indent = indent || 0;
    obj = safeObj(obj);
    const pad = new Array(indent + 1).join(' ');
    const lines = [];
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = obj[k];
      if (v === null || v === undefined) {
        lines.push(pad + k + ':');
      } else if (Array.isArray(v)) {
        lines.push(pad + k + ':');
        for (let j = 0; j < v.length; j++) {
          lines.push(pad + '  - ' + yamlScalar(v[j]));
        }
      } else if (typeof v === 'object') {
        lines.push(pad + k + ':');
        lines.push(yamlDumpSimple(v, indent + 2));
      } else {
        lines.push(pad + k + ': ' + yamlScalar(v));
      }
    }
    return lines.join('\n');
  }

  function yamlScalar(v) {
    if (typeof v === 'string') {
      // 含特殊字符则加引号
      if (/[:#\[\]{}&*!|>'"%@`]/.test(v) || v.trim() !== v || v === '') {
        return '"' + v.replace(/"/g, '\\"') + '"';
      }
      // ⚠️ 数字/布尔/null 样式的字符串必须加引号，否则回读时被 parseScalar 强转类型
      // （如 "007"→7、"true"→true、"2025"→2025，导致 zod 校验失败）
      if (/^(?:true|false|null|~|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(v)) {
        return '"' + v + '"';
      }
      return v;
    }
    return String(v);
  }

  // 生成变量输出格式内容
  // ⚠️完全固定英文模板，原封不动输出（不要修改字段、不要加注释、不要替换占位符、不要动态生成路径示例）
  // ⚠️使用 ${...} 占位符，路径示例均为占位符（如 ${/path/to/variable}），不根据本卡 schema 动态生成
  // ⚠️已删除 fixVarOutputFormatPaths/derivePatchExamples：模板5属"完全固定格式"，
  //   任何按本卡 schema 动态改写示例路径的行为都违反规范，AI 照抄模板即可
  function generateVarOutputFormat() {
    return ['---',
      '变量输出格式:',
      '  rule:',
      '    - you must output the update analysis and the actual update commands at once in the end of the next reply',
      '    - the update commands works like the **JSON Patch (RFC 6902)** standard, must be a valid JSON array containing operation objects, but supports the following operations instead:',
      '      - replace: replace the value of existing paths',
      '      - delta: update the value of existing number paths by a delta value',
      '      - insert: insert new items into an object or array (using `-` as array index intends appending to the end)',
      '      - remove',
      '      - move',
      '    - don\'t update field names starts with `_` as they are readonly, such as `_变量`',
      '  format: |-',
      '    <UpdateVariable>',
      '    <Analysis>$(IN ENGLISH, no more than 80 words)',
      '    - ${calculate time passed: ...}',
      '    - ${decide whether dramatic updates are allowed as it\'s in a special case or the time passed is more than usual: yes/no}',
      '    - ${analyze every variable based on its corresponding `check`, according only to current reply instead of previous plots: ...}',
      '    </Analysis>',
      '    <JSONPatch>',
      '    [',
      '      { "op": "replace", "path": "${/path/to/variable}", "value": "${new_value}" },',
      '      { "op": "delta", "path": "${/path/to/number/variable}", "value": "${positive_or_negative_delta}" },',
      '      { "op": "insert", "path": "${/path/to/object/new_key}", "value": "${new_value}" },',
      '      { "op": "insert", "path": "${/path/to/array/-}", "value": "${new_value}" },',
      '      { "op": "remove", "path": "${/path/to/object/key}" },',
      '      { "op": "remove", "path": "${/path/to/array/0}" },',
      '      { "op": "move", "from": "${/path/to/variable}", "to": "${/path/to/another/path}" },',
      '      ...',
      '    ]',
      '    </JSONPatch>',
      '    </UpdateVariable>'
    ].join('\n');
  }

  // 生成变量输出格式强调内容
  // ⚠️完全固定，原封不动输出（不要修改字段、不要加注释、不要替换占位符）
  // 默认关闭（enabled=false），AI不输出<UpdateVariable>时才启用
  function generateVarOutputEmphasis() {
    return ['---',
      '变量输出格式强调:',
      '  rule: The following must be inserted to the end of reply, and cannot be omitted',
      '  format: |-',
      '    <UpdateVariable>',
      '    ...',
      '    </UpdateVariable>'
    ].join('\n');
  }

  // ===== 从角色卡数据提取角色名列表 =====
  // 优先从 [InitVar] 条目中解析角色名，回退到角色卡描述中正则提取
  function extractCharNames(cd, rawEntries) {
    const names = [];
    // 1. 从 [InitVar] 条目解析
    if (rawEntries && rawEntries.length) {
      for (let j = 0; j < rawEntries.length; j++) {
        const entry = rawEntries[j];
        const c = (entry.comment || '').toLowerCase();
        if (c.indexOf('[initvar]') >= 0) {
          const content = entry.content || '';
          // ⚠️改进R4：用 parseInitVar 取顶层键（准确），不再用 line.trim() 逐行匹配
          // 旧逻辑的 line.trim() 会把缩进的嵌套 mapping（着装:/称号:/近期事务:）误收为角色名
          try {
            const parsed = parseInitVar(content);
            if (parsed && typeof parsed === 'object') {
              const topKeys = Object.keys(parsed);
              for (let tk = 0; tk < topKeys.length; tk++) {
                const nm = topKeys[tk];
                if (nm === '世界' || nm === '系统' || nm.charAt(0) === '_' || nm.charAt(0) === '$') continue;
                // ⚠️跳过纯英文/ASCII 顶层键（如 basic/status/secret/social/clock）：
                // 这是 schema 字段分类名，不是角色名。角色名通常含中文。
                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(nm)) continue;
                if (names.indexOf(nm) < 0) names.push(nm);
              }
            }
          } catch (_e) {
            // parseInitVar 失败时回退到逐行匹配（仅取0缩进行的顶层键）
            const lines = content.split('\n');
            for (let k = 0; k < lines.length; k++) {
              const rawLine = lines[k];
              // ⚠️R4关键修复：只匹配0缩进（行首非空白）的"键:"行，跳过缩进行的嵌套字段
              if (rawLine.charAt(0) !== ' ' && rawLine.charAt(0) !== '\t' && rawLine.charAt(0) !== '-') {
                const line = rawLine.trim();
                if (/^[^\s:#]+:\s*$/.test(line) && line.indexOf('世界:') < 0) {
                  const nm2 = line.replace(/:$/, '').trim();
                  if (nm2 && nm2 !== '世界' && names.indexOf(nm2) < 0) names.push(nm2);
                }
              }
            }
          }
          break;
        }
      }
    }
    // 2. 回退：从角色卡名称和描述中提取
    if (names.length === 0 && cd) {
      if (cd.name && !/^(未命名|新建|空)/.test(cd.name)) names.push(cd.name);
      if (cd.description) {
        const desc = cd.description;
        const nameMatches = desc.match(/[\u4e00-\u9fff]{1,6}(?=对主角|对<user>|的依存|的好感|暗恋|喜欢|依恋|钟情|心仪|在意)/g);
        if (nameMatches) {
          for (let m = 0; m < nameMatches.length; m++) {
            if (names.indexOf(nameMatches[m]) < 0) names.push(nameMatches[m]);
          }
        }
      }
    }
    // 3. 默认：如果只有主角自己
    if (names.length === 0) names.push('主角');
    return names.slice(0, 5); // 最多5个角色
  }

  // ===== Neko 美化模板（已与 MVU_BEAUTIFY_* 统一为通长长条样式）=====
  const NEKO_COMPLETE_HTML = MVU_BEAUTIFY_COMPLETE;

  const NEKO_THINKING_HTML = MVU_BEAUTIFY_THINKING;

  // ===== MVU 状态栏 HTML 生成（通用回退模板）=====
  // 仅作为 AI 未生成状态栏时的兜底：符合用户模板标准（populateCharacterData + getAllVariables + eventOn + errorCatched）
  // 运行时监听 Mvu.events.VARIABLE_INITIALIZED / VARIABLE_UPDATE_ENDED 事件驱动刷新
  // 兜底实现：由于不知道具体变量id，populateCharacterData内部会自动遍历 stat_data 所有键生成 DOM（与旧renderTree效果相同，但函数外壳符合用户模板标准）
  function generateMvuStatusBarHtml(roleNames) {
    return MVU_STATUS_BAR_TEMPLATE;
  }

  // ===== 酒馆直接写入 API 适配层（借鉴 javascript-format (7).js）=====
  // 在 iframe 内通过 window.parent 访问酒馆原生 API，实现角色卡直接写入

  // 获取酒馆 API 函数（兼容 iframe 上下文）
  // 查找顺序（遵循 tavern_helper_template @types/function/index.d.ts）：
  //   1. window[name]                     —— 全局导出（最老版 ST 助手）
  //   2. window.parent[name]              —— iframe 内访问父窗口的全局
  //   3. window.TavernHelper[name]        —— 新版：所有函数统一挂在 TavernHelper 命名空间下
  //   4. window.parent.TavernHelper[name] —— iframe 内访问父窗口的 TavernHelper
  //   5. SillyTavern.getContext()[name]   —— 新版 ST 稳定接口（@types/iframe/exported.sillytavern.d.ts）
  //   6. 全局 getContext()[name] / window.parent.getContext()[name]
  function _tavernFn(name) {
    try {
      if (typeof window[name] === 'function') return window[name];
      if (window.parent && typeof window.parent[name] === 'function') return window.parent[name];
      if (typeof window.TavernHelper !== 'undefined' && window.TavernHelper && typeof window.TavernHelper[name] === 'function') return window.TavernHelper[name];
      if (window.parent && typeof window.parent.TavernHelper !== 'undefined' && window.parent.TavernHelper && typeof window.parent.TavernHelper[name] === 'function') return window.parent.TavernHelper[name];
    } catch (e) { logWarn("_tavernFn", e); }
    // 兼容新版 SillyTavern（1.12+）：部分函数从 window 全局移到 SillyTavern.getContext() 上下文对象
    try {
      const _st = _tavern();
      if (_st && typeof _st.getContext === 'function') {
        const _ctx = _st.getContext();
        if (_ctx && typeof _ctx[name] === 'function') return _ctx[name];
      }
      if (typeof getContext === 'function') {
        const _ctx2 = getContext();
        if (_ctx2 && typeof _ctx2[name] === 'function') return _ctx2[name];
      }
      if (window.parent && typeof window.parent.getContext === 'function') {
        const _ctx3 = window.parent.getContext();
        if (_ctx3 && typeof _ctx3[name] === 'function') return _ctx3[name];
      }
    } catch (e2) { logWarn("_tavernFn", e2); }
    return null;
  }

  // 获取 SillyTavern 对象
  function _tavern() {
    try {
      if (typeof SillyTavern !== 'undefined') return SillyTavern;
      if (window.parent && window.parent.SillyTavern) return window.parent.SillyTavern;
    } catch (e) { logWarn("_tavern", e); }
    return null;
  }

  // 生成唯一 ID
  function _genId(prefix) {
    return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  // 判断是否为中止错误
  function _isAbortError(err) {
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    if (err instanceof Error && err.name === 'AbortError') return true;
    const msg = err instanceof Error ? err.message : String(err);
    return /(?:operation was aborted|request was aborted|\baborted\b)/iu.test(msg);
  }

  // 带重试的异步操作（应对酒馆中止）
  async function _tavernRetry(label, fn) {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (!_isAbortError(e)) throw e;
        lastErr = e;
        console.warn('[时之写卡器] ' + label + '被中止，准备重试（' + attempt + '/3）', e);
        if (attempt < 3) await new Promise(function(r) {
          setTimeout(r, 350 * attempt);
        });
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(label + '连续被中止，请确认页面没有刷新或断开后重试（原始错误：' + msg + '）');
  }

  // 刷新角色列表
  async function _refreshCharacterList() {
    const st = _tavern();
    if (st && typeof st.getCharacters === 'function') {
      await _tavernRetry('刷新角色列表', function() {
        return st.getCharacters();
      });
    }
  }

  // 验证角色卡名称
  function _tavernValidateName(name) {
    const e = (name || '').trim();
    if (!e) throw new Error('角色卡名称不能为空');
    if (e === 'current') throw new Error('角色卡名称不能是 current');
    const lower = e.replace(/\s+/g, ' ').toLowerCase();
    if (lower === 'sillytavern system') throw new Error('SillyTavern System 是系统占位角色，请填写新的角色卡名称');
    return e;
  }

  // 确保角色卡存在并补全 alternate_greetings 兼容字段（Wr）
  async function _tavernEnsureCharacter(name) {
    const validated = _tavernValidateName(name);
    const st = _tavern();
    if (!st || !st.characters) throw new Error('无法访问酒馆角色列表');
    let idx = -1;
    if (typeof st.characters.findIndex === 'function') {
      idx = st.characters.findIndex(function(c) {
        return c.name === validated;
      });
    } else {
      for (let i = 0; i < st.characters.length; i++) {
        if (st.characters[i].name === validated) {
          idx = i;
          break;
        }
      }
    }
    if (idx < 0) {
      await _refreshCharacterList();
      if (typeof st.characters.findIndex === 'function') {
        idx = st.characters.findIndex(function(c) {
          return c.name === validated;
        });
      } else {
        for (let j = 0; j < st.characters.length; j++) {
          if (st.characters[j].name === validated) {
            idx = j;
            break;
          }
        }
      }
    }
    if (idx < 0) throw new Error('角色卡不存在：' + validated);
    let char = st.characters[idx];
    if (char.data && Array.isArray(char.data.alternate_greetings)) return;
    if (typeof st.unshallowCharacter === 'function') {
      await _tavernRetry('读取角色卡详情', function() {
        return st.unshallowCharacter(String(idx));
      });
    }
    if (typeof st.characters.findIndex === 'function') {
      idx = st.characters.findIndex(function(c) {
        return c.name === validated;
      });
    }
    if (idx < 0) throw new Error('读取详情后角色卡从列表中消失：' + validated);
    char = st.characters[idx];
    if (!char.data) char.data = {};
    const altG = char.data.alternate_greetings;
    if (Array.isArray(altG)) return;
    let greetings = (typeof altG === 'string' && altG.trim()) ? [altG] : [];
    if (greetings.length === 0) greetings = ['\u200b'];
    char.data.alternate_greetings = greetings;
    const firstMes = char.first_mes || (char.data && char.data.first_mes) || '';
    const replaceCharacter = _tavernFn('replaceCharacter');
    if (replaceCharacter) {
      await _tavernRetry('补全角色卡兼容字段', function() {
        return replaceCharacter(validated, {
          first_messages: [firstMes].concat(greetings)
        }, {
          render: 'none'
        });
      });
    }
    const updated = st.characters.find(function(c) {
      return c.name === validated;
    });
    if (updated) {
      if (!updated.data) updated.data = {};
      if (!Array.isArray(updated.data.alternate_greetings)) updated.data.alternate_greetings = greetings;
    }
  }

  // 创建或获取角色卡（Nr）
  async function _tavernCreateOrGet(name) {
    const validated = _tavernValidateName(name);
    const getCharacterNames = _tavernFn('getCharacterNames');
    let names = getCharacterNames ? getCharacterNames() : [];
    let created = false;

    if (names.indexOf(validated) >= 0) {
      await _tavernEnsureCharacter(validated);
    } else {
      const createCharacter = _tavernFn('createCharacter');
      if (!createCharacter) {
        // 兜底：酒馆 JS API 不支持 createCharacter（新版 ST 或 iframe 隔离），
        // 直接用 REST API POST /api/characters/create 创建空角色卡
        await _tavernCreateCharacterViaFetch(validated);
        created = true;
        await _refreshCharacterList();
        await _tavernEnsureCharacter(validated);
        return {
          name: validated,
          created: created
        };
      }
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await createCharacter(validated, {
            first_messages: ['', '\u200b']
          });
          created = true;
          break;
        } catch (e) {
          if (!_isAbortError(e)) throw e;
          lastErr = e;
          console.warn('[时之写卡器] 创建角色卡被中止，正在确认（' + attempt + '/3）', e);
          await new Promise(function(r) {
            setTimeout(r, 350 * attempt);
          });
          try {
            await _refreshCharacterList();
          } catch (_) {}
          names = getCharacterNames ? getCharacterNames() : [];
          if (names.indexOf(validated) >= 0) {
            break;
          }
        }
      }
      await _tavernEnsureCharacter(validated);
      if (!created) {
        const getCharacter = _tavernFn('getCharacter');
        if (getCharacter) {
          try {
            await getCharacter(validated);
          } catch (e) {
            throw new Error('创建角色卡失败：' + validated);
          }
        }
      }
    }
    return {
      name: validated,
      created: created
    };
  }

  // 兜底：通过 REST API 创建角色卡（不依赖 SillyTavern JS createCharacter 函数）
  // 直接 POST /api/characters/create，兼容所有 ST 版本
  async function _tavernCreateCharacterViaFetch(name) {
    const formData = new FormData();
    formData.append('name', name);
    // 最小化字段：只需 name，其余字段后续由 _tavernWriteCharacterData 填充
    formData.append('description', '');
    formData.append('first_mes', '');
    formData.append('mes_example', '');
    formData.append('creator', '');
    formData.append('creator_notes', '');
    formData.append('character_version', '');
    formData.append('system_prompt', '');
    formData.append('tags', '[]');
    formData.append('alternate_greetings', '[]');
    const resp = await fetch('/api/characters/create', {
      method: 'POST',
      body: formData
    });
    if (!resp.ok) {
      let txt = '';
      try {
        txt = await resp.text();
      } catch (_) {}
      throw new Error('REST API 创建角色卡失败 (HTTP ' + resp.status + '): ' + (txt || resp.statusText));
    }
    let data = null;
    try {
      data = await resp.json();
    } catch (_) {}
    // 创建后刷新角色列表，确保后续 _tavernEnsureCharacter 能找到它
    await _refreshCharacterList();
    return data;
  }

  // 写入开场白（Yr）
  async function _tavernWriteFirstMes(name, firstMes) {
    const validated = _tavernValidateName(name);
    const content = (firstMes || '').trim();
    if (!content) throw new Error('开场白不能为空');
    await _tavernEnsureCharacter(validated);
    const updateCharacterWith = _tavernFn('updateCharacterWith');
    if (!updateCharacterWith) throw new Error('酒馆不支持 updateCharacterWith API');
    await updateCharacterWith(validated, function(charData) {
      const msgs = charData.first_messages || [];
      charData.first_messages = [content].concat(msgs.slice(1));
      return charData;
    });
  }

  // 写入角色卡基础字段（对齐 tavern_helper Character 规范）
  async function _tavernWriteCharacterData(name, data) {
    const validated = _tavernValidateName(name);
    await _tavernEnsureCharacter(validated);
    const updateCharacterWith = _tavernFn('updateCharacterWith');
    if (!updateCharacterWith) throw new Error('酒馆不支持 updateCharacterWith API');
    await updateCharacterWith(validated, function(charData) {
      // ===== 对齐 tavern_helper Character 规范 =====
      // 规范顶层字段：description / creator / creator_notes / version / first_messages
      // 非规范字段 → extensions（extensions 支持 [other: string]: any）
      // V3 data.* 兼容写入（SillyTavern 提示词构建器从 data.* 读取）

      // ===== 前置规范化：酒馆读回来的 depth_prompt/data.depth_prompt 可能是 JSON 字符串
      //   （tavern 在某些版本会把 depth_prompt 序列化为字符串存储），
      //   如果不先反序列化，后续任意赋值 .depth/.prompt 都会抛 "Cannot create property 'depth' on string"
      if (!charData.extensions) charData.extensions = {};
      charData.extensions.depth_prompt = normalizeDepthPrompt(charData.extensions.depth_prompt, 4);
      if (!charData.data) charData.data = {};
      charData.data.depth_prompt = normalizeDepthPrompt(charData.data.depth_prompt, 4);

      // --- 规范顶层字段 ---
      if (data.description !== undefined) {
        charData.description = data.description;
      }
      if (data.creator !== undefined) {
        charData.creator = data.creator;
      }
      if (data.creator_notes !== undefined) {
        charData.creator_notes = data.creator_notes;
      }
      // character_version → version（规范字段名为 version）
      if (data.character_version !== undefined) {
        charData.version = data.character_version;
      }
      // alternate_greetings → first_messages（规范用 first_messages: string[] 统一承载首条+备选）
      if (data.alternate_greetings !== undefined && Array.isArray(data.alternate_greetings)) {
        if (!Array.isArray(charData.first_messages)) charData.first_messages = [''];
        // 保留 [0]（首条由 _tavernWriteFirstMes 写入），[1:] 替换为备选开场白
        charData.first_messages = [charData.first_messages[0] || ''].concat(data.alternate_greetings);
      }

      // --- 非规范字段 → extensions ---
      if (data.system_prompt !== undefined) {
        charData.extensions.system_prompt = data.system_prompt;
      }
      if (data.personality !== undefined) {
        charData.extensions.personality = data.personality;
      }
      if (data.scenario !== undefined) {
        charData.extensions.scenario = data.scenario;
      }
      if (data.depth_prompt !== undefined) {
        // 防御：depth_prompt 必须是对象；JSON 字符串 / 纯 prompt 字符串统一规范化
        const _dp = normalizeDepthPrompt(data.depth_prompt, 4);
        charData.extensions.depth_prompt = _dp;
      }

      // --- V3 兼容：同时写入 data.* 供 SillyTavern 提示词构建器读取 ---
      if (!charData.data) charData.data = {};
      if (data.description !== undefined) charData.data.description = data.description;
      if (data.personality !== undefined) charData.data.personality = data.personality;
      if (data.scenario !== undefined) charData.data.scenario = data.scenario;
      if (data.system_prompt !== undefined) charData.data.system_prompt = data.system_prompt;
      if (data.creator_notes !== undefined) charData.data.creator_notes = data.creator_notes;
      if (data.creator !== undefined) charData.data.creator = data.creator;
      if (data.character_version !== undefined) charData.data.character_version = data.character_version;
      if (data.alternate_greetings !== undefined && Array.isArray(data.alternate_greetings)) {
        charData.data.alternate_greetings = data.alternate_greetings;
      }
      if (data.depth_prompt !== undefined) {
        const _dp2 = normalizeDepthPrompt(data.depth_prompt, 4);
        charData.data.depth_prompt = _dp2;
      }

      // --- 关联世界书（保持原样）---
      if (data.world !== undefined && data.world) {
        charData.data.world = data.world;
        charData.world = data.world;
      }
      return charData;
    });
  }

  // 规范化脚本对象（Hr）— 对齐 tavern_helper Script 规范
  function _normalizeScript(s) {
    s = s || {};
    return {
      type: s.type || 'script',
      enabled: true,
      name: s.name,
      id: s.id || _genId('qz-character-script'),
      content: s.content,
      info: s.info || '',
      button: {
        enabled: (s.button && s.button.enabled !== undefined) ? s.button.enabled : true,
        buttons: (s.button && s.button.buttons) || []
      },
      data: s.data || {},
      export_with: s.export_with || {
        data: true,
        button: true
      }
    };
  }

  // 按 id 或 name 去重后更新脚本（Qr）
  function _upsertScript(scripts, newScript) {
    const arr = scripts.slice();
    let idx = -1;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (s.type !== 'script' && !s.name) continue;
      const sName = String(s.name || s.scriptName || '');
      if (s.id === newScript.id || sName.toLowerCase() === newScript.name.toLowerCase()) {
        idx = i;
        break;
      }
    }
    const merged = Object.assign({}, arr[idx] || {}, newScript, {
      name: newScript.name,
      content: newScript.content,
      enabled: true
    });
    if (idx >= 0) {
      arr[idx] = _normalizeScript(merged);
    } else {
      arr.push(_normalizeScript(newScript));
    }
    return arr;
  }

  // 写入 tavern_helper 脚本（Rr）
  async function _tavernWriteScript(name, script) {
    const validated = _tavernValidateName(name);
    await _tavernEnsureCharacter(validated);
    const updateCharacterWith = _tavernFn('updateCharacterWith');
    if (!updateCharacterWith) throw new Error('酒馆不支持 updateCharacterWith API');
    const normalized = _normalizeScript(script);
    await updateCharacterWith(validated, function(charData) {
      if (!charData.extensions) charData.extensions = {
        regex_scripts: [],
        tavern_helper: {
          scripts: [],
          variables: {}
        }
      };
      if (!charData.extensions.regex_scripts) charData.extensions.regex_scripts = [];
      if (!charData.extensions.tavern_helper) charData.extensions.tavern_helper = {
        scripts: [],
        variables: {}
      };
      if (!charData.extensions.tavern_helper.scripts) charData.extensions.tavern_helper.scripts = [];
      if (!charData.extensions.tavern_helper.variables) charData.extensions.tavern_helper.variables = {};
      charData.extensions.tavern_helper.scripts = _upsertScript(charData.extensions.tavern_helper.scripts, normalized);
      return charData;
    });
    const getCurrentCharacterName = _tavernFn('getCurrentCharacterName');
    const updateScriptTreesWith = _tavernFn('updateScriptTreesWith');
    if (getCurrentCharacterName && updateScriptTreesWith && getCurrentCharacterName() === validated) {
      await updateScriptTreesWith(function(scripts) {
        return _upsertScript(scripts, normalized);
      }, {
        type: 'character'
      });
    }
  }

  // 写入 MVU schema 脚本（Dr）
  async function _tavernWriteMvuSchema(name, schemaContent) {
    await _tavernWriteScript(name, {
      name: '变量结构',
      id: _genId('qz-mvu-schema'),
      content: schemaContent,
      info: '自动生成的 MVU 变量结构脚本。',
      button: {
        enabled: true,
        buttons: []
      },
      data: {}
    });
  }

  // 写入 MVU 运行时 bundle.js 脚本
  async function _tavernWriteMvuRuntime(name) {
    await _tavernWriteScript(name, {
      type: 'script',
      enabled: true,
      name: 'MVU',
      id: '961f366d-e403-45c2-8155-3d14ec86de53',
      content: "import'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';",
      info: '',
      button: {
        enabled: true,
        buttons: [{
            name: '重新处理变量',
            visible: false
          },
          {
            name: '重新读取初始变量',
            visible: false
          },
          {
            name: '快照楼层',
            visible: false
          },
          {
            name: '重演楼层',
            visible: false
          },
          {
            name: '重试额外模型解析',
            visible: false
          },
          {
            name: '清除旧楼层变量',
            visible: false
          }
        ]
      },
      data: {}
    });
  }

  // 用代码块包裹 HTML
  function _wrapHtml(html) {
    const trimmed = safeStr(html).trim();
    if (!trimmed) return '';
    if (/^```/.test(trimmed)) return trimmed;
    return '```html\n' + trimmed + '\n```';
  }

  // 转换内部正则格式到 SillyTavern 正则脚本格式（ri）— 对齐 tavern_helper TavernRegex 规范
  function _convertRegexScript(s) {
    s = s || {};
    const placement = s.placement || [];
    return {
      id: s.id,
      script_name: s.scriptName,
      enabled: (s.enabled !== undefined ? s.enabled : (s.disabled !== undefined ? !s.disabled : true)),
      find_regex: s.findRegex,
      replace_string: s.replaceString,
      trim_strings: Array.isArray(s.trimStrings) ? s.trimStrings : (Array.isArray(s.trim_strings) ? s.trim_strings : []),
      source: {
        user_input: placement.indexOf(1) >= 0,
        ai_output: placement.indexOf(2) >= 0,
        slash_command: placement.indexOf(3) >= 0,
        world_info: placement.indexOf(4) >= 0,
        reasoning: placement.indexOf(5) >= 0
      },
      destination: {
        display: s.markdownOnly === true,
        prompt: s.promptOnly === true
      },
      run_on_edit: s.runOnEdit !== undefined ? s.runOnEdit : false,
      min_depth: s.minDepth !== undefined ? s.minDepth : null,
      max_depth: s.maxDepth !== undefined ? s.maxDepth : null
    };
  }

  // 写入正则脚本（含状态栏 HTML）（oi - 借鉴 javascript-format (7).js）
  async function _tavernWriteRegexScripts(name, statusBarHtml) {
    const validated = _tavernValidateName(name);

    const scripts = [
      // 1. 仅格式思维链 - 从提示词移除 <Analysis> 段
      _convertRegexScript({
        id: 'd668c8a6-fa6a-444d-a5d6-8f68b73a3c36',
        scriptName: '仅格式思维链',
        findRegex: '/<Analysis>[\\s\\S]+?<\\/Analysis>/gm',
        replaceString: '',
        trimStrings: [],
        placement: [2],
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: true,
        minDepth: null,
        maxDepth: null
      }),
      // 2. 只发送最新2楼的变量更新
      _convertRegexScript({
        id: '5bb4b588-23ca-4564-8df5-882104eff764',
        scriptName: '只发送最新2楼的变量更新',
        findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm',
        replaceString: '',
        trimStrings: [],
        placement: [2],
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: true,
        minDepth: 4,
        maxDepth: null
      }),
      // 3. [美化]变量完成
      _convertRegexScript({
        id: '6fb572ae-a9ea-436d-9779-ad100f1ff7f5',
        scriptName: '[美化]变量完成',
        findRegex: '/<UpdateVariable(?:variable)?>\\s*([\\s\\S]*?)\\s*<\\/UpdateVariable(?:variable)?>/gsi',
        replaceString: NEKO_COMPLETE_HTML,
        trimStrings: [],
        placement: [2],
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: false,
        minDepth: null,
        maxDepth: null
      }),
      // 4. [美化]变量更新中
      _convertRegexScript({
        id: 'bf1b7441-5cf1-426d-bd6c-911332be9923',
        scriptName: '[美化]变量更新中',
        findRegex: '/<UpdateVariable(?:variable)?>(?!.*<\\/UpdateVariable(?:variable)?>)\\s*(.*)\\s*$/gsi',
        replaceString: NEKO_THINKING_HTML,
        trimStrings: [],
        placement: [2],
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: false,
        minDepth: null,
        maxDepth: null
      }),
      // ==== 【月相思维链·去杂标签 #1】移除 <thinking> / <think> 内部标签（promptOnly，不影响显示）====
      // 月相1-4已删除
      // ==== 【月相思维链·去杂标签 #2】移除 [果农冒泡]/[NSFW判定]/[人物逻辑]/[基调锚定] 等中括号思考标签 ====
      // 月相2已删除
      // ==== 【月相思维链·去杂标签 #3】移除 "果农人格加载" / "time_format" / "time_format:" 等元信息段 ====
      // 月相3已删除
      // ==== 【月相思维链·去杂标签 #4】移除 <!-- End of The ECoT -->、<content>包裹 等HTML注释/标签 ====
      // 月相4已删除
      // 5. 隐藏状态栏标记（display:false, prompt:true）
      {
        id: _genId('qz-card-status-hide'),
        script_name: '隐藏状态栏标记',
        enabled: true,
        find_regex: '/<StatusPlaceHolderImpl\\/>/g',
        replace_string: '',
        trim_strings: [],
        source: {
          user_input: false,
          ai_output: true,
          slash_command: false,
          world_info: false,
          reasoning: false
        },
        destination: {
          display: false,
          prompt: true
        },
        run_on_edit: true,
        min_depth: null,
        max_depth: null
      },
      // 6. MVU状态栏（display:true, prompt:false）
      {
        id: _genId('qz-card-status'),
        script_name: 'MVU状态栏',
        enabled: true,
        find_regex: '/<StatusPlaceHolderImpl\\/>/g',
        replace_string: _wrapHtml(statusBarHtml),
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
      }
    ];

    // 按 script_name 去重旧脚本后追加新脚本（同时清理遗留的无名 StatusPlaceHolderImpl 正则）
    const nameSet = {};
    scripts.forEach(function(s) {
      nameSet[s.script_name] = true;
    });
    const newFindRegexes = {};
    scripts.forEach(function(s) {
      const fr = String(s.find_regex || s.findRegex || '');
      if (fr.indexOf('StatusPlaceHolderImpl') >= 0) newFindRegexes['StatusPlaceHolderImpl'] = true;
    });

    const updateCharacterWith = _tavernFn('updateCharacterWith');
    if (!updateCharacterWith) throw new Error('酒馆不支持 updateCharacterWith API');
    await _tavernEnsureCharacter(validated);
    await updateCharacterWith(validated, function(charData) {
      if (!charData.extensions) charData.extensions = {
        regex_scripts: [],
        tavern_helper: {
          scripts: [],
          variables: {}
        }
      };
      const existing = charData.extensions.regex_scripts || [];
      const filtered = existing.filter(function(r) {
        if (nameSet[r.script_name]) return false; // 按 script_name 去重
        // 额外清理：遗留的无名 StatusPlaceHolderImpl 正则
        if (!r.script_name) {
          const fr = String(r.find_regex || r.findRegex || '');
          const id = String(r.id || '');
          if (newFindRegexes['StatusPlaceHolderImpl'] && fr.indexOf('StatusPlaceHolderImpl') >= 0) return false;
          if (newFindRegexes['StatusPlaceHolderImpl'] && (id.indexOf('mvu-status') >= 0 || id.indexOf('regex-mvu-status') >= 0)) return false;
        }
        return true;
      });
      charData.extensions.regex_scripts = filtered.concat(scripts);
      return charData;
    });

    // 同步当前角色的正则树
    const getCurrentCharacterName = _tavernFn('getCurrentCharacterName');
    const updateTavernRegexesWith = _tavernFn('updateTavernRegexesWith');
    if (getCurrentCharacterName && updateTavernRegexesWith && getCurrentCharacterName() === validated) {
      await updateTavernRegexesWith(function(existing) {
        const filtered = existing.filter(function(r) {
          if (nameSet[r.script_name]) return false;
          if (!r.script_name) {
            const fr = String(r.find_regex || r.findRegex || '');
            const id = String(r.id || '');
            if (newFindRegexes['StatusPlaceHolderImpl'] && fr.indexOf('StatusPlaceHolderImpl') >= 0) return false;
            if (newFindRegexes['StatusPlaceHolderImpl'] && (id.indexOf('mvu-status') >= 0 || id.indexOf('regex-mvu-status') >= 0)) return false;
          }
          return true;
        });
        return filtered.concat(scripts);
      }, {
        type: 'character'
      });
    }
  }

  // 写入世界书条目（si/Ai/ii - 借鉴 javascript-format (7).js）
  // ===== 修复Bug2：把 v2 角色卡条目格式转换为酒馆助手 WorldbookEntry 新格式 =====
  // 旧格式用 comment/constant/selective/position(字符串)/extensions；
  // 酒馆助手 API(createWorldbookEntries 等)用 name/strategy/position(对象)/extra，
  // 直接传旧格式会导致条目"没有名字"且激活策略/位置参数全部丢失。
  function _convertToWorldbookEntry(e, i, sourceTag) {
    const comment = e.comment || e.name || e.title || ('条目' + (i + 1));
    const ext = e.extensions || {};
    // position：优先 extensions.position(数字)，其次顶层 position，默认 4(at_depth)
    const posRaw = (ext.position !== undefined ? ext.position : (e.position !== undefined ? e.position : 4));
    // ⚠️完善：完整字符串枚举→数字（before_char/after_char/before_an/after_an/@深度/EMTop/EMBottom/outlet），
    // 修复旧实现只认 before_char/after_char、其余全部落到 4 导致位置错乱的问题
    const posNum = _posToNum(posRaw);
    // ST position: 0=before_char, 1=after_char, 2=before_example, 3=after_example, 4=at_depth(作者注释位)
    const posType = (posNum === 0) ? 'before_character_definition' :
      (posNum === 1) ? 'after_character_definition' :
      (posNum === 2) ? 'before_example_messages' :
      (posNum === 3) ? 'after_example_messages' :
      'at_depth';
    const roleNum = (ext.role !== undefined ? ext.role : 0);
    const posRole = (roleNum === 1) ? 'user' : (roleNum === 2 ? 'assistant' : 'system');
    const posDepth = (ext.depth !== undefined ? ext.depth : 4);
    const order = (e.insertion_order !== undefined ? e.insertion_order : (ext.order || 100));
    // 激活策略：constant=true→蓝灯; 否则 selective=true→绿灯; 否则默认 constant
    const isConst = (e.constant !== undefined ? e.constant : false);
    const isSel = (e.selective !== undefined ? e.selective : true);
    const stratType = isConst ? 'constant' : (isSel ? 'selective' : 'constant');
    const keys = Array.isArray(e.keys) ? e.keys.filter(function(k) {
      return typeof k === 'string' && k;
    }) : [];
    const secKeys = Array.isArray(e.secondary_keys) ? e.secondary_keys : [];
    const selLogic = (ext.selectiveLogic === 1 ? 'and_all' : (ext.selectiveLogic === 2 ? 'not_all' : (ext.selectiveLogic === 3 ? 'not_any' : 'and_any')));
    const useProb = (ext.useProbability !== undefined ? ext.useProbability : (ext.use_probability !== undefined ? ext.use_probability : true));
    const probability = useProb ? (ext.probability !== undefined ? ext.probability : 100) : 100;
    return {
      name: comment,
      content: e.content || '',
      enabled: (e.enabled !== undefined ? e.enabled : true),
      strategy: {
        type: stratType,
        keys: keys,
        keys_secondary: {
          logic: selLogic,
          keys: secKeys
        },
        scan_depth: (ext.scan_depth !== undefined && ext.scan_depth !== null) ? ext.scan_depth : 'same_as_global'
      },
      position: {
        type: posType,
        role: posRole,
        depth: posDepth,
        order: order
      },
      probability: probability,
      recursion: {
        prevent_incoming: !!(ext.prevent_recursion),
        prevent_outgoing: !!(ext.exclude_recursion),
        delay_until: (ext.delay_until_recursion || null)
      },
      effect: {
        sticky: (ext.sticky || null),
        cooldown: (ext.cooldown || null),
        delay: (ext.delay || null)
      },
      extra: {
        source: sourceTag
      }
    };
  }

  // ===== 写入世界书前的强 sanitize：防止酒馆内部出现 Cannot create property 'depth' on string =====
  // 必须保证：每一条是纯对象；position/strategy/recursion/effect 一定是对象；depth/order 是 number；
  //           任何字符串/数字/null/数组 形式的旧条目都会被重建，不把需要升级的字符串形式 position 交给酒馆。
  function _sanitizeWorldbookEntriesForWrite(list) {
    if (!Array.isArray(list)) return [];
    const safeNumber = function(v, def) {
      const n = Number(v);
      return (isFinite(n) && !isNaN(n)) ? n : def;
    };
    const safeKeys = function(k) {
      if (!Array.isArray(k)) return [];
      return k.filter(function(x) {
        return typeof x === 'string' && x;
      });
    };
    return list
      .map(function(e, i, arr) {
        // 防御：entries 里混了纯字符串/数字（典型：depth_prompt.prompt 被误 push）→ 包装成匿名条目避免后面对字符串写 .depth
        if (e == null) return null;
        // 拦截 regex: 脚本配置误写为世界书条目
        const _eCmt = String((e && (e.comment || e.name)) || '');
        if (/^regex[:：]/i.test(_eCmt)) {
          console.warn('[sanitize] 写入前拦截regex脚本配置条目:', _eCmt.slice(0, 30));
          return null;
        }
        if (typeof e === 'string') {
          const firstL = e.split('\n')[0].trim().slice(0, 40) || ('误写字符串条目' + (i + 1));
          console.warn('[sanitize] entries里发现字符串元素，已包装为匿名条目:', firstL.slice(0, 20));
          return {
            name: firstL,
            comment: firstL,
            content: e
          };
        }
        if (typeof e === 'number' || typeof e === 'boolean') {
          return {
            name: '误写标量条目' + (i + 1),
            comment: '误写标量条目' + (i + 1),
            content: String(e)
          };
        }
        if (Array.isArray(e)) return null;
        // 保证有 comment（写卡器用 comment 驱动一切；酒馆旧数据只有 name 时用 name 回退）
        if (!e.comment && e.name) e = Object.assign({}, e, {
          comment: e.name
        });
        if (!e.comment) e = Object.assign({}, e, {
          comment: e.name || String(e.content || '').split('\n')[0].trim().slice(0, 40) || ('条目' + (i + 1))
        });
        return e;
      })
      .filter(function(e) {
        return e && typeof e === 'object';
      })
      .map(function(e, i, arr) {
        const pos = (e.position && typeof e.position === 'object') ? e.position : {};
        const strat = (e.strategy && typeof e.strategy === 'object') ? e.strategy : {};
        const ks = (strat.keys_secondary && typeof strat.keys_secondary === 'object') ? strat.keys_secondary : {};
        const rec = (e.recursion && typeof e.recursion === 'object') ? e.recursion : {};
        const eff = (e.effect && typeof e.effect === 'object') ? e.effect : {};
        // ===== ✅新增：写入酒馆前对空 keys 条目最后一次兜底派生（写酒馆的永久防线）=====
        let rawKeys = (Array.isArray(strat.keys) && strat.keys.length > 0) ? strat.keys :
          (Array.isArray(e.keys) && e.keys.length > 0 ? e.keys : null);
        if (!rawKeys || rawKeys.length === 0) {
          const isConst = !!(e.constant || (strat.type === 'constant'));
          if (!isConst) {
            try {
              const cmForDerive = e.comment || e.name || '';
              const derTmpl = (typeof getEntryTemplate === 'function') ? getEntryTemplate(cmForDerive) : null;
              if (!(derTmpl && derTmpl.constant)) {
                const derived = (typeof _deriveEntryKeys === 'function') ?
                  _deriveEntryKeys(cmForDerive, derTmpl, e.content || '') :
                  [];
                if (derived && derived.length > 0) rawKeys = derived;
              }
            } catch (eDer) { logWarn("_sanitizeWorldbookEntriesForWrite", eDer); }
          }
        }
        const rawSecondaryKeys = (Array.isArray(ks.keys) && ks.keys.length > 0) ? ks.keys :
          (Array.isArray(e.secondary_keys) && e.secondary_keys.length > 0 ? e.secondary_keys : []);
        // position 类型（优先取新字段，否则回退 Tavern 旧常量）
        const posType = typeof pos.type === 'string' ? pos.type :
          (e.position === 'before_char' || e.position === 0 || pos.type === 0 ? 'before_character_definition' :
            (e.position === 'after_char' || e.position === 1 ? 'after_character_definition' :
              (e.position === 'before_an' || e.position === 2 ? 'before_example_messages' :
                (e.position === 'after_an' || e.position === 3 ? 'after_example_messages' :
                  'at_depth'))));
        const roleVal = (typeof pos.role === 'string') ? pos.role :
          (pos.role === 1 ? 'user' : (pos.role === 2 ? 'assistant' : 'system'));
        // ===== 🧹 最后一道防线：变量列表/变量输出格式条目强制规范化 content =====
        // ⚠️ 核心名严格匹配，避免含关键词的普通条目被强制覆盖（同 processEntriesFn 修复）
        const _sanitizeComment = String(e.comment || e.name || '');
        let _sanitizeContent = String(e.content == null ? '' : e.content);
        const _sanitizeCore = _entryCommentCore(_sanitizeComment);
        if (_isInitVarComment(_sanitizeComment, _sanitizeContent)) {
          _sanitizeContent = normalizeInitVarContent(_sanitizeContent);
        }
        if (_sanitizeCore === '变量列表') {
          _sanitizeContent = normalizeVarListContent(_sanitizeContent);
        }
        if (_sanitizeCore === '变量输出格式' || _sanitizeCore === '变量输出格式强调') {
          _sanitizeContent = normalizeVarOutputFormatContent(_sanitizeComment, _sanitizeContent);
        }
        if (_sanitizeCore === '变量更新规则') {
          _sanitizeContent = normalizeVarUpdateRuleContent(_sanitizeContent);
        }
        return {
          name: String(e.name || e.comment || ('条目' + (i + 1))),
          content: _sanitizeContent,
          enabled: e.enabled !== false,
          uid: (typeof e.uid === 'number' && isFinite(e.uid)) ? e.uid : (e.uid != null ? Number(e.uid) : undefined),
          strategy: {
            type: (typeof strat.type === 'string' && strat.type) ? strat.type : (e.constant ? 'constant' : (e.selective ? 'selective' : 'selective')),
            keys: safeKeys(rawKeys),
            keys_secondary: {
              logic: (typeof ks.logic === 'string' && ks.logic) ? ks.logic : 'and_any',
              keys: safeKeys(rawSecondaryKeys)
            },
            scan_depth: (strat.scan_depth === undefined || strat.scan_depth === null) ?
              (e.scan_depth != null ? e.scan_depth : 'same_as_global') :
              strat.scan_depth
          },
          position: {
            type: posType,
            role: roleVal,
            depth: safeNumber(typeof pos.depth === 'number' ? pos.depth : e.depth, 4),
            order: safeNumber(typeof pos.order === 'number' ? pos.order : (e.order || e.insertion_order), 100)
          },
          probability: safeNumber(e.probability, 100),
          recursion: {
            prevent_incoming: !!rec.prevent_incoming,
            prevent_outgoing: !!rec.prevent_outgoing,
            delay_until: (typeof rec.delay_until === 'number' && isFinite(rec.delay_until)) ? rec.delay_until : null
          },
          effect: {
            sticky: (typeof eff.sticky === 'number' && isFinite(eff.sticky)) ? eff.sticky : null,
            cooldown: (typeof eff.cooldown === 'number' && isFinite(eff.cooldown)) ? eff.cooldown : null,
            delay: (typeof eff.delay === 'number' && isFinite(eff.delay)) ? eff.delay : null
          },
          extra: (e.extra && typeof e.extra === 'object') ? e.extra : {}
        };
      });
  }

  // ===== 【写卡预设】自动给世界书条目分配并包裹 <名称_idN> 标签（对齐 template_tag_spec）=====
  // 分配规则：角色速览固定 <角色速览_id0> → 世界观条目 id1+ → 角色条目按顺序id → NPC继续递增
  // 同一角色的所有条目（基础信息/三面性/二次解释/衣柜/NSFW）共用同一个 <角色名_idN>
  // 注意：MVU条目（[InitVar]/[mvu_update]/变量列表/状态栏占位符）不包裹标签
  function assignAndWrapTagIds(entries) {
    if (!entries || !entries.length) return entries;
    // 第一步：收集顶层角色名（从comment中提取，非主角/世界/系统）
    const allNames = [];
    let worldviewIdx = 0; // 世界观计数器，第一个世界观 = id1
    const charNameToId = {}; // 角色名 → 分配的id数字
    let nextCharId = 1; // 下一个可用的角色id（从1开始，因为世界观可能先占）
    // 预扫描：优先从comment提取所有候选：角色速览/世界观前缀/角色名/NPC名
    // 窄口径：仅 9.1.6 工作流核心条目参与 tag-id 的 mvu 分桶。
    // 故意不复用顶层宽口径 isMVUEntry（后者还含阶段判定/派生字段/控制器等附加条目，
    // 那些在 id 分配时应走普通世界观/NPC 分桶，过宽会把普通条目误分到 mvu 桶）。
    const MVU_WORKFLOW_PREFIX_RE = /(\[InitVar\]|\[mvu_update\]|变量列表|变量输出格式|变量输出格式强调|<状态栏>|占位符提醒|状态栏占位符)/i;
    const isMvuWorkflowEntry = function(c) {
      return MVU_WORKFLOW_PREFIX_RE.test(c || '');
    };
    // 预扫描：把所有comment按出现顺序分类
    const classified = entries.map(function(e, idx) {
      const c = String(e.comment || e.name || ('条目' + (idx + 1)));
      if (isMvuWorkflowEntry(c)) return {
        idx: idx,
        type: 'mvu',
        name: '',
        comment: c
      };
      // 1. 角色速览：固定 id0
      if (c.indexOf('角色速览') >= 0) return {
        idx: idx,
        type: 'char-overview',
        name: '角色速览',
        comment: c
      };
      // 2. 世界观组：
      if (/^(世界观|世界元数据|状态栏|<世界元数据>)/.test(c) ||
        c.indexOf('世界观') === 0 || c.indexOf('世界元数据') >= 0) {
        worldviewIdx++;
        return {
          idx: idx,
          type: 'worldview',
          name: '世界观',
          subId: worldviewIdx,
          comment: c
        };
      }
      // 3. NPC条目（尝试提取名称，如"NPC1: 商人张三" → "商人张三"）
      if (/^(NPC)/.test(c) || c.indexOf('NPC') === 0) {
        // 尝试从"NPC: 名称"或"NPC1: 名称"格式提取名称
        const npcMatch = c.match(/^(?:NPC\d*)\s*[:：]\s*([\u4e00-\u9fffA-Za-z0-9_]{2,8})/);
        const npcName = npcMatch ? npcMatch[1] : '';
        return {
          idx: idx,
          type: 'npc-guess',
          name: npcName,
          comment: c
        };
      }
      // 4. 角色条目（从comment前缀提取：去掉<...>/[...]后的首个2-6字中文字符串）
      const m = c.match(/<?([\u4e00-\u9fff]{2,6})/);
      const guessName = m ? m[1] : '';
      // 排除明显非角色名：主角/世界/系统/剧情/第一章/附录等
      const EXCLUDE_NAMES = {
        '主角': true,
        '世界': true,
        '系统': true,
        '剧情': true,
        '附录': true,
        '设定': true,
        '第一章': true,
        '第二章': true,
        '第三章': true
      };
      if (guessName && !EXCLUDE_NAMES[guessName]) {
        if (allNames.indexOf(guessName) < 0) allNames.push(guessName);
        return {
          idx: idx,
          type: 'char-entry',
          name: guessName,
          comment: c
        };
      }
      // 5. 兜底：归为世界观附属（id跟世界观走）
      worldviewIdx++;
      return {
        idx: idx,
        type: 'worldview',
        name: '世界观',
        subId: worldviewIdx,
        comment: c
      };
    });
    // 第二步：正式分配ID
    // 角色速览固定id0，世界观从id1开始，角色从世界观最大id+1继续，NPC继续
    let maxWorldId = 0;
    classified.forEach(function(item) {
      if (item.type === 'worldview') maxWorldId = Math.max(maxWorldId, item.subId || 0);
    });
    nextCharId = maxWorldId + 1;
    classified.forEach(function(item) {
      if (item.type === 'char-entry' || item.type === 'npc-guess') {
        const key = item.name || ('NPC_' + item.idx);
        if (!(key in charNameToId)) {
          charNameToId[key] = nextCharId++;
        }
      }
    });
    // 第三步：执行包裹
    const TAG_OPEN_RE = /^\s*<([\u4e00-\u9fffA-Za-z0-9_]+)_id(\d+)\s*>/; // 已经有标签打开？
    const outEntries = entries.slice();
    classified.forEach(function(item) {
      const e = outEntries[item.idx];
      if (!e) return;
      const content = String(e.content || '');
      // MVU条目、已含标签开头的、空内容的不处理
      if (item.type === 'mvu') return;
      if (TAG_OPEN_RE.test(content)) return;
      if (!content.trim()) return;
      let tagName = '',
        tagId = 0;
      if (item.type === 'char-overview') {
        tagName = '角色速览';
        tagId = 0;
      } else if (item.type === 'worldview') {
        tagName = '世界观';
        tagId = item.subId;
      } else if (item.type === 'char-entry' && item.name) {
        tagName = item.name;
        tagId = charNameToId[item.name] || 0;
      } else if (item.type === 'npc-guess' && item.name) {
        tagName = item.name;
        tagId = charNameToId[item.name] || 0;
      } else if (item.type === 'npc-guess' && !item.name) {
        tagName = 'NPC';
        tagId = charNameToId['NPC_' + item.idx] || (++worldviewIdx);
      } else {
        tagName = '世界观';
        tagId = (++worldviewIdx);
      }
      if (!tagName) return;
      const open = '<' + tagName + '_id' + tagId + '>';
      const close = '</' + tagName + '_id' + tagId + '>';
      // 保证 content 前后有换行分隔，避免标签和内容粘连
      let padded = content;
      if (padded.charAt(0) !== '\n') padded = '\n' + padded;
      if (padded.charAt(padded.length - 1) !== '\n') padded = padded + '\n';
      e.content = open + padded + close;
    });
    return outEntries;
  }

  // ===== 去重写入：参考 javascript-format 的 name/comment 路径匹配 =====
  // 旧方案用 extra.source === SOURCE_TAG 过滤再 createWorldbookEntries 追加，
  // 但 extra 字段经酒馆持久化后不一定能原样读回，过滤失效 → 条目叠加。
  // 新方案：updateWorldbookWith 一次性按 name 匹配，命中则覆盖，未命中才追加。
  function _normWiPath(p) {
    let n = String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+/g, '/').trim();
    if (!n) return '';
    if (n.charAt(0) !== '/') n = '/' + n;
    return '/' + n.split('/').filter(Boolean).join('/');
  }

  function _wiEntryMatch(worldbookName, targetName, oldEntry) {
    const target = _normWiPath('/Worldbooks/' + worldbookName + '/' + (targetName || ''));
    if (!target) return false;
    const byComment = _normWiPath('/Worldbooks/' + worldbookName + '/' + ((oldEntry && oldEntry.comment) || ''));
    const byName = _normWiPath('/Worldbooks/' + worldbookName + '/' + ((oldEntry && oldEntry.name) || ''));
    return byComment === target || byName === target;
  }

  async function _tavernWriteWorldbook(worldbookName, entries) {
    const SOURCE_TAG = 'modelo-char-generator';
    const getWorldbookNames = _tavernFn('getWorldbookNames');
    const getWorldbook = _tavernFn('getWorldbook');
    const createWorldbook = _tavernFn('createWorldbook');
    const updateWorldbookWith = _tavernFn('updateWorldbookWith');
    const createWorldbookEntries = _tavernFn('createWorldbookEntries');

    // ===== 【写卡预设】步骤0：给所有世界书条目自动包裹 <名称_idN> 标签 =====
    // MVU条目自动跳过，已经有标签的不重复包裹
    const wrappedEntries = assignAndWrapTagIds(entries || []);

    // ===== 修复Bug2：转换为酒馆助手 WorldbookEntry 新格式（name 替代 comment） =====
    let converted = wrappedEntries.map(function(e, i) {
      return _convertToWorldbookEntry(e, i, SOURCE_TAG);
    });
    // ===== 写入前强制 sanitize：确保所有条目/position/strategy 是对象，过滤字符串/null =====
    converted = _sanitizeWorldbookEntriesForWrite(converted);

    // ===== 修复Bug1：确保世界书存在（createWorldbookEntries / updateWorldbookWith 要求世界书已存在，
    //                  否则抛错——这正是"只写入开场白和角色描述、不生成世界书、不关联到角色卡"的根因） =====
    let exists = false;
    if (getWorldbookNames) {
      try {
        const names = await getWorldbookNames();
        exists = !!(names && names.indexOf(worldbookName) >= 0);
      } catch (_e) {}
    }
    if (!exists && getWorldbook) {
      try {
        await getWorldbook(worldbookName);
        exists = true;
      } catch (_e) {
        exists = false;
      }
    }
    if (!exists) {
      if (!createWorldbook) throw new Error('酒馆不支持 createWorldbook API，无法创建世界书');
      // createWorldbook 在世界书已存在时会替换(清空)内容，故仅在不存在时调用
      await createWorldbook(worldbookName);
    }

    // ===== 去重写入：按 name/comment 路径匹配，命中则覆盖，未命中才追加 =====
    // （参考 javascript-format 的 ba + updateWorldbookWith 实现，避免条目叠加）
    if (updateWorldbookWith) {
      await updateWorldbookWith(worldbookName, function(oldEntries) {
        const list = (oldEntries || []).slice();
        for (let i = 0; i < converted.length; i++) {
          const newEntry = converted[i];
          let idx = -1;
          for (let j = 0; j < list.length; j++) {
            if (_wiEntryMatch(worldbookName, newEntry.name, list[j])) {
              idx = j;
              break;
            }
          }
          if (idx >= 0) {
            // 命中同名条目：保留原 uid/displayIndex 等元数据，覆盖内容与配置
            list[idx] = Object.assign({}, list[idx], newEntry);
          } else {
            // 未命中：追加新条目
            list.push(newEntry);
          }
        }
        // ===== 回调返回前再统一 sanitize：oldEntries 可能含 position=字符串/空字符串 的旧条目，避免酒馆写 .depth 时炸 =====
        return _sanitizeWorldbookEntriesForWrite(list);
      }, {
        render: 'immediate'
      });
    } else if (createWorldbookEntries) {
      // 回退兜底：无 updateWorldbookWith 时走追加（旧版本可能叠加）
      await createWorldbookEntries(worldbookName, converted, {
        render: 'immediate'
      });
    } else {
      throw new Error('酒馆不支持 updateWorldbookWith / createWorldbookEntries API');
    }
  }

  // ===== 修复Bug5：将世界书绑定到当前角色卡（rebindCharWorldbooks） =====
  // 根因：步骤2仅写了 character.data.world 字段（v3 规范数据），但并未通过酒馆助手 API
  // 真正激活角色卡与世界书的关联，导致世界书虽已生成却"不关联到角色卡"。
  // 此函数在切换到角色卡后调用，把 worldbookName 设为主世界书，并保留原有 additional 世界书。
  async function _tavernBindWorldbookToChar(worldbookName) {
    const getCharWorldbookNames = _tavernFn('getCharWorldbookNames');
    const rebindCharWorldbooks = _tavernFn('rebindCharWorldbooks');
    if (!rebindCharWorldbooks) {
      console.warn('[worldbook] 酒馆不支持 rebindCharWorldbooks API，跳过角色卡世界书绑定');
      return;
    }
    // 读取当前角色卡已绑定的世界书，保留 additional，仅替换 primary
    const primary = worldbookName;
    const additional = [];
    if (getCharWorldbookNames) {
      try {
        const cur = getCharWorldbookNames('current');
        if (cur) {
          // 把旧的主世界书降级为 additional（避免丢失之前已绑定的世界书），去重
          if (cur.primary && cur.primary !== worldbookName && additional.indexOf(cur.primary) < 0) {
            additional.push(cur.primary);
          }
          if (Array.isArray(cur.additional)) {
            cur.additional.forEach(function(n) {
              if (n && n !== worldbookName && additional.indexOf(n) < 0) additional.push(n);
            });
          }
        }
      } catch (_e) {}
    }
    await rebindCharWorldbooks('current', {
      primary: primary,
      additional: additional
    });
  }

  // 切换到角色卡（Lr）
  async function _tavernSwitchToCharacter(name) {
    const validated = _tavernValidateName(name);
    const st = _tavern();
    if (!st || !st.characters) throw new Error('无法访问酒馆角色列表');
    let idx = -1;
    for (let n = 0; n < 20 && idx < 0; n++) {
      idx = -1;
      for (let i = 0; i < st.characters.length; i++) {
        if (st.characters[i].name === validated) {
          idx = i;
          break;
        }
      }
      if (idx < 0) await new Promise(function(r) {
        setTimeout(r, 100);
      });
    }
    if (idx < 0) throw new Error('已完成写入，但无法在角色列表中找到：' + validated);
    if (typeof st.selectCharacterById === 'function') {
      await st.selectCharacterById(idx, {
        switchMenu: true
      });
    }
  }

  // ===== 生成完整角色卡 =====
  function buildExportCard(cd) {
    // 兼容 V3 格式：条目和扩展可能在 data 对象内
    const v3Data = cd.data || {};
    const rawEntries = (cd.character_book && cd.character_book.entries) || (v3Data.character_book && v3Data.character_book.entries) || [];
    const rawExtensions = cd.extensions || v3Data.extensions || {};
    // 从角色卡数据提取角色名列表，用于 MVU 条目内容自动生成
    const charNames = extractCharNames(cd, rawEntries);
    // ===== 预填充：自动填充 MVU 条目空内容（独立步骤，确保检测和schema生成使用填充后的数据）=====
    // ⚠️六大标准模板对齐：InitVar/变量列表/更新规则/输出格式/格式强调；变量分段(EJS)已按规范移除
    let filledEntries = rawEntries.map(function(e, i) {
      const comment = e.comment || ('条目' + (i + 1));
      const commentLower = comment.toLowerCase();
      const isInitVar = commentLower.indexOf('[initvar]') >= 0;
      const isVarList = comment.indexOf('变量列表') >= 0;
      const isVarRule = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量更新规则') >= 0;
      const isVarFormat = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式') >= 0 && comment.indexOf('强调') < 0;
      const isVarFormatEmphasis = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式强调') >= 0;
      let outContent = e.content || '';
      if (!outContent || outContent.trim() === '') {
        if (isInitVar) outContent = generateInitVarYaml(charNames);
        else if (isVarList) outContent = generateVarListContent();
        else if (isVarRule) outContent = generateVarUpdateRule(charNames);
        else if (isVarFormat) outContent = generateVarOutputFormat();
        else if (isVarFormatEmphasis) outContent = generateVarOutputEmphasis();
      } else if (isVarList) {
        outContent = normalizeVarListContent(outContent);
      } else if (isInitVar && outContent) {
        // ⚠️防御性规范化：剥离 AI 误写的 stat_data 根键、过滤 _/$ 只读字段
        outContent = normalizeInitVarContent(outContent);
      } else if (isVarRule && outContent) {
        // ⚠️防御性规范化：补全根节点、剥离 stat_data. 前缀、check 转列表
        outContent = normalizeVarUpdateRuleContent(outContent);
      } else if ((isVarFormat || isVarFormatEmphasis) && outContent) {
        // ⚠️防御性规范化：模板5/6为完全固定格式，被 AI 改动即强制重建
        outContent = normalizeVarOutputFormatContent(comment, outContent);
      }
      return {
        id: e.id || (i + 1),
        keys: e.keys || [],
        secondary_keys: e.secondary_keys || [],
        comment: comment,
        content: outContent,
        constant: e.constant,
        selective: e.selective,
        insertion_order: e.insertion_order,
        enabled: e.enabled,
        position: e.position,
        use_regex: e.use_regex,
        extensions: e.extensions || {}
      };
    });
    // ===== 预填充结束 =====
    // ===== 改进Z5：MVU核心条目兜底——只要任意一项MVU条目存在，就自动补齐其余4类缺失条目 =====
    // 确保导出的角色卡永远包含完整可用的MVU系统
    const anyMVUExists = filledEntries.some(function(e) {
      return isMVUEntry(e.comment || '');
    });
    const mvuEntryExists = function(pred) {
      return filledEntries.some(pred);
    };
    if (anyMVUExists) {
      const _toAppend = [];
      let _idx = filledEntries.length;
      // InitVar
      if (!mvuEntryExists(function(e) {
          return (e.comment || '').toLowerCase().indexOf('[initvar]') >= 0;
        })) {
        _toAppend.push({
          id: _idx + 1,
          keys: [],
          secondary_keys: [],
          comment: '[InitVar]初始变量',
          content: generateInitVarYaml(charNames),
          constant: true,
          selective: false,
          insertion_order: 100,
          enabled: false,
          position: 0,
          use_regex: true,
          extensions: {}
        });
        _idx++;
      }
      // 变量列表（标签内为 null）—— ⚠️insertion_order=200 对齐 ENTRY_TEMPLATES/速查表（原150不一致）
      if (!mvuEntryExists(function(e) {
          return (e.comment || '').indexOf('变量列表') >= 0;
        })) {
        _toAppend.push({
          id: _idx + 1,
          keys: [],
          secondary_keys: [],
          comment: '变量列表',
          content: generateVarListContent(),
          constant: true,
          selective: false,
          insertion_order: 200,
          enabled: true,
          position: 4,
          use_regex: true,
          extensions: {}
        });
        _idx++;
      }
      // [mvu_update]变量更新规则
      if (!mvuEntryExists(function(e) {
          return (e.comment || '').toLowerCase().indexOf('[mvu_update]') >= 0 && (e.comment || '').indexOf('变量更新规则') >= 0;
        })) {
        _toAppend.push({
          id: _idx + 1,
          keys: [],
          secondary_keys: [],
          comment: '[mvu_update]变量更新规则',
          content: generateVarUpdateRule(charNames),
          constant: true,
          selective: false,
          insertion_order: 200,
          enabled: true,
          position: 4,
          use_regex: true,
          extensions: {}
        });
        _idx++;
      }
      // [mvu_update]变量输出格式
      if (!mvuEntryExists(function(e) {
          return (e.comment || '').indexOf('变量输出格式') >= 0 && (e.comment || '').indexOf('强调') < 0;
        })) {
        _toAppend.push({
          id: _idx + 1,
          keys: [],
          secondary_keys: [],
          comment: '[mvu_update]变量输出格式',
          content: generateVarOutputFormat(),
          constant: true,
          selective: false,
          insertion_order: 200,
          enabled: true,
          position: 4,
          use_regex: true,
          extensions: {}
        });
        _idx++;
      }
      // ⚠️迭代：补齐模板6 [mvu_update]变量输出格式强调（默认 enabled=false——
      // 仅在测试发现 AI 不输出 <UpdateVariable> 块时才手动启用，六大模板缺一不可）
      if (!mvuEntryExists(function(e) {
          return (e.comment || '').indexOf('变量输出格式强调') >= 0;
        })) {
        _toAppend.push({
          id: _idx + 1,
          keys: [],
          secondary_keys: [],
          comment: '[mvu_update]变量输出格式强调',
          content: generateVarOutputEmphasis(),
          constant: true,
          selective: false,
          insertion_order: 200,
          enabled: false,
          position: 4,
          use_regex: true,
          extensions: {}
        });
        _idx++;
      }
      if (_toAppend.length) {
        filledEntries = filledEntries.concat(_toAppend);
        console.warn('[buildExportCard] Z5兜底：自动补齐缺失MVU条目 ' + _toAppend.map(function(e) {
          return e.comment;
        }).join('、'));
      }
    }
    let entries = filledEntries.map(function(e, i) {
      const comment = e.comment || ('条目' + (i + 1));
      const tmpl = getEntryTemplate(comment);
      const isConst = tmpl ? tmpl.constant : false;
      const isSel = tmpl ? tmpl.selective : true;
      const pos = tmpl ? tmpl.position : 4;
      const depth = tmpl ? tmpl.depth : 4;
      const order = tmpl ? tmpl.order : 100;
      const defaultGroup = tmpl ? tmpl.group : '';
      const defaultProb = tmpl ? tmpl.probability : 100;
      const defaultSL = tmpl ? tmpl.selectiveLogic : 0;
      const defaultPR = tmpl ? tmpl.prevent_recursion : false;
      const defaultER = tmpl ? tmpl.exclude_recursion : false;
      const defaultDUR = tmpl ? !!tmpl.delay_until_recursion : false;
      const defaultUseProb = tmpl ? tmpl.useProbability : false;
      const defaultScanDepth = tmpl ? tmpl.scan_depth : null;
      const defaultEnabled = tmpl && tmpl.enabled !== undefined ? tmpl.enabled : true;
      const ext = e.extensions || {};
      const rawPos = ext.position !== undefined ? ext.position : pos;
      // ⚠️完善：字符串 position 完整映射（before_char/after_char/before_an/after_an/@N/EMTop/EMBottom/outlet），
      // 修复旧实现只认 before_char、其余字符串全部落到 1 导致导出位置错乱
      const posNum = _posToNum(rawPos);
      // ST规范：顶层position只接受 "before_char" 或 "after_char"
      // position=0 → before_char，其他所有值 → after_char
      const topPosStr = (posNum === 0) ? 'before_char' : 'after_char';
      // ST规范：role 仅 position=4(atDepth) 时有意义；position≠4 时导出为 null
      let roleVal = ext.role !== undefined && ext.role !== null ? ext.role : null;
      if (posNum !== 4) {
        roleVal = null;
      } else if (typeof roleVal === 'string') {
        roleVal = roleVal.toLowerCase() === 'user' ? 1 : (roleVal.toLowerCase() === 'assistant' ? 2 : 0);
      }
      const useProbVal = ext.useProbability !== undefined ? ext.useProbability : (ext.use_probability !== undefined ? ext.use_probability : defaultUseProb);
      const groupWeightVal = ext.group_weight !== undefined ? ext.group_weight : (ext.groupWeight !== undefined ? ext.groupWeight : 100);
      // MVU 安全网：[initvar] 条目必须 enabled=false；变量输出格式强调 默认 enabled=false
      // 注意：空内容填充已移至预填充步骤，此处仅保留类型检测用于 enabled 逻辑
      const commentLower = comment.toLowerCase();
      const isInitVar = commentLower.indexOf('[initvar]') >= 0;
      const isVarRule = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量更新规则') >= 0;
      const isVarFormat = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式') >= 0 && comment.indexOf('强调') < 0;
      const isVarFormatEmphasis = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式强调') >= 0;
      const outContent = e.content || '';
      return {
        id: e.id || (i + 1),
        keys: e.keys || [],
        secondary_keys: e.secondary_keys || (tmpl && tmpl.secondary_keys) || [],
        comment: comment,
        content: outContent,
        constant: e.constant !== undefined ? e.constant : isConst,
        selective: e.selective !== undefined ? e.selective : isSel,
        insertion_order: e.insertion_order || order,
        enabled: isInitVar ? false : (isVarFormatEmphasis ? (e.enabled !== undefined ? e.enabled : false) : (e.enabled !== undefined ? e.enabled : defaultEnabled)),
        position: topPosStr,
        use_regex: e.use_regex !== undefined ? e.use_regex : true,
        extensions: {
          position: posNum,
          exclude_recursion: ext.exclude_recursion !== undefined ? ext.exclude_recursion : defaultER,
          display_index: i,
          probability: ext.probability !== undefined ? ext.probability : defaultProb,
          useProbability: useProbVal,
          depth: ext.depth !== undefined ? ext.depth : depth,
          selectiveLogic: ext.selectiveLogic !== undefined ? ext.selectiveLogic : defaultSL,
          group: ext.group || defaultGroup,
          prevent_recursion: ext.prevent_recursion !== undefined ? ext.prevent_recursion : defaultPR,
          scan_depth: ext.scan_depth !== undefined ? ext.scan_depth : defaultScanDepth,
          match_whole_words: ext.match_whole_words !== undefined ? ext.match_whole_words : null,
          case_sensitive: ext.case_sensitive !== undefined ? ext.case_sensitive : null,
          automation_id: ext.automation_id !== undefined ? ext.automation_id : '',
          group_override: ext.group_override !== undefined ? !!ext.group_override : false,
          /* 改进S：尊重用户配置，不再硬编码false */
          group_weight: groupWeightVal,
          delay_until_recursion: ext.delay_until_recursion !== undefined ? ext.delay_until_recursion : defaultDUR,
          /* 改进T：保留原值（数字=延迟N轮），不再强制boolean */
          use_group_scoring: ext.use_group_scoring !== undefined ? ext.use_group_scoring : false,
          role: roleVal,
          vectorized: ext.vectorized !== undefined ? ext.vectorized : false,
          sticky: ext.sticky !== undefined && ext.sticky !== null ? ext.sticky : null,
          cooldown: ext.cooldown !== undefined && ext.cooldown !== null ? ext.cooldown : null,
          delay: ext.delay !== undefined && ext.delay !== null ? ext.delay : null,
          match_persona_description: ext.match_persona_description !== undefined ? ext.match_persona_description : false,
          match_character_description: ext.match_character_description !== undefined ? ext.match_character_description : false,
          match_character_personality: ext.match_character_personality !== undefined ? ext.match_character_personality : false,
          match_character_depth_prompt: ext.match_character_depth_prompt !== undefined ? ext.match_character_depth_prompt : false,
          match_scenario: ext.match_scenario !== undefined ? ext.match_scenario : false,
          match_creator_notes: ext.match_creator_notes !== undefined ? ext.match_creator_notes : false,
          outlet_name: ext.outlet_name !== undefined ? ext.outlet_name : '',
          triggers: Array.isArray(ext.triggers) ? ext.triggers : [],
          character_filter: ext.character_filter !== undefined ? ext.character_filter : null,
          ignore_budget: ext.ignore_budget !== undefined ? !!ext.ignore_budget : false,
          addMemo: ext.addMemo !== undefined ? !!ext.addMemo : false
        }
      };
    });
    // ===== 深度防御：entries 里混入字符串/null/非对象时立即清理（常见于 depth_prompt.prompt 被误写入 entries 或用户操作残留字符串）=====
    entries = entries.filter(function(e) {
      return e && typeof e === 'object' && !Array.isArray(e);
    });
    // ===== 额外保险：如果 entry.comment 缺失但 content 像 "【...】：..." 这种 depth_prompt 式长文本，加一个 fallback comment 防止后续流程炸 =====
    entries = entries.map(function(e) {
      if (!e.comment && e.content && typeof e.content === 'string') {
        const first = e.content.split('\n')[0].trim();
        if (first.length > 8 && first.length <= 60) e = Object.assign({}, e, {
          comment: first.slice(0, 40)
        });
      }
      return e;
    });
    // ST规范：换行符统一使用 \r\n
    const toCRLF = function(str) {
      if (!str) return str;
      return str.replace(/\r?\n/g, '\r\n');
    };
    // normalizeRegexScripts 已提取为外层共享函数（导入/导出共用）
    const cardName = cd.name || '未命名世界';
    const cardDesc = cd.description || '';
    // 检测是否包含MVU核心条目（至少 [initvar] + 变量列表/更新规则/输出格式 之一即视为MVU系统）
    // 使用预填充后的 filledEntries 进行检测，确保 InitVar 等条目已含自动生成的内容
    const hasInitVar = filledEntries.some(function(e) {
      return (e.comment || '').toLowerCase().indexOf('[initvar]') >= 0;
    });
    const hasVarList = filledEntries.some(function(e) {
      return (e.comment || '').indexOf('变量列表') >= 0;
    });
    const hasVarUpdate = filledEntries.some(function(e) {
      return (e.comment || '').toLowerCase().indexOf('[mvu_update]') >= 0 || (e.comment || '').indexOf('变量更新规则') >= 0;
    });
    const hasVarFormat = filledEntries.some(function(e) {
      return (e.comment || '').indexOf('变量输出格式') >= 0;
    });
    let hasMVUEntries = !!(hasInitVar && (hasVarList || hasVarUpdate || hasVarFormat));
    // 宽泛匹配：只要存在任意 MVU 核心条目（即使无 [InitVar]）也视为 MVU 卡
    const hasAnyMVU = hasMVUEntries || filledEntries.some(function(e) {
      return isMVUEntry(e.comment || '');
    });
    // 最终使用宽泛匹配结果，确保只要有任意 MVU 条目就注入脚本
    hasMVUEntries = hasMVUEntries || hasAnyMVU;
    let rawFirstMes = cd.first_mes || '';
    // MVU 卡的开场白必须含 <StatusPlaceHolderImpl/>（即使 first_mes 为空也追加，保证状态栏正常显示）
    if (hasMVUEntries && rawFirstMes.indexOf('<StatusPlaceHolderImpl') < 0) {
      rawFirstMes = rawFirstMes.replace(/<StatusPlaceHolderImpl\s*\/>/gi, '').trim() + '\n\n<StatusPlaceHolderImpl/>';
    }
    const cardFirstMes = toCRLF(rawFirstMes);
    const cardAltGreetings = (cd.alternate_greetings || []).map(function(g) {
      // ⚠️改进R5：非字符串元素（null/数字/对象）会令 toCRLF 崩溃，加 typeof 守卫
      if (typeof g !== 'string') g = '';
      let greeting = toCRLF(g);
      // MVU开局变量初始化：在alternate_greetings中保留<UpdateVariable>段（覆盖[InitVar]默认值）
      // 同时确保每个alt greeting也含<StatusPlaceHolderImpl/>占位符
      if (hasMVUEntries && greeting.indexOf('<StatusPlaceHolderImpl') < 0) {
        greeting = greeting.replace(/<StatusPlaceHolderImpl\s*\/>/gi, '').trim() + '\n\n<StatusPlaceHolderImpl/>';
      }
      return greeting;
    });
    const cardSysPrompt = toCRLF(cd.system_prompt || '');
    const cardCreatorNotes = toCRLF(cd.creator_notes || '时之写卡器创建');
    // 优先从 data.depth_prompt 读取（v3规范），回退到 extensions.depth_prompt（v2兼容）
    // 改进D：深拷贝避免引用污染源cardData（多次buildExportCard会累积修改role/depth）
    // 修复：若来源是 JSON 字符串（形如 '{"prompt":"...","depth":0,"role":"system"}'），先反序列化再操作，
    //   否则 JSON.parse(JSON.stringify(string)) 仍是字符串，后续 .depth= 会抛 "Cannot create property 'depth' on string"
    const _rawDpSrc = cd.depth_prompt ? cd.depth_prompt : (rawExtensions.depth_prompt ? rawExtensions.depth_prompt : {
      prompt: '',
      depth: 4,
      role: 'system'
    });
    const _depthPromptSrc = normalizeDepthPrompt(_rawDpSrc, 4);
    const depthPrompt = JSON.parse(JSON.stringify(_depthPromptSrc));
    // 修正 depth_prompt.role 为字符串
    if (typeof depthPrompt.role === 'number') {
      depthPrompt.role = depthPrompt.role === 1 ? 'user' : (depthPrompt.role === 2 ? 'assistant' : 'system');
    }
    if (depthPrompt.depth === undefined) depthPrompt.depth = 4;
    const cardData = {
      name: cardName,
      description: cardDesc,
      personality: cd.personality || '',
      scenario: cd.scenario || '',
      first_mes: cardFirstMes,
      creator_notes: cardCreatorNotes,
      system_prompt: cardSysPrompt,
      creator: '时之写卡器',
      character_version: '',
      alternate_greetings: cardAltGreetings,
      group_only_greetings: [],
      depth_prompt: depthPrompt,
      extensions: (function() {
        // 检测是否包含MVU变量系统条目（复用前面的检测结果）
        const hasMVU = hasMVUEntries;
        const existingRx = normalizeRegexScripts(rawExtensions.regex_scripts);
        const existingScripts = (rawExtensions.tavern_helper && rawExtensions.tavern_helper.scripts) || [];
        const mvuScripts = existingScripts.slice();
        const mvuRegex = existingRx.slice();
        if (hasMVU) {
          // 自动注入MVU bundle.js脚本（如果尚未存在）
          // 使用 MVU 规范的固定UUID，确保兼容
          const hasBundle = mvuScripts.some(function(s) {
            return (s.content || '').indexOf('MagVarUpdate') >= 0 || (s.content || '').indexOf('bundle.js') >= 0;
          });
          if (!hasBundle) {
            mvuScripts.push({
              type: 'script',
              enabled: true,
              name: 'MVU',
              id: '961f366d-e403-45c2-8155-3d14ec86de53',
              content: "import'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';",
              info: '',
              button: {
                enabled: true,
                buttons: [{
                    name: '重新处理变量',
                    visible: false
                  },
                  {
                    name: '重新读取初始变量',
                    visible: false
                  },
                  {
                    name: '快照楼层',
                    visible: false
                  },
                  {
                    name: '重演楼层',
                    visible: false
                  },
                  {
                    name: '重试额外模型解析',
                    visible: false
                  },
                  {
                    name: '清除旧楼层变量',
                    visible: false
                  }
                ]
              },
              data: {}
            });
          }
          // ⚠️用户要求：变量结构脚本（zod schema）由 AI 在 MVU Tab 按 9.1.5/9.1.6 工作流一条一条生成，不再导出时自动注入
          // （原 isMvuSchemaComplete / hasSchema / generateMvuSchemaScript 自动注入逻辑已移除）
          // ⚠️用户要求：WTC（世界书调用脚本）不再自动注入，由 AI 按需在 MVU Tab 生成
          // （原 hasWTC 自动注入逻辑已移除）
          // 自动注入MVU必备正则脚本（5条：正则1-5；正则6 美化状态栏由 AI 在 MVU Tab 生成）
          // 正则1：仅格式思维链 - 从提示词中移除<Analysis>段（AI思维链不需要重复发送）
          const hasAnalysisRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('Analysis') >= 0 && r.promptOnly;
          });
          if (!hasAnalysisRegex) {
            mvuRegex.push({
              id: 'd668c8a6-fa6a-444d-a5d6-8f68b73a3c36',
              scriptName: '仅格式思维链',
              findRegex: '/<Analysis>[\\s\\S]+?<\\/Analysis>/gm',
              replaceString: '',
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: false,
              promptOnly: true,
              runOnEdit: false, // StageDog标准：避免编辑消息时重复执行
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // 正则2：只发送最新2楼的变量更新 - 从提示词移除旧UpdateVariable段（minDepth=4保留最近2楼）
          const hasUpdateVarPromptRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('UpdateVariable') >= 0 && r.promptOnly;
          });
          if (!hasUpdateVarPromptRegex) {
            mvuRegex.push({
              id: '5bb4b588-23ca-4564-8df5-882104eff764',
              scriptName: '只发送最新2楼的变量更新',
              findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm',
              replaceString: '',
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: false,
              promptOnly: true,
              runOnEdit: false, // StageDog标准：避免编辑消息时重复执行
              substituteRegex: 0,
              minDepth: 4,
              maxDepth: null
            });
          }
          // 正则3：[美化]变量完成 - 美化已完成的UpdateVariable显示（markdownOnly）
          const hasBeautifyCompleteRegex = mvuRegex.some(function(r) {
            return r.id === '6fb572ae-a9ea-436d-9779-ad100f1ff7f5';
          });
          if (!hasBeautifyCompleteRegex) {
            mvuRegex.push({
              id: '6fb572ae-a9ea-436d-9779-ad100f1ff7f5',
              scriptName: '[美化]变量完成',
              findRegex: '/<UpdateVariable(?:variable)?>\\s*([\\s\\S]*?)\\s*<\\/UpdateVariable(?:variable)?>/gsi',
              replaceString: MVU_BEAUTIFY_COMPLETE,
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: true,
              promptOnly: false,
              runOnEdit: false,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // 正则4：[美化]变量更新中 - 美化流式输出中的UpdateVariable显示
          const hasBeautifyThinkingRegex = mvuRegex.some(function(r) {
            return r.id === 'bf1b7441-5cf1-426d-bd6c-911332be9923';
          });
          if (!hasBeautifyThinkingRegex) {
            mvuRegex.push({
              id: 'bf1b7441-5cf1-426d-bd6c-911332be9923',
              scriptName: '[美化]变量更新中',
              findRegex: '/<UpdateVariable(?:variable)?>(?!.*<\\/UpdateVariable(?:variable)?>)\\s*(.*)\\s*$/gsi',
              replaceString: MVU_BEAUTIFY_THINKING,
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: true,
              promptOnly: false,
              runOnEdit: false,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // 月相1-4已删除
          // 正则5：[不发送]隐藏状态栏标记 - 从提示词移除 <StatusPlaceHolderImpl/>（AI不需要看到占位符）
          const hasHidePlaceholderRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('StatusPlaceHolderImpl') >= 0 && r.promptOnly && !r.markdownOnly;
          });
          if (!hasHidePlaceholderRegex) {
            mvuRegex.push({
              id: 'mvu-status-hide',
              scriptName: '[不发送]隐藏状态栏标记',
              findRegex: '/<StatusPlaceHolderImpl\\/>/g',
              replaceString: '',
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: false,
              promptOnly: true,
              runOnEdit: false, // StageDog标准：避免编辑消息时重复执行
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // ⚠️用户要求：正则6（[美化]MVU状态栏）由 AI 在 MVU Tab 按 9.1.6 工作流一条一条生成，不再导出时自动注入
          // （原 hasStatusBarRegex / MVU_STATUS_BAR_HTML 回退注入逻辑已移除）
        }
        return {
          talkativeness: '0.5',
          fav: false,
          world: cardName,
          depth_prompt: depthPrompt,
          regex_scripts: mvuRegex,
          'xiaobaix-template': {
            enabled: false,
            template: '',
            customRegex: '',
            disableParsers: false,
            skipFirstMessage: false,
            recentMessageCount: 0,
            limitToRecentMessages: false
          },
          tavern_helper: {
            scripts: mvuScripts,
            variables: {}
          }
        };
      })(),
      character_book: (function() {
        // ⚠️完善：保留/导出 Lorebook 顶层元数据（CCv3 规范字段）
        //   description/scan_depth/token_budget/recursive_scanning 仅在源卡有明确值时写出，
        //   无值时省略（ST 会按全局设置处理），保证与旧行为完全兼容
        const _cbSrc = cd.character_book || (v3Data.character_book) || {};
        const _cbOut = {
          name: cardName,
          entries: entries
        };
        if (typeof _cbSrc.description === 'string' && _cbSrc.description) _cbOut.description = _cbSrc.description;
        if (typeof _cbSrc.scan_depth === 'number' && !isNaN(_cbSrc.scan_depth)) _cbOut.scan_depth = _cbSrc.scan_depth;
        if (typeof _cbSrc.token_budget === 'number' && !isNaN(_cbSrc.token_budget)) _cbOut.token_budget = _cbSrc.token_budget;
        if (typeof _cbSrc.recursive_scanning === 'boolean') _cbOut.recursive_scanning = _cbSrc.recursive_scanning;
        return _cbOut;
      })()
    };
    // ⚠️改进R6：data.format='milk' 必须在 return 前设置（旧代码在 return 之后是死代码）
    if (cardData && !cardData.format) cardData.format = 'milk';
    // ST规范：顶层需要重复 data 中的关键字段（v3格式顶层用 creatorcomment，data内沿用 creator_notes）
    // CCv3 规范：导出时带创建/修改时间戳（Unix 秒，UTC）；creation_date 缺省为 0（未知）
    const _ccv3Creation = (typeof cd.creation_date === 'number') ? cd.creation_date :
      ((v3Data && typeof v3Data.creation_date === 'number') ? v3Data.creation_date : 0);
    return {
      name: cardName,
      description: cardDesc,
      personality: cd.personality || '',
      scenario: cd.scenario || '',
      first_mes: cardFirstMes,
      mes_example: cd.mes_example || '',
      creatorcomment: cardCreatorNotes,
      avatar: 'none',
      talkativeness: '0.5',
      fav: false,
      create_date: new Date().toISOString(),
      creation_date: _ccv3Creation,
      modification_date: Math.floor(Date.now() / 1000),
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: cardData
    };
  }

  // ============================================================================
  // SECTION 8  写卡器主界面 UI 渲染（欢迎页 · 聊天 · 预览）
  // ============================================================================
  // ===== 主界面 =====
  async function openEditor() {
    try {
      const doc = await createModalIframe();

      // ========== 明暗主题 ==========
      // 优先级：localStorage('cw-theme') 显式选择 > 系统 prefers-color-scheme（默认浅色）
      function _systemPrefersDark() {
        try {
          return !!(doc.defaultView && doc.defaultView.matchMedia &&
            doc.defaultView.matchMedia('(prefers-color-scheme: dark)').matches);
        } catch (_) {
          return false;
        }
      }
      function _resolveTheme() {
        try {
          const saved = localStorage.getItem('cw-theme');
          if (saved === 'dark' || saved === 'light') return saved;
        } catch (_) {}
        return _systemPrefersDark() ? 'dark' : 'light';
      }
      function _syncThemeToggleIcon(theme) {
        try {
          const btns = doc.querySelectorAll('#themeToggleBtn');
          for (let i = 0; i < btns.length; i++) {
            btns[i].innerHTML = svgIcon(theme === 'dark' ? 'sun' : 'moon', 15);
          }
        } catch (_) {}
      }
      function applyTheme(theme) {
        try {
          if (theme === 'dark') doc.documentElement.setAttribute('data-theme', 'dark');
          else if (theme === 'light') doc.documentElement.setAttribute('data-theme', 'light');
          else doc.documentElement.removeAttribute('data-theme');
          _syncThemeToggleIcon(theme);
          // iframe 外壳带内联背景色（不走 CSS 变量），同步真实 --bg 防止暗黑下白边闪烁
          try {
            if (window.frameElement) {
              const bg = doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue('--bg').trim();
              if (bg) window.frameElement.style.background = bg;
            }
          } catch (_) {}
        } catch (e) {
          logWarn('applyTheme', e);
        }
      }
      applyTheme(_resolveTheme());
      // 事件委托：topbar 随 doc.body.innerHTML 多次重建，监听挂 doc 只需绑定一次
      doc.addEventListener('click', function(e) {
        const btn = e.target && e.target.closest ? e.target.closest('#themeToggleBtn') : null;
        if (!btn) return;
        const next = doc.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try {
          localStorage.setItem('cw-theme', next);
        } catch (_) {}
        applyTheme(next);
      });

      let cardData = {
        name: '',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        creator_notes: '',
        system_prompt: '',
        creator: '时之写卡器',
        character_version: '',
        alternate_greetings: [],
        group_only_greetings: [],
        // CCv3 新字段：昵称（替换{{char}}显示名）/ 多语言创作者注释 / 来源追溯
        nickname: '',
        creator_notes_multilingual: {},
        source: [],
        extensions: {
          talkativeness: '0.5',
          fav: false,
          world: '',
          depth_prompt: {
            prompt: '',
            depth: 4,
            role: 'system'
          },
          regex_scripts: [],
          'xiaobaix-template': {
            enabled: false,
            template: '',
            customRegex: '',
            disableParsers: false,
            skipFirstMessage: false,
            recentMessageCount: 0,
            limitToRecentMessages: false
          },
          tavern_helper: {
            scripts: [],
            variables: {}
          }
        },
        character_book: {
          entries: []
        }
      };

      // ========== Tab 隔离系统：角色卡 Tab 与 MVU状态栏 Tab 完全独立 ==========
      // 参考用户建议的 chatSessions 结构化封装，两边会话状态完全隔离
      let activeTab = 'card'; // 'card' = 角色卡生成, 'mvu' = MVU变量状态栏
      // 暴露到 window：让 mergePartial / checkMvu8Entries 等顶层作用域函数也能正确取到当前Tab和cardData
      if (typeof window !== 'undefined') {
        window.__cardData = cardData;
        window.__tab_activeTab = activeTab;
        window.__getActiveTab = function() {
          return activeTab;
        };
        /* 改进16：灰色模式开关——角色卡Tab允许讨论/规划变量结构，但仍禁止生成真实MVU条目
           用法：setMvuDiscussMode(true) 开启讨论模式；setMvuDiscussMode(false) 恢复严格拦截 */
        window.__mvuDiscussMode = false;
        window.setMvuDiscussMode = function(on) {
          window.__mvuDiscussMode = !!on;
          return window.__mvuDiscussMode;
        };
      }
      // 向后兼容别名：activeTab === currentTab，两边代码都能跑
      let currentTab = activeTab;
      const chatSessions = {
        card: {
          messages: [], // 角色卡Tab独立聊天历史
          mode: 'normal' // 角色卡Tab专属模式：永远是 normal，永远不进入状态栏生成模式
        },
        mvu: {
          messages: [] // MVU Tab独立聊天历史
        }
      };
      // 会话数组别名：实际以 chatSessions 为准，切换Tab时同步
      let cardMessages = chatSessions.card.messages;
      let mvuMessages = chatSessions.mvu.messages;
      // ★ 向后兼容别名：旧代码各处仍直接引用 messages 变量（importCardData/loadFromStorage等）
      // let 与原 var 同作用域语义一致（仅无前向提升，本函数声明前无 messages 引用，已核查）
      let messages = chatSessions.card.messages;

      // 当前Tab的messages访问器（根据activeTab返回对应数组）
      function getCurrentMessages() {
        return activeTab === 'card' ? chatSessions.card.messages : chatSessions.mvu.messages;
      }

      function setCurrentMessages(arr) {
        if (activeTab === 'card') {
          chatSessions.card.messages = arr;
          cardMessages = arr;
          messages = arr;
        } else {
          chatSessions.mvu.messages = arr;
          mvuMessages = arr;
        }
      }
      // ★ 暴露到 window：让顶层作用域的 buildPrompt / callAIChat / calcProgress 等函数也能访问
      if (typeof window !== 'undefined') {
        window.__getCurrentTab = function() {
          return currentTab;
        };
        window.__getCurrentMessages = getCurrentMessages;
        window.__setCurrentMessages = setCurrentMessages;
        window.__getChatSessions = function() {
          return chatSessions;
        };
        window.__setChatSessionsCardMessages = function(arr) {
          chatSessions.card.messages = arr;
          cardMessages = arr;
          messages = arr;
        };
        window.__setChatSessionsMvuMessages = function(arr) {
          chatSessions.mvu.messages = arr;
          mvuMessages = arr;
        };
      }

      let isGenerating = false;
      let cardGenerated = false;
      let progress = 0;
      let moduleProgress = {
        total: 0,
        constant: 0,
        triggered: 0,
        grouped: 0,
        has_key: 0,
        has_content: 0
      };

      // ===== Tab 切换函数：保存当前Tab状态 + 切换并恢复另一Tab状态 =====
      function switchTab(targetTab) {
        if (targetTab === activeTab || isGenerating) return;
        // ===== 1. 先保存正要离开的Tab状态到 chatSessions（对称保存两边，确保不会丢失最新进度） =====
        if (activeTab === 'mvu') {
          mvuMessages = chatSessions.mvu.messages;
        } else {
          // 离开角色卡Tab：同步别名
          cardMessages = chatSessions.card.messages;
          messages = chatSessions.card.messages;
          chatSessions.card.mode = 'normal';
        }
        // ===== 2. 正式切到新Tab =====
        activeTab = targetTab;
        currentTab = activeTab; // 向后兼容
        // 同步到 window：让 mergePartial / buildPrompt / calcProgress 也能取到最新Tab
        if (typeof window !== 'undefined') {
          window.__tab_activeTab = activeTab;
          if (typeof window.__getActiveTab === 'function') {
            // 重新绑定闭包（防止旧闭包返回过时值）
          }
          window.__getActiveTab = function() {
            return activeTab;
          };
          window.__getCurrentTab = function() {
            return currentTab;
          };
        }
        // 更新Tab按钮激活态
        const tabBtns = doc.querySelectorAll('.tab-btn');
        for (let ti = 0; ti < tabBtns.length; ti++) {
          tabBtns[ti].classList.toggle('active', tabBtns[ti].getAttribute('data-tab') === targetTab);
        }
        // ===== 3. 同步所有消息别名变量（cardMessages/mvuMessages/messages），保证所有引用都指向最新数组 =====
        cardMessages = chatSessions.card.messages;
        mvuMessages = chatSessions.mvu.messages;
        if (targetTab === 'card') {
          messages = chatSessions.card.messages;
        }
        // 切换聊天记录：清空当前聊天面板并重放目标Tab的消息
        const chatC = doc.getElementById('chatMessages');
        if (chatC) {
          chatC.innerHTML = '';
          const msgs = getCurrentMessages();
          for (let mi = 0; mi < msgs.length; mi++) {
            appendMsg(msgs[mi].role, msgs[mi].content, mi);
          }
          // ★ 重绘后自动滚动到底部，让用户看到最新消息
          try {
            chatC.scrollTop = chatC.scrollHeight;
          } catch (_scErr) {}
          // 下一帧再滚一次（确保渲染完成后滚动）
          try {
            setTimeout(function() {
              chatC.scrollTop = chatC.scrollHeight;
            }, 50);
          } catch (_scErr2) {}
        }
        // ===== 4. 恢复新Tab状态 =====
        if (targetTab === 'mvu') {
          // ===== 进入MVU Tab时自动注入固定资产（bundle.js + 正则1-5）=====
          // ⚠️仅自动注入 bundle.js 和正则1-5；变量结构脚本/WTC/<状态栏>占位符提醒/正则6 由 AI 按 9.1.6 工作流一条一条生成
          // 这些资产固定不变，提前注入让用户在MVU Tab里就能看到完整资产，预览时也能正确渲染
          const injectedAssets = ensureFixedMvuAssetsInCardData();
          if (injectedAssets && injectedAssets.length > 0) {
            renderPreview();
            showToast('已自动注入MVU固定资产：' + injectedAssets.join('、'), 'success');
          }
        } else {
          chatSessions.card.mode = 'normal'; // 角色卡Tab永远是normal
        }
        // ===== 5. 刷新所有UI =====
        updateProgress(); // ★ 重算进度百分比（Tab不同过滤规则不同）
        updateQuickActions(); // 快捷动作按钮
        updateCtxBar(); // ctx-bar 上下文操作条
        renderPreview(); // 右侧预览面板
        scheduleCtxBarUpdate(); // ctx-bar 防抖再刷一次（合并后续成对刷新）
        // ===== 6. 更新输入框：切换Tab时清空残留内容 + 更新placeholder + 更新字符计数/发送按钮脉冲 =====
        const inputEl = doc.getElementById('chatInput');
        if (inputEl) {
          // ★ 切换Tab必须清空输入框内容：避免用户在A Tab写了一半切到B Tab还在，导致上下文不匹配
          inputEl.value = '';
          inputEl.placeholder = targetTab === 'card' ?
            '描述你想要的世界/角色设定，我来生成角色卡...' :
            '描述你想要的MVU变量系统或状态栏，如"做一个好感度+物品栏的状态栏"...';
          // 触发输入框的input事件让字符计数和脉冲按钮更新
          try {
            const _fakeEvt = doc.createEvent ? doc.createEvent('Event') : null;
            if (_fakeEvt) {
              _fakeEvt.initEvent('input', false, true);
              inputEl.dispatchEvent(_fakeEvt);
            }
          } catch (_evtErr) {}
          updateCharCount();
          updateSendBtnPulse();
        }
        // ===== 7. 更新顶栏标题：Tab不同标题不同，给用户明确的上下文感知 =====
        const titleH1 = doc.querySelector('.topbar h1');
        if (titleH1) {
          if (targetTab === 'card') {
            titleH1.innerHTML = svgIcon('bolt', 18, 'topbar-ic') + ' 时之写卡器';
          } else {
            titleH1.innerHTML = svgIcon('sliders', 18, 'topbar-ic') + ' MVU变量系统<span style="font-weight:400;font-size:.85em;color:var(--ink-soft)"> · 变量与状态栏</span>';
          }
        }
        // ===== 8. 保存切换后的状态到 storage =====
        saveToStorage();
        showToast('已切换到：' + (targetTab === 'card' ? '角色卡生成 Tab' : 'MVU变量状态栏 Tab'), 'info');
      }

      function renderWelcome() {
        doc.body.innerHTML =
          '<div class="app">' +
          '<div class="topbar">' +
          '<div class="topbar-left">' +
          '<h1>' + svgIcon('bolt', 18, 'topbar-ic') + ' 时之写卡器</h1>' +
          '</div>' +
          '<div class="topbar-right">' +
          '<button class="icon-btn icon-btn-square" id="themeToggleBtn" aria-label="切换明暗主题" title="切换明暗主题">' + svgIcon('moon', 15) + '</button>' +
          '<button class="icon-btn icon-btn-square danger" id="closeBtn" aria-label="关闭" title="关闭">' + svgIcon('close', 16) + '</button>' +
          '</div>' +
          '</div>' +
          '<div class="welcome">' +
          '<h2>' + svgIcon('sparkle', 22, 'welcome-ic') + ' 时之写卡器</h2>' +
          '<p>基于SillyTavern原生世界书（World Info）机制，通过AI对话自由生成符合ST官方Schema的世界书条目。<br>和AI聊天就能生成世界书JSON，直接写入酒馆！</p>' +
          '<div class="welcome-features">' +
          '<div class="wf-item"><div class="wf-icon">' + svgIcon('chat', 18) + '</div><div class="wf-copy"><div class="wf-title">对话式创作</div><div class="wf-desc">像聊天一样自然，AI按你的需求自由生成世界书条目</div></div></div>' +
          '<div class="wf-item"><div class="wf-icon">' + svgIcon('chart', 18) + '</div><div class="wf-copy"><div class="wf-title">权重可视化</div><div class="wf-desc">展示每个条目权重等级、触发逻辑、Token占用</div></div></div>' +
          '<div class="wf-item"><div class="wf-icon">' + svgIcon('code', 18) + '</div><div class="wf-copy"><div class="wf-title">JSON代码输出</div><div class="wf-desc">AI直接产出符合ST标准Schema的世界书JSON（entries对象），或:::操作块增量修改</div></div></div>' +
          '<div class="wf-item"><div class="wf-icon">' + svgIcon('save', 18) + '</div><div class="wf-copy"><div class="wf-title">一键写入酒馆</div><div class="wf-desc">生成的世界书条目直接装配进角色卡，写入酒馆当前角色</div></div></div>' +
          '</div>' +
          '<button class="start-btn" id="startBtn">' + svgIcon('play', 18) + ' 开始创作</button>' +
          '<div class="welcome-actions">' +
          '<button class="btn btn-ghost" id="importBtn">' + svgIcon('download', 15) + ' 导入现有卡</button>' +
          '<button class="btn btn-ghost" id="continueBtn" style="display:none">' + svgIcon('folderOpen', 15) + ' 继续上次</button>' +
          '</div>' +
          '<p style="font-size:.7em;color:var(--muted);margin-top:18px">世界书条目字段对齐ST官方源码（world-info.js）：key/comment/content/constant/selective/position/selectiveLogic/order/depth 等40个字段，不臆造字段名</p>' +
          '<p style="font-size:.65em;color:var(--muted);margin-top:6px">自由生成：不限制标签前缀，用户要什么条目就生成什么条目</p>' +
          '</div>' +
          '</div>';
        doc.getElementById('closeBtn').addEventListener('click', closeModal);
        doc.getElementById('startBtn').addEventListener('click', function() {
          // ✅ 点击「开始创作」= 全新开始：自动清空之前所有记录（角色卡数据 + 两边Tab聊天记录 + localStorage存档）
          resetAllWorkForNewCard();
          renderChatUI();
          addAssistantMsg('你好！我是你的世界书条目创作助手 🎭\n\n我会基于SillyTavern原生世界书机制，自由生成符合ST规范的世界书条目（World Info / Lorebook）。\n\n**你可以直接告诉我**：\n   • 想加入世界书的内容：任何设定\n   • 我会直接生成对应的世界书条目（JSON代码块或:::操作块），可随时增删改\n\n在开始之前，有两个关键问题需要先明确：\n\n**1. 内容尺度**：你希望这个世界卡是什么尺度？\n   • 全年龄向：纯洁的青春、友情、冒险故事（默认，不含任何成人内容）\n   • 暗黑向：残酷、血腥、深刻、绝望的剧情——包含暴力/死亡/折磨/背叛/创伤/精神崩溃，不含色情\n   • NSFW（18禁）：成人内容——包含露骨的情欲/性行为描写，器官直呼、过程逐帧、不回避不省略\n   • 暗黑+NSFW 叠加：性暴力/黑暗调教/末世堕落/人身支配等极端内容，两套标准同时全开\n   ⚠️ 一旦选定，本卡将**严格按照该尺度执行**——不会打码、不会留白、不会用"省略号/成语"敷衍。\n\n**2. 核心方向**：你想做什么样的世界？\n   可以直接告诉我你的构想（如"修仙宗门""末世生存""日式校园恋爱"等），我会据此自由生成世界书条目。\n\n请先告诉我尺度和方向，我们就可以开始创作了！');
        });
        doc.getElementById('importBtn').addEventListener('click', showImportModal);
        const contBtn = doc.getElementById('continueBtn');
        if (contBtn && hasSavedData()) {
          contBtn.style.display = 'inline-block';
          contBtn.addEventListener('click', continueFromSave);
        }
      }

      function renderChatUI() {
        doc.body.innerHTML =
          '<div class="app">' +
          '<div class="topbar topbar--main">' +
          '<div class="topbar-left">' +
          '<h1>' + svgIcon('bolt', 18, 'topbar-ic') + ' 时之写卡器</h1>' +
          '<div class="tab-switcher" id="tabSwitcher">' +
          '<button class="tab-btn active" data-tab="card"><span class="tab-icon">' + svgIcon('mask', 14) + '</span>世界书</button>' +
          '<button class="tab-btn" data-tab="mvu"><span class="tab-icon">' + svgIcon('sliders', 14) + '</span>MVU</button>' +
          '</div>' +
          '</div>' +
          '<div class="topbar-right">' +
          '<div class="ws-dropdown-wrap" id="wsMenuWrap">' +
          '<button class="icon-btn" id="wsMenuBtn" aria-label="工作区" title="工作区（字体大小/导入导出/进度总览）">' + svgIcon('menu', 15) + ' 工作区</button>' +
          '<div class="ws-dropdown" id="wsDropdown"></div>' +
          '</div>' +
          '<span class="phase" id="phaseLabel">0%</span>' +
          '<button class="icon-btn icon-btn-square" id="themeToggleBtn" aria-label="切换明暗主题" title="切换明暗主题">' + svgIcon('moon', 15) + '</button>' +
          '<button class="icon-btn icon-btn-square danger" id="closeBtn" aria-label="关闭" title="关闭">' + svgIcon('close', 16) + '</button>' +
          '</div>' +
          '</div>' +
          '<div class="main">' +
          '<div class="chat-panel" style="position:relative">' +
          // ========== 上下文操作条（合并旧 mod-focus + mod-dash + mvu-info-panel）==========
          '<div class="ctx-bar" id="ctxBar">' +
          '<span class="ctx-stage" id="ctxStage">' + svgIcon('info', 13) + ' <strong>就绪</strong></span>' +
          '<div class="ctx-actions" id="ctxActions"></div>' +
          '</div>' +
          '<div class="chat-messages" id="chatMessages"></div>' +
          '<div class="scroll-btns" id="scrollBtns"><button id="scrollBottomBtn" title="到底部" aria-label="到底部">' + svgIcon('arrowDown', 14) + '</button></div>' +
          '<div class="quick-actions" id="quickActions"></div>' +
          '<div class="chat-input-area">' +
          '<div class="chat-input-row">' +
          '<textarea class="chat-input" id="chatInput" placeholder="描述你想要的世界书条目（任何设定…），我来生成世界书JSON..." rows="1"></textarea>' +
          '<button class="btn-send" id="sendBtn" title="发送" aria-label="发送">' +
          svgIcon('send', 18, 'send-icon') +
          svgIcon('spinner', 18, 'send-spinner ic-spin') +
          '</button>' +
          '</div>' +
          '<div class="chat-input-foot">' +
          '<span class="chat-input-hint" id="chatInputHint"><span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> 发送 · <span class="kbd">Enter</span> 换行</span>' +
          '<span class="chat-input-char-count" id="charCount">0 字 / 2000</span>' +
          '</div>' +
          '</div>' +
          '</div>' +
          '<div class="preview-panel">' +
          '<div class="preview-header">' +
          '<span class="pv-title">' + svgIcon('clipboard', 15) + ' 预览</span>' +
          '<button class="pv-export" id="exportLogBtn" title="导出聊天记录和后台记录" aria-label="导出聊天记录">' + svgIcon('fileExport', 15) + '</button>' +
          '</div>' +
          '<div class="preview-body" id="previewBody"></div>' +
          '</div>' +
          '</div>' +
          '</div>' +
          '<div class="work-toast-layer" id="workToastLayer"></div>';
        bindEvents();
        applyFontScale(_appFontScale);
        initWorkspaceMenu();
        updateCtxBar();
        updateQuickActions();
        renderPreview();
        updateCharCount();
      }

      // ===== Work Toast 工作提示系统 =====
      let workToastSeed = 0;

      function pushWorkToast(text, kind) {
        const layer = doc.getElementById('workToastLayer');
        if (!layer) return;
        const id = ++workToastSeed;
        const toast = doc.createElement('div');
        toast.className = 'work-toast ' + (kind === 'done' ? 'is-done' : 'is-working');
        toast.innerHTML = svgIcon(kind === 'done' ? 'checkCircle' : 'spinner', 18, 'wt-icon' + (kind !== 'done' ? ' ic-spin' : '')) +
          '<span class="wt-text">' + escHtml(text) + '</span>';
        layer.appendChild(toast);
        // 触发动画
        setTimeout(function() {
          toast.classList.add('show');
        }, 10);
        // 3秒后自动消失
        setTimeout(function() {
          toast.classList.remove('show');
          setTimeout(function() {
            if (toast.parentNode) toast.remove();
          }, 300);
        }, 3000);
      }

      // ===== 工作区下拉菜单 =====
      // ⚠️修复：document 级监听器一次性绑定标志——renderChatUI 每次导入卡/继续上次都会重跑
      // bindEvents/initWorkspaceMenu，原先 doc.addEventListener 直接累积（N次导入=N倍监听器+游离DOM引用）
      let _docClickBound = false;
      let _docKeydownBound = false;

      function initWorkspaceMenu() {
        const btn = doc.getElementById('wsMenuBtn');
        const dropdown = doc.getElementById('wsDropdown');
        if (!btn || !dropdown) return;
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          dropdown.classList.toggle('show');
          if (dropdown.classList.contains('show')) renderWorkspaceMenuItems();
        });
        if (!_docClickBound) {
          _docClickBound = true;
          doc.addEventListener('click', function(e) {
            // 事件发生时实时查找 dropdown（body.innerHTML 重建后旧引用会指向游离节点）
            const dd = doc.getElementById('wsDropdown');
            if (dd && (!e.target || !e.target.closest || !e.target.closest('#wsMenuWrap'))) dd.classList.remove('show');
          });
        }
      }

      function renderWorkspaceMenuItems() {
        const dropdown = doc.getElementById('wsDropdown');
        if (!dropdown) return;
        let items = '';
        const hasFirstDef = cardData.first_mes && cardData.first_mes.length > 50;
        const hasEntriesDef = cardData.character_book && cardData.character_book.entries && cardData.character_book.entries.length > 0;
        // ===== 字体大小：可展开的控件（工作区下拉中）=====
        items += '<div class="ws-font-expand collapsed" id="wsFontExpand">' +
          '<div class="ws-font-header" id="wsFontHeader">' + svgIcon('eye', 14) + ' 字体大小 <span style="margin-left:auto;display:inline-flex;align-items:center;gap:6px"><span class="ws-font-arrow">▾</span></span></div>' +
          '<div class="ws-font-body">' +
          '<div class="ws-font-ctrl">' +
          '<button class="ws-font-btn" id="wsFontDec" title="缩小字体">A-</button>' +
          '<span class="ws-font-size-label" id="wsFontSizeLabel">' + Math.round(_appFontScale * 100) + '%</span>' +
          '<button class="ws-font-btn" id="wsFontInc" title="放大字体">A+</button>' +
          '<button class="ws-font-btn" id="wsFontReset" title="恢复默认" style="font-size:.7em">↺</button>' +
          '</div>' +
          '</div>' +
          '</div>';
        // MVU / Tab 切换
        items += '<div class="ws-dropdown-divider"></div>';
        items += '<div class="ws-dropdown-section">视图切换</div>';
        if (currentTab === 'card') {
          items += '<div class="ws-dropdown-item" data-action="switch-tab" data-tab="mvu">' + svgIcon('sliders', 15) + ' 切到 MVU变量·状态栏</div>';
        } else {
          items += '<div class="ws-dropdown-item" data-action="switch-tab" data-tab="card">' + svgIcon('bolt', 15) + ' 切到 世界书生成</div>';
        }
        // 工具（进度总览/开场白/权重/分组）
        items += '<div class="ws-dropdown-divider"></div>';
        items += '<div class="ws-dropdown-section">工具</div>';
        items += '<div class="ws-dropdown-item" data-action="qa-summary">' + svgIcon('chart', 15) + ' 进度总览</div>';
        if (currentTab === 'card' && !hasFirstDef && progress >= 20) {
          items += '<div class="ws-dropdown-item" data-action="qa-opening">' + svgIcon('film', 15) + ' 生成开场白</div>';
        }
        if (hasEntriesDef) {
          items += '<div class="ws-dropdown-item" data-action="qa-weight">' + svgIcon('gauge', 15) + ' 权重可视化</div>';
          items += '<div class="ws-dropdown-item" data-action="qa-group">' + svgIcon('layers', 15) + ' 分组管理</div>';
        }
        items += '<div class="ws-dropdown-divider"></div>';
        items += '<div class="ws-dropdown-section">导入导出</div>';
        items += '<div class="ws-dropdown-item" data-action="export-card" title="导出完整角色卡JSON（含世界书、正则、脚本，chara_card_v3格式）">' + svgIcon('fileExport', 15) + ' 导出角色卡JSON</div>';
        items += '<div class="ws-dropdown-item" data-action="export-log">' + svgIcon('fileExport', 15) + ' 导出聊天记录</div>';
        items += '<div class="ws-dropdown-item" data-action="import-card">' + svgIcon('download', 15) + ' 导入角色卡</div>';
        dropdown.innerHTML = items;
        // ===== 字体大小展开栏：折叠/展开切换 =====
        const fontHeader = doc.getElementById('wsFontHeader');
        const fontExpand = doc.getElementById('wsFontExpand');
        if (fontHeader && fontExpand) {
          fontHeader.addEventListener('click', function(e) {
            e.stopPropagation();
            fontExpand.classList.toggle('collapsed');
          });
        }
        // ===== 字体加减按钮绑定（下拉菜单中）=====
        const wsDecBtn = doc.getElementById('wsFontDec');
        const wsIncBtn = doc.getElementById('wsFontInc');
        const wsResetBtn = doc.getElementById('wsFontReset');
        if (wsDecBtn) wsDecBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          applyFontScale(_appFontScale - _FONT_STEP);
          try {
            saveToStorage();
          } catch (e) { logWarn("renderWorkspaceMenuItems", e); }
        });
        if (wsIncBtn) wsIncBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          applyFontScale(_appFontScale + _FONT_STEP);
          try {
            saveToStorage();
          } catch (e) { logWarn("renderWorkspaceMenuItems", e); }
        });
        if (wsResetBtn) wsResetBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          applyFontScale(1);
          try {
            saveToStorage();
          } catch (e) { logWarn("renderWorkspaceMenuItems", e); }
        });
        // 应用当前字体缩放状态到下拉控件（按钮禁用/百分比）
        applyFontScale(_appFontScale);
        // 绑定点击
        dropdown.querySelectorAll('.ws-dropdown-item').forEach(function(item) {
          item.addEventListener('click', function() {
            const action = this.getAttribute('data-action');
            dropdown.classList.remove('show');
            if (action === 'switch-tab') switchTab(this.getAttribute('data-tab'));
            else if (action === 'export-card') exportCardJson();
            else if (action === 'export-log') {
              const btn = doc.getElementById('exportLogBtn');
              if (btn) btn.click();
            } else if (action === 'import-card') showImportModal();
            else if (action === 'qa-summary') handleQuickAction('summary');
            else if (action === 'qa-opening') handleQuickAction('opening');
            else if (action === 'qa-weight') handleQuickAction('weight');
            else if (action === 'qa-group') handleQuickAction('group');
          });
        });
      }

      function bindEvents() {
        // ⚠️竞态修复：生成期间关闭编辑器 → 旧闭包的 callAI 返回后仍会写 storage，与用户重新打开的
        // 新闭包形成双写者竞态（AI 修改可能被覆盖丢失）。改为关闭前二次确认
        doc.getElementById('closeBtn').addEventListener('click', function() {
          if (isGenerating) {
            const okToClose = window.confirm('AI 正在生成中，关闭后本次生成的内容可能丢失（后台任务仍会继续写数据）。\n确定要关闭吗？');
            if (!okToClose) return;
            closeModal();
            // 后台任务仍在运行：保留 window.__* 访问器（后台闭包仍经其读写数据），下次 openEditor 覆盖
          } else {
            closeModal();
            // ⚠️无后台任务：立即释放 window.__* 持有的整份 cardData + 聊天历史引用，防会话数据泄漏
            _releaseEditorGlobals();
          }
        });
        const input = doc.getElementById('chatInput');
        const sendBtn = doc.getElementById('sendBtn');
        sendBtn.addEventListener('click', handleSend);
        // 键盘事件：
        //   · 桌面：单纯 Enter = 换行（textarea 默认行为，不拦截）；Ctrl/Cmd + Enter = 发送
        //   · 移动端：软键盘 Enter/Send 键 = 换行（textarea 默认行为），点击纸飞机按钮才发送
        //   · 通用：中文/日文输入法合成中（isComposing）一律不触发发送，避免候选上屏阶段误发送
        //   · Shift+Enter 与 Ctrl+Enter 区分：Shift 保留给"语义换段"（仍换行），Ctrl/Cmd 才发送
        input.addEventListener('keydown', function(e) {
          if (e.key !== 'Enter') return;
          // 合成中：直接 return，交给 textarea 默认换行
          if (e.isComposing) return;
          // Ctrl(Mac:Cmd) + Enter → 发送
          const sendModifier = e.ctrlKey || e.metaKey;
          if (sendModifier) {
            e.preventDefault();
            handleSend();
          }
          // 其他情况（纯 Enter / Shift+Enter / Alt+Enter 等）：不 prevent，textarea 默认换行
        });
        // 提示：在 sendBtn title / 底部 hint 动态加上正确的修饰键（Mac=⌘, Win/Linux=Ctrl）
        try {
          const _ua = typeof navigator !== 'undefined' ? (navigator.platform || navigator.userAgent || '') : '';
          const _isMac = /Mac|iPhone|iPad|iPod/i.test(_ua);
          const _mod = _isMac ? '⌘' : 'Ctrl';
          sendBtn.setAttribute('title', '发送（' + _mod + '+Enter）');
          sendBtn.setAttribute('aria-label', '发送（' + _mod + '+Enter）');
          const _hintEl = doc.getElementById('chatInputHint');
          if (_hintEl) {
            _hintEl.innerHTML = '<span class="kbd">' + _mod + '</span>+<span class="kbd">Enter</span> 发送 · <span class="kbd">Enter</span> 换行';
          }
        } catch (_hm) {}
        input.addEventListener('input', function() {
          updateCharCount();
          updateSendBtnPulse();
          // 自动变高：重置高度后按内容撑开，上限由 CSS max-height 控制（约5行）
          this.style.height = 'auto';
          this.style.height = this.scrollHeight + 'px';
        });
        // Esc：关闭最上层模态框
        if (!_docKeydownBound) {
          _docKeydownBound = true;
          doc.addEventListener('keydown', function(e) {
            if (e.key !== 'Escape') return;
            // 1) 先尝试关闭最上层模态框（json-modal / modal）
            const modals = doc.querySelectorAll('.json-modal, .modal');
            for (let i = modals.length - 1; i >= 0; i--) {
              if (modals[i].parentNode) {
                modals[i].remove();
                e.preventDefault();
                return;
              }
            }
          });
        }
        const exportLogBtn = doc.getElementById('exportLogBtn');
        if (exportLogBtn) {
          exportLogBtn.addEventListener('click', exportChatLogs);
        }
        const qBtns = doc.querySelectorAll('.quick-btn');
        for (let i = 0; i < qBtns.length; i++) {
          qBtns[i].addEventListener('click', function() {
            const action = this.getAttribute('data-action');
            handleQuickAction(action);
          });
        }
        // ctx-bar 模块按钮（updateCtxBar 内部已绑定，这里兜底）
        const ctxMods = doc.querySelectorAll('.ctx-mod');
        for (let cm = 0; cm < ctxMods.length; cm++) {
          if (!ctxMods[cm].getAttribute('data-bound')) {
            ctxMods[cm].setAttribute('data-bound', '1');
            ctxMods[cm].addEventListener('click', function() {
              const mod = this.getAttribute('data-mod');
              if (mod) handleQuickAction(mod);
            });
          }
        }
        const sbBtn = doc.getElementById('scrollBottomBtn');
        if (sbBtn) {
          sbBtn.addEventListener('click', scrollChat);
        }
        const cm = doc.getElementById('chatMessages');
        if (cm) {
          cm.addEventListener('scroll', function() {
            const btns = doc.getElementById('scrollBtns');
            if (btns) {
              if (cm.scrollTop < cm.scrollHeight - cm.clientHeight - 100) {
                btns.classList.add('show');
              } else {
                btns.classList.remove('show');
              }
            }
          });
        }
        // ========== 移动端左右滑动切换：对话页左滑进预览，预览页右滑回对话（跟手+阻尼+阈值）==========
        (function setupSwipeNav() {
          const mainEl = doc.querySelector('.main');
          if (!mainEl) return;
          const win = doc.defaultView || window;
          const chatPanel = mainEl.querySelector('.chat-panel');
          const previewPanel = mainEl.querySelector('.preview-panel');
          if (!chatPanel || !previewPanel) return;
          const SWIPE_THRESHOLD = 55;   // 超过该位移才切换
          const EDGE_RATIO = 0.28;      // 首页/末页继续拖动时的阻尼系数
          let startX = 0, startY = 0, lock = null, dx = 0, fromPanel = 'chat';

          // 起点是否落在可横向滚动的容器内（如快捷按钮横滚条/宽表格），若是则不拦截手势
          function inHScroller(node) {
            let el = node;
            while (el && el !== mainEl && el.nodeType === 1) {
              const ovx = win.getComputedStyle(el).overflowX;
              if ((ovx === 'auto' || ovx === 'scroll') && el.scrollWidth - el.clientWidth > 4) return true;
              el = el.parentNode;
            }
            return false;
          }
          function applyTransform() {
            const w = mainEl.clientWidth;
            if (fromPanel === 'chat') {
              chatPanel.style.transform = 'translateX(' + dx + 'px)';
              previewPanel.style.transform = 'translateX(' + (w + dx) + 'px)';
            } else {
              chatPanel.style.transform = 'translateX(' + (-w + dx) + 'px)';
              previewPanel.style.transform = 'translateX(' + dx + 'px)';
            }
          }
          function finishSwipe() {
            if (lock !== 'horizontal') { lock = null; return; }
            mainEl.classList.remove('swiping'); // 恢复过渡；内联 transform 仍占住当前手势位置
            let goOther = false;
            if (fromPanel === 'chat' && dx < -SWIPE_THRESHOLD) goOther = true;
            if (fromPanel === 'preview' && dx > SWIPE_THRESHOLD) goOther = true;
            // chat 达标→进预览(tab-preview)；preview 达标→回对话(移除)；未达标保持原页
            mainEl.classList.toggle('tab-preview', fromPanel === 'chat' ? goOther : !goOther);
            // 双 rAF：先让浏览器按内联位置绘制一帧（与手指离开点一致，无跳变），再清内联触发 CSS 过渡
            win.requestAnimationFrame(function () {
              win.requestAnimationFrame(function () {
                chatPanel.style.transform = '';
                previewPanel.style.transform = '';
              });
            });
            lock = null;
          }
          mainEl.addEventListener('touchstart', function (e) {
            if (!win.matchMedia('(max-width:768px)').matches) { lock = 'skip'; return; }
            const t = e.touches[0], node = e.target;
            startX = t.clientX; startY = t.clientY; lock = null; dx = 0;
            if (node.closest && node.closest('input,textarea,select,[contenteditable="true"]')) { lock = 'skip'; return; }
            if (inHScroller(node)) { lock = 'skip'; return; }
            fromPanel = mainEl.classList.contains('tab-preview') ? 'preview' : 'chat';
          }, { passive: true });
          mainEl.addEventListener('touchmove', function (e) {
            if (lock === 'skip' || lock === 'vertical') return;
            const t = e.touches[0];
            const rawDx = t.clientX - startX, rawDy = t.clientY - startY;
            if (lock !== 'horizontal') {
              if (Math.abs(rawDx) < 6 && Math.abs(rawDy) < 6) return;
              // 水平意图明显强于垂直才接管，保证聊天/预览的上下滚动不受影响
              if (Math.abs(rawDx) > Math.abs(rawDy) * 1.2) {
                lock = 'horizontal';
                mainEl.classList.add('swiping');
              } else { lock = 'vertical'; return; }
            }
            dx = rawDx;
            if (fromPanel === 'chat' && dx > 0) dx = rawDx * EDGE_RATIO;
            if (fromPanel === 'preview' && dx < 0) dx = rawDx * EDGE_RATIO;
            applyTransform();
            if (e.cancelable) e.preventDefault();
          }, { passive: false });
          mainEl.addEventListener('touchend', finishSwipe, { passive: true });
          mainEl.addEventListener('touchcancel', finishSwipe, { passive: true });
        })();
        // ========== Tab 切换按钮：角色卡 / MVU状态栏，完全隔离两边聊天记录与AI上下文 ==========
        const tabBtns = doc.querySelectorAll('.tab-btn');
        for (let tbi = 0; tbi < tabBtns.length; tbi++) {
          tabBtns[tbi].addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            if (isGenerating && targetTab !== activeTab) {
              showToast('AI 正在生成中，请稍候再切换 Tab', 'warning');
              return;
            }
            switchTab(targetTab);
          });
        }
      }

      let _inputTokenTimer = null;
      function updateCharCount() {
        const input = doc.getElementById('chatInput');
        const cnt = doc.getElementById('charCount');
        if (!input || !cnt) return;
        const len = input.value.length;
        // 字数即时刷新（O(1)）；token 估算走正则分词，按键高频触发时 150ms 防抖
        cnt.setAttribute('data-chars', String(len));
        cnt.textContent = len + ' 字 / 2000';
        cnt.className = 'chat-input-char-count';
        if (len > 1500) cnt.classList.add('warn');
        if (len > 1900) cnt.classList.add('over');
        if (_inputTokenTimer) clearTimeout(_inputTokenTimer);
        _inputTokenTimer = setTimeout(function() {
          _inputTokenTimer = null;
          const input2 = doc.getElementById('chatInput');
          const cnt2 = doc.getElementById('charCount');
          if (!input2 || !cnt2) return;
          const chars = Number(cnt2.getAttribute('data-chars') || '0');
          if (!chars) {
            cnt2.textContent = '0 字 / 2000';
            return;
          }
          cnt2.textContent = chars + ' 字 · ~' + countTokens(input2.value) + 'T / 2000';
        }, CONFIG.INPUT_TOKEN_DEBOUNCE_MS);
      }

      function updateSendBtnPulse() {
        const input = doc.getElementById('chatInput');
        const btn = doc.getElementById('sendBtn');
        if (!input || !btn) return;
        const hasContent = input.value.trim().length > 0;
        btn.classList.toggle('send-btn-pulse', hasContent && !btn.disabled);
      }

      // ===== 导入模态框 =====
      function showImportModal() {
        const h = '<div class="modal" id="importModal">' +
          '<div class="modal-content">' +
          '<h3 style="color:var(--accent-deep);margin-bottom:4px;font-size:1em;display:inline-flex;align-items:center;gap:7px">' + svgIcon('download', 17) + ' 导入角色卡</h3>' +
          '<p style="font-size:.78em;color:var(--ink-soft);margin-bottom:8px">导入现有角色卡继续编辑，支持chara_card_v2/v3格式</p>' +
          '<div class="import-tabs">' +
          '<div class="import-tab active" data-tab="paste">' + svgIcon('clipboard', 14) + ' 粘贴JSON</div>' +
          '<div class="import-tab" data-tab="file">' + svgIcon('folderOpen', 14) + ' 选择文件</div>' +
          '</div>' +
          '<div id="importTabPaste">' +
          '<textarea class="chat-input" id="importTextarea" placeholder="在此粘贴角色卡JSON..." rows="8" style="min-height:120px;font-family:var(--font-mono);font-size:.75em"></textarea>' +
          '</div>' +
          '<div id="importTabFile" style="display:none">' +
          '<div class="import-dropzone" id="importDropzone">' +
          '<div class="dz-icon">' + svgIcon('folderOpen', 36) + '</div>' +
          '<div class="dz-text">点击选择文件或拖拽JSON文件到此处</div>' +
          '<input type="file" id="importFile" accept=".json,application/json" style="display:none">' +
          '</div>' +
          '<div id="importFileInfo" style="font-size:.72em;color:var(--ink-soft);text-align:center;display:none"></div>' +
          '</div>' +
          '<div class="modal-actions">' +
          '<button class="btn btn-ghost" id="importCloseBtn">取消</button>' +
          '<button class="btn btn-primary" id="importConfirmBtn">' + svgIcon('check', 15) + ' 导入并开始</button>' +
          '</div>' +
          '</div></div>';
        const tmp = doc.createElement('div');
        tmp.innerHTML = h;
        const modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);
        modalEl.addEventListener('click', function(e) {
          if (e.target === modalEl) modalEl.remove();
        });
        doc.getElementById('importCloseBtn').addEventListener('click', function() {
          modalEl.remove();
        });

        const tabs = modalEl.querySelectorAll('.import-tab');
        tabs.forEach(function(t) {
          t.addEventListener('click', function() {
            tabs.forEach(function(x) {
              x.classList.remove('active');
            });
            t.classList.add('active');
            const tab = t.getAttribute('data-tab');
            doc.getElementById('importTabPaste').style.display = tab === 'paste' ? 'block' : 'none';
            doc.getElementById('importTabFile').style.display = tab === 'file' ? 'block' : 'none';
          });
        });

        const dz = doc.getElementById('importDropzone');
        const fileInput = doc.getElementById('importFile');
        if (dz && fileInput) {
          dz.addEventListener('click', function() {
            fileInput.click();
          });
          fileInput.addEventListener('change', function(e) {
            const file = e.target.files && e.target.files[0];
            if (file) handleImportFile(file);
          });
        }

        doc.getElementById('importConfirmBtn').addEventListener('click', function() {
          const text = doc.getElementById('importTextarea').value.trim();
          if (!text) {
            showToast('请粘贴JSON内容或选择文件', 'warning');
            return;
          }
          try {
            const data = JSON.parse(text);
            importCardData(data);
            modalEl.remove();
          } catch (e) {
            showToast('JSON解析失败: ' + e.message, 'error');
          }
        });
      }

      function handleImportFile(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
          try {
            const data = JSON.parse(e.target.result);
            const info = doc.getElementById('importFileInfo');
            if (info) {
              info.style.display = 'block';
              const name = (data.data && data.data.name) || data.name || '未知';
              info.textContent = '✅ 已加载: ' + name + ' (' + file.name + ')';
            }
            doc.getElementById('importTextarea').value = e.target.result;
          } catch (err) {
            showToast('文件解析失败: ' + err.message, 'error');
          }
        };
        reader.readAsText(file);
      }

      function importCardData(data) {
        const rawData = data;
        const cd = data.data || data;
        if (!cd || typeof cd !== 'object') {
          showToast('无效的角色卡格式', 'error');
          return;
        }

        cardData.name = cd.name || '';
        cardData.description = cd.description || '';
        cardData.personality = cd.personality || '';
        cardData.scenario = cd.scenario || '';
        cardData.first_mes = cd.first_mes || '';
        cardData.mes_example = cd.mes_example || '';
        cardData.creator_notes = cd.creator_notes || (rawData.creatorcomment !== undefined ? rawData.creatorcomment : '');
        cardData.system_prompt = cd.system_prompt || '';
        cardData.creator = cd.creator || '时之写卡器';
        cardData.character_version = cd.character_version !== undefined ? cd.character_version : '';
        cardData.alternate_greetings = cd.alternate_greetings || [];
        cardData.extensions = {
          talkativeness: '0.5',
          fav: false,
          world: cd.extensions && cd.extensions.world ? cd.extensions.world : '',
          depth_prompt: cd.extensions && cd.extensions.depth_prompt ? cd.extensions.depth_prompt : {
            prompt: '',
            depth: 0,
            role: 'system'
          },
          regex_scripts: normalizeRegexScripts(cd.extensions && cd.extensions.regex_scripts),
          'xiaobaix-template': cd.extensions && cd.extensions['xiaobaix-template'] ? cd.extensions['xiaobaix-template'] : {
            enabled: false,
            template: '',
            customRegex: '',
            disableParsers: false,
            skipFirstMessage: false,
            recentMessageCount: 0,
            limitToRecentMessages: false
          },
          tavern_helper: (cd.extensions && cd.extensions.tavern_helper) ?
            {
              scripts: (cd.extensions.tavern_helper.scripts || []),
              variables: (cd.extensions.tavern_helper.variables || {})
            } :
            {
              scripts: [],
              variables: {}
            }
        };
        cardData.group_only_greetings = cd.group_only_greetings || [];
        // CCv3 新字段：导入时一并读取（nickname/多语言注释/来源/时间戳），保证导入→编辑→导出不丢失
        cardData.nickname = cd.nickname || '';
        cardData.creator_notes_multilingual = (cd.creator_notes_multilingual && typeof cd.creator_notes_multilingual === 'object' && !Array.isArray(cd.creator_notes_multilingual)) ?
          cd.creator_notes_multilingual : {};
        cardData.source = Array.isArray(cd.source) ? cd.source : [];
        cardData.creation_date = (typeof cd.creation_date === 'number') ? cd.creation_date :
          ((rawData && typeof rawData.creation_date === 'number') ? rawData.creation_date : 0);
        cardData.modification_date = (typeof cd.modification_date === 'number') ? cd.modification_date :
          ((rawData && typeof rawData.modification_date === 'number') ? rawData.modification_date : 0);

        // 导入时无论原卡是否含 character_book 都重置，避免残留旧卡条目
        cardData.character_book = {
          entries: []
        };
        // ⚠️完善：兼容 ST 独立世界书 JSON 导入（官方"世界书导入/导出"格式，顶层 entries 对象/数组，无 data/character_book）
        // 归一化后转成 character_book，复用下方同一套条目规范化逻辑；顶层元数据一并保留
        if (!cd.character_book && cd.entries && (Array.isArray(cd.entries) || (typeof cd.entries === 'object' && cd.entries !== null))) {
          const _wiPartial = { entries: cd.entries };
          try { normalizeWorldInfoJSON(_wiPartial); } catch (_eWi) {}
          if (Array.isArray(_wiPartial.entries)) {
            const _wiName = (typeof cd.name === 'string' && cd.name) ? cd.name : (cardData.name || '世界书');
            cd.character_book = {
              name: _wiName,
              entries: _wiPartial.entries
            };
            if (typeof cd.description === 'string' && cd.description) cd.character_book.description = cd.description;
            if (typeof cd.scan_depth === 'number' && !isNaN(cd.scan_depth)) cd.character_book.scan_depth = cd.scan_depth;
            if (typeof cd.token_budget === 'number' && !isNaN(cd.token_budget)) cd.character_book.token_budget = cd.token_budget;
            if (typeof cd.recursive_scanning === 'boolean') cd.character_book.recursive_scanning = cd.recursive_scanning;
          }
        }
        // ⚠️完善：保留 Lorebook 顶层元数据（description/scan_depth/token_budget/recursive_scanning）
        // 与 buildExportCard 导出逻辑闭环：有明确值才写，无值时省略（ST 按全局设置处理）
        if (cd.character_book && typeof cd.character_book === 'object') {
          if (typeof cd.character_book.description === 'string' && cd.character_book.description) cardData.character_book.description = cd.character_book.description;
          if (typeof cd.character_book.scan_depth === 'number' && !isNaN(cd.character_book.scan_depth)) cardData.character_book.scan_depth = cd.character_book.scan_depth;
          if (typeof cd.character_book.token_budget === 'number' && !isNaN(cd.character_book.token_budget)) cardData.character_book.token_budget = cd.character_book.token_budget;
          if (typeof cd.character_book.recursive_scanning === 'boolean') cardData.character_book.recursive_scanning = cd.character_book.recursive_scanning;
        }
        if (cd.character_book) {
          cardData.character_book = {
            entries: (cd.character_book.entries || []).map(function(e, i) {
              // 通过模板获取默认值（支持 MVU [InitVar] 等前缀）
              const comment = e.comment || '';
              const tmpl = getEntryTemplate(comment);
              const defaultPos = tmpl ? tmpl.position : 4;
              const defaultDepth = tmpl ? tmpl.depth : 4;
              const defaultOrder = tmpl ? tmpl.order : 100;
              const defaultEnabled = tmpl && tmpl.enabled !== undefined ? tmpl.enabled : true;
              // [InitVar] 条目 enabled=false（MVU 只读取禁用的 initvar 条目进行初始化）
              const isInitVar = _isInitVarComment(comment, e.content);
              const isVarList = comment.indexOf('变量列表') >= 0;
              const enabledVal = isInitVar ? false : (e.enabled !== undefined ? e.enabled : defaultEnabled);
              const ext = e.extensions || {};
              return {
                comment: comment,
                content: isVarList ? normalizeVarListContent(e.content || '') : (e.content || ''),
                keys: e.keys || [],
                secondary_keys: e.secondary_keys || (tmpl && tmpl.secondary_keys) || [],
                constant: e.constant !== undefined ? e.constant : (tmpl ? tmpl.constant : false),
                selective: e.selective !== undefined ? e.selective : (tmpl ? tmpl.selective : true),
                insertion_order: e.insertion_order || defaultOrder,
                enabled: enabledVal,
                use_regex: e.use_regex !== undefined ? e.use_regex : true,
                position: ext.position !== undefined ? ext.position : defaultPos,
                extensions: {
                  position: ext.position !== undefined ? ext.position : defaultPos,
                  depth: ext.depth !== undefined ? ext.depth : defaultDepth,
                  role: ext.role !== undefined ? ext.role : 0,
                  probability: ext.probability !== undefined ? ext.probability : (tmpl ? tmpl.probability : 100),
                  useProbability: ext.useProbability !== undefined ? ext.useProbability : (ext.use_probability !== undefined ? ext.use_probability : (tmpl ? tmpl.useProbability : false)),
                  selectiveLogic: ext.selectiveLogic !== undefined ? ext.selectiveLogic : (tmpl ? tmpl.selectiveLogic : 0),
                  group: ext.group || (tmpl ? tmpl.group : '') || '',
                  group_weight: ext.group_weight !== undefined ? ext.group_weight : (ext.groupWeight !== undefined ? ext.groupWeight : 100),
                  prevent_recursion: ext.prevent_recursion !== undefined ? ext.prevent_recursion : (tmpl ? tmpl.prevent_recursion : false),
                  exclude_recursion: ext.exclude_recursion !== undefined ? ext.exclude_recursion : (tmpl ? tmpl.exclude_recursion : false),
                  delay_until_recursion: ext.delay_until_recursion !== undefined ? ext.delay_until_recursion : (tmpl ? tmpl.delay_until_recursion : false),
                  /* 改进T：保留原值 */
                  use_group_scoring: ext.use_group_scoring !== undefined ? ext.use_group_scoring : false,
                  vectorized: ext.vectorized !== undefined ? ext.vectorized : false,
                  sticky: ext.sticky !== undefined && ext.sticky !== null ? ext.sticky : 0,
                  cooldown: ext.cooldown !== undefined && ext.cooldown !== null ? ext.cooldown : 0,
                  delay: ext.delay !== undefined && ext.delay !== null ? ext.delay : 0,
                  scan_depth: ext.scan_depth !== undefined ? ext.scan_depth : (tmpl ? tmpl.scan_depth : null),
                  match_whole_words: ext.match_whole_words !== undefined ? ext.match_whole_words : null,
                  case_sensitive: ext.case_sensitive !== undefined ? ext.case_sensitive : null,
                  automation_id: ext.automation_id || '',
                  display_index: ext.display_index !== undefined ? ext.display_index : i,
                  outlet_name: ext.outlet_name || '',
                  triggers: ext.triggers || [],
                  ignore_budget: ext.ignore_budget !== undefined ? ext.ignore_budget : false,
                  match_persona_description: ext.match_persona_description !== undefined ? ext.match_persona_description : false,
                  match_character_description: ext.match_character_description !== undefined ? ext.match_character_description : false,
                  match_character_personality: ext.match_character_personality !== undefined ? ext.match_character_personality : false,
                  match_character_depth_prompt: ext.match_character_depth_prompt !== undefined ? ext.match_character_depth_prompt : false,
                  match_scenario: ext.match_scenario !== undefined ? ext.match_scenario : false,
                  match_creator_notes: ext.match_creator_notes !== undefined ? ext.match_creator_notes : false
                }
              };
            })
          };
        }

        cardGenerated = !!(cardData.name && (cardData.description || (cardData.character_book.entries && cardData.character_book.entries.length > 0)));
        progress = calcProgress();
        // ========== Tab 隔离：导入角色卡时重置两边聊天记录（回到全新起始状态） ==========
        chatSessions.card.messages = [];
        chatSessions.mvu.messages = [];
        cardMessages = chatSessions.card.messages;
        mvuMessages = chatSessions.mvu.messages;
        // 同步到全局 messages 别名（向后兼容）
        messages = [];
        // 如果当前不在角色卡Tab，自动切回角色卡Tab（导入后默认从角色卡开始）
        const needSwitchBack = (activeTab !== 'card');

        renderChatUI();
        applyFontScale(_appFontScale);
        if (needSwitchBack) {
          // 如果当前是MVU Tab，则重置回角色卡Tab（导入新角色，MVU需重新配置）
          activeTab = 'card';
          currentTab = 'card';
          if (typeof window !== 'undefined') window.__tab_activeTab = 'card';
        }
        // 恢复Tab激活态（renderChatUI 每次会重新生成Tab按钮）
        const tabBtnsAfter = doc.querySelectorAll('.tab-btn');
        for (let tbai = 0; tbai < tabBtnsAfter.length; tbai++) {
          tabBtnsAfter[tbai].classList.toggle('active', tabBtnsAfter[tbai].getAttribute('data-tab') === activeTab);
        }
        const entriesLen = (cardData.character_book && cardData.character_book.entries) ? cardData.character_book.entries.length : 0;
        const greeting = '你好！已成功导入角色卡「' + (cardData.name || '未命名') + '」🎭\n\n' +
          '卡片数据：描述 ' + (cardData.description || '').length + ' 字、开场白 ' + (cardData.first_mes || '').length + ' 字、世界书 ' + entriesLen + ' 条\n\n' +
          '**我已读取了角色卡的全部内容，可以直接进行增/删/改操作：**\n' +
          '• 想修改某个字段？直接说"把名字改成XXX"或"修改世界观描述"\n' +
          '• 想添加世界书条目？说"添加一个XX的条目"\n' +
          '• 想修改条目？说"把XX改成XXX"或"修改XXX条目"\n' +
          '• 想删除条目？说"删掉XXX条目"\n\n' +
          '（MVU变量/状态栏请切换到「MVU变量状态栏」Tab重新制作）\n\n' +
          '请告诉我你想做什么！';
        addAssistantMsg(greeting);
        saveToStorage();
      }

      // ============================================================================
      // SECTION 9  持久化 & 酒馆 SillyTavern API 适配层
      // ============================================================================
      // ===== localStorage 持久化 =====
      const STORAGE_KEY = 'modelo_char_generator_state';

      // ===== 创建全新空 cardData 对象（写新卡/新建工作区时用，保证彻底无旧值残留）=====
      //   模板与 openEditor 入口处 L8154 初始化完全一致，保证新建与首次打开状态等价
      function createEmptyCardData() {
        return {
          name: '',
          description: '',
          personality: '',
          scenario: '',
          first_mes: '',
          creator_notes: '',
          system_prompt: '',
          creator: '时之写卡器',
          character_version: '',
          alternate_greetings: [],
          group_only_greetings: [],
          extensions: {
            talkativeness: '0.5',
            fav: false,
            world: '',
            depth_prompt: {
              prompt: '',
              depth: 4,
              role: 'system'
            },
            regex_scripts: [],
            'xiaobaix-template': {
              enabled: false,
              template: '',
              customRegex: '',
              disableParsers: false,
              skipFirstMessage: false,
              recentMessageCount: 0,
              limitToRecentMessages: false
            },
            tavern_helper: {
              scripts: [],
              variables: {}
            }
          },
          character_book: {
            entries: []
          }
        };
      }

      // ===== 「开始创作」全新开始：重置角色卡 + 聊天记录 + 本地存档（不重置字体、不切Tab）=====
      function resetAllWorkForNewCard() {
        // 1. 角色卡数据：替换为全新空对象（彻底切断旧引用）
        cardData = createEmptyCardData();
        if (typeof window !== 'undefined') window.__cardData = cardData;

        // 2. 聊天记录：两边 Tab 全部清空 + 所有别名同步（兼容旧代码对 messages/cardMessages/mvuMessages 的直接引用）
        chatSessions.card = {
          messages: [],
          mode: 'normal'
        };
        chatSessions.mvu = {
          messages: []
        };
        cardMessages = chatSessions.card.messages;
        mvuMessages = chatSessions.mvu.messages;
        // 全局 messages 兼容别名：默认回到角色卡 Tab（与首次打开时 L8220 一致）
        messages = chatSessions.card.messages;

        // 3. 当前 Tab 强制回到「角色卡生成」（与首次打开 welcome 起点一致）
        activeTab = 'card';
        currentTab = 'card';
        if (typeof window !== 'undefined') {
          window.__tab_activeTab = activeTab;
        }

        // 4. 进度/生成状态归零
        cardGenerated = false;
        progress = 0;
        moduleProgress = {
          total: 0,
          constant: 0,
          triggered: 0,
          grouped: 0,
          has_key: 0,
          has_content: 0
        };
        // 5. 撤回快照 / AI 队列 归零
        try {
          if (typeof cardDataSnapshots !== 'undefined') {
            cardDataSnapshots = {
              card: {},
              mvu: {}
            };
          }
        } catch (_eSnap) {}
        try {
          _aiChatQueueMode = false;
        } catch (_eQ) {}
        try {
          _aiChatNotesQueue = [];
        } catch (_eQ) {}
        // 7. localStorage 存档：移除旧 STORAGE_KEY，避免"关闭重开又带回来旧卡"
        clearStorage();
      }

      // 全局字体缩放：0.85 (最小) ~ 5.0 (最大，接近无限大)，步进0.1
      const _MIN_FONT_SCALE = 0.85,
        _MAX_FONT_SCALE = 5.0,
        _FONT_STEP = 0.1;
      let _appFontScale = 1;

      function applyFontScale(scale) {
        if (typeof scale !== 'number' || isNaN(scale)) scale = 1;
        if (scale < _MIN_FONT_SCALE) scale = _MIN_FONT_SCALE;
        if (scale > _MAX_FONT_SCALE) scale = _MAX_FONT_SCALE;
        // 精确到2位小数，避免浮点累计误差
        scale = Math.round(scale * 100) / 100;
        _appFontScale = scale;
        // 修复：必须作用到 iframe 内的 doc，而非外层 document
        const docEl = (doc && doc.documentElement) ? doc.documentElement : document.documentElement;
        if (docEl) docEl.style.setProperty('--app-font-scale', String(scale));
        // 同步更新下拉菜单中的字体控件（如果已打开）
        const wsLabel = doc ? doc.getElementById('wsFontSizeLabel') : null;
        const wsDecBtn = doc ? doc.getElementById('wsFontDec') : null;
        const wsIncBtn = doc ? doc.getElementById('wsFontInc') : null;
        const wsResetBtn = doc ? doc.getElementById('wsFontReset') : null;
        if (wsLabel) wsLabel.textContent = Math.round(scale * 100) + '%';
        if (wsDecBtn) wsDecBtn.disabled = scale <= _MIN_FONT_SCALE + 0.001;
        if (wsIncBtn) wsIncBtn.disabled = scale >= _MAX_FONT_SCALE - 0.001;
      }

      function saveToStorage() {
        try {
          // 同步别名引用（chatSessions 是唯一真源）
          cardMessages = chatSessions.card.messages;
          mvuMessages = chatSessions.mvu.messages;

          const state = {
            cardData: cardData,
            activeTab: activeTab || 'card',
            chatSessions: chatSessions,
            currentTab: activeTab || 'card',
            cardGenerated: cardGenerated,
            progress: progress,
            moduleProgress: moduleProgress,
            fontScale: typeof _appFontScale === 'number' ? _appFontScale : 1,
            timestamp: Date.now()
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
          if (e.name === 'QuotaExceededError') {
            console.warn('[storage] Quota exceeded, 尝试精简冗余字段后重试...');
            /* 改进E：去掉向后兼容的冗余副本字段（chatSessions已是唯一真源），仅保留核心数据重试一次 */
            try {
              const slimState = {
                cardData: cardData,
                activeTab: activeTab || 'card',
                chatSessions: chatSessions,
                cardGenerated: cardGenerated,
                progress: progress,
                moduleProgress: moduleProgress,
                fontScale: typeof _appFontScale === 'number' ? _appFontScale : 1,
                timestamp: Date.now()
              };
              localStorage.setItem(STORAGE_KEY, JSON.stringify(slimState));
              console.warn('[storage] 精简重试成功（已去除向后兼容冗余字段）');
              if (typeof showToast === 'function') {
                try {
                  showToast('存储空间不足，已精简冗余字段后保存成功', 'warning');
                } catch (_) {}
              }
            } catch (e2) {
              console.error('[storage] 精简重试仍失败:', e2 && e2.message);
              if (typeof showToast === 'function') {
                try {
                  showToast('⚠️存储空间不足，数据未能保存！请尽快写入酒馆避免丢失', 'error');
                } catch (_) {}
              }
            }
          } else {
            console.warn('[storage] save error:', e && e.message);
          }
        }
      }

      function loadFromStorage() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return false;
          const state = JSON.parse(raw);
          if (state.cardData) {
            cardData = state.cardData;
            if (typeof window !== 'undefined') window.__cardData = cardData;
            // 防御性恢复结构：避免旧版/损坏数据导致后续访问崩溃
            if (!cardData.character_book) cardData.character_book = {
              entries: []
            };
            if (!cardData.character_book.entries) cardData.character_book.entries = [];
            if (!cardData.extensions) cardData.extensions = {};
            cardData.extensions.depth_prompt = normalizeDepthPrompt(cardData.extensions.depth_prompt, 0);
            // 顶层 depth_prompt（V3 字段）同样需要规范化：防止它是字符串导致后续 buildExportCard / mergePartial 崩溃
            if (typeof cardData.depth_prompt !== 'undefined') {
              cardData.depth_prompt = normalizeDepthPrompt(cardData.depth_prompt, 0);
            } else {
              // 与 extensions.depth_prompt 双向同步，保持旧代码（直接读 cd.depth_prompt 的）一致
              cardData.depth_prompt = normalizeDepthPrompt(cardData.extensions.depth_prompt, 0);
            }
            if (!cardData.extensions.tavern_helper) cardData.extensions.tavern_helper = {
              scripts: [],
              variables: {}
            };
            if (!cardData.extensions.tavern_helper.scripts) cardData.extensions.tavern_helper.scripts = [];
            if (!cardData.alternate_greetings) cardData.alternate_greetings = [];

            // ========== Tab 隔离：优先加载 chatSessions 对象，其次从独立字段重建 ==========
            if (state.chatSessions && typeof state.chatSessions === 'object') {
              // 最新版：从 chatSessions 对象还原
              chatSessions.card = Object.assign({
                  messages: [],
                  mode: 'normal'
                },
                state.chatSessions.card || {}
              );
              chatSessions.mvu = Object.assign({
                  messages: []
                },
                state.chatSessions.mvu || {}
              );
            } else {
              // 上一版/旧版：从独立字段或 messages 字段迁移
              let migratedCardMsgs = [];
              if (state.cardMessages && Array.isArray(state.cardMessages)) {
                migratedCardMsgs = state.cardMessages;
              } else if (state.messages && Array.isArray(state.messages)) {
                // 最早的单会话版本：原来的 messages 全部迁移到角色卡Tab
                migratedCardMsgs = state.messages.slice();
              }
              chatSessions.card = {
                messages: migratedCardMsgs,
                mode: 'normal'
              };
              chatSessions.mvu = {
                messages: (state.mvuMessages && Array.isArray(state.mvuMessages)) ? state.mvuMessages : []
              };
            }
            // 同步别名引用
            cardMessages = chatSessions.card.messages;
            mvuMessages = chatSessions.mvu.messages;

            // 当前Tab：优先 activeTab，其次 currentTab，默认回到角色卡Tab
            activeTab = state.activeTab || state.currentTab || 'card';
            currentTab = activeTab; // 兼容别名
            // 同步到 window：让 mergePartial / _renderPreviewImpl 也能取到正确 Tab
            // （修复：之前只恢复模块级变量，window.__tab_activeTab 仍为初始值 'card'，
            //  导致继续上次后 UI 显示 MVU Tab 但实际生成/预览仍按角色卡 Tab 逻辑）
            if (typeof window !== 'undefined') {
              window.__tab_activeTab = activeTab;
            }
            // 当前Tab的 messages 兼容：虽然我们不再使用全局 messages 变量，但为了向后兼容
            // ⚠️修复：不再 .slice() 复制——副本会切断与 chatSessions 唯一真源的引用，
            // 导致旧代码写 messages 的消息不进 saveToStorage（序列化的是 chatSessions），静默丢失
            messages = (activeTab === 'card') ? chatSessions.card.messages : chatSessions.mvu.messages;

            cardGenerated = state.cardGenerated || false;
            progress = state.progress || 0;
            moduleProgress = state.moduleProgress || {
              total: 0,
              constant: 0,
              triggered: 0,
              grouped: 0,
              has_key: 0,
              has_content: 0
            };
            if (typeof state.fontScale === 'number') _appFontScale = state.fontScale;

            return true;
          }
        } catch (e) { logWarn("loadFromStorage", e); }
        return false;
      }

      function hasSavedData() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return false;
          const state = JSON.parse(raw);
          // 放宽条件：有 name 或有 entries 或有 description 都算有数据
          if (!state || !state.cardData) return false;
          const cd = state.cardData;
          const hasName = cd.name && cd.name.length > 0;
          const hasDesc = cd.description && cd.description.length > 0;
          const hasEntries = cd.character_book && cd.character_book.entries && cd.character_book.entries.length > 0;
          return hasName || hasDesc || hasEntries;
        } catch (e) {
          return false;
        }
      }

      function clearStorage() {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch (e) { logWarn("clearStorage", e); }
      }

      function continueFromSave() {
        if (loadFromStorage()) {
          renderChatUI();
          applyFontScale(_appFontScale);
          // ========== Tab 隔离：恢复对应Tab的历史消息到对话区 ==========
          // 用 getCurrentMessages() 取当前Tab的专属消息数组（activeTab已在loadFromStorage中恢复）
          const curMsgs = getCurrentMessages();
          const savedMessages = curMsgs.slice();
          setCurrentMessages([]);
          const chatC = doc.getElementById('chatMessages');
          if (chatC) chatC.innerHTML = '';
          savedMessages.forEach(function(m) {
            const arr = getCurrentMessages();
            arr.push(m);
            appendMsg(m.role, m.content, arr.length - 1);
          });
          // 恢复Tab按钮激活态（renderChatUI 默认可能没有选中对应Tab）
          const tabBtns = doc.querySelectorAll('.tab-btn');
          for (let tbi = 0; tbi < tabBtns.length; tbi++) {
            tabBtns[tbi].classList.toggle('active', tabBtns[tbi].getAttribute('data-tab') === activeTab);
          }
          // 更新输入框占位符和标题
          const inputEl = doc.getElementById('chatInput');
          if (inputEl) {
            inputEl.placeholder = activeTab === 'card' ?
              '描述你想要的世界书条目（任何设定…），我来生成世界书JSON...' :
              '描述你想要的MVU变量系统或状态栏，如"做一个好感度+物品栏的状态栏"...';
          }
          const titleH1 = doc.querySelector('.topbar h1');
          if (titleH1) {
            titleH1.innerHTML = activeTab === 'card' ?
              svgIcon('bolt', 18, 'topbar-ic') + ' 时之写卡器<span style="font-weight:400;font-size:.85em;color:var(--ink-soft)"> · 世界书生成</span>' :
              svgIcon('sliders', 18, 'topbar-ic') + ' MVU变量系统<span style="font-weight:400;font-size:.85em;color:var(--ink-soft)"> · 变量与状态栏</span>';
          }
          updateProgress();
          updateQuickActions();
          updateCtxBar();
          renderPreview();
          scheduleCtxBarUpdate();
          showToast('已恢复上次创作进度（当前：' + (activeTab === 'card' ? '角色卡生成 Tab' : 'MVU变量状态栏 Tab') + '）', 'success');
        } else {
          showToast('没有找到保存的数据', 'warning');
        }
      }

      function updateCtxBar() {
        const stage = doc.getElementById('ctxStage');
        const actions = doc.getElementById('ctxActions');
        if (!stage || !actions) return;
        const __tab = (typeof activeTab !== 'undefined') ? activeTab : 'card';
        const p = progress || 0;
        // ===== 阶段提示 =====
        let stageName, stageIcon;
        if (__tab === 'card') {
          stageIcon = 'info';
          stageName = p < 20 ? '生成世界书条目' : p < 40 ? '丰富世界书条目' : p < 60 ? '深化世界书条目' : p < 80 ? '完善世界书条目' : p < 95 ? '补充细节' : '可写入酒馆';
        } else {
          // MVU Tab：静态阶段标签（进度由8步chip展示，避免与chip重复冲突）
          stageIcon = 'sliders';
          stageName = 'MVU变量系统';
        }
        stage.innerHTML = svgIcon(stageIcon, 13) + ' <strong>' + stageName + '</strong>';
        // ===== 操作区内容 =====
        let h = '';
        if (__tab === 'card') {
          // 角色卡Tab：世界书条目统计胶囊（条目总数 / 常驻 / 触发）
          const mp = getModuleProgress();
          const aiMp = moduleProgress || {};
          const labels = [{
              key: 'total',
              icon: 'book',
              name: '条目总数'
            },
            {
              key: 'constant',
              icon: 'lock',
              name: '常驻'
            },
            {
              key: 'triggered',
              icon: 'bolt',
              name: '触发'
            },
            {
              key: 'grouped',
              icon: 'layers',
              name: '分组'
            },
            {
              key: 'has_key',
              icon: 'key',
              name: '触发词'
            },
            {
              key: 'has_content',
              icon: 'document',
              name: '内容完整'
            }
          ];
          labels.forEach(function(l) {
            let val = (mp[l.key] ? 100 : 0);
            if (aiMp[l.key] > 0) val = Math.max(val, aiMp[l.key]);
            const cls = val >= 100 ? 'done' : val > 0 ? 'prog' : '';
            h += '<button class="ctx-mod ' + cls + '" data-mod="' + l.key + '" title="' + l.name + '">' + svgIcon(l.icon, 13) + ' ' + l.name + '</button>';
          });
        } else {
          // MVU Tab：8步紧凑状态 chip + 阶段自适应主操作按钮
          const _ctxChk = checkMvu8Entries(cardData);
          const _d = _ctxChk.done;
          const _doneCnt = _ctxChk.doneCount;
          // 8步紧凑状态 chip（仅序号 + 完成态，节省横向空间）
          const _steps = [{
              has: _d[0],
              label: '①',
              title: '第1条 zod变量结构脚本'
            },
            {
              has: _d[1],
              label: '②',
              title: '第2条 [InitVar]初始变量'
            },
            {
              has: _d[2],
              label: '③',
              title: '第3条 [mvu_update]更新规则'
            },
            {
              has: _d[3],
              label: '④',
              title: '第4条 变量列表'
            },
            {
              has: _d[4],
              label: '⑤',
              title: '第5条 [mvu_update]输出格式'
            },
            {
              has: _d[5],
              label: '⑥',
              title: '第6条 输出格式强调'
            },
            {
              has: _d[6],
              label: '⑦',
              title: '第7条 <状态栏>占位提醒'
            },
            {
              has: _ctxChk.has8,
              label: '⑧',
              title: '第8条 状态栏HTML(正则6)'
            }
          ];
          _steps.forEach(function(s) {
            h += '<span class="ctx-chip ' + (s.has ? 'ok' : 'todo') + '" title="' + s.title + '">' + svgIcon(s.has ? 'checkCircle' : 'circle', 11) + ' ' + s.label + '</span>';
          });
          // 阶段自适应主操作按钮（右对齐，高亮当前阶段主操作）
          // 注：部分完成(1-6/7)时不显示主按钮，由输入框上方"继续"按钮接管
          if (!_ctxChk.all7Done) {
            if (_doneCnt === 0) {
              h += '<button class="ctx-mod" data-mod="init_var" style="margin-left:auto;background:var(--accent-soft);color:var(--accent-deep);border-color:var(--accent-border)">' + svgIcon('code', 13) + ' 生成变量系统</button>';
            }
          } else if (!_ctxChk.has8) {
            h += '<button class="ctx-mod" data-mod="start_sb" style="margin-left:auto;background:var(--accent-soft);color:var(--accent-deep);border-color:var(--accent-border)">' + svgIcon('sliders', 13) + ' 生成状态栏</button>';
          } else {
            h += '<button class="ctx-mod" data-mod="mvuPreview" style="margin-left:auto;background:var(--accent-soft);color:var(--accent-deep);border-color:var(--accent-border)">' + svgIcon('eye', 13) + ' 预览状态栏</button>';
          }
        }
        actions.innerHTML = h;
        // 绑定模块按钮点击
        const modBtns = actions.querySelectorAll('.ctx-mod');
        for (let i = 0; i < modBtns.length; i++) {
          modBtns[i].addEventListener('click', function() {
            const mod = this.getAttribute('data-mod');
            if (mod) handleQuickAction(mod);
          });
        }
      }

      function updateQuickActions() {
        const qa = doc.getElementById('quickActions');
        if (!qa) return;
        const p = progress || 0;
        const hasFirst = cardData.first_mes && cardData.first_mes.length > 50;
        const hasEntries = cardData.character_book && cardData.character_book.entries && cardData.character_book.entries.length > 0;
        const hasMVU = hasEntries && cardData.character_book.entries.some(function(e) {
          return isMVUEntry(e.comment || '');
        });

        // ========== 精简版：仅留「阶段主操作」+「生成」+ 2 mini（写入/清空）==========
        // 模块导航/权重/分组/进度总览等已迁至「工作区」下拉菜单，避免拥挤
        const actions = [];
        if (currentTab === 'card') {
          // 阶段主操作（hl）
          if (p < 20) actions.push({
            action: 'generate_entry',
            icon: 'book',
            label: '生成世界书条目',
            hl: true
          });
          else if (p < 40) actions.push({
            action: 'generate_entry',
            icon: 'book',
            label: '丰富世界书条目',
            hl: true
          });
          else if (p < 60) actions.push({
            action: 'generate_entry',
            icon: 'book',
            label: '深化世界书条目',
            hl: true
          });
          else if (p < 80) actions.push({
            action: 'generate_entry',
            icon: 'book',
            label: '完善世界书条目',
            hl: true
          });
          else if (p < 95) actions.push({
            action: 'generate_entry',
            icon: 'book',
            label: '补充细节条目',
            hl: true
          });
          // 生成角色卡并写入酒馆（新：直接调用 tavern API 装配导出，而非再让AI输出完整JSON）
          // p>=95 时高亮；p<95 也能点（允许用户提前导出），但不做高亮提示
          actions.push({
            action: 'generate',
            icon: 'sparkle',
            label: '生成并写入酒馆',
            title: '通过写卡器装配角色卡（含世界书/正则/脚本），直接写入到酒馆当前角色卡',
            hl: p >= 95
          });
        } else {
          // MVU Tab：基于8条工作流的三阶段按钮组
          const _chk = checkMvu8Entries(cardData);
          const _done7Count = _chk.doneCount;
          const _all7Done = _chk.all7Done;
          if (!_all7Done) {
            // Phase A：前7条MVU条目未完成
            if (_done7Count === 0) {
              actions.push({
                action: 'init_var',
                icon: 'code',
                label: '生成MVU变量系统',
                hl: true
              });
            } else {
              actions.push({
                action: 'continue_mvu',
                icon: 'play',
                label: '继续',
                hl: true
              });
            }
            actions.push({
              action: 'next',
              icon: 'bolt',
              label: '下一步建议'
            });
          } else if (!_chk.has8) {
            // Phase B：前7条已完成，状态栏未生成
            actions.push({
              action: 'start_sb',
              icon: 'sliders',
              label: '生成状态栏HTML',
              hl: true
            });
            actions.push({
              action: 'mvuPreview',
              icon: 'eye',
              label: '预览(默认模板)'
            });
          } else {
            // Phase C：状态栏已生成
            actions.push({
              action: 'mvuPreview',
              icon: 'eye',
              label: '预览状态栏',
              hl: true
            });
            actions.push({
              action: 'start_sb',
              icon: 'refreshCycle',
              label: '重新生成'
            });
            actions.push({
              action: 'reset_sb',
              icon: 'trash',
              label: '清除状态栏'
            });
          }
        }
        let h = '';
        actions.forEach(function(a) {
          const icHtml = a.icon ? svgIcon(a.icon, 14) + ' ' : '';
          const titleAttr = a.title ? (' title="' + a.title.replace(/"/g, '&quot;') + '"') : '';
          const ariaLabel = a.title ? (' aria-label="' + a.title.replace(/"/g, '&quot;') + '"') : '';
          h += '<button class="quick-btn' + (a.hl ? ' hl' : '') + '" data-action="' + a.action + '"' + titleAttr + ariaLabel + '>' + icHtml + a.label + '</button>';
        });
        // 常驻指令组（两 Tab 通用）：继续 / 重做上一条 / 查看进度
        h += '<span class="qa-cmd-sep"></span>';
        h += '<button class="qa-mini qa-cmd" data-action="continue" title="一键发送「继续」，让AI接着上一步输出">' + svgIcon('play', 13) + ' 继续</button>';
        h += '<button class="qa-mini qa-cmd" data-action="redo" title="撤销并重新生成最后一条AI回复（自动回滚该次卡片修改）">' + svgIcon('refreshCycle', 13) + ' 重做</button>';
        h += '<button class="qa-mini qa-cmd" data-action="summary" title="让AI梳理当前已完成内容、缺口与下一步">' + svgIcon('gauge', 13) + ' 查看进度</button>';
        // 2 mini：写入酒馆 / 清空（右对齐）
        h += '<button class="qa-mini" id="saveBtn" title="直接写入酒馆角色卡">' + svgIcon('save', 14) + ' 写入酒馆</button>';
        h += '<button class="qa-mini" id="clearChatBtn" title="清空对话记录（不影响角色卡内容）">' + svgIcon('trash', 14) + ' 清空</button>';
        qa.innerHTML = h;
        const btns = qa.querySelectorAll('.quick-btn');
        for (let i = 0; i < btns.length; i++) {
          btns[i].addEventListener('click', function() {
            handleQuickAction(this.getAttribute('data-action'));
          });
        }
        // 常驻指令按钮绑定
        const cmdBtns = qa.querySelectorAll('.qa-cmd');
        for (let ci2 = 0; ci2 < cmdBtns.length; ci2++) {
          cmdBtns[ci2].addEventListener('click', function() {
            handleQuickAction(this.getAttribute('data-action'));
          });
        }
        bindToolbarButtons();
      }



      // 绑定导出/清空按钮（位于 quick-actions 内，每次重建后需重新绑定）
      function bindToolbarButtons() {
        const saveBtn = doc.getElementById('saveBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveCharacter);
        const clearChatBtn = doc.getElementById('clearChatBtn');
        if (clearChatBtn) {
          clearChatBtn.addEventListener('click', function() {
            if (isGenerating) {
              showToast('⚠️ AI正在生成中，请稍后再清除', 'warning');
              return;
            }
            // ========== Tab 隔离：只清空当前Tab的聊天记录，另一Tab不受影响 ==========
            const curMsgs = getCurrentMessages();
            const tabName = currentTab === 'card' ? '角色卡生成' : 'MVU变量状态栏';
            if (curMsgs.length === 0) {
              showToast(tabName + ' Tab 的对话已经是空的', 'info');
              return;
            }
            if (!confirm('确定清空「' + tabName + '」Tab 的所有对话记录吗？\n\n✅ 角色卡内容不会被影响，仍会保留\n✅ 只清除当前Tab的聊天对话历史\n✅ 另一个Tab的聊天记录不受影响')) return;
            setCurrentMessages([]);
            const chatC = doc.getElementById('chatMessages');
            if (chatC) chatC.innerHTML = '';
            saveToStorage();
            showToast('✅ ' + tabName + ' Tab 的对话已清空（角色卡内容不受影响）', 'success');
          });
        }
        // 同步禁用态（生成中）
        if (saveBtn) saveBtn.disabled = isGenerating;
      }

      function handleQuickAction(action) {
        const input = doc.getElementById('chatInput');

        // ========== Tab 跳转动作（跨Tab快速切换入口） ==========
        if (action === 'goto_mvu') {
          showToast('正在切换到「MVU变量状态栏」Tab...', 'info');
          switchTab('mvu');
          return;
        }
        if (action === 'goto_card') {
          showToast('正在切换到「角色卡生成」Tab...', 'info');
          switchTab('card');
          return;
        }

        // ========== Tab 隔离：动作权限校验，跨Tab动作自动跳转 ==========
        // 在角色卡Tab中点击了MVU专属动作 → 自动切到MVU Tab再执行
        const mvuOnlyActions = ['init_var', 'var_update_rule', 'start_sb', 'continue_sb', 'reset_sb', 'mvuPreview', 'continue_mvu'];
        if (currentTab === 'card' && mvuOnlyActions.indexOf(action) >= 0) {
          // ⚠️修复：生成中 switchTab 被锁静默失败，但旧逻辑仍 300ms 后原样重放 → 无限 toast 循环。
          // 改为：切换失败（Tab 未变）时中断重放链并明确提示，不重试
          switchTab('mvu');
          if (currentTab !== 'mvu') {
            showToast('AI正在处理中，无法切换到MVU Tab，请稍后再试「' + action + '」', 'warning');
            return;
          }
          showToast('「' + action + '」是MVU专属功能，已切换到MVU变量状态栏Tab', 'info');
          // 切换后在MVU Tab执行同一个动作
          setTimeout(function() {
            handleQuickAction(action);
          }, 300);
          return;
        }
        // 在MVU Tab中点击了角色卡专属动作 → 自动切到角色卡Tab再执行
        const cardOnlyActions = ['opening', 'generate', 'generate_entry', 'weight', 'group'];
        if (currentTab === 'mvu' && cardOnlyActions.indexOf(action) >= 0) {
          // ⚠️修复：同上，切换失败时中断重放链
          switchTab('card');
          if (currentTab !== 'card') {
            showToast('AI正在处理中，无法切换到角色卡Tab，请稍后再试「' + action + '」', 'warning');
            return;
          }
          showToast('「' + action + '」是角色卡专属功能，已切换到角色卡生成Tab', 'info');
          setTimeout(function() {
            handleQuickAction(action);
          }, 300);
          return;
        }

        // MVU专属快捷动作（仅MVU Tab有效）
        if (action === 'start_sb') {
          // ===== 前置检查：生成状态栏前，必须先完成前7条（第8条=状态栏本身）=====
          const _chkSB = checkMvu8Entries(cardData);
          if (!_chkSB.all7Done) {
            addAssistantMsg(buildMissingMvuHint(_chkSB.missing));
            showToast('前7条未齐全：缺' + _chkSB.missingCount + '条', 'warning');
            return;
          }
          // 生成状态栏前，确保固定资产已注入（bundle.js/正则1-5等）
          ensureFixedMvuAssetsInCardData();
          // 让AI生成完整状态栏HTML（统一模板，写卡器自动提取保存）
          if (input) {
            input.value = '请根据已配置的MVU变量系统，生成状态栏HTML。输出一个完整的HTML文档（含CSS和JS），使用 populateCharacterData + getAllVariables + eventOn(Mvu.events.VARIABLE_UPDATE_ENDED) + errorCatched 标准模式。';
            handleSend();
          }
          return;
        }
        if (action === 'continue_sb') {
          // 继续状态栏生成
          if (input) {
            input.value = '继续生成状态栏';
            handleSend();
          }
          return;
        }
        if (action === 'continue_mvu') {
          // 继续MVU逐条生成：自动发送"继续"两个字
          if (input) {
            input.value = '继续';
            handleSend();
          }
          return;
        }
        if (action === 'reset_sb') {
          // 清除已生成的状态栏正则（正则6）
          if (!confirm('确定清除已生成的美化状态栏正则（正则6）吗？\n\n✅ 仅删除状态栏HTML正则，不影响前7条MVU变量条目\n✅ 可随时重新生成')) return;
          cardData.extensions = cardData.extensions || {};
          const _rx = cardData.extensions.regex_scripts || [];
          for (let _m = _rx.length - 1; _m >= 0; _m--) {
            if ((_rx[_m].findRegex || '').indexOf('StatusPlaceHolder') >= 0 && _rx[_m].markdownOnly && !_rx[_m].promptOnly) {
              _rx.splice(_m, 1);
            }
          }
          cardData.extensions.regex_scripts = _rx;
          saveToStorage();
          renderPreview();
          updateQuickActions();
          updateCtxBar();
          showToast('✅ 已清除状态栏正则，可重新生成', 'success');
          return;
        }

        // 通用快捷指令（两个 Tab 通用）：继续 / 重做最后一条AI回复
        if (action === 'continue') {
          if (isGenerating) {
            showToast('AI正在处理中，请稍候再点「继续」', 'warning');
            return;
          }
          if (input) {
            input.value = '继续';
            handleSend();
          }
          return;
        }
        if (action === 'redo') {
          if (isGenerating) {
            showToast('AI正在处理中，请稍候再点「重做」', 'warning');
            return;
          }
          const msgs = getCurrentMessages();
          let lastAi = -1;
          for (let ri = msgs.length - 1; ri >= 0; ri--) {
            if (msgs[ri].role === 'assistant') {
              lastAi = ri;
              break;
            }
          }
          if (lastAi < 0) {
            showToast('当前还没有AI回复可以重做', 'info');
            return;
          }
          regenerateAIMessage(lastAi);
          return;
        }

        // 通用动作（两个Tab都可以用，但行为不同）
        if (action === 'generate_entry') {
          // 角色卡Tab：让AI自由生成世界书条目（用户描述什么就生成什么）
          if (currentTab !== 'card') {
            showToast('⚠️ 「生成世界书条目」仅在「角色卡生成」Tab中可用', 'warning');
            return;
          }
          if (input) {
            input.value = '请帮我生成世界书条目。请先告诉我你想在世界书里添加什么内容（任何设定等），或者我直接根据当前进度给你建议。可以直接输出符合ST世界书JSON规范的条目（```json代码块）或用:::操作块。';
            handleSend();
          }
          return;
        }
        if (action === 'weight') {
          showWeightVisual();
          return;
        }
        if (action === 'group') {
          showGroupMgr();
          return;
        }
        if (action === 'mvuPreview') {
          showMvuStatusBarPreview();
          return;
        }
        if (action === 'generate') {
          // 新版：不再让AI生成完整JSON（旧版）。当前流程是「渐进写卡 + 写卡器自动装配 + 酒馆API」，
          // 点击「生成角色卡」直接执行写入酒馆（与 qa-mini 写入酒馆按钮一致，按钮位置更显眼）。
          // 兜底：仍仅角色卡Tab生效
          if (currentTab !== 'card') {
            showToast('⚠️ 「生成并写入酒馆」仅在「角色卡生成」Tab中可用。\n当前在MVU变量状态栏Tab，请切换到角色卡生成Tab使用此功能。', 'warning', 5000);
            return;
          }
          saveCharacter();
          return;
        }

        // Prompt字典：区分角色卡Tab和MVU Tab使用不同的默认提示
        const cardPrompts = {
          next: '下一步我该做什么？请根据当前世界书条目完成度和缺口，给出2-3条具体可执行的建议，并说明每条建议会丰富哪个方向。',
          summary: '帮我梳理一下当前已收集的信息和进度：1) 已完成的核心设定 2) 世界书条目现状 3) 还缺什么 4) 推荐的下一步。用简洁列表呈现。',
          opening: '请根据现有世界观设定生成开场白。开场白1用 ::: set first_mes（500-800字：场景描写→主角出场→冲突/悬念→结尾留钩；用 {{char}}/{{user}} 代角色与玩家名，可结合 {{time}}/{{date}}/{{random}}/{{pick}}/{{idleDuration}}/{{roll}} 等酒馆宏增强真实感，但禁止占位符/未定文案）；同时生成2条以上备选开场白用 ::: set alternate_greetings（多条用---分割，与开场白1不同的场景/视角/时机；酒馆聊天界面可切换，{{charFirstMessage::N}} 可取第N条）。全部用:::操作块输出。',
          generate_entry: '请帮我自由生成世界书条目（不限制标签前缀，用户要什么就生成什么）。只用:::upsert操作块输出，生成/修改条目时必须按「条目元素逐项决策清单」把40个元素全部过一遍：需自定义的写进元信息行（keys/constant/position/selectiveLogic/depth/probability/order/match_whole_words/role/group/triggers等），用默认值的不写；正文用YAML中文格式。'
        };
        const mvuPrompts = {
          next: '我当前的MVU进度该怎么推进？请分析：\n1) 前7条MVU条目完成情况（' + MVU_8STEPS_SHORT + '）\n2) 第8条状态栏完成情况\n3) 推荐的下一步怎么做。用简洁列表呈现。',
          summary: '帮我梳理MVU系统当前状态：\n1) 按8条顺序检查前7条完成情况（' + MVU_8STEPS_SHORT + '）\n2) 检查第8条状态栏完成情况\n3) 缺失什么、推荐的下一步。',
          // ⚠️修复：六大模板+8条工作流规范已全部注入后台系统提示词（buildMvuTabPrompt 的 specBlock），
          // 用户消息只需简短指令——原先把 MVU_VAR_SPEC 等几千字规范整个填进输入框当用户消息发送，
          // 用户会看到"一按按钮发送一大段文字"
          init_var: '请帮我设计MVU变量系统：先收集我的变量需求（角色/世界观/场景/需要追踪什么状态），' +
            '然后按8条固定顺序逐条生成，一次只输出1条，输出后停下等我说"继续"。\n' +
            '现在从【第1条：变量结构脚本(zod 4 schema)】开始。',
          var_update_rule: '请检查当前MVU系统已有的条目，按8条固定顺序从缺失的第一条开始补。\n' +
            '一次只补1条，输出后立即停下等我确认。前7条全部完成后才生成第8条状态栏。'
        };
        // 选择当前Tab对应的Prompt字典
        const prompts = currentTab === 'card' ? cardPrompts : mvuPrompts;
        // summary/next在两个字典中都有；init_var/var_update_rule仅在MVU字典
        if (prompts[action] && input) {
          // ⚠️修复：生成期间禁止填入提示词——原先 isGenerating 时 handleSend 静默 return，
          // 整段提示词会残留在输入框里
          if (isGenerating) {
            showToast('AI正在处理中，请稍候再点「' + action + '」', 'warning');
            return;
          }
          input.value = prompts[action];
          handleSend();
        } else if (!prompts[action] && currentTab === 'mvu') {
          // 如果在MVU Tab点了角色卡Tab才有的动作（应该被上面的跳转拦住了，兜底防止意外）
          showToast('⚠️ 该动作仅在「角色卡生成」Tab中可用', 'warning');
        }
      }

      // 队列模式：callAIChat处理期间，addAssistantMsg的调用改为收集到队列，最后合并为一条消息
      let _aiChatNotesQueue = [];
      let _aiChatQueueMode = false;

      function addAssistantMsg(content) {
        // 队列模式：不立即显示，收集到队列
        if (_aiChatQueueMode) {
          _aiChatNotesQueue.push(content);
          return;
        }
        // ========== Tab 隔离：写入当前Tab专属的聊天记录数组，两边互不干扰 ==========
        const curMsgs = getCurrentMessages();
        curMsgs.push({
          role: 'assistant',
          content: content
        });
        appendMsg('assistant', content, curMsgs.length - 1);
        saveToStorage();
        scheduleCtxBarUpdate();
      }

      function addUserMsg(content) {
        // ========== Tab 隔离：写入当前Tab专属的聊天记录数组，两边互不干扰 ==========
        const curMsgs = getCurrentMessages();
        curMsgs.push({
          role: 'user',
          content: content
        });
        appendMsg('user', content, curMsgs.length - 1);
        saveToStorage();
      }
      /* 导出完整角色卡JSON（含世界书、正则、脚本）—— 复用 buildExportCard 装配逻辑，与「写入酒馆」数据一致 */
      function exportCardJson() {
        try {
          if (!cardData.name || !cardData.name.trim()) {
            showToast('请先确定世界/角色名称，再导出角色卡', 'warning');
            return;
          }
          const exportCard = buildExportCard(cardData);
          const json = JSON.stringify(exportCard, null, 2);
          const blob = new Blob([json], {
            type: 'application/json;charset=utf-8'
          });
          const url = URL.createObjectURL(blob);
          const a = doc.createElement('a');
          a.href = url;
          // 文件名非法字符替换为下划线（/ \ : * ? " < > |）
          const safeName = cardData.name.trim().replace(/[\\/:*?"<>|]/g, '_');
          a.download = '角色卡_' + safeName + '_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
          doc.body.appendChild(a);
          a.click();
          doc.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast('✅ 角色卡JSON已导出（含世界书、正则、脚本，chara_card_v3格式）', 'success');
        } catch (err) {
          logError('exportCardJson', err, '❌ 导出失败：' + (err && err.message ? err.message : '未知错误'));
        }
      }
      /* 导出聊天记录和后台记录（调试用，放在预览面板右上角不起眼位置） */
      function exportChatLogs() {
        try {
          const log = {
            exportTime: new Date().toISOString(),
            toolVersion: 'Card_making_tool',
            cardData: cardData,
            currentTab: currentTab,
            cardMessages: cardMessages,
            mvuMessages: mvuMessages,
            progress: progress,
            moduleProgress: moduleProgress
          };
          const blob = new Blob([JSON.stringify(log, null, 2)], {
            type: 'application/json;charset=utf-8'
          });
          const url = URL.createObjectURL(blob);
          const a = doc.createElement('a');
          a.href = url;
          a.download = 'chatlog_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
          doc.body.appendChild(a);
          a.click();
          doc.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast('✅ 已导出聊天记录和后台记录', 'success');
        } catch (err) {
          logError('exportChatLogs', err, '❌ 导出失败：' + (err && err.message ? err.message : '未知错误'));
        }
      }

      function appendMsg(role, content, explicitIdx) {
        const c = doc.getElementById('chatMessages');
        if (!c) return;
        const div = doc.createElement('div');
        div.className = 'chat-msg ' + role;
        const msgId = 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
        div.setAttribute('data-msg-id', msgId);
        // 记录消息在当前Tab消息数组中的索引（供头像菜单撤回/重新生成定位）
        // explicitIdx 由重放场景（switchTab/rerenderChatMessages）显式传入；
        // 正常流程（push后立即append）用 getCurrentMessages().length-1 兜底
        let msgIdx = (typeof explicitIdx === 'number' && explicitIdx >= 0) ? explicitIdx : -1;
        if (msgIdx < 0) {
          try {
            msgIdx = getCurrentMessages().length - 1;
          } catch (_eIdx) {}
        }
        if (msgIdx < 0) msgIdx = (c.querySelectorAll('.chat-msg').length);
        div.setAttribute('data-msg-index', String(msgIdx));
        div.setAttribute('data-msg-role', role);
        const avatarHtml = buildAvatarHtml(role);
        let bubbleHtml;
        // AI 消息：使用 section 分区渲染（思维链/正文/代码块可折叠）
        if (role === 'assistant') {
          try {
            const sections = parseMessageSections(content);
            bubbleHtml = renderMessageSections(sections, msgId);
          } catch (e) {
            logWarn('renderMessageSections', e);
            try {
              bubbleHtml = fmtBubble(content);
            } catch (e2) {
              bubbleHtml = '';
            }
          }
        } else {
          try {
            bubbleHtml = fmtBubble(content);
          } catch (e) {
            logWarn('fmtBubble', e);
            bubbleHtml = '';
          }
        }
        if (bubbleHtml) {
          // 🐛修复：转义顺序必须是 & → " → < → >，否则 &lt; 等已有实体会被二次解码
          div.innerHTML = avatarHtml + '<div class="bubble" data-raw-text="' + content.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '">' + bubbleHtml + '</div>';
        } else {
          div.innerHTML = avatarHtml + '<div class="bubble"></div>';
          const bubbleEl = div.querySelector('.bubble');
          if (bubbleEl) bubbleEl.textContent = (content == null ? '' : String(content));
        }
        c.appendChild(div);
        // 头像点击：弹出操作菜单（修改头像/人设/撤回/重新生成等），不再直接上传
        const avEl = div.querySelector('.avatar-clickable');
        if (avEl) {
          avEl.style.position = 'relative';
          avEl.addEventListener('click', function(e) {
            if (e) {
              e.stopPropagation();
            }
            showAvatarMenu(role, msgIdx, avEl);
          });
        }
        // 铅笔按钮：点击直接编辑该条消息内容（不截断后续、不重新生成，仅原地改文本）
        const editBtnEl = div.querySelector('.msg-edit-btn');
        if (editBtnEl) {
          editBtnEl.addEventListener('click', function(e) {
            if (e) {
              e.stopPropagation();
              e.preventDefault();
            }
            editMessageContent(msgIdx, role);
          });
        }
        // AI 消息：绑定 section 折叠交互
        if (role === 'assistant') {
          const bubbleDiv = div.querySelector('.bubble');
          if (bubbleDiv) bindSectionToggles(bubbleDiv);
        }
        scrollChat();
      }

      function buildAvatarHtml(role) {
        const key = role === 'user' ? 'userAvatar' : 'aiAvatar';
        const cls = 'avatar avatar-clickable';
        const title = role === 'user' ? '点击展开操作菜单（修改头像/人设/撤回等）' : '点击展开操作菜单（修改头像/人设/撤回/重新生成等）';
        const saved = localStorage.getItem(key);
        let avatarInner;
        if (saved) {
          // ⚠️ XSS防御：saved 来自 localStorage（正常为 canvas dataURL），仍需校验为 data:image/*
          // 且转义引号/括号，防止被注入 x" onmouseover=... 或 url() 逃逸
          const isSafeAvatar = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(saved);
          avatarInner = '<div class="' + cls + '" title="' + title + '" style="cursor:pointer;background-image:url(' + (isSafeAvatar ? ('\'' + saved + '\'') : 'none') + ');background-size:cover;background-position:center"></div>';
        } else {
          const icon = role === 'user' ? svgIcon('user', 18) : svgIcon('bot', 18);
          avatarInner = '<div class="' + cls + '" title="' + title + '" style="cursor:pointer">' + icon + '</div>';
        }
        // 铅笔编辑按钮：AI 在头像右侧，用户在头像左侧
        const editBtn = '<button class="msg-edit-btn" type="button" title="编辑此条消息内容">' + svgIcon('edit', 14) + '</button>';
        // 用户消息（右对齐）：铅笔在左、头像在右；AI消息（左对齐）：头像在左、铅笔在右
        if (role === 'user') {
          return '<div class="avatar-row">' + editBtn + avatarInner + '</div>';
        }
        return '<div class="avatar-row">' + avatarInner + editBtn + '</div>';
      }

      function triggerAvatarUpload(role) {
        const key = role === 'user' ? 'userAvatar' : 'aiAvatar';
        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        doc.body.appendChild(input);
        let inputRemoved = false;
        const removeInput = function() {
          if (!inputRemoved && input.parentNode) {
            doc.body.removeChild(input);
            inputRemoved = true;
          }
        };
        // 取消文件选择对话框不触发 change：用窗口 focus + 延迟兜底清理临时 input（防 DOM 残留）
        let cancelTimer = null;
        const win = doc.defaultView || window;
        const onFocusCleanup = function() {
          if (cancelTimer) clearTimeout(cancelTimer);
          cancelTimer = setTimeout(function() {
            removeInput();
            win.removeEventListener('focus', onFocusCleanup);
          }, 1500);
        };
        win.addEventListener('focus', onFocusCleanup);
        input.addEventListener('change', function(e) {
          if (cancelTimer) clearTimeout(cancelTimer);
          win.removeEventListener('focus', onFocusCleanup);
          const file = e.target.files && e.target.files[0];
          // 无论是否选中文件都移除临时 input，避免 DOM 节点泄漏
          removeInput();
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function(ev) {
            const img = new Image();
            img.onload = function() {
              const size = Math.min(img.width, img.height);
              const canvas = doc.createElement('canvas');
              canvas.width = 128;
              canvas.height = 128;
              const ctx = canvas.getContext('2d');
              const sx = (img.width - size) / 2,
                sy = (img.height - size) / 2;
              ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
              const dataUrl = canvas.toDataURL('image/png');
              localStorage.setItem(key, dataUrl);
              refreshAllAvatars(role);
              showToast((role === 'user' ? '用户' : 'AI') + '头像已更新', 'success');
            };
            // 损坏图片不再静默失败
            img.onerror = function() {
              showToast('图片文件已损坏，无法设为头像', 'error');
            };
            img.src = ev.target.result;
          };
          reader.onerror = function() {
            showToast('读取图片文件失败', 'error');
          };
          reader.readAsDataURL(file);
        });
        input.click();
      }

      function refreshAllAvatars(role) {
        const key = role === 'user' ? 'userAvatar' : 'aiAvatar';
        const saved = localStorage.getItem(key);
        if (!saved) return;
        const avatars = doc.querySelectorAll('.chat-msg.' + role + ' .avatar-clickable');
        for (let i = 0; i < avatars.length; i++) {
          avatars[i].innerHTML = '';
          avatars[i].style.backgroundImage = 'url(' + saved + ')';
          avatars[i].style.backgroundSize = 'cover';
          avatars[i].style.backgroundPosition = 'center';
        }
      }

      // ====================================================================
      // ========== 头像菜单系统 + cardData快照撤回系统 ==========
      // ====================================================================
      // 每个Tab维护独立的快照表：{ card: {msgIndex: cardDataClone}, mvu: {...} }
      // 在每条AI消息应用修改前保存快照，撤回时回滚cardData + 截断消息
      const cardDataSnapshots = {
        card: {},
        mvu: {}
      };

      function _snapTabKey() {
        return (activeTab === 'mvu') ? 'mvu' : 'card';
      }

      function saveCardDataSnapshot(aiMsgIndex) {
        try {
          const clone = JSON.parse(JSON.stringify(cardData));
          const tabSnaps = cardDataSnapshots[_snapTabKey()];
          tabSnaps[aiMsgIndex] = clone;
          // 撤销栈封顶：每 Tab 仅保留最近 CONFIG.UNDO_STACK_LIMIT 步，防止长会话快照无限增长占内存
          try {
            const keys = Object.keys(tabSnaps).map(Number).sort(function(a, b) {
              return a - b;
            });
            if (keys.length > CONFIG.UNDO_STACK_LIMIT) {
              const dropN = keys.length - CONFIG.UNDO_STACK_LIMIT;
              for (let i = 0; i < dropN; i++) delete tabSnaps[keys[i]];
            }
          } catch (e) {
            logWarn('snapshotCap', e);
          }
        } catch (e) {
          console.warn('[snapshot] save failed:', e && e.message);
        }
      }

      function restoreCardDataSnapshot(aiMsgIndex) {
        const snap = cardDataSnapshots[_snapTabKey()][aiMsgIndex];
        if (!snap) return false;
        try {
          const restored = JSON.parse(JSON.stringify(snap));
          // 原地替换 cardData 的内容（保留引用，避免各处引用失效）
          for (let k in cardData) {
            if (cardData.hasOwnProperty(k)) delete cardData[k];
          }
          for (let k2 in restored) {
            if (restored.hasOwnProperty(k2)) cardData[k2] = restored[k2];
          }
          return true;
        } catch (e) {
          console.warn('[snapshot] restore failed:', e && e.message);
          return false;
        }
      }

      function clearSnapshotsAfter(msgIndex) {
        const tab = _snapTabKey();
        const snaps = cardDataSnapshots[tab];
        for (let k in snaps) {
          if (snaps.hasOwnProperty(k) && Number(k) > msgIndex) delete snaps[k];
        }
      }

      // 全局人设：AI人设 / 用户人设（存localStorage，buildPrompt注入）
      function getPersonaHeader() {
        const aiP = (localStorage.getItem('aiPersona') || '').trim();
        const userP = (localStorage.getItem('userPersona') || '').trim();
        let hdr = '';
        if (aiP) hdr += '【AI全局人设】\n' + aiP + '\n';
        if (userP) hdr += '【用户全局人设】\n' + userP + '\n';
        return hdr;
      }

      // 修改头像（复用原triggerAvatarUpload的文件上传逻辑）
      function editAvatar(role) {
        triggerAvatarUpload(role);
      }

      // 编辑全局人设（弹窗textarea）
      function editPersona(role) {
        const key = role === 'user' ? 'userPersona' : 'aiPersona';
        const title = role === 'user' ? '用户全局人设' : 'AI全局人设';
        const cur = localStorage.getItem(key) || '';
        const html = '<div class="modal-content" style="max-width:560px">' +
          '<h3 style="margin:0 0 8px;color:var(--accent-deep)">' + svgIcon('settings', 16) + ' ' + title + '</h3>' +
          '<div style="font-size:.78em;color:var(--muted);margin-bottom:8px">该人设会注入到每次AI对话的开头，对当前工具内的AI生效（与状态栏/角色卡界面互不影响，仅影响工具内对话）。</div>' +
          '<textarea id="personaEditArea" style="width:100%;min-height:160px;font-size:.88em;padding:10px;border:1px solid var(--line);border-radius:var(--radius);font-family:inherit;resize:vertical;box-sizing:border-box">' + escHtml(cur) + '</textarea>' +
          '<div class="modal-actions">' +
          '<button class="btn" id="personaCancelBtn" style="background:var(--surface-soft);color:var(--ink-soft);border:1px solid var(--line)">取消</button>' +
          '<button class="btn" id="personaSaveBtn" style="background:var(--accent);color:#fff">保存</button>' +
          '</div></div>';
        const mask = doc.createElement('div');
        mask.className = 'modal';
        mask.innerHTML = html;
        doc.body.appendChild(mask);
        const ta = doc.getElementById('personaEditArea');
        if (ta) {
          try {
            ta.focus();
          } catch (_) {}
        }
        const close = function() {
          if (mask.parentNode) mask.parentNode.removeChild(mask);
        };
        doc.getElementById('personaCancelBtn').addEventListener('click', close);
        doc.getElementById('personaSaveBtn').addEventListener('click', function() {
          const val = ta ? ta.value : '';
          localStorage.setItem(key, val);
          close();
          showToast(title + '已保存', 'success');
        });
        mask.addEventListener('click', function(e) {
          if (e.target === mask) close();
        });
      }

      // 关闭所有已打开的头像菜单
      function closeAllAvatarMenus() {
        const ms = doc.querySelectorAll('.avatar-menu');
        for (let i = 0; i < ms.length; i++) {
          if (ms[i].parentNode) ms[i].parentNode.removeChild(ms[i]);
        }
      }
      // 点击页面其他位置关闭菜单
      doc.addEventListener('click', function() {
        closeAllAvatarMenus();
      });

      // 显示头像菜单（展开在头像旁边）
      function showAvatarMenu(role, msgIdx, anchorEl) {
        closeAllAvatarMenus();
        const msgs = getCurrentMessages();
        const menu = doc.createElement('div');
        menu.className = 'avatar-menu';
        // AI头像在左(user右对齐)，菜单展开在右侧；用户头像在右，菜单展开在左侧
        menu.classList.add(role === 'user' ? 'am-left' : 'am-right');
        const items = [];
        if (role === 'assistant') {
          items.push({
            icon: 'image',
            label: '修改头像',
            act: function() {
              editAvatar('assistant');
            }
          });
          items.push({
            icon: 'settings',
            label: '人设设置(AI全局人设)',
            act: function() {
              editPersona('assistant');
            }
          });
          items.push({
            sep: true
          });
          items.push({
            icon: 'undo',
            label: '撤回',
            title: '撤回此条AI回复及其对角色卡的修改',
            danger: true,
            act: function() {
              revokeAIMessage(msgIdx);
            }
          });
          items.push({
            icon: 'refresh',
            label: '重新生成',
            title: '重新生成此条AI回复',
            act: function() {
              regenerateAIMessage(msgIdx);
            }
          });
        } else {
          items.push({
            icon: 'image',
            label: '修改头像',
            act: function() {
              editAvatar('user');
            }
          });
          items.push({
            icon: 'settings',
            label: '人设设置(用户全局人设)',
            act: function() {
              editPersona('user');
            }
          });
          items.push({
            sep: true
          });
          items.push({
            icon: 'edit',
            label: '修改',
            title: '修改此条消息',
            act: function() {
              editUserMessage(msgIdx);
            }
          });
          items.push({
            icon: 'refresh',
            label: '重新生成',
            title: '重新生成下面的AI回答',
            act: function() {
              regenerateAnswerBelow(msgIdx);
            }
          });
          items.push({
            sep: true
          });
          items.push({
            icon: 'undo',
            label: '撤回',
            title: '撤回AI从此条之后所有的消息和操作(含角色卡内容)',
            danger: true,
            act: function() {
              revokeAfterUserMessage(msgIdx);
            }
          });
        }
        let html = '';
        items.forEach(function(it) {
          if (it.sep) {
            html += '<div class="avatar-menu-sep"></div>';
            return;
          }
          // 横向图标条：只显示图标，hover 时顶部弹出 tooltip（label/title）
          const tipText = it.title || it.label || '';
          html += '<div class="avatar-menu-item' + (it.danger ? ' danger' : '') + '" title="' + escAttr(tipText) + '">' + svgIcon(it.icon, 18) + '<span class="am-tip">' + escHtml(tipText) + '</span></div>';
        });
        menu.innerHTML = html;
        // 定位：挂到 avatar 元素本身（avatar 已设 position:relative），菜单横向展开在 avatar 旁边
        // AI头像在左→菜单 left:calc(100%+6px) 展开到右侧；用户头像在右→菜单 right:calc(100%+6px) 展开到左侧
        if (!anchorEl) {
          doc.body.appendChild(menu);
          menu.style.position = 'fixed';
        } else {
          anchorEl.appendChild(menu);
        }
        // 绑定点击
        const itemEls = menu.querySelectorAll('.avatar-menu-item');
        let actIdx = 0;
        items.forEach(function(it) {
          if (it.sep) return;
          const el = itemEls[actIdx];
          actIdx++;
          if (!el || !it.act) return;
          el.addEventListener('click', function(e) {
            if (e) {
              e.stopPropagation();
            }
            closeAllAvatarMenus();
            try {
              it.act();
            } catch (err) {
              logError('avatarMenu', err, '操作失败：' + (err && err.message ? err.message : ''));
            }
          });
        });
      }

      // ===== 重放当前Tab所有消息到聊天面板（撤回/重新生成后调用） =====
      function rerenderChatMessages() {
        const chatC = doc.getElementById('chatMessages');
        if (!chatC) return;
        chatC.innerHTML = '';
        const msgs = getCurrentMessages();
        for (let i = 0; i < msgs.length; i++) {
          appendMsg(msgs[i].role, msgs[i].content, i);
        }
        try {
          chatC.scrollTop = chatC.scrollHeight;
        } catch (_) {}
        // 刷新关联UI
        try {
          renderPreview();
        } catch (_) {}
        try {
          updateQuickActions();
        } catch (_) {}
        try {
          updateCtxBar();
        } catch (_) {}
      }

      // ===== 撤回：移除某条AI消息 + 回滚其cardData修改 =====
      function revokeAIMessage(aiIdx) {
        const msgs = getCurrentMessages();
        if (aiIdx < 0 || aiIdx >= msgs.length || msgs[aiIdx].role !== 'assistant') {
          showToast('无法撤回：该消息不是AI回复', 'warning');
          return;
        }
        if (isGenerating) {
          showToast('AI正在生成中，请稍候', 'warning');
          return;
        }
        // 检查后面是否还有用户消息——如果有，说明后续用户消息的上下文依赖本条AI的回复
        // 此时禁止单条撤回（会导致用户消息变成无根之木），引导用户从对应"用户消息"撤回
        let hasUserAfter = false;
        let aiCountAfter = 0;
        let userCountAfter = 0;
        for (let _i = aiIdx + 1; _i < msgs.length; _i++) {
          if (msgs[_i].role === 'user') {
            hasUserAfter = true;
            userCountAfter++;
          } else aiCountAfter++;
        }
        if (hasUserAfter) {
          showToast('本条AI之后还有 ' + userCountAfter + ' 条用户消息，无法单独撤回此条AI（会导致后续对话上下文断裂）。\n\n请点击【对应那条用户消息的头像→撤回】，从用户消息整条链路撤回，这样上下文保持一致。', 'warning');
          return;
        }
        // 后续只有AI回复：提示影响范围
        let confirmMsg = '确定撤回此条AI回复吗？\n\n✅ 移除该AI回复消息';
        if (aiCountAfter > 0) confirmMsg += ' 及其后 ' + aiCountAfter + ' 条AI回复';
        confirmMsg += '\n✅ 回滚对角色卡/变量系统的修改';
        confirmMsg += '\n✅ 保留上一条用户消息，可重新生成';
        if (!confirm(confirmMsg)) return;
        // 回滚cardData到该AI消息应用修改前的快照
        const ok = restoreCardDataSnapshot(aiIdx);
        // 截断消息：保留到aiIdx（不含），即移除该AI消息及其后所有（仅AI）
        msgs.length = aiIdx;
        clearSnapshotsAfter(aiIdx - 1);
        saveToStorage();
        progress = calcProgress();
        rerenderChatMessages();
        showToast(ok ? '✅ 已撤回AI回复并回滚修改' : '✅ 已撤回AI回复（无快照可回滚，角色卡未变更）', 'success');
      }

      // ===== 撤回：用户消息之后所有消息和操作（含cardData，含之后的用户消息） =====
      function revokeAfterUserMessage(userIdx) {
        const msgs = getCurrentMessages();
        if (userIdx < 0 || userIdx >= msgs.length || msgs[userIdx].role !== 'user') {
          showToast('无法撤回：该消息不是用户消息', 'warning');
          return;
        }
        if (isGenerating) {
          showToast('AI正在生成中，请稍候', 'warning');
          return;
        }
        // 统计该用户消息之后的消息数量（用户消息和AI回复）
        let userCountAfter = 0;
        let aiCountAfter = 0;
        for (let _wai = userIdx + 1; _wai < msgs.length; _wai++) {
          if (msgs[_wai].role === 'user') userCountAfter++;
          else aiCountAfter++;
        }
        let msg = '确定从这条用户消息之后全部撤回吗？\n\n';
        msg += '⚠️ 会移除：';
        if (aiCountAfter > 0) msg += aiCountAfter + ' 条AI回复';
        if (userCountAfter > 0) msg += ' + ' + userCountAfter + ' 条用户消息（之后的用户输入也会被删除，因上下文基于此条之前的对话）';
        if (aiCountAfter === 0 && userCountAfter === 0) msg += '当前之后无任何消息，无需撤回';
        msg += '\n✅ 回滚这些AI回复对角色卡/变量系统的全部修改';
        msg += '\n✅ 保留当前这条用户消息本身，可重新生成下面的AI回答';
        msg += '\nℹ️ 状态栏界面和角色卡界面互不影响（仅回滚当前Tab）';
        if (aiCountAfter === 0 && userCountAfter === 0) {
          showToast('当前这条用户消息之后没有任何消息可撤回', 'info');
          return;
        }
        if (!confirm(msg)) return;
        // 该用户消息后的AI消息索引 = userIdx+1
        const aiIdx = userIdx + 1;
        let ok = false;
        if (aiIdx < msgs.length) {
          ok = restoreCardDataSnapshot(aiIdx);
        }
        // 截断消息：保留到userIdx+1（含用户消息，移除其后所有）
        msgs.length = userIdx + 1;
        clearSnapshotsAfter(userIdx);
        saveToStorage();
        progress = calcProgress();
        rerenderChatMessages();
        showToast(ok ? '✅ 已撤回此条之后所有AI消息并回滚修改' : '✅ 已撤回此条之后所有AI消息（无快照可回滚，角色卡未变更）', 'success');
      }

      // ===== 重新生成：某条AI消息（撤回该AI回复后重新调用AI）=====
      function regenerateAIMessage(aiIdx) {
        const msgs = getCurrentMessages();
        if (aiIdx < 0 || aiIdx >= msgs.length || msgs[aiIdx].role !== 'assistant') {
          showToast('无法重新生成：该消息不是AI回复', 'warning');
          return;
        }
        if (isGenerating) {
          showToast('AI正在生成中，请稍候', 'warning');
          return;
        }
        // 需要前一条用户消息作为重新生成的依据
        if (aiIdx - 1 < 0 || msgs[aiIdx - 1].role !== 'user') {
          showToast('无法重新生成：找不到对应的用户提问', 'warning');
          return;
        }
        // 检查后面是否还有用户消息——有则禁止，否则后续上下文断裂
        let hasUserAfter = false;
        let userCountAfter = 0;
        let aiCountAfter = 0;
        for (let _ri = aiIdx + 1; _ri < msgs.length; _ri++) {
          if (msgs[_ri].role === 'user') {
            hasUserAfter = true;
            userCountAfter++;
          } else aiCountAfter++;
        }
        if (hasUserAfter) {
          showToast('本条AI之后还有 ' + userCountAfter + ' 条用户消息，无法单独重新生成此条（会导致后续对话上下文断裂）。\n\n请点击【对应那条用户消息的头像→重新生成】，从用户消息整条链路重新生成。', 'warning');
          return;
        }
        if (aiCountAfter > 0 && !confirm('此条AI之后还有 ' + aiCountAfter + ' 条AI回复，重新生成会将这些AI回复一并移除并重建新回答。确定继续？')) return;
        // 回滚该AI消息的cardData修改 + 截断到aiIdx（移除该AI消息及其后所有AI）
        restoreCardDataSnapshot(aiIdx);
        msgs.length = aiIdx;
        clearSnapshotsAfter(aiIdx - 1);
        saveToStorage();
        progress = calcProgress();
        rerenderChatMessages();
        // 重新调用AI（基于已有的最后一条用户消息）
        // ⚠️callAIChat是async，调用处非async上下文，用.catch兜底避免unhandled rejection
        callAIChat().catch(function(err) {
          showToast('重新生成失败：' + (err && err.message ? err.message : ''), 'error');
        });
      }

      // ===== 重新生成：用户消息下面的AI回答 =====
      function regenerateAnswerBelow(userIdx) {
        const msgs = getCurrentMessages();
        if (userIdx < 0 || userIdx >= msgs.length || msgs[userIdx].role !== 'user') {
          showToast('无法重新生成：该消息不是用户消息', 'warning');
          return;
        }
        if (isGenerating) {
          showToast('AI正在生成中，请稍候', 'warning');
          return;
        }
        // 统计该用户消息之后有多少用户消息和AI回复——如果后面还有用户消息，需提示
        let userCountAfter = 0;
        let aiCountAfter = 0;
        for (let _bai = userIdx + 1; _bai < msgs.length; _bai++) {
          if (msgs[_bai].role === 'user') userCountAfter++;
          else aiCountAfter++;
        }
        // 后面还有用户消息：提示上下文断裂风险
        if (userCountAfter > 0) {
          if (!confirm('该用户消息之后还有 ' + userCountAfter + ' 条用户消息 + ' + aiCountAfter + ' 条AI回复。\n\n重新生成本条AI回答时，这些后续消息会被一并移除（因为它们的上下文基于本条之前的AI输出，会导致不一致）。\n\n确定继续？')) return;
        } else if (aiCountAfter > 1) {
          if (!confirm('该用户消息之后还有 ' + aiCountAfter + ' 条AI回复，重新生成会移除这些AI回复并重建新回答。确定继续？')) return;
        }
        // 该用户消息下的AI回答索引 = userIdx+1
        const aiIdx = userIdx + 1;
        if (aiIdx < msgs.length && msgs[aiIdx].role === 'assistant') {
          // 存在AI回答：回滚 + 截断到aiIdx（移除其及之后所有）
          restoreCardDataSnapshot(aiIdx);
          msgs.length = aiIdx;
          clearSnapshotsAfter(userIdx);
        } else {
          // 没有AI回答：截断到userIdx+1（保留该用户消息）
          msgs.length = userIdx + 1;
          clearSnapshotsAfter(userIdx);
        }
        saveToStorage();
        progress = calcProgress();
        rerenderChatMessages();
        // 重新调用AI（基于该用户消息）
        // ⚠️callAIChat是async，用.catch兜底
        callAIChat().catch(function(err) {
          showToast('重新生成失败：' + (err && err.message ? err.message : ''), 'error');
        });
      }

      // ===== 修改：用户消息（原地修改内容，弹窗textArea确认，该消息之后的AI/用户消息全部移除并回滚快照）=====
      function editUserMessage(userIdx) {
        const msgs = getCurrentMessages();
        if (userIdx < 0 || userIdx >= msgs.length || msgs[userIdx].role !== 'user') {
          showToast('无法修改：该消息不是用户消息', 'warning');
          return;
        }
        if (isGenerating) {
          showToast('AI正在生成中，请稍候', 'warning');
          return;
        }
        const origText = msgs[userIdx].content || '';
        // 弹窗：textArea + 取消/确定
        const html = '<div class="modal-content" style="max-width:640px">' +
          '<h3 style="margin:0 0 8px;color:var(--accent-deep)">' + svgIcon('edit', 16) + ' 修改用户消息</h3>' +
          '<div style="font-size:.78em;color:var(--muted);margin-bottom:8px">修改本条消息后，本条之后的所有消息（含AI回答和后续用户消息）将被撤销并回滚对应改动。</div>' +
          '<textarea id="editMsgText" style="width:100%;min-height:160px;font-size:.88em;padding:10px;border:1px solid var(--line);border-radius:var(--radius);font-family:inherit;resize:vertical;box-sizing:border-box">' + escHtml(origText) + '</textarea>' +
          '<div class="modal-actions">' +
          '<button class="btn" id="editMsgCancel" style="background:var(--surface-soft);color:var(--ink-soft);border:1px solid var(--line)">取消</button>' +
          '<button class="btn" id="editMsgOk" style="background:var(--accent);color:#fff">确认修改</button>' +
          '</div></div>';
        const mask = doc.createElement('div');
        mask.className = 'modal';
        mask.innerHTML = html;
        doc.body.appendChild(mask);
        const ta = doc.getElementById('editMsgText');
        if (ta) {
          try {
            ta.focus();
          } catch (_) {}
        }
        const close = function() {
          if (mask.parentNode) mask.parentNode.removeChild(mask);
        };
        doc.getElementById('editMsgCancel').addEventListener('click', close);
        mask.addEventListener('click', function(e) {
          if (e.target === mask) close();
        });
        doc.getElementById('editMsgOk').addEventListener('click', function() {
          const newText = ta ? ta.value : '';
          if (!newText || !newText.trim()) {
            showToast('消息内容不能为空', 'warning');
            return;
          }
          // 1. 该用户消息之后的第一条AI消息：回滚快照（若存在）
          const aiIdx = userIdx + 1;
          if (aiIdx < msgs.length) restoreCardDataSnapshot(aiIdx);
          // 2. 截断到 userIdx+1（保留[0..userIdx]，移除 userIdx 之后的所有）
          msgs.length = userIdx + 1;
          // 3. 原地修改该用户消息内容
          msgs[userIdx].content = newText;
          // 4. 清除此消息之后的快照（此后所有被删的AI回答快照都应丢弃）
          clearSnapshotsAfter(userIdx);
          saveToStorage();
          progress = calcProgress();
          rerenderChatMessages();
          close();
          showToast('消息已修改，之后的回复已撤销', 'success');
          // 自动重新生成（基于修改后的用户消息）
          if (isGenerating) return;
          callAIChat().catch(function(err) {
            showToast('自动重新生成失败：' + (err && err.message ? err.message : ''), 'error');
          });
        });
      }
      // ===== 铅笔按钮：原地编辑消息内容（不截断后续消息、不重新生成）=====
      function editMessageContent(msgIdx, role) {
        const msgs = getCurrentMessages();
        if (msgIdx < 0 || msgIdx >= msgs.length) {
          showToast('无法编辑：消息索引无效', 'warning');
          return;
        }
        if (msgs[msgIdx].role !== role) {
          showToast('无法编辑：消息角色不匹配', 'warning');
          return;
        }
        if (isGenerating) {
          showToast('AI正在生成中，请稍候', 'warning');
          return;
        }
        const origText = msgs[msgIdx].content || '';
        const isAI = (role === 'assistant');
        const titleText = isAI ? '编辑AI消息' : '编辑用户消息';
        const hint = isAI ?
          '直接修改AI的回复文本。保存后仅更新本条消息的显示内容，不会重新生成或撤回后续消息。' :
          '直接修改本条消息文本。保存后仅更新显示内容，不会截断后续消息或重新生成。如需重新生成，请点头像菜单→修改。';
        const html = '<div class="modal-content" style="max-width:640px">' +
          '<h3 style="margin:0 0 8px;color:var(--accent-deep)">' + svgIcon('edit', 16) + ' ' + titleText + '</h3>' +
          '<div style="font-size:.78em;color:var(--muted);margin-bottom:8px">' + hint + '</div>' +
          '<textarea id="editMsgTextInline" style="width:100%;min-height:200px;font-size:.88em;padding:10px;border:1px solid var(--line);border-radius:var(--radius);font-family:inherit;resize:vertical;box-sizing:border-box">' + escHtml(origText) + '</textarea>' +
          '<div class="modal-actions">' +
          '<button class="btn" id="editMsgInlineCancel" style="background:var(--surface-soft);color:var(--ink-soft);border:1px solid var(--line)">取消</button>' +
          '<button class="btn" id="editMsgInlineOk" style="background:var(--accent);color:#fff">保存</button>' +
          '</div></div>';
        const mask = doc.createElement('div');
        mask.className = 'modal';
        mask.innerHTML = html;
        doc.body.appendChild(mask);
        const ta = doc.getElementById('editMsgTextInline');
        if (ta) {
          try {
            ta.focus();
          } catch (_) {}
        }
        const close = function() {
          if (mask.parentNode) mask.parentNode.removeChild(mask);
        };
        doc.getElementById('editMsgInlineCancel').addEventListener('click', close);
        mask.addEventListener('click', function(e) {
          if (e.target === mask) close();
        });
        doc.getElementById('editMsgInlineOk').addEventListener('click', function() {
          const newText = ta ? ta.value : '';
          if (!newText || !newText.trim()) {
            showToast('消息内容不能为空', 'warning');
            return;
          }
          msgs[msgIdx].content = newText;
          saveToStorage();
          rerenderChatMessages();
          close();
          showToast('✅ 消息已更新', 'success');
        });
      }

      function addTyping() {
        removeTyping();
        const c = doc.getElementById('chatMessages');
        if (!c) return;
        const div = doc.createElement('div');
        div.className = 'chat-msg assistant';
        div.id = 'typingInd';
        div.innerHTML = buildAvatarHtml('assistant') + '<div class="bubble typing"><span>●</span><span>●</span><span>●</span> 思考中...</div>';
        // 打字指示器不需要铅笔编辑按钮
        const typingEditBtn = div.querySelector('.msg-edit-btn');
        if (typingEditBtn) typingEditBtn.style.display = 'none';
        c.appendChild(div);
        scrollChat();
      }

      function removeTyping() {
        const t = doc.getElementById('typingInd');
        if (t) t.remove();
      }

      function scrollChat() {
        const c = doc.getElementById('chatMessages');
        if (c) requestAnimationFrame(function() {
          c.scrollTop = c.scrollHeight;
        });
      }
      // ===== 消息 section 分区渲染（参考专家工作区设计）=====
      const cpSectionStates = {};

      function parseMessageSections(text) {
        text = safeStr(text);
        const sections = [];
        const thinkingRe = /(?:<thinking>|<reasoning>|<think>)([\s\S]*?)(?:<\/thinking>|<\/reasoning>|<\/think>)|(?:\[metacognition\]|\[思维链\]|\[果农冒泡\]|\[love_qkll\])([\s\S]*?)(?:\[\/metacognition\]|\[\/思维链\]|\[\/果农冒泡\]|\[\/love_qkll\])/gi;
        let match, lastEnd = 0;
        while ((match = thinkingRe.exec(text)) !== null) {
          if (match.index > lastEnd) {
            const before = text.slice(lastEnd, match.index).trim();
            if (before) sections.push({
              type: 'content',
              content: before
            });
          }
          const thinkContent = (match[1] || match[2] || '').trim();
          if (thinkContent) sections.push({
            type: 'thinking',
            content: thinkContent
          });
          lastEnd = match.index + match[0].length;
        }
        if (lastEnd < text.length) {
          const after = text.slice(lastEnd).trim();
          if (after) sections.push({
            type: 'content',
            content: after
          });
        }
        if (!sections.length) sections.push({
          type: 'content',
          content: text
        });
        // 对 content section 进一步拆分代码块
        const expanded = [];
        sections.forEach(function(sec) {
          if (sec.type !== 'content') {
            expanded.push(sec);
            return;
          }
          const codeRe = /```(\w*)\s*\n?([\s\S]*?)```/g;
          let lastPos = 0,
            m2;
          while ((m2 = codeRe.exec(sec.content)) !== null) {
            if (m2.index > lastPos) {
              const before2 = sec.content.slice(lastPos, m2.index).trim();
              if (before2) expanded.push({
                type: 'content',
                content: before2
              });
            }
            expanded.push({
              type: 'code',
              content: m2[2] || '',
              lang: m2[1] || ''
            });
            lastPos = m2.index + m2[0].length;
          }
          if (lastPos < sec.content.length) {
            const after2 = sec.content.slice(lastPos).trim();
            if (after2) expanded.push({
              type: 'content',
              content: after2
            });
          }
        });
        // 合并连续 content
        const merged = [];
        expanded.forEach(function(s) {
          const last = merged[merged.length - 1];
          if (last && last.type === 'content' && s.type === 'content') {
            last.content += '\n' + s.content;
          } else {
            merged.push(s);
          }
        });
        // 🆕 第三遍：从 content section 中拆出 :::操作块（让操作块也能折叠）
        let finalSections = [];
        merged.forEach(function(sec) {
          if (sec.type !== 'content') {
            finalSections.push(sec);
            return;
          }
          const opRe = /:::\s*(upsert|update|delete|set|rename)\s+[^\n\r]+/gi;
          if (!opRe.test(sec.content)) {
            finalSections.push(sec);
            return;
          }
          // 重置 lastIndex（test 会移动它）
          opRe.lastIndex = 0;
          let lastOpEnd = 0,
            opMatch;
          while ((opMatch = opRe.exec(sec.content)) !== null) {
            if (opMatch.index > lastOpEnd) {
              const before = sec.content.slice(lastOpEnd, opMatch.index).trim();
              if (before) finalSections.push({
                type: 'content',
                content: before
              });
            }
            // 找到对应的结束 ::: （从当前位置开始找下一个单独的 ::: 行）
            const afterStart = opMatch.index + opMatch[0].length;
            const closeRe = /\n\s*:::/g;
            closeRe.lastIndex = afterStart;
            const closeMatch = closeRe.exec(sec.content);
            let opBody, opEnd;
            if (closeMatch) {
              opBody = sec.content.slice(opMatch.index, closeMatch.index + closeMatch[0].length);
              opEnd = closeMatch.index + closeMatch[0].length;
            } else {
              opBody = sec.content.slice(opMatch.index);
              opEnd = sec.content.length;
            }
            finalSections.push({
              type: 'opblock',
              content: opBody
            });
            lastOpEnd = opEnd;
          }
          if (lastOpEnd < sec.content.length) {
            const afterOps = sec.content.slice(lastOpEnd).trim();
            if (afterOps) finalSections.push({
              type: 'content',
              content: afterOps
            });
          }
        });
        // 🆕 第四遍：如果存在:::操作块，剥除冗余的JSON代码块
        // AI有时同时输出:::操作块和JSON代码块（两者内容重复），此时JSON是冗余的，应从显示中移除
        const hasOpBlock = finalSections.some(function(s) {
          return s.type === 'opblock';
        });
        if (hasOpBlock) {
          finalSections = finalSections.filter(function(s) {
            if (s.type !== 'code') return true;
            // JSON代码块（含 { "name" / "entries" / "character_book" 等角色卡字段）视为冗余
            const c = (s.content || '').trim();
            if (c.charAt(0) === '{' && (c.indexOf('"name"') >= 0 || c.indexOf('"entries"') >= 0 || c.indexOf('"character_book"') >= 0 || c.indexOf('"description"') >= 0)) {
              return false; // 剥除
            }
            return true;
          });
        }
        return finalSections;
      }

      function renderMessageSections(sections, msgId) {
        // 🐛修复：单段长文本（>200字）也用折叠包裹，让用户可以缩放
        // 之前只有多段才折叠，导致第一句话（欢迎语）等单段长文本无法缩放
        if (!sections || (sections.length === 1 && sections[0].type === 'content' && sections[0].content.length <= 200)) {
          return fmtBubble(sections ? sections[0].content : '');
        }
        let html = '';
        sections.forEach(function(sec, idx) {
          const stateKey = msgId + '-' + idx;
          // ========== 默认收起：所有 section（思维链/正文/代码）初次渲染均为 collapsed ==========
          // cpSectionStates[key] === true  → 用户已手动展开
          // cpSectionStates[key] === false → 用户已手动收起
          // cpSectionStates[key] === undefined → 未操作过，默认收起
          const isCollapsed = cpSectionStates[stateKey] !== true;
          let icon, label, cls;
          if (sec.type === 'thinking') {
            icon = '思';
            label = '思维链';
            cls = 'cp-section-thinking';
          } else if (sec.type === 'code') {
            icon = '{}';
            label = escHtml(sec.lang || '代码');
            cls = 'cp-section-code';
          } else if (sec.type === 'opblock') {
            icon = '📝';
            cls = 'cp-section-opblock';
            // 从:::行提取操作类型作为label
            // ⚠️ XSS修复：label 来自 AI 输出的 ::: 行剩余文本，必须转义后再拼接
            const opMatch = (sec.content || '').match(/^:::\s*(upsert|update|delete|set|rename)\s+([^\n\r]*)/i);
            if (opMatch) {
              label = escHtml(opMatch[1] + ' ' + (opMatch[2] || '').trim());
            } else {
              label = '操作块';
            }
          } else {
            icon = '答';
            label = '正文';
            cls = 'cp-section-content';
          }
          const preview = (sec.content || '').slice(0, 80).replace(/&/g, '&amp;').replace(/</g, '&lt;');
          html += '<div class="cp-section ' + cls + '">';
          html += '<div class="cp-section-header" data-section-key="' + stateKey + '">';
          html += '<span class="cp-section-icon">' + icon + '</span>';
          html += '<span class="cp-section-label">' + label + '</span>';
          if (isCollapsed && preview) html += '<span class="cp-section-preview">' + preview + '...</span>';
          html += '<span class="cp-section-toggle">' + (isCollapsed ? '展开' : '收起') + '</span>';
          html += '</div>';
          if (!isCollapsed) {
            if (sec.type === 'code') {
              const esc = sec.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              html += '<div class="cp-section-body">' + esc + '</div>';
            } else if (sec.type === 'opblock') {
              // 操作块：转义后等宽字体显示原始:::文本
              const opEsc = sec.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              html += '<div class="cp-section-body"><pre class="cp-opblock-pre">' + opEsc + '</pre></div>';
            } else if (sec.type === 'thinking') {
              html += '<div class="cp-section-body">' + sec.content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</div>';
            } else {
              html += '<div class="cp-section-body">' + fmtBubble(sec.content) + '</div>';
            }
          }
          html += '</div>';
        });
        return html;
      }

      function bindSectionToggles(container) {
        if (!container) return;
        const headers = container.querySelectorAll('.cp-section-header');
        for (let i = 0; i < headers.length; i++) {
          (function(h) {
            h.addEventListener('click', function() {
              const key = h.getAttribute('data-section-key');
              if (!key) return;
              // 当前是否收起：未操作过(undefined)默认收起，或用户设为 false
              const wasCollapsed = cpSectionStates[key] !== true;
              // 切换：收起→展开(true)，展开→收起(false)
              cpSectionStates[key] = wasCollapsed ? true : false;
              // ⚠️泄漏修复：msgId 含 Date.now()+random，rerenderChatMessages/switchTab 重放会生成全新 id，
              // 旧键永不清理导致无界增长。超过上限时清掉最早的键
              const _cpKeys = Object.keys(cpSectionStates);
              if (_cpKeys.length > 500) {
                for (let _ck = 0; _ck < _cpKeys.length - 400; _ck++) delete cpSectionStates[_cpKeys[_ck]];
              }
              const msgEl = h.closest('.chat-msg');
              if (msgEl) {
                const msgId = msgEl.getAttribute('data-msg-id');
                const bubble = msgEl.querySelector('.bubble');
                const raw = bubble ? bubble.getAttribute('data-raw-text') : '';
                if (bubble && raw) {
                  const secs = parseMessageSections(raw);
                  bubble.innerHTML = renderMessageSections(secs, msgId);
                  bindSectionToggles(bubble);
                }
              }
            });
          })(headers[i]);
        }
      }

      function fmtBubble(t) {
        t = safeStr(t);
        const parts = [];
        const re = /<statusblock>([\s\S]*?)<\/statusblock>/gi;
        let last = 0;
        let m;
        while ((m = re.exec(t)) !== null) {
          if (m.index > last) {
            parts.push({
              type: 'text',
              content: t.substring(last, m.index)
            });
          }
          parts.push({
            type: 'status',
            content: m[1]
          });
          last = m.index + m[0].length;
        }
        if (last < t.length) {
          parts.push({
            type: 'text',
            content: t.substring(last)
          });
        }
        let out = '';
        parts.forEach(function(p) {
          if (p.type === 'status') {
            out += '<div class="sb-wrap">' + parseStatusblock(p.content) + '</div>';
          } else {
            let h = p.content;
            const placeholders = [];
            const iframes = [];
            // ===== 保护阶段：先做 iframe → 再做代码块 → 最后做 Markdown =====
            // ⚠️占位符用 \u0000 包裹，避免被 Markdown 的 __bold__ 正则吃掉
            // 1) ```html 代码块优先转 iframe（必须放在一般 ```\w* 之前）
            h = h.replace(/```html\s*\n([\s\S]*?)```/gi, function(_, code) {
              iframes.push(renderHtmlToIframe(code.replace(/\\n/g, '\n')));
              return '\u0000HTML_IFRAME_' + (iframes.length - 1) + '\u0000';
            });
            // 2) 检测消息中直接包含的完整HTML文档（非代码块格式）
            h = h.replace(/(?:html\s*[\n\\n]+)?(<!doctype html>[\s\S]*?<\/html>)/gi, function(_, htmlCode) {
              const code = htmlCode.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
              iframes.push(renderHtmlToIframe(code));
              return '\u0000HTML_IFRAME_' + (iframes.length - 1) + '\u0000';
            });
            // 3) 所有 ``` 代码块存占位符（含 ```json / ```js 等），内容必须 HTML 转义后再塞回
            h = h.replace(/```(\w*)\s*\n([\s\S]*?)```/gi, function(_, lang, code) {
              const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              const cls = lang ? ' class="lang-' + lang.replace(/[^a-zA-Z0-9_-]/g, '') + '"' : '';
              placeholders.push('<pre><code' + cls + '>' + escaped + '</code></pre>');
              return '\u0000PROTECTED_BLOCK_' + (placeholders.length - 1) + '\u0000';
            });
            // ===== 转义 + Markdown 渲染 =====
            h = h.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // 标题 ### / ## / #
            h = h.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>');
            h = h.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');
            h = h.replace(/^#\s+(.+)$/gm, '<h2>$1</h2>');
            // 分隔线
            h = h.replace(/^(---|\*\*\*)$/gm, '<hr>');
            // 引用块
            h = h.replace(/^&gt;\s?(.*)$/gm, function(_, txt) {
              return '__BQ__' + txt;
            });
            h = h.replace(/(__BQ__(?:.*\n?)*)/g, function(m) {
              const inner = m.replace(/__BQ__/g, '').replace(/\n$/, '');
              return '<blockquote>' + inner + '</blockquote>';
            });
            // ===== GFM 表格（必须在换行 → <br> 之前处理，按段落解析） =====
            h = h.replace(/^((?:\|.*\|\n)+)$/gm, function(block) {
              const lines = block.replace(/\n$/, '').split(/\n/);
              if (lines.length < 2) return block;
              // 取第二行判断是否为分隔线（:---|:---:|---: 之类）
              const sep = lines[1].replace(/^\s*\||\|\s*$/g, '').split(/\s*\|\s*/);
              const isSep = sep.length > 0 && sep.every(function(s) {
                return /^:?-{3,}:?$/.test(s.trim());
              });
              if (!isSep) return block;
              // 解析表头
              const headers = lines[0].replace(/^\s*\||\|\s*$/g, '').split(/\s*\|\s*/);
              const aligns = sep.map(function(s) {
                const t = s.trim();
                if (t.charAt(0) === ':' && t.charAt(t.length - 1) === ':') return 'center';
                if (t.charAt(t.length - 1) === ':') return 'right';
                if (t.charAt(0) === ':') return 'left';
                return '';
              });
              const thead = '<thead><tr>' + headers.map(function(hd, i) {
                const st = aligns[i] ? ' style="text-align:' + aligns[i] + '"' : '';
                return '<th' + st + '>' + hd.trim() + '</th>';
              }).join('') + '</tr></thead>';
              let bodyRows = '';
              for (let ri = 2; ri < lines.length; ri++) {
                const cells = lines[ri].replace(/^\s*\||\|\s*$/g, '').split(/\s*\|\s*/);
                bodyRows += '<tr>' + cells.map(function(ce, ci) {
                  const st = aligns[ci] ? ' style="text-align:' + aligns[ci] + '"' : '';
                  return '<td' + st + '>' + ce.trim() + '</td>';
                }).join('') + '</tr>';
              }
              const tbody = bodyRows ? '<tbody>' + bodyRows + '</tbody>' : '';
              return '<div class="md-table-wrap"><table>' + thead + tbody + '</table></div>';
            });
            // 无序列表 - 或 *
            h = h.replace(/^[\-\*]\s+(.+)$/gm, function(_, txt) {
              return '__UL__' + txt;
            });
            h = h.replace(/(__UL__(?:.*\n?)*)/g, function(m) {
              const items = m.replace(/__UL__/g, '').split(/\n/).filter(function(x) {
                return x;
              });
              return '<ul>' + items.map(function(it) {
                return '<li>' + it + '</li>';
              }).join('') + '</ul>';
            });
            // 有序列表 1.
            h = h.replace(/^\d+\.\s+(.+)$/gm, function(_, txt) {
              return '__OL__' + txt;
            });
            h = h.replace(/(__OL__(?:.*\n?)*)/g, function(m) {
              const items = m.replace(/__OL__/g, '').split(/\n/).filter(function(x) {
                return x;
              });
              return '<ol>' + items.map(function(it) {
                return '<li>' + it + '</li>';
              }).join('') + '</ol>';
            });
            // 行内
            h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
            h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
            h = h.replace(/__(.+?)__/g, '<b>$1</b>');
            // 行内斜体：⚠️兼容性修复——lookbehind (?<!\*) 在 Safari<16.4/旧Chrome 会抛 SyntaxError，
            // 且正则字面量在脚本解析期求值，会导致整个脚本加载失败。改用捕获组排除法实现同样语义：
            // 匹配单个 *xx* 且两侧都不是 *（避免误吃 **粗体** 残留的星号）
            h = h.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, function(_m, pre, txt) {
              return pre + '<i>' + txt + '</i>';
            });
            h = h.replace(/~~(.+?)~~/g, '<del>$1</del>');
            // 换行
            h = h.replace(/\n{3,}/g, '\n\n');
            h = h.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
            // 还原 iframe → 代码块（用 split/join 全局替换，避免 replace 只替换首个）
            for (let ii = 0; ii < iframes.length; ii++) {
              h = h.split('\u0000HTML_IFRAME_' + ii + '\u0000').join(iframes[ii]);
            }
            for (let pi = 0; pi < placeholders.length; pi++) {
              h = h.split('\u0000PROTECTED_BLOCK_' + pi + '\u0000').join(placeholders[pi]);
            }
            out += h;
          }
        });
        return out;
      }

      function renderHtmlToIframe(htmlCode) {
        if (!htmlCode || htmlCode.length < 50) return '';
        /* 注入与状态栏预览一致的完整 mock 运行时（getAllVariables/_/$/waitGlobalInitialized/eventOn/Mvu/errorCatched），
           保证状态栏 HTML 在聊天内预览也能正确渲染变量 */
        const mockScript = buildPreviewMockScript(getStatDataForRender());
        if (htmlCode.indexOf('<head') >= 0) {
          htmlCode = htmlCode.replace(/<head([^>]*)>/i, '<head$1>' + mockScript);
        } else if (htmlCode.indexOf('<html') >= 0) {
          htmlCode = htmlCode.replace(/<html([^>]*)>/i, '<html$1><head>' + mockScript + '</head>');
        } else {
          htmlCode = mockScript + htmlCode;
        }
        const escHtml = htmlCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return '<iframe class="html-render-frame" loading="lazy" srcdoc="' + escHtml + '" sandbox="allow-scripts" style="width:100%;min-height:280px;border:1px solid #e6dfd0;border-radius:6px;background:transparent"></iframe>';
      }

      function getStatDataForRender() {
        let statData = {};
        const entries = (cardData.character_book && cardData.character_book.entries) || [];
        let initVarEntry = null;
        for (let i = 0; i < entries.length; i++) {
          if (_isInitVarComment(entries[i].comment, entries[i].content)) {
            initVarEntry = entries[i];
            break;
          }
        }
        if (initVarEntry && initVarEntry.content) {
          const parsed = parseInitVar(initVarEntry.content);
          if (parsed) statData = parsed;
        }
        return statData;
      }
      // 构建预览用 mock 运行时脚本（模拟酒馆环境），供聊天内 iframe 预览与状态栏预览弹窗共用
      // 提供 getAllVariables / waitGlobalInitialized / eventOn / errorCatched / Mvu / _ / $ + fallback 渲染
      function buildPreviewMockScript(statData) {
        statData = statData || {};
        const statDataJson = JSON.stringify(statData).replace(/<\/script/gi, '<\\/script');
        return '<script>\n' +
          '/* === 写卡器预览用 mock API（模拟酒馆运行时）=== */\n' +
          '(function() {\n' +
          '  var statData = ' + statDataJson + ';\n' +
          '  window.__PREVIEW_MOCK_STAT_DATA__ = statData;\n' +
          '  window.getAllVariables = function() { return { stat_data: statData }; };\n' +
          '  window.waitGlobalInitialized = function(name) { return Promise.resolve(); };\n' +
          '  window.eventOn = function(evt, cb) {};\n' +
          '  window.errorCatched = function(fn) {\n' +
          '    return function() {\n' +
          '      try {\n' +
          '        var r = fn.apply(this, arguments);\n' +
          '        if (r && typeof r.catch === "function") {\n' +
          '          r.catch(function(e) { console.warn("[预览 mock] statusbar async error:", e && e.message, e && e.stack); });\n' +
          '        }\n' +
          '        return r;\n' +
          '      } catch(e) { console.warn("[预览 mock] statusbar sync error:", e && e.message, e && e.stack); }\n' +
          '    };\n' +
          '  };\n' +
          '  window.Mvu = { events: { VARIABLE_INITIALIZED: "VARIABLE_INITIALIZED", VARIABLE_UPDATE_ENDED: "VARIABLE_UPDATE_ENDED" } };\n' +
          '  // StageDog 标准变量 API：getVariables(option) 消息级 scope\n' +
          '  window.getVariables = function(opt) {\n' +
          '    opt = opt || {};\n' +
          '    // type: "message" → 当前楼层变量；默认"latest"\n' +
          '    // 返回结构与 getAllVariables 一致（预览模式下不区分楼层）\n' +
          '    return { stat_data: window.__PREVIEW_MOCK_STAT_DATA__ || {} };\n' +
          '  };\n' +
          '  window._ = {\n' +
          '    get: function(obj, path, def) {\n' +
          '      if (obj == null) return def;\n' +
          '      var keys = String(path).split(".");\n' +
          '      var cur = obj;\n' +
          '      for (var i = 0; i < keys.length; i++) {\n' +
          '        if (cur == null) return def;\n' +
          '        cur = cur[keys[i]];\n' +
          '      }\n' +
          '      return cur === undefined ? def : cur;\n' +
          '    },\n' +
          '    has: function(obj, path) {\n' +
          '      if (obj == null) return false;\n' +
          '      var keys = String(path).split(".");\n' +
          '      var cur = obj;\n' +
          '      for (var i = 0; i < keys.length; i++) {\n' +
          '        if (cur == null || !Object.prototype.hasOwnProperty.call(cur, keys[i])) return false;\n' +
          '        cur = cur[keys[i]];\n' +
          '      }\n' +
          '      return true;\n' +
          '    }\n' +
          '  };\n' +
          '  function _miniJQ(sel) {\n' +
          '    if (typeof sel === "function") {\n' +
          '      try {\n' +
          '        if (document.readyState === "complete" || document.readyState === "interactive") { sel(); }\n' +
          '        else { document.addEventListener("DOMContentLoaded", sel); }\n' +
          '      } catch(e) { console.warn("[预览 mock] $(fn):", e); }\n' +
          '      return { ready: function(fn) { try { fn(); } catch(e) {} return this; } };\n' +
          '    }\n' +
          '    var el = (typeof sel === "string") ? document.querySelector(sel) : sel;\n' +
          '    return {\n' +
          '      0: el, length: el ? 1 : 0,\n' +
          '      html: function(s) { if (el) el.innerHTML = (s == null ? (el.innerHTML || "") : String(s)); return this; },\n' +
          '      text: function(s) { if (el) el.textContent = s; return this; },\n' +
          '      addClass: function(c) { if (el) el.classList.add(c); return this; },\n' +
          '      removeClass: function(c) { if (el) el.classList.remove(c); return this; },\n' +
          '      ready: function(fn) { try { fn(); } catch(e) {} return this; }\n' +
          '    };\n' +
          '  }\n' +
          '  window.$ = window.jQuery = _miniJQ;\n' +
          '  function fallbackRender() {\n' +
          '    var root = document.getElementById("render-root") || document.querySelector(".card-body") || document.body;\n' +
          '    if (!root) return;\n' +
          '    var stillLoading = root.querySelector(".loading-state");\n' +
          '    if (!stillLoading) return;\n' +
          '    var htmlStr = "";\n' +
          '    var data = statData || {};\n' +
          '    function rt(obj, level) {\n' +
          '      level = level || 0;\n' +
          '      var indentClass = "indent-" + Math.min(level, 4);\n' +
          '      var itemsHtml = "";\n' +
          '      var keys = Object.keys(obj || {});\n' +
          '      for (var k = 0; k < keys.length; k++) {\n' +
          '        var key = keys[k];\n' +
          '        var value = obj[key];\n' +
          '        if (key.indexOf("_") === 0 || key.indexOf("$") === 0) continue;\n' +
          '        var isPlainObj = value !== null && typeof value === "object" && !Array.isArray(value);\n' +
          '        if (isPlainObj) {\n' +
          '          if (itemsHtml) { htmlStr += "<div class=\\"stat-grid " + indentClass + "\\">" + itemsHtml + "</div>"; itemsHtml = ""; }\n' +
          '          if (level > 0) { htmlStr += "<div class=\\"category-title " + indentClass + "\\">" + key + "</div>"; }\n' +
          '          rt(value, level + 1);\n' +
          '          continue;\n' +
          '        }\n' +
          '        itemsHtml += "<div class=\\"stat-item\\"><span class=\\"stat-label\\">" + key + "</span><span class=\\"stat-value\\">";\n' +
          '        if (typeof value === "number") itemsHtml += "<span class=\\"value-number\\">" + value + "</span>";\n' +
          '        else if (typeof value === "boolean") itemsHtml += value ? "<span class=\\"value-true\\">✓</span>" : "<span class=\\"value-false\\">✕</span>";\n' +
          '        else if (Array.isArray(value)) itemsHtml += "<span class=\\"value-text\\">[" + value.join(", ") + "]</span>";\n' +
          '        else itemsHtml += "<span class=\\"value-text\\">" + String(value == null ? "" : value) + "</span>";\n' +
          '        itemsHtml += "</span></div>";\n' +
          '      }\n' +
          '      if (itemsHtml) htmlStr += "<div class=\\"stat-grid " + indentClass + "\\">" + itemsHtml + "</div>";\n' +
          '    }\n' +
          '    rt(data, 0);\n' +
          '    try {\n' +
          '      root.innerHTML = htmlStr;\n' +
          '      root.classList.add("flash-update");\n' +
          '      setTimeout(function() { try { root.classList.remove("flash-update"); } catch(_) {} }, 300);\n' +
          '    } catch(_) {}\n' +
          '  }\n' +
          '  setTimeout(fallbackRender, 500);\n' +
          '  setTimeout(fallbackRender, 1500);\n' +
          '  setTimeout(fallbackRender, 3500);\n' +
          '})();\n' +
          '<\/script>\n';
      }
      // ===== statusblock 渲染：统一走 Markdown 管道（兼容旧 HTML 格式自动转换） =====
      function parseStatusblock(inner) {
        let md = inner;
        // ===== 向后兼容：把旧 HTML 标签格式自动转成 Markdown =====
        // <details open><summary><b>标题</b></summary> → ### 标题
        md = md.replace(/<details(?:\s+open)?\s*>[\s\S]*?<summary>(?:<b>)?([\s\S]*?)(?:<\/b>)?<\/summary>/gi, function(_, title) {
          return '\n### ' + title.trim() + '\n\n';
        });
        md = md.replace(/<\/details>/gi, '\n');
        // <ul><li><b>key</b>：value</li> → - **key**：value
        md = md.replace(/<ul>/gi, '\n').replace(/<\/ul>/gi, '\n');
        md = md.replace(/<ol>/gi, '\n').replace(/<\/ol>/gi, '\n');
        md = md.replace(/<li>/gi, '- ').replace(/<\/li>/gi, '\n');
        // <p><b>key</b>：value</p> → **key**：value
        md = md.replace(/<p>/gi, '\n').replace(/<\/p>/gi, '\n');
        // <b>text</b> → **text**
        md = md.replace(/<b>/gi, '**').replace(/<\/b>/gi, '**');
        // <br> → 换行
        md = md.replace(/<br\s*\/?>/gi, '\n');
        // 清理残留 HTML 标签
        md = md.replace(/<\/?(?:span|div|button)[^>]*>/gi, '');
        // 清理多余空行
        md = md.replace(/\n{3,}/g, '\n\n').trim();
        // ===== 走 fmtBubble 的 Markdown 管道渲染 =====
        return fmtBubble(md);
      }

      // ctx-bar 防抖刷新：高频成对的刷新请求（消息渲染/合并/预览）合并为一次
      let _ctxBarRenderTimer = null;
      function scheduleCtxBarUpdate() {
        if (_ctxBarRenderTimer) return;
        _ctxBarRenderTimer = setTimeout(function() {
          _ctxBarRenderTimer = null;
          updateCtxBar();
        }, CONFIG.CTX_BAR_DEBOUNCE_MS);
      }

      function escHtml(t) {
        /* 改进O：改用字符串替换避免每次创建DOM节点（高频调用场景性能提升） */
        if (!t) return '';
        return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      function escAttr(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      let lastUserInput = '';
      // ============================================================================
      // SECTION 10 聊天消息发送 + AI 写卡流程主循环（callAIChat）
      // ============================================================================
      async function handleSend() {
        const input = doc.getElementById('chatInput');
        const text = input ? input.value.trim() : '';
        if (!text || isGenerating) return;
        input.value = '';
        input.style.height = 'auto'; // 发送后重置输入框高度
        lastUserInput = text;
        const genKw = ['生成角色卡', '生成完整角色卡', '导出角色卡', '写入酒馆', '完整生成'];
        // ⚠️修复：否定语境不算生成指令（"不要导出角色卡"原先会命中 indexOf 误触发 doGenerate）
        const isNegation = /不要|别|不许|禁止|无需|不用/.test(text.slice(0, 12));
        const isGenCmd = !isNegation && genKw.some(function(k) {
          return text === k || text.indexOf(k) >= 0;
        });
        if (isGenCmd && progress >= 30) {
          // ⚠️修复：MVU Tab 下 doGenerate 直接弹 toast 返回，会留下一条无 AI 回复的孤立用户消息。
          // 先判断 Tab，MVU Tab 下按普通聊天走 callAIChat
          if (currentTab === 'mvu') {
            addUserMsg(text);
            await callAIChat();
            return;
          }
          addUserMsg(text);
          await doGenerate();
          return;
        }
        addUserMsg(text);
        await callAIChat();
      }

      // ===== AI回复清理（移除思考链、内部标签等） =====
      function cleanAIReply(text) {
        if (text == null) return '';
        if (typeof text !== 'string') text = String(text);
        let t = text;
        t = t.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
        t = t.replace(/<!--\s*End of The ECoT\s*-->/gi, '');
        t = t.replace(/^#\s*果农人格加载[^\n]*\n/gim, '');
        t = t.replace(/\*果农记录[：:][^*]*\*/g, '');
        t = t.replace(/<time_format>[\s\S]*?<\/time_format>/gi, '');
        t = t.replace(/<content>/gi, '').replace(/<\/content>/gi, '');
        t = t.replace(/^\[(语言检定|果农冒泡|NSFW判定|人物逻辑|基调锚定|角色认知迷雾|角色活性与自然回应|风格适配|反思\s*&?\s*设定校对|物理规则|正文字数检测|输出顺序检查|时间地点输出检查|善意视角|防重复|反思)\][^\n]*\n/gim, '');
        t = t.replace(/<角色认知迷雾>[\s\S]*?<\/角色认知迷雾>/gi, '');
        t = t.replace(/<角色活性与自然回应>[\s\S]*?<\/角色活性与自然回应>/gi, '');
        t = t.replace(/\n{4,}/g, '\n\n\n');
        t = t.trim();
        return t;
      }

      // ===== 从AI回复中提取JSON =====
      function extractJSON(text) {
        if (typeof text !== 'string') return null;
        const patterns = [
          /```json\s*([\s\S]*?)\s*```/i,
          /```javascript\s*([\s\S]*?)\s*```/i,
          /```js\s*([\s\S]*?)\s*```/i,
          /```\s*([\s\S]*?)\s*```/i,
        ];
        for (let i = 0; i < patterns.length; i++) {
          const m = text.match(patterns[i]);
          if (m) {
            const jsonContent = m[1].trim();
            try {
              return JSON.parse(jsonContent);
            } catch (e) { logWarn("extractJSON", e); }
            const fixed = repairJSON(jsonContent);
            if (fixed) return fixed;
          }
        }
        const braceStart = text.indexOf('{');
        const braceEnd = text.lastIndexOf('}');
        if (braceStart >= 0 && braceEnd > braceStart) {
          const candidate = text.substring(braceStart, braceEnd + 1);
          try {
            return JSON.parse(candidate.trim());
          } catch (e) { logWarn("extractJSON", e); }
          const fixed2 = repairJSON(candidate);
          if (fixed2) return fixed2;
        }
        return null;
      }

      // ===== 🆕 ::: 操作块协议解析器 =====
      // 新协议：AI 用 ::: action key ... ::: 声明每条操作，无需JSON代码块
      // 支持5种操作：upsert / update / delete / set / rename
      // 兼容旧JSON：如果AI仍输出```json块，走原有 extractJSON + mergePartial 路径

      // 规范化key：去装饰括号 + trim + 大小写折叠（复用已有逻辑）
      function _opNormKey(s) {
        if (!s) return '';
        let r = String(s).trim();
        for (let iter = 0; iter < 2; iter++) {
          const pairs = [
            ['⟦', '⟧'],
            ['【', '】'],
            ['「', '」'],
            ['『', '』'],
            ['［', '］'],
            ['《', '》'],
            ['〈', '〉'],
            ['(', ')'],
            ['[', ']'],
            ['{', '}']
          ];
          let matched = false;
          for (let pi = 0; pi < pairs.length; pi++) {
            const L = pairs[pi][0],
              R = pairs[pi][1];
            if (r.length >= 4 && r.charAt(0) === L && r.charAt(r.length - 1) === R) {
              r = r.slice(1, -1).trim();
              matched = true;
              break;
            }
          }
          if (!matched) break;
        }
        return r.toLowerCase();
      }

      // 解析 ::: 操作块，返回操作数组
      function parseOpBlocks(rawText) {
        if (typeof rawText !== 'string') return [];
        const ops = [];
        // 匹配 ::: action key ... 格式（key 到换行/行尾为止，content 到下一个 ::: 为止）
        // 用单个 \n 分隔 key 和 content，避免 [\r\n]+ 贪婪吃掉多个换行导致 content 起点错误
        // 前瞻允许中间有空行（\n\s*:::），解决 delete 后紧跟空行再接下一个操作的问题
        // ⚠️修复：用 (?:^|\n) 锚定行首，避免AI散文里的内联引用（如"使用`::: upsert script:xxx`协议"）
        //   被误匹配为操作块，从而生成垃圾脚本/条目并吞掉真正的:::块。
        // ⚠️【修复AI删除条目不生效 #1】强制要求每个 :::action key ... 必须用一个单独行的 ::: 结束（闭合）。
        //   原来前瞻写法 (?=\n[ \t]*:::|$) 允许 delete 后跟"没有闭合的:::"，AI在delete后直接写自然语言或另一个:::块开头，
        //   会导致块体错误吞掉后续大段文本，最终 parseOpBlocks 解析出的 delete.key 里混有"删除理由/下一动作"等垃圾内容，
        //   applyOps / mergePartial 都匹配不到条目。这是用户反馈"AI明明写了删除但预览还堆叠"的主要根因。
        //   新规则：块结束 = 【必须】行首（允许前导空格/制表）三冒号 + 行尾空白。
        //   delete/rename/set 这类无正文动作允许"紧凑写法"（闭合:::紧跟下一行，块体为空），
        //   也兼容 CRLF；若闭合:::后直接接下一个动作开头（"::: delete X\n\n::: set field"），
        //   该:::同时视为上一块闭合+下一块开头（提示词示例里存在这种写法）。
        const re = /(?:^|\r?\n)[ \t]*:::\s*(upsert|update|delete|set|rename)\s+([^\n\r]+?)(?:\r?\n([\s\S]*?))?(?=\r?\n?[ \t]*:::(?:[ \t]*(?:\r?\n|$)|[ \t]+(?:upsert|update|delete|set|rename)\b))/gi;
        let m;
        while ((m = re.exec(rawText)) !== null) {
          const action = m[1].toLowerCase();
          const key = m[2].trim();
          // 从块体里剥离后面会被前瞻一并捕获的闭合:::行（前瞻只是锚定，内容里仍可能含尾空格/换行）
          const rawBody = (m[3] || '').replace(/\n[ \t]*:::[ \t]*$/, '').replace(/\n[ \t]*:::[ \t]*\n$/, '\n').trim();
          let content = rawBody;
          // ===== ✅新增：解析 upsert/update 块体开头的元信息头（keys/secondary_keys/selectiveLogic/constant/depth/cooldown等）=====
          //   格式：块体第1行开始，连续出现 `键=值`（单行）行，直到遇到第1个空行或遇到不以"键名="开头的行为止。
          //   之后的部分（空行之后 / 非键=值行开始之后）才是真正的 content 正文。
          //   支持的键（覆盖ST世界书40字段中可通过操作块配置的全部字段）：
          //   keys, secondary_keys, selectiveLogic, constant, depth, cooldown, sticky, delay, vectorized,
          //   prevent_recursion, exclude_recursion, delay_until_recursion, use_regex, probability, group, order,
          //   role, case_sensitive, use_group_scoring, group_override, ignore_budget, addMemo, outlet_name,
          //   automation_id, triggers, match_*（match_persona_description 等6个匹配字段）
          const metaFields = ['keys', 'secondary_keys', 'selectiveLogic', 'constant', 'selective', 'depth', 'cooldown', 'sticky', 'delay',
            'vectorized', 'prevent_recursion', 'exclude_recursion', 'delay_until_recursion', 'use_regex',
            'probability', 'group', 'order', 'insertion_order', 'position', 'useProbability', 'scan_depth',
            'match_whole_words', 'enabled', 'group_weight', 'role', 'case_sensitive', 'use_group_scoring',
            'group_override', 'ignore_budget', 'addMemo', 'outlet_name', 'automation_id', 'triggers',
            'match_persona_description', 'match_character_description', 'match_character_personality',
            'match_character_depth_prompt', 'match_scenario', 'match_creator_notes'
          ];
          const _stripMeta = function(bodyStr) {
            const lines = bodyStr.split(/\r?\n/);
            const meta = {};
            let splitIdx = -1; // 正文从第几行开始
            for (let li = 0; li < lines.length; li++) {
              const line = lines[li];
              const tline = line.trim();
              if (tline === '') {
                splitIdx = li + 1;
                break;
              } // 空行 → 元信息结束
              const eq = tline.indexOf('=');
              if (eq < 2) {
                splitIdx = li;
                break;
              } // 不以"键="开头 → 元信息结束
              const k = tline.substring(0, eq).trim();
              const v = tline.substring(eq + 1).trim();
              let matchedKey = null;
              for (let mi = 0; mi < metaFields.length; mi++) {
                if (metaFields[mi].toLowerCase() === k.toLowerCase()) {
                  matchedKey = metaFields[mi];
                  break;
                }
              }
              if (!matchedKey) {
                splitIdx = li;
                break;
              } // 不是已知元信息键 → 元信息结束
              // 值解析
              if (matchedKey === 'keys' || matchedKey === 'secondary_keys' || matchedKey === 'triggers') {
                meta[matchedKey] = v.split(/[,，]/).map(function(s) {
                  return s.trim();
                }).filter(function(s) {
                  return s.length > 0;
                });
              } else if (matchedKey === 'constant' || matchedKey === 'vectorized' || matchedKey === 'prevent_recursion' ||
                matchedKey === 'exclude_recursion' || matchedKey === 'use_regex' || matchedKey === 'useProbability' ||
                matchedKey === 'match_whole_words' || matchedKey === 'enabled' || matchedKey === 'use_group_scoring' ||
                matchedKey === 'group_override' || matchedKey === 'ignore_budget' || matchedKey === 'addMemo' ||
                matchedKey === 'selective' ||
                matchedKey === 'match_persona_description' || matchedKey === 'match_character_description' ||
                matchedKey === 'match_character_personality' || matchedKey === 'match_character_depth_prompt' ||
                matchedKey === 'match_scenario' || matchedKey === 'match_creator_notes') {
                meta[matchedKey] = /^(true|1|yes|是)$/i.test(v);
              } else if (matchedKey === 'group' || matchedKey === 'outlet_name' || matchedKey === 'automation_id') {
                meta[matchedKey] = v;
              } else if (matchedKey === 'role') {
                const n = Number(v);
                meta[matchedKey] = (!isNaN(n) && String(n) === v) ? n : v;
              } else {
                const n = Number(v);
                meta[matchedKey] = (!isNaN(n) && String(n) === v) ? n : v;
              }
            }
            const bodyLines = (splitIdx >= 0) ? lines.slice(splitIdx) : lines;
            return {
              meta: meta,
              content: bodyLines.join('\n').trim()
            };
          };
          if (action === 'upsert' || action === 'update') {
            const r = _stripMeta(rawBody);
            for (let mk in r.meta) {
              if (r.meta.hasOwnProperty(mk)) ops._metaFields = ops._metaFields || {};
            } // no-op 兼容
            // 把解析出的元信息直接挂到 op 上（applyOps 里会用），content 用剥离元信息后的正文
            content = r.content;
            const opRec = {
              action: action,
              key: key,
              content: content
            };
            for (let _mk in r.meta) {
              if (r.meta.hasOwnProperty(_mk)) opRec[_mk] = r.meta[_mk];
            }
            ops.push(opRec);
            continue;
          }
          // rename 格式：::: rename oldKey → newKey
          if (action === 'rename') {
            const arrowMatch = key.match(/^(.+?)\s*(?:->|→|=>)\s*(.+)$/);
            if (arrowMatch) {
              ops.push({
                action: 'rename',
                oldKey: arrowMatch[1].trim(),
                newKey: arrowMatch[2].trim(),
                content: ''
              });
            } else {
              // 没有箭头，尝试用空格分割
              const parts = key.split(/\s+/);
              if (parts.length >= 2) {
                ops.push({
                  action: 'rename',
                  oldKey: parts[0],
                  newKey: parts.slice(1).join(' '),
                  content: ''
                });
              }
            }
          } else {
            ops.push({
              action: action,
              key: key,
              content: content
            });
          }
        }
        return ops;
      }

      // 检测AI回复是否包含:::操作块（行首锚定，避免散文内联引用误判）——同时要求块必须存在闭合:::行，
      // 否则 hasOpBlocks 会误判"我要输出:::协议"这种说明性文本也算有效块，导致旧JSON路径被跳过。
      function hasOpBlocks(rawText) {
        if (typeof rawText !== 'string') return false;
        // 至少要有 开始行 + 闭合行 两个:::。兼容紧凑写法（:::action key 换行即闭合:::）和 CRLF。
        return /(?:^|\r?\n)[ \t]*:::\s*(?:upsert|update|delete|set|rename)\s+[^\n\r]+?(?:\r?\n[\s\S]*?)?\r?\n?[ \t]*:::[ \t]*(?:\r?\n|$)/i.test(rawText);
      }

      // 执行操作数组，返回 { modified, changeLog }
      function applyOps(ops, cd) {
        if (!ops || !ops.length || !cd) return {
          modified: false,
          changeLog: {
            added: 0,
            updated: 0,
            deleted: 0,
            fieldUpdates: 0,
            renamed: 0
          }
        };
        let modified = false;
        const changeLog = {
          added: 0,
          updated: 0,
          deleted: 0,
          fieldUpdates: 0,
          renamed: 0
        };

        // 确保基础结构存在
        if (!cd.character_book) cd.character_book = {
          entries: []
        };
        if (!cd.character_book.entries) cd.character_book.entries = [];
        if (!cd.extensions) cd.extensions = {};
        if (!cd.extensions.tavern_helper) cd.extensions.tavern_helper = {
          scripts: []
        };
        if (!cd.extensions.tavern_helper.scripts) cd.extensions.tavern_helper.scripts = [];
        if (!cd.extensions.regex_scripts) cd.extensions.regex_scripts = [];

        // 合法的顶层字段（set操作用）
        const validFields = ['name', 'description', 'first_mes', 'system_prompt', 'personality', 'scenario', 'creator_notes', 'alternate_greetings', 'creator', 'character_version', 'depth_prompt', 'mes_example', 'nickname'];

        // MVU条目关键词（用于Tab隔离：角色卡Tab下拦截MVU条目写入）
        function _isMvuEntryKey(comment) {
          const c = (comment || '').toLowerCase();
          return c.indexOf('[initvar]') >= 0 || c.indexOf('变量列表') >= 0 ||
            c.indexOf('变量更新规则') >= 0 || c.indexOf('变量输出格式') >= 0 ||
            c.indexOf('mvu_update') >= 0 || c.indexOf('[mvu_update]') >= 0 ||
            c.indexOf('状态变量输出') >= 0;
        }

        ops.forEach(function(op) {
          // ===== Tab隔离：角色卡Tab下拦截MVU条目写入 =====
          if (currentTab === 'card' && (op.action === 'upsert' || op.action === 'update' || op.action === 'delete')) {
            if (_isMvuEntryKey(op.key)) {
              console.warn('[Tab隔离·角色卡Tab] :::操作块拦截MVU条目:', op.key);
              return;
            }
          }

          // ===== script 操作：修改 extensions.tavern_helper.scripts =====
          if (op.action === 'upsert' || op.action === 'update') {
            // 检测是否是脚本操作（key以 script: 开头）
            if (op.key && /^script:/i.test(op.key)) {
              const scriptName = op.key.replace(/^script:\s*/i, '').trim();
              const scripts = cd.extensions.tavern_helper.scripts;
              // 查找现有脚本
              let sFoundIdx = -1;
              for (let si = 0; si < scripts.length; si++) {
                if ((scripts[si].name || '').toLowerCase() === scriptName.toLowerCase() ||
                  (scripts[si].id || '') === scriptName) {
                  sFoundIdx = si;
                  break;
                }
              }
              if (sFoundIdx >= 0) {
                // 更新（固定脚本拦截）
                if (isFixedMvuScript(scripts[sFoundIdx])) {
                  console.warn('[opblock] 拦截固定脚本修改:', scriptName);
                  return;
                }
                scripts[sFoundIdx].content = op.content || '';
                modified = true;
                changeLog.updated++;
              } else if (op.action === 'upsert') {
                // 新增脚本
                scripts.push({
                  type: 'script',
                  name: scriptName,
                  enabled: true,
                  content: op.content || '',
                  id: 'script-' + Date.now() + '-' + Math.floor(Math.random() * 10000)
                });
                modified = true;
                changeLog.added++;
              }
              return;
            }

            const nk = _opNormKey(op.key);
            if (!nk) {
              console.warn('[opblock] 跳过空key');
              return;
            }

            // 剥去入存comment的外层装饰括号
            let cleanComment = op.key;
            for (let iter = 0; iter < 2; iter++) {
              const pairs = [
                ['⟦', '⟧'],
                ['【', '】'],
                ['「', '」'],
                ['『', '』'],
                ['［', '］'],
                ['《', '》'],
                ['〈', '〉'],
                ['(', ')'],
                ['[', ']'],
                ['{', '}']
              ];
              let didStrip = false;
              for (let pi = 0; pi < pairs.length; pi++) {
                const L = pairs[pi][0],
                  R = pairs[pi][1];
                if (cleanComment.length >= 4 && cleanComment.charAt(0) === L && cleanComment.charAt(cleanComment.length - 1) === R) {
                  cleanComment = cleanComment.slice(1, -1).trim();
                  didStrip = true;
                  break;
                }
              }
              if (!didStrip) break;
            }

            // ===== ✅新增：构造基础增量对象（含 AI 块体元信息头里的 keys/secondary_keys/selectiveLogic/constant/...）=====
            const basePatch = {
              comment: cleanComment
            };
            // ===== 🧹清洗 MVU 条目 content 中混入的 enabled/content/comment 等配置字段 =====
            let _cleanedContent = (op.content && op.content.trim().length > 0) ?
              _stripEntryConfigFromContent(cleanComment, op.content) : op.content;
            // 变量列表条目：强制规范化为标准格式（只保留 null+包裹标签，丢弃变量实际值/配置字段）
            if (_cleanedContent && cleanComment.indexOf('变量列表') >= 0) {
              _cleanedContent = normalizeVarListContent(_cleanedContent);
            }
            // 变量输出格式/强调条目：强制使用固定YAML模板，丢弃AI混入的变量值/配置字段
            if (_cleanedContent && (cleanComment.indexOf('变量输出格式') >= 0)) {
              _cleanedContent = normalizeVarOutputFormatContent(cleanComment, _cleanedContent);
            }
            // 变量更新规则条目：规范化缩进/range格式/移除string的type字段
            if (_cleanedContent && cleanComment.indexOf('变量更新规则') >= 0) {
              _cleanedContent = normalizeVarUpdateRuleContent(_cleanedContent);
            }
            if (_cleanedContent && _cleanedContent.trim().length > 0) basePatch.content = _cleanedContent;
            const metaKeysTop = ['keys', 'secondary_keys', 'selectiveLogic', 'constant', 'selective', 'depth', 'cooldown', 'sticky', 'delay',
              'vectorized', 'prevent_recursion', 'exclude_recursion', 'delay_until_recursion', 'use_regex',
              'probability', 'group', 'order', 'insertion_order', 'position', 'useProbability', 'scan_depth',
              'match_whole_words', 'enabled', 'group_weight', 'role', 'case_sensitive', 'use_group_scoring',
              'group_override', 'ignore_budget', 'addMemo', 'outlet_name', 'automation_id', 'triggers',
              'match_persona_description', 'match_character_description', 'match_character_personality',
              'match_character_depth_prompt', 'match_scenario', 'match_creator_notes'
            ];
            const extMap = {
              selectiveLogic: 'selectiveLogic',
              depth: 'depth',
              position: 'position',
              sticky: 'sticky',
              cooldown: 'cooldown',
              delay: 'delay',
              probability: 'probability',
              useProbability: 'useProbability',
              prevent_recursion: 'prevent_recursion',
              exclude_recursion: 'exclude_recursion',
              delay_until_recursion: 'delay_until_recursion',
              scan_depth: 'scan_depth',
              match_whole_words: 'match_whole_words',
              case_sensitive: 'case_sensitive',
              use_group_scoring: 'use_group_scoring',
              group: 'group',
              group_weight: 'group_weight',
              group_override: 'group_override',
              role: 'role',
              outlet_name: 'outlet_name',
              automation_id: 'automation_id',
              triggers: 'triggers',
              match_persona_description: 'match_persona_description',
              match_character_description: 'match_character_description',
              match_character_personality: 'match_character_personality',
              match_character_depth_prompt: 'match_character_depth_prompt',
              match_scenario: 'match_scenario',
              match_creator_notes: 'match_creator_notes',
              ignore_budget: 'ignore_budget',
              addMemo: 'addMemo',
              vectorized: 'vectorized'
            };
            let extPatch = null;
            for (let _mki = 0; _mki < metaKeysTop.length; _mki++) {
              const _mk = metaKeysTop[_mki];
              if (op[_mk] === undefined) continue;
              if (extMap[_mk] !== undefined) {
                extPatch = extPatch || {};
                extPatch[extMap[_mk]] = op[_mk];
              } else {
                basePatch[_mk] = op[_mk];
              }
            }

            // 精确匹配现有条目
            let foundIdx = -1;
            for (let fi = 0; fi < cd.character_book.entries.length; fi++) {
              if (_opNormKey(cd.character_book.entries[fi].comment) === nk) {
                foundIdx = fi;
                break;
              }
            }

            if (foundIdx >= 0) {
              // 更新
              const oldEntry = cd.character_book.entries[foundIdx];
              const mergedEntry = Object.assign({}, oldEntry, basePatch);
              if (extPatch) mergedEntry.extensions = Object.assign({}, (oldEntry && oldEntry.extensions) || {}, extPatch);
              // ===== ✅新增：keys 为空时，按<标签>分类+实体名自动派生（蓝灯不派生）=====
              const _tmplHere = getEntryTemplate(mergedEntry.comment || '');
              if ((!mergedEntry.keys || mergedEntry.keys.length === 0) && !((_tmplHere && _tmplHere.constant) || mergedEntry.constant)) {
                try {
                  mergedEntry.keys = _deriveEntryKeys(mergedEntry.comment, _tmplHere, mergedEntry.content);
                } catch (derr) { logWarn("_isMvuEntryKey", derr); }
              }
              if (!mergedEntry.secondary_keys) mergedEntry.secondary_keys = [];
              cd.character_book.entries[foundIdx] = mergedEntry;
              modified = true;
              changeLog.updated++;
            } else {
              // upsert: 新增；update: 警告不新增
              if (op.action === 'update') {
                console.warn('[opblock] update 找不到条目:', op.key);
              } else {
                const newEntry = Object.assign({
                  comment: cleanComment,
                  content: op.content || '',
                  constant: false,
                  position: 0,
                  keys: [],
                  secondary_keys: [],
                  extensions: {}
                }, basePatch);
                if (extPatch) newEntry.extensions = Object.assign({}, newEntry.extensions || {}, extPatch);
                const _tmplNew = getEntryTemplate(newEntry.comment || '');
                if (_tmplNew) {
                  // MVU 系统条目强制使用模板的 selective/constant 值
                  const _isNewMvuSys = (String(newEntry.comment || '').toLowerCase().indexOf('变量输出格式') >= 0 ||
                    String(newEntry.comment || '').toLowerCase().indexOf('变量更新规则') >= 0 ||
                    String(newEntry.comment || '').toLowerCase().indexOf('[initvar]') >= 0 ||
                    String(newEntry.comment || '').indexOf('初始变量') >= 0 ||
                    String(newEntry.comment || '').indexOf('变量列表') >= 0);
                  if (_isNewMvuSys) {
                    newEntry.selective = _tmplNew.selective;
                    newEntry.constant = _tmplNew.constant;
                  } else {
                    if (newEntry.selective === undefined) newEntry.selective = _tmplNew.selective;
                    if (newEntry.constant === undefined) newEntry.constant = _tmplNew.constant;
                  }
                }
                // ===== ✅新增：新条目 keys 为空自动派生 =====
                if ((!newEntry.keys || newEntry.keys.length === 0) && !(newEntry.constant || (_tmplNew && _tmplNew.constant))) {
                  try {
                    newEntry.keys = _deriveEntryKeys(newEntry.comment, _tmplNew, newEntry.content);
                  } catch (derr2) { logWarn("_isMvuEntryKey", derr2); }
                }
                if (!newEntry.secondary_keys) newEntry.secondary_keys = [];
                cd.character_book.entries.push(newEntry);
                modified = true;
                changeLog.added++;
              }
            }
          } else if (op.action === 'delete') {
            // 检测是否是脚本删除（key以 script: 开头）
            if (op.key && /^script:/i.test(op.key)) {
              const delScriptName = op.key.replace(/^script:\s*/i, '').trim();
              const delScripts = cd.extensions.tavern_helper.scripts;
              let delCount = 0;
              cd.extensions.tavern_helper.scripts = delScripts.filter(function(s) {
                const match = (s.name || '').toLowerCase() === delScriptName.toLowerCase() ||
                  (s.id || '') === delScriptName;
                if (match && isFixedMvuScript(s)) {
                  console.warn('[opblock] 拦截固定脚本删除:', delScriptName);
                  return true; // 保留
                }
                if (match) delCount++;
                return !match;
              });
              if (delCount > 0) {
                modified = true;
                changeLog.deleted += delCount;
              }
              return;
            }

            const dk = _opNormKey(op.key);
            if (!dk) {
              console.warn('[opblock] delete空key');
              return;
            }
            let removeCount = 0;
            const strippedDk = dk.replace(/^[<\[【⟦『「〈《\(\[{]+|[>\]】⟧』」〉》\)\]}]+$/g, '').trim();
            cd.character_book.entries = cd.character_book.entries.filter(function(e) {
              if (!e || typeof e !== 'object') {
                removeCount++;
                return false;
              } // 防御：null/字符串/数字直接当脏数据删掉
              const ek = _opNormKey(e.comment || '');
              const strippedEk = ek.replace(/^[<\[【⟦『「〈《\(\[{]+|[>\]】⟧』」〉》\)\]}]+$/g, '').trim();
              // 精确匹配优先；否则短 key 用 includes 模糊（dk.length>=4 避免乱删）
              let shouldDelete = (ek === dk) ||
                (strippedDk && strippedEk && strippedEk === strippedDk) ||
                (strippedDk && strippedEk && strippedDk.length >= 4 && strippedEk.indexOf(strippedDk) >= 0) ||
                (dk.length >= 6 && ek.indexOf(dk) >= 0);
              // 额外：如果用户删的内容本身和某条 entry.content 前 50 字匹配度>80%（常见于"把这段删掉"）也命中删除
              if (!shouldDelete && strippedDk && strippedDk.length >= 10 && e.content && typeof e.content === 'string') {
                const headContent = e.content.slice(0, Math.max(60, strippedDk.length + 20));
                if (headContent.indexOf(strippedDk) >= 0) shouldDelete = true;
              }
              if (shouldDelete) removeCount++;
              return !shouldDelete;
            });
            if (removeCount > 0) {
              modified = true;
              changeLog.deleted += removeCount;
            } else {
              // ⚠️【修复AI删除条目不生效 #2】用户反馈：AI写了删除指令，但预览里旧条目一直堆叠，完全看不到删除。
              // 原来删除失败只打 console.warn，用户看不到。这里把 applyOps 中 delete 没匹配到条目的 key 挂到
              // changeLog._deleteFailures 上，外层 callAIChat 会弹 Toast 明确告诉用户"删失败了，comment不对"。
              console.warn('[opblock] delete 找不到条目:', op.key);
              changeLog._deleteFailures = changeLog._deleteFailures || [];
              changeLog._deleteFailures.push(String(op.key || '').slice(0, 120));
            }
          } else if (op.action === 'set') {
            const fieldName = op.key.toLowerCase().trim();
            if (validFields.indexOf(fieldName) >= 0) {
              if (fieldName === 'alternate_greetings') {
                // alternate_greetings 转为数组：按 "---分割---" 或独立行 "---" 分隔（与输出协议一致；整段多行文本为一条）
                cd.alternate_greetings = op.content.split(/\s*---分割---\s*/).map(function(s) {
                  return s.trim();
                }).filter(Boolean);
              } else {
                cd[fieldName] = op.content;
              }
              modified = true;
              changeLog.fieldUpdates++;
            } else {
              console.warn('[opblock] set 未知字段:', fieldName);
            }
          } else if (op.action === 'rename') {
            const oldK = _opNormKey(op.oldKey);
            const newK = op.newKey.trim();
            if (!oldK || !newK) {
              console.warn('[opblock] rename 空key');
              return;
            }
            // 剥去newKey装饰括号
            let cleanNewKey = newK;
            for (let iter2 = 0; iter2 < 2; iter2++) {
              const pairs2 = [
                ['⟦', '⟧'],
                ['【', '】'],
                ['「', '」'],
                ['『', '』'],
                ['［', '］'],
                ['《', '》'],
                ['〈', '〉'],
                ['(', ')'],
                ['[', ']'],
                ['{', '}']
              ];
              let didStrip2 = false;
              for (let pi2 = 0; pi2 < pairs2.length; pi2++) {
                const L2 = pairs2[pi2][0],
                  R2 = pairs2[pi2][1];
                if (cleanNewKey.length >= 4 && cleanNewKey.charAt(0) === L2 && cleanNewKey.charAt(cleanNewKey.length - 1) === R2) {
                  cleanNewKey = cleanNewKey.slice(1, -1).trim();
                  didStrip2 = true;
                  break;
                }
              }
              if (!didStrip2) break;
            }
            let renamed = false;
            for (let ri = 0; ri < cd.character_book.entries.length; ri++) {
              if (_opNormKey(cd.character_book.entries[ri].comment) === oldK) {
                cd.character_book.entries[ri].comment = cleanNewKey;
                renamed = true;
                break;
              }
            }
            if (renamed) {
              modified = true;
              changeLog.renamed++;
            } else {
              console.warn('[opblock] rename 找不到条目:', op.oldKey);
            }
          }
        });

        return {
          modified: modified,
          changeLog: changeLog
        };
      }

      // ===== 兜底：从AI回复中提取状态栏HTML（当AI只输出```html而非JSON时）=====
      // 场景：用户让AI"改状态栏"，AI直接输出了```html代码块而非JSON的regex_scripts
      // 此时extractJSON提取不到，需要这个兜底机制把HTML保存到cardData.extensions.regex_scripts
      function tryExtractStatusBarHtml(aiText) {
        if (!aiText) return false;
        // 匹配所有 ```html 代码块（[ \t]*\r?\n? 容错 ```html 后无换行的情况，不吃内容缩进）
        const htmlBlocks = [];
        const htmlRe = /```html[ \t]*\r?\n?([\s\S]*?)\r?\n?```/gi;
        let m;
        while ((m = htmlRe.exec(aiText)) !== null) {
          htmlBlocks.push(m[1]);
        }
        // 也匹配无语言标记的 ``` 代码块（可能含HTML）
        if (htmlBlocks.length === 0) {
          const genericRe = /```[ \t]*\r?\n?([\s\S]*?)\r?\n?```/g;
          while ((m = genericRe.exec(aiText)) !== null) {
            if (m[1].indexOf('<html') >= 0 || m[1].indexOf('<!doctype') >= 0 || m[1].indexOf('<head') >= 0) {
              htmlBlocks.push(m[1]);
            }
          }
        }
        if (htmlBlocks.length === 0) return false;

        // 强负面关键词：含这些内容一定不是状态栏HTML（是写卡器进度块/世界书条目碎片等）
        // ⚠️P0修复：entries/comment 原先是裸子串匹配——StageDog zod 规范明确推荐 `_(data).entries()`，
        // AI 按规范生成的状态栏 JS 里出现 Object.entries()/_.entries()/注释 一律被误杀 → 提取失败
        // → 预览"未生成"+写入酒馆丢自定义状态栏。改为只匹配 JSON 键形态（"entries": / 'comment':）
        const wordBlacklist = ['<statusblock>', '</statusblock>', '信息完整度', '需要您补充的信息',
          '```json', '```js', '```yaml',
          'character_book', 'insertion_order'
        ];
        // 结构验证：完整HTML文档特征（doctype/html + style/script 至少各一）
        const mustHaveStructure = ['<!doctype', '<html', '<style', '<script'];
        // 状态栏HTML专属特征（⚠️对齐用户模板标准：populateCharacterData + getAllVariables + eventOn + errorCatched）
        // 旧表（matrix-card/m-bar-wrap/renderTree等）大半是历史模板专属词，按用户模板生成的
        // 新状态栏常只命中2-3个，导致提取失败（预览显示未生成+写入酒馆丢失），故大幅扩充并降阈值
        const statusBarKeywords = ['StatusPlaceHolderImpl', 'render-root', 'stat_data', 'waitGlobalInitialized',
          'getAllVariables', 'populateCharacterData', 'errorCatched', 'eventOn',
          'VARIABLE_UPDATE_ENDED', 'Mvu.events', 'toggleSection', 'section-header',
          'mvu-status', 'card-body', 'refreshStatus', 'renderTree',
          'matrix-card', 'matrix-grid', 'm-bar-wrap', '.m-label', '.m-value',
          'renderVars', 'loadVars', 'mvu-matrix-ui', 'mvu-status-card',
          'getVariables', 'stat_data.'
        ];
        // MVU核心特征（用户模板标准必备）：至少命中1个才可能是状态栏
        const mvuCoreFeatures = ['getAllVariables', 'stat_data', 'populateCharacterData', 'waitGlobalInitialized', 'Mvu.events', 'getVariables'];
        let statusBarHtml = null;
        for (let i = 0; i < htmlBlocks.length; i++) {
          const block = htmlBlocks[i];
          // 黑名单过滤：裸词命中（这些词不会出现在状态栏代码里）→ 跳过
          let hitBlack = false;
          for (let b = 0; b < wordBlacklist.length; b++) {
            if (block.indexOf(wordBlacklist[b]) >= 0) {
              hitBlack = true;
              break;
            }
          }
          if (hitBlack) continue;
          // JSON键形态黑名单：entries/comment 作为带引号的对象键（世界书JSON碎片特征），
          // 状态栏JS里的 Object.entries()/_.entries()/注释 不会命中
          if (/["']entries["']\s*:/.test(block) || /["']comment["']\s*:/.test(block)) continue;
          // 结构验证：至少出现2个HTML结构标签（非单纯CSS/JS碎片）
          let structCount = 0;
          for (let s = 0; s < mustHaveStructure.length; s++) {
            if (block.indexOf(mustHaveStructure[s]) >= 0) structCount++;
          }
          if (structCount < 2) continue;
          // MVU核心特征：至少1个（读变量的入口，状态栏必有）
          let coreCount = 0;
          for (let c = 0; c < mvuCoreFeatures.length; c++) {
            if (block.indexOf(mvuCoreFeatures[c]) >= 0) coreCount++;
          }
          if (coreCount < 1) continue;
          // 特征关键词：至少2个即认定（黑名单+完整文档结构+MVU核心特征三重防护，误报风险低）
          let matchCount = 0;
          for (let k = 0; k < statusBarKeywords.length; k++) {
            if (block.indexOf(statusBarKeywords[k]) >= 0) matchCount++;
          }
          if (matchCount >= 2) {
            // 清理字面量转义字符
            let cleaned = block;
            if (cleaned.indexOf('\\n') >= 0) cleaned = cleaned.replace(/\\n/g, '\n');
            if (cleaned.indexOf('\\"') >= 0) cleaned = cleaned.replace(/\\"/g, '"');
            if (cleaned.indexOf('\\\\') >= 0) cleaned = cleaned.replace(/\\\\/g, '\\');
            statusBarHtml = cleaned;
            break;
          }
        }
        if (!statusBarHtml) {
          // ⚠️迭代：日志留痕——提取失败时打印各代码块的判定详情，方便排查"生成了但没保存"
          try {
            console.warn('[statusbar] 未识别到状态栏HTML：共', htmlBlocks.length, '个代码块。各块判定：',
              htmlBlocks.map(function(blk) {
                let mc = 0;
                for (let k2 = 0; k2 < statusBarKeywords.length; k2++) {
                  if (blk.indexOf(statusBarKeywords[k2]) >= 0) mc++;
                }
                let sc = 0;
                for (let s2 = 0; s2 < mustHaveStructure.length; s2++) {
                  if (blk.indexOf(mustHaveStructure[s2]) >= 0) sc++;
                }
                return {
                  len: blk.length,
                  structCount: sc,
                  keywordCount: mc,
                  head: blk.slice(0, 60)
                };
              }));
          } catch (_logErr) {}
          return false;
        }

        // 复用统一的保存函数，避免重复代码
        return saveStatusBarToCard(statusBarHtml);
      }

      // 保存拼接好的状态栏HTML到角色卡的regex_scripts
      function saveStatusBarToCard(assembledHtml) {
        if (!assembledHtml) return false;
        // ⚠️改进Z6：先做全面的字段初始化，避免任何undefined导致后续push报错
        if (!cardData) return false;
        cardData.extensions = cardData.extensions || {};
        cardData.extensions.regex_scripts = Array.isArray(cardData.extensions.regex_scripts) ? cardData.extensions.regex_scripts : [];
        cardData.extensions.tavern_helper = cardData.extensions.tavern_helper || {
          scripts: [],
          variables: {}
        };
        if (!Array.isArray(cardData.extensions.tavern_helper.scripts)) cardData.extensions.tavern_helper.scripts = [];
        cardData.character_book = cardData.character_book || {};
        cardData.character_book.entries = Array.isArray(cardData.character_book.entries) ? cardData.character_book.entries : [];
        cardData.first_mes = typeof cardData.first_mes === 'string' ? cardData.first_mes : '';
        cardData.alternate_greetings = Array.isArray(cardData.alternate_greetings) ? cardData.alternate_greetings : [];

        const rxList = cardData.extensions.regex_scripts;
        // 收集所有「美化状态栏」脚本：findRegex 含 StatusPlaceHolder 且 markdownOnly 且 非 promptOnly
        // 同时兼容 id === 'mvu-status-bar' 的脚本（历史数据可能 findRegex 写法不一）
        const sbIdxList = [];
        for (let j = 0; j < rxList.length; j++) {
          const r = rxList[j];
          if (!r) continue;
          const isSb = (r.id === 'mvu-status-bar') ||
            ((r.findRegex || '').indexOf('StatusPlaceHolder') >= 0 && r.markdownOnly && !r.promptOnly);
          if (isSb) sbIdxList.push(j);
        }
        const wrappedHtml = '```\n' + assembledHtml + '\n```';
        if (sbIdxList.length > 0) {
          // 取第一个作为更新目标，其余重复的全部删除（按 id 或 findRegex 匹配的都算重复）
          const keepIdx = sbIdxList[0];
          rxList[keepIdx].replaceString = wrappedHtml;
          rxList[keepIdx].findRegex = '/<StatusPlaceHolderImpl\\/>/g';
          rxList[keepIdx].markdownOnly = true;
          rxList[keepIdx].promptOnly = false;
          rxList[keepIdx].placement = [2];
          rxList[keepIdx].runOnEdit = false; // StageDog标准：避免编辑消息时重复执行
          rxList[keepIdx].disabled = false;
          rxList[keepIdx].id = 'mvu-status-bar';
          rxList[keepIdx].scriptName = '[美化]MVU状态栏';
          // 降序删除其余重复脚本（保留 keepIdx）
          if (sbIdxList.length > 1) {
            const dupToRemove = sbIdxList.slice(1).sort(function(a, b) {
              return b - a;
            });
            dupToRemove.forEach(function(idx) {
              console.warn('[statusbar] 去重：删除重复的[美化]MVU状态栏脚本:', rxList[idx].scriptName || rxList[idx].name);
              rxList.splice(idx, 1);
            });
          }
        } else {
          rxList.push({
            id: 'mvu-status-bar',
            scriptName: '[美化]MVU状态栏',
            findRegex: '/<StatusPlaceHolderImpl\\/>/g',
            replaceString: wrappedHtml,
            trimStrings: [],
            placement: [2],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: false, // StageDog标准：避免编辑消息时重复执行
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null
          });
        }
        cardData.extensions.regex_scripts = rxList;

        // ⚠️清理世界书条目中的状态栏模块残留：历史版本/旧角色卡可能已把状态栏模块
        // 代码（Step 2-6）误写入了character_book.entries。此处保存regex后主动清理，
        // 避免条目里的陈旧状态栏代码污染世界书上下文、与regex_scripts版本不一致。
        if (cardData.character_book && Array.isArray(cardData.character_book.entries)) {
          const sbCleanupRe = /状态栏.*Step\s*[2-7]|Step\s*[2-7].*状态栏|状态栏.*(配色|HTML骨架|CSS样式|变量读取|渲染函数|事件绑定)|(配色|HTML骨架|CSS样式|变量读取|渲染函数|事件绑定).*状态栏/;
          const beforeLen = cardData.character_book.entries.length;
          cardData.character_book.entries = cardData.character_book.entries.filter(function(e) {
            const c = String((e && e.comment) || '');
            if (sbCleanupRe.test(c)) {
              console.warn('[statusbar] 清理世界书中的状态栏残留条目:', c);
              return false;
            }
            return true;
          });
          if (cardData.character_book.entries.length < beforeLen) {
            console.warn('[statusbar] 共清理 ' + (beforeLen - cardData.character_book.entries.length) + ' 个状态栏残留条目');
          }
        }

        /* 改进8+Z6：自动追加占位符兜底——确保 first_mes 末尾有 <StatusPlaceHolderImpl/> */
        if (cardData.first_mes && cardData.first_mes.indexOf('StatusPlaceHolderImpl') < 0) {
          cardData.first_mes = cardData.first_mes.replace(/\s*$/, '') + '\n<StatusPlaceHolderImpl/>';
          console.warn('[statusbar] 改进8兜底：first_mes 末尾自动追加 <StatusPlaceHolderImpl/>');
        } else if (!cardData.first_mes) {
          // ⚠️Z6+：first_mes为空也给一个默认开场白（含占位符），确保状态栏能显示
          cardData.first_mes = '（默认开场白）\n<StatusPlaceHolderImpl/>';
          console.warn('[statusbar] Z6兜底：first_mes为空，已自动生成默认开场白含<StatusPlaceHolderImpl/>');
        }
        /* 同样确保 alternate_greetings 每条也追加了占位符 */
        if (cardData.alternate_greetings && Array.isArray(cardData.alternate_greetings)) {
          for (let gi = 0; gi < cardData.alternate_greetings.length; gi++) {
            const ag = cardData.alternate_greetings[gi];
            if (typeof ag === 'string' && ag.indexOf('StatusPlaceHolderImpl') < 0) {
              cardData.alternate_greetings[gi] = ag.replace(/\s*$/, '') + '\n<StatusPlaceHolderImpl/>';
            }
          }
        }
        return true;
      }

      // ===== 进入MVU Tab时自动注入固定资产（bundle.js + 正则1-5）=====
      // ⚠️仅自动注入 bundle.js 和正则1-5；变量结构脚本/WTC/<状态栏>占位符提醒/正则6 由 AI 按 9.1.6 工作流一条一条生成
      // 这些资产固定不变，由写卡器自动管理，AI无权写入/删除（白名单拦截）
      // 提前注入到cardData，让用户在MVU Tab里就能看到完整资产，预览时也能正确渲染
      function ensureFixedMvuAssetsInCardData() {
        if (!cardData) return;
        cardData.extensions = cardData.extensions || {};
        cardData.extensions.tavern_helper = cardData.extensions.tavern_helper || {
          scripts: [],
          variables: {}
        };
        if (!cardData.extensions.tavern_helper.scripts) cardData.extensions.tavern_helper.scripts = [];
        if (!cardData.extensions.regex_scripts) cardData.extensions.regex_scripts = [];
        const thScripts = cardData.extensions.tavern_helper.scripts;
        let rxList = cardData.extensions.regex_scripts;
        const injected = [];

        // === 0. 去重清理：移除已累积的重复固定正则（只保留每个id的第一份）===
        const _fixedRxIds = {
          'd668c8a6-fa6a-444d-a5d6-8f68b73a3c36': true,
          '5bb4b588-23ca-4564-8df5-882104eff764': true,
          '6fb572ae-a9ea-436d-9779-ad100f1ff7f5': true,
          'bf1b7441-5cf1-426d-bd6c-911332be9923': true,
          'mvu-status-hide': true
        };
        const _seenRxIds = {};
        const _dedupedRx = [];
        for (let _ri = 0; _ri < rxList.length; _ri++) {
          const _r = rxList[_ri];
          if (!_r) continue;
          const _rid = _r.id || '';
          if (_rid && _fixedRxIds[_rid]) {
            if (_seenRxIds[_rid]) continue;
            _seenRxIds[_rid] = true;
          }
          _dedupedRx.push(_r);
        }
        if (_dedupedRx.length !== rxList.length) {
          cardData.extensions.regex_scripts = _dedupedRx;
          rxList = _dedupedRx;
        }

        // === 1. 注入 bundle.js（MVU本体脚本）===
        const hasBundle = thScripts.some(function(s) {
          return (s.content || '').indexOf('MagVarUpdate') >= 0 || (s.content || '').indexOf('bundle.js') >= 0;
        });
        if (!hasBundle) {
          thScripts.push({
            type: 'script',
            enabled: true,
            name: 'MVU',
            id: '961f366d-e403-45c2-8155-3d14ec86de53',
            content: "import'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';",
            info: '',
            button: {
              enabled: true,
              buttons: [{
                  name: '重新处理变量',
                  visible: false
                }, {
                  name: '重新读取初始变量',
                  visible: false
                },
                {
                  name: '快照楼层',
                  visible: false
                }, {
                  name: '重演楼层',
                  visible: false
                },
                {
                  name: '重试额外模型解析',
                  visible: false
                }, {
                  name: '清除旧楼层变量',
                  visible: false
                }
              ]
            },
            data: {}
          });
          injected.push('bundle.js');
        }

        // === 2. 注入变量结构 zod 脚本（如果有 InitVar 条目）===
        // ⚠️用户要求：变量结构脚本由 AI 在 MVU Tab 一条一条生成，不再自动注入
        // （原逻辑已移除，AI 按 9.1.5 工作流生成）

        // === 4. 注入正则1：仅格式思维链（移除<Analysis>段）===
        const hasR1 = rxList.some(function(r) {
          return r.id === 'd668c8a6-fa6a-444d-a5d6-8f68b73a3c36' || ((r.findRegex || r.find_regex || '').indexOf('Analysis') >= 0 && r.promptOnly);
        });
        if (!hasR1) {
          rxList.push({
            id: 'd668c8a6-fa6a-444d-a5d6-8f68b73a3c36',
            scriptName: '仅格式思维链',
            findRegex: '/<Analysis>[\\s\\S]+?<\\/Analysis>/gm',
            replaceString: '',
            trimStrings: [],
            placement: [2],
            disabled: false,
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: false, // StageDog标准：避免编辑消息时重复执行
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null
          });
          injected.push('正则1(思维链)');
        }

        // === 5. 注入正则2：只发送最新2楼的变量更新 ===
        const hasR2 = rxList.some(function(r) {
          return r.id === '5bb4b588-23ca-4564-8df5-882104eff764' || ((r.findRegex || r.find_regex || '').indexOf('UpdateVariable') >= 0 && r.promptOnly);
        });
        if (!hasR2) {
          rxList.push({
            id: '5bb4b588-23ca-4564-8df5-882104eff764',
            scriptName: '只发送最新2楼的变量更新',
            findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm',
            replaceString: '',
            trimStrings: [],
            placement: [2],
            disabled: false,
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: false, // StageDog标准：避免编辑消息时重复执行
            substituteRegex: 0,
            minDepth: 4,
            maxDepth: null
          });
          injected.push('正则2(变量更新截断)');
        }

        // === 6. 注入正则3：[美化]变量完成 ===
        const hasR3 = rxList.some(function(r) {
          return r.id === '6fb572ae-a9ea-436d-9779-ad100f1ff7f5';
        });
        if (!hasR3) {
          rxList.push({
            id: '6fb572ae-a9ea-436d-9779-ad100f1ff7f5',
            scriptName: '[美化]变量完成',
            findRegex: '/<UpdateVariable(?:variable)?>\\s*([\\s\\S]*?)\\s*<\\/UpdateVariable(?:variable)?>/gsi',
            replaceString: MVU_BEAUTIFY_COMPLETE,
            trimStrings: [],
            placement: [2],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: false,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null
          });
          injected.push('正则3(变量完成美化)');
        }

        // === 7. 注入正则4：[美化]变量更新中 ===
        const hasR4 = rxList.some(function(r) {
          return r.id === 'bf1b7441-5cf1-426d-bd6c-911332be9923';
        });
        if (!hasR4) {
          rxList.push({
            id: 'bf1b7441-5cf1-426d-bd6c-911332be9923',
            scriptName: '[美化]变量更新中',
            findRegex: '/<UpdateVariable(?:variable)?>(?!.*<\\/UpdateVariable(?:variable)?>)\\s*(.*)\\s*$/gsi',
            replaceString: MVU_BEAUTIFY_THINKING,
            trimStrings: [],
            placement: [2],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: false,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null
          });
          injected.push('正则4(变量更新中美化)');
        }

        // === 8. 注入正则5：[不发送]隐藏状态栏标记 ===
        const hasR5 = rxList.some(function(r) {
          return r.id === 'mvu-status-hide' || ((r.findRegex || r.find_regex || '').indexOf('StatusPlaceHolderImpl') >= 0 && r.promptOnly && !r.markdownOnly);
        });
        if (!hasR5) {
          rxList.push({
            id: 'mvu-status-hide',
            scriptName: '[不发送]隐藏状态栏标记',
            findRegex: '/<StatusPlaceHolderImpl\\/>/g',
            replaceString: '',
            trimStrings: [],
            placement: [2],
            disabled: false,
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: false, // StageDog标准：避免编辑消息时重复执行
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null
          });
          injected.push('正则5(隐藏状态栏标记)');
        }

        // === 9. <状态栏>占位符提醒条目 ===
        // ⚠️用户要求：占位符提醒条目由 AI 在 MVU Tab 一条一条生成，不再自动注入
        // （原逻辑已移除，AI 在生成状态栏相关条目时一并生成）

        if (injected.length > 0) {
          saveToStorage();
        }
        return injected;
      }

      // JSON 修复：用状态机遍历，只对"键位置"的裸标识符补引号，
      // 避免破坏字符串值内部的 word: 模式（如 "Time: 远古"）
      function repairJSON(str) {
        if (!str) return null;
        // 1) 先尝试直接解析
        try {
          return JSON.parse(str);
        } catch (e) { logWarn("repairJSON", e); }
        // 2) 反转义多余转义、修复尾逗号
        const s = str
          .replace(/\\\\n/g, '\\n')
          .replace(/\\\\r/g, '\\r')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        try {
          return JSON.parse(s);
        } catch (e) { logWarn("repairJSON", e); }
        // 3) 状态机：单引号字符串转双引号 + 裸键补引号（不触碰字符串内部）
        const out = [];
        let i = 0;
        const len = s.length;
        // state: 0=期望键或值, 1=字符串内, 2=键已结束待冒号, 3=值已结束待逗号/括号
        let afterColon = false; // 上一非空白token是否是冒号（值上下文）
        while (i < len) {
          const ch = s[i];
          if (ch === '"') {
            // 双引号字符串：原样复制到匹配的结束引号（处理转义）
            out.push(ch);
            i++;
            while (i < len) {
              const c = s[i];
              out.push(c);
              if (c === '\\' && i + 1 < len) {
                out.push(s[i + 1]);
                i += 2;
                continue;
              }
              i++;
              if (c === '"') break;
            }
            afterColon = false;
            continue;
          }
          if (ch === "'") {
            // 单引号字符串：转成双引号
            out.push('"');
            i++;
            while (i < len) {
              const c2 = s[i];
              if (c2 === '\\' && i + 1 < len) {
                // 转义字符原样保留
                out.push(c2, s[i + 1]);
                i += 2;
                continue;
              }
              if (c2 === "'") {
                out.push('"');
                i++;
                break;
              }
              if (c2 === '"') {
                out.push('\\');
              } // 字符串内的双引号需转义
              out.push(c2);
              i++;
            }
            afterColon = false;
            continue;
          }
          // 裸键检测：在键上下文（非值，紧跟标识符 + 冒号）
          if (!afterColon && /[a-zA-Z_$]/.test(ch)) {
            let j = i;
            while (j < len && /[a-zA-Z0-9_$]/.test(s[j])) j++;
            // 跳过空白看是否跟冒号
            let k = j;
            while (k < len && /\s/.test(s[k])) k++;
            if (k < len && s[k] === ':') {
              // 是裸键，补引号
              out.push('"', s.substring(i, j), '"');
              i = j;
              continue;
            }
          }
          if (ch === ':') afterColon = true;
          else if (ch === ',' || ch === '{' || ch === '[') afterColon = false;
          else if (ch === '}' || ch === ']') afterColon = false;
          out.push(ch);
          i++;
        }
        const repaired = out.join('');
        try {
          return JSON.parse(repaired);
        } catch (e) {
          return null;
        }
      }

      // ===== AI对话调用 =====
      async function callAIChat() {
        if (isGenerating) return;
        isGenerating = true;
        setEnabled(false);
        addTyping();
        pushWorkToast('正在思考...', 'working');
        try {
          // ========== 启用队列模式：所有addAssistantMsg调用收集到队列，最后合并为一条消息 ==========
          _aiChatQueueMode = true;
          _aiChatNotesQueue = [];
          // ========== Tab 隔离：使用当前Tab专属的聊天记录数组 ==========
          const curTabMessages = getCurrentMessages();
          let prompt = buildPrompt(cardData, cardGenerated, curTabMessages);
          // 注入全局人设（AI/用户人设，从 localStorage 读取，头像菜单可编辑）
          const _personaHdr = getPersonaHeader();
          if (_personaHdr) prompt = _personaHdr + '\n\n' + prompt;
          let aiResponse = await callAI(prompt);
          aiResponse = cleanAIReply(aiResponse);
          removeTyping();

          // ========== 🆕 保存cardData快照（用于头像菜单"撤回"回滚）==========
          // 在应用任何AI修改前保存；AI消息将落在 curTabMessages.length 索引处
          try {
            saveCardDataSnapshot(curTabMessages.length);
          } catch (_snapErr) {}

          // ========== 🆕 ::: 操作块协议优先检测 ==========
          // 如果AI回复包含:::操作块，走新协议路径（更简洁、零语法错误）
          // 否则回退到旧JSON路径（兼容）
          let parsed = null;
          if (hasOpBlocks(aiResponse)) {
            const ops = parseOpBlocks(aiResponse);
            if (ops.length > 0) {
              const _entriesBeforeOps = _snapshotEntries();
              const opResult = applyOps(ops, cardData);
              if (opResult.modified) {
                if (cardData.name && (cardData.description || (cardData.character_book && cardData.character_book.entries && cardData.character_book.entries.length > 0))) {
                  cardGenerated = true;
                }
                progress = calcProgress();
                // MVU Tab：合并后自动注入固定资产
                if (currentTab === 'mvu') {
                  const mvuEntriesAfterOps = (cardData.character_book || {}).entries || [];
                  const hasInitVarAfterOps = mvuEntriesAfterOps.some(function(e) {
                    return (e.comment || '').toLowerCase().indexOf('[initvar]') >= 0;
                  });
                  if (hasInitVarAfterOps) {
                    const newlyInjectedOps = ensureFixedMvuAssetsInCardData();
                    if (newlyInjectedOps && newlyInjectedOps.length > 0) renderPreview();
                  }
                }
                // 显示变更统计
                const crOps = opResult.changeLog;
                let _diffOps = null;
                try {
                  _diffOps = computeEntryDiff(_entriesBeforeOps, _snapshotEntries());
                } catch (e) {
                  logWarn('entryDiff', e);
                }
                if (_diffOps) flashPreviewChanges(_diffOps);
                const partsOps = [];
                if (crOps.added) partsOps.push('➕新增' + crOps.added + '条');
                if (crOps.updated) partsOps.push('🔄更新' + crOps.updated + '条');
                if (crOps.deleted) partsOps.push('🗑️删除' + crOps.deleted + '条');
                if (crOps.fieldUpdates) partsOps.push('📝字段' + crOps.fieldUpdates + '项');
                if (crOps.renamed) partsOps.push('✏️重命名' + crOps.renamed + '条');
                if (_diffOps && _diffOps.updated.length) {
                  let addLO = 0,
                    delLO = 0;
                  _diffOps.updated.forEach(function(u) {
                    addLO += u.addLines;
                    delLO += u.delLines;
                  });
                  if (addLO || delLO) partsOps.push('📝正文 +' + addLO + '/-' + delLO + '行');
                }
                if (partsOps.length) showToast('✅ 已应用修改：' + partsOps.join('，'), 'success');
                // ⚠️ 删除失败：把所有没命中的 key 明确告诉用户。避免"AI写了删除但预览堆叠"时用户毫无察觉，
                // 只能眼睁睁看着旧条目越来越多。这里给出精确匹配的指导文案。
                if (crOps._deleteFailures && crOps._deleteFailures.length > 0) {
                  const failList = crOps._deleteFailures.map(function(k, i) {
                    return (i + 1) + '. ⟦' + k + '⟧';
                  }).join('\n');
                  try {
                    showToast('⚠️ AI 想要删除以下条目，但未匹配到（comment 不精确）：\n' +
                      failList +
                      '\n💡解决：①在预览面板双击该条目→手动删除；②或告诉AI使用精确 comment 字符串匹配。',
                      'warning', 9000);
                  } catch (_) {}
                }
                renderPreview();
                saveToStorage();
              } else if (ops.length > 0) {
                showToast('⚠️ AI返回了操作指令，但未匹配到任何条目。请检查条目名称是否正确', 'warning', 6000);
              }
            }
            // 跳过旧JSON路径（parsed 保持 null，下方 if(parsed) 自然跳过）
          } else {
            // ========== 旧JSON路径（兼容） ==========
            parsed = extractJSON(aiResponse);
          }
          if (parsed) {
            // ========== Tab 隔离：角色卡Tab下，严格过滤掉AI违规生成的MVU条目 ==========
            if (currentTab === 'card') {
              const filteredForCard = filterMvuEntriesFromParsed(parsed);
              if (filteredForCard._mvuStrippedCount > 0) {
                showToast('⚠️ 检测到AI违规生成了 ' + filteredForCard._mvuStrippedCount + ' 条MVU相关内容，已自动拦截。\nMVU变量系统请切换到「MVU变量状态栏」Tab进行制作。', 'warning', 6000);
              }
              if (filteredForCard._mvuRegexScriptStripped) {
                showToast('⚠️ 检测到AI违规生成了MVU相关正则脚本，已自动拦截。', 'warning', 6000);
              }
              parsed = filteredForCard.parsed;
            }
            const hasData = Object.keys(parsed).filter(function(k) {
              return k !== '_nochange';
            }).length > 0;
            if (hasData) {
              // 合并前条目快照：用于合并后简易 diff（toast 行数统计 + 预览面板高亮）
              const _entriesBeforeMerge = _snapshotEntries();
              // 传递 returnLog 选项以便获取精确的变更统计（新增/删除/更新数量）
              const mergeResult = mergePartial(parsed, cardData, {
                returnLog: true
              });
              let actuallyModified = false;
              let changeLogResult = null;
              if (typeof mergeResult === 'object' && mergeResult !== null) {
                actuallyModified = !!mergeResult.modified;
                changeLogResult = mergeResult.log || null;
              } else {
                actuallyModified = !!mergeResult;
              }
              if (actuallyModified) {
                if (cardData.name && (cardData.description || (cardData.character_book && cardData.character_book.entries && cardData.character_book.entries.length > 0))) {
                  cardGenerated = true;
                }
                progress = calcProgress();
                // ===== MVU Tab：合并后确保固定资产（bundle.js + 正则1-5）始终存在 =====
                // ⚠️仅自动注入 bundle.js 和正则1-5；变量结构脚本/WTC/<状态栏>占位符提醒/正则6 由 AI 按 9.1.6 工作流一条一条生成
                // 当AI生成了InitVar条目后，触发一次补注入（确保固定资产不丢）
                if (currentTab === 'mvu') {
                  const mvuEntriesAfterMerge = (cardData.character_book || {}).entries || [];
                  const hasInitVarAfterMerge = mvuEntriesAfterMerge.some(function(e) {
                    return (e.comment || '').toLowerCase().indexOf('[initvar]') >= 0;
                  });
                  if (hasInitVarAfterMerge) {
                    const newlyInjected = ensureFixedMvuAssetsInCardData();
                    if (newlyInjected && newlyInjected.length > 0) {
                      renderPreview();
                    }
                  }
                }
                // 显示变更统计 Toast，让用户明确知道AI确实执行了删改而不是瞎加
                try {
                  // 合并后简易 diff：驱动预览面板闪光 + 追加新增/删除行数
                  let _entryDiff = null;
                  try {
                    _entryDiff = computeEntryDiff(_entriesBeforeMerge, _snapshotEntries());
                  } catch (e) {
                    logWarn('entryDiff', e);
                  }
                  if (_entryDiff) flashPreviewChanges(_entryDiff);
                  if (changeLogResult) {
                    const cr = changeLogResult;
                    const parts = [];
                    if (cr.added) parts.push('➕新增' + cr.added + '条');
                    if (cr.updated) parts.push('🔄更新' + cr.updated + '条');
                    if (cr.deleted) parts.push('🗑️删除' + cr.deleted + '条');
                    if (cr.fieldUpdates) parts.push('📝字段' + cr.fieldUpdates + '项');
                    if (_entryDiff && _entryDiff.updated.length) {
                      let addL = 0,
                        delL = 0;
                      _entryDiff.updated.forEach(function(u) {
                        addL += u.addLines;
                        delL += u.delLines;
                      });
                      if (addL || delL) parts.push('📝正文 +' + addL + '/-' + delL + '行');
                    }
                    if (parts.length) showToast('✅ 已应用修改：' + parts.join('，'), 'success');
                    // mergePartial 路径下同样提示删除失败（AI走旧JSON协议、写 _delete/entries[{_action:delete}] 时的兜底提醒）
                    if (cr._deleteFailures && cr._deleteFailures.length > 0) {
                      const failList = cr._deleteFailures.map(function(k, i) {
                        return (i + 1) + '. ⟦' + k + '⟧';
                      }).join('\n');
                      try {
                        showToast('⚠️ AI 想要删除以下条目，但未匹配到（comment 不精确 / 模糊匹配命中多条已跳过）：\n' +
                          failList +
                          '\n💡解决：①预览面板双击该条目→手动删除；②或告知AI精确 comment。',
                          'warning', 9000);
                      } catch (_) {}
                    }
                  }
                } catch (e) { logWarn("callAIChat", e); }
              } else if (hasData) {
                // AI输出了JSON但实际上没修改到任何东西（可能comment不匹配导致只加不删没生效）
                // 提示用户可能需要调整comment
                showToast('⚠️ AI返回了修改指令，但未匹配到任何条目（可能comment不精确）。请让AI使用精确comment或在JSON中加_action:delete明确删除', 'warning', 6000);
              }
            }
          }
          // lastUserInput 兜底逻辑：仅在用户明确要求修改开场白时才强制写入 first_mes
          // 修复：之前用 indexOf('开场白') 太脆弱，"别动开场白"也会触发
          // 现在改为：只在 parsed 中有 first_mes 且 mergePartial 没成功写入时才兜底
          // 且不再依赖 lastUserInput 关键词匹配（mergePartial 已能处理 first_mes 更新）
          if (parsed && parsed.first_mes && typeof parsed.first_mes === 'string' && parsed.first_mes.trim().length > 50) {
            // 仅当 mergePartial 没修改到 first_mes 时，才用这段兜底赋值
            if (cardData.first_mes !== parsed.first_mes.trim()) {
              // 额外检查：用户当前输入确实是在讨论开场白（正向意图，非否定语境）
              if (lastUserInput) {
                const hasOpening = lastUserInput.indexOf('开场白') >= 0 || lastUserInput.indexOf('first_mes') >= 0 || lastUserInput.indexOf('opening') >= 0 || lastUserInput.indexOf('开局') >= 0;
                const isNegation = /别动|不要|不用|别改|保持|取消|撤销|删除开场/.test(lastUserInput);
                if (hasOpening && !isNegation) {
                  cardData.first_mes = parsed.first_mes.trim();
                  progress = calcProgress();
                }
              }
            }
          }
          // ===== 状态栏处理（统一模板：从AI回复中提取完整HTML并保存）==========
          // ========== Tab 隔离：状态栏处理仅在 MVU Tab 中执行，角色卡Tab完全跳过 ==========
          if (currentTab === 'mvu') {
            try {
              const _sbSavedMain = tryExtractStatusBarHtml(aiResponse);
              if (_sbSavedMain) {
                showToast('✅ 已从AI回答中提取状态栏HTML并保存', 'success');
                progress = calcProgress();
                // ⚠️P0修复：立即持久化——原先漏了 saveToStorage，若后续步骤异常/用户直接关闭，
                // 内存里的状态栏正则不落盘，重开编辑器后"未生成"且写入酒馆丢失
                saveToStorage();
                renderPreview();
              } else {
                // ⚠️失败可见化：原先静默失败，用户只看到"预览未生成"却不知道原因
                // 有```代码块但没识别为状态栏时给出明确提示（Console 有各代码块判定详情）
                const _hasFence = /```/.test(aiResponse || '');
                if (_hasFence) {
                  showToast('⚠️ AI回复中有代码块，但未识别为状态栏HTML（未保存）。\n详情见浏览器Console的 [statusbar] 日志', 'warning', 7000);
                }
              }
            } catch (e) {
              logWarn('statusbar', e);
            }
          } // End of: if (currentTab === 'mvu') - 状态栏处理仅在MVU Tab

          // 检测AI发出的 <preview_statusbar> 命令（仅MVU Tab生效）
          if (currentTab === 'mvu' && aiResponse && aiResponse.indexOf('<preview_statusbar>') >= 0) {
            try {
              addAssistantMsg('🎛️ 当前状态栏预览：\n```html\n' + MVU_STATUS_BAR_HTML + '\n```');
            } catch (_pvErr) {
              logWarn('statusbarPreview', _pvErr);
            }
          }

          // ========== 关闭队列模式，合并所有系统消息到一条回复 ==========
          _aiChatQueueMode = false;
          // 对话框显示与历史存储：合并AI原始回复 + 队列中的系统消息，只显示一条消息
          let rawContent = aiResponse;
          if (_aiChatNotesQueue.length > 0) {
            rawContent = (rawContent || '') + '\n\n---\n' + _aiChatNotesQueue.join('\n\n');
          }
          _aiChatNotesQueue = [];

          // 1. 先存储到历史（Tab隔离：存到当前Tab的专属数组）
          //    ⚠️必须先 push 再 appendMsg：appendMsg 用 getCurrentMessages().length-1 算消息索引，
          //    若先 append 再 push，DOM 上的 data-msg-index 会比实际数组索引小1，导致头像菜单撤回/重新生成定位错位
          const _aiMsgContent = (rawContent && rawContent.trim().length > 0) ? rawContent : '（已应用修改）';
          curTabMessages.push({
            role: 'assistant',
            content: _aiMsgContent
          });
          // 2. 显示完整内容到对话框（合并后的一条消息），显式传入索引确保与数组对齐
          try {
            appendMsg('assistant', _aiMsgContent, curTabMessages.length - 1);
          } catch (e) {
            logWarn('appendMsg', e);
          }
          saveToStorage();
          updateProgress();
          updateQuickActions();
          updateCtxBar();
          renderPreview();
          scheduleCtxBarUpdate();
          saveToStorage();
        } catch (err) {
          // 严重错误：AI 调用/响应解析/合并失败。控制台留完整错误栈（带 scope），对话内给用户可读提示
          logError('callAIChat', err);
          removeTyping();
          _aiChatQueueMode = false;
          _aiChatNotesQueue = [];
          try {
            addAssistantMsg('😞 出错了：' + (err && err.message) + '\n\n请检查酒馆是否已连接AI模型，以及JS-Slash-Runner插件是否已启用。');
          } catch (e) { logWarn("callAIChat", e); }
          try {
            setEnabled(true);
          } catch (e) { logWarn("callAIChat", e); }
        } finally {
          isGenerating = false;
          try {
            setEnabled(true);
          } catch (e) { logWarn("callAIChat", e); }
        }
      }

      // ===== 完整生成 =====
      async function doGenerate() {
        if (isGenerating) return;
        // ========== Tab 隔离：角色卡一键生成仅在角色卡Tab可用，MVU Tab不能调用 ==========
        if (currentTab !== 'card') {
          showToast('⚠️ 「一键生成完整角色卡」仅在「角色卡生成」Tab中可用。\n当前在MVU变量状态栏Tab，请切换到角色卡生成Tab使用此功能。', 'warning', 5000);
          return;
        }
        isGenerating = true;
        setEnabled(false);
        addTyping();
        try {
          const hasAll = cardData.name && cardData.description && cardData.first_mes && ((cardData.character_book || {}).entries || []).length >= 4;
          if (hasAll) {
            removeTyping();
            cardGenerated = true;
            // ⚠️修复：原先 setProgress(100) 虚报进度（实际按 calcProgress 计），
            // 且手动收尾后 finally 还会再收尾一遍 + 弹"完成"toast（什么都没生成也算完成）
            progress = calcProgress();
            setProgress(progress);
            renderPreview();
            updateCtxBar();
            scheduleCtxBarUpdate();
            addAssistantMsg('🎉 角色卡内容已完整！点击「💾 导出」查看完整JSON。\n\n你也可以继续和我对话，随时修改或补充内容。');
            return; // 直接走 finally 统一收尾（不再手动重复 isGenerating/setEnabled）
          }
          // 角色卡Tab：genPrompt也必须过滤MVU内容，并明确禁止生成MVU条目
          const filteredSysForGenerate = filterOutMvuSectionsFromSysPrompt(SYS_PROMPT);
          const antiMvuBanGenerate = '\n\n⚠️【生成时MVU隔离禁令 · 绝对不允许违反】\n' +
            '1. 绝对禁止生成MVU变量条目：[InitVar]初始变量、变量列表、变量更新规则、变量输出格式、变量输出格式强调、<状态栏>占位符提醒\n' +
            '2. 绝对禁止生成<状态栏>或任何状态栏相关的世界书条目\n' +
            '3. 绝对禁止在regex_scripts中生成MVU/StatusPlaceHolderImpl/UpdateVariable相关正则脚本\n' +
            '4. MVU变量条目（8条工作流）和状态栏由独立的MVU Tab负责，当前生成任务与MVU系统完全无关\n';
          let genPrompt = filteredSysForGenerate + antiMvuBanGenerate +
            '\n\n=== 生成指令 ===\n' +
            '请立即生成完整的角色卡数据，补齐所有缺失的核心字段。\n\n' +
            '=== ★★★输出方式：只允许使用 :::操作块协议，禁止输出任何```json代码块/JSON！★★★ ===\n' +
            '- 世界观描述（description）用：::: set description\\n完整世界观描述正文\\n:::\n' +
            '- 开场白1（first_mes）用：::: set first_mes\\n开场白正文\\n:::\n' +
            '- 备选开场白2/3（alternate_greetings，多条用---分割）用：::: set alternate_greetings\\n开场白2\\n---分割---\\n开场白3\\n:::\n' +
            '- 角色名（name）用：::: set name\\n世界/角色名称\\n:::\n' +
            '- 世界书条目用：::: upsert 条目名\\nkeys=触发词1,触发词2\\nconstant=false\\nposition=4\\nselectiveLogic=0\\ndepth=4\\nprobability=100\\norder=100\\nmatch_whole_words=false\\n\\n身份：……\\n外貌：……\\n性格：……\\n能力：\\n  - ……\\n  - ……\\n:::\n' +
            '- ★条目正文（content）必须使用YAML中文格式：每行一个「维度：内容」（身份/外貌/性格/能力/背景/关系等），列表用缩进+短横线逐项列出，禁止写成一大段无结构文字\n' +
            '- 已有条目用相同 comment 覆盖（::upsert必须输出完整旧content+改动部分），缺失的补充新条目\n\n' +
            '=== 必须达到的字段标准 ===\n' +
            '- name：简洁有力的世界/角色名称（字数自由）\n' +
            '- description（世界观描述）：不限字数，覆盖世界核心设定（地理/历史/势力/规则/种族等），这是世界观的主体，用分段+要点列出\n' +
            '- first_mes（开场白1）：不限字数，结构：场景描写→动作驱动→内心独白→自然对话→结尾留钩，分段落自然展开\n' +
            '- alternate_greetings（备选开场白2/3以此类推）：至少生成2条以上，与开场白1不同的场景/视角/时机\n' +
            '- personality/scenario：内容自由（纯世界模式可留空，角色模式建议填写）\n' +
            '- 多开局机制：开场白1用 first_mes，开场白2/3以此类推用 alternate_greetings（多条用---分割），全部由AI生成\n' +
            '- extensions.depth_prompt：新手引导（depth=0，可选）\n' +
            '- character_book.entries：不限数量，自由命名，按用户需求生成世界书条目（触发词/常驻/位置/逻辑等字段遵循ST官方规则），每条字数自由\n' +
            '- ★★★【逐项决策】每条世界书条目生成时，必须按「条目元素逐项决策清单」把40个元素全部过一遍：需要自定义的写进操作块元信息行（keys/constant/position/selectiveLogic/depth/probability/order/match_whole_words/role/group/triggers 等），用默认值的不用写。禁止只写keys和content就完事，禁止遗漏影响触发的字段\n' +
            '- 已有条目用相同comment覆盖，缺失的补充新条目\n' +
            '- ★每条目根据当前角色卡全部内容（name/description/开场白/已有条目）调整触发词、常驻或触发、位置、深度、触发逻辑、分组等元素，与整体世界观协调一致\n\n' +
            '=== 已有内容（参考，不要丢失） ===\n' +
            (cardData.name ? '- 名称：' + cardData.name + '\n' : '') +
            (cardData.description ? '- 描述(完整' + (cardData.description || '').length + '字，不截断)：' + (cardData.description || '') + '\n' : '') +
            '- 条目数：' + (((cardData.character_book || {}).entries || []).length) + '条\n' +
            '\n=== 输出要求 ===\n只输出 :::操作块协议（set顶层字段 + upsert条目），严禁输出任何JSON代码块。严禁夹带任何MVU内容。';
          // 注入全局人设（与 callAIChat 路径保持一致）
          const _genPersonaHdr = getPersonaHeader();
          if (_genPersonaHdr) genPrompt = _genPersonaHdr + '\n\n' + genPrompt;
          const aiResponse = await callAI(genPrompt);
          removeTyping();
          // doGenerate 路径同样需要快照，否则撤回一键生成结果时无法回滚cardData
          try {
            const _genMsgs = getCurrentMessages();
            saveCardDataSnapshot(_genMsgs.length);
          } catch (_genSnapErr) {}

          // ===== 操作块协议优先（与 callAIChat 路径一致：只用:::操作块）=====
          if (hasOpBlocks(aiResponse)) {
            const _genOps = parseOpBlocks(aiResponse);
            if (_genOps.length > 0) {
              const _entriesBeforeGen = _snapshotEntries();
              const _genOpResult = applyOps(_genOps, cardData);
              if (_genOpResult.modified) {
                cardGenerated = true;
                setProgress(100);
                renderPreview();
                updateCtxBar();
                scheduleCtxBarUpdate();
                saveToStorage();
                const _crGen = _genOpResult.changeLog || {};
                let _diffGen = null;
                try {
                  _diffGen = computeEntryDiff(_entriesBeforeGen, _snapshotEntries());
                } catch (_eGd) {}
                if (_diffGen) flashPreviewChanges(_diffGen);
                const _partsG = [];
                if (_crGen.added) _partsG.push('➕新增' + _crGen.added + '条');
                if (_crGen.updated) _partsG.push('✏️更新' + _crGen.updated + '条');
                if (_crGen.deleted) _partsG.push('🗑️删除' + _crGen.deleted + '条');
                if (_crGen.fieldUpdates) _partsG.push('⚙️字段更新' + _crGen.fieldUpdates + '处');
                addAssistantMsg('🎉 角色卡生成成功！' + (_partsG.length ? ('本次' + _partsG.join('、') + '。') : '') + '点击「💾 导出」查看完整JSON。\n\nMVU变量系统和状态栏请切换到「MVU变量状态栏」Tab独立制作。');
              } else {
                addAssistantMsg('⚠️ 生成完成，但没有检测到实际变更（操作块已解析但未修改任何内容）。\n\nAI返回前' + CONFIG.AI_ERROR_PREVIEW_CHARS + '字：\n' + aiResponse.substring(0, CONFIG.AI_ERROR_PREVIEW_CHARS));
              }
            } else {
              addAssistantMsg('⚠️ 未解析出有效操作块，可能需要再补充一些信息。\n\nAI返回前' + CONFIG.AI_ERROR_PREVIEW_CHARS + '字：\n' + aiResponse.substring(0, CONFIG.AI_ERROR_PREVIEW_CHARS));
            }
            removeTyping();
          } else {
          let parsed = extractJSON(aiResponse);
          if (parsed) {
            // 角色卡一键生成：同样走MVU内容过滤防御
            const genFiltered = filterMvuEntriesFromParsed(parsed);
            if (genFiltered._mvuStrippedCount > 0 || genFiltered._mvuRegexScriptStripped) {
              showToast('⚠️ 一键生成的结果中检测到 ' + genFiltered._mvuStrippedCount + ' 项MVU违规内容，已自动过滤。', 'warning', 5000);
            }
            parsed = genFiltered.parsed;
            try {
              let genMergeOk = false;
              if (parsed.spec === 'chara_card_v3' && parsed.data) {
                const rV3 = mergePartial(parsed.data, cardData, {
                  returnLog: true
                });
                genMergeOk = !!(typeof rV3 === 'object' ? rV3.modified : rV3);
              } else {
                const rPlain = mergePartial(parsed, cardData, {
                  returnLog: true
                });
                genMergeOk = !!(typeof rPlain === 'object' ? rPlain.modified : rPlain);
              }
              cardGenerated = true;
              setProgress(100);
              renderPreview();
              updateCtxBar();
              scheduleCtxBarUpdate();
              saveToStorage();
              addAssistantMsg('🎉 角色卡生成成功！点击「💾 导出」查看完整JSON。\n\nMVU变量系统和状态栏请切换到「MVU变量状态栏」Tab独立制作。');
            } catch (e) {
              logError('doGenerate.parse', e);
              addAssistantMsg('⚠️ 解析失败，请重试。\n\n错误：' + e.message);
            }
          } else {
            addAssistantMsg('⚠️ 未找到JSON格式，可能需要再补充一些信息。\n\nAI返回前' + CONFIG.AI_ERROR_PREVIEW_CHARS + '字：\n' + aiResponse.substring(0, CONFIG.AI_ERROR_PREVIEW_CHARS));
          }
          } // end: 操作块优先 else（JSON回退路径）
        } catch (err) {
          logError('doGenerate', err);
          removeTyping();
          addAssistantMsg('生成出错：' + (err && err.message));
          pushWorkToast('生成出错', 'done');
        } finally {
          isGenerating = false;
          setEnabled(true);
          pushWorkToast('完成', 'done');
        }
      }

      // 记录禁用前输入框是否聚焦，避免恢复时抢焦点打断用户阅读
      let _inputWasFocused = false;

      function setEnabled(enabled) {
        const sendBtn = doc.getElementById('sendBtn');
        const saveBtn = doc.getElementById('saveBtn');
        const input = doc.getElementById('chatInput');
        if (sendBtn) sendBtn.disabled = !enabled;
        if (saveBtn) saveBtn.disabled = !enabled;
        if (input) {
          // 禁用前记录焦点状态；恢复时仅当原本聚焦才重新聚焦
          if (!enabled) {
            _inputWasFocused = (doc.activeElement === input);
            input.disabled = true;
          } else {
            input.disabled = false;
            if (_inputWasFocused) {
              try {
                input.focus();
              } catch (e) { logWarn("setEnabled", e); }
            }
            _inputWasFocused = false;
          }
        }
        // 发送按钮图标切换：生成中显示等待（转圈）图标，空闲显示发送图标
        if (sendBtn) {
          const waiting = !enabled;
          if (waiting) sendBtn.classList.add('is-waiting');
          else sendBtn.classList.remove('is-waiting');
        }
        // 快捷按钮、上下文模块按钮统一禁用/启用，避免生成中误触
        const sels = ['.quick-btn', '.ctx-mod'];
        for (let s = 0; s < sels.length; s++) {
          const nodes = doc.querySelectorAll(sels[s]);
          for (let i = 0; i < nodes.length; i++) {
            nodes[i].disabled = !enabled;
            nodes[i].style.pointerEvents = enabled ? '' : 'none';
            nodes[i].style.opacity = enabled ? '' : '0.5';
          }
        }
        updateSendBtnPulse();
      }

      function getModuleProgress() {
        let entries = (cardData.character_book || {}).entries || [];
        // ========== Tab 隔离：角色卡Tab 过滤掉 MVU 条目 ==========
        const __tab = (typeof window !== 'undefined' && typeof window.__getActiveTab === 'function') ? window.__getActiveTab() : (typeof activeTab !== 'undefined' ? activeTab : 'card');
        if (__tab === 'card') {
          entries = entries.filter(function(e) {
            return !isMVUEntry(e.comment || '');
          });
        }
        // 自由世界书条目统计（不再按八体系引导，仅统计条目总量与配置完整性）
        const result = {};
        const constCount = entries.filter(function(e) {
          return e.constant === true;
        }).length;
        const trigCount = entries.length - constCount;
        const groupCount = entries.filter(function(e) {
          return !!(e.group || (e.extensions && e.extensions.group));
        }).length;
        const hasKey = entries.some(function(e) {
          return !!(e.key || (e.keys && e.keys.length > 0));
        });
        const hasContent = entries.some(function(e) {
          return (e.content || '').length > 50;
        });
        result.total = entries.length >= 4;
        result.constant = constCount >= 1;
        result.triggered = trigCount >= 2;
        result.grouped = groupCount >= 1;
        result.has_key = hasKey;
        result.has_content = hasContent;
        return result;
      }

      function calcProgress() {
        let score = 0;
        if (cardData.name) score += 8;
        if (cardData.description && cardData.description.length >= 400) score += 15;
        else if (cardData.description && cardData.description.length >= 200) score += 10;
        else if (cardData.description && cardData.description.length > 50) score += 5;
        let entries = (cardData.character_book || {}).entries || [];
        // ========== Tab 隔离：角色卡Tab 不统计 MVU 条目 ==========
        const __tab = (typeof window !== 'undefined' && typeof window.__getActiveTab === 'function') ? window.__getActiveTab() : (typeof activeTab !== 'undefined' ? activeTab : 'card');
        if (__tab === 'card') {
          entries = entries.filter(function(e) {
            return !isMVUEntry(e.comment || '');
          });
        }
        if (entries.length >= 4) {
          if (cardData.first_mes && cardData.first_mes.length >= 500) score += 15;
          else if (cardData.first_mes && cardData.first_mes.length >= 300) score += 8;
        }
        // system_prompt 不参与评分：写卡器契约为留空，身份写入 description/personality
        if (cardData.extensions && cardData.extensions.depth_prompt && cardData.extensions.depth_prompt.prompt) score += 3;
        if ((cardData.personality || '').trim() || (cardData.scenario || '').trim()) score += 2;
        score += Math.min(entries.length * 5, 30);
        const mp = getModuleProgress();
        const doneCount = Object.keys(mp).filter(function(k) {
          return mp[k] === true;
        }).length;
        score += doneCount * 3;
        if (cardData.creator_notes && cardData.creator_notes.length >= 10) score += 2;
        return Math.min(score, 100);
      }

      function updateProgress() {
        progress = calcProgress();
        const pl = doc.getElementById('phaseLabel');
        if (pl) pl.textContent = progress + '%';
      }

      function setProgress(val) {
        progress = Math.max(0, Math.min(100, val));
        const pl = doc.getElementById('phaseLabel');
        if (pl) pl.textContent = progress + '%';
      }

      // ===== MVU状态栏预览（仅当用户已配置MVU变量系统时可用）=====
      // 用 iframe srcdoc 沙箱渲染状态栏HTML，内部 mock 酒馆运行时API
      // 数据源：从 [InitVar]初始变量 世界书条目解析YAML作为 stat_data
      // HTML源：优先用AI生成的正则6 replaceString，回退用 MVU_STATUS_BAR_HTML 默认模板
      function showMvuStatusBarPreview() {
        /* 改进Q：重复打开去重——若已存在预览模态框，先移除旧实例，避免iframe叠加和定时器累积 */
        const existingModal = doc.getElementById('mvuPreviewModal');
        if (existingModal) {
          existingModal.remove();
        }
        const entries = (cardData.character_book || {}).entries || [];
        /* 前置检查：必须存在MVU条目 */
        const hasMVU = entries.some(function(e) {
          return isMVUEntry(e.comment || '');
        });
        if (!hasMVU) {
          showToast('请先配置MVU变量系统（[InitVar]初始变量等条目）后再使用状态栏预览', 'warning');
          return;
        }
        /* 读取 [InitVar] 初始变量 YAML 作为预览假数据 */
        let initVarEntry = null;
        for (let i = 0; i < entries.length; i++) {
          if ((entries[i].comment || '').toLowerCase().indexOf('[initvar]') >= 0) {
            initVarEntry = entries[i];
            break;
          }
        }
        let statData = {};
        let initVarContent = '';
        let usingSampleData = false;
        if (initVarEntry && initVarEntry.content) {
          initVarContent = initVarEntry.content;
          const parsed = parseInitVar(initVarContent);
          if (parsed) statData = parsed;
        }
        /* 若 InitVar 为空或解析失败，使用示例数据让预览仍有内容可渲染 */
        if (!statData || Object.keys(statData).length === 0) {
          statData = {
            '世界': {
              '当前日期': '2025-07-26',
              '当前时间': '17:36'
            },
            '主角': {
              '好感度': 35,
              '状态': '正常',
              '物品栏': {}
            }
          };
          usingSampleData = true;
        }
        /* 读取状态栏HTML：优先AI生成的正则6，回退默认模板 */
        let statusBarHtml = MVU_STATUS_BAR_HTML;
        let statusBarSource = '默认模板';
        const regexScripts = cardData.extensions && cardData.extensions.regex_scripts || [];
        for (let j = 0; j < regexScripts.length; j++) {
          const r = regexScripts[j];
          /* 匹配 StatusPlaceHolder（兼容带Impl和不带Impl的版本） */
          if ((r.findRegex || '').indexOf('StatusPlaceHolder') >= 0 && r.markdownOnly && !r.promptOnly) {
            const rep = r.replaceString || '';
            /* 去掉 ```html ... ``` 或 ``` ... ``` 包裹（StageDog标准用纯```无语言） */
            const m = rep.match(/```(?:html)?\s*\n([\s\S]*?)\n```/);
            if (m) {
              statusBarHtml = m[1];
              statusBarSource = 'AI生成正则';
            } else if (rep.indexOf('<!doctype html') >= 0 || rep.indexOf('<html') >= 0) {
              statusBarHtml = rep;
              statusBarSource = 'AI生成正则';
            }
            break;
          }
        }
        /* ====== HTML 鲁棒性包装：如果 AI 生成的只是 <body> 片段或独立片段，自动补全为完整 HTML 文档 ====== */
        (function() {
          const hasDocType = /<!doctype\s/i.test(statusBarHtml);
          const hasHtmlTag = /<html[\s>]/i.test(statusBarHtml);
          const hasHeadTag = /<head[\s>]/i.test(statusBarHtml);
          /* 默认模板本身是完整的，不用包；AI 生成的片段没 doctype/head/body 时需要包 */
          if (!hasDocType && !hasHtmlTag) {
            statusBarHtml = '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <title>MVU StatusBar</title>\n</head>\n<body>\n' + statusBarHtml + '\n</body>\n</html>';
            statusBarSource += '（已补全HTML骨架）';
          } else if (hasHtmlTag && !hasHeadTag) {
            /* 有 <html> 但缺 <head>：插入空 head 标签供 mock 注入 */
            statusBarHtml = statusBarHtml.replace(/<html([^>]*)>/i, '<html$1>\n<head></head>');
          }
          /* 如果最终仍缺 render-root，自动补一个（放在 body 开头），否则渲染没地方写 */
          if (statusBarHtml.indexOf('id="render-root"') < 0 && statusBarHtml.indexOf("id='render-root'") < 0) {
            if (/<body([^>]*)>/i.test(statusBarHtml)) {
              statusBarHtml = statusBarHtml.replace(/(<body[^>]*>)/i,
                '$1\n<div class="mvu-status-card"><div class="card-body" id="render-root"><div class="loading-state">正在加载状态数据...</div></div></div>');
              statusBarSource += '（已补render-root）';
            }
          }
        })();
        /* 构建预览弹窗：顶部说明+数据来源标识，主体为iframe沙箱渲染 */
        let h = '<div class="modal" id="mvuPreviewModal">' +
          '<div class="modal-content" style="max-width:720px">' +
          '<h3 style="color:#a16207;margin-bottom:8px;font-size:1em">🎛️ MVU状态栏预览</h3>' +
          /* 顶部只有标题，然后直接是iframe渲染区，不显示任何变量信息 */
          '';
        /* InitVar 缺失提示仅用于控制台日志，不在界面显示 */
        if (!initVarEntry) {
          console.warn('[预览] 未找到 [InitVar]初始变量 条目，使用示例数据');
        } else if (usingSampleData) {
          console.warn('[预览] [InitVar] 条目内容为空或格式异常，使用示例数据');
        }
        h += '<div style="background:#ffffff;border:1px solid rgba(15,23,42,.10);border-radius:8px;overflow:hidden;margin-bottom:8px">' +
          '<iframe id="mvuPreviewFrame" style="width:100%;height:420px;border:0;background:transparent" sandbox="allow-scripts"></iframe>' +
          '</div>' +
          '<div class="modal-actions">' +
          '<button class="btn btn-ghost" id="mvuPreviewCloseBtn">关闭</button>' +
          '</div>' +
          '</div></div>';
        const tmp = doc.createElement('div');
        tmp.innerHTML = h;
        const modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);
        /* 注入 iframe 内容：在状态栏HTML前注入 mock API + 轻量级jquery/lodash子集 */
        const frame = doc.getElementById('mvuPreviewFrame');

        function loadFrame() {
          const mockScript = buildPreviewMockScript(statData);
          let fullDoc = statusBarHtml;
          /* ======【插入位置：将 mock 脚本放在 <head> 的最开始，保证 mock API 先于状态栏原有 script 执行 ======
             （相比插在 </head> 前，这样即使原状态栏用了 defer/module 也能拿到 $、_、getAllVariables） */
          const headStartMatch = fullDoc.match(/<head[^>]*>/i);
          if (headStartMatch) {
            /* 插入到 <head ...> 标签紧后面（紧跟 headStartMatch[0] 的后面）
               同时把默认模板的 <style> 保留（否则 mock 脚本在 style 前也没关系，因为 script 是顺序执行的，style 仍会生效 */
            const idx = fullDoc.indexOf(headStartMatch[0]);
            fullDoc = fullDoc.substring(0, idx + headStartMatch[0].length) +
              '\n' + mockScript + '\n' +
              fullDoc.substring(idx + headStartMatch[0].length);
          } else if (fullDoc.indexOf('<body') >= 0) {
            fullDoc = fullDoc.replace(/<body/i, mockScript + '<body');
          } else {
            fullDoc = mockScript + fullDoc;
          }
          /* ✅ 修复：不要在最后把所有 </script> 替换成 <\\/script>！
             - </script> 作为 HTML 闭合标签是合法且必须的（脚本 tag 需要正常闭合）
             - 只有在 <script> 标签 *文本内容内部* 出现 </script> 才会截断
             - 已在 statDataJson 阶段单独转义：JSON.stringify(statData).replace(/<\/script/gi, '<\\/script')
             - 这里再次全量替换会把 </script> tag 本身变成非法的 \</script>，让浏览器无法解析，导致整页空白！ */
          frame.srcdoc = fullDoc;
        }
        loadFrame();
        /* 关闭逻辑 */
        modalEl.addEventListener('click', function(e) {
          if (e.target === modalEl) modalEl.remove();
        });
        doc.getElementById('mvuPreviewCloseBtn').addEventListener('click', function() {
          modalEl.remove();
        });
      }

      // ===== 权重可视化预览（规范4.4） =====
      function showWeightVisual() {
        const entries = (cardData.character_book || {}).entries || [];
        if (entries.length === 0) {
          showToast('还没有世界书条目，先和AI聊聊生成内容吧', 'warning');
          return;
        }
        let permToken = 0,
          trigToken = 0,
          totalToken = 0;
        entries.forEach(function(e) {
          const tk = countTokens(e.content || '');
          totalToken += tk;
          if (e.constant) permToken += tk;
          else trigToken += tk;
        });

        let h = '<div class="modal" id="wvModal">' +
          '<div class="modal-content">' +
          '<h3 style="color:#a16207;margin-bottom:4px;font-size:1em">📊 权重可视化预览</h3>' +
          '<p style="font-size:.72em;color:#667085;margin-bottom:8px">展示每个条目的权重等级、触发逻辑、Token占用（对齐ST注入权重层级）</p>' +
          '<div class="wv-summary">' +
          '<div class="wv-stat"><span class="wv-stat-val" style="color:#15803d">' + entries.length + '</span><span class="wv-stat-lbl">条目总数</span></div>' +
          '<div class="wv-stat"><span class="wv-stat-val" style="color:#c98b7a">' + permToken + '</span><span class="wv-stat-lbl">常驻Token</span></div>' +
          '<div class="wv-stat"><span class="wv-stat-val" style="color:#a16207">' + trigToken + '</span><span class="wv-stat-lbl">触发Token</span></div>' +
          '<div class="wv-stat"><span class="wv-stat-val" style="color:#ca8a04">' + totalToken + '</span><span class="wv-stat-lbl">总Token</span></div>' +
          '</div>' +
          '<div class="wv-legend">';
        const legendItems = [{
            level: '最高',
            color: '#c98b7a',
            desc: 'post_history/铁则'
          },
          {
            level: '极高',
            color: '#c98b7a',
            desc: 'position=2/状态栏'
          },
          {
            level: '中高',
            color: '#ca8a04',
            desc: 'position=4 触发'
          },
          {
            level: '中',
            color: '#15803d',
            desc: '概率触发/动态'
          },
          {
            level: '低',
            color: '#667085',
            desc: 'position=1 常驻'
          },
          {
            level: '极低',
            color: '#b3aa98',
            desc: 'position=0 常驻'
          }
        ];
        legendItems.forEach(function(l) {
          h += '<span class="wv-legend-item"><span class="wv-legend-dot" style="background:' + l.color + '"></span>' + l.level + '(' + l.desc + ')</span>';
        });
        h += '</div>' +
          '<div class="modal-body">';

        // 按分组展示
        const groupOrder = ['常驻体系', '触发体系', '动态系统', '自定义'];
        const groupColors = {
          '常驻体系': '#15803d',
          '触发体系': '#a16207',
          '动态系统': '#ca8a04',
          '自定义': '#667085'
        };
        groupOrder.forEach(function(g) {
          const groupEntries = entries.filter(function(e) {
            const eg = getDisplayGroup(e);
            return eg === g;
          });
          if (groupEntries.length === 0) return;
          let groupTok = 0;
          groupEntries.forEach(function(e) {
            groupTok += countTokens(e.content || '');
          });
          h += '<div class="wv-group-header"><span style="color:' + (groupColors[g] || '#667085') + '">' + g + '</span><span class="wv-group-count">' + groupEntries.length + '条 · ' + groupTok + 'T</span></div>';
          // 按权重排序（order越大权重越低，先展示高权重=order小）
          groupEntries.sort(function(a, b) {
            return (a.insertion_order || 100) - (b.insertion_order || 100);
          });
          groupEntries.forEach(function(e, idx) {
            const comment = e.comment || ('条目' + (idx + 1));
            const m = comment.match(/^<([^>]+)>/);
            const prefixKey = m ? m[1] : '';
            const wl = WEIGHT_LEVELS[prefixKey] || {
              level: '中',
              color: '#15803d',
              desc: '自定义'
            };
            const tk = countTokens(e.content || '');
            const ext = e.extensions || {};
            const tmpl = getEntryTemplate(comment);
            const isConst = e.constant !== undefined ? e.constant : (tmpl ? tmpl.constant : false);
            const pos = ext.position !== undefined ? ext.position : (tmpl ? tmpl.position : 4);
            const depth = ext.depth !== undefined ? ext.depth : (tmpl ? tmpl.depth : 4);
            const sticky = ext.sticky || 0;
            const cd = ext.cooldown || 0;
            const pr = ext.prevent_recursion;
            const prob = ext.probability !== undefined ? ext.probability : 100;
            const sl = ext.selectiveLogic || 0;

            h += '<div class="wv-entry" style="border-left-color:' + wl.color + '">' +
              '<div class="wv-entry-header">' +
              '<span class="wv-entry-name" title="' + escHtml(comment) + '">' + escHtml(comment) + '</span>' +
              '<span class="wv-entry-level" style="background:' + wl.color + '20;color:' + wl.color + ';border:1px solid ' + wl.color + '50">' + wl.level + '</span>' +
              '<span class="wv-entry-token">' + tk + 'T</span>' +
              '</div>' +
              '<div class="wv-entry-meta">' +
              '<span class="wv-tag ' + (isConst ? 'const' : 'trig') + '">' + (isConst ? '常驻' : '触发') + '</span>' +
              '<span class="wv-tag">pos=' + pos + '</span>' +
              (!isConst ? '<span class="wv-tag">depth=' + depth + '</span>' : '') +
              (sticky ? '<span class="wv-tag dyn">sticky</span>' : '') +
              (cd ? '<span class="wv-tag warn">CD=' + cd + '</span>' : '') +
              (pr ? '<span class="wv-tag const">防递归</span>' : '') +
              (prob < 100 ? '<span class="wv-tag warn">' + prob + '%</span>' : '') +
              (sl ? '<span class="wv-tag trig">SL=' + sl + '</span>' : '') +
              '<span class="wv-tag" style="color:#b3aa98" title="' + escHtml(wl.desc) + '">' + escHtml(wl.desc) + '</span>' +
              '</div>' +
              '</div>';
          });
        });

        h += '</div>' +
          '<div class="modal-actions">' +
          '<button class="btn btn-ghost" id="wvCloseBtn">关闭</button>' +
          '</div>' +
          '</div></div>';
        const tmp = doc.createElement('div');
        tmp.innerHTML = h;
        const modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);
        modalEl.addEventListener('click', function(e) {
          if (e.target === modalEl) modalEl.remove();
        });
        doc.getElementById('wvCloseBtn').addEventListener('click', function() {
          modalEl.remove();
        });
      }

      // ===== 分组管理（规范4.4：分组自动适配） =====
      function showGroupMgr() {
        const entries = (cardData.character_book || {}).entries || [];
        if (entries.length === 0) {
          showToast('还没有世界书条目', 'warning');
          return;
        }
        const groups = {};
        entries.forEach(function(e) {
          const g = getDisplayGroup(e);
          if (!groups[g]) groups[g] = [];
          groups[g].push(e);
        });
        const groupColors = {
          '常驻体系': '#15803d',
          '触发体系': '#a16207',
          '动态系统': '#ca8a04',
          '自定义': '#667085'
        };
        let h = '<div class="modal" id="groupModal">' +
          '<div class="modal-content">' +
          '<h3 style="color:#a16207;margin-bottom:4px;font-size:1em">🗂️ 分组管理</h3>' +
          '<p style="font-size:.72em;color:#667085;margin-bottom:8px">每个体系对应一个世界书分组，支持批量开关（对齐ST分组管理功能）</p>' +
          '<div class="group-mgr-list">';
        Object.keys(groups).forEach(function(g) {
          const gEntries = groups[g];
          let gTok = 0;
          gEntries.forEach(function(e) {
            gTok += countTokens(e.content || '');
          });
          const allEnabled = gEntries.every(function(e) {
            return e.enabled !== false;
          });
          h += '<div class="group-mgr-item">' +
            '<span class="gm-color" style="background:' + (groupColors[g] || '#667085') + '"></span>' +
            '<span class="gm-name">' + escHtml(g) + '</span>' +
            '<span class="gm-count">' + gEntries.length + '条 · ' + gTok + 'T</span>' +
            '<button class="gm-toggle ' + (allEnabled ? 'on' : '') + '" data-group="' + escHtml(g) + '">' + (allEnabled ? '已启用' : '已禁用') + '</button>' +
            '</div>';
        });
        h += '</div>' +
          '<div class="modal-actions">' +
          '<button class="btn btn-ghost" id="groupCloseBtn">关闭</button>' +
          '<button class="btn btn-primary" id="groupReassignBtn">🔄 按前缀重新分组</button>' +
          '</div>' +
          '</div></div>';
        const tmp = doc.createElement('div');
        tmp.innerHTML = h;
        const modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);
        modalEl.addEventListener('click', function(e) {
          if (e.target === modalEl) modalEl.remove();
        });
        doc.getElementById('groupCloseBtn').addEventListener('click', function() {
          modalEl.remove();
        });
        const toggles = modalEl.querySelectorAll('.gm-toggle');
        for (let i = 0; i < toggles.length; i++) {
          toggles[i].addEventListener('click', function() {
            const g = this.getAttribute('data-group');
            const turnOn = !this.classList.contains('on');
            entries.forEach(function(e) {
              const eg = getDisplayGroup(e);
              if (eg === g) e.enabled = turnOn;
            });
            this.classList.toggle('on', turnOn);
            this.textContent = turnOn ? '已启用' : '已禁用';
            saveToStorage();
            renderPreview();
            showToast((turnOn ? '已启用' : '已禁用') + '分组：' + g, 'success');
          });
        }
        const reassignBtn = doc.getElementById('groupReassignBtn');
        if (reassignBtn) reassignBtn.addEventListener('click', function() {
          entries.forEach(function(e) {
            const tmpl = getEntryTemplate(e.comment || '');
            if (tmpl) {
              if (!e.extensions) e.extensions = {};
              e.extensions.group = tmpl.group;
            }
          });
          saveToStorage();
          modalEl.remove();
          showGroupMgr();
          showToast('已按条目前缀重新分配分组', 'success');
        });
      }

      // ===== 预览渲染 =====
      /* 改进V：renderPreview防抖——合并连续渲染请求（如批量更新entries时），避免16+调用点全量重建卡顿 */
      let _renderPreviewTimer = null;

      // ===== 合并 diff 预览高亮 =====
      // 合并前记录 entries 快照，合并后由 computeEntryDiff 得到差异，
      // 在 _renderPreviewImpl 重建 DOM 后给对应条目打 3.2s 闪光 class（新增=绿，更新=琥珀）。
      // 删除的条目已不在 DOM，仅计入 toast 文案。
      let _pvFlash = {
        add: {},
        upd: {},
        ts: 0
      };
      // ===== 世界书条目搜索/筛选/批量操作状态（预览面板重建后仍保留）=====
      // kind: all=全部 / constant=常驻 / triggered=关键词触发 / off=已禁用；group 取 e.extensions.group
      const _pvFilter = {
        q: '',
        kind: 'all',
        group: '',
        batch: false,
        selected: {}
      };
      let _pvSearchHadFocus = false;
      function _snapshotEntries() {
        const arr = (cardData.character_book && cardData.character_book.entries) || [];
        try {
          return arr.map(function(e) {
            return {
              comment: e.comment,
              content: e.content
            };
          });
        } catch (e) {
          logWarn('entrySnapshot', e);
          return [];
        }
      }
      function flashPreviewChanges(diff) {
        if (!diff) return;
        safeArr(diff.added).forEach(function(k) {
          _pvFlash.add[String(k)] = 1;
        });
        safeArr(diff.updated).forEach(function(d) {
          if (d && d.comment != null) _pvFlash.upd[String(d.comment)] = 1;
        });
        _pvFlash.ts = Date.now();
        _applyPreviewFlash(); // DOM 若已含目标节点（未触发重建）也能立即生效
      }
      function _applyPreviewFlash() {
        try {
          if (!_pvFlash.ts || Date.now() - _pvFlash.ts > 5000) {
            _pvFlash = { add: {}, upd: {}, ts: 0 };
            return;
          }
          const body = doc.getElementById('previewBody');
          if (!body) return;
          const nodes = body.querySelectorAll('details.pv-entry[data-pv-comment]');
          for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            const key = el.getAttribute('data-pv-comment');
            const cls = _pvFlash.add[key] ? 'pv-flash-add' : (_pvFlash.upd[key] ? 'pv-flash-upd' : null);
            if (cls) {
              el.classList.remove('pv-flash-add', 'pv-flash-upd');
              // 强制重排以重启动画（同一节点可能被连续两次合并命中）
              void el.offsetWidth;
              el.classList.add(cls);
              setTimeout(function(node, c) {
                node.classList.remove(c);
              }.bind(null, el, cls), 3200);
            }
          }
          _pvFlash = { add: {}, upd: {}, ts: 0 };
        } catch (e) {
          logWarn('previewFlash', e);
        }
      }

      function renderPreview() {
        if (_renderPreviewTimer) clearTimeout(_renderPreviewTimer);
        _renderPreviewTimer = setTimeout(_renderPreviewImpl, CONFIG.PREVIEW_DEBOUNCE_MS);
      }

      function _renderPreviewImpl() {
        _renderPreviewTimer = null;
        const body = doc.getElementById('previewBody');
        if (!body) return;
        updateProgress();
        // ========== Tab 隔离：角色卡Tab 过滤 MVU 内容，MVU Tab 只显示 MVU 相关 ==========
        const __tab = (typeof window !== 'undefined' && typeof window.__getActiveTab === 'function') ? window.__getActiveTab() : (typeof activeTab !== 'undefined' ? activeTab : 'card');

        // 通用段落：完整显示内容（不再截断），支持折叠。icon 支持 emoji 字符串或 SVG 图标名
        // editKey(可选)：传入字段名时，内容区可双击编辑
        function sec(icon, title, content, rightInfo, editKey) {
          const has = content && (typeof content === 'string' ? content.trim().length > 0 : true);
          const dot = has ? 'full' : 'empty';
          const editAttr = editKey ? ' data-edit-type="field" data-edit-key="' + escHtml(editKey) + '"' : '';
          const editCls = editKey ? ' pv-editable' : '';
          const editHint = editKey ? '<span class="pv-edit-hint" title="双击编辑">✏️</span>' : '';
          const inner = has ?
            '<div class="pv-content' + editCls + '"' + editAttr + '>' + escHtml(typeof content === 'string' ? content : '') + '</div>' :
            '<div class="pv-empty' + editCls + '"' + editAttr + '>待生成...</div>';
          const rightHtml = rightInfo ? '<span class="sec-right">' + rightInfo + '</span>' : '';
          // icon 为 SVG 图标名（无 emoji 字符）时渲染内联 SVG
          const iconHtml = (/^[a-zA-Z]+$/.test(icon)) ? svgIcon(icon, 14) : icon;
          return '<div class="pv-section"><h3><span class="sec-left"><span class="dot ' + dot + '"></span>' + iconHtml + ' ' + title + '</span>' + rightHtml + editHint + '<span class="pv-toggle" title="折叠/展开"></span></h3>' + inner + '</div>';
        }

        let h = '';

        if (__tab === 'mvu') {
          // ========== MVU Tab 预览：状态栏总览(顶置) + 8步进度 + 变量结构脚本 + 变量条目 + 状态栏HTML源码 + 关联角色卡 ==========
          const allEntries = (cardData.character_book && cardData.character_book.entries) || [];
          const mvuEntries = allEntries.filter(function(e) {
            return isMVUEntry(e.comment || '');
          });
          const rxScripts = normalizeRegexScripts(cardData.extensions && cardData.extensions.regex_scripts);

          // ① 状态栏总览（顶置突出，含8步进度条 + 操作按钮）
          h += buildStatusBarPreviewSection();

          // ② MVU 8步进度详情（逐条展开说明）
          const _pvChk = checkMvu8Entries(cardData);
          const _pvD = _pvChk.done;
          const _pvSteps = [{
              has: _pvD[0],
              icon: 'code',
              name: '第1条 变量结构脚本',
              desc: 'zod 4 Schema + registerMvuSchema 注册（tavern_helper.scripts）'
            },
            {
              has: _pvD[1],
              icon: 'docVar',
              name: '第2条 [InitVar]初始变量',
              desc: 'YAML格式初始变量，依据第1条schema生成，enabled=false'
            },
            {
              has: _pvD[2],
              icon: 'list',
              name: '第3条 [mvu_update]更新规则',
              desc: '依据schema生成每变量路径的 type/range/format/check'
            },
            {
              has: _pvD[3],
              icon: 'list',
              name: '第4条 变量列表',
              desc: '固定内容：<status_current_variables>null</status_current_variables>'
            },
            {
              has: _pvD[4],
              icon: 'list',
              name: '第5条 [mvu_update]输出格式',
              desc: '固定YAML：<UpdateVariable>+<Analysis>+<JSONPatch>（5种操作）'
            },
            {
              has: _pvD[5],
              icon: 'list',
              name: '第6条 输出格式强调',
              desc: '固定YAML原样输出强调，AI不输出<UpdateVariable>时启用'
            },
            {
              has: _pvD[6],
              icon: 'sliders',
              name: '第7条 <状态栏>占位提醒',
              desc: '提醒AI每条回复底部输出 <StatusPlaceHolderImpl/>'
            },
            {
              has: _pvChk.has8,
              icon: 'table',
              name: '第8条 状态栏HTML',
              desc: '正则6 [美化]MVU状态栏（markdownOnly=true，前7条完成后才生成）'
            }
          ];
          const _pvDoneCnt = _pvChk.doneCount + (_pvChk.has8 ? 1 : 0);
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot ' + (_pvDoneCnt > 0 ? 'full' : 'empty') + '"></span>' + svgIcon('list', 14) + ' MVU 8步进度详情</span><span class="sec-right">' + _pvDoneCnt + '/8</span><span class="pv-toggle"></span></h3><div class="pv-sub">';
          _pvSteps.forEach(function(s) {
            const _tag = s.has ? '<span class="pv-tag ok">✓ 完成</span>' : '<span class="pv-tag off">待生成</span>';
            h += '<details class="pv-entry"><summary><span>' + svgIcon(s.icon, 12) + ' ' + s.name + '</span><span class="sec-right">' + _tag + '</span></summary><div class="pv-entry-body"><div class="pv-entry-content">' + s.desc + '</div></div></details>';
          });
          h += '</div></div>';

          // ③ 变量结构脚本 + MVU脚本（tavern_helper.scripts）
          const mvuScripts = (cardData.extensions && cardData.extensions.tavern_helper && cardData.extensions.tavern_helper.scripts) || [];
          if (mvuScripts.length > 0) {
            h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>' + svgIcon('code', 14) + ' 变量结构脚本</span><span class="sec-right">' + mvuScripts.length + '条</span><span class="pv-toggle"></span></h3><div class="pv-sub">';
            mvuScripts.forEach(function(s, idx) {
              const sName = s.name || ('脚本' + (idx + 1));
              const sTok = countTokens(s.content || '');
              const isSchema = (s.id === 'mvu-schema' || sName.indexOf('变量结构') >= 0 || (s.content || '').indexOf('mvu_zod') >= 0);
              const isBundle = (s.id === '961f366d-e403-45c2-8155-3d14ec86de53' || (s.content || '').indexOf('MagVarUpdate') >= 0 || (s.content || '').indexOf('bundle.js') >= 0);
              const isWTC = (s.id === 'wtc-lorebook-call' || (s.content || '').indexOf('LorebookToolCall') >= 0);
              const sTag = isSchema ? '<span class="pv-tag ok">变量结构</span>' : (isBundle ? '<span class="pv-tag">MVU本体</span>' : (isWTC ? '<span class="pv-tag">WTC</span>' : ''));
              const sDisabled = s.enabled === false ? '<span class="pv-tag off">禁用</span>' : '';
              h += '<details class="pv-entry"><summary><span>' + (idx + 1) + '. ' + escHtml(sName) + '</span><span class="sec-right">~' + sTok + 'T ' + sTag + sDisabled + '</span></summary>' +
                '<div class="pv-entry-body"><div class="pv-entry-content">' + escHtml(s.content || '') + '</div></div></details>';
            });
            h += '</div></div>';
          } else {
            h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>' + svgIcon('code', 14) + ' 变量结构脚本</span><span class="pv-toggle"></span></h3><div class="pv-empty">尚未生成脚本</div></div>';
          }

          // ④ MVU变量条目（世界书条目，过滤MVU相关）
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot ' + (mvuEntries.length > 0 ? 'full' : 'empty') + '"></span>' + svgIcon('book', 14) + ' MVU变量条目</span><span class="sec-right">' + mvuEntries.length + '条</span><span class="pv-toggle"></span></h3>';
          if (mvuEntries.length > 0) {
            h += '<div class="pv-entry-list">';
            mvuEntries.forEach(function(e, i) {
              const eTok = countTokens(e.content || '');
              const disabledTag = e.enabled === false ? '<span class="pv-tag off">禁用</span>' : '';
              h += '<details class="pv-entry" data-pv-comment="' + escHtml(e.comment || ('MVU条目' + (i + 1))) + '"><summary><span>' + escHtml(e.comment || ('MVU条目' + (i + 1))) + '</span><span class="sec-right">~' + eTok + 'T ' + disabledTag + '</span></summary>' +
                '<div class="pv-entry-body"><div class="pv-entry-content">' + escHtml(e.content || '') + '</div></div></details>';
            });
            h += '</div>';
          } else {
            h += '<div class="pv-empty">尚未生成MVU变量条目，请在聊天中描述你想要的变量系统</div>';
          }
          h += '</div>';

          // ⑤ 状态栏HTML源码（正则脚本，含状态栏美化正则）
          if (rxScripts.length > 0) {
            h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>' + svgIcon('table', 14) + ' 状态栏HTML源码（正则）</span><span class="sec-right">' + rxScripts.length + '条</span><span class="pv-toggle"></span></h3><div class="pv-sub">';
            rxScripts.forEach(function(r, idx) {
              const isStatusBar = (r.findRegex || '').indexOf('StatusPlaceHolder') >= 0;
              const flags = [];
              if (r.markdownOnly) flags.push('<span class="pv-tag">仅显示</span>');
              if (r.promptOnly) flags.push('<span class="pv-tag">仅提示词</span>');
              if (r.disabled) flags.push('<span class="pv-tag off">禁用</span>');
              if (isStatusBar) flags.push('<span class="pv-tag ok">美化状态栏</span>');
              h += '<details class="pv-entry"><summary><span>' + (idx + 1) + '. ' + escHtml(r.scriptName || '正则脚本') + '</span><span class="sec-right">' + flags.join('') + '</span></summary>';
              h += '<div class="pv-entry-body">';
              h += '<div class="pv-code">查找：<code>' + escHtml(r.findRegex || '') + '</code></div>';
              const rep = r.replaceString || '';
              if (rep) {
                const repDisplay = rep.length > 1200 ? rep.substring(0, 1200) + '\n…（共' + rep.length + '字符，已截断）' : rep;
                h += '<div class="pv-code" style="margin-top:3px">替换：\n' + escHtml(repDisplay) + '</div>';
              }
              h += '</div></details>';
            });
            h += '</div></div>';
          } else {
            h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>' + svgIcon('table', 14) + ' 状态栏HTML源码（正则）</span><span class="pv-toggle"></span></h3><div class="pv-empty">尚未生成正则脚本</div></div>';
          }

          // ⑥ 关联角色卡信息（只读，紧凑）
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot ' + (cardData.name ? 'full' : 'empty') + '"></span>' + svgIcon('mask', 14) + ' 关联角色卡</span><span class="pv-toggle"></span></h3><div class="pv-content">' + escHtml(cardData.name || '(未命名)') + (cardData.description ? ' · 描述' + cardData.description.length + '字' : '') + '</div></div>';

          body.innerHTML = h;
          bindPreviewInteractions();
          return;
        }

        // ========== 角色卡 Tab 预览：过滤掉 MVU 内容 ==========

        h += sec('globe', '世界名称', cardData.name, '', 'name');
        h += sec('scroll', '世界观描述', cardData.description, cardData.description ? (cardData.description.length + '字') : '', 'description');
        h += sec('sparkle', '性格总结', cardData.personality, cardData.personality ? (cardData.personality.length + '字') : '', 'personality');
        h += sec('target', '场景', cardData.scenario, cardData.scenario ? (cardData.scenario.length + '字') : '', 'scenario');

        // 世界书条目状态（独立 pv-section，角色卡Tab：不含MVU条目）
        const mp = getModuleProgress();
        const modLabels = {
          total: {
            ic: 'book',
            txt: '条目'
          },
          constant: {
            ic: 'lock',
            txt: '常驻'
          },
          triggered: {
            ic: 'bolt',
            txt: '触发'
          },
          grouped: {
            ic: 'layers',
            txt: '分组'
          },
          has_key: {
            ic: 'key',
            txt: '触发词'
          },
          has_content: {
            ic: 'document',
            txt: '内容'
          }
        };
        let modDone = 0,
          modTotal = Object.keys(modLabels).length;
        let modH = '<div class="module-progress">';
        Object.keys(modLabels).forEach(function(k) {
          const cls = mp[k] ? 'done' : 'todo';
          if (mp[k]) modDone++;
          modH += '<div class="module-item ' + cls + '" data-mod="' + k + '" title="' + modLabels[k].txt + '">' + svgIcon(modLabels[k].ic, 11) + ' ' + modLabels[k].txt + '</div>';
        });
        modH += '</div>';
        h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot ' + (modDone > 0 ? 'full' : 'empty') + '"></span>' + svgIcon('layers', 14) + ' 世界书条目状态</span><span class="sec-right">' + modDone + '/' + modTotal + ' 达标</span><span class="pv-toggle" title="折叠/展开"></span></h3>' + modH + '</div>';

        const allEntries = (cardData.character_book && cardData.character_book.entries) || [];
        // 角色卡Tab：过滤掉 MVU 条目
        const entries = allEntries.filter(function(e) {
          return !isMVUEntry(e.comment || '');
        });
        const bookName = (cardData.name ? cardData.name + ' · 世界设定集' : '世界设定集');
        let bookTokCount = 0;
        entries.forEach(function(e) {
          bookTokCount += countTokens(e.content || '');
        });

        // 世界书条目：搜索/筛选 + 批量操作工具条，每个条目独立折叠（默认折叠）
        if (entries.length > 0) {
          // —— 收集分组（e.extensions.group）——
          const groupSet = {};
          entries.forEach(function(e) {
            const g = (e.extensions && e.extensions.group) || '';
            if (g) groupSet[g] = 1;
          });
          const groupNames = Object.keys(groupSet).sort();
          const optSel = function(v) {
            return _pvFilter.group === v ? ' selected' : '';
          };
          const kindSel = function(v) {
            return _pvFilter.kind === v ? ' selected' : '';
          };
          // —— 工具条 ——
          let barH = '<div class="pv-filter-bar">';
          barH += '<input type="search" class="pv-f-search" placeholder="搜索条目名 / 内容…" value="' + escHtml(_pvFilter.q) + '" aria-label="搜索世界书条目">';
          barH += '<select class="pv-f-kind" aria-label="按启用方式筛选"><option value="all"' + kindSel('all') + '>全部</option><option value="constant"' + kindSel('constant') + '>常驻</option><option value="triggered"' + kindSel('triggered') + '>关键词触发</option><option value="off"' + kindSel('off') + '>已禁用</option></select>';
          barH += '<select class="pv-f-group" aria-label="按分组筛选"' + (groupNames.length ? '' : ' disabled') + '><option value="">全部分组</option>';
          groupNames.forEach(function(g) {
            barH += '<option value="' + escHtml(g) + '"' + optSel(g) + '>' + escHtml(g) + '</option>';
          });
          barH += '</select>';
          barH += '<button type="button" class="pv-f-batch' + (_pvFilter.batch ? ' on' : '') + '" data-pv-batch-toggle title="进入批量选择模式，可批量启用/禁用/删除/改分组">' + (_pvFilter.batch ? '退出批量' : '批量操作') + '</button>';
          barH += '</div>';
          // —— 批量操作条 ——
          if (_pvFilter.batch) {
            const selCount = Object.keys(_pvFilter.selected).length;
            barH += '<div class="pv-batch-bar">';
            barH += '<label class="pv-batch-all"><input type="checkbox" data-pv-check-all' + (selCount > 0 ? ' checked' : '') + '> 全选当前结果</label>';
            barH += '<button type="button" data-pv-batch-act="enable">启用</button>';
            barH += '<button type="button" data-pv-batch-act="disable">禁用</button>';
            barH += '<select data-pv-batch-group aria-label="批量修改分组"><option value="">改分组…</option><option value="__none__">（移出分组）</option>';
            groupNames.forEach(function(g) {
              barH += '<option value="' + escHtml(g) + '">' + escHtml(g) + '</option>';
            });
            barH += '</select>';
            barH += '<button type="button" class="danger" data-pv-batch-act="delete">删除</button>';
            barH += '<span class="pv-batch-count">已选 <b data-pv-sel-count>' + selCount + '</b> 条</span>';
            barH += '</div>';
          }
          // —— 过滤 ——
          const fq = _pvFilter.q.trim().toLowerCase();
          const fk = _pvFilter.kind;
          const fg = _pvFilter.group;
          const shown = entries.filter(function(e) {
            if (fk === 'constant' && !e.constant) return false;
            if (fk === 'triggered' && (e.constant || e.enabled === false)) return false;
            if (fk === 'off' && e.enabled !== false) return false;
            const g = (e.extensions && e.extensions.group) || '';
            if (fg && g !== fg) return false;
            if (fq) {
              const hay = ((e.comment || '') + '\n' + (e.content || '')).toLowerCase();
              if (hay.indexOf(fq) < 0) return false;
            }
            return true;
          });
          let eH = barH + '<div class="pv-entry-list">';
          if (!shown.length) {
            eH += '<div class="pv-empty">没有匹配的条目</div>';
          }
          for (let i = 0; i < shown.length; i++) {
            const e = shown[i];
            const label = e.comment || ('条目' + (i + 1));
            const eTok = countTokens(e.content || '');
            const constTag = e.constant ? '<span class="pv-tag ok">常驻</span>' : '<span class="pv-tag">触发</span>';
            const posTag = '<span class="pv-tag">P' + (e.position == null ? '-' : e.position) + '</span>';
            const depTag = (e.depth != null) ? '<span class="pv-tag">D' + e.depth + '</span>' : '';
            const disabledTag = e.enabled === false ? '<span class="pv-tag off">禁用</span>' : '';
            const grp = (e.extensions && e.extensions.group) || '';
            const grpTag = grp ? '<span class="pv-tag grp">' + escHtml(grp) + '</span>' : '';
            const checkBox = _pvFilter.batch ?
              ('<input type="checkbox" class="pv-batch-check" data-pv-check-comment="' + escHtml(label) + '" title="选择该条目"' + (_pvFilter.selected[label] ? ' checked' : '') + '>') : '';
            eH += '<details class="pv-entry' + (_pvFilter.selected[label] ? ' selected' : '') + '" data-pv-comment="' + escHtml(label) + '"><summary>' +
              checkBox +
              '<span class="pv-entry-summary-main">' + escHtml(label) + '</span>' +
              '<span class="pv-entry-summary-tags">' +
              '<span class="sec-right" style="margin-right:0">~' + eTok + 'T ' + constTag + posTag + depTag + grpTag + disabledTag + '</span>' +
              '<button type="button" class="pv-entry-del" data-pv-entry-del data-entry-comment="' + escHtml(label) + '" title="删除该条目">🗑</button>' +
              '</span>' +
              '</summary>' +
              '<div class="pv-entry-body"><div class="pv-entry-content pv-editable" data-edit-type="entry" data-edit-index="' + allEntries.indexOf(e) + '">' + escHtml(e.content || '') + '</div></div></details>';
          }
          eH += '</div>';
          const countTxt = shown.length === entries.length ?
            (entries.length + '条 · ~' + bookTokCount + 'T') :
            ('匹配 ' + shown.length + '/' + entries.length + '条 · ~' + bookTokCount + 'T');
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>' + svgIcon('book', 14) + ' <span class="pv-book-name">' + escHtml(bookName) + '</span></span><span class="sec-right">' + countTxt + '</span><span class="pv-toggle" title="折叠/展开"></span></h3>' + eH + '</div>';
        } else {
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>' + svgIcon('book', 14) + ' <span class="pv-book-name">' + escHtml(bookName) + '</span></span><span class="pv-toggle"></span></h3><div class="pv-empty">待生成...</div></div>';
        }

        h += sec('film', '开场白', cardData.first_mes, cardData.first_mes ? (cardData.first_mes.length + '字') : '', 'first_mes');
        h += sec('chat', '对话示例', cardData.mes_example, cardData.mes_example ? (cardData.mes_example.length + '字') : '', 'mes_example');
        // 身份定位（自动提取：personality+description 前 50 字）
        let autoIdExtract = '';
        if (cardData.personality || cardData.description) {
          const rawId = (cardData.personality ? (cardData.personality + ' ') : '') + (cardData.description || '');
          autoIdExtract = rawId.substring(0, 50) + (rawId.length > 50 ? '...' : '');
        }
        const idLen = autoIdExtract.length;
        h += sec('bolt', '身份定位（自动提取）', autoIdExtract || '(从 personality/description 自动生成，无需手动写 system_prompt)', idLen > 0 ? ('~' + idLen + '字 · 自动提取') : '');
        // 多开局机制：模板结构 = first_mes(开场白1) + alternate_greetings(开场白2/3以此类推)
        const altGreetings = Array.isArray(cardData.alternate_greetings) ? cardData.alternate_greetings : [];
        const altGreetCount = altGreetings.filter(function(g) {
          return typeof g === 'string' && g.trim().length > 0;
        }).length;
        const hasFirstMes = !!(cardData.first_mes && cardData.first_mes.trim().length > 0);
        const multiDesc = '开场白1(first_mes): ' + (hasFirstMes ? '✅' : '未生成') + ' | 备选开场白(alternate_greetings): ' + altGreetCount + ' 条';
        const multiContent = (hasFirstMes && altGreetCount >= 1) ?
          ('已配置多开局：' + multiDesc) :
          '尚未配置多开局。开场白1用 first_mes，开场白2/3以此类推用 alternate_greetings（::: set alternate_greetings，多条用---分割）。';
        const multiRight = ((hasFirstMes && altGreetCount >= 1) ? '✅ ' : '⚠️ ') + (hasFirstMes ? '1开场' : '0') + '+' + altGreetCount + '备选';
        h += sec('refreshCycle', '多开局机制（开场白1/2/3以此类推）', multiContent, multiRight);

        h += sec('edit', '创作者备注', cardData.creator_notes, '', 'creator_notes');

        // ===== 脚本（tavern_helper.scripts）：变量结构/MVU/WTC等，可折叠显示 =====
        const cardScripts = (cardData.extensions && cardData.extensions.tavern_helper && cardData.extensions.tavern_helper.scripts) || [];
        if (cardScripts.length > 0) {
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>' + svgIcon('code', 14) + ' 脚本</span><span class="sec-right">' + cardScripts.length + '条</span><span class="pv-toggle"></span></h3><div class="pv-sub">';
          cardScripts.forEach(function(s, idx) {
            const sName = s.name || ('脚本' + (idx + 1));
            const sTok = countTokens(s.content || '');
            const isSchema = (s.id === 'mvu-schema' || sName.indexOf('变量结构') >= 0 || (s.content || '').indexOf('mvu_zod') >= 0);
            const isBundle = (s.id === '961f366d-e403-45c2-8155-3d14ec86de53' || (s.content || '').indexOf('MagVarUpdate') >= 0);
            const isWTC = (s.id === 'wtc-lorebook-call' || (s.content || '').indexOf('LorebookToolCall') >= 0);
            const sTag = isSchema ? '<span class="pv-tag ok">变量结构</span>' : (isBundle ? '<span class="pv-tag">MVU本体</span>' : (isWTC ? '<span class="pv-tag">WTC</span>' : ''));
            const sDisabled = s.enabled === false ? '<span class="pv-tag off">禁用</span>' : '';
            h += '<details class="pv-entry"><summary><span>' + (idx + 1) + '. ' + escHtml(sName) + '</span><span class="sec-right">~' + sTok + 'T ' + sTag + sDisabled + '</span></summary>' +
              '<div class="pv-entry-body"><div class="pv-entry-content">' + escHtml(s.content || '') + '</div></div></details>';
          });
          h += '</div></div>';
        }

        // ===== 正则脚本：可折叠显示 =====
        const cardRxScripts = normalizeRegexScripts(cardData.extensions && cardData.extensions.regex_scripts);
        if (cardRxScripts.length > 0) {
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>' + svgIcon('table', 14) + ' 正则脚本</span><span class="sec-right">' + cardRxScripts.length + '条</span><span class="pv-toggle"></span></h3><div class="pv-sub">';
          cardRxScripts.forEach(function(r, idx) {
            const flags = [];
            if (r.markdownOnly) flags.push('<span class="pv-tag">仅显示</span>');
            if (r.promptOnly) flags.push('<span class="pv-tag">仅提示词</span>');
            if (r.disabled) flags.push('<span class="pv-tag off">禁用</span>');
            h += '<details class="pv-entry"><summary><span>' + (idx + 1) + '. ' + escHtml(r.scriptName || '正则脚本') + '</span><span class="sec-right">' + flags.join('') + '</span></summary>';
            h += '<div class="pv-entry-body">';
            h += '<div class="pv-code">查找：<code>' + escHtml(r.findRegex || '') + '</code></div>';
            const rep = r.replaceString || '';
            if (rep) {
              const repDisplay = rep.length > 1200 ? rep.substring(0, 1200) + '\n…（共' + rep.length + '字符，已截断）' : rep;
              h += '<div class="pv-code" style="margin-top:3px">替换：\n' + escHtml(repDisplay) + '</div>';
            }
            h += '</div></details>';
          });
          h += '</div></div>';
        }

        body.innerHTML = h;
        // 绑定折叠/按钮事件（每次重渲染后重新绑定）
        bindPreviewInteractions();
        // 合并 diff 闪光（DOM 重建后消费本次变更记录）
        _applyPreviewFlash();
      }

      // 状态栏预览区块：展示生成状态 + 已收集模块 + 预览/重置按钮
      function buildStatusBarPreviewSection() {
        const entries = (cardData.character_book || {}).entries || [];
        const hasMVU = entries.some(function(e) {
          return isMVUEntry(e.comment || '');
        });
        const rxScripts = normalizeRegexScripts(cardData.extensions && cardData.extensions.regex_scripts);
        let statusBarRegex = null;
        for (let i = 0; i < rxScripts.length; i++) {
          const r = rxScripts[i];
          if ((r.findRegex || '').indexOf('StatusPlaceHolder') >= 0 && r.markdownOnly && !r.promptOnly) {
            statusBarRegex = r;
            break;
          }
        }
        const hasStatusBar = !!statusBarRegex;
        const mvuChk = checkMvu8Entries(cardData);
        const _d = mvuChk.done;

        const dotCls = hasStatusBar ? 'full' : 'empty';
        const right = hasStatusBar ? '已生成' : (mvuChk.all7Done ? '待生成' : (hasMVU ? mvuChk.doneCount + '/7' : '未启用'));
        let sH = '<div class="pv-sub">';

        // ===== 8步进度可视化条（紧凑方块，绿=完成/灰=待办）=====
        const _stepNames = ['①zod变量结构', '②[InitVar]初始变量', '③[mvu_update]更新规则', '④变量列表', '⑤[mvu_update]输出格式', '⑥输出格式强调', '⑦<状态栏>占位提醒', '⑧状态栏HTML(正则6)'];
        const _stepStates = [_d[0], _d[1], _d[2], _d[3], _d[4], _d[5], _d[6], mvuChk.has8];
        const _stepShort = ['1', '2', '3', '4', '5', '6', '7', '栏'];
        sH += '<div style="display:flex;gap:5px;flex-wrap:wrap;margin:5px 0 10px 0">';
        for (let si = 0; si < 8; si++) {
          const _done = _stepStates[si];
          const _cls = _done ? 'sb-step ok' : 'sb-step todo';
          const _ic = _done ? svgIcon('checkCircle', 11) : svgIcon('circle', 11);
          sH += '<span class="' + _cls + '" title="' + _stepNames[si] + '">' + _ic + _stepShort[si] + '</span>';
        }
        sH += '</div>';

        // ===== 变量系统 + 状态栏HTML 双状态行 =====
        sH += '<details class="pv-entry"' + (hasMVU ? '' : ' open') + '><summary><span>变量系统</span><span class="sec-right">' + (hasMVU ? '<span class="pv-tag ok">已启用</span> ' + mvuChk.doneCount + '/7' : '<span class="pv-tag off">未启用</span>') + '</span></summary><div class="pv-entry-body"><div class="pv-entry-content">' + (hasMVU ? 'MVU变量系统已检测到。<br>导出时自动注入：bundle.js(MVU本体)、正则1-5(思维链移除/变量更新截断/状态栏隐藏等)。<br>状态栏HTML需前7条完成后生成。' : '未检测到MVU变量系统。请先在MVU Tab生成变量系统。') + '</div></div></details>';

        if (hasStatusBar) {
          const repLen = (statusBarRegex.replaceString || '').length;
          sH += '<details class="pv-entry" open><summary><span>状态栏HTML（正则6）</span><span class="sec-right">' + repLen + ' 字符</span></summary>';
          sH += '<div class="pv-entry-body"><div style="margin:2px 0"><span class="pv-tag ok">已生成</span><span class="pv-tag">仅显示</span></div>';
          sH += '<div class="pv-entry-content">findRegex: ' + escHtml(statusBarRegex.findRegex || '') + '</div></div></details>';
        } else if (mvuChk.all7Done) {
          sH += '<details class="pv-entry" open><summary><span>状态栏HTML（正则6）</span><span class="sec-right"><span class="pv-tag off">未生成</span></span></summary>';
          sH += '<div class="pv-entry-body"><div class="pv-entry-content">前7条已完成，点击「生成状态栏」让AI生成HTML。</div></div></details>';
        } else {
          sH += '<details class="pv-entry" open><summary><span>状态栏HTML（正则6）</span><span class="sec-right"><span class="pv-tag off">未生成</span></span></summary>';
          sH += '<div class="pv-entry-body"><div class="pv-entry-content">需先完成前7条MVU条目（当前' + mvuChk.doneCount + '/7）。</div></div></details>';
        }

        // ===== 操作按钮（阶段自适应）=====
        sH += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">';
        if (hasStatusBar) {
          sH += '<button class="pv-mini-btn" data-pv-action="preview-statusbar">' + svgIcon('eye', 13) + ' 预览状态栏</button>';
          sH += '<button class="pv-mini-btn" data-pv-action="reset-statusbar">' + svgIcon('trash', 13) + ' 清除状态栏</button>';
        }
        if (mvuChk.all7Done) {
          sH += '<button class="pv-mini-btn" data-pv-action="gen-statusbar">' + svgIcon('sparkle', 13) + ' ' + (hasStatusBar ? '重新生成' : '生成状态栏') + '</button>';
        }
        sH += '</div>';

        sH += '</div>';
        return '<div class="pv-section"><h3><span class="sec-left"><span class="dot ' + dotCls + '"></span>' + svgIcon('sliders', 14) + ' 状态栏总览</span><span class="sec-right">' + right + '</span><span class="pv-toggle"></span></h3>' + sH + '</div>';
      }

      // 预览面板交互绑定：段落折叠 + 状态栏按钮
      function bindPreviewInteractions() {
        const body = doc.getElementById('previewBody');
        if (!body) return;
        // 段落折叠（点击 h3 标题区或 pv-toggle）
        const toggles = body.querySelectorAll('.pv-toggle');
        for (let i = 0; i < toggles.length; i++) {
          toggles[i].addEventListener('click', function(e) {
            e.stopPropagation();
            const section = this.closest('.pv-section');
            if (section) section.classList.toggle('collapsed');
          });
        }
        // 标题点击也可折叠（除按钮/链接/details外）
        const heads = body.querySelectorAll('.pv-section > h3');
        for (let j = 0; j < heads.length; j++) {
          heads[j].addEventListener('click', function(e) {
            if (e.target.closest('.pv-mini-btn') || e.target.closest('.pv-book-name') || e.target.closest('.pv-toggle') || e.target.closest('.module-item') || e.target.closest('.pv-entry') || e.target.closest('details') || e.target.closest('summary')) return;
            const section = this.closest('.pv-section');
            if (section) section.classList.toggle('collapsed');
          });
        }
        // 模块进度项点击：提示世界书条目现状（不再绑定AI完善指令）
        const modItems = body.querySelectorAll('.module-item[data-mod]');
        for (let mi = 0; mi < modItems.length; mi++) {
          modItems[mi].addEventListener('click', function(e) {
            e.stopPropagation();
            // 无操作：仅展示状态（提示用户可直接对话生成条目）
          });
        }
        // 状态栏按钮
        const btns = body.querySelectorAll('.pv-mini-btn[data-pv-action]');
        for (let k = 0; k < btns.length; k++) {
          btns[k].addEventListener('click', function() {
            const act = this.getAttribute('data-pv-action');
            if (act === 'preview-statusbar') {
              showMvuStatusBarPreview();
            } else if (act === 'gen-statusbar') {
              const input = doc.getElementById('chatInput');
              if (input) {
                input.value = '请根据已配置的MVU变量系统，生成状态栏HTML。输出一个完整的HTML文档（含CSS和JS），使用 populateCharacterData + getAllVariables + eventOn(Mvu.events.VARIABLE_UPDATE_ENDED) + errorCatched 标准模式。';
                updateCharCount();
                updateSendBtnPulse();
                try {
                  input.focus();
                } catch (_) {}
              }
            } else if (act === 'reset-statusbar') {
              if (!confirm('确定清除已生成的美化状态栏正则（正则6）吗？')) return;
              cardData.extensions = cardData.extensions || {};
              const rx = cardData.extensions.regex_scripts || [];
              for (let m = rx.length - 1; m >= 0; m--) {
                if ((rx[m].findRegex || '').indexOf('StatusPlaceHolder') >= 0 && rx[m].markdownOnly && !rx[m].promptOnly) {
                  rx.splice(m, 1);
                }
              }
              cardData.extensions.regex_scripts = rx;
              saveToStorage();
              renderPreview();
              showToast('✅ 已清除状态栏正则', 'success');
            }
          });
        }
        // ========== 双击编辑：预览内容区双击弹出编辑窗口 ==========
        const editables = body.querySelectorAll('[data-edit-type]');
        for (let ei = 0; ei < editables.length; ei++) {
          editables[ei].style.cursor = 'pointer';
          editables[ei].addEventListener('dblclick', function(e) {
            e.stopPropagation();
            // ⚠️竞态修复：生成期间用户编辑与 AI 回写并发，AI 的 upsert 可能复活刚删的条目/覆盖编辑内容
            if (isGenerating) {
              showToast('AI正在生成中，请等待完成后再编辑', 'warning');
              return;
            }
            const type = this.getAttribute('data-edit-type');
            const key = this.getAttribute('data-edit-key');
            const index = this.getAttribute('data-edit-index');
            showPreviewEditModal(type, key, index);
          });
        }
        // ========== 预览面板条目折叠头：悬浮删除按钮一键删（不用进编辑弹窗）==========
        const pvDels = body.querySelectorAll('button.pv-entry-del[data-pv-entry-del]');
        for (let pdi = 0; pdi < pvDels.length; pdi++) {
          pvDels[pdi].addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            // ⚠️竞态修复：生成期间禁删（避免与 AI upsert 并发导致刚删条目被复活）
            if (isGenerating) {
              showToast('AI正在生成中，请等待完成后再删除条目', 'warning');
              return;
            }
            const rawIdx = this.getAttribute('data-entry-idx');
            const comment = this.getAttribute('data-entry-comment');
            const allEntries = (cardData.character_book || {}).entries || [];
            let idx = -1;
            if (comment != null) {
              // 筛选视图下索引会漂移，优先按 comment 精确定位
              for (let fi2 = 0; fi2 < allEntries.length; fi2++) {
                if ((allEntries[fi2].comment || '') === comment) {
                  idx = fi2;
                  break;
                }
              }
            } else {
              idx = parseInt(rawIdx);
            }
            if (isNaN(idx) || idx < 0) {
              showToast('⚠️ 无法确定要删除的条目', 'warning');
              return;
            }
            const en = allEntries[idx];
            if (!en) {
              showToast('⚠️ 未找到该条目，可能已被删除', 'warning');
              return;
            }
            const name = en.comment || ('条目' + (idx + 1));
            if (!window.confirm('确认删除该条目吗？\n\n条目：' + name + '\n（此操作无法撤回，误删可用头像菜单→撤回AI修改恢复快照）')) return;
            // 这里用 allEntries 里的真实引用直接 splice 掉
            allEntries.splice(idx, 1);
            delete _pvFilter.selected[name];
            updateProgress();
            renderPreview();
            saveToStorage();
            showToast('🗑️ 已删除条目：' + name, 'success');
          });
        }
        // ========== 世界书：搜索/筛选/批量操作（每次重建后重绑，状态存于 _pvFilter）==========
        const fSearch = body.querySelector('.pv-f-search');
        if (fSearch) {
          fSearch.addEventListener('focus', function() {
            _pvSearchHadFocus = true;
          });
          fSearch.addEventListener('blur', function() {
            _pvSearchHadFocus = false;
          });
          fSearch.addEventListener('input', function() {
            _pvFilter.q = this.value;
            renderPreview();
            _pvSearchHadFocus = true; // 重建后恢复焦点
          });
          if (_pvSearchHadFocus) {
            try {
              fSearch.focus();
              const vlen = fSearch.value.length;
              fSearch.setSelectionRange(vlen, vlen);
            } catch (_) {}
          }
        }
        const fKind = body.querySelector('.pv-f-kind');
        if (fKind) {
          fKind.addEventListener('change', function() {
            _pvFilter.kind = this.value;
            renderPreview();
          });
        }
        const fGroup = body.querySelector('.pv-f-group');
        if (fGroup) {
          fGroup.addEventListener('change', function() {
            _pvFilter.group = this.value;
            renderPreview();
          });
        }
        const batchToggle = body.querySelector('[data-pv-batch-toggle]');
        if (batchToggle) {
          batchToggle.addEventListener('click', function() {
            _pvFilter.batch = !_pvFilter.batch;
            if (!_pvFilter.batch) _pvFilter.selected = {};
            renderPreview();
          });
        }
        // 条目勾选（checkbox 在 summary 内，必须阻止冒泡否则会折叠 details）
        const batchChecks = body.querySelectorAll('.pv-batch-check[data-pv-check-comment]');
        for (let bci = 0; bci < batchChecks.length; bci++) {
          batchChecks[bci].addEventListener('click', function(ev) {
            ev.stopPropagation();
          });
          batchChecks[bci].addEventListener('change', function() {
            const c = this.getAttribute('data-pv-check-comment');
            if (this.checked) _pvFilter.selected[c] = 1;
            else delete _pvFilter.selected[c];
            const de = this.closest('.pv-entry');
            if (de) de.classList.toggle('selected', !!this.checked);
            const cntEl = body.querySelector('[data-pv-sel-count]');
            if (cntEl) cntEl.textContent = String(Object.keys(_pvFilter.selected).length);
          });
        }
        // 全选当前过滤结果
        const checkAll = body.querySelector('[data-pv-check-all]');
        if (checkAll) {
          checkAll.addEventListener('click', function(ev) {
            ev.stopPropagation();
          });
          checkAll.addEventListener('change', function() {
            const checks = body.querySelectorAll('.pv-batch-check[data-pv-check-comment]');
            for (let cai = 0; cai < checks.length; cai++) {
              checks[cai].checked = this.checked;
              const c = checks[cai].getAttribute('data-pv-check-comment');
              if (this.checked) _pvFilter.selected[c] = 1;
              else delete _pvFilter.selected[c];
              const de = checks[cai].closest('.pv-entry');
              if (de) de.classList.toggle('selected', this.checked);
            }
            const cntEl = body.querySelector('[data-pv-sel-count]');
            if (cntEl) cntEl.textContent = String(Object.keys(_pvFilter.selected).length);
          });
        }
        // 批量动作：启用/禁用/删除/改分组（按 comment 命中，MVU 条目不受角色卡批量操作影响）
        const batchActs = body.querySelectorAll('[data-pv-batch-act]');
        const runBatch = function(act) {
          if (isGenerating) {
            showToast('AI正在生成中，请等待完成后再批量操作', 'warning');
            return;
          }
          const allEnt = (cardData.character_book || {}).entries || [];
          const targets = allEnt.filter(function(en) {
            return !isMVUEntry(en.comment || '') && _pvFilter.selected[en.comment || ''];
          });
          if (!targets.length) {
            showToast('请先勾选要操作的条目', 'warning');
            return;
          }
          if (act === 'delete') {
            if (!window.confirm('确认删除勾选的 ' + targets.length + ' 个条目吗？\n（此操作无法撤回，误删可用头像菜单→撤回AI修改恢复快照）')) return;
          }
          let changed = 0;
          for (let tai = targets.length - 1; tai >= 0; tai--) {
            const t = targets[tai];
            if (act === 'enable') {
              if (t.enabled === false) {
                t.enabled = true;
                changed++;
              }
            } else if (act === 'disable') {
              if (t.enabled !== false) {
                t.enabled = false;
                changed++;
              }
            } else if (act === 'delete') {
              const di = allEnt.indexOf(t);
              if (di >= 0) {
                allEnt.splice(di, 1);
                delete _pvFilter.selected[t.comment || ''];
                changed++;
              }
            }
          }
          if (changed > 0 || act !== 'delete') {
            updateProgress();
            saveToStorage();
            renderPreview();
            const verb = act === 'enable' ? '启用' : (act === 'disable' ? '禁用' : '删除');
            if (changed === 0 && act !== 'delete') {
              showToast('选中的条目已全部是该状态，无需变更', 'info');
            } else {
              showToast('已批量' + verb + ' ' + (act === 'enable' || act === 'disable' ? changed : targets.length) + ' 个条目', 'success');
            }
          }
        };
        for (let bai = 0; bai < batchActs.length; bai++) {
          batchActs[bai].addEventListener('click', function(ev) {
            ev.stopPropagation();
            runBatch(this.getAttribute('data-pv-batch-act'));
          });
        }
        const batchGroupSel = body.querySelector('[data-pv-batch-group]');
        if (batchGroupSel) {
          batchGroupSel.addEventListener('change', function() {
            const val = this.value;
            this.value = '';
            if (!val) return;
            if (isGenerating) {
              showToast('AI正在生成中，请等待完成后再改分组', 'warning');
              return;
            }
            const allEnt = (cardData.character_book || {}).entries || [];
            let changed = 0;
            allEnt.forEach(function(en) {
              if (!isMVUEntry(en.comment || '') && _pvFilter.selected[en.comment || '']) {
                en.extensions = en.extensions || {};
                if (val === '__none__') delete en.extensions.group;
                else en.extensions.group = val;
                changed++;
              }
            });
            if (changed > 0) {
              saveToStorage();
              renderPreview();
              showToast('已将 ' + changed + ' 个条目' + (val === '__none__' ? '移出分组' : ('移入分组「' + val + '」')), 'success');
            } else {
              showToast('请先勾选要操作的条目', 'warning');
            }
          });
        }
      }

      // ===== 预览双击编辑弹窗 =====
      function showPreviewEditModal(type, key, index) {
        // 读取当前值
        let currentVal = '';
        let title = '';
        if (type === 'field') {
          currentVal = cardData[key] != null ? String(cardData[key]) : '';
          title = '编辑字段：' + key;
        } else if (type === 'entry') {
          const idx = parseInt(index);
          const entries = (cardData.character_book || {}).entries || [];
          const entry = entries[idx];
          if (!entry) return;
          currentVal = entry.content || '';
          title = '编辑条目：' + (entry.comment || ('条目' + (idx + 1)));
        } else {
          return;
        }
        // 创建弹窗
        const overlay = doc.createElement('div');
        overlay.className = 'json-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:10001;padding:16px';
        const modal = doc.createElement('div');
        modal.style.cssText = 'background:var(--surface);border-radius:var(--radius);box-shadow:0 20px 60px rgba(15,23,42,.2);width:100%;max-width:600px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden';
        const header = doc.createElement('div');
        header.style.cssText = 'padding:14px 18px;border-bottom:1px solid var(--line-soft);display:flex;align-items:center;justify-content:space-between;gap:10px';
        header.innerHTML = '<span style="font-weight:600;color:var(--accent-deep);font-size:.95em">' + escHtml(title) + '</span>';
        const closeBtn = doc.createElement('button');
        closeBtn.className = 'icon-btn icon-btn-square';
        closeBtn.innerHTML = svgIcon('close', 16);
        closeBtn.onclick = function() {
          overlay.remove();
        };
        header.appendChild(closeBtn);
        const textareaWrap = doc.createElement('div');
        textareaWrap.style.cssText = 'flex:1;overflow:auto;padding:14px 18px';
        const textarea = doc.createElement('textarea');
        textarea.style.cssText = 'width:100%;min-height:200px;padding:12px 14px;border:1px solid var(--line);border-radius:var(--radius);font-size:14px;font-family:inherit;line-height:1.6;resize:vertical;color:var(--ink);background:var(--surface-soft)';
        textarea.value = currentVal;
        textareaWrap.appendChild(textarea);
        const footer = doc.createElement('div');
        footer.style.cssText = 'padding:10px 18px;border-top:1px solid var(--line-soft);display:flex;justify-content:space-between;align-items:center;gap:8px';
        const footerLeft = doc.createElement('div');
        footerLeft.style.cssText = 'display:flex;align-items:center;gap:8px';
        // 删除按钮：给 entry / 顶层 field / 数组 field 三种情况用（用户反馈"AI删不掉时预览里没法手动删"）
        let canDelete = false;
        if (type === 'entry') canDelete = true;
        else if (type === 'field') {
          const idxNum = parseInt(index);
          if (index != null && !isNaN(idxNum) && Array.isArray(cardData[key])) canDelete = true;
          else canDelete = true; // 顶层字段也允许一键清空（删除按钮文案写"清空"而不是删除）
        }
        if (canDelete) {
          const delBtn = doc.createElement('button');
          delBtn.className = 'btn';
          delBtn.style.cssText = 'background:var(--terra-soft);color:var(--terra-text);border:1px solid transparent;display:inline-flex;align-items:center;gap:6px';
          delBtn.innerHTML = svgIcon('trash', 14) + (type === 'field' && (index == null || isNaN(parseInt(index))) ? ' 清空字段' : ' 删除');
          delBtn.onclick = function() {
            let what = '';
            if (type === 'entry') {
              const idxE = parseInt(index);
              const en = (((cardData.character_book || {}).entries || [])[idxE] || {}).comment || ('条目' + (idxE + 1));
              what = '条目「' + en + '」';
              if (!window.confirm('确认删除该条目吗？\n\n条目：' + en + '\n（此操作无法撤回，误删可用头像菜单→撤回AI修改恢复快照）')) return;
              const es = (cardData.character_book || {}).entries || [];
              if (idxE >= 0 && idxE < es.length) es.splice(idxE, 1);
            } else if (type === 'field') {
              const iF = parseInt(index);
              if (index != null && !isNaN(iF) && Array.isArray(cardData[key])) {
                what = '字段「' + key + '」第' + (iF + 1) + '项';
                if (!window.confirm('确认删除该数组项吗？\n\n' + what)) return;
                if (iF >= 0 && iF < cardData[key].length) cardData[key].splice(iF, 1);
              } else {
                what = '顶层字段「' + key + '」（清空为 ""）';
                if (!window.confirm('确认清空该顶层字段吗？\n\n字段：' + key + '\n\n（置为空字符串，不会删除字段本身，避免渲染报错）')) return;
                cardData[key] = '';
              }
            }
            overlay.remove();
            updateProgress();
            renderPreview();
            saveToStorage();
            showToast('🗑️ 已删除：' + what, 'success');
          };
          footerLeft.appendChild(delBtn);
        }
        footer.appendChild(footerLeft);
        const footerRight = doc.createElement('div');
        footerRight.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';
        const cancelBtn = doc.createElement('button');
        cancelBtn.className = 'btn btn-ghost';
        cancelBtn.textContent = '取消';
        cancelBtn.onclick = function() {
          overlay.remove();
        };
        const saveBtn = doc.createElement('button');
        saveBtn.className = 'btn btn-primary';
        saveBtn.innerHTML = svgIcon('save', 14) + ' 保存';
        saveBtn.onclick = function() {
          const newVal = textarea.value;
          if (type === 'field') {
            cardData[key] = newVal;
          } else if (type === 'entry') {
            const idx2 = parseInt(index);
            const entries2 = (cardData.character_book || {}).entries || [];
            if (entries2[idx2]) {
              entries2[idx2].content = newVal;
            }
          }
          overlay.remove();
          updateProgress();
          renderPreview();
          saveToStorage();
          showToast('✅ 已保存修改', 'success');
        };
        footerRight.appendChild(cancelBtn);
        footerRight.appendChild(saveBtn);
        footer.appendChild(footerRight);
        modal.appendChild(header);
        modal.appendChild(textareaWrap);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        overlay.addEventListener('click', function(e) {
          if (e.target === overlay) overlay.remove();
        });
        doc.body.appendChild(overlay);
        try {
          textarea.focus();
        } catch (_) {}
      }

      async function saveCharacter() {
        if (!cardData.name || !cardData.name.trim()) {
          showToast('请先确定世界/角色名称', 'error');
          return;
        }
        // 检测酒馆 API 可用性（必须在 try 之前判断，给出清晰提示）
        const st = (typeof _tavern === 'function') ? _tavern() : null;
        if (!st) {
          showToast('未检测到酒馆环境，无法直接写入角色卡', 'error');
          return;
        }
        const saveBtn = doc.getElementById('saveBtn');
        const originalHTML = saveBtn ? saveBtn.innerHTML : '';
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerHTML = svgIcon('spinner', 14, 'ic-spin') + ' 写入中…';
        }
        try {
          // 复用 buildExportCard 完成MVU条目检测/填充、StatusPlaceHolderImpl注入、CRLF规范化等逻辑
          const exportCard = buildExportCard(cardData);
          const data = exportCard.data || {};
          // 世界书名称：优先 extensions.world（buildExportCard 写入位置），其次角色名
          const worldbookName = (data.extensions && data.extensions.world) || data.world || exportCard.name || cardData.name;
          const entries = (data.character_book && data.character_book.entries) || [];

          // MVU 系统检测（与 buildExportCard 内部判定保持一致）
          const filledForMvu = entries.some(function(e) {
            return isMVUEntry(e.comment || '');
          });
          const hasMVU = !!(filledForMvu || entries.some(function(e) {
            const c = (e.comment || '').toLowerCase();
            return c.indexOf('[initvar]') >= 0 || c.indexOf('[mvu_update]') >= 0 || (e.comment || '').indexOf('变量列表') >= 0 || (e.comment || '').indexOf('变量输出格式') >= 0;
          }));

          // 提取角色名列表（用于状态栏 HTML 生成）
          const charNames = extractCharNames(cardData, (cardData.character_book || {}).entries || []);

          // ===== 步骤1：创建或获取角色卡 =====
          await _tavernCreateOrGet(cardData.name);

          // ===== 步骤2：写入角色卡基础字段（description/personality/scenario/system_prompt 等）=====
          await _tavernWriteCharacterData(cardData.name, {
            description: data.description,
            personality: data.personality,
            scenario: data.scenario,
            system_prompt: data.system_prompt,
            creator_notes: data.creator_notes,
            creator: data.creator,
            character_version: data.character_version,
            alternate_greetings: data.alternate_greetings,
            depth_prompt: data.depth_prompt,
            // 关联世界书：写入 character.data.world，让酒馆自动加载该世界书
            world: (entries.length > 0) ? worldbookName : undefined
          });

          // ===== 步骤3：写入开场白 =====
          if (data.first_mes && data.first_mes.trim()) {
            await _tavernWriteFirstMes(cardData.name, data.first_mes);
          }

          // ===== 步骤4：MVU 变量系统（仅在检测到 MVU 条目时写入）=====
          if (hasMVU) {
            // 4a. 写入 MVU bundle.js 运行时脚本
            await _tavernWriteMvuRuntime(cardData.name);
            // 4b. 写入变量结构 zod schema 脚本
            // ⚠️优先使用 AI 在 MVU Tab 按 9.1.5/9.1.6 工作流生成的变量结构脚本；
            //   若 AI 未生成，则从 [InitVar] 条目内容兜底生成（保证导出到酒馆不缺 schema）
            const existingScripts = (cardData.extensions && cardData.extensions.tavern_helper && cardData.extensions.tavern_helper.scripts) || [];
            let aiSchemaScript = null;
            for (let _si = 0; _si < existingScripts.length; _si++) {
              const _ss = existingScripts[_si];
              if (!_ss) continue;
              if (_ss.id === 'mvu-schema' || String(_ss.name || '').indexOf('变量结构') >= 0 ||
                String(_ss.content || '').indexOf('mvu_zod') >= 0) {
                aiSchemaScript = _ss;
                break;
              }
            }
            let schemaContent = '';
            if (aiSchemaScript && aiSchemaScript.content && String(aiSchemaScript.content).indexOf('z.object') >= 0) {
              schemaContent = aiSchemaScript.content;
            } else {
              const initVarEntry = entries.filter(function(e) {
                return (e.comment || '').toLowerCase().indexOf('[initvar]') >= 0;
              })[0];
              const schemaInitContent = initVarEntry ? (initVarEntry.content || '') : '';
              schemaContent = generateMvuSchemaScript(schemaInitContent);
            }
            await _tavernWriteMvuSchema(cardData.name, schemaContent);
            // 4c. 写入正则脚本（5条固定正则1-5 + 1条正则6状态栏HTML）
            // ⚠️优先使用 AI 在 MVU Tab 按 9.1.6 工作流生成的状态栏 HTML；若 AI 未生成，才用默认状态栏兜底（保证不空）
            let statusBarHtml = '';
            // 4c-1. 检查 cardData 中是否已保存 AI 生成的状态栏正则（来自 saveStatusBarToCard）
            const existingRx = (cardData.extensions && cardData.extensions.regex_scripts) || [];
            let customSb = null;
            for (let si = 0; si < existingRx.length; si++) {
              const rxs = existingRx[si];
              if (!rxs) continue;
              const isSb = (rxs.id === 'mvu-status-bar') ||
                ((rxs.findRegex || rxs.find_regex || '').indexOf('StatusPlaceHolder') >= 0 &&
                  (rxs.markdownOnly || (rxs.destination && rxs.destination.display)) &&
                  !(rxs.promptOnly || (rxs.destination && rxs.destination.prompt)));
              if (isSb && (rxs.replaceString || rxs.replace_string)) {
                customSb = rxs.replaceString || rxs.replace_string;
                break;
              }
            }
            if (customSb) {
              // 解包 ``` 围栏（saveStatusBarToCard 用 ``` 包裹，_tavernWriteRegexScripts 会重新包裹）
              // ⚠️修复：原先 /\n?```$/m 带 m 标志会匹配 HTML 内部任何"行尾```"（如 script 里嵌套反引号），
              // 导致只删到内部位置、尾部```残留进酒馆。改为无 m 标志只匹配整体首行/末行
              statusBarHtml = customSb.replace(/^```[a-z]*[ \t]*\r?\n?/, '').replace(/\r?\n?[ \t]*```\s*$/, '').trim();
            }
            // 4c-2. 兜底：AI 完全没生成状态栏时，用统一模板生成默认状态栏（保证写入酒馆不缺状态栏）
            if (!statusBarHtml) statusBarHtml = generateMvuStatusBarHtml(charNames);
            await _tavernWriteRegexScripts(cardData.name, statusBarHtml);
          }

          // ===== 步骤5：写入世界书条目 =====
          if (entries.length > 0) {
            await _tavernWriteWorldbook(worldbookName, entries);
          }

          // ===== 步骤6：切换到角色卡 =====
          await _tavernSwitchToCharacter(cardData.name);

          // ===== 步骤7：将世界书绑定到当前角色卡（修复：世界书不关联到角色卡）=====
          // 必须在切换到角色卡之后调用，使该角色卡成为 current，rebindCharWorldbooks('current') 才能生效
          if (entries.length > 0) {
            try {
              await _tavernBindWorldbookToChar(worldbookName);
            } catch (_be) {
              console.warn('[时之写卡器] 世界书关联角色卡失败:', _be && _be.message);
            }
          }

          const mvuTip = hasMVU ? '（MVU变量系统已写入：bundle.js+变量结构脚本+世界书条目+正则1-5+正则6状态栏+开场白占位符）' : '';
          showToast('✅ 角色卡已成功写入酒馆' + mvuTip, 'success');
        } catch (e) {
          console.error('[时之写卡器] 写入酒馆失败:', e);
          showToast('保存失败: ' + (e.message || String(e)), 'error');
        } finally {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalHTML;
          }
        }
      }

      // showJsonModal 已移除：导出功能改为直接写入酒馆角色卡（见 saveCharacter）

      renderWelcome();

    } catch (e) {
      console.error('时之写卡器 Error:', e);
      showToast('打开失败: ' + e.message, 'error');
    }
  }

  // ============================================================================
  // SECTION 11 脚本按钮注册 + 浮动按钮兜底 + 入口 / 卸载清理
  // ============================================================================
  // ⚠️保存事件注销句柄：pagehide 时用 eventOff 注销框架事件总线上的监听（tavern-helper 规范），
  // 防止脚本重载后旧 handler 残留导致重复触发/旧闭包复活
  let _btnEvtOff = null;

  function registerButton() {
    try {
      const evtOn = typeof eventOn === 'function' ? eventOn : (typeof window.eventOn === 'function' ? window.eventOn : null);
      const getBtnEvt = typeof getButtonEvent === 'function' ? getButtonEvent : (typeof window.getButtonEvent === 'function' ? window.getButtonEvent : null);
      if (evtOn && getBtnEvt) {
        const handler = function() {
          openEditor();
        };
        evtOn(getBtnEvt('时之写卡器'), handler);
        // 若框架提供 eventOff，保存句柄供卸载时注销
        try {
          const evtOff = typeof eventOff === 'function' ? eventOff : (typeof window.eventOff === 'function' ? window.eventOff : null);
          if (evtOff) _btnEvtOff = function() {
            try {
              evtOff(getBtnEvt('时之写卡器'), handler);
            } catch (_e) {}
          };
        } catch (_e2) {}
        return true;
      }
    } catch (e) { logWarn("registerButton", e); }
    return false;
  }

  function addFloatingButton() {
    try {
      const pDoc = (window.parent && window.parent.document) ? window.parent.document : document;
      const old = pDoc.getElementById(SCRIPT_ID + '-btn');
      if (old) old.remove();
      const btn = pDoc.createElement('button');
      btn.id = SCRIPT_ID + '-btn';
      btn.textContent = '⚡ 时之写卡器';
      btn.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:99998;padding:10px 18px;background:linear-gradient(135deg,#4f46e5,#4338ca);color:#fff;border:none;border-radius:25px;cursor:pointer;font-weight:600;box-shadow:0 6px 20px rgba(15,23,42,.12);transition:all .3s;font-size:14px;';
      btn.onmouseover = function() {
        btn.style.transform = 'scale(1.05)';
      };
      btn.onmouseout = function() {
        btn.style.transform = 'scale(1)';
      };
      btn.onclick = openEditor;
      pDoc.body.appendChild(btn);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ============================================================================
  // SECTION 11.5 动态悬浮图标（借鉴"狐神撫"悬浮宠物：呼吸动画·拖拽·位置记忆·缩放·右键菜单）
  // ============================================================================
  // 悬浮图标：jsDelivr 固定 commit 链接，永久有效（原图 384×580 竖版全身图）
  const FLOAT_ICON_URL = 'https://cdn.jsdelivr.net/gh/Neohero521/Messy@3eeb1ac14e65bd33330b3fd38abf04f5c82939c0/mmexport1788704514544.webp';
  const FLOAT_ICON_KEY = 'szxq_float_icon_v1';
  const FLOAT_ICON_BASE = 64; // 100%缩放时的图标宽度(px)
  const FLOAT_ICON_RATIO = 580 / 384; // 图标宽高比（384×580），高度=宽度×此值
  const _floatIconCleanups = []; // 卸载清理句柄（DOM移除 + 父页面监听器注销）
  let _floatIconActive = false; // 悬浮图标是否挂载成功（成功后旧兜底按钮不再叠加）

  function addDynamicFloatIcon() {
    try {
      const pDoc = (window.parent && window.parent.document) ? window.parent.document : document;
      const pWin = (window.parent && window.parent.document) ? window.parent : window;
      // ---- 去重：脚本重载时清掉旧实例 ----
      ['float-icon', 'float-menu', 'float-style'].forEach(function(suffix) {
        const old = pDoc.getElementById(SCRIPT_ID + '-' + suffix);
        if (old) old.remove();
      });

      // ---- 设置状态（位置/缩放/动画开关，localStorage持久化） ----
      const st = {
        posX: null,
        posY: null,
        scale: 100,
        animEnabled: true
      };
      try {
        const rawFi = localStorage.getItem(FLOAT_ICON_KEY);
        if (rawFi) {
          const dFi = JSON.parse(rawFi);
          if (dFi) {
            if (typeof dFi.scale === 'number') st.scale = Math.max(40, Math.min(160, dFi.scale));
            if (dFi.animEnabled !== undefined) st.animEnabled = !!dFi.animEnabled;
            if (typeof dFi.posX === 'number') st.posX = dFi.posX;
            if (typeof dFi.posY === 'number') st.posY = dFi.posY;
          }
        }
      } catch (_) {}

      function saveFi() {
        try {
          localStorage.setItem(FLOAT_ICON_KEY, JSON.stringify({
            posX: st.posX,
            posY: st.posY,
            scale: st.scale,
            animEnabled: st.animEnabled
          }));
        } catch (_) {}
      }

      // ---- 注入样式（图标 + 右键菜单，深色玻璃风，z-index低于弹窗99999） ----
      const styleEl = pDoc.createElement('style');
      styleEl.id = SCRIPT_ID + '-float-style';
      styleEl.textContent = '' +
        '#' + SCRIPT_ID + '-float-icon{position:fixed;z-index:99990;width:64px;height:97px;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;}' +
        '#' + SCRIPT_ID + '-float-icon .szxq-fi-anim{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 6px 16px rgba(0,0,0,.45)) drop-shadow(0 0 10px rgba(240,150,80,.22));transition:filter .25s ease,transform .2s ease;}' +
        '#' + SCRIPT_ID + '-float-icon .szxq-fi-anim img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;}' +
        '#' + SCRIPT_ID + '-float-icon.szxq-fi-anim-on .szxq-fi-anim{animation:szxq-fi-breath 3.4s ease-in-out infinite;}' +
        '#' + SCRIPT_ID + '-float-icon:hover .szxq-fi-anim{filter:drop-shadow(0 10px 24px rgba(0,0,0,.5)) drop-shadow(0 0 18px rgba(240,150,80,.4));}' +
        '#' + SCRIPT_ID + '-float-icon.szxq-fi-dragging{cursor:grabbing;}' +
        '#' + SCRIPT_ID + '-float-icon.szxq-fi-dragging .szxq-fi-anim{transform:scale(1.08);}' +
        '@keyframes szxq-fi-breath{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-4px) scale(1.05)}}' +
        '#' + SCRIPT_ID + '-float-menu{position:fixed;z-index:99991;display:none;flex-direction:column;gap:2px;min-width:190px;padding:8px 4px;background:rgba(24,20,18,.96);border:1px solid rgba(240,150,80,.30);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.65);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif;}' +
        '#' + SCRIPT_ID + '-float-menu .szxq-fm-item{display:flex;align-items:center;gap:10px;width:100%;padding:8px 14px;border:none;background:transparent;border-radius:8px;color:#d8ccc2;font-size:12.5px;font-family:inherit;cursor:pointer;text-align:left;transition:background .15s ease,color .15s ease;}' +
        '#' + SCRIPT_ID + '-float-menu .szxq-fm-item:hover{background:rgba(240,150,80,.18);color:#f5ded0;}' +
        '#' + SCRIPT_ID + '-float-menu .szxq-fm-item.danger{color:#d08080;}' +
        '#' + SCRIPT_ID + '-float-menu .szxq-fm-item.danger:hover{background:rgba(180,60,60,.25);color:#ffb0a0;}' +
        '#' + SCRIPT_ID + '-float-menu .szxq-fm-divider{height:1px;background:rgba(255,255,255,.08);margin:4px 8px;}' +
        '#' + SCRIPT_ID + '-float-menu .szxq-fm-scale{padding:6px 14px 10px;display:flex;flex-direction:column;gap:4px;}' +
        '#' + SCRIPT_ID + '-float-menu .szxq-fm-scale label{font-size:11px;color:#a09088;display:flex;justify-content:space-between;align-items:center;cursor:default;}' +
        '#' + SCRIPT_ID + '-float-menu .szxq-fm-scale .szxq-fm-val{color:#f0a070;font-weight:600;}' +
        '#' + SCRIPT_ID + '-float-menu .szxq-fm-scale input[type=range]{width:100%;accent-color:#f09650;cursor:pointer;}';
      pDoc.head.appendChild(styleEl);

      // ---- 悬浮图标（wrap=定位层/拖拽热区，anim=呼吸动画层，img=图标本体） ----
      const wrap = pDoc.createElement('div');
      wrap.id = SCRIPT_ID + '-float-icon';
      wrap.title = '时之写卡器 · 单击打开 / 拖拽移动 / 右键菜单 / 滚轮缩放';
      wrap.setAttribute('aria-label', '时之写卡器悬浮图标');
      const animLayer = pDoc.createElement('div');
      animLayer.className = 'szxq-fi-anim';
      const img = pDoc.createElement('img');
      img.alt = '时之写卡器';
      img.draggable = false;
      img.referrerPolicy = 'no-referrer';
      img.src = FLOAT_ICON_URL;
      animLayer.appendChild(img);
      wrap.appendChild(animLayer);

      // ---- 右键菜单 ----
      const menu = pDoc.createElement('div');
      menu.id = SCRIPT_ID + '-float-menu';
      menu.setAttribute('role', 'menu');
      menu.innerHTML = '' +
        '<button class="szxq-fm-item" data-action="open"><span>✏️</span> 打开时之写卡器</button>' +
        '<button class="szxq-fm-item" data-action="toggle-anim"><span>🎬</span> 动画 <span class="szxq-fi-state">开</span></button>' +
        '<div class="szxq-fm-divider"></div>' +
        '<div class="szxq-fm-scale">' +
        '<label>大小 <span class="szxq-fm-val">100%</span></label>' +
        '<input type="range" min="40" max="160" step="5" value="100">' +
        '</div>' +
        '<div class="szxq-fm-divider"></div>' +
        '<button class="szxq-fm-item" data-action="reset-pos"><span>📍</span> 重置位置</button>' +
        '<button class="szxq-fm-item danger" data-action="hide"><span>✕</span> 隐藏图标（刷新后恢复）</button>';
      const slider = menu.querySelector('input[type=range]');
      const scaleVal = menu.querySelector('.szxq-fm-val');
      const animStateLabel = menu.querySelector('.szxq-fi-state');

      pDoc.body.appendChild(wrap);
      pDoc.body.appendChild(menu);

      // ---- 位置/缩放应用（含视口钳制） ----
      const baseH = Math.round(FLOAT_ICON_BASE * FLOAT_ICON_RATIO); // 默认高度兜底（布局未就绪时）
      function applyPosition() {
        const w = pWin.innerWidth || pDoc.documentElement.clientWidth || 0;
        const h = pWin.innerHeight || pDoc.documentElement.clientHeight || 0;
        const bw = wrap.offsetWidth || FLOAT_ICON_BASE;
        const bh = wrap.offsetHeight || baseH;
        if (st.posX == null || st.posY == null) {
          st.posX = w - bw - 24;
          st.posY = h - bh - 96;
        }
        st.posX = Math.max(4, Math.min(w - bw - 4, st.posX));
        st.posY = Math.max(4, Math.min(h - bh - 4, st.posY));
        wrap.style.left = Math.round(st.posX) + 'px';
        wrap.style.top = Math.round(st.posY) + 'px';
      }

      function applyScale() {
        const s = st.scale / 100;
        const w = Math.round(FLOAT_ICON_BASE * s);
        const h = Math.round(FLOAT_ICON_BASE * FLOAT_ICON_RATIO * s); // 384×580 竖版全身图，高度按比例
        wrap.style.width = w + 'px';
        wrap.style.height = h + 'px';
        applyPosition();
      }

      function applyAnim() {
        if (st.animEnabled) wrap.classList.add('szxq-fi-anim-on');
        else wrap.classList.remove('szxq-fi-anim-on');
        if (animStateLabel) animStateLabel.textContent = st.animEnabled ? '开' : '关';
      }

      function syncScaleUI() {
        if (scaleVal) scaleVal.textContent = Math.round(st.scale) + '%';
        if (slider) slider.value = st.scale;
      }

      function showMenu(x, y) {
        menu.style.display = 'flex';
        const r = menu.getBoundingClientRect();
        const w = pWin.innerWidth,
          h = pWin.innerHeight;
        let l = x,
          t = y;
        if (l + r.width > w - 8) l = Math.max(8, w - r.width - 8);
        if (t + r.height > h - 8) t = Math.max(8, h - r.height - 8);
        menu.style.left = l + 'px';
        menu.style.top = t + 'px';
        applyAnim();
        syncScaleUI();
      }

      function hideMenu() {
        menu.style.display = 'none';
      }

      // ---- 拖拽 + 单击打开（位移<4px视为单击；拖拽期间暂停呼吸动画避免transform冲突） ----
      let drag = null;

      function onDown(e) {
        if (e.button === 2) return; // 右键留给菜单
        const rect = wrap.getBoundingClientRect();
        drag = {
          ox: e.clientX - rect.left,
          oy: e.clientY - rect.top,
          sx: e.clientX,
          sy: e.clientY,
          moved: false
        };
        wrap.classList.add('szxq-fi-dragging');
        wrap.classList.remove('szxq-fi-anim-on');
        hideMenu();
      }

      function onMove(e) {
        if (!drag) return;
        if (Math.abs(e.clientX - drag.sx) > 4 || Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
        const w = pWin.innerWidth,
          h = pWin.innerHeight;
        const bw = wrap.offsetWidth || FLOAT_ICON_BASE,
          bh = wrap.offsetHeight || baseH;
        st.posX = Math.max(4, Math.min(w - bw - 4, e.clientX - drag.ox));
        st.posY = Math.max(4, Math.min(h - bh - 4, e.clientY - drag.oy));
        wrap.style.left = Math.round(st.posX) + 'px';
        wrap.style.top = Math.round(st.posY) + 'px';
      }

      function onUp() {
        if (!drag) return;
        const wasClick = !drag.moved;
        drag = null;
        wrap.classList.remove('szxq-fi-dragging');
        applyAnim(); // 恢复呼吸动画
        if (wasClick) {
          try {
            openEditor();
          } catch (err) {
            showToast('打开失败: ' + (err && err.message ? err.message : err), 'error');
          }
        } else {
          saveFi();
        }
      }
      wrap.addEventListener('pointerdown', function(e) {
        e.preventDefault();
        onDown(e);
      });
      pDoc.addEventListener('pointermove', onMove);
      pDoc.addEventListener('pointerup', onUp);
      pDoc.addEventListener('pointercancel', onUp);

      // ---- 右键菜单 / 菜单外点击关闭 ----
      wrap.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        showMenu(e.clientX, e.clientY);
      });

      function onDocClick(e) {
        if (menu.style.display === 'flex' && !menu.contains(e.target) && !wrap.contains(e.target)) hideMenu();
      }
      pDoc.addEventListener('click', onDocClick);

      // ---- 滚轮缩放 ----
      wrap.addEventListener('wheel', function(e) {
        e.preventDefault();
        e.stopPropagation();
        st.scale = Math.max(40, Math.min(160, st.scale + (e.deltaY > 0 ? -4 : 4)));
        applyScale();
        syncScaleUI();
        saveFi();
      }, {
        passive: false
      });

      // ---- 菜单项交互 ----
      menu.addEventListener('click', function(e) {
        const item = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
        if (!item) return;
        const act = item.getAttribute('data-action');
        if (act === 'open') {
          hideMenu();
          try {
            openEditor();
          } catch (err) {
            showToast('打开失败: ' + (err && err.message ? err.message : err), 'error');
          }
        } else if (act === 'toggle-anim') {
          st.animEnabled = !st.animEnabled;
          applyAnim();
          saveFi();
        } else if (act === 'reset-pos') {
          st.posX = null;
          st.posY = null;
          applyPosition();
          saveFi();
          hideMenu();
        } else if (act === 'hide') {
          hideMenu();
          wrap.style.display = 'none'; // 仅本次会话隐藏，刷新后恢复
        }
      });
      slider.addEventListener('input', function() {
        st.scale = Math.max(40, Math.min(160, parseFloat(slider.value) || 100));
        applyScale();
        syncScaleUI();
        saveFi();
      });

      // ---- 视口变化时钳制位置（节流，避免拖拽分屏/移动端地址栏伸缩时高频重排）----
      let _resizeThrottleTimer = null;
      function onResize() {
        if (_resizeThrottleTimer) return;
        _resizeThrottleTimer = setTimeout(function() {
          _resizeThrottleTimer = null;
          applyPosition();
        }, CONFIG.RESIZE_THROTTLE_MS);
      }
      pWin.addEventListener('resize', onResize);

      // ---- 初始化 ----
      applyScale();
      applyAnim();
      syncScaleUI();

      // ---- 注册卸载清理（DOM + 父页面监听器） ----
      _floatIconCleanups.push(function() {
        try {
          pDoc.removeEventListener('pointermove', onMove);
          pDoc.removeEventListener('pointerup', onUp);
          pDoc.removeEventListener('pointercancel', onUp);
          pDoc.removeEventListener('click', onDocClick);
          pWin.removeEventListener('resize', onResize);
          wrap.remove();
          menu.remove();
          styleEl.remove();
        } catch (_) {}
      });
      _floatIconActive = true;
      return true;
    } catch (e) {
      console.warn('[时之写卡器] 悬浮图标挂载失败，回退旧入口:', e);
      return false;
    }
  }

  let retryCount = 0;
  let _initRetryTimer = null; // ⚠️保存重试定时器句柄：pagehide 时取消，防止卸载后浮动按钮"复活"
  function tryInit() {
    if (registerButton()) {
      return;
    }
    if (retryCount < 10) {
      retryCount++;
      _initRetryTimer = setTimeout(tryInit, 500);
    } else if (!_floatIconActive) {
      addFloatingButton();
    } // 悬浮图标已在时不再叠加旧兜底按钮
  }
  // ============================================================================
  // ===== 脚本入口 / 卸载清理：遵循 tavern-helper-template 脚本模板规范 =====
  //   · 初始化放入 $() 中（等价于 jQuery ready，防止 DOM 未就绪时注册按钮失败）
  //   · 卸载时(pagehide)不仅关闭写卡器弹窗，还清理浮动按钮，避免残留DOM
  // ============================================================================
  // 清理函数：写卡器专用浮动按钮 + 弹层 iframe 统一卸载
  function cleanupScriptArtifacts() {
    try {
      closeModal();
    } catch (_) {}
    try {
      // 取消进行中的初始化重试，防止清理后 addFloatingButton 把浮动按钮重新加回父页面
      if (_initRetryTimer) {
        clearTimeout(_initRetryTimer);
        _initRetryTimer = null;
      }
      // 注销框架事件总线上的按钮监听（若可用）
      if (_btnEvtOff) {
        _btnEvtOff();
        _btnEvtOff = null;
      }
      // ⚠️修复（卸载清理不完整）：释放 window.__* 编辑器访问器（持有整份 cardData + 双Tab聊天历史）
      _releaseEditorGlobals();
      const pDoc = (window.parent && window.parent.document) ? window.parent.document : document;
      const btn = pDoc.getElementById(SCRIPT_ID + '-btn');
      if (btn) btn.remove();
      const md = pDoc.getElementById(SCRIPT_ID + '-modal');
      if (md) md.remove();
      // 悬浮图标（SECTION 11.5）：移除DOM + 注销父页面监听器
      while (_floatIconCleanups.length) {
        try {
          _floatIconCleanups.pop()();
        } catch (_) {}
      }
      _floatIconActive = false;
    } catch (_) {}
  }

  // ===== 初始化入口：优先 jQuery ready（酒馆环境必定注入 jQuery），否则直接执行 =====
  // skill 规范：脚本代码的副作用（DOM注册、按钮、监听器）必须在 jQuery ready 回调中，
  // 禁止使用 DOMContentLoaded（远程加载场景不会触发），禁止直接在顶层作用域执行 DOM 写入。
  function scriptEntryPoint() {
    window.addEventListener('pagehide', cleanupScriptArtifacts);
    addDynamicFloatIcon(); // 动态悬浮图标（常驻入口：单击打开/拖拽/缩放/右键菜单）
    tryInit();
  }
  if (typeof $ !== 'undefined') {
    $(scriptEntryPoint);
  } else if (typeof window !== 'undefined' && window.parent && typeof window.parent.$ !== 'undefined') {
    window.parent.$(scriptEntryPoint);
  } else {
    scriptEntryPoint();
  }
})();