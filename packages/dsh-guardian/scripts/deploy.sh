#!/bin/bash
# dsh-guardian 插件部署脚本（顺序安全，见 docs/architecture.md §9 部署纪律）。
#
# 顺序（不可调换）：
#   ① 备份 profile patch（cordis.patch.yml.bak-<yyyymmddhhmmss>）
#   ② 拷贝包到 profile node_modules/@botton/dsh-guardian/
#   ③ 幂等追加 insert 条目（grep -q 'web-ui-guardian' 存在则跳过）
#   ④ 仅打印重载提示——绝不执行 kickstart
#
# 为什么必须先拷包再追加条目：dsh 重载时 loader 遇 insert 行立即从
# node_modules 解析包；若条目先落位而包缺失，插件解析失败 → cordis 拒绝
# → 进程退出 → launchd 崩溃循环。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_PKG="$(cd "$SCRIPT_DIR/.." && pwd)"
PROFILE_HOME="$HOME/.deepseek-harness/home/profiles/web"
PATCH_FILE="$PROFILE_HOME/cordis.patch.yml"
DEST_PKG="$PROFILE_HOME/node_modules/@botton/dsh-guardian"
STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP="$PATCH_FILE.bak-$STAMP"

# 0. 前置检查
[ -d "$SRC_PKG" ] || { echo "错误：找不到包目录 $SRC_PKG" >&2; exit 1; }
[ -f "$PATCH_FILE" ] || { echo "错误：找不到 profile patch $PATCH_FILE" >&2; exit 1; }

# ① 备份 profile patch（无论后续是否改动，先留可回滚副本）
cp -p "$PATCH_FILE" "$BACKUP"
echo "① 已备份 profile patch → $BACKUP"

# ② 拷贝包到 profile node_modules（必须先于条目落位）
mkdir -p "$(dirname "$DEST_PKG")"
rm -rf "$DEST_PKG"
cp -R "$SRC_PKG" "$DEST_PKG"
echo "② 已安装包 → $DEST_PKG"

# ③ 幂等追加 insert 条目
if grep -q 'web-ui-guardian' "$PATCH_FILE"; then
  echo "③ patch 已含 web-ui-guardian 条目，跳过追加（幂等）"
else
  cat >> "$PATCH_FILE" <<'YAML'
# 2026-09-02 dsh-guardian 插件：守护程序面板化（启动/停止/状态，仅为既有
# launchctl 启停逻辑的封装）。卸载：删除本条目 + node_modules/@botton/dsh-guardian 后重载 dsh。
- insert:
    - id: web-ui-guardian
      name: '@botton/dsh-guardian'
YAML
  echo "③ 已追加 insert 条目 → $PATCH_FILE"
fi

# ④ 仅打印重载提示——绝不自行 kickstart dsh（须先告知主理人并获确认）
cat <<'EOF'
④ 部署完成，插件将在 dsh 重载后生效。
   重载须主理人确认后手动执行：
     launchctl kickstart -k gui/$(id -u)/com.deepseek.dsh
   重载后验证：
     pgrep -fl dsh   # 确认 dsh 进程存活、未崩溃重启
     curl --noproxy '*' -s http://127.0.0.1:<webPort>/api/guardian/status
EOF
