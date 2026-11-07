#!/usr/bin/env bash
# 開票助手：取「作者前綴 + 流水號」（例：AMY-01），照 tickets/README.md 模板建檔。
#
# 為什麼是作者前綴（v4.11.0，取代全域流水號 TICKET_PREFIX-XXXX）：
# 全域流水號的撞號是**取號與推送之間的競爭條件**——兩個人在對方 push 之前取號，
# fetch 再勤也看不到彼此（源專案四度因此撞號）。
# 作者前綴給每個人**獨立的號碼空間**，不需要與任何人協調，結構上不會撞。
# 既有的舊制票**不改號**，新舊並存（案主拍板）。
#
# 前綴規則（案主拍板）：
#   ・前綴 = git 帳號的固定映射（見下方 case），**不是「誰想到需求」**——
#     案主叫 agent 開票，commit 掛誰名下就用誰的前綴，規則明確不用判斷。
#   ・同一人平行開兩個 session 都在開票時，第二個 session 用 TICKET_PREFIX 環境變數
#     指定別名（例：AMY2），否則 namespace 塌回去照樣撞。
#
# 用法：scripts/new-ticket.sh "短題（kebab 或中文）" ["角色，如 行政 或 客戶,業務"]
#   也可： make new-ticket t="匯出對帳單" r="行政"
#   前綴覆寫：TICKET_PREFIX=AMY2 scripts/new-ticket.sh "..."
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TICKETS_DIR="${TICKETS_DIR:-$ROOT/tickets}"  # 測試用沙盒入口（ticket-tools-test.sh）
REMOTE="${TICKET_REMOTE:-origin}"
BASE_BRANCH="${TICKET_BASE_BRANCH:-stage}"

title="${1:-}"
roles="${2:-}"

# 0) 決定作者前綴：TICKET_PREFIX 環境變數 > git config ticket.prefix（每個 clone 設一次）。
#
# **不用 git user.name 判**：實測這台機器根本沒設 user.name，commit 作者是
# 系統帳號 fallback（<使用者>@<機器名>.local）——拿一個本來就
# 沒人維護的欄位當身分依據，判出來的前綴是假的。改成顯式設定，一次就好：
#
#   git config ticket.prefix AMY    # 存在這個 clone 的 .git/config，不會 commit
#
prefix="${TICKET_PREFIX:-}"
if [ -z "$prefix" ]; then
  prefix="$(git -C "$ROOT" config ticket.prefix 2>/dev/null || echo "")"
fi
if [ -z "$prefix" ]; then
  echo "[new-ticket] 尚未設定票號前綴。每個 clone 設一次即可：" >&2
  echo "    git config ticket.prefix AMY   ← 換成你的（2~8 個大寫字母，字母開頭）" >&2
  echo "  臨時覆寫（同一人第二個平行 session 用）：TICKET_PREFIX=AMY2 make new-ticket …" >&2
  exit 2
fi
if ! [[ "$prefix" =~ ^[A-Z][A-Z0-9]{1,7}$ ]]; then
  echo "[new-ticket] 前綴格式錯誤（'$prefix'）：2~8 個大寫字母/數字、字母開頭" >&2
  exit 2
fi
if [ -z "$title" ]; then
  echo "用法：scripts/new-ticket.sh \"短題\" [\"角色\"]" >&2
  echo "  例：scripts/new-ticket.sh \"匯出對帳單\" \"行政\"" >&2
  exit 2
fi

# 1) 先 fetch 遠端——取號的重點：讓本地看到別人剛開的票號
#
# **掃全部遠端分支，不只 stage**（v4.8.0）：只掃 stage 會看不到「已經開好、
# 但還在別人 feature 分支上」的票，那正是源專案其中一次撞號的成因
# ——對方的票躺在未合併的分支上，取號時完全看不見。
if git -C "$ROOT" fetch --all --prune >/dev/null 2>&1; then
  branches=$(git -C "$ROOT" for-each-ref --format='%(refname)' refs/remotes/ 2>/dev/null | grep -v '/HEAD$')
  echo "[new-ticket] 已 fetch 全部遠端（取號納入 $(printf '%s\n' "$branches" | grep -c . || echo 0) 條遠端分支上的票）"
  remote_nums=$(
    for ref in $branches; do
      git -C "$ROOT" ls-tree -r --name-only "$ref" -- tickets/ 2>/dev/null
    done | grep -oE "${prefix}-[0-9]+"
  )
else
  echo "[new-ticket][warn] fetch 失敗（離線或無此遠端）——改用本地最大號，撞號風險較高；push 前務必先 pull --rebase" >&2
  remote_nums=""
fi

# 2) 本地 + 遠端合併，取**這個前綴自己的**最大號 +1（10# 強制十進位，防前導零變八進位）。
# 只在自己的 namespace 裡取號——這正是不會撞的原因。
local_nums=$(ls "$TICKETS_DIR/${prefix}"-*.md 2>/dev/null | grep -oE "${prefix}-[0-9]+")
max=$(printf '%s\n%s\n' "$local_nums" "$remote_nums" | grep -oE '[0-9]+$' | sort -n | tail -1)
max=${max:-00}
next=$(printf '%s-%02d' "$prefix" "$((10#$max + 1))")

# 3) 短題正規化到檔名（空白、斜線→ -）
slug=$(printf '%s' "$title" | tr ' /' '--')
file="$TICKETS_DIR/$next-$slug.md"
today=$(date +%Y-%m-%d)
if [ -n "$roles" ]; then roles_field="[$roles]"; else roles_field="[]"; fi

if [ -e "$file" ]; then
  echo "[new-ticket] 檔案已存在，未覆寫：$file" >&2
  exit 1
fi

cat > "$file" <<EOF
---
id: $next
title: $title
status: 待開發        # 待開發 | 開發中 | 完成 | 作廢
roles: $roles_field
owner:
spec: docs/SPEC.md#48-庫存管理
created: $today
updated: $today
---

<!-- roles 誰使用：客戶 / 業務 / 行政（可多個，未填 ticket-lint 會擋）；owner 動工時填；spec 換成實際章節錨點 -->

## 目的（要解決什麼問題）

一句話說明為什麼要做。

## 使用角色與情境

- 誰、在什麼場景、用什麼裝置操作。

## 需求細節

- 與案主確認過的具體行為（含欄位、流程、規則）。

## 驗收標準

- [ ] 可驗證的條件一
- [ ] 可驗證的條件二

## 邊界（明確不做什麼）

- 這張票不包含的範圍，避免無限延伸。

## 開發備註（/dev 填寫）

- 實作決策、風險、對應 commit / PR。
EOF

echo "[new-ticket] 已建立 $next → $file"
echo "[new-ticket] 記得補：roles（誰用）、目的、驗收；動工時標「開發中」+ 填 owner。"
