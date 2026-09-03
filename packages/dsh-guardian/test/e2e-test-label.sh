#!/bin/bash
# dsh-guardian 插件端到端验证（架构 §11.2）。
#
# 用测试专用 label（com.deepseek.dsh-guardian-plugin-test{,-diff}，ProgramArguments
# 为 /bin/true）驱动 GuardianService 全部分支：
#   stop(未运行)→NOT_RUNNING、start→OK、start→ALREADY_RUNNING、
#   stop→OK、stop→NOT_RUNNING、损坏 plist→START_VERIFY_FAILED（EIO5 容忍+复验兜底）
#
# ⚠️ 纪律：全程不碰生产 label（com.deepseek.dsh-guardian{,-diff}）；
#    须在非沙箱终端（真实用户 gui 域）运行——WorkBuddy 沙箱内 launchctl
#    bootstrap 全域 EIO，无法执行本脚本。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_LIB="$SCRIPT_DIR/../lib"
UID_VALUE="$(id -u)"
TEST_DIR="$(mktemp -d /tmp/dsh-guardian-e2e.XXXXXX)"
LABEL_A="com.deepseek.dsh-guardian-plugin-test"
LABEL_B="com.deepseek.dsh-guardian-plugin-test-diff"
PLIST_A="$TEST_DIR/$LABEL_A.plist"
PLIST_B="$TEST_DIR/$LABEL_B.plist"
PLIST_BROKEN="$TEST_DIR/$LABEL_A.broken.plist"

cleanup() {
  # 清理测试 label（幂等；只碰测试 label，绝不碰生产）
  launchctl bootout "gui/$UID_VALUE" "$PLIST_A" >/dev/null 2>&1 || true
  launchctl bootout "gui/$UID_VALUE" "$PLIST_B" >/dev/null 2>&1 || true
  launchctl bootout "gui/$UID_VALUE" "$PLIST_BROKEN" >/dev/null 2>&1 || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# 生成测试 plist 副本（label 为测试专用，ProgramArguments=/bin/true 立即退出，
# StartInterval 拉长避免反复触发）
make_plist() {
  local label="$1" path="$2"
  cat > "$path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/true</string>
	</array>
	<key>StartInterval</key>
	<integer>86400</integer>
	<key>RunAtLoad</key>
	<false/>
</dict>
</plist>
EOF
}
make_plist "$LABEL_A" "$PLIST_A"
make_plist "$LABEL_B" "$PLIST_B"
# 损坏 plist（非法 XML）。注意：真机实测 macOS 26 对非法 plist 的 bootstrap
# 同样返回 EIO 5（与"已加载"同码），服务层按竞态容忍后 print 复验兜底，
# 因此本场景断言 START_VERIFY_FAILED 而非 START_FAILED。
# START_FAILED（非 EIO5 非零）已由 QA 注入测试（test/qa-guardian-branches.mjs 分支 #3）覆盖。
printf '<plist><dict><key>broken</key>' > "$PLIST_BROKEN"

export DSH_GUARDIAN_JOBS="$(cat <<EOF
[
  { "label": "$LABEL_A", "plist": "$PLIST_A" },
  { "label": "$LABEL_B", "plist": "$PLIST_B" }
]
EOF
)"

echo "== e2e：测试 label ${LABEL_A} / ${LABEL_B}（uid=${UID_VALUE}）=="

node --input-type=module - "$PKG_LIB" "$PLIST_A" "$PLIST_BROKEN" <<'EOF'
// GuardianService 全分支驱动（独立 host 进程内直接调用服务层）。
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [libDir, plistA, plistBroken] = process.argv.slice(2);
const { GuardianService } = await import(pathToFileURL(`${libDir}/index.js`).href);

const service = new GuardianService();
const check = (body, action, code) => {
  assert.equal(body.action, action, `action 应为 ${action}`);
  assert.equal(body.code, code, `期望 ${code}，实际 ${body.code}（${body.message}）detail=${body.detail ?? "-"}`);
  assert.ok(typeof body.message === "string" && body.message.length > 0, "应有中文 message");
  console.log(`  ✓ ${action} → ${code}：${body.message}`);
};

// 0. 前置：双测试 label 均未加载
let status = await service.status();
assert.equal(status.overall, "stopped", `前置期望 stopped，实际 ${status.overall}`);
console.log("  ✓ status → stopped（双未加载）");

// 1. stop（未运行）→ NOT_RUNNING（不发 bootout）
check(await service.stop(), "stop", "NOT_RUNNING");

// 2. start → OK（双 bootstrap 成功，复验双 loaded）
check(await service.start(), "start", "OK");
status = await service.status();
assert.equal(status.overall, "active", `启动后期望 active，实际 ${status.overall}`);
console.log("  ✓ status → active（双 loaded）");

// 3. start（重复）→ ALREADY_RUNNING（探测命中，不发 bootstrap）
check(await service.start(), "start", "ALREADY_RUNNING");

// 4. stop → OK（双 bootout 成功，sleep 后复验双不可打印）
check(await service.stop(), "stop", "OK");

// 5. stop（重复）→ NOT_RUNNING
check(await service.stop(), "stop", "NOT_RUNNING");

// 6. 损坏 plist → START_VERIFY_FAILED（真机 EIO5 被竞态容忍，print 复验未加载兜底；
//    见上方注释：macOS 26 非法 plist 与"已加载"同返 EIO 5）
//    将 jobs 中第一个 plist 换成损坏副本，复用同一服务
service.jobs = [
  { label: service.jobs[0].label, plist: plistBroken },
  service.jobs[1],
];
check(await service.start(), "start", "START_VERIFY_FAILED");

console.log("== e2e 全部分支通过 ==");
EOF

echo "== e2e 完成，测试 label 已清理 =="
