#!/usr/bin/env bash
# 票務工具自動化測試（v4.12.1）：new-ticket.sh 的取號與 ticket-lint.sh 的守門；
# 框架 v4.2.2 起也測 ticket-gate-hook.sh（無票不開發的閘門，含 Windows 格式的路徑）。
#
# 為什麼要有：v4.11.0 把票號改成作者前綴時，取號腳本與 lint 都只靠**手動跑幾次看輸出**
# 驗證——而同一天就實際發生「讓號時檔名改了、frontmatter 的 id 忘了改」（源專案的真實事故）與
# 「lint 的錯誤路徑第一次執行就炸」（$base：黏全形字元）兩件事。守規則的工具自己沒有測試，
# 規則遲早再破一次。
#
# 全程在暫存沙盒跑（TICKETS_DIR 覆寫），不碰真的 tickets/；壞掉的遠端讓 fetch 走離線路徑，
# 不對外連線。掛在 make ticket-lint 之後（同一個 CI job）。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

fail=0
err() { echo "[ticket-tools-test] ✗ $1" >&2; fail=1; }
ok() { echo "[ticket-tools-test] ✓ $1"; }

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

# 假 git repo：讓 new-ticket 讀不到**真 repo 的 ticket.prefix**。
# 第一版沒隔離，跑在已設定前綴的 clone 上時「未設前綴要擋」測試就假失敗了——
# 測試自己第一次執行就抓到自己不夠密封，這正是要自動化的原因。
git init -q "$SANDBOX/fakegit"
FAKE_GIT_DIR="$SANDBOX/fakegit/.git"

run_new_ticket() {  # $1=prefix（空字串＝不給，測未設定路徑） $2=title
  GIT_DIR="$FAKE_GIT_DIR" TICKETS_DIR="$SANDBOX" TICKET_PREFIX="${1}" \
  TICKET_REMOTE="__no_such_remote__" \
    bash "$ROOT/scripts/new-ticket.sh" "$2" "行政" 2>/dev/null
}

run_lint() {
  TICKETS_DIR="$SANDBOX" bash "$ROOT/scripts/ticket-lint.sh" 2>&1
}

# ── 取號 ────────────────────────────────────────────────────────────────
# 1) 未設前綴要擋下並給指引，不能默默用錯身分
if run_new_ticket "" "無前綴要擋" >/dev/null; then
  err "未設前綴竟然開票成功——會默默用錯身分"
else
  ok "未設前綴被擋下"
fi

# 2) 第一張從 01 開始
run_new_ticket "TESTA" "第一張" >/dev/null
[ -f "$SANDBOX/TESTA-01-第一張.md" ] && ok "TESTA-01 建立" || err "第一張沒有取到 TESTA-01"

# 3) 同前綴遞增
run_new_ticket "TESTA" "第二張" >/dev/null
[ -f "$SANDBOX/TESTA-02-第二張.md" ] && ok "同前綴遞增到 02" || err "同前綴沒有遞增"

# 4) 不同前綴各自獨立（這就是不會撞號的核心保證）
run_new_ticket "TESTB" "別人的第一張" >/dev/null
[ -f "$SANDBOX/TESTB-01-別人的第一張.md" ] \
  && ok "不同前綴各自從 01 起（號碼空間獨立）" \
  || err "前綴的號碼空間沒有隔離——撞號問題沒真的解掉"

# ── lint 守門 ──────────────────────────────────────────────────────────
# 5) 剛開的票要能過 lint（新舊格式相容）
if run_lint | grep -q "OK"; then ok "新格式票通過 lint"; else err "新開的票過不了 lint：$(run_lint | head -2)"; fi

# 6) frontmatter id 與檔名不一致要抓到（源專案實際發生的事故）
sed -i '' 's/^id: TESTA-02$/id: TESTA-99/' "$SANDBOX/TESTA-02-第二張.md" 2>/dev/null \
  || sed -i 's/^id: TESTA-02$/id: TESTA-99/' "$SANDBOX/TESTA-02-第二張.md"
lint_mismatch=$(run_lint)
if echo "$lint_mismatch" | grep -q "檔名須以 id"; then
  ok "id 與檔名不一致被抓到（讓號事故的守門）"
else
  err "id 與檔名不一致沒被抓到——讓號那種事故會再發生。lint 輸出：$(echo "$lint_mismatch" | head -3)"
fi
sed -i '' 's/^id: TESTA-99$/id: TESTA-02/' "$SANDBOX/TESTA-02-第二張.md" 2>/dev/null \
  || sed -i 's/^id: TESTA-99$/id: TESTA-02/' "$SANDBOX/TESTA-02-第二張.md"

# 7) id 重複要抓到，而且**錯誤路徑本身不能炸**（$base：黏全形字元那個坑）
cp "$SANDBOX/TESTA-01-第一張.md" "$SANDBOX/TESTA-01-複製撞號.md"
lint_out=$(run_lint)
if echo "$lint_out" | grep -q "id 重複"; then
  ok "id 重複被抓到"
else
  err "id 重複沒被抓到：$lint_out"
fi
if echo "$lint_out" | grep -q "unbound variable"; then
  err "lint 的錯誤路徑自己炸了（unbound variable）——回報撞號的功能在最需要時死掉"
else
  ok "錯誤路徑本身活著（bash 3.2 全形字元坑的回歸）"
fi
rm -f "$SANDBOX/TESTA-01-複製撞號.md"

# 8) 舊制 TICKET_PREFIX-XXXX（framework-config.sh 的 TK）仍然合法（新舊並存是案主拍板）
cat > "$SANDBOX/TK-0001-舊制相容.md" <<'EOF'
---
id: TK-0001
title: 舊制相容
status: 待開發
roles: [行政]
spec:
created: 2026-08-07
updated: 2026-08-07
---
EOF
if run_lint | grep -q "OK"; then ok "舊制 TK-XXXX 相容"; else err "舊制票被誤擋：$(run_lint | head -2)"; fi

# ── 無票不開發的閘門（ticket-gate-hook.sh）────────────────────────────────
# Windows 的 Claude Code 傳 C:\… 或 C:/… 格式的路徑，Repo 的根目錄卻是 Git Bash 的 /c/…：
# 原本比對不到，沒有票也改得了產品程式碼（默默放行）。在暫存的複本測：產品目錄是 frontend、backend，一開始沒有票。
# 閘門用 python3 讀 Claude Code 傳來的內容；沒有 python3 就讀不到、一律放行，這裡直接說清楚，不跑後面的測試。
if ! python3 -c 'pass' >/dev/null 2>&1; then
  err "找不到可以執行的 python3：閘門讀不到 Agent 要改哪個檔案，會默默放行。先安裝 python3（見 README「需要的工具」）"
  exit 1
fi
GATE="$SANDBOX/gate"
mkdir -p "$GATE/scripts" "$GATE/tickets"
cp "$ROOT/scripts/ticket-gate-hook.sh" "$GATE/scripts/"
{ grep -v '^PRODUCT_DIRS=' "$ROOT/scripts/framework-config.sh"; echo 'PRODUCT_DIRS=(frontend backend)'; } >"$GATE/scripts/framework-config.sh"
GATE="$(cd "$GATE" && pwd)"
# macOS、Linux 沒有 C 槽：假裝這個複本在 Windows 的 C 槽，Git Bash 看到的根目錄是 /c$GATE，
# Claude Code 傳來的是 C:$GATE（斜線）或把斜線換成反斜線的寫法
AS_WINDOWS="TICKET_GATE_TEST_ROOT=/c$GATE"
WIN_SLASH="C:$GATE"
WIN_BACKSLASH="C:$(tr / '\\' <<<"$GATE")"

gate() {  # $1=要修改的檔案路徑，之後是給閘門的環境變數；印出閘門的訊息，結束代碼和閘門相同
  local file="$1"
  shift
  # 和 Claude Code 一樣送 UTF-8 的 JSON，內容有中文。
  # 路徑從 stdin 交給 python3，不放在參數裡：Windows 的 Git Bash 交給原生程式（例如 Microsoft Store 的 Python）的參數，
  # 只要看起來像 /tmp/… 這種路徑，就會先改寫成 C:/…/Temp/… 的寫法，和閘門的根目錄（Git Bash 看到的 /tmp/…）對不上，
  # 「一般的路徑」那幾項會變成放行、測試失敗。stdin 的內容不會被改寫（Claude Code 也是從 stdin 傳給閘門）。
  printf '%s' "$file" |
    python3 -c 'import json, sys; p = sys.stdin.buffer.read().decode("utf-8"); sys.stdout.buffer.write(json.dumps({"tool_name": "Edit", "tool_input": {"file_path": p, "old_string": "送出", "new_string": "送出（處理中…）"}}, ensure_ascii=False).encode("utf-8"))' |
    env "$@" bash "$GATE/scripts/ticket-gate-hook.sh" 2>&1
}

blocked() {  # $1=說明 $2=路徑 之後是環境變數
  local what="$1" file="$2" out code
  shift 2
  out="$(gate "$file" "$@")"
  code=$?
  if [ "$code" -eq 2 ] && grep -q '^\[ticket-gate\]' <<<"$out"; then
    ok "閘門擋下：${what}"
  else
    err "閘門沒有擋下：${what}（結束代碼 ${code}）：${file}"
  fi
}

allowed() {  # $1=說明 $2=路徑 之後是環境變數
  local what="$1" file="$2" out code
  shift 2
  out="$(gate "$file" "$@")"
  code=$?
  if [ "$code" -eq 0 ]; then
    ok "閘門放行：${what}"
  else
    err "閘門不應該擋：${what}（結束代碼 ${code}）：$(head -n 1 <<<"$out")"
  fi
}

# 9) 沒有開著的票：產品程式碼一律擋下（一般的路徑、Windows 的兩種寫法、大小寫不同），docs 照常放行
blocked "產品程式碼（一般的路徑）" "$GATE/frontend/src/App.tsx"
blocked "產品程式碼（Windows 的 C:\\…）" "$WIN_BACKSLASH\\frontend\\src\\App.tsx" "$AS_WINDOWS"
blocked "產品程式碼（Windows 的 C:/…）" "$WIN_SLASH/backend/src/app.ts" "$AS_WINDOWS"
blocked "產品程式碼（Windows 的路徑，大小寫不同）" "$(tr '[:lower:]' '[:upper:]' <<<"$WIN_BACKSLASH")\\FRONTEND\\src\\App.tsx" "$AS_WINDOWS"
# Windows 的 Python 讀 pipe 預設用系統的編碼：用 cp950 讀 UTF-8 的中文會失敗，閘門以前就默默放行
blocked "產品程式碼（Python 讀 pipe 用 cp950，像 Windows）" "$GATE/frontend/src/App.tsx" PYTHONIOENCODING=cp950
allowed "docs（一般的路徑）" "$GATE/docs/SPEC.md"
allowed "docs（Windows 的路徑）" "$WIN_BACKSLASH\\docs\\SPEC.md" "$AS_WINDOWS"

# 10) 有一張開發中的票：產品程式碼放行
cat > "$GATE/tickets/TESTA-01-閘門放行.md" <<'EOF'
---
id: TESTA-01
title: 閘門放行
status: 開發中
roles: [行政]
owner: test
spec:
created: 2026-11-07
updated: 2026-11-07
---
EOF
allowed "有開發中的票時的產品程式碼（一般的路徑）" "$GATE/frontend/src/App.tsx"
allowed "有開發中的票時的產品程式碼（Windows 的路徑）" "$WIN_BACKSLASH\\frontend\\src\\App.tsx" "$AS_WINDOWS"

if [ "$fail" -eq 0 ]; then
  echo "[ticket-tools-test] 全部通過"
fi
exit "$fail"
