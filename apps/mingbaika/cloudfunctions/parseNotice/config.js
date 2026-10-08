'use strict';

/**
 * 解构引擎的运行配置。
 *
 * 所有可变项都可通过云函数环境变量覆盖，便于在控制台切换而不改代码。
 * 特别注意 AI_PROVIDER：这是"选哪条 AI 接入路线"的总开关，
 * 两条路线（云开发托管 / 自建 HTTP 直连）的实现见 providers/ 目录。
 */

const CONFIG = {
  // ── AI 接入路线 ──────────────────────────────────────────────────────
  // cloudbase: 用微信云开发托管的 AI 能力（cloud.extend.AI），Key 由平台托管
  // http:      在云函数里直连模型厂商的 HTTP API（需自备 API Key）
  aiProvider: process.env.AI_PROVIDER || 'cloudbase',

  // 模型标识。云开发托管时取 cloudbase 售卖的模型名；http 模式取厂商模型名。
  // deepseek-v4-flash 是大赛发放额度的那个模型。
  model: process.env.AI_MODEL || 'deepseek-v4-flash',

  // http 模式必填：OpenAI 兼容的 chat/completions 地址与密钥。
  // 也可以指向任何兼容 OpenAI 协议的厂商（智谱 / 月之暗面 / 通义 等）。
  http: {
    baseUrl: process.env.AI_HTTP_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.AI_HTTP_API_KEY || '',
    // 是否让厂商强制返回 JSON（OpenAI 兼容的 response_format）
    jsonMode: process.env.AI_HTTP_JSON_MODE !== 'false',
  },

  // ── 运行参数 ────────────────────────────────────────────────────────
  /** 模型调用超时（毫秒）。云函数整体超时要大于这个值。 */
  modelTimeoutMs: parseInt(process.env.MODEL_TIMEOUT_MS || '45000', 10),

  /** 单张图片最大字节数。超过则拒绝，避免把云函数拖死。 */
  maxImageBytes: parseInt(process.env.MAX_IMAGE_BYTES || String(5 * 1024 * 1024), 10),

  /** 是否把解析结果落库（history 依赖它）。 */
  persist: process.env.PERSIST !== 'false',

  /** 集合名。 */
  collection: {
    notices: 'notices',
  },

  /** 是否在返回值里带 debug 信息（上线前应关掉，避免泄露 prompt 与原始模型输出）。 */
  debug: process.env.DEBUG_RESULT === 'true',
};

module.exports = CONFIG;
