# dsh-guardian 守护程序面板

在 dsh WebUI 里一键管理 macOS launchd 守护程序：启动、停止、查看运行状态，不用再开终端敲 `launchctl`。

## 这是什么

[dsh-guardian](https://github.com/) 是一组守护 DeepSeek Harness（dsh）的 LaunchAgent 巡检脚本（定时健康扫描 + 配置变更侦测）。以前启停它必须在终端手动执行 `launchctl bootstrap / bootout`，本插件把这套既有逻辑原样封装进 dsh WebUI——**不改任何启停逻辑，只加面板**。

## 功能

- **状态总览**：双 LaunchAgent（定时巡检 + 变更侦测）的加载状态、运行次数、最近退出码、整体健康度（active / partial / stopped）
- **守护日志尾行**：最近扫描记录、失败计数、备份数量，面板上直接看
- **一键启动 / 停止**：调用与终端完全相同的 `launchctl bootstrap / bootout`，先探测再动作再复验
- **明确的异常反馈**（12 种状态码全中文提示）：
  - 重复启动 →「守护程序已在运行中，无需重复启动」
  - 停止未运行的守护 →「守护程序当前未在运行，无需停止」
  - 启动失败 / 启动后未加载 / 停止失败 / 停止后未卸载 → 各自独立的错误提示与排查建议
  - 并发操作 → 409「操作进行中，请稍候」
- **安全围栏**：API 仅监听回环地址，校验 Host / Origin / sec-fetch-site，防 DNS rebinding 与跨站调用

## 设计原则

- **零第三方运行时依赖**：纯 Node.js 标准库 + dsh 宿主 API，无需 build 步骤
- **只封装，不改造**：启停走系统 `launchctl`，与手动终端操作完全等价，两者可随时混用
- **幂等防呆**：先 `print` 探测、只对需要的 job 动作、完成后 `print` 复验；EIO5 竞态容忍（重复 bootstrap / bootout 竞态不误报失败）
- **只读状态聚合**：读取 guardian 状态目录与日志，绝不写入

## 安装

从 dsh-market 安装后重载 dsh 即可：

```bash
launchctl kickstart -k gui/$(id -u)/com.deepseek.dsh
```

手动安装（tarball）：解包到 profile 的 `node_modules/@botton/dsh-guardian/`，向 profile `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: web-ui-guardian
      name: '@botton/dsh-guardian'
```

然后执行上面的 kickstart 重载。

## 前提

- macOS（launchd 用户域），Node ≥ 22.19，dsh ≥ 0.1.1-rc.1
- 已安装 dsh-guardian 守护脚本（本插件是它的管理面板，不包含守护脚本本身）

## 卸载

移除 patch 中的 `web-ui-guardian` 条目并删除 `node_modules/@botton/dsh-guardian/`，重载 dsh。守护程序本身不受影响。

## 作者

**botton指北** —— 抠门爱折腾的免费党技术博主，公众号「botton指北」。MIT License。
