'use strict';

/**
 * 从模型返回的自由文本里抽出 JSON 对象。
 *
 * 为什么需要：即使 prompt 明确要求"只输出 JSON、不要 markdown"，模型仍会时不时
 * 加上代码块围栏或前后解释。这是工程现实，不能靠"再强调一遍 prompt"解决。
 *
 * 纯函数，可离线单测。
 */

/** 尝试修复常见的模型 JSON 毛病：尾随逗号、中文引号、单引号。 */
function repair(s) {
  return s
    .replace(/,\s*([}\]])/g, '$1')          // 尾随逗号
    .replace(/[\u201c\u201d]/g, '"')         // 中文双引号 → 英文
    .replace(/([{,]\s*)'([^']*)'(\s*:)/g, '$1"$2"$3') // 单引号 key
    .replace(/:\s*'([^']*)'/g, ': "$1"');    // 单引号 value
}

/**
 * @param {string} text 模型返回的原始文本
 * @returns {object|null} 解析出的对象；失败返回 null（调用方应走降级）
 */
function extractJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  if (!s) return null;

  // 1) 剥掉 markdown 代码块围栏
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(s);
  if (fence && fence[1]) s = fence[1].trim();

  // 2) 直接解析
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object') return o;
  } catch (e) { /* 继续尝试 */ }

  // 3) 截取首个 { 到最后一个 }，再试
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = s.slice(start, end + 1);
    try {
      const o = JSON.parse(candidate);
      if (o && typeof o === 'object') return o;
    } catch (e) { /* 继续尝试 */ }
    try {
      const o = JSON.parse(repair(candidate));
      if (o && typeof o === 'object') return o;
    } catch (e) { /* 放弃 */ }
  }

  return null;
}

module.exports = { extractJson, repair };
