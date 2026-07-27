// 测试 mergePartial 修复后的逻辑
var ENTRY_TEMPLATES = {
  '<基础公理>': { constant: true, position: 0, order: 250, selective: true, use_regex: false, secondary_keys: [], probability: 100, selectiveLogic: 0, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: false, sticky: 0, cooldown: 0, delay: 0, match_whole_words: false, scan_depth: 0, group: '', group_weight: 100, useProbability: true, depth: 4, enabled: true }
};

function getEntryTemplate(comment) {
  var m = comment.match(/^<([^>]+)>/);
  if (m) {
    var key = '<' + m[1] + '>';
    return ENTRY_TEMPLATES[key];
  }
  return null;
}

function normalizeVarListContent(c) { return c; }

function mergePartial(partial, cd) {
  if (!partial || typeof partial !== 'object') return false;
  var modified = false;
  if (partial.character && !partial.spec) {
    var ch = partial.character;
    delete partial.character;
    for (var k in ch) { if (ch.hasOwnProperty(k)) partial[k] = ch[k]; }
  }
  if (partial.deleted_entries && Array.isArray(partial.deleted_entries)) {
    partial._delete = (partial._delete || []).concat(partial.deleted_entries.map(function(c) { return 'character_book.entries.' + c; }));
    delete partial.deleted_entries;
  }
  if (partial._delete && Array.isArray(partial._delete)) {
    var entryPrefix = 'character_book.entries.';
    var fieldDeletes = [];
    partial._delete.forEach(function(path) {
      if (path.indexOf(entryPrefix) === 0) {
        var entryKey = path.slice(entryPrefix.length);
        if (cd.character_book && cd.character_book.entries) {
          var idx = parseInt(entryKey);
          if (!isNaN(idx) && String(idx) === entryKey) {
            cd.character_book.entries.splice(idx, 1);
          } else {
            cd.character_book.entries = cd.character_book.entries.filter(function(e) { return e.comment !== entryKey; });
          }
          modified = true;
        }
      } else {
        fieldDeletes.push(path);
      }
    });
    fieldDeletes.forEach(function(p) {
      var parts = p.split('.');
      var node = cd;
      for (var i = 0; i < parts.length - 1; i++) {
        if (!node || typeof node !== 'object' || !(parts[i] in node)) { node = null; break; }
        node = node[parts[i]];
      }
      if (node && typeof node === 'object' && parts[parts.length - 1] in node) {
        delete node[parts[parts.length - 1]];
        modified = true;
      }
    });
    delete partial._delete;
  }
  delete partial._nochange;

  if (partial.character_book) {
    delete partial.character_book.name;
    if (Object.keys(partial.character_book).length === 0) delete partial.character_book;
  }

  if (partial.entries && Array.isArray(partial.entries)) {
    cd.character_book = cd.character_book || { entries: [] };
    var existing = cd.character_book.entries || [];
    partial.entries.forEach(function(ne) {
      if (!ne.comment || !ne.comment.trim()) return;
      if (!ne.content || ne.content.trim().length < 20) return;
      var tmpl = getEntryTemplate(ne.comment);
      ne.enabled = (tmpl && tmpl.enabled !== undefined) ? tmpl.enabled : true;
      if (ne.comment && ne.comment.indexOf('变量列表') >= 0 && typeof ne.content === 'string') {
        ne.content = normalizeVarListContent(ne.content);
      }
      var idx = existing.findIndex(function(e) { return e.comment === ne.comment; });
      if (idx >= 0) {
        existing[idx] = Object.assign({}, existing[idx], ne);
        modified = true;
      } else { existing.push(ne); modified = true; }
    });
    cd.character_book.entries = existing;
    delete partial.entries;
  }

  if (partial.depth_prompt !== undefined) {
    cd.extensions = cd.extensions || {};
    cd.extensions.depth_prompt = cd.extensions.depth_prompt || { prompt: '', depth: 0, role: 'system' };
    var dp = partial.depth_prompt;
    var dpModified = false;
    if (typeof dp === 'string') {
      if (dp.trim().length > 0 && cd.extensions.depth_prompt.prompt !== dp) {
        cd.extensions.depth_prompt.prompt = dp;
        dpModified = true;
      }
    } else if (dp && typeof dp === 'object') {
      if (dp.prompt !== undefined && typeof dp.prompt === 'string' && dp.prompt.trim().length > 0 && cd.extensions.depth_prompt.prompt !== dp.prompt) {
        cd.extensions.depth_prompt.prompt = dp.prompt;
        dpModified = true;
      }
      if (dp.depth !== undefined && typeof dp.depth === 'number' && dp.depth >= 0 && cd.extensions.depth_prompt.depth !== dp.depth) {
        cd.extensions.depth_prompt.depth = dp.depth;
        dpModified = true;
      }
    }
    if (dpModified) modified = true;
    delete partial.depth_prompt;
  }

  // extensions 分支（关键修复点）
  if (partial.extensions) {
    cd.extensions = cd.extensions || {};
    for (var ek in partial.extensions) {
      if (partial.extensions.hasOwnProperty(ek)) {
        if (ek === 'depth_prompt') {
          cd.extensions.depth_prompt = cd.extensions.depth_prompt || { prompt: '', depth: 0, role: 'system' };
          var dp2 = partial.extensions.depth_prompt;
          var beforeDp = JSON.stringify(cd.extensions.depth_prompt);
          if (typeof dp2 === 'string') cd.extensions.depth_prompt.prompt = dp2;
          else if (dp2 && typeof dp2 === 'object') {
            if (dp2.prompt !== undefined) cd.extensions.depth_prompt.prompt = dp2.prompt;
            if (dp2.depth !== undefined && typeof dp2.depth === 'number' && dp2.depth >= 0) cd.extensions.depth_prompt.depth = dp2.depth;
          }
          if (JSON.stringify(cd.extensions.depth_prompt) !== beforeDp) modified = true;
        } else {
          if (JSON.stringify(cd.extensions[ek]) !== JSON.stringify(partial.extensions[ek])) {
            cd.extensions[ek] = partial.extensions[ek];
            modified = true;
          }
        }
      }
    }
  }

  return modified;
}

// ===== 测试用例 =====
console.log('=== 测试1: 浅合并保留 keys ===');
var cd1 = { character_book: { entries: [{ comment: '<基础公理>世界', keys: ['世界', '公理'], content: '旧内容旧内容旧内容', id: 1 }] } };
var r1 = mergePartial({ entries: [{ comment: '<基础公理>世界', content: '这是一段足够长的新内容用于测试浅合并逻辑是否保留keys字段' }] }, cd1);
console.log('modified:', r1, 'keys保留:', cd1.character_book.entries[0].keys, 'content更新:', cd1.character_book.entries[0].content, 'id保留:', cd1.character_book.entries[0].id);

console.log('\n=== 测试2: 含点comment的删除 ===');
var cd2 = { character_book: { entries: [{ comment: '<基础公理>.力量体系', content: '内容' }, { comment: '其他', content: '内容2' }] } };
var r2 = mergePartial({ _delete: ['character_book.entries.<基础公理>.力量体系'] }, cd2);
console.log('modified:', r2, '剩余条目:', cd2.character_book.entries.map(function(e){return e.comment;}));

console.log('\n=== 测试3: 嵌套路径删除不误删父对象 ===');
var cd3 = { extensions: { depth_prompt: { prompt: 'test', depth: 4 }, other: '保留' }, tags: ['a','b'] };
var before3 = JSON.parse(JSON.stringify(cd3));
var r3 = mergePartial({ _delete: ['extensions.depth_prompt.prompt'] }, cd3);
console.log('modified:', r3, 'extensions仍在:', !!cd3.extensions, 'other保留:', cd3.extensions.other, 'prompt已删:', cd3.extensions.depth_prompt.prompt === undefined);

console.log('\n=== 测试4: depth=0 可写入 ===');
var cd4 = { extensions: { depth_prompt: { prompt: 'old', depth: 4, role: 'system' } } };
var r4 = mergePartial({ depth_prompt: { prompt: 'new prompt', depth: 0 } }, cd4);
console.log('modified:', r4, 'depth:', cd4.extensions.depth_prompt.depth, 'prompt:', cd4.extensions.depth_prompt.prompt);

console.log('\n=== 测试5: extensions分支设置modified ===');
var cd5 = { extensions: { depth_prompt: { prompt: '', depth: 0, role: 'system' } } };
var r5 = mergePartial({ extensions: { depth_prompt: { prompt: '新手引导内容', depth: 0 } } }, cd5);
console.log('modified:', r5, 'prompt:', cd5.extensions.depth_prompt.prompt);
