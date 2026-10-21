#!/bin/sh
# 与母本比对 memory-kit 版本。
# 退出码：0 一致 / 1 落后于母本 / 2 本机未安装 / 3 无法核对（无网络）
#         4 本地比母本新（母本仓库自身，或副本被本地改过，或刚推送缓存未更新）
set -u

REPO_RAW=${MEM_KIT_RAW:-https://raw.githubusercontent.com/cosmorithm/Mem-kit/main/memory-kit/VERSION}
API_URL=${MEM_KIT_API:-}
case "$REPO_RAW" in
  http*) if [ -z "$API_URL" ]; then API_URL="https://api.github.com/repos/cosmorithm/Mem-kit/contents/memory-kit/VERSION"; fi ;;
esac

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_FILE="$DIR/../VERSION"
RETRIES=${MEM_KIT_RETRIES:-2}
PAUSE=${MEM_KIT_PAUSE:-5}

fetch() { curl -fsSL --max-time 8 "$@" 2>/dev/null | tr -d '[:space:]' || true; }

local_version=$(tr -d '[:space:]' < "$LOCAL_FILE" 2>/dev/null || true)
if [ -z "${local_version:-}" ]; then
  echo "本机 memory-kit：未安装（找不到 $LOCAL_FILE）"
  exit 2
fi

# 读母本版本：先用 raw；与本地不一致时用 API 复核，两边都旧就再试一轮。
read_remote() {
  raw=$(fetch "$REPO_RAW")
  if [ -z "${raw:-}" ]; then printf '%s' ''; return; fi
  if [ "$raw" = "$local_version" ] || [ -z "${API_URL:-}" ]; then printf '%s' "$raw"; return; fi
  api=$(fetch -H "Accept: application/vnd.github.raw" "$API_URL")
  if [ -n "${api:-}" ]; then printf '%s' "$api"; return; fi
  printf '%s' "$raw"
}

remote_version=$(read_remote)
if [ -z "${remote_version:-}" ]; then
  echo "本机 memory-kit：$local_version"
  echo "母本：取不到（无网络或地址不可达）"
  exit 3
fi

attempt=0
while [ "$remote_version" != "$local_version" ] && [ "$attempt" -lt "$RETRIES" ]; do
  sleep "$PAUSE"
  retried=$(read_remote)
  attempt=$((attempt + 1))
  if [ -n "${retried:-}" ] && [ "$retried" = "$local_version" ]; then
    remote_version=$retried
    break
  fi
  [ -n "${retried:-}" ] && remote_version=$retried
done

echo "本机 memory-kit：$local_version"
echo "母本：$remote_version"

if [ "$remote_version" = "$local_version" ]; then
  exit 0
fi

if awk -v a="$local_version" -v b="$remote_version" 'BEGIN{split(a,x,".");split(b,y,".");for(i=1;i<=3;i++){if((x[i]+0)>(y[i]+0))exit 0;if((x[i]+0)<(y[i]+0))exit 1}exit 1}'; then
  echo "本地比母本新。刚推送过就是 CDN 还没更新，等一分钟再看；否则确认本地是否被改过。"
  exit 4
fi

echo "落后于母本，建议更新（见 BootMemory.md §4.2）"
exit 1
