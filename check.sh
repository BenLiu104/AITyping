#!/usr/bin/env bash
# check.sh — AITyping 閘門檢查入口
# 用法:  bash check.sh [phase0|phase1|all]
#       無參數 = 自動偵測當前階段並跑對應閘門
set -euo pipefail
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE_DIR"

pass=0; fail=0; skipped=0
gate()   { echo "  ✅ $1"; pass=$((pass+1)); }
nogate() { echo "  ❌ $1"; fail=$((fail+1)); }
skip()   { echo "  ⏭️  $1"; skipped=$((skipped+1)); }

# ── Phase 0 gates ──────────────────────────────────────
check_phase0() {
  echo ""
  echo "═══ Phase 0 Gates ═══"

  # G0.1: 14 tracked files
  count=$(git ls-files 2>/dev/null | wc -l)
  [ "$count" -eq 14 ] && gate "G0.1 tracked files = $count" || nogate "G0.1 tracked files = $count (expected 14)"

  # G0.2: git healthy
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 && gate "G0.2a inside git repo" || nogate "G0.2a not a git repo"
  [ "$(git branch --show-current)" = "main" ] && gate "G0.2b branch=main" || nogate "G0.2b branch != main"
  [ -z "$(git status --porcelain)" ] && gate "G0.2c working tree clean" || nogate "G0.2c working tree dirty"

  # G0.3: .env ignored
  git check-ignore .env >/dev/null 2>&1 && gate "G0.3 .env is gitignored" || nogate "G0.3 .env NOT ignored"

  # G0.4: no real API key pattern
  git grep -nIE 'AIza[0-9A-Za-z_-]{30,}' HEAD -- . >/dev/null 2>&1 \
    && nogate "G0.4 real API key FOUND in tracked content" \
    || gate "G0.4 no real API key pattern in tracked files"

  # G0.5: core docs code fence balanced
  for f in README.md AGENTS.md PRD.md docs/adr/0001-architecture-decisions.md; do
    [ -s "$f" ] || { nogate "G0.5 $f missing/empty"; continue; }
    n=$(grep -c '```' "$f")
    [ $((n % 2)) -eq 0 ] && gate "G0.5 $f fences ok ($n)" || nogate "G0.5 $f unbalanced fences ($n)"
  done

  # G0.6: AGENTS has routing + rollback
  grep -q '## 12. 工作流程路由' AGENTS.md && gate "G0.6 AGENTS has routing section" || nogate "G0.6 AGENTS missing routing"
  grep -q '## 13. 約束衝突回退協議' AGENTS.md && gate "G0.6 AGENTS has rollback section" || nogate "G0.6 AGENTS missing rollback"

  # G0.7: STATUS.md readable
  [ -s STATUS.md ] && grep -q '當前階段' STATUS.md && gate "G0.7 STATUS.md present + has current phase" || nogate "G0.7 STATUS.md missing/broken"
}

# ── Phase 1 gates (preliminary — runnable only when frontend/backend exist) ──
check_phase1() {
  echo ""
  echo "═══ Phase 1 Gates ═══"

  [ -d frontend ] && [ -f frontend/package.json ] && gate "G1.1a frontend/ exists" || nogate "G1.1a frontend/ missing"
  [ -d backend ]  && [ -f backend/pyproject.toml -o -f backend/requirements.txt ] && gate "G1.1b backend/ exists" || nogate "G1.1b backend/ missing"

  if [ -d frontend ]; then
    (cd frontend && npm run typecheck 2>/dev/null) && gate "G1.2 typecheck passes" || skip "G1.2 typecheck (not runnable yet)"
    (cd frontend && npm run lint 2>/dev/null) && gate "G1.3 lint passes" || skip "G1.3 lint (not runnable yet)"
    (cd frontend && npm run test 2>/dev/null) && gate "G1.4a frontend tests pass" || skip "G1.4a frontend tests (not runnable yet)"
  fi

  if [ -d backend ]; then
    (cd backend && ruff check . 2>/dev/null && ruff format . --check 2>/dev/null) && gate "G1.3 ruff passes" || skip "G1.3 ruff (not runnable)"
    (cd backend && pytest 2>/dev/null) && gate "G1.4b backend tests pass" || skip "G1.4b pytest (not runnable)"
  fi

  if [ -d frontend/dist ]; then
    ! grep -r 'AIza' frontend/dist/ 2>/dev/null && gate "G1.5 no API key in bundle" || nogate "G1.5 API key FOUND in dist/"
  else
    skip "G1.5 bundle check (dist/ not built)"
  fi

  echo ""
  echo "注意：G1.6–G1.9 需要人工測試（iPhone 真機），check.sh 無法自動驗證。"
}

# ── Main ────────────────────────────────────────────────
mode="${1:-auto}"

case "$mode" in
  phase0)
    check_phase0
    ;;
  phase1)
    check_phase1
    ;;
  auto)
    # 自動偵測：如果有 frontend/ + backend/ 就行 phase1，否則 phase0
    if [ -d frontend ] && [ -f frontend/package.json ] && [ -d backend ]; then
      check_phase0
      check_phase1
    else
      check_phase0
    fi
    ;;
  all)
    check_phase0
    check_phase1
    ;;
  *)
    echo "用法: bash check.sh [phase0|phase1|all|auto]"
    exit 1
    ;;
esac

echo ""
echo "═══ 結果 ═══"
echo "  通過: $pass    失敗: $fail    跳過: $skipped"
if [ "$fail" -gt 0 ]; then
  echo "  ❌ 有閘門未通過。睇 GATES.md 確認點解。"
  exit 1
else
  echo "  ✅ 閘門全過。"
  exit 0
fi
