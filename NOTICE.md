# 来源与署名

本仓库是 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) 的修改版本，不是上游官方发布。原项目作者为 **小杨**（GitHub: [@YuJunZhiXue](https://github.com/YuJunZhiXue)），原许可证为 MIT，`Copyright (c) 2026 小杨`，全文见 [LICENSE](LICENSE)。本仓库保留原版权声明与许可证文本。

本仓库的修改包括：移除在线更新入口、移除回退功能、调整仓库元数据与文档、增加本机状态修订号、审计/审批门、严格 JSON 输出、提示词内核 v3，以及 0.2.1 的补丁锚点。插件用途不变，但上述改动会改变默认提示行为与可用的界面入口。

## 工程加固的来源

以下模块与兼容性改动来自 [JeffKeeping/dsh-purge-plus](https://github.com/JeffKeeping/dsh-purge-plus)（MIT）：

- `lib/json-safe.js`
- `lib/revision.js`
- `lib/tool-gate.js`
- 0.2.1 `dsh-harness-dev-context` 锚点（#32 / #53）与 #90 `STEER_WAKE_LATCH`
- `test/` 与 `scripts/compat-check.mjs` 的结构与用例

该分支的 `NOTICE.md` 说明，上述实现参考了 [Minglink/dsh-infinite-gen-5](https://github.com/Minglink/dsh-infinite-gen-5)（IG5，CC BY-NC-SA 4.0）的 `source/json_output.js`、`source/attachment_lease.js`、`index.js` 的 `installApprovalGate` 以及各模块的 revision/CAS 做法。本仓库仅使用与本插件场景相关的部分，不包含 IG5 的逆向引擎、Python worker 协议或调试器集成。相关设计思想按 CC BY-NC-SA 4.0 署名；本仓库整体仍按 MIT 发布，且不用于商业售卖。

## 其它第三方文件

`lib/redteam/`、`presets/redteam/`、`skills/redteam/` 等红队代码与素材来自 Jueze-2019 的 MIT 许可项目，版权与许可全文见：

- [docs/redteam-upstream-LICENSE](docs/redteam-upstream-LICENSE)
- [docs/redteam-upstream-DISCLOSURE](docs/redteam-upstream-DISCLOSURE)

## 使用条件

上游 README 要求：借用本项目的名称、思路、代码或提示词，必须署名并写明来源仓库。本仓库保留该署名与上游链接。上游同时声明本项目免费、非盈利，禁止商业售卖、付费倒卖或用于黑灰产牟利；本仓库沿用同一条款。
