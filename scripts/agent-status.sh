#!/usr/bin/env bash
# Agent 入口簡報用的一次性狀態快照（設計目標 <1 秒）。
# 供 team-leader / pm / dev / framework 入口共用：一個指令拿到簡報所需的全部資訊。
# 專案差異（專案名、票號前綴、健康檢查 URL）在 scripts/framework-config.sh，不改本檔。
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/framework-config.sh

if [ -f .template-uninitialized ]; then
  echo "⚠️ 模板尚未初始化：請走 setup 入口（.agents/skills/setup/SKILL.md）完成專案設定"
fi

echo "== framework =="
fw_ver=$(grep -m1 -oE '框架版本：v[0-9]+\.[0-9]+\.[0-9]+' docs/FRAMEWORK.md 2>/dev/null | sed 's/框架版本：//')
echo "  ${PROJECT_NAME}｜框架 ${fw_ver:-未知}（規則與決策紀錄見 docs/FRAMEWORK.md）"

echo "== git =="
echo "branch: $(git branch --show-current 2>/dev/null || echo '?')"
echo "last:   $(git log --oneline -1 2>/dev/null || echo '?')"
dirty_n=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "dirty:  $dirty_n 個未提交檔案"
if [ "$dirty_n" -gt 0 ]; then
  git status --porcelain 2>/dev/null | head -5 | sed 's/^/  /'
  [ "$dirty_n" -gt 5 ] && echo "  … 還有 $((dirty_n - 5)) 個"
fi

echo "== tickets =="
if ls tickets/*-*.md >/dev/null 2>&1; then
  # 統計四態
  for s in 待開發 開發中 完成 作廢; do
    n=$(grep -l "^status: $s" tickets/*-*.md 2>/dev/null | wc -l | tr -d ' ')
    echo "  $s: $n"
  done
  # 工作佇列才詳列（待開發 / 開發中）；完成 / 作廢只給數字，避免歷史淹沒簡報
  for f in tickets/*-*.md; do
    st=$(grep -m1 "^status:" "$f" | sed 's/status: *//')
    case "$st" in
      待開發|開發中)
        id=$(grep -m1 "^id:" "$f" | sed 's/id: *//')
        ti=$(grep -m1 "^title:" "$f" | sed 's/title: *//')
        ow=$(grep -m1 "^owner:" "$f" | sed 's/owner: *//;s/ *#.*//;s/ *$//')
        echo "  → $id [$st]${ow:+[$ow]} $ti" ;;
    esac
  done
else
  echo "  (尚無票)"
fi

echo "== spec =="
# 只掃「## 2. 功能狀態總覽」到下一個「## 」之間的表格列，避開圖例表與變更歷史的符號
awk '
  /^## 2\. 功能狀態總覽/ {inseg=1; next}
  inseg && /^## / {inseg=0}
  inseg {print}
' docs/SPEC.md 2>/dev/null \
  | grep -o "✅ 已完成\|🚧 進行中\|⏳ 未開始" | sort | uniq -c | sed 's/^/  /'
# ⏳ 未開始項目的標題（總覽表首欄），讓簡報零額外讀檔就能點出待啟動的事
awk -F'|' '
  /^## 2\. 功能狀態總覽/ {inseg=1; next}
  inseg && /^## / {inseg=0}
  inseg && /⏳ 未開始/ {gsub(/^ *| *$/,"",$2); print "  ⏳ " $2}
' docs/SPEC.md 2>/dev/null
# 最近一筆變更歷史（changelog 第一列資料 = 最新）
latest=$(awk -F'|' '
  /^## 5\. 變更歷史/ {inseg=1; next}
  inseg && /^\| *[0-9]{4}-/ {gsub(/^ *| *$/,"",$2); gsub(/^ *| *$/,"",$3); print $2 "：" $3; exit}
' docs/SPEC.md 2>/dev/null)
[ -n "$latest" ] && echo "  最近變更 $latest"

echo "== lint =="
./scripts/ticket-lint.sh 2>&1 | sed 's/^\[ticket-lint\] /  /'

echo "== 閘門 =="
if [ -f cache/hotfix-override ]; then
  echo "  ⚠️ cache/hotfix-override 存在：無票不開發閘門目前被放行！救火完成請刪除此檔並補票"
else
  echo "  票務閘門正常（無 hotfix-override）"
fi

echo "== health =="
if [ -n "$HEALTH_URL" ]; then
  curl -m 2 -fsS "$HEALTH_URL" 2>/dev/null || echo "  dev 環境未啟動或未就緒"
else
  echo "  （未設定健康檢查；要啟用請在 scripts/framework-config.sh 填 HEALTH_URL）"
fi
