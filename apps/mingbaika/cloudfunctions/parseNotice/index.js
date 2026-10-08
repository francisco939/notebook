'use strict';

/**
 * 云函数：parseNotice —— 解构引擎（产品模块 F2）
 *
 * 职责边界（刻意保持很窄）：
 *   取图 → 调模型 → 交给 core 管线做结构与校验 → 落库 → 返回
 *
 * 一切"判断"都下沉到 core/（纯函数、可离线回归）；
 * 本文件只处理"与环境打交道"的部分（云存储、数据库、网络）。
 *
 * 返回契约（前端据此渲染，不要改）：
 *   成功 { success: true, card: <ActionCard>, cached: boolean }
 *   失败 { success: false, error: string }
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const cfg = require('./config');
const { SYSTEM_PROMPT, buildUserPrompt } = require('./prompt');
const { createProvider } = require('./providers');
const { extractJson } = require('./core/json-extract');
const { buildActionCard, buildDegradedCard } = require('./core');

exports.main = async (event) => {
  const startedAt = Date.now();
  const event_ = event || {};
  const { fileID, rawText, requestId } = event_;

  // ── 0. 自检模式：不走解析链路，只诊断 AI 是否可达、模型名是否正确 ──────
  // 必须放在参数校验之前，否则会被"请提供图片或文字"拦掉。
  // 用途：不用真机、不用小程序前端，直接在云开发控制台调用本函数，
  //       就能定位"所有解析都降级"是不是模型配置导致的。
  if (event_.selfTest) return runSelfTest();

  let openid = null;
  try {
    openid = (cloud.getWXContext() || {}).OPENID || null;
  } catch (e) { /* 本地调试可能取不到 */ }

  if (!fileID && !rawText) {
    return { success: false, error: '请提供图片或文字' };
  }

  const db = cloud.database();
  const coll = db.collection(cfg.collection.notices);

  // ── 1. 幂等：用 requestId 构造确定性 _id，撞 _id 即返回旧结果 ──────────
  // 老人容易连点两次按钮，这样不会重复消耗模型额度。
  const docId = buildDocId(openid, requestId);
  if (docId) {
    try {
      const hit = await coll.doc(docId).get();
      if (hit && hit.data && hit.data.card) {
        return { success: true, card: hit.data.card, cached: true };
      }
    } catch (e) {
      // 文档不存在是正常路径，不视为错误
    }
  }

  // ── 2. 取图 → base64 ────────────────────────────────────────────────
  let imageBase64 = null;
  let mimeType = null;
  let imageBytes = 0;
  if (fileID) {
    try {
      const dl = await cloud.downloadFile({ fileID });
      const buf = dl.fileContent;
      imageBytes = buf ? buf.length : 0;
      if (!buf || !imageBytes) throw new Error('下载到的文件为空');
      if (imageBytes > cfg.maxImageBytes) {
        return { success: false, error: `图片过大（${Math.round(imageBytes / 1024)}KB），请压缩后再试` };
      }
      imageBase64 = buf.toString('base64');
      mimeType = guessMime(fileID, buf);
    } catch (e) {
      return { success: false, error: '读取图片失败：' + (e.message || e) };
    }
  }

  // ── 3. 调模型 ───────────────────────────────────────────────────────
  const userPrompt = buildUserPrompt({ rawText, hasImage: !!imageBase64 });
  let modelResult = { ok: false, error: '未调用' };
  try {
    const provider = createProvider(cfg);
    modelResult = await provider.parse({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      imageBase64,
      mimeType,
      timeoutMs: cfg.modelTimeoutMs,
    });
  } catch (e) {
    // createProvider 抛出的配置错误（例如 provider 名字写错）
    modelResult = { ok: false, error: e.message || String(e) };
  }

  // ── 4. 解构（结构与校验全部交给纯函数管线） ──────────────────────────
  let card;
  let debug = null;

  if (!modelResult.ok) {
    card = buildDegradedCard(rawText || null, 'modelFailed', { source: 'fallback', now: Date.now() });
    debug = { modelError: modelResult.error };
  } else {
    const parsed = extractJson(modelResult.text);
    if (!parsed) {
      // 模型没按 JSON 输出 —— 把它的原话留存，但不展示给用户
      card = buildDegradedCard(rawText || null, 'modelFailed', { source: 'fallback', now: Date.now() });
      debug = { modelError: '模型输出无法解析为 JSON', rawModelText: String(modelResult.text).slice(0, 500) };
    } else {
      const built = buildActionCard({
        modelOutput: parsed,
        // 原文优先取模型自报的 rawText（图片场景下只有模型知道图里写了什么）
        rawText: (typeof parsed.rawText === 'string' && parsed.rawText) || rawText || null,
        nowMs: Date.now(),
        source: 'model',
      });
      card = built.card;
      debug = built.debug;
    }
  }

  // ── 5. 落库（失败不影响返回） ────────────────────────────────────────
  let persisted = false;
  if (cfg.persist) {
    try {
      const doc = {
        _openid: openid,
        fileID: fileID || null,
        rawText: card.rawText || rawText || null,
        card,
        degraded: card.degraded === true,
        confidence: card.confidence,
        itemCount: card.items.length,
        riskCount: card.risks.length,
        provider: modelResult.ok ? modelResult.via : null,
        latencyMs: Date.now() - startedAt,
        createdAt: db.serverDate(),
      };
      if (docId) doc._id = docId;
      await coll.add({ data: doc });
      persisted = true;
    } catch (e) {
      // 撞 _id（并发重复请求）也是正常的，静默处理
      persisted = false;
    }
  }

  // ── 6. 返回（debug 仅调试期开启） ────────────────────────────────────
  const out = { success: true, card, cached: false, persisted };
  if (cfg.debug) {
    out.debug = Object.assign({}, debug, {
      imageBytes,
      provider: modelResult.ok ? modelResult.via : null,
      modelError: modelResult.ok ? null : modelResult.error,
      latencyMs: Date.now() - startedAt,
    });
  }
  return out;
};

/** openid + requestId → 确定性文档 _id。没有 requestId 时不启用幂等。 */
function buildDocId(openid, requestId) {
  if (!requestId || typeof requestId !== 'string') return null;
  const safe = requestId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!safe) return null;
  return `${(openid || 'anon').slice(0, 28)}_${safe}`;
}

/**
 * 自检：诊断 AI 通道是否可用、模型名是否正确。
 *
 * 为什么需要它：
 *   "解析全部降级成『这条我没看懂』" 的根因可能在模型配置（模型名不在
 *   该通道的可用列表里），而这种问题在小程序前端只能看到一个降级结果，
 *   看不出原因。本函数把每一步都摊开，让根因可见。
 *
 * 调用方式（云开发控制台 → 云函数 → parseNotice → 测试）：
 *   { "selfTest": true }
 *
 * 不写数据库、不消耗额度以外的资源，只读诊断。
 * 注意：会真实调用一次模型（约十几个 token），用于确认模型名有效。
 */
async function runSelfTest() {
  const out = {
    selfTest: true,
    at: new Date().toISOString(),
    config: {
      aiProvider: cfg.aiProvider,
      model: cfg.model,
      modelVision: cfg.modelVision || '(未设置，图片将退回用文字模型——会失败)',
      modelFamily: cfg.modelFamily || '(未设置 → 默认 cloudbase)',
      httpBaseUrl: cfg.aiProvider === 'http' ? cfg.http.baseUrl : '(不适用)',
      httpApiKeySet: cfg.aiProvider === 'http' ? !!cfg.http.apiKey : '(不适用)',
      debug: cfg.debug,
    },
    checks: {},
    errors: [],
  };

  // 1) 云环境可达性
  try {
    const ctx = cloud.getWXContext() || {};
    out.checks.wxContext = ctx.OPENID ? 'ok（已拿到 openid）' : 'ok（无 openid，控制台调用时正常）';
  } catch (e) {
    out.checks.wxContext = 'FAIL: ' + (e.message || String(e));
  }

  // 2) provider 能否构造
  let provider;
  try {
    provider = createProvider(cfg);
    out.checks.provider = 'ok（' + provider.name + '）';
  } catch (e) {
    out.checks.provider = 'FAIL: ' + (e.message || String(e));
    return out;
  }

  // 3) 真实调用一次最小请求 —— 这一步能直接验证模型名是否有效
  try {
    const res = await provider.parse({
      systemPrompt: '只回复两个字：正常。不要加任何其他内容。',
      userPrompt: '正常',
      imageBase64: null,
      mimeType: null,
      timeoutMs: 20000,
    });
    if (res && res.ok) {
      out.checks.modelCall = 'ok（' + (res.via || provider.name) + '）';
      out.sampleReply = String(res.text || '').slice(0, 120);
      if (res.usage) out.usage = res.usage;
    } else {
      out.checks.modelCall = 'FAIL';
      out.errors.push('模型调用失败：' + ((res && res.error) || '(无错误信息)'));
    }
  } catch (e) {
    out.checks.modelCall = 'FAIL（抛异常）';
    out.errors.push('模型调用异常：' + (e && e.message ? e.message : String(e)));
  }

  // 4) 结论提示
  if (out.checks.modelCall && out.checks.modelCall.indexOf('ok') === 0) {
    out.verdict = 'AI 通道可用，模型名有效且开关已打开。若解析仍失败，问题不在模型配置。';
  } else {
    out.verdict =
      'AI 通道不可用。按可能性排查：' +
      '① 控制台的模型「状态」开关没打开（云开发控制台 → AI → 生文模型 → 把 ' + cfg.model +
      ' 的开关打开）；' +
      '② 模型名「' + cfg.model + '」不在本通道可用列表（去控制台 → AI 对照实际名字）；' +
      '③ 以上都对则看 errors 里的具体报错。';
  }

  return out;
}

/** 按扩展名 + 魔数判断图片类型。云开发返回的 fileID 不一定带后缀。 */
function guessMime(fileID, buf) {
  const ext = String(fileID || '').split('.').pop().toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (buf && buf.length > 12) {
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
    if (buf[8] === 0x57 && buf[9] === 0x45) return 'image/webp';
    if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  }
  return 'image/jpeg';
}
