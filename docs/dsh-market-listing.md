# dsh-market 上架资料 —— @botton/dsh-guardian v1.0.0

> 提交 dsh-market 时按各字段粘贴。最后更新：2026-09-03

## 基本信息

| 字段 | 内容 |
|---|---|
| 包名 | `@botton/dsh-guardian` |
| 版本 | 1.0.0 |
| 作者 | botton指北 |
| 许可证 | MIT |
| 分类建议 | 系统运维 / 服务管理 |
| 分发物 | `dist/botton-dsh-guardian-1.0.0.tgz`（18.8 kB，12 文件） |
| 兼容性 | macOS（launchd gui 域）、Node ≥ 22.19、dsh ≥ 0.1.1-rc.1 |
| 前置依赖 | 已部署 dsh-guardian 守护脚本（本插件为其管理面板） |

## 一句话简介（列表页用）

在 dsh WebUI 里一键启动/停止/查看 macOS launchd 守护程序，告别终端手动敲 launchctl。

## 详细介绍（详情页用）

dsh-guardian 是守护 DeepSeek Harness 的双 LaunchAgent（定时健康巡检 + 配置变更侦测）。以往启停必须在终端执行 `launchctl bootstrap / bootout`，本插件将这套**既有逻辑原样封装**进 WebUI 面板——不改任何启停行为，只加一个图形界面。

**核心能力**

- 状态总览：双 Agent 加载状态、运行次数、最近退出码、整体健康度（active / partial / stopped），附守护日志尾行、失败计数、备份数量
- 一键启动/停止：与终端操作完全等价，先 print 探测、只对需要的 job 动作、完成后 print 复验
- 12 种状态码全中文反馈：重复启动、停止未运行、启动/停止失败、复验失败、并发冲突（409）各有明确提示
- 安全围栏：API 仅回环可达，Host / Origin / sec-fetch-site 三重校验，防 DNS rebinding 与跨站调用

**品质背书**

- 零第三方运行时依赖、零构建步骤，安装包仅 18.8 kB
- 28 例单元测试 + 37 断言分支注入实测 + 真机端到端 8/8 全过
- 幂等防呆：EIO5 竞态容忍（重复启动/停止不误报失败），任何操作可安全重试

**理念**：只封装，不改造。面板与终端命令随时混用，互不冲突。

## 标签 / 关键词

dsh, dsh-plugin, launchd, launchctl, guardian, macos, 运维, 守护进程

## 截图清单（上架前需补拍）

1. WebUI 左侧插件栏「守护程序」入口
2. 面板主界面：active 状态全貌（双 job 绿点 + 日志尾行）
3. 停止后 stopped 状态 +「守护程序已停止」提示
4. 重复启动的 ALREADY_RUNNING 防呆提示

> 拍法：浏览器打开 `http://127.0.0.1:3081`，操作面板时系统截图即可；建议 1440×900 以上，注意抹掉日志里不想公开的信息。

## 安装说明（详情页底部）

市场安装后执行 `launchctl kickstart -k gui/$(id -u)/com.deepseek.dsh` 重载生效。卸载：移除 patch 条目 + 删除包目录后重载，守护程序本身不受影响。
