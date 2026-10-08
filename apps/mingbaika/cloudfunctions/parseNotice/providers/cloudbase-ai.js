'use strict';

/**
 * Provider：微信云开发托管的 AI 能力（cloud.extend.AI）。
 *
 * 为什么这是默认路线：
 *  - 不需要自备 API Key，密钥由云开发托管，不落到代码或环境变量里；
 *  - 与云开发一体，不需要域名白名单；
 *  - 直接吃云开发售卖的模型（含大赛发放额度的 deepseek-v4-flash）；
 *  - 原生支持图片输入，多模态不用额外搭 OCR。
 *
 * ⚠️ 待实测：云函数侧的 cloud.extend.AI 可用性与参数形态需要真机验证。
 * 已知在小程序前端是 `model.generateText({ data: {...} })`，
 * 而社区示例在云函数里写成 `model.generateText({...})`（无 data 包裹）。
 * 本实现先试带 data 的形态，失败再试裸参数，两种都失败才降级——
 * 这样无论哪种是对的都能跑通，代价是多一次请求尝试。
 */

const TIMEOUT_GUARD_MS = 2000; // 留出的收尾余量

function createCloudbaseProvider(cfg) {
  return {
    name: 'cloudbase',

    async parse({ systemPrompt, userPrompt, imageBase64, mimeType, timeoutMs }) {
      let cloud;
      try {
        cloud = require('wx-server-sdk');
      } catch (e) {
        return { ok: false, error: '未安装 wx-server-sdk：' + e.message };
      }

      if (!cloud.extend || !cloud.extend.AI || typeof cloud.extend.AI.createModel !== 'function') {
        return {
          ok: false,
          error: '当前云开发环境不支持 cloud.extend.AI（需检查云开发版本与基础库版本）',
        };
      }

      // 组装多模态 content：图片在前，文本在后
      const content = [];
      if (imageBase64) {
        content.push({ type: 'image', image_base64: imageBase64 });
      }
      content.push({ type: 'text', text: userPrompt });

      const userContent = imageBase64 ? content : userPrompt;
      const model = cloud.extend.AI.createModel(cfg.modelFamily || 'cloudbase');
      // 带图片时必须走多模态模型：纯文本模型（如 hy3）读不了图，会直接报错
      const modelName = imageBase64 ? (cfg.modelVision || cfg.model) : cfg.model;

      // 两种参数形态都试一遍
      const payload = {
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      };

      const attempts = [
        { label: 'data-wrapped', arg: { data: payload } },
        { label: 'bare', arg: payload },
      ];

      const errors = [];
      for (const a of attempts) {
        try {
          const res = await withTimeout(model.generateText(a.arg), timeoutMs);
          const text = pickText(res);
          if (text) {
            return {
              ok: true,
              text,
              usage: (res && res.usage) || null,
              via: `cloudbase:${modelName}:${a.label}${imageBase64 ? ':vision' : ''}`,
            };
          }
          errors.push(`${a.label}: 返回体里找不到文本`);
        } catch (e) {
          errors.push(`${a.label}: ${e && e.message ? e.message : String(e)}`);
        }
      }

      return { ok: false, error: 'cloud.extend.AI 调用失败 —— ' + errors.join(' | ') };
    },
  };
}

/** 从各家形态不一的返回体里取出文本内容。 */
function pickText(res) {
  if (!res) return null;
  if (typeof res === 'string') return res;
  if (res.choices && res.choices[0] && res.choices[0].message) {
    const c = res.choices[0].message.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c.map((x) => (typeof x === 'string' ? x : x && x.text) || '').join('');
    }
  }
  if (typeof res.text === 'string') return res.text;
  if (typeof res.content === 'string') return res.content;
  return null;
}

function withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`调用超时（${ms}ms）`)), Math.max(1000, ms - TIMEOUT_GUARD_MS))),
  ]);
}

module.exports = createCloudbaseProvider;
