#!/bin/bash
# dsh-guardian 插件卸载脚本。
#
# 顺序：① 备份 profile patch → ② 移除 insert 条目（含注释块）→ ③ 删除包目录
# → ④ 打印重载提示（绝不自行 kickstart）。
#
# 为什么先删条目再删包：与部署镜像——只要条目还在而包已删，dsh 重载时
# 解析失败会导致崩溃循环；先摘条目后删包，任何时刻重载都安全。
set -euo pipefail

PROFILE_HOME="$HOME/.deepseek-harness/home/profiles/web"
PATCH_FILE="$PROFILE_HOME/cordis.patch.yml"
DEST_PKG="$PROFILE_HOME/node_modules/@botton/dsh-guardian"
STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP="$PATCH_FILE.bak-$STAMP"

[ -f "$PATCH_FILE" ] || { echo "错误：找不到 profile patch $PATCH_FILE" >&2; exit 1; }

# ① 备份 profile patch
cp -p "$PATCH_FILE" "$BACKUP"
echo "① 已备份 profile patch → $BACKUP"

# ② 移除 insert 条目（从 deploy.sh 追加的注释头到 name 行为止整块删除）
if grep -q 'web-ui-guardian' "$PATCH_FILE"; then
  TMP_FILE="$(mktemp)"
  awk '
    /# 2026-09-02 dsh-guardian 插件：守护程序面板化/ { skip = 1; next }
    skip == 1 && /@botton\/dsh-guardian/ { skip = 0; next }
    skip == 1 { next }
    { print }
  ' "$PATCH_FILE" > "$TMP_FILE"
  cat "$TMP_FILE" > "$PATCH_FILE"
  rm -f "$TMP_FILE"
  echo "② 已移除 web-ui-guardian insert 条目"
else
  echo "② patch 中无 web-ui-guardian 条目，跳过（幂等）"
fi

# ③ 删除包目录
if [ -d "$DEST_PKG" ]; then
  rm -rf "$DEST_PKG"
  echo "③ 已删除包目录 $DEST_PKG"
else
  echo "③ 包目录不存在，跳过（幂等）"
fi

# ④ 仅打印重载提示——绝不自行 kickstart
cat <<'EOF'
④ 卸载完成，将在 dsh 重载后生效。
   重载须主理人确认后手动执行：
     launchctl kickstart -k gui/$(id -u)/com.deepseek.dsh
EOF
