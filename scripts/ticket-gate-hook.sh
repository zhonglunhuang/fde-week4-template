#!/usr/bin/env bash
# PreToolUse hook：「無票不開發」的機制化閘門。
# 當 agent 要 Edit/Write 產品程式碼（PRODUCT_DIRS，見 scripts/framework-config.sh）時，
# 檢查 tickets/ 是否存在「待開發 / 開發中」的功能票；沒有就擋下（exit 2）。
# 由 .claude/settings.json 的 hooks.PreToolUse 呼叫。
# 邊界（誠實聲明）：只能檢查「有沒有可開發的票」，無法判斷本次修改屬於哪張票。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/framework-config.sh"

# 尚未設定產品目錄（初始化前）→ 閘門不擋
[ ${#PRODUCT_DIRS[@]} -eq 0 ] && exit 0

# 取出要修改的檔案路徑，印成「格式＋路徑」：W＝原本是 Windows 的寫法，P＝其他。
# - Windows 的 Claude Code 傳 C:\… 或 C:/… 格式的路徑，ROOT 卻是 Git Bash 的 /c/…：
#   開頭是磁碟機代號的路徑，反斜線換成斜線、C:/ 換成 /c/，才比對得到。
# - Claude Code 傳來的內容是 UTF-8；Windows 的 Python 讀 pipe 預設用系統的編碼（例如 cp950），
#   內容有中文就讀不出來、閘門默默放行。所以一律當成 UTF-8 讀，也用 UTF-8 印。
INPUT=$(python3 -c '
import json, re, sys
try:
    d = json.load(sys.stdin.buffer)
except Exception:
    sys.exit(0)
ti = d.get("tool_input") or {}
p = ti.get("file_path") or ti.get("notebook_path") or ""
m = re.match(r"([A-Za-z]):[\\/]", p)
if m:
    p = "W/" + m.group(1).lower() + "/" + p[3:].replace("\\", "/")
elif p:
    p = "P" + p
sys.stdout.buffer.write(p.encode("utf-8"))
' 2>/dev/null || true)

# 拿不到路徑（非檔案類工具）→ 放行
[ -z "$INPUT" ] && exit 0
FILE_PATH="${INPUT#?}"
# Windows 的路徑不分大小寫（C:\Users\Amy 和 c:\users\amy 是同一個資料夾），比對時也不分；其他路徑照舊
[ "${INPUT:0:1}" = W ] && shopt -s nocasematch

# 只閘產品程式碼目錄；框架檔、docs、tickets、cache、scripts 一律放行。
# TICKET_GATE_TEST_ROOT 只給 scripts/ticket-tools-test.sh 用：在 macOS、Linux 上假裝 Repo 在 Windows 的 /c/…
MATCH_ROOT="${TICKET_GATE_TEST_ROOT:-$ROOT}"
hit=0
for d in "${PRODUCT_DIRS[@]}"; do
  case "$FILE_PATH" in
    "$MATCH_ROOT/$d"/*) hit=1; break ;;
  esac
done
shopt -u nocasematch
[ "$hit" -eq 0 ] && exit 0

# 紅燈救火豁免：使用者明確同意後 touch cache/hotfix-override（不進 git），
# 修完必須刪除該檔並補票（規則見 AGENTS.md「Ticket 工作流」）。
[ -f "$ROOT/cache/hotfix-override" ] && exit 0

# 有任何「待開發 / 開發中」的票 → 放行
if grep -lE '^status: *(待開發|開發中)' "$ROOT"/tickets/*-*.md >/dev/null 2>&1; then
  exit 0
fi

cat >&2 <<EOF
[ticket-gate] 無票不開發：tickets/ 目前沒有任何「待開發 / 開發中」的功能票，
產品程式碼（${PRODUCT_DIRS[*]}）的修改已被擋下。
- 新功能 / 行為修改 → 先走 /pm 確認角色與目的、開票，再從 /dev 依票開發。
- 紅燈救火（不改行為）→ 經使用者明確同意後執行
  \`mkdir -p cache && touch cache/hotfix-override\` 暫時放行；修完刪除該檔，行為有變要補票。
EOF
exit 2
