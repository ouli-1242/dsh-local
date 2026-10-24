# dsh-purge

本机 DeepSeek Harness（DSH）插件，用于管理提示词与补丁。安装并应用后会修改本机 DSH 安装目录中的 `@deepseek-ai` 文件；入口在 **设置 → Purge**，分为补丁、规则、演练台三段。

> 只在你有权管理的机器上使用。应用前请确认可以还原；插件会为被修改的文件保留 `.dshpurge.bak` 备份。

## 环境

- DSH 0.2.1-rc.2（官方 Web 与官方桌面端）
- Node.js >= 18

## 安装

在本仓库目录执行，只安装正在使用的宿主；某个 profile 不存在就跳过对应命令。

```sh
# Web
dsh plugin --profile web add .

# 官方桌面端
dsh plugin --profile desktop add .
```

使用打包文件时，把 `.` 换成 tar.gz / zip 的路径。

## 应用

1. 完全退出并重新打开刚安装的宿主。
2. 打开 **设置 → Purge**，在 **补丁** 段点 **应用**。
3. 应用成功会自动重启；没完成不会重启。重启后新开一轮对话。

Web 与桌面端分开应用，不要在一个宿主里点另一个宿主的应用。

## 使用范围

- 「演练台」仅用于你有权管理的本机、离线靶标，或已获书面授权的环境。
- 插件不按地区或目标 IP 做拦截；请自行确认对目标有测试授权。

## 命令行

```sh
dsh-purge --status
dsh-purge --apply
dsh-purge --revert
dsh-purge --uninstall
```

聊天中也可以使用 `/purge status|apply|revert|uninstall`。

## 还原与卸载

- **还原**：用 `.dshpurge.bak` 覆盖回原文件；没有备份时去掉本插件写入的 shim 行。
- **卸载**：先还原已应用的补丁，再删除注入文件、规则库和插件本身。
- 用户自己的提示词文件 `prompt-inject.md` 在还原时保留。

## 升级

本版本没有在线更新入口，也不会访问上游仓库。升级时退出宿主，替换本插件目录后重新应用。

## 许可

MIT License，版权声明见 [LICENSE](LICENSE)。本仓库基于上游项目的修改版本，工程加固的来源、第三方代码与署名见 [NOTICE.md](NOTICE.md)；红队代码的原始许可见 [docs/redteam-upstream-LICENSE](docs/redteam-upstream-LICENSE) 和 [docs/redteam-upstream-DISCLOSURE](docs/redteam-upstream-DISCLOSURE)。
