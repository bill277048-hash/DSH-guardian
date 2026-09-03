# dsh-market 上架流程与 PR 材料

## 流程（三步）

1. **本仓库推上 GitHub**（已完成代码与提交，待网络可用时 push）
2. **给仓库加 topic `dsh-plugin`**（GitHub 网页：仓库页 → 右上角齿轮 → Topics，必填，是官方发现机制）
3. **向注册表提 PR**：fork `awesome-dsh-plugin/awesome-dsh-plugin` → 在 `data/plugins/` 新建 `bill277048-hash__DSH-guardian.yml`（内容见 [registry-entry.yml](registry-entry.yml)）→ 提 PR

PR 合并后 README 自动重新生成、目录站与 dsh-market 自动重建，通常一天内收录。

## PR 正文草稿

```
Add bill277048-hash/DSH-guardian (tools)

A WebUI panel for the dsh-guardian watchdog: start, stop and inspect the two
macOS LaunchAgents (health scan + config diff) that keep DeepSeek Harness alive,
without opening a terminal.

- Host routes: GET /api/guardian/status, POST /api/guardian/start|stop
- 12-branch error taxonomy with Chinese feedback (already running, start failed,
  verify failed, 409 busy, 403 loopback guard, ...)
- Zero third-party runtime deps, zero build step; declares dsh.bundle
- Verified: 28 unit tests, 37-assertion branch injection suite, 8/8 real launchd e2e
  (test labels only), running in production on macOS 26 / Apple Silicon

This is a wrapper around existing launchctl commands — it changes no start/stop
logic and can be mixed with terminal usage.
```

## 提交前检查清单

- [ ] 仓库已 push（含 11 个提交）
- [ ] 仓库 age ≥ 1 天、commit ≥ 10（CI 自动校验）
- [ ] topic `dsh-plugin` 已添加
- [ ] `package.json` 含 `dsh.bundle` ✅
- [ ] 仓库根/子包有 `cordis.patch.yml` ✅（在 packages/dsh-guardian/）
- [ ] 描述准确、无营销词、英文句尾有句号 ✅
- [ ] 分类 `tools` ✅
- [ ] （可选）GitHub Release v1.0.0 + 上传 `dist/botton-dsh-guardian-1.0.0.tgz`，启用条目里的 `tarball` 字段
- [ ] （可选）`screenshots.json`（1-8 张，GitHub 图床，路径不能出目录）
- [ ] （可选）npm 发布：去掉 `private: true`，补 `repository` 字段指向本仓库

## 已知限制

- CI 只认仓库根或 `packages/`、`plugins/`、`apps/` 子包里的 `package.json`，所以插件包放在 `packages/dsh-guardian/`
- 每个 PR 最多 3 个条目；我们只提 1 个
- 若 CI 报错，按评论修改后 push 到同一分支即可，无需重开 PR
