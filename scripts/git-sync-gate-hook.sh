#!/usr/bin/env bash
# PreToolUse hook：「推分支前先同步遠端」的機制化閘門。
# 當 agent 要跑 `git push` 時，先 fetch 對應遠端分支；若本地落後遠端（會產生衝突或
# 覆蓋他人 commit）就擋下（exit 2），要求先 `git pull --rebase` 整合再推。
# 由工作區層 .claude/settings.json 的 hooks.PreToolUse（matcher: Bash）呼叫。
# 邊界（誠實聲明）：只擋「落後遠端」的 push；不自動 rebase（避免在 hook 內卡在
# rebase 中途），解衝突交給 agent/使用者明確執行。fetch 失敗時放行（不因網路波動擋工作）。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

CMD=$(python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
print((d.get("tool_input") or {}).get("command") or "")
' 2>/dev/null || true)

# 非 git push 指令 → 放行（用詞界避免誤判 echo "git push" 之類，但寧鬆不誤擋）
printf '%s' "$CMD" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+push([[:space:]]|$)' || exit 0

cd "$ROOT" || exit 0

# 目前分支的上游；沒有上游（全新分支首推）→ 無可衝突，放行
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) || exit 0
REMOTE=${UPSTREAM%%/*}
BRANCH=${UPSTREAM#*/}

# 先抓最新遠端狀態（3 秒逾時；抓不到就放行，不因網路波動擋工作）
git fetch "$REMOTE" "$BRANCH" >/dev/null 2>&1 || exit 0

BEHIND=$(git rev-list --count "HEAD..$UPSTREAM" 2>/dev/null || echo 0)
[ "${BEHIND:-0}" -eq 0 ] && exit 0

cat >&2 <<EOF
[git-sync-gate] 本地落後遠端：$UPSTREAM 有 $BEHIND 個你還沒有的 commit，
直接 push 會衝突或無法推。請先整合再推（避免衝突）：

  git pull --rebase $REMOTE $BRANCH
  # 若有衝突：解完 → git add <檔> → git rebase --continue → 重跑檢查 → 再 push

（此閘門只擋下、不自動 rebase；解衝突請當場處理。規則見 AGENTS.md「分支與出貨流程」。）
EOF
exit 2
