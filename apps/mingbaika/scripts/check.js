'use strict';

/**
 * 小程序静态校验。
 *
 * 为什么需要它：小程序没法在命令行里真正运行，但绝大部分「一打开就报错」的问题
 * 都是可以静态查出来的——JSON 写错、组件路径不存在、页面文件缺一个、事件绑定的方法
 * 在 JS 里根本不存在。这个脚本把这些都拦住，让「能不能打开」变成可机械复现的结论，
 * 而不是「我感觉应该没问题」。
 *
 * 用法：
 *   node apps/mingbaika/scripts/check.js
 *
 * 退出码 0 = 全部通过；1 = 有错误。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_ROOT = path.join(__dirname, '..');
const MP = path.join(APP_ROOT, 'miniprogram');
const CF = path.join(APP_ROOT, 'cloudfunctions');

const errors = [];
const warnings = [];
let checks = 0;

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }
function ok() { checks++; }

function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function rel(p) { return path.relative(APP_ROOT, p).replace(/\\/g, '/'); }

function exists(p) { try { fs.statSync(p); return true; } catch (e) { return false; } }

// ---------------------------------------------------------------------------
console.log('== 1. JSON 文件合法性 ==');
// ---------------------------------------------------------------------------
const jsonFiles = walk(MP).filter((f) => f.endsWith('.json'))
  .concat(['project.config.json'].map((f) => path.join(APP_ROOT, f)).filter(exists));
for (const f of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
    ok();
  } catch (e) {
    fail(`JSON 解析失败：${rel(f)} —— ${e.message}`);
  }
}
console.log(`   检查 ${jsonFiles.length} 个 JSON`);

// ---------------------------------------------------------------------------
console.log('== 2. app.json 页面文件完整性 ==');
// ---------------------------------------------------------------------------
let appJson = null;
try {
  appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
} catch (e) {
  fail('读不到 app.json：' + e.message);
}
if (appJson) {
  const pages = appJson.pages || [];
  if (!pages.length) fail('app.json 的 pages 为空');
  for (const page of pages) {
    for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
      const p = path.join(MP, page + ext);
      if (!exists(p)) fail(`页面文件缺失：${page}${ext}`);
      else ok();
    }
  }
  // tabBar 里引用的页面也必须在 pages 中
  if (appJson.tabBar && Array.isArray(appJson.tabBar.list)) {
    for (const item of appJson.tabBar.list) {
      if (item.pagePath && pages.indexOf(item.pagePath) < 0) {
        fail(`tabBar 引用了未注册的页面：${item.pagePath}`);
      } else ok();
    }
  }
  console.log(`   检查 ${pages.length} 个页面`);
}

// ---------------------------------------------------------------------------
console.log('== 3. 自定义组件注册路径 ==');
// ---------------------------------------------------------------------------
function resolveComponent(fromJsonPath, ref) {
  if (ref.startsWith('plugin://')) return null; // 插件，跳过
  if (ref.startsWith('/')) return path.join(MP, ref.slice(1));
  return path.resolve(path.dirname(fromJsonPath), ref);
}

let compCount = 0;
for (const f of jsonFiles) {
  if (!f.startsWith(MP)) continue;
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
  const uc = j.usingComponents;
  if (!uc) continue;
  for (const [name, refVal] of Object.entries(uc)) {
    compCount++;
    const base = resolveComponent(f, refVal);
    if (base === null) { ok(); continue; }
    for (const ext of ['.js', '.json', '.wxml']) {
      if (!exists(base + ext)) {
        fail(`${rel(f)} 引用的组件 "${name}" 缺少文件：${refVal}${ext}`);
      } else ok();
    }
  }
}
console.log(`   检查 ${compCount} 处组件引用`);

// ---------------------------------------------------------------------------
console.log('== 4. JS 语法 ==');
// ---------------------------------------------------------------------------
const jsFiles = walk(MP).filter((f) => f.endsWith('.js'))
  .concat(walk(CF).filter((f) => f.endsWith('.js') && !f.includes('node_modules')));
for (const f of jsFiles) {
  const code = fs.readFileSync(f, 'utf8');
  try {
    new vm.Script(code, { filename: f });
    ok();
  } catch (e) {
    fail(`JS 语法错误：${rel(f)} —— ${e.message}`);
  }
}
console.log(`   检查 ${jsFiles.length} 个 JS 文件`);

// ---------------------------------------------------------------------------
console.log('== 5. WXML 事件绑定 vs JS 方法 ==');
// ---------------------------------------------------------------------------
const wxmlFiles = walk(MP).filter((f) => f.endsWith('.wxml'));
let bindCount = 0;
for (const wxml of wxmlFiles) {
  const jsPath = wxml.replace(/\.wxml$/, '.js');
  if (!exists(jsPath)) continue;
  const src = fs.readFileSync(wxml, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  // 匹配 bindtap / catchtap / bind:tap 等
  const re = /(?:bind|catch|capture-bind|capture-catch)[:]?([a-zA-Z]+)\s*=\s*"([^"{}]+)"/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(src)) !== null) {
    const handler = m[2].trim();
    if (!handler || seen.has(handler)) continue;
    seen.add(handler);
    bindCount++;
    // JS 里应存在 `handler:` 或 `handler(` 或 `handler =`
    const re2 = new RegExp('\\b' + handler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:(=]');
    if (!re2.test(js)) {
      fail(`${rel(wxml)} 绑定了 ${handler}，但 ${path.basename(jsPath)} 里找不到这个方法`);
    } else ok();
  }
}
console.log(`   检查 ${bindCount} 处事件绑定`);

// ---------------------------------------------------------------------------
console.log('== 6. 工程结构 ==');
// ---------------------------------------------------------------------------
const mustHave = [
  'project.config.json',
  'miniprogram/app.js',
  'miniprogram/app.json',
  'miniprogram/app.wxss',
  'cloudfunctions/parseNotice/index.js',
  'cloudfunctions/parseNotice/package.json',
];
for (const f of mustHave) {
  if (!exists(path.join(APP_ROOT, f))) fail(`缺少必须文件：${f}`);
  else ok();
}

// 反向检查：project.config.json 里的 miniprogramRoot 必须指向真实目录
try {
  const pc = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'project.config.json'), 'utf8'));
  const mr = pc.miniprogramRoot || './';
  if (!exists(path.resolve(APP_ROOT, mr))) {
    fail(`project.config.json 的 miniprogramRoot="${mr}" 指向不存在的目录`);
  } else ok();
  const cr = pc.cloudfunctionRoot;
  if (cr && !exists(path.resolve(APP_ROOT, cr))) {
    fail(`project.config.json 的 cloudfunctionRoot="${cr}" 指向不存在的目录`);
  } else if (cr) ok();
  if (!pc.appid || pc.appid === 'YOUR_APPID') {
    warn('project.config.json 的 appid 还是占位值，开发者工具里需要填真实 AppID 才能用云开发');
  }
} catch (e) {
  fail('读 project.config.json 失败：' + e.message);
}

// 占位值扫描
const placeholders = [];
for (const f of jsFiles) {
  const code = fs.readFileSync(f, 'utf8');
  if (code.includes('YOUR_ENV_ID')) placeholders.push('YOUR_ENV_ID ← ' + rel(f));
  if (code.includes('YOUR_APPID')) placeholders.push('YOUR_APPID ← ' + rel(f));
}
if (placeholders.length) {
  for (const p of placeholders) warn('待人工替换的占位值：' + p);
}

// ---------------------------------------------------------------------------
console.log('\n' + '-'.repeat(56));
console.log(`静态检查项 ${checks} 个，错误 ${errors.length} 个，提醒 ${warnings.length} 个`);
if (errors.length) {
  console.log('\n错误：');
  errors.forEach((e) => console.log('  ✗ ' + e));
}
if (warnings.length) {
  console.log('\n提醒（不阻塞）：');
  warnings.forEach((w) => console.log('  ! ' + w));
}
if (errors.length) {
  console.log('\n静态校验未通过');
  process.exit(1);
}
console.log('\n静态校验通过 ✅');
