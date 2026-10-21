#!/bin/sh
# 与母本比对 memory-kit 版本。
# 退出码：0 一致 / 1 落后于母本 / 2 本机未安装 / 3 无法核对（无网络）
#         4 本地比母本新（母本仓库自身，或副本被本地改过）
set -u

REPO_RAW=${MEM_KIT_RAW:-https://raw.githubusercontent.com/cosmorithm/Mem-kit/main/memory-kit/VERSION}
API_URL=${MEM_KIT_API:-}
case "$REPO_RAW" in
  http*) if [ -z "$API_URL" ]; then API_URL="https://api.github.com/repos/cosmorithm/Mem-kit/contents/memory-kit/VERSION"; fi ;;
esac

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_FILE="$DIR/../VERSION"

fetch() { curl -fsSL --max-time 8 "$@" 2>/dev/null | tr -d '[:space:]' || true; }

local_version=$(tr -d '[:space:]' < "$LOCAL_FILE" 2>/dev/null || true)
if [ -z "${local_version:-}" ]; then
  echo "本机 memory-kit：未安装（找不到 $LOCAL_FILE）"
  exit 2
fi

remote_version=$(fetch "$REPO_RAW")
if [ -z "${remote_version:-}" ]; then
  echo "本机 memory-kit：$local_version"
  echo "母本：取不到（无网络或地址不可达）"
  exit 3
fi

# raw 走 CDN，刚推送后可能还是旧值；不一致时用 API 复核一次，以 API 为准
if [ "$remote_version" != "$local_version" ] && [ -n "$API_URL" ]; then
  api_version=$(fetch -H "Accept: application/vnd.github.raw" "$API_URL")
  if [ -n "${api_version:-}" ] && [ "$api_version" = "$local_version" ]; then
    echo "本机 memory-kit：$local_version"
    echo "母本：$local_version（raw 缓存仍是 $remote_version，已用 API 复核）"
    exit 0
  fi
  if [ -n "${api_version:-}" ]; then
    remote_version=$api_version
  fi
fi

echo "本机 memory-kit：$local_version"
echo "母本：$remote_version"

if [ "$local_version" = "$remote_version" ]; then
  exit 0
fi

if awk -v a="$local_version" -v b="$remote_version" 'BEGIN{split(a,x,".");split(b,y,".");for(i=1;i<=3;i++){if((x[i]+0)>(y[i]+0))exit 0;if((x[i]+0)<(y[i]+0))exit 1}exit 1}'; then
  echo "本地比母本新：如果这是母本仓库，先推送；如果这是项目里的副本，说明你本地改过工具。"
  exit 4
fi

echo "落后于母本，建议更新（见 BootMemory.md §4.2）"
exit 1
