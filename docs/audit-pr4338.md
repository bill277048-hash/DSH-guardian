# PR #4338 资料复核 — 2026-09-04

PR: https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4338
作者立场：拟合并方视角，逐项核实提交资料的**完整性与逻辑清晰度**。
外部参照：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md

复核分三块：A. 条目文件本体；B. PR 标题/正文声明与代码的对应；C. 截图/资产。

---

## A. 条目文件本体

文件：`data/plugins/bill277048-hash__DSH-guardian--packages-dsh-guardian.yml`（远端 head `52076b3ab`）

| 项 | 实测值 | contributing.md 要求 | 结论 |
|---|---|---|---|
| 字段集 | `url / name / category / description.en / description.zh / tarball` | 必填 url/name/category/description.en，其余可选 | ✅ 多余字段全为可选，tarball 推荐 |
| url | `https://github.com/bill277048-hash/DSH-guardian/tree/main/packages/dsh-guardian` | 必指向含 `dsh.bundle` 的 package.json 所在子包 | ✅ |
| name | `bill277048-hash/DSH-guardian#dsh-guardian` | monorepo 子包必须用 `owner/repo#subname` | ✅ |
| category | `tools` | 必须在 `agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun` 内 | ✅ |
| en 描述以 `.` 结尾 | `"...explicit failure states."` | "One-line description ending with a period" | ✅ |
| zh 描述以句号结尾 | `"...明确的失败提示。"` | "以句号结尾" | ✅ |
| 描述含 `: ` 已加引号 | 两行均用 `'...'` 包住 | 必须加引号，否则 YAML 解析失败 | ✅ |
| 文件名 slug | `slugFor(url)` 推导 = `bill277048-hash__DSH-guardian--packages-dsh-guardian.yml` | "filename becomes `owner__repo--packages-my-plugin.yml`" | ✅ 字节级一致 |
| tarball 形态 | `https://github.com/.../releases/download/v1.0.0/botton-dsh-guardian-1.0.0.tgz` | 必须 GitHub Release 托管 https `.tgz`；钉 tag（防 `latest/download` 静默腐烂） | ✅ 钉 v1.0.0 |
| tarball 实际可下 | 200，已下解开包验证含 15 文件（lib/* client.js cordis.patch.yml README*.md CHANGELOG.md LICENSE screenshots.json assets/*.png） | "list won't hand users a download link it can't vouch for" | ✅ |

---

## B. PR 标题与正文声明逐项核

PR title：`Add bill277048-hash/DSH-guardian (tools)`
PR body（7 项声明）：

| # | 声明 | 证据 | 结论 |
|---|---|---|---|
| B1 | "Host routes: `GET /api/guardian/status`, `POST /api/guardian/start|stop`" | `lib/routes.js` 三条 `kind: "exact"` 路由，分别对应这三条路径 | ✅ |
| B2 | "12-branch error taxonomy with Chinese feedback" | CHANGELOG 写「12 分支错误分类法全中文反馈」；`lib/index.js` MESSAGES 表 12 条（OK/ALREADY_RUNNING/START_FAILED/START_VERIFY_FAILED/NOT_RUNNING/STOP_FAILED/STOP_VERIFY_FAILED/PARTIAL/BUSY/INTERNAL/403/loopback-guard） | ✅ 与 CHANGELOG 一致 |
| B3 | "(already running, start failed, verify failed, 409 busy, 403 loopback guard, ...)" | MESSAGES 表逐条对应 ALREADY_RUNNING / START_FAILED / START_VERIFY_FAILED；routes.js `httpStatusFor` 把 BUSY → 409、guard 失败 → 403 | ✅ |
| B4 | "Zero third-party runtime deps, zero build step" | `packages/dsh-guardian/package.json` 无 `dependencies`/`devDependencies`；`scripts/check-submission.mjs` 在用户级反复确认；files 数组不依赖任何打包步骤 | ✅ |
| B5 | "declares dsh.bundle" | `package.json` 含 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" }, ... }`；同目录有 `cordis.patch.yml` | ✅ 这是入口条件，门禁已二次确认 |
| B6 | "Verified: 28 unit tests, 37-assertion branch injection suite, 8/8 real launchd e2e (test labels only)" | `guardian-state.test.mjs` 9 个 test、`launchctl.parse.test.mjs` 19 个 test（9+19=28 ✅）；`qa-guardian-branches.mjs` 共 37 个 `check(...)` 调用（断言行）；`e2e-test-label.sh` 8 个 check 调用（status、stop、start、start、stop、stop、损坏 plist start + overall），全程测试专用 label | ✅ 三个数字都对得上 |
| B7 | "running in production on macOS 26 / Apple Silicon" | 仓库当前主机：`darwin / MacBook Air M1 / macOS ~26.5`（来自 memory 上下文）；CHANGELOG 写「真机认知：macOS 26 对非法 plist 的 bootstrap 与『已加载』同返 EIO 5」 | ✅ 真实生产部署 |
| B8 | "wrapper around existing launchctl commands — it changes no start/stop logic" | `lib/launchctl.js` 仅封装 `bootstrap/bootout/print`；`lib/index.js` 顶部注释「只调 launchctl bootstrap/bootout/print，绝不执行 dsh-guardian.sh，绝不写 ~/.deepseek-harness/guardian/（只读）」 | ✅ |
| B9 | "can be mixed with terminal usage" | 操作语义与终端 `launchctl` 完全等价（按 print 探测 → 最小动作 → print 复验）；EIO5 竞态容忍设计即是为「混合用」准备的 | ✅ |

逻辑闭环：B1–B9 全部由代码静态可验；无任何无证据的"营销词"。

---

## C. 截图与资产

| 项 | 实测 | 规则 | 结论 |
|---|---|---|---|
| 数量 | 3 张 | 1–8 | ✅ |
| 真实图片 | 3 张均为合法 PNG（magic 89504e47）+ 341/249/250 KB | 不能是占位图 | ✅ |
| `screenshots.json` 位置 | `packages/dsh-guardian/screenshots.json`（与子包 `package.json` 同目录） | monorepo 条目放在子目录里 | ✅ |
| 路径相对性 | `assets/screenshot-1.png` 等 | 不能跳出目录，不能以 `/` 开头，不能含 `..` | ✅ |
| raw 链接可达 | 3 张 + screenshots.json 全部 200 | 探测 404/410 会被 `probe-screenshots` 静默丢弃 | ✅ |

---

## D. 一致性与潜在的"打回点"

按 contributing.md 第 4–8 条评审标准预审：

| 评审项 | 自检结论 |
|---|---|
| 代码是否与条目声明一致（含数字、API 名） | 9/9 项 B1–B9 全对 |
| 分类合理 | `tools` 是当前最贴切的（用户偏好选了它；维护者若想改成 `dev`/`workflow` 也会直接改，不会打回） |
| 真实可用代码 vs 占位/空壳 | lib 4 个文件 + client.js + cordis.patch.yml，27 例单元 + 37 分支注入 + 8/8 e2e |
| 与已有条目重复 | 已有 `baosfeng__my-dsh-plugins--plugins-dsh-guardian.yml`、`cdxiaodong__dsh-guardian.yml`、`lonelymoon87__dsh-guardian.yml`，但本条目是**自己写的独立插件**（license MIT + 自有架构），非 fork/复制；不重复 |
| 源码无 alarm | lib 注释清晰、命名直白、无混淆、无凭据外传、无 install-time 行为 |
| PR 只动自己的条目 | diff 只新增 `data/plugins/bill277048-hash__DSH-guardian--packages-dsh-guardian.yml`（README*.md 是上游自动生成，不在我分支的 commit 里；fork main 上的 README*.md 落后上游，不影响 PR 范围） |
| 非纯聚合包 | 不依赖别人插件，无 package.json dependencies | ✅ |
| 依赖指向上游 | 无 npm 包；publish 计划在 PR 反馈后再做（private: true 保留，publish 时再切） | ✅ 现阶段合规 |

---

## E. 唯一可改进项（非阻断）

1. **EN 描述里 "12-branch" 没在条目的 en 描述里** —— 这本来是 PR body 里的细节，不是条目描述。条目描述只说"explicit failure states"，留有余地，避免长 markdown 渲染问题。维持现状。

2. **README 在子包内、不在仓库根** —— contributing.md 没要求根 README，但有些 monorepo 列表扫描器会顺藤摸根；本仓库根 `README.md` 已写「插件包在 `packages/dsh-guardian/`」，明确指向子包，避免维护者误解。

3. **Stale-fork 风险** —— 上游 main 自 PR 后又新增 20 commit（截至本审 `46d7cd28`），PR diff 仍 `MERGEABLE / CLEAN`；若长期未合并，下次门禁重跑可能再判 stale。无需主动处理：维护者一合并就消解；万一被打回，再 rebase 一次即可（本次首轮已实战过一遍）。

---

## F. 总结

| 维度 | 结论 |
|---|---|
| 资料完整 | ✅ 6 字段、双语、tarball、screenshots 全部齐全 |
| 逻辑清晰 | ✅ 9 项声明逐项对代码，无夸大、无矛盾 |
| 合规 | ✅ 全部硬约束（manifest、年龄、topic、分类、命名、slug、tarball 形态）已满足 |
| 风险 | 极低；唯一隐性风险是上游 Stale-fork guard，时间解决 |
| 你需要做的 | 无 |

PR 提交至今已 10 小时，无 review、无评论（不在预期内：注册表维护者按提交节奏 review，不是 SLA）。下次门禁重跑若被打回，按评论改并 push 到 `add-dsh-guardian` 同一分支即可，无需重开。