const fs = require('fs');
let content = fs.readFileSync('时之写卡器测试版.js', 'utf8');
let changes = 0;

// ==================================================
// 修改 1: generateMvuSchemaScript - var→const/let + transform 幂等修复 + 统一导入路径
// ==================================================
console.log('=== 修改 1: generateMvuSchemaScript ===');

// 1a) HEADER: 去掉注释前缀，统一导入路径
let oldHeader = 'var HEADER = "/* 必须使用 mvu_zod.js 路径 */ import { registerMvuSchema } from \'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js\';\\n\\nexport const Schema = z.object({";';
let newHeader = 'const HEADER = "import { registerMvuSchema } from \'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js\';\\n\\nexport const Schema = z.object({";';
if (content.indexOf(oldHeader) >= 0) {
  content = content.replace(oldHeader, newHeader);
  changes++;
  console.log('  ✅ 1a: HEADER 统一导入路径，var→const');
} else {
  console.log('  ⚠️ 1a: HEADER 未找到精确匹配，尝试宽松匹配...');
  // 尝试只替换 var HEADER 部分
  content = content.replace(/var HEADER = "\/\* 必须使用 mvu_zod\.js 路径 \*\/ import/g, 'const HEADER = "import');
  changes++;
  console.log('  ✅ 1a: HEADER 已用正则替换');
}

// 1b) buildPhaseTransform 中 var→let，并修复浅拷贝→直接修改
// 好感度阶段：var _aff → const _val，{ ...data } → 直接赋值
let oldAff = "      lines.push(\"        var _aff = Number(data['\" + nm + \"'].好感度 ?? data['\" + nm + \"'].依存度 ?? 0);\");\n      lines.push(\"        var _phase = _aff < 20 ? '陌生' : _aff < 50 ? '熟识' : _aff < 80 ? '好感' : '深爱';\");\n      lines.push(\"        data['\" + nm + \"'] = { ...data['\" + nm + \"'], $好感度阶段: _phase };\");";
let newAff = "      lines.push(\"        const _val = Number(data['\" + nm + \"'].好感度 ?? data['\" + nm + \"'].依存度 ?? 0);\");\n      lines.push(\"        data['\" + nm + \"']['$好感度阶段'] = _val < 20 ? '陌生' : _val < 50 ? '熟识' : _val < 80 ? '好感' : '深爱';\");";
if (content.indexOf(oldAff) >= 0) {
  content = content.replace(oldAff, newAff);
  changes++;
  console.log('  ✅ 1b: 好感度阶段 transform 幂等修复');
} else {
  console.log('  ⚠️ 1b: 好感度阶段未找到精确匹配');
}

// 关系阶段：var _r, var _rp → const，{ ...data } → 直接赋值
let oldRel = "      lines.push(\"        var _r = String(data['\" + nm + \"'].关系 || '');\");\n      lines.push(\"        var _rp = _r.indexOf('陌生') >= 0 ? '陌生' : _r.indexOf('熟识') >= 0 ? '熟识' : _r.indexOf('朋友') >= 0 ? '朋友' : _r.indexOf('暧昧') >= 0 ? '暧昧' : _r.indexOf('恋人') >= 0 ? '恋人' : _r || '陌生';\");\n      lines.push(\"        data['\" + nm + \"'] = { ...data['\" + nm + \"'], $关系阶段: _rp };\");";
let newRel = "      lines.push(\"        const _r = String(data['\" + nm + \"'].关系 || '');\");\n      lines.push(\"        const _rp = _r.indexOf('陌生') >= 0 ? '陌生' : _r.indexOf('熟识') >= 0 ? '熟识' : _r.indexOf('朋友') >= 0 ? '朋友' : _r.indexOf('暧昧') >= 0 ? '暧昧' : _r.indexOf('恋人') >= 0 ? '恋人' : _r || '陌生';\");\n      lines.push(\"        data['\" + nm + \"']['$关系阶段'] = _rp;\");";
if (content.indexOf(oldRel) >= 0) {
  content = content.replace(oldRel, newRel);
  changes++;
  console.log('  ✅ 1c: 关系阶段 transform 幂等修复');
} else {
  console.log('  ⚠️ 1c: 关系阶段未找到精确匹配');
}

// 世界状态派生：var _day → const，{ ...data } → 直接赋值
let oldWorld = "      lines.push(\"        var _day = Number(data['世界']._当前剧情日 ?? data['世界']['_当前剧情日'] ?? 1);\");\n      lines.push(\"        data['世界'] = { ...data['世界'], '$剧情阶段': _day <= 1 ? '开局' : _day <= 3 ? '前期' : _day <= 7 ? '中期' : '后期' };\");";
let newWorld = "      lines.push(\"        const _day = Number(data['世界']._当前剧情日 ?? data['世界']['_当前剧情日'] ?? 1);\");\n      lines.push(\"        data['世界']['$剧情阶段'] = _day <= 1 ? '开局' : _day <= 3 ? '前期' : _day <= 7 ? '中期' : '后期';\");";
if (content.indexOf(oldWorld) >= 0) {
  content = content.replace(oldWorld, newWorld);
  changes++;
  console.log('  ✅ 1d: 世界状态 transform 幂等修复');
} else {
  console.log('  ⚠️ 1d: 世界状态未找到精确匹配');
}

// 1e) 其余 var→const/let（在 generateMvuSchemaScript 函数范围内）
// 只替换函数内部的 var 声明（通过精确匹配上下文）
let varReplacements = [
  // genValueZod 内
  ['      var base = \'z.coerce.number().prefault(', '      const base = \'z.coerce.number().prefault('],
  ['        var itemType = \'z.string()\';', '        let itemType = \'z.string()\';'],
  // genObjectDefaultInline 内
  ['      var parts = Object.keys(obj).map(function(key) {', '      const parts = Object.keys(obj).map(function(key) {'],
  // genObjectLines 内
  ['      var padStr = new Array(indent + 1).join(\' \');', '      const padStr = new Array(indent + 1).join(\' \');'],
  ['      var lines = [];\n      var keys = Object.keys(obj);', '      let lines = [];\n      const keys = Object.keys(obj);'],
  ['        var val = obj[key];\n        var comma = i < keys.length - 1 ? \',\' : \'\';', '        const val = obj[key];\n        const comma = i < keys.length - 1 ? \',\' : \'\';'],
  // collectPhaseTargets 内
  ['      var targets = { aff: [], rel: [], mood: [] };', '      const targets = { aff: [], rel: [], mood: [] };'],
  ['      var topKeys = Object.keys(parsed);', '      const topKeys = Object.keys(parsed);'],
  ['        var k = topKeys[i];', '        const k = topKeys[i];'],
  ['        var inner = parsed[k];', '        const inner = parsed[k];'],
  // buildPhaseTransform 内
  ['      var lines = [];\n      // 好感度阶段', '      let lines = [];\n      // 好感度阶段'],
  // 主逻辑
  ['    var parsed = parseInitVar(initVarContent);', '    let parsed = parseInitVar(initVarContent);'],
  ['    var bodyLines = genObjectLines(parsed, 2);\n    var targets = collectPhaseTargets(parsed);\n    var phaseTransform = buildPhaseTransform(targets, Object.keys(parsed));\n    var hasPhase = phaseTransform && phaseTransform.trim().length > 0;\n\n    var bodyStr = bodyLines.join(\'\\n\');',
   '    const bodyLines = genObjectLines(parsed, 2);\n    const targets = collectPhaseTargets(parsed);\n    const phaseTransform = buildPhaseTransform(targets, Object.keys(parsed));\n    const hasPhase = phaseTransform && phaseTransform.trim().length > 0;\n\n    const bodyStr = bodyLines.join(\'\\n\');'],
  ['    var FOOTER;', '    let FOOTER;'],
];
for (const [oldStr, newStr] of varReplacements) {
  if (content.indexOf(oldStr) >= 0) {
    content = content.replace(oldStr, newStr);
    changes++;
  }
}
console.log('  ✅ 1e: var→const/let 替换完成 (' + varReplacements.length + ' 处)');

// ==================================================
// 修改 2: generateInitVarYaml - 添加物品栏: {}，保持纯净初始态
// ==================================================
console.log('\n=== 修改 2: generateInitVarYaml ===');
let oldInitVar = "  function generateInitVarYaml(charNames) {\n    var lines = [\n      '世界:',\n      '  当前时间: 开局',\n      '  当前地点: 待定'\n    ];\n    (charNames || []).forEach(function(name) {\n      lines.push(name + ':');\n      lines.push('  好感度: 0');\n      lines.push('  状态: 进行中');\n    });\n    // 如果没有主角，补一个主角最小核心字段（好感度+状态，其他所有属性由 zod .prefault() 自动补默认值）\n    if (charNames && charNames.indexOf('主角') < 0) {\n      lines.push('主角:');\n      lines.push('  好感度: 0');\n      lines.push('  状态: 进行中');\n    }\n    return lines.join('\\n');\n  }";
let newInitVar = "  function generateInitVarYaml(charNames) {\n    // ⚠️纯净初始态：不包含 stat_data 根键；不包含 _/$ 开头字段（由 zod prefault/transform 生成）\n    const lines = [\n      '世界:',\n      '  当前时间: D1 - 清晨',\n      '  当前地点: 走廊'\n    ];\n    (charNames || []).forEach(function(name) {\n      lines.push(name + ':');\n      lines.push('  好感度: 0');\n      lines.push('  状态: 正常');\n      if (name === '主角') lines.push('  物品栏: {}');\n    });\n    // 如果没有主角，补一个主角最小核心字段\n    if (charNames && charNames.indexOf('主角') < 0) {\n      lines.push('主角:');\n      lines.push('  好感度: 0');\n      lines.push('  状态: 正常');\n      lines.push('  物品栏: {}');\n    }\n    return lines.join('\\n');\n  }";
if (content.indexOf(oldInitVar) >= 0) {
  content = content.replace(oldInitVar, newInitVar);
  changes++;
  console.log('  ✅ generateInitVarYaml 已更新');
} else {
  console.log('  ⚠️ 未找到精确匹配');
}

// ==================================================
// 修改 3: generateVarUpdateRule - 精简联动版
// ==================================================
console.log('\n=== 修改 3: generateVarUpdateRule ===');
let oldRule = "  function generateVarUpdateRule(charNames) {\n    var lines = [\n      '---',\n      '变量更新规则:',\n      '  世界:',\n      '    当前时间:',\n      '      format: ${xx历}-${YYYY/MM/DD}-${HH:MM}',\n      '      check:',\n      '        - 每次事件推进、休息或旅行后更新，保持时间流逝合理',\n      '        - 若场景跳转跨度较大，应说明跳跃原因',\n      '    当前地点:',\n      '      check:',\n      '        - 场景发生明确移动或地点变化时更新，描述具体位置'\n    ];\n    // ⚠️多角色共性属性用 ${角色名} 合并规则，不重复书写\n    if (charNames && charNames.length > 0) {\n      lines.push('  ${角色名}.好感度:');\n      lines.push('    type: number');\n      lines.push('    check:');\n      lines.push('      - 仅在有明确情感互动且角色感知到时更新');\n      lines.push('      - 变动幅度建议 ±(1~3)，zod已自动做clamp(0,100)，AI无需重复约束范围');\n      lines.push('      - 优先用 delta 操作（如 {\"op\":\"delta\",\"path\":\"/${角色名}/好感度\",\"value\":+1}）');\n      lines.push('  ${角色名}.心情:');\n      lines.push('    check:');\n      lines.push('      - 仅在环境变化或互动产生明确情绪波动时更新，2-4字简明描述（平静/喜悦/焦虑/害羞等）');\n      lines.push('  ${角色名}.状态:');\n      lines.push('    check:');\n      lines.push('      - 从\"进行中/已暂停/已完成/已失败\"中选，仅剧情本质推进时才切换');\n      lines.push('  ${角色名}.关系:');\n      lines.push('    check:');\n      lines.push('      - 仅关系本质性改变时才更新（陌生→熟识→朋友→暧昧→恋人），一次互动不足以越级');\n      // 主角专属规则（物品栏、能力面板等）\n      if (charNames.indexOf('主角') >= 0) {\n        lines.push('  主角.物品栏:');\n        lines.push('    type: |-');\n        lines.push('      {');\n        lines.push('        [物品名: string]: {');\n        lines.push('          描述: string;');\n        lines.push('          数量: number;');\n        lines.push('        }');\n        lines.push('      }');\n        lines.push('    check:');\n        lines.push('      - 获得：{\"op\":\"insert\",\"path\":\"/主角/物品栏/物品名\",\"value\":{\"描述\":\"...\",\"数量\":1}}');\n        lines.push('      - 消耗：{\"op\":\"remove\",\"path\":\"/主角/物品栏/物品名\"}；数量变化：{\"op\":\"delta\",\"path\":\"/主角/物品栏/物品名/数量\",\"value\":-1}');\n      }\n    }\n    return lines.join('\\n');\n  }";
let newRule = "  function generateVarUpdateRule(charNames) {\n    // ⚠️精简联动版：zod 已定义 range/clamp，此处不重复；check 规则简洁化\n    const lines = [\n      '---',\n      '变量更新规则:',\n      '  世界.当前时间:',\n      '    format: D${天数}-${时间段}',\n      '    check:',\n      '      - 仅在场景切换或显著休息后推进时间',\n      '  世界.当前地点:',\n      '    check:',\n      '      - 场景发生明确移动时更新为具体位置'\n    ];\n    if (charNames && charNames.length > 0) {\n      lines.push('  ${角色}.好感度:');\n      lines.push('    type: number');\n      lines.push('    check:');\n      lines.push('      - 依据{{user}}互动感知调整 ±(1~3)');\n      lines.push('      - 严禁在无直接互动时大幅变动');\n      lines.push('  ${角色}.心情:');\n      lines.push('    check:');\n      lines.push('      - 2-4字简述当前情绪波动');\n      lines.push('  ${角色}.状态:');\n      lines.push('    check:');\n      lines.push('      - 仅剧情本质推进时切换（正常/异常/濒死等）');\n      lines.push('  ${角色}.关系:');\n      lines.push('    check:');\n      lines.push('      - 仅关系本质性改变时更新，一次互动不足以越级');\n      if (charNames.indexOf('主角') >= 0) {\n        lines.push('  主角.物品栏:');\n        lines.push('    type: \"{ [物品名: string]: { 描述: string; 数量: number } }\"');\n        lines.push('    check:');\n        lines.push('      - 获得新物品使用 insert，消耗使用 remove 或 delta 数量');\n      }\n    }\n    return lines.join('\\n');\n  }";
if (content.indexOf(oldRule) >= 0) {
  content = content.replace(oldRule, newRule);
  changes++;
  console.log('  ✅ generateVarUpdateRule 已精简');
} else {
  console.log('  ⚠️ 未找到精确匹配');
}

// ==================================================
// 修改 4: normalizeVarListContent - 强校验复数标签
// ==================================================
console.log('\n=== 修改 4: normalizeVarListContent ===');
let oldNorm = "  function normalizeVarListContent(content) {\n    var macro = '{{format_message_variable::stat_data}}';\n    var stdBlock = '---\\n<status_current_variables>\\n' + macro + '\\n</status_current_variables>';\n    if (!content || !content.trim()) return stdBlock;\n    // 修正 AI 误写的占位符（如 {{null}}、{{get_message_variable::stat_data}} 等）\n    var cleaned = content.replace(/\\{\\{null\\}\\}/gi, macro)\n                         .replace(/\\{\\{get_message_variable::stat_data\\}\\}/gi, macro)\n                         .replace(/\\{\\{format_message_variable::[^}]*\\}\\}/gi, macro);\n    // 含宏：重建为标准格式（丢弃所有混入的变量实际值/配置字段）\n    if (cleaned.indexOf(macro) >= 0) {\n      return stdBlock;\n    }\n    // ⚠️用户规范：严格复数标签。若误写单数标签（AI漏写s），**强制替换为复数**，否则酒馆助手的宏无法识别\n    // 检测单数标签 <status_current_variable> (不带s) 并强制修复为复数\n    if (/<status_current_variable\\s*>[\\s\\S]*?<\\/status_current_variable\\s*>/i.test(cleaned)) {\n      cleaned = cleaned.replace(/<status_current_variable\\s*>/gi, '<status_current_variables>')\n                       .replace(/<\\/status_current_variable\\s*>/gi, '</status_current_variables>');\n    }\n    // 含复数包裹标签：在标签内注入宏（保证内容正确）\n    if (/<status_current_variables>[\\s\\S]*?<\\/status_current_variables>/i.test(cleaned)) {\n      cleaned = cleaned.replace(/(<status_current_variables>)([\\s\\S]*?)(<\\/status_current_variables>)/i,\n        '$1\\n' + macro + '\\n$3');\n      return '---\\n' + cleaned;\n    }\n    return cleaned.replace(/\\s+$/, '') + '\\n' + stdBlock;\n  }";
let newNorm = "  function normalizeVarListContent(content) {\n    // ⚠️强校验版：必须严格使用复数 variables 标签；标签内只保留宏，过滤 null/杂质\n    const macro = '{{format_message_variable::stat_data}}';\n    const stdBlock = '---\\n<status_current_variables>\\n' + macro + '\\n</status_current_variables>';\n    if (!content || !content.trim()) return stdBlock;\n    // 修正 AI 误写的占位符（如 {{null}}、{{get_message_variable::stat_data}}、纯文本 null 等）\n    let cleaned = content.replace(/\\{\\{null\\}\\}/gi, macro)\n                         .replace(/\\{\\{get_message_variable::stat_data\\}\\}/gi, macro)\n                         .replace(/\\{\\{format_message_variable::[^}]*\\}\\}/gi, macro);\n    // 修正标签内的纯 null 文本\n    cleaned = cleaned.replace(/(<status_current_variables>)\\s*null\\s*(<\\/status_current_variables>)/gi, '$1\\n' + macro + '\\n$2');\n    // 含宏：重建为标准格式（丢弃所有混入的变量实际值/配置字段）\n    if (cleaned.indexOf(macro) >= 0) {\n      return stdBlock;\n    }\n    // ⚠️严格复数标签：若误写单数标签（AI漏写s），强制替换为复数\n    if (/<status_current_variable\\s*>[\\s\\S]*?<\\/status_current_variable\\s*>/i.test(cleaned)) {\n      cleaned = cleaned.replace(/<status_current_variable\\s*>/gi, '<status_current_variables>')\n                       .replace(/<\\/status_current_variable\\s*>/gi, '</status_current_variables>');\n    }\n    // 含复数包裹标签：在标签内注入宏（保证内容正确）\n    if (/<status_current_variables>[\\s\\S]*?<\\/status_current_variables>/i.test(cleaned)) {\n      cleaned = cleaned.replace(/(<status_current_variables>)([\\s\\S]*?)(<\\/status_current_variables>)/i,\n        '$1\\n' + macro + '\\n$3');\n      return '---\\n' + cleaned;\n    }\n    return cleaned.replace(/\\s+$/, '') + '\\n' + stdBlock;\n  }";
if (content.indexOf(oldNorm) >= 0) {
  content = content.replace(oldNorm, newNorm);
  changes++;
  console.log('  ✅ normalizeVarListContent 强校验版已更新');
} else {
  console.log('  ⚠️ 未找到精确匹配');
}

// ==================================================
// 修改 5: DEFAULT_STEP3_HTML - 标准支撑骨架
// ==================================================
console.log('\n=== 修改 5: DEFAULT_STEP3_HTML ===');
let oldStep3 = "var DEFAULT_STEP3_HTML = '<div id=\"render-root\" class=\"stat-box\"></div>';";
let newStep3 = "var DEFAULT_STEP3_HTML =\n        '<div class=\"mvu-status-card\">' +\n        '  <div class=\"status-header\">' +\n        '    <div class=\"char-name\" id=\"char-name\">加载中...</div>' +\n        '    <div class=\"world-time\" id=\"world-time\">--</div>' +\n        '  </div>' +\n        '  <div class=\"card-body\" id=\"render-root\">' +\n        '    <div class=\"stat-grid\">' +\n        '      <div class=\"stat-item\">' +\n        '        <span class=\"stat-label\">好感度</span>' +\n        '        <div class=\"progress-bar\"><div id=\"affinity-bar\" class=\"progress-bar-fill\"></div></div>' +\n        '        <span class=\"stat-value\" id=\"affinity-val\">0</span>' +\n        '      </div>' +\n        '    </div>' +\n        '  </div>' +\n        '  <div class=\"loading-state\" id=\"loading-mask\"><span>SYSTEM INITIALIZING...</span></div>' +\n        '</div>';";
if (content.indexOf(oldStep3) >= 0) {
  content = content.replace(oldStep3, newStep3);
  changes++;
  console.log('  ✅ DEFAULT_STEP3_HTML 已替换为标准支撑骨架');
} else {
  console.log('  ⚠️ 未找到精确匹配');
}

// ==================================================
// 修改 6: DEFAULT_STEP6_JS - 事件驱动 + errorCatched
// ==================================================
console.log('\n=== 修改 6: DEFAULT_STEP6_JS ===');
let oldStep6 = "var DEFAULT_STEP6_JS =\n        '(function init(){\\n' +\n        '  try { if (typeof waitGlobalInitialized === \"function\") waitGlobalInitialized(\"Mvu\"); } catch(e) {}\\n' +\n        '  var max=15,count=0; var _sbTimer=null;\\n' +\n        '  function _safeGetVars(){try{return getAllVariables()||{};}catch(e){return{};}}\\n' +\n        '  function _hasStatData(){var v=_safeGetVars();return v&&typeof v===\"object\"&&v.stat_data!==undefined;}\\n' +\n        '  function tryRender(){try{typeof populateCharacterData===\"function\"&&populateCharacterData();}catch(e1){try{typeof refreshStatus===\"function\"&&refreshStatus();}catch(e2){}}count++;if(!_hasStatData()){if(count<max){setTimeout(tryRender,1000);}return;}_sbTimer&&(clearInterval(_sbTimer),_sbTimer=null);typeof populateCharacterData===\"function\"?populateCharacterData():(typeof refreshStatus===\"function\"&&refreshStatus());}\\n' +\n        '  tryRender();\\n' +\n        '  try{if(typeof eventOn===\"function\"&&typeof Mvu!==\"undefined\"&&Mvu&&Mvu.events){eventOn(Mvu.events.VARIABLE_INITIALIZED,typeof populateCharacterData===\"function\"?populateCharacterData:refreshStatus);eventOn(Mvu.events.VARIABLE_UPDATE_ENDED,typeof populateCharacterData===\"function\"?populateCharacterData:refreshStatus);}}catch(e){}\\n' +\n        '  /* 兼容旧版：保留2秒兜底轮询，避免事件不触发 */\\n' +\n        '  _sbTimer=setInterval(function(){try{typeof populateCharacterData===\"function\"?populateCharacterData():(typeof refreshStatus===\"function\"&&refreshStatus());}catch(e){}},2000);\\n' +\n        '  document&&document.addEventListener&&document.addEventListener(\"visibilitychange\",function(){if(document.hidden){_sbTimer&&(clearInterval(_sbTimer),_sbTimer=null);}else if(!_sbTimer){_sbTimer=setInterval(function(){try{typeof populateCharacterData===\"function\"?populateCharacterData():(typeof refreshStatus===\"function\"&&refreshStatus());}catch(e){}},2000);}});\\n' +\n        '  window&&window.addEventListener&&window.addEventListener(\"pagehide\",function(){_sbTimer&&(clearInterval(_sbTimer),_sbTimer=null);});\\n' +\n        '})();';";
let newStep6 = "var DEFAULT_STEP6_JS =\n        'async function init() {\\n' +\n        '  /* 1. 等待 MVU 核心就绪 */\\n' +\n        '  await waitGlobalInitialized(\"Mvu\");\\n' +\n        '  /* 2. 执行首次渲染 */\\n' +\n        '  populateCharacterData();\\n' +\n        '  /* 3. 监听变量更新结束事件，实现即时自动刷新（优于定时器） */\\n' +\n        '  eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => { populateCharacterData(); });\\n' +\n        '  /* 4. 绑定 UI 交互 */\\n' +\n        '  $(\".status-header\").on(\"click\", function() { $(\"#render-root\").slideToggle(200); });\\n' +\n        '}\\n' +\n        '/* 必须使用 errorCatched 包装以防止脚本崩溃导致酒馆卡死 */\\n' +\n        '$(errorCatched(init));';";
if (content.indexOf(oldStep6) >= 0) {
  content = content.replace(oldStep6, newStep6);
  changes++;
  console.log('  ✅ DEFAULT_STEP6_JS 已替换为事件驱动 + errorCatched');
} else {
  console.log('  ⚠️ 未找到精确匹配，尝试宽松匹配...');
  // 尝试只匹配开头和结尾
  let s6Start = content.indexOf('var DEFAULT_STEP6_JS =');
  let s6End = content.indexOf("        '})();';", s6Start);
  if (s6Start >= 0 && s6End >= 0) {
    s6End = content.indexOf('\n', s6End) + 1;
    content = content.substring(0, s6Start) + newStep6 + content.substring(s6End);
    changes++;
    console.log('  ✅ DEFAULT_STEP6_JS 已用宽松匹配替换');
  } else {
    console.log('  ❌ DEFAULT_STEP6_JS 完全未找到');
  }
}

// ==================================================
// 保存
// ==================================================
fs.writeFileSync('时之写卡器测试版.js', content);
console.log('\n=== 保存完毕，共 ' + changes + ' 处修改 ===');

// 验证
let fc = fs.readFileSync('时之写卡器测试版.js', 'utf8');
console.log('\n验证:');
console.log('  1. HEADER 无注释前缀:', fc.indexOf('const HEADER = "import') >= 0 ? 'ok' : '缺失');
console.log('  2. transform 直接修改 data:', fc.indexOf("['$好感度阶段'] = _val") >= 0 ? 'ok' : '缺失');
console.log('  3. 无浅拷贝 { ...data:', fc.indexOf("{ ...data['\" + nm") >= 0 ? '⚠️还有残留' : 'ok');
console.log('  4. InitVar 物品栏:', fc.indexOf("'  物品栏: {}'") >= 0 ? 'ok' : '缺失');
console.log('  5. 更新规则精简:', fc.indexOf('依据{{user}}互动感知调整') >= 0 ? 'ok' : '缺失');
console.log('  6. 变量列表 null 修正:', fc.indexOf('null\\\\s*</status_current_variables>') >= 0 || fc.indexOf('纯 null 文本') >= 0 ? 'ok' : '缺失');
console.log('  7. Step3 骨架:', fc.indexOf('status-header') >= 0 ? 'ok' : '缺失');
console.log('  8. Step6 errorCatched:', fc.indexOf('$(errorCatched(init))') >= 0 ? 'ok' : '缺失');
console.log('  9. Step6 无 setInterval:', fc.indexOf('_sbTimer=setInterval') >= 0 ? '⚠️还有残留' : 'ok');
