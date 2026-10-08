'use strict';

// TODO: 把 YOUR_ENV_ID 替换成你自己的微信云开发环境 ID（在云开发控制台查看）。
//       不填会导致 wx.cloud.callFunction 调用失败。
var ENV_ID = 'cloudbase-d5g5ujb8104db7396';

App({
  globalData: {
    envId: ENV_ID,
    // TODO: 配置「一键拨号」的默认号码（通常是子女或老师的电话）。
    //       留空时点击拨号会提示去设置。建议子女首次帮老人配置。
    contactPhone: '',
    // 转发进入时暂存的参数，两种形态：
    //   聊天素材（scene 1173）：{ materialPath, materialType, materialName }
    //   普通 query 参数      ：{ rawText, fileID, extraData }
    pendingForward: null,
    // index 页解析完成后，临时存放卡片，供 result 页立即读取（避免 URL 超长）
    tempCard: null,
  },

  onLaunch: function () {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请升级微信客户端');
      return;
    }
    wx.cloud.init({
      env: ENV_ID,
      traceUser: true,
    });
  },

  /**
   * 从聊天转发消息进入小程序时触发。有两条独立的路径，字段位置不同：
   *
   * 【路径 A】聊天素材打开小程序（scene = 1173）
   *   微信在启动参数里给出 `forwardMaterials` 数组，它与 `query` **同级**，
   *   不是嵌在 query 里（这点最容易写错）。每项形如 { type, name, path, size }，
   *   path 可能是 http(s) URL，也可能是本地临时路径。
   *   依据：微信开放文档《聊天素材支持小程序打开》
   *   https://developers.weixin.qq.com/miniprogram/dev/framework/material/support_material
   *
   * 【路径 B】普通小程序卡片 / 扫码等，参数在 `query` 里。
   */
  onShow: function (options) {
    var opts = options || {};

    // —— 路径 A：聊天素材（scene 1173）——
    var mats = opts.forwardMaterials;
    if (!mats && typeof wx.getEnterOptionsSync === 'function') {
      // 冷启动后再次触发、或 onShow 未带参数时，向微信要一份「进入参数」快照
      try {
        var enter = wx.getEnterOptionsSync() || {};
        if (enter.forwardMaterials) {
          mats = enter.forwardMaterials;
          if (!opts.query && enter.query) opts = enter;
        }
      } catch (e) {
        // 低版本基础库没有该 API，忽略即可（不是错误路径）
      }
    }
    if (mats && mats.length) {
      var m = mats[0] || {};
      this.globalData.pendingForward = {
        materialPath: m.path || '',
        materialType: m.type || '',
        materialName: m.name || '',
      };
      return;
    }

    // —— 路径 B：query 参数 ——
    var q = opts.query || {};
    var extra = opts.referrerInfo && opts.referrerInfo.extraData;
    if (q.rawText || q.fileID || extra) {
      this.globalData.pendingForward = {
        rawText: q.rawText || '',
        fileID: q.fileID || '',
        extraData: extra || null,
      };
    }
  },
});
