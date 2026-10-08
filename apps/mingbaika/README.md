# 明白卡 · 小程序工程

> 面向祖辈家长的信息降维工具。老人把家长群里的通知转发进来，输出一张大字、能听、说清「要做什么、什么时候前、交多少钱」的行动卡。
>
> 参赛：2026 微信小程序开发大赛（主题「与 AI 共生」）
> 产品方案见 `../../docs/参赛项目-明白卡-方案.md`

---

## 一、这个工程现在是什么状态

**已完成**：完整可部署的骨架 + 已验证的核心内核。

| 部分 | 状态 | 验证方式 |
|---|---|---|
| 纯函数内核（校验/时间解析/风险规则/降级） | ✅ 完成 | 46 项离线测试全通过 |
| 云函数解构引擎（含两条 AI 路线） | ✅ 完成 | 静态校验通过；需真机联调 |
| 小程序端（3 页面 + 2 组件） | ✅ 完成 | 静态校验 68 项通过 |
| **真实运行** | ⏳ 待人工 | 需要 AppID + 云环境（见第四节） |

**核心设计**：所有「判断」都在 `cloudfunctions/parseNotice/core/` 里的纯函数中，不碰网络、不碰 `wx.*`。因此它们可以在 Node 里完整回归测试，换模型、换载体都不用重写。

---

## 二、目录结构

```
apps/mingbaika/
├── project.config.json              # 开发者工具项目配置（miniprogramRoot / cloudfunctionRoot）
├── scripts/check.js                 # 静态校验脚本（下面第五节讲怎么用）
├── docs/AI接入选型.md                # 云开发托管 vs HTTP 直连的决策依据
├── miniprogram/                     # 小程序端
│   ├── app.js                       # 云开发初始化（⚠️ 需填 ENV_ID）
│   ├── app.json / app.wxss / sitemap.json
│   ├── pages/
│   │   ├── index/                   # 入口页：三个通知入口
│   │   ├── result/                  # 行动卡页：一屏一卡 + 朗读 + 一键拨号
│   │   └── history/                 # 历史记录
│   ├── components/
│   │   ├── action-card/             # 行动卡组件
│   │   └── risk-banner/             # 风险拦截条
│   └── utils/
│       ├── api.js                   # 云函数调用封装
│       ├── store.js                 # 本地历史（最多 50 条）
│       ├── tts.js                   # 语音播报（读不出时降级）
│       └── format.js                # 日期/金额中文格式化
└── cloudfunctions/
    └── parseNotice/                 # 解构引擎（产品模块 F2）
        ├── index.js                 # 主流程：取图 → 调模型 → 过管线 → 落库
        ├── config.js                # 所有可调项（含 AI 路线开关）
        ├── prompt.js                # Prompt 组装
        ├── core/                    # ★ 纯函数内核（不依赖任何环境）
        │   ├── schema.js            # 行动卡契约 + 规范化 + 校验
        │   ├── time-parser.js       # 相对时间 → 绝对日期
        │   ├── risk-rules.js        # 风险启发式（F4）
        │   ├── fallback.js          # 降级判定
        │   ├── pipeline.js          # 端到端管线
        │   └── json-extract.js      # 从模型自由文本里抽 JSON
        ├── providers/               # AI Provider 抽象
        │   ├── cloudbase-ai.js      # 路线 A：云开发托管
        │   └── http-deepseek.js     # 路线 B：HTTP 直连
        └── tests/                   # 离线回归测试
```

---

## 三、数据流

```
用户在群里长按通知 → 转发 → 选「明白卡」
                                    ↓
                    wx.chooseMessageFile / chooseMedia / 转发参数
                                    ↓
                        上传云存储拿 fileID
                                    ↓
              wx.cloud.callFunction('parseNotice')
                                    ↓
        云函数取图 → base64 → 组装 Prompt → 调模型
                                    ↓
        ┌──────────── core/ 纯函数管线 ────────────┐
        │ 抽 JSON → 规范化 → 契约校验              │
        │ → 本地重算日期 → 风险启发式 → 降级判定    │
        └──────────────────────────────────────────┘
                                    ↓
                    返回行动卡 → 渲染 + 朗读 + 拨号
```

**为什么日期不交给模型算**：模型算「本周五前」极易给错年份或错推算。所以 prompt 里明确要求它只引用原文表述，绝对日期一律由 `core/time-parser.js` 本地计算——确定性、可单测、可回归。

**为什么会降级**：抽取错的金额或日期，比不抽取更糟。证据不足时整卡降级为「原文 + 朗读」，让用户自己核对，绝不给半成品。

---

## 四、部署步骤（照着做）

### 1. 填两个占位值

| 文件 | 占位 | 替换成 |
|---|---|---|
| `project.config.json` | `"appid": "YOUR_APPID"` | 你的小程序 AppID |
| `miniprogram/app.js` | `var ENV_ID = 'YOUR_ENV_ID'` | 云开发环境 ID |

### 2. 用开发者工具打开项目

打开**开发者工具的「导入项目」**，目录选 `apps/mingbaika/`（**不是** `miniprogram/`）——因为 `project.config.json` 在这一层。

### 3. 开通云开发

工具栏点「云开发」→ 开通 → 创建环境（首次使用有免费额度）。
把环境的 **环境 ID** 填进 `app.js` 的 `ENV_ID`。

### 4. 部署云函数

在开发者工具左侧文件树里右键 `cloudfunctions/parseNotice` → **「上传并部署：云端安装依赖」**。
（一定要选「云端安装依赖」，本地没有 `node_modules`。）

### 5. 建数据库集合

云开发控制台 → 数据库 → 新建集合 `notices`。

权限建议：**仅创建者可读写**。这个集合存的是用户自己的通知解析结果，不需要共享。

### 6. 配置模型

云开发控制台 → **AI+** → 确认 `deepseek-v4-flash` 可用。

如果不用云开发托管、要切 HTTP 直连，在云函数配置里加三个环境变量：

```
AI_PROVIDER=http
AI_HTTP_BASE_URL=https://api.deepseek.com/v1
AI_HTTP_API_KEY=sk-xxxxx
```

细节和取舍理由见 `docs/AI接入选型.md`。

### 7. 配置一键拨号号码

`miniprogram/app.js` 里的 `contactPhone: ''`，填一个默认号码（通常是子女或老师的电话）。
产品上更合理的做法是让子女首次配置时填写，M1 先用固定值。

### 8.（可选）开通语音播报

语音播报依赖**微信同声传译插件**，需要单独申请：

1. 小程序后台 → 设置 → 第三方设置 → 插件管理 → 添加插件，搜索「微信同声传译」（appid `wx069ba97219f66d99`）
2. 在 `app.json` 里加：

```json
"plugins": {
  "WechatSI": {
    "version": "0.3.5",
    "provider": "wx069ba97219f66d99"
  }
}
```

**注意**：这个 `plugins` 字段刻意**没有**预先写在 `app.json` 里——如果写了但后台没添加插件，开发者工具会直接报错，整个项目打不开。所以顺序必须是「先加插件，再改配置」。

不配也能跑：`utils/tts.js` 会降级为 Toast 提示，不会崩。

---

## 五、测试与校验

这两个命令都不需要微信环境、不需要联网，可以随时跑。

```bash
# 内核回归测试（46 项）
node apps/mingbaika/cloudfunctions/parseNotice/tests/core.test.js
node apps/mingbaika/cloudfunctions/parseNotice/tests/pipeline-model.test.js

# 小程序静态校验（JSON 合法性 / 页面完整性 / 组件路径 / JS 语法 / 事件绑定）
node apps/mingbaika/scripts/check.js
```

静态校验能拦住绝大部分「一打开就报错」的问题：JSON 写错、组件路径不存在、页面缺文件、事件绑定的方法在 JS 里根本不存在。

**它拦不住的**：真实运行时的行为。那必须靠开发者工具 + 真机。

---

## 六、待办清单

### 阻塞真实运行（必须人工做）

- [ ] 填 `project.config.json` 的 **AppID**
- [ ] 开通云开发，填 `app.js` 的 **ENV_ID**
- [ ] 部署云函数 `parseNotice`
- [ ] 建集合 `notices`
- [ ] 在云开发控制台确认 **`deepseek-v4-flash` 可用**

### 需要实测确认（我未验证，不算结论）

- [ ] **三个通知入口是否真的可用** —— 这是整个项目单点风险，见产品方案 §9.1
  - `wx.chooseMessageFile` 从聊天选图
  - 转发消息给小程序（字段传递方式）
  - 聊天工具栏入口
- [ ] 云函数侧 `cloud.extend.AI` 是否可用（`docs/AI接入选型.md` 的 V1）
- [ ] 图片输入是否真的支持 `deepseek-v4-flash`（V3）
- [ ] 单张图片大小上限（V4）

### 体验完善

- [ ] 一键拨号号码改为子女配置
- [ ] 同声传译插件申请与配置
- [ ] 真实通知测试集（100 条）跑一遍，看行动项召回率与期限抽取准确率
- [ ] `app.js` 的 `pendingForward` 字段名按真机实测结果修正

---

## 七、刻意不做的选择

这些是取舍，不是遗漏。改动前先看理由。

| 决定 | 理由 |
|---|---|
| 不用 TDesign / 任何 npm 包 | 避免「构建 npm」这一步。9 天冲刺要减少失败点，且本产品 UI 极简（一屏一卡、大按钮），组件库用不上。手写 WXSS 反而更好控制面向老人的字号与对比度。 |
| 不用 Skyline | 默认 WebView 渲染足够；Skyline 的样式子集差异会带来额外的适配成本。 |
| 不做前端直连模型 | Schema 校验、降级、幂等、风险规则都在云函数侧。前端直连会让这些兜底逻辑无处安放。宁可多一跳。 |
| 卡片最多 3 条行动项 | 认知负荷约束，不是技术限制。 |
| 小程序不做好友关系链 | 小程序**没有任何好友链 API**（`wx.getFriendCloudStorage` 是小游戏专属且仅限开放数据域）。这一点无法绕过，只能接受。 |
