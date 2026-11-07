#!/usr/bin/env bash
# SessionStart hook：每個新 session 由 harness 強制執行。
# 兩種模式：
# 1. 模板尚未初始化（存在 .template-uninitialized）→ 注入「首次使用引導」規則，
#    帶新使用者走 setup 入口完成專案設定。
# 2. 已初始化 → 注入「開場規則 + 專案即時狀態」，確保第一個回應一定是
#    team-leader 簡報 + 入口選項。
# 由 .claude/settings.json 的 hooks.SessionStart 呼叫。
set -uo pipefail
cd "$(dirname "$0")/.."

if [ -f .template-uninitialized ]; then
  cat <<'EOF'
=== 首次使用引導（強制，無例外） ===
這是尚未初始化的「Agent 協作開發框架模板」。本 session 的第一個回應，
不論使用者打了什麼，一律：
1. 歡迎使用者，用 5 行內白話介紹這個框架是什麼：
   角色入口（pm / dev / framework）＋ 功能票驅動開發（無票不開發，hook 強制）
   ＋ SPEC 單一事實來源 ＋ 每次變更留痕。
2. 用 AskUserQuestion 問「要現在開始初始化嗎？」（開始初始化 / 先了解框架再說）。
3. 選「開始初始化」→ 讀 .agents/skills/setup/SKILL.md，照精靈流程逐步引導；
   選「先了解」→ 白話導覽 README.md 與 docs/FRAMEWORK.md 的重點，隨時可回到初始化。
初始化完成前不進行任何產品開發；不要跳過引導直接執行使用者的其他任務
（可先記下任務，初始化完成後再處理）。
EOF
  exit 0
fi

cat <<'EOF'
=== Session 開場規則（強制，無例外） ===
本 session 的第一個回應，不論使用者打了什麼（打招呼、提問、甚至明確指定任務），一律：
1. 以 team-leader 身分產出「專案現況簡報」（直接用下方即時狀態，不要重跑 agent-status.sh）。
2. 用 AskUserQuestion 詢問要進哪個入口（pm / dev / framework）。
3. 使用者選定後，讀 .agents/skills/<入口>/SKILL.md 以該角色繼續；
   若第一句話已指定任務，帶著該任務進入口，但簡報與入口選項不可省略。
詳細流程見 .agents/skills/team-leader/SKILL.md。
=== 專案即時狀態 ===
EOF
./scripts/agent-status.sh
