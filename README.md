# DSH-guardian

dsh WebUI panel for managing the dsh-guardian macOS LaunchAgents — start, stop and inspect the watchdog without touching a terminal.

在 dsh WebUI 中一键启动 / 停止 / 查看 macOS launchd 守护程序（定时巡检 + 配置变更侦测），无需打开终端敲 `launchctl`。

- 兼容：macOS（launchd 用户域）、Node ≥ 22.19、dsh ≥ 0.1.1-rc.1
- 许可证：MIT · 零第三方运行时依赖

## 这是什么 / 不是什么

dsh-guardian 是一组守护 DeepSeek Harness（dsh）的 LaunchAgent 巡检脚本（定时健康扫描 + 配置变更侦测）。以前启停它必须在终端手动执行 `launchctl bootstrap / bootout`，[本插件](packages/dsh-guardian/) 把这套既有逻辑原样封装进 dsh WebUI。

| | |
|---|---|
| ✅ 是 | dsh-guardian 守护程序的 WebUI 管理面板（启动 / 停止 / 查看状态） |
| ❌ 不是 | 不含守护脚本本身（守护脚本须另行部署） |
| ✅ 只封装 | 启停走系统 `launchctl`，与终端命令完全等价，两者可随时混用 |
| ✅ 不改造 | 守护脚本、两个 plist 一行不动；绝不碰 dsh 主服务 |

## 工作原理（30 秒版）

```
浏览器面板(client.js)  ──fetch──▶  dsh webServer 路由 /api/guardian/*
                                      │
                                      ▼
                           GuardianService（互斥锁序列化 start/stop）
                                      │
                    ┌─────────────────┼──────────────────┐
                    ▼                 ▼                  ▼
              launchctl.js     guardian-state.js        （只读）
           bootstrap/bootout    print 解析 + .fails     backups/ 计数
                /print           + log tail               guardian.log
```

操作语义（**先探测、后动作、再验证**）：

- **start**：先 `print` 双 label → 双已加载直接返回 `ALREADY_RUNNING`（不发 bootstrap）；仅对未加载的 plist 执行 `bootstrap`；EIO5 视为已加载（竞态容忍）；完成后 `print` 复验双 loaded。
- **stop**：先 `print` → 双未加载直接返回 `NOT_RUNNING`（不发 bootout）；仅对已加载的 label 执行 `bootout`；`No such process` / `Could not find service` 视为已停止；完成后 `print` 复验。
- **status**：不加锁，随时可查。

## 安装 / 卸载

### 方式一：插件市场

```bash
dsh plugin --profile web add github:bill277048-hash/DSH-guardian
```

或从 dsh **设置 → 插件市场** 一键安装。

### 方式二：本仓库脚本

```bash
# 安装（备份 patch → 拷包 → 幂等追加 insert 条目；不自行 kickstart）
packages/dsh-guardian/scripts/deploy.sh
# 重载生效（确认后手动执行）
launchctl kickstart -k gui/$(id -u)/com.deepseek.dsh

# 卸载（先摘条目后删包，自动备份 patch）
packages/dsh-guardian/scripts/undeploy.sh
launchctl kickstart -k gui/$(id -u)/com.deepseek.dsh
```

## 前提

- macOS（launchd 用户域 `gui/<uid>`）
- Node ≥ 22.19，dsh ≥ 0.1.1-rc.1
- **已部署 dsh-guardian 守护脚本**（两个 plist `com.deepseek.dsh-guardian{,-diff}.plist` + `dsh-guardian.sh`）——本插件是它的管理面板，不包含守护脚本本身

## 使用

### WebUI 面板

打开 dsh WebUI **插件管理页**，找到「守护程序」卡片：状态总览（双 LaunchAgent 加载状态 / 运行次数 / 最近退出码 / 整体健康度）+ 守护日志尾行 + 启动 / 停止 / 刷新按钮。操作期间按钮禁用防抖，完成后自动刷新状态。

### 状态接口（只读，仅限本机回环）

```bash
curl --noproxy '*' -s http://127.0.0.1:3081/api/guardian/status
```

返回：`overall`（`active` 双 loaded / `partial` 单 loaded 异常 / `stopped` 双未加载）、`jobs[]`（每个 label 的 `loaded` / `state` / `runs` / `lastExitCode`）、`guardian`（`fails` 失败计数 / `backupCount` 备份数 / `lastLogLines` 日志尾行）、`checkedAt`。

### 12 反馈分支

| code | 场景 | 中文提示 |
|---|---|---|
| `OK` | 启动 / 停止成功 | 守护程序已启动 / 已停止 |
| `ALREADY_RUNNING` | 重复启动 | 已在运行中，无需重复启动 |
| `START_FAILED` | 启动失败 | 启动失败，请检查 plist 与系统日志 |
| `START_VERIFY_FAILED` | 启动后未加载 | 指令已执行但未正常加载 |
| `NOT_RUNNING` | 停止未运行 | 当前未在运行，无需停止 |
| `STOP_FAILED` | 停止失败 | 停止失败，请重试或终端手动 bootout |
| `STOP_VERIFY_FAILED` | 停止后仍在 | 指令已执行但服务仍在运行 |
| `partial` | 状态页：仅单 job loaded | 两个守护任务仅一个在运行，建议先停止再重启 |
| `BUSY` | 并发操作 (409) | 正在执行上一个操作，请稍候 |
| `INTERNAL` | 内部错误 (500) | 插件内部错误 |
| 403（HTTP 状态） | 非本机访问 | forbidden: loopback-only |

面板按 code 着色：`OK` 绿、`ALREADY_RUNNING` / `NOT_RUNNING` 黄（提示非故障）、`BUSY` 灰、其余红。

## 设计原则

- **零第三方运行时依赖**：纯 Node.js 标准库 + dsh 宿主 API，零构建步骤
- **只封装，不改造**：启停走系统 `launchctl`，与手动终端操作完全等价
- **幂等防呆**：先 `print` 探测、只对需要的 job 动作、完成后 `print` 复验；EIO5 竞态容忍
- **只读状态聚合**：读取 guardian 状态目录与日志，绝不写入
- **回环安全围栏**：API 仅监听回环地址，校验 Host / Origin / sec-fetch-site，防 DNS rebinding 与跨站调用

## 仓库结构

```
packages/dsh-guardian/   插件本体（package.json / lib / client.js / cordis.patch.yml / test / scripts）
  ├─ test/               单元测试 + QA 分支注入实测 + 真机 e2e（测试专用 label）
  └─ scripts/            deploy.sh / undeploy.sh（手动部署用，幂等、不自行 kickstart）
docs/                    架构设计、上架资料
```

更完整的说明见 [`packages/dsh-guardian/README.zh.md`](packages/dsh-guardian/README.zh.md)。

## 质量

- 28 例单元测试（parsePrint / 状态聚合，`node --test` 零依赖）
- 37 断言分支注入实测（12 分支全覆盖）
- 真机端到端 8/8（测试专用 label `com.deepseek.dsh-guardian-plugin-test`，全程不碰生产 label）
- macOS 26 / Apple Silicon 生产环境实跑验证

## 许可证

MIT © botton指北
