# DSH-guardian

dsh WebUI panel for managing the dsh-guardian macOS LaunchAgents — start, stop and inspect the watchdog without touching a terminal.

在 dsh WebUI 中一键启动 / 停止 / 查看 macOS launchd 守护程序（定时巡检 + 配置变更侦测），无需打开终端。

- **插件包**：[`packages/dsh-guardian`](packages/dsh-guardian/)（`@botton/dsh-guardian`，含完整说明 [README.zh.md](packages/dsh-guardian/README.zh.md)）
- **安装**：`dsh plugin --profile web add github:bill277048-hash/DSH-guardian`，或从 dsh-market 一键安装
- **前提**：macOS（launchd gui 域）、Node ≥ 22.19、dsh ≥ 0.1.1-rc.1、已部署 dsh-guardian 守护脚本
- **特性**：零第三方运行时依赖；12 种状态码全中文反馈；仅封装既有 launchctl 启停逻辑，与终端命令完全等价

## 仓库结构

```
packages/dsh-guardian/   插件本体（package.json / lib / client.js / cordis.patch.yml）
  ├─ test/               单元测试 + QA 分支注入实测 + 真机 e2e（测试专用 label）
  └─ scripts/            deploy.sh / undeploy.sh（手动部署用，幂等、不自行 kickstart）
docs/                    架构设计文档、上架资料
dist/                    npm pack 分发 tarball
```

## License

MIT © botton指北
