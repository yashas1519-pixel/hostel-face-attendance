#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# pre-push-check.sh
# Run before every git push. Verifies backend + frontend + tests, then pushes.
# Usage: bash pre-push-check.sh "commit message"
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/admin"
MSG="${1:-chore: update}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }
info() { echo -e "${YELLOW}▶ $1${NC}"; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Pre-Push Quality Gate"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. Backend build ──────────────────────────────────────────────────────────
info "Backend: npm run build"
cd "$BACKEND"
BUILD_OUT=$(npm run build 2>&1 || true)
if echo "$BUILD_OUT" | grep -E "error TS|SyntaxError|Cannot find module" | grep -v "^>" | grep -q "." ; then
  echo "$BUILD_OUT" | grep -E "error TS|SyntaxError" | grep -v "^>"
  fail "Backend build failed — fix errors above before pushing."
fi
pass "Backend build OK"

# ── 2. Backend unit tests ─────────────────────────────────────────────────────
info "Backend: unit tests"
cd "$BACKEND"
TEST_OUT=$(npx jest --passWithNoTests --silent 2>&1 || true)
if echo "$TEST_OUT" | grep -q "FAIL\|Tests.*failed"; then
  echo "$TEST_OUT"
  fail "Backend unit tests failed — fix tests before pushing."
fi
pass "Backend tests OK"

# ── 3. Frontend TypeScript (matches Vercel exactly — no --skipLibCheck) ───────
info "Frontend: tsc --noEmit"
cd "$FRONTEND"
TS_ERRORS=$(node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "error TS" | grep -v "node_modules\|next.config" || true)
if [ -n "$TS_ERRORS" ]; then
  echo "$TS_ERRORS"
  fail "Frontend TypeScript errors — fix above before pushing."
fi
pass "Frontend TypeScript OK"

# ── 4. Frontend ESLint (errors only, warnings allowed) ────────────────────────
info "Frontend: ESLint"
cd "$FRONTEND"
LINT_ERRORS=$(node node_modules/eslint/bin/eslint.js src/ --format=json 2>/dev/null \
  | node -e "
      const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const errs=d.flatMap(f=>f.messages.filter(m=>m.severity===2).map(m=>f.filePath.split('/src/')[1]+':'+m.line+' '+m.message));
      if(errs.length){errs.forEach(e=>console.log(e));process.exit(1);}
    " || true)
if [ -n "$LINT_ERRORS" ]; then
  echo "$LINT_ERRORS"
  fail "Frontend ESLint errors — fix above before pushing."
fi
pass "Frontend ESLint OK"

# ── 5. Push to GitHub ─────────────────────────────────────────────────────────
echo ""
info "All checks passed — pushing to GitHub"
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

pass "Pushed to GitHub ✅"

# ── 6. Trigger Render deploy (if hook configured) ─────────────────────────────
if [ -n "${RENDER_DEPLOY_HOOK:-}" ]; then
  info "Triggering Render deploy…"
  curl -s "$RENDER_DEPLOY_HOOK" > /dev/null
  pass "Render deploy triggered ✅"
else
  echo ""
  echo "  💡 To auto-deploy Render on push:"
  echo "     export RENDER_DEPLOY_HOOK='https://api.render.com/deploy/srv-xxx?key=yyy'"
  echo "     (Get it from: Render Dashboard → your service → Settings → Deploy Hook)"
fi
echo ""
