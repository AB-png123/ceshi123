#!/bin/bash
# dsh-hao-import 的无界面入口：由 DSH 启动钩子（或手动 / launchd）调用。
#
# 幂等两层：
#   1. 15 秒冷却，避免同一次启动里被重复触发（--force 可跳过）；
#   2. import_hao.py 用 uploads/.imported.json 按「壁纸 id + 类型」去重。
#
# 环境变量：
#   DSH_HAO_IMPORT_PYTHON       指定 python3 解释器
#   DSH_WALLPAPER_ENGINE_DIR    壁纸引擎数据目录（日志也写在这里）
#
# 退出码：0 成功（包括「没有新壁纸」）；非 0 表示导入失败，详情见 import.log。
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SELF_DIR/import_hao.py"
ENGINE="${DSH_WALLPAPER_ENGINE_DIR:-$HOME/.dsh-wallpaper-engine}"
LOG="$ENGINE/import.log"
COOL="$ENGINE/.last-run"

find_python() {
  if [ -n "${DSH_HAO_IMPORT_PYTHON:-}" ] && [ -x "$DSH_HAO_IMPORT_PYTHON" ]; then
    printf '%s' "$DSH_HAO_IMPORT_PYTHON"
    return 0
  fi
  for candidate in \
    "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3" \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3 \
    /usr/bin/python3; do
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  command -v python3 2>/dev/null || true
}

PY="$(find_python)"
if [ -z "$PY" ]; then
  echo "dsh-hao-import: 未找到 python3（可用 DSH_HAO_IMPORT_PYTHON 指定）" >&2
  exit 127
fi
if [ ! -f "$SCRIPT" ]; then
  echo "dsh-hao-import: 缺少 $SCRIPT" >&2
  exit 127
fi

mkdir -p "$ENGINE"

# --force 跳过冷却；--dry-run 既不读冷却也不写冷却，方便随时预演。
FORCE=0
DRY=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --dry-run) DRY=1; ARGS+=("$arg") ;;
    *) ARGS+=("$arg") ;;
  esac
done

if [ "$FORCE" -eq 0 ] && [ "$DRY" -eq 0 ] && [ -f "$COOL" ]; then
  last="$(cat "$COOL" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  case "$last" in
    ''|*[!0-9]*) last=0 ;;
  esac
  if [ $((now - last)) -lt 15 ]; then
    exit 0
  fi
fi
[ "$DRY" -eq 0 ] && date +%s > "$COOL"

TS="$(date '+%Y-%m-%d %H:%M:%S')"
if [ "${#ARGS[@]}" -gt 0 ]; then
  OUT="$("$PY" "$SCRIPT" "${ARGS[@]}" 2>&1)"
else
  OUT="$("$PY" "$SCRIPT" 2>&1)"
fi
RC=$?
printf '\n[%s] rc=%s\n%s\n' "$TS" "$RC" "$OUT" >> "$LOG"

if [ "$RC" -ne 0 ]; then
  echo "导入失败（$RC）："
  echo "$OUT" | tail -5
  exit 1
fi
echo "$OUT"
