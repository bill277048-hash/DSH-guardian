# v1.0.0

dsh-guardian 守护程序面板首个正式发布：在 dsh WebUI 中一键启动 / 停止 / 查看 macOS launchd 守护程序。

## 功能

- 状态总览：双 LaunchAgent（定时巡检 + 变更侦测）的加载状态、运行次数、最近退出码、整体健康度
- 守护日志尾行、失败计数、备份数量，面板内直接查看
- 一键启动 / 停止：与终端 `launchctl bootstrap / bootout` 完全等价
- 12 种状态码全中文反馈：重复启动、停止未运行、启动/停止失败、复验失败、并发冲突（409）、回环围栏（403）
- 先 print 探测 → 只对需要的 job 动作 → 完成后 print 复验；EIO5 竞态容忍

## 设计原则

只封装，不改造：启停走系统 launchctl，与手动终端操作等价，两者可随时混用。零第三方运行时依赖，零构建步骤。

## 质量

- 28 例单元测试（解析与状态聚合）
- 37 断言的分支注入实测（12 分支全覆盖）
- 真机端到端 8/8（仅用测试专用 launchd label）
- macOS 26 / Apple Silicon 生产环境实跑验证

## 安装

```bash
dsh plugin --profile web add github:bill277048-hash/DSH-guardian
```

或从 dsh-market 一键安装。手动安装见仓库 README。

## 变更记录

完整内容见仓库内 `packages/dsh-guardian/CHANGELOG.md`。
