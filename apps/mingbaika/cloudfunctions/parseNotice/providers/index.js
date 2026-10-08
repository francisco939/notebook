'use strict';

/**
 * AI Provider 工厂。
 *
 * 为什么要抽象：赛事现场/答辩时可能需要在"云开发托管"和"自建 HTTP 直连"之间切换，
 * 也可能需要临时换模型。业务代码（index.js）不应该关心这些差异，
 * 只依赖下面这个统一接口：
 *
 *   provider.parse({ systemPrompt, userPrompt, imageBase64, mimeType, timeoutMs })
 *     → { ok: true, text: string, usage: object|null, via: string }
 *     → { ok: false, error: string }
 *
 * 注意：接口约定"不抛异常"，失败以 ok:false 返回。
 * 这样调用方可以无脑进入降级路径，不会因为一个厂商报错而整个云函数 500。
 */

function createProvider(cfg) {
  const name = (cfg && cfg.aiProvider) || 'cloudbase';
  switch (name) {
    case 'cloudbase':
      return require('./cloudbase-ai')(cfg);
    case 'http':
      return require('./http-deepseek')(cfg);
    default:
      throw new Error(`未配置的 AI_PROVIDER："${name}"（可选 cloudbase | http）`);
  }
}

module.exports = { createProvider };
