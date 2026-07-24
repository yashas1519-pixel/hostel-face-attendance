#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# pre-push-check.sh
# MANDATORY gate before every git push.
# Runs the exact same checks as Vercel + GitHub Actions CI.
# Usage: bash pre-push-check.sh "commit message"
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/admin"
MSG="${1:-chore: update}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ BLOCKED: $1${NC}"; echo -e "${RED}Fix the errors above before pushing.${NC}"; exit 1; }
info() { echo -e "${YELLOW}▶  $1${NC}"; }
sep()  { echo -e "${BOLD}───────────────────────────────────────────────────────────${NC}"; }

echo ""
sep
echo -e "${BOLD}  🔒 Pre-Push Quality Gate — ALL checks must pass${NC}"
sep
echo ""

# ── 1. Backend TypeScript strict check ────────────────────────────────────────
info "[1/5] Backend TypeScript (tsc --noEmit)..."
cd "$BACKEND"
TS_BACK=$(node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | grep -v node_modules || true)
if [ -n "$TS_BACK" ]; then
  echo "$TS_BACK"
  fail "Backend TypeScript errors"
fi
pass "Backend TypeScript OK"

# ── 2. Backend NestJS build (catches import/module errors) ────────────────────
info "[2/5] Backend build (npm run build)..."
cd "$BACKEND"
BUILD_OUT=$(npm run build 2>&1 || true)
if echo "$BUILD_OUT" | grep -E "^error TS|error TS[0-9]|SyntaxError|Cannot find module|Module not found" | grep -v "node_modules" | grep -q "."; then
  echo "$BUILD_OUT" | grep -E "error TS|SyntaxError|Cannot find module" | grep -v "node_modules"
  fail "Backend build failed"
fi
pass "Backend build OK"

# ── 3. Frontend TypeScript (matches Vercel exactly) ───────────────────────────
info "[3/5] Frontend TypeScript (tsc --noEmit)..."
cd "$FRONTEND"
TS_FRONT=$(node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | grep -v "node_modules\|next.config" || true)
if [ -n "$TS_FRONT" ]; then
  echo "$TS_FRONT"
  fail "Frontend TypeScript errors"
fi
pass "Frontend TypeScript OK"

# ── 4. Frontend ESLint (errors = blocked, warnings = allowed) ─────────────────
info "[4/5] Frontend ESLint..."
cd "$FRONTEND"
LINT_ERRORS=$(node node_modules/eslint/bin/eslint.js src/ --format=json 2>/dev/null \
  | node -e "
      const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const errs=d.flatMap(f=>f.messages.filter(m=>m.severity===2).map(m=>f.filePath.split('/src/')[1]+':'+m.line+' ['+m.ruleId+'] '+m.message));
      if(errs.length){errs.forEach(e=>console.log(e));process.exit(1);}
    " || true)
if [ -n "$LINT_ERRORS" ]; then
  echo "$LINT_ERRORS"
  fail "Frontend ESLint errors"
fi
pass "Frontend ESLint OK (0 errors)"

# ── 5. Backend unit tests ─────────────────────────────────────────────────────
info "[5/5] Backend unit tests..."
cd "$BACKEND"
TEST_OUT=$(npx jest --passWithNoTests --silent --forceExit 2>&1 || true)
if echo "$TEST_OUT" | grep -q "FAIL\|Tests.*failed"; then
  echo "$TEST_OUT"
  fail "Backend unit tests failed"
fi
pass "Backend tests OK"

# ── All passed → push ─────────────────────────────────────────────────────────
echo ""
sep
echo -e "${GREEN}${BOLD}  ✅ ALL 5 CHECKS PASSED — pushing to GitHub${NC}"
sep
echo ""

cd "$ROOT"
git fetch origin master
git pull --rebase origin master 2>/dev/null || true
git add -A

if git diff --cached --quiet; then
  info "Nothing to commit — just pushing"
else
  git commit -m "$MSG"
fi
git push origin master

pass "Pushed to GitHub"

# ── Trigger Render deploy (if hook configured) ────────────────────────────────
if [ -n "${RENDER_DEPLOY_HOOK:-}" ]; then
  info "Triggering Render deploy…"
  curl -s "$RENDER_DEPLOY_HOOK" > /dev/null
  pass "Render deploy triggered"
else
  echo ""
  echo "  💡 Render auto-deploy: export RENDER_DEPLOY_HOOK='<your hook URL>'"
fi
echo ""
