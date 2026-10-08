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

  // 文字模型。2026-10-08 依据云开发控制台实际列表修正：
  // 原配置 deepseek-v4-flash 不在 cloudbase 托管通道的可用列表里（那是
  // HTTP 直连通道的模型），导致所有解析必然失败降级。
  // hy3 标注"小程序成长计划"，走成长计划赠送的 Token 额度。
  // 可用环境变量 AI_MODEL 覆盖，不必改代码。
  model: process.env.AI_MODEL || 'hy3',

  // 图片模型（多模态）。带图片的解析走它——hy3 是纯文本模型，读不了图。
  // 控制台列表里标注"图文生"的才支持图片输入，选了 hy-vision-2.0-instruct。
  // ⚠️ 该模型是否吃成长计划免费额度未经确认，可能按资源点计费——额度见控制台「费用管理」。
  modelVision: process.env.AI_MODEL_VISION || 'hy-vision-2.0-instruct',

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
