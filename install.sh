#!/usr/bin/env bash
# 可选工具：把导入脚本复制到 ~/.dsh/wallpaper-import/。
#
# 插件本身已自带 scripts/，装好插件即可工作，不需要运行本脚本。
# 只有当你想单独管理脚本副本（例如配合 launchd 定时调用）时才需要它；
# 副本不会被插件自动使用，需设 DSH_HAO_IMPORT_SCRIPT 指过去。
#
# 用法：
#   ./install.sh                 只复制脚本到 ~/.dsh/wallpaper-import
#   ./install.sh --with-plugin   顺便执行 dsh plugin add（需要 dsh CLI）
#   DSH_PROFILE=web ./install.sh 指定 profile（默认 desktop）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.dsh/wallpaper-import"
PROFILE="${DSH_PROFILE:-desktop}"
WITH_PLUGIN=0

for arg in "$@"; do
  case "$arg" in
    --with-plugin) WITH_PLUGIN=1 ;;
    -h|--help)
      sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数：$arg（可用 --with-plugin / --help）" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$DEST"
install -m 0755 "$ROOT/scripts/run-import.sh" "$DEST/run-import.sh"
install -m 0755 "$ROOT/scripts/import_hao.py" "$DEST/import_hao.py"
echo "✓ 脚本副本已复制到 $DEST（可选；插件默认使用包内脚本）"

if [ "$WITH_PLUGIN" -eq 1 ]; then
  if ! command -v dsh >/dev/null 2>&1; then
    echo "✗ 找不到 dsh 命令，请先安装 DSH，或手动安装插件（见 README）" >&2
    exit 1
  fi
  if [ ! -d "$HOME/.dsh/profiles/$PROFILE" ]; then
    echo "✗ 找不到 profile：$HOME/.dsh/profiles/$PROFILE（可用 DSH_PROFILE 指定）" >&2
    exit 1
  fi
  echo "→ 正在把插件加入 $PROFILE profile …"
  ( cd "$HOME/.dsh/profiles/$PROFILE" && dsh plugin --profile "$PROFILE" add "$ROOT" )
  echo "✓ 插件已加入 profile，重启 DSH 后生效"
else
  cat <<EOF

插件默认使用包内脚本，通常直接安装即可：
  dsh plugin --profile $PROFILE add github:AB-png123/ceshi123

若想使用刚复制的副本：
  DSH_HAO_IMPORT_SCRIPT=$DEST/run-import.sh

最后重启 DSH 应用。
EOF
fi
