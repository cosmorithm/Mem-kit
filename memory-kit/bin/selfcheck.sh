#!/bin/sh
# 与母本比对 memory-kit 版本。
# 退出码：0 一致 / 1 落后于母本 / 2 本机未安装 / 3 无法核对（无网络）
#         4 本地比母本新（通常是母本仓库自己，或还没推送）
set -u

REPO_RAW=${MEM_KIT_RAW:-https://raw.githubusercontent.com/cosmorithm/Mem-kit/main/memory-kit/VERSION}
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_FILE="$DIR/../VERSION"

local_version=$(tr -d '[:space:]' < "$LOCAL_FILE" 2>/dev/null || true)
if [ -z "${local_version:-}" ]; then
  echo "本机 memory-kit：未安装（找不到 $LOCAL_FILE）"
  exit 2
fi

remote_version=$(curl -fsSL --max-time 8 "$REPO_RAW" 2>/dev/null | tr -d '[:space:]' || true)
if [ -z "${remote_version:-}" ]; then
  echo "本机 memory-kit：$local_version"
  echo "母本：取不到（无网络或地址不可达）"
  exit 3
fi

echo "本机 memory-kit：$local_version"
echo "母本：$remote_version"

if [ "$local_version" = "$remote_version" ]; then
  exit 0
fi

# 逐段比较主版本号，判断是落后还是领先
if awk -v a="$local_version" -v b="$remote_version" 'BEGIN{split(a,x,".");split(b,y,".");for(i=1;i<=3;i++){if((x[i]+0)>(y[i]+0))exit 0;if((x[i]+0)<(y[i]+0))exit 1}exit 1}'; then
  echo "本地比母本新：如果这是母本仓库，先推送；如果这是项目里的副本，说明你本地改过工具。"
  exit 4
fi

echo "落后于母本，建议更新（见 BootMemory.md §4.2）"
exit 1
