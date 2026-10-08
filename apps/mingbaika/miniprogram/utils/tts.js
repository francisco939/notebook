'use strict';

/**
 * 语音播报工具。
 *
 * ⚠️ TODO（人工配置，不配也不会崩）：
 *   微信没有内置免费 TTS。本项目优先使用「微信同声传译」插件（WechatSI）。
 *   需要两步才能启用：
 *   1) 在小程序管理后台 → 设置 → 第三方设置 → 插件，添加「微信同声传译」插件
 *      （插件 appid：wx069ba97219f66d99）。
 *   2) 在 app.json 的 "plugins" 字段声明（当前未声明，避免未添加插件时开发者工具报错）：
 *        "plugins": {
 *          "WechatSI": { "version": "0.3.5", "provider": "wx069ba97219f66d99" }
 *        }
 *   插件不可用时，降级为 Toast 提示「语音功能待配置」，绝不抛错。
 */

var format = require('./format.js');

var _plugin = null;     // 缓存的插件对象
var _pluginTried = false;

/**
 * 安全地拿到同声传译插件。拿不到返回 null，不抛异常。
 */
function getWechatSI() {
  if (_pluginTried) return _plugin;
  _pluginTried = true;
  try {
    // requirePlugin 是全局函数；插件未声明时调用会抛异常，必须 try-catch
    _plugin = requirePlugin('WechatSI');
  } catch (e) {
    _plugin = null;
  }
  return _plugin;
}

/**
 * 把一张行动卡拼成「一句句人话」，供语音播报逐句朗读。
 * 纯函数：输入卡，输出句子数组。降级卡直接读原文。
 *
 * @param {object} card
 * @returns {string[]} 每句不超过一句话，便于逐条朗读
 */
function cardToSpeechText(card) {
  if (!card || typeof card !== 'object') return [];
  var lines = [];

  if (card.degraded) {
    lines.push('这条我没看懂，请对着原文核对，或者打电话问问孩子。');
    if (card.rawText) {
      // 原文较长时按句号/换行切成短句，避免一次性朗读过长
      var segs = card.rawText.split(/[。\n！？]/).filter(function (s) { return s.trim(); });
      segs.forEach(function (s) { lines.push(s.trim()); });
    }
    return lines;
  }

  lines.push((card.title || '这条通知') + '。');

  if (card.summary) lines.push(card.summary + '。');

  if (Array.isArray(card.items)) {
    card.items.forEach(function (it, i) {
      var s = '第' + ['一', '二', '三', '四', '五'][i] + '件，' + (it.what || '');
      if (it.deadline) {
        var dl = format.formatDeadlineCN(it.deadline);
        if (dl) s += '，' + dl;
      }
      if (it.amount && typeof it.amount.value === 'number') {
        s += '，' + format.formatAmountCN(it.amount);
      }
      if (it.location) s += '，地点 ' + it.location;
      if (Array.isArray(it.carry) && it.carry.length) {
        s += '，需要带 ' + it.carry.join('、');
      }
      lines.push(s + '。');
    });
  }

  if (Array.isArray(card.risks) && card.risks.length) {
    var danger = card.risks.filter(function (r) { return r.level === 'danger'; });
    if (danger.length) {
      lines.push('注意，这条要先确认。' + danger.map(function (r) { return r.title; }).join('，') + '。');
    }
  }

  return lines;
}

/**
 * 朗读整张卡。插件可用时逐句播报；不可用降级为 Toast。
 * @param {object} card
 */
function speak(card) {
  var plugin = getWechatSI();
  if (!plugin || typeof plugin.textToSpeech !== 'function') {
    wx.showToast({ title: '语音功能待配置', icon: 'none' });
    return;
  }
  var lines = cardToSpeechText(card);
  if (!lines.length) {
    wx.showToast({ title: '没有可朗读的内容', icon: 'none' });
    return;
  }
  // 逐句朗读：上句结束再读下一句
  var idx = 0;
  function next() {
    if (idx >= lines.length) return;
    var text = lines[idx++];
    plugin.textToSpeech({
      lang: 'zh_CN',
      tts: true,
      content: text,
      success: function (res) {
        if (res && res.filename) {
          var audio = wx.createInnerAudioContext();
          audio.src = res.filename;
          audio.onEnded(function () { next(); });
          audio.play();
        } else {
          next();
        }
      },
      fail: function () { next(); },
    });
  }
  next();
}

/**
 * 停止朗读（保留接口，当前逐句播报靠 onEnded 串联）。
 */
function stop() {
  // 微信同声传译插件无统一停止接口；这里仅做占位，避免外部调用报错。
}

module.exports = {
  cardToSpeechText: cardToSpeechText,
  speak: speak,
  stop: stop,
};
