'use strict';

/**
 * 本地存储层 —— 本项目的数据权威在本地，云端只是备份镜像。
 *
 * 依据 [S11]：wx.setStorage 单 key 上限 1MB、总量 10MB、按用户隔离、不跨设备。
 * 纯文本记事按每条 200 字估算，10MB 可存 2 万条以上，容量不构成现实约束。
 *
 * 设计约定：
 *   1. 所有写失败（超容量等）**静默降级**，不向老人报错。本地写不进去也要能继续用。
 *   2. 删除一律是软删除（deleted=true），为"删错了能找回"提供基础 [S9][S10]。
 */

var KEY_NOTES = 'notes_v1';
var SETTINGS_PREFIX = 'set_';

/* ---------------- 底层读写 ---------------- */

function get(key, def) {
  try {
    var v = wx.getStorageSync(key);
    if (v === '' || v === undefined || v === null) return def;
    return v;
  } catch (e) {
    return def;
  }
}

function set(key, val) {
  try {
    wx.setStorageSync(key, val);
    return true;
  } catch (e) {
    return false; // 静默失败，不打扰用户
  }
}

function getSetting(name, def) { return get(SETTINGS_PREFIX + name, def); }
function setSetting(name, val) { return set(SETTINGS_PREFIX + name, val); }

/* ---------------- 工具 ---------------- */

function newId() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadRaw() {
  var arr = get(KEY_NOTES, []);
  return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
}

function saveRaw(arr) { return set(KEY_NOTES, arr); }

/* ---------------- 记事 CRUD ---------------- */

/** 返回全部未删除的记事。排序：有时间的在前按时间升序，没时间的在后按创建时间倒序。 */
function list() {
  var arr = loadRaw().filter(function (n) { return n && !n.deleted; });
  arr.sort(function (a, b) {
    var at = a.dueAt, bt = b.dueAt;
    if (at && bt) return at - bt;
    if (at && !bt) return -1;
    if (!at && bt) return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  return arr;
}

function getNote(id) {
  var arr = loadRaw();
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i].id === id) return arr[i];
  }
  return null;
}

/**
 * 新增。返回新建的 note（写入失败时仍返回对象，保证 UI 不卡住）。
 *
 * extra 里的字段全部可选，且**全部是新增字段**（title / status / statusAt / author）。
 * 老数据没有这些字段时按默认值处理，不得报错、不得清空 —— 体验版可能已有真实数据。
 */
function add(content, when, extra) {
  var now = Date.now();
  var note = {
    id: newId(),
    content: content || '',
    rawTime: (when && when.rawTime) || '',
    hasTime: !!(when && when.hasTime),
    dueAt: (when && when.dueAt) || null,
    createdAt: now,
    updatedAt: now,
    deleted: false,
    title: (extra && extra.title) || '',
    status: (extra && extra.status) || 'todo',
    statusAt: (extra && extra.statusAt) || null,
    author: (extra && extra.author) || ''
  };
  var arr = loadRaw();
  arr.unshift(note);
  saveRaw(arr);
  return note;
}

/** 切换完成状态。status 为 'todo' 时 statusAt 归零，便于"撤销完成"。 */
function setStatus(id, status) {
  if (['todo', 'done', 'skipped'].indexOf(status) < 0) return null;
  return update(id, {
    status: status,
    statusAt: status === 'todo' ? null : Date.now()
  });
}

/** 局部更新。返回更新后的 note，找不到返回 null。 */
function update(id, patch) {
  var arr = loadRaw();
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i].id === id) {
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) arr[i][k] = patch[k];
      }
      arr[i].updatedAt = Date.now();
      saveRaw(arr);
      return arr[i];
    }
  }
  return null;
}

/** 软删除。返回被删的 note（撤销时用得着），找不到返回 null。 */
function softDelete(id) {
  var n = getNote(id);
  if (!n) return null;
  update(id, { deleted: true, deletedAt: Date.now() });
  return n;
}

function restore(id) { return update(id, { deleted: false, deletedAt: 0 }); }

/** 清理 30 天前软删除的记录，避免软删除数据无限堆积。 */
function purgeDeleted() {
  var arr = loadRaw();
  var cut = Date.now() - 30 * 24 * 3600 * 1000;
  var kept = arr.filter(function (n) {
    return !(n && n.deleted && n.deletedAt && n.deletedAt < cut);
  });
  if (kept.length !== arr.length) saveRaw(kept);
  return arr.length - kept.length;
}

/* ---------------- 设置 ---------------- */

function getFontScale() { return getSetting('fontScale', ''); }
function setFontScale(s) { return setSetting('fontScale', s); }

/** 添加人名字。没有账号体系，就用本地一个名字代替 —— 零依赖方案。 */
function getAuthor() { return getSetting('author', ''); }
function setAuthor(name) { return setSetting('author', name || ''); }

/* ---------------- 示例数据 ---------------- */

/**
 * 首次使用时铺几条示例事件，让"日历 + 关卡 + 完成态"当场可见。
 * 只在**一条记录都没有**时执行一次，之后不再触发 —— 不污染真实数据。
 */
function seedIfEmpty() {
  if (loadRaw().length > 0) return 0;

  var DAY = 24 * 3600 * 1000;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var base = today.getTime();

  var samples = [
    { off: 0,  title: '量血压',     desc: '早上起床后量一次，记下数值', author: '我',     status: 'done' },
    { off: 0,  title: '吃降压药',   desc: '早饭后一片',                 author: '女儿',   status: 'todo' },
    { off: 0,  title: '下楼散步',   desc: '小区走两圈就回来',           author: '我',     status: 'todo' },
    { off: 1,  title: '去社区医院', desc: '带上医保卡和上次的结果',     author: '儿子',   status: 'todo' },
    { off: -1, title: '交水电费',   desc: '已经交了，不用再管',         author: '女儿',   status: 'done' },
    { off: -1, title: '老同学聚会', desc: '这次不去了，下次再约',       author: '我',     status: 'skipped' }
  ];

  var arr = [];
  samples.forEach(function (s, i) {
    var at = base + s.off * DAY + (10 + i) * 3600 * 1000;
    arr.push({
      id: newId(),
      content: s.desc,
      title: s.title,
      rawTime: '',
      hasTime: false,
      dueAt: at,
      createdAt: at,
      updatedAt: at,
      deleted: false,
      status: s.status,
      statusAt: s.status === 'todo' ? null : at,
      author: s.author
    });
  });

  saveRaw(arr);
  return arr.length;
}

module.exports = {
  get: getSetting,
  set: setSetting,
  list: list,
  getNote: getNote,
  add: add,
  update: update,
  setStatus: setStatus,
  softDelete: softDelete,
  restore: restore,
  purgeDeleted: purgeDeleted,
  getFontScale: getFontScale,
  setFontScale: setFontScale,
  getAuthor: getAuthor,
  setAuthor: setAuthor,
  seedIfEmpty: seedIfEmpty
};
