# _archive · 归档区

> 归档日期：2026-10-08
> 归档原因：项目方向从「明白卡（读取群通知）」转向「记得（面向老年人的记事本）」，
> `apps/mingbaika/` 整体删除，此处保留**仍有可能复用**的部分。

**本目录不参与构建、不影响小程序运行**。里面的内容随时可以再删——保留只是因为
删了就找不回（其中 3 份文档在归档前从未进过 git）。

---

## 目录内容

| 目录 | 内容 | 为什么留 |
|---|---|---|
| `明白卡-失效文档/` | `AI接入选型.md`、`技术方案-纯本地版.md`、`第二版开发规划.md`、`参赛项目-明白卡-方案.md` | 记录了「为什么放弃 AI 路线」「第二版本来要做什么」的决策链路。将来写参赛复盘或重新评估 AI 时有参考价值 |
| `明白卡-一次性脚本/` | `gen-avatar.js` | 小程序头像生成器（依赖 Python Pillow）。改文案/配色/字号后可重新生成头像 |
| `明白卡-可复用工具/` | `deploy.js` | miniprogram-ci 部署封装（check/preview/upload/fn）。**绑定明白卡结构**——硬编码了 `parseNotice` 云函数与 `cloudfunctions/` 路径，直接跑到「记得」上会失败。改造时需去掉云函数分支、调整 ENV_ID 读取位置 |
| `明白卡-资产/` | `avatar.png` | 已提交到小程序注册页的头像（144×144）。「记得」若要沿用可改字重生成 |

---

## 恢复方式

本目录内容**已在 git 历史中**，即使本地删掉也能找回：

```bash
git log --oneline -- _archive/     # 找到提交
git checkout <commit> -- _archive/ # 恢复
```

被删除的 `apps/mingbaika/` 同理可整体恢复：

```bash
git log --oneline --diff-filter=D -- apps/mingbaika/
git checkout <commit>^ -- apps/mingbaika/
```

---

## 已随 `apps/mingbaika/` 一起删除、且**未**归档的内容

| 内容 | 说明 |
|---|---|
| 明白卡小程序源码 | 3 页面 + 2 组件 + utils（含 `api.js` / `tts.js` / `format.js`） |
| 云函数 `parseNotice` | 含 `core/`（schema、time-parser、risk-rules、pipeline、fallback）+ `providers/` + 3 份测试 |
| `docs/部署指南.md`、`部署指南-小白版.md`、`入口实测清单.md` | 明白卡专用部署文档 |
| `scripts/check.js`（77 项静态检查）、`setup-db.js`（建集合，从未用真实凭据跑通） | 明白卡专用脚本 |
| `project.private.config.json` | 开发者工具本地配置，**被 .gitignore 忽略，不在 git 里**，删除后不可恢复（可重新由工具生成） |

> 注意：`core/time-parser.js` 的**修复版**已随新项目保存在
> `apps/elder-notes/miniprogram/utils/time-parser.js`。归档区**没有**保留明白卡的旧版——
> 那份是未修复版（不支持「下午三点」这类中文数字钟点）。复用时请以新项目副本为准。
