# Changelog

## 1.0.0 (2026-09-03)

首个正式发布。

### 功能

- WebUI 面板（插槽 `web-ui.plugin.item`，名称「守护程序」）：状态总览、日志尾行、启动/停止按钮
- 宿主 API：`GET /api/guardian/status`、`POST /api/guardian/start`、`POST /api/guardian/stop`
- 12 分支错误分类法全中文反馈（OK / ALREADY_RUNNING / START_FAILED / START_VERIFY_FAILED / NOT_RUNNING / STOP_FAILED / STOP_VERIFY_FAILED / partial / BUSY / INTERNAL / 403）
- launchctl 操作语义：print 探测 → 只对需要的 job 动作 → print 复验；EIO5 竞态容忍
- 回环安全围栏（socket + Host + Origin + sec-fetch-site 校验）
- AsyncMutex 并发互斥（409 BUSY）

### 质量

- 28 例单元测试（parsePrint / 状态聚合），37 断言分支注入实测，真机 e2e 8/8（测试标签 `com.deepseek.dsh-guardian-plugin-test{,-diff}`）
- 真机认知：macOS 26 对非法 plist 的 bootstrap 与"已加载"同返 EIO 5，统一由 print 复验兜底

### 备注

- 包名由开发期 `@dsh-local/dsh-guardian` 更名为 `@botton/dsh-guardian`（分发署名 botton指北），运行时行为不变
- 许可证 MIT
