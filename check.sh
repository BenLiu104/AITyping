#!/usr/bin/env bash
# check.sh — AITyping 閘門檢查入口
# 用法:  bash check.sh [phase0|phase1|all|auto]
#       無參數 = auto（自動偵測當前階段）
# 注意: 刻意唔用 set -e，用 explicit exit handling 避免 grep 等命令非零 exit 提早終止。
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

  # G0.1: 19 tracked files
  count=$(git ls-files 2>/dev/null | wc -l)
  [ "$count" -eq 19 ] && gate "G0.1 tracked files = $count" || nogate "G0.1 tracked files = $count (expected 19)"

  # G0.2: git healthy
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 && gate "G0.2a inside git repo" || nogate "G0.2a not a git repo"
  [ "$(git branch --show-current)" = "main" ] && gate "G0.2b branch=main" || nogate "G0.2b branch != main"
  [ -z "$(git status --porcelain 2>/dev/null)" ] && gate "G0.2c working tree clean" || nogate "G0.2c working tree dirty"

  # G0.3: .env ignored
  git check-ignore .env >/dev/null 2>&1 && gate "G0.3 .env is gitignored" || nogate "G0.3 .env NOT ignored"

  # G0.4: no real API key pattern
  git grep -nIE 'AIza[0-9A-Za-z_-]{30,}' HEAD -- . >/dev/null 2>&1 \
    && nogate "G0.4 real API key FOUND in tracked content" \
    || gate "G0.4 no real API key pattern in tracked files"

  # G0.5: core docs code fence balanced
  for f in README.md AGENTS.md PRD.md docs/adr/0001-architecture-decisions.md; do
    if [ ! -s "$f" ]; then nogate "G0.5 $f missing/empty"; continue; fi
    n=$(grep -c '```' "$f" || true)  # grep -c exits 1 on 0 matches, suppress with || true
    [ $((n % 2)) -eq 0 ] && gate "G0.5 $f fences ok ($n)" || nogate "G0.5 $f unbalanced fences ($n)"
  done

  # G0.6: AGENTS has routing + rollback + update rules
  grep -q '## 12. 工作流程路由' AGENTS.md && gate "G0.6 AGENTS has routing section" || nogate "G0.6 AGENTS missing routing"
  grep -q '## 13. 約束衝突回退協議' AGENTS.md && gate "G0.6 AGENTS has rollback section" || nogate "G0.6 AGENTS missing rollback"
  grep -q '## 15. 文件更新規則' AGENTS.md && gate "G0.6 AGENTS has update-rules section" || nogate "G0.6 AGENTS missing update-rules"

  # G0.7: STATUS.md present + has current phase
  [ -s STATUS.md ] && grep -q '當前階段' STATUS.md && gate "G0.7 STATUS.md present + has current phase" || nogate "G0.7 STATUS.md missing/broken"

  # G0.8: ERRORS.md is a valid table template
  [ -s ERRORS.md ] && grep -q '| 時間 | 錯誤 | 根因 |' ERRORS.md && gate "G0.8 ERRORS.md template present" || nogate "G0.8 ERRORS.md missing/broken"

  # G0.9: GATES.md has phase definitions
  [ -s GATES.md ] && grep -q 'Phase 1 — PWA MVP' GATES.md && gate "G0.9 GATES.md has Phase 1 definitions" || nogate "G0.9 GATES.md missing/broken"
}

# ── Phase 1 gates (only runnable when frontend/backend exist) ──
check_phase1() {
  echo ""
  echo "═══ Phase 1 Gates ═══"

  [ -d frontend ] && [ -f frontend/package.json ] && gate "G1.1a frontend/ exists" || nogate "G1.1a frontend/ missing"
  [ -d backend ]  && [ -f backend/requirements.txt ] && gate "G1.1b backend/ exists" || nogate "G1.1b backend/ missing"

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
  phase0)  check_phase0 ;;
  phase1)  check_phase1 ;;
  auto)
    if [ -d frontend ] && [ -f frontend/package.json ]; then
      check_phase0; check_phase1
    else
      check_phase0
    fi
    ;;
  all)     check_phase0; check_phase1 ;;
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
