#!/usr/bin/env bash
# 票務一致性 lint：驗證 tickets/<前綴>-*.md 的 frontmatter 與基本一致性。
# 掛在 make check（= CI），漂移直接紅燈。規則來源：tickets/README.md。
# 票號前綴在 scripts/framework-config.sh 設定。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/framework-config.sh"
TICKETS_DIR="${TICKETS_DIR:-$ROOT/tickets}"

fail=0
err() { echo "[ticket-lint] $1" >&2; fail=1; }
warn() { echo "[ticket-lint][warn] $1" >&2; }  # 提醒不擋（協作軟規則）

shopt -s nullglob
# 新舊兩種票號並存（源專案 v4.11.0）：舊制 ${TICKET_PREFIX}-XXXX 不改號，
# 新票一律作者前綴（git config ticket.prefix，例 AMY-01）。
# 用「排除 README」而不是列舉前綴——新成員加入時不必回來改這裡。
files=()
for f in "$TICKETS_DIR"/*.md; do
  [ "$(basename "$f")" = "README.md" ] && continue
  files+=("$f")
done
if [ ${#files[@]} -eq 0 ]; then
  echo "[ticket-lint] OK（尚無票）"
  exit 0
fi

for f in "${files[@]}"; do
  base=$(basename "$f")
  id=$(sed -n 's/^id: *//p' "$f" | head -1)
  status=$(sed -n 's/^status: *//p' "$f" | sed 's/ *#.*//;s/ *$//' | head -1)
  roles=$(sed -n 's/^roles: *//p' "$f" | head -1)
  title=$(sed -n 's/^title: *//p' "$f" | head -1)
  spec=$(sed -n 's/^spec: *//p' "$f" | sed 's/ *#.*$//' | head -1)

  # 舊制 ${TICKET_PREFIX}-XXXX（凍結）或作者前綴（PREFIX-NN，源專案 v4.11.0）
  [[ "$id" =~ ^(${TICKET_PREFIX}-[0-9]{4}|[A-Z][A-Z0-9]{1,7}-[0-9]{2,4})$ ]] \
    || err "${base}：id 格式錯誤（'$id'），應為 ${TICKET_PREFIX}-XXXX（舊制）或 前綴-NN（例 AMY-01）"
  [[ "$base" == "$id"-* ]] || err "${base}：檔名須以 id（$id-）開頭"
  case "$status" in
    待開發|開發中|完成|作廢) ;;
    *) err "${base}：status 不合法（'$status'），只允許 待開發/開發中/完成/作廢" ;;
  esac
  [[ "$roles" =~ ^\[.*[^[:space:]].*\]$ ]] || err "${base}：roles 未填（「誰使用」是開票鐵則）"
  [ -n "$title" ] || err "${base}：title 未填"
  if [ "$status" = "完成" ] && [ -z "$spec" ]; then
    err "${base}：完成的票必須有 spec 欄位（票完成 = SPEC 同步一起完成）"
  fi
  if [ -n "$spec" ] && [ ! -f "$ROOT/${spec%%#*}" ]; then
    err "${base}：spec 指向不存在的檔案（${spec%%#*}）"
  fi
  # 多 session 領票制（tickets/README）：開發中建議填 owner，缺了提醒不擋
  owner=$(sed -n 's/^owner: *//p' "$f" | sed 's/ *#.*//;s/ *$//' | head -1)
  if [ "$status" = "開發中" ] && [ -z "$owner" ]; then
    warn "${base}：開發中但未填 owner（多 session 協作請領票）"
  fi
done

dups=$(sed -n 's/^id: *//p' "${files[@]}" | sort | uniq -d)
# 全形括號緊接 $dups 會被 bash 當成變數名的一部分（set -u 下直接炸掉，
# 反而讓「回報撞號」自己先死——源專案 v4.2.1 在 new-ticket.sh 修過同一個坑）。
[ -n "${dups}" ] && err "id 重複：${dups}（號碼不重用；兩個 session 同前綴撞號時，第二個 session 用 TICKET_PREFIX 指定別名）"

if [ "$fail" -eq 0 ]; then
  echo "[ticket-lint] OK（${#files[@]} 張票通過）"
fi
exit "$fail"
