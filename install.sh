#!/bin/sh
# Mem-kit 安装脚本：把 BootMemory.md 与 memory-kit 复制到目标项目。
# 用法: ./install.sh [目标目录] [--force]
set -eu

FORCE=0
TARGET="."
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) echo "用法: $0 [目标目录] [--force]"; exit 0 ;;
    *) TARGET="$arg" ;;
  esac
done

SRC=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ -d "$TARGET" ] || { echo "目标目录不存在: $TARGET" >&2; exit 1; }

copy() {
  src=$1
  dst=$2
  if [ -e "$dst" ] && [ "$FORCE" -ne 1 ]; then
    echo "跳过（已存在，加 --force 覆盖）: $dst"
    return 0
  fi
  cp -R "$src" "$dst"
  echo "已写入: $dst"
}

copy "$SRC/BootMemory.md" "$TARGET/BootMemory.md"
copy "$SRC/memory-kit" "$TARGET/memory-kit"

printf '\n安装完成。下一步：\n'
printf '  1. 对 AI 说：请阅读 BootMemory.md\n'
printf '  2. 或按 BootMemory.md 第 5 节手工建记忆\n'
