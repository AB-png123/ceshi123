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
expand_home() {
  case "$1" in
    "~") printf '%s' "$HOME" ;;
    "~/"*) printf '%s/%s' "$HOME" "${1#\~/}" ;;
    *) printf '%s' "$1" ;;
  esac
}
ENGINE="${DSH_WALLPAPER_ENGINE_DIR:-${DSH_WE_DATA_DIR:-$HOME/.dsh-wallpaper-engine}}"
ENGINE="$(expand_home "$ENGINE")"
LOG="$ENGINE/import.log"
COOL="$ENGINE/.last-run"

log_fail() {
  local code="$1"
  local message="$2"
  mkdir -p "$ENGINE" 2>/dev/null || true
  printf '\n[%s] rc=%s\n%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$code" "$message" >> "$LOG" 2>/dev/null || true
  echo "$message" >&2
  exit "$code"
}

python_ok() {
  local exe="$1" v major minor
  [ -n "$exe" ] && [ -x "$exe" ] || return 1
  # 未安装 Xcode CLT 时 /usr/bin/python3 只是会弹安装器/报许可错误的存根。
  if [ "$exe" = "/usr/bin/python3" ]; then
    command -v xcode-select >/dev/null 2>&1 || return 1
    xcode-select -p >/dev/null 2>&1 || return 1
  fi
  v="$("$exe" -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null </dev/null)" || return 1
  case "$v" in
    *.*) ;;
    *) return 1 ;;
  esac
  major="${v%%.*}"
  minor="${v#*.}"
  [ "$major" -ge 3 ] 2>/dev/null && [ "$minor" -ge 8 ] 2>/dev/null
}

PY=""
PY_ERROR=""
find_python() {
  local explicit="${DSH_HAO_IMPORT_PYTHON:-}" candidate resolved
  if [ -n "$explicit" ]; then
    case "$explicit" in
      */*) resolved="$explicit" ;;
      *) resolved="$(command -v "$explicit" 2>/dev/null || true)" ;;
    esac
    if python_ok "$resolved"; then
      PY="$resolved"
      return 0
    fi
    PY_ERROR="指定的 DSH_HAO_IMPORT_PYTHON 不可用或低于 3.8：${explicit}"
    return 1
  fi
  for candidate in \
    "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3" \
    "$HOME/.pyenv/shims/python3" \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3 \
    /opt/local/bin/python3 \
    /usr/bin/python3; do
    if python_ok "$candidate"; then
      PY="$candidate"
      return 0
    fi
  done
  candidate="$(command -v python3 2>/dev/null || true)"
  if python_ok "$candidate"; then
    PY="$candidate"
    return 0
  fi
  PY_ERROR="未找到可用的 python3（需要 3.8+；macOS 可先装 Xcode CLT 或 Homebrew python）"
  return 1
}

if ! find_python; then
  log_fail 127 "dsh-hao-import: ${PY_ERROR}（可用 DSH_HAO_IMPORT_PYTHON 指定）"
fi
if [ ! -f "$SCRIPT" ]; then
  log_fail 127 "dsh-hao-import: 缺少 ${SCRIPT}（插件包不完整，请重装）"
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
  echo "导入失败（${RC}）："
  echo "$OUT" | tail -5
  exit 1
fi
echo "$OUT"
