'use strict';

/**
 * 风险提示条组件：用于顶部「拦截式」展示 danger 级风险。
 * 父页面只把 level === 'danger' 的风险传进来。
 */
Component({
  properties: {
    risks: {
      type: Array,
      value: [],
    },
  },
  data: {},
});
