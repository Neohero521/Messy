/**
 * 修复工具：给两个 JSON 中的 mvu-status-bar regex 替换掉坏掉的 replaceString
 */
const fs = require('fs');
const path = require('path');

const FIXED_HTML = fs.readFileSync(path.join(__dirname, '_statusbar_fix.html'), 'utf8').trim();

const FILES = [
  '/workspace/写卡工具/初诞之界 (Alpha Test).json',
  '/workspace/写卡工具/chatlog_2026-07-31-12-14-35.json'
];

function escapeJsonStr(s) {
  // JSON.stringify 天然给你把 " \n \t \r 都转义好了，外层去掉首尾双引号
  return JSON.stringify(s).slice(1, -1);
}

function fixFile(file) {
  console.log('\n========== 处理:', path.basename(file), '==========');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.log('  跳过读取失败:', e.message);
    return;
  }

  // 两种情况：1）文件本身是合法 JSON；2）不是合法 JSON（用户给的 chatlog 可能是聊天记录片段/空）
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    console.log('  不是完整合法JSON，尝试正则提取 regex_scripts 片段（如果包含的话）');
    // 只改真正存在 mvu-status-bar 且是合法JSON的文件
    if (!/"id"\s*:\s*"mvu-status-bar"/.test(raw)) {
      console.log('  不包含 mvu-status-bar 脚本，跳过');
      return;
    }
    // chatlog：看是不是数组里消息包含有 JSON 块。为稳妥起见仅用正则找到对应 regex 的
    // replaceString 做替换。我们不硬 parse，只在能 JSON.parse 的文件上改。
    console.log('  chatlog 文件不能整文件 JSON.parse，跳过（用户实际使用的是初诞之界.json）');
    return;
  }

  const fixed = escapeJsonStr(FIXED_HTML);
  let touched = 0;

  // 递归遍历找 regex_scripts 数组
  function walk(n, trail) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      // 看这个数组名是否叫 regex_scripts（通过父节点和属性判断）
      n.forEach((item, idx) => {
        if (item && typeof item === 'object' && item.id === 'mvu-status-bar') {
          const beforeLen = (item.replaceString || '').length;
          item.replaceString = FIXED_HTML;
          console.log(`  ✓ 修复了 mvu-status-bar 脚本，replaceString 长度: ${beforeLen} -> ${FIXED_HTML.length}`);
          touched++;
          // 同时把匹配标记改成更可靠的 带斜杠注释的
          if (typeof item.markString === 'string' && !item.markString.includes('StatusPlaceHolderImpl')) {
            // 保留用户原 mark，让正则同时匹配 <StatusPlaceHolderImpl/> 和原标记
          }
        }
        walk(item, trail.concat(`[${idx}]`));
      });
    } else {
      // object
      for (const k of Object.keys(n)) {
        if (k === 'regex_scripts' && Array.isArray(n[k])) {
          // 走上面的数组逻辑
          walk(n[k], trail.concat(k));
        } else {
          walk(n[k], trail.concat(k));
        }
      }
    }
  }

  walk(obj, []);

  if (touched > 0) {
    const out = JSON.stringify(obj, null, 2);
    fs.writeFileSync(file, out, 'utf8');
    console.log(`  ✔ 已写回文件，共修复 ${touched} 处`);
  } else {
    console.log('  未找到 mvu-status-bar 项');
  }
}

FILES.forEach(fixFile);
console.log('\n完成。');
