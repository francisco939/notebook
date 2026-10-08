'use strict';

/**
 * 记得 · 全局入口
 *
 * 只做两件事：
 *   1. 推断并持有全局字号档位（页面通过 app.globalData.scale 读取）
 *   2. 提供 setScale 供设置页切换
 */

var store = require('./utils/store.js');

App({
  globalData: {
    scale: 'large',       // small | large | xlarge
    scaleConfirmed: false // 用户是否亲手选过字号（未选过则首页显示调字号提示条）
  },

  onLaunch: function () {
    var saved = store.getFontScale();
    var confirmed = !!store.get('scaleConfirmed', false);

    if (!saved) {
      // 首次启动：按微信字体设置推断档位。
      // 依据 [S1]：iOS 关怀模式字号 23.8px，Android 关怀模式倍率 ×1.4 → 22px。
      // 取 22px 作为"已是关怀模式"的判定线。
      var fs = 17;
      try {
        var info = (typeof wx.getAppBaseInfo === 'function')
          ? wx.getAppBaseInfo()
          : wx.getSystemInfoSync();
        fs = info.fontSizeSetting || 17;
      } catch (e) {
        fs = 17; // 拿不到就用标准值，不阻塞启动
      }
      saved = fs >= 22 ? 'xlarge' : 'large';
      store.setFontScale(saved);
    }

    this.globalData.scale = saved;
    this.globalData.scaleConfirmed = confirmed;
  },

  setScale: function (scale) {
    if (['small', 'large', 'xlarge'].indexOf(scale) < 0) return;
    this.globalData.scale = scale;
    this.globalData.scaleConfirmed = true;
    store.setFontScale(scale);
    store.set('scaleConfirmed', true);
  }
});
