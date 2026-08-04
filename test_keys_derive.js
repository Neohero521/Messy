// 【最小化函数抽取验证脚本】
// 因为 parseOpBlocks / applyOps 在 openEditor 的嵌套 function 作用域中，无法从 IIFE 顶层导出。
// 这里采用“同源逻辑重放”的验证方式：
//   1) 从源码中截取 IIFE 顶层可访问的函数 (getEntryTemplate / _deriveEntryKeys / _sanitizeWorldbookEntriesForWrite / _stripOuterBrackets)
//   2) 按源码中完全一致的逻辑，手写一份最小化的 parseOpBlocks/applyOps 等价实现（仅验证核心行为）
//   最终目标：
//     ✓ 非蓝灯条目：_deriveEntryKeys 派生 keys 非空
//     ✓ 块体解析：元信息行被剥离到 meta，content 正文不含 keys/secondary_keys 行
//     ✓ applyOps 写入：非蓝灯条目 keys 非空 & content 正文纯净
//     ✓ AI 漏填：applyOps 自动派生补全
//     ✓ _sanitizeWorldbookEntriesForWrite：最终写入酒馆前强制补 keys
var fs = require('fs');
var src = fs.readFileSync('/workspace/写卡工具/时之写卡器.js', 'utf8');

// ========= Step 1：抽取 4 个 IIFE 顶层函数（用 eval 到 sandbox） =========
// 找这几个函数的起止行，截出来拼成一段 evalable 的代码
var lines = src.split(/\n/);
var findFuncRange = function(startLineIdx, endHintRegex, openCloseChar, maxEndOffset) {
  // startLineIdx 是函数开始行（0-based）。用大括号匹配找到函数体结束。
  var depth = 0; var started = false;
  for (var i = startLineIdx; i < Math.min(lines.length, startLineIdx + (maxEndOffset || 3000)); i++) {
    var ln = lines[i];
    for (var j = 0; j < ln.length; j++) {
      var ch = ln[j], prev = j>0 ? ln[j-1] : '';
      if (!started) {
        if (ch === '{') { started = true; depth = 1; }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        // skip string（保守跳：直接到同字符串结束符）
        var q = ch; j++;
        while (j < ln.length && !(ln[j] === q && ln[j-1] !== '\\')) j++;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (started && depth === 0) return [startLineIdx, i]; }
    }
  }
  return null;
};

var S2 = {};
(function(){
  // 1) 找 ENTRY_TEMPLATES（在 IIFE 顶层，被 getEntryTemplate 引用）
  var tmplStart = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*(?:var|let|const)\s+ENTRY_TEMPLATES\s*=\s*\{/.test(lines[i])) { tmplStart = i; break; }
  }
  if (tmplStart < 0) throw new Error('找不到 ENTRY_TEMPLATES');
  var tmplRange = findFuncRange(tmplStart, null, null, 800);

  // 2) 找 getEntryTemplate 定义（L1008 → 0-based 1007）
  var getETStart = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*function\s+getEntryTemplate\s*\(/.test(lines[i])) { getETStart = i; break; }
  }
  var getETRange = findFuncRange(getETStart);
  if (!getETRange) throw new Error('找不到 getEntryTemplate 结束');

  // 3) 找 _stripOuterBrackets（L3478 是内部的，IIFE 顶层也有个同逻辑的在 L1008 之前？之前用的是 processEntriesFn 内部的 _stripOuterBrackets。L1054 在 _deriveEntryKeys 里也调 _stripOuterBrackets，所以 IIFE 顶层必须有个 _stripOuterBrackets。找这个 IIFE 顶层声明：）
  var stripStart = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*function\s+_stripOuterBrackets\s*\(/.test(lines[i])) { stripStart = i; break; }
  }
  var stripRange;
  if (stripStart >= 0) stripRange = findFuncRange(stripStart);
  // 找不到顶层的？那就用源码中 L3478 的同样逻辑手写一份
  var stripCode;
  if (stripRange) {
    stripCode = lines.slice(stripRange[0], stripRange[1] + 1).join('\n');
  } else {
    stripCode = `
function _stripOuterBrackets(s) {
  if (!s) return '';
  var r = String(s).trim();
  for (var iter = 0; iter < 2; iter++) {
    var pairs = [['⟦','⟧'],['【','】'],['「','」'],['『','』'],['［','］'],['《','》'],['〈','〉'],['(',')'],['[',']'],['{','}']];
    var matched = false;
    for (var pi = 0; pi < pairs.length; pi++) {
      var L = pairs[pi][0], R = pairs[pi][1];
      if (r.length >= 4 && r.charAt(0) === L && r.charAt(r.length-1) === R) {
        r = r.slice(1, -1).trim(); matched = true; break;
      }
    }
    if (!matched) break;
  }
  return r;
}`;
  }

  // 4) 找 _deriveEntryKeys（L1049 → 0-based 1048）
  var derStart = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*function\s+_deriveEntryKeys\s*\(/.test(lines[i])) { derStart = i; break; }
  }
  var derRange = findFuncRange(derStart, null, null, 300);

  // 5) 找 _sanitizeWorldbookEntriesForWrite（L6704 → 0-based 6703）
  var sanStart = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*function\s+_sanitizeWorldbookEntriesForWrite\s*\(/.test(lines[i])) { sanStart = i; break; }
  }
  var sanRange = findFuncRange(sanStart, null, null, 500);

  console.log('截取函数范围:',
    'ENTRY_TEMPLATES[' + tmplRange.map(function(x){return x+1;}).join('-') + ']',
    'getEntryTemplate[' + getETRange.map(function(x){return x+1;}).join('-') + ']',
    '_deriveEntryKeys[' + derRange.map(function(x){return x+1;}).join('-') + ']',
    '_sanitize[' + sanRange.map(function(x){return x+1;}).join('-') + ']',
    'strip=' + (stripRange?stripRange.map(function(x){return x+1;}).join('-'):'手写'));

  var code = [
    '(function(){',
    '  var exports = {};',
    lines.slice(tmplRange[0], tmplRange[1] + 1).join('\n'),         // ENTRY_TEMPLATES
    stripCode,
    lines.slice(getETRange[0], getETRange[1] + 1).join('\n'),       // getEntryTemplate
    lines.slice(derRange[0], derRange[1] + 1).join('\n'),           // _deriveEntryKeys
    lines.slice(sanRange[0], sanRange[1] + 1).join('\n'),           // _sanitizeWorldbookEntriesForWrite
    '  exports.ENTRY_TEMPLATES = ENTRY_TEMPLATES;',
    '  exports.getEntryTemplate = getEntryTemplate;',
    '  exports._deriveEntryKeys = _deriveEntryKeys;',
    '  exports._sanitizeWorldbookEntriesForWrite = _sanitizeWorldbookEntriesForWrite;',
    '  exports._stripOuterBrackets = _stripOuterBrackets;',
    '  return exports;',
    '})()'
  ].join('\n');

  // 执行并把结果挂到 S2
  var mod = eval(code);
  for (var k in mod) S2[k] = mod[k];
})();

console.log('✅ 抽取函数 OK:', Object.keys(S2));

// ========= Step 2：按源码完全一致的逻辑手写最小 parseOpBlocks / applyOps =========
function _opNormKey(s) {
  if (!s) return '';
  var r = String(s).trim();
  for (var iter = 0; iter < 2; iter++) {
    var pairs = [['⟦','⟧'],['【','】'],['「','」'],['『','』'],['［','］'],['《','》'],['〈','〉'],['(',')'],['[',']'],['{','}']];
    var matched = false;
    for (var pi = 0; pi < pairs.length; pi++) {
      var L = pairs[pi][0], R = pairs[pi][1];
      if (r.length >= 4 && r.charAt(0) === L && r.charAt(r.length-1) === R) {
        r = r.slice(1, -1).trim(); matched = true; break;
      }
    }
    if (!matched) break;
  }
  return r.toLowerCase();
}

function parseOpBlocks(rawText) {
  if (!rawText) return [];
  var ops = [];
  var re = /:::\s*(upsert|update|delete|set|rename)\s+([^\n\r]+?)\n([\s\S]*?)(?=\n\s*:::|$)/gi;
  var m;
  var metaFields = ['keys','secondary_keys','selectiveLogic','constant','depth','cooldown','sticky','delay',
                    'vectorized','prevent_recursion','exclude_recursion','delay_until_recursion','use_regex',
                    'probability','group','order','insertion_order','position','useProbability','scan_depth',
                    'match_whole_words','enabled','group_weight'];
  var _stripMeta = function(bodyStr) {
    var lns = bodyStr.split(/\r?\n/);
    var meta = {};
    var splitIdx = -1;
    for (var li = 0; li < lns.length; li++) {
      var line = lns[li];
      var tline = line.trim();
      if (tline === '') { splitIdx = li + 1; break; }
      var eq = tline.indexOf('=');
      if (eq < 2) { splitIdx = li; break; }
      var k = tline.substring(0, eq).trim();
      var v = tline.substring(eq + 1).trim();
      var matchedKey = null;
      for (var mi = 0; mi < metaFields.length; mi++) {
        if (metaFields[mi].toLowerCase() === k.toLowerCase()) { matchedKey = metaFields[mi]; break; }
      }
      if (!matchedKey) { splitIdx = li; break; }
      if (matchedKey === 'keys' || matchedKey === 'secondary_keys') {
        meta[matchedKey] = v.split(/[,，]/).map(function(s){return s.trim();}).filter(function(s){return s.length>0;});
      } else if (/constant|vectorized|prevent_recursion|exclude_recursion|delay_until_recursion|use_regex|useProbability|match_whole_words|enabled/.test(matchedKey)) {
        meta[matchedKey] = /^(true|1|yes|是)$/i.test(v);
      } else if (matchedKey === 'group') {
        meta[matchedKey] = v;
      } else {
        var n = Number(v);
        meta[matchedKey] = (!isNaN(n) && String(n) === v) ? n : v;
      }
    }
    var bodyLines = (splitIdx >= 0) ? lns.slice(splitIdx) : lns;
    return { meta: meta, content: bodyLines.join('\n').trim() };
  };
  while ((m = re.exec(rawText)) !== null) {
    var action = m[1].toLowerCase();
    var key = m[2].trim();
    var rawBody = (m[3] || '').trim();
    if (action === 'upsert' || action === 'update') {
      var r = _stripMeta(rawBody);
      var opRec = { action: action, key: key, content: r.content };
      for (var _mk in r.meta) opRec[_mk] = r.meta[_mk];
      ops.push(opRec);
    } else if (action === 'rename') {
      var am = key.match(/^(.+?)\s*(?:->|→|=>)\s*(.+)$/);
      if (am) ops.push({ action:'rename', oldKey:am[1].trim(), newKey:am[2].trim(), content:'' });
    } else {
      ops.push({ action: action, key: key, content: rawBody });
    }
  }
  return ops;
}

function applyOps(ops, cd) {
  if (!ops || !ops.length || !cd) return { modified: false, changeLog:{ added:0,updated:0,deleted:0,fieldUpdates:0,renamed:0 } };
  var modified = false;
  var changeLog = { added:0, updated:0, deleted:0, fieldUpdates:0, renamed:0 };
  if (!cd.character_book) cd.character_book = { entries: [] };
  if (!cd.character_book.entries) cd.character_book.entries = [];
  ops.forEach(function(op) {
    if (op.action === 'upsert' || op.action === 'update') {
      var cleanComment = op.key;
      for (var iter = 0; iter < 2; iter++) {
        var pairs = [['⟦','⟧'],['【','】'],['「','」'],['『','』'],['［','］'],['《','》'],['〈','〉'],['(',')'],['[',']'],['{','}']];
        var didStrip = false;
        for (var pi = 0; pi < pairs.length; pi++) {
          var L = pairs[pi][0], R = pairs[pi][1];
          if (cleanComment.length >= 4 && cleanComment.charAt(0) === L && cleanComment.charAt(cleanComment.length-1) === R) {
            cleanComment = cleanComment.slice(1, -1).trim(); didStrip = true; break;
          }
        }
        if (!didStrip) break;
      }
      var basePatch = { comment: cleanComment };
      if (op.content && op.content.trim().length > 0) basePatch.content = op.content;
      var metaKeysTop = ['keys','secondary_keys','constant','vectorized','use_regex','enabled'];
      var extMap = { selectiveLogic:'selectiveLogic', depth:'depth', cooldown:'cooldown', sticky:'sticky', delay:'delay',
                     probability:'probability', prevent_recursion:'prevent_recursion', exclude_recursion:'exclude_recursion',
                     delay_until_recursion:'delay_until_recursion', group:'group', group_weight:'group_weight' };
      var extPatch = null;
      for (var _mki = 0; _mki < metaKeysTop.length; _mki++) {
        var mk = metaKeysTop[_mki];
        if (op[mk] === undefined) continue;
        if (extMap[mk]) { extPatch = extPatch || {}; extPatch[extMap[mk]] = op[mk]; }
        else basePatch[mk] = op[mk];
      }
      // selectiveLogic / depth 也可能在块体头里
      for (var ek in extMap) {
        if (op[ek] !== undefined) { extPatch = extPatch || {}; extPatch[extMap[ek]] = op[ek]; }
      }
      var nk = _opNormKey(op.key);
      var foundIdx = -1;
      for (var fi = 0; fi < cd.character_book.entries.length; fi++) {
        if (_opNormKey(cd.character_book.entries[fi].comment) === nk) { foundIdx = fi; break; }
      }
      if (foundIdx >= 0) {
        var oldEntry = cd.character_book.entries[foundIdx];
        var mergedEntry = Object.assign({}, oldEntry, basePatch);
        if (extPatch) mergedEntry.extensions = Object.assign({}, (oldEntry && oldEntry.extensions) || {}, extPatch);
        var _tmplHere = S2.getEntryTemplate(mergedEntry.comment || '');
        if ((!mergedEntry.keys || mergedEntry.keys.length === 0) && !((_tmplHere && _tmplHere.constant) || mergedEntry.constant)) {
          mergedEntry.keys = S2._deriveEntryKeys(mergedEntry.comment, _tmplHere, mergedEntry.content);
        }
        if (!mergedEntry.secondary_keys) mergedEntry.secondary_keys = [];
        cd.character_book.entries[foundIdx] = mergedEntry;
        modified = true; changeLog.updated++;
      } else {
        if (op.action === 'update') { /* skip */ }
        else {
          var newEntry = Object.assign({
            comment: cleanComment, content: op.content || '', constant: false, position: 0,
            keys: [], secondary_keys: [], extensions: {}
          }, basePatch);
          if (extPatch) newEntry.extensions = Object.assign({}, newEntry.extensions || {}, extPatch);
          var _tmplNew = S2.getEntryTemplate(newEntry.comment || '');
          if (_tmplNew) {
            if (newEntry.selective === undefined) newEntry.selective = _tmplNew.selective;
            if (newEntry.constant === undefined) newEntry.constant = _tmplNew.constant;
          }
          if ((!newEntry.keys || newEntry.keys.length === 0) && !(newEntry.constant || (_tmplNew && _tmplNew.constant))) {
            newEntry.keys = S2._deriveEntryKeys(newEntry.comment, _tmplNew, newEntry.content);
          }
          if (!newEntry.secondary_keys) newEntry.secondary_keys = [];
          cd.character_book.entries.push(newEntry);
          modified = true; changeLog.added++;
        }
      }
    } else if (op.action === 'delete') {
      var dk = _opNormKey(op.key);
      cd.character_book.entries = cd.character_book.entries.filter(function(e) {
        return _opNormKey(e.comment || '') !== dk;
      });
      changeLog.deleted++;
    }
  });
  return { modified: modified, changeLog: changeLog };
}

// ========= 验证开始 =========
var allPass = true;
function check(cond, msg){ if(!cond){ console.log('❌', msg); allPass = false; process.exitCode = 1; } else { console.log('✅', msg); } }

// 测试1：_deriveEntryKeys 派生
console.log('\n=== 测试1：_deriveEntryKeys 直接派生 ===');
var cases1 = [
  { c:'<重要角色>白娅', content:'身份：父母双亡的女高中生，寄居在父母朋友家中。外貌：娇小纤细的萝莉体型，校服整洁。' },
  { c:'⟦<重要角色>白娅·人际关系⟧', content:'与林雪老师：表面礼貌实则疏远。女仆：现在的主要生活照料者。' },
  { c:'<地点场景>天台观星台', content:'屋顶有一台古旧的望远镜，夜晚可以看到流星。' },
  { c:'<场景机制>战斗核心·回合制', content:'战斗采用回合制，每次行动消耗AP点，每人3AP。' },
  { c:'<核心玩法>战斗·词条机制', content:'每件武器自带词条。词条分攻击/防御/特殊三大类。' },
  { c:'<叙事背景>星陨大陆·历史', content:'三万年前，诸神陨落，星雨从天而降...。', vec:true },
  { c:'<基础公理>力量体系（蓝灯）', content:'修炼九层：炼气筑基...', const:true },
  { c:'<引导机制>新手引导·前10轮', content:'1.强化博弈感 2.物理边界监控' },
  { c:'<近场强约束>当前剧情·白娅绝食', content:'白娅自认为失去了<user>的关注，开始绝食。' },
  { c:'<互动选项>开局选项', content:'选项A.敲门喊她 选项B.用钥匙直接开' },
];
cases1.forEach(function(tc){
  var tmpl = S2.getEntryTemplate(tc.c);
  var keys = S2._deriveEntryKeys(tc.c, tmpl, tc.content);
  console.log('  ', tc.c, '→', JSON.stringify(keys));
  if (tc.const) check(keys.length === 0, tc.c + '(蓝灯)不派生 keys');
  else if (tc.vec) check(keys.length <= 2, tc.c + '(向量化) keys≤2，弱锚点实际=' + keys.length);
  else check(keys.length > 0, tc.c + ' 派生 keys 非空（len=' + keys.length + '）');
});

// 测试2：parseOpBlocks 解析块体元信息 & 正文纯净
console.log('\n=== 测试2：parseOpBlocks 解析元信息 & 正文纯净 ===');
var text1 = [
  '已生成白娅条目和天台场景。',
  '::: upsert <重要角色>白娅',
  'keys=白娅,诗织,唯子,转学,女仆',
  'secondary_keys=好感度,依存,家庭,称呼',
  'selectiveLogic=0',
  'cooldown=3',
  '',
  '身份：父母双亡的女高中生...',
  '外貌：娇小纤细...',
  ':::',
  '::: upsert <地点场景>天台观星台',
  'keys=天台,观星台,屋顶,星空',
  '',
  '屋顶有一台古旧的望远镜。',
  ':::',
  '::: upsert <基础公理>世界观（蓝灯不填keys）',
  '',
  '世界是星陨大陆，以修为论尊卑。',
  ':::',
  '::: delete <场景机制>旧战斗规则',
  ':::',
].join('\n');
var ops = parseOpBlocks(text1);
check(ops.length === 4, '解析出 4 个 op（实际=' + ops.length + '）');
check(ops[0].action === 'upsert' && ops[3].action === 'delete', 'op类型正确');
check(Array.isArray(ops[0].keys) && ops[0].keys.join(',') === '白娅,诗织,唯子,转学,女仆', 'ops[0].keys 解析正确: ' + JSON.stringify(ops[0].keys));
check(Array.isArray(ops[0].secondary_keys) && ops[0].secondary_keys.join(',') === '好感度,依存,家庭,称呼', 'ops[0].secondary_keys 解析正确');
check(ops[0].selectiveLogic === 0, 'ops[0].selectiveLogic=0');
check(ops[0].cooldown === 3, 'ops[0].cooldown=3');
ops.forEach(function(op, i){
  if (op.action === 'upsert' || op.action === 'update') {
    check(!/^keys\s*=|^secondary_keys\s*=|^selectiveLogic\s*=/m.test(op.content || ''), 'op['+i+'] content正文不含元信息行');
  }
});

// 测试3：applyOps 应用后 keys 非空 & 正文纯净
console.log('\n=== 测试3：applyOps 写入后 keys 非空 & 正文纯净 ===');
var cd1 = { name:'测试', character_book:{ entries:[] }, extensions:{ tavern_helper:{ scripts:[] }, regex_scripts:[] }};
var r1 = applyOps(ops, cd1);
check(cd1.character_book.entries.length === 3, '写入后3条entries（实际='+cd1.character_book.entries.length+'）');
cd1.character_book.entries.forEach(function(e, i){
  console.log('  entry'+i, e.comment, '→ keys=', JSON.stringify(e.keys), 'sec=', JSON.stringify(e.secondary_keys), 'SL=', e.extensions && e.extensions.selectiveLogic, 'cd=', e.extensions && e.extensions.cooldown);
  var tmpl = S2.getEntryTemplate(e.comment || '');
  var isConst = (e.constant === true) || (tmpl && tmpl.constant === true);
  if (!isConst) check(Array.isArray(e.keys) && e.keys.length > 0, 'entry['+i+'] '+e.comment+' 非蓝灯 keys 非空');
  check(!/^keys\s*=/m.test(e.content || ''), 'entry['+i+'] content正文无keys行');
});

// 测试4：AI 漏填 keys → applyOps 自动派生
console.log('\n=== 测试4：AI漏填keys自动派生 ===');
var text2 = [
  '::: upsert <重要角色>赵远学长',
  '',
  '身份：高三学生会主席。性格：冷静沉着，公正不阿。',
  ':::',
  '::: upsert <叙事背景>苍蓝学院·历史',
  '',
  '苍蓝学院创立于两百年前，由四大贵族联手出资...',
  ':::',
].join('\n');
var ops2 = parseOpBlocks(text2);
check(!ops2[0].keys, 'AI未填keys（赵远学长）');
var cd2 = { name:'测试2', character_book:{ entries:[] }, extensions:{}};
applyOps(ops2, cd2);
cd2.character_book.entries.forEach(function(e, i){
  console.log('  entry'+i, e.comment, '→ keys=', JSON.stringify(e.keys));
  var tmpl = S2.getEntryTemplate(e.comment || '');
  var isConst = (e.constant === true) || (tmpl && tmpl.constant === true);
  if (!isConst) check(Array.isArray(e.keys) && e.keys.length > 0, 'entry['+i+'] 漏填自动派生keys非空');
});

// 测试5：_sanitizeWorldbookEntriesForWrite 写酒馆前补 keys
console.log('\n=== 测试5：sanitize写入酒馆前补keys ===');
var dirtyList = [
  { comment:'<物品>破碎怀表', content:'一块怀表，指针不动。据说能看到过去。' },
  { comment:'<势力与组织>学生会·执行部', content:'执行部负责风纪，由赵远领导。' },
  '<叙事背景>星祭之夜的传说（字符串污染）',
  null, 123, true,
  { comment:'<基础公理>世界（蓝灯）', content:'世界分九层天。', constant: true },
];
var sanitized = S2._sanitizeWorldbookEntriesForWrite(dirtyList);
check(sanitized.length >= 4, 'sanitize后保留有效条目（实际=' + sanitized.length + '）');
sanitized.forEach(function(e, i){
  console.log('  se'+i, e.name, '→ strategy.keys=', JSON.stringify(e.strategy.keys), 'type=', e.strategy.type);
  if (e.strategy.type !== 'constant') {
    check(Array.isArray(e.strategy.keys) && e.strategy.keys.length > 0, 'se['+i+'] 非蓝灯 strategy.keys非空');
  }
  check(!/^keys\s*=/.test(e.content || ''), 'se['+i+'] content正文无keys行');
});

console.log('\n' + (allPass ? '🎉 全部验证通过!' : '⚠️ 有失败项，见上方 ❌ 标记'));
process.exit(allPass ? 0 : 1);
