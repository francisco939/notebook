'use strict';

/**
 * 纯函数内核统一出口。
 * 设计铁律：core/ 目录下的所有模块都不得 require('wx-server-sdk') 或引用任何
 * 运行环境专属 API。这样内核既能在云函数里跑，也能在 Node 里直接回归测试，
 * 未来若要迁移到别的载体（小游戏 / 独立后端）也只需替换外壳。
 */

module.exports = Object.assign(
  {},
  require('./schema'),
  require('./time-parser'),
  require('./risk-rules'),
  require('./fallback'),
  require('./pipeline'),
  require('./json-extract')
);
