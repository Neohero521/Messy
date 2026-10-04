(function() {
  'use strict';
  // 写入诊断开关：true 时打印分步写入日志（排障用），false 时静默
  const WRITER_DEBUG = false;
  /* ============================================================================
   * 时之写卡器 · Agent 版（单界面智能写卡）
   * ----------------------------------------------------------------------------
   * 与旧版（三 Tab：角色卡/MVU/前端）不同，本版本是 Agent 模式：
   *   · 只有一个角色卡生成界面（单一对话会话）
   *   · AI 是全能写卡 Agent：根据用户需求和提示词智能生成——
   *       角色卡（世界观/世界书条目/开场白）、MVU变量系统（8条工作流+状态栏）、
   *       前端界面（正文美化正则/结构化数据面板）
   *   · 后处理按「内容特征」自动路由：:::操作块 / 状态栏HTML / 前端HTML
   *     全部自动提取保存，不再依赖 Tab 切换
   *
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
   *   ▌SECTION 7  MVU 8步工作流 + 统一 Agent 提示词构建（buildPrompt）
   *   ▌SECTION 8  酒馆 SillyTavern API 适配层（_tavern() 封装 · 导入导出）
   *   ▌SECTION 9  写卡器主界面 UI 渲染（欢迎页 · 聊天页 · 预览面板）
   *   ▌SECTION 10 聊天消息发送与 AI 流式回复（callAIChat · 写卡流程主循环）
   *   ▌SECTION 11 脚本注册按钮 + 浮动按钮 + 入口 / 卸载清理
   * ==========================================================================
   */
  const SCRIPT_ID = 'modelo-char-generator';

  // ===== Agent 模式总开关：本文件为 Agent 版（单界面/单会话/内容级路由），恒为 true =====
  // 旧版三 Tab 隔离逻辑（角色卡Tab↔MVU Tab 双向拦截、按 Tab 分发提示词/后处理）
  // 在 Agent 版中全部依据此常量跳过，改为内容级自动路由。
  const AGENT_MODE = true;

  // ===== Agent Loop 步数上限（防失控）=====
  // 硬上限 50，软上限 12；按计划长度动态取 min(50, max(12, steps*4))
  const AGENT_LOOP_MAX_STEPS_HARD = 50;
  const AGENT_LOOP_MAX_STEPS_SOFT = 12;
  const AGENT_LOOP_MAX_STEPS = AGENT_LOOP_MAX_STEPS_HARD; // 兼容旧引用（parseAgentPlan 截断用）
  function _computeStepLimit(plan) {
    if (!plan || !plan.steps || !plan.steps.length) return AGENT_LOOP_MAX_STEPS_SOFT;
    return Math.min(AGENT_LOOP_MAX_STEPS_HARD,
                    Math.max(AGENT_LOOP_MAX_STEPS_SOFT, plan.steps.length * 4));
  }

  // ===== 解析AI输出的计划块 <agent_plan>...</agent_plan>（Agent Loop 入口协议）=====
  // minSteps（可选，默认2）：最小步骤数门槛——初始计划≥2步才触发循环；动态重规划传1（剩余工作可能只有一件）
  // 返回 { goal, steps:[{desc,done}], createdAt, stepRuns } 或 null
  function parseAgentPlan(text, minSteps) {
    if (!text) return null;
    const m = String(text).match(/<agent_plan>([\s\S]*?)<\/agent_plan>/i);
    if (!m) return null;
    const body = m[1] || '';
    const goalMatch = body.match(/目标[：:]\s*([^\n]+)/);
    const goal = goalMatch ? goalMatch[1].trim() : 'Agent创作计划';
    const steps = [];
    body.split(/\r?\n/).forEach(function(line) {
      const l = line.trim();
      if (!l) return;
      // 步骤行：1. / 1、/ 1) / 1）等开头，或 - / • / • 列表符（兼容全角标点）
      const sm =
        l.match(/^\*{0,2}\s*(\d+)\s*[\.、．)）:：]\s*(.+?)\s*\*{0,2}$/) ||
        l.match(/^\*{0,2}\s*[（(]\s*(\d+)\s*[)）]\s*(.+?)\s*\*{0,2}$/) ||
        l.match(/^[-•▪◦·]\s*(.+)$/) ||
        l.match(/^(?:第\s*)?(\d+)\s*步[：:]\s*(.+)$/) ||
        l.match(/^Step\s*(\d+)\s*[：:]\s*(.+)$/i) ||
        l.match(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*(.+)$/);
      if (sm) {
        const desc = (sm[2] || sm[1] || '').trim().replace(/[*_`]+/g, '');  // 顺手剥 Markdown 标记
        if (desc && desc.length > 1) steps.push({ desc: desc, done: false, dependsOn: [] });
      }
    });
    // 解析依赖：支持 "（依赖 1,3）" / "(需要:1,3)" / "[depends:1,3]" 写法
    steps.forEach(function(s) {
      const depMatch = s.desc.match(/[（(\[]\s*(?:依赖|需要|depends?)\s*[:：]?\s*([0-9,，、\s]+)\s*[)）\]]/i);
      if (depMatch) {
        s.dependsOn = depMatch[1].split(/[,，、\s]+/)
          .map(function(x) { return parseInt(x, 10) - 1; })
          .filter(function(n) { return n >= 0 && n < steps.length && n !== steps.indexOf(s); });
        s.desc = s.desc.replace(depMatch[0], '').trim();
      }
    });
    const _minNeed = (typeof minSteps === 'number') ? minSteps : 2;
    if (steps.length < _minNeed) return null; // 初始计划少于2步不触发循环；重规划由调用方放宽门槛
    if (steps.length > AGENT_LOOP_MAX_STEPS) steps.length = AGENT_LOOP_MAX_STEPS; // 超长计划截断
    // ⚠️步骤粒度启发式校验：拒绝明显过大的步骤描述，避免"生成完整角色卡"这类单步吃掉整个卡
    // ★修复#5：只保留最极端的整体生成信号——移除"整个世界/整体世界观/整体设定/全部设定"等会误伤正常"生成世界观"一步的词
    const _VAGUE_STEP_RE = /(一次性生成|全量生成|全面生成|一次搞定|一并生成完整|全部内容一起做|一次生成全部|全部生成|完整卡)/;   // ★P2-16：删"完整角色卡/整张卡"——用户可能就是想要完整的
    const _vagueSteps = steps.filter(function(s) { return _VAGUE_STEP_RE.test(s.desc); });
    const _base = { goal: goal, steps: steps, createdAt: Date.now(), stepRuns: 0 };
    if (_vagueSteps.length > 0) {
      _base._vague = true;
      _base._vagueSteps = _vagueSteps.map(function(s) { return s.desc; });
    }
    return _base;
  }

  // ===== 从 AI 报告文本兜底构造 Agent 计划（AI 忘输出 <agent_plan> 时保底）=====
  // 触发场景：AI 输出了"生成计划报告"但没输出 <agent_plan> 标签
  // 返回 { goal, steps:[{desc,done}], createdAt, stepRuns } 或 null
  function buildPlanFromReportText(text) {
    if (!text) return null;
    const t = String(text);
    // 放宽触发：任何"报告特征"词命中即可
    if (!/(我理解你想要|新增条目|拟新增|会新增|打算加|准备加|条目清单|生成计划|execution plan)/.test(t)) return null;   // ★P2-2：去掉"计划/清单/优先/要做/必做"等日常高频词，只在 AI 明确输出条目清单/生成计划类措辞时触发
    // ★松绑2.8：段头词扩到 12 个，且不强制标记 emoji（原版要求 ## 或 emoji 开头才结束，AI 用 "**修改内容**" 就走不到）
    const sectionRe = /(?:新增条目|打算[加做]|准备[加做]|拟新增|会新增|条目清单|要做|计划|清单)[^\n]*\n([\s\S]*?)(?=\n\s*(?:##|---|✏️|🔧|🎯|🌍|📌|📋|🎬|以上|修改内容|优先级)|$)/i;
    const sm = t.match(sectionRe);
    if (!sm || !sm[1]) return null;
    const lines = sm[1].split(/\n/);
    const steps = [];
    lines.forEach(function(line) {
      const l = line.replace(/^\s*(?:\d+\s*[\.、．)）]|[-*•▪◦·◆■])\s*/, '').replace(/[*_`【】]/g, '').trim();
      if (l.length < 3 || l.length > 200) return;
      if (/^(以上|如下|清单|以下|说明|注意|总计|合计)/.test(l)) return;
      steps.push({ desc: l.slice(0, 80), done: false, dependsOn: [] });
    });
    if (steps.length < 1) return null;
    if (steps.length > 12) steps.length = 12;
    return {
      goal: '按报告执行',
      steps: steps,
      createdAt: Date.now(),
      stepRuns: 0,
      _fromReport: true
    };
  }

  // ============================================================================
  // 全局调参常量（唯一事实源）：阈值/超时/防抖统一在此，禁止再散落魔法数字
  // ============================================================================
  const CONFIG = Object.freeze({
    // —— 定时器 / 防抖（毫秒）——
    IFRAME_LOAD_TIMEOUT_MS: 4000,   // iframe 加载超时
    PREVIEW_DEBOUNCE_MS: 250,       // 预览面板刷新防抖（全量重建DOM，批量操作时合并渲染，降低卡顿）
    INPUT_TOKEN_DEBOUNCE_MS: 150,   // 输入框 token 估算防抖（字数显示仍即时）
    CTX_BAR_DEBOUNCE_MS: 0,         // 上下文操作条合并刷新（0=下一个事件循环即执行，保持即时）
    RESIZE_THROTTLE_MS: 100,        // 视口 resize 节流
    // —— 条目匹配引擎（findEntryMatch）——
    MATCH_SUFFIX_SIM: 0.72,         // 同前缀唯一条目：后缀名「编辑距离+前缀+字符集」混合相似度阈值（★#7：0.60→0.72，避免"林月/林月如"被合并）
    MATCH_CONTENT_SIM: 0.55,        // 同前缀多条目：正文 bigram Dice 相似度阈值（★#7：0.45→0.55）
    MATCH_CONTENT_MIN_LEN: 20,      // 正文参与相似度匹配的最小长度
    MATCH_CONTENT_HEAD: 300,        // 正文比较仅取前 N 字符（控 CPU；中文按字符计）
    // —— 文本 / UI ——
    AI_ERROR_PREVIEW_CHARS: 300,    // AI 解析失败时回显的原文片段长度
    DERIVE_KEYWORD_HEAD_CHARS: 300, // 触发词派生：仅扫描正文前 N 字
    DERIVE_KEYWORD_MAX: 8,          // 触发词派生：候选词数量上限（★松绑2.3：5→8，既不过度也不吝啬）
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
  /* 权重可视化等级色（7 级 × {main/bg/border}，供 WEIGHT_LEVELS / _inferWeightLevel 引用，避免 JS 内联 hex）*/
  --w-level-max:      #c98b7a;  --w-level-max-bg:      rgba(201,139,122,.13);  --w-level-max-border:      rgba(201,139,122,.31);
  --w-level-max2:     #c98b7a;  --w-level-max2-bg:     rgba(201,139,122,.13);  --w-level-max2-border:     rgba(201,139,122,.31);
  --w-level-high:     #ca8a04;  --w-level-high-bg:     rgba(202,138,4,.13);    --w-level-high-border:     rgba(202,138,4,.31);
  --w-level-mid:      #15803d;  --w-level-mid-bg:      rgba(21,128,61,.13);    --w-level-mid-border:      rgba(21,128,61,.31);
  --w-level-midlow:   #667085;  --w-level-midlow-bg:   rgba(102,112,133,.13);  --w-level-midlow-border:   rgba(102,112,133,.31);
  --w-level-low:      #667085;  --w-level-low-bg:      rgba(102,112,133,.13);  --w-level-low-border:      rgba(102,112,133,.31);
  --w-level-min:      #b3aa98;  --w-level-min-bg:      rgba(179,170,152,.13);  --w-level-min-border:      rgba(179,170,152,.31);
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
  /* 权重等级色·暗色主题 */
  --w-level-max:      #f8a58e;  --w-level-max-bg:      rgba(248,165,142,.18);  --w-level-max-border:      rgba(248,165,142,.42);
  --w-level-max2:     #f8a58e;  --w-level-max2-bg:     rgba(248,165,142,.18);  --w-level-max2-border:     rgba(248,165,142,.42);
  --w-level-high:     #fbbf24;  --w-level-high-bg:     rgba(251,191,36,.18);   --w-level-high-border:     rgba(251,191,36,.42);
  --w-level-mid:      #4ade80;  --w-level-mid-bg:      rgba(74,222,128,.18);   --w-level-mid-border:      rgba(74,222,128,.42);
  --w-level-midlow:   #8f97a8;  --w-level-midlow-bg:   rgba(143,151,168,.18);  --w-level-midlow-border:   rgba(143,151,168,.42);
  --w-level-low:      #8f97a8;  --w-level-low-bg:      rgba(143,151,168,.18);  --w-level-low-border:      rgba(143,151,168,.42);
  --w-level-min:      #b8b0a0;  --w-level-min-bg:      rgba(184,176,160,.18);  --w-level-min-border:      rgba(184,176,160,.42);
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
  --scrollbar-thumb:rgba(255,255,255,.22);--link:#93b4ff;
  --w-level-max:#f8a58e;--w-level-max-bg:rgba(248,165,142,.18);--w-level-max-border:rgba(248,165,142,.42);
  --w-level-max2:#f8a58e;--w-level-max2-bg:rgba(248,165,142,.18);--w-level-max2-border:rgba(248,165,142,.42);
  --w-level-high:#fbbf24;--w-level-high-bg:rgba(251,191,36,.18);--w-level-high-border:rgba(251,191,36,.42);
  --w-level-mid:#4ade80;--w-level-mid-bg:rgba(74,222,128,.18);--w-level-mid-border:rgba(74,222,128,.42);
  --w-level-midlow:#8f97a8;--w-level-midlow-bg:rgba(143,151,168,.18);--w-level-midlow-border:rgba(143,151,168,.42);
  --w-level-low:#8f97a8;--w-level-low-bg:rgba(143,151,168,.18);--w-level-low-border:rgba(143,151,168,.42);
  --w-level-min:#b8b0a0;--w-level-min-bg:rgba(184,176,160,.18);--w-level-min-border:rgba(184,176,160,.42);
  color-scheme:dark;
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
.chat-messages{flex:1 1 0;overflow-y:auto;padding:12px 4px;min-height:0;-webkit-overflow-scrolling:touch}
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
.chat-msg .bubble{max-width:92%;padding:8px 4px;border-radius:var(--radius);font-size:1.14em;line-height:1.7;word-break:break-word}
.chat-msg.assistant .bubble{background:var(--surface);border:1px solid var(--line-soft);color:var(--ink);font-size:1.24em;padding:10px 6px;max-width:100%;width:100%;border-radius:var(--radius);box-shadow:var(--shadow-soft)}
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
/* ===== Agent 理解阶段·选项条 ===== */
.agent-options-bar{flex-shrink:0;display:flex;flex-direction:column;gap:6px;padding:10px 14px;background:linear-gradient(180deg,var(--accent-soft) 0%,rgba(79,70,229,.03) 100%);border-top:1px solid var(--accent-border);animation:optBarIn .28s ease}
@keyframes optBarIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.agent-options-bar .opt-hint{display:flex;align-items:center;gap:6px;font-size:.78em;color:var(--accent-text);font-weight:600;margin-bottom:2px}
.agent-options-bar .opt-hint svg{color:var(--accent)}
.agent-options-bar .opt-btn{display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;background:var(--surface);border:1px solid var(--accent-border);border-radius:var(--radius-sm);color:var(--ink);font-size:.86em;line-height:1.5;text-align:left;cursor:pointer;transition:all .18s cubic-bezier(.4,0,.2,1);font-family:inherit;font-weight:500}
.agent-options-bar .opt-btn:hover:not(:disabled){background:var(--surface);border-color:var(--accent);transform:translateY(-1px);box-shadow:0 6px 18px rgba(79,70,229,.14)}
.agent-options-bar .opt-btn:active:not(:disabled){transform:translateY(0) scale(.99)}
.agent-options-bar .opt-btn:disabled{opacity:.45;cursor:not-allowed}
.agent-options-bar .opt-num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:linear-gradient(135deg,var(--accent),var(--accent-deep));color:#fff;border-radius:50%;font-size:.78em;font-weight:700;flex-shrink:0;box-shadow:0 2px 6px rgba(79,70,229,.22)}
.agent-options-bar .opt-text{flex:1;min-width:0}
.agent-options-bar .opt-cancel{align-self:flex-end;padding:4px 10px;background:transparent;border:none;color:var(--muted);font-size:.76em;cursor:pointer;font-family:inherit;border-radius:6px;transition:all .15s}
.agent-options-bar .opt-cancel:hover{color:var(--terra-text);background:var(--terra-soft)}
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
/* 生成中：隐藏发送箭头和 spinner，改显示"停止"方块 */
.btn-send .stop-icon{display:none;color:#fff}
.btn-send.is-waiting .stop-icon{display:block}
.btn-send.is-waiting .send-spinner{display:none}   /* 覆盖：生成中用停止图标替代 spinner */
/* 已请求停止：按钮变琥珀色提示 */
.btn-send.is-aborting{background:linear-gradient(135deg,var(--amber),#a16207)!important;animation:pulse-send 1.4s infinite}
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
  .chat-messages{padding:8px 4px}
  .chat-msg .bubble{max-width:94%;font-size:1.14em;padding:7px 4px}
  .chat-msg.assistant .bubble{font-size:1.24em;padding:9px 6px}
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
.cp-section{margin:2px 0;border-radius:var(--radius-sm);overflow:hidden}
.cp-section-header{display:flex;align-items:center;gap:4px;padding:4px 6px;cursor:pointer;user-select:none;transition:background .15s;border-radius:var(--radius-sm)}
.cp-section-header:hover{background:var(--surface-sink)}
.cp-section-icon{width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;background:var(--surface-sink);color:var(--muted)}
.cp-section-label{font-size:.9em;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp-section-preview{font-size:.8em;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}
.cp-section-toggle{font-size:.78em;color:var(--accent);flex-shrink:0;padding:0 4px}
.cp-section-body{padding:6px 6px 8px 8px;font-size:1.02em;line-height:1.75;white-space:pre-wrap;word-break:break-word}
.cp-section-body.collapsed{display:none}
/* section 类型着色 */
.cp-section-thinking .cp-section-header{background:var(--amber-soft)}
.cp-section-thinking .cp-section-label,.cp-section-thinking .cp-section-icon{color:var(--amber-text)}
.cp-section-thinking .cp-section-body{color:var(--ink-soft);font-size:.85em;font-style:italic}
.cp-section-content .cp-section-header{background:var(--sage-soft)}
.cp-section-content .cp-section-label,.cp-section-content .cp-section-icon{color:var(--sage-text)}
.cp-section-code .cp-section-body{font-family:var(--font-mono);font-size:.96em;background:var(--surface-soft);border:1px solid var(--line-soft);border-radius:8px;margin:4px 4px 6px 6px;padding:8px 8px;tab-size:2;overflow-x:auto}
.cp-section-opblock .cp-section-header{background:var(--accent-soft)}
.cp-section-opblock .cp-section-label,.cp-section-opblock .cp-section-icon{color:var(--accent-text)}
.cp-opblock-pre{font-family:var(--font-mono);font-size:.96em;background:var(--surface-soft);border:1px solid var(--accent-border);border-radius:8px;margin:4px 4px 6px 6px;padding:8px 8px;tab-size:2;overflow-x:auto;white-space:pre-wrap;word-break:break-word;color:var(--ink-soft)}
/* ===== 执行结果卡片（失败置顶，红色高亮）===== */
.cp-section-execnotes .cp-section-header{background:var(--terra-soft)}
.cp-section-execnotes .cp-section-label,
.cp-section-execnotes .cp-section-icon{color:var(--terra-text)}
.cp-section-execnotes .cp-section-body{
  font-family:var(--font-mono);font-size:.94em;line-height:1.6;
  background:var(--surface-soft);border:1px solid var(--line-soft);
  border-radius:8px;margin:4px 4px 6px 6px;padding:8px 10px;
}
.cp-section-execnotes .exec-line{padding:2px 0;word-break:break-word}
.cp-section-execnotes .exec-fail{
  color:var(--terra-text);font-weight:600;
  background:var(--terra-soft);border-left:3px solid var(--terra);
  padding:4px 8px;border-radius:0 6px 6px 0;margin:4px 0;
}
.cp-section-execnotes .exec-warn{
  color:var(--amber-text);font-weight:500;
  background:var(--amber-soft);border-left:3px solid var(--amber);
  padding:4px 8px;border-radius:0 6px 6px 0;margin:4px 0;
}
.cp-section-execnotes .exec-ok{color:var(--sage-text)}
.cp-section-execnotes .exec-title{color:var(--ink);font-weight:700;margin-top:2px}

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
  // SECTION 2.5  卡片数据验证层（独立于 AI 输出的真实性校验）
  // 与 mergePartial/applyOps 职责严格区分：写入层负责"落盘"，验证层负责"落盘后是否符合规范"
  // 返回：{ valid, errorCount, warnCount, issues: [{level, code, msg, path?, comment?}] }
  // ============================================================================
  function validateCardData(cd) {
    const issues = [];
    if (!cd || typeof cd !== 'object') {
      return { valid: false, errorCount: 1, warnCount: 0,
               issues: [{ level: 'fatal', code: 'NO_DATA', msg: '卡片数据为空' }] };
    }
    const entries = (cd.character_book && cd.character_book.entries) || [];
    const regexScripts = (cd.extensions && cd.extensions.regex_scripts) || [];

    // ---- 主体字段 ----
    if (!cd.name || !String(cd.name).trim()) {
      issues.push({ level: 'error', code: 'NAME_EMPTY', msg: '名称为空', path: 'name' });
    }
    const descLen = String(cd.description || '').length;
    if (descLen === 0) {
      issues.push({ level: 'error', code: 'DESC_EMPTY', msg: '世界观描述为空', path: 'description' });
    } else if (descLen < 100) {
      issues.push({ level: 'warn', code: 'DESC_SHORT', msg: '世界观描述过短（' + descLen + '字，建议≥200）', path: 'description' });
    }
    if (!cd.first_mes || !String(cd.first_mes).trim()) {
      issues.push({ level: 'warn', code: 'FIRST_MES_EMPTY', msg: '开场白为空', path: 'first_mes' });
    }

    // ---- 条目结构与触发词 ----
    const seenComments = {};
    entries.forEach(function(e, i) {
      if (!e || typeof e !== 'object') {
        issues.push({ level: 'error', code: 'ENTRY_INVALID', msg: '条目 #' + i + ' 结构无效', path: 'character_book.entries[' + i + ']' });
        return;
      }
      const cmt = String(e.comment || '');
      if (!cmt) {
        issues.push({ level: 'error', code: 'ENTRY_NO_COMMENT', msg: '条目 #' + i + ' 缺少 comment', path: 'character_book.entries[' + i + ']' });
      } else {
        const norm = _stripOuterBrackets(cmt).trim().toLowerCase();
        if (norm && seenComments[norm]) {
          issues.push({ level: 'warn', code: 'ENTRY_DUPLICATE', msg: '条目「' + cmt + '」与之前的条目重复', comment: cmt });
        }
        seenComments[norm] = true;
      }
      const isConst = !!e.constant;
      const isMvuSys = isMVUEntry(cmt);
      const keys = Array.isArray(e.keys) ? e.keys : [];
      if (!isConst && !isMvuSys && keys.length === 0) {
        issues.push({ level: 'error', code: 'ENTRY_NO_KEYS',
          msg: '条目「' + (cmt || '#' + i) + '」非常驻且无触发词，永远无法激活',
          path: 'character_book.entries[' + i + ']', comment: cmt });
      }
      const ext = e.extensions || {};
      if (ext.match_whole_words === true && /[\u4e00-\u9fa5]/.test(keys.join(''))) {
        issues.push({ level: 'error', code: 'MATCH_WHOLE_WORDS_CN',
          msg: '条目「' + cmt + '」含中文触发词但 match_whole_words=true，触发会失效', comment: cmt });
      }
      if (_isInitVarComment(cmt, e.content) && e.enabled !== false) {
        issues.push({ level: 'error', code: 'INITVAR_ENABLED',
          msg: '[InitVar]条目「' + cmt + '」必须 enabled=false，否则会被注入上下文污染', comment: cmt });
      }
      ['sticky', 'cooldown', 'delay'].forEach(function(k) {
        if (ext[k] === 0) {
          issues.push({ level: 'warn', code: 'EFFECT_ZERO_' + k.toUpperCase(),
            msg: '条目「' + cmt + '」的 ' + k + '=0（应为 null 或正整数），可能导致意外行为', comment: cmt });
        }
      });
    });

    // ---- MVU 路径一致性 ----
    try {
      const mvuIssues = _validateMvuPathConsistency(cd);
      if (mvuIssues && mvuIssues.length) issues.push.apply(issues, mvuIssues);
    } catch (_e) { logWarn('validate.mvu', _e); }

    // ---- 正则脚本基本结构 ----
    regexScripts.forEach(function(r, i) {
      if (!r || typeof r !== 'object') {
        issues.push({ level: 'error', code: 'RX_INVALID', msg: '正则 #' + i + ' 结构无效' });
        return;
      }
      if (!r.findRegex) {
        issues.push({ level: 'error', code: 'RX_NO_FIND', msg: '正则「' + (r.scriptName || '#' + i) + '」缺少 findRegex' });
      }
      if (r.replaceString === undefined) {
        issues.push({ level: 'error', code: 'RX_NO_REPLACE', msg: '正则「' + (r.scriptName || '#' + i) + '」缺少 replaceString' });
      }
    });

    const errors = issues.filter(function(x) { return x.level === 'error' || x.level === 'fatal'; });
    return {
      valid: errors.length === 0,
      errorCount: errors.length,
      warnCount: issues.length - errors.length,
      issues: issues
    };
  }

  function _validateMvuPathConsistency(cd) {
    const issues = [];
    const entries = (cd.character_book && cd.character_book.entries) || [];
    const rxScripts = (cd.extensions && cd.extensions.regex_scripts) || [];

    let initVarEntry = null;
    for (let i = 0; i < entries.length; i++) {
      if (_isInitVarComment(entries[i].comment, entries[i].content)) { initVarEntry = entries[i]; break; }
    }
    if (!initVarEntry) return issues;

    const initVarKeys = {};
    try {
      const parsed = parseInitVar(initVarEntry.content || '');
      const collect = function(obj, prefix) {
        if (!obj || typeof obj !== 'object') return;
        Object.keys(obj).forEach(function(k) {
          const path = prefix ? (prefix + '.' + k) : k;
          initVarKeys[path] = true;
          const v = obj[k];
          if (v && typeof v === 'object' && !Array.isArray(v)) collect(v, path);
        });
      };
      collect(parsed, '');
    } catch (_e) {}

    let sbRegex = null;
    for (let j = 0; j < rxScripts.length; j++) {
      const r = rxScripts[j];
      if (!r) continue;
      if (String(r.findRegex || '').indexOf('StatusPlaceHolder') >= 0 && r.markdownOnly && !r.promptOnly) {
        sbRegex = r; break;
      }
    }
    if (!sbRegex) return issues;

    const html = String(sbRegex.replaceString || '');

    // 抽取所有 _.get(...) 第二参数里的 dotted 路径（兼容两种写法：
    //   _.get(allVars, "stat_data.XXX")   —— 旧写法
    //   const sd = _.get(allVars,"stat_data",{}); _.get(sd, "XXX.YYY")  —— 模板标准写法）
    const sbPaths = {};
    // 写法A：stat_data.XXX 全路径
    const getPathReA = /_\.get\s*\(\s*[^,]+,\s*["']stat_data\.([^"']+)["']/g;
    let gm;
    while ((gm = getPathReA.exec(html)) !== null) sbPaths[gm[1]] = true;
    // 写法B：第二参数是 "顶层.子层" 形式的短路径（含至少一个点，且首段是 CJK 或已知变量段）
    const getPathReB = /_\.get\s*\(\s*[^,]+,\s*["']([\u4e00-\u9fa5][\u4e00-\u9fa5\w]*\.[^"']+)["']/g;
    while ((gm = getPathReB.exec(html)) !== null) sbPaths[gm[1]] = true;
    Object.keys(sbPaths).forEach(function(p) {
      if (!initVarKeys[p]) {
        issues.push({ level: 'error', code: 'SB_PATH_MISMATCH',
          msg: '状态栏读取 stat_data.' + p + ' 但 [InitVar] 中不存在该路径，该变量将永远为空' });
      }
    });

    const usedIds = {};
    const idSelRe = /\$\(\s*['"]#([a-zA-Z0-9_-]+)['"]\s*\)/g;
    while ((gm = idSelRe.exec(html)) !== null) usedIds[gm[1]] = true;
    const definedIds = {};
    const idDefRe = /id\s*=\s*["']([a-zA-Z0-9_-]+)["']/g;
    while ((gm = idDefRe.exec(html)) !== null) definedIds[gm[1]] = true;
    // 白名单：预览时自动补的渲染根
    const ID_WHITELIST = { 'render-root': 1 };
    Object.keys(usedIds).forEach(function(id) {
      if (!definedIds[id] && !ID_WHITELIST[id]) {
        issues.push({ level: 'error', code: 'SB_ID_MISSING',
          msg: '状态栏 $(\'#' + id + '\') 引用的 id 在 HTML 中不存在，该 DOM 永远不被填充' });
      }
    });

    return issues;
  }

  // ============================================================================
  // SECTION 2  通用工具函数
  // ============================================================================
  // ===== Token估算 =====
  // ⚠️性能：CJK 正则提为模块级常量，避免 countTokens 在进度/预览循环中反复编译
  const RE_CJK = /[\u4e00-\u9fa5]/g;
  const RE_NON_CJK_SPLIT = /[\u4e00-\u9fa5]/g;

  function countTokens(text) {
    if (!text) return 0;
    const t = String(text);
    const cn = (t.match(RE_CJK) || []).length;
    const enWords = t.replace(RE_NON_CJK_SPLIT, ' ').split(/\s+/).filter(Boolean).length;
    return cn + Math.ceil(enWords * 0.75);
  }

  // ===== SvgIcons 组件系统 =====
  // 统一大小/描边，颜色继承 currentColor，与主题完美融合（参考文件7 stroke 风格）
  const SVG_PATHS = {
    // 通用操作
    close: 'M6 6l12 12M18 6L6 18',
    send: 'M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z',
    stop: 'M7 7h10v10H7z',
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
    // 进度统计模块图标（updateCtxBar / 预览区 modLabels 引用）
    key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
    document: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6M9 13h6M9 17h6',
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
        if (old) {
          // 先走完整关闭流程（触发 __cwBeforeClose / about:blank 销毁旧 document），再移除
          try { closeModal(); } catch (_) {}
          const stillOld = parentDoc.getElementById(SCRIPT_ID + '-modal');
          if (stillOld) stillOld.remove();
        }
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
      // ★ 清理过期快照：长会话可能累积大量 szxq_snap_* 键，只保留最新 200 个，防止 localStorage 膨胀
      try {
        const _allSnapKeys = Object.keys(localStorage).filter(function(k) { return k.indexOf('szxq_snap_') === 0; });
        if (_allSnapKeys.length > 200) {
          _allSnapKeys.sort();
          const _drop = _allSnapKeys.slice(0, _allSnapKeys.length - 200);
          _drop.forEach(function(k) { try { localStorage.removeItem(k); } catch (_) {} });
        }
      } catch (_snapClean) {}
      // ★ 加固 Bug3：清理生成/分析相关标志，防止关闭后残留触发
      try {
        if (typeof window !== 'undefined') {
          window.__cwAbortRequested = false;
          window.__cwCurrentGenId = null;
        }
      } catch (_flagClear) {}
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
        '__mvuDiscussMode', 'setMvuDiscussMode',
        '__agentMode', '__agentLoopApi', '__setChatSessionsFrontendMessages',
        '__agentAutoMode', '__getAgentAutoMode',
        // ↓ 新增：临时状态
        '__cwCurrentGenId', '__cwAbortRequested',
        '__cwBeforeClose'
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
    '变量当前状态': {
      constant: true,
      selective: false,
      position: 4,
      depth: 1,
      order: 69000,
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
      order: 79000,
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
      order: 79001,
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
      order: 79002,
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
  // 依据 ST 优先级链推导：position 主导大区，order 大区内定排序，depth 越小越强
  function _inferWeightLevel(e) {
    const ext = (e && e.extensions) || {};
    const pos = ext.position !== undefined ? ext.position : 4;
    const ord = e.insertion_order !== undefined ? e.insertion_order :
                (ext.order !== undefined ? ext.order : 100);
    const depth = ext.depth !== undefined ? ext.depth : 4;
    const posBase = { 0: 20, 1: 40, 2: 55, 3: 65, 5: 45, 6: 50, 7: 60 }[pos];
    let score;
    if (pos === 4) {
      const depthScore = Math.max(0, 80 - depth * 8);
      score = 40 + depthScore * 0.7 + Math.min(30, ord / 10);
    } else if (posBase !== undefined) {
      score = posBase + Math.min(35, ord / 10);
    } else {
      score = 40 + Math.min(35, ord / 10);
    }
    if (e.constant) score += 8;
    if (ext.ignore_budget) score += 15;
    if ((ext.useProbability || ext.useProbability === undefined) && ext.probability < 100) {
      score -= 10;
    }
    // ⚠️E1：不再返回裸 hex，改用 CSS 变量 + 显式 bg/border（避免 'var(...)' + '20' 拼接非法）
    if (score >= 95) return { level: '最高', color: 'var(--w-level-max)',   bg: 'var(--w-level-max-bg)',   border: 'var(--w-level-max-border)',   desc: 'ignoreBudget 强制保留 / AN 底部强约束' };
    if (score >= 80) return { level: '极高', color: 'var(--w-level-max2)',  bg: 'var(--w-level-max2-bg)',  border: 'var(--w-level-max2-border)',  desc: 'AN 区 / @D depth≤1 / order≥200' };
    if (score >= 65) return { level: '高',   color: 'var(--w-level-high)',  bg: 'var(--w-level-high-bg)',  border: 'var(--w-level-high-border)',  desc: 'AN 区中部 / @D depth≤3 / order≥150' };
    if (score >= 50) return { level: '中高', color: 'var(--w-level-high)',  bg: 'var(--w-level-high-bg)',  border: 'var(--w-level-high-border)',  desc: '角色定义后 / @D depth≤4' };
    if (score >= 38) return { level: '中',   color: 'var(--w-level-mid)',   bg: 'var(--w-level-mid-bg)',   border: 'var(--w-level-mid-border)',   desc: '常规触发条目 / 示例区' };
    if (score >= 25) return { level: '中低', color: 'var(--w-level-midlow)',bg: 'var(--w-level-midlow-bg)',border: 'var(--w-level-midlow-border)',desc: '角色定义之前 / order 偏小' };
    if (score >= 12) return { level: '低',   color: 'var(--w-level-low)',   bg: 'var(--w-level-low-bg)',   border: 'var(--w-level-low-border)',   desc: '角色定义之前 / order 极小的常驻' };
    return { level: '极低', color: 'var(--w-level-min)', bg: 'var(--w-level-min-bg)', border: 'var(--w-level-min-border)', desc: '底层打底条目 / 常驻弱影响' };
  }
  const WEIGHT_LEVELS = {
    '世界元数据': {
      level: '极低',
      color: 'var(--w-level-min)', bg: 'var(--w-level-min-bg)', border: 'var(--w-level-min-border)',
      desc: 'position=0 常驻，底层背景'
    },
    '状态栏': {
      level: '极高',
      color: 'var(--w-level-max2)', bg: 'var(--w-level-max2-bg)', border: 'var(--w-level-max2-border)',
      desc: 'position=2 depth=2 sticky粘性'
    },
    '统一输出格式': {
      level: '极低',
      color: 'var(--w-level-min)', bg: 'var(--w-level-min-bg)', border: 'var(--w-level-min-border)',
      desc: 'position=0 常驻'
    },
    '角色边界': {
      level: '极低',
      color: 'var(--w-level-min)', bg: 'var(--w-level-min-bg)', border: 'var(--w-level-min-border)',
      desc: 'position=0 常驻'
    },
    '禁止项': {
      level: '极低',
      color: 'var(--w-level-min)', bg: 'var(--w-level-min-bg)', border: 'var(--w-level-min-border)',
      desc: 'position=0 常驻，禁止规则'
    },
    '自定义条目': {
      level: '中',
      color: 'var(--w-level-mid)', bg: 'var(--w-level-mid-bg)', border: 'var(--w-level-mid-border)',
      desc: '用户自定义'
    },
    '[InitVar]初始变量': {
      level: '极低',
      color: 'var(--w-level-min)', bg: 'var(--w-level-min-bg)', border: 'var(--w-level-min-border)',
      desc: '第2条 | position=0(before_character_definition) insertion_order=100 常驻(enabled=false)，MVU变量初始化YAML'
    },
    '变量当前状态': {
      level: '极低',
      color: 'var(--w-level-min)', bg: 'var(--w-level-min-bg)', border: 'var(--w-level-min-border)',
      desc: '第4条 | position=4(at_depth d=1) order=69000 常驻，注入当前变量状态给LLM'
    },
    '[mvu_update]变量更新规则': {
      level: '低',
      color: 'var(--w-level-low)', bg: 'var(--w-level-low-bg)', border: 'var(--w-level-low-border)',
      desc: '第3条 | position=4(at_depth d=0) 常驻，依据schema生成check/type/range'
    },
    '[mvu_update]变量输出格式': {
      level: '低',
      color: 'var(--w-level-low)', bg: 'var(--w-level-low-bg)', border: 'var(--w-level-low-border)',
      desc: '第5条 | position=4(at_depth d=0) 常驻，固定中文格式定义<UpdateVariable>输出格式'
    },
    '[mvu_update]变量输出格式强调': {
      level: '低',
      color: 'var(--w-level-low)', bg: 'var(--w-level-low-bg)', border: 'var(--w-level-low-border)',
      desc: '第6条 | position=4(at_depth d=0) 默认enabled=false，AI不输出<UpdateVariable>时启用'
    },
    '<状态栏>占位符提醒': {
      level: '极低',
      color: 'var(--w-level-min)', bg: 'var(--w-level-min-bg)', border: 'var(--w-level-min-border)',
      desc: '第7条 | position=4(at_depth d=0) 常驻，提醒AI输出<StatusPlaceHolderImpl/>'
    },
    '状态变量输出': {
      level: '中',
      color: 'var(--w-level-mid)', bg: 'var(--w-level-mid-bg)', border: 'var(--w-level-mid-border)',
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
    if (comment.indexOf('变量当前状态') >= 0) return ENTRY_TEMPLATES['变量当前状态'];
    if (comment.indexOf('状态变量输出') >= 0) return ENTRY_TEMPLATES['状态变量输出'];
    // 第7条：<状态栏>占位符提醒条目（含"状态栏"+"占位符"或"提醒"）
    if (comment.indexOf('状态栏') >= 0 && (comment.indexOf('占位') >= 0 || comment.indexOf('提醒') >= 0)) {
      // 复用"状态栏"模板（selective触发式），但实际第7条应为constant=true常驻
      // 这里返回变量当前状态模板作为基础（constant=true, position=4, depth=1, order=69000）
      return ENTRY_TEMPLATES['变量当前状态'];
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

  // ===== 内容特征推断：AI 不显式写字段时，按 comment/content 语义智能补默认 =====
  // 优先级：AI 显式元信息 > 此推断 > 模板 > 通用兜底
  // ★松绑2.6：只做最基础的"位置建议"，不再强制 constant（comment 出现"角色"不必然常驻——用户可能想要"提到才展开"）
  function inferEntryConfig(comment, content) {
    const cfg = {};
    const cmt = String(comment || '');
    const body = String(content || '');
    const c = cmt + '\n' + body.slice(0, 800);

    // 概率类（AI 很少自己写，保留）
    if (/极低概率|千分之一|百万分之一|几乎不可能/.test(c)) {
      cfg.probability = 5; cfg.useProbability = true;
    } else if (/低概率|小概率|稀有|偶尔|万里挑一|极少数|罕见/.test(c)) {
      cfg.probability = 20; cfg.useProbability = true;
    } else if (/中概率|有时|时常|偶尔会/.test(c)) {
      cfg.probability = 50; cfg.useProbability = true;
    }

    const stickyM = c.match(/持续\s*(\d+)\s*(?:楼|条|轮)/);
    if (stickyM) cfg.sticky = parseInt(stickyM[1], 10);
    const cdM = c.match(/冷却\s*(\d+)/);
    if (cdM) cfg.cooldown = parseInt(cdM[1], 10);
    const delayM = c.match(/延迟\s*(\d+)/);
    if (delayM) cfg.delay = parseInt(delayM[1], 10);

    // 位置建议（不强制 constant；position 只分 0/1/4 三档基础建议，其余交给模板兜底）
    if (/世界观|世界设定|总纲|meta规则/.test(cmt)) {
      cfg.position = 0;
      cfg.order = cfg.order || 80;
    } else if (/人物|角色|主角|NPC|势力|地点/.test(cmt)) {
      cfg.position = 1;
      cfg.order = cfg.order || 100;
    } else if (/当前|剧情|进度|任务|此刻|实时|本轮/.test(cmt)) {
      cfg.position = 4;
      cfg.order = cfg.order || 150;
    } else {
      cfg.position = 0;
      cfg.order = cfg.order || 100;
    }

    // 示例/作者注/出口（保留精确位置，防止落错大区）
    if (/示例|对话示例|示范|sample|开场范例/.test(cmt)) {
      cfg.position = 5;
      cfg.order = cfg.order || 100;
    }
    if (/作者注|旁白|meta|注记/.test(cmt)) {
      cfg.position = 2;
      cfg.order = cfg.order || 100;
    }
    if (/出口|outlet|注入点/.test(cmt)) {
      cfg.position = 7;
      cfg.order = cfg.order || 100;
    }
    return cfg;
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
  // （如 <自定义条目>变量当前状态使用说明 的核心名是"变量当前状态使用说明"，不等于"变量当前状态"，不应被规范化）
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

  // ===== 判定是否为"变量当前状态"MVU条目 =====
  // ⚠️ 原先多处写成 comment 同时含"变量当前状态"和"format_message_variable"才识别——
  // 但 comment 本身就是"变量当前状态"，永远不含 format_message_variable，导致该条目在
  // 角色卡Tab过滤/MVU Tab收集/解析拦截三处全部漏网（隔离失效+重复建条）
  function _isVarListEntry(comment, content) {
    const c = String(comment || '');
    if (_entryCommentCore(c) === '变量当前状态') return true;
    if (c.indexOf('变量当前状态') >= 0) {
      const ct = String(content || '');
      // 内容含 {{format_message_variable::stat_data}} 宏（新版固定模板的唯一注入宏）
      // ★修复#16：子串匹配 → 宏形态精确匹配，避免正文里仅"提到"该宏名的普通条目被误判为 MVU 条目
      if (/\{\{format_message_variable::stat_data\}\}/.test(ct)) return true;
    }
    return false;
  }

  // ===== 🔑 自动派生触发词（写卡器兜底防线 · 对齐 StageDog 绿灯/向量化/蓝灯策略）=====
  // 仅当 keys 为空时才派生；蓝灯(constant=true)与向量化(vectorized=true)保持空不变
  // ⚠️性能：触发词停用词表提为模块级常量（_deriveEntryKeys 对每条条目调用，避免反复创建对象）
  const _DERIVE_STOP_WORDS = {
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
    '设定': 1
    // ★松绑2.2：只保留纯虚词 + comment 无信息量词。删除全部降权词（背景/机制/规则/系统/状态/类型/模式/玩法/流程）
    //   ——这些是实义词，用户可能真的想用"规则/系统"做触发词；_degraded 兜底逻辑已同步删除。
  };

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
    const stopSet = _DERIVE_STOP_WORDS;
    const candidates = [];
    // 1) 先提取 名字后缀中"·中文点号"切分出的多段，作为多维度命名（如 白娅·人际关系 → 白娅/人际关系）
    if (namePart) {
      namePart.split(/[·\/,，、\-\\]+/).forEach(function(seg) {
        const s = seg.trim();
        if (!s) return;
        if (/[\u4e00-\u9fa5A-Za-z0-9]{2,}/.test(s)) {
          if (!stopSet[s]) candidates.push(s);
        }
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
    // 去重 + 限制数量（★松绑2.3：上限=CONFIG.DERIVE_KEYWORD_MAX=8）
    const uniq = [];
    for (let ci = 0; ci < candidates.length; ci++) {
      const c = String(candidates[ci]).trim();
      if (!c || c.length < 1 || c.length > 24) continue;
      if (uniq.indexOf(c) < 0) uniq.push(c);
      if (uniq.length >= CONFIG.DERIVE_KEYWORD_MAX) break;
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
    const isMvu = c.indexOf('[initvar]') >= 0 || c.indexOf('变量当前状态') >= 0 ||
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
    // 触发条件：出现 content 根键（条目被对象化的铁证），或 ≥1 个根级配置字段
    // （阈值从 <2 放宽到 <1：AI 只多写一行 enabled:false 也会漏网）
    // ★修复#6：触发条件收紧——必须 有 content 根键（对象化铁证）或 ≥3 个根级配置字段才清洗，
    //   避免普通自定义条目（如游戏变量本身叫"开启"）因 1 个配置字段被误判整块清洗
    if (!hasContentKey && rootConfigCount < 3) return content;

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
    if (result2) return result2;
    // 🐛修复：无正文残留时——若存在 content 根键（对象化条目），说明 AI 意图清空正文，返回空字符串而非原文；
    // 非对象化条目（无 content 键）保留原文（此时整段都是配置行，保守不清洗）
    return hasContentKey ? '' : content;
  }

  // 判断条目是否属于MVU变量系统
  // 兼容大小写前缀：[InitVar]/[initvar]、[mvu_update] 等
  // 扩展：包含8条工作流条目 + 附加条目（阶段判定/人设切换/派生字段/状态机/联动规则等）也视为MVU体系条目
  // ⚠️变量分段/EJS 已按六大标准模板规范移除，不再视为 MVU 体系条目
  function isMVUEntry(comment) {
    const c = (comment || '').toLowerCase();
    // ★松绑2.5：只留 MVU 原生标识（删"阶段判定/人设切换/系统模式/状态机/联动规则"等普通名词——用户自定义条目不再被误判为 MVU 资产）
    // ★松绑P1-3：'状态栏' 收窄为仅 <状态栏> 前缀条目（MVU 第8条标准资产名 <状态栏>占位符提醒），
    //   避免"<自定义条目>状态栏使用说明 / 状态栏配色方案"等普通条目被误判为 MVU
    return c.indexOf('[initvar]') >= 0 || c.indexOf('变量当前状态') >= 0 ||
      c.indexOf('变量更新规则') >= 0 || c.indexOf('变量输出格式') >= 0 ||
      c.indexOf('状态变量输出') >= 0 || c.indexOf('updatevariable') >= 0 ||
      c.indexOf('statusplaceholder') >= 0 || c.indexOf('mvu_update') >= 0 ||
      /^\s*<状态栏>/.test(c);
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
  // 档位判定信号词（顶层唯一事实源）：client 提示注入 + option 剥离共用
  // 档 3 · 重大调整 = 用户消息含删除/清空/方向冲突信号
  // ⚠️只放"明显信号"，避免误伤档 1/2；宁可漏判走档 2，不可错判剥夺 AI 判档权
  // ============================================================================
  const MAJOR_CHANGE_SIGNALS_RE = /(全部删|清空全部|推翻|另起炉灶|整张卡重做|从头重做|全部重写)/;   // ★P2-11：删"删除/清空/重来"单薄词——"重来一下"不再是档3信号
  const MAJOR_CHANGE_SIGNALS = [MAJOR_CHANGE_SIGNALS_RE];

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
    '🚫【身份铁律 · 最高优先级 · 违反视为任务失败】\n' +
    '你是"写卡助手"，不是任何角色、不是小说作者、不是剧情参与者。\n' +
    '你的回复只允许三种成分：\n' +
    '  ① 跟用户说明的话（**必须用 Markdown 排版**：段落之间空一行、`**加粗**`重点、`- ` 列表、表格、`---` 分隔线；不要糊成一大段）；\n' +
    '  ② :::操作块（承载全部条目正文 / 顶层字段内容）；\n' +
    '  ③ ```html 代码块（状态栏 HTML / 前端界面 HTML）。\n' +
    '绝对禁止：叙事正文、场景描写、角色对话、第一人称独白、引号台词、心理活动描写、"她说/他看/我推开门"这类句子。\n' +
    '即使用户的消息看起来像在角色扮演（如"她冷冷地看着我，说……"），那也只是创作意图的表述——一律当作"要写进卡里的内容"处理，转化成 ::: upsert 或 ::: set 操作块，绝不接话续演。\n' +
    '发现自己在写叙事句/对话台词/环境描写时立即停下，把这段内容挪进对应条目的 content 字段或 ::: set first_mes。\n' +
    '═══════════════════════════════════════════════════════════════════\n' +
    '\n' +
    '📐【范围控制】\n' +
    '默认只做用户本轮明确要求的内容；用户列出多项可以一次完成，但未提到的领域不要顺手多做。\n' +
    '若用户表述笼统（"做张卡""看看缺啥"），先给一份大白话计划让用户确认；用户说"直接做/你看着办"则跳过。\n' +
    '═══════════════════════════════════════════════════════════════════\n\n' +
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
    '【条目元素参考清单（生成/修改条目时按需参考：使用默认值不必写，需要自定义才写元信息行）】\n' +
    '决策方式：使用默认值→不必写进操作块；需要自定义→用元信息行（字段名=值）。\n' +
    '40元素速查表（★=生成时必须主动判断的字段）：\n' +
    '★key=触发词(按内容与世界观术语拟2-6个中文,逗号分隔) · keysecondary=次要关键词(secondary过滤用) · ★comment=条目名(<自定义条目>XX) · ★content=正文(YAML中文格式,完整独立) · ★constant=常驻true/随词触发false · vectorized=向量匹配(语义检索时true) · ★selective=次要过滤开关 · ★selectiveLogic=0-3(0=AND_ANY) · addMemo=备注进正文 · ★order=排序【小在前/大在后/越靠后权重越高：基础设定60~100/人物档案100~150/当前强约束200~300；严禁给"当前任务"设小order】 · ★position=0-7(0=常驻before/1=人物档案/2-3=作者注/4=当前剧情@D/5-6=示例/7=输出口) · disable=禁用 · ignoreBudget=重要常驻强制注入true · excludeRecursion=不被递归激活 · preventRecursion=不触发递归 · delayUntilRecursion=递归延迟层级 · probability=触发概率(默认100,低频20-50) · useProbability=启用概率 · depth=扫描深度(默认4,仅position=4生效) · role=0-3(仅position=4:0=system/1=user/2=assistant) · outletName(仅position=7) · group=互斥分组 · groupOverride=分组按order优先 · groupWeight=分组权重 · scanDepth=条目级扫描深度(默认null继承全局) · caseSensitive=大小写敏感(中文默认null) · ★matchWholeWords=全词匹配【中文必须false!】 · useGroupScoring=组评分 · automationId=脚本自动化ID · sticky=黏性持续N条(默认null) · cooldown=冷却N条(默认null) · delay=延迟N条(默认null) · triggers=生成触发器(默认空=所有场景;可选normal/continue/impersonate/swipe/regenerate/quiet) · characterFilter=角色过滤{"names":[],"tags":[],"isExclude":false} · matchCharacterDescription/Personality/Scenario/PersonaDescription/CharacterDepthPrompt/CreatorNotes=六种角色匹配开关(默认false)\n' +
    '⚠️禁止事项：禁止字段名 ignoreMaxBudget/matchCharacterNote/matchCreatorsNotes/excludeFilter；sticky/cooldown/delay 无效果时写null禁止写0；entries禁止写成数组；characterFilter禁止写成扁平数组。\n' +
    '\n' +
    '【★字段语义决策规则（本表优先于上方40元素清单；上方清单仅作字段名查阅用）】\n' +
    '先判断条目类型→再查本表→只写需要自定义的字段；无需自定义的字段保持默认即可：\n' +
    '①constant：世界观底层规则/人设总纲/必须背景/MVU变量系统条目→true；具体人物/地点/事件/道具/场景细节→false\n' +
    '②position：全局前置规则(写作风格/安全边界/总纲)→0；角色/世界观定义→1；剧情当前状态/动态信息/状态栏占位→4(at_depth)；作者注相关→2/3；示例消息相关→5/6\n' +
    '③depth(仅position=4)：永远要看的关键提醒→1-2；一般触发→4；近期对话才有意义(如"刚才的伤")→2-3；远景伏笔→6-8\n' +
    '④selectiveLogic：主关键词命中即触发→0；必须主+次全命中(如"白娅"+"战斗")→3；主命中但排除某场景→1；主命中且完全不含次关键词→2\n' +
    '⑤probability+useProbability：每次都触发→省略(默认100)；低频/随机事件(深夜访客/偶遇)→probability=20-50,useProbability=true；正文写"低概率/稀有"→5-15\n' +
    '⑥sticky/cooldown/delay：无效果→null(禁止写0)；触发后持续N楼保持→sticky=N；触发后冷却N楼→cooldown=N；对话开始后延迟N楼激活→delay=N\n' +
    '⑦group：同类型只允许同时出现一个→填分组名(如"角色类"/"地点类")；不互斥→空；同组按order顺序→groupOverride=true；偏好某条→group_weight调高\n' +
    '⑧scanDepth：一般跟随全局→null；只扫最近几楼(临时状态)→2-4；深扫历史(伏笔回收)→8-12\n' +
    '⑨matchWholeWords：中文→false；英文/代码词→true\n' +
    '⑩role(仅position=4)：一般系统提示→0；模拟用户发言→1；模拟角色发言→2\n' +
    '⑪preventRecursion/excludeRecursion：触发后不再引发其他条目→preventRecursion=true；自身不被他条递归激活→excludeRecursion=true；一般条目省略\n' +
    '\n' +
    '【典型条目字段配置示例】\n' +
    '· 当前剧情状态：constant=true, position=4, depth=2, order=200（⚠️强时效约束，order 必须靠后才不被前区裁掉）\n' +
    '· 世界观地理总纲：constant=true, position=0, order=80（基础打底，order 小让位给后区强约束）\n' +
    '· 人物"白娅"：constant=false, keys=白娅,白娅小姐, position=1, order=120, depth=4, selectiveLogic=0\n' +
    '· 稀有事件"月圆之夜"：constant=false, keys=月圆之夜,满月, probability=30, useProbability=true, cooldown=20\n' +
    '· 伏笔"旧伤"：constant=false, keys=旧伤,伤痕, position=4, depth=5, delay=15（远期线索，深插历史）\n' +
    '\n' +
    '【★智能选位 · 条目优先级与权重规则（生成时务必据此决策 position/order/depth/group）】\n' +
    'ST 世界书按"大区→插入策略→order→分组→预算"5 层链决定优先级，越靠后的信息对 AI 输出影响越大。\n' +
    '【第1层 · position 定大区（永远最先判定，order 再大也不能跨区）】\n' +
    '  0=before_char（弱影响，打底常驻）  1=after_char（中等）  2=before_an（AN顶部·较强）\n' +
    '  3=after_an（AN底部·最强）  4=@D 深度（独立注入聊天历史）  5/6=示例前/后  7=outlet\n' +
    '  判定口诀：世界观总纲/铁律/写作风格→0；人物身份/性格/关系网/势力/地点档案→1；\n' +
    '            当前剧情状态/临时动态/伏笔线索→4(@D)；作者注/元评论→2或3；示例/对话→5或6。\n' +
    '【第2层 · 插入策略（全局/角色世界书混合）——写卡器不改，但生成时必须知道】\n' +
    '  默认：角色条目 + 全局条目按 order 混排；策略可在 ST 世界书顶层配置。\n' +
    '【第3层 · order 同区排序（⚠️最常见误区）】\n' +
    '  核心口诀：order 数值越【小】越靠前、越【大】越靠后、越靠后权重越高。\n' +
    '  长期基础设定（世界观/人设总纲）→ 60~100（靠前，让位给强约束）\n' +
    '  常规人物/势力/地点条目 → 100~150\n' +
    '  当前生效规则/需要强约束 AI 的指令 → 200~300（靠后，最后下发，AI 最重视）\n' +
    '  ⚠️ 反例：给"当前任务""绝对命令"设 order=50 → 反而被提到前区、被削弱。\n' +
    '【第4层 · depth（仅 position=4 生效，独立轴，不参与大区排序）】\n' +
    '  depth=0/1：紧贴最新消息 → 最强影响（当前事件/紧急状态）\n' +
    '  depth=2~3：场景级/本幕相关（当前地点、在场人物）\n' +
    '  depth=4~5：跨场景线索（伏笔/回忆/约定）\n' +
    '  depth=6~8：远期背景/秘辛 → 影响最弱\n' +
    '【第5层 · group / groupWeight / groupOverride】\n' +
    '  同类互斥条目（不同时期的同一地点、不同阵营的同一人物）→ 放同一 group；\n' +
    '  同组默认 groupWeight=100；groupOverride=true 时同组按 order 高覆盖低。\n' +
    '【预算裁剪（ignoreBudget 的用法）】\n' +
    '  预算不足时：position 越靠前 + order 越小的条目【越先被裁】；\n' +
    '  必须保留的核心条目（世界观总纲、MVU骨架）→ ignoreBudget=true 强制不裁。\n' +
    '【触发与常驻（constant / selective）】\n' +
    '  长期铁律、世界观骨架、MVU 系统条目 → constant=true（无视关键词每轮必注入）；\n' +
    '  人物/事件/伏笔 → constant=false + selective=true（命中 keys 才插入）。\n' +
    '【概率触发（probability / useProbability）】\n' +
    '  只有"随机事件/稀有触发"才用（20~50）；常驻和强约束条目必须 probability=100 + useProbability=false。\n' +
    '【最终口诀（生成时默念）】\n' +
    '  先看位置定大区，同区策略分角色，序小在前序大后，越靠后权重越高。\n' +
    '  分组叠加组权值，深度单独插聊天。预算不够先砍前，无视预算必保留。\n' +
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
    '- 键名命名自由，与世界观术语一致\n' +
    '- 禁止在正文中出现 JSON/代码语法，禁止把 keys= 等元信息写进正文\n' +
    '- 世界观描述(description)、开场白(first_mes/alternate_greetings) 同样用分段/分点结构，禁止整段糊成一团\n' +
    '- 【内容独立完整】酒馆只把 content 注入上下文，触发词/标题/备注一律不进上下文。因此每个条目正文必须自包含、完整可独立理解，禁止写"见其他条目"、"详见上方"、依赖标题才能读懂的内容\n' +
    '- 【递归联动】条目正文可以主动提及另一条目的触发词（如正文写"她的伙伴露芙"），酒馆会自动递归激活对应条目，让设定按需展开；涉及关联设定的条目内容应互相串起触发词\n' +
    '- 【内容长度】条目内容字数完全自由，按设定需要充分展开，无需刻意控制长度；信息密度优先，避免无意义空话\n' +
    '\n' +
    '【世界观描述与开场白生成（参考 chara_card_v3 模板字段结构）】\n' +
    '- 世界观描述：::: set description\n（完整世界观描述正文，覆盖世界核心设定：地理/历史/势力/规则/种族等，用分段+要点列出）\n:::\n' +
    '- 开场白1：::: set first_mes\n（开场白正文，尽量详细，结构：场景描写→动作驱动→内心独白→自然对话→结尾留钩；开场白决定角色的交流风格，越长后续回复越不容易过短）\n:::\n' +
    '- 开场白2/3（以此类推，多条用---分割）：::: set alternate_greetings\n（开场白2正文）\n---分割---\n（开场白3正文）\n:::\n' +
    '- 性格总结：::: set personality\n（自由描述世界/角色性格特征，如"沉稳睿智、外冷内热"，长短不限，按需展开）\n:::\n' +
    '- 场景：::: set scenario\n（互动发生的环境与背景设定，包括地点、氛围、当前状态）\n:::\n' +
    '- 对话示例：::: set mes_example\n（1-2组示例对话，每组前用<START>标签分隔，{{user}}代表用户、{{char}}代表角色，示范角色的说话风格与语气）\n:::\n' +
    '- 角色名：::: set name\n（世界/角色名称）\n:::\n' +
    '- ★可写字段参照（chara_card_v3 / v2CharData 官方顶层字段，需要哪个用 ::: set 输出哪个）：name、description（世界观描述）、personality（性格总结）、scenario（场景）、first_mes（开场白1）、alternate_greetings（备用开场白数组，酒馆聊天界面可切换，{{charFirstMessage::N}} 取第N条）、mes_example（对话示例）、creator_notes（创作者注释）、tags（标签）、system_prompt（角色主提示词覆盖，可用 {{original}} 占位原始内容）、post_history_instructions（历史后指令覆盖）、depth_prompt（@深度提示）。内容文本字段（description/first_mes/alternate_greetings/mes_example/条目content）中才可用酒馆宏；结构化字段（name/tags/system_prompt/post_history_instructions 等）保持纯文本。\n' +
    '\n' +
    '【条目生成原则（★必须遵守）】\n' +
    '- 生成条目时，按需填写会影响该条目生效的字段（触发型必填 keys；常驻型必填 constant=true；需要自定义位置的写 position/depth）；其余保持默认即可，不必逐项过一遍。\n' +   // ★P2-7：不再强制 40 元素逐项决策
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
  // ★修复#7：正文相似度比较前剔除"结构性模板行"（性格:/外貌:/能力:/身份: 等固定键前缀行），
  //   只保留具体内容参与 bigram 比较——防止两条同结构模板条目因"性格：xxx"骨架雷同被过度合并
  function _stripStructRows(str) {
    return String(str || '').split(/\n/).filter(function(l) {
      return !/^\s*(?:性格|外貌|能力|身份|背景|特征|爱好|特长|关系|职业|年龄|身材|穿着|习惯|口头禅|弱点|优点|喜好|厌恶|目标|信念|记忆|秘密|立场|态度|举止|神情|语气|风格|气质|谈吐|社交|战斗|法术|技能|物品|装备|武器|道具|丹药|功法|境界|等级|势力|宗门|家族|地位|称号|名字|姓名|称呼|性格特点|外貌描写)[：:]\s*/.test(l);
    }).join('\n');
  }

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
        const neHead = _stripStructRows(neContent).slice(0, CONFIG.MATCH_CONTENT_HEAD);
        const _neSuf = getSuffix(neComment, nePrefix);
        let best = null;
        samePrefixEntries.forEach(function(x) {
          const exHead = _stripStructRows(x.c).slice(0, CONFIG.MATCH_CONTENT_HEAD);
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
  //   before_char→0  after_char→1  before_an→2  after_an→3
  //   at_depth(@N)→4（深度另存于 depth 字段）  before_example_messages→5  after_example_messages→6
  //   EMTop→5  EMBottom→6  outlet→7；数字字符串"0"~"7"也转数字
  function _posToNum(posRaw) {
    if (typeof posRaw === 'number') return posRaw;
    if (typeof posRaw !== 'string') return 4;
    const s = posRaw.trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s.charAt(0) === '@') {
      // ST 中 @N 表示 "at_depth, depth=N"——position 返回 4，深度由调用方从 @N 里取走存入 depth 字段
      const pn = parseInt(s.slice(1), 10);
      if (!isNaN(pn) && pn >= 0) return 4;
      return 4;
    }
    const map = {
      'before_char': 0, 'before_character_definition': 0,
      'after_char': 1, 'after_character_definition': 1,
      'before_an': 2, 'before_author_note': 2,
      'after_an': 3, 'after_author_note': 3,
      'at_depth': 4,
      'before_example_messages': 5, 'emtop': 5,
      'after_example_messages': 6, 'embottom': 6,
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
    // ========== Agent 模式：无 Tab 隔离 ==========
    // ======================================================================
    // 旧版（三Tab）在此处做双向硬拦截：角色卡Tab拦MVU、MVU Tab拦角色卡主体。
    // Agent 版只有一个会话，AI 可在同一对话里自由生成角色卡/MVU/前端内容，
    // 因此双向拦截整体跳过（MVU 固定资产保护仍由下方 isFixedMvuScript 等逻辑兜底）。
    // ======================================================================
    let _activeTab = 'card';
    if (typeof window !== 'undefined') {
      // 1. 优先 window.__getActiveTab()（最新闭包，每次switchTab都会重新绑定）
      if (typeof window.__getActiveTab === 'function') {
        try {
          const _t = window.__getActiveTab();
          if (_t === 'card' || _t === 'mvu' || _t === 'frontend') _activeTab = _t;
        } catch (_eTabA) {}
      }
      // 2. 降级 window.__tab_activeTab（同步标记值）
      if (_activeTab !== 'mvu' && window.__tab_activeTab) {
        _activeTab = (window.__tab_activeTab === 'mvu' || window.__tab_activeTab === 'frontend') ? window.__tab_activeTab : 'card';
      }
    }
    // 3. 最后作用域 activeTab/currentTab 兜底
    try {
      if (typeof activeTab !== 'undefined' && (activeTab === 'card' || activeTab === 'mvu' || activeTab === 'frontend')) _activeTab = activeTab;
      else if (typeof currentTab !== 'undefined' && (currentTab === 'card' || currentTab === 'mvu' || currentTab === 'frontend')) _activeTab = currentTab;
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

    if (!AGENT_MODE && _activeTab === 'card') {
      // ===================== （旧版三Tab逻辑，Agent版已停用）角色卡Tab：硬拦截所有MVU写入 =====================
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
    } else if (!AGENT_MODE && _activeTab === 'mvu') {
      // ===================== （旧版三Tab逻辑，Agent版已停用）MVU Tab：只允许修改白名单字段，禁止改动角色卡主体 =====================
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
      // 允许通过的：MVU变量条目（InitVar/变量当前状态/更新规则/输出格式/格式强调/占位提醒等）/ 阶段判定 / EJS控制器 / 人设切换 / 派生字段 / 状态机 / 自定义变量相关条目 等
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

    // ====== Agent模式（原MVU Tab专属）：写入前对已有数据做去重清理 ======
    // 问题根因：AI 多次生成 MVU 条目时，comment 可能稍有不同（如 [mvu_update]变量更新规则 vs 变量更新规则），
    // findMatchingEntry 无法匹配 → 产生重复条目。正则脚本也有类似问题。
    // 解决方案：写入新数据前先清理已有数据中的重复项（仅对MVU类型条目生效，普通世界书条目不受影响）。
    if (AGENT_MODE || _activeTab === 'mvu') {
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
        // 原先 <自定义条目>变量当前状态使用说明 这类普通条目会被 normalizeVarListContent 无条件覆盖为固定串，内容被摧毁
        const neCore = _entryCommentCore(ne.comment || '');
        if (_isInitVarComment(ne.comment, ne.content)) {
          if (typeof ne.content === 'string') ne.content = normalizeInitVarContent(ne.content);
        }
        if (neCore === '变量当前状态' && typeof ne.content === 'string') {
          ne.content = normalizeVarListContent(ne.content);
        }
        // 变量输出格式/强调条目：强制使用固定模板，丢弃AI混入的变量值/配置字段
        if ((neCore === '变量输出格式' || neCore === '变量输出格式强调') && typeof ne.content === 'string') {
          ne.content = normalizeVarOutputFormatContent(ne.comment || '', ne.content);
        }
        // 变量更新规则条目：规范化缩进/range格式/移除string的type字段
        if (neCore === '变量更新规则' && typeof ne.content === 'string') {
          ne.content = normalizeVarUpdateRuleContent(ne.content);
        }
        // 内容特征推断（与 applyOps upsert 同口径）：AI 没写的字段按 comment/content 语义补默认
        try {
          const _inf = inferEntryConfig(ne.comment || '', ne.content || '');
          const _isExtField = function(k) {
            return /^(depth|position|probability|useProbability|sticky|cooldown|delay|selectiveLogic|group|group_weight|prevent_recursion|exclude_recursion|delay_until_recursion|scan_depth|match_whole_words|role|vectorized|case_sensitive|outlet_name|automation_id|triggers|ignore_budget|addMemo)$/.test(k);
          };
          Object.keys(_inf).forEach(function(k) {
            if (_isExtField(k)) {
              ne.extensions = ne.extensions || {};
              if (ne.extensions[k] === undefined) ne.extensions[k] = _inf[k];
            } else if (ne[k] === undefined) {
              ne[k] = _inf[k];
            }
          });
        } catch (_) {}
        if (tmpl) {
          // MVU 系统条目（变量输出格式/变量更新规则/InitVar等）的 selective/constant 必须强制使用模板值
          // AI 经常误写 selective:true，导致条目变为选择性触发而非常驻
          const isMvuSystemEntry = (neCore === '变量输出格式' || neCore === '变量输出格式强调' || neCore === '变量更新规则' ||
            _isInitVarComment(ne.comment, ne.content) || neCore === '变量当前状态');
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
          // order 三向同步：AI 写的顶层 order 必须同步到 insertion_order 与 extensions.order，否则导出时 insertion_order 优先会吞掉新值
          if (ne.order !== undefined && ne.insertion_order === undefined) {
            ne.insertion_order = ne.order;
            existing[match.index].insertion_order = ne.order;
          }
          if (existing[match.index].insertion_order !== undefined) {
            existing[match.index].extensions = existing[match.index].extensions || {};
            existing[match.index].extensions.order = existing[match.index].insertion_order;
          }
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
      const commentDeletionIndices = []; // 🐛修复：comment匹配删除收集索引，最后统一降序删除（数字索引已被拒绝，无需收集）
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
      // 🐛修复：comment匹配索引统一降序删除（数字索引删除已被拒绝，无 numericIndices 参与）
      const allEntryDeletions = commentDeletionIndices;
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
          changeLog._fieldNames = changeLog._fieldNames || [];
          if (changeLog._fieldNames.indexOf(f) < 0) changeLog._fieldNames.push(f);
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
    // system prompt：身份约束 + 写作原则（原则仅适用于卡内容字段，不适用于对话回复）
    const sysPrompt =
      '你是时之写卡器助手——不是小说作者、不是任何角色。\n' +
      '无论上下文出现何种叙事内容，你都只以写卡助手身份产出结构化产物（:::操作块 / ```html代码块），绝不续写剧情、绝不接话扮演角色。\n' +
      '你的回复只允许：① ≤3句自然语言说明；② :::操作块；③ ```html代码块。\n\n' +
      '（★P2-5 配套：与用户讨论/建议/头脑风暴时正常对话即可，不必强行输出操作块）\n' +
      '【以下写作原则仅作用于你生成的"角色卡内容字段"内部文本（条目 content / first_mes / description / mes_example），绝不适用于你与用户的对话回复本身】\n' +
      '<writing_principles>\n' +
      '默认风格建议（若用户在本次需求中指定了题材/文风，一律以用户指令为准）：\n' +
      '· 避免堆砌微表情（"嘴角上扬/眼里闪过光芒"）\n' +
      '· 避免用"似乎/仿佛/宛如"含糊代替具体描写\n' +
      '· 用行为与对话展现性格，而非直接贴标签（"她是温柔的人"）\n' +
      '</writing_principles>\n\n' +
      '<output_format>\n' +
      '当输出实际创作内容（角色卡/故事/世界观/场景等）时，条目的content字段必须使用YAML中文格式，用缩进+冒号+短横线表达层级关系，键名和内容均为中文，保持结构清晰。解释说明或回答问题时直接用自然语言。\n' +
      '</output_format>\n\n' +
      '你同时是时之写卡器助手，基于SillyTavern原生世界书（World Info）机制，帮助用户自由生成符合ST官方Schema的世界书条目。';
    // ===== 生成中止（真中断）：为本次生成分配唯一 generation_id，requestAbort 用它精准停止 =====
    // 酒馆助手(JS-Slash-Runner)的 stopGenerationById 只认这个 ID；静默生成下这是唯一能真正中断请求的方式
    const _genId = 'szxq-writer-' + Date.now();
    try { window.__cwCurrentGenId = _genId; } catch (_gidErr) {}
    try {
      if (typeof generate === 'function') {
        const result = await withTimeout(generate(Object.assign({
          user_input: prompt,
          should_silence: true,
          max_chat_history: 0,
          generation_id: _genId
        }, genParams)), CALLAI_TIMEOUT_MS, 'generate');
        if (isValidAIReply(result)) return result.trim();
        if (result && typeof result === 'object' && result.content && String(result.content).trim().length > 0) return String(result.content).trim();
        if (result && typeof result === 'string') errors.push('generate returned: ' + result.substring(0, 80));
      }
    } catch (e) {
      errors.push('generate: ' + e.message);
    }
    // ⚠️用户已请求停止：主路径被中止后不得落到下一条回退策略（否则会发起一次新的生成，停止失效）
    if (window.__cwAbortRequested) throw new Error('__USER_ABORT__');
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
          max_chat_history: 0,
          generation_id: _genId
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
      missing: ['第1条 变量结构脚本(zod)', '第2条 [InitVar]初始变量', '第3条 [mvu_update]更新规则', '第4条 变量当前状态', '第5条 [mvu_update]输出格式', '第6条 [mvu_update]输出格式强调', '第7条 <状态栏>占位提醒'],
      missingCount: 7,
      has8: false
    };
    const entries = (cd.character_book || {}).entries || [];
    const thScripts = (cd.extensions && cd.extensions.tavern_helper && cd.extensions.tavern_helper.scripts) || [];
    const rxScripts = (cd.extensions && cd.extensions.regex_scripts) || [];
    // 前7条检测（按8条工作流顺序：第3条=更新规则，第4条=变量当前状态）
    // ⚠️脚本存为对象（含content/name/id字段），非string；兼容两种形态
    const has1 = thScripts.some(function(s) {
      if (!s) return false;
      const c = typeof s === 'string' ? s : (s.content || '');
      return c.indexOf('registerMvuSchema') >= 0 || c.indexOf('z.object') >= 0;
    });
    const has2 = entries.some(function(e) {
      const c = (e.comment || '').toLowerCase();
      return c.indexOf('[initvar]') >= 0 || c.indexOf('<initvar>') >= 0;
    });
    const has3 = entries.some(function(e) {
      const c = (e.comment || '').toLowerCase();
      return (c.indexOf('[mvu_update]') >= 0 || c.indexOf('<mvu_update>') >= 0) && c.indexOf('变量更新规则') >= 0;
    });
    const has4 = entries.some(function(e) {
      // 严格核心名匹配：避免"<自定义条目>变量当前状态使用说明"被误判为第4条已完成
      return _entryCommentCore(e.comment || '') === '变量当前状态';
    });
    const has5 = entries.some(function(e) {
      return _entryCommentCore(e.comment || '') === '变量输出格式';
    });
    const has6 = entries.some(function(e) {
      return _entryCommentCore(e.comment || '') === '变量输出格式强调';
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
    const names7 = ['第1条 变量结构脚本(zod)', '第2条 [InitVar]初始变量', '第3条 [mvu_update]更新规则', '第4条 变量当前状态', '第5条 [mvu_update]输出格式', '第6条 [mvu_update]输出格式强调', '第7条 <状态栏>占位提醒'];
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

  // ===== 结构化观察：卡片状态 + 校验结果 → AI 可读的语义快照 =====
  function _buildStructuredObservation(cd, valResult) {
    const lines = ['【当前卡片状态】'];
    const entries = (cd.character_book && cd.character_book.entries) || [];
    const nonMvu = entries.filter(function(e) { return !isMVUEntry((e && e.comment) || ''); });
    const descLen = String(cd.description || '').length;
    lines.push('· 主体：名称' + (cd.name ? '✅' : '✗') +
               ' / 描述' + (descLen >= 200 ? '✅' : (descLen > 0 ? '偏短(' + descLen + '字)' : '✗')) +
               ' / 开场白' + (cd.first_mes ? '✅' : '✗'));
    lines.push('· 世界书：普通条目 ' + nonMvu.length + ' 条（常驻 ' +
               nonMvu.filter(function(e) { return e.constant; }).length + ' / 触发 ' +
               nonMvu.filter(function(e) { return !e.constant; }).length + '）');
    try {
      const chk = checkMvu8Entries(cd);
      const mvuDone = chk.doneCount + (chk.has8 ? 1 : 0);
      lines.push('· MVU：' + mvuDone + '/8' +
                 (chk.missingCount > 0 ? '（缺：' + chk.missing.slice(0, 3).join('、') +
                   (chk.missingCount > 3 ? ' 等' + chk.missingCount + '项' : '') + '）' : ''));
    } catch (_e) {}
    const rx = (cd.extensions && cd.extensions.regex_scripts) || [];
    const fe = rx.filter(function(r) { return r && String(r.scriptName || '').indexOf('[界面]') === 0; });
    lines.push('· 界面：产物 ' + fe.length + ' 个' + (fe.length > 0 ? '（' + fe.slice(0, 3).map(function(r){ return r.scriptName; }).join('、') + '）' : ''));

    if (valResult && valResult.issues && valResult.issues.length > 0) {
      // 只注入 ERROR 级别（WARN 每步都塞会吃 token，且让 AI 反复想"先修小问题"）
      const _errs = valResult.issues.filter(function(x) { return x.level === 'error' || x.level === 'fatal'; });
      if (_errs.length > 0) {
        lines.push('');
        lines.push('【结构校验（' + _errs.length + ' 个错误，必须优先修复）】');
        _errs.slice(0, 6).forEach(function(x) {
          lines.push('  [ERROR] ' + x.msg);
        });
        if (_errs.length > 6) {
          lines.push('  …还有 ' + (_errs.length - 6) + ' 项');
        }
        lines.push('→ 请优先修复上述错误，再继续当前任务。');
      }
    }
    return lines.join('\n');
  }

  // 公共函数：生成"缺失条目提示文本"（供 isSBRequest / start_sb 共用）
  function buildMissingMvuHint(missing) {
    missing = safeArr(missing);
    const hint = missing.map(function(item, i) {
      return '  ' + (i + 1) + '. ' + item;
    }).join('\n');
    return '⚠️ 前7条未齐全（第8条=状态栏HTML，必须前7条完成后才生成）。\n' +
      '当前缺失 ' + missing.length + ' 条：\n' + hint + '\n\n' +
      '请按以下8条固定顺序补齐（依赖顺序是铁律；支持一次回复连续批量输出多条）：\n' +
      '  第1条：变量结构脚本（zod 4 schema）\n' +
      '  第2条：[InitVar]初始变量\n' +
      '  第3条：[mvu_update]变量更新规则\n' +
      '  第4条：变量当前状态\n' +
      '  第5条：[mvu_update]变量输出格式\n' +
      '  第6条：[mvu_update]变量输出格式强调\n' +
      '  第7条：<状态栏>占位符提醒条目\n' +
      '  第8条：正则6 [美化]MVU状态栏（即状态栏 HTML）—— 前7条完成后才生成\n\n' +
      '生成时请从缺失的第一条开始，按顺序在**一次回复中连续全部输出**（已存在的不要重复生成）；用户要求逐条确认时才逐条来。';
  }

  // ====================================================================
  // 公共常量：MVU 8条工作流规范文本（供 mvuPrompts.init_var / var_update_rule / buildMissingMvuHint 引用，避免多处重复维护）
  // ====================================================================
  // 生成顺序规则（批量默认：多条可一次输出，顺序与依赖关系是铁律）
  const MVU_SEQUENTIAL_RULE =
    '【生成顺序规则】\n' +
    '1. 顺序铁律：必须按 1→2→3→4→5→6→7→8 的固定顺序生成（依赖关系：第2/3条严格依据第1条schema；第8条状态栏HTML依赖前7条，前7条未完成前禁止生成第8条）。\n' +
    '2. ★【批量生成是默认模式】多条内容（脚本/条目/正则）应当**在一次回复中按顺序连续全部输出**，无需逐条停下等确认——除非用户明确要求"逐条生成/一条一条来/每条等我确认"。\n' +
    '3. 用户说"继续"时，从缺失或未完成的下一条继续生成（已完成的不重复输出）。\n\n';
  // 8条固定顺序（含每条详细规范）—— 第3/4条顺序已调整为：更新规则在前，变量当前状态在后
  const MVU_8STEPS_DETAIL =
    '【8条固定顺序（严格按此顺序，不能跳步）】\n' +
    '  第1条：变量结构脚本（tavern_helper.scripts，MVU Zod）\n' +
    '       · 文件头固定：import { registerMvuSchema } from \'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js\';\n' +
    '       · 文件尾固定：$(() => { registerMvuSchema(Schema); })\n' +
    '       · 变量结构导出：export const Schema = z.object({ ... });\n' +
    '       · 严格遵循 zod 4 规范；不使用 MVU 原版 _.set/_.add 语法\n' +
    '  第2条：[InitVar]初始变量（世界书条目，enabled=false）—— YAML格式，严格依据第1条schema生成；schema有z.prefault()的字段可省略；enabled必须=false\n' +
    '  第3条：[mvu_update]变量更新规则（世界书条目，constant=true，position=4/depth=0/order=79000）—— 依据第1条schema生成每个变量路径的type/range/check；不含 `_`/`$` 开头字段\n' +
    '  第4条：变量当前状态（世界书条目，constant=true，position=4/depth=1/order=69000）—— 固定内容：\n' +
    '<status_current_variable>\n当前剧情末尾的变量状态如下：\n\n{{format_message_variable::stat_data}}\n\n</status_current_variable>\n' +
    '  第5条：[mvu_update]变量输出格式（世界书条目，constant=true，position=4/depth=0/order=79001）—— 固定中文格式：<UpdateVariable>+<Analysis>+<JSONPatch>（4种操作：replace/delta/insert/remove），路径占位符用中文 ${/到/变量/的路径}\n' +
    '  第6条：[mvu_update]变量输出格式强调（世界书条目，constant=true，默认enabled=false）—— 固定内容原样输出，AI不输出<UpdateVariable>时启用\n' +
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
    '①zod脚本 ②InitVar ③更新规则 ④变量当前状态 ⑤输出格式 ⑥格式强调 ⑦占位提醒 ⑧状态栏HTML';
  // MVU变量系统创作指导（第1-6条详细规范）—— 供 mvuPrompts 按用户"写变量xxx"指令逐条输出对应规范
  const MVU_VAR_SPEC =
    '═══════════════════════════════════════════════════════════════════\n' +
    '📋 MVU变量系统创作指导（第1-6条详细规范）\n' +
    '═══════════════════════════════════════════════════════════════════\n\n' +
    '===== 第1条：变量结构脚本（zod 4 Schema）=====\n\n' +
    '【版本说明】本写卡器仅支持 MVU Zod 规范（zod 4 Schema + registerMvuSchema 注册），不支持 MVU 原版 _.set/_.add 格式。请勿使用 MVU 原版语法。\n\n' +
    '【任务】帮助用户创作一个完全符合zod 4库的MVU变量结构脚本\n\n' +
    '★★★【批量铁律·最高优先级】除用户明确要求"逐条生成/一条一条来/每条等我确认"外，禁止逐条输出、禁止中途停下询问或等确认：用户需求已明确（或已说"直接做/你看着办/批量生成"）时，跳过下方第一/二步的询问与确认，直接在同一次回复中按 1→8 固定顺序把全部缺失的MVU资产**连续批量输出完毕**（zod脚本:::操作块 + [InitVar]/更新规则/变量当前状态/输出格式/格式强调/占位提醒:::操作块 + 状态栏```html，混排一次输出，写卡器全部自动提取）。只有当用户完全没有说明要追踪什么时，才一次性问完下方问题（禁止逐条追问）。\n\n' +
    '【工作流程（第一/二步仅在需求确实不明时执行）】\n' +
    '第一步：了解需求（仅当用户未说明需求时，一次性问完以下问题）\n' +
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
    '第二步：确认结构（用户需求已明确或说"直接做"时跳过本步，直接编写）\n' +
    '  根据用户需求，先用自然语言列出结构大纲，让用户确认是否符合需求\n\n' +
    '第三步：编写初始变量\n' +
    '  按照zod 4编写javascript文件；随后按固定顺序在同一次回复中批量输出其余缺失条目（禁止只写脚本就停下等确认）\n\n' +
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
    '【示例（严格对齐第二个文件规范）】\n' +
    '  角色:\n' +
    '    奥利弗:\n' +
    '      好感度: 20\n' +
    '      心情: 平静\n' +
    '      物品: [宿舍钥匙, 篮球, 课本]\n' +
    '      衣着:\n' +
    '        上衣: 黑色T恤\n' +
    '        下装: 白色短裤\n' +
    '      _关系阶段: 泛泛之交\n' +
    '  世界:\n' +
    '    日期: 2025-10-22\n' +
    '    时间: 09:00\n' +
    '    天气: 晴\n' +
    '  $成就:\n' +
    '    知彼知己: false\n' +
    '    初露锋芒: false\n' +
    '    慷慨之举: false\n\n' +
    '【注意事项】\n' +
    '  1. 条目命名：[initvar] 变量初始化（enabled=false）\n' +
    '  2. YAML 格式，不带 stat_data 根键（MVU 底层自动挂载）\n' +
    '  3. ★允许包含 `_`/`$` 开头字段（只读派生字段 / AI 不可见字段），与第二个文件一致\n' +
    '  4. schema 有 z.prefault() 的字段可省略；无 schema 时按用户需求写全\n' +
    '  5. 后续配置：变量规则、变量当前状态、输出格式需另行生成\n\n' +
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
    '  在你的回复最后，必须根据新输出剧情末尾的实际状态，判断变量是否需要更新，如需要更新，则遵循下述规则：\n\n' +
    '  interface State {\n' +
    '    角色: {\n' +
    '      ${角色名}: {\n' +
    '        好感度: number; // 范围为 0~100；除非发生重大事件，否则单次增减必须在 ±5 以内\n' +
    '        心情: string; // 根据角色的实际情绪更新\n' +
    '        物品: string[]; // 获得、消耗、遗失或转移物品时新增或删除对应元素\n' +
    '        衣着: { // 明确更换服装时更新\n' +
    '          上衣: string;\n' +
    '          下装: string;\n' +
    '        };\n' +
    '      };\n' +
    '    };\n\n' +
    '    世界: {\n' +
    '      日期: string; // 格式为 YYYY-MM-DD，在剧情时间跨日时更新\n' +
    '      时间: string; // 格式为 HH:mm，根据剧情实际经过的时间合理推进\n' +
    '      天气: \'晴\' | \'多云\' | \'雨\' | \'暴雨\' | \'雪\'; // 在剧情明确表现天气变化时更新\n' +
    '    };\n' +
    '  }\n\n' +
    '【要求】\n' +
    '  - interface 中不要包含以 `_` 和 `$` 开头的变量\n' +
    '  - 在各个字段定义后用 `//` 注释写明更新规则\n' +
    '  - 如果同一字段下的多个子字段更新规则一致，宜写在父字段后\n' +
    '  - 合并同类型变量规则\n' +
    '  - string 类型变量不需要写 type（interface 中直接写 string 即可）\n\n' +
    '【示例】\n' +
    '  ---\n' +
    '  在你的回复最后，必须根据新输出剧情末尾的实际状态，判断变量是否需要更新，如需要更新，则遵循下述规则：\n\n' +
    '  interface State {\n' +
    '    角色: {\n' +
    '      奥利弗: {\n' +
    '        好感度: number; // 范围为 0~100；除非发生重大事件，否则单次增减必须在 ±5 以内\n' +
    '        心情: string; // 根据奥利弗的实际情绪更新\n' +
    '        物品: string[]; // 获得、消耗、遗失或转移物品时新增或删除对应元素\n' +
    '        衣着: { // 明确更换服装时更新\n' +
    '          上衣: string;\n' +
    '          下装: string;\n' +
    '        };\n' +
    '      };\n' +
    '    };\n\n' +
    '    世界: {\n' +
    '      日期: string; // 格式为 YYYY-MM-DD，在剧情时间跨日时更新\n' +
    '      时间: string; // 格式为 HH:mm，根据剧情实际经过的时间合理推进\n' +
    '      天气: \'晴\' | \'多云\' | \'雨\' | \'暴雨\' | \'雪\'; // 在剧情明确表现天气变化时更新\n' +
    '    };\n' +
    '  }\n\n' +
    '  完成后的引导：\n' +
    '  下一步：创建变量当前状态。对我说"写变量当前状态"。\n\n' +
    '===== 第4条：变量当前状态（固定格式，原样输出）=====\n\n' +
    '  <status_current_variable>\n' +
    '  当前剧情末尾的变量状态如下：\n\n' +
    '  {{format_message_variable::stat_data}}\n\n' +
    '  </status_current_variable>\n\n' +
    '  重点：这就是你要输出给用户的完整格式！整个内容用代码块包裹，一次性完整输出！\n\n' +
    '  开始协作吧！\n\n' +
    '  ---\n\n' +
    '  完成后的引导\n\n' +
    '  当变量当前状态创作完成并输出后：\n\n\n' +
    '  下一步：创建变量输出格式。对我说"写变量输出格式"。\n\n' +
    '===== 第5条：变量输出格式（固定格式，原样输出）=====\n\n' +
    '  ---\n' +
    '  更新必须遵循以下语法规则，并包裹在`<UpdateVariable>`标签内：\n' +
    '  - 使用有效的 JSON 数组，每个元素表示单个操作对象，仅支持`replace`、`delta`、`insert`、`remove`四种操作。\n' +
    '  - 禁止更新以`_`为开头的变量，这些是只读变量。\n' +
    '\n' +
    '  <UpdateVariable>\n' +
    '  <Analysis>\n' +
    '  更新列表:\n' +
    '  - ${变量名称} ${完整操作路径}: ${仅根据本次回复说明更新原因}\n' +
    '  </Analysis>\n' +
    '  <JSONPatch>\n' +
    '  [\n' +
    '    { "op": "replace", "path": "${/到/变量/的路径}", "value": ${新值} },\n' +
    '    { "op": "delta", "path": "${/到/数值/变量/的路径}", "value": ${正或负的变动值} },\n' +
    '    { "op": "insert", "path": "${/到/对象/新键/的路径}", "value": ${新值} },\n' +
    '    { "op": "insert", "path": "${/到/数组/-}", "value": ${新值} },\n' +
    '    { "op": "remove", "path": "${/到/对象/键/的路径}" },\n' +
    '    { "op": "remove", "path": "${/到/数组/的路径/0}" },\n' +
    '    ...\n' +
    '  ]\n' +
    '  </JSONPatch>\n' +
    '  </UpdateVariable>\n' +
    '\n' +
    '  重点：这就是你要输出给用户的完整格式！整个内容用代码块包裹，一次性完整输出！\n\n' +
    '  开始协作吧！\n\n' +
    '  ---\n\n' +
    '  完成后的引导\n\n' +
    '  当变量输出格式创作完成并输出后：\n\n' +
    '  下一步：创建变量输出格式强调。对我说"写变量输出格式强调"。\n\n' +
    '===== 第6条：变量输出格式强调（固定格式，原样输出）=====\n\n' +
    '  注意：这个条目只在测试时发现AI不输出 <UpdateVariable> 块时才需要启用。\n\n' +
    '  ---\n' +
    '  注意：以下内容必须插入到回复末尾，不可省略。\n' +
    '\n' +
    '  <UpdateVariable>\n' +
    '  ...\n' +
    '  </UpdateVariable>\n\n' +
    '  重点：这就是你要输出给用户的完整格式！整个内容用代码块包裹，一次性完整输出！\n\n' +
    '  开始协作吧！\n\n' +
    '  ---\n\n' +
    '  完成后的引导\n\n' +
    '  注意：这个条目只在测试时发现AI不输出 <UpdateVariable> 块时才需要启用。';

  // ============================================================================
  // SECTION 7  MVU 8步工作流 + 提示词构建（buildPrompt · Tab隔离）
  // ============================================================================
  // ===== 前端界面 HTML 基准模板（原 buildFrontendTabPrompt 内部常量，Agent 版提取为顶层供统一提示词引用）=====
  const FE_BEAUTIFY_BASE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>正文美化</title>
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

        /* 根据用户需求自由设计样式 */
        /* 例如：信纸效果、日记本效果、对话气泡等 */

        .loading {
            text-align: center;
            padding: 20px;
            color: #999;
        }
    </style>
</head>
<body>
    <div class="story-container" id="content">
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
            var match = messageText.match(/<story>([\s\S]*?)<\/story>/);
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
                    if (trimmed.startsWith('"') || trimmed.startsWith('"') || trimmed.startsWith('「')) {
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
    </script>
</body>
</html>`;
  const FE_STRUCTURED_BASE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>页面标题</title>
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
            padding: 16px;
        }

        .loading {
            text-align: center;
            padding: 20px;
            color: #999;
        }

        /* 根据用户需求自由设计样式 */
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

            /* 从完整消息中提取标签内容，注意替换为你的真实标签名 */
            var tagMatch = messageText.match(/<标签名>([\s\S]*?)<\/标签名>/);
            if (!tagMatch || !tagMatch[1]) {
                console.error("未找到标签内容");
                return result;
            }
            var content = tagMatch[1];

            /* 根据选用的数据格式进行解析 */
            /* 方式一：[字段|值] 格式的解析方式 */
            var match = content.match(/\[字段名\|([^\]]+)\]/);
            if (match && match[1]) {
                var parts = match[1].split('|');
                result.field1 = parts[0] || '';
                result.field2 = parts[1] || '';
            }

            /* 方式二：键值对格式的解析方式 */
            var lines = content.trim().split('\\n');
            lines.forEach(function(line) {
                var kv = line.split(':');
                if (kv.length >= 2) {
                    var key = kv[0].trim();
                    var value = kv.slice(1).join(':').trim();
                    result[key] = value;
                }
            });

            return result;
        }

        /* ========== 渲染界面 ========== */
        function renderPage(data) {
            var html = '';
            /* 根据用户需求构建HTML */
            document.getElementById('content').innerHTML = html;
        }

        /* ========== 交互函数 ========== */
        function handleClick(keyword, param) {
            if (typeof triggerSlash === 'function') {
                triggerSlash('/send ' + keyword + '：' + param + '|/trigger');
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
    </script>
</body>
</html>`;

  // ===== 意图分类规则（顶层常量，避免每轮 buildPrompt 重建对象）=====
  const INTENT_RULES = {
    mvu: [
      { re: /mvu|initvar|zod|schema|stat_data|状态栏/i, w: 4 },
      { re: /变量|数值|属性|追踪|进度条/i, w: 3 },
      { re: /好感度|金钱|物品栏|背包|库存|装备/i, w: 3 },
      { re: /等级|经验|境界|亲密度|信任度|理智|恐惧/i, w: 3 },
      { re: /[\[［]mvu_update[\]］]/i, w: 5 }
    ],
    frontend: [
      { re: /界面|前端|美化|面板|正则/i, w: 4 },
      { re: /信纸|日记|气泡|论坛|任务面板|数据卡/i, w: 3 },
      { re: /渲染|排版|配色|样式|风格化|html模板/i, w: 3 },
      { re: /正文美化|\[界面\]/i, w: 5 }
    ],
    card: [
      { re: /角色设定|人设|开场白|first_mes|世界观总纲/i, w: 2 },
      { re: /添加.{0,4}条目|写.{0,4}设定|删.{0,4}条目/i, w: 2 },
      { re: /世界书|触发词|keys\s*=/i, w: 1 }
    ]
  };

  // ===== 构建完整提示词（Agent 版：单会话统一提示词，按「意图检测+卡片状态」注入领域规范）=====
  // agentDirective（可选）：Agent自主执行模式的任务指令（agentLoop 每步传入：计划总览+当前步骤+控制标记协议）
  function buildPrompt(cardData, cardGenerated, messages, agentDirective) {
    const cd = cardData;

    // ★修复#11：快捷动作标志位 → 注入系统侧（不进用户消息）；用完即清
    try {
      const _qa = window.__cwQuickAction || null;
      window.__cwQuickAction = null;
      if (_qa && _qa.prompt) {
        agentDirective = (agentDirective || '') +
          '\n[系统动作] 用户点击了快捷按钮「' + String(_qa.action || '') + '」，请按其要求直接执行（无需复述给用户听）：\n' + _qa.prompt + '\n';
      }
    } catch (_qaErr) { logWarn('buildPrompt.quickAction', _qaErr); }

    // ★ 优先使用传入的 messages 参数（callAIChat 传的是当前会话消息，权威），
    //   未传时再降级到 getCurrentMessages()/window.__getCurrentMessages()
    const tabMessages = (messages && Array.isArray(messages) && messages.length > 0) ?
      messages :
      (typeof getCurrentMessages === 'function' && Array.isArray(getCurrentMessages())) ?
      getCurrentMessages() :
      (typeof window !== 'undefined' && typeof window.__getCurrentMessages === 'function' && Array.isArray(window.__getCurrentMessages())) ?
      window.__getCurrentMessages() :
      (Array.isArray(messages) ? messages : []);

    // ========== 1. 意图检测：扫描最近3条用户消息 + 当前卡片MVU/前端资产状态 ==========
    // 命中才注入对应领域的大段规范（MVU六模板/前端基准HTML模板），平时只带轻量速览，节省token
    const recentUserTexts = [];
    for (let _ui = tabMessages.length - 1, _uc = 0; _ui >= 0 && _uc < 3; _ui--) {
      if (tabMessages[_ui] && tabMessages[_ui].role === 'user') {
        recentUserTexts.push(String(tabMessages[_ui].content || ''));
        _uc++;
      }
    }
    const intentText = recentUserTexts.join('\n');
    const _allEntries = (cd && cd.character_book && cd.character_book.entries) || [];
    const _allRegex = (cd && cd.extensions && cd.extensions.regex_scripts) || [];
    const hasMvuAssets = _allEntries.some(function(e) {
        return isMVUEntry((e && e.comment) || '');
      }) ||
      _allRegex.some(function(r) {
        return r && String(r.findRegex || '').indexOf('StatusPlaceHolder') >= 0;
      });
    const hasFeAssets = _allRegex.some(function(r) {
      return r && (r.id === 'frontend-beautify' || String(r.scriptName || '').indexOf('[界面]') === 0);
    });
    // ===== 意图分类器：规则+评分，替代二值正则（规则表见顶层 INTENT_RULES）=====
    const _scores = { mvu: 0, frontend: 0, card: 0 };
    Object.keys(INTENT_RULES).forEach(function(k) {
      INTENT_RULES[k].forEach(function(rule) {
        if (rule.re.test(intentText)) _scores[k] += rule.w;
      });
    });
    if (hasMvuAssets) _scores.mvu += 1;
    if (hasFeAssets) _scores.frontend += 1;
    // ★修复#8：否定词降权——"不要/不用/别做"等意图明显排除该领域时压分，防"数值/界面"等普通词误触发大段规范注入
    const _negRe = /(不用|不想|不要|别做|无需|不做|不用做|别加|不要做|不需要)/;
    if (_negRe.test(intentText)) {
      _scores.mvu = Math.max(0, _scores.mvu - 1);
      _scores.frontend = Math.max(0, _scores.frontend - 1);
    }
    const mvuIntent = _scores.mvu >= 2;   // ★松绑2.4：4→2（轻微命中就帮 AI 带上规范）
    const feIntent = _scores.frontend >= 2;   // ★松绑2.4：4→2
    try { console.log('[intent]', _scores, 'text=', intentText.slice(0, 60)); } catch (_) {}

    // ========== 2. 当前卡片全量上下文（顶层字段 + 世界书条目[普通+MVU分组] + 脚本/正则资产状态）==========
    let existingInfo = '';
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
        // ===== Agent版：普通条目与MVU条目都完整可见（MVU条目单独分组+<<<content>>>包裹提示）=====
        const normalEntries = entries.filter(function(e) {
          return !isMVUEntry((e && e.comment) || '');
        });
        const mvuOnlyEntries = entries.filter(function(e) {
          return isMVUEntry((e && e.comment) || '');
        });
        if (normalEntries.length > 0) {
          let entryText = '世界书条目·普通设定（' + normalEntries.length + '条）：';
          normalEntries.forEach(function(e, i) {
            // ⚠️发送完整 content（不截断），让 AI 修改条目时能看到完整旧内容，避免凭摘要重写覆盖
            entryText += '\n  ' + (i + 1) + '. [' + (e.comment || '条目' + (i + 1)) + '] keys:' + (e.keys || []).join(',') + '\n     content(' + (e.content || '').length + '字): ' + (e.content || '');
          });
          parts.push(entryText);
        }
        if (mvuOnlyEntries.length > 0) {
          let mvuEntryText = '世界书条目·MVU变量系统条目（' + mvuOnlyEntries.length + '条，属于8条工作流资产）：\n';
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
          parts.push(mvuEntryText);
        }
        // 精确 comment 清单（全部条目，普通+MVU）
        let commentListText = '⚠️【世界书条目精确 comment 清单 - 删改时务必使用下列精确字符串匹配】\n';
        commentListText += '删除条目写法：\n';
        commentListText += '  方式1: { "_delete": ["character_book.entries.<这里粘贴完整comment>"] }\n';
        commentListText += '  方式2: entries数组里加 { "_action":"delete", "comment":"<这里粘贴完整comment>" }\n';
        commentListText += '修改条目写法（确保成功覆盖）：comment必须与下面「精确字符串」完全相同，字符级匹配，空格标点都不能变！\n';
        commentListText += '----------------------------------------\n';
        entries.forEach(function(e, i) {
          const comment = e.comment || ('条目' + (i + 1));
          const _isMvuOne = isMVUEntry(comment);
          commentListText += (i + 1) + '. 精确字符串: ⟦' + comment + '⟧' + (_isMvuOne ? '  [MVU资产]' : '') + '\n';
        });
        commentListText += '----------------------------------------\n';
        commentListText += '⚠️ 记住：comment 不精确匹配 = 只加新条目不删旧条目 = 用户骂你！\n';
        parts.push(commentListText);
      }
      // ===== 脚本资产状态（tavern_helper.scripts：zod变量结构/MVU本体等）=====
      const thScripts = (cd.extensions && cd.extensions.tavern_helper && cd.extensions.tavern_helper.scripts) || [];
      if (thScripts.length > 0) {
        let scriptText = '当前已有脚本（tavern_helper.scripts，共' + thScripts.length + '条）：\n';
        thScripts.forEach(function(s, i) {
          const isSchema = (s.id === 'mvu-schema' || (s.name || '').indexOf('变量结构') >= 0 || (s.content || '').indexOf('mvu_zod') >= 0);
          const isBundle = (s.id === '961f366d-e403-45c2-8155-3d14ec86de53' || (s.content || '').indexOf('MagVarUpdate') >= 0 || (s.content || '').indexOf('bundle.js') >= 0);
          scriptText += '  ' + (i + 1) + '. ' + (s.name || '脚本' + (i + 1)) + (isSchema ? '（zod变量结构，可整段覆盖修改）' : (isBundle ? '（MVU本体bundle.js，固定资产勿动）' : '')) + (s.enabled === false ? ' [禁用]' : '') + '\n';
        });
        parts.push(scriptText);
      }
      // ===== 正则脚本资产状态（MVU状态栏 + 前端界面）=====
      if (_allRegex.length > 0) {
        let rxText = '当前已有正则脚本（regex_scripts，共' + _allRegex.length + '条）：\n';
        _allRegex.forEach(function(r, i) {
          rxText += '  ' + (i + 1) + '. ' + (r.scriptName || '正则' + (i + 1)) + '  查找:' + String(r.findRegex || '').slice(0, 60) + (r.disabled ? ' [禁用]' : '') + '\n';
        });
        parts.push(rxText);
      }
      if (parts.length > 0) existingInfo = '\n\n=== 当前角色卡已有内容（不要重复输出，除非增/删/改）===\n' + parts.join('\n');
    }

    // ========== 3. 创作进度总览（普通条目统计 + MVU 8步完成度 + 前端产物状态）==========
    let qcBlock = '\n\n=== 📋 当前创作进度总览（权威标准，你必须以此为准）===\n';
    {
      const entries = (cd && cd.character_book && cd.character_book.entries) || [];
      const nonMvuEntries = entries.filter(function(e) {
        return !isMVUEntry((e && e.comment) || '');
      });
      const constCount = nonMvuEntries.filter(function(e) {
        return e.constant === true;
      }).length;
      const trigCount = nonMvuEntries.length - constCount;
      qcBlock += '【角色卡主体】名称:' + ((cd && cd.name) ? '✅' : '✗') + ' 世界观描述:' + ((cd && cd.description && cd.description.length >= 200) ? '✅' : ((cd && cd.description) ? '偏短' : '✗')) + ' 开场白:' + ((cd && cd.first_mes) ? '✅' : '✗') + '\n';
      qcBlock += '普通世界书条目：' + nonMvuEntries.length + ' 条（常驻' + constCount + ' · 触发' + trigCount + '）\n';
      // MVU 8步完成度
      try {
        const _chk = checkMvu8Entries(cd || {});
        const _mvuDone = _chk.doneCount + (_chk.has8 ? 1 : 0);
        qcBlock += '【MVU变量系统】8步工作流：' + _mvuDone + '/8（第8条=状态栏HTML' + (_chk.has8 ? '✅已生成' : '未生成') + '）' + (_chk.all7Done ? '' : ' 缺:' + _chk.missingCount + '条') + '\n';
      } catch (_chkErr) { logWarn('qcMvu', _chkErr); }
      // 前端产物状态
      const feBeautify = _allRegex.some(function(r) { return r && (r.id === 'frontend-beautify' || String(r.id || '').indexOf('frontend-beautify-') === 0); });
      const feBeautifyCount = _allRegex.filter(function(r) { return r && (r.id === 'frontend-beautify' || String(r.id || '').indexOf('frontend-beautify-') === 0); }).length;
      const feStructured = _allRegex.filter(function(r) { return r && String(r.id || '').indexOf('frontend-structured-') === 0; }).length;
      qcBlock += '【前端界面】正文美化正则:' + (feBeautifyCount > 0 ? ('✅已生成×' + feBeautifyCount) : '未生成') + ' · 结构化数据面板:' + feStructured + '个\n';
      qcBlock += '如需新增条目直接upsert；修改已有条目必须输出完整旧content+改动部分；删除用delete。\n';
      qcBlock += '★若用户本次描述笼统（未指明具体做哪一小块），建议先输出「生成计划报告」（大白话讲清：要做什么 + 加/改哪几条 + 先做哪个）让用户确认；方向明确时也可直接输出产物。\n';   // ★P2-13配套：软化"禁止直接upsert"
    }

    // ========== 3.5. 空卡/有卡路径指示（客户端主动告诉AI该走哪条路）==========
    {
      const _cdForPath = cd || {};
      const _entriesForPath = (_cdForPath.character_book && _cdForPath.character_book.entries) || [];
      const _isBlank = !String(_cdForPath.name || '').trim() &&
                       !String(_cdForPath.description || '').trim() &&
                       _entriesForPath.length === 0 &&
                       !String(_cdForPath.first_mes || '').trim();
      if (_isBlank) {
        qcBlock += '\n【本次路径 · 空卡起步】当前卡片完全为空。若本轮需要出报告：\n' +
          '  · 必须写"🌍 世界观设定"段：时间/地点 + 核心冲突（2-3 句）\n' +
          '  · "📋 新增条目"段必须按用户意图给出**具体条目数量 + 每条目名称 + 一句话说明**\n' +
          '  · 报告末尾以"可以的话回复「确认」我就开始做；要改就直说哪里不对。"收尾\n';
      } else {
        qcBlock += '\n【本次路径 · 有卡迭代】当前卡片已有内容。若本轮需要出报告：\n' +
          '  · 必须写"📌 当前卡现状"段：有几条条目、缺什么（1-2 句）\n' +
          '  · "📋 新增条目"段逐条给出：条目名 + 一句话说明\n' +
          '  · "✏️ 修改内容"段（有则写，无则省略）\n' +
          '  · 报告末尾以"可以的话回复「确认」我就开始做；要改就直说哪里不对。"收尾\n';
      }
    }

    // ========== 4. Agent 身份 + 意图路由 ==========
    const agentIdentity = '\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🤖 你是「时之写卡 Agent」——全能角色卡创作智能体（Agent模式）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '你在一个统一的对话界面里负责角色卡创作的一切事务，可自主完成三大领域：\n' +
      '  A. 角色卡主体：世界观/角色设定、世界书条目、开场白、性格场景等（:::操作块协议输出）\n' +
      '  B. MVU变量系统：zod变量结构、[InitVar]初始变量、更新规则、输出格式等8条工作流资产 + HTML状态栏（条目用:::操作块；状态栏输出```html完整代码块）\n' +
      '  C. 前端界面：正文美化正则、结构化数据面板（输出```html完整代码块，结构化时带【页面名称】【标签名】标记）\n\n' +
      '【意图路由 · 每轮先判断用户要什么，再决定输出什么】\n' +
      '1. 世界观/角色/设定/条目/开场白/剧情 → 领域A\n' +
      '2. 变量/数值追踪/好感度/金钱/物品/属性/阶段/境界/状态栏/MVU → 领域B：**一律生成MVU体系资产**（zod脚本→[InitVar]→更新规则→变量当前状态→输出格式→格式强调→占位提醒→状态栏HTML，按固定顺序，★默认且必须一次回复批量输出全部缺失条目——禁止逐条停顿等用户确认，除非用户明确要求"逐条生成/每条等确认"）。⚠️【铁律】变量追踪内容必须以MVU条目形式实现，禁止做成普通世界书条目、禁止写进description/开场白——变量系统只有走MVU体系才能在酒馆运行。⚠️【严格模板】第4/5/6条是固定内容模板必须原样输出，第2/3条严格依据第1条schema的字段名生成（路径字字对应），禁止自创格式。\n' +
      '3. 界面/美化/信纸/气泡/面板/论坛/渲染 → 领域C：先确认风格需求，再输出完整HTML代码块（用户说"直接做/你看着办"则按合理默认执行）\n' +
      '\n' +
      '★★★【需求评估 · 每轮的第一步 · 最高优先级 · 判定权完全在你】★★★\n' +
      '★每轮先判断任务规模（判档权完全在你，客户端不越权）：\n' +
      '  · 小任务（≤2 个操作 / 微调现有内容）→ 直接执行，一次回复完成\n' +
      '  · 中等任务（新体系 / ≥3 条条目 / 大范围重构）→ 先出 60~300 字白话报告（🎯我想帮你做 / 🌍世界观或现状 / 📋打算加的条目 / ✏️要改的地方 / 🔧先做哪个），末尾加 <agent_plan>…</agent_plan>（2-8 步，每步一小块），以"可以的话回复「确认」我就开始做"收尾，等用户确认\n' +
      '  · 重大调整（需删现有条目 / 方向冲突 / 清空重做）→ 报告 + 可选 <agent_options>（2-3 个在范围/取舍/代价上有实质差异的方案）\n' +
      '  · 用户说"直接做/别问了/你看着办"→ 跳过确认，直接执行（大任务可配合 <agent:continue> 自动续跑）\n' +
      '判档依据以"用户意图是否真模糊、范围是否真的大"为准，而非几个信号词。\n' +
      '报告一律用大白话、禁止"意图深度解析/权重推演/position/depth/order/体验推演/冲突检查"等术语、禁止并列选项（档 3 选项除外）。\n' +
      '控制范围：用户说"加白娅"，主体内容只做白娅；不主动扩写她的关系网/家族/装备；报告只是提议——用户不确认，不写进卡片。\n' +   // ★P2-23："绝不扩大范围"→"控制范围"
      '4. 内容尺度（全年龄/暗黑/NSFW）如果用户没提且任务涉及创作，默认按"全年龄向"执行；用户描述里出现暗黑/NSFW倾向关键词时按用户意图执行。\n' +
      '5. 每次用户输入只处理最新一条消息；若用户消息形如"我选择：xxx"，那是选项确认，直接执行该方向，不要再给概览/选项。\n\n' +
      '【通用行为准则】\n' +
      '· 🚫【绝不角色扮演】你永远不是故事中的角色。绝不产出叙事正文、场景描写、角色对话、第一人称独白（详见系统提示"身份铁律"）。\n' +
      '  产出卡片内容时：用 :::操作块 或 ```html 代码块承载；\n' +
      '  与用户讨论/建议/头脑风暴时：正常对话即可，不必强行输出操作块。\n' +   // ★P2-5：允许咨询性对话
      '· 语义优先：用户说话=要增删改！反问句/不满句=隐含修改需求，不要当聊天\n' +
      '· 修改/删除已有条目时，必须使用上方提供的精确comment字符串\n' +
      '· MVU/前端资产与角色卡其他内容相互配合：变量路径决定状态栏渲染路径，界面风格贴合世界观\n' +
      '· 写卡器会自动提取你输出中的 :::操作块 和 HTML代码块 并保存，你只管按协议输出\n' +
      '· ReAct观察机制：你每轮输出后，写卡器执行并把**【执行结果】**附在你消息尾部（✅成功明细/❌失败原因）——对话历史里能看到。若上轮有❌失败，优先修正失败项再继续。\n' +   // ★P2-22：语气软化
      '\n';

    // ========== 5. 领域规范块（按意图注入：MVU / 前端）==========
    // —— MVU 完整规范（意图命中或已有MVU资产时注入）——
    const mvuSpecBlock = '\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🎛️【领域规范 · MVU变量系统】（本轮需求涉及变量/状态栏）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🔒【MVU顺序铁律 · 违反=整个变量系统无法运行】\n' +
      '   · 必须严格按 1→2→3→4→5→6→7→8 顺序生成；不得跳步、不得乱序、不得先做第8条状态栏。\n' +
      '   · ⚠️豁免：若是单纯修改已存在 MVU 条目的字段值（如改 InitVar 里的日期/数值/文本），直接改即可，无需走完整顺序。\n' +
      '   · 每次涉及MVU，先在回复开头用一句话复述当前进度"当前已有第X条，本轮从第X+1条开始"，再开始输出。\n' +
      '   · 第2条[InitVar]的YAML键名、第3条更新规则的路径、第8条populateCharacterData的_.get路径，三者必须字字对应（先读第1条zod schema字段名，逐字照抄，不得翻译/缩写）。\n' +
      '   · 第4/5/6条是固定模板——原样照抄（不改字段名、不替换${...}占位符、不增删条目、不加注释）。\n' +
      '   · 一次回复内按顺序连续输出全部缺失条目（批量是默认模式），禁止一次只输出一条。\n\n' +
      'MVU=MagVarUpdate变量框架，由8条固定工作流资产构成：\n' +
      '第1条: 变量结构脚本（zod 4 Schema + registerMvuSchema → tavern_helper.scripts）\n' +
      '第2条: [InitVar]初始变量（constant=true, position=0, insertion_order=100, enabled=false, content=YAML）\n' +
      '第3条: [mvu_update]变量更新规则（constant=true, position=4, depth=0, order=200）\n' +
      '第4条: 变量当前状态（constant=true, position=4, depth=1, order=69000, 固定模板）\n' +
      '第5条: [mvu_update]变量输出格式（固定中文格式：<UpdateVariable>+<Analysis>+<JSONPatch>，4种操作replace/delta/insert/remove）\n' +
      '第6条: [mvu_update]变量输出格式强调（默认enabled=false）\n' +
      '第7条: <状态栏>占位符提醒（constant=true，提醒AI每条回复底部输出<StatusPlaceHolderImpl/>）\n' +
      '第8条: 正则6 [美化]MVU状态栏（markdownOnly=true, promptOnly=false，完整HTML文档）\n\n' +
      '⚠️【生成顺序与批量】严格按1→8固定顺序（依赖铁律：前7条完成后才生成第8条状态栏）；**多条可在一次回复中按顺序连续全部输出（批量是默认模式）**——只有用户明确要求逐条确认时才逐条来。\n' +
      '⚠️【MVU体系边界】变量追踪相关的一切内容（包括用户额外要求的阶段判定/人设切换/派生字段/EJS控制器等附加条目）都必须以MVU体系条目形式生成，禁止做成普通世界书条目或写进description/开场白。\n\n' +
      '【MVU条目输出方式（第1-7条）】一律用:::操作块：\n' +
      '::: upsert [InitVar]初始变量\\n世界:\\n  境界: 炼气\\n:::\n' +
      '⚠️【InitVar正文纯净铁律】content只写YAML变量内容（不写stat_data根键，MVU底层自动挂载）；绝不把enabled/content/comment等配置字段写进content。\n' +
      '修改变量结构脚本：::: upsert script:变量结构\\nzod代码\\n:::（删除：::: delete script:脚本名）\n\n' +
      '【状态栏（第8条）输出方式】输出一个完整HTML文档代码块（```html），写卡器自动提取保存为正则6：\n' +
      '· 完整<!doctype html>文档，<head>放<style>和<script>，<body>内每个需显示的变量DOM必须有唯一id\n' +
      '· script中实现 populateCharacterData()：getAllVariables()读变量 → _.get(all_variables,"stat_data.xxx",默认值)逐变量读取 → $(\'#id\').text(value)逐变量填充\n' +
      '· init流程：await waitGlobalInitialized(\'Mvu\') → populateCharacterData() → eventOn(Mvu.events.VARIABLE_UPDATE_ENDED,回调刷新) → $(errorCatched(init))\n' +
      '· 需求不明时先问：UI风格/显示哪些变量及分组/配色/是否要进度条；用户说"直接生成/你看着办"才跳过询问按默认生成\n' +
      '· 禁止输出任何注释（/* */ 和 // 都不要）；禁用vh/position:absolute/min-height/overflow:auto；布尔值仅✓/✕；_或$开头的key跳过\n' +
      '· 数组用items.map(i=>...).join()生成HTML后$(\'#list\').html(html)；对象用Object.entries遍历\n\n' +
      '【路径一致性铁律（状态栏能否显示的关键，违反=纯文字状态栏）】\n' +
      '1. InitVar的YAML键名 ↔ populateCharacterData的_.get路径 ↔ 变量更新规则引用的路径，三者必须字字相同（不得自创翻译）\n' +
      '2. populateCharacterData必须从 _.get(allVars,"stat_data",{}) 取根节点再逐变量 _.get(statData,"顶层键.子键",默认值)\n' +
      '3. HTML骨架id ↔ $(\'#id\')选择器字字一一对应（错一个字母=该变量永远不显示）；禁止递归renderTree旧模式\n' +
      '4. 修改MVU条目或状态栏必须用相同comment/id覆盖，禁止新增重复条目\n' +
      '⚠️ 严禁只描述不输出代码块——生成状态栏必须给出完整```html代码块；发现只写了文字立即补代码块再结束本轮\n\n' +
      '【MVU六大模板完整规范（生成第1-6条时的权威依据）】\n' +
      MVU_SEQUENTIAL_RULE + '\n' +
      MVU_8STEPS_DETAIL + '\n' +
      MVU_VAR_SPEC + '\n\n' +
      MVU_8STEPS_COMMON_RULES + '\n' +
      MVU_MODIFY_RULE + '\n';
    // —— MVU 轻量速览（未命中时注入）——
    const mvuBrief = '\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🎛️【领域速览 · MVU变量系统】（完整规范将在你处理变量/状态栏需求时自动提供）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '· MVU=MagVarUpdate变量框架，8条固定资产：zod脚本/[InitVar]/更新规则/变量当前状态/输出格式/强调/占位提醒/状态栏HTML\n' +
      '· 若用户提到变量/数值追踪/好感度/状态栏等：一律生成MVU体系资产（批量生成是默认模式），先做需求收集（要追踪什么/怎么展示），用户说"直接做"则按合理默认批量生成\n' +
      '· 本轮用户未涉及变量需求时忽略本速览，不要主动生成MVU内容\n';
    // —— 前端完整规范（意图命中或已有前端正则时注入）——
    const feSpecBlock = '\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🖼️【领域规范 · 前端界面】（本轮需求涉及界面/美化/面板）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '前端界面=把AI消息渲染成自定义界面的酒馆正则，按用户描述自动判断两类：\n' +
      '  · 正文美化：把正文渲染成信纸/日记/对话气泡等 → 「[界面]正文美化」正则\n' +
      '  · 结构化数据：把AI按特定格式输出的数据（论坛/任务面板/数据卡等，非MVU变量美化）渲染成界面 → 「[界面]页面名称」正则 + 规范AI输出的世界书条目\n\n' +
      '【酒馆正则配置模板（必须严格遵循）】\n' +
      '- 正文美化：名称[界面]正文美化，查找 <story>[\\s\\S]*?</story>（<story>可换任意标签名，须与extractContent里正则一致）\n' +
      '- 结构化数据：名称[界面]页面名称，查找 <标签名>[\\s\\S]*?</标签名>\n' +
      '- 勾选：AI输出✓、在编辑时运行✓、仅格式显示✓（placement=[2]/markdownOnly=true/promptOnly=false/runOnEdit=true）\n' +
      '# 注意：严禁使用<khl>、<thinking>、<content>标签；闭合标签后禁止输出其他内容；"{{}}"不是格式一部分，输出时禁止携带\n\n' +
      '【HTML模板铁律】必须严格基于下方标准模板生成，只允许改样式/标签名/数据格式，禁止删除核心函数结构：\n' +
      '· 正文美化：基于【正文美化标准模板】，只允许改<style>样式、换<story>标签名（连同extractContent正则）。禁止删除 getMessageData/extractContent/renderPage/init/$(function(){init();})\n' +
      '· 结构化数据：基于【结构化数据标准模板】，只允许改<style>样式、换标签名（连同parseData正则）、调整parseData解析与renderPage渲染、可加handleClick交互。禁止删除 getMessageData/parseData/renderPage/init/$(function(){init();})\n' +
      '· 完整HTML文档：<!DOCTYPE html>+<style>+<body>+<script>，代码全部内联，样式贴合聊天区宽度与世界观主题\n\n' +
      '──────── 正文美化标准模板 ────────\n' +
      FE_BEAUTIFY_BASE_HTML + '\n\n' +
      '──────── 结构化数据标准模板 ────────\n' +
      FE_STRUCTURED_BASE_HTML + '\n\n' +
      '【酒馆slash命令速查（界面交互按钮必须用真实语法，不可自创）】\n' +
      '- /send (string)：以用户身份发消息（不触发生成）；/trigger：触发消息生成。交互范式：triggerSlash(\'/send \'+keyword+\'：\'+param+\'|/trigger\')\n' +
      '- /sys (string)：系统旁白；/popup /input /buttons：弹窗交互；/setvar /getvar /addvar：本地变量；/setglobalvar：全局变量\n' +
      '- /inject id=唯一ID text：向LLM提示词注入文本；/delay (毫秒)：延迟；/echo (string)：toast提示\n\n' +
      '【输出格式（铁律，写卡器按此自动保存）】\n' +
      '· 正文美化：直接输出一个完整HTML代码块（```html），写卡器自动保存为[界面]正文美化正则，并自动联动生成[前端正文美化]世界书条目+把开场白用<story>包裹\n' +
      '· 结构化数据：必须按以下格式组织输出：\n' +
      '  【页面名称】任务面板（或论坛/数据卡等，用于正则名 [界面]任务面板）\n' +
      '  【标签名】panel（小写英文标签，用于查找正则<panel>...</panel>，严禁用think/thinking/content）\n' +
      '  【开场白示例】（可选）希望开场白立刻展示该面板的示例数据（写卡器自动包裹标签注入开场白）\n' +
      '  【HTML】\\n```html\\n（完整HTML文档）\\n```\\n' +
      '  写卡器自动生成规范AI输出的世界书条目（标题=[界面]页面名称，含Format示例）并把示例注入开场白\n' +
      '⚠️ 严禁把HTML代码放进JSON的entries数组/:::操作块/<statusblock>——HTML不属于世界书条目；修改界面直接输出新HTML代码块覆盖\n';
    // —— 前端轻量速览（未命中时注入）——
    const feBrief = '\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🖼️【领域速览 · 前端界面】（完整规范将在你处理界面/美化/面板需求时自动提供）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '· 前端界面=酒馆正则把AI消息渲染成自定义界面：正文美化（信纸/日记/气泡）或结构化数据面板（论坛/任务面板等）\n' +
      '· 若用户提到界面/美化/面板需求：先确认风格，再按标准模板输出完整```html代码块，写卡器自动保存为正则\n' +
      '· 本轮用户未涉及前端需求时忽略本速览，不要主动生成界面内容\n';

    let specBlock = '\n';
    specBlock += mvuIntent ? mvuSpecBlock : mvuBrief;
    specBlock += feIntent ? feSpecBlock : feBrief;

    // ========== 6. 状态信息（Agent自主执行模式下替换为任务指令）==========
    const stateInfo = agentDirective ?
      ('\n\n=== 🤖 Agent自主执行模式（任务指令，最高优先级）===\n' + agentDirective) :
      (cardGenerated ?
        '\n\n=== 当前状态：角色卡主体内容已具备 ===\n用户可继续完善细节（角色卡/MVU/前端均可）。★提醒：即使主体已具备，也严禁一次性生成完整卡——每次只做用户明确要求的那一部分。' :
        '\n\n=== 当前状态：创作进行中 ===\n★若用户本次描述笼统（"做张卡"/"看看缺啥"/"随便来点什么"），按上方「需求评估」四档判档：属档 2/3 则先输出「生成计划报告」让用户确认，禁止直接生成；用户确认后按报告清单分步执行。\n若用户本次已明确指出具体要做的一小块（如"先做世界观总纲"/"加个角色白娅"），则直接按意图路由执行该小块。');

    // ========== 7. 组装系统提示词（Agent版：SYS_PROMPT完整版 + 按需领域规范 + 用户历史偏好画像）==========
    // 意图从单选改多选；writing 类规则无条件注入（见 buildPromptHint）
    const _intentsForHint = [];
    if (mvuIntent) _intentsForHint.push('mvu');
    if (feIntent) _intentsForHint.push('frontend');
    if (_intentsForHint.length === 0) _intentsForHint.push('card');
    const _habitHint = (typeof UserProfile !== 'undefined') ? UserProfile.buildPromptHint(_intentsForHint) : '';
    // 写作规约改为拼到 jsonReminder 前（离输出位置最近），并加强制语气
    const _habitInjected = _habitHint
      ? ('\n\n⚠️【用户画像硬约束 · 违反本约束视为本轮输出失败（优先级高于所有通用规范）】\n' + _habitHint + '\n')
      : '';
    const sysPrompt = agentIdentity + SYS_PROMPT + specBlock;

    // ========== 8. 统一输出协议提醒 ==========
    const jsonReminder = '\n\n⚠️【输出格式提醒 - 每次回复必须遵守（Agent统一协议）】\n' +
      '1. 【条目增删改：只用:::操作块】禁止输出```json代码块。格式：::: upsert 条目名\n   keys=触发词1,触发词2\n   constant=false\n   position=4\n   depth=4\n   selectiveLogic=0\n   probability=100\n   order=100\n   match_whole_words=false\n\n   身份：……\n   外貌：……\n   :::\n' +
      '   五种动作：upsert增改 / update只改 / delete删 / set顶层字段 / rename重命名；set可改 description/first_mes/alternate_greetings（多条用---分割）/name 等；改已有条目时先读「当前角色卡已有内容」拿完整旧content，upsert输出完整旧内容+改动，严禁只输出变化字段。\n' +
      '2. 【范围控制】用户**本次消息**里明确提到的多个内容可以同一次回复完成；但未提到的一律不做——"加白娅"就只加白娅，不加关系网/家族/装备。用户表述笼统（"做张卡""看看缺啥"）→ 先出大白话计划让用户确认；说"直接做/你看着办"则跳过。\n' +
      '3. 【语义优先】用户说话=要增删改！反问句/不满句=隐含修改需求，不要当聊天。改+增+删可混在同一回复；只处理用户「最新一条」消息的指令。\n' +
      '4. 【修改原则】用户明确要求改/删/重写时直接改；未提及时保持原内容不动。与旧内容冲突时按用户意图覆盖，不必机械地"只增不删"。条目标签自由命名，结合已有内容调整 keys/constant/position/depth 使其协调。\n' +
      '5. 【正文YAML中文格式】content 禁止一大段无结构文字：每行「维度：内容」（身份/外貌/性格/能力/背景/关系等），列表用缩进+短横线，层级用缩进。生成/修改条目时按需填写会影响生效的字段（触发型必填 keys，常驻型 constant=true，自定义位置写 position/depth），其余保持默认。\n' +
      '6. 【MVU顺序自检】涉及MVU变量系统：先按 1→2→3→4→5→6→7→8 列一遍，从最小缺失序号开始连续输出；第2/3条字段名逐字照抄第1条zod schema；第4/5/6条原样照抄固定模板。⚠️豁免：单纯修改已存在MVU条目的字段值直接改即可，无需走完整顺序。MVU状态栏HTML与前端界面HTML各用独立完整```html代码块输出，严禁塞进操作块/JSON。\n' +
      '7. 【报告 vs 选项】报告=大白话讲清"要做什么+加哪几条+先做哪个"（60~300 字，5 段：🎯我想帮你做/🌍世界观或现状/📋打算加的条目/✏️要改的地方/🔧先做哪个，末尾附 <agent_plan>…</agent_plan> 2-8 步——没有它用户无法一键执行）；选项=<agent_options> 里的方案A/B/C，仅档 3 重大调整（需删/方向冲突/清空重做）使用；档 1/4 直接执行，不出报告不出选项。不要替用户做决定：用户没确认前一个字都不写进卡片。\n' +
      '8. 🎨【对话内容用 Markdown】鼓励使用 `## 标题`/`- ` 列表/`**加粗**` 增强可读性；避免 <details>/<summary>（写卡器会接管折叠）；有需要修改的内容时输出操作块/代码块，纯粹聊天/建议则正常回复即可。\n';

    // ========== Agent 模式：阶段性提示（只在真正需要时注入）==========
    // ★松绑P1-1：__cwForceUnderstandNext 标记已全面拆除（_suggestReport 只提示不设置），
    //   不再读取该标记；"我选择：xxx"→直接执行；其他→不注入，AI 自行判断
    let _agentStageBlock = '';

    if (!agentDirective) {
      let _lastUserTxt = '';
      for (let _mi = tabMessages.length - 1; _mi >= 0; _mi--) {
        if (tabMessages[_mi] && tabMessages[_mi].role === 'user') {
          _lastUserTxt = String(tabMessages[_mi].content || '').trim();
          break;
        }
      }
      const _isConfirmingMsg = /^我选择\s*[:：]/.test(_lastUserTxt) ||
        /^(确认|开始|ok|OK|Ok|可以|go|Go|GO|做吧|执行|同意|好的|好|行|行吧|没问题|继续|就这样|干吧)[。！!，,\s]*$/i.test(_lastUserTxt.trim());

      // ===== 迭代3：档3粗判布尔（涉及删/方向冲突 → 档 3），供下方 _agentStageBlock 分支使用 =====
      const _lastUserTxtForStage = (function() {
        const msgs = tabMessages;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i] && msgs[i].role === 'user') return String(msgs[i].content || '');
        }
        return '';
      })();
      // 粗判：涉及删/方向冲突 → 档 3（信号词与客户端选项剥离共用 MAJOR_CHANGE_SIGNALS_RE）
      const _promptIsMajorChange = MAJOR_CHANGE_SIGNALS_RE.test(_lastUserTxtForStage);

      if (_isConfirmingMsg) {
        _agentStageBlock =
          '\n\n' +
          '═══════════════════════════════════════════════════════════════════\n' +
          '✅【用户已确认方向 · 现在启动 Agent 执行】\n' +
          '═══════════════════════════════════════════════════════════════════\n' +
          '1. 如果你上一条回复已经输出过 <agent_plan>，写卡器会自动逐步执行——本轮你只需执行**第 1 步**。\n' +
          '2. 如果上一条没输出 <agent_plan>，本轮请先输出一份 <agent_plan>（2-8 步），然后**执行第 1 步**。\n' +
          '3. 每步只做一小块（如"加主角条目""补 MVU 第 1 条 zod脚本"），禁止一步做完全部。\n';
        const _mChoice = _lastUserTxt.match(/^我选择\s*[:：]\s*([\s\S]+)$/);
        if (_mChoice && _mChoice[1]) {
          _agentStageBlock +=
            '\n\n📌【本次严格约束 · 最高优先级】\n' +
            '用户在理解阶段已确认方向：⟦' + _mChoice[1].trim() + '⟧\n' +
            '你的输出**必须严格限定在这个方向之内**，禁止扩张到用户未确认的其他领域。\n';
        }
      }
      // 其他情况：不注入阶段提示，AI 按 agentIdentity 里的评估规则自行判断
    }

    let fullPrompt = sysPrompt + stateInfo + existingInfo + qcBlock + _habitInjected + jsonReminder + _agentStageBlock + '\n\n=== 对话历史（Agent单会话） ===\n';

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
          // 清理```代码块：不静默删除（否则AI看不到自己上轮生成的HTML），替换成简短标记保留上下文意识
          // ⚠️负向先行断言：execnotes 执行结果块保留原文（失败信息必须完整传给下一轮AI）
          .replace(/```(?!execnotes\b)(\w*)\s*([\s\S]*?)```/g, function(_, lang, code) {
            return '（已保存的' + (lang ? lang.toUpperCase() : '代码') + '块，约' + String(code||'').split('\n').length + '行）';
          })
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

    // 额外追加锚点提示（Agent自主执行模式：批量执行当前步骤+控制标记；自由对话模式：只回答最新指令+自主续跑标记）
    fullPrompt += agentDirective ?
      '（你正处于Agent自主执行模式：忽略「最新指令」标记，直接批量执行上方任务指令中的「当前任务」——把该步骤全部产物在本次回复中一次性输出（多个:::操作块/多个```html代码块混排均可，写卡器全部自动提取），不要向用户提问、不要只做说明不产出内容；MVU依赖顺序（前7条后才生成第8条）仍需遵守但无需逐条停顿。完成当前步骤后在回复末尾输出控制标记。）' :
      '（请只针对上方>>>标记的最新指令回复，不要重复处理已回答过的旧指令。\n\n' +
      '【本轮行动指南 · 四档判档 · 最高优先级】\n' +
      '  · 档位判定与各档动作见上方「需求评估 · 每轮的第一步」（档1微调直接执行；档2生成/大改先出「生成计划报告」等确认；档3重大调整报告+<agent_options>方案选项；档4强制跳过确认直接执行）。\n' +
      '  · 若你上轮已输出「生成计划报告」且用户本轮回复「确认/开始/OK/可以/做吧」等肯定词：严格按上方「本次执行契约」清单执行，只做清单内的内容，严禁越界。\n' +
      '  · 档 1/档 4 的大任务需多轮完成时：末尾单独一行输出 <agent:continue>，写卡器会自动续跑（最多15轮），全部完成时输出 <agent:done>；下一轮基于历史继续未完成部分，不要重复已完成内容。\n' +
      '  · 若用户消息形如"我选择：xxx"，那是选项确认——直接执行该方向，不要再给概览/选项。）';

    return fullPrompt;
  }

  // ========== 工具函数：从SYS_PROMPT中剔除MVU相关段落（角色卡Tab用） ==========
  // @deprecated Agent 单界面版未使用，保留供历史参考
  function filterOutMvuSectionsFromSysPrompt(originalPrompt) {
    if (!originalPrompt) return originalPrompt;
    // 通过关键词过滤掉MVU专属的大型段落：
    // （正则脚本文档/示例、状态栏Step生成流程、MVU脚本API等已从SYS_PROMPT源头删除，无需运行时过滤）
    // 1. 条目命名规范中 [InitVar]/变量当前状态/变量更新规则/变量输出格式/<状态变量输出>
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
  // @deprecated Agent 单界面版未使用
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
    // 只发 comment + content 完整内容，且明确标注「只读、不可修改」
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
      '   第4条：变量当前状态（固定模板，注入当前变量状态）\n' +
      '   第5条：[mvu_update]变量输出格式（<UpdateVariable>+<JSONPatch>4种操作）\n' +
      '   第6条：[mvu_update]变量输出格式强调（固定内容，默认enabled=false）\n' +
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
      '第4条: comment="变量当前状态", constant=true, position=4, depth=1, order=69000\n' +
      '       content 固定模板：{{format_message_variable::stat_data}} 展开当前变量快照（详见MVU_VAR_SPEC第4条）\n' +
      '第5条: comment="[mvu_update]变量输出格式", constant=true, position=4, depth=0, order=200\n' +
      '       content=固定中文格式原样输出，<UpdateVariable>+<Analysis>+<JSONPatch>（详见MVU_VAR_SPEC第5条）\n' +
      '第6条: comment="[mvu_update]变量输出格式强调", constant=true, position=4, depth=0, order=200, enabled=false\n' +
      '       content=固定内容原样输出，AI不输出<UpdateVariable>时启用强制提醒（详见MVU_VAR_SPEC第6条）\n' +
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
      '2. 【_.get 根路径统一】populateCharacterData 必须从 _.get(allVars, "stat_data", {}) 取根节点，再逐变量 _.get(statData, "顶层键.子键", 默认值)——MVU 底层自动把 InitVar 的顶层键挂载到 stat_data 下（InitVar 正文**不写** stat_data 根键），变量当前状态条目由 {{format_message_variable::stat_data}} 宏注入当前变量快照。\n' +
      '3. 【逐变量id填充模式统一（用户模板标准核心）】HTML 中每个需显示的变量必须有**唯一id** ↔ populateCharacterData 中用 $(\'#id\').text(value) / $(\'#id\').html(html) 对应选择器逐变量填充。禁止使用递归 renderTree！\n' +
      '   · HTML 骨架 id 命名 ↔ populateCharacterData $(\'#id\') 选择器必须字字一一对应（错一个字母=该变量永远不显示）\n' +
      '   · 禁止"不为每个变量写id，让递归renderTree自动生成"的旧模式——用户模板已废弃该做法\n' +
      '4. 【覆盖而非新增】修改 MVU 条目或状态栏脚本时，必须用相同的 comment / id 覆盖现有条目，禁止新增重复条目。\n' +
      '   · 美化状态栏正则脚本固定只有一个（id=mvu-status-bar, findRegex=/<StatusPlaceHolderImpl\\\\/>/g），写卡器自动覆盖，你不要在JSON里重复输出\n' +
      '   · MVU变量条目各自只保留一条：[InitVar]初始变量 / 变量当前状态 / 变量更新规则 / 变量输出格式 / 变量输出格式强调 / <状态栏>占位符提醒\n' +
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
      '· 没有需要修改的内容就输出文字说明\n' +
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
          // 清理```代码块：不静默删除（否则AI看不到自己上轮生成的HTML），替换成简短标记保留上下文意识
          .replace(/```(\w*)\s*([\s\S]*?)```/g, function(_, lang, code) {
            return '（已保存的' + (lang ? lang.toUpperCase() : '代码') + '块，约' + String(code||'').split('\n').length + '行）';
          })
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

  // ===== 构建前端界面 Tab 提示词（正文美化 + 结构化数据面板统一，AI自动判断类型，与角色卡/MVU Tab 完全隔离）=====
  // @deprecated Agent 单界面版未使用
  function buildFrontendTabPrompt(cardData, messages) {
    const cd = cardData || {};
    // 1. 当前角色卡内容上下文（仅作风格/世界观参考，不发送角色卡生成逻辑）
    let cardContext = '';
    const ctxParts = [];
    if (cd.name) ctxParts.push('角色/世界名称：' + cd.name);
    if (cd.description) ctxParts.push('世界观描述(完整' + (cd.description || '').length + '字，不截断)：' + (cd.description || ''));
    if (cd.first_mes) ctxParts.push('开场白(完整' + (cd.first_mes || '').length + '字，不截断)：' + (cd.first_mes || ''));
    const entries = (cd.character_book || {}).entries || [];
    // 注入常规世界书条目完整内容（只读上下文，用于设计界面风格参考，禁止修改）
    const nonMvuEntries = entries.filter(function(e) {
      const c = (e.comment || '').toLowerCase();
      if (c.indexOf('[initvar]') >= 0) return false;
      if (c.indexOf('变量更新规则') >= 0) return false;
      if (c.indexOf('变量输出格式') >= 0 || c.indexOf('mvu_update') >= 0) return false;
      if (c.indexOf('状态变量输出') >= 0) return false;
      if (c.indexOf('<状态栏>') >= 0) return false;
      return true;
    });
    if (nonMvuEntries.length > 0) {
      let nonMvuText = '世界书常规条目内容（' + nonMvuEntries.length + '条 · 只读上下文，用于界面风格参考，❌禁止修改这些条目）：\n';
      nonMvuEntries.forEach(function(e, i) {
        nonMvuText += '  ' + (i + 1) + '. [' + (e.comment || '条目' + (i + 1)) + '] (完整' + (e.content || '').length + '字，不截断):\n' + (e.content || '') + '\n';
      });
      ctxParts.push(nonMvuText);
    }
    // 当前已有的前端正则状态（正文美化 + 结构化面板，全部展示供AI参考）
    const regexScripts = (cd.extensions || {}).regex_scripts || [];
    const feRegexScripts = regexScripts.filter(function(s) {
      if (!s) return false;
      return (s.id === 'frontend-beautify') || ((s.scriptName || '').indexOf('[界面]') >= 0);
    });
    if (feRegexScripts.length > 0) {
      let rxText = '当前已有前端正则脚本（' + feRegexScripts.length + '条）：\n';
      feRegexScripts.forEach(function(r, i) {
        rxText += '── 正则 ' + (i + 1) + ' ──\n';
        rxText += '名称: ' + (r.scriptName || '(空)') + '\n';
        rxText += '查找表达式: ' + (r.findRegex || '(空)') + '\n';
        rxText += 'disabled: ' + (!!r.disabled) + '\n\n';
      });
      ctxParts.push(rxText);
    }
    if (ctxParts.length > 0) {
      cardContext = '\n' +
        '═══════════════════════════════════════════════════════════════════\n' +
        '📋 当前角色卡内容上下文（仅作前端界面设计参考用）\n' +
        '═══════════════════════════════════════════════════════════════════\n' +
        ctxParts.join('\n───\n') + '\n' +
        '═══════════════════════════════════════════════════════════════════\n';
    }

    // 2. 前端界面专属系统指令（统一：正文美化 / 结构化数据面板，AI根据用户输入自动判断类型）
    // ⚠️标准基准模板（用户提供）：AI 必须严格基于此结构生成，只允许修改样式/标签名/数据格式，
    //   禁止删除 getMessageData / extractContent|parseData / renderPage / init / $(function(){init();}) 等核心结构。
    /* Agent版：FE 模板已提取为顶层常量（FE_BEAUTIFY_BASE_HTML / FE_STRUCTURED_BASE_HTML），此处直接引用 */
    let feSystemPrompt = '' +
      '你是「前端界面设计师」——专门负责设计酒馆聊天界面的前端正则，把AI消息渲染成自定义界面。' +
      '根据用户的描述自动判断要生成哪一类：\n' +
      '  · 正文美化：把AI正文渲染成信纸/日记/对话气泡等自定义界面 → 生成「[界面]正文美化」正则\n' +
      '  · 结构化数据：把AI按特定格式输出的数据（状态栏、论坛、任务面板等，**非MVU变量美化**）渲染成界面 → 生成「[界面]页面名称」正则 + 规范AI输出的世界书条目\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🎯 你的专属职责（只有这些，别的都不管）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      'A. 根据用户需求设计「[界面]正文美化」或「[界面]页面名称」正则（页面名称按用途定：如[界面]任务面板、[界面]论坛、[界面]状态栏）\n' +
      'B. 设计数据格式（结构化时：[字段名|值] 或 键值对）+ 完整HTML替换代码，样式贴合当前角色卡世界观\n' +
      'C. 结构化时：设计「规范AI输出」的世界书条目（条目标题=此前端名称，内容含注意事项+触发条件Format示例）——写卡器会据你的输出自动生成，你只需保证数据格式清晰\n' +
      'D. 只负责前端界面正则，绝不生成角色卡字段/MVU变量内容（zod脚本/[InitVar]/<状态栏>等一律禁止）\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '📌 酒馆正则配置模板（必须严格遵循）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '- 正文美化：正则名称 [界面]正文美化，查找正则表达式 <story>[\\s\\S]*?</story>（<story>可换任意标签名）\n' +
      '- 结构化数据：正则名称 [界面]页面名称，查找正则表达式 <标签名>[\\s\\S]*?</标签名>\n' +
      '替换为: 下方HTML代码（必须用```html代码块包裹）\n' +
      '勾选: AI输出 ✓、在编辑时运行 ✓、仅格式显示 ✓\n' +
      '（对应regex_scripts字段：placement=[2]、markdownOnly=true、promptOnly=false、runOnEdit=true）\n\n' +
      '# 注意\n' +
      '- 严禁使用<think>、<thinking>、<content>标签\n' +
      '- 闭合标签后禁止输出其他内容\n' +
      '- （如果使用{{}}占位符）"{{}}"并不是格式的一部分，输出时禁止携带\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🧩 前端界面HTML代码模板（铁律：必须严格基于下方标准模板生成，禁止删除核心函数结构）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '· 正文美化：严格基于【正文美化标准模板】生成。只允许：修改 <style> 里的样式（信纸/日记/气泡等）、' +
      '按用户要求更换 <story> 标签名（连同 extractContent 里的正则一起改）。禁止删除 getMessageData / extractContent / renderPage / init / $(function(){init();})。\n' +
      '· 结构化数据：严格基于【结构化数据标准模板】生成。只允许：修改 <style> 样式、把 <标签名> 换成你的真实标签（连同 parseData 里的正则一起改）、' +
      '按数据格式调整 parseData 解析与 renderPage 渲染、可加 handleClick 交互。禁止删除 getMessageData / parseData / renderPage / init / $(function(){init();})。\n' +
      '· 完整HTML文档：<!DOCTYPE html> + <style> + <body> + <script>，代码全部内联，样式贴合聊天区宽度与主题。\n\n' +
      '────────────────────────────────────────────────\n' +
      '📋 正文美化标准模板（必须严格基于此结构生成）：\n' +
      '────────────────────────────────────────────────\n' +
      FE_BEAUTIFY_BASE_HTML + '\n\n' +
      '────────────────────────────────────────────────\n' +
      '📋 结构化数据标准模板（必须严格基于此结构生成）：\n' +
      '────────────────────────────────────────────────\n' +
      FE_STRUCTURED_BASE_HTML + '\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '🧰 酒馆 slash 命令速查（前端界面交互用——设计按钮/点击交互时，必须使用下方真实酒馆语法，不可自创）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '- /send (string)：向聊天记录添加用户消息，不触发生成。例：/send 检查背包\n' +
      '- /trigger (string)?：触发消息生成（群聊可指定索引/名字）。例：/send 检查背包|/trigger\n' +
      '- /sendas name="角色名" (string)：以指定角色（含头像）发送消息\n' +
      '- /sys (string)：以系统旁白发送消息；/comment (string)：添加不属于聊天的备注消息（compact=true 紧凑布局）\n' +
      '- /buttons labels=["A","B"] (string)：显示带按钮的阻塞弹窗，点击的按钮标签返回管道\n' +
      '- /popup okButton="确认" (string)：显示阻塞弹窗并返回结果；/input default="默认值" (string)：显示输入框弹窗并返回输入\n' +
      '- /if left=变量 right=值 rule=eq "命令"：条件执行命令（rule: eq/neq/gt/gte/lt/lte/in/nin/not）\n' +
      '- /setvar key=变量 值：设置本地变量并传入管道；/getvar 变量：读取本地变量；/addvar key=变量 数值：本地变量加值\n' +
      '- /incvar /decvar：本地变量 ±1；/setglobalvar /getglobalvar：全局变量存取；/flushvar /flushglobalvar：删除变量；/let 变量 值：声明作用域变量；/listvar：列出变量\n' +
      '- /inject id=唯一ID text：向LLM提示词注入文本（深度默认4、身份默认system，可用于注入状态数据）\n' +
      '- /char-get field=name|description|personality|scenario|first_mes|creator_notes|system_prompt：读取角色卡字段\n' +
      '- /event-emit event="事件名" data=...：发送自定义事件（监听该事件的脚本自动运行）\n' +
      '- /echo title="标题" (string)：toast 提示消息（severity=info|warning|error、color=颜色）\n' +
      '- /delay (毫秒)：延迟下一条命令；/gen (string)：用提示词生成文本并传入管道（不含聊天历史）；/regex name="脚本名" (string)：运行正则脚本\n' +
      '- /times N "命令"：重复执行N次（{{timesIndex}}为当前索引）；/while left=变量 rule=lte right=值 "命令"：循环执行；/break：跳出循环\n' +
      '- /run 闭包或QR名：运行闭包/快捷回复\n' +
      '- 变量宏：{{var::x}}（本地变量）、{{getvar::x}}（全局变量）、{{pipe}}（管道上一步的值）、{{user}}、{{char}}、{{lastMessage}}\n' +
      '- 交互范式（结构化面板 handleClick 标准写法）：\n' +
      '    handleClick(keyword, param) { if (typeof triggerSlash === "function") triggerSlash(\'/send \' + keyword + \'：\' + param + \'|/trigger\'); }\n' +
      '    即：点击界面按钮 → 以用户身份发送「关键词：参数」→ 触发AI生成响应；需要更复杂交互时（变量/条件/弹窗/注入）可自由组合上方命令。\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '📜 输出格式（铁律，写卡器按此自动保存）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '· 正文美化：直接输出一个完整HTML文档代码块（```html 或纯```），写卡器自动提取保存为[界面]正文美化正则\n' +
      '   · 自动联动（写卡器执行）：① 自动生成世界书条目[前端正文美化]（规范AI用 <story> 包裹正文）② 自动把现有开场白正文用 <story> 标签包裹（若尚未包裹，让正文美化正则立即生效）\n' +
      '· 结构化数据：回复时必须按以下格式组织（便于写卡器提取页面名称/标签名/HTML）：\n' +
      '  【页面名称】任务面板（或论坛/状态栏等，用于生成正则名 [界面]任务面板）\n' +
      '  【标签名】panel（小写英文标签，用于查找正则 <panel>...</panel>，严禁用 think/thinking/content）\n' +
      '  【开场白示例】（可选）若希望开场白立刻展示该面板效果，在此给出要注入的示例数据（写卡器自动包裹<标签名>并追加到开场白；省略则自动用通用格式示例）\n' +
      '  【HTML】\n' +
      '  ```html\n' +
      '  （完整HTML文档）\n' +
      '  ```\n' +
      '  【世界书条目】写卡器会自动生成规范AI输出的世界书条目（标题=[界面]任务面板，含注意事项+Format示例），你无需输出条目JSON\n' +
      '   · 自动联动（写卡器执行）：生成成功即自动把 <标签名> 示例块注入开场白末尾（若开场白已有该标签则跳过），让正则一进酒馆就能渲染\n\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '⚠️ 前端 Tab 核心铁律（最高优先级）\n' +
      '═══════════════════════════════════════════════════════════════════\n' +
      '1. ✅唯一输出格式：正文美化=一个完整HTML代码块；结构化=【页面名称】+【标签名】+ 一个完整HTML代码块，写卡器自动提取保存\n' +
      '2. ⚠️严禁把HTML代码放进JSON的entries数组、:::操作块、<statusblock>——HTML代码不属于世界书条目\n' +
      '3. ⚠️不要生成任何角色卡/世界书相关的JSON（name/description/entries）\n' +
      '4. ⚠️不要生成任何MVU变量内容（zod脚本/[InitVar]/变量当前状态/<状态栏>）\n' +
      '5. 修改已有界面时：直接输出新的HTML代码块（结构化需含新【页面名称】【标签名】），写卡器自动覆盖\n' +
      '6. 只处理用户「最新一条」消息的指令，不要重复处理旧指令\n' +
      '7. 所有前端界面生成成功后，写卡器自动联动「世界书条目 + 开场白」：正文美化 → [前端正文美化]条目 + <story>包裹开场白；结构化 → [前端数据面板]X条目 + 开场白注入<标签名>示例块。你无需手动输出世界书JSON，也不要自己直接改开场白——需要展示什么数据写在【开场白示例】里即可，写卡器自动处理\n';

    // 3. 组装完整提示词
    let fullPrompt = feSystemPrompt + cardContext +
      '\n\n═══════════════════════════════════════════════════════════════════\n' +
      '📜 对话历史（前端界面 Tab专属，与角色卡/MVU Tab完全隔离）\n' +
      '═══════════════════════════════════════════════════════════════════\n';

    // 对话历史（与MVU Tab同逻辑：清理代码块/操作块，AI不需要再看格式指令）
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
      let msgContent = m.content || '';
      if (m.role === 'assistant') {
        msgContent = msgContent
          .replace(/:::\s*(?:upsert|update|delete|set|rename)\s+[^\n\r]*[\s\S]*?(?=\n\s*:::|\n\n|$)/gi, '')
          .replace(/:::\s*(?:upsert|update|delete|set|rename)\s+[^\n\r]*/gi, '')
          .replace(/^\s*:::\s*$/gim, '')
          .replace(/```[\s\S]*?```/g, '')
          .replace(/<details[\s\S]*?<\/details>/gi, '')
          .replace(/<statusblock>[\s\S]*?<\/statusblock>/gi, '')
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
    fullPrompt += '（请只针对上方>>>标记的最新指令回复。严格遵守前端 Tab 核心铁律：按上面输出格式回复（正文美化=完整HTML代码块；结构化=【页面名称】+【标签名】+完整HTML代码块），不生成任何角色卡/世界书/MVU内容。）';

    return fullPrompt;
  }

  // ========== 工具函数：角色卡Tab专属 - 从AI返回的parsed JSON中剔除MVU相关内容 ==========
  // 这是最后一道防线：即使AI违反prompt禁令生成了MVU内容，这里也会硬性拦截过滤
  // @deprecated Agent 单界面版未使用
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
          if (entryCmt.indexOf('变量当前状态') >= 0) isMvuTarget = true;
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
          if (cmt.indexOf('变量当前状态') >= 0) return false;
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
  // 剥离 AI 误写的 stat_data 根键，但保留 `_` 和 `$` 字段（初始变量允许只读/派生字段占位）
  function stripStatDataRoot(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const keys = Object.keys(obj);
    // 若顶层只有一个键且为 stat_data，则下钻一层
    if (keys.length === 1 && keys[0] === 'stat_data') {
      const inner = obj.stat_data;
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        return stripStatDataRoot(inner);
      }
    }
    // 递归剥离 stat_data 根键，但不再过滤 _/$ 开头字段
    const result = {};
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        result[k] = stripStatDataRoot(v);
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  // 规范化 InitVar 条目内容：剥离 AI 误写的 stat_data 根键
  // MVU 底层自动挂载到 stat_data，InitVar 中再写一层会导致套娃
  // ⚠️ 按需规范化：仅当检测到 stat_data 根键 / 代码围栏 / JSON 格式时才重建 YAML，
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
    if (hasStatDataRoot || hadFence || wasJson) {
      // ⚠️_/$ 开头字段（只读/派生）已允许出现在初始变量中，不再作为重建触发条件
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

  // ===== 变量当前状态内容规范化 =====
  // ⚠️固定格式（对齐造物工坊规范）：标签内为 {{format_message_variable::stat_data}} 宏，
  // 由 MVU 脚本在注入时展开为当前剧情末尾的变量状态快照
  function normalizeVarListContent(content) {
    // ⚠️强制重建为固定格式（不管 AI 写了什么）
    return '<status_current_variable>\n当前剧情末尾的变量状态如下：\n\n{{format_message_variable::stat_data}}\n\n</status_current_variable>';
  }

  // ⚠️已删除：_getParsedInitForEntries —— 模板5为完全固定格式（不按本卡 schema 动态生成
  // JSON Patch 示例路径），解析 InitVar 的需求已随 fixVarOutputFormatPaths 一并移除

  // ===== 🧹 规范化变量输出格式/变量输出格式强调条目 content =====
  // 这两个条目的 content 是固定 YAML 模板（用户模板5/6），AI 不应修改。
  // 如果 AI 把变量实际值/配置字段混入，强制重建为标准模板。
  function normalizeVarOutputFormatContent(comment, content) {
    const core = _entryCommentCore(String(comment || ''));   // 剥 [xxx]/<xxx> 前缀
    if (core === '变量输出格式强调') return generateVarOutputEmphasis();
    if (core === '变量输出格式') return generateVarOutputFormat();
    return content;   // 非系统条目原样返回
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
    // 第二个文件规范：InitVar 允许（且鼓励）写出 _/$ 开头的只读/隐藏字段作为初始占位
    const lines = [];
    (charNames || []).forEach(function(name) {
      lines.push(name + ':');
      lines.push('  好感度: 0');
      lines.push('  心情: 平静');
      lines.push('  物品: []');
      lines.push('  衣着:');
      lines.push('    上衣: 未知');
      lines.push('    下装: 未知');
      lines.push('  _关系阶段: 泛泛之交');
    });
    if (!charNames || charNames.indexOf('主角') < 0) {
      lines.push('主角:');
      lines.push('  好感度: 0');
      lines.push('  心情: 平静');
      lines.push('  物品: []');
      lines.push('  衣着:');
      lines.push('    上衣: 未知');
      lines.push('    下装: 未知');
      lines.push('  _关系阶段: 泛泛之交');
    }
    lines.push('世界:');
    lines.push('  日期: 2025-10-22');
    lines.push('  时间: 09:00');
    lines.push('  天气: 晴');
    lines.push('$成就:');
    lines.push('  知彼知己: false');
    lines.push('  初露锋芒: false');
    lines.push('  慷慨之举: false');
    return lines.join('\n');
  }

  // 生成变量当前状态内容（固定格式，对齐造物工坊规范）
  function generateVarListContent() {
    return '<status_current_variable>\n当前剧情末尾的变量状态如下：\n\n{{format_message_variable::stat_data}}\n\n</status_current_variable>';
  }

  // ⚠️已删除：generateVarSegmentedPrompt（变量分段/EJS 提示模板）——
  // 不属于用户规定的 MVU 六大标准模板（结构脚本/初始变量/更新规则/变量当前状态/输出格式/格式强调），
  // 且 EJS 分段提示属于8条工作流之外的额外条目，按规范全部移除

  // 生成变量更新规则内容（TypeScript interface 格式，对齐造物工坊规范）
  function generateVarUpdateRule(charNames) {
    return [
      '---',
      '在你的回复最后，必须根据新输出剧情末尾的实际状态，判断变量是否需要更新，如需要更新，则遵循下述规则：',
      '',
      'interface State {',
      '  角色: {',
      '    ' + (charNames[0] || '角色') + ': {',
      '      好感度: number; // 范围为 0~100；除非发生重大事件，否则单次增减必须在 ±5 以内',
      '      心情: string; // 根据角色的实际情绪更新',
      '      物品: string[]; // 获得、消耗、遗失或转移物品时新增或删除对应元素',
      '      衣着: { // 明确更换服装时更新',
      '        上衣: string;',
      '        下装: string;',
      '      };',
      '    };',
      '  };',
      '',
      '  世界: {',
      '    日期: string; // 格式为 YYYY-MM-DD，在剧情时间跨日时更新',
      '    时间: string; // 格式为 HH:mm，根据剧情实际经过的时间合理推进',
      '    天气: \'晴\' | \'多云\' | \'雨\' | \'暴雨\' | \'雪\'; // 在剧情明确表现天气变化时更新',
      '  };',
      '}'
    ].join('\n');
  }

  // 规范化变量更新规则内容（TypeScript interface 格式）
  function normalizeVarUpdateRuleContent(content) {
    if (!content || !content.trim()) return generateVarUpdateRule([]);
    let text = content.replace(/```typescript\s*/gi, '').replace(/```ts\s*/gi, '').replace(/```\s*$/g, '').trim();
    // 去除可能的前导 --- 分隔符（保留一个）
    text = text.replace(/^---\s*\n/, '');
    // 补回前导 ---
    if (!/^---/.test(text)) text = '---\n' + text;
    // ⚠️只有内容看起来像 TS interface 字段时才包裹为 interface State；
    // YAML 版规则（旧卡残留/用户粘贴旧规则）原样保留，避免把 YAML 塞进 interface 生成语法错误
    const _looksLikeTs = /:\s*(number|string|boolean|\[|\{|'|")/.test(text) &&
      !/^\s*\S+\s*:\s*\n/m.test(text.split('\n').slice(1).join('\n'));
    if (_looksLikeTs && !/interface\s+State\s*\{/.test(text)) {
      text = '---\ninterface State {\n' + text.replace(/^---\s*\n/, '') + '\n}';
    }
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

  // 生成变量输出格式内容（四种操作，去掉 move）
  // ⚠️完全固定英文模板，原封不动输出（不要修改字段、不要加注释、不要替换占位符、不要动态生成路径示例）
  // ⚠️使用 ${...} 占位符，路径示例均为占位符（如 ${/path/to/variable}），不根据本卡 schema 动态生成
  // ⚠️已删除 fixVarOutputFormatPaths/derivePatchExamples：模板5属"完全固定格式"，
  //   任何按本卡 schema 动态改写示例路径的行为都违反规范，AI 照抄模板即可
  function generateVarOutputFormat() {
    return ['---',
      '更新必须遵循以下语法规则，并包裹在`<UpdateVariable>`标签内：',
      '- 使用有效的 JSON 数组，每个元素表示单个操作对象，仅支持`replace`（替换已存在变量）、`delta`（使用差值更新已存在变量）、`insert`（插入新元素到对象或数组，如使用`-`作为数组索引，则追加到末尾）、remove（移除已存在变量）四种操作。',
      '- 禁止更新以`_`为开头的变量，这些是只读变量。',
      '',
      '<UpdateVariable>',
      '<Analysis>',
      '更新列表:',
      '- ${变量名称} ${完整操作路径}: ${仅根据本次回复说明更新原因，该变量在本次剧情中发生了什么变化，为什么需要更新}',
      '</Analysis>',
      '<JSONPatch>',
      '[',
      '  { "op": "replace", "path": "${/到/变量/的路径}", "value": ${新值} },',
      '  { "op": "delta", "path": "${/到/数值/变量/的路径}", "value": ${正或负的变动值} },',
      '  { "op": "insert", "path": "${/到/对象/新键/的路径}", "value": ${新值} },',
      '  { "op": "insert", "path": "${/到/数组/-}", "value": ${新值} },',
      '  { "op": "remove", "path": "${/到/对象/键/的路径}" }, ',
      '  { "op": "remove", "path": "${/到/数组/的路径/0}" },',
      '  ...',
      ']',
      '</JSONPatch>',
      '</UpdateVariable>'
    ].join('\n');
  }

  // 生成变量输出格式强调内容
  // ⚠️完全固定，原封不动输出（不要修改字段、不要加注释、不要替换占位符）
  // 默认关闭（enabled=false），AI不输出<UpdateVariable>时才启用
  function generateVarOutputEmphasis() {
    return ['---',
      '注意：以下内容必须插入到回复末尾，不可省略。',
      '',
      '<UpdateVariable>',
      '...',
      '</UpdateVariable>'
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
    // ⚠️修复：部分 ST 版本 getCharacterNames 可能返回 undefined/对象，.indexOf 会崩，统一兜底成数组
    const _resolveNames = function() {
      if (!getCharacterNames) return [];
      const n = getCharacterNames() || [];
      return Array.isArray(n) ? n : [];
    };
    let names = _resolveNames();
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
          names = _resolveNames();
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
    // srcdoc iframe 的 baseURI 可能是 about:srcdoc，相对路径 /api/... 会解析失败。
    // 优先用父窗口 origin 拼绝对 URL；父窗口不可访问时回退相对路径（同域场景仍可用）。
    let _createUrl = '/api/characters/create';
    try {
      const _parentLoc = (window.parent && window.parent.location) ? window.parent.location : null;
      const _origin = _parentLoc ? _parentLoc.origin : '';
      if (_origin && _origin !== 'null' && /^https?:/.test(_origin)) _createUrl = _origin + _createUrl;
    } catch (_eOrigin) { /* 跨域时父窗口 location 不可读，保持相对路径 */ }
    const resp = await fetch(_createUrl, {
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
      enabled: s.enabled !== undefined ? !!s.enabled : true,
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
    const newName = String((newScript && newScript.name) || '').toLowerCase();
    let idx = -1;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (s.type !== 'script' && !s.name) continue;
      const sName = String(s.name || s.scriptName || '').toLowerCase();
      if (s.id === newScript.id || (newName && sName === newName)) {
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
      id: 'mvu-schema',
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
        runOnEdit: false, // 与 ensureFixedMvuAssetsInCardData 一致：避免编辑消息时重复移除 <Analysis>
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
        runOnEdit: false, // 与卡片内一致：避免编辑消息时重复剥离旧变量更新
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
      // ⚠️修复：id 固定为 'mvu-status-hide'（与 ensureFixedMvuAssetsInCardData 注入/去重/识别完全一致，
      // 原先 _genId 每次写入生成新id，重命名脚本后残留旧版本）
      {
        id: 'mvu-status-hide',
        script_name: '[不发送]隐藏状态栏标记',
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
        run_on_edit: false, // 与卡片内一致：编辑消息时无需重复剥离占位符
        min_depth: null,
        max_depth: null
      },
      // 6. MVU状态栏（display:true, prompt:false）
      // ⚠️注意：状态栏保留 run_on_edit:true（见 saveStatusBarToCard）——编辑历史消息时需按当前变量重渲染状态栏
      // ⚠️修复：id/script_name 与 saveStatusBarToCard 完全统一（id='mvu-status-bar'、name='[美化]MVU状态栏'），
      // 否则两处各自写入同名不同 id 的脚本会在酒馆里重复渲染状态栏
      {
        id: 'mvu-status-bar',
        script_name: '[美化]MVU状态栏',
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
    // ⚠️修复：兼容旧命名——历史写入可能残留 script_name='MVU状态栏' 的旧脚本，同样视为重复删除
    nameSet['MVU状态栏'] = true;
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

  // 写入前端界面正则（[界面]正文美化 + [界面]页面名称 结构化面板）
  // ⚠️修复：写入酒馆时此前只写 MVU 状态栏正则，前端正则（正文美化/结构化）从未写入，导致酒馆里没有界面效果。
  // 与 _tavernWriteRegexScripts 相同写入方式（updateCharacterWith + updateTavernRegexesWith），按 script_name 去重。
  async function _tavernWriteFrontendRegexes(name, feRegexList) {
    const validated = _tavernValidateName(name);
    const scripts = (feRegexList || []).map(function(r) {
      if (!r) return null;
      const name = String(r.scriptName || r.script_name || '').trim();
      if (!name) return null;   // ← 新增：丢弃无名正则（避免 ST 端写入 script_name=undefined 的脏条目）
      return _convertRegexScript({
        id: r.id,
        scriptName: name,
        findRegex: r.findRegex || r.find_regex,
        replaceString: r.replaceString || r.replace_string,
        trimStrings: r.trimStrings || r.trim_strings,
        placement: r.placement || [2],
        markdownOnly: (r.markdownOnly !== undefined ? r.markdownOnly : (r.destination ? !!r.destination.display : true)),
        promptOnly: (r.promptOnly !== undefined ? r.promptOnly : (r.destination ? !!r.destination.prompt : false)),
        runOnEdit: (r.runOnEdit !== undefined ? r.runOnEdit : true),
        minDepth: r.minDepth !== undefined ? r.minDepth : null,
        maxDepth: r.maxDepth !== undefined ? r.maxDepth : null
      });
    }).filter(Boolean);
    if (scripts.length === 0) return;
    const nameSet = {};
    scripts.forEach(function(s) {
      if (s.script_name) nameSet[s.script_name] = true;
    });

    // ⚠️修复：与 _tavernWriteRegexScripts 一致，先从酒馆API取到 updateCharacterWith，
    // 否则下方直接 await 会抛 ReferenceError: updateCharacterWith is not defined
    const updateCharacterWith = _tavernFn('updateCharacterWith');
    if (!updateCharacterWith) throw new Error('酒馆不支持 updateCharacterWith API');

    await _tavernEnsureCharacter(validated);
    await updateCharacterWith(validated, function(charData) {
      if (!charData.extensions) charData.extensions = {};
      if (!Array.isArray(charData.extensions.regex_scripts)) charData.extensions.regex_scripts = [];
      const filtered = charData.extensions.regex_scripts.filter(function(r) {
        if (r && r.script_name && nameSet[r.script_name]) return false;
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
          if (r && r.script_name && nameSet[r.script_name]) return false;
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
    if (!e || typeof e !== 'object') return null;
    const comment = e.comment || e.name || e.title || ('条目' + (i + 1));
    const ext = (e.extensions && typeof e.extensions === 'object') ? e.extensions : {};
    const posRaw = (ext.position !== undefined ? ext.position : (e.position !== undefined ? e.position : 4));
    const posNum = _posToNum(posRaw);
    const posType = (posNum === 0) ? 'before_character_definition' :
      (posNum === 1) ? 'after_character_definition' :
      (posNum === 2) ? 'before_author_note' :
      (posNum === 3) ? 'after_author_note' :
      (posNum === 5) ? 'before_example_messages' :
      (posNum === 6) ? 'after_example_messages' :
      'at_depth';
    const roleNum = (ext.role !== undefined ? ext.role : (e.role !== undefined ? e.role : 0));
    const posRole = (roleNum === 1 || roleNum === 'user') ? 'user'
      : (roleNum === 2 || roleNum === 'assistant') ? 'assistant' : 'system';
    const posDepth = (ext.depth !== undefined ? ext.depth : (e.depth !== undefined ? e.depth : 4));
    const order = (e.insertion_order !== undefined ? e.insertion_order
      : (ext.order !== undefined ? ext.order
      : (e.order !== undefined ? e.order
      : (ext.insertion_order !== undefined ? ext.insertion_order : 100))));
    const isConst = (e.constant !== undefined ? e.constant : false);
    const isSel = (e.selective !== undefined ? e.selective : true);
    const stratType = isConst ? 'constant' : 'selective';
    const keys = Array.isArray(e.keys) ? e.keys.filter(function(k) { return typeof k === 'string' && k; })
      : (Array.isArray(e.key) ? e.key.filter(function(k) { return typeof k === 'string' && k; }) : []);
    const secKeys = Array.isArray(e.secondary_keys) ? e.secondary_keys
      : (Array.isArray(e.keysecondary) ? e.keysecondary : []);
    const selLogic = (ext.selectiveLogic === 1 ? 'not_all'
      : (ext.selectiveLogic === 2 ? 'not_any'
      : (ext.selectiveLogic === 3 ? 'and_all' : 'and_any')));
    const useProb = (ext.useProbability !== undefined ? ext.useProbability
      : (ext.use_probability !== undefined ? ext.use_probability
      : (e.useProbability !== undefined ? e.useProbability : true)));
    const probability = useProb ? (ext.probability !== undefined ? ext.probability
      : (e.probability !== undefined ? e.probability : 100)) : 100;
    const preventRecursion = !!(ext.prevent_recursion !== undefined ? ext.prevent_recursion : e.preventRecursion);
    const excludeRecursion = !!(ext.exclude_recursion !== undefined ? ext.exclude_recursion : e.excludeRecursion);
    const delayUntilRecursion = (ext.delay_until_recursion !== undefined ? ext.delay_until_recursion
      : (e.delayUntilRecursion !== undefined ? e.delayUntilRecursion : 0));
    const sticky = (ext.sticky !== undefined && ext.sticky !== null) ? ext.sticky
      : ((e.sticky !== undefined && e.sticky !== null) ? e.sticky : null);
    const cooldown = (ext.cooldown !== undefined && ext.cooldown !== null) ? ext.cooldown
      : ((e.cooldown !== undefined && e.cooldown !== null) ? e.cooldown : null);
    const delay = (ext.delay !== undefined && ext.delay !== null) ? ext.delay
      : ((e.delay !== undefined && e.delay !== null) ? e.delay : null);

    // 完整保留原条目，再覆盖规范化字段
    const out = Object.assign({}, e);
    delete out._action; delete out.delete; delete out._nochange; delete out._delete;
    delete out.comment; delete out.title;
    delete out.keys; delete out.secondary_keys; delete out.key; delete out.keysecondary;
    delete out.insertion_order;

    out.name = comment;
    out.content = e.content || '';
    out.enabled = (e.enabled !== undefined ? e.enabled : true);
    out.strategy = Object.assign({}, (e.strategy && typeof e.strategy === 'object') ? e.strategy : {}, {
      type: stratType,
      keys: keys.slice(),
      keys_secondary: Object.assign({},
        (e.strategy && e.strategy.keys_secondary && typeof e.strategy.keys_secondary === 'object') ? e.strategy.keys_secondary : {},
        { logic: selLogic, keys: secKeys.slice() }),
      scan_depth: (ext.scan_depth !== undefined && ext.scan_depth !== null) ? ext.scan_depth
        : (e.scanDepth !== undefined && e.scanDepth !== null ? e.scanDepth
        : ((e.strategy && e.strategy.scan_depth !== undefined) ? e.strategy.scan_depth : 'same_as_global'))
    });
    out.position = Object.assign({},
      (e.position && typeof e.position === 'object' && !Array.isArray(e.position)) ? e.position : {},
      { type: posType, role: posRole, depth: posDepth, order: order });
    out.probability = probability;
    out.useProbability = useProb;
    out.recursion = Object.assign({}, (e.recursion && typeof e.recursion === 'object') ? e.recursion : {}, {
      prevent_incoming: preventRecursion,
      prevent_outgoing: excludeRecursion,
      delay_until: (typeof delayUntilRecursion === 'number' && isFinite(delayUntilRecursion)) ? delayUntilRecursion : null
    });
    out.effect = Object.assign({}, (e.effect && typeof e.effect === 'object') ? e.effect : {}, {
      sticky: sticky, cooldown: cooldown, delay: delay
    });

    // 补齐优先级/权重字段
    out.constant = isConst;
    out.selective = isSel;
    out.selectiveLogic = (ext.selectiveLogic !== undefined ? ext.selectiveLogic : 0);
    out.group = ext.group !== undefined ? ext.group : (e.group !== undefined ? e.group : '');
    out.groupWeight = ext.group_weight !== undefined ? ext.group_weight
      : (ext.groupWeight !== undefined ? ext.groupWeight : (e.groupWeight !== undefined ? e.groupWeight : 100));
    out.groupOverride = !!(ext.group_override !== undefined ? ext.group_override
      : (e.groupOverride !== undefined ? e.groupOverride : false));
    out.useGroupScoring = ext.use_group_scoring !== undefined ? ext.use_group_scoring
      : (e.useGroupScoring !== undefined ? e.useGroupScoring : null);
    // null = 继承全局预算（不强制/不豁免）；undefined → null；其余布尔强转（修复：原 !! 强转会丢失 null）
    const _ibV = ext.ignore_budget !== undefined ? ext.ignore_budget
      : (e.ignoreBudget !== undefined ? e.ignoreBudget : null);
    out.ignoreBudget = (_ibV === undefined || _ibV === null) ? null : !!_ibV;
    out.vectorized = !!(ext.vectorized !== undefined ? ext.vectorized
      : (e.vectorized !== undefined ? e.vectorized : false));
    out.addMemo = !!(ext.addMemo !== undefined ? ext.addMemo : (e.addMemo !== undefined ? e.addMemo : false));
    out.outletName = ext.outlet_name !== undefined ? ext.outlet_name
      : (e.outletName !== undefined ? e.outletName : '');
    out.automationId = ext.automation_id !== undefined ? ext.automation_id
      : (e.automationId !== undefined ? e.automationId : '');
    out.triggers = Array.isArray(ext.triggers) ? ext.triggers.slice()
      : (Array.isArray(e.triggers) ? e.triggers.slice() : []);
    out.characterFilter = ext.character_filter !== undefined ? ext.character_filter
      : (e.characterFilter !== undefined ? e.characterFilter : null);
    out.matchWholeWords = ext.match_whole_words !== undefined ? ext.match_whole_words
      : (e.matchWholeWords !== undefined ? e.matchWholeWords : null);
    out.caseSensitive = ext.case_sensitive !== undefined ? ext.case_sensitive
      : (e.caseSensitive !== undefined ? e.caseSensitive : null);
    out.matchPersonaDescription = !!(ext.match_persona_description !== undefined ? ext.match_persona_description
      : (e.matchPersonaDescription !== undefined ? e.matchPersonaDescription : false));
    out.matchCharacterDescription = !!(ext.match_character_description !== undefined ? ext.match_character_description
      : (e.matchCharacterDescription !== undefined ? e.matchCharacterDescription : false));
    out.matchCharacterPersonality = !!(ext.match_character_personality !== undefined ? ext.match_character_personality
      : (e.matchCharacterPersonality !== undefined ? e.matchCharacterPersonality : false));
    out.matchCharacterDepthPrompt = !!(ext.match_character_depth_prompt !== undefined ? ext.match_character_depth_prompt
      : (e.matchCharacterDepthPrompt !== undefined ? e.matchCharacterDepthPrompt : false));
    out.matchScenario = !!(ext.match_scenario !== undefined ? ext.match_scenario
      : (e.matchScenario !== undefined ? e.matchScenario : false));
    out.matchCreatorNotes = !!(ext.match_creator_notes !== undefined ? ext.match_creator_notes
      : (e.matchCreatorNotes !== undefined ? e.matchCreatorNotes : false));
    out.scanDepth = (ext.scan_depth !== undefined ? ext.scan_depth : (e.scanDepth !== undefined ? e.scanDepth : null));
    out.delayUntilRecursion = (typeof delayUntilRecursion === 'number' && isFinite(delayUntilRecursion)) ? delayUntilRecursion : 0;
    out.position_num = posNum;
    out.position_str = posType;
    out.depth = posDepth;
    out.order = order;
    out.role = (posNum === 4) ? roleNum : null;
    out.sticky = sticky; out.cooldown = cooldown; out.delay = delay;
    out.preventRecursion = preventRecursion; out.excludeRecursion = excludeRecursion;
    out.key = keys.slice(); out.keysecondary = secKeys.slice();
    if (e.extensions && typeof e.extensions === 'object') out.extensions = Object.assign({}, e.extensions);
    out.extra = Object.assign({}, (e.extra && typeof e.extra === 'object') ? e.extra : {}, { source: sourceTag });
    return out;
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
        const out = Object.assign({}, e);
        delete out._action; delete out.delete; delete out._nochange; delete out._delete;
        const pos = (e.position && typeof e.position === 'object' && !Array.isArray(e.position)) ? e.position : {};
        const strat = (e.strategy && typeof e.strategy === 'object') ? e.strategy : {};
        const ks = (strat.keys_secondary && typeof strat.keys_secondary === 'object') ? strat.keys_secondary : {};
        const rec = (e.recursion && typeof e.recursion === 'object') ? e.recursion : {};
        const eff = (e.effect && typeof e.effect === 'object') ? e.effect : {};
        // ===== 写入酒馆前对空 keys 条目最后一次兜底派生 =====
        let rawKeys = (Array.isArray(strat.keys) && strat.keys.length > 0) ? strat.keys :
          (Array.isArray(e.keys) && e.keys.length > 0 ? e.keys
          : (Array.isArray(e.key) && e.key.length > 0 ? e.key : null));
        if (!rawKeys || rawKeys.length === 0) {
          if (e.vectorized === true || (strat && strat.vectorized === true)) {
            // ★修复#10：用户主动选择向量化 → 不派生关键词（保持空 keys，走语义检索/向量化激活，避免关键词触发泛滥）
            rawKeys = [];
          } else {
            const isConst = !!(e.constant || (strat.type === 'constant'));
            const cmForDerive = String(e.comment || e.name || '').trim();
            if (!isConst && cmForDerive) {
              try {
                const derTmpl = (typeof getEntryTemplate === 'function') ? getEntryTemplate(cmForDerive) : null;
                if (!(derTmpl && derTmpl.constant)) {
                  const derived = (typeof _deriveEntryKeys === 'function') ?
                    _deriveEntryKeys(cmForDerive, derTmpl, e.content || '') : [];
                  if (derived && derived.length > 0) rawKeys = derived;
                }
              } catch (eDer) { logWarn("_sanitizeWorldbookEntriesForWrite", eDer); }
            }
          }
        }
        const rawSecondaryKeys = (Array.isArray(ks.keys) && ks.keys.length > 0) ? ks.keys :
          (Array.isArray(e.secondary_keys) && e.secondary_keys.length > 0 ? e.secondary_keys
          : (Array.isArray(e.keysecondary) && e.keysecondary.length > 0 ? e.keysecondary : []));
        const posType = typeof pos.type === 'string' ? pos.type :
          (e.position === 'before_char' || e.position === 0 || pos.type === 0 ? 'before_character_definition' :
            (e.position === 'after_char' || e.position === 1 ? 'after_character_definition' :
              (e.position === 'before_an' || e.position === 2 ? 'before_author_note' :
                (e.position === 'after_an' || e.position === 3 ? 'after_author_note' :
                  (e.position === 'before_example_messages' || e.position === 5 ? 'before_example_messages' :
                    (e.position === 'after_example_messages' || e.position === 6 ? 'after_example_messages' :
                      'at_depth'))))));
        const roleVal = (typeof pos.role === 'string') ? pos.role :
          (pos.role === 1 ? 'user' : (pos.role === 2 ? 'assistant' : 'system'));
        // ===== MVU 系统条目强制规范化 content =====
        const _sanitizeComment = String(e.comment || e.name || '');
        let _sanitizeContent = String(e.content == null ? '' : e.content);
        const _sanitizeCore = _entryCommentCore(_sanitizeComment);
        if (_isInitVarComment(_sanitizeComment, _sanitizeContent)) {
          _sanitizeContent = normalizeInitVarContent(_sanitizeContent);
        }
        if (_sanitizeCore === '变量当前状态') {
          _sanitizeContent = normalizeVarListContent(_sanitizeContent);
        }
        if (_sanitizeCore === '变量输出格式' || _sanitizeCore === '变量输出格式强调') {
          _sanitizeContent = normalizeVarOutputFormatContent(_sanitizeComment, _sanitizeContent);
        }
        if (_sanitizeCore === '变量更新规则') {
          _sanitizeContent = normalizeVarUpdateRuleContent(_sanitizeContent);
        }

        out.name = String(e.name || e.comment || ('条目' + (i + 1)));
        out.content = _sanitizeContent;
        out.enabled = e.enabled !== false;
        out.uid = (typeof e.uid === 'number' && isFinite(e.uid)) ? e.uid :
          (typeof e.uid === 'string' && /^\d+$/.test(e.uid) ? Number(e.uid) :
          (typeof e.uid === 'string' ? e.uid : undefined));
        out.strategy = Object.assign({}, strat, {
          type: (typeof strat.type === 'string' && strat.type) ? strat.type : (e.constant ? 'constant' : 'selective'),
          keys: safeKeys(rawKeys),
          keys_secondary: Object.assign({}, ks, {
            logic: (typeof ks.logic === 'string' && ks.logic) ? ks.logic : 'and_any',
            keys: safeKeys(rawSecondaryKeys)
          }),
          scan_depth: (strat.scan_depth === undefined || strat.scan_depth === null) ?
            (e.scan_depth != null ? e.scan_depth : (e.scanDepth != null ? e.scanDepth : 'same_as_global')) :
            strat.scan_depth
        });
        out.position = Object.assign({}, pos, {
          type: posType,
          role: roleVal,
          depth: safeNumber(typeof pos.depth === 'number' ? pos.depth : (e.depth !== undefined ? e.depth : undefined), 4),
          order: safeNumber(
            (e.insertion_order !== undefined ? e.insertion_order
            : (e.order !== undefined ? e.order
            : (typeof pos.order === 'number' ? pos.order : undefined))), 100)
        });
        out.probability = safeNumber(e.probability, 100);
        if (out.useProbability === undefined) {
          out.useProbability = (e.useProbability !== undefined ? e.useProbability
            : (e.use_probability !== undefined ? e.use_probability : true));
        }
        out.recursion = Object.assign({}, rec, {
          prevent_incoming: (rec.prevent_incoming !== undefined ? !!rec.prevent_incoming : (!!e.prevent_recursion || !!e.preventRecursion)),
          prevent_outgoing: (rec.prevent_outgoing !== undefined ? !!rec.prevent_outgoing : (!!e.exclude_recursion || !!e.excludeRecursion)),
          delay_until: (typeof rec.delay_until === 'number' && isFinite(rec.delay_until)) ? rec.delay_until
            : (typeof e.delay_until_recursion === 'number' && isFinite(e.delay_until_recursion) ? e.delay_until_recursion
            : (typeof e.delayUntilRecursion === 'number' && isFinite(e.delayUntilRecursion) ? e.delayUntilRecursion : null))
        });
        out.effect = Object.assign({}, eff, {
          sticky: (typeof eff.sticky === 'number' && isFinite(eff.sticky)) ? eff.sticky
            : ((typeof e.sticky === 'number' && isFinite(e.sticky)) ? e.sticky : null),
          cooldown: (typeof eff.cooldown === 'number' && isFinite(eff.cooldown)) ? eff.cooldown
            : ((typeof e.cooldown === 'number' && isFinite(e.cooldown)) ? e.cooldown : null),
          delay: (typeof eff.delay === 'number' && isFinite(eff.delay)) ? eff.delay
            : ((typeof e.delay === 'number' && isFinite(e.delay)) ? e.delay : null)
        });

        // 补齐优先级/权重字段（缺失才填默认值，避免 undefined 被下游丢弃）
        if (out.constant === undefined) out.constant = !!(strat.type === 'constant');
        if (out.selective === undefined) out.selective = !out.constant;
        if (out.selectiveLogic === undefined) {
          const _logicMap = { 'and_any': 0, 'not_all': 1, 'not_any': 2, 'and_all': 3 };
          out.selectiveLogic = (typeof ks.logic === 'string' && _logicMap[ks.logic] !== undefined) ? _logicMap[ks.logic] : 0;
        }
        if (out.group === undefined) out.group = '';
        if (out.groupWeight === undefined) out.groupWeight = 100;
        if (out.groupOverride === undefined) out.groupOverride = false;
        if (out.useGroupScoring === undefined) out.useGroupScoring = null;
        if (out.ignoreBudget === undefined) out.ignoreBudget = false;
        if (out.vectorized === undefined) out.vectorized = false;
        if (out.addMemo === undefined) out.addMemo = false;
        if (out.outletName === undefined) out.outletName = '';
        if (out.automationId === undefined) out.automationId = '';
        if (!Array.isArray(out.triggers)) out.triggers = [];
        if (out.characterFilter === undefined) out.characterFilter = null;
        if (out.matchWholeWords === undefined) out.matchWholeWords = null;
        if (out.caseSensitive === undefined) out.caseSensitive = null;
        if (out.matchPersonaDescription === undefined) out.matchPersonaDescription = false;
        if (out.matchCharacterDescription === undefined) out.matchCharacterDescription = false;
        if (out.matchCharacterPersonality === undefined) out.matchCharacterPersonality = false;
        if (out.matchCharacterDepthPrompt === undefined) out.matchCharacterDepthPrompt = false;
        if (out.matchScenario === undefined) out.matchScenario = false;
        if (out.matchCreatorNotes === undefined) out.matchCreatorNotes = false;
        if (out.scanDepth === undefined) out.scanDepth = null;
        if (out.delayUntilRecursion === undefined) out.delayUntilRecursion = 0;
        if (!Array.isArray(out.key) || out.key.length === 0) out.key = safeKeys(rawKeys);
        if (!Array.isArray(out.keysecondary)) out.keysecondary = safeKeys(rawSecondaryKeys);
        if (out.depth === undefined) out.depth = out.position.depth;
        if (out.order === undefined) out.order = out.position.order;
        if (out.role === undefined) out.role = (out.position.type === 'at_depth') ? out.position.role : null;
        if (out.preventRecursion === undefined) out.preventRecursion = !!out.recursion.prevent_incoming;
        if (out.excludeRecursion === undefined) out.excludeRecursion = !!out.recursion.prevent_outgoing;
        if (out.sticky === undefined) out.sticky = out.effect.sticky;
        if (out.cooldown === undefined) out.cooldown = out.effect.cooldown;
        if (out.delay === undefined) out.delay = out.effect.delay;
        if (out.position_num === undefined) {
          const _posMap = {
            'before_character_definition': 0, 'after_character_definition': 1,
            'before_author_note': 2, 'after_author_note': 3, 'at_depth': 4,
            'before_example_messages': 5, 'after_example_messages': 6, 'outlet': 7
          };
          out.position_num = (_posMap[posType] !== undefined) ? _posMap[posType] : 4;
        }
        if (out.position_str === undefined) out.position_str = posType;
        out.extra = (e.extra && typeof e.extra === 'object') ? e.extra : {};
        return out;
      });
  }

  // ===== 【写卡预设】自动给世界书条目分配并包裹 <名称_idN> 标签（对齐 template_tag_spec）=====
  // 分配规则：角色速览固定 <角色速览_id0> → 世界观条目 id1+ → 角色条目按顺序id → NPC继续递增
  // 同一角色的所有条目（基础信息/三面性/二次解释/衣柜/NSFW）共用同一个 <角色名_idN>
  // 注意：MVU条目（[InitVar]/[mvu_update]/变量当前状态/状态栏占位符）不包裹标签
  function assignAndWrapTagIds(entries) {
    if (!entries || !entries.length) return entries;
    // 第一步：收集顶层角色名（从comment中提取，非主角/世界/系统）
    let worldviewIdx = 0; // 世界观计数器，第一个世界观 = id1
    const charNameToId = {}; // 角色名 → 分配的id数字
    let nextCharId = 0; // 占位，稍后被 maxWorldId+1 覆盖
    // 预扫描：优先从comment提取所有候选：角色速览/世界观前缀/角色名/NPC名
    // 窄口径：仅 9.1.6 工作流核心条目参与 tag-id 的 mvu 分桶。
    // 故意不复用顶层宽口径 isMVUEntry（后者还含阶段判定/派生字段/控制器等附加条目，
    // 那些在 id 分配时应走普通世界观/NPC 分桶，过宽会把普通条目误分到 mvu 桶）。
    const MVU_WORKFLOW_PREFIX_RE = /(\[InitVar\]|\[mvu_update\]|变量当前状态|变量输出格式|变量输出格式强调|<状态栏>|占位符提醒|状态栏占位符)/i;
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
      // 2. 世界观组：先剥掉 <...>/[...] 外层前缀再判断（修复 '<世界观>地理志' 被误判为角色名"世界观"）
      const _coreC = _entryCommentCore(c);
      if (/^(世界观|世界元数据|状态栏)/.test(_coreC) ||
        _coreC.indexOf('世界观') === 0 || c.indexOf('世界元数据') >= 0) {
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
    if (WRITER_DEBUG) console.log('[写卡诊断] 世界书转换后条目：', converted.map(function(e) {
      const _isConst = !!(e.strategy && e.strategy.type === 'constant');
      return (e.name || '?') + '(content:' + (e.content || '').length + '字,enabled:' + e.enabled + ',constant:' + _isConst + ')';
    }));

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
        // ⚠️部分 ST 版本对不存在的世界书 resolve 出 {}（不抛错），需用返回内容判空，
        // 否则会误判已存在、跳过 createWorldbook，随后 updateWorldbookWith 失败。
        const _wb = await getWorldbook(worldbookName);
        exists = !!( _wb && (Array.isArray(_wb) ? _wb.length > 0 : Object.keys(_wb).length > 0));
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
    // ⚠️六大标准模板对齐：InitVar/变量当前状态/更新规则/输出格式/格式强调；变量分段(EJS)已按规范移除
    let filledEntries = rawEntries.map(function(e, i) {
      const comment = e.comment || ('条目' + (i + 1));
      const commentLower = comment.toLowerCase();
      const isInitVar = commentLower.indexOf('[initvar]') >= 0;
      const isVarList = _entryCommentCore(comment) === '变量当前状态';
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
      // 变量当前状态（固定模板：{{format_message_variable::stat_data}} 宏注入）—— ⚠️depth=1 order=69000 对齐 ENTRY_TEMPLATES/速查表（insertion_order=200 为旧字段兜底）
      if (!mvuEntryExists(function(e) {
          return (e.comment || '').indexOf('变量当前状态') >= 0;
        })) {
        _toAppend.push({
          id: _idx + 1,
          keys: [],
          secondary_keys: [],
          comment: '变量当前状态',
          content: generateVarListContent(),
          constant: true,
          selective: false,
          insertion_order: 69000,
          enabled: true,
          position: 4,
          depth: 1,
          order: 69000,
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
        insertion_order: e.insertion_order || e.order || order,
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
    // 检测是否包含MVU核心条目：宽泛匹配——只要存在任意 MVU 核心条目（含 [initvar] 或其他MVU特征，即使缺 [InitVar]）也视为 MVU 卡
    // 🐛修复：简化冗余判定（原先 hasInitVar 精确判定 + hasAnyMVU 宽泛判定再合并，等价于直接宽泛判定）
    const hasMVUEntries = filledEntries.some(function(e) {
      return isMVUEntry(e.comment || '');
    });
    let rawFirstMes = cd.first_mes || '';
    // MVU 卡的开场白必须含 <StatusPlaceHolderImpl/>（即使 first_mes 为空也追加，保证状态栏正常显示）
    if (hasMVUEntries && rawFirstMes.indexOf('<StatusPlaceHolderImpl') < 0) {
      rawFirstMes = rawFirstMes.replace(/<StatusPlaceHolderImpl\s*\/>/gi, '').trim() + '\n\n<StatusPlaceHolderImpl/>';
    }
    const cardFirstMes = toCRLF(rawFirstMes);
    // ⚠️修复：cd.alternate_greetings 可能是字符串（旧卡/手改JSON），.map 会直接 TypeError，先做数组保护
    const cardAltGreetings = (Array.isArray(cd.alternate_greetings) ? cd.alternate_greetings : []).map(function(g) {
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
            variables: (rawExtensions.tavern_helper && rawExtensions.tavern_helper.variables) || {}
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
    // ★ 修复 Bug1：编辑器重入锁——防止用户连点图标时并发打开/误触发上次会话
    if (typeof window !== 'undefined' && window.__cwEditorOpening) {
      try { console.log('[写卡器] 编辑器正在打开，忽略重复调用'); } catch (_) {}
      return;
    }
    if (typeof window !== 'undefined') window.__cwEditorOpening = true;
    try {
      const doc = await createModalIframe();
      // ★★★ 加固 Bug1：打开即锁欢迎页状态 ★★★
      try {
        if (doc && doc.body) doc.body.innerHTML = '';
        if (typeof renderWelcome === 'function') renderWelcome();
        if (typeof window !== 'undefined') {
          window.__cwAbortRequested = false;
          window.__cwCurrentGenId = null;
          window.__tab_activeTab = 'card';
        }
      } catch (_openForce) {}

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

      // ========== Agent 模式会话系统：单一界面/单一会话 ==========
      // 旧版三 Tab（角色卡/MVU/前端）已合并：activeTab 恒为 'card'，
      // chatSessions.mvu / chatSessions.frontend 仅作旧存档迁移兼容保留（loadFromStorage 会把历史消息合并进 card）
      let activeTab = 'card'; // Agent模式：恒为 'card'（顶层函数 calcProgress/getModuleProgress 等按此过滤MVU条目统计，行为正确）
      // ===== Agent 模式开关（true=Agent模式：先理解+选项+确认；false=正常模式：直接生成）=====
      let agentAutoMode = true;
      // 待用户选择的选项列表（AI 输出 <agent_options> 后填充，用户选择/取消后清空）
      let _pendingAgentOptions = null;
      if (typeof window !== 'undefined') {
        window.__agentAutoMode = agentAutoMode;
        window.__getAgentAutoMode = function() { return agentAutoMode; };
      }
      // 暴露到 window：让 mergePartial / checkMvu8Entries 等顶层作用域函数也能正确取到当前Tab和cardData
      if (typeof window !== 'undefined') {
        window.__cardData = cardData;
        window.__tab_activeTab = activeTab;
        window.__getActiveTab = function() {
          return activeTab;
        };
        window.__agentMode = true; // Agent模式标记：顶层逻辑据此跳过旧Tab隔离（防御性，实际隔离代码已按 AGENT_MODE 常量停用）
        /* 灰色模式开关（旧版遗留兼容）：Agent版无隔离，此开关不再有实际作用 */
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
          messages: [], // Agent版唯一会话（chatSessions 命名保留以兼容旧存档结构）
          mode: 'normal'
        },
        mvu: {
          messages: [] // 仅作旧存档迁移兼容（loadFromStorage 合并后恒为空数组）
        },
        frontend: {
          messages: [] // 仅作旧存档迁移兼容（loadFromStorage 合并后恒为空数组）
        }
      };
      // 会话数组别名：实际以 chatSessions.card.messages 为准
      let cardMessages = chatSessions.card.messages;
      let mvuMessages = chatSessions.mvu.messages;
      let frontendMessages = chatSessions.frontend.messages;
      // ★ 向后兼容别名：旧代码各处仍直接引用 messages 变量（importCardData/loadFromStorage等）
      // let 与原 var 同作用域语义一致（仅无前向提升，本函数声明前无 messages 引用，已核查）
      let messages = chatSessions.card.messages;

      // 当前会话的messages访问器（Agent模式：恒返回唯一会话数组）
      function getCurrentMessages() {
        return chatSessions.card.messages;
      }

      function setCurrentMessages(arr) {
        chatSessions.card.messages = arr;
        cardMessages = arr;
        messages = arr;
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
        window.__setChatSessionsFrontendMessages = function(arr) {
          chatSessions.frontend.messages = arr;
          frontendMessages = arr;
        };
        /* ===== Agent Loop 调试/自动化接口（控制台可操作，不影响正常使用）===== */
        window.__agentLoopApi = {
          startCheckFlow: startCheckFlow,
          startAgentFlow: startCheckFlow, // 旧别名兼容（原「自动创作」入口现为「检查」）
          agentLoop: agentLoop,
          stopAgentLoop: stopAgentLoop,
          handleSend: handleSend,
          getPlan: function() { return agentPlan; },
          setPlan: function(p) { agentPlan = p; },
          isLoopActive: function() { return agentLoopActive; }
        };
      }

      let isGenerating = false;

      // ==========================================================================
      // 双层调度器（迭代1 · P0-1）
      //   · markDirty(flags...) → rAF + setTimeout 竞速 → _flush() 一次消费
      //   · preview 单独走 debounce（保批量合并只重建 1 次预览）
      //   · 全部状态收敛在 openEditor 作用域内，随会话销毁（D2）
      //   · 100ms setTimeout 竞速：解决后台标签页 rAF 被节流（D3）
      // ==========================================================================
      const _dirty = { storage:false, progress:false, ctx:false, actions:false, preview:false };
      let _rafId = 0, _schedTimer = 0, _previewTimer = 0;
      let _lastCtxHtml = null, _lastActionsHtml = null;   // H3：初始 null，避免"空串"被误判为"未计算"
      let _sessionAlive = true;

      function markDirty() {
        for (let _di = 0; _di < arguments.length; _di++) _dirty[arguments[_di]] = true;
        _schedule();
      }
      function _schedule() {
        if (_rafId || _schedTimer) return;
        // rAF 与 setTimeout 竞速：先到先跑，另一条立即清掉（后台标签页 rAF 会被节流）
        _rafId = requestAnimationFrame(function() { _rafId = 0; _flush(); });
        _schedTimer = setTimeout(function() { _schedTimer = 0; _flush(); }, 100);
      }
      function _flush() {
        if (_rafId) { try { cancelAnimationFrame(_rafId); } catch (_) {} _rafId = 0; }
        if (_schedTimer) { clearTimeout(_schedTimer); _schedTimer = 0; }
        if (!_sessionAlive) return;
        if (_dirty.storage)  { _dirty.storage  = false; saveToStorage(); }
        if (_dirty.progress) { _dirty.progress = false; updateProgress(); }
        if (_dirty.ctx)      { _dirty.ctx      = false; updateCtxBar(); }
        if (_dirty.actions)  { _dirty.actions  = false; updateQuickActions(); }
        if (_dirty.preview)  {
          _dirty.preview = false;
          if (_previewTimer) clearTimeout(_previewTimer);
          _previewTimer = setTimeout(function() {
            _previewTimer = 0;
            if (_sessionAlive) _renderPreviewImpl();
          }, CONFIG.PREVIEW_DEBOUNCE_MS);
        }
      }
      function clearSessionTimers() {
        if (_rafId) { try { cancelAnimationFrame(_rafId); } catch (_) {} _rafId = 0; }
        if (_schedTimer)  { clearTimeout(_schedTimer);  _schedTimer  = 0; }
        if (_previewTimer){ clearTimeout(_previewTimer); _previewTimer = 0; }
      }
      // 统一数据写入口：默认全脏（性能优化交给哨兵，避免"漏标记"新 bug 类）
      function commitCard(mutator) {
        try { mutator(cardData); } catch (e) { logError('commitCard', e); return; }
        markDirty('storage', 'progress', 'ctx', 'actions', 'preview');
      }

      // ===== 生成中止（软停止）=====
      // 酒馆的 generate()/generateQuietPrompt() 无 AbortController 支持，无法真正中断；
      // 本标志语义：AI 响应返回后丢弃本次结果，不写入 cardData、不追加聊天记录。
      let _abortRequested = false;

      function requestAbort() {
        if (!isGenerating) return;
        _abortRequested = true;
        try { window.__cwAbortRequested = true; } catch (_wa) {}

        // ===== 真中断：调用酒馆助手(JS-Slash-Runner) stopGenerationById 精准停止本次生成 =====
        const _genId = window.__cwCurrentGenId;
        if (_genId) {
          let _stopped = false;
          try {
            const _stopById = _tavernFn('stopGenerationById');
            if (_stopById) {
              _stopById(_genId);
              _stopped = true;
            }
          } catch (e) {
            console.warn('[写卡器] stopGenerationById 调用失败，尝试 stopAllGeneration', e);
          }
          // 不可用/调用失败 → 兜底全局停止（写卡器同一时间只有一个请求，误伤概率低）
          if (!_stopped) {
            try {
              const _stopAll = _tavernFn('stopAllGeneration');
              if (_stopAll) _stopAll();
            } catch (e2) { logWarn('stopAllGeneration', e2); }
          }
        }

        // 若 Agent 循环正在跑，一并停掉循环（当前步仍会等 AI 返回后被丢弃）
        try { if (agentLoopActive) stopAgentLoop(); } catch (_e) {}
        const _sb = doc.getElementById('sendBtn');
        if (_sb) {
          _sb.classList.add('is-aborting');
          _sb.title = '已请求停止，等待当前 AI 响应结束…';
        }
        showToast('⏹ 已请求停止——AI 响应返回后本次结果将被丢弃', 'info', 5000);
      }
      let cardGenerated = false;
      let progress = 0;

      // ========== Agent自主执行循环（Agent Loop · ReAct模式）状态 ==========
      // agentPlan：AI输出的创作计划 { goal, steps:[{desc,done}], createdAt, stepRuns }
      // agentLoopActive：循环运行中（每步=一次完整AI调用+应用+提取）
      // agentLastObservation：上一步的执行结果观察（ReAct核心：行动→观察→决策，供下一步任务指令注入）
      let agentPlan = null;
      let agentLoopActive = false;
      let agentConsecutiveFailures = 0;
      let agentLastObservation = '';
      let moduleProgress = {
        total: 0,
        constant: 0,
        triggered: 0,
        grouped: 0,
        has_key: 0,
        has_content: 0
      };

      // ===== switchTab（旧版三Tab遗留，Agent版已无Tab概念）=====
      // Agent版单一界面：此函数仅作旧调用点的安全兜底，不再执行任何切换逻辑
      function switchTab(targetTab) {
        // no-op：Agent模式下没有Tab可切换（activeTab 恒为 'card'）
        if (targetTab !== activeTab) {
          showToast('Agent模式下已无需切换——角色卡/MVU/前端在同一个对话里都能做', 'info');
        }
      }

      // ★ 修复 Bug2：iframe 内 window.confirm 常被浏览器/酒馆拦截 → 用 doc 内自定义 modal
      function showWelcomeConfirmModal(msg, onConfirm) {
        // ✅ 修复：DOM 弹窗创建失败时降级到原生 confirm，保证用户一定看到提示
        let mask = null;
        try {
          const existing = doc.getElementById('welcomeConfirmModal');
          if (existing) existing.remove();
          mask = doc.createElement('div');
          mask.id = 'welcomeConfirmModal';
          mask.className = 'modal';
          // ★ 修复 Bug2：给遮罩与内容加**内联关键样式**，不依赖 IFRAME_CSS 即可正常显示。
          //   只要 CSS 变量可用就用变量值，不可用则回退到显式色值，保证任何环境都能看到弹窗。
          mask.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;' +
            'background:rgba(15,23,42,.42);' +
            'display:flex;align-items:center;justify-content:center;' +
            'z-index:100002;pointer-events:auto;';
          mask.innerHTML =
            '<div class="modal-content" style="' +
              'max-width:540px;width:90%;' +
              'background:var(--surface,#ffffff);color:var(--ink,#111827);' +
              'border:1px solid var(--line,#e5e7eb);border-radius:12px;padding:16px;' +
              'box-shadow:0 20px 60px rgba(15,23,42,.3);' +
              'display:flex;flex-direction:column;max-height:85vh;' +
            '">' +
            '<h3 style="color:var(--accent-deep,#4338ca);margin:0 0 10px;font-size:1em;' +
              'display:inline-flex;align-items:center;gap:7px">' +
              svgIcon('alert', 17) + ' 请确认</h3>' +
            '<div style="white-space:pre-wrap;font-size:.86em;line-height:1.7;' +
              'color:var(--ink-soft,#475467);max-height:340px;overflow:auto;margin-bottom:12px">' +
              escHtml(msg) + '</div>' +
            '<div class="modal-actions" style="display:flex;justify-content:flex-end;gap:8px;' +
              'padding-top:11px;border-top:1px solid var(--line-soft,#e5e7eb)">' +
              '<button class="btn btn-ghost" id="wcmCancelBtn">取消</button>' +
              '<button class="btn btn-primary" id="wcmOkBtn">' + svgIcon('check', 15) + ' 确认</button>' +
            '</div></div>';
          doc.body.appendChild(mask);
          // ★ 修复 Bug2：显式校验弹框已挂载到 DOM，否则抛出让 catch 走兜底
          const _verify = doc.getElementById('welcomeConfirmModal');
          if (!_verify || !_verify.parentNode) {
            throw new Error('弹框挂载失败（DOM 未包含 #welcomeConfirmModal）');
          }
          // ★ 修复 Bug2：强制同步一次布局 + 尺寸/可见性双重校验
          void _verify.offsetWidth;
          const _rect = _verify.getBoundingClientRect();
          const _cstyle = (doc.defaultView || window).getComputedStyle(_verify);
          if (_rect.width === 0 || _rect.height === 0 ||
              _cstyle.display === 'none' ||
              _cstyle.visibility === 'hidden' ||
              parseFloat(_cstyle.opacity || '1') === 0) {
            throw new Error('弹框尺寸为0或不可见');
          }
          const close = function() { if (mask && mask.parentNode) mask.parentNode.removeChild(mask); };
          // 只允许通过明确按钮关闭，遮罩点击不关闭（避免误关后用户以为"没提示"）
          const _cancelBtn = doc.getElementById('wcmCancelBtn');
          const _okBtn = doc.getElementById('wcmOkBtn');
          if (_cancelBtn) _cancelBtn.addEventListener('click', close);
          if (_okBtn) _okBtn.addEventListener('click', function() {
            close();
            try { onConfirm && onConfirm(); } catch (err) { logError('welcomeConfirm', err); }
          });
          try { if (_okBtn) _okBtn.focus(); } catch (_) {}
          return;
        } catch (e) {
          logWarn('showWelcomeConfirmModal.dom', e);
          if (mask && mask.parentNode) { try { mask.parentNode.removeChild(mask); } catch (_) {} }
        }
        // ⚠️修复 Bug1/Bug2（v2）：DOM 弹窗失败时**彻底禁用 iframe 内 confirm 兜底**。
        // 根因：iframe 内 window.confirm 在沙箱 / 严格模式 / 自动化环境下会被静默处理：
        //   ① 返回 false → 无可见弹窗，用户以为"点了没反应"（Bug ② 点击开始创作没有提示）
        //   ② 返回 true  → 无可见弹窗，直接执行 onConfirm 进入聊天页，用户以为"自动进入继续上次"（Bug ①）
        // 修复：DOM 弹窗失败 → 只显示明确的错误提示，让用户重试，绝不静默执行回调。
        try { showToast('⚠️ 确认对话框无法弹出，请关闭后重新打开写卡器再试', 'error', 8000); } catch (_) {}
      }

      function renderWelcome() {
        // ★ 明确渲染欢迎页（防止任何异常路径下渲染了聊天界面/残留DOM干扰）
        try { clearAgentOptionsBar(); } catch (_) {}
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
          '<h2>' + svgIcon('sparkle', 22, 'welcome-ic') + ' 时之写卡器 · Agent</h2>' +
          '<p>全能角色卡创作Agent：在一个对话里智能生成完整角色卡——世界书条目、MVU变量系统、前端界面。<br>说出你的想法，剩下的交给我，直接写入酒馆！</p>' +
          // ★ 新增：检测到存档时给出明确提示，避免用户误以为"点击图标 = 自动继续上次"
          (hasSavedData() ?
            '<div style="margin:8px auto 4px;padding:10px 14px;max-width:480px;background:var(--accent-soft);border:1px solid var(--accent-border);border-radius:var(--radius-sm);font-size:.82em;color:var(--accent-text);text-align:left">' +
            '💾 <b>检测到上次保存的创作进度</b>——请明确选择下方按钮：<br>' +
            '&nbsp;&nbsp;· 点「<b>开始创作</b>」= 清空旧存档，全新开始<br>' +
            '&nbsp;&nbsp;· 点「<b>继续上次</b>」= 恢复上次的所有内容<br>' +
            '&nbsp;&nbsp;· 点「<b>导入现有卡</b>」= 从 JSON 导入角色卡' +
            '</div>' : '') +
          '<div class="welcome-features">' +
          '<div class="wf-item"><div class="wf-icon">' + svgIcon('chat', 18) + '</div><div class="wf-copy"><div class="wf-title">Agent式对话创作</div><div class="wf-desc">一个界面搞定一切：AI自动理解需求，按意图生成角色卡/MVU/前端</div></div></div>' +
          '<div class="wf-item"><div class="wf-icon">' + svgIcon('sliders', 18) + '</div><div class="wf-copy"><div class="wf-title">MVU变量系统</div><div class="wf-desc">zod变量结构、初始变量、更新规则等8条工作流资产 + HTML状态栏</div></div></div>' +
          '<div class="wf-item"><div class="wf-icon">' + svgIcon('layers', 18) + '</div><div class="wf-copy"><div class="wf-title">前端界面</div><div class="wf-desc">正文美化正则、结构化数据面板（论坛/任务面板等），自动提取保存</div></div></div>' +
          '<div class="wf-item"><div class="wf-icon">' + svgIcon('save', 18) + '</div><div class="wf-copy"><div class="wf-title">一键写入酒馆</div><div class="wf-desc">世界书条目+变量系统+界面正则全部装配进角色卡，写入酒馆当前角色</div></div></div>' +
          '</div>' +
          '<button class="start-btn" id="startBtn" title="开始新卡（若有正在进行的内容会先二次确认）">' + svgIcon('play', 18) + ' 开始创作</button>' +
          '<div class="welcome-actions">' +
          '<button class="btn btn-ghost" id="importBtn">' + svgIcon('download', 15) + ' 导入现有卡</button>' +
          '<button class="btn btn-ghost" id="continueBtn" style="display:none">' + svgIcon('folderOpen', 15) + ' 恢复上次进度</button>' +
          '</div>' +
          '<p style="font-size:.7em;color:var(--muted);margin-top:18px">世界书条目字段对齐ST官方源码（world-info.js）：key/comment/content/constant/selective/position/selectiveLogic/order/depth 等40个字段，不臆造字段名</p>' +
          '<p style="font-size:.65em;color:var(--muted);margin-top:6px">Agent模式：角色卡 / MVU变量 / 前端界面 无需切换，按内容特征自动提取保存</p>' +
          '</div>' +
          '</div>';
        doc.getElementById('closeBtn').addEventListener('click', closeModal);
        doc.getElementById('startBtn').addEventListener('click', function() {
          try {
            const _entryCount = (cardData.character_book && cardData.character_book.entries || []).length;
            const _hasWorkInMemory = !!(cardData.name || cardData.description || cardData.first_mes || _entryCount > 0);
            const _hasSavedWork = hasSavedData();

            let _confirmMsg = '';
            if (_hasWorkInMemory || _hasSavedWork) {
              // ===== 有内容/存档：详细确认（包含条目数、字数、对话条数）=====
              let _cardName = cardData.name || '';
              let _showEntryCount = _entryCount;
              let _showDescLen = (cardData.description || '').length;
              let _showFirstMesLen = (cardData.first_mes || '').length;
              let _showMsgCount = 0;
              try { _showMsgCount = getCurrentMessages().length; } catch (_) {}
              if (!_hasWorkInMemory && _hasSavedWork) {
                try {
                  const _raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('modelo_char_generator_state');
                  if (_raw) {
                    const _state = JSON.parse(_raw);
                    const _cd = _state && _state.cardData;
                    if (_cd) {
                      _cardName = _cd.name || '';
                      _showEntryCount = (_cd.character_book && _cd.character_book.entries || []).length;
                      _showDescLen = (_cd.description || '').length;
                      _showFirstMesLen = (_cd.first_mes || '').length;
                    }
                    if (_state && _state.chatSessions && _state.chatSessions.card &&
                        Array.isArray(_state.chatSessions.card.messages)) {
                      _showMsgCount = _state.chatSessions.card.messages.length;
                    } else if (_state && Array.isArray(_state.cardMessages)) {
                      _showMsgCount = _state.cardMessages.length;
                    }
                  }
                } catch (_eSaved) { logWarn('startBtn.savedSummary', _eSaved); }
              }
              _confirmMsg =
                '⚠️ 开始新卡会清空当前所有记录，且无法恢复。\n\n' +
                '当前卡：「' + (_cardName || '(未命名)') + '」\n' +
                '· 条目 ' + _showEntryCount + ' 条\n' +
                '· 描述 ' + _showDescLen + ' 字 / 开场白 ' + _showFirstMesLen + ' 字\n' +
                '· 对话 ' + _showMsgCount + ' 条\n\n' +
                '确定要清空并开始新卡吗？\n' +
                '（如需保留，请先点「取消」，用右上「工作区 → 导出角色卡JSON」备份）';
            } else {
              _confirmMsg =
                '🆕 开始创作新的角色卡？\n\n' +
                '将进入全新的创作会话，所有内容从零开始。\n' +
                '之后你随时可以让 Agent 生成世界观、角色、MVU变量系统、前端界面等内容。\n\n' +
                '确定继续？';
            }
            // ★ 修复 Bug2：删除"120ms 降级到 window.parent.confirm"逻辑。
            //   根因：iframe 内 window.parent.confirm 跨域调用会抛异常，catch 分支误把 ok 设为 true
            //   直接跳过确认进入聊天页（用户看到的"没提示"）。修复后只走 DOM modal。
            showWelcomeConfirmModal(_confirmMsg, function() {
              try {
                resetAllWorkForNewCard();
                renderChatUI();
                addAssistantMsg('你好！我是你的全能写卡Agent 🤖\n\n' +
                  '在一个对话里，我可以帮你完成角色卡创作的一切：\n' +
                  '   • **角色卡主体**：世界观、角色设定、世界书条目、开场白\n' +
                  '   • **MVU变量系统**：变量结构、初始变量、更新规则等8条工作流资产 + HTML状态栏\n' +
                  '   • **前端界面**：正文美化、结构化数据面板\n' +
                  '   • **全自动托管**：直接说你的需求即可\n\n' +
                  '请先告诉我尺度和方向，我们就可以开始创作了！');
              } catch (err) {
                logError('startBtn.onConfirm', err, '进入创作界面失败：' + (err && err.message ? err.message : '未知错误'));
              }
            });

            // 兜底：150ms 后检查 modal 是否渲染成功，若失败则主动走 iframe 内 confirm 兜底（不再静默）
            setTimeout(function() {
              let _visible = false;
              try {
                const m = doc.getElementById('welcomeConfirmModal');
                if (m && m.parentNode) {
                  const r = m.getBoundingClientRect();
                  const cs = (doc.defaultView || window).getComputedStyle(m);
                  _visible = r.width > 0 && r.height > 0 && cs.display !== 'none' &&
                             cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0;
                }
              } catch (_vc) { _visible = false; }
              if (!_visible) {
                logWarn('startBtn', '自定义确认框不可见，走兜底路径');
                // ★ 修复 Bug2：DOM 弹框未渲染 → 主动走 iframe 内 confirm 兜底（不再静默）
                try {
                  const _localWin = (doc && doc.defaultView) ? doc.defaultView : null;
                  const _localConfirm = (_localWin && typeof _localWin.confirm === 'function')
                    ? _localWin.confirm.bind(_localWin) : null;
                  if (_localConfirm) {
                    // 无内容/存档 → 直接进入新卡；有内容 → 走详细确认
                    const _entryCount2 = (cardData.character_book && cardData.character_book.entries || []).length;
                    const _hasWork2 = !!(cardData.name || cardData.description || cardData.first_mes || _entryCount2 > 0);
                    const _msg2 = _hasWork2
                      ? '⚠️ 开始新卡会清空当前所有记录。\n\n确定要继续吗？'
                      : '🆕 开始创作新的角色卡？\n\n将进入全新的创作会话。\n\n确定继续？';
                    if (_localConfirm(_msg2)) {
                      try {
                        resetAllWorkForNewCard();
                        renderChatUI();
                        addAssistantMsg('你好！我是你的全能写卡Agent 🤖\n\n请先告诉我尺度和方向，我们就可以开始创作了！');
                      } catch (_e) {
                        logError('startBtn.fallbackConfirm', _e);
                      }
                    }
                  } else {
                    showToast('⚠️ 确认对话框未能弹出，请刷新酒馆页面后重试', 'error', 8000);
                  }
                } catch (_eCf) {
                  showToast('⚠️ 确认对话框未能弹出，请刷新酒馆页面后重试', 'error', 8000);
                }
              }
            }, 150);
          } catch (err) {
            // ✅ 修复：捕获回调内任何异常，并给出可见提示（不再静默失败）
            logError('startBtn', err);
            try { showToast('开始创作失败：' + (err && err.message ? err.message : '未知错误'), 'error', 6000); } catch (_) {}
          }
        });
        doc.getElementById('importBtn').addEventListener('click', showImportModal);
        const contBtn = doc.getElementById('continueBtn');
        // ★ 修复 Bug1：每次渲染欢迎页先强制隐藏，由 hasSavedData 决定是否显示
        if (contBtn) contBtn.style.display = 'none';
        if (contBtn && hasSavedData()) {
          contBtn.style.display = 'inline-block';
          // ★ 修复 Bug1：防重入——1秒内只允许触发一次，避免连点图标时二次触发
          let _contBtnClicked = false;
          contBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (_contBtnClicked) return;
            _contBtnClicked = true;
            setTimeout(function() { _contBtnClicked = false; }, 1000);
            showWelcomeConfirmModal(
              '📂 恢复上次的创作进度？\n\n' +
              '将读取本地存档，恢复上次的角色卡数据与聊天记录。\n\n' +
              '（若想从零开始，请点「开始创作」）',
              function() {
                try { continueFromSave(); } catch (err) {
                  logError('continueFromSave', err, '恢复存档失败：' + (err && err.message ? err.message : '未知错误'));
                }
              }
            );
          });
        }
      }

      function renderChatUI() {
        doc.body.innerHTML =
          '<div class="app">' +
          '<div class="topbar topbar--main">' +
          '<div class="topbar-left">' +
          '<h1>' + svgIcon('bolt', 18, 'topbar-ic') + ' 时之写卡器<span style="font-weight:400;font-size:.8em;color:var(--ink-soft)"> · Agent</span></h1>' +
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
          '<div class="agent-options-bar" id="agentOptionsBar" style="display:none"></div>' +
          '<div class="quick-actions" id="quickActions"></div>' +
          '<div class="chat-input-area">' +
          '<div class="chat-input-row">' +
          '<textarea class="chat-input" id="chatInput" placeholder="描述你想要的任何内容：世界观/角色设定/世界书条目/开场白，或 MVU变量系统、状态栏、前端界面… Agent自动理解并生成" rows="1"></textarea>' +
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
      let _pvToggleBound = false;   // 迭代1·M1：doc 级 toggle 捕获监听的一次性绑定标志

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
        // Agent模式：无视图切换（旧三Tab已合并）
        // 工具（进度总览/开场白/权重/分组）
        items += '<div class="ws-dropdown-divider"></div>';
        items += '<div class="ws-dropdown-section">工具</div>';
        items += '<div class="ws-dropdown-item" data-action="qa-summary">' + svgIcon('chart', 15) + ' 进度总览</div>';
        if (!hasFirstDef && progress >= 20) {
          items += '<div class="ws-dropdown-item" data-action="qa-opening">' + svgIcon('film', 15) + ' 生成开场白</div>';
        }
        items += '<div class="ws-dropdown-item" data-action="qa-weight">' + svgIcon('gauge', 15) + ' 权重可视化</div>';
        items += '<div class="ws-dropdown-item" data-action="qa-group">' + svgIcon('layers', 15) + ' 分组管理</div>';
        items += '<div class="ws-dropdown-item" data-action="user-profile" title="查看本地记录的写作习惯（题材/尺度/条目长度/常驻比例等），AI会据此个性化写卡，纯本地可关闭可清空">' + svgIcon('chart', 15) + ' 我的习惯</div>';
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
            if (action === 'export-card') exportCardJson();
            else if (action === 'export-log') {
              const btn = doc.getElementById('exportLogBtn');
              if (btn) btn.click();
            } else if (action === 'import-card') showImportModal();
            else if (action === 'qa-summary') handleQuickAction('summary');
            else if (action === 'qa-opening') handleQuickAction('opening');
            else if (action === 'qa-weight') handleQuickAction('weight');
            else if (action === 'qa-group') handleQuickAction('group');
            else if (action === 'user-profile') showUserProfilePanel();
          });
        });
      }

      function bindEvents() {
        // ⚠️竞态修复：生成期间关闭编辑器 → 旧闭包的 callAI 返回后仍会写 storage，与用户重新打开的
        // 新闭包形成双写者竞态（AI 修改可能被覆盖丢失）。改为关闭前二次确认
        doc.getElementById('closeBtn').addEventListener('click', function() {
          if (isGenerating || agentLoopActive || (typeof _analyzingPrefs !== 'undefined' && _analyzingPrefs)) {
            const okToClose = window.confirm((agentLoopActive ? 'Agent自动循环正在执行中' : (_analyzingPrefs ? '正在后台分析写作偏好' : 'AI 正在生成中')) + '，关闭后当前步骤的内容可能丢失。\n' + (agentLoopActive ? 'Agent循环将一并停止（已完成步骤全部保留，可重开后「继续执行计划」）。\n' : '后台任务仍会继续写数据。\n') + '确定要关闭吗？');
            if (!okToClose) return;
            // Agent循环中关闭：停止循环（当前AI调用无法中断，本步完成后不再继续）
            if (agentLoopActive) {
              try {
                stopAgentLoop();
              } catch (_e) {}
            }
            closeModal();
            // 后台任务仍在运行：保留 window.__* 访问器（后台闭包仍经其读写数据），下次 openEditor 覆盖
          } else {
            // 🐛 修复 Bug3：关闭编辑器时不再自动采集 accepted 样本 / 触发写作偏好分析。
            //   原因：_collectAcceptedSamples 会用 localStorage 中的历史快照构造"用户接受了 AI 产出"的正样本，
            //   写入 feedback 后立即触发 _maybeAutoAnalyze() → 后台静默调 AI 分析写作偏好。
            //   用户每次"打开 → 关闭"写卡器都会被触发，形成"打开/关闭此工具自动分析"的打扰。
            //   数据采集改由用户明确动作触发：写入酒馆（saveCharacter）/ 导出角色卡 JSON（exportCardJson）。
            // 便于排查误报：明确打印关闭时不会触发分析
            if (WRITER_DEBUG) console.log('[写卡诊断] closeBtn: 关闭编辑器，未触发偏好分析（白名单：save-character / export-json）');
            closeModal();
            // ⚠️无后台任务：立即释放 window.__* 持有的整份 cardData + 聊天历史引用，防会话数据泄漏
            _releaseEditorGlobals();
          }
        });
        const input = doc.getElementById('chatInput');
        const sendBtn = doc.getElementById('sendBtn');
        sendBtn.addEventListener('click', function() {
          if (isGenerating) {
            requestAbort();
          } else {
            handleSend();
          }
        });
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
        // 迭代1·M1+H2：`<details>` 展开态捕获监听——必须绑 doc（body 随 renderChatUI 重建，绑 body 会丢）
        if (!_pvToggleBound) {
          _pvToggleBound = true;
          doc.addEventListener('toggle', function(e) {
            const d = e.target;
            if (!d || d.tagName !== 'DETAILS') return;
            const c = d.getAttribute('data-pv-comment');
            if (!c) return;
            if (d.open) _pvExpanded[c] = true; else delete _pvExpanded[c];
          }, true);
        }
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
        // ========== Agent模式：无Tab切换按钮（renderChatUI 已移除 tab-switcher，此绑定自然为空，仅留注释说明） ==========
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
          // ⚠️修复：ST 独立世界书导出格式里 entries 可能是对象（{"0":{...},"1":{...}}）而非数组，
          // 直接 .map 会抛 TypeError。先归一化成数组，再做下方条目规范化。
          try {
            if (cd.character_book.entries && !Array.isArray(cd.character_book.entries) && typeof cd.character_book.entries === 'object') {
              normalizeWorldInfoJSON({ character_book: cd.character_book });
            }
          } catch (_normErr) { logWarn('import.normalize', _normErr); }
          const _rawBookEntries = Array.isArray(cd.character_book.entries) ? cd.character_book.entries : [];
          cardData.character_book = {
            entries: _rawBookEntries.map(function(e, i) {
              // 通过模板获取默认值（支持 MVU [InitVar] 等前缀）
              const comment = e.comment || '';
              const tmpl = getEntryTemplate(comment);
              const defaultPos = tmpl ? tmpl.position : 4;
              const defaultDepth = tmpl ? tmpl.depth : 4;
              const defaultOrder = tmpl ? tmpl.order : 100;
              const defaultEnabled = tmpl && tmpl.enabled !== undefined ? tmpl.enabled : true;
              // [InitVar] 条目 enabled=false（MVU 只读取禁用的 initvar 条目进行初始化）
              const isInitVar = _isInitVarComment(comment, e.content);
              const isVarList = _entryCommentCore(comment) === '变量当前状态';
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
                  group_override: ext.group_override !== undefined ? !!ext.group_override : false,
                  sticky: ext.sticky !== undefined && ext.sticky !== null ? ext.sticky : null,
                  cooldown: ext.cooldown !== undefined && ext.cooldown !== null ? ext.cooldown : null,
                  delay: ext.delay !== undefined && ext.delay !== null ? ext.delay : null,
                  scan_depth: ext.scan_depth !== undefined ? ext.scan_depth : (tmpl ? tmpl.scan_depth : null),
                  match_whole_words: ext.match_whole_words !== undefined ? ext.match_whole_words : null,
                  case_sensitive: ext.case_sensitive !== undefined ? ext.case_sensitive : null,
                  automation_id: ext.automation_id || '',
                  display_index: ext.display_index !== undefined ? ext.display_index : i,
                  outlet_name: ext.outlet_name || '',
                  triggers: ext.triggers || [],
                  ignore_budget: ext.ignore_budget !== undefined ? ext.ignore_budget : false,
                  character_filter: ext.character_filter !== undefined ? ext.character_filter : null,
                  addMemo: ext.addMemo !== undefined ? !!ext.addMemo : false,
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
        // ========== Agent模式：导入角色卡时重置唯一会话聊天记录（回到全新起始状态） ==========
        chatSessions.card.messages = [];
        chatSessions.mvu.messages = [];
        chatSessions.frontend.messages = [];
        cardMessages = chatSessions.card.messages;
        mvuMessages = chatSessions.mvu.messages;
        frontendMessages = chatSessions.frontend.messages;
        // 同步到全局 messages 别名（向后兼容）
        messages = [];
        // Agent模式：activeTab 恒为 'card'，无需切回；导入新卡时作废旧Agent计划
        agentPlan = null;
        agentLoopActive = false;
        agentConsecutiveFailures = 0;
        agentLastObservation = '';
        renderChatUI();
        applyFontScale(_appFontScale);
        const entriesLen = (cardData.character_book && cardData.character_book.entries) ? cardData.character_book.entries.length : 0;
        const greeting = '你好！已成功导入角色卡「' + (cardData.name || '未命名') + '」🎭\n\n' +
          '卡片数据：描述 ' + (cardData.description || '').length + ' 字、开场白 ' + (cardData.first_mes || '').length + ' 字、世界书 ' + entriesLen + ' 条\n\n' +
          '**我已读取了角色卡的全部内容（含MVU资产/正则脚本），可以直接进行增/删/改操作：**\n' +
          '• 想修改某个字段？直接说"把名字改成XXX"或"修改世界观描述"\n' +
          '• 想添加世界书条目？说"添加一个XX的条目"\n' +
          '• 想修改条目？说"把XX改成XXX"或"修改XXX条目"\n' +
          '• 想删除条目？说"删掉XXX条目"\n' +
          '• 想做变量系统/状态栏/前端界面？直接描述需求即可，无需切换任何界面\n\n' +
          '请告诉我你想做什么！';
        addAssistantMsg(greeting);
        saveToStorage();
        try { UserProfile.recordCardImported(); } catch (_) {}
      }

      // ============================================================================
      // SECTION 9  持久化 & 酒馆 SillyTavern API 适配层
      // ============================================================================
      // ===== localStorage 持久化 =====
      const STORAGE_KEY = 'modelo_char_generator_agent_state'; // Agent版独立存档key：避免与旧三Tab版存档互相覆盖（旧key: modelo_char_generator_state）

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

        // 2. 聊天记录：所有 Tab 全部清空 + 所有别名同步（兼容旧代码对 messages/cardMessages/mvuMessages/frontendMessages 的直接引用）
        chatSessions.card = {
          messages: [],
          mode: 'normal'
        };
        chatSessions.mvu = {
          messages: []
        };
        chatSessions.frontend = {
          messages: []
        };
        cardMessages = chatSessions.card.messages;
        mvuMessages = chatSessions.mvu.messages;
        frontendMessages = chatSessions.frontend.messages;
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
            // const 对象不能整体重新赋值，改为清空每个 tab 的键
            ['card', 'mvu', 'frontend'].forEach(function(k) {
              try { cardDataSnapshots[k] = {}; } catch (_) {}
            });
          }
          // 同步清理 localStorage 持久化快照，避免重开后误读到旧卡数据
          const _snapToDel = [];
          for (let _i = 0; _i < localStorage.length; _i++) {
            const _k = localStorage.key(_i);
            if (_k && _k.indexOf('szxq_snap_') === 0) _snapToDel.push(_k);
          }
          _snapToDel.forEach(function(_k) { localStorage.removeItem(_k); });
        } catch (_eSnap) {}
        try {
          _aiChatQueueMode = false;
        } catch (_eQ) {}
        try {
          _aiChatNotesQueue = [];
        } catch (_eQ) {}
        // 6. Agent Loop 状态归零（计划/循环/失败计数/观察）
        agentPlan = null;
        agentLoopActive = false;
        agentConsecutiveFailures = 0;
        agentLastObservation = '';
        // 6.5 撤回/重试对照基线 + AI变更摘要 + 预览筛选状态 归零
        try { _lastAcceptedSnapshot = null; } catch (_e) {}
        try {
          for (const _mk in _msgChangeMap) {
            if (_msgChangeMap.hasOwnProperty(_mk)) delete _msgChangeMap[_mk];
          }
        } catch (_e) {}
        try {
          if (typeof _pvFilter !== 'undefined' && _pvFilter) {
            _pvFilter.q = '';
            _pvFilter.kind = 'all';
            _pvFilter.group = '';
            _pvFilter.batch = false;
            _pvFilter.selected = {};
          }
        } catch (_e) {}
        try { cpSectionStates && Object.keys(cpSectionStates).forEach(function(k){ delete cpSectionStates[k]; }); } catch (_e) {}
        // 7. localStorage 存档：移除旧 STORAGE_KEY，避免"关闭重开又带回来旧卡"
        clearStorage();
        // 8. Agent 理解阶段选项条归零
        clearAgentOptionsBar();
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
          frontendMessages = chatSessions.frontend.messages;

          const state = {
            cardData: cardData,
            activeTab: activeTab || 'card',
            chatSessions: chatSessions,
            currentTab: activeTab || 'card',
            cardGenerated: cardGenerated,
            progress: progress,
            moduleProgress: moduleProgress,
            fontScale: typeof _appFontScale === 'number' ? _appFontScale : 1,
            agentPlan: agentPlan, // Agent计划（含步骤done状态，重开后可「继续执行计划」）
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
                agentPlan: agentPlan, // Agent计划不可丢（丢=执行中计划无法继续）
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
          // Agent版独立存档key；若无Agent存档，回退读取旧三Tab版存档（自动迁移合并三组会话）
          let raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) {
            raw = localStorage.getItem('modelo_char_generator_state'); // 旧版key
            if (!raw) return false;
          }
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

            // ========== Agent模式：还原唯一会话，旧三Tab存档（card/mvu/frontend）历史消息自动合并进唯一会话 ==========
            let _migCard = [], _migMvu = [], _migFrontend = [];
            if (state.chatSessions && typeof state.chatSessions === 'object') {
              // 新版结构：从 chatSessions 对象还原三组消息
              _migCard = (state.chatSessions.card && Array.isArray(state.chatSessions.card.messages)) ? state.chatSessions.card.messages.slice() : [];
              _migMvu = (state.chatSessions.mvu && Array.isArray(state.chatSessions.mvu.messages)) ? state.chatSessions.mvu.messages.slice() : [];
              _migFrontend = (state.chatSessions.frontend && Array.isArray(state.chatSessions.frontend.messages)) ? state.chatSessions.frontend.messages.slice() : [];
            } else {
              // 更旧的版本：从独立字段迁移
              if (state.cardMessages && Array.isArray(state.cardMessages)) {
                _migCard = state.cardMessages.slice();
              } else if (state.messages && Array.isArray(state.messages)) {
                _migCard = state.messages.slice();
              }
              _migMvu = (state.mvuMessages && Array.isArray(state.mvuMessages)) ? state.mvuMessages.slice() : [];
            }
            // ★ 旧三Tab消息合并进唯一会话：无法恢复原始交织顺序，按 card → mvu → frontend 串联；
            //   非空会话段之间插入系统分隔消息，避免连续两条user消息产生歧义
            const _merged = _migCard.slice();
            if (_migMvu.length > 0) {
              if (_merged.length > 0) _merged.push({ role: 'assistant', content: '（以下为旧版「MVU变量」界面的对话记录，已合并入本会话）' });
              Array.prototype.push.apply(_merged, _migMvu);
            }
            if (_migFrontend.length > 0) {
              if (_merged.length > 0) _merged.push({ role: 'assistant', content: '（以下为旧版「前端界面」界面的对话记录，已合并入本会话）' });
              Array.prototype.push.apply(_merged, _migFrontend);
            }
            chatSessions.card = {
              messages: _merged,
              mode: 'normal'
            };
            chatSessions.mvu = {
              messages: []
            };
            chatSessions.frontend = {
              messages: []
            };
            // 同步别名引用
            cardMessages = chatSessions.card.messages;
            mvuMessages = chatSessions.mvu.messages;
            frontendMessages = chatSessions.frontend.messages;

            // Agent模式：activeTab 恒为 'card'（旧存档记录的Tab值不再生效）
            activeTab = 'card';
            currentTab = activeTab; // 兼容别名
            if (typeof window !== 'undefined') {
              window.__tab_activeTab = activeTab;
            }
            // messages 全局兼容别名：指向唯一会话（不 .slice() 复制，保持与 chatSessions 唯一真源的引用）
            messages = chatSessions.card.messages;

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

            // ========== Agent模式：恢复未完成的Agent计划（含步骤done状态）==========
            // ★修复#10：门槛 >= 2 → >= 1（只剩 1 步未完成时重新打开不应丢弃计划）
            if (state.agentPlan && state.agentPlan.steps && Array.isArray(state.agentPlan.steps) && state.agentPlan.steps.length >= 1) {
              agentPlan = {
                goal: String(state.agentPlan.goal || 'Agent创作计划'),
                steps: state.agentPlan.steps.map(function(s) {
                  return { desc: String((s && s.desc) || ''), done: !!(s && s.done) };
                }).filter(function(s) {
                  return s.desc.length > 1;
                }),
                createdAt: state.agentPlan.createdAt || Date.now(),
                stepRuns: 0 // 重开后重置执行计数（防失控上限按新一轮会话计）
              };
              if (agentPlan.steps.length < 2) agentPlan = null;
            } else {
              agentPlan = null;
            }

            // 用户要求：不做定时检查。分析只在撤回/重试/编辑/写入等事件节点由 _maybeAutoAnalyze 触发，
            // 或用户在「我的习惯」面板点「立即分析」。

            return true;
          }
        } catch (e) { logWarn("loadFromStorage", e); }
        return false;
      }

      function hasSavedData() {
        try {
          let raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('modelo_char_generator_state');
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
          try { localStorage.removeItem('modelo_char_generator_state'); } catch (_eL) {}
        } catch (e) { logWarn("clearStorage", e); }
      }

      function continueFromSave() {
        if (loadFromStorage()) {
          renderChatUI();
          applyFontScale(_appFontScale);
          // ========== Agent模式：恢复唯一会话的历史消息到对话区 ==========
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
          updateProgress();
          updateQuickActions();
          updateCtxBar();
          renderPreview();
          scheduleCtxBarUpdate();
          showToast('已恢复上次创作进度', 'success');
        } else {
          showToast('没有找到保存的数据', 'warning');
        }
      }

      function updateCtxBar() {
        const stage = doc.getElementById('ctxStage');
        const actions = doc.getElementById('ctxActions');
        if (!stage || !actions) return;
        const p = progress || 0;
        // ===== Agent模式：统一阶段提示（Agent循环执行中显示计划进度，否则显示整体创作进度）=====
        let stageName, stageIcon;
        const _planActive = agentLoopActive && agentPlan && agentPlan.steps;
        const _planPendingN = agentPlan && agentPlan.steps ? agentPlan.steps.filter(function(s) { return !s.done; }).length : 0;
        if (_planActive) {
          const _doneN = agentPlan.steps.filter(function(s) { return s.done; }).length;
          stageIcon = 'sparkle';
          stageName = '🤖 Agent自动执行中 · 第' + Math.min(_doneN + 1, agentPlan.steps.length) + '/' + agentPlan.steps.length + '步';
          // ★ 体验补强：执行中给 phaseLabel 加脉冲动效（复用现有 send-btn-pulse 动画）
          try {
            const _pl = doc.getElementById('phaseLabel');
            if (_pl) _pl.classList.add('send-btn-pulse');
          } catch (_) {}
        } else if (agentPlan && agentPlan.steps && _planPendingN > 0) {
          stageIcon = 'play';
          stageName = '计划待续 · 剩' + _planPendingN + '步（点「继续执行计划」）';
        } else {
          stageIcon = 'info';
          stageName = p < 20 ? 'Agent创作中 · 补齐主体设定' : p < 40 ? 'Agent创作中 · 丰富世界书' : p < 60 ? 'Agent创作中 · 深化条目' : p < 80 ? 'Agent创作中 · 完善细节' : p < 95 ? 'Agent创作中 · 精修打磨' : '内容完备 · 可写入酒馆';
        }
        stage.innerHTML = svgIcon(stageIcon, 13) + ' <strong>' + stageName + '</strong>';
        // ===== Agent模式：三领域统一状态胶囊（条目统计 + MVU 8步摘要 + 前端产物）=====
        let h = '';
        {
          // —— 角色卡主体：世界书条目统计胶囊 ——
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
          // —— MVU变量系统：8步紧凑chip ——
          const _ctxChk = checkMvu8Entries(cardData);
          const _doneCnt = _ctxChk.doneCount;
          const _mvuTotalDone = _doneCnt + (_ctxChk.has8 ? 1 : 0);
          h += '<span class="ctx-chip ' + (_mvuTotalDone > 0 ? 'ok' : 'todo') + '" title="MVU 8步工作流（第8条=状态栏HTML）">' + svgIcon(_mvuTotalDone > 0 ? 'checkCircle' : 'circle', 11) + ' MVU ' + _mvuTotalDone + '/8</span>';
          // —— 前端界面：产物状态chip ——
          const _feBList = getFrontendBeautifyRegexes();
          const _feS = getFrontendStructuredRegexes();
          const _feOk = _feBList.length > 0 || _feS.length > 0;
          h += '<span class="ctx-chip ' + (_feOk ? 'ok' : 'todo') + '" title="前端界面正则（正文美化 + 数据面板）">' + svgIcon(_feOk ? 'checkCircle' : 'circle', 11) + ' 界面' + (_feBList.length > 0 ? ('·美化×' + _feBList.length) : '') + (_feS.length > 0 ? ('·面板×' + _feS.length) : '') + '</span>';
          // —— 阶段自适应主操作按钮（右对齐：按最大缺口推荐）——
          if (!_ctxChk.all7Done) {
            if (_doneCnt === 0 && !_feOk) {
              // MVU与前端都未开始：不显示主按钮（由快捷动作「智能推进」接管）
            } else if (_doneCnt === 0) {
              h += '<button class="ctx-mod" data-mod="init_var" style="margin-left:auto;background:var(--accent-soft);color:var(--accent-deep);border-color:var(--accent-border)">' + svgIcon('code', 13) + ' 生成变量系统</button>';
            }
          } else if (!_ctxChk.has8) {
            h += '<button class="ctx-mod" data-mod="start_sb" style="margin-left:auto;background:var(--accent-soft);color:var(--accent-deep);border-color:var(--accent-border)">' + svgIcon('sliders', 13) + ' 生成状态栏</button>';
          } else {
            h += '<button class="ctx-mod" data-mod="mvuPreview" style="margin-left:auto;background:var(--accent-soft);color:var(--accent-deep);border-color:var(--accent-border)">' + svgIcon('eye', 13) + ' 预览状态栏</button>';
          }
        }
        // 迭代1·H3：幂等哨兵——同一批次多次调用时跳过重复 DOM 写
        if (h === _lastCtxHtml) return;
        _lastCtxHtml = h;
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

        // ========== Agent模式：统一快捷动作（按当前卡片缺口自适应，不分Tab）==========
        // 结构：Agent循环动作（模式切换/检查/停止/继续计划） + MVU动作 + 前端动作 + 常驻组（继续/重做/进度/写入/清空）
        const actions = [];
        const _chk = checkMvu8Entries(cardData);
        const _feB = getFrontendBeautifyRegex();
        const _feS = getFrontendStructuredRegexes();
        const _hasFe = !!_feB || _feS.length > 0;
        const _planPending = agentPlan && agentPlan.steps && agentPlan.steps.some(function(s) { return !s.done; });

        // —— 模式切换（始终显示，点击切换 Agent ⇄ 正常）——
        actions.push({
          action: 'toggle_mode',
          icon: agentAutoMode ? 'bot' : 'chat',
          label: agentAutoMode ? 'Agent模式' : '正常模式',
          title: agentAutoMode
            ? '当前：Agent 模式 —— AI先理解你的意图并给出2-3个选项，你确认后才开始生成计划并自动执行。点击切换到「正常模式」'
            : '当前：正常模式 —— AI直接根据你的描述生成内容。点击切换到「Agent模式」（先理解+选项+确认再生成）',
          hl: agentAutoMode
        });
        // —— 检查（始终显示，独立于模式）——
        actions.push({
          action: 'start_check',
          icon: 'target',
          label: '检查',
          title: '全面检查创作进度：逐项核对角色卡主体 / MVU 8步工作流 / 前端界面，输出待办计划并由Agent自动逐步执行'
        });
        // —— Agent循环状态（循环中/有待续计划时才显示）——
        if (agentLoopActive) {
          actions.push({
            action: 'stop_agent',
            icon: 'close',
            label: '停止Agent',
            title: '在当前步骤完成后停止自动执行（成果保留，剩余步骤可随时继续）',
            hl: true
          });
        } else if (_planPending) {
          actions.push({
            action: 'resume_agent',
            icon: 'play',
            label: '继续执行计划',
            title: '继续自动执行未完成的Agent计划（剩余' + agentPlan.steps.filter(function(s) { return !s.done; }).length + '步）',
            hl: true
          });
        }
        // —— 生成并写入酒馆（p>=95 高亮）——
        actions.push({
          action: 'generate',
          icon: 'save',
          label: '生成并写入酒馆',
          title: '通过写卡器装配角色卡（含世界书/MVU资产/正则/脚本），直接写入到酒馆当前角色卡',
          hl: p >= 95
        });
        // —— MVU动作（按8步状态自适应）——
        if (!_chk.all7Done) {
          if (_chk.doneCount === 0) {
            actions.push({
              action: 'init_var',
              icon: 'code',
              label: '生成MVU变量系统',
              title: '启动MVU 8条工作流：从第1条zod变量结构脚本开始批量生成（一次回复输出全部缺失条目）'
            });
          } else {
            actions.push({
              action: 'continue_mvu',
              icon: 'play',
              label: '继续MVU工作流',
              title: '继续生成下一条MVU条目（当前' + _chk.doneCount + '/7）'
            });
          }
        } else if (!_chk.has8) {
          actions.push({
            action: 'start_sb',
            icon: 'sliders',
            label: '生成状态栏HTML',
            title: '前7条已完成，生成第8条MVU状态栏HTML（正则6）'
          });
        } else {
          actions.push({
            action: 'mvuPreview',
            icon: 'eye',
            label: '预览状态栏',
            title: '沙箱预览MVU状态栏渲染效果'
          });
          actions.push({
            action: 'reset_sb',
            icon: 'trash',
            label: '清除状态栏'
          });
        }
        // —— 前端动作（按产物状态自适应）——
        if (!_hasFe) {
          actions.push({
            action: 'generate_frontend',
            icon: 'layers',
            label: '生成前端界面',
            title: '描述想要的界面效果（正文美化 / 结构化数据面板），AI自动判断生成对应正则+世界书条目'
          });
        } else {
          actions.push({
            action: 'preview_frontend',
            icon: 'eye',
            label: '预览界面',
            title: '在沙箱预览界面渲染效果（正文美化 + 数据面板）'
          });
          actions.push({
            action: 'generate_frontend',
            icon: 'refreshCycle',
            label: '重新生成界面'
          });
          actions.push({
            action: 'reset_frontend',
            icon: 'trash',
            label: '清除界面正则'
          });
        }
        let h = '';
        actions.forEach(function(a) {
          const icHtml = a.icon ? svgIcon(a.icon, 14) + ' ' : '';
          const titleAttr = a.title ? (' title="' + a.title.replace(/"/g, '&quot;') + '"') : '';
          const ariaLabel = a.title ? (' aria-label="' + a.title.replace(/"/g, '&quot;') + '"') : '';
          h += '<button class="quick-btn' + (a.hl ? ' hl' : '') + '" data-action="' + a.action + '"' + titleAttr + ariaLabel + '>' + icHtml + a.label + '</button>';
        });
        // 常驻指令组：继续 / 重做上一条 / 查看进度
        h += '<span class="qa-cmd-sep"></span>';
        h += '<button class="qa-mini qa-cmd" data-action="continue" title="一键发送「继续」，让AI接着上一步输出">' + svgIcon('play', 13) + ' 继续</button>';
        h += '<button class="qa-mini qa-cmd" data-action="redo" title="撤销并重新生成最后一条AI回复（自动回滚该次卡片修改）">' + svgIcon('refreshCycle', 13) + ' 重做</button>';
        h += '<button class="qa-mini qa-cmd" data-action="summary" title="让Agent梳理当前已完成内容、缺口与下一步">' + svgIcon('gauge', 13) + ' 查看进度</button>';
        // 2 mini：写入酒馆 / 清空（右对齐）
        h += '<button class="qa-mini" id="saveBtn" title="直接写入酒馆角色卡">' + svgIcon('save', 14) + ' 写入酒馆</button>';
        h += '<button class="qa-mini" id="clearChatBtn" title="清空对话记录（不影响角色卡内容）">' + svgIcon('trash', 14) + ' 清空</button>';
        // 迭代1·H3：幂等哨兵
        if (h === _lastActionsHtml) return;
        _lastActionsHtml = h;
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
            // ========== Agent模式：清空唯一会话的聊天记录 ==========
            const curMsgs = getCurrentMessages();
            if (curMsgs.length === 0) {
              showToast('对话已经是空的', 'info');
              return;
            }
            if (!confirm('确定清空所有对话记录吗？\n\n✅ 角色卡内容不会被影响，仍会保留\n✅ 只清除聊天对话历史')) return;
            setCurrentMessages([]);
            const chatC = doc.getElementById('chatMessages');
            if (chatC) chatC.innerHTML = '';
            saveToStorage();
            showToast('✅ 对话已清空（角色卡内容不受影响）', 'success');
          });
        }
        // 同步禁用态（生成中）
        if (saveBtn) saveBtn.disabled = isGenerating;
      }

      function handleQuickAction(action) {
        const input = doc.getElementById('chatInput');
        // 用户画像：记录快捷动作使用频次
        try { UserProfile.recordAction(action); } catch (_) {}

        // ========== Agent模式：无Tab跳转（旧 goto_mvu/goto_card 与跨Tab跳转器已移除）==========

        // —— 模式切换（Agent ⇄ 正常）——
        if (action === 'toggle_mode') {
          agentAutoMode = !agentAutoMode;
          if (typeof window !== 'undefined') window.__agentAutoMode = agentAutoMode;
          updateQuickActions();
          showToast(
            agentAutoMode
              ? '✅ 已切换到「Agent模式」——AI 会先理解你的意图并给出 2-3 个选项，你确认后再开始生成'
              : '✅ 已切换到「正常模式」——AI 会直接根据你的描述生成',
            'success', 4500
          );
          return;
        }
        // —— 检查（原「自动创作」功能，独立按钮）——
        if (action === 'start_check' || action === 'auto_create') {
          if (isGenerating) {
            showToast('AI正在处理中，请稍候再点「检查」', 'warning');
            return;
          }
          if (agentLoopActive) return;
          startCheckFlow();
          return;
        }
        if (action === 'stop_agent') {
          stopAgentLoop();
          return;
        }
        if (action === 'resume_agent') {
          if (isGenerating) {
            showToast('AI正在处理中，请稍候再继续计划', 'warning');
            return;
          }
          agentLoop().catch(function(err) {
            logError('agentLoop.resume', err);
          });
          return;
        }

        // MVU专属快捷动作（Agent模式：不限Tab）
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

        // ========== 前端界面 Tab 专属动作（统一：正文美化 + 结构化数据面板，AI自动判断类型）==========
        if (action === 'generate_frontend') {
          if (isGenerating) {
            showToast('AI正在处理中，请稍候再点「生成前端界面」', 'warning');
            return;
          }
          if (input) {
            if (input.value && input.value.trim()) {
              // 用户已描述想要的界面 → 直接发送
              handleSend();
            } else {
              // 无输入 → 填入统一引导指令（AI按描述自动判断生成正文美化或结构化数据面板）
              input.value = '请根据现有角色卡的风格，生成一个「前端界面」正则。AI根据我接下来的描述自动判断类型：\n' +
                '- 若我描述的是正文美化（如信纸/日记/气泡等渲染风格）→ 输出 ```html 完整HTML（getMessageData + extractContent + renderPage），保存为[界面]正文美化正则，并自动生成对应世界书条目。\n' +
                '- 若我描述的是结构化数据面板（如任务面板/论坛/状态栏等展示AI特定格式数据）→ 输出【页面名称】+【标签名】+ ```html 完整HTML（getMessageData + parseData + renderPage + handleClick），保存为[界面]页面名称正则，并生成规范AI输出的世界书条目。';
              handleSend();
            }
          }
          return;
        }
        if (action === 'preview_frontend') {
          // 沙箱预览所有前端界面正则（正文美化 + 结构化数据面板），参考MVU状态栏预览
          const _feB = getFrontendBeautifyRegex();
          const _feS = getFrontendStructuredRegexes();
          if (!_feB && _feS.length === 0) {
            showToast('还没有生成前端界面正则，先点「生成前端界面」', 'warning');
            return;
          }
          showFrontendPreview();
          return;
        }
        if (action === 'reset_frontend') {
          if (!confirm('确定清除全部「前端界面」正则吗？\n\n✅ 将删除正文美化正则 + 结构化数据面板正则 + 对应的世界书条目\n✅ 不影响角色卡/世界书/MVU内容\n✅ 可随时重新生成')) return;
          cardData.extensions = cardData.extensions || {};
          const _rxFe = Array.isArray(cardData.extensions.regex_scripts) ? cardData.extensions.regex_scripts : [];
          cardData.extensions.regex_scripts = _rxFe.filter(function(r) {
            if (!r) return true;
            const isFe = (r.id === 'frontend-beautify' || (r.scriptName || '').indexOf('[界面]') === 0);
            if (isFe) console.warn('[frontend] 清除界面正则:', r.scriptName);
            return !isFe;
          });
          removeBeautifyWorldInfoEntry();
          removeStructuredFrontendAll();
          saveToStorage();
          renderPreview();
          updateQuickActions();
          updateCtxBar();
          showToast('✅ 已清除全部前端界面正则（含世界书条目），可重新生成', 'success');
          return;
        }

        // 通用快捷指令（两个 Tab 通用）：继续 / 重做最后一条AI回复
        if (action === 'continue') {
          if (isGenerating) {
            showToast('AI正在处理中，请稍候再点「继续」', 'warning');
            return;
          }
          try { UserProfile.recordContinue(); } catch (_) {}
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

        // 通用动作（Agent模式：不限Tab）
        if (action === 'generate_entry') {
          // 让AI自由生成世界书条目（用户描述什么就生成什么）
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
          // 点击「生成并写入酒馆」直接执行写入酒馆（与 qa-mini 写入酒馆按钮一致，按钮位置更显眼）。
          // Agent模式：不限Tab
          saveCharacter();
          return;
        }

        // ========== Agent模式：统一 Prompt 字典（合并旧三Tab字典，覆盖角色卡/MVU/前端全领域）==========
        const prompts = {
          next: '下一步我该做什么？请根据「当前创作进度总览」分析三大领域缺口（角色卡主体/世界书条目；MVU 8步工作流：' + MVU_8STEPS_SHORT + '；前端界面正则），给出2-3条具体可执行的建议，并说明每条建议会丰富哪个方向。用简洁列表呈现。',
          summary: '帮我作为写卡Agent梳理当前创作进度：\n1) 角色卡主体：名称/世界观描述/开场白/世界书条目现状\n2) MVU变量系统：按8条顺序检查完成情况（' + MVU_8STEPS_SHORT + '）\n3) 前端界面：正文美化正则与结构化数据面板状态\n4) 还缺什么、推荐的下一步。用简洁列表呈现。',
          opening: '请根据现有世界观设定生成开场白。开场白1用 ::: set first_mes（500-800字：场景描写→主角出场→冲突/悬念→结尾留钩；用 {{char}}/{{user}} 代角色与玩家名，可结合 {{time}}/{{date}}/{{random}}/{{pick}}/{{idleDuration}}/{{roll}} 等酒馆宏增强真实感，但禁止占位符/未定文案）；同时生成2条以上备选开场白用 ::: set alternate_greetings（多条用---分割，与开场白1不同的场景/视角/时机；酒馆聊天界面可切换，{{charFirstMessage::N}} 可取第N条）。全部用:::操作块输出。',
          generate_entry: '请帮我自由生成世界书条目（不限制标签前缀，用户要什么就生成什么）。只用:::upsert操作块输出，生成/修改条目时按需填写会影响生效的字段（触发型必填 keys/constant=false，常驻型 constant=true，需要自定义位置的写 position/depth/order/selectiveLogic/probability 等），其余保持默认；正文用YAML中文格式。',
          init_var: '请帮我设计MVU变量系统（注意：变量相关内容一律走MVU体系，不要做成普通条目）：先收集我的变量需求（角色/世界观/场景/需要追踪什么状态）；若我已说清需求或让你看着办，则按8条固定顺序**一次回复批量生成全部条目**（第1条zod脚本→第7条占位提醒连续输出，前7条完成后可继续生成第8条状态栏HTML）。',
          var_update_rule: '请检查当前MVU系统已有的条目，按8条固定顺序从缺失的第一条开始补齐，**一次回复批量输出所有缺失条目**（已存在的不重复生成）；前7条全部完成后才生成第8条状态栏。',
          generate_frontend: '请根据现有角色卡风格设计一个前端界面。AI根据我的需求自动判断类型：若为正文美化（信纸/日记/气泡等）输出```html完整HTML（getMessageData+extractContent+renderPage）；若为结构化数据面板（任务面板/论坛/状态栏等）输出【页面名称】+【标签名】+```html完整HTML（getMessageData+parseData+renderPage+handleClick）。写卡器会自动保存为正则并生成世界书条目。'
        };
        if (prompts[action] && input) {
          // ⚠️修复：生成期间禁止触发——整段提示词不再填入输入框
          if (isGenerating) {
            showToast('AI正在处理中，请稍候再点「' + action + '」', 'warning');
            return;
          }
          // ★修复#11：快捷动作改为标志位注入——指令存入 window.__cwQuickAction，
          // 由 buildPrompt 注入到系统侧（agentDirective），不再把 500+ 字系统指令写进用户消息（避免污染对话历史/让用户困惑）
          try { window.__cwQuickAction = { action: action, prompt: prompts[action] }; } catch (_) {}
          if (input.value && input.value.trim()) {
            // 用户已有输入 → 正常发送，动作指令作为系统侧补充
            handleSend();
          } else {
            input.value = '（快捷动作：' + action + '）';
            handleSend();
          }
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
        // ★反馈语料：把用户这条消息回填到最近被撤回/重试的样本（用户不满原因的最强信号）
        try { UserProfile.attachNextMessage(content); } catch (_) {}
        // 撤回/重试后用户发新消息 = 当前 cardData 是用户最终接受的基线，立即回填 acceptedContent
        try {
          const _curEntries = (cardData.character_book || {}).entries || [];
          const _curMap = {};
          _curEntries.forEach(function(e) {
            if (e && e.comment) _curMap[String(e.comment)] = String(e.content || '');
          });
          const _tab = _snapTabKey();
          UserProfile.attachAcceptedContent(_curMap, _tab);
          UserProfile.attachAcceptedFields({
            name: cardData.name || '',
            description: cardData.description || '',
            personality: cardData.personality || '',
            scenario: cardData.scenario || '',
            first_mes: cardData.first_mes || '',
            mes_example: cardData.mes_example || '',
            creator_notes: cardData.creator_notes || ''
          }, _tab);
        } catch (_acErr) { logWarn('addUserMsg.accepted', _acErr); }
        saveToStorage();
      }

      // ===== Agent 理解阶段：选项条渲染 / 选项发送 / 清理 =====
      function renderAgentOptionsBar(options) {
        const bar = doc.getElementById('agentOptionsBar');
        if (!bar) return;
        if (!options || options.length === 0) {
          bar.style.display = 'none';
          bar.innerHTML = '';
          return;
        }
        let h = '<div class="opt-hint">' + svgIcon('target', 14) + ' 请选择下一步方向（或直接在下方输入你的想法）：</div>';
        options.forEach(function(opt, i) {
          // ⚠️不要在此处根据 isGenerating 写死 disabled：本函数在 callAIChat 的 try 块内被调用，
          // 此刻 finally 尚未执行、isGenerating 仍为 true——会导致按钮一渲染就永久置灰、无法点击。
          // 可点性统一交给下方 click 事件里的运行时守卫判断。
          h += '<button class="opt-btn" data-opt-index="' + i + '">' +
            '<span class="opt-num">' + (i + 1) + '</span>' +
            '<span class="opt-text">' + escHtml(opt) + '</span>' +
            '</button>';
        });
        h += '<button class="opt-cancel" data-opt-cancel title="取消选择，重新描述需求">× 取消选择</button>';
        bar.innerHTML = h;
        bar.style.display = 'flex';
        // 绑定选项点击
        bar.querySelectorAll('.opt-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            if (isGenerating) { showToast('AI 正在处理中，请稍候', 'warning'); return; }
            const idx = parseInt(this.getAttribute('data-opt-index'), 10);
            const chosen = options[idx];
            if (chosen) sendAgentChoice(chosen);
          });
        });
        const cancelBtn = bar.querySelector('[data-opt-cancel]');
        if (cancelBtn) {
          cancelBtn.addEventListener('click', function() {
            _pendingAgentOptions = null;
            renderAgentOptionsBar(null);
            showToast('已取消选择，可重新描述你的需求', 'info');
          });
        }
        // 滚动到可见
        try { bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
      }

      function sendAgentChoice(choiceText) {
        if (!choiceText || isGenerating) return;
        const input = doc.getElementById('chatInput');
        if (!input) return;
        // 用户画像：记录用户在 Agent 理解阶段选择了哪个方向
        try { UserProfile.recordAgentChoice(choiceText); } catch (_) {}
        // 清空选项条 & 状态
        _pendingAgentOptions = null;
        renderAgentOptionsBar(null);
        // 用前缀标记"这是用户对理解阶段的确认"，供 buildPrompt 判断进入确认阶段
        input.value = '我选择：' + choiceText;
        updateCharCount && updateCharCount();
        updateSendBtnPulse && updateSendBtnPulse();
        handleSend();
      }

      function clearAgentOptionsBar() {
        _pendingAgentOptions = null;
        renderAgentOptionsBar(null);
      }
      // ============================================================================
      // 统一文件导出辅助：优先下载（父窗口触发，绕过酒馆下载拦截），
      // 同时写剪贴板作为兜底，最差降级到手动复制模态框
      // ============================================================================
      function _exportTextFile(filename, content, mime) {
        const pDoc = (window.parent && window.parent.document) ? window.parent.document : doc;
        const pWin = (window.parent && window.parent.window) ? window.parent.window : (doc.defaultView || window);
        let downloaded = false;
        let copied = false;

        // 1) 优先在【父窗口】创建 a 元素触发下载
        //    （iframe 内 srcdoc/about:blank 下载常被浏览器或酒馆拦截）
        try {
          const BlobCtor = pWin.Blob || Blob;
          const URLCtor = pWin.URL || URL;
          const blob = new BlobCtor([content], { type: mime + ';charset=utf-8' });
          const url = URLCtor.createObjectURL(blob);
          const a = pDoc.createElement('a');
          a.href = url;
          a.download = filename;
          a.rel = 'noopener';
          a.style.cssText = 'position:fixed;left:-99999px;top:0;';
          pDoc.body.appendChild(a);
          try {
            const MouseEventCtor = pWin.MouseEvent || MouseEvent;
            // ⚠️ bubbles:false —— 绕过酒馆在 document 上委托的下载拦截器
            a.dispatchEvent(new MouseEventCtor('click', {
              bubbles: false,
              cancelable: true,
              view: pWin
            }));
          } catch (_me) {
            a.click();
          }
          downloaded = true;
          setTimeout(function() {
            try { a.remove(); } catch (_) {}
            try { URLCtor.revokeObjectURL(url); } catch (_) {}
          }, 5000);
        } catch (_dlErr) {
          // 父窗口下载失败：回退到 iframe 内下载
          try {
            const blob2 = new Blob([content], { type: mime + ';charset=utf-8' });
            const url2 = URL.createObjectURL(blob2);
            const a2 = doc.createElement('a');
            a2.href = url2;
            a2.download = filename;
            doc.body.appendChild(a2);
            a2.click();
            doc.body.removeChild(a2);
            setTimeout(function() {
              try { URL.revokeObjectURL(url2); } catch (_) {}
            }, 5000);
            downloaded = true;
          } catch (_e2) {
            logWarn('_exportTextFile.download', _e2);
          }
        }

        // 2) 同时写剪贴板，作为兜底（无论下载是否成功，用户都能粘贴拿到内容）
        // ⚠️writeText 异步返回，不参与同步返回值判断：成功仅作为"额外加分"异步提示，失败静默
        let _asyncCopied = false;
        try {
          const nav = pWin.navigator || (typeof navigator !== 'undefined' ? navigator : null);
          if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
            nav.clipboard.writeText(content).then(function() {
              _asyncCopied = true;
              try { showToast('📋 已复制到剪贴板（异步生效）', 'success', 2500); } catch (_) {}
            }, function() {});
          }
        } catch (_cpErr) { logWarn('_exportTextFile.cp', _cpErr); }

        // 剪贴板 API 不可用 / 未授权：用 execCommand 兜底
        if (!copied) {
          try {
            const ta = doc.createElement('textarea');
            ta.value = content;
            ta.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0;';
            doc.body.appendChild(ta);
            ta.select();
            try { ta.setSelectionRange(0, ta.value.length); } catch (_) {}
            const ok = doc.execCommand && doc.execCommand('copy');
            doc.body.removeChild(ta);
            copied = !!ok;
          } catch (_e3) { logWarn('_exportTextFile.execCopy', _e3); }
        }

        return { downloaded: downloaded, copied: copied || _asyncCopied };
      }

      // 手动复制兜底模态框：下载与剪贴板都失败时使用
      function _showExportFallbackModal(filename, content) {
        const _pWin = (window.parent && window.parent.window) ? window.parent.window : (doc.defaultView || window);
        const modal = doc.createElement('div');
        modal.className = 'modal';
        modal.style.zIndex = '100002';
        modal.innerHTML =
          '<div class="modal-content" style="max-width:720px">' +
          '<h3 style="color:var(--accent-deep);margin-bottom:6px;font-size:1em;display:inline-flex;align-items:center;gap:7px">' +
          svgIcon('fileExport', 16) + ' 导出内容（请手动复制保存）</h3>' +
          '<p style="font-size:.78em;color:var(--muted);margin-bottom:8px">浏览器/酒馆拦截了自动下载。请全选下方内容复制，或点「复制到剪贴板」后粘贴到文本文件，保存为 <b>' + escHtml(filename) + '</b></p>' +
          '<textarea id="exportFallbackText" readonly style="width:100%;height:320px;font-family:var(--font-mono);font-size:.72em;padding:10px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface-soft);color:var(--ink);resize:vertical;box-sizing:border-box"></textarea>' +
          '<div class="modal-actions">' +
          '<button class="btn btn-ghost" id="exportFallbackCopyBtn">' + svgIcon('clipboard', 14) + ' 复制到剪贴板</button>' +
          '<button class="btn btn-primary" id="exportFallbackCloseBtn">关闭</button>' +
          '</div></div>';
        doc.body.appendChild(modal);
        const ta = doc.getElementById('exportFallbackText');
        if (ta) ta.value = content;
        modal.addEventListener('click', function(e) {
          if (e.target === modal) modal.remove();
        });
        const closeBtn = doc.getElementById('exportFallbackCloseBtn');
        if (closeBtn) closeBtn.addEventListener('click', function() { modal.remove(); });
        const copyBtn = doc.getElementById('exportFallbackCopyBtn');
        if (copyBtn) copyBtn.addEventListener('click', function() {
          let ok = false;
          try {
            if (ta) {
              ta.focus();
              ta.select();
              try { ta.setSelectionRange(0, ta.value.length); } catch (_) {}
            }
            ok = !!(doc.execCommand && doc.execCommand('copy'));
          } catch (_) {}
          if (!ok) {
            try {
              const nav = _pWin.navigator || (typeof navigator !== 'undefined' ? navigator : null);
              if (nav && nav.clipboard && nav.clipboard.writeText) {
                nav.clipboard.writeText(content).then(function() {
                  showToast('✅ 已复制到剪贴板', 'success');
                }, function() {
                  showToast('复制失败，请手动全选下方文本复制', 'warning');
                });
                return;
              }
            } catch (_) {}
          }
          if (ok) showToast('✅ 已复制到剪贴板', 'success');
          else showToast('复制失败，请手动全选下方文本复制', 'warning');
        });
        try { if (ta) { ta.focus(); ta.select(); } } catch (_) {}
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
          const safeName = cardData.name.trim().replace(/[\\/:*?"<>|]/g, '_');
          const filename = '角色卡_' + safeName + '_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
          const _res = _exportTextFile(filename, json, 'application/json');
          try { _collectAcceptedSamples('export-json'); } catch (_ea) { logWarn('exportCardJson.accepted', _ea); }
          // ★ 修复 Bug4：只有 export-json 白名单触发分析
          try { _maybeAutoAnalyze('export-json'); } catch (_) {}
          if (_res.downloaded || _res.copied) {
            showToast('✅ 角色卡JSON已导出' + (_res.copied ? '（同时已复制到剪贴板，若浏览器拦截下载可直接粘贴保存）' : ''), 'success', 6000);
          } else {
            _showExportFallbackModal(filename, json);
          }
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
            frontendMessages: frontendMessages,
            progress: progress,
            moduleProgress: moduleProgress
          };
          const json = JSON.stringify(log, null, 2);
          const filename = 'chatlog_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
          const _res = _exportTextFile(filename, json, 'application/json');
          if (_res.downloaded || _res.copied) {
            showToast('✅ 已导出聊天记录' + (_res.copied ? '（同时已复制到剪贴板）' : ''), 'success', 6000);
          } else {
            _showExportFallbackModal(filename, json);
          }
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
            bubbleHtml = renderMessageSections(sections, msgIdx);
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
        mvu: {},
        frontend: {}
      };

      // ===== AI消息索引 → 本次变更摘要（供撤回/重试时作为反馈素材）=====
      const _msgChangeMap = {};
      function buildChangeSummary(diff, fieldUpdates, fieldNames) {
        if (!diff && !fieldUpdates) return null;
        const entries = [];
        if (diff) {
          (diff.added || []).forEach(function(c) {
            entries.push({ action: 'add', comment: String(c).slice(0, 60) });
          });
          (diff.updated || []).forEach(function(u) {
            if (u && u.comment != null) {
              entries.push({ action: 'update', comment: String(u.comment).slice(0, 60), addLines: u.addLines || 0, delLines: u.delLines || 0 });
            }
          });
          (diff.deleted || []).forEach(function(c) {
            entries.push({ action: 'delete', comment: String(c).slice(0, 60) });
          });
        }
        if (entries.length === 0 && !fieldUpdates) return null;
        return {
          entries: entries.slice(0, 15),
          fieldUpdates: fieldUpdates || 0,
          fieldNames: Array.isArray(fieldNames) ? fieldNames.slice(0, 10) : [],
          totalEntries: entries.length,
          truncated: entries.length > 15
        };
      }

      function _snapTabKey() {
        if (activeTab === 'frontend') return 'frontend';
        return (activeTab === 'mvu') ? 'mvu' : 'card';
      }

      // ===== 从快照与当前 cardData 构造"AI产物 vs 用户基线"对照样本 =====
      // 行级 diff：只保留前后版本不一致的行，避免长条目改动点被 1500 字截断吞掉
      function _lineDiff(before, after) {
        const bl = String(before || '').split(/\r?\n/);
        const al = String(after || '').split(/\r?\n/);
        const bSet = {}, aSet = {};
        bl.forEach(function(l) { if (l.trim()) bSet[l.trim()] = true; });
        al.forEach(function(l) { if (l.trim()) aSet[l.trim()] = true; });
        const onlyBefore = [], onlyAfter = [];
        bl.forEach(function(l) { const t = l.trim(); if (t && !aSet[t]) onlyBefore.push(l); });
        al.forEach(function(l) { const t = l.trim(); if (t && !bSet[t]) onlyAfter.push(l); });
        return { before: onlyBefore.join('\n'), after: onlyAfter.join('\n') };
      }
      function buildEntryPairsFromSnapshot(snap, currentEntries, semantics) {
        if (!snap) return [];
        const sem = semantics || 'baseline-vs-ai';
        const beforeMap = {};
        const beforeEntries = (snap.character_book && snap.character_book.entries) || [];
        beforeEntries.forEach(function(e) {
          if (e && e.comment) beforeMap[String(e.comment)] = String(e.content || '');
        });
        const afterMap = {};
        (currentEntries || []).forEach(function(e) {
          if (e && e.comment) afterMap[String(e.comment)] = String(e.content || '');
        });
        const pairs = [];
        Object.keys(beforeMap).forEach(function(k) {
          const before = beforeMap[k];
          const after = (k in afterMap) ? afterMap[k] : '';
          if (before === after) return;
          if (k in afterMap) {
            const _d = _lineDiff(before, after);
            pairs.push({
              name: k, action: 'update', semantics: sem,
              before: (_d.before || before).slice(0, 1500),
              after: (_d.after || after).slice(0, 1500)
            });
          } else {
            pairs.push({ name: k, action: 'delete', before: before, after: '', semantics: sem });
          }
        });
        Object.keys(afterMap).forEach(function(k) {
          if (!(k in beforeMap)) {
            pairs.push({ name: k, action: 'add', before: '', after: afterMap[k], semantics: sem });
          }
        });
        return pairs;
      }
      function buildFieldPairsFromSnapshot(snap, cd, semantics) {
        if (!snap || !cd) return [];
        const sem = semantics || 'baseline-vs-ai';
        const fields = ['name','description','personality','scenario','first_mes','mes_example','creator_notes'];
        const out = [];
        fields.forEach(function(f) {
          const before = String(snap[f] || '');
          const after = String(cd[f] || '');
          if (before === after) return;
          out.push({ name: '顶层字段·' + f, action: before && after ? 'update' : (after ? 'add' : 'delete'), before: before, after: after, semantics: sem });
        });
        const bg = (snap.alternate_greetings || []).join('\n---\n');
        const ag = (cd.alternate_greetings || []).join('\n---\n');
        if (bg !== ag) {
          out.push({ name: '顶层字段·alternate_greetings', action: bg && ag ? 'update' : (ag ? 'add' : 'delete'), before: bg, after: ag, semantics: sem });
        }
        return out;
      }
      function _pickSnapshotFor(aiIdx) {
        try {
          let snap = cardDataSnapshots[_snapTabKey()][aiIdx];
          if (!snap) {
            const _k = 'szxq_snap_' + _snapTabKey() + '_' + aiIdx;
            const _r = localStorage.getItem(_k);
            if (_r) snap = JSON.parse(_r);
          }
          return snap;
        } catch (_) { return null; }
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
          // 持久化兜底：写入 localStorage（刷新后仍可撤回；失败静默，不影响主流程）
          try {
            const _k = 'szxq_snap_' + _snapTabKey() + '_' + aiMsgIndex;
            localStorage.setItem(_k, JSON.stringify(clone));
          } catch (_ePersist) { /* 超配额忽略 */ }
        } catch (e) {
          console.warn('[snapshot] save failed:', e && e.message);
        }
      }

      function restoreCardDataSnapshot(aiMsgIndex) {
        let snap = cardDataSnapshots[_snapTabKey()][aiMsgIndex];
        // 内存没有 → 尝试 localStorage（刷新后兜底）
        if (!snap) {
          try {
            const _k = 'szxq_snap_' + _snapTabKey() + '_' + aiMsgIndex;
            const _raw = localStorage.getItem(_k);
            if (_raw) snap = JSON.parse(_raw);
          } catch (_eL) { snap = null; }
          if (!snap) return false;
        }
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
        // 同步清理 localStorage 中该 tab 序号更大的快照
        try {
          const _ns = 'szxq_snap_' + tab + '_';
          const _toDel = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.indexOf(_ns) === 0) {
              const idx = parseInt(key.slice(_ns.length), 10);
              if (!isNaN(idx) && idx > msgIndex) _toDel.push(key);
            }
          }
          _toDel.forEach(function(k) { localStorage.removeItem(k); });
        } catch (_eC) {}
        // 同步清理 _msgChangeMap（避免长会话无限增长）
        for (let k in _msgChangeMap) {
          if (_msgChangeMap.hasOwnProperty(k) && Number(k) > msgIndex) delete _msgChangeMap[k];
        }
        // 硬上限：保留最近 300 条（超过时删最早的键）
        const _mcKeys = Object.keys(_msgChangeMap).map(Number).sort(function(a, b) { return a - b; });
        if (_mcKeys.length > 300) {
          for (let _i = 0; _i < _mcKeys.length - 300; _i++) delete _msgChangeMap[_mcKeys[_i]];
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

      // 迭代1·E4：清理 cpSectionStates 中索引超过 maxKeepIdx 的孤儿键（消息截断后调用）
      function _clearCpSectionStatesAfter(maxKeepIdx) {
        try {
          Object.keys(cpSectionStates).forEach(function(k) {
            const m = /^m(\d+)-/.exec(k);
            if (m && parseInt(m[1], 10) > maxKeepIdx) delete cpSectionStates[k];
          });
        } catch (_eClearCp) {}
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
        // 迭代1·E4：清理超出当前消息数的 cpSectionStates 孤儿键
        _clearCpSectionStatesAfter(msgs.length - 1);
        // 刷新关联UI
        try {
          markDirty('preview', 'ctx', 'actions');
        } catch (_) {}
      }

      // ===== 撤回：移除某条AI消息 + 回滚其cardData修改 =====
      function revokeAIMessage(aiIdx, opts) {
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
        // 迭代1·H1：silent 模式（Ctrl+Z / 快捷键）跳过 confirm 弹窗
        if (!opts || !opts.silent) {
          if (!confirm(confirmMsg)) return;
        }
        // 回滚cardData到该AI消息应用修改前的快照
        // 关键：在 restore 之前，把"AI产物 vs 用户基线"对照抓下来
        let _entryPairs = [];
        try {
          const _snap = _pickSnapshotFor(aiIdx) || _lastAcceptedSnapshot;
          if (_snap) {
            _entryPairs = buildEntryPairsFromSnapshot(_snap, (cardData.character_book || {}).entries || [], 'baseline-vs-ai')
              .concat(buildFieldPairsFromSnapshot(_snap, cardData, 'baseline-vs-ai'));
          }
        } catch (_ePair) { logWarn('buildEntryPairs', _ePair); }

        // 反馈：优先用"卡片实际改动摘要"，AI回复文本只留片段
        try {
          const _revokedReply = msgs[aiIdx] ? String(msgs[aiIdx].content || '') : '';
          const _changeSummary = _msgChangeMap[aiIdx] || null;
          if (_revokedReply || _changeSummary || _entryPairs.length) {
            UserProfile.recordFeedback({
              kind: 'revoke',
              changeSummary: _changeSummary,
              entryPairs: _entryPairs,
              aiReply: _revokedReply.slice(0, 1500)
            });
          }
          delete _msgChangeMap[aiIdx];
        } catch (_fb) {}
        const ok = restoreCardDataSnapshot(aiIdx);
        // 注意：撤回时不主动回填 acceptedContent——保持为空，等用户真正"导出/写入/关闭"时
        // 由 _collectAcceptedSamples 用当时的真实 cardData 回填，避免把"回滚到的旧版"误当成用户要的版本。
        // 截断消息：保留到aiIdx（不含），即移除该AI消息及其后所有（仅AI）
        msgs.length = aiIdx;
        clearSnapshotsAfter(aiIdx - 1);
        _clearCpSectionStatesAfter(aiIdx - 1);   // 迭代1·E4
        saveToStorage();
        progress = calcProgress();
        rerenderChatMessages();
        try { UserProfile.recordRevoke(aiIdx, _snapTabKey()); } catch (_) {}
        showToast(ok ? '✅ 已撤回AI回复并回滚修改' : '⚠️ 已撤回AI回复（无快照可回滚，角色卡未变更）', ok ? 'success' : 'warning');
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
        // 抓取：用最早的快照（aiIdx）作为基线，当前 cardData 作为产物
        let _entryPairs = [];
        try {
          const _snap = _pickSnapshotFor(aiIdx) || _lastAcceptedSnapshot;
          if (_snap) {
            _entryPairs = buildEntryPairsFromSnapshot(_snap, (cardData.character_book || {}).entries || [], 'baseline-vs-ai')
              .concat(buildFieldPairsFromSnapshot(_snap, cardData, 'baseline-vs-ai'));
          }
        } catch (_ePair) { logWarn('buildEntryPairs', _ePair); }

        // 反馈：聚合这一批所有被撤回的 AI 修改（不止第一条）
        try {
          const _aiIdxForFb = userIdx + 1;
          const _batchSummaries = [];
          const _firstReply = (_aiIdxForFb < msgs.length && msgs[_aiIdxForFb].role === 'assistant') ?
            String(msgs[_aiIdxForFb].content || '').slice(0, 1500) : '';
          for (let _bi = _aiIdxForFb; _bi < msgs.length; _bi++) {
            if (msgs[_bi].role === 'assistant' && _msgChangeMap[_bi]) {
              _batchSummaries.push(_msgChangeMap[_bi]);
            }
          }
          if (_batchSummaries.length > 0 || _entryPairs.length > 0) {
            UserProfile.recordFeedback({
              kind: 'revoke',
              changeSummary: _batchSummaries.length > 0 ? { batch: _batchSummaries.slice(0, 5), batchCount: _batchSummaries.length } : null,
              entryPairs: _entryPairs,
              aiReply: _firstReply
            });
          } else if (_firstReply) {
            UserProfile.recordFeedback({ kind: 'revoke', changeSummary: null, aiReply: _firstReply });
          }
          for (let _ci = _aiIdxForFb; _ci < msgs.length; _ci++) delete _msgChangeMap[_ci];
        } catch (_fb) {}
        let ok = false;
        if (aiIdx < msgs.length) {
          ok = restoreCardDataSnapshot(aiIdx);
        }
        // 截断消息：保留到userIdx+1（含用户消息，移除其后所有）
        msgs.length = userIdx + 1;
        clearSnapshotsAfter(userIdx);
        _clearCpSectionStatesAfter(userIdx);   // 迭代1·E4
        saveToStorage();
        progress = calcProgress();
        rerenderChatMessages();
        try { UserProfile.recordRevoke(userIdx, _snapTabKey()); } catch (_) {}
        showToast(ok ? '✅ 已撤回此条之后所有AI消息并回滚修改' : '⚠️ 已撤回此条之后所有AI消息（无快照可回滚，角色卡未变更）', ok ? 'success' : 'warning');
      }

      // ===== 重新生成：某条AI消息（撤回该AI回复后重新调用AI）=====
      function regenerateAIMessage(aiIdx, opts) {
        const msgs = getCurrentMessages();
        if (aiIdx < 0 || aiIdx >= msgs.length || msgs[aiIdx].role !== 'assistant') {
          showToast('无法重新生成：该消息不是AI回复', 'warning');
          return;
        }
        if (isGenerating) {
          showToast('AI正在生成中，请稍候', 'warning');
          return;
        }
        // （已删除"需要前一条用户消息"校验：无用户提问也可以重新生成，AI 会基于卡片现状 + 已有历史重建上下文）
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
        if (aiCountAfter > 0 && !(opts && opts.silent) && !confirm('此条AI之后还有 ' + aiCountAfter + ' 条AI回复，重新生成会将这些AI回复一并移除并重建新回答。确定继续？')) return;
        // 用户画像：这是一次重试（摩擦信号）
        try { UserProfile.recordRetry(aiIdx, _snapTabKey()); } catch (_) {}
        // 抓对照
        let _entryPairs = [];
        try {
          const _snap = _pickSnapshotFor(aiIdx) || _lastAcceptedSnapshot;
          if (_snap) {
            _entryPairs = buildEntryPairsFromSnapshot(_snap, (cardData.character_book || {}).entries || [], 'baseline-vs-ai')
              .concat(buildFieldPairsFromSnapshot(_snap, cardData, 'baseline-vs-ai'));
          }
        } catch (_ePair) {}
        // ★反馈语料：记录被重试的旧 AI 回复
        try {
          const _oldReply = msgs[aiIdx] ? String(msgs[aiIdx].content || '') : '';
          const _changeSummary = _msgChangeMap[aiIdx] || null;
          if (_oldReply || _changeSummary || _entryPairs.length) {
            UserProfile.recordFeedback({
              kind: 'retry',
              changeSummary: _changeSummary,
              entryPairs: _entryPairs,
              aiReply: _oldReply.slice(0, 1500)
            });
          }
          delete _msgChangeMap[aiIdx];
        } catch (_) {}
        // 回滚该AI消息的cardData修改 + 截断到aiIdx（移除该AI消息及其后所有AI）
        restoreCardDataSnapshot(aiIdx);
        msgs.length = aiIdx;
        clearSnapshotsAfter(aiIdx - 1);
        _clearCpSectionStatesAfter(aiIdx - 1);   // 迭代1·E4
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
        // 抓对照（基线 = 该用户消息之前的第一条快照）
        let _entryPairs2 = [];
        try {
          const _snap2 = _pickSnapshotFor(userIdx + 1) || _lastAcceptedSnapshot;
          if (_snap2) {
            _entryPairs2 = buildEntryPairsFromSnapshot(_snap2, (cardData.character_book || {}).entries || [], 'baseline-vs-ai')
              .concat(buildFieldPairsFromSnapshot(_snap2, cardData, 'baseline-vs-ai'));
          }
        } catch (_ePair2) {}
        // ★反馈语料：记录被重做的旧 AI 回答
        try {
          const _aiIdxForFb2 = userIdx + 1;
          const _oldReply2 = (_aiIdxForFb2 < msgs.length && msgs[_aiIdxForFb2].role === 'assistant') ?
            String(msgs[_aiIdxForFb2].content || '').slice(0, 1500) : '';
          const _changeSummary2 = _msgChangeMap[_aiIdxForFb2] || null;
          if (_oldReply2 || _changeSummary2 || _entryPairs2.length) {
            UserProfile.recordFeedback({
              kind: 'retry',
              changeSummary: _changeSummary2,
              entryPairs: _entryPairs2,
              aiReply: _oldReply2
            });
            try { UserProfile.recordRetry(_aiIdxForFb2, _snapTabKey()); } catch (_) {}
          }
          delete _msgChangeMap[_aiIdxForFb2];
        } catch (_fb) {}
        if (aiIdx < msgs.length && msgs[aiIdx].role === 'assistant') {
          // 存在AI回答：回滚 + 截断到aiIdx（移除其及之后所有）
          restoreCardDataSnapshot(aiIdx);
          msgs.length = aiIdx;
          clearSnapshotsAfter(userIdx);
          _clearCpSectionStatesAfter(userIdx);   // 迭代1·E4
        } else {
          // 没有AI回答：截断到userIdx+1（保留该用户消息）
          msgs.length = userIdx + 1;
          clearSnapshotsAfter(userIdx);
          _clearCpSectionStatesAfter(userIdx);   // 迭代1·E4
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
          _clearCpSectionStatesAfter(userIdx);   // 迭代1·E4
          // 3. 原地修改该用户消息内容
          msgs[userIdx].content = newText;
          // 正/负样本：用户重写自己的提问 = 对之前 AI 回答的不满信号
          try {
            UserProfile.recordFeedback({
              kind: 'user-rewrite',
              changeSummary: null,
              aiReply: '',
              userEdit: newText.slice(0, 400)
            });
          } catch (_) {}
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
          // ★反馈语料：AI 消息被人工修改 → 记录"AI原产出 vs 用户改成"的 diff
          if (isAI && origText && origText !== newText) {
            try {
              UserProfile.recordFeedback({
                kind: 'edit',
                aiReply: origText,
                userEdit: newText,
                entryPairs: [{ name: '（用户手改整条消息）', action: 'update', before: origText, after: newText, semantics: 'ai-vs-user' }]
              });
            } catch (_) {}
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

      function renderMessageSections(sections, msgIdx) {
        // 🐛修复：单段长文本（>200字）也用折叠包裹，让用户可以缩放
        // 之前只有多段才折叠，导致第一句话（欢迎语）等单段长文本无法缩放
        if (!sections || (sections.length === 1 && sections[0].type === 'content' && sections[0].content.length <= 200)) {
          return fmtBubble(sections ? sections[0].content : '');
        }
        let html = '';
        sections.forEach(function(sec, idx) {
          // 迭代1·E4：stateKey 由 msgIdx 决定（不再用随机 msgId），rerenderChatMessages 重放后仍能命中
          const stateKey = 'm' + (msgIdx == null ? 'x' : msgIdx) + '-' + idx;
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
          } else if (sec.type === 'code' && sec.lang === 'execnotes') {
            icon = '📋';
            label = '执行结果';
            cls = 'cp-section-execnotes';
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
            if (sec.type === 'code' && sec.lang === 'execnotes') {
              // 按行渲染：失败/警告行置顶并加红/琥珀背景，成功行绿色
              const _lines = String(sec.content || '').split(/\r?\n/);
              let _bodyHtml = '';
              _lines.forEach(function(ln) {
                const _t = ln.trim();
                if (!_t) { _bodyHtml += '<div style="height:4px"></div>'; return; }
                if (/^❌|失败|未生效|未命中|未识别|校验失败/.test(_t)) {
                  _bodyHtml += '<div class="exec-line exec-fail">' + escHtml(_t) + '</div>';
                } else if (/^✅/.test(_t)) {
                  _bodyHtml += '<div class="exec-line exec-ok">' + escHtml(_t) + '</div>';
                } else if (/^⚠️|警告/.test(_t)) {
                  _bodyHtml += '<div class="exec-line exec-warn">' + escHtml(_t) + '</div>';
                } else if (/^【|^(❌|✅)\s|项）：$/.test(_t)) {
                  _bodyHtml += '<div class="exec-line exec-title">' + escHtml(_t) + '</div>';
                } else {
                  _bodyHtml += '<div class="exec-line">' + escHtml(_t) + '</div>';
                }
              });
              html += '<div class="cp-section-body">' + _bodyHtml + '</div>';
            } else if (sec.type === 'code' && (sec.lang === 'html' || (sec.lang === '' && /<!doctype|<html[\s>]|<body[\s>]|<head[\s>]/i.test(sec.content || '')))) {
              // ★ HTML 代码块：直接渲染成 iframe（状态栏 / 前端界面 等），而不是显示源码文本
              const _rendered = renderHtmlToIframe(sec.content);
              if (_rendered) {
                html += '<div class="cp-section-body">' + _rendered + '</div>';
              } else {
                // 内容过短 / 渲染失败 → 回退显示源码，防止丢内容
                const esc = sec.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                html += '<div class="cp-section-body">' + esc + '</div>';
              }
            } else if (sec.type === 'code') {
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
                const msgIdx = parseInt(msgEl.getAttribute('data-msg-index'), 10);
                const bubble = msgEl.querySelector('.bubble');
                const raw = bubble ? bubble.getAttribute('data-raw-text') : '';
                if (bubble && raw) {
                  const secs = parseMessageSections(raw);
                  bubble.innerHTML = renderMessageSections(secs, isNaN(msgIdx) ? -1 : msgIdx);
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
            // ⚠️修复：不再把字面 \n 还原成换行——前端模板的 split(/\n\s*\n/) 依赖字面转义，iframe 内直接原样渲染（\n 是合法 JS 转义）
            h = h.replace(/```html\s*\n([\s\S]*?)```/gi, function(_, code) {
              iframes.push(renderHtmlToIframe(code));
              return '\u0000HTML_IFRAME_' + (iframes.length - 1) + '\u0000';
            });
            // 2) 检测消息中直接包含的完整HTML文档（非代码块格式）
            h = h.replace(/(?:html\s*[\n\\n]+)?(<!doctype html>[\s\S]*?<\/html>)/gi, function(_, htmlCode) {
              let code = htmlCode;
              // 仅当是 JSON 转义字符串（含 \"）时才还原转义，普通代码保持字面 \n
              if (code.indexOf('\\"') >= 0) {
                if (code.indexOf('\\n') >= 0) code = code.replace(/\\n/g, '\n');
                code = code.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
              }
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
            // 链接 [文本](url) —— 必须在行内 code 之前处理，避免被反引号规则吃掉
            h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
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
        const escapedSrcdoc = htmlCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return '<iframe class="html-render-frame" loading="lazy" srcdoc="' + escapedSrcdoc + '" sandbox="allow-scripts" style="width:100%;min-height:280px;border:1px solid #e6dfd0;border-radius:6px;background:transparent"></iframe>';
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
          '      ready: function(fn) { try { fn(); } catch(e) {} return this; },\n' +
          '      on: function(ev, fn) { if (el && el.addEventListener) { try { el.addEventListener(ev, fn); } catch(e) {} } return this; },\n' +
          '      off: function(ev, fn) { if (el && el.removeEventListener) { try { el.removeEventListener(ev, fn); } catch(e) {} } return this; },\n' +
          '      css: function() { return this; },\n' +
          '      attr: function(k, v) { if (el) { if (v === undefined) return el.getAttribute(k); try { el.setAttribute(k, v); } catch(e) {} } return this; },\n' +
          '      append: function(c) { if (el) { try { el.insertAdjacentHTML("beforeend", c); } catch(e) {} } return this; },\n' +
          '      prepend: function(c) { if (el) { try { el.insertAdjacentHTML("afterbegin", c); } catch(e) {} } return this; },\n' +
          '      find: function(s) { return _miniJQ(el ? el.querySelector(s) : null); },\n' +
          '      closest: function(s) { return _miniJQ(el && el.closest ? el.closest(s) : null); },\n' +
          '      parent: function() { return _miniJQ(el ? el.parentElement : null); },\n' +
          '      children: function() { return _miniJQ(el ? el.firstElementChild : null); },\n' +
          '      val: function(v) { if (el) { if (v === undefined) return el.value; el.value = v; } return this; },\n' +
          '      each: function(fn) { if (el) { try { fn.call(el, 0, el); } catch(e) {} } return this; },\n' +
          '      hide: function() { if (el) el.style.display = "none"; return this; },\n' +
          '      show: function() { if (el) el.style.display = ""; return this; },\n' +
          '      toggle: function() { if (el) el.style.display = (el.style.display === "none") ? "" : "none"; return this; },\n' +
          '      data: function(k, v) { if (el && el.dataset) { if (v === undefined) return el.dataset[k]; el.dataset[k] = v; } return this; }\n' +
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
        return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      }

      function escAttr(s) {
        if (!s) return '';
        // ★修复#18：补 ' → &#39;（统一 5 字符转义，与 escHtml 一致）
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
      }

      let lastUserInput = '';
      // ============================================================================
      // SECTION 10 聊天消息发送 + AI 写卡流程主循环（callAIChat）
      // ============================================================================

      // ============================================================================
      // ========== Agent自主执行循环（Agent Loop · 真·Agent核心） ==========
      // 流程：AI输出 <agent_plan> 计划块 → 写卡器解析 → 自动循环执行每一步
      //（每步=一次完整AI调用+操作块/HTML自动应用）→ 全部完成汇报，用户可随时停止
      // 控制标记（AI在每步回复末尾输出）：<agent:next> 还有后续步骤 / <agent:done> 全部完成 / <agent:skip> 本步跳过
      // ============================================================================
      // 注：计划块解析 parseAgentPlan / 步数上限 AGENT_LOOP_MAX_STEPS 已提升至 IIFE 顶层（parseAgentPlan 无闭包依赖）

      // ===== 构造Agent执行指令（agentLoop每步传入buildPrompt第4参数）=====
      // ReAct核心：注入上一步执行结果观察 + 决策规则（修正失败→继续/重规划），让AI基于反馈动态决策
      function buildAgentDirective(stepIdx) {
        if (!agentPlan || !agentPlan.steps[stepIdx]) return null;
        let planText = '用户总目标：' + agentPlan.goal + '\n执行计划（✅已完成 / ▫️待执行）：\n';
        agentPlan.steps.forEach(function(s, i) {
          planText += (s.done ? '✅' : '▫️') + ' 第' + (i + 1) + '步：' + s.desc + '\n';
        });
        let d = '';
        d += '你正在按上述计划自主创作（ReAct模式：行动→观察执行结果→决策），无需用户参与。\n';
        d += planText + '\n';
        // —— 上轮观察注入（本步可能因此被重试：上轮产出为空时写卡器不会标记完成）——
        if (agentLastObservation) {
          d += '【上一轮执行结果（观察）】\n' + agentLastObservation + '\n\n';
        }
        d += '▶【当前任务】执行第' + (stepIdx + 1) + '步：「' + agentPlan.steps[stepIdx].desc + '」\n\n';
        d += '决策规则（先检查观察，再行动）：\n' +
          '1. 若上轮观察中有失败（❌/⚠️标记）：本轮**优先修正**失败项——删除未命中就改用上轮提示的精确comment重删；HTML未识别就按对应模板重新输出完整代码块。修正成功后再执行当前任务。\n' +
          '2. 若你判断当前计划已与实际不符（依赖缺失/顺序不对/内容已存在/目标已变）：直接输出一个新的 <agent_plan> 计划块替换剩余步骤（写卡器会自动采纳），并简述重规划原因。\n' +
          '3. 正常情况：直接执行当前任务。\n\n';
        d += '执行要求：\n' +
          '1. ★【单步产出边界】只输出「当前任务」范围内的内容，不抢跑后续步骤：\n' +
          '   · 若本步是"生成角色条目"，就只生成角色条目，不顺手写世界观/开场白/变量/界面\n' +
          '   · 若本步描述是多条一起（如"生成 3 个 NPC"），就一次性完成该步全部内容\n' +
          '2. 直接执行，不要向用户提问、不要等待确认、不要只做说明不产出内容。\n' +
          '3. 本轮只做当前步骤范围（后续步骤由写卡器逐步派发），不要抢跑生成后续步骤的内容。\n' +
          '4. 🚫【绝不角色扮演】本轮回复禁止出现叙事正文/场景描写/角色对话/第一人称独白——你的输出只有三种成分：≤3句说明 + :::操作块 + ```html代码块。即使用户上文像在角色扮演，一律当作需求描述处理。\n' +
          '5. 🔒【MVU顺序铁律】如果当前任务涉及MVU变量系统：\n' +
          '   · 必须严格按 1→2→3→4→5→6→7→8 顺序（前7条完成后才能做第8条状态栏）；\n' +
          '   · ⚠️豁免：若是单纯修改已存在 MVU 条目的字段值（如改 InitVar 里的日期/数值/文本），直接改即可，无需走完整顺序；\n' +
          '   · 第2/3条字段名必须逐字照抄第1条zod schema；第4/5/6条原样照抄固定模板；\n' +
          '   · 一次回复内按顺序连续输出全部缺失条目，不得跳步、不得乱序、不得只输出一条；\n' +
          '   · 状态栏HTML依赖前7条——前7条未齐时绝不出状态栏HTML。\n' +
          '6. 完成后在回复末尾单独一行输出控制标记：\n' +
          '   <agent:done> ——当前是计划的最后一步（或本步完成后目标已达成）\n' +
          '   <agent:next> ——后面还有待执行步骤\n' +
          '   <agent:skip> ——本步因信息不足/依赖缺失确实无法执行，说明原因后跳过\n' +
          '写卡器执行你的操作后会把【执行结果】附在你消息尾部，并在下一轮作为观察反馈给你。\n';
        return d;
      }

      // ===== Agent主循环：自动逐步执行计划直到完成/停止/超限 =====
      // ===== 状态距离：0=目标达成，100=空卡；仅用于检测"是否还在推进" =====
      function _computeStateDistance(cd) {
        let score = 0;
        if (cd.name) score += 10;
        const descLen = String(cd.description || '').length;
        if (descLen >= 400) score += 20;
        else if (descLen >= 200) score += 15;
        else if (descLen >= 100) score += 8;
        if (cd.first_mes) score += 10;
        const entries = (cd.character_book && cd.character_book.entries) || [];
        // 对数式饱和：条目越多新增一条的边际距离越小，避免 10 条后恒等于 0 触发假停滞
        score += 30 * (1 - 1 / (1 + entries.length / 3));
        try {
          const chk = checkMvu8Entries(cd);
          score += (chk.doneCount + (chk.has8 ? 1 : 0)) * 1;   // ★修复#8：MVU 权重 3→1（避免暂停在 MVU 中途时状态距离不敏感而提前判"停滞"）
        } catch (_) {}
        const rx = (cd.extensions && cd.extensions.regex_scripts) || [];
        score += Math.min(rx.filter(function(r) {
          return r && String(r.scriptName || '').indexOf('[界面]') === 0;
        }).length * 5, 15);
        return Math.max(0, 100 - score);
      }

      // ★ 新增：Agent 计划执行完成后的总结报告（完成情况 + 后续建议，Markdown格式）
      // ===== 智能建议生成：基于角色卡内容的类别分析，给出针对性下一步建议 =====
      function _buildSmartAdvice() {
        const entries = (cardData.character_book && cardData.character_book.entries) || [];
        const nonMvu = entries.filter(function(e) { return !isMVUEntry((e && e.comment) || ''); });
        const descLen = String(cardData.description || '').length;
        const firstLen = String(cardData.first_mes || '').length;
        const altCount = (cardData.alternate_greetings || []).filter(function(g){ return typeof g === 'string' && g.trim(); }).length;
        let chk = { doneCount: 0, all7Done: false, has8: false };
        try { chk = checkMvu8Entries(cardData); } catch (_) {}
        const mvuDone = chk.doneCount + (chk.has8 ? 1 : 0);
        const rx = (cardData.extensions && cardData.extensions.regex_scripts) || [];
        const feB = rx.filter(function(r){ return r && (r.id === 'frontend-beautify' || String(r.scriptName||'').indexOf('[界面]正文美化') >= 0); }).length;
        const feS = rx.filter(function(r){ return r && String(r.id||'').indexOf('frontend-structured-') === 0; }).length;

        // ---- 世界书条目类别识别（从 comment + content 前 150 字；★松绑4.3：每类 2-4 个最典型词）----
        const _catPatterns = {
          '角色': /人物|角色|NPC/i,
          '势力': /势力|组织|门派|家族/i,
          '地点': /地点|地图|城市|秘境/i,
          '规则': /规则|体系|等级|禁忌/i,
          '物品': /物品|道具|装备|法宝/i,
          '技能': /技能|能力|法术|功法/i,
          '事件': /事件|剧情|任务|主线/i,
          '关系': /关系|羁绊|好感/i,
        };
        const _catCount = {};
        Object.keys(_catPatterns).forEach(function(k) { _catCount[k] = 0; });
        nonMvu.forEach(function(e) {
          const txt = String(e.comment || '') + ' ' + String(e.content || '').slice(0, 150);
          Object.keys(_catPatterns).forEach(function(k) {
            if (_catPatterns[k].test(txt)) _catCount[k]++;
          });
        });

        const advice = [];

        // ---- 角色卡主体 ----
        if (descLen === 0) advice.push('- **还没写世界观** → 说"生成世界观总纲"');
        else if (descLen < 300) advice.push('- 世界观描述偏短（' + descLen + ' 字）→ 说"扩写世界观，补充历史/地理/势力"');
        if (firstLen === 0) advice.push('- **还没写开场白** → 说"生成开场白"');
        else if (altCount === 0) advice.push('- 只有一条开场白 → 说"再来一条备选开场白（换个场景或时间）"');

        // ---- 世界书条目类别缺口分析 ----
        if (nonMvu.length === 0) {
          advice.push('- **还没有世界书条目** → 说"先做世界观规则条目"或"加个主角条目"');
        } else {
          if (_catCount.角色 === 0) advice.push('- **缺少角色条目** → 说"加主角/配角/反派条目"');
          if (_catCount.势力 === 0 && nonMvu.length >= 2) advice.push('- 缺少势力/组织 → 说"加几个势力或组织（宗门/家族/阵营）"');
          if (_catCount.地点 === 0 && nonMvu.length >= 3) advice.push('- 缺少地点/地图 → 说"加几个关键地点（城市/秘境/学院）"');
          if (_catCount.规则 === 0 && nonMvu.length >= 3) advice.push('- 缺少世界观规则 → 说"加规则条目（等级体系/禁忌/机制）"');
          if (_catCount.物品 === 0 && _catCount.技能 === 0 && nonMvu.length >= 4) advice.push('- 缺少物品/技能 → 说"加装备/法宝/技能条目"');
          if (_catCount.事件 === 0 && nonMvu.length >= 4) advice.push('- 缺少事件/剧情 → 说"加主线任务或悬念事件"');
          if (advice.length === 0 && nonMvu.length < 4) advice.push('- 条目偏少（' + nonMvu.length + ' 条）→ 说"再丰富几个角色或地点条目"');
        }

        // ---- MVU 变量系统 ----
        if (mvuDone > 0 && !chk.all7Done) advice.push('- **MVU 前 7 条没齐** → 说"继续 MVU"补齐（缺 ' + (7 - chk.doneCount) + ' 条）');
        if (chk.all7Done && !chk.has8) advice.push('- MVU 差最后一步 → 说"生成状态栏"补上第 8 条');
        if (mvuDone === 0 && nonMvu.length >= 4) advice.push('- 还没做 MVU 变量系统 → 说"设计 MVU 变量系统"（追踪好感度/金钱/状态等）');

        // ---- 前端界面 ----
        if (feB === 0 && feS === 0 && nonMvu.length >= 3) advice.push('- 还没做前端界面 → 说"做个正文美化"或"做个任务面板"');

        // ---- 兜底 ----
        if (advice.length === 0) advice.push('- 卡片已经比较完整 → 点「生成并写入酒馆」装进酒馆试试，或说"检查一下还缺什么"');

        return advice;
      }

      function _buildAgentCompletionSummary(goal) {
        const entries = (cardData.character_book && cardData.character_book.entries) || [];
        const nonMvu = entries.filter(function(e) { return !isMVUEntry((e && e.comment) || ''); });
        const constN  = nonMvu.filter(function(e) { return e.constant; }).length;
        const trigN   = nonMvu.length - constN;
        const descLen = String(cardData.description || '').length;
        const firstLen= String(cardData.first_mes || '').length;
        let chk = { doneCount: 0, all7Done: false, has8: false, missing: [] };
        try { chk = checkMvu8Entries(cardData); } catch (_) {}
        const mvuDone = chk.doneCount + (chk.has8 ? 1 : 0);
        const rx = (cardData.extensions && cardData.extensions.regex_scripts) || [];
        const feB = rx.filter(function(r) { return r && (r.id === 'frontend-beautify' || String(r.scriptName || '').indexOf('[界面]正文美化') >= 0); }).length;
        const feS = rx.filter(function(r) { return r && String(r.id || '').indexOf('frontend-structured-') === 0; }).length;

        const L = [];
        L.push('## ✅ Agent 执行完成');
        if (goal) L.push('> 目标：' + goal);
        L.push('');
        L.push('### 📦 完成情况');
        L.push('- 角色卡名称：' + (cardData.name ? '「' + cardData.name + '」' : '*（未命名）*'));
        L.push('- 世界观描述：**' + descLen + ' 字**' + (descLen === 0 ? ' ⚠️ 还没写' : (descLen < 200 ? '（偏短）' : '')));
        L.push('- 开场白：**' + firstLen + ' 字**' + (firstLen === 0 ? ' ⚠️ 还没写' : ''));
        L.push('- 世界书条目：**' + nonMvu.length + ' 条**（常驻 ' + constN + ' / 触发 ' + trigN + '）');
        if (mvuDone > 0) L.push('- MVU 变量系统：**' + mvuDone + '/8**' + (chk.all7Done ? '' : '（缺 ' + (7 - chk.doneCount) + ' 条工作流）'));
        if (feB > 0 || feS > 0) L.push('- 前端界面：' + (feB > 0 ? '正文美化 ×' + feB : '') + (feS > 0 ? (feB > 0 ? ' · ' : '') + '数据面板 ×' + feS : ''));
        L.push('');
        L.push('### 💡 建议下一步');
        L.push(_buildSmartAdvice().join('\n'));
        L.push('');
        L.push('### 🎬 常用操作');
        L.push('- 单条重做：「重做 XX 条目」或「重做第 N 步」');
        L.push('- 一键写入：「生成并写入酒馆」');
        L.push('- 继续打磨：直接说你想要改的地方');
        return L.join('\n');
      }

      // ★ 新增：自由对话轮次结束后的轻量完成小结（非 Agent 循环场景）
      function _buildLightweightCompletionSummary() {
        const entries = (cardData.character_book && cardData.character_book.entries) || [];
        const nonMvu = entries.filter(function(e) { return !isMVUEntry((e && e.comment) || ''); });
        const descLen = String(cardData.description || '').length;
        const firstLen = String(cardData.first_mes || '').length;
        const altCount = (cardData.alternate_greetings || []).filter(function(g){ return typeof g==='string' && g.trim(); }).length;
        let chk = { doneCount: 0, all7Done: false, has8: false, missing: [] };
        try { chk = checkMvu8Entries(cardData); } catch (_) {}
        const mvuDone = chk.doneCount + (chk.has8 ? 1 : 0);
        const rx = (cardData.extensions && cardData.extensions.regex_scripts) || [];
        const feB = rx.filter(function(r){ return r && (r.id === 'frontend-beautify' || String(r.scriptName||'').indexOf('[界面]正文美化') >= 0); }).length;
        const feS = rx.filter(function(r){ return r && String(r.id||'').indexOf('frontend-structured-') === 0; }).length;

        const L = [];
        L.push('---');
        L.push('### ✅ 本次完成情况');
        if (nonMvu.length > 0) L.push('- 世界书条目：**' + nonMvu.length + ' 条**');
        if (descLen > 0) L.push('- 世界观描述：**' + descLen + ' 字**' + (descLen < 200 ? '（有点短，建议写更细）' : ''));
        if (firstLen > 0) L.push('- 开场白：**' + firstLen + ' 字**' + (altCount > 0 ? ' + 备选 ' + altCount + ' 条' : ''));
        if (mvuDone > 0) L.push('- MVU 变量系统：**' + mvuDone + '/8**');
        if (feB > 0 || feS > 0) L.push('- 前端界面：' + (feB > 0 ? '正文美化×' + feB : '') + (feS > 0 ? ' 数据面板×' + feS : ''));

        L.push('');
        L.push('### 💡 下一步可以做');
        L.push(_buildSmartAdvice().join('\n'));
        L.push('');
        L.push('> 有什么想改的直接说，比如"主角性格再强势一点"、"开场白换个场景"。');
        return L.join('\n');
      }

      async function agentLoop() {
        if (agentLoopActive) return;
        if (!agentPlan) return;
        const pending = agentPlan.steps.filter(function(s) { return !s.done; }).length;
        if (pending <= 0) {
          addAssistantMsg(_buildAgentCompletionSummary(agentPlan.goal));
          agentPlan = null;
          saveToStorage();
          updateQuickActions();
          updateCtxBar();
          return;
        }
        agentLoopActive = true;
        agentConsecutiveFailures = 0;
        // ===== 语义循环检测状态 =====
        let _lastDist = _computeStateDistance(cardData);
        let _stagnantCount = 0;
        const STAGNANT_THRESHOLD = 4;
        const STAGNANT_EPSILON = 2;
        try {
          while (agentLoopActive && agentPlan) {
            const idx = agentPlan.steps.findIndex(function(s, i, arr) {
              if (s.done) return false;
              // 依赖未满足的步骤跳过
              if (s.dependsOn && s.dependsOn.length > 0) {
                const allDepsDone = s.dependsOn.every(function(di) {
                  return arr[di] && arr[di].done;
                });
                if (!allDepsDone) return false;
              }
              return true;
            });
            if (idx < 0) {
              const _blocked = agentPlan.steps.filter(function(s){ return !s.done; }).length;
              if (_blocked > 0) {
                addAssistantMsg('⚠️ 检测到 ' + _blocked + ' 个步骤因依赖未满足被阻塞（可能依赖成环）。已停止循环，请检查计划。');
                agentLoopActive = false;
                break;
              }
              addAssistantMsg(_buildAgentCompletionSummary(agentPlan.goal));
              agentPlan = null;
              break;
            }
            // 防失控：动态步数上限（按计划长度取 min(50, max(12, steps*4))）
            const _stepLimit = _computeStepLimit(agentPlan);
            if ((agentPlan.stepRuns || 0) >= _stepLimit) {
              addAssistantMsg('⚠️ Agent已连续执行 ' + _stepLimit + ' 步（计划 ' + agentPlan.steps.length + ' 步的4倍）达到上限，循环已停止。\n剩余未完成步骤可点「继续执行计划」或对话继续。');
              break;
            }
            agentPlan.stepRuns = (agentPlan.stepRuns || 0) + 1;
            saveToStorage();
            updateCtxBar();
            updateQuickActions();
            const stepDesc = String(agentPlan.steps[idx].desc || '').slice(0, 50);
            pushWorkToast('Agent执行 ' + (idx + 1) + '/' + agentPlan.steps.length + '：' + stepDesc, 'working');
            // 执行单步（callAIChat内含完整应用链路：操作块/JSON/状态栏/前端HTML自动提取保存）
            const r = await callAIChat({ agentStep: true, stepIdx: idx });
            // ReAct：保存本步执行结果观察，作为下一步任务指令的反馈
            if (r && r.observation) agentLastObservation = r.observation;
            // ⚠️并发让位：用户在循环间隙插话（isGenerating=true导致本步被跳过）→ 短暂等待让用户那轮完成，
            //    等待期间本步未实际执行（补偿stepRuns后continue重试，不计失败）；超时仍占用则暂停循环让位
            if (r === null && isGenerating) {
              for (let w = 0; w < 3 && isGenerating; w++) {
                await new Promise(function(res) { setTimeout(res, 2000); });
                if (!agentLoopActive) break;
              }
              if (!agentLoopActive) break;
              if (isGenerating) {
                addAssistantMsg('💬 检测到对话正被用户消息占用，Agent循环已暂停让位——\n剩余步骤可稍后点「继续执行计划」恢复执行。');
                break;
              }
              agentPlan.stepRuns = Math.max(0, (agentPlan.stepRuns || 1) - 1); // 补偿：本步未实际执行
              continue;
            }
            // 用户中途停止
            if (!agentLoopActive) {
              showToast('⏹ Agent已停止（当前步骤成果已保留，剩余' + agentPlan.steps.filter(function(s) { return !s.done; }).length + '步可点「继续执行计划」）', 'info', 6000);
              break;
            }
            // 重试信号：本步无产出（callAIChat未标记done）→ 循环回到同一步，带失败观察重试
            if (r && r.control === 'retry') {
              showToast('⚠️ 本步未产出有效内容，Agent将结合执行结果重试', 'warning', 5000);
              try { UserProfile.recordAgentStepRetry(idx); } catch (_) {}
            }
            // 产出检测（防AI空转；skip是显式跳过，不算失败）
            if (r && (r.produced || r.control === 'skip' || r.control === 'replan')) {
              agentConsecutiveFailures = 0;
            } else {
              agentConsecutiveFailures++;
              if (agentConsecutiveFailures >= 2) {
                addAssistantMsg('⚠️ Agent连续两步没有产出有效内容（可能AI未按协议输出操作块），循环已自动停止。\n可对话说明需求后让我继续，或点「检查」重新检查创作进度。');
                break;
              }
            }
            // 动态重规划信号：新计划已在callAIChat中替换agentPlan，继续循环从新计划第一步执行
            if (r && r.control === 'replan') {
              showToast('🔄 Agent已重规划，从新计划第一步继续', 'info', 5000);
            }
            // ===== 语义进展检查：连续 N 步状态距离无变化则停止 =====
            try {
              const _newDist = _computeStateDistance(cardData);
              const _delta = _lastDist - _newDist;
              if (_delta < STAGNANT_EPSILON) {
                _stagnantCount++;
                if (_stagnantCount >= STAGNANT_THRESHOLD) {
                  addAssistantMsg('⚠️ 已连续 ' + STAGNANT_THRESHOLD + ' 步没有实质进展（状态距离变化 <' + STAGNANT_EPSILON + '），可能陷入循环或计划与目标不匹配。\n\n' +
                    '建议：\n• 点「检查」让 Agent 重新评估\n• 或对话说明具体哪里不对，我重新规划\n\n' +
                    '剩余步骤：' + agentPlan.steps.filter(function(s){ return !s.done; }).length + ' 步');
                  agentLoopActive = false;
                  break;
                }
              } else {
                _stagnantCount = 0;
              }
              _lastDist = _newDist;
            } catch (_sd) {}
            // 完成信号
            if (r && r.control === 'done') {
              agentPlan.steps.forEach(function(s) { s.done = true; });
              addAssistantMsg(_buildAgentCompletionSummary(agentPlan.goal));
              agentPlan = null;
              agentLastObservation = ''; // 计划完成，观察随之作废
              break;
            }
          }
        } catch (err) {
          logError('agentLoop', err);
          try {
            addAssistantMsg('⚠️ Agent循环异常中断：' + (err && err.message) + '\n已执行的步骤成果均已保留。');
          } catch (_e) {}
        } finally {
          agentLoopActive = false;
          agentConsecutiveFailures = 0;
          try {
            saveToStorage();
            updateQuickActions();
            updateCtxBar();
            renderPreview();
          } catch (_e2) {}
          // ★ 修复：Agent 循环收尾不再自动触发偏好分析（只在写入酒馆/导出JSON/手动"立即分析"时触发）
        }
      }

      // ===== 停止Agent循环（当前AI调用无法中断，本步完成后停止）=====
      function stopAgentLoop() {
        if (!agentLoopActive) return;
        agentLoopActive = false;
        showToast('⏹ 将在当前步骤完成后停止Agent', 'info');
        updateQuickActions();
      }

      // ===== 检查入口：全面检查创作进度，输出待办计划 → agentLoop 自动执行 =====
      function startCheckFlow() {
        if (isGenerating || agentLoopActive) return;
        const input = doc.getElementById('chatInput');
        if (!input) return;
        input.value =
          '请作为写卡Agent执行一次全面检查。\n\n' +
          '【检查范围 · 逐项核对「当前创作进度总览」】\n' +
          '1. 角色卡主体：名称 / 世界观描述 / 开场白 / 备选开场白 / 世界书条目（数量、覆盖、触发词、字段配置、正文格式）\n' +
          '2. MVU 变量系统 8 步：zod脚本 / [InitVar] / 更新规则 / 变量当前状态 / 输出格式 / 格式强调 / 占位提醒 / 状态栏HTML\n' +
          '3. 前端界面：[界面]正文美化 / [界面]X 结构化面板 / 对应世界书条目\n\n' +
          '【输出要求 · 本轮只做检查报告，不生成任何内容】\n' +
          '★ 本轮不输出 :::操作块 / ```html 代码块（写了会被剥离）。\n' +
          '★ **报告末尾请追加 <agent_plan>...</agent_plan> 计划块**：把待办拆成 2-8 个小步骤（每步只做一小块，如"生成世界观总纲"、"加主角条目"、"补 MVU 第1条 zod脚本"）。写卡器会自动逐步执行。\n' +
          '★ 按简明报告模板输出：\n' +
          '   🎯 我理解你想要：一句话\n' +
          '   📌 当前卡现状：有几条条目、缺什么（1-2 句）\n' +
          '   📋 新增条目（X 条）：条目名 + 一句话说明\n' +
          '   ✏️ 修改内容（有则写）\n' +
          '   🔧 优先级安排：一句话\n\n' +
          '★ 报告末尾以"请回复「确认」开始执行，或指出需要调整的地方。"收尾，然后停止。\n' +
          '★ 用户回复"确认"后，写卡器会自动调用 Agent 循环逐步执行你列出的计划——所以你**必须**在报告末尾输出 <agent_plan>…</agent_plan>。';
        try { window.__cwAllowAgentPlan = true; } catch (_) {}
        handleSend();
      }

      // ===== 客户端提示器（★松绑1.1/1.2）：不再拦截、不再强制报告 =====
      // 本函数只输出一个"提示信号"给用户：返回 true 只用于弹 Toast，
      // **不设置任何全局标记、不干预 AI**。判档权完全在 AI（agentIdentity"需求评估"段）。
      function _suggestReport(text, cd) {
        if (!text) return false;
        const t = String(text).trim();
        if (!t) return false;
        // 明确的"跳过确认" → 不提示
        if (/(直接做|别问了|你看着办|你自己决定|不要问|直接生成|立即执行|马上做|开始吧|不用确认|无需确认|我自己看|我自己处理)/.test(t)) return false;
        // 确认语 → 不提示
        if (/^(确认|开始|OK|ok|可以|go|Go|做吧|执行|同意|好的|好|行|我选择\s*[:：])/i.test(t)) return false;

        // 空卡：只有整套级别才提示（其余放行，让 AI 自主判断）
        const isBlank = !cd || (
          !String(cd.name || '').trim() &&
          !String(cd.description || '').trim() &&
          (!cd.character_book || !cd.character_book.entries || cd.character_book.entries.length === 0) &&
          !String(cd.first_mes || '').trim()
        );
        if (isBlank) {
          return /(整套|全套|一整套|全量|一次做完|全部做完)/.test(t);   // ★P2-18：删"从零/完整角色卡/完整世界观"等高频词
        }

        // 有卡：只在出现"整套/全量/从头/全部重写"这类极限词时提示
        return /(整套体系|整体重构|全部重写|全量替换|整张卡重做)/.test(t);   // ★P2-18：删"从头重做/完整角色卡/完整世界观"
      }

      // ===== 离线反馈分析：把撤回/重试语料提炼成 avoid/prefer 写作规约 =====
      // 触发：攒够样本且距上次≥冷却，或用户手动调用 analyzeWritingPreferences()
      let _analyzingPrefs = false;
      async function analyzeWritingPreferences(force, source) {
        // ★ 修复 Bug3（v2）：非 force 调用必须显式传白名单 source（含 undefined/null/空串 一律拒绝）。
        // 原逻辑 `source !== undefined && source !== null && !_ALLOWED_SOURCES[source]` 允许"未传 source"绕过白名单，
        // 任何调用点只要漏传参数就会静默触发 AI 分析，用户感知为"打开 / 关闭工具自动分析写作偏好"。
        // 修复后：只有显式传入 'manual' / 'save-character' / 'export-json' 才允许执行。
        const _ALLOWED_SOURCES = { 'manual': 1, 'save-character': 1, 'export-json': 1 };
        if (!force) {
          if (!source || !_ALLOWED_SOURCES[source]) {
            try { console.log('[偏好分析] 双重守卫：非白名单来源「' + source + '」已拒绝（仅允许 manual / save-character / export-json）'); } catch (_) {}
            return;
          }
        }
        if (isGenerating || _analyzingPrefs) return;
        let un;
        try { un = UserProfile.getUnanalyzedFeedback(); } catch (_) { return; }
        const minSamples = force ? 1 : 2;
        if (!un || un.length < minSamples) {
          showToast(
            force
              ? '还没有可分析的反馈样本，先撤回/重试一次 AI 修改再试'
              : '反馈样本还太少（当前 ' + (un ? un.length : 0) + ' 条，至少 2 条），再多撤回/重试几次后再分析',
            'info', 4000
          );
          return;
        }
        _analyzingPrefs = true;
        // 分层采样：按 kind 分组，保证不同动作类型都被看到
        const _byKind = {};
        un.forEach(function(f) { (_byKind[f.kind] = _byKind[f.kind] || []).push(f); });
        const _kinds = Object.keys(_byKind);
        const _perKind = Math.max(3, Math.floor(20 / Math.max(1, _kinds.length)));
        let _picked = [];
        _kinds.forEach(function(k) {
          _picked = _picked.concat(_byKind[k].slice(-_perKind));
        });
        _picked.sort(function(a, b) { return (a.ts || 0) - (b.ts || 0); });
        const samples = _picked.slice(-20).map(function(f) {
          const s = {
            动作: (function() {
              const K = {
                'revoke': '撤回',
                'retry': '重做',
                'edit': '人工编辑',
                'user-rewrite': '用户重写自己的消息',
                'accepted': '保留并写入酒馆',
                'manual-delete': '预览面板手动删除条目',
                'manual-delete-batch': '预览面板批量删除条目',
                'manual-disable-batch': '预览面板批量禁用条目',
                'manual-enable-batch': '预览面板批量启用条目'
              };
              return K[f.kind] || f.kind;
            })()
          };
          if (f.changeSummary) s['AI本次实际改动'] = f.changeSummary;
          if (Array.isArray(f.entryPairs) && f.entryPairs.length > 0) {
            s['内容对照'] = f.entryPairs.map(function(pr) {
              const out = { 条目: pr.name, 动作: pr.action };
              if (pr.before) out['用户认可的版本(或旧版)'] = pr.before;
              if (pr.after) out['AI给的版本(或新版)'] = pr.after;
              return out;
            });
          }
          if (f.aiReply) s['AI回复片段'] = f.aiReply.slice(0, 1200);
          if (f.userNextMsg) s['用户随后说'] = f.userNextMsg.slice(0, 600);
          if (f.userEdit) s['用户把内容改成'] = f.userEdit.slice(0, 1200);
          return s;
        });
        // 按 semantics 分组，让 AI 明白每对的"哪边是用户要的"
        const _grouped = { 'ai-vs-user': [], 'baseline-vs-ai': [], 'baseline-vs-accepted': [], 'user-rejected': [], 'other': [] };
        _picked.forEach(function(f) {
          (f.entryPairs || []).forEach(function(pr) {
            const sem = pr.semantics || 'baseline-vs-ai';
            const g = _grouped[sem] ? sem : 'other';
            _grouped[g].push({
              条目: pr.name,
              动作: pr.action,
              before: pr.before,
              after: pr.after,
              acceptedContent: pr.acceptedContent || ''
            });
          });
        });
        const _semDesc = {
          'ai-vs-user': '【AI vs 用户手改】before=AI 原版；after=用户手改成。→ **after 是金标准**，before 是要避免的',
          'baseline-vs-ai': '【基线 vs AI 版】before=AI 修改前；after=AI 修改后（被撤回/重试的）。→ **after 是被拒版本**；**acceptedContent（若有）是用户最终接受的金标准**；从 after→acceptedContent 的差异提取规则',
          'baseline-vs-accepted': '【基线 vs 最终接受版】before=AI 介入前；after=用户最终保留并写入酒馆的版本。→ **after 是金标准**',
          'user-rejected': '【用户主动删除/禁用】before=被删内容。→ before 是要避免的',
          'other': '（语义未知，谨慎参考）'
        };
        const _payload = { 动作汇总: samples.map(function(s) { return s.动作; }), 按语义分组: {} };
        Object.keys(_grouped).forEach(function(k) {
          if (_grouped[k].length === 0) return;
          _payload.按语义分组[k] = { 说明: _semDesc[k], 对照: _grouped[k].slice(0, 8) };
        });
        const _plainSamples = samples.filter(function(s) {
          return !s['内容对照'] || s['内容对照'].length === 0;
        }).slice(0, 5);

        const prompt =
          '你是写作偏好分析师。你将看到用户对 AI 写卡产出的反馈样本，需要从中提炼**可执行的写作规约**。\n\n' +
          '【核心要求】\n' +
          '1. 只从样本出发，禁止凭空推断。\n' +
          '2. 每条规则必须**可执行**（祈使句，具体到"写/不写什么"，禁止"用户喜欢简洁"这类空话）。\n' +
          '3. 每条规则必须带 `evidence`：从样本里引用一句具体差异（≤30字），便于用户审核。\n' +
          '4. 输出规则条数：avoid 3-8 条，prefer 3-8 条。\n' +
          '5. 每条带 category ∈ {writing, structure, fields, scale, general}。\n\n' +
          '【如何读对照】严格按每组"说明"判断哪边是用户要的：\n' +
          '- ai-vs-user：after 是用户要的\n' +
          '- baseline-vs-ai：after 是被拒的；acceptedContent（若有）才是用户要的\n' +
          '- baseline-vs-accepted：after 是用户认可的\n' +
          '- user-rejected：before 是要避免的\n' +
          '⚠️ 严禁把"被拒版"当成用户要的。\n\n' +
          '【★★★最高优先级：acceptedContent 是金标准★★★】\n' +
          '处理 baseline-vs-ai 样本时：after=用户不满的版本（要避免）；acceptedContent=用户最终接受的版本（要模仿）。直接从 after→acceptedContent 的对比提取规则。\n' +
          '例：after="她嘴角上扬，眼里闪过光芒" / acceptedContent="她看了他一眼" → 规则：避免微表情描写。\n' +
          '禁止只产出"避免用似乎/仿佛"这类通用规则；每条规则必须能在样本里找到出处（填 evidence）。\n' +
          '如果样本只能支撑通用规则，就把 avoid/prefer 减到 2-3 条，宁缺毋滥。\n\n' +
          '【重点维度】句子长短/段落密度；比喻/微表情/心理/环境描写；对话比例与语气描写；YAML结构与条目长度；触发词数量；开场白开场方式；dark/nsfw 尺度。\n\n' +
          '【输出格式】严格 JSON，无多余文字：\n' +
          '{ "avoid": [{"text":"...","category":"structure","evidence":"..."}], "prefer": [{"text":"...","category":"writing","evidence":"..."}] }\n\n' +
          '【样本数据】\n' +
          JSON.stringify(_payload, null, 2) +
          (_plainSamples.length ? '\n\n【无对照的辅助样本】\n' + JSON.stringify(_plainSamples, null, 2) : '');
        showToast('正在分析你的写作偏好（' + samples.length + ' 条样本）…', 'info', 4000);
        try {
          // 复用底层 callAI，避免污染聊天流
          const raw = await callAI(prompt);
          const parsed = extractJSON(raw);
          const rules = (parsed && typeof parsed === 'object') ? parsed : null;
          if (!rules || (!Array.isArray(rules.avoid) && !Array.isArray(rules.prefer))) {
            showToast('分析结果无法解析，本次未写入规约', 'warning', 4000);
            return;
          }
          UserProfile.mergeWritingRules(rules);
          UserProfile.markFeedbackAnalyzed();
          const n = (rules.avoid ? rules.avoid.length : 0) + (rules.prefer ? rules.prefer.length : 0);
          // 把提炼结果回显到对话，让用户看到并可否决
          try {
            const _avoid = (rules.avoid || []).slice(0, 6).map(function(r, i) {
              return '  ' + (i + 1) + '. [避免] ' + (r.text || r) + (r.evidence ? '  ←' + r.evidence : '');
            }).join('\n');
            const _prefer = (rules.prefer || []).slice(0, 6).map(function(r, i) {
              return '  ' + (i + 1) + '. [偏好] ' + (r.text || r) + (r.evidence ? '  ←' + r.evidence : '');
            }).join('\n');
            addAssistantMsg(
              '🧠 从你的历史反馈中提炼了 ' + n + ' 条写作规约，今后写卡会自动遵守：\n\n' +
              (_avoid ? '【避免】\n' + _avoid + '\n\n' : '') +
              (_prefer ? '【偏好】\n' + _prefer + '\n\n' : '') +
              '不认可的规则可在「工作区 → 我的习惯 → 写作规约」逐条删除。'
            );
          } catch (_echoErr) { logWarn('analyze.echo', _echoErr); }
          showToast('✅ 已从反馈中提炼 ' + n + ' 条写作规则，今后写卡会自动遵守', 'success', 6000);
        } catch (e) {
          logError('analyzeWritingPreferences', e);
          showToast('分析失败：' + (e && e.message ? e.message : ''), 'error', 5000);
        } finally {
          _analyzingPrefs = false;
        }
      }

      // 统一的"检查是否值得自动分析"入口
      // ★ 修复（Bug3 + 用户要求）：只允许「写入酒馆(save-character)」和「导出JSON(export-json)」两个触发点，
      //   任何其它路径（打开/关闭/AI对话结束/撤回/重试/循环等）一律 return，
      //   彻底杜绝"打开关闭工具就自动分析写作偏好"。
      //   注：用户在「我的习惯 → 立即分析」按钮里的手动触发，走的是 analyzeWritingPreferences(true)，
      //       不经过本函数，所以此处白名单无需包含 'manual'。
      function _maybeAutoAnalyze(trigger) {
        // ★ 修复 Bug3：白名单机制 + 显式日志，确保只有用户主动「写入酒馆 / 导出JSON」触发分析。
        //   打开/关闭/对话结束/撤回/重试/Agent循环 等路径一律不触发。
        const _ALLOWED = { 'save-character': 1, 'export-json': 1 };
        if (!trigger || !_ALLOWED[trigger]) {
          // 用 console.log（非 WRITER_DEBUG 门控），方便用户随时确认"没有触发分析"
          try { console.log('[偏好分析] 触发点「' + trigger + '」不在白名单内，跳过分析（仅允许 save-character / export-json）'); } catch (_) {}
          return;
        }
        // ★ 加固 Bug3：文档已不可见/iframe 已卸载 → 放弃分析
        try {
          const _cwDoc = window.document;
          if (!_cwDoc || _cwDoc.readyState === 'uninitialized' || !_cwDoc.body) return;
          const _pDoc = (window.parent && window.parent.document) ? window.parent.document : _cwDoc;
          if (!_pDoc || !_pDoc.getElementById(SCRIPT_ID + '-modal')) return;
        } catch (_visGuard) {}
        try {
          if (typeof UserProfile === 'undefined' || UserProfile.isDisabled()) return;
          if (isGenerating || _analyzingPrefs) return;
          // 不做定时检查：shouldAnalyze() 内部有冷却，触发完全依赖事件节点。
          // 用微任务让位给当前 UI 操作完成（不是定时器），再执行分析。
          if (UserProfile.shouldAnalyze()) {
            Promise.resolve().then(function() {
              if (isGenerating || _analyzingPrefs) return;
              // ★ 修复 Bug3：传入 trigger 供双重守卫校验
              analyzeWritingPreferences(false, trigger).catch(function(e) { logError('autoAnalyze', e); });
            });
          }
        } catch (_) {}
      }

      // 用户"最后接受基线"——撤回/重试对照以此为基准，避免连续撤回时 baseline 被污染
      let _lastAcceptedSnapshot = null;
      function _markAccepted() {
        try { _lastAcceptedSnapshot = JSON.parse(JSON.stringify(cardData)); } catch (_) {}
      }

      // 公共 accepted 采集函数：saveCharacter / exportCardJson / closeBtn 复用
      function _collectAcceptedSamples(source) {
        const _curTab = _snapTabKey();
        const _accMsgs = getCurrentMessages();
        const _currentEntries = (cardData.character_book || {}).entries || [];
        const _currentMap = {};
        _currentEntries.forEach(function(e) {
          if (e && e.comment) _currentMap[String(e.comment)] = String(e.content || '');
        });
        try { UserProfile.attachAcceptedContent(_currentMap, _curTab); } catch (_atErr) { logWarn('collectAccepted.attach', _atErr); }
        try {
          const _curFields = {
            name: cardData.name || '',
            description: cardData.description || '',
            personality: cardData.personality || '',
            scenario: cardData.scenario || '',
            first_mes: cardData.first_mes || '',
            mes_example: cardData.mes_example || '',
            creator_notes: cardData.creator_notes || ''
          };
          UserProfile.attachAcceptedFields(_curFields, _curTab);
        } catch (_afErr) { logWarn('collectAccepted.attachFields', _afErr); }
        let _accCnt = 0;
        for (let _ai = _accMsgs.length - 1; _ai >= 0 && _accCnt < 3; _ai--) {
          if (!_accMsgs[_ai] || _accMsgs[_ai].role !== 'assistant') continue;
          const _snap = _pickSnapshotFor(_ai);
          if (!_snap) continue;
          const _pairs = buildEntryPairsFromSnapshot(_snap, _currentEntries, 'baseline-vs-accepted')
            .concat(buildFieldPairsFromSnapshot(_snap, cardData, 'baseline-vs-accepted'));
          if (!_pairs.length) continue;
          UserProfile.recordFeedback({
            kind: 'accepted',
            semantics: 'baseline-vs-accepted',
            entryPairs: _pairs.slice(0, 6),
            aiReply: String(_accMsgs[_ai].content || '').slice(0, 1500)
          });
          _accCnt++;
        }
        if (_accCnt > 0) {
          // ★ 修复 Bug3：分析触发彻底从采集函数剥离——采集只负责采集，触发交给调用方
          // （仅 saveCharacter / exportCardJson 两处会调用 _maybeAutoAnalyze）
          try { UserProfile.recordFriction('accepted:' + (source || 'unknown'), '', 1); } catch (_) {}
        }
        _markAccepted();
        return _accCnt;
      }

      async function handleSend() {
        const input = doc.getElementById('chatInput');
        const text = input ? input.value.trim() : '';
        if (!text) return;
        if (isGenerating) {
          showToast('AI 正在生成中——点击右下角⏹按钮可停止', 'info', 3000);
          return;
        }
        // 后台分析写作偏好期间，避免并发调用 AI
        if (typeof _analyzingPrefs !== 'undefined' && _analyzingPrefs) {
          showToast('正在后台分析你的写作偏好，请稍候再发送', 'info', 3000);
          return;
        }
        // 用户手动发送（不是点击选项）时，清掉待选选项条
        if (_pendingAgentOptions && !/^我选择\s*[:：]/.test(text)) {
          clearAgentOptionsBar();
        }
        input.value = '';
        input.style.height = 'auto'; // 发送后重置输入框高度
        lastUserInput = text;
        // 用户画像：记录用户输入（覆盖「生成角色卡」命令与普通对话两条路径，每发一条只记一次）
        // 带摩擦检测：疑问词/长消息/重复句
        try { UserProfile.recordUserMessageWithFriction(text); } catch (_) {}
        // ★松绑1.1：只提示不拦截——不再设置 __cwForceUnderstandNext，判档权完全在 AI
        if (_suggestReport(text, cardData)) {
          showToast('💡 这看起来是较大的需求，如果 AI 判断需要，它会先出计划征求你确认', 'info', 5500);
        }
        // ⚠️已禁用一键生成完整卡：所有用户消息（含"生成角色卡""完整生成"等笼统请求）
        // 一律走 callAIChat → 报告流程（四档判档），先输出生成计划报告，让用户确认后再分步生成。
        // doGenerate 已废弃，仅保留函数声明防止旧引用报错。
        // ★★★ 新增：用户明确确认 + 已有待执行计划 → 直接启动 Agent 循环（不再绕道调用AI出计划）★★★
        // ★P2-12：必须短句、"好"必须独立成句（"好的，但改下第 2 步"不再触发）
        const _isUserConfirm = /^(确认|开始|OK|可以|go|做吧|执行|同意|好的|行|继续|就这样)[。！!，,\s]*$/i.test(text.trim())
          && text.trim().length <= 8
          && !/(不|别|等等|暂停|不要|算了)/.test(text);
        if (_isUserConfirm && agentPlan && Array.isArray(agentPlan.steps) &&
            agentPlan.steps.some(function(s) { return !s.done; }) && !agentLoopActive) {
          const _pending = agentPlan.steps.filter(function(s) { return !s.done; }).length;
          addUserMsg(text);
          showToast('✅ 已确认，Agent 开始执行计划（剩余 ' + _pending + ' 步）', 'success', 5000);
          agentLoop().catch(function(err) {
            logError('agentLoop.confirm', err);
          });
          return;
        }
        // ★松绑P1-1：__cwForceUnderstandNext 标记已拆除，无需恢复旧值
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
        // ★修复#13：状态标签剥离仅限回复开头 5 行——不再全文扫描（gim），避免误删正文中用户想要的标题（如叙事游戏"# 反思阶段"）
        // ★修复#9：按 \r?\n 分行，避免 CRLF 输入下 \r 残留导致换行错位
        const _clLines = t.split(/\r?\n/);
        const _clHead = Math.min(5, _clLines.length);
        for (let _clI = 0; _clI < _clHead; _clI++) {
          _clLines[_clI] = _clLines[_clI].replace(/^\[(语言检定|果农冒泡|NSFW判定|人物逻辑|基调锚定|角色认知迷雾|角色活性与自然回应|风格适配|反思\s*&?\s*设定校对|物理规则|正文字数检测|输出顺序检查|时间地点输出检查|善意视角|防重复|反思)\][^\n]*$/, '');
        }
        t = _clLines.join('\n');
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
      // ===== op 参数 schema（applyOps 前置校验）=====
      const VALID_SET_FIELDS = ['name','description','first_mes','system_prompt','personality','scenario','creator_notes','alternate_greetings','creator','character_version','depth_prompt','mes_example','nickname'];
      const OP_SCHEMA = {
        upsert: { required: ['key'], optional: ['content','keys','secondary_keys','constant','position','selectiveLogic','depth','probability','order','group','sticky','cooldown','delay','role','enabled','match_whole_words'] },
        update: { required: ['key'], optional: ['content','keys','secondary_keys','constant','position','selectiveLogic','depth','probability','order','group'] },
        delete: { required: ['key'], optional: [] },
        set:    { required: ['key'], optional: ['content'] },
        rename: { required: ['oldKey','newKey'], optional: [] }
      };
      function _validateOp(op) {
        if (!op || typeof op !== 'object') return { ok: false, error: 'OP_NOT_OBJECT' };
        const schema = OP_SCHEMA[op.action];
        if (!schema) return { ok: false, error: 'UNKNOWN_ACTION: ' + String(op.action) };
        for (let i = 0; i < schema.required.length; i++) {
          const k = schema.required[i];
          if (op[k] === undefined || op[k] === null || String(op[k]).trim() === '') {
            return { ok: false, error: 'MISSING_FIELD: ' + op.action + '.' + k };
          }
        }
        if (op.action === 'set') {
          if (VALID_SET_FIELDS.indexOf(String(op.key).toLowerCase()) < 0) {
            return { ok: false, error: 'SET_UNKNOWN_FIELD: ' + op.key + '（合法字段：' + VALID_SET_FIELDS.join('/') + '）' };
          }
        }
        return { ok: true };
      }

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

        // 合法的顶层字段（set操作用；与 _validateOp 共用 VALID_SET_FIELDS）
        const validFields = VALID_SET_FIELDS;

        // MVU条目关键词（Tab隔离时代遗留：Agent模式下 ::操作块 可自由增删改全部领域条目，这两个函数保留作参考，不再被调用）
        function _isMvuEntryKey(comment) {
          const c = (comment || '').toLowerCase();
          return c.indexOf('[initvar]') >= 0 || c.indexOf('变量当前状态') >= 0 ||
            c.indexOf('变量更新规则') >= 0 || c.indexOf('变量输出格式') >= 0 ||
            c.indexOf('mvu_update') >= 0 || c.indexOf('[mvu_update]') >= 0 ||
            c.indexOf('状态变量输出') >= 0;
        }

        // ⚠️修复：MVU内容检查（用于 set 顶层字段拦截——AI 可能把 MVU 内容塞进 description 等顶层字段绕过 Tab 隔离）
        function _isMvuContentCheck(text) {
          if (!text) return false;
          const t = String(text);
          const head = t.slice(0, 300);
          return /\[initvar\]/i.test(head) || /\[mvu_update\]/i.test(head) ||
            head.indexOf('变量当前状态') >= 0 || head.indexOf('变量更新规则') >= 0 ||
            head.indexOf('变量输出格式') >= 0 || head.indexOf('状态变量输出') >= 0 ||
            /<statusblock[\s>]/i.test(t) || /<StatusPlaceHolderImpl/.test(t) ||
            t.indexOf('stat_data') >= 0 || t.indexOf('getAllVariables') >= 0;
        }

        ops.forEach(function(op) {
          // ===== op 前置校验（失败仅记录，不中断整批）=====
          const _v = _validateOp(op);
          if (!_v.ok) {
            console.warn('[applyOps] op 校验失败:', _v.error, op);
            changeLog._opErrors = changeLog._opErrors || [];
            changeLog._opErrors.push(_v.error);
            return;
          }
          // ===== Agent模式：不再按Tab拦截MVU条目（:::操作块可自由增删改全部领域条目）=====

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
            // ⚠️严格核心名判定（剥 [xxx]/<xxx> 前缀后精确匹配）：
            // 避免"<自定义条目>变量当前状态使用说明"等普通条目被 indexOf 误伤、内容被强制改写成固定模板
            const _cleanCore = _entryCommentCore(cleanComment);
            // 变量当前状态条目：强制规范化为标准格式（丢弃变量实际值/配置字段）
            if (_cleanedContent && _cleanCore === '变量当前状态') {
              _cleanedContent = normalizeVarListContent(_cleanedContent);
            }
            // 变量输出格式/强调条目：强制使用固定模板，丢弃AI混入的变量值/配置字段
            if (_cleanedContent && (_cleanCore === '变量输出格式' || _cleanCore === '变量输出格式强调')) {
              _cleanedContent = normalizeVarOutputFormatContent(cleanComment, _cleanedContent);
            }
            // 变量更新规则条目：规范化缩进/range格式/移除string的type字段
            if (_cleanedContent && _cleanCore === '变量更新规则') {
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
              // order 三向同步：AI 写的顶层 order / insertion_order 必须同步到三处，否则导出时 insertion_order 优先会吞掉新值
              if (basePatch.order !== undefined) {
                mergedEntry.insertion_order = basePatch.order;
                mergedEntry.extensions = mergedEntry.extensions || {};
                mergedEntry.extensions.order = basePatch.order;
              } else if (basePatch.insertion_order !== undefined) {
                mergedEntry.insertion_order = basePatch.insertion_order;
                mergedEntry.extensions = mergedEntry.extensions || {};
                mergedEntry.extensions.order = basePatch.insertion_order;
              }
              // ===== ✅新增：keys 为空时，按<标签>分类+实体名自动派生（蓝灯不派生）=====
              const _tmplHere = getEntryTemplate(mergedEntry.comment || '');
              if ((!mergedEntry.keys || mergedEntry.keys.length === 0) && !((_tmplHere && _tmplHere.constant) || mergedEntry.constant)) {
                try {
                  mergedEntry.keys = _deriveEntryKeys(mergedEntry.comment, _tmplHere, mergedEntry.content);
                } catch (derr) { logWarn("_deriveEntryKeys", derr); }
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
                  keys: [],
                  secondary_keys: [],
                  extensions: {}
                }, basePatch);
                if (extPatch) newEntry.extensions = Object.assign({}, newEntry.extensions || {}, extPatch);

                // ===== 优先级：AI 显式元信息 > 内容特征推断 > 模板 > 通用兜底 =====
                // 1) 内容特征推断（只填 AI 没写的字段；ext 字段分流到 newEntry.extensions）
                try {
                  const inferred = inferEntryConfig(newEntry.comment || '', newEntry.content);
                  const _extMapForInfer = {
                    selectiveLogic:1, depth:1, position:1, sticky:1, cooldown:1, delay:1,
                    probability:1, useProbability:1, prevent_recursion:1, exclude_recursion:1,
                    delay_until_recursion:1, scan_depth:1, match_whole_words:1, case_sensitive:1,
                    use_group_scoring:1, group:1, group_weight:1, group_override:1, role:1,
                    outlet_name:1, automation_id:1, triggers:1, vectorized:1, ignore_budget:1, addMemo:1
                  };
                  if (!newEntry.extensions) newEntry.extensions = {};
                  Object.keys(inferred).forEach(function(k) {
                    if (_extMapForInfer[k]) {
                      if (newEntry.extensions[k] === undefined) newEntry.extensions[k] = inferred[k];
                    } else {
                      if (newEntry[k] === undefined) newEntry[k] = inferred[k];
                    }
                  });
                } catch (_) {}

                // 2) 模板兜底
                const _tmplNew = getEntryTemplate(newEntry.comment || '');
                if (_tmplNew) {
                  // MVU 系统条目强制使用模板的 selective/constant 值
                  const _isNewMvuSys = (String(newEntry.comment || '').toLowerCase().indexOf('变量输出格式') >= 0 ||
                    String(newEntry.comment || '').toLowerCase().indexOf('变量更新规则') >= 0 ||
                    String(newEntry.comment || '').toLowerCase().indexOf('[initvar]') >= 0 ||
                    String(newEntry.comment || '').indexOf('初始变量') >= 0 ||
                    String(newEntry.comment || '').indexOf('变量当前状态') >= 0);
                  if (_isNewMvuSys) {
                    newEntry.selective = _tmplNew.selective;
                    newEntry.constant = _tmplNew.constant;
                  } else {
                    if (newEntry.constant === undefined) newEntry.constant = _tmplNew.constant;
                    if (newEntry.selective === undefined) newEntry.selective = _tmplNew.selective;
                  }
                  if (newEntry.insertion_order === undefined) newEntry.insertion_order = _tmplNew.order;
                  // AI 显式写了顶层 order（操作块元信息）→ 优先级最高，覆盖模板值
                  if (newEntry.order !== undefined && newEntry.order !== null) {
                    newEntry.insertion_order = newEntry.order;
                  }
                  // 同步 extensions.order 与顶层 insertion_order：优先尊重 AI 显式写的 order
                  if (newEntry.extensions && newEntry.extensions.order !== undefined) {
                    newEntry.insertion_order = newEntry.extensions.order;
                  } else if (newEntry.extensions) {
                    newEntry.extensions.order = newEntry.insertion_order;
                  }
                  // AI 顶层 order 也回写到 extensions.order，保证导出/写入一致
                  if (newEntry.order !== undefined && newEntry.extensions) {
                    newEntry.extensions.order = newEntry.order;
                  }
                  if (newEntry.use_regex === undefined) newEntry.use_regex = _tmplNew.use_regex;
                  if (!newEntry.extensions) newEntry.extensions = {};
                  const ext = newEntry.extensions;
                  if (ext.position === undefined) ext.position = _tmplNew.position;
                  if (ext.depth === undefined) ext.depth = _tmplNew.depth;
                  if (ext.probability === undefined) ext.probability = _tmplNew.probability;
                  if (ext.useProbability === undefined) ext.useProbability = _tmplNew.useProbability;
                  if (ext.selectiveLogic === undefined) ext.selectiveLogic = _tmplNew.selectiveLogic;
                  if (ext.prevent_recursion === undefined) ext.prevent_recursion = _tmplNew.prevent_recursion;
                  if (ext.exclude_recursion === undefined) ext.exclude_recursion = _tmplNew.exclude_recursion;
                  if (ext.delay_until_recursion === undefined) ext.delay_until_recursion = _tmplNew.delay_until_recursion;
                  if (ext.scan_depth === undefined) ext.scan_depth = _tmplNew.scan_depth;
                  if (ext.group === undefined) ext.group = _tmplNew.group;
                  if (ext.group_weight === undefined) ext.group_weight = _tmplNew.group_weight;
                  if (ext.match_whole_words === undefined) ext.match_whole_words = _tmplNew.match_whole_words;
                  if (ext.sticky === undefined) ext.sticky = _tmplNew.sticky;
                  if (ext.cooldown === undefined) ext.cooldown = _tmplNew.cooldown;
                  if (ext.delay === undefined) ext.delay = _tmplNew.delay;
                }
                if (newEntry.position === undefined) delete newEntry.position;
                // ===== ✅新增：新条目 keys 为空自动派生 =====
                if ((!newEntry.keys || newEntry.keys.length === 0) && !(newEntry.constant || (_tmplNew && _tmplNew.constant))) {
                  try {
                    newEntry.keys = _deriveEntryKeys(newEntry.comment, _tmplNew, newEntry.content);
                  } catch (derr2) { logWarn("_deriveEntryKeys", derr2); }
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
              // ★只走规范化后的精确相等（去括号、小写化）。
              //   原先用 indexOf 子串匹配会"删林月连带删林月之章"——误删不可挽回，漏删会经 _deleteFailures 提示 AI 用精确 comment 重试。
              const shouldDelete = (ek === dk) || (strippedDk && strippedEk && strippedEk === strippedDk);
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
              // ===== Agent模式：不再拦截MVU内容写入顶层字段 =====
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
              changeLog._fieldNames = changeLog._fieldNames || [];
              if (changeLog._fieldNames.indexOf(fieldName) < 0) changeLog._fieldNames.push(fieldName);
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
        // 返回 { saved:boolean, reason:string, attempts:Array, suggestion:string }
        if (!aiText) return { saved: false, reason: 'NO_INPUT', attempts: [], suggestion: 'AI 未返回任何内容' };
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
        if (htmlBlocks.length === 0) {
          return { saved: false, reason: 'NO_HTML_BLOCK', attempts: [],
                   suggestion: 'AI 回复中没有任何 ```html 代码块' };
        }

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
            let cleaned = block;
            // 仅当含 JSON 转义特征（\"）时才整体还原转义；AI 直接输出的 ```html 保持原样
            if (cleaned.indexOf('\\"') >= 0) {
              if (cleaned.indexOf('\\n') >= 0) cleaned = cleaned.replace(/\\n/g, '\n');
              cleaned = cleaned.replace(/\\"/g, '"');
              if (cleaned.indexOf('\\\\') >= 0) cleaned = cleaned.replace(/\\\\/g, '\\');
            }
            statusBarHtml = cleaned;
            break;
          }
        }
        if (!statusBarHtml) {
          // ⚠️迭代：日志留痕——提取失败时打印各代码块的判定详情，方便排查"生成了但没保存"
          const attempts = htmlBlocks.map(function(blk) {
            let mc = 0;
            for (let k2 = 0; k2 < statusBarKeywords.length; k2++) {
              if (blk.indexOf(statusBarKeywords[k2]) >= 0) mc++;
            }
            let sc = 0;
            for (let s2 = 0; s2 < mustHaveStructure.length; s2++) {
              if (blk.indexOf(mustHaveStructure[s2]) >= 0) sc++;
            }
            return { len: blk.length, structCount: sc, keywordCount: mc, head: blk.slice(0, 80) };
          });
          try {
            console.warn('[statusbar] 未识别到状态栏HTML：共', htmlBlocks.length, '个代码块。各块判定：', attempts);
          } catch (_logErr) {}
          return { saved: false, reason: 'INSUFFICIENT_FEATURES', attempts: attempts,
                   suggestion: 'HTML 块缺少状态栏特征（需含 getAllVariables/stat_data/populateCharacterData 中至少1项，' +
                               '且 <!doctype>/<html>/<style>/<script> 中至少2项，状态栏关键词至少2个）' };
        }

        // 复用统一的保存函数，避免重复代码
        const _ok = saveStatusBarToCard(statusBarHtml);
        return { saved: !!_ok, reason: _ok ? 'OK' : 'SAVE_FAILED', attempts: [],
                 suggestion: _ok ? '' : '保存到卡片失败' };
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
          rxList[keepIdx].runOnEdit = true; // 与 _tavernWriteRegexScripts 的 run_on_edit=true 一致：编辑历史消息时按当前变量重渲染状态栏
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
          // ⚠️修复：first_mes为空时不再注入"（默认开场白）"文本——尊重用户无开场白的意图，只追加占位符确保状态栏可显示
          cardData.first_mes = '<StatusPlaceHolderImpl/>';
          console.warn('[statusbar] first_mes为空，仅追加 <StatusPlaceHolderImpl/> 占位符');
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

      // ===== 前端界面 Tab：[界面]正文美化 正则 查询/保存/提取 =====
      // 正则标识：id=frontend-beautify / frontend-beautify-<tag>，或 scriptName 含 [界面]正文美化
      // ⚠️多界面支持：正文美化可按用户意愿生成多个（不同正文标签并存，如 <story>信纸 + <diary>日记）
      function getFrontendBeautifyRegex() {
        const list = getFrontendBeautifyRegexes();
        return list.length > 0 ? list[0] : null;
      }

      // 全部正文美化正则（多个界面并存时逐条返回）
      function getFrontendBeautifyRegexes() {
        if (!cardData || !cardData.extensions || !Array.isArray(cardData.extensions.regex_scripts)) return [];
        return cardData.extensions.regex_scripts.filter(function(r) {
          return r && ((r.id || '').indexOf('frontend-beautify') === 0 || (r.scriptName || '').indexOf('[界面]正文美化') >= 0);
        });
      }

      function hasFrontendBeautifyRegex() {
        return getFrontendBeautifyRegexes().length > 0;
      }

      // 从正文美化HTML中提取正文标签名（extractContent 的 match(/<tag>.../) 正则推断）
      function extractBeautifyTagFromHtml(html) {
        const h = String(html || '');
        let m1 = h.match(/match\(\s*\/<([a-zA-Z][\w-]*)>/);
        if (m1 && m1[1]) return m1[1];
        m1 = h.match(/match\(\s*\/<\\?\s*([a-zA-Z][\w-]*)/);
        if (m1 && m1[1]) return m1[1];
        return 'story';
      }

      // 保存/覆盖 [界面]正文美化 正则（统一结构：AI输出[2] + 编辑时运行 + 仅格式显示）
      // ⚠️多界面去重规则：按正文标签（findRegex）匹配——同标签覆盖旧版，不同标签新增并存
      function saveFrontendRegexToCard(assembledHtml) {
        if (!assembledHtml || !cardData) return false;
        cardData.extensions = cardData.extensions || {};
        cardData.extensions.regex_scripts = Array.isArray(cardData.extensions.regex_scripts) ? cardData.extensions.regex_scripts : [];
        const rxList = cardData.extensions.regex_scripts;
        const wrappedHtml = '```\n' + assembledHtml + '\n```';
        const tag = extractBeautifyTagFromHtml(assembledHtml);
        const findRegex = '/<' + tag + '>[\\s\\S]*?<\\/' + tag + '>/g';
        // 同标签（findRegex 相同）→ 覆盖；不同标签 → 新增并存
        let targetIdx = -1;
        for (let j = 0; j < rxList.length; j++) {
          const r = rxList[j];
          if (!r) continue;
          const isFe = (r.id === 'frontend-beautify') || ((r.id || '').indexOf('frontend-beautify-') === 0) || ((r.scriptName || '').indexOf('[界面]正文美化') >= 0);
          if (isFe && r.findRegex === findRegex) {
            targetIdx = j;
            break;
          }
        }
        const hasClassic = rxList.some(function(r) {
          return r && r.id === 'frontend-beautify';
        });
        const useClassicId = (targetIdx >= 0 && rxList[targetIdx].id === 'frontend-beautify') || !hasClassic;
        const meta = {
          id: useClassicId ? 'frontend-beautify' : ('frontend-beautify-' + tag),
          scriptName: useClassicId ? '[界面]正文美化' : ('[界面]正文美化·' + tag),
          findRegex: findRegex,
          replaceString: wrappedHtml,
          trimStrings: [],
          placement: [2],
          disabled: false,
          markdownOnly: true,
          promptOnly: false,
          runOnEdit: true, // 用户模板：在编辑时运行
          substituteRegex: 0,
          minDepth: null,
          maxDepth: null
        };
        if (targetIdx >= 0) {
          // 覆盖更新：保留原有 id/scriptName（用户可能已重命名）
          meta.id = rxList[targetIdx].id || meta.id;
          meta.scriptName = rxList[targetIdx].scriptName || meta.scriptName;
          rxList[targetIdx] = meta;
          console.warn('[frontend] 覆盖正文美化（标签<' + tag + '>）:', meta.scriptName);
        } else {
          rxList.push(meta);
          if (!useClassicId) console.warn('[frontend] 新增正文美化界面（标签<' + tag + '>，与已有界面并存）:', meta.scriptName);
        }
        cardData.extensions.regex_scripts = rxList;
        return true;
      }

      // ===== 兜底：从AI回复中提取前端界面HTML（当AI只输出```html而非JSON时）=====
      // 场景：用户让AI"做正文美化/改前端界面"，AI直接输出了```html代码块而非JSON的regex_scripts
      // 识别特征（对齐用户模板）：getMessageData + extractContent + renderPage + getChatMessages + getCurrentMessageId
      function tryExtractFrontendRegexHtml(aiText) {
        if (!aiText) return false;
        // 匹配所有 ```html 代码块
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

        // 黑名单：状态栏/世界书/MVU 内容（这些不是前端界面正则）
        const wordBlacklist = ['<statusblock>', '</statusblock>', 'StatusPlaceHolderImpl',
          'stat_data', 'getAllVariables', 'VARIABLE_UPDATE_ENDED', 'Mvu.events',
          'InitVar', 'mvu_update', '变量更新规则', '变量输出格式',
          'character_book', 'insertion_order', '```json', '```js', '```yaml',
          '信息完整度', '需要您补充的信息'
        ];
        // 结构验证：完整HTML文档特征
        const mustHaveStructure = ['<!doctype', '<html', '<style', '<script'];
        // 前端界面专属特征（对齐用户模板：getMessageData + extractContent + renderPage）
        const feKeywords = ['getMessageData', 'extractContent', 'renderPage', 'getChatMessages',
          'getCurrentMessageId', 'story-container', 'init()', '$(function'
        ];
        // 前端核心特征（模板必备入口，至少命中1个）
        const feCoreFeatures = ['getMessageData', 'extractContent', 'getChatMessages', 'getCurrentMessageId'];
        // ⚠️多界面批量：一次回复里的所有正文美化代码块全部收集保存（不同正文标签并存，同标签覆盖）
        const frontendHtmlList = [];
        for (let i = 0; i < htmlBlocks.length; i++) {
          const block = htmlBlocks[i];
          // 黑名单过滤
          let hitBlack = false;
          for (let b = 0; b < wordBlacklist.length; b++) {
            if (block.indexOf(wordBlacklist[b]) >= 0) {
              hitBlack = true;
              break;
            }
          }
          if (hitBlack) continue;
          // ⚠️类型互斥：含 parseData 且不含 extractContent 的代码块是「结构化数据面板」HTML，
          // 由 extractStructuredPanelsBatch 负责保存（含无标记兜底），此处不抢存
          if (block.indexOf('parseData') >= 0 && block.indexOf('extractContent') < 0) continue;
          // 结构验证：至少出现2个HTML结构标签
          let structCount = 0;
          for (let s = 0; s < mustHaveStructure.length; s++) {
            if (block.indexOf(mustHaveStructure[s]) >= 0) structCount++;
          }
          if (structCount < 2) continue;
          // 前端核心特征：至少1个
          let coreCount = 0;
          for (let c = 0; c < feCoreFeatures.length; c++) {
            if (block.indexOf(feCoreFeatures[c]) >= 0) coreCount++;
          }
          if (coreCount < 1) continue;
          // 特征关键词：至少2个即认定
          let matchCount = 0;
          for (let k = 0; k < feKeywords.length; k++) {
            if (block.indexOf(feKeywords[k]) >= 0) matchCount++;
          }
          if (matchCount >= 2) {
            // ⚠️修复：\n 必须是字面两字符保留（正文美化模板的 split(/\n\s*\n/) 依赖字面转义，酒馆正则按字面\n匹配换行）。
            // 仅当代码块是 JSON 转义字符串（含 \"）时才还原 \\n→换行、\\"→"、\\\\→\；
            // AI 直接输出 ```html 代码块时不做任何替换，保证 \n 原样写入。
            let cleaned = block;
            if (cleaned.indexOf('\\"') >= 0) {
              if (cleaned.indexOf('\\n') >= 0) cleaned = cleaned.replace(/\\n/g, '\n');
              cleaned = cleaned.replace(/\\"/g, '"');
              if (cleaned.indexOf('\\\\') >= 0) cleaned = cleaned.replace(/\\\\/g, '\\');
            }
            frontendHtmlList.push(cleaned);
          }
        }
        if (frontendHtmlList.length === 0) {
          // 迭代：日志留痕——提取失败时打印各代码块的判定详情
          try {
            console.warn('[frontend] 未识别到前端界面HTML：共', htmlBlocks.length, '个代码块。各块判定：',
              htmlBlocks.map(function(blk) {
                let mc = 0;
                for (let k2 = 0; k2 < feKeywords.length; k2++) {
                  if (blk.indexOf(feKeywords[k2]) >= 0) mc++;
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

        // 复用统一的保存函数（逐块保存：同正文标签覆盖，不同标签新增并存）
        let _savedAny = false;
        frontendHtmlList.forEach(function(feHtml) {
          if (saveFrontendRegexToCard(feHtml)) _savedAny = true;
        });
        if (_savedAny) {
          // ⚠️修复：① 自动生成「规范AI输出」的正文美化世界书条目（[前端正文美化]，多界面时列出全部标签）
          //         ② 自动把现有正文（开场白）用首个正文标签包裹，让正文美化正则立即生效
          try {
            saveBeautifyWorldInfoEntry();
          } catch (_beErr) {
            logWarn('frontend', _beErr);
          }
          try {
            wrapExistingStoryWithBeautifyTag();
          } catch (_wrErr) {
            logWarn('frontend', _wrErr);
          }
        }
        return _savedAny;
      }

      // ===== 正文美化世界书条目（规范AI输出 <story> 正文，与结构化面板条目并列）=====

      // 保存/覆盖「规范AI输出」的正文美化世界书条目（[前端正文美化]）
      // ⚠️多界面：正文美化有多个（不同正文标签）时，条目列出全部标签供AI按场景选用
      function saveBeautifyWorldInfoEntry() {
        if (!cardData) return false;
        cardData.character_book = cardData.character_book || {
          entries: []
        };
        cardData.character_book.entries = Array.isArray(cardData.character_book.entries) ? cardData.character_book.entries : [];
        const entries = cardData.character_book.entries;
        const entryName = '[界面]正文美化';
        const comment = '[前端正文美化]';
        // 收集当前全部正文美化标签（多界面并存时全部列出）
        const feList = getFrontendBeautifyRegexes();
        const tags = feList.map(function(r) {
          return extractBeautifyTagFromHtml(String(r.replaceString || ''));
        }).filter(function(t, i, a) {
          return t && a.indexOf(t) === i;
        });
        if (tags.length === 0) tags.push('story');
        const primary = tags[0];
        const tagRules = tags.map(function(t) {
          return '<' + t + '>\n（正文内容，对话行与叙述行按场景自由排版，可使用{{char}}/{{user}}等宏）\n</' + t + '>';
        }).join('\n（或）\n');
        const content = '<正文>\n' +
          '**注意事项**：1) AI输出的正文内容（对话、叙述、旁白）必须放在 <' + primary + '> 与 </' + primary + '> 标签之间' +
          (tags.length > 1 ? '（存在多种正文界面时按场景选用其一：' + tags.join('、') + '，禁止嵌套使用）' : '') +
          '；2) 严禁使用<think>、<thinking>、<content>标签；3) 闭合正文标签后禁止输出其他内容；4) {{}}不是格式的一部分，输出时禁止携带。\n\n' +
          '#触发条件说明\n' +
          '当AI输出正文/叙述/对话内容时，必须按以下 Format 输出：\n' +
          'Format:\n' +
          tagRules;
        // 去重：按 comment 或 name 匹配覆盖
        let targetIdx = -1;
        for (let j = 0; j < entries.length; j++) {
          const e = entries[j];
          if ((e.comment || '').indexOf('[前端正文美化]') >= 0 || (e.name === entryName)) {
            targetIdx = j;
            break;
          }
        }
        const entry = {
          uid: 'frontend-wi-beautify-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          keys: ['正文', 'story'],
          comment: comment,
          content: content,
          constant: false,
          selective: true,
          insertion_order: 100,
          enabled: true,
          name: entryName,
          extensions: {
            position: 1
          }
        };
        if (targetIdx >= 0) {
          entry.uid = entries[targetIdx].uid || entry.uid;
          entries[targetIdx] = entry;
        } else {
          entries.push(entry);
        }
        cardData.character_book.entries = entries;
        return true;
      }

      // 删除正文美化世界书条目（清除正则时联动）
      function removeBeautifyWorldInfoEntry() {
        if (!cardData || !Array.isArray(cardData.character_book && cardData.character_book.entries)) return false;
        cardData.character_book.entries = cardData.character_book.entries.filter(function(e) {
          return !((e.comment || '').indexOf('[前端正文美化]') >= 0);
        });
        return true;
      }

      // 自动把现有正文（开场白 first_mes）用正文标签包裹（生成正文美化后立即生效）
      // ⚠️多界面：用首个正文美化的标签包裹；已被任一正文标签包裹则跳过（防重复包裹）
      function wrapExistingStoryWithBeautifyTag() {
        if (!cardData || !cardData.first_mes || !String(cardData.first_mes).trim()) return false;
        const mes = String(cardData.first_mes);
        // 已被任一正文美化标签包裹则跳过
        const feList = getFrontendBeautifyRegexes();
        for (let i = 0; i < feList.length; i++) {
          const tg = extractBeautifyTagFromHtml(String(feList[i].replaceString || ''));
          if (tg && mes.indexOf('<' + tg) >= 0) return false;
        }
        if (/<story[\s>][\s\S]*<\/story>/i.test(mes)) return false;
        const primaryTag = feList.length > 0 ? extractBeautifyTagFromHtml(String(feList[0].replaceString || '')) : 'story';
        const trimmed = mes.trim();
        cardData.first_mes = '<' + primaryTag + '>\n' + trimmed + '\n</' + primaryTag + '>';
        return true;
      }

      // ====================================================================
      // ===== 结构化数据美化模板（[界面]页面名称 正则 + 规范AI输出的世界书条目）=====
      // ====================================================================
      // 适用于状态栏、论坛、任务面板等「AI输出特定格式数据」的界面美化（非MVU变量美化）。
      // 生成三件套：① [界面]页面名称 正则（<标签名>...</标签名> → HTML）② 界面HTML代码 ③ 规范AI输出的世界书条目

      // 当前全部结构化数据正则（id 前缀 frontend-structured-）
      function getFrontendStructuredRegexes() {
        if (!cardData || !cardData.extensions || !Array.isArray(cardData.extensions.regex_scripts)) return [];
        return cardData.extensions.regex_scripts.filter(function(r) {
          return r && (r.id || '').indexOf('frontend-structured-') === 0;
        });
      }

      // 从HTML推断数据格式：pipe=[字段名|值] | kv=键值对 | both=两者兼容
      function detectStructuredDataFormat(html) {
        const h = html || '';
        const hasPipe = (h.indexOf("split('|')") >= 0) || (h.indexOf("split(\"|\")") >= 0) || /\[\w+\|[\s\S]*?\]/.test(h);
        const hasKv = (h.indexOf("split(':')") >= 0) || (h.indexOf("split(\":\")") >= 0) || (h.indexOf('kv[0].trim()') >= 0);
        if (hasPipe && hasKv) return 'both';
        if (hasPipe) return 'pipe';
        if (hasKv) return 'kv';
        return 'pipe';
      }

      // 从AI回复提取页面名称：【页面名称】xxx / 页面名称：xxx
      function extractPageNameFromReply(aiText) {
        if (!aiText) return '';
        const m1 = aiText.match(/【页面名称】\s*([^\n【】]+)/);
        if (m1 && m1[1]) return m1[1].trim();
        const m2 = aiText.match(/【页面名】\s*([^\n【】]+)/);
        if (m2 && m2[1]) return m2[1].trim();
        const m3 = aiText.match(/页面名称?\s*[:：]\s*([^\n]+)/);
        if (m3 && m3[1]) return m3[1].trim();
        return '';
      }

      // 从AI回复提取标签名：【标签名】xxx / 标签名：xxx
      function extractTagNameFromReply(aiText) {
        if (!aiText) return '';
        const m1 = aiText.match(/【标签名】\s*([^\n【】]+)/);
        if (m1 && m1[1]) return m1[1].trim();
        const m2 = aiText.match(/标签名\s*[:：]\s*([^\n]+)/);
        if (m2 && m2[1]) return m2[1].trim();
        return '';
      }

      // 保存/覆盖 [界面]页面名称 正则（按 scriptName 去重）
      function saveStructuredFrontendRegex(pageName, tagName, assembledHtml) {
        if (!pageName || !tagName || !assembledHtml || !cardData) return false;
        cardData.extensions = cardData.extensions || {};
        cardData.extensions.regex_scripts = Array.isArray(cardData.extensions.regex_scripts) ? cardData.extensions.regex_scripts : [];
        const rxList = cardData.extensions.regex_scripts;
        const wrappedHtml = '```\n' + assembledHtml + '\n```';
        const scriptName = '[界面]' + pageName;
        const idBase = 'frontend-structured-' + String(pageName).replace(/[^\w\u4e00-\u9fa5]/g, '');
        // 去重：scriptName 相同或 id 相同则覆盖
        let targetIdx = -1;
        for (let j = 0; j < rxList.length; j++) {
          const r = rxList[j];
          if (!r) continue;
          const isSt = (r.id === idBase) || ((r.scriptName || '') === scriptName);
          if (isSt) {
            targetIdx = j;
            break;
          }
        }
        const findRegex = '/<' + tagName + '>[\\s\\S]*?<\\/' + tagName + '>/g';
        const meta = {
          id: idBase,
          scriptName: scriptName,
          findRegex: findRegex,
          replaceString: wrappedHtml,
          trimStrings: [],
          placement: [2],
          disabled: false,
          markdownOnly: true,
          promptOnly: false,
          runOnEdit: true, // 用户模板：在编辑时运行
          substituteRegex: 0,
          minDepth: null,
          maxDepth: null
        };
        if (targetIdx >= 0) {
          rxList[targetIdx] = meta;
        } else {
          rxList.push(meta);
        }
        cardData.extensions.regex_scripts = rxList;
        return true;
      }

      // 保存/覆盖「规范AI输出」的结构化世界书条目（标题=此前端名称）
      function saveStructuredWorldInfoEntry(pageName, tagName, dataFormat) {
        if (!pageName || !tagName || !cardData) return false;
        cardData.character_book = cardData.character_book || {
          entries: []
        };
        cardData.character_book.entries = Array.isArray(cardData.character_book.entries) ? cardData.character_book.entries : [];
        const entries = cardData.character_book.entries;
        const entryName = '[界面]' + pageName;
        const comment = '[前端数据面板]' + pageName;
        // 数据格式示例行（按推断的格式生成）
        let fmtLines = '';
        if (dataFormat === 'kv') {
          fmtLines = '字段名: 值\n字段名2: 值2';
        } else if (dataFormat === 'both') {
          fmtLines = '[字段名|值]\n[字段名2|值2]\n字段名: 值';
        } else {
          fmtLines = '[字段名|值]\n[字段名2|值2]';
        }
        const content = '<' + pageName + '>\n' +
          '**注意事项**：1) 严禁使用<think>、<thinking>、<content>标签；2) 闭合</' + tagName + '>标签后禁止输出其他内容；3) {{}}不是格式的一部分，输出时禁止携带。\n\n' +
          '#触发条件说明\n' +
          '当需要展示' + pageName + '相关数据时，必须按以下 Format 输出：\n' +
          'Format:\n' +
          '<' + tagName + '>\n' + fmtLines + '\n' +
          '</' + tagName + '>';
        // 去重：按 comment 或 name 匹配覆盖
        let targetIdx = -1;
        for (let j = 0; j < entries.length; j++) {
          const e = entries[j];
          const cmt = (e.comment || '');
          if (cmt.indexOf('[前端数据面板]') >= 0 && (cmt === comment || (e.name === entryName))) {
            targetIdx = j;
            break;
          }
        }
        const entry = {
          uid: 'frontend-wi-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          keys: [tagName, pageName],
          comment: comment,
          content: content,
          constant: false,
          selective: true,
          insertion_order: 100,
          enabled: true,
          name: entryName,
          extensions: {
            position: 1
          }
        };
        if (targetIdx >= 0) {
          entry.uid = entries[targetIdx].uid || entry.uid;
          entries[targetIdx] = entry;
        } else {
          entries.push(entry);
        }
        cardData.character_book.entries = entries;
        return true;
      }

      // 清除全部结构化数据面板（正则 + 世界书条目 + 开场白注入的示例块）
      function removeStructuredFrontendAll() {
        if (!cardData) return false;
        cardData.extensions = cardData.extensions || {};
        cardData.extensions.regex_scripts = Array.isArray(cardData.extensions.regex_scripts) ? cardData.extensions.regex_scripts : [];
        cardData.extensions.regex_scripts = cardData.extensions.regex_scripts.filter(function(r) {
          return !(r && (r.id || '').indexOf('frontend-structured-') === 0);
        });
        if (cardData.character_book && Array.isArray(cardData.character_book.entries)) {
          cardData.character_book.entries = cardData.character_book.entries.filter(function(e) {
            return !((e.comment || '').indexOf('[前端数据面板]') >= 0);
          });
        }
        // 还原开场白：移除写卡器注入的示例块（带特征注释 <!-- 写卡器注入[标签]示例 -->）
        try {
          const mes = String(cardData.first_mes || '');
          if (mes) {
            cardData.first_mes = mes.replace(/\n{0,2}\s*<!--\s*写卡器注入\[[^\]]+\]示例\s*-->[\s\S]*?<\/[a-zA-Z][\w-]*>/g, '');
          }
        } catch (_cleanErr) {}
        return true;
      }

      // 从AI回复提取可选的开场白示例：【开场白示例】...（可选，AI可提供具体示例数据，写卡器自动包裹标签注入开场白）
      function extractFirstMesSampleFromReply(aiText) {
        if (!aiText) return '';
        const m = aiText.match(/【开场白示例】\s*([\s\S]*?)(?=\n\s*【[^】]+】|$)/);
        if (m && m[1]) return m[1].trim();
        return '';
      }

      // 按推断的数据格式生成通用示例（与结构化世界书条目的 Format 对齐）
      function buildStructuredSampleByFormat(dataFormat) {
        if (dataFormat === 'kv') return '字段名: 值\n字段名2: 值2';
        if (dataFormat === 'both') return '[字段名|值]\n[字段名2|值2]\n字段名: 值';
        return '[字段名|值]\n[字段名2|值2]';
      }

      // 自动把结构化面板示例注入开场白（生成结构化面板后立即生效，让正则一进酒馆就能渲染）
      // 带特征注释便于清除；开场白已含该标签则跳过（不重复注入）
      function injectStructuredSampleToFirstMes(tagName, sampleText) {
        if (!cardData || !tagName) return false;
        const mes = String(cardData.first_mes || '');
        const _escTagName = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tagRe = new RegExp('<' + _escTagName + '[\\s>]');
        if (tagRe.test(mes)) return false;
        const sample = (sampleText && String(sampleText).trim()) ? String(sampleText).trim() : buildStructuredSampleByFormat('pipe');
        const injected = '\n\n<!-- 写卡器注入[' + tagName + ']示例 -->\n<' + tagName + '>\n' + sample + '\n</' + tagName + '>';
        cardData.first_mes = mes + injected;
        return true;
      }

      // 从AI回复提取结构化面板三件套（【页面名称】【标签名】+ HTML → 正则 + 世界书条目）
      // 成功返回 {pageName, tagName}，失败返回 null
      // ⚠️统一委托批量版：单面板/多面板/标记在HTML后/无标记兜底 全走 extractStructuredPanelsBatch 同一套逻辑
      function tryExtractStructuredFrontendHtml(aiText) {
        if (!aiText) return null;
        const savedList = extractStructuredPanelsBatch(aiText);
        if (!Array.isArray(savedList) || savedList.length === 0) return null;
        const pageName = savedList[0];
        const rx = getFrontendStructuredRegexes().filter(function(r) {
          return r && r.scriptName === '[界面]' + pageName;
        })[0];
        let tagName = '';
        if (rx) {
          const fm = String(rx.findRegex || '').match(/<([a-zA-Z][\w-]*)>/);
          tagName = fm && fm[1] ? fm[1] : '';
        }
        return {
          pageName: pageName,
          tagName: tagName
        };
      }

      // ===== 批量提取结构化面板（Agent Loop 批量产出配套，可按用户意愿生成任意多个）=====
      // 一次AI回复可包含多个面板组（【页面名称】+【标签名】+【HTML】代码块 各自成组）。
      // ⚠️修复（用户反馈"生成其他前端美化都加不到写卡器里"）：
      //   旧实现按【页面名称】分段、段内找HTML——①标记在HTML代码块之后时段内无HTML→整组丢失；
      //   ②AI漏写【页面名称】标记时面板HTML被所有提取器静默丢弃。
      //   新实现：全局收集面板块与标记，按位置就近配对；无标记的面板块按parseData正则推断标签兜底保存。
      function extractStructuredPanelsBatch(aiText) {
        if (!aiText) return [];
        const saved = [];
        const text = String(aiText);
        const stBlacklist = ['<statusblock>', '</statusblock>', 'stat_data', 'getAllVariables',
          'VARIABLE_UPDATE_ENDED', 'Mvu.events', 'InitVar', 'mvu_update', '变量更新规则',
          '变量输出格式', 'character_book', 'insertion_order', '信息完整度'
        ];
        // 1. 全局收集HTML代码块（带位置，```html 优先，回退任意```含HTML文档特征的块）
        const htmlBlocks = [];
        const htmlRe = /```html[ \t]*\r?\n?([\s\S]*?)\r?\n?```/gi;
        let m;
        while ((m = htmlRe.exec(text)) !== null) {
          htmlBlocks.push({ content: m[1], start: m.index, end: m.index + m[0].length });
        }
        if (htmlBlocks.length === 0) {
          const genericRe = /```[ \t]*\r?\n?([\s\S]*?)\r?\n?```/g;
          while ((m = genericRe.exec(text)) !== null) {
            if (/<html|<!doctype|<head/i.test(m[1])) {
              htmlBlocks.push({ content: m[1], start: m.index, end: m.index + m[0].length });
            }
          }
        }
        if (htmlBlocks.length === 0) return [];
        // 2. 判定面板块：parseData特征（必备）+ 黑名单 + 完整文档 + 排除MVU状态栏特征
        const isPanelBlock = function(block) {
          for (let b = 0; b < stBlacklist.length; b++) {
            if (block.indexOf(stBlacklist[b]) >= 0) return false;
          }
          // MVU状态栏特征（populateCharacterData/waitGlobalInitialized）不是数据面板
          if (block.indexOf('populateCharacterData') >= 0 || block.indexOf('waitGlobalInitialized') >= 0) return false;
          if (!/<!doctype|<html|<head/i.test(block)) return false;
          // 面板必备 parseData；含 extractContent 无 parseData 的是正文美化块（互斥）
          if (block.indexOf('parseData') < 0) return false;
          return true;
        };
        const panelBlocks = htmlBlocks.filter(function(pb) {
          return isPanelBlock(pb.content);
        });
        if (panelBlocks.length === 0) return [];
        // 3. 全局收集【页面名称】/【标签名】标记（带位置）
        const markers = [];
        const mkRe = /【页面名称】\s*([^\n【]+)/g;
        while ((m = mkRe.exec(text)) !== null) {
          const pageName = String(m[1]).trim();
          if (!pageName) continue;
          const tm = text.slice(m.index, m.index + 600).match(/【标签名】\s*([^\n【]+)/);
          markers.push({ pageName: pageName, tagName: tm ? String(tm[1]).trim() : '', pos: m.index });
        }
        // 4. 配对：每个标记优先取其后最近的未用面板块；没有则回退取其前最近的未用块（标记在HTML后的场景）
        const used = {};
        const pairs = [];
        markers.forEach(function(mk) {
          let target = -1;
          for (let i = 0; i < panelBlocks.length; i++) {
            if (!used[i] && panelBlocks[i].start > mk.pos) { target = i; break; }
          }
          if (target < 0) {
            // 回退配对：取位置最接近标记的未用块（避免"块1、标记1、块2、标记2"顺序交错时乱配）
            let bestDist = Infinity;
            for (let i = 0; i < panelBlocks.length; i++) {
              if (used[i]) continue;
              const d = Math.abs(panelBlocks[i].start - mk.pos);
              if (d < bestDist) { bestDist = d; target = i; }
            }
          }
          if (target >= 0) {
            used[target] = true;
            pairs.push({ pageName: mk.pageName, tagName: mk.tagName, block: panelBlocks[target].content, sampleText: '' });
          }
        });
        // 5. 兜底：无标记的面板块（AI漏写【页面名称】）→ 从parseData正则推断标签，按标签名保存（不再丢弃）
        panelBlocks.forEach(function(pb, i) {
          if (used[i]) return;
          let tagName = '';
          const tagGuess = pb.content.match(/match\(\s*\/<([a-zA-Z][\w-]*)/);
          if (tagGuess && tagGuess[1]) tagName = tagGuess[1];
          if (!tagName) {
            const tagGuess2 = pb.content.match(/<([a-zA-Z][\w-]*)>\\?\(/);
            if (tagGuess2) tagName = tagGuess2[1];
          }
          if (!tagName) tagName = 'panel';
          pairs.push({ pageName: tagName, tagName: tagName, block: pb.content, sampleText: '', inferred: true });
          console.warn('[frontendBatch] 面板HTML未带【页面名称】标记，已按标签<' + tagName + '>兜底保存（不丢弃）');
        });
        // 6. 逐组保存（正则 + 世界书条目 + 开场白示例注入）
        pairs.forEach(function(p) {
          try {
            // 标签名兜底：从 parseData 的 match(/<xxx>...<\/xxx>/) 正则推断
            if (!p.tagName) {
              const tagGuess = p.block.match(/match\(\s*\/<([a-zA-Z][\w-]*)/);
              p.tagName = tagGuess ? tagGuess[1] : 'panel';
            }
            const okRx = saveStructuredFrontendRegex(p.pageName, p.tagName, p.block);
            if (!okRx) return;
            const dataFormat = detectStructuredDataFormat(p.block);
            saveStructuredWorldInfoEntry(p.pageName, p.tagName, dataFormat);
            // 开场白示例注入（多面板各自注入；无标记兜底组用格式默认示例）
            try {
              const sampleText = p.sampleText || extractFirstMesSampleFromReply(text) || buildStructuredSampleByFormat(dataFormat);
              injectStructuredSampleToFirstMes(p.tagName, sampleText);
            } catch (_injErr) {
              logWarn('frontendBatch', _injErr);
            }
            saved.push(p.pageName);
          } catch (e) {
            logWarn('frontendBatch', e);
          }
        });
        return saved;
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
      // opts（可选）：{ agentStep: true, stepIdx: N } —— Agent循环单步执行模式（agentLoop 调用）
      //   agentStep 模式：使用 Agent 任务指令提示词，应用后解析控制标记并返回步骤结果给 agentLoop
      // 返回值：agentStep 时返回 { produced, control: 'next'|'done'|'skip' }；普通模式返回 null
      async function callAIChat(opts) {
        opts = opts || {};
        if (isGenerating) return null;
        isGenerating = true;
        _abortRequested = false;
        try { window.__cwAbortRequested = false; } catch (_abReset) {}
        setEnabled(false);
        addTyping();
        pushWorkToast(opts.agentStep ? 'Agent执行中...' : '正在思考...', 'working');
        try {
          // ========== 启用队列模式：所有addAssistantMsg调用收集到队列，最后合并为一条消息 ==========
          _aiChatQueueMode = true;
          _aiChatNotesQueue = [];
          const curTabMessages = getCurrentMessages();
          // ===== 执行边界锁：上一条AI回复如果是报告，且用户本轮回复了"确认"，注入报告作为执行契约 =====
          let _execContractBlock = '';
          try {
            const _msgs = getCurrentMessages();
            // 找上一条 assistant 消息
            let _prevAi = null;
            for (let _i = _msgs.length - 1; _i >= 0; _i--) {
              if (_msgs[_i] && _msgs[_i].role === 'assistant') { _prevAi = _msgs[_i].content; break; }
              if (_msgs[_i] && _msgs[_i].role === 'user') break;   // 只追溯最近一条 assistant
            }
            // 找本轮 user 消息
            const _curUser = (function() {
              for (let _i = _msgs.length - 1; _i >= 0; _i--) {
                if (_msgs[_i] && _msgs[_i].role === 'user') return String(_msgs[_i].content || '');
              }
              return '';
            })();
            // 判定：上一条AI是报告 + 本轮是确认
            const _isPrevReport = _prevAi && /新增条目|生成计划|我理解你想要|世界观设定/.test(_prevAi);
            const _isConfirm = /^(确认|开始|OK|ok|可以|go|Go|做吧|执行|同意|好的|好|行)\s*[。！!]?\s*$/.test(_curUser.trim());
            if (_isPrevReport && _isConfirm) {
              // 从报告里抽"新增条目"段（从"新增条目"到下一个大段标记为止）
              const _m = _prevAi.match(/新增条目[\s\S]*?(?=修改内容|优先级安排|报告结束|——\s*报告结束)/);
              const _clause = _m ? _m[0].slice(0, 3000) : '';
              if (_clause) {
                _execContractBlock =
                  '\n\n═══════════════════════════════════════════════════════════════════\n' +
                  '🔒【本次执行契约 · 上轮报告已被用户确认，严格按此执行】\n' +
                  '═══════════════════════════════════════════════════════════════════\n' +
                  '用户已确认你上轮输出的生成计划。**本轮只输出该计划范围内的产物，不得越界**。\n\n' +
                  '【已确认的执行清单】\n' + _clause + '\n\n' +
                  '【执行铁律】\n' +
                  '  1. 只生成清单里列出的条目 / 只改动清单里列出的内容\n' +
                  '  2. 严禁"顺手多做"——清单外的角色/条目/开场白/变量/界面一律不生成\n' +
                  '  3. 若执行中发现清单有误：可以先说明问题再调整；范围变化较大时等用户确认。\n' +   // ★P2-21：不再"先停下报告问题"一刀切
                  '  4. 按清单中的 position/depth/order 严格执行，不得擅自改权重\n' +
                  '═══════════════════════════════════════════════════════════════════\n';
              }
            }
          } catch (_ecErr) { logWarn('execContract', _ecErr); }
          // ========== Agent步骤模式：注入任务指令（计划总览+当前步骤+控制标记协议）；普通模式走统一提示词 ==========
          let prompt = opts.agentStep ?
            buildPrompt(cardData, cardGenerated, curTabMessages, buildAgentDirective(opts.stepIdx)) :
            buildPrompt(cardData, cardGenerated, curTabMessages);
          // 注入全局人设（AI/用户人设，从 localStorage 读取，头像菜单可编辑）
          const _personaHdr = getPersonaHeader();
          if (_personaHdr) prompt = _personaHdr + '\n\n' + prompt;
          // 执行契约注入：报告确认后，把已确认清单拼进 prompt（放在人设之后、调用 AI 之前）
          if (_execContractBlock) prompt = prompt + _execContractBlock;
          let aiResponse = await callAI(prompt);
          // ===== 中止检查点：用户已请求停止 → 丢弃本次结果，不写入任何数据 =====
          if (_abortRequested) {
            removeTyping();
            showToast('⏹ 本次生成已停止，结果未写入卡片', 'info', 4000);
            return opts.agentStep ? { produced: false, control: 'skip', observation: '用户主动中止' } : null;
          }
          aiResponse = cleanAIReply(aiResponse);
          // ===== 中止检查点2：响应清理后再次确认（极少数异步竞态下兜底）=====
          if (_abortRequested) {
            removeTyping();
            return opts.agentStep ? { produced: false, control: 'skip', observation: '用户主动中止' } : null;
          }
          // 用户画像：一次 AI 调用成功返回
          try { UserProfile.recordAiCall(); } catch (_) {}

          // ===== Agent 模式：解析 <agent_understand> / <agent_options> 并抽取为可点选项 =====
          let _agentOptionsParsed = null;
          {
            const _uM = aiResponse.match(/<agent_understand>([\s\S]*?)<\/agent_understand>/i);
            const _oM = aiResponse.match(/<agent_options>([\s\S]*?)<\/agent_options>/i);
            if (_uM && _oM) {
              const _uText = _uM[1].trim();
              const _opts = String(_oM[1]).trim()
                .split(/\r?\n/)
                .map(function(l) {
                  return l.replace(/^\s*(?:\d+\s*[\.、．)）]|[-*•▪])\s*/, '').trim();
                })
                .filter(function(s) { return s.length > 1; });
              if (_opts.length >= 2) {
                _agentOptionsParsed = _opts.slice(0, 5); // 软上限5个
                // 从 aiResponse 里剥离两个块，改用自然段 + 强化理解内容
                aiResponse = aiResponse
                  .replace(/<agent_understand>[\s\S]*?<\/agent_understand>/gi, '')
                  .replace(/<agent_options>[\s\S]*?<\/agent_options>/gi, '')
                  .replace(/\n{3,}/g, '\n\n')
                  .trim();
                aiResponse = (aiResponse ? aiResponse + '\n\n' : '') +
                  '📋 **我的理解**：' + _uText +
                  '\n\n请从下方选项中选择一个方向，或直接在输入框描述你的想法：';
              }
            }
          }
          removeTyping();

          // ========== 🆕 保存cardData快照（用于头像菜单"撤回"回滚）==========
          // 在应用任何AI修改前保存；AI消息将落在 curTabMessages.length 索引处
          try {
            saveCardDataSnapshot(curTabMessages.length);
          } catch (_snapErr) {}

          // ========== Agent步骤产出跟踪：本轮AI回复是否产生了实际内容（操作块/JSON合并/HTML提取） ==========
          let _stepProduced = false;
          // ========== ReAct观察收集器：记录本轮每个行动的执行结果（成功明细/失败原因） ==========
          // 用途：①追加到AI消息尾部（用户可见+下轮AI可见）②agentLoop下一步的任务指令（观察→决策→修正）
          let _execNotes = [];

          // ========== 🆕 ::: 操作块协议优先检测 ==========
          // 如果AI回复包含:::操作块，走新协议路径（更简洁、零语法错误）
          // 否则回退到旧JSON路径（兼容）
          // ===== 报告阶段松绑（★松绑1.3/1.4/1.5）：不再强制报告、不再剥离产物、不再改写AI回复 =====
          // 若 AI 输出像报告（含报告特征词），做轻量质量检查：不达标只记 execNotes 供参考，不拦截不改写
          // ★松绑P1-2：触发条件收紧——≥2 个报告特征词，或含 <agent_plan> 标签，
          //   避免"AI 回答提问/条目正文里带单个词（如'世界观设定'）"误入质量检测
          // ★P2-3：emoji 不再作为判定依据——只有 <agent_plan> 或明确条目清单类措辞才触发质量检查
          const _hasReport = /<agent_plan>/i.test(aiResponse)
            || /(新增条目|拟新增|会新增|打算加|准备加)/.test(aiResponse);
          if (_hasReport) {
            // ★P2-9：报告完整度交给 AI 自行判断——只保留篇幅下限的轻提示
            const _quality = { length: (aiResponse || '').length };
            const _bad = [];
            if (_quality.length < 60) _bad.push('篇幅过短（' + _quality.length + '字，需 ≥60 字）');
            if (_bad.length > 0) {
              // ★松绑1.3：只在 execnotes 里记一笔（AI 与用户都能从对话历史看到），不改 aiResponse、不置 _stepProduced=false
              _execNotes.push('ℹ️ 报告可能不完整（' + _bad.join('；') + '）——若方向清晰可直接说"继续/直接做"');
            }

            // ★松绑1.5：<agent_options> 只在用户消息完全无删除/方向变更信号时才剥离（不再要求报告达标三重校验）
            if (/<agent_options>/i.test(aiResponse)) {
              const _lastUserForOpt = (function() {
                try {
                  const _msgs = getCurrentMessages();
                  for (let _li = _msgs.length - 1; _li >= 0; _li--) {
                    if (_msgs[_li] && _msgs[_li].role === 'user') return String(_msgs[_li].content || '');
                  }
                } catch (_eM) {}
                return '';
              })();
              const _hasMajorSignal = MAJOR_CHANGE_SIGNALS_RE.test(_lastUserForOpt);
              if (!_hasMajorSignal) {
                aiResponse = aiResponse
                  .replace(/<agent_options>[\s\S]*?<\/agent_options>/gi, '')
                  .replace(/<agent_understand>[\s\S]*?<\/agent_understand>/gi, '')
                  .replace(/\n{3,}/g, '\n\n').trim();
                _execNotes.push('ℹ️ 已剥除方案选项：本轮无删除/方向变更信号，建议直说需求');
              }
            }
          } else {
            // AI 完全没输出有效内容（无报告也无产物）时，才给出重试提示（松绑：不剥离、不拒收，仅提示）
            const _hasOpBlock = hasOpBlocks(aiResponse);
            const _hasHtml = /```html/i.test(aiResponse);
            const _hasAnyText = !!(aiResponse && aiResponse.trim().length >= 10);
            if (!_hasOpBlock && !_hasHtml && !_hasAnyText) {
              _execNotes.push('❌ AI 未输出任何内容——请重试或回复"直接做"跳过报告流程');
            }
          }
          let parsed = null;
          let _pendingChangeSummary = null;  // 本次变更摘要，供消息索引映射
          if (hasOpBlocks(aiResponse)) {
            const ops = parseOpBlocks(aiResponse);
            if (ops.length > 0) {
              const _entriesBeforeOps = _snapshotEntries();
              const opResult = applyOps(ops, cardData);
              if (opResult.modified) {
                _stepProduced = true;
                if (cardData.name && (cardData.description || (cardData.character_book && cardData.character_book.entries && cardData.character_book.entries.length > 0))) {
                  cardGenerated = true;
                }
                progress = calcProgress();
                // Agent模式：检测到InitVar条目后自动注入MVU固定资产（不再限定Tab）
                {
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
                try { _pendingChangeSummary = buildChangeSummary(_diffOps, crOps.fieldUpdates, crOps._fieldNames); } catch (_) {}
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
                // ReAct观察：操作应用成功明细
                if (partsOps.length) _execNotes.push('✅ 操作块已应用：' + partsOps.join('，'));
                // 用户画像：操作块增删改统计
                try { UserProfile.recordOpsChange(crOps); } catch (_) {}
                // ⚠️ 删除失败：把所有没命中的 key 明确告诉用户
                if (crOps._deleteFailures && crOps._deleteFailures.length > 0) {
                  const failList = crOps._deleteFailures.map(function(k, i) {
                    return (i + 1) + '. ⟦' + k + '⟧';
                  }).join('\n');
                  _execNotes.push('❌ 删除未命中（comment不精确，这些条目仍保留）：\n' + failList);
                }
                // op 参数校验失败提示
                if (crOps._opErrors && crOps._opErrors.length > 0) {
                  const _errList = crOps._opErrors.slice(0, 5).map(function(e, i) { return (i+1) + '. ' + e; }).join('\n');
                  _execNotes.push('❌ 操作参数校验失败（已跳过这些 op）：\n' + _errList);
                }
                // 合并为一条 toast，避免两个弹窗叠加轰炸
                try {
                  const _parts = [];
                  if (crOps._deleteFailures && crOps._deleteFailures.length > 0) {
                    _parts.push('删除未命中 ' + crOps._deleteFailures.length + ' 条（comment 不精确）');
                  }
                  if (crOps._opErrors && crOps._opErrors.length > 0) {
                    _parts.push('op 参数不合法 ' + crOps._opErrors.length + ' 个');
                  }
                  if (_parts.length) {
                    showToast('⚠️ 本批操作有问题：' + _parts.join('；') +
                      '\n💡删除：预览面板双击手动删，或让 AI 用精确 comment；op：见下方详情',
                      'warning', 8000);
                  }
                } catch (_) {}
                renderPreview();
                saveToStorage();
              } else if (ops.length > 0) {
                // ReAct观察：操作未产生任何修改（常见：delete的comment不精确）——带上具体未命中key便于下轮修正
                const _dfOps = (opResult.changeLog && opResult.changeLog._deleteFailures) || [];
                _execNotes.push('❌ 操作块已解析但未匹配到任何条目（未产生修改）——' +
                  (_dfOps.length ? '删除未命中：⟦' + _dfOps.join('⟧、⟦') + '⟧；请从上方「精确comment清单」复制字符级一致的字符串重试' : 'comment不精确/字段名无效；请从上方「精确comment清单」复制字符级一致的字符串重试'));
                showToast('⚠️ AI返回了操作指令，但未匹配到任何条目。请检查条目名称是否正确', 'warning', 6000);
                try { UserProfile.recordIdleLoop('ops-no-match'); } catch (_) {}
              }
            }
            // 跳过旧JSON路径（parsed 保持 null，下方 if(parsed) 自然跳过）
          } else {
            // ========== 旧JSON路径（兼容） ==========
            parsed = extractJSON(aiResponse);
          }
          if (parsed) {
            // ========== Agent模式：不过滤MVU内容（AI可在同一会话自由生成全部领域资产） ==========
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
                _stepProduced = true;
                if (cardData.name && (cardData.description || (cardData.character_book && cardData.character_book.entries && cardData.character_book.entries.length > 0))) {
                  cardGenerated = true;
                }
                progress = calcProgress();
                // ===== Agent模式：合并后确保MVU固定资产（bundle.js + 正则1-5）始终存在（不再限定Tab） =====
                // ⚠️仅自动注入 bundle.js 和正则1-5；变量结构脚本/WTC/<状态栏>占位符提醒/正则6 由 AI 按 9.1.6 工作流一条一条生成
                // 当AI生成了InitVar条目后，触发一次补注入（确保固定资产不丢）
                {
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
                  try { _pendingChangeSummary = buildChangeSummary(_entryDiff, changeLogResult ? changeLogResult.fieldUpdates : 0, changeLogResult ? changeLogResult._fieldNames : null); } catch (_) {}
                  if (changeLogResult) {
                    const cr = changeLogResult;
                    // 用户画像：JSON 合并路径的增删改统计
                    try { UserProfile.recordOpsChange(cr); } catch (_) {}
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
                    if (parts.length) _execNotes.push('✅ JSON修改已应用：' + parts.join('，'));
                    // mergePartial 路径下同样提示删除失败（AI走旧JSON协议、写 _delete/entries[{_action:delete}] 时的兜底提醒）
                    if (cr._deleteFailures && cr._deleteFailures.length > 0) {
                      const failList = cr._deleteFailures.map(function(k, i) {
                        return (i + 1) + '. ⟦' + k + '⟧';
                      }).join('\n');
                      _execNotes.push('❌ 删除未命中（这些条目仍保留）：\n' + failList);
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
                _execNotes.push('❌ 修改指令未匹配到任何条目（comment不精确，未产生修改）——需要用精确comment重试');
                showToast('⚠️ AI返回了修改指令，但未匹配到任何条目（可能comment不精确）。请让AI使用精确comment或在JSON中加_action:delete明确删除', 'warning', 6000);
                try { UserProfile.recordIdleLoop('json-no-match'); } catch (_) {}
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
          // ===== Agent模式：批量内容级自动提取（一次回复可同时包含多种产物，全部提取互不短路）=====
          // 提取器按代码块特征自判归属且互斥：
          //   状态栏HTML = populateCharacterData/getAllVariables/stat_data(MVU特征) — 唯一，存为正则6
          //   结构化面板 = getMessageData+parseData(【页面名称】分组) — 可多个，批量提取
          //   正文美化 = getMessageData+extractContent(renderPage) — 唯一，存为[界面]正文美化
          // 批量产出场景：状态栏 + 多个面板 + 美化 可混在同一次回复中，这里逐一全部提取保存
          let _htmlSavedCount = 0;
          try {
            const _sbResult = tryExtractStatusBarHtml(aiResponse);
            const _sbSavedMain = _sbResult && _sbResult.saved;
            if (_sbSavedMain) {
              _htmlSavedCount++;
              _execNotes.push('✅ MVU状态栏HTML已提取保存（正则6）');
              showToast('✅ 已从AI回答中提取MVU状态栏HTML并保存', 'success');
              try { UserProfile.recordStatusBarGenerated(); } catch (_) {}
              progress = calcProgress();
              // ⚠️P0修复：立即持久化——若后续步骤异常/用户直接关闭，内存里的状态栏正则不落盘会丢失
              saveToStorage();
              renderPreview();
            } else if (_sbResult && _sbResult.reason && _sbResult.reason !== 'NO_HTML_BLOCK' && _sbResult.attempts && _sbResult.attempts.length) {
              // 有 HTML 块但没识别为状态栏 → 明确告知原因
              const _detail = _sbResult.attempts.slice(0, 3).map(function(a, i) {
                return '  #' + (i+1) + ': ' + a.len + '字, 结构' + a.structCount + '/4, 关键词' + a.keywordCount;
              }).join('\n');
              _execNotes.push('⚠️ 状态栏提取未命中：' + (_sbResult.suggestion || '') + '\n' + _detail);
              console.warn('[statusbar] 提取失败:', _sbResult);
            }
          } catch (e) {
            logWarn('statusbar', e);
          }
          try {
            // 结构化数据面板：按【页面名称】分组批量提取（单面板兼容）
            const _stPanels = extractStructuredPanelsBatch(aiResponse);
            if (_stPanels && _stPanels.length > 0) {
              _htmlSavedCount += _stPanels.length;
              _execNotes.push('✅ 结构化面板已保存：[界面]' + _stPanels.join('、[界面]') + '（含规范条目+开场白示例注入）');
              showToast('✅ 已保存 ' + _stPanels.length + ' 个结构化面板：[界面]' + _stPanels.join('、[界面]') + '（含规范AI输出的世界书条目）', 'success');
              try { UserProfile.recordFrontendGenerated(_stPanels.length); } catch (_) {}
              saveToStorage();
              renderPreview();
              updateQuickActions();
              updateCtxBar();
            }
          } catch (e) {
            logWarn('frontend', e);
          }
          try {
            // 正文美化：[界面]正文美化 正则 + 自动生成对应世界书条目
            // （特征自检互斥：状态栏块被MVU词黑名单排除；结构化面板块有parseData无extractContent被跳过）
            const _feSaved = tryExtractFrontendRegexHtml(aiResponse);
            if (_feSaved) {
              _htmlSavedCount++;
              _execNotes.push('✅ 正文美化HTML已保存（[界面]正文美化正则 + 规范条目 + 开场白已包裹<story>）');
              showToast('✅ 已从AI回答中提取正文美化HTML并保存为「[界面]正文美化」正则', 'success');
              saveToStorage();
              renderPreview();
              updateQuickActions();
              updateCtxBar();
            }
          } catch (e) {
            logWarn('frontend', e);
          }
          // ⚠️失败可见化：回复里有HTML代码块但所有提取器都未识别时给出提示（Console有判定详情日志）
          if (_htmlSavedCount === 0) {
            const _hasFence = /```/.test(aiResponse || '');
            const _fenceLooksHtml = /```html|<!doctype|<html/i.test(aiResponse || '');
            if (_hasFence && _fenceLooksHtml) {
              _execNotes.push('❌ 回复中有HTML代码块但未识别为状态栏/前端界面（未保存）——请检查是否符合模板结构（getMessageData/parseData或populateCharacterData特征）');
              showToast('⚠️ AI回复中有HTML代码块，但未识别为状态栏/前端界面（未保存）。\n详情见浏览器Console的 [statusbar] / [frontend] 日志', 'warning', 7000);
            }
          }
          // 关键失败（HTML未保存）已经在 _execNotes 里，再加一次阻塞性 toast 保证用户不会漏看
          if (_htmlSavedCount === 0 && /```html|<!doctype|<html/i.test(aiResponse || '')) {
            const _hint = _execNotes.filter(function(n) { return /^❌/.test(String(n)); })[0] || '';
            try {
              showToast('❌ AI 输出了 HTML，但未通过写卡器识别，尚未保存到卡片\n' + (_hint ? '原因：' + _hint.slice(0, 80) : ''), 'error', 9000);
            } catch (_) {}
          }
          if (_htmlSavedCount > 0) _stepProduced = true;

          // ========== Agent Loop 收尾（ReAct核心：观察反馈 + 动态重规划 + 失败重试）==========
          let _agentCtl = null;
          if (opts.agentStep && agentPlan && agentPlan.steps && typeof opts.stepIdx === 'number' && agentPlan.steps[opts.stepIdx]) {
            const _skipMark = /<agent:skip>/i.test(aiResponse || '');
            const _doneMark = /<agent:done>/i.test(aiResponse || '');
            // —— 动态重规划：AI在执行中途输出新 <agent_plan> → 替换剩余步骤（基于观察调整策略）——
            // 门槛放宽到1步：重规划时剩余工作可能只有一件（初始计划仍需≥2步才触发循环）
            const _replan = parseAgentPlan(aiResponse, 1);
            if (_replan && _replan.steps && _replan.steps.length >= 1) {
              _replan.stepRuns = agentPlan.stepRuns || 0; // 继承防失控计数
              agentPlan = _replan;
              _execNotes.push('📋 已采纳Agent的新计划（' + _replan.steps.length + '步，替换剩余步骤）');
              showToast('📋 Agent已重规划：新计划共 ' + _replan.steps.length + ' 步', 'info', 6000);
              saveToStorage();
              updateQuickActions();
              updateCtxBar();
              _agentCtl = { produced: true, control: 'replan' };
            } else if (_stepProduced || _skipMark) {
              // —— 本步有产出（或显式跳过）→ 标记完成 ——
              agentPlan.steps[opts.stepIdx].done = true;
              if (_skipMark && !_stepProduced) agentPlan.steps[opts.stepIdx].skipped = true;
              _agentCtl = {
                produced: _stepProduced,
                control: _doneMark ? 'done' : (_skipMark ? 'skip' : 'next')
              };
            } else {
              // —— 本步无任何产出且未跳过 → 不标记完成，agentLoop将带失败观察重试本步 ——
              if (_execNotes.length === 0) _execNotes.push('⚠️ 本轮没有产生任何卡片修改（未检测到有效操作块/HTML）');
              _agentCtl = {
                produced: false,
                control: 'retry',
                retryStepIdx: opts.stepIdx
              };
            }
          } else if (!opts.agentStep) {
            // —— 自由对话模式（全程Agent化）：检测 <agent_plan> 计划块 或 <agent:continue> 自主续跑标记 ——
            let _newPlan = parseAgentPlan(aiResponse);
            // ★ Agent体验修复：AI 未输出 <agent_plan> 时，从报告文本兜底构造计划
            if (!_newPlan) {
              try {
                _newPlan = buildPlanFromReportText(aiResponse);
                if (_newPlan) {
                  try { console.log('[Agent] AI 未输出 <agent_plan>，已从报告文本兜底构造计划：', _newPlan.steps.length, '步'); } catch (_) {}
                  showToast('📋 AI 未输出计划标签，已自动从报告里提取 ' + _newPlan.steps.length + ' 步计划', 'info', 5000);
                }
              } catch (_autoErr) { logWarn('buildPlanFromReportText', _autoErr); }
            }
            // ★ 诊断：<agent_plan> 存在但解析失败 → 提示步骤行格式问题（修复 Agent 体验不到）
            if (!_newPlan && /<agent_plan>/i.test(aiResponse)) {
              try { console.warn('[Agent] <agent_plan> 存在但解析失败——请检查步骤行格式（应为 "1. xxx" 每行一步）'); } catch (_) {}
              showToast('⚠️ AI 输出了 <agent_plan> 但步骤行格式不标准（应为 "1. xxx" 每行一步）——请让 AI 重发计划', 'warning', 8000);
            }
            // ⚠️关键修复：只有用户已明确确认（上一条消息形如"我选择：xxx"）时才自动启动循环。
            // 否则——用户刚发了需求、AI 直接跳过理解阶段输出计划——不自动执行，等用户确认。
            const _lastUserMsgForPlan = (function() {
              try {
                const _msgs = getCurrentMessages();
                for (let _li = _msgs.length - 1; _li >= 0; _li--) {
                  if (_msgs[_li] && _msgs[_li].role === 'user') {
                    return String(_msgs[_li].content || '').trim();
                  }
                }
              } catch (_eM) {}
              return '';
            })();
            // ★修复#12：允许"确认词+后跟修饰语"（如"好的，但是把第2步去掉"）——去掉 $ 锚定 + 否定词排除
            const _userConfirmedPlan =
              /^我选择\s*[:：]/.test(_lastUserMsgForPlan) ||
              (/^(确认|开始|ok|OK|可以|go|Go|做吧|执行|同意|好的|好|行|行吧|没问题|继续|就这样|干吧)[。！!，,\s]*/i.test(_lastUserMsgForPlan.trim()) &&
               !/(不|别|先别|等等|等一下|暂停|不要|算了)/.test(_lastUserMsgForPlan)) ||
              window.__cwAllowAgentPlan === true;
            // 用完重置标志
            try { window.__cwAllowAgentPlan = false; } catch (_) {}
            // ★松绑4.1：粒度过大的计划不再拒收——已采纳但记一笔提示（执行时单步产出仍有上限保护）
            if (_newPlan && _newPlan._vague) {
              try { showToast('⚠️ Agent 计划里有偏大的步骤，已采纳但执行时会限制单步产出', 'info', 5000); } catch (_) {}
              _execNotes.push('ℹ️ 计划含粗粒度步骤：' + String(_newPlan._vagueSteps || []).join('、'));
            }
            if (_newPlan && _newPlan.steps && _newPlan.steps.length >= 1 && !agentLoopActive && _userConfirmedPlan) {
              // 原自动启动逻辑（已确认，放行）
              agentPlan = _newPlan;
              agentLastObservation = '';
              saveToStorage();
              updateQuickActions();
              updateCtxBar();
              showToast('📋 已收到Agent计划：「' + _newPlan.goal + '」共 ' + _newPlan.steps.length + ' 步，即将自动逐步执行（可随时停止）', 'success', 7000);
              setTimeout(function() {
                agentLoop().catch(function(err) {
                  logError('agentLoop.auto', err);
                });
              }, 300);
            } else if (_newPlan && _newPlan.steps && _newPlan.steps.length >= 1 && !agentLoopActive && !_userConfirmedPlan) {
              // ★ 保留计划、显示快捷按钮，同时给用户明确提示（不再"拦截"）
              agentPlan = _newPlan;
              agentLastObservation = '';
              saveToStorage();
              updateQuickActions();
              updateCtxBar();
              showToast('📋 已收到Agent计划（' + _newPlan.steps.length + ' 步）——点底部「继续执行计划」或回复"确认"即可开始', 'info', 8000);
            } else if (/<agent:continue>/i.test(aiResponse || '') && !/<agent:done>/i.test(aiResponse || '') && !agentLoopActive) {
              // 自主续跑：上限15轮防失控
              const _contRuns = (opts._autoRuns || 0) + 1;
              if (_contRuns <= 15) {
                showToast('🤖 Agent续跑（第 ' + _contRuns + '/15 轮）：继续完成剩余任务…', 'info', 3000);
                setTimeout(function() {
                  callAIChat({ _autoRuns: _contRuns }).catch(function(err) {
                    logError('agentAutoContinue', err);
                  });
                }, 300);
              } else {
                showToast('ℹ️ Agent已连续自主续跑15轮，本轮到此为止——如需继续请再告诉我', 'info', 6000);
              }
            }
          }

          // —— 每次非 Agent 步骤的自由对话结束，若本轮有产出，把完成小结合并到上一条 AI 消息 ——
          if (!opts.agentStep && _stepProduced) {
            // ★修复#17：轻量采集"本轮产物被接受"信号（不触发分析——分析仍限 save/export/手动白名单）
            try {
              const _cm = {};
              const _allE = ((cardData && cardData.character_book) || {}).entries || [];
              _allE.forEach(function(e) { if (e && e.comment) _cm[String(e.comment)] = String(e.content || ''); });
              UserProfile.attachAcceptedContent(_cm, _snapTabKey());
            } catch (_at2) { logWarn('collectAccepted.tail', _at2); }
            try {
              const _summary = _buildLightweightCompletionSummary();
              if (_summary) {
                const _lastIdx = curTabMessages.length - 1;
                if (_lastIdx >= 0 && curTabMessages[_lastIdx] && curTabMessages[_lastIdx].role === 'assistant') {
                  // 合并到上一条 AI 消息（不追加独立气泡）
                  curTabMessages[_lastIdx].content = curTabMessages[_lastIdx].content + '\n\n' + _summary;
                  // 增量重绘该条消息的 DOM（找到对应节点重新渲染 section）
                  const _chatC = doc.getElementById('chatMessages');
                  if (_chatC) {
                    const _nodes = _chatC.querySelectorAll('.chat-msg[data-msg-index="' + _lastIdx + '"]');
                    if (_nodes.length > 0) {
                      const _node = _nodes[_nodes.length - 1];
                      const _bubble = _node.querySelector('.bubble');
                      if (_bubble) {
                        try {
                          const _secs = parseMessageSections(curTabMessages[_lastIdx].content);
                          _bubble.innerHTML = renderMessageSections(_secs, _lastIdx);
                          bindSectionToggles(_bubble);
                        } catch (_rErr) { logWarn('rerenderSummary', _rErr); }
                      }
                    }
                  }
                }
              }
            } catch (_sErr) { logWarn('lightSummary', _sErr); }
          }

          // ========== ReAct观察合成：执行结果 + 结构化卡片状态 + 校验结果（下轮决策依据）==========
          let _observation = '';
          try {
            const _val = validateCardData(cardData);
            const _obsParts = [];
            if (_execNotes.length > 0) _obsParts.push(_execNotes.join('\n'));
            _obsParts.push(_buildStructuredObservation(cardData, _val));
            _observation = _obsParts.join('\n\n');
          } catch (_obsErr) {
            logWarn('observation', _obsErr);
            _observation = _execNotes.join('\n');
          }
          if (_agentCtl) _agentCtl.observation = _observation;

          // 检测AI发出的 <preview_statusbar> 命令（Agent模式：不限Tab）
          if (aiResponse && aiResponse.indexOf('<preview_statusbar>') >= 0) {
            try {
              addAssistantMsg('🎛️ 当前状态栏预览：\n```html\n' + MVU_STATUS_BAR_HTML + '\n```');
            } catch (_pvErr) {
              logWarn('statusbarPreview', _pvErr);
            }
          }

          // ========== 关闭队列模式，合并所有系统消息到一条回复 ==========
          // ⚠️ 队列模式收尾统一放 finally：此处只读取队列内容用于拼接，清空/复位由 finally 完成
          let rawContent = aiResponse;
          if (_aiChatNotesQueue.length > 0) {
            rawContent = (rawContent || '') + '\n\n---\n' + _aiChatNotesQueue.join('\n\n');
          }
          // 剥掉控制标记（<agent:next>/<agent:done>/<agent:skip>/<agent:continue>），聊天中不显示协议噪音
          rawContent = String(rawContent || '')
            .replace(/<agent:(?:next|done|skip|continue)>/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          // ReAct观察入消息流：执行结果区块持久化（用户可见，下一轮AI也能从对话历史读取）
          // 用 ```execnotes 包裹，交由 renderMessageSections 渲染成"失败置顶"的可折叠卡片
          if (_execNotes.length > 0) {
            const _fail = _execNotes.filter(function(n) { return /^(❌|⚠️)/.test(String(n)); });
            const _ok   = _execNotes.filter(function(n) { return /^✅/.test(String(n)); });
            const _other = _execNotes.filter(function(n) { return !/^(❌|⚠️|✅)/.test(String(n)); });
            let _block = '```execnotes\n【执行结果】\n';
            if (_fail.length > 0) {
              _block += '❌ 未生效/失败（' + _fail.length + ' 项）：\n' + _fail.map(function(n) { return '· ' + String(n).replace(/^(❌|⚠️)\s*/, ''); }).join('\n') + '\n\n';
            }
            if (_other.length > 0) {
              _block += '· ' + _other.join('\n· ') + '\n\n';
            }
            if (_ok.length > 0) {
              _block += '✅ 已生效（' + _ok.length + ' 项）：\n' + _ok.map(function(n) { return '· ' + String(n).replace(/^✅\s*/, ''); }).join('\n') + '\n';
            }
            _block += '\n```';
            rawContent = (rawContent || '') + '\n\n' + _block;
          }

          // 1. 先存储到历史（Agent模式：单一会话数组）
          //    ⚠️必须先 push 再 appendMsg：appendMsg 用 getCurrentMessages().length-1 算消息索引，
          //    若先 append 再 push，DOM 上的 data-msg-index 会比实际数组索引小1，导致头像菜单撤回/重新生成定位错位
          const _aiMsgContent = (rawContent && rawContent.trim().length > 0) ? rawContent : '（已应用修改）';
          // 记录本次 AI 消息的卡片变更摘要（供撤回/重做时作为反馈素材）
          try {
            _msgChangeMap[curTabMessages.length] = _pendingChangeSummary;
            // 每次写入也顺手做一次上限检查（clearSnapshotsAfter 只在撤回/重试时触发，纯生成场景会漏）
            const _mcWriteKeys = Object.keys(_msgChangeMap).map(Number).sort(function(a, b) { return a - b; });
            if (_mcWriteKeys.length > 300) {
              for (let _i = 0; _i < _mcWriteKeys.length - 300; _i++) delete _msgChangeMap[_mcWriteKeys[_i]];
            }
          } catch (_) {}
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
          // Agent 模式：渲染选项条（在消息落 DOM 之后）
          if (_agentOptionsParsed) {
            _pendingAgentOptions = _agentOptionsParsed;
            try { renderAgentOptionsBar(_agentOptionsParsed); } catch (_eOpt) { logWarn('renderAgentOptionsBar', _eOpt); }
          }
          saveToStorage();
          updateProgress();
          updateQuickActions();
          updateCtxBar();
          renderPreview();
          scheduleCtxBarUpdate();
          saveToStorage();
          // Agent步骤模式：返回步骤执行结果（produced/control）给 agentLoop；普通模式返回 null
          return _agentCtl;
        } catch (err) {
          if (window.__cwAbortRequested) {
            // 用户主动中止：底层请求已被真中断，这不是错误——静默收尾（setEnabled(true) 由 finally 负责）
            removeTyping();
            showToast('⏹ 已停止生成，本次结果未写入卡片', 'info', 4000);
            _aiChatQueueMode = false;
            _aiChatNotesQueue = [];
          } else {
            // 严重错误：AI 调用/响应解析/合并失败。控制台留完整错误栈（带 scope），对话内给用户可读提示
            logError('callAIChat', err);
            removeTyping();
            // ⚠️修复：关闭队列模式并清空队列，否则 addAssistantMsg 会把错误消息压进队列，
            // 随后 finally 的 _aiChatNotesQueue=[] 会直接丢弃，用户界面看不到任何错误提示
            _aiChatQueueMode = false;
            _aiChatNotesQueue = [];
            try {
              addAssistantMsg('😞 出错了：' + (err && err.message) + '\n\n请检查酒馆是否已连接AI模型，以及JS-Slash-Runner插件是否已启用。');
            } catch (_e) {
              logWarn("callAIChat", _e);
              // ↓ 新增：连 addAssistantMsg 都失败，直接 toast 保证用户能看见
              try { showToast('出错了：' + (err && err.message), 'error', 8000); } catch (_) {}
            }
            try {
              setEnabled(true);
            } catch (e) { logWarn("callAIChat", e); }
          }
        } finally {
          _abortRequested = false;
          try { window.__cwAbortRequested = false; } catch (_abF) {}
          // ⚠️修复：队列模式收尾统一放 finally，任何异常路径都不会残留 _aiChatQueueMode=true 或队列数据
          _aiChatQueueMode = false;
          _aiChatNotesQueue = [];
          isGenerating = false;
          try {
            setEnabled(true);
          } catch (e) { logWarn("callAIChat", e); }
          // 摩擦主动提示：每轮对话结束后检查一次（带冷却，不打扰）
          try { maybeShowFrictionTip(); } catch (_) {}
          // ★ 修复：AI 对话结束后不再触发写作偏好分析——只在「写入酒馆」/「导出JSON」/「我的习惯→立即分析」时触发
        }
      }

      // ===== 完整生成（已废弃）=====
      // ⚠️本函数原用于"一键生成完整角色卡"，现已被分步生成流程取代。
      // 保留函数声明以避免外部引用报错；实际不再产出内容，仅提示用户走对话流程。
      async function doGenerate() {
        showToast('一键生成已停用：现在采用"先概览确认、再分步生成"流程——请直接在对话框描述你想要的一部分（如"先做世界观总纲"、"做主角三人组"），AI 会先给概览让你确认。', 'info', 6000);
        return;
      }

      // 记录禁用前输入框是否聚焦，避免恢复时抢焦点打断用户阅读
      let _inputWasFocused = false;

      function setEnabled(enabled) {
        const sendBtn = doc.getElementById('sendBtn');
        const saveBtn = doc.getElementById('saveBtn');
        const input = doc.getElementById('chatInput');

        // 发送按钮：空闲 = 发送；生成中 = 停止（不 disabled，供点击 requestAbort）
        if (sendBtn) {
          sendBtn.disabled = false;
          if (enabled) {
            sendBtn.classList.remove('is-waiting', 'is-aborting');
            sendBtn.title = '发送';
            sendBtn.innerHTML = svgIcon('send', 18, 'send-icon') + svgIcon('spinner', 18, 'send-spinner ic-spin');
          } else {
            sendBtn.classList.remove('is-aborting');
            sendBtn.classList.add('is-waiting');
            // 生成中把 send-icon 位置换成 stop-icon（CSS 控制显隐）
            sendBtn.innerHTML = svgIcon('send', 18, 'send-icon') +
                                svgIcon('stop', 16, 'stop-icon') +
                                svgIcon('spinner', 18, 'send-spinner ic-spin');
          }
        }
        if (saveBtn) saveBtn.disabled = !enabled;

        // ⚠️输入框不再禁用：生成中用户可以先打字准备下一条（Ctrl+Enter 会被 handleSend 的 isGenerating 挡住）
        if (input) {
          input.disabled = false;
        }

        // 其余快捷按钮/上下文按钮统一禁用（保持原逻辑不变）
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

      // ===== 前端界面沙箱预览（参考MVU状态栏预览：mock API + iframe 渲染）=====
      function buildFrontendPreviewMockScript(sampleMessage) {
        const sampleJson = JSON.stringify(sampleMessage || '').replace(/<\/script/gi, '<\\/script');
        return '<script>\n' +
          '/* === 写卡器前端预览用 mock API（模拟酒馆运行时）=== */\n' +
          '(function() {\n' +
          '  var __feSampleMsg = ' + sampleJson + ';\n' +
          '  window.__FE_PREVIEW_MSG__ = __feSampleMsg;\n' +
          '  // getChatMessages / getCurrentMessageId 模拟（前端HTML模板依赖）\n' +
          '  window.getChatMessages = function() {\n' +
          '    return [{ role: "assistant", name: "", message: __feSampleMsg, is_system: false, is_user: false, extra: {} }];\n' +
          '  };\n' +
          '  window.getCurrentMessageId = function() { return "__preview__"; };\n' +
          '  window.getMessageId = function() { return "__preview__"; };\n' +
          '  // triggerSlash 模拟（结构化面板 handleClick 依赖）\n' +
          '  window.triggerSlash = function(cmd) { console.log("[前端预览] triggerSlash:", cmd); };\n' +
          '  // $ mock（与MVU预览一致：$(fn) 立即执行 + $(sel) 迷你链式）\n' +
          '  function _feMiniJQ(sel) {\n' +
          '    if (typeof sel === "function") {\n' +
          '      try {\n' +
          '        if (document.readyState === "complete" || document.readyState === "interactive") { sel(); }\n' +
          '        else { document.addEventListener("DOMContentLoaded", sel); }\n' +
          '      } catch(e) { console.warn("[前端预览] $(fn):", e); }\n' +
          '      return { ready: function(fn) { try { fn(); } catch(e) {} return this; } };\n' +
          '    }\n' +
          '    var el = (typeof sel === "string") ? document.querySelector(sel) : sel;\n' +
          '    return {\n' +
          '      0: el, length: el ? 1 : 0,\n' +
          '      html: function(s) { if (el) el.innerHTML = (s == null ? (el.innerHTML || "") : String(s)); return this; },\n' +
          '      text: function(s) { if (el) el.textContent = s; return this; },\n' +
          '      addClass: function(c) { if (el) el.classList.add(c); return this; },\n' +
          '      removeClass: function(c) { if (el) el.classList.remove(c); return this; },\n' +
          '      ready: function(fn) { try { fn(); } catch(e) {} return this; },\n' +
          '      on: function(ev, fn) { if (el && el.addEventListener) { try { el.addEventListener(ev, fn); } catch(e) {} } return this; },\n' +
          '      off: function(ev, fn) { if (el && el.removeEventListener) { try { el.removeEventListener(ev, fn); } catch(e) {} } return this; },\n' +
          '      css: function() { return this; },\n' +
          '      attr: function(k, v) { if (el) { if (v === undefined) return el.getAttribute(k); try { el.setAttribute(k, v); } catch(e) {} } return this; },\n' +
          '      append: function(c) { if (el) { try { el.insertAdjacentHTML("beforeend", c); } catch(e) {} } return this; },\n' +
          '      prepend: function(c) { if (el) { try { el.insertAdjacentHTML("afterbegin", c); } catch(e) {} } return this; },\n' +
          '      find: function(s) { return _feMiniJQ(el ? el.querySelector(s) : null); },\n' +
          '      closest: function(s) { return _feMiniJQ(el && el.closest ? el.closest(s) : null); },\n' +
          '      parent: function() { return _feMiniJQ(el ? el.parentElement : null); },\n' +
          '      children: function() { return _feMiniJQ(el ? el.firstElementChild : null); },\n' +
          '      val: function(v) { if (el) { if (v === undefined) return el.value; el.value = v; } return this; },\n' +
          '      each: function(fn) { if (el) { try { fn.call(el, 0, el); } catch(e) {} } return this; },\n' +
          '      hide: function() { if (el) el.style.display = "none"; return this; },\n' +
          '      show: function() { if (el) el.style.display = ""; return this; },\n' +
          '      toggle: function() { if (el) el.style.display = (el.style.display === "none") ? "" : "none"; return this; },\n' +
          '      data: function(k, v) { if (el && el.dataset) { if (v === undefined) return el.dataset[k]; el.dataset[k] = v; } return this; }\n' +
          '    };\n' +
          '  }\n' +
          '  window.$ = window.jQuery = _feMiniJQ;\n' +
          '  window._ = { get: function(o,k,d){ if(o==null)return d; var ks=String(k).split("."); var c=o; for(var i=0;i<ks.length;i++){ if(c==null)return d; c=c[ks[i]]; } return c===undefined?d:c; } };\n' +
          '})();\n' +
          '</script>';
      }

      // 前端界面沙箱预览弹窗（正文美化 + 结构化数据面板逐一渲染）
      function showFrontendPreview() {
        // 去重：若已存在预览模态框先移除
        const existingModal = doc.getElementById('fePreviewModal');
        if (existingModal) existingModal.remove();

        const feBList = getFrontendBeautifyRegexes();
        const feStList = getFrontendStructuredRegexes();
        const panels = [];
        // ⚠️多界面：全部正文美化逐一渲染（不同正文标签并存的多个界面）
        feBList.forEach(function(feB) {
          panels.push({
            kind: 'beautify',
            name: feB.scriptName || '[界面]正文美化',
            findRegex: feB.findRegex || '',
            html: String(feB.replaceString || '').replace(/^```\s*\n?/, '').replace(/\n?```$/, '')
          });
        });
        feStList.forEach(function(r) {
          panels.push({
            kind: 'structured',
            name: r.scriptName || '(未命名面板)',
            findRegex: r.findRegex || '',
            html: String(r.replaceString || '').replace(/^```\s*\n?/, '').replace(/\n?```$/, '')
          });
        });
        if (panels.length === 0) {
          showToast('还没有生成前端界面正则，先点「生成前端界面」', 'warning');
          return;
        }
        // 构建预览弹窗：顶部说明 + 每个面板一个 iframe 沙箱渲染
        let h = '<div class="modal" id="fePreviewModal">' +
          '<div class="modal-content" style="max-width:760px">' +
          '<h3 style="color:#a16207;margin-bottom:8px;font-size:1em">🎛️ 前端界面预览</h3>' +
          '<div style="font-size:.8em;color:var(--muted);margin-bottom:8px">示例数据渲染（正文美化=示例<story>正文；结构化=示例<标签名>数据）</div>';
        panels.forEach(function(p, i) {
          h += '<div style="margin-bottom:10px">' +
            '<div style="display:flex;align-items:center;gap:6px;font-size:.82em;color:var(--ink-soft);margin-bottom:4px"><span class="pv-tag ' + (p.kind === 'beautify' ? 'ok' : '') + '">' + (p.kind === 'beautify' ? '正文美化' : '数据面板') + '</span>' + escHtml(p.name) + ' <code>' + escHtml(String(p.findRegex).replace(/^\/|\/$/g, '')) + '</code></div>' +
            '<div style="background:#ffffff;border:1px solid rgba(15,23,42,.10);border-radius:8px;overflow:hidden">' +
            '<iframe class="fe-preview-frame" data-fe-panel="' + i + '" style="width:100%;height:380px;border:0;background:transparent" sandbox="allow-scripts"></iframe>' +
            '</div></div>';
        });
        h += '<div class="modal-actions">' +
          '<button class="btn btn-ghost" id="fePreviewCloseBtn">关闭</button>' +
          '</div>' +
          '</div></div>';
        const tmp = doc.createElement('div');
        tmp.innerHTML = h;
        const modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);

        // 注入 iframe 内容：在HTML前注入 mock API + 示例消息
        panels.forEach(function(p, i) {
          const frame = modalEl.querySelector('.fe-preview-frame[data-fe-panel="' + i + '"]');
          if (!frame) return;
          // 构造示例消息（按面板类型）
          let sampleMsg = '';
          if (p.kind === 'beautify') {
            // 用该界面自己的正文标签生成示例（多界面各自标签不同）
            const bm = String(p.findRegex || '').match(/<([a-zA-Z][\w-]*)>/);
            const bTag = bm && bm[1] ? bm[1] : 'story';
            sampleMsg = '<' + bTag + '>\n"（示例）你好，{{user}}。"\n\n（示例）窗外下起了雨，{{char}}望向远方。\n</' + bTag + '>';
          } else {
            const fm = String(p.findRegex || '').match(/<([a-zA-Z][\w-]*)>/);
            const tag = fm && fm[1] ? fm[1] : 'panel';
            sampleMsg = '<' + tag + '>\n[任务|主线剧情]\n[目标|击败魔王]\n[状态|进行中]\n</' + tag + '>';
          }
          let fullDoc = p.html;
          // HTML 鲁棒性包装（同MVU状态栏预览）
          if (!/<!doctype\s/i.test(fullDoc) && !/<html[\s>]/i.test(fullDoc)) {
            fullDoc = '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <title>' + escHtml(p.name) + '</title>\n</head>\n<body>\n' + fullDoc + '\n</body>\n</html>';
          } else if (/<html[\s>]/i.test(fullDoc) && !/<head[\s>]/i.test(fullDoc)) {
            fullDoc = fullDoc.replace(/<html([^>]*)>/i, '<html$1>\n<head></head>');
          }
          const mockScript = buildFrontendPreviewMockScript(sampleMsg);
          const headStartMatch = fullDoc.match(/<head[^>]*>/i);
          if (headStartMatch) {
            const idx = fullDoc.indexOf(headStartMatch[0]);
            fullDoc = fullDoc.substring(0, idx + headStartMatch[0].length) + '\n' + mockScript + '\n' + fullDoc.substring(idx + headStartMatch[0].length);
          } else if (fullDoc.indexOf('<body') >= 0) {
            fullDoc = fullDoc.replace(/<body/i, mockScript + '<body');
          } else {
            fullDoc = mockScript + fullDoc;
          }
          frame.srcdoc = fullDoc;
        });

        // 关闭逻辑
        modalEl.addEventListener('click', function(e) {
          if (e.target === modalEl) modalEl.remove();
        });
        doc.getElementById('fePreviewCloseBtn').addEventListener('click', function() {
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
          '常驻体系': 'var(--sage, #15803d)',
          '触发体系': 'var(--amber, #a16207)',
          '动态系统': 'var(--amber, #ca8a04)',
          '自定义':   'var(--muted, #667085)'
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
            const wl = WEIGHT_LEVELS[prefixKey] || _inferWeightLevel(e);
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
              '<span class="wv-entry-level" style="background:' + (wl.bg || 'var(--w-level-mid-bg)') + ';color:' + wl.color + ';border:1px solid ' + (wl.border || 'var(--w-level-mid-border)') + '">' + wl.level + '</span>' +
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
          '常驻体系': 'var(--sage, #15803d)',
          '触发体系': 'var(--amber, #a16207)',
          '动态系统': 'var(--amber, #ca8a04)',
          '自定义':   'var(--muted, #667085)'
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

      // ===== 用户习惯画像面板（工作区菜单 → 我的习惯）=====
      // 纯本地统计：展示题材/尺度/条目长度习惯/操作频次；可开关/导出/导入/清空

      // ---- 摩擦主动提示：同模式 30min 内只提示一次，用轻量 toast 不打断 ----
      const _frictionTipsShown = {};
      const FRICTION_TIP_COOLDOWN_MS = 30 * 60 * 1000;
      function maybeShowFrictionTip() {
        try {
          if (typeof UserProfile === 'undefined' || UserProfile.isDisabled()) return;
          const patterns = UserProfile.detectFrictionPatterns();
          if (!patterns || !patterns.length) return;
          const now = Date.now();
          const p = patterns.find(function(x) {
            return !_frictionTipsShown[x.pattern] ||
                   (now - _frictionTipsShown[x.pattern]) > FRICTION_TIP_COOLDOWN_MS;
          });
          if (!p) return;
          _frictionTipsShown[p.pattern] = now;
          showToast('💡 ' + p.hint, 'info', 6000);
          try { UserProfile.recordFriction('tip-shown', p.pattern, 0); } catch (_) {}
        } catch (e) { logWarn('maybeShowFrictionTip', e); }
      }

      function exportWritingRulesMd() {
        try {
          const rules = UserProfile.getWritingRules();
          const catNames = { writing:'写作/描写', structure:'条目结构', fields:'字段风格', scale:'内容尺度', general:'通用' };
          const lines = [];
          const _avoid = rules.avoid || [], _prefer = rules.prefer || [];
          lines.push('---');
          lines.push('name: user-writing-prefs');
          lines.push('description: 用户个人写作偏好（由时之写卡器从历史反馈提炼）');
          lines.push('version: ' + new Date().toISOString().slice(0, 10));
          lines.push('rules_avoid: ' + _avoid.length);
          lines.push('rules_prefer: ' + _prefer.length);
          lines.push('---');
          lines.push('');
          lines.push('# 用户写作偏好规约');
          lines.push('');
          lines.push('> 由「时之写卡器」从历史反馈提炼，导出时间：' + new Date().toLocaleString());
          lines.push('> 可直接导入回写卡器（「我的习惯」→「导入md」），或作为 skill 文件分享。');
          lines.push('');
          lines.push('## 规则概览');
          lines.push('');
          lines.push('- avoid（避免）：共 ' + _avoid.length + ' 条');
          lines.push('- prefer（偏好）：共 ' + _prefer.length + ' 条');
          lines.push('');
          const _renderSection = function(arr, title) {
            if (!arr || !arr.length) return;
            lines.push('## ' + title);
            lines.push('');
            const byCat = {};
            arr.forEach(function(r) {
              const c = r.category || 'general';
              (byCat[c] = byCat[c] || []).push(r);
            });
            Object.keys(byCat).forEach(function(cat) {
              lines.push('### ' + (catNames[cat] || cat));
              lines.push('');
              byCat[cat].forEach(function(r) {
                lines.push('- ' + r.text +
                  (r.evidence ? '  <!-- evidence:' + r.evidence.replace(/-->/g, '') + ' -->' : '') +
                  (r.hits > 1 ? '  <!-- hits:' + r.hits + ' -->' : ''));
              });
              lines.push('');
            });
          };
          _renderSection(_avoid, '避免（avoid）');
          _renderSection(_prefer, '偏好（prefer）');
          // 附：近期原始对照样本（用户校对规则是否失真）
          try {
            const p = UserProfile.getRaw();
            const recent = (p.feedback || []).filter(function(f) {
              return (f.entryPairs || []).some(function(pr) { return pr.before && pr.after; });
            }).slice(-5);
            if (recent.length) {
              lines.push('');
              lines.push('---');
              lines.push('');
              lines.push('## 附：近期原始对照样本（校对规则是否失真）');
              lines.push('');
              recent.forEach(function(f, i) {
                const d = new Date(f.ts);
                lines.push('### 样本 ' + (i + 1) + ' (' + d.toLocaleString() + ' · ' + f.kind + ')');
                (f.entryPairs || []).slice(0, 3).forEach(function(pr) {
                  lines.push('- 条目 `' + (pr.name || '') + '` · ' + pr.action);
                  if (pr.before) lines.push('  - ✗ ' + String(pr.before).slice(0, 100).replace(/\n/g, ' / '));
                  if (pr.after) lines.push('  - ↩ ' + String(pr.after).slice(0, 100).replace(/\n/g, ' / '));
                  if (pr.acceptedContent) lines.push('  - ✓ ' + String(pr.acceptedContent).slice(0, 100).replace(/\n/g, ' / '));
                });
                lines.push('');
              });
            }
          } catch (_) {}
          const md = lines.join('\n');
          const filename = '写作偏好_' + new Date().toISOString().slice(0, 10) + '.md';
          const _res = _exportTextFile(filename, md, 'text/markdown');
          if (_res.downloaded || _res.copied) {
            showToast('✅ 已导出写作偏好 md' + (_res.copied ? '（同时已复制到剪贴板）' : '') + '（可通过「导入md」回流）', 'success', 6000);
          } else {
            _showExportFallbackModal(filename, md);
          }
        } catch (e) {
          showToast('导出失败：' + (e.message || e), 'error');
        }
      }

      // 从 md 导入写作规约
      function importWritingRulesMd(mdText) {
        if (!mdText) return { ok: false, msg: '空内容' };
        try {
          const lines = String(mdText).split(/\r?\n/);
          const avoid = [], prefer = [];
          let curCat = 'general', curSection = null;
          const catReverse = { '写作/描写':'writing', '条目结构':'structure', '字段风格':'fields', '内容尺度':'scale', '通用':'general' };
          lines.forEach(function(ln) {
            const t = ln.trim();
            if (!t) return;
            if (/^##\s+避免/.test(t)) { curSection = 'avoid'; curCat = 'general'; return; }
            if (/^##\s+偏好/.test(t)) { curSection = 'prefer'; curCat = 'general'; return; }
            if (/^##\s+规则概览/.test(t)) { curSection = null; return; }
            if (/^###\s+/.test(t)) {
              const name = t.replace(/^###\s+/, '').trim();
              curCat = catReverse[name] || 'general';
              return;
            }
            if (curSection && /^-\s+/.test(t)) {
              const evMatch = t.match(/<!--\s*evidence:(.*?)\s*-->/);
              const evidence = evMatch ? evMatch[1].trim() : '';
              const text = t.replace(/^-\s+/, '').replace(/<!--.*?-->/g, '').trim();
              if (text) {
                const item = { text: text, category: curCat, hits: 1, lastSeen: Date.now(), evidence: evidence };
                if (curSection === 'avoid') avoid.push(item); else prefer.push(item);
              }
            }
          });
          if (avoid.length === 0 && prefer.length === 0) return { ok: false, msg: '未解析到规则' };
          UserProfile.mergeWritingRules({ avoid: avoid, prefer: prefer, _fromUserImport: true });
          return { ok: true, avoidCount: avoid.length, preferCount: prefer.length };
        } catch (e) {
          return { ok: false, msg: e.message || String(e) };
        }
      }

      function showUserProfilePanel() {
        const s = UserProfile.summarize();
        const isOff = UserProfile.isDisabled();
        const fmt = function(v) { return v == null ? '—' : String(v); };
        const kv = function(k, v) {
          return '<div style="display:flex;justify-content:space-between;gap:14px;padding:5px 0;border-bottom:1px dashed var(--line-soft)">' +
            '<span style="color:var(--muted);flex-shrink:0">' + escHtml(k) + '</span>' +
            '<b style="text-align:right">' + escHtml(fmt(v)) + '</b></div>';
        };

        const c = s.counters;
        let h = '<div class="modal" id="upModal"><div class="modal-content" style="max-width:640px">' +
          '<div style="padding:14px 18px 0;display:flex;align-items:center;justify-content:space-between">' +
            '<h3 style="color:var(--accent-deep);margin:0;display:inline-flex;align-items:center;gap:7px;font-size:1em">' +
              svgIcon('chart', 17) + ' 我的写作习惯</h3>' +
            '<button class="icon-btn icon-btn-square" id="upCloseTop" style="margin:0">' + svgIcon('close', 15) + '</button>' +
          '</div>' +
          '<div style="padding:0 18px 12px;font-size:.76em;color:var(--muted)">纯本地统计，不上传；AI写卡时会参考这些偏好，但永远以你本轮的明确指令为准。</div>' +
          '<div class="modal-body" style="padding:0 18px">';

        // 计数概览
        h += '<div class="wv-summary" style="margin-bottom:12px">' +
          '<div class="wv-stat"><span class="wv-stat-val">' + (c.cardsSaved||0) + '</span><span class="wv-stat-lbl">完成卡</span></div>' +
          '<div class="wv-stat"><span class="wv-stat-val">' + (c.userMessages||0) + '</span><span class="wv-stat-lbl">对话</span></div>' +
          '<div class="wv-stat"><span class="wv-stat-val">' + ((c.entriesAdded||0)+(c.entriesUpdated||0)) + '</span><span class="wv-stat-lbl">条目操作</span></div>' +
          '<div class="wv-stat"><span class="wv-stat-val">' + ((c.revokes||0)+(c.edits||0)) + '</span><span class="wv-stat-lbl">撤回+编辑</span></div>' +
        '</div>';

        // 画像明细
        h += '<div class="pv-section" style="padding:10px 14px;margin-bottom:10px">' +
          kv('常写题材', s.topGenres.length ? s.topGenres.map(function(x){return x[0]+'×'+x[1];}).join('、') : '—') +
          kv('尺度倾向', s.scale) +
          kv('条目平均字数', s.avgLen ? s.avgLen + ' 字' : '—') +
          kv('常驻条目占比', s.constRate + '%') +
          kv('YAML 结构化率', s.yamlRate + '%') +
          kv('平均触发词数', s.avgKeys) +
          kv('常用条目前缀', s.topPrefixes.length ? s.topPrefixes.map(function(x){return x[0]+'×'+x[1];}).join('、') : '—') +
          kv('常用功能', s.topActions.length ? s.topActions.map(function(x){return x[0]+'×'+x[1];}).join('、') : '—') +
        '</div>';

        // 最近行为（包在 pv-section 内，复用 pv-entry 样式）
        if (s.recentEvents.length) {
          h += '<div class="pv-section" style="padding:8px 12px;margin-bottom:10px">' +
            '<details class="pv-entry" style="margin:0"><summary><span>最近行为</span>' +
            '<span class="sec-right">' + s.recentEvents.length + ' 条</span></summary>' +
            '<div class="pv-entry-body"><div class="pv-entry-content">' +
            s.recentEvents.slice(0, 15).map(function(e) {
              const d = new Date(e.ts);
              const t = d.toLocaleString('zh-CN', {hour12:false}).slice(5);
              return escHtml(t) + '  [' + escHtml(e.type) + '] ' + escHtml(e.brief || '');
            }).join('<br>') +
            '</div></div></details></div>';
        }

        // 近期困难（摩擦模式识别，1h 窗口）——用警示色左边条
        let _fp = [];
        try { _fp = UserProfile.detectFrictionPatterns(60 * 60 * 1000) || []; } catch (_) {}
        if (_fp.length) {
          h += '<div class="pv-section" style="padding:10px 12px;margin-bottom:10px;border-left:3px solid var(--terra, #d97706)">' +
            '<div style="font-weight:600;color:var(--terra-text);margin-bottom:6px;font-size:.88em">⚠️ 近期可能卡壳的地方</div>';
          _fp.forEach(function(p) {
            h += '<div style="padding:6px 0;border-bottom:1px dashed var(--line-soft)">' +
              '<div style="font-size:.82em;font-weight:600;color:var(--ink)">' + escHtml(p.title) +
              ' <span style="color:var(--muted);font-weight:400">(严重度 ' + p.severity + ')</span></div>' +
              '<div style="font-size:.76em;color:var(--ink-soft);margin-top:3px;line-height:1.5">' + escHtml(p.hint) + '</div>' +
            '</div>';
          });
          h += '</div>';
        }

        // 摩擦事件时间线（近 24h）
        let _frAll = [];
        try {
          const _now = Date.now();
          const _raw = (UserProfile.getRaw().frictions || []);
          _frAll = _raw.filter(function(f){ return _now - f.ts < 24*3600*1000; });
        } catch (_) {}
        if (_frAll.length) {
          h += '<div class="pv-section" style="padding:8px 12px;margin-bottom:10px">' +
            '<details class="pv-entry" style="margin:0"><summary><span>摩擦时间线（24h）</span>' +
            '<span class="sec-right">' + _frAll.length + ' 条</span></summary>' +
            '<div class="pv-entry-body"><div class="pv-entry-content">' +
            _frAll.slice(-30).reverse().map(function(f) {
              const d = new Date(f.ts);
              const t = d.toLocaleString('zh-CN',{hour12:false}).slice(5);
              return escHtml(t) + '  [' + escHtml(f.kind) + '] ' + escHtml(f.detail || '');
            }).join('<br>') +
            '</div></div></details></div>';
        }

        // 写作规约（AI 从反馈中提炼，可查看/删除）
        let _wr = { avoid: [], prefer: [] };
        try { _wr = UserProfile.getWritingRules(); } catch (_) {}
        if ((_wr.avoid && _wr.avoid.length) || (_wr.prefer && _wr.prefer.length)) {
          h += '<div class="pv-section" style="padding:10px 12px;margin-bottom:10px;border-left:3px solid var(--accent, #4f46e5)">' +
            '<div style="font-weight:600;color:var(--accent-deep);margin-bottom:6px;font-size:.88em">🧠 写作规约（AI 从你的反馈中提炼，写卡时自动遵守）</div>';
          const _renderRules = function(arr, kind) {
            if (!arr || !arr.length) return '';
            let s = '';
            arr.forEach(function(r) {
              const esc = escHtml(r.text || '');
              const txtAttr = escAttr(r.text || '');
              s += '<div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px dashed var(--line-soft)">' +
                '<span style="flex:1;font-size:.8em;color:var(--ink);line-height:1.5">' + esc +
                (r.hits > 1 ? ' <span style="color:var(--muted);font-size:.85em">（×' + r.hits + '）</span>' : '') + '</span>' +
                '<button type="button" class="pv-mini-btn" data-wr-del="' + kind + '" data-wr-text="' + txtAttr + '" title="删除该规则" style="flex-shrink:0;font-size:.7em;padding:3px 8px">删除</button>' +
                '</div>';
            });
            return s;
          };
          if (_wr.avoid.length) {
            h += '<div style="font-size:.76em;color:var(--terra-text);font-weight:600;margin:6px 0 2px">✕ 讨厌的写法（avoid）</div>';
            h += _renderRules(_wr.avoid, 'avoid');
          }
          if (_wr.prefer.length) {
            h += '<div style="font-size:.76em;color:var(--sage-text);font-weight:600;margin:8px 0 2px">✓ 想要的写法（prefer）</div>';
            h += _renderRules(_wr.prefer, 'prefer');
          }
          h += '<div style="margin-top:8px;font-size:.72em;color:var(--muted)">规则会随你的反馈自动累积；90 天未命中的规则自动淘汰。</div>';
          h += '</div>';
        }

        // 原始反馈语料区（可审计）
        try {
          const _rawFB = (UserProfile.getRaw().feedback || []).slice(-20).reverse();
          if (_rawFB.length > 0) {
            h += '<div style="padding:8px 12px;margin-bottom:10px;border-left:3px solid var(--line-soft)">' +
              '<div style="font-weight:600;color:var(--accent-deep);margin-bottom:6px;font-size:.85em">📝 原始反馈语料（近20条）</div>';
            _rawFB.forEach(function(f) {
              const _d = new Date(f.ts);
              const _t = _d.toLocaleString('zh-CN', {hour12:false}).slice(5);
              const _kindMap = { revoke:'撤回', retry:'重试', edit:'编辑', 'user-rewrite':'用户重写',
                'accepted':'接受', 'manual-delete':'手动删', 'manual-delete-batch':'批量删' };
              const _kind = _kindMap[f.kind] || f.kind;
              const _pairs = (f.entryPairs || []).slice(0, 1);
              h += '<div style="padding:5px 0;border-bottom:1px dashed var(--line-soft);font-size:.76em">';
              h += '<div style="color:var(--muted)">' + escHtml(_t) + ' · <b>' + escHtml(_kind) + '</b>' +
                   (f.analyzed ? ' <span style="color:var(--sage-text)">✓已分析</span>' : ' <span style="color:var(--amber-text)">⏳待分析</span>') + '</div>';
              if (_pairs.length > 0) {
                const _pr = _pairs[0];
                h += '<div style="margin-top:2px;color:var(--terra-text)">✗ ' + escHtml(String(_pr.before || '').slice(0, 80)) + '</div>';
                h += '<div style="color:var(--sage-text)">✓ ' + escHtml(String(_pr.after || _pr.acceptedContent || '').slice(0, 80)) + '</div>';
              }
              h += '</div>';
            });
            h += '</div>';
          }
        } catch (_rawFBErr) { logWarn('upPanel.rawFeedback', _rawFBErr); }

        // skill 版本历史
        try {
          const _skillHistory = JSON.parse(localStorage.getItem('szxq_writing_skill_history_v1') || '[]');
          if (Array.isArray(_skillHistory) && _skillHistory.length > 0) {
            h += '<div style="padding:8px 12px;margin-bottom:10px;border-left:3px solid var(--line-soft)">' +
              '<div style="font-weight:600;color:var(--accent-deep);margin-bottom:6px;font-size:.85em">🗂️ skill 版本历史</div>';
            _skillHistory.slice().reverse().forEach(function(v, vi) {
              const _d = new Date(v.ts);
              const _t = _d.toLocaleString('zh-CN', {hour12:false}).slice(5);
              const _avoidN = ((v.rules && v.rules.avoid) || []).length;
              const _preferN = ((v.rules && v.rules.prefer) || []).length;
              h += '<div style="padding:3px 0;font-size:.76em;display:flex;align-items:center;gap:8px">' +
                '<span style="color:var(--muted);flex-shrink:0">' + escHtml(_t) + '</span>' +
                '<span style="flex:1">avoid ' + _avoidN + ' / prefer ' + _preferN + '</span>' +
                '<button type="button" class="pv-mini-btn" data-wr-rollback="' + vi + '" style="font-size:.7em;padding:2px 8px">回滚</button>' +
                '</div>';
            });
            h += '</div>';
          }
        } catch (_skillHistErr) { logWarn('upPanel.skillHistory', _skillHistErr); }

        h += '</div>' + // /modal-body
          '<div class="modal-actions" style="padding:0 18px 14px;flex-wrap:wrap;gap:6px">' +
            '<button class="btn btn-ghost" id="upToggleBtn">' + (isOff ? '🔔 开启记录' : '🔕 关闭记录') + '</button>' +
            '<button class="btn btn-ghost" id="upAnalyzeBtn" title="立即分析最近反馈，提炼写作规约">🧠 立即分析</button>' +
            '<button class="btn btn-ghost" id="upExportBtn">导出</button>' +
            '<button class="btn btn-ghost" id="upExportMdBtn" title="导出为可读 md 文件（可分享/可作 skill 用）">导出md</button>' +
            '<button class="btn btn-ghost" id="upImportMdBtn" title="从 md 文件导入写作规约（合并到现有规则）">导入md</button>' +
            '<button class="btn btn-ghost" id="upImportBtn">导入</button>' +
            '<button class="btn" id="upClearBtn" style="background:var(--terra-soft);color:var(--terra-text);border:1px solid transparent">清空</button>' +
            '<button class="btn btn-primary" id="upCloseBtn">关闭</button>' +
          '</div></div></div>';

        const tmp = doc.createElement('div');
        tmp.innerHTML = h;
        const modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);

        const close = function() { modalEl.remove(); };
        modalEl.addEventListener('click', function(e) { if (e.target === modalEl) close(); });
        doc.getElementById('upCloseBtn').addEventListener('click', close);
        const closeTop = doc.getElementById('upCloseTop');
        if (closeTop) closeTop.addEventListener('click', close);
        doc.getElementById('upToggleBtn').addEventListener('click', function() {
          UserProfile.setDisabled(!UserProfile.isDisabled());
          close(); showUserProfilePanel();
        });
        const upAnalyzeBtn = doc.getElementById('upAnalyzeBtn');
        if (upAnalyzeBtn) upAnalyzeBtn.addEventListener('click', function() {
          close();
          // ★ 修复 Bug3：用户手动分析传 'manual'，明确允许来源
          analyzeWritingPreferences(true, 'manual').catch(function(e) {
            showToast('分析失败：' + (e && e.message ? e.message : e), 'error');
          });
        });
        const upExportMdBtn = doc.getElementById('upExportMdBtn');
        if (upExportMdBtn) upExportMdBtn.addEventListener('click', function() { exportWritingRulesMd(); });
        const upImportMdBtn = doc.getElementById('upImportMdBtn');
        if (upImportMdBtn) upImportMdBtn.addEventListener('click', function() {
          const inp = doc.createElement('input');
          inp.type = 'file';
          inp.accept = '.md,.markdown,text/markdown,text/plain';
          inp.addEventListener('change', function() {
            const f = inp.files && inp.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = function() {
              const res = importWritingRulesMd(r.result);
              if (res.ok) {
                close();
                showUserProfilePanel();
                showToast('✅ 已导入 ' + res.avoidCount + ' 条 avoid + ' + res.preferCount + ' 条 prefer', 'success');
              } else {
                showToast('导入失败：' + res.msg, 'error');
              }
            };
            r.readAsText(f);
          });
          inp.click();
        });
        doc.getElementById('upExportBtn').addEventListener('click', function() {
          try {
            const json = UserProfile.exportJson();
            const filename = '写作习惯_' + new Date().toISOString().slice(0, 10) + '.json';
            const _res = _exportTextFile(filename, json, 'application/json');
            if (_res.downloaded || _res.copied) {
              showToast('✅ 已导出' + (_res.copied ? '（同时已复制到剪贴板）' : ''), 'success', 6000);
            } else {
              _showExportFallbackModal(filename, json);
            }
          } catch (e) {
            showToast('导出失败：' + (e.message || e), 'error');
          }
        });
        doc.getElementById('upImportBtn').addEventListener('click', function() {
          const inp = doc.createElement('input');
          inp.type = 'file'; inp.accept = '.json';
          inp.addEventListener('change', function() {
            const f = inp.files && inp.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = function() {
              if (UserProfile.importJson(r.result)) { close(); showUserProfilePanel(); showToast('✅ 已导入', 'success'); }
              else showToast('导入失败：JSON 无效', 'error');
            };
            r.readAsText(f);
          });
          inp.click();
        });
        doc.getElementById('upClearBtn').addEventListener('click', function() {
          if (!confirm('确认清空全部习惯记录吗？此操作不可恢复。')) return;
          UserProfile.clear(); close(); showUserProfilePanel(); showToast('已清空习惯记录', 'success');
        });
        // 删除单条写作规约（按文本匹配，同步 skill 文件）
        const wrDelBtns = modalEl.querySelectorAll('[data-wr-del]');
        for (let _wi = 0; _wi < wrDelBtns.length; _wi++) {
          wrDelBtns[_wi].addEventListener('click', function() {
            const kind = this.getAttribute('data-wr-del');
            const text = this.getAttribute('data-wr-text');
            if (!kind || !text) return;
            if (!confirm('确认删除该规则吗？删除后 AI 不再遵守它。')) return;
            let ok = false;
            try { ok = UserProfile.removeWritingRule(kind, text); } catch (_) {}
            close(); showUserProfilePanel();
            showToast(ok ? '已删除该规则' : '删除失败：未找到该规则', ok ? 'success' : 'warning');
          });
        }
        // skill 版本回滚
        const _rollbackBtns = modalEl.querySelectorAll('[data-wr-rollback]');
        for (let _rbi = 0; _rbi < _rollbackBtns.length; _rbi++) {
          _rollbackBtns[_rbi].addEventListener('click', function() {
            const _vi = parseInt(this.getAttribute('data-wr-rollback'), 10);
            if (isNaN(_vi)) return;
            if (!confirm('回滚到该版本？当前规则会被覆盖（当前规则会存为历史版本）。')) return;
            let _ok = false;
            try {
              const _hist = JSON.parse(localStorage.getItem('szxq_writing_skill_history_v1') || '[]');
              const _reverseIdx = _hist.length - 1 - _vi;
              const _target = _hist[_reverseIdx];
              if (_target && _target.rules) {
                UserProfile.mergeWritingRules({
                  avoid: _target.rules.avoid || [],
                  prefer: _target.rules.prefer || [],
                  _fromUserImport: true,
                  _replace: true
                });
                _ok = true;
              }
            } catch (_rbErr) { logWarn('rollbackSkill', _rbErr); }
            close(); showUserProfilePanel();
            showToast(_ok ? '✅ 已回滚到该版本' : '⚠️ 回滚失败', _ok ? 'success' : 'warning');
          });
        }
      }

      // ===== 预览渲染 =====
      /* 迭代1·H6：旧 _renderPreviewTimer 已由调度器的 _previewTimer 取代，不再声明独立防抖变量 */

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
      // 迭代1·M1：预览面板世界书条目展开态（按 comment 键控，重建后仍生效）
      const _pvExpanded = {};
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
          if (!_pvFlash.ts || Date.now() - _pvFlash.ts > 8000) {   // ★修复#19：5s→8s（动画3200ms+慢设备重排抖动余量）
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
        markDirty('preview');
      }

      function _renderPreviewImpl() {
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
              name: '第4条 变量当前状态',
              desc: '固定内容：{{format_message_variable::stat_data}} 宏注入'
            },
            {
              has: _pvD[4],
              icon: 'list',
              name: '第5条 [mvu_update]输出格式',
              desc: '固定格式：<UpdateVariable>+<Analysis>+<JSONPatch>（4种操作）'
            },
            {
              has: _pvD[5],
              icon: 'list',
              name: '第6条 输出格式强调',
              desc: '固定内容原样输出强调，AI不输出<UpdateVariable>时启用'
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
              h += '<details class="pv-entry" data-pv-comment="' + escHtml(e.comment || ('MVU条目' + (i + 1))) + '"' + (_pvExpanded[e.comment || ('MVU条目' + (i + 1))] ? ' open' : '') + '><summary><span>' + escHtml(e.comment || ('MVU条目' + (i + 1))) + '</span><span class="sec-right">~' + eTok + 'T ' + disabledTag + '</span></summary>' +
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

        if (__tab === 'frontend') {
          // ========== 前端界面统一预览：[界面]正文美化 + 结构化数据面板 + 世界书条目 + 界面总览 ==========
          const _feB = getFrontendBeautifyRegex();
          const _feBList = getFrontendBeautifyRegexes();
          const _feStRx = getFrontendStructuredRegexes();
          const _feWi = (cardData.character_book && cardData.character_book.entries || []).filter(function(e) {
            return (e.comment || '').indexOf('[前端数据面板]') >= 0 || (e.comment || '').indexOf('[前端正文美化]') >= 0;
          });
          const _feTotal = _feBList.length + _feStRx.length;

          // ① 界面总览（参考MVU状态栏总览：状态dot + 按钮）
          const _feDotCls = _feTotal > 0 ? 'full' : 'empty';
          const _feRight = _feTotal > 0 ? (_feBList.length > 0 ? '正文美化×' + _feBList.length + ' · ' : '') + _feStRx.length + '个面板' : '未生成';
          let feOverview = '<div class="pv-section"><h3><span class="sec-left"><span class="dot ' + _feDotCls + '"></span>' + svgIcon('layers', 14) + ' 前端界面总览</span><span class="sec-right">' + _feRight + '</span><span class="pv-toggle"></span></h3><div class="pv-sub">';
          _feBList.forEach(function(_feOne) {
            feOverview += '<div style="margin:2px 0"><span class="pv-tag ok">正文美化</span>' + escHtml(_feOne.scriptName || '[界面]正文美化') + ' <code>' + escHtml(String(_feOne.findRegex || '').replace(/^\/|\/$/g, '')) + '</code></div>';
          });
          if (_feStRx.length > 0) {
            feOverview += '<div style="margin:2px 0"><span class="pv-tag ok">数据面板 ×' + _feStRx.length + '</span><code>' + escHtml(_feStRx.map(function(r, i) {
              return (i + 1) + '.' + (r.scriptName || '(未命名)');
            }).join(' ')) + '</code></div>';
          }
          feOverview += '<div style="margin:2px 0"><span class="pv-tag">规范世界书条目 ×' + _feWi.length + '</span></div>';
          feOverview += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">';
          if (_feTotal > 0) {
            feOverview += '<button class="pv-mini-btn" data-pv-action="preview-frontend">' + svgIcon('eye', 13) + ' 预览界面</button>';
            feOverview += '<button class="pv-mini-btn" data-pv-action="reset-frontend">' + svgIcon('trash', 13) + ' 清除界面正则</button>';
          }
          feOverview += '</div></div></div>';
          h += feOverview;

          // ② [界面]正文美化 正则状态（多界面全部展示）
          if (_feBList.length > 0) {
            _feBList.forEach(function(_feOne, _feIdx) {
              h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>' + svgIcon('layers', 14) + ' ' + escHtml(_feOne.scriptName || '[界面]正文美化') + (_feBList.length > 1 ? '（' + (_feIdx + 1) + '/' + _feBList.length + '）' : '') + '</span><span class="pv-toggle"></span></h3><div class="pv-content">' + escHtml('名称: ' + (_feOne.scriptName || '') + '\n查找: ' + (_feOne.findRegex || '')) + '</div></div>';
              const feHtmlCode = String(_feOne.replaceString || '').replace(/^```\s*\n?/, '').replace(/\n?```$/, '');
              h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>' + svgIcon('code', 14) + ' ' + escHtml((_feOne.scriptName || '界面') + ' HTML源码（正则替换内容）') + '</span><span class="pv-toggle"></span></h3><div class="pv-content">' + escHtml(feHtmlCode.slice(0, 2000)) + (feHtmlCode.length > 2000 ? '\n…（截断显示，完整见对话记录）' : '') + '</div></div>';
            });
            h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>' + svgIcon('eye', 14) + ' 输出配置</span><span class="pv-toggle"></span></h3><div class="pv-content">AI输出 · 在编辑时运行 · 仅格式显示（placement=[2] / markdownOnly=true / promptOnly=false / runOnEdit=true）</div></div>';
          } else {
            h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>' + svgIcon('layers', 14) + ' [界面]正文美化</span><span class="pv-toggle"></span></h3><div class="pv-empty">尚未生成正文美化正则，点「生成前端界面」并描述想要的正文渲染效果</div></div>';
          }

          // ③ 结构化数据面板列表 + HTML源码
          if (_feStRx.length > 0) {
            h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>' + svgIcon('table', 14) + ' 结构化数据面板（' + _feStRx.length + '个）</span><span class="pv-toggle"></span></h3><div class="pv-content">' + escHtml(_feStRx.map(function(r, i) {
              return (i + 1) + '. ' + (r.scriptName || '(未命名)') + '  ← ' + String(r.findRegex || '').replace(/^\/|\/$/g, '');
            }).join('\n')) + '</div></div>';
            _feStRx.forEach(function(r, i) {
              const _stHtmlCode = String(r.replaceString || '').replace(/^```\s*\n?/, '').replace(/\n?```$/, '');
              h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>' + svgIcon('code', 14) + ' ' + escHtml('面板' + (i + 1) + ' HTML源码') + '</span><span class="pv-toggle"></span></h3><div class="pv-content">' + escHtml(_stHtmlCode.slice(0, 1500)) + (_stHtmlCode.length > 1500 ? '\n…（截断显示，完整见对话记录）' : '') + '</div></div>';
            });
          } else {
            h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>' + svgIcon('table', 14) + ' 结构化数据面板</span><span class="pv-toggle"></span></h3><div class="pv-empty">尚未生成面板，点「生成前端界面」并描述想展示的数据（状态栏/论坛/任务面板等）</div></div>';
          }

          // ④ 规范AI输出的世界书条目
          if (_feWi.length > 0) {
            h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>' + svgIcon('book', 14) + ' 规范AI输出的世界书条目（' + _feWi.length + '条）</span><span class="pv-toggle"></span></h3><div class="pv-content">' + escHtml(_feWi.map(function(e, i) {
              return (i + 1) + '. [' + (e.name || e.comment || '条目') + '] 触发词: ' + ((e.keys || []).join('、') || '无') + '\n' + String(e.content || '').slice(0, 300) + (String(e.content || '').length > 300 ? '\n…' : '');
            }).join('\n\n')) + '</div></div>';
          } else {
            h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>' + svgIcon('book', 14) + ' 规范AI输出的世界书条目</span><span class="pv-toggle"></span></h3><div class="pv-empty">尚未生成，生成界面时自动创建</div></div>';
          }

          // ⑤ 关联角色卡信息（只读，紧凑）
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
            eH += '<details class="pv-entry' + (_pvFilter.selected[label] ? ' selected' : '') + '" data-pv-comment="' + escHtml(label) + '"' + (_pvExpanded[label] ? ' open' : '') + '><summary>' +
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

        // ===== Agent模式：MVU状态栏总览（进度 + 预览/操作按钮，复用MVU总览区块）=====
        try {
          const _pvMvuEntries = (cardData.character_book && cardData.character_book.entries) || [];
          const _pvHasMvu = _pvMvuEntries.some(function(e) {
            return isMVUEntry(e.comment || '');
          });
          if (_pvHasMvu) {
            h += buildStatusBarPreviewSection();
          } else {
            h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>' + svgIcon('sliders', 14) + ' MVU变量系统</span><span class="sec-right">0/8</span><span class="pv-toggle"></span></h3><div class="pv-empty">尚未配置——在对话中提出变量/状态栏需求即可生成</div></div>';
          }
        } catch (_pvMvuErr) {
          logWarn('pvMvu', _pvMvuErr);
        }

        // ===== Agent模式：前端界面总览（正文美化 + 数据面板状态，复用前端总览样式）=====
        try {
          const _feB = getFrontendBeautifyRegex();
          const _feStRx = getFrontendStructuredRegexes();
          const _feTotal = (_feB ? 1 : 0) + _feStRx.length;
          const _feDotCls = _feTotal > 0 ? 'full' : 'empty';
          const _feRight = _feTotal > 0 ? ((_feB ? '正文美化 · ' : '') + _feStRx.length + '个面板') : '未生成';
          let _feOv = '<div class="pv-section"><h3><span class="sec-left"><span class="dot ' + _feDotCls + '"></span>' + svgIcon('layers', 14) + ' 前端界面</span><span class="sec-right">' + _feRight + '</span><span class="pv-toggle"></span></h3><div class="pv-sub">';
          if (_feB) {
            _feOv += '<div style="margin:2px 0"><span class="pv-tag ok">正文美化</span><code>' + escHtml(String(_feB.findRegex || '').replace(/^\/|\/$/g, '')) + '</code></div>';
          }
          if (_feStRx.length > 0) {
            _feOv += '<div style="margin:2px 0"><span class="pv-tag ok">数据面板 ×' + _feStRx.length + '</span><code>' + escHtml(_feStRx.map(function(r, i) {
              return (i + 1) + '.' + (r.scriptName || '(未命名)');
            }).join(' ')) + '</code></div>';
          }
          if (_feTotal > 0) {
            _feOv += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">';
            _feOv += '<button class="pv-mini-btn" data-pv-action="preview-frontend">' + svgIcon('eye', 13) + ' 预览界面</button>';
            _feOv += '<button class="pv-mini-btn" data-pv-action="reset-frontend">' + svgIcon('trash', 13) + ' 清除界面正则</button>';
            _feOv += '</div>';
          }
          _feOv += '</div></div>';
          h += _feOv;
        } catch (_pvFeErr) {
          logWarn('pvFe', _pvFeErr);
        }

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
        const _stepNames = ['①zod变量结构', '②[InitVar]初始变量', '③[mvu_update]更新规则', '④变量当前状态', '⑤[mvu_update]输出格式', '⑥输出格式强调', '⑦<状态栏>占位提醒', '⑧状态栏HTML(正则6)'];
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
            } else if (act === 'preview-frontend') {
              // 前端界面沙箱预览（参考MVU状态栏预览）
              showFrontendPreview();
            } else if (act === 'reset-frontend') {
              if (!confirm('确定清除全部「前端界面」正则吗？\n\n✅ 将删除正文美化正则 + 结构化数据面板正则 + 对应的世界书条目\n✅ 不影响角色卡/世界书/MVU内容\n✅ 可随时重新生成')) return;
              cardData.extensions = cardData.extensions || {};
              const _rxFeAll = Array.isArray(cardData.extensions.regex_scripts) ? cardData.extensions.regex_scripts : [];
              cardData.extensions.regex_scripts = _rxFeAll.filter(function(r) {
                if (!r) return true;
                const isFe = (r.id === 'frontend-beautify' || (r.scriptName || '').indexOf('[界面]') === 0);
                if (isFe) console.warn('[frontend] 清除界面正则:', r.scriptName);
                return !isFe;
              });
              removeBeautifyWorldInfoEntry();
              removeStructuredFrontendAll();
              saveToStorage();
              renderPreview();
              updateQuickActions();
              updateCtxBar();
              showToast('✅ 已清除全部前端界面正则（含世界书条目）', 'success');
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
            // 反馈语料：用户手动删除 AI 生成的条目 = 明确负样本
            try {
              UserProfile.recordFeedback({
                kind: 'manual-delete',
                changeSummary: {
                  entries: [{ action: 'delete', comment: String(name).slice(0, 60) }],
                  fieldUpdates: 0, totalEntries: 1, source: 'preview-panel'
                },
                entryPairs: [{
                  name: String(name),
                  action: 'delete',
                  before: String(en.content || ''),
                  after: '',
                  semantics: 'user-rejected'
                }],
                aiReply: ''
              });
              UserProfile.recordFriction('manual-delete', name, 2);
            } catch (_) {}
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
          // 反馈语料：批量操作也是用户态度信号
          try {
            const _batchEntries = targets.map(function(t) {
              return {
                action: act === 'delete' ? 'delete' : (act === 'disable' ? 'disable' : 'enable'),
                comment: String(t.comment || '').slice(0, 60)
              };
            });
            const _batchPairs = (act === 'delete') ? targets.slice(0, 6).map(function(t) {
              return { name: String(t.comment || ''), action: 'delete', before: String(t.content || ''), after: '', semantics: 'user-rejected' };
            }) : [];
            if (_batchEntries.length > 0) {
              UserProfile.recordFeedback({
                kind: act === 'delete' ? 'manual-delete-batch' : ('manual-' + act + '-batch'),
                changeSummary: { entries: _batchEntries.slice(0, 15), fieldUpdates: 0, totalEntries: _batchEntries.length, source: 'preview-panel-batch' },
                entryPairs: _batchPairs,
                aiReply: ''
              });
            }
          } catch (_) {}
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
          // ★反馈语料：人工编辑了 AI 生成的字段/条目内容 → 记录 diff（含完整对照）
          try {
            if (currentVal && currentVal !== newVal) {
              let _pairs = [];
              if (type === 'entry') {
                const idx2 = parseInt(index);
                const entry = ((cardData.character_book || {}).entries || [])[idx2];
                _pairs.push({
                  name: (entry && entry.comment) || ('条目' + idx2),
                  action: 'update',
                  before: currentVal,
                  after: newVal,
                  semantics: 'ai-vs-user'
                });
              } else if (type === 'field') {
                _pairs.push({
                  name: '顶层字段·' + key,
                  action: 'update',
                  before: currentVal,
                  after: newVal,
                  semantics: 'ai-vs-user'
                });
              }
              UserProfile.recordFeedback({
                kind: 'edit',
                entryPairs: _pairs,
                aiReply: currentVal.slice(0, 1500),
                userEdit: newVal.slice(0, 1500)
              });
            }
          } catch (_) {}
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
          try { UserProfile.recordEdit(type, key); } catch (_) {}
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
        // ⚠️写入前结构校验：发现错误时让用户确认是否仍要写入
        try {
          const _v = validateCardData(cardData);
          if (!_v.valid) {
            const _msg = _v.issues.filter(function(x){ return x.level === 'error'; })
              .slice(0, 5).map(function(x, i){ return (i+1) + '. ' + x.msg; }).join('\n');
            if (!confirm('写入前发现 ' + _v.errorCount + ' 个错误：\n\n' + _msg +
                (_v.errorCount > 5 ? '\n…还有 ' + (_v.errorCount - 5) + ' 项' : '') +
                '\n\n仍然写入吗？（建议先修正）')) {
              return;
            }
          }
        } catch (_ve) { logWarn('save.validate', _ve); }
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
          // ===== 诊断日志（写入前数据实况）=====
          if (WRITER_DEBUG) console.log('[写卡诊断] 待写入数据：', {
            名称: cardData.name,
            description长度: (data.description || '').length,
            first_mes长度: (data.first_mes || '').length,
            personality长度: (data.personality || '').length,
            scenario长度: (data.scenario || '').length,
            条目数: ((data.character_book && data.character_book.entries) || []).length,
            条目清单: ((data.character_book && data.character_book.entries) || []).map(function(e) {
              return (e.comment || '?') + '(content:' + (e.content || '').length + '字)';
            })
          });
          // 世界书名称：优先 extensions.world（buildExportCard 写入位置），其次角色名
          const worldbookName = (data.extensions && data.extensions.world) || data.world || exportCard.name || cardData.name;
          const entries = (data.character_book && data.character_book.entries) || [];

          // MVU 系统检测（与 buildExportCard 内部判定保持一致）
          const filledForMvu = entries.some(function(e) {
            return isMVUEntry(e.comment || '');
          });
          const hasMVU = !!(filledForMvu || entries.some(function(e) {
            const c = (e.comment || '').toLowerCase();
            return c.indexOf('[initvar]') >= 0 || c.indexOf('[mvu_update]') >= 0 || (e.comment || '').indexOf('变量当前状态') >= 0 || (e.comment || '').indexOf('变量输出格式') >= 0;
          }));

          // 提取角色名列表（用于状态栏 HTML 生成）
          const charNames = extractCharNames(cardData, (cardData.character_book || {}).entries || []);

          // ===== 步骤1：创建或获取角色卡 =====
          await _tavernCreateOrGet(cardData.name);
          if (WRITER_DEBUG) console.log('[写卡诊断] 步骤1 角色卡已就绪');

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
          if (WRITER_DEBUG) console.log('[写卡诊断] 步骤2 基础字段已写入');

          // ===== 步骤3：写入开场白 =====
          if (data.first_mes && data.first_mes.trim()) {
            await _tavernWriteFirstMes(cardData.name, data.first_mes);
          }
          if (WRITER_DEBUG) console.log('[写卡诊断] 步骤3 开场白已写入');

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
              statusBarHtml = customSb
                .replace(/^\s*```[a-zA-Z]*[ \t]*\r?\n/, '')   // 只剥开头的 ``` 语言行
                .replace(/\r?\n?[ \t]*```\s*$/, '')            // 只剥结尾的 ```
                .trim();
            }
            // 4c-2. 兜底：AI 完全没生成状态栏时，用统一模板生成默认状态栏（保证写入酒馆不缺状态栏）
            if (!statusBarHtml) statusBarHtml = generateMvuStatusBarHtml(charNames);
            await _tavernWriteRegexScripts(cardData.name, statusBarHtml);
          }

          // ===== 步骤4.5：前端界面正则（[界面]正文美化 + [界面]页面名称 结构化面板）=====
          // ⚠️修复：此前写入酒馆只处理 MVU 正则，前端正则从未写入，导致酒馆里看不到正文美化/数据面板效果。
          // 前端世界书条目已随 entries（步骤5 _tavernWriteWorldbook）写入，这里补写正则。
          {
            const _feRxAll = (cardData.extensions && Array.isArray(cardData.extensions.regex_scripts)) ? cardData.extensions.regex_scripts : [];
            const frontendRxList = _feRxAll.filter(function(r) {
              if (!r) return false;
              return (r.id === 'frontend-beautify') ||
                ((r.id || '').indexOf('frontend-structured-') === 0) ||
                ((r.scriptName || '').indexOf('[界面]') === 0);
            });
            if (frontendRxList.length > 0) {
              await _tavernWriteFrontendRegexes(cardData.name, frontendRxList);
            }
          }

          // ===== 步骤5：写入世界书条目 =====
          if (entries.length > 0) {
            await _tavernWriteWorldbook(worldbookName, entries);
          }
          if (WRITER_DEBUG) console.log('[写卡诊断] 步骤5 世界书已写入：' + worldbookName + '，共 ' + entries.length + ' 条');

          // ===== 步骤6：切换到角色卡 =====
          await _tavernSwitchToCharacter(cardData.name);
          if (WRITER_DEBUG) console.log('[写卡诊断] 步骤6 已切换到角色卡');

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
          // 用户画像：写入成功才记一张完成卡，并采样字段长度/条目写作习惯
          try { UserProfile.recordCardSaved(cardData); } catch (_) {}
          // ===== 正样本采集（以"最终写入酒馆"为金标准）=====
          try { _collectAcceptedSamples('save-character'); } catch (_accErr) { logWarn('saveCharacter.accepted', _accErr); }
          // ★ 修复 Bug4：只有 save-character 白名单触发分析
          try { _maybeAutoAnalyze('save-character'); } catch (_) {}
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

      // ===== 关闭钩子：flush 未消费的 dirty → 置 sessionAlive=false → 清定时器（E2/E3）=====
      try {
        window.__cwBeforeClose = function() {
          _flush();                 // ⚠️必须在 _sessionAlive=false 之前，否则会短路丢最后一次编辑（D1）
          _sessionAlive = false;
          clearSessionTimers();
        };
      } catch (_eHook) {}

      // ★ 修复 Bug1：每次打开时强制渲染欢迎页，独立 try-catch 保证后续步骤不受前序失败影响
      try { if (doc && doc.body) doc.body.innerHTML = ''; } catch (_preClear) {}
      try {
        if (typeof activeTab !== 'undefined') activeTab = 'card';
        if (typeof currentTab !== 'undefined') currentTab = 'card';
        if (typeof window !== 'undefined') window.__tab_activeTab = 'card';
      } catch (_tabReset) {}

      try {
        renderWelcome();
        // 渲染校验：DOM 里必须有 .welcome 容器，否则说明渲染失败
        let _welcomeCheck = doc.querySelector('.welcome');
        // ★ 修复 Bug1：首次渲染失败时清空 body 后重试一次（应对极端情况下 DOM 残留冲突）
        if (!_welcomeCheck) {
          console.warn('[写卡诊断] 欢迎页首次渲染失败，清空 body 后重试');
          try { doc.body.innerHTML = ''; } catch (_clr) {}
          renderWelcome();
          _welcomeCheck = doc.querySelector('.welcome');
        }
        if (!_welcomeCheck) throw new Error('renderWelcome 未产出 .welcome 容器（含重试）');
        // ★ 修复 Bug1：防御性清理残留聊天界面元素（禁止"打开即进入聊天"）
        const _strayChat = doc.querySelector('.chat-panel, .chat-messages, .chat-input-area');
        if (_strayChat) {
          console.warn('[写卡诊断] 检测到残留聊天界面元素，强制清空 body 后重渲染欢迎页');
          try { doc.body.innerHTML = ''; } catch (_clr2) {}
          renderWelcome();
        }
        if (WRITER_DEBUG) console.log('[写卡诊断] 欢迎页已强制渲染，当前状态=welcome');
      } catch (_welcomeErr) {
        console.error('[时之写卡器] renderWelcome 异常，触发纯净兜底:', _welcomeErr);
        try {
          doc.body.innerHTML =
            '<div class="app"><div class="topbar"><div class="topbar-left">' +
            '<h1>' + svgIcon('bolt', 18, 'topbar-ic') + ' 时之写卡器</h1></div>' +
            '<div class="topbar-right"><button class="icon-btn icon-btn-square danger" id="closeBtn">' +
            svgIcon('close', 16) + '</button></div></div>' +
            '<div class="welcome"><h2>时之写卡器</h2>' +
            '<p>欢迎页渲染异常。请关闭后重开，或刷新酒馆页面。</p></div></div>';
          const _cb = doc.getElementById('closeBtn');
          if (_cb) _cb.addEventListener('click', closeModal);
        } catch (_e2) {}
      }

    } catch (e) {
      console.error('时之写卡器 Error:', e);
      showToast('打开失败: ' + e.message, 'error');
    } finally {
      // ★ 释放重入锁
      try { if (typeof window !== 'undefined') window.__cwEditorOpening = false; } catch (_) {}
    }
  }

  // ============================================================================
  // SECTION 12  用户使用习惯画像（本地记录 · 个性化写卡辅助）
  // 设计原则：埋点轻、存储独立、分析可解释、应用直接反哺 AI 提示词
  // ============================================================================
  const USER_PROFILE_KEY = 'szxq_user_profile_v1';
  const USER_PROFILE_MAX_EVENTS = 120;
  const USER_SKILL_KEY = 'szxq_writing_skill_v1';

  const _UP_GENRE_KEYWORDS = {
    '仙侠/修仙': ['修仙','宗门'],
    '玄幻/奇幻': ['玄幻','魔法'],
    '都市/校园': ['都市','校园'],
    '末世/废土': ['末世','丧尸'],
    '科幻/赛博': ['科幻','赛博'],
    '恋爱/养成': ['恋爱','养成'],
    '经营/模拟': ['经营','模拟'],
    '推理/悬疑': ['推理','悬疑'],
    '恐怖/惊悚': ['恐怖','怪谈'],
    '克苏鲁':   ['克苏鲁'],
  };
  const _UP_SCALE_KEYWORDS = {
    dark: ['暗黑','残酷'],
    nsfw: ['NSFW','涩涩'],
    safe: ['全年龄','治愈'],
  };

  // ============ SECTION 12.5  摩擦事件与困难点推测 ============
  // 习惯画像回答"用户喜欢什么"；摩擦画像回答"用户卡在哪"——共用存储，规则引擎不同
  const UP_FRICTION_WINDOW_MS = 5 * 60 * 1000;   // 5min 滑动窗口
  const UP_FRICTION_MAX = 200;                    // 摩擦事件环形缓冲

  // 显式疑问信号：从用户消息文本里识别
  const _UP_QUESTION_PATTERNS = [
    { key:'howto',    re:/(怎么|如何|怎样|咋|在哪|哪里)/,                       label:'操作疑问',    weight:1 },
    { key:'why',      re:/(为什么|怎么会|怎么没|咋没|为啥)/,                   label:'结果困惑',    weight:2 },
    { key:'cando',    re:/(能不能|可不可以|可以吗|支持吗)/,                   label:'能力试探',    weight:1 },
    { key:'help',     re:/(帮我|求|弄不好|搞不定|不会|不懂|教我|给个示例)/,      label:'明确求助',    weight:3 },
    { key:'negative', re:/(不对|重来|太差|不像|不是这样|不满意|错了|不好)/,      label:'负面反馈',    weight:3 },
    { key:'concept',  re:/(什么是|什么意思|啥意思|什么区别|有啥区别|是啥)/,       label:'概念疑惑',    weight:1 },
  ];
  // 摩擦类型权重：高权事件（撤回/重试/求助/不满）更容易触发主动提示
  const _UP_FRICTION_WEIGHTS = {
    'revoke': 2, 'retry': 3, 'continue': 1, 'edit': 1,
    'agent-retry': 3, 'idle-loop': 3, 'repeat-self': 3, 'verbose': 1,
    'question:help': 3, 'question:negative': 3, 'question:why': 2,
    'question:howto': 1, 'question:cando': 1, 'question:concept': 1,
  };

  const UserProfile = (function() {
    const DEFAULT = function() {
      return {
        version: 1, createdAt: Date.now(), updatedAt: Date.now(), disabled: false,
        counters: { cardsSaved:0, cardsImported:0, aiCalls:0, userMessages:0,
                    entriesAdded:0, entriesUpdated:0, entriesDeleted:0,
                    statusBarGenerated:0, frontendGenerated:0,
                    revokes:0, edits:0, quickActions:0,
                    retries:0, continues:0, agentRetries:0 },
        actionUsage: {}, genreTags: {}, scaleVotes: { safe:0, dark:0, nsfw:0 },
        fieldStats: {}, commentPrefixes: {},
        entryStats: { totalCount:0, totalContentLen:0, constCount:0, yamlCount:0, keyCount:0, keyedCount:0 },
        recentEvents: [],
        frictions: [],   // [{ ts, kind, detail, weight }]
        // ===== 反馈语料库：撤回/重试/编辑时的内容样本（供离线分析提炼写作规约）=====
        feedback: [],    // [{ ts, kind, aiReply, userNextMsg, userEdit, analyzed }]
        // ===== 写作规约：从语料提炼的 avoid/prefer 规则（带 hits 计数与衰减）=====
        writingRules: { avoid: [], prefer: [] },  // [{ text, hits, lastSeen }]
        lastAnalysisAt: 0,
      };
    };

    let _cache = null;
    function load() {
      if (_cache) return _cache;
      try {
        const raw = localStorage.getItem(USER_PROFILE_KEY);
        if (raw) {
          const p = JSON.parse(raw), d = DEFAULT();
          _cache = Object.assign(d, p);
          _cache.counters   = Object.assign(d.counters,   p.counters   || {});
          _cache.scaleVotes = Object.assign(d.scaleVotes, p.scaleVotes || {});
          _cache.entryStats = Object.assign(d.entryStats, p.entryStats || {});
          _cache.frictions  = Array.isArray(p.frictions) ? p.frictions : [];
          return _cache;
        }
      } catch (e) { logWarn('UserProfile.load', e); }
      _cache = DEFAULT();
      return _cache;
    }

    let _saveTimer = null;
    function save(immediate) {
      const doSave = function() {
        _saveTimer = null;
        try {
          const p = load(); p.updatedAt = Date.now();
          if (p.recentEvents.length > USER_PROFILE_MAX_EVENTS) {
            p.recentEvents = p.recentEvents.slice(-USER_PROFILE_MAX_EVENTS);
          }
          if (Array.isArray(p.frictions) && p.frictions.length > UP_FRICTION_MAX * 2) {
            p.frictions = p.frictions.slice(-UP_FRICTION_MAX);
          }
          localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(p));
        } catch (e) {
          if (e && e.name === 'QuotaExceededError') {   // 空间不足：先丢事件流再丢摩擦流
            try { const p = load(); p.recentEvents = []; p.frictions = []; localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(p)); } catch (_) {}
          }
        }
      };
      if (immediate) { if (_saveTimer) clearTimeout(_saveTimer); doSave(); }
      else if (!_saveTimer) _saveTimer = setTimeout(doSave, 300);
    }

    function pushEvent(type, brief) {
      const p = load();
      p.recentEvents.push({ ts: Date.now(), type: type, brief: String(brief || '').slice(0, 80) });
      if (p.recentEvents.length > USER_PROFILE_MAX_EVENTS * 2) p.recentEvents = p.recentEvents.slice(-USER_PROFILE_MAX_EVENTS);
    }
    function incCounter(k, d) { const p = load(); p.counters[k] = (p.counters[k] || 0) + (d == null ? 1 : d); }

    // ---- 摩擦事件记录 ----
    function _frictionWeight(kind) {
      if (_UP_FRICTION_WEIGHTS[kind] != null) return _UP_FRICTION_WEIGHTS[kind];
      // 前缀匹配（question:xxx 已在表里；兜底用 kind 冒号前段）
      if (kind && kind.indexOf(':') > 0) {
        const base = kind.split(':')[0];
        return _UP_FRICTION_WEIGHTS[base] || 1;
      }
      return 1;
    }
    function recordFriction(kind, detail, weight) {
      const p = load();
      if (p.disabled) return;
      try {
        const w = (weight != null) ? weight : _frictionWeight(kind);
        p.frictions.push({ ts: Date.now(), kind: kind, detail: String(detail||'').slice(0,60), weight: w });
        if (p.frictions.length > UP_FRICTION_MAX * 2) p.frictions = p.frictions.slice(-UP_FRICTION_MAX);
        pushEvent('friction', kind + (detail ? ':'+detail : ''));
        save();
      } catch (e) { logWarn('UP.recordFriction', e); }
    }

    // ---------------- 采集接口 ----------------
    function recordUserMessage(text, opts) {
      opts = opts || {};
      if (load().disabled) return;
      try {
        if (!opts.skipCount) incCounter('userMessages');
        const p = load();
        for (const g in _UP_GENRE_KEYWORDS) {
          for (const kw of _UP_GENRE_KEYWORDS[g]) {
            if (text.indexOf(kw) >= 0) { p.genreTags[g] = (p.genreTags[g]||0)+1; break; }
          }
        }
        for (const s in _UP_SCALE_KEYWORDS) {
          for (const kw of _UP_SCALE_KEYWORDS[s]) {
            if (text.indexOf(kw) >= 0) { p.scaleVotes[s] = (p.scaleVotes[s]||0)+1; break; }
          }
        }
        pushEvent('msg', text.slice(0, 40));
        save();
      } catch (e) { logWarn('UP.recordUserMessage', e); }
    }
    function recordAction(action) {
      if (load().disabled) return;
      try { const p = load(); p.actionUsage[action] = (p.actionUsage[action]||0)+1; incCounter('quickActions'); pushEvent('action', action); save(); } catch (_) {}
    }
    function recordAgentChoice(text) {
      if (load().disabled) return;
      try { pushEvent('choice', text.slice(0,40)); recordUserMessage(text, { skipCount: true }); save(); } catch (_) {}
    }
    function recordAiCall() { if (!load().disabled) try { incCounter('aiCalls'); save(); } catch(_){} }
    function recordOpsChange(cr) {
      if (!cr || load().disabled) return;
      try { incCounter('entriesAdded', cr.added||0); incCounter('entriesUpdated', cr.updated||0); incCounter('entriesDeleted', cr.deleted||0); save(); } catch(_){}
    }
    function recordStatusBarGenerated() { if (!load().disabled) try { incCounter('statusBarGenerated'); pushEvent('statusbar',''); save(); } catch(_){} }
    function recordFrontendGenerated(n) { if (!load().disabled) try { incCounter('frontendGenerated', n||1); save(); } catch(_){} }
    function recordCardImported() { if (!load().disabled) try { incCounter('cardsImported'); pushEvent('card-imported',''); save(); } catch(_){} }

    // ---- 带摩擦信号的采集 ----
    // 用户消息：原有采集 + 疑问/重复/长消息摩擦检测
    function recordUserMessageWithFriction(text) {
      if (load().disabled) return [];
      recordUserMessage(text);
      try {
        const hits = [];
        for (let i = 0; i < _UP_QUESTION_PATTERNS.length; i++) {
          const q = _UP_QUESTION_PATTERNS[i];
          if (q.re.test(text)) {
            hits.push(q.key);
            recordFriction('question:'+q.key, text.slice(0,40), q.weight);
          }
        }
        if (text.length >= 200) recordFriction('verbose', '长消息('+text.length+'字)', 1);
        // 高频重复同一句话（用户觉得 AI 没听懂）：最近两条 msg 完全相同
        const p = load();
        const recentMsgs = p.recentEvents.filter(function(e){ return e.type === 'msg'; });
        if (recentMsgs.length >= 2) {
          const a = recentMsgs[recentMsgs.length-1].brief || '';
          const b = recentMsgs[recentMsgs.length-2].brief || '';
          if (a && a === b) recordFriction('repeat-self', text.slice(0,30), 3);
        }
        return hits;
      } catch (e) { logWarn('UP.msgFriction', e); return []; }
    }
    // ---------------- 反馈语料库（内容样本，供离线分析） ----------------
    const FEEDBACK_MAX = 80;            // 反馈总条数上限（环形缓冲）
    const FEEDBACK_CONTENT_MAX = 1500;  // 单条内容字段截断上限
    const FEEDBACK_PAIRS_MAX = 6;       // 单条样本最多保留几对对照
    function recordFeedback(fb) {
      if (load().disabled) return;
      try {
        const p = load();
        p.feedback = Array.isArray(p.feedback) ? p.feedback : [];
        const pairs = Array.isArray(fb.entryPairs) ? fb.entryPairs.slice(0, FEEDBACK_PAIRS_MAX).map(function(pr) {
          return {
            name: String(pr.name || '').slice(0, 80),
            action: pr.action || 'update',
            before: String(pr.before || '').slice(0, FEEDBACK_CONTENT_MAX),
            after: String(pr.after || '').slice(0, FEEDBACK_CONTENT_MAX),
            semantics: pr.semantics || 'baseline-vs-ai',
            acceptedContent: pr.acceptedContent ? String(pr.acceptedContent).slice(0, FEEDBACK_CONTENT_MAX) : ''
          };
        }) : [];
        p.feedback.push({
          ts: Date.now(),
          kind: fb.kind || 'revoke',
          semantics: fb.semantics || '',
          changeSummary: fb.changeSummary || null,
          entryPairs: pairs,
          aiReply: String(fb.aiReply || '').slice(0, FEEDBACK_CONTENT_MAX),
          userNextMsg: String(fb.userNextMsg || '').slice(0, FEEDBACK_CONTENT_MAX),
          userEdit: String(fb.userEdit || '').slice(0, FEEDBACK_CONTENT_MAX),
          analyzed: false
        });
        if (p.feedback.length > FEEDBACK_MAX) p.feedback = p.feedback.slice(-FEEDBACK_MAX);
        save();
      } catch (e) { logWarn('UP.recordFeedback', e); }
    }
    // 用户下一条消息回填到最近的未分析 revoke/retry 样本（最强不满信号）
    function attachNextMessage(msg) {
      if (load().disabled || !msg) return;
      try {
        const p = load();
        p.feedback = Array.isArray(p.feedback) ? p.feedback : [];
        // 不设硬时间窗：只匹配"最近一条未分析的 revoke/retry"（Agent 循环可能跑很久）
        for (let i = p.feedback.length - 1; i >= 0; i--) {
          const f = p.feedback[i];
          if (f.analyzed) continue;
          if ((f.kind === 'revoke' || f.kind === 'retry') && !f.userNextMsg) {
            f.userNextMsg = String(msg).slice(0, FEEDBACK_CONTENT_MAX);
            save();
            return;
          }
        }
      } catch (e) { logWarn('UP.attachNext', e); }
    }
    // 规约合并：按文本去重，重复命中 +1，lastSeen 刷新；90 天未命中自动降权移除
    function mergeWritingRules(rules) {
      if (!rules || load().disabled) return;
      try {
        const p = load();
        p.writingRules = p.writingRules || { avoid: [], prefer: [] };
        const now = Date.now();
        const _90d = 90 * 24 * 3600 * 1000;
        // _replace 模式（回滚场景）：先清空目标分类再写入
        const _replaceMode = !!(rules && rules._replace);
        if (_replaceMode) {
          if (Array.isArray(rules.avoid)) p.writingRules.avoid = [];
          if (Array.isArray(rules.prefer)) p.writingRules.prefer = [];
        }
        // 规则质量门槛：拒绝空泛/过短/过长/无动词的规则（用户手动导入时跳过）
        const _isQualityRule = function(text, opts) {
          if (!text) return false;
          const t = String(text).trim();
          if (opts && opts.skipQualityCheck) return true;
          if (t.length < 4 || t.length > 300) return false;
          // ★P2-8：取消"建议/尽量"开头白名单与动词黑名单——AI 提炼的任何合理规则都保留，用户可在面板手动删
          return true;
        };
        const _fromUserImport = !!(rules && rules._fromUserImport);
        const _mergeArr = function(arr, list) {
          (list || []).forEach(function(item) {
            const text = typeof item === 'string' ? item : String(item && item.text || '').trim();
            const category = (typeof item === 'object' && item && item.category) ? String(item.category) : 'general';
            const evidence = (typeof item === 'object' && item && item.evidence) ? String(item.evidence).slice(0, 120) : '';
            if (!text) return;
            if (!_isQualityRule(text, { skipQualityCheck: _fromUserImport })) {
              logWarn('UP.mergeRules.skip', '空泛规则已丢弃: ' + text.slice(0, 40));
              return;
            }
            const hit = arr.find(function(r) { return r.text === text; });
            if (hit) {
              hit.hits = (hit.hits || 1) + 1;
              hit.lastSeen = now;
              if (!hit.category || hit.category === 'general') hit.category = category;
              if (evidence && !hit.evidence) hit.evidence = evidence;
            } else {
              arr.push({ text: text, hits: 1, lastSeen: now, category: category, evidence: evidence });
            }
          });
          return arr.filter(function(r) { return (now - (r.lastSeen || 0)) < _90d; });
        };
        p.writingRules.avoid = _mergeArr(p.writingRules.avoid, rules.avoid);
        p.writingRules.prefer = _mergeArr(p.writingRules.prefer, rules.prefer);
        // 衰减：90天未命中且 hits<=1 的直接淘汰；老规则但命中过多次保留
        ['avoid','prefer'].forEach(function(k) {
          p.writingRules[k] = (p.writingRules[k] || []).filter(function(r) {
            if (!r) return false;
            const age = now - (r.lastSeen || 0);
            if (age < _90d) return true;
            return (r.hits || 1) >= 2;
          });
        });
        p.lastAnalysisAt = now;
        save(true);
        try { _persistSkillFile(); } catch (_psErr) { logWarn('persistSkillFile', _psErr); }
      } catch (e) { logWarn('UP.mergeRules', e); }
    }
    function _persistSkillFile() {
      const p = load();
      const skill = { version: 2, updatedAt: Date.now(), rules: p.writingRules || { avoid: [], prefer: [] } };
      try {
        let history = [];
        try { history = JSON.parse(localStorage.getItem('szxq_writing_skill_history_v1') || '[]'); } catch (_) {}
        if (Array.isArray(history)) {
          const _last = history[history.length - 1];
          const _same = _last && JSON.stringify(_last.rules) === JSON.stringify(skill.rules);
          if (!_same) {
            history.push({ ts: Date.now(), rules: JSON.parse(JSON.stringify(skill.rules)) });
            while (history.length > 5) history.shift();
            try { localStorage.setItem('szxq_writing_skill_history_v1', JSON.stringify(history)); } catch (_) {}
          }
        }
      } catch (_histErr) { logWarn('_persistSkillFile.history', _histErr); }
      try {
        localStorage.setItem(USER_SKILL_KEY, JSON.stringify(skill));
      } catch (e) {
        if (e && e.name === 'QuotaExceededError') {
          skill.rules.avoid = (skill.rules.avoid || []).slice(0, 20);
          skill.rules.prefer = (skill.rules.prefer || []).slice(0, 20);
          try { localStorage.setItem(USER_SKILL_KEY, JSON.stringify(skill)); } catch (_) {}
        }
      }
    }
    function _loadSkillFile() {
      try {
        const raw = localStorage.getItem(USER_SKILL_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || !s.rules) return null;
        return s;
      } catch (_) { return null; }
    }
    function markFeedbackAnalyzed() {
      try {
        const p = load();
        (p.feedback || []).forEach(function(f) { f.analyzed = true; });
        save();
      } catch (_) {}
    }
    function getWritingRules() {
      const skill = _loadSkillFile();
      const r = (skill && skill.rules) || (load().writingRules || { avoid: [], prefer: [] });
      const sorted = function(arr) {
        return (arr || []).slice().sort(function(a, b) { return (b.hits || 0) - (a.hits || 0); });
      };
      return { avoid: sorted(r.avoid), prefer: sorted(r.prefer) };
    }
    // 按规则文本删除（避免下标因排序错位）；同时同步 skill 文件
    function removeWritingRule(kind, text) {
      if (kind !== 'avoid' && kind !== 'prefer') return false;
      try {
        const p = load();
        p.writingRules = p.writingRules || { avoid: [], prefer: [] };
        if (!Array.isArray(p.writingRules[kind])) return false;
        const before = p.writingRules[kind].length;
        p.writingRules[kind] = p.writingRules[kind].filter(function(r) {
          return !r || String(r.text || '') !== String(text || '');
        });
        if (p.writingRules[kind].length === before) return false;
        save(true);
        try { _persistSkillFile(); } catch (_psErr) { logWarn('persistSkillFile', _psErr); }
        return true;
      } catch (e) {
        logWarn('UP.removeWritingRule', e);
        return false;
      }
    }
    // 是否值得跑一次离线分析
    function shouldAnalyze() {
      const p = load();
      const unArr = (p.feedback || []).filter(function(f) { return !f.analyzed; });
      const un = unArr.length;
      if (un === 0) return false;
      const sinceLast = Date.now() - (p.lastAnalysisAt || 0);
      // 快速通道 A：累计 5 条立即分析
      if (un >= 5) return true;
      // 快速通道 B：有强对照（acceptedContent 或 ai-vs-user）→ 30s 冷却
      const _hasStrongPair = unArr.some(function(f) {
        return (f.entryPairs || []).some(function(pr) {
          return pr && (pr.acceptedContent || (pr.semantics === 'ai-vs-user' && pr.before && pr.after));
        });
      });
      if (_hasStrongPair && sinceLast >= 30 * 1000) return true;
      const byKind = {};
      unArr.forEach(function(f) { byKind[f.kind] = (byKind[f.kind] || 0) + 1; });
      const anyKind2 = Object.keys(byKind).some(function(k) { return byKind[k] >= 2; });
      if (anyKind2 && sinceLast >= 30 * 1000) return true;
      if (un >= 2 && sinceLast >= 2 * 60 * 1000) return true;
      // 单条兜底：3 分钟
      if (un >= 1 && sinceLast >= 3 * 60 * 1000) return true;
      return false;
    }
    function getUnanalyzedFeedback() {
      return (load().feedback || []).filter(function(f) { return !f.analyzed; });
    }

    // ---- 撤回/重试后，跟踪"用户最终接受版" ----
    function _pushPendingRegen(kind, msgIdx, tab) {
      const p = load();
      p.pendingRegen = Array.isArray(p.pendingRegen) ? p.pendingRegen : [];
      p.pendingRegen.push({
        ts: Date.now(),
        kind: kind,
        msgIdx: (msgIdx == null ? -1 : msgIdx),
        tab: tab || 'card',
        consumed: false
      });
      if (p.pendingRegen.length > 20) p.pendingRegen = p.pendingRegen.slice(-10);
    }
    function attachAcceptedContent(contentMap, tab) {
      if (!contentMap || load().disabled) return;
      try {
        const p = load();
        const pending = (p.pendingRegen || []).filter(function(x) {
          return !x.consumed && x.tab === (tab || 'card') && (Date.now() - x.ts) < 30 * 60 * 1000;
        });
        if (!pending.length) return;
        // 模糊匹配：剥装饰括号 + 小写
        const _norm = function(s) {
          return String(s || '')
            .replace(/^[<\[【⟦『「〈《\(]+|[>\]】⟧』」〉》\)]+$/g, '')
            .trim().toLowerCase();
        };
        const normMap = {};
        Object.keys(contentMap).forEach(function(k) { normMap[_norm(k)] = contentMap[k]; });
        const fb = p.feedback || [];
        for (let i = fb.length - 1; i >= 0; i--) {
          const f = fb[i];
          if (f.kind !== 'revoke' && f.kind !== 'retry') continue;
          if (!f.entryPairs || !f.entryPairs.length) continue;
          let touched = false;
          f.entryPairs.forEach(function(pr) {
            if (contentMap[pr.name] != null) {
              pr.acceptedContent = String(contentMap[pr.name]).slice(0, FEEDBACK_CONTENT_MAX);
              touched = true;
              return;
            }
            const hit = normMap[_norm(pr.name)];
            if (hit != null) {
              pr.acceptedContent = String(hit).slice(0, FEEDBACK_CONTENT_MAX);
              touched = true;
            }
          });
          if (touched) break;
        }
        pending.forEach(function(x) { x.consumed = true; });
        save();
      } catch (e) { logWarn('UP.attachAcceptedContent', e); }
    }
    // 顶层字段（description/first_mes 等）的"最终接受版"回填
    function attachAcceptedFields(fieldMap, tab) {
      if (!fieldMap || load().disabled) return;
      try {
        const p = load();
        const pending = (p.pendingRegen || []).filter(function(x) {
          return !x.consumedFields && x.tab === (tab || 'card') && (Date.now() - x.ts) < 30 * 60 * 1000;
        });
        if (!pending.length) return;
        const fb = p.feedback || [];
        for (let i = fb.length - 1; i >= 0; i--) {
          const f = fb[i];
          if (f.kind !== 'revoke' && f.kind !== 'retry') continue;
          if (!f.entryPairs || !f.entryPairs.length) continue;
          let touched = false;
          f.entryPairs.forEach(function(pr) {
            if (!pr.name || pr.name.indexOf('顶层字段·') !== 0) return;
            const key = pr.name.slice(5);
            if (fieldMap[key] != null) {
              pr.acceptedContent = String(fieldMap[key]).slice(0, FEEDBACK_CONTENT_MAX);
              touched = true;
            }
          });
          if (touched) break;
        }
        pending.forEach(function(x) { x.consumedFields = true; });
        save();
      } catch (e) { logWarn('UP.attachAcceptedFields', e); }
    }
    function recordRevoke(msgIdx, tab) {
      if (load().disabled) return;
      try {
        incCounter('revokes');
        _pushPendingRegen('revoke', msgIdx, tab);
        recordFriction('revoke', 'msg#'+(msgIdx==null?'?':msgIdx), 2);
        pushEvent('revoke', '');
        save();
      } catch (_) {}
    }
    function recordEdit(type, key) {
      if (load().disabled) return;
      try {
        incCounter('edits');
        const detail = type+(key?':'+key:'');
        recordFriction('edit', detail, 1);
        pushEvent('edit', detail);
        save();
      } catch (_) {}
    }
    function recordRetry(msgIdx, tab) {
      if (load().disabled) return;
      try {
        incCounter('retries');
        _pushPendingRegen('retry', msgIdx, tab);
        recordFriction('retry', 'msg#'+(msgIdx==null?'?':msgIdx), 3);
        pushEvent('retry', '');
        save();
      } catch (_) {}
    }
    function recordContinue() {
      if (load().disabled) return;
      try {
        incCounter('continues');
        recordFriction('continue', '', 1);
        pushEvent('continue', '');
        save();
      } catch (_) {}
    }
    function recordAgentStepRetry(stepIdx) {
      if (load().disabled) return;
      try {
        incCounter('agentRetries');
        recordFriction('agent-retry', 'step#'+stepIdx, 3);
        save();
      } catch (_) {}
    }
    function recordIdleLoop(context) {
      if (load().disabled) return;
      try { recordFriction('idle-loop', context||'', 3); save(); } catch (_) {}
    }

    function recordCardSaved(cardData) {
      if (load().disabled) return;
      try {
        incCounter('cardsSaved');
        const p = load();
        // 字段长度统计（哪些字段用户总会写满，哪些常留空）
        ['name','description','personality','scenario','first_mes','mes_example','creator_notes']
          .forEach(function(f) {
            const v = cardData && cardData[f], len = typeof v === 'string' ? v.length : 0;
            const st = p.fieldStats[f] || (p.fieldStats[f] = { filled:0, totalLen:0 });
            if (len > 0) st.filled++;
            st.totalLen += len;
          });
        // 条目写作习惯
        const es = p.entryStats;
        const entries = (cardData && cardData.character_book && cardData.character_book.entries) || [];
        entries.forEach(function(e) {
          const c = String(e.content || '');
          es.totalCount++; es.totalContentLen += c.length;
          if (e.constant) es.constCount++;
          if (/^[^\s:：]+[:：]/.test(c) && /\n\s+\S/.test(c)) es.yamlCount++;   // 启发式判断 YAML 结构
          const keys = e.keys || (e.key ? [e.key] : []);
          es.keyedCount++; es.keyCount += Array.isArray(keys) ? keys.length : 0;
          const m = String(e.comment || '').match(/^<?\[?([^\>\]\s]{2,12})/);
          if (m && m[1]) p.commentPrefixes[m[1]] = (p.commentPrefixes[m[1]]||0)+1;
        });
        pushEvent('card-saved', (cardData && cardData.name) || '');
        save(true);
      } catch (e) { logWarn('UP.recordCardSaved', e); }
    }

    // ---------------- 分析 ----------------
    function summarize() {
      const p = load();
      const topN = function(o, n) { return Object.keys(o).map(function(k) { return [k, o[k]]; })
        .sort(function(a,b) { return b[1]-a[1]; }).slice(0, n); };
      const sv = p.scaleVotes, maxV = Math.max(sv.safe||0, sv.dark||0, sv.nsfw||0);
      let scale = '未明确';
      if (maxV > 0) {
        const picks = [];
        if (sv.safe === maxV) picks.push('全年龄向');
        if (sv.dark === maxV) picks.push('暗黑向');
        if (sv.nsfw === maxV) picks.push('NSFW(18禁)');
        scale = picks.join(' / ');
      }
      const es = p.entryStats;
      return {
        topGenres: topN(p.genreTags, 3),
        scale: scale,
        avgLen: es.totalCount ? Math.round(es.totalContentLen / es.totalCount) : 0,
        constRate: es.totalCount ? Math.round(es.constCount / es.totalCount * 100) : 0,
        yamlRate: es.totalCount ? Math.round(es.yamlCount / es.totalCount * 100) : 0,
        avgKeys: es.keyedCount ? (es.keyCount / es.keyedCount).toFixed(1) : '0',
        topActions: topN(p.actionUsage, 5),
        topPrefixes: topN(p.commentPrefixes, 5),
        counters: p.counters,
        recentEvents: p.recentEvents.slice(-20).reverse(),
      };
    }

    // ---------------- 摩擦模式识别（滑动窗口 + 加权计数）----------------
    // 返回 [{ pattern, severity, title, hint }]，按严重度降序
    function detectFrictionPatterns(windowMs) {
      windowMs = windowMs || UP_FRICTION_WINDOW_MS;
      const p = load();
      if (!Array.isArray(p.frictions) || p.frictions.length === 0) return [];
      const since = Date.now() - windowMs;
      const recent = p.frictions.filter(function(f){ return f.ts >= since; });
      if (!recent.length) return [];

      // 加权计数：kind 前缀匹配，把 window 内所有匹配事件的 weight 求和
      const wsum = function(kindPrefix) {
        return recent.reduce(function(acc, f) {
          return acc + ((f.kind && f.kind.indexOf(kindPrefix) === 0) ? (f.weight || 1) : 0);
        }, 0);
      };
      const count = function(kindPrefix) {
        return recent.filter(function(f){ return f.kind && f.kind.indexOf(kindPrefix) === 0; }).length;
      };

      const patterns = [];

      // 撤回风暴：加权撤回 >= 4（即 2 次撤回）
      const wRevoke = wsum('revoke');
      if (wRevoke >= 4) {
        patterns.push({
          pattern: 'revoke-storm', severity: wRevoke >= 8 ? 3 : 2,
          title: '连续撤回',
          hint: '你最近连续撤回了 AI 的结果，说明它多次偏离预期。下次提问时明确写"这次要 XXX，不要 YYY"，或撤回后补一句方向再生成。'
        });
      }

      // 重试循环：加权重试 >= 6（即 2 次重试）
      const wRetry = wsum('retry');
      if (wRetry >= 6) {
        patterns.push({
          pattern: 'retry-loop', severity: 3,
          title: '反复重试',
          hint: '同一处反复重试，AI 很可能抓不住核心诉求。建议把期望拆成两三句说清，或直接指出不满意的具体点（如"性格太软，要更强势"）。'
        });
      }

      // 继续依赖：加权继续 >= 3（即 3 次继续）
      const wContinue = wsum('continue');
      if (wContinue >= 3) {
        patterns.push({
          pattern: 'continue-dependence', severity: 2,
          title: '持续续写',
          hint: '连续多次点「继续」，说明 AI 每次产出偏短。下次直接说"一次生成完整内容，不要分段"。'
        });
      }

      // 编辑热点：同一 detail 窗口内被编辑 >=2 次
      const editDetailMap = {};
      recent.filter(function(f){ return f.kind === 'edit'; }).forEach(function(f) {
        if (f.detail) editDetailMap[f.detail] = (editDetailMap[f.detail]||0)+1;
      });
      const hotEditKeys = Object.keys(editDetailMap).filter(function(k){ return editDetailMap[k] >= 2; });
      if (hotEditKeys.length) {
        patterns.push({
          pattern: 'edit-hotspot', severity: 2,
          title: '反复修改同一处',
          hint: '「' + hotEditKeys[0] + '」被反复手动修改。下次让 AI 生成时用更明确的描述（语气/风格/长度），争取一次到位。'
        });
      }

      // 疑问密集：加权 question >= 5
      const wQuestion = wsum('question:');
      if (wQuestion >= 5) {
        const kinds = {};
        recent.filter(function(f){ return f.kind && f.kind.indexOf('question:') === 0; })
          .forEach(function(f) { const k = f.kind.split(':')[1]; kinds[k] = (kinds[k]||0)+1; });
        const top = Object.keys(kinds).sort(function(a,b){ return kinds[b]-kinds[a]; })[0];
        const tips = {
          howto:    '看起来你在找功能入口。右上「工作区」里集中了导入/导出/进度/权重等全部工具。',
          why:      '你多次追问"为什么"。建议直接告诉 AI "上一版哪里不对"，比问原因更容易修。',
          cando:    '你在试探能力边界——几乎所有 ST 世界书字段和 MVU 都能做，不确定时直接问"能不能做 XXX"。',
          help:     '检测到多次求助。可以点「检查」让 Agent 自动梳理缺口并补齐，或直接描述你想要的最终效果。',
          negative: '你多次表达不满。建议把"不对"具体化为"我不要 A，我要 B"，AI 修正精度会高很多。',
          concept:  '你在确认概念。试试点「查看进度」或让 AI 用一句话解释关键词，避免它一次说太多。'
        };
        patterns.push({
          pattern: 'question-dense', severity: 2,
          title: '疑问密集',
          hint: tips[top] || '你在连续提问，可以试试直接描述想要的结果，让 AI 反向补齐。'
        });
      }

      // 修正风暴：撤回 + 编辑 + 重试 同时出现（各至少 1 次）
      if (count('revoke') >= 1 && count('edit') >= 1 && count('retry') >= 1) {
        patterns.push({
          pattern: 'fix-storm', severity: 3,
          title: '反复修正',
          hint: '你在撤回、手动改、重试之间来回。这种情况通常说明沟通成本已经超过自己写。建议把需求用一句话写清，让 AI 从零生成一次，而不是继续局部修。'
        });
      }

      // 空转循环：>=1 次 idle-loop（单事件权重已 3）
      if (count('idle-loop') >= 1) {
        patterns.push({
          pattern: 'idle-loop', severity: 3,
          title: 'AI 空转',
          hint: 'AI 回复"已应用修改"但实际没变化——很可能没匹配到条目。点开预览面板双击该条目手动改，或告诉 AI 精确的条目名。'
        });
      }

      patterns.sort(function(a,b){ return b.severity - a.severity; });
      return patterns;
    }

    // ---------------- 应用：注入 AI 的偏好摘要 + 困难画像 ----------------
    function buildPromptHint(intent) {
      // 兼容单字符串和多意图数组（多意图取分类并集）
      const intents = Array.isArray(intent) ? intent.slice() : [intent || 'all'];
      if (intents.length === 0) intents.push('all');
      const s = summarize();
      const parts = [];

      // 意图 → 允许的分类（writing 永远注入，见下）
      const intentCatMap = {
        card:     ['structure', 'fields', 'general', 'scale'],
        mvu:      ['structure', 'general'],
        frontend: ['fields', 'general'],
        all:      ['structure', 'fields', 'general', 'scale']
      };
      const allowedCats = {};
      intents.forEach(function(it) {
        const cats = intentCatMap[it] || intentCatMap.all;
        cats.forEach(function(c) { allowedCats[c] = true; });
      });
      // 写作类规则始终注入（句子长短/比喻/描写/对话比例是全局约束）
      allowedCats.writing = true;
      if (intents.indexOf('card') >= 0 || intents.indexOf('all') >= 0) allowedCats.scale = true;

      // ★写作规约（从历史反馈提炼，按本轮场景过滤）
      try {
        const rules = getWritingRules();
        // writing/structure/general 始终保留，其余按本轮意图过滤
        const _prio = function(arr) {
          return (arr || []).filter(function(r) {
            const c = r.category || 'general';
            if (c === 'writing' || c === 'structure' || c === 'general') return true;
            return allowedCats[c];
          });
        };
        const filteredAvoid = _prio(rules.avoid);
        const filteredPrefer = _prio(rules.prefer);
        const rlines = [];
        if (filteredAvoid.length) {
          rlines.push('【🔴 用户明确讨厌的写法 · 必须避免（违反视为输出失败）】');
          filteredAvoid.slice(0, 8).forEach(function(r) { rlines.push('· ' + r.text + (r.hits > 1 ? '（×' + r.hits + '）' : '')); });
        }
        if (filteredPrefer.length) {
          if (rlines.length) rlines.push('');
          rlines.push('【🟢 用户明确想要的写法 · 优先执行】');
          filteredPrefer.slice(0, 8).forEach(function(r) { rlines.push('· ' + r.text + (r.hits > 1 ? '（×' + r.hits + '）' : '')); });
        }
        if (rlines.length) parts.push(rlines.join('\n'));
      } catch (e) { logWarn('UP.hint.rules', e); }

      // ★注入"被拒版 vs 用户最终要的"强对照
      try {
        const p = load();
        const fb = p.feedback || [];
        const strongSamples = [];
        fb.forEach(function(f) {
          (f.entryPairs || []).forEach(function(pr) {
            if (!pr.before || pr.before.length < 20) return;
            if (pr.semantics === 'ai-vs-user' && pr.after && pr.after.length > 20) {
              strongSamples.push({ kind: 'ai-vs-user', name: pr.name, bad: pr.before, good: pr.after });
            } else if (pr.semantics === 'baseline-vs-ai' && pr.acceptedContent && pr.acceptedContent.length > 20 && pr.after && pr.after.length > 20 && pr.after !== pr.acceptedContent) {
              strongSamples.push({ kind: 'rejected-vs-accepted', name: pr.name, bad: pr.after, good: pr.acceptedContent });
            } else if (pr.semantics === 'user-rejected' && pr.action === 'delete' && pr.before.length > 30) {
              strongSamples.push({ kind: 'user-rejected', name: pr.name, bad: pr.before, good: '' });
            }
          });
        });
        const picked = strongSamples.slice(-4);
        if (picked.length > 0) {
          const lines = ['【历史对照样本（从你过去的真实修改里抓取，供参考写作风格）】'];
          picked.forEach(function(s, i) {
            lines.push('例' + (i + 1) + ' · 条目「' + s.name + '」' + (s.kind === 'user-rejected' ? '（用户主动删除）' : ''));
            lines.push('  ✗ 用户不要的写法：');
            lines.push('    ' + s.bad.slice(0, 300).replace(/\n/g, '\n    '));
            if (s.good) {
              lines.push('  ✓ 用户想要的写法：');
              lines.push('    ' + s.good.slice(0, 300).replace(/\n/g, '\n    '));
            }
          });
          lines.push('→ 请在本次创作中体现上述差异特征。');
          parts.push(lines.join('\n'));
        }
      } catch (e) { logWarn('UP.hint.samples', e); }

      // 习惯画像
      if (s.counters.cardsSaved || s.counters.userMessages) {
        const lines = ['【用户历史偏好画像（本地统计，仅供参考，以用户本轮明确指令为准）】'];
        if (s.topGenres.length) lines.push('· 常写题材：' + s.topGenres.map(function(g){ return g[0]+'('+g[1]+'次)'; }).join('、'));
        if (s.scale !== '未明确') lines.push('· 内容尺度倾向：' + s.scale);
        if (s.avgLen) lines.push('· 条目平均正文 ' + s.avgLen + ' 字；常驻占比 ' + s.constRate + '%；YAML结构化率 ' + s.yamlRate + '%；平均触发词 ' + s.avgKeys + ' 个');
        if (s.topPrefixes.length) lines.push('· 常用条目前缀：' + s.topPrefixes.map(function(x){ return x[0]+'('+x[1]+'次)'; }).join('、'));
        if (s.counters.cardsSaved) lines.push('· 累计完成角色卡 ' + s.counters.cardsSaved + ' 张；撤回 ' + s.counters.revokes + ' 次；手动编辑 ' + s.counters.edits + ' 次');
        lines.push('→ 请优先复用用户已有的命名/结构习惯，减少重复确认。');
        parts.push(lines.join('\n'));
      }

      // 摩擦画像（当前窗口内识别到的困难）
      try {
        const patterns = detectFrictionPatterns();
        if (patterns.length) {
          const fl = ['【用户当前遇到的困难（请据此主动调整策略）】'];
          patterns.forEach(function(p) { fl.push('· [' + p.title + '] ' + p.hint); });
          fl.push('→ 请主动简化表达、一次性给全产出、避免让用户再问一遍；若识别为表达不清，先复述理解再动笔。');
          parts.push(fl.join('\n'));
        }
        // 近期疑问类型
        const fr = load().frictions || [];
        const qKinds = {};
        fr.slice(-30).forEach(function(f) {
          if (f.kind && f.kind.indexOf('question:') === 0) {
            const k = f.kind.split(':')[1]; qKinds[k] = (qKinds[k]||0)+1;
          }
        });
        if (Object.keys(qKinds).length) {
          const mapping = { howto:'操作入口', why:'结果不符预期', cando:'能力边界', help:'需要示范', negative:'结果不满', concept:'概念解释' };
          const list = Object.keys(qKinds).map(function(k){ return mapping[k] || k; }).join('、');
          parts.push('【用户近期疑问类型】' + list + ' —— 请在回答时主动预判并减少这类问题。');
        }
      } catch (e) { logWarn('UP.buildPromptHint.friction', e); }

      return parts.join('\n\n');
    }

    // ---------------- 控制 ----------------
    function setDisabled(f) { const p = load(); p.disabled = !!f; save(true); }
    function isDisabled() { return !!load().disabled; }
    function clear() {
      try { localStorage.removeItem(USER_PROFILE_KEY); } catch (_) {}
      try { localStorage.removeItem(USER_SKILL_KEY); } catch (_) {}
      try { localStorage.removeItem('szxq_writing_skill_history_v1'); } catch (_) {}
      _cache = null;
    }
    function getRaw() { return load(); }
    function exportJson() { return JSON.stringify(load(), null, 2); }
    function importJson(txt) {
      try { const p = JSON.parse(txt); if (!p || typeof p !== 'object') return false;
        _cache = Object.assign(DEFAULT(), p); save(true); return true; } catch(_) { return false; }
    }

    return { recordUserMessage: recordUserMessage, recordAction: recordAction, recordAgentChoice: recordAgentChoice, recordAiCall: recordAiCall,
             recordOpsChange: recordOpsChange, recordStatusBarGenerated: recordStatusBarGenerated, recordFrontendGenerated: recordFrontendGenerated,
             recordCardSaved: recordCardSaved, recordCardImported: recordCardImported, recordRevoke: recordRevoke, recordEdit: recordEdit,
             // 摩擦信号
             recordUserMessageWithFriction: recordUserMessageWithFriction,
             recordRetry: recordRetry, recordContinue: recordContinue,
             recordAgentStepRetry: recordAgentStepRetry, recordIdleLoop: recordIdleLoop,
             recordFriction: recordFriction,
             detectFrictionPatterns: detectFrictionPatterns,
             summarize: summarize, buildPromptHint: buildPromptHint, setDisabled: setDisabled, isDisabled: isDisabled, clear: clear, getRaw: getRaw,
             exportJson: exportJson, importJson: importJson,
             // 反馈语料 / 写作规约
             recordFeedback: recordFeedback, attachNextMessage: attachNextMessage,
             attachAcceptedContent: attachAcceptedContent,
             attachAcceptedFields: attachAcceptedFields,
             mergeWritingRules: mergeWritingRules, markFeedbackAnalyzed: markFeedbackAnalyzed,
             getWritingRules: getWritingRules, removeWritingRule: removeWritingRule, shouldAnalyze: shouldAnalyze, getUnanalyzedFeedback: getUnanalyzedFeedback,
             saveNow: function() { save(true); } };
  })();

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
    // iframe 内 pagehide 兼容性不足，补 beforeunload 双保险（cleanupScriptArtifacts 内部幂等）
    window.addEventListener('pagehide', cleanupScriptArtifacts);
    window.addEventListener('beforeunload', cleanupScriptArtifacts);
    // 父窗口卸载时也尝试清理（子 iframe 的监听不总会触发）
    try {
      if (window.parent && window.parent !== window) {
        window.parent.addEventListener('pagehide', cleanupScriptArtifacts);
      }
    } catch (_) {}
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