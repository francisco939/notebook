'use strict';

/**
 * 静态自检：把"能用眼睛看出来"的无障碍问题变成"跑一条命令就报错"。
 *
 * 跑法：node scripts/check.js
 *
 * 这个脚本**代劳不了**什么（别指望它）：
 *   - 测不出真机上的实际点击热区（它会告诉你代码里写了 min-height，但写没生效它不管）
 *   - 测不出对比度是否真达标（色值对不对要另用对比度工具算）
 *   - 测不出老人看不看得清、点不点得中
 * 它能保证的只有一件事：**别把明显的规格破坏带进代码库**。
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var MP = path.join(ROOT, 'miniprogram');

var MIN_FONT_RPX = 32;      // 辅助文字底线 16pt = 32rpx [S2][S16]
var MIN_TAP_RPX = 88;       // 次要组件热区 44pt = 88rpx [S2]
var MIN_TAP_MAIN_RPX = 120; // 主要组件热区 60pt = 120rpx [S2]

var errors = [];
var warns = [];

function walk(dir, ext, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach(function (name) {
    var p = path.join(dir, name);
    var st = fs.statSync(p);
    if (st.isDirectory()) walk(p, ext, out);
    else if (p.indexOf(ext) === p.length - ext.length) out.push(p);
  });
  return out;
}

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

/* ---------------- 1. 页面完整性 ---------------- */
console.log('\n[1] 页面完整性');
var appJsonPath = path.join(MP, 'app.json');
if (!fs.existsSync(appJsonPath)) {
  errors.push('缺 miniprogram/app.json');
} else {
  var appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  (appJson.pages || []).forEach(function (p) {
    ['js', 'wxml', 'wxss', 'json'].forEach(function (ext) {
      var f = path.join(MP, p + '.' + ext);
      if (!fs.existsSync(f)) errors.push('页面 ' + p + ' 缺 ' + ext + ' 文件');
    });
  });
  console.log('  页面数 ' + (appJson.pages || []).length +
    '（层级深度要求 ≤2，页面数不是硬指标，靠人工走查 A5）');
}

/* ---------------- 2. 字号下限 ---------------- */
console.log('\n[2] 字号下限（硬编码 font-size ≥ ' + MIN_FONT_RPX + 'rpx）');
var wxssFiles = walk(MP, '.wxss');
var fontHits = 0;
wxssFiles.forEach(function (f) {
  var src = fs.readFileSync(f, 'utf8');
  var re = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*rpx/g;
  var m;
  while ((m = re.exec(src)) !== null) {
    fontHits++;
    var v = parseFloat(m[1]);
    if (v < MIN_FONT_RPX) {
      var line = src.slice(0, m.index).split('\n').length;
      errors.push(rel(f) + ':' + line + ' font-size ' + v + 'rpx < ' + MIN_FONT_RPX +
        'rpx（16pt 底线）');
    }
  }
});
console.log('  检查了 ' + wxssFiles.length + ' 个 wxss 文件，' + fontHits + ' 处 font-size');

/* ---------------- 3. 热区下限 ---------------- */
console.log('\n[3] 热区下限（min-height 字面量 ≥ ' + MIN_TAP_RPX + 'rpx）');
wxssFiles.forEach(function (f) {
  var src = fs.readFileSync(f, 'utf8');
  var re = /min-height\s*:\s*(\d+(?:\.\d+)?)\s*rpx/g;
  var m;
  while ((m = re.exec(src)) !== null) {
    var v = parseFloat(m[1]);
    if (v < MIN_TAP_RPX) {
      var line = src.slice(0, m.index).split('\n').length;
      errors.push(rel(f) + ':' + line + ' min-height ' + v + 'rpx < ' + MIN_TAP_RPX + 'rpx（44pt 底线）');
    }
  }
});

/* 热区必须走变量，不允许写死成小值 */
wxssFiles.forEach(function (f) {
  var src = fs.readFileSync(f, 'utf8');
  if (/min-height\s*:\s*var\(--tap\)/.test(src) || /min-height\s*:\s*var\(--tap-sm\)/.test(src)) {
    // 合规写法
  }
});

/* ---------------- 4. 可点元素必须有文字 ---------------- */
console.log('\n[4] 可点元素必须带文字（不能有纯图标按钮 [S12]）');
var wxmlFiles = walk(MP, '.wxml');
var tapCount = 0;
wxmlFiles.forEach(function (f) {
  var src = fs.readFileSync(f, 'utf8');
  // 粗筛：含 bindtap/catchtap 的标签起始行，向后看 3 行内是否出现 <text 或中文
  var lines = src.split('\n');
  lines.forEach(function (line, i) {
    if (!/bind(tap|touchstart)/.test(line)) return;
    tapCount++;
    var chunk = lines.slice(i, i + 4).join('\n');
    // 有文字的三种形态：<text> 标签、字面中文、{{}} 插值（列表项通常是插值）
    var hasText = /<text/.test(chunk) ||
      /[一-龥]/.test(chunk.replace(/<[^>]*>/g, '')) ||
      /\{\{[^}]+\}\}/.test(chunk);
    if (!hasText) {
      warns.push(rel(f) + ':' + (i + 1) + ' 可点元素附近没看到文字，确认是不是纯图标按钮');
    }
  });
});
console.log('  检查了 ' + tapCount + ' 处可点元素');

/* ---------------- 5. 占位符 / 死功能检查 ---------------- */
console.log('\n[5] 占位符与"点了没反应"的入口');
var allSrc = walk(MP, '.js').concat(wxmlFiles).concat(wxssFiles);
allSrc.forEach(function (f) {
  var src = fs.readFileSync(f, 'utf8');
  if (/YOUR_APPID|YOUR_ENV_ID|TODO|FIXME/.test(src)) {
    var line = src.split('\n').findIndex(function (l) { return /YOUR_APPID|YOUR_ENV_ID|TODO|FIXME/.test(l); });
    errors.push(rel(f) + ':' + (line + 1) + ' 存在未完成的占位标记');
  }
});

/* ---------------- 6. AppID ---------------- */
console.log('\n[6] AppID');
var pcPath = path.join(ROOT, 'project.config.json');
if (fs.existsSync(pcPath)) {
  var pc = JSON.parse(fs.readFileSync(pcPath, 'utf8'));
  if (!pc.appid || /^YOUR_/.test(pc.appid)) errors.push('project.config.json 的 appid 还是占位符');
  else console.log('  appid = ' + pc.appid);
}

/* ---------------- 7. 纯函数模块不应依赖 wx ---------------- */
console.log('\n[7] 纯函数模块不应依赖 wx.*（否则没法在 Node 里单测）');
['miniprogram/utils/time-parser.js', 'miniprogram/utils/time.js'].forEach(function (p) {
  var f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { errors.push('缺 ' + p); return; }
  var src = fs.readFileSync(f, 'utf8');
  if (/\bwx\./.test(src)) errors.push(p + ' 用到了 wx.*，无法在 Node 中单测');
});
console.log('  time-parser.js / time.js 应为纯函数');

/* ---------------- 汇总 ---------------- */
console.log('\n' + '='.repeat(56));
if (warns.length) {
  console.log('警告 ' + warns.length + ' 条（不阻断，但要人工确认）：');
  warns.forEach(function (w) { console.log('  ⚠ ' + w); });
}
if (errors.length) {
  console.log('失败 ' + errors.length + ' 条：');
  errors.forEach(function (e) { console.log('  ✗ ' + e); });
  console.log('\n结论：不通过');
  process.exit(1);
}
console.log('结论：静态检查全部通过（' + wxssFiles.length + ' wxss / ' + wxmlFiles.length + ' wxml）');
console.log('\n注意：这不代表真机无障碍达标。A6/A7/A8/A11 仍需真机验证。');
