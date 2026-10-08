'use strict';

/**
 * Provider：在云函数里直连模型厂商的 HTTP API（OpenAI 兼容协议）。
 *
 * 什么时候用这条路线：
 *  - 想用云开发没上架的模型（例如某个视觉模型）；
 *  - 想完全掌控模型版本与参数；
 *  - 手里有大赛发放的 API 额度，想直接消耗它。
 *
 * 代价：API Key 要自己管（放云函数环境变量，不要写进代码）、要自己处理厂商差异。
 *
 * ⚠️ 重要提醒：DeepSeek 官方 API 目前的主力是文本模型。
 * 如果走这条路线又需要解析图片，必须二选一：
 *   (a) 换一个支持视觉的 OpenAI 兼容模型（如 GLM-4V / 通义千问 VL / Kimi 视觉版），
 *       把 AI_MODEL 和 AI_HTTP_BASE_URL 指过去即可，本文件不用改；
 *   (b) 先对图片做 OCR 得到文字，再把文字喂给纯文本模型。
 * 这也是为什么云开发托管路线被设为默认——它在图片这件事上开箱即用。
 */

const https = require('https');
const { URL } = require('url');

function createHttpProvider(cfg) {
  const h = cfg.http || {};

  return {
    name: 'http',

    async parse({ systemPrompt, userPrompt, imageBase64, mimeType, timeoutMs }) {
      if (!h.baseUrl) return { ok: false, error: '未配置 AI_HTTP_BASE_URL' };
      if (!h.apiKey) return { ok: false, error: '未配置 AI_HTTP_API_KEY' };

      let userContent;
      if (imageBase64) {
        // OpenAI 兼容的多模态格式
        userContent = [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` },
          },
        ];
      } else {
        userContent = userPrompt;
      }

      const baseBody = {
        model: cfg.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      };

      const url = joinUrl(h.baseUrl, '/chat/completions');
      const headers = { Authorization: `Bearer ${h.apiKey}` };

      // 先带 response_format 试（能强制 JSON 输出，效果最好）
      const attempts = [];
      if (h.jsonMode) {
        attempts.push({ label: 'json-mode', body: Object.assign({}, baseBody, { response_format: { type: 'json_object' } }) });
      }
      attempts.push({ label: 'plain', body: baseBody });

      const errors = [];
      for (const a of attempts) {
        let res;
        try {
          res = await postJson(url, a.body, headers, timeoutMs);
        } catch (e) {
          errors.push(`${a.label}: ${e && e.message ? e.message : String(e)}`);
          continue;
        }

        if (res.status >= 200 && res.status < 300) {
          let json;
          try {
            json = JSON.parse(res.body);
          } catch (e) {
            errors.push(`${a.label}: 响应不是合法 JSON`);
            continue;
          }
          const text = pickText(json);
          if (text) {
            return { ok: true, text, usage: json.usage || null, via: `http:${cfg.model}:${a.label}` };
          }
          errors.push(`${a.label}: 响应里找不到文本`);
          continue;
        }

        // 有些厂商不支持 response_format，换个姿势再试
        errors.push(`${a.label}: HTTP ${res.status} ${truncate(res.body, 200)}`);
      }

      return { ok: false, error: 'HTTP 调用失败 —— ' + errors.join(' | ') };
    },
  };
}

function pickText(json) {
  if (!json) return null;
  if (json.choices && json.choices[0]) {
    const c = json.choices[0].message ? json.choices[0].message.content : json.choices[0].text;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x && x.text) || '').join('');
  }
  return null;
}

function joinUrl(base, path) {
  const b = base.replace(/\/+$/, '');
  return b.endsWith('/v1') || /\/v\d+$/.test(b) ? b + path : b + '/v1' + path;
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 用 Node 内置 https 发 POST，避免给云函数引入第三方依赖。 */
function postJson(urlStr, body, extraHeaders, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      return reject(new Error('URL 非法：' + urlStr));
    }
    const data = JSON.stringify(body);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: Object.assign(
          {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
          extraHeaders || {}
        ),
        timeout: timeoutMs || 45000,
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('timeout', () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = createHttpProvider;
