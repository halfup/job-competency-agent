#!/usr/bin/env bash
# 把当前仓库推送到 GitHub（自动建私有仓库 + 设置 remote + push）
#
# 用法：
#   GITHUB_TOKEN=ghp_xxx ./scripts/push-to-github.sh [仓库名]
#
# 也可以在 GitHub 网页上先手动建好空仓库，然后：
#   GITHUB_TOKEN=ghp_xxx ./scripts/push-to-github.sh --existing
#
# GITHUB_TOKEN 需要 repo 权限（classic token 勾选 repo；fine-grained 勾选
# Contents: Read and write + Administration: Read and write）

set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${1:-job-competency-agent}"
MODE="${2:-create}"
: "${GITHUB_TOKEN:?请设置 GITHUB_TOKEN 环境变量，例如 GITHUB_TOKEN=ghp_xxx ./scripts/push-to-github.sh}"

API="https://api.github.com"
auth=(-H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json")

echo "→ 读取账号信息"
OWNER=$(curl -sS "${auth[@]}" "$API/user" | sed -n 's/.*"login": *"\([^"]*\)".*/\1/p' | head -1)
if [ -z "$OWNER" ]; then
  echo "❌ token 无效或没有 user 读取权限"
  exit 1
fi
echo "  账号: $OWNER"

# 提交者身份（用 GitHub 私有邮箱，避免暴露真实邮箱）
git config user.name "$OWNER"
git config user.email "${OWNER}@users.noreply.github.com"
BRANCH=$(git branch --show-current)
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "chore: 同步提交"
  echo "→ 已提交本地改动"
fi

if [ "$MODE" = "--existing" ]; then
  echo "→ 使用已存在的仓库 $OWNER/$REPO"
else
  echo "→ 创建私有仓库 $OWNER/$REPO"
  CODE=$(curl -sS -o /tmp/repo-create.json -w '%{http_code}' "${auth[@]}" \
    -X POST "$API/user/repos" \
    -d "{\"name\":\"$REPO\",\"private\":true,\"description\":\"职到 AI · 岗位胜任力评估智能体（Evidence-grounded 面试与能力评估系统）\"}")
  if [ "$CODE" != "201" ] && [ "$CODE" != "422" ]; then
    echo "❌ 建仓库失败 (HTTP $CODE)"; cat /tmp/repo-create.json; exit 1
  fi
  [ "$CODE" = "422" ] && echo "  仓库已存在，直接复用"
fi

echo "→ 配置 remote 并推送"
git remote remove origin 2>/dev/null || true
git remote add origin "https://${OWNER}:${GITHUB_TOKEN}@github.com/${OWNER}/${REPO}.git"
git push -u origin "$BRANCH" 2>&1 | sed 's/x-access-token:[^ ]*/x-access-token:***/'

# 推送完成后把 token 从 remote 地址里去掉，避免明文留在 .git/config
git remote set-url origin "https://github.com/${OWNER}/${REPO}.git"

echo "✅ 完成: https://github.com/${OWNER}/${REPO}"
